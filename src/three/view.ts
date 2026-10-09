import * as THREE from 'three';

/**
 * Shared battlefield camera orbit, read by the background camera and every
 * model's cell camera so units are seen from the same angle as the ground.
 * Drag to look around; the view stays where it is released until sent home.
 * Only active while a battle enables it, so other scenes keep the default view.
 */

const YAW_MAX = 0.7;
const PITCH_MIN = -0.32;
const PITCH_MAX = 0.3;
const PER_PX = 0.006;
const DIST_MIN = 0.55;
const DIST_MAX = 1.35;
const PER_WHEEL = 0.0012;

/** yaw: orbit about the vertical (rad); pitch: change in elevation (rad, + = steeper); dist: camera distance × default. */
const cur = { yaw: 0, pitch: 0, dist: 1 };
const target = { yaw: 0, pitch: 0, dist: 1 };
const ZERO = { yaw: 0, pitch: 0, dist: 1 };
let dragging = false;
let enabled = false;
let last = performance.now();

export function enableOrbit(on: boolean) {
  enabled = on;
  dragging = false;
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
  target.yaw = target.pitch = 0;
  target.dist = 1;
}

/** True when the view is (heading) away from the default framing. */
export function isAway() {
  return target.yaw !== 0 || target.pitch !== 0 || target.dist !== 1;
}

/** Current view, eased toward the target; safe to call several times per frame. */
export function getView() {
  if (!enabled) return ZERO;
  const now = performance.now();
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const k = dragging ? 18 : 7;
  cur.yaw = THREE.MathUtils.damp(cur.yaw, target.yaw, k, dt);
  cur.pitch = THREE.MathUtils.damp(cur.pitch, target.pitch, k, dt);
  cur.dist = THREE.MathUtils.damp(cur.dist, target.dist, 12, dt);
  if (Math.abs(cur.yaw - target.yaw) < 1e-4) cur.yaw = target.yaw;
  if (Math.abs(cur.pitch - target.pitch) < 1e-4) cur.pitch = target.pitch;
  if (Math.abs(cur.dist - target.dist) < 1e-4) cur.dist = target.dist;
  return cur;
}

/** True while the view differs from the default framing. */
export function isOrbiting() {
  return enabled && (dragging || cur.yaw !== 0 || cur.pitch !== 0 || cur.dist !== 1 || isAway());
}
