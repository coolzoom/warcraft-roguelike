import * as THREE from 'three';
import type { Action, Clip } from './models';

export type { Action };

/**
 * Clips are retimed so the gameplay beat lands on time regardless of the source
 * animation's length: the promise from play() resolves `impact` seconds in, at
 * `frac` of the clip (the blow landing / spell leaving the hand).
 */
const TIMING: Record<Action, { frac: number; impact: number }> = {
  attack: { frac: 0.45, impact: 0.32 },
  cast: { frac: 0.5, impact: 0.45 },
  hit: { frac: 1, impact: 0.45 },
  cheer: { frac: 0.5, impact: 0.5 },
  die: { frac: 1, impact: 0.75 },
  stun: { frac: 1, impact: 0.6 },
};

interface Running {
  action: Action;
  clip: THREE.AnimationAction;
  t: number;
  impactAt: number;
  end: number;
  resolved: boolean;
  resolve: () => void;
}

/** Drives a rigged model's AnimationMixer: looping idle/walk base plus retimed one-shot actions. */
export class Animator {
  private mixer: THREE.AnimationMixer;
  private idle?: THREE.AnimationAction;
  private walk?: THREE.AnimationAction;
  private base?: THREE.AnimationAction;
  private cur: Running | null = null;
  private dead = false;

  constructor(
    root: THREE.Object3D,
    private clips: Partial<Record<Clip, THREE.AnimationClip>>,
  ) {
    this.mixer = new THREE.AnimationMixer(root);
    if (clips.idle) this.idle = this.mixer.clipAction(clips.idle);
    if (clips.walk) this.walk = this.mixer.clipAction(clips.walk);
    this.base = this.idle;
    if (this.base) {
      this.base.play();
      // desync identical units standing side by side
      this.base.time = Math.random() * clips.idle!.duration;
    }
  }

  setWalking(on: boolean) {
    const next = on ? (this.walk ?? this.idle) : this.idle;
    if (next === this.base || this.dead) return;
    const prev = this.base;
    this.base = next;
    if (!this.cur && next) this.fadeTo(next, prev, 0.2);
  }

  play(action: Action): Promise<void> {
    if (this.dead) return Promise.resolve();
    const clip = this.clips[action];
    if (!clip) return Promise.resolve();
    const prev = this.cur?.clip ?? this.base;
    this.finish();
    const { frac, impact } = TIMING[action];
    const speed = THREE.MathUtils.clamp((clip.duration * frac) / impact, 0.6, 3);
    const a = this.mixer.clipAction(clip);
    a.reset();
    a.setLoop(THREE.LoopOnce, 1);
    a.clampWhenFinished = true;
    a.timeScale = speed;
    this.fadeTo(a, prev, 0.08);
    if (action === 'die') this.dead = true;
    return new Promise((resolve) => {
      this.cur = { action, clip: a, t: 0, impactAt: (clip.duration * frac) / speed, end: clip.duration / speed, resolved: false, resolve };
    });
  }

  cancel() {
    this.finish();
  }

  update(dt: number) {
    this.mixer.update(dt);
    const c = this.cur;
    if (!c) return;
    c.t += dt;
    if (!c.resolved && c.t >= c.impactAt) {
      c.resolved = true;
      c.resolve();
    }
    // blend back into the base loop just before the one-shot ends (death holds its last frame)
    if (c.action !== 'die' && c.resolved && c.t >= c.end - 0.12) {
      this.cur = null;
      if (this.base) this.fadeTo(this.base, c.clip, 0.15);
    }
  }

  private fadeTo(next: THREE.AnimationAction, prev: THREE.AnimationAction | undefined, dur: number) {
    if (next.loop !== THREE.LoopOnce) next.reset();
    next.setEffectiveWeight(1);
    next.play();
    if (prev && prev !== next) next.crossFadeFrom(prev, dur, false);
  }

  private finish() {
    if (this.cur && !this.cur.resolved) this.cur.resolve();
    this.cur = null;
  }
}

/** Seconds for each procedural one-shot and when its impact lands. */
const PROC: Record<Action, { dur: number; impact: number }> = {
  attack: { dur: 0.6, impact: 0.32 },
  cast: { dur: 0.8, impact: 0.45 },
  hit: { dur: 0.45, impact: 0.45 },
  cheer: { dur: 0.8, impact: 0.5 },
  die: { dur: 0.75, impact: 0.75 },
  stun: { dur: 0.9, impact: 0.6 },
};

