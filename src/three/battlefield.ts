import Phaser from 'phaser';
import * as THREE from 'three';
import { add, cyl, toon } from './parts';
import { getTimeScale, getView } from './view';

/**
 * Stylized 3D forest road rendered into its own canvas and registered as a Phaser
 * texture, drawn as the bottom layer of a scene. One road segment of props is built
 * three times end to end; scrolling slides the world by the segment length modulo,
 * so the march between waves loops forever without a seam.
 */

export const BF_KEY = 'battlefield3d';
const W = 540;
const H = 960;
/** Segment length along the road, world units. */
const L = 32;
const GROUND_W = 30;
const ROAD = 3.3;
/** World units per scrolled 2D pixel (the 2D background's scroll unit). */
const PX = 0.02;
/** Camera orbit pivot on the ground and the default camera offset from it. */
const PIVOT = new THREE.Vector3(0, 0, -6);
const CAM_OFFSET = new THREE.Vector3(0, 28, 20);
const CAM_DIST = CAM_OFFSET.length();
const CAM_ELEV = Math.atan2(CAM_OFFSET.y, CAM_OFFSET.z);
const FOG_NEAR = 36;
const FOG_FAR = 66;

export type Mood = 'day' | 'boss' | 'elite' | 'rage';

const MOODS: Record<Mood, { fog: number; sky: number; ground: number; sun: number; sunI: number; hemiI: number }> = {
  day: { fog: 0x7d8458, sky: 0xfff1d6, ground: 0x4a5a2a, sun: 0xffe2b0, sunI: 2.3, hemiI: 1.5 },
  boss: { fog: 0x3b2440, sky: 0xc8a0ff, ground: 0x3a2030, sun: 0xff9a7a, sunI: 1.5, hemiI: 1.0 },
  elite: { fog: 0x8a5a3a, sky: 0xffc89a, ground: 0x4a3a20, sun: 0xff9a4a, sunI: 2.0, hemiI: 1.2 },
  rage: { fog: 0x4a1210, sky: 0xff8a6a, ground: 0x3a1010, sun: 0xff4a2a, sunI: 1.9, hemiI: 0.9 },
};

function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Value noise that tiles every `period` cells vertically, so the ground texture repeats without a seam. */
function periodicNoise(seed: number, cellsX: number, cellsY: number) {
  const r = rng(seed);
  const grid = Array.from({ length: cellsX * cellsY }, () => r());
  const at = (x: number, y: number) => grid[(((y % cellsY) + cellsY) % cellsY) * cellsX + Math.min(cellsX - 1, Math.max(0, x))];
  return (u: number, v: number) => {
    const x = u * (cellsX - 1);
    const y = v * cellsY;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
    const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
}

/** Road half-width along the segment (v: 0..1), periodic so segments join. */
const roadEdge = (v: number) => ROAD + 0.45 * Math.sin(v * Math.PI * 4) + 0.3 * Math.sin(v * Math.PI * 6 + 1.3);

function groundTexture() {
  const tw = 512;
  const th = 1024;
  const canvas = document.createElement('canvas');
  canvas.width = tw;
  canvas.height = th;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(tw, th);
  const coarse = periodicNoise(1, 12, 20);
  const fine = periodicNoise(2, 48, 80);
  const r = rng(3);
  for (let py = 0; py < th; py++) {
    const v = py / th;
    const edge = roadEdge(v);
    for (let px = 0; px < tw; px++) {
      const u = px / tw;
      const x = (u - 0.5) * GROUND_W;
      const n = coarse(u, v);
      const f = fine(u, v);
      const d = Math.abs(x) - edge + (n - 0.5) * 1.6;
      const grass = Math.min(1, Math.max(0, (d + 0.5) / 1.0));
      const dirt = [150 + 40 * (n - 0.5) + 30 * (f - 0.5), 112 + 30 * (n - 0.5) + 22 * (f - 0.5), 70 + 18 * (f - 0.5)];
      const g = 0.75 + 0.5 * n;
      const gr = [70 * g + 18 * (f - 0.5), 96 * g + 26 * (f - 0.5), 42 * g + 10 * (f - 0.5)];
      const i = (py * tw + px) * 4;
      img.data[i] = dirt[0] + (gr[0] - dirt[0]) * grass;
      img.data[i + 1] = dirt[1] + (gr[1] - dirt[1]) * grass;
      img.data[i + 2] = dirt[2] + (gr[2] - dirt[2]) * grass;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  // pebbles on the road, darker tufts in the grass
  for (let k = 0; k < 900; k++) {
    const px = r() * tw;
    const py = r() * th;
    const x = (px / tw - 0.5) * GROUND_W;
    const onRoad = Math.abs(x) < roadEdge(py / th) - 0.3;
    ctx.fillStyle = onRoad ? `rgba(90,68,44,${0.35 + r() * 0.4})` : `rgba(40,62,24,${0.3 + r() * 0.4})`;
    const s = onRoad ? 1 + r() * 2.5 : 1.5 + r() * 3;
    for (const dy of [-th, 0, th]) ctx.fillRect(px, py + dy, s, s * (onRoad ? 1 : 2));
  }
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 3);
  tex.anisotropy = 4;
  return tex;
}

const M = {
  trunk: toon(0x5a3a22),
  pine: [toon(0x2f5a2c), toon(0x27502a), toon(0x3a6630)],
  rock: toon(0x8a8a82),
  rockDark: toon(0x6a6a64),
  wood: toon(0x7a5232),
  woodDark: toon(0x4a3020),
  iron: toon(0x4a4a50),
  red: toon(0xa01e1a),
  blue: toon(0x23488f),
  gold: toon(0xd8a43a),
};

const shadowed = <T extends THREE.Object3D>(o: T) => {
  o.traverse((c) => ((c as THREE.Mesh).isMesh ? (c.castShadow = true) : null));
  return o;
};

function pine(r: () => number) {
  const g = new THREE.Group();
  const s = 0.8 + r() * 0.6;
  add(g, cyl(0.16, 0.22, 1.2, M.trunk, 7), 0, 0.6, 0);
  const m = M.pine[Math.floor(r() * M.pine.length)];
  [0, 1, 2].forEach((i) => {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(1.3 - i * 0.32, 1.5, 8), m);
    add(g, cone, 0, 1.4 + i * 0.85, 0).rotation.y = r() * Math.PI;
  });
  g.scale.setScalar(s);
  g.rotation.y = r() * Math.PI;
  return shadowed(g);
}

function rock(r: () => number) {
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.4 + r() * 0.45, 0), r() < 0.5 ? M.rock : M.rockDark);
  m.scale.set(1, 0.55 + r() * 0.3, 0.8 + r() * 0.4);
  m.rotation.set(r(), r() * 3, r());
  m.position.y = 0.1;
  return shadowed(m);
}

