import Phaser from 'phaser';
import * as THREE from 'three';
import { Animator, Action, ProceduralAnimator } from './animator';
import { instantiate } from './models';
import { getView } from './view';

/**
 * Renders every 3D model into one shared offscreen WebGL canvas laid out as
 * an atlas of cells. The canvas is registered as a Phaser texture, so each
 * unit is just a Phaser Image showing its cell and keeps normal 2D layering
 * with HP bars, cards and effects.
 */

const CELL = 256;
const COLS = 6;
const ROWS = 4;
export const ATLAS_KEY = 'models3d';

export interface ModelHandle {
  frame: string;
  /** Vertical origin (0..1 from top) where the model's feet land in its frame; follows the view pitch. */
  readonly footY: number;
  /** Frame size in px. */
  size: number;
  play(action: Action): Promise<void>;
  setFacing(yaw: number): void;
  setWalking(on: boolean): void;
  release(): void;
}

interface Slot {
  col: number;
  row: number;
  span: number;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  anim: Animator | ProceduralAnimator;
  aim: (yaw: number, pitch: number) => number;
  footY: number;
}

/** Model instance with its own lights and a camera framing it like the battlefield view. */
export function buildModelScene(art: string, explicitModel?: string) {
  const model = instantiate(art, explicitModel);
  if (!model) return null;
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xfff6e8, 0x5a4630, 2.0));
  const sun = new THREE.DirectionalLight(0xfff2dc, 2.4);
  sun.position.set(2.5, 4, 3.5);
  scene.add(sun);
  const rim = new THREE.DirectionalLight(0xa8d8ff, 1.4);
  rim.position.set(-3, 2.5, -2.5);
  scene.add(rim);
  if (model.float) model.root.position.y = model.height * 0.1;
  const facing = new THREE.Group();
  facing.add(model.root);
  scene.add(facing);

  // Frame the model with headroom for swings, looking down slightly like the battlefield camera.
  const h = model.height;
  const extent = Math.max(h * 1.5, model.width * 1.25);
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  const dist = extent / 2 / Math.tan(THREE.MathUtils.degToRad(14));
  const target = new THREE.Vector3(0, h * 0.55, 0);
  const pitch0 = THREE.MathUtils.degToRad(22);
  const foot = new THREE.Vector3();
  /** Orbit the cell camera with the battlefield view; returns where the feet land (0..1 from top). */
  const aim = (yaw: number, pitch: number) => {
    const p = pitch0 + pitch;
    const flat = Math.cos(p) * dist;
    camera.position.set(Math.sin(yaw) * flat, target.y + Math.sin(p) * dist, Math.cos(yaw) * flat);
    camera.lookAt(target);
    camera.updateMatrixWorld();
    return (1 - foot.set(0, 0, 0).project(camera).y) / 2;
  };
  const footY = aim(0, 0);
  const anim = model.procedural ? new ProceduralAnimator(model.root, h) : new Animator(model.root, model.clips);
  return { model, facing, scene, camera, footY, anim, aim };
}

class Stage {
  readonly renderer: THREE.WebGLRenderer;
  private used: boolean[] = new Array(COLS * ROWS).fill(false);
  private slots = new Set<Slot>();
  private timer = new THREE.Timer();
  private game?: Phaser.Game;

  constructor() {
    this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(CELL * COLS, CELL * ROWS, false);
    this.renderer.setClearColor(0x000000, 0);
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
  }

  /** Register the atlas with Phaser and render it once per Phaser frame. */
  attach(game: Phaser.Game) {
    if (this.game) return;
    this.game = game;
    const tex = game.textures.create(ATLAS_KEY, this.renderer.domElement as unknown as HTMLImageElement, CELL * COLS, CELL * ROWS)!;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        tex.add(`c${c}_${r}`, 0, c * CELL, r * CELL, CELL, CELL);
        if (c % 2 === 0 && r % 2 === 0) tex.add(`b${c}_${r}`, 0, c * CELL, r * CELL, CELL * 2, CELL * 2);
      }
    game.events.on(Phaser.Core.Events.PRE_RENDER, () => this.render());
  }

  private alloc(span: number): { col: number; row: number } | null {
    for (let r = 0; r + span <= ROWS; r += span)
      for (let c = 0; c + span <= COLS; c += span) {
        let free = true;
        for (let dy = 0; dy < span && free; dy++) for (let dx = 0; dx < span && free; dx++) free = !this.used[(r + dy) * COLS + c + dx];
        if (!free) continue;
        for (let dy = 0; dy < span; dy++) for (let dx = 0; dx < span; dx++) this.used[(r + dy) * COLS + c + dx] = true;
        return { col: c, row: r };
      }
    return null;
  }

  private free(s: Slot) {
    for (let dy = 0; dy < s.span; dy++) for (let dx = 0; dx < s.span; dx++) this.used[(s.row + dy) * COLS + s.col + dx] = false;
  }

  create(art: string, big: boolean, model?: string): ModelHandle | null {
    const built = buildModelScene(art, model);
    if (!built) return null;
    const span = big ? 2 : 1;
    const pos = this.alloc(span);
    if (!pos) return null;

    const { facing, scene, camera, footY, anim, aim } = built;
    const slot: Slot = { col: pos.col, row: pos.row, span, scene, camera, anim, aim, footY };
    this.slots.add(slot);
    const frame = big ? `b${pos.col}_${pos.row}` : `c${pos.col}_${pos.row}`;
    let released = false;
    return {
      frame,
      get footY() {
        return slot.footY;
      },
      size: CELL * span,
      play: (action) => (released ? Promise.resolve() : slot.anim.play(action)),
      setFacing: (yaw) => (facing.rotation.y = yaw),
      setWalking: (on) => slot.anim.setWalking(on),
      release: () => {
        if (released) return;
        released = true;
        this.slots.delete(slot);
        this.free(slot);
        slot.anim.cancel();
      },
    };
  }

  /** Number of live models; exposed for automated tests. */
  get count() {
    return this.slots.size;
  }

  private render() {
    this.timer.update();
    const dt = Math.min(0.05, this.timer.getDelta());
    const r = this.renderer;
    const H = CELL * ROWS;
    r.setScissorTest(false);
    r.clear();
    r.setScissorTest(true);
    const { yaw, pitch } = getView();
    this.slots.forEach((s) => {
      s.footY = s.aim(yaw, pitch);
      s.anim.update(dt);
      const size = CELL * s.span;
      const x = s.col * CELL;
      const y = H - s.row * CELL - size; // WebGL viewport origin is bottom-left
      r.setViewport(x, y, size, size);
      r.setScissor(x, y, size, size);
      r.render(s.scene, s.camera);
    });
    const tex = this.game?.textures.get(ATLAS_KEY);
    tex?.source[0].update();
  }
}

let stage: Stage | null = null;

export function getStage() {
  if (!stage) stage = new Stage();
  return stage;
}
