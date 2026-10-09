import * as THREE from 'three';
import catalog from '../presentation.json';
import { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { add, cyl, horn, toon, toonMat, torus } from './parts';

/**
 * Rigged, animated CC0 characters (KayKit by Kay Lousberg, Quaternius) dressed up
 * as the Warcraft roster: atlas skin recolours, faction tints, props on bones.
 */

export type Action = 'attack' | 'cast' | 'hit' | 'cheer' | 'die' | 'stun';
export type Clip = Action | 'idle' | 'walk';

interface PropDef {
  bone: string;
  /** Offset from the bone, in normalized model units (model height ≈ HEIGHT), model axes. */
  offset: [number, number, number];
  build: () => THREE.Object3D;
}

interface ModelDef {
  file: string;
  /** [width/depth, height] multipliers applied after normalizing, e.g. a squat dwarf. */
  squash?: [number, number];
  hide?: string[];
  /** KayKit palette atlases: recolour skin-tone texels to this colour. */
  skin?: number;
  /** KayKit palette atlases: rotate saturated texels whose hue (degrees) is in `from` to hue `to`. */
  hue?: { from: [number, number]; to: number };
  /** Drop triangles of one material whose bind-space vertex matches (e.g. a halo baked into the body mesh). */
  trim?: { material: string; drop: (x: number, y: number, z: number) => boolean };
  /** Quaternius models: material name → colour. */
  tint?: Record<string, number>;
  /** Extra KayKit weapon files snapped onto rig hand slots. */
  attach?: { file: string; bone: string }[];
  props?: PropDef[];
  clips?: Partial<Record<Clip, string>>;
  float?: boolean;
}

const HEIGHT = 1.6;
const IVORY = 0xf6ecd2;

const KAY_WEAPONS = ['1H_Axe_Offhand', 'Barbarian_Round_Shield', '1H_Axe', 'Mug', 'Knife_Offhand', '1H_Crossbow', '2H_Crossbow', 'Spellbook', 'Spellbook_open', '1H_Wand'];

function hornPair(): THREE.Object3D {
  const g = new THREE.Group();
  const m = toon(IVORY);
  [-1, 1].forEach((s) => {
    const h = add(g, horn(0.34, 0.055, -s * 0.16, m), s * 0.2, 0, 0);
    h.rotation.z = -s * 1.2;
  });
  add(g, torus(0.05, 0.012, toon(0xf0b83a)), 0, -0.2, 0.32);
  return g;
}

function frostCrown(): THREE.Object3D {
  const g = new THREE.Group();
  const ice = toon(0x9fe4ff, 0.9);
  add(g, cyl(0.2, 0.22, 0.07, ice, 18));
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const sp = add(g, horn(0.16 + (i % 2) * 0.1, 0.03, 0, ice), Math.sin(a) * 0.2, 0.02, Math.cos(a) * 0.2);
    sp.rotation.set(Math.cos(a) * 0.3, 0, -Math.sin(a) * 0.3);
  }
  return g;
}