function barrel() {
  const g = new THREE.Group();
  add(g, cyl(0.32, 0.32, 0.8, M.wood, 12), 0, 0.4, 0);
  [0.15, 0.65].forEach((y) => add(g, cyl(0.335, 0.335, 0.07, M.iron, 12), 0, y, 0));
  return shadowed(g);
}

function barricade(r: () => number) {
  const g = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const stake = new THREE.Group();
    add(stake, cyl(0.12, 0.14, 1.6, M.wood, 6), 0, 0.8, 0);
    add(stake, new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.4, 6), M.woodDark), 0, 1.8, 0);
    stake.position.set((i - 2) * 0.42, 0, 0);
    stake.rotation.x = -0.55 + (r() - 0.5) * 0.2;
    g.add(stake);
  }
  const beam = add(g, cyl(0.1, 0.1, 2.2, M.woodDark, 6), 0, 0.5, 0.25);
  beam.rotation.z = Math.PI / 2;
  return shadowed(g);
}

interface Fire {
  flame: THREE.Object3D;
  light: THREE.PointLight;
  embers: THREE.Points;
  seed: number;
}

const FLAME_OUT = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.9 });
const FLAME_IN = new THREE.MeshBasicMaterial({ color: 0xffe07a });
const EMBER = new THREE.PointsMaterial({ color: 0xffa040, size: 0.12, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });

function campfire(fires: Fire[]) {
  const g = new THREE.Group();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const s = add(g, new THREE.Mesh(new THREE.DodecahedronGeometry(0.16, 0), M.rockDark), Math.cos(a) * 0.5, 0.08, Math.sin(a) * 0.5);
    s.castShadow = true;
  }
  [0, 1, 2].forEach((i) => {
    const log = add(g, cyl(0.07, 0.07, 0.8, M.woodDark, 6), 0, 0.12, 0);
    log.rotation.set(Math.PI / 2, 0, (i / 3) * Math.PI);
  });
  const flame = new THREE.Group();
  add(flame, new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.8, 7), FLAME_OUT), 0, 0.4, 0);
  add(flame, new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.5, 6), FLAME_IN), 0, 0.3, 0);
  g.add(flame);
  const light = add(g, new THREE.PointLight(0xff8a30, 6, 6, 1.6), 0, 0.9, 0);
  const n = 18;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
  const embers = new THREE.Points(geo, EMBER);
  g.add(embers);
  fires.push({ flame, light, embers, seed: Math.random() * 10 });
  return g;
}

