import * as THREE from 'three';

/**
 * Shared battlefield camera orbit, read by the background camera and every
 * model's cell camera so units are seen from the same angle as the ground.
 * Drag to look around; the view stays where it is released until sent home.
 * Only active while a battle enables it, so other scenes keep the default view.
 * Also holds the slow-motion time scale and a temporary focus for cinematics.
 */

const YAW_MAX = 0.7;
const PITCH_MIN = -0.32;
const PITCH_MAX = 0.3;
const PER_PX = 0.006;
const DIST_MIN = 0.55;
const DIST_MAX = 1.35;
const PER_WHEEL = 0.0012;

interface View {
  /** Orbit about the vertical (rad). */
  yaw: number;
  /** Change in elevation (rad, + = steeper). */
  pitch: number;
  /** Camera distance × default. */
  dist: number;
  /** Pivot offset on the ground from the default pivot (world units). */
  fx: number;
  fz: number;
}

const home = (): View => ({ yaw: 0, pitch: 0, dist: 1, fx: 0, fz: 0 });
const cur = home();
const target = home();
const ZERO = home();
let saved: View | null = null;
let dragging = false;
let enabled = false;
let last = performance.now();
let timeScale = 1;

export function enableOrbit(on: boolean) {
  enabled = on;
  dragging = false;
  if (!on) endFocus();
}

export function orbitBy(dx: number, dy: number) {
  dragging = true;
  target.yaw = THREE.MathUtils.clamp(target.yaw - dx * PER_PX, -YAW_MAX, YAW_MAX);
  target.pitch = THREE.MathUtils.clamp(target.pitch + dy * PER_PX, PITCH_MIN, PITCH_MAX);
}

export function releaseOrbit() {
  dragging = false;
}

/** Mouse wheel: positive deltaY (scroll down) pulls the camera back. */
export function zoomBy(deltaY: number) {
  target.dist = THREE.MathUtils.clamp(target.dist * Math.exp(deltaY * PER_WHEEL), DIST_MIN, DIST_MAX);
}

/** Ease back to the default framing. */
export function homeOrbit() {
  Object.assign(target, home());
}

/** Swoop onto a ground point (offset from the default pivot); endFocus() restores the player's view. */
export function focusOn(fx: number, fz: number, dist: number, yawKick: number) {
  saved ??= { ...target };
  Object.assign(target, { fx, fz, dist, yaw: THREE.MathUtils.clamp(saved.yaw + yawKick, -YAW_MAX, YAW_MAX) });
}

export function endFocus() {
  if (saved) Object.assign(target, saved);
  saved = null;
}

/** Slow motion for 3D animation (the 2D side scales Phaser's clocks). */
export function setTimeScale(s: number) {
  timeScale = s;
}

export function getTimeScale() {
  return timeScale;
}

/** True when the view is (heading) away from the default framing. */
export function isAway() {
  return target.yaw !== 0 || target.pitch !== 0 || target.dist !== 1 || target.fx !== 0 || target.fz !== 0;
}

/** Current view, eased toward the target in real time; safe to call several times per frame. */
export function getView(): Readonly<View> {
  if (!enabled) return ZERO;
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const k = dragging ? 18 : saved ? 5 : 7;
  for (const key of ['yaw', 'pitch', 'dist', 'fx', 'fz'] as const) {
    cur[key] = THREE.MathUtils.damp(cur[key], target[key], key === 'dist' && !saved ? 12 : k, dt);
    if (Math.abs(cur[key] - target[key]) < 1e-4) cur[key] = target[key];
  }
  return cur;
}

/** True while the view differs from the default framing. */
export function isOrbiting() {
  return enabled && (dragging || cur.yaw !== 0 || cur.pitch !== 0 || cur.dist !== 1 || cur.fx !== 0 || cur.fz !== 0 || isAway());
}