export const MODEL_DEFS: Record<keyof typeof catalog.models, ModelDef> = {
  p_orc: {
    file: 'Barbarian.glb',
    skin: 0x6cab3c,
    hide: [...KAY_WEAPONS, 'Barbarian_Hat'],
    clips: { idle: '2H_Melee_Idle', attack: '2H_Melee_Attack_Chop' },
  },
  p_troll: {
    file: 'Rogue.glb',
    skin: 0x4b93c4,
    hide: KAY_WEAPONS,
    clips: { attack: 'Throw' },
  },
  p_tauren: {
    file: 'Yeti.glb',
    tint: { Yeti_Main: 0x8f5a2e, Yeti_Secondary: 0xd8a878 },
    props: [{ bone: 'Head', offset: [0, 0.3, 0.05], build: hornPair }],
    clips: { attack: 'Punch', cast: 'Yes' },
  },
  p_mage: {
    file: 'Mage.glb',
    hide: KAY_WEAPONS,
    clips: { attack: 'Spellcast_Shoot', cast: 'Spellcast_Raise' },
  },
  p_dwarf: {
    file: 'Knight.glb',
    squash: [1.18, 0.86],
    clips: { attack: '1H_Melee_Attack_Chop' },
  },
  p_elf: {
    file: 'Rogue_Hooded.glb',
    skin: 0xa58ae0,
    hue: { from: [90, 180], to: 275 },
    hide: [...KAY_WEAPONS, 'Knife', 'Throwable'],
    clips: { attack: 'Spellcast_Shoot', cast: 'Spellcast_Raise' },
  },
  e_ghoul: { file: 'Zombie.glb', clips: { attack: 'Punch' } },
  e_skeleton: {
    file: 'Skeleton_Warrior.glb',
    attach: [
      { file: 'Skeleton_Blade.gltf', bone: 'handslotr' },
      { file: 'Skeleton_Shield_Small_A.gltf', bone: 'handslotl' },
    ],
    clips: { attack: '1H_Melee_Attack_Chop' },
  },
  e_necro: {
    file: 'Skeleton_Mage.glb',
    attach: [{ file: 'Skeleton_Staff.gltf', bone: 'handslotr' }],
    clips: { attack: 'Spellcast_Shoot', cast: 'Spellcast_Raise' },
  },
  e_abom: {
    file: 'Brute.glb',
    tint: { Orc_Main: 0xb4c49c, Orc_Secondary: 0x8a9a70, Orc_Hair: 0x4a5a3a, Orc_Mouth: 0x6a3040 },
    clips: { attack: 'Weapon' },
  },
  b_dragon: {
    file: 'Dragon.glb',
    tint: { Main: 0x86b2d2, Belly: 0xe0f0f8, Wings: 0x2f5f92, Claws: 0x1e2a44, Eyes: 0x8fe6ff },
    clips: { idle: 'Dragon_Flying', walk: 'Dragon_Flying', attack: 'Dragon_Attack', cast: 'Dragon_Attack2', hit: 'Dragon_Hit', stun: 'Dragon_Hit', die: 'Dragon_Death', cheer: 'Dragon_Attack2' },
    float: true,
  },
  b_lich: {
    file: 'GhostSkull.glb',
    tint: { Ghost_Main: 0x1e3f7a, Ghost_Secondary: 0xdce8f2 },
    props: [{ bone: 'Head', offset: [0, 0.42, 0], build: frostCrown }],
    clips: { attack: 'Punch', cast: 'Yes' },
    float: true,
  },
  b_demon: {
    file: 'Demon.glb',
    tint: { Demon_Main: 0x6a4a8e, Black: 0x1c2a1c },
    trim: { material: 'Black', drop: (x, _y, z) => z > 0.0275 && Math.abs(x) < 0.0072 },
    clips: { attack: 'Weapon', cast: 'Yes' },
  },
};

/** Fallback clip names per action, first match wins (names are stripped of "Armature|" prefixes). */
const CLIP_CANDIDATES: Record<Clip, string[]> = {
  idle: ['Idle', 'Flying_Idle'],
  walk: ['Walking_A', 'Walk', 'Fast_Flying', 'Run'],
  attack: ['1H_Melee_Attack_Chop', 'Weapon', 'Punch', 'Headbutt'],
  cast: ['Spellcast_Raise', 'Yes', 'Wave'],
  hit: ['Hit_A', 'HitReact', 'HitRecieve'],
  die: ['Death_A', 'Death'],
  cheer: ['Cheer', 'Yes', 'Wave'],
  stun: ['Hit_B', 'No', 'HitReact'],
};

const SKIN_TONES = [
  [240, 192, 152],
  [248, 200, 168],
  [240, 192, 160],
  [232, 176, 136],
];

/** Repaint a KayKit palette atlas: skin tones → `def.skin`, a hue band → `def.hue.to`, keeping texel shading. */
function paintAtlas(tex: THREE.Texture, def: ModelDef): THREE.Texture {
  const img = tex.image as HTMLImageElement | ImageBitmap;
  const canvas = document.createElement('canvas');
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(img, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = data.data;
  const skin = def.skin !== undefined ? new THREE.Color(def.skin) : null;
  const lum = (r: number, g: number, b: number) => 0.3 * r + 0.59 * g + 0.11 * b;
  const c = new THREE.Color();
  const hsl = { h: 0, s: 0, l: 0 };
  for (let i = 0; i < d.length; i += 4) {
    if (skin) {
      const tone = SKIN_TONES.find(([r, g, b]) => Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) < 30);
      if (tone) {
        const k = lum(d[i], d[i + 1], d[i + 2]) / lum(tone[0], tone[1], tone[2]);
        d[i] = Math.min(255, skin.r * 255 * k);
        d[i + 1] = Math.min(255, skin.g * 255 * k);
        d[i + 2] = Math.min(255, skin.b * 255 * k);
        continue;
      }
    }
    if (def.hue) {
      c.setRGB(d[i] / 255, d[i + 1] / 255, d[i + 2] / 255, THREE.SRGBColorSpace).getHSL(hsl, THREE.SRGBColorSpace);
      const deg = hsl.h * 360;
      if (hsl.s > 0.2 && deg >= def.hue.from[0] && deg <= def.hue.from[1]) {
        c.setHSL(def.hue.to / 360, hsl.s, hsl.l, THREE.SRGBColorSpace);
        const rgb = { r: 0, g: 0, b: 0 };
        c.getRGB(rgb, THREE.SRGBColorSpace);
        d[i] = rgb.r * 255;
        d[i + 1] = rgb.g * 255;
        d[i + 2] = rgb.b * 255;
      }
    }
  }
  ctx.putImageData(data, 0, 0);
  const out = new THREE.CanvasTexture(canvas);
  out.flipY = tex.flipY;
  out.colorSpace = tex.colorSpace;
  out.wrapS = tex.wrapS;
  out.wrapT = tex.wrapT;
  out.magFilter = tex.magFilter;
  out.minFilter = tex.minFilter;
  return out;
}