function banner(color: THREE.Material, cloths: THREE.Mesh[]) {
  const g = new THREE.Group();
  add(g, cyl(0.06, 0.07, 3, M.woodDark, 6), 0, 1.5, 0);
  const bar = add(g, cyl(0.04, 0.04, 1.1, M.woodDark, 6), 0, 2.9, 0);
  bar.rotation.z = Math.PI / 2;
  add(g, new THREE.Mesh(new THREE.SphereGeometry(0.08, 8, 6), M.gold), 0, 3.05, 0);
  const geo = new THREE.PlaneGeometry(0.95, 1.4, 6, 8);
  geo.translate(0, -0.7, 0);
  geo.userData.rest = (geo.attributes.position.array as Float32Array).slice();
  const cloth = add(g, new THREE.Mesh(geo, color), 0, 2.85, 0.02);
  (cloth.material as THREE.Material).side = THREE.DoubleSide;
  cloths.push(cloth);
  return shadowed(g);
}

/** One road segment of props; local z spans [-L/2, L/2]. Same seed → identical copies that tile. */
function buildSegment(fires: Fire[], cloths: THREE.Mesh[]) {
  const r = rng(7);
  const seg = new THREE.Group();
  const taken: { x: number; z: number; rad: number }[] = [];
  const place = (obj: THREE.Object3D, side: number, xMin: number, xMax: number, rad: number, tries = 12) => {
    for (let t = 0; t < tries; t++) {
      const z = (r() - 0.5) * L;
      const x = side * (xMin + r() * (xMax - xMin)) + 0;
      const edge = roadEdge((((-z / L + 0.5) % 1) + 1) % 1);
      if (Math.abs(x) < edge + rad + 0.3) continue;
      if (taken.some((p) => Math.hypot(p.x - x, p.z - z) < p.rad + rad)) continue;
      taken.push({ x, z, rad });
      obj.position.x = x;
      obj.position.z = z;
      seg.add(obj);
      return obj;
    }
    return null;
  };
  // set pieces first so they get the spots right by the road
  place(campfire(fires), -1, 4.6, 5.4, 0.9);
  place(campfire(fires), 1, 4.6, 5.4, 0.9);
  place(barricade(r), -1, 4.8, 5.6, 1.4)?.rotateY(0.3);
  place(barricade(r), 1, 4.8, 5.6, 1.4)?.rotateY(-0.3);
  place(banner(M.red, cloths), -1, 4.4, 4.9, 0.8);
  place(banner(M.blue, cloths), 1, 4.4, 4.9, 0.8);
  for (const side of [-1, 1]) {
    for (let i = 0; i < 3; i++) {
      const b = place(barrel(), side, 4.3, 6, 0.45);
      if (b && r() < 0.5) place(barrel(), side, 4.3, 6.5, 0.45);
    }
    for (let i = 0; i < 7; i++) place(rock(r), side, 4.0, 10, 0.6);
    for (let i = 0; i < 14; i++) place(pine(r), side, 5.6, 13, 1.1, 20);
  }
  return seg;
}