const ease = (k: number) => k * k * (3 - 2 * k);

/**
 * Same interface as Animator for static meshes without a rig: the whole model
 * squashes, hops, lunges and topples about its feet (root origin).
 */
export class ProceduralAnimator {
  private t = Math.random() * 10;
  private walkW = 0;
  private walking = false;
  private dead = false;
  private cur: { action: Action; t: number; resolved: boolean; resolve: () => void } | null = null;
  private y0: number;

  constructor(
    private root: THREE.Object3D,
    private h: number,
  ) {
    this.y0 = root.position.y;
  }

  setWalking(on: boolean) {
    this.walking = on;
  }

  play(action: Action): Promise<void> {
    if (this.dead) return Promise.resolve();
    this.finish();
    if (action === 'die') this.dead = true;
    return new Promise((resolve) => (this.cur = { action, t: 0, resolved: false, resolve }));
  }

  cancel() {
    this.finish();
  }

  update(dt: number) {
    this.t += dt;
    this.walkW = THREE.MathUtils.damp(this.walkW, this.walking && !this.dead ? 1 : 0, 10, dt);
    const h = this.h;
    const p = { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, sx: 1, sy: 1 };

    const still = this.dead ? 0 : 1 - this.walkW;
    const breathe = Math.sin(this.t * 2.4) * still;
    p.sy += 0.03 * breathe;
    p.sx -= 0.015 * breathe;
    p.rz += Math.sin(this.t * 1.3) * 0.025 * still;
    const step = this.t * 10;
    p.y += this.walkW * Math.abs(Math.sin(step)) * 0.07 * h;
    p.rz += this.walkW * Math.sin(step) * 0.1;
    p.rx += this.walkW * 0.08;

    const c = this.cur;
    if (c) {
      c.t += dt;
      const { dur, impact } = PROC[c.action];
      const k = Math.min(1, c.t / dur);
      const ki = impact / dur;
      const wave = Math.sin(Math.PI * k);
      switch (c.action) {
        case 'attack': {
          // wind up back, lunge forward onto the target at impact, settle
          const lean =
            k < ki * 0.55 ? -0.35 * ease(k / (ki * 0.55)) : k < ki ? -0.35 + 0.85 * ease((k - ki * 0.55) / (ki * 0.45)) : 0.5 * (1 - ease((k - ki) / (1 - ki)));
          p.rx += lean;
          p.z += Math.max(0, lean) * 0.5 * h;
          p.sy += lean < 0 ? -lean * 0.12 : 0;
          break;
        }
        case 'cast':
          p.y += 0.12 * h * wave;
          p.ry += Math.PI * 2 * ease(k);
          p.sx += 0.08 * wave;
          p.sy += 0.08 * wave;
          break;
        case 'hit': {
          const d = (1 - k) * (1 - k);
          p.rx -= 0.35 * d;
          p.z -= 0.1 * h * d;
          p.sx += 0.06 * d;
          p.sy -= 0.06 * d;
          break;
        }
        case 'cheer': {
          const hop = Math.abs(Math.sin(2 * Math.PI * k));
          p.y += 0.16 * h * hop;
          p.sy += 0.08 * hop;
          p.sx -= 0.04 * hop;
          break;
        }
        case 'stun':
          p.rz += 0.2 * Math.sin(k * 6 * Math.PI) * (1 - k);
          p.ry += 0.35 * Math.sin(k * 4 * Math.PI) * (1 - k);
          break;
        case 'die':
          p.rx -= 1.45 * k * k;
          p.sy -= 0.1 * k;
          break;
      }
      if (!c.resolved && c.t >= impact) {
        c.resolved = true;
        c.resolve();
      }
      if (c.action !== 'die' && k >= 1) this.cur = null;
    }

    this.root.position.set(p.x, this.y0 + p.y, p.z);
    this.root.rotation.set(p.rx, p.ry, p.rz);
    this.root.scale.set(p.sx, p.sy, p.sx);
  }

  private finish() {
    if (this.cur && !this.cur.resolved) this.cur.resolve();
    if (this.cur?.action !== 'die') this.cur = null;
  }
}