const OUTLINE = new THREE.MeshBasicMaterial({ color: 0x1e1008, side: THREE.BackSide });
// Offset in view space so line weight stays even on scaled parts; uses the skinned normal when rigged.
OUTLINE.onBeforeCompile = (shader) => {
  shader.vertexShader = shader.vertexShader.replace(
    '#include <project_vertex>',
    `#ifdef USE_SKINNING
      vec3 outlineN = objectNormal;
    #else
      vec3 outlineN = normal;
    #endif
    vec4 mvPosition = modelViewMatrix * vec4(transformed, 1.0);
    mvPosition.xyz += normalize(normalMatrix * outlineN) * 0.022;
    gl_Position = projectionMatrix * mvPosition;`,
  );
};

/** Inverted-hull outline; skinned hulls share the source skeleton so they deform with it. */
function addOutlines(root: THREE.Object3D) {
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh && m.visible && !(m.material as THREE.Material).transparent) meshes.push(m);
  });
  meshes.forEach((m) => {
    let hull: THREE.Mesh;
    if ((m as THREE.SkinnedMesh).isSkinnedMesh) {
      const sm = m as THREE.SkinnedMesh;
      const sh = new THREE.SkinnedMesh(sm.geometry, OUTLINE);
      sh.bind(sm.skeleton, sm.bindMatrix);
      sh.bindMode = sm.bindMode;
      hull = sh;
    } else {
      hull = new THREE.Mesh(m.geometry, OUTLINE);
    }
    hull.frustumCulled = false;
    m.add(hull);
  });
}

function toToon(m: THREE.Material, def: ModelDef, skinTex: Map<THREE.Texture, THREE.Texture>) {
  const src = m as THREE.MeshStandardMaterial;
  let map = src.map;
  if (map && (def.skin !== undefined || def.hue)) {
    if (!skinTex.has(map)) skinTex.set(map, paintAtlas(map, def));
    map = skinTex.get(map)!;
  }
  const color = def.tint?.[src.name] !== undefined ? new THREE.Color(def.tint[src.name]) : src.color.clone();
  const glow = /glow|eye/i.test(src.name) && !/eye_(white|black)/i.test(src.name);
  const mat = toonMat({
    name: src.name,
    color,
    map,
    transparent: src.transparent,
    opacity: src.opacity,
    alphaTest: src.alphaTest,
    side: src.side,
    emissive: glow ? color : 0x000000,
    emissiveIntensity: glow ? 1.4 : 0,
  });
  return mat;
}

export interface ModelProto {
  root: THREE.Group;
  clips: Partial<Record<Clip, THREE.AnimationClip>>;
  height: number;
  width: number;
  float: boolean;
  /** Static mesh without a rig: animated by transforming the whole model. */
  procedural: boolean;
}

/** `kit`: rigged CC0 characters; `ai`: image-to-3D meshes generated from the portraits. */
export type ModelSet = 'kit' | 'ai';
const SET_KEY = 'horde_models';

const protos: Record<ModelSet, Map<string, ModelProto>> = { kit: new Map(), ai: new Map() };
const loading: Partial<Record<ModelSet, Promise<void>>> = {};
let active: ModelSet = localStorage.getItem(SET_KEY) === 'ai' ? 'ai' : 'kit';

export function getModelSet(): ModelSet {
  return active;
}

/** Switch model sets (persisted); resolves once the set is loaded. */
export async function setModelSet(set: ModelSet) {
  active = set;
  localStorage.setItem(SET_KEY, set);
  await loadModels();
}

/** Number of AI-generated models available (0 until the AI set has loaded). */
export function aiModelCount() {
  return protos.ai.size;
}

function findClip(clips: THREE.AnimationClip[], name: string) {
  return clips.find((c) => c.name.split('|').pop() === name);
}