class Battlefield {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, W / H, 1, 120);
  /** Default framing: the 2D layout is authored against this view. */
  private home = new THREE.PerspectiveCamera(40, W / H, 1, 120);
  private ray = new THREE.Raycaster();
  private ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private pivot = new THREE.Vector3();
  private world = new THREE.Group();
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private fog: THREE.Fog;
  private fires: Fire[] = [];
  private cloths: THREE.Mesh[] = [];
  private motes: THREE.Points;
  private timer = new THREE.Timer();
  private time = 0;
  private game?: Phaser.Game;
  private users = 0;
  private mood = { from: MOODS.day, to: MOODS.day, t: 1 };
  /** Scroll position in 2D pixels (same unit as the old tileSprite offset). */
  scroll = 0;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(W, H, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.fog = new THREE.Fog(MOODS.day.fog, FOG_NEAR, FOG_FAR);
    this.scene.fog = this.fog;
    this.scene.background = new THREE.Color(MOODS.day.fog);
    this.home.position.copy(PIVOT).add(CAM_OFFSET);
    this.home.lookAt(PIVOT);
    this.home.updateMatrixWorld();
    this.placeCamera();

    this.hemi = new THREE.HemisphereLight(MOODS.day.sky, MOODS.day.ground, MOODS.day.hemiI);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(MOODS.day.sun, MOODS.day.sunI);
    this.sun.position.set(-10, 20, 2);
    this.sun.target.position.set(0, 0, -8);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    Object.assign(this.sun.shadow.camera, { left: -16, right: 16, top: 26, bottom: -26, near: 1, far: 60 });
    this.sun.shadow.bias = -0.0015;
    this.scene.add(this.sun, this.sun.target);

    const ground = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_W, L * 3), new THREE.MeshLambertMaterial({ map: groundTexture() }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.z = -L;
    ground.receiveShadow = true;
    this.world.add(ground);
    for (let k = -2; k <= 0; k++) {
      const seg = buildSegment(this.fires, this.cloths);
      seg.position.z = k * L;
      this.world.add(seg);
    }
    this.scene.add(this.world);

    // drifting pollen / fireflies in front of the camera, independent of scrolling
    const n = 70;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos.set([(Math.random() - 0.5) * 16, 0.5 + Math.random() * 5, -26 + Math.random() * 30], i * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.motes = new THREE.Points(
      geo,
      new THREE.PointsMaterial({ color: 0xfff0b0, size: 0.09, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
    );
    this.scene.add(this.motes);
  }

  attach(game: Phaser.Game) {
    if (this.game) return;
    this.game = game;
    const tex = game.textures.create(BF_KEY, this.renderer.domElement as unknown as HTMLImageElement, W, H)!;
    tex.add('__BASE', 0, 0, 0, W, H);
    game.events.on(Phaser.Core.Events.PRE_RENDER, () => this.users > 0 && this.render());
  }

  acquire() {
    this.users++;
  }

  release() {
    this.users = Math.max(0, this.users - 1);
  }

  setMood(m: Mood, instant = false) {
    this.mood = { from: this.currentMood(), to: MOODS[m], t: instant ? 1 : 0 };
  }

  private currentMood() {
    const { from, to, t } = this.mood;
    const c = (a: number, b: number) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();
    return {
      fog: c(from.fog, to.fog),
      sky: c(from.sky, to.sky),
      ground: c(from.ground, to.ground),
      sun: c(from.sun, to.sun),
      sunI: from.sunI + (to.sunI - from.sunI) * t,
      hemiI: from.hemiI + (to.hemiI - from.hemiI) * t,
    };
  }

  /** Orbit the camera about PIVOT (shifted by any focus) by the shared view yaw/pitch. */
  private placeCamera() {
    const { yaw, pitch, dist: zoom, fx, fz } = getView();
    const elev = CAM_ELEV + pitch;
    const dist = CAM_DIST * zoom;
    const flat = dist * Math.cos(elev);
    const pivot = this.pivot.set(PIVOT.x + fx, PIVOT.y, PIVOT.z + fz);
    this.camera.position.set(pivot.x + flat * Math.sin(yaw), pivot.y + dist * Math.sin(elev), pivot.z + flat * Math.cos(yaw));
    this.camera.lookAt(pivot);
    this.camera.updateMatrixWorld();
    // keep the haze at the same depth behind the field when zooming
    this.fog.near = FOG_NEAR + (dist - CAM_DIST);
    this.fog.far = FOG_FAR + (dist - CAM_DIST);
  }

  /**
   * Where a ground point drawn at 2D (x, y) in the default view appears now,
   * and how much nearer (>1) or farther it is, for scaling sprites standing there.
   */
  remap(x: number, y: number) {
    this.placeCamera();
    this.ray.setFromCamera(new THREE.Vector2((x / W) * 2 - 1, 1 - (y / H) * 2), this.home);
    const p = this.ray.ray.intersectPlane(this.ground, new THREE.Vector3());
    if (!p) return { x, y, scale: 1 };
    const scale = p.distanceTo(this.home.position) / p.distanceTo(this.camera.position);
    const s = p.clone().project(this.camera);
    return { x: ((s.x + 1) / 2) * W, y: ((1 - s.y) / 2) * H, scale };
  }

  /** Ground point under 2D (x, y) of the default view, as an offset from PIVOT. */
  groundOffset(x: number, y: number) {
    this.ray.setFromCamera(new THREE.Vector2((x / W) * 2 - 1, 1 - (y / H) * 2), this.home);
    const p = this.ray.ray.intersectPlane(this.ground, new THREE.Vector3());
    return p ? { x: p.x - PIVOT.x, z: p.z - PIVOT.z } : { x: 0, z: 0 };
  }

  private render() {
    this.placeCamera();
    this.timer.update();
    const dt = Math.min(0.05, this.timer.getDelta()) * getTimeScale();
    this.time += dt;
    const t = this.time;

    if (this.mood.t < 1) {
      this.mood.t = Math.min(1, this.mood.t + dt / 1.2);
      const m = this.currentMood();
      this.fog.color.setHex(m.fog);
      (this.scene.background as THREE.Color).setHex(m.fog);
      this.hemi.color.setHex(m.sky);
      this.hemi.groundColor.setHex(m.ground);
      this.hemi.intensity = m.hemiI;
      this.sun.color.setHex(m.sun);
      this.sun.intensity = m.sunI;
    }

    this.world.position.z = (((-this.scroll * PX) % L) + L) % L;

    this.fires.forEach((f, i) => {
      const k = t * 9 + f.seed;
      f.flame.scale.set(1 + 0.12 * Math.sin(k * 1.7), 1 + 0.25 * Math.sin(k) * Math.sin(k * 2.3), 1 + 0.12 * Math.cos(k * 1.3));
      f.light.intensity = 5 + 1.6 * Math.sin(k * 1.9) + Math.sin(k * 3.7);
      const arr = f.embers.geometry.attributes.position.array as Float32Array;
      for (let j = 0; j < arr.length / 3; j++) {
        const life = (t * 0.6 + j / (arr.length / 3) + i * 0.13) % 1;
        const a = j * 2.4 + i;
        arr[j * 3] = Math.cos(a) * 0.15 * (1 + life) + Math.sin(t + j) * 0.08 * life;
        arr[j * 3 + 1] = 0.4 + life * 2.2;
        arr[j * 3 + 2] = Math.sin(a) * 0.15 * (1 + life);
      }
      f.embers.geometry.attributes.position.needsUpdate = true;
    });

    this.cloths.forEach((c, i) => {
      const pos = c.geometry.attributes.position;
      const rest = c.geometry.userData.rest as Float32Array;
      for (let j = 0; j < pos.count; j++) {
        const x = rest[j * 3];
        const y = rest[j * 3 + 1];
        const w = (x + 0.48) * (0.2 - y * 0.12);
        pos.setZ(j, Math.sin(t * 3 + x * 4 + y * 2 + i) * 0.12 * w);
      }
      pos.needsUpdate = true;
      c.geometry.computeVertexNormals();
    });

    const mp = this.motes.geometry.attributes.position.array as Float32Array;
    for (let j = 0; j < mp.length / 3; j++) {
      mp[j * 3] += Math.sin(t * 0.7 + j) * 0.004;
      mp[j * 3 + 1] += Math.cos(t * 0.9 + j * 1.3) * 0.003;
    }
    this.motes.geometry.attributes.position.needsUpdate = true;
    (this.motes.material as THREE.PointsMaterial).opacity = 0.45 + 0.25 * Math.sin(t * 1.5);

    this.renderer.render(this.scene, this.camera);
    this.game?.textures.get(BF_KEY).source[0].update();
  }
}

let bf: Battlefield | null = null;

export function getBattlefield() {
  if (!bf) bf = new Battlefield();
  return bf;
}

export interface Background {
  /** Scroll in 2D pixels; decreasing values march forward. */
  setScroll(px: number): void;
  setMood(m: Mood): void;
  /** False for the flat fallback road, which can't orbit. */
  orbitable: boolean;
  remap(x: number, y: number): { x: number; y: number; scale: number };
  /** Ground offset from the camera pivot under a 2D point, for focusOn(). */
  groundOffset(x: number, y: number): { x: number; z: number };
}

/** Bottom layer of a scene: the 3D battlefield, or the flat painted road when WebGL is unavailable. */
export function addBackground(scene: Phaser.Scene, mood: Mood = 'day'): Background {
  const { width, height } = scene.scale;
  if (scene.textures.exists(BF_KEY)) {
    const field = getBattlefield();
    scene.add.image(0, 0, BF_KEY).setOrigin(0).setDisplaySize(width, height);
    field.acquire();
    field.setMood(mood, true);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => field.release());
    return {
      setScroll: (px) => (field.scroll = px),
      setMood: (m) => field.setMood(m),
      orbitable: true,
      remap: (x, y) => {
        const p = field.remap((x / width) * W, (y / height) * H);
        return { x: (p.x / W) * width, y: (p.y / H) * height, scale: p.scale };
      },
      groundOffset: (x, y) => field.groundOffset((x / width) * W, (y / height) * H),
    };
  }
  const tile = scene.add.tileSprite(0, 0, width, height, 'bg_loop').setOrigin(0);
  tile.tileScaleX = tile.tileScaleY = width / scene.textures.get('bg').getSourceImage().width;
  return {
    setScroll: (px) => (tile.tilePositionY = px),
    setMood: () => undefined,
    orbitable: false,
    remap: (x, y) => ({ x, y, scale: 1 }),
    groundOffset: () => ({ x: 0, z: 0 }),
  };
}