/** Snap a prop to a bone so it lines up with model axes in the rest pose. */
function attachProp(root: THREE.Object3D, p: PropDef) {
  const bone = root.getObjectByName(p.bone);
  if (!bone) return;
  root.updateMatrixWorld(true);
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const scl = new THREE.Vector3();
  bone.matrixWorld.decompose(pos, quat, scl);
  const obj = p.build();
  obj.traverse((o) => ((o as THREE.Mesh).isMesh ? (o.userData.prop = true) : null));
  const world = pos.add(new THREE.Vector3(...p.offset));
  bone.add(obj);
  obj.position.copy(bone.worldToLocal(world));
  obj.quaternion.copy(quat.invert());
  obj.scale.setScalar(1 / scl.x);
}

async function buildProto(def: ModelDef, loader: GLTFLoader, files: Map<string, Promise<GLTF>>): Promise<ModelProto> {
  const load = (f: string) => {
    if (!files.has(f)) files.set(f, loader.loadAsync(`models/${f}`));
    return files.get(f)!;
  };
  const gltf = await load(def.file);
  const scene = cloneSkinned(gltf.scene);

  for (const a of def.attach ?? []) {
    const bone = scene.getObjectByName(a.bone);
    const w = await load(a.file);
    if (bone) bone.add(w.scene.clone());
  }
  const hide = new Set(def.hide ?? []);
  const skinTex = new Map<THREE.Texture, THREE.Texture>();
  const mats = new Map<THREE.Material, THREE.Material>();
  scene.traverse((o) => {
    if (hide.has(o.name)) o.visible = false;
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = false;
    const conv = (x: THREE.Material) => {
      if (!mats.has(x)) mats.set(x, toToon(x, def, skinTex));
      return mats.get(x)!;
    };
    if (def.trim && !Array.isArray(m.material) && m.material.name === def.trim.material) trimGeometry(m, def.trim.drop);
    m.material = Array.isArray(m.material) ? m.material.map(conv) : conv(m.material);
  });

  const clips: Partial<Record<Clip, THREE.AnimationClip>> = {};
  (Object.keys(CLIP_CANDIDATES) as Clip[]).forEach((k) => {
    const names = [def.clips?.[k], ...CLIP_CANDIDATES[k]].filter(Boolean) as string[];
    for (const n of names) {
      const c = findClip(gltf.animations, n);
      if (c) {
        clips[k] = c;
        break;
      }
    }
  });

  // Measure in the idle pose (bind poses are often T-poses) and normalize: feet at origin, height = HEIGHT.
  const mixer = new THREE.AnimationMixer(scene);
  if (clips.idle) mixer.clipAction(clips.idle).play();
  mixer.update(0);
  const { root, width } = normalize(scene, def.squash ?? [1, 1]);
  mixer.stopAllAction();
  mixer.uncacheRoot(scene);

  def.props?.forEach((p) => attachProp(root, p));
  addOutlines(root);

  return { root, clips, height: HEIGHT * (def.squash?.[1] ?? 1), width, float: !!def.float, procedural: false };
}

/** Wrap `scene` so its feet sit at the origin and it stands HEIGHT tall (times squash). */
function normalize(scene: THREE.Object3D, [sx, sy]: [number, number]) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3();
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && o.visible && isShown(o)) box.expandByObject(o, true);
  });
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const s = HEIGHT / size.y;
  const inner = new THREE.Group();
  inner.add(scene);
  inner.scale.set(s * sx, s * sy, s * sx);
  inner.position.set(-center.x * s * sx, -box.min.y * s * sy, -center.z * s * sx);
  const root = new THREE.Group();
  root.add(inner);
  return { root, width: Math.max(size.x, size.z) * s * sx };
}

/** AI meshes carry baked colour textures; keep them, swap in toon shading and outlines. */
async function buildAiProto(art: string, loader: GLTFLoader, yawDeg = 180): Promise<ModelProto> {
  const gltf = await loader.loadAsync(`models/ai/${art}.glb`);
  const scene = gltf.scene;
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    m.frustumCulled = false;
    if (!m.geometry.attributes.normal) smoothNormals(m.geometry);
    const src = m.material as THREE.MeshStandardMaterial;
    // Baked textures read dark under the toon ramp; lift them a little.
    const color = src.map ? new THREE.Color(1, 1, 1) : src.color.clone();
    m.material = toonMat({ name: src.name, color: color.multiplyScalar(1.3), map: src.map });
  });
  // TRELLIS meshes usually face -Z, but not always; the manifest's `yaw` turns each toward the camera (+Z).
  scene.rotation.y = THREE.MathUtils.degToRad(yawDeg);
  // Rigged by .playtest/ai_rig.py: one animation per clip key; unrigged meshes animate procedurally.
  const clips: Partial<Record<Clip, THREE.AnimationClip>> = {};
  for (const k of Object.keys(CLIP_CANDIDATES) as Clip[]) {
    const c = findClip(gltf.animations, k);
    if (c) clips[k] = c;
  }
  const { root, width } = normalize(scene, [1, 1]);
  addOutlines(root);
  const procedural = !clips.idle;
  return { root, clips, height: HEIGHT, width, float: !!MODEL_DEFS[art as keyof typeof MODEL_DEFS]?.float, procedural };
}

/** Area-weighted normals shared by every vertex at the same position, so UV seams don't split the outline hull. */
function smoothNormals(geo: THREE.BufferGeometry) {
  const pos = geo.attributes.position;
  const key = (i: number) => `${pos.getX(i).toFixed(5)},${pos.getY(i).toFixed(5)},${pos.getZ(i).toFixed(5)}`;
  const keys = Array.from({ length: pos.count }, (_, i) => key(i));
  const acc = new Map<string, THREE.Vector3>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  const idx = geo.index;
  const tris = idx ? idx.count : pos.count;
  for (let t = 0; t < tris; t += 3) {
    const [i, j, k] = idx ? [idx.getX(t), idx.getX(t + 1), idx.getX(t + 2)] : [t, t + 1, t + 2];
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, j).sub(a);
    c.fromBufferAttribute(pos, k).sub(a);
    const n = b.cross(c);
    for (const v of [i, j, k]) {
      const s = acc.get(keys[v]) ?? acc.set(keys[v], new THREE.Vector3()).get(keys[v])!;
      s.add(n);
    }
  }
  const normals = new Float32Array(pos.count * 3);
  keys.forEach((kk, i) => {
    const n = acc.get(kk)!.normalize();
    normals.set([n.x, n.y, n.z], i * 3);
  });
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
}

function trimGeometry(m: THREE.Mesh, drop: (x: number, y: number, z: number) => boolean) {
  const geo = m.geometry.clone();
  const pos = geo.attributes.position;
  const index = geo.index;
  if (!index) return;
  const keep: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const tri = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    if (!tri.some((v) => drop(pos.getX(v), pos.getY(v), pos.getZ(v)))) keep.push(...tri);
  }
  geo.setIndex(keep);
  m.geometry = geo;
}

function isShown(o: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function loadSet(set: ModelSet): Promise<void> {
  const loader = new GLTFLoader();
  if (set === 'kit') {
    const files = new Map<string, Promise<GLTF>>();
    return Promise.all(
      Object.entries(MODEL_DEFS).map(async ([art, def]) => {
        protos.kit.set(art, await buildProto(def, loader, files));
      }),
    ).then(() => undefined);
  }
  // Listed in a manifest so a partially generated set still works; missing units fall back to the kit.
  return fetch('models/ai/manifest.json')
    .then((r) => (r.ok ? r.json() : { arts: [] }))
    .catch(() => ({ arts: [] }))
    .then(({ arts, yaw = {} }: { arts: string[]; yaw?: Record<string, number> }) =>
      Promise.all(
        arts.map((art) =>
          buildAiProto(art, loader, yaw[art])
            .then((p) => void protos.ai.set(art, p))
            .catch((err) => console.warn(`AI model ${art} unavailable:`, err)),
        ),
      ),
    )
    .then(() => undefined);
}

/** Load and prepare the active set (and the kit fallback) once; safe to call repeatedly. */
export function loadModels(): Promise<void> {
  const sets: ModelSet[] = active === 'ai' ? ['kit', 'ai'] : ['kit'];
  return Promise.all(sets.map((s) => (loading[s] ??= loadSet(s)))).then(() => undefined);
}

function proto(art: string, explicitModel?: string) {
  // Explicit card model always wins; the global set only affects legacy art-only data.
  if (explicitModel && Object.hasOwn(MODEL_DEFS, explicitModel)) return protos.kit.get(explicitModel) ?? protos.kit.get(art);
  return (active === 'ai' && protos.ai.get(art)) || protos.kit.get(art);
}

export function hasModel(art: string, explicitModel?: string) {
  return !!proto(art, explicitModel);
}

/** A fresh instance sharing geometry/materials with the prototype; nothing to dispose. */
export function instantiate(art: string, explicitModel?: string) {
  const p = proto(art, explicitModel);
  if (!p) return null;
  return { ...p, root: cloneSkinned(p.root) as THREE.Group };
}
