import Phaser from 'phaser';
import {
  BOSS_EVERY,
  CARDS,
  ENEMIES,
  EnemyAI,
  EnemyAIParams,
  SPELLS,
  UNITS,
  Rarity,
  SpellDef,
  SpellEffect,
  UnitAction,
  UnitSkill,
  buildWave,
  isBossWave,
  unitSkill,
  waveScale,
} from '../data';
import {
  ATTACK_ELEMENT,
  BACK_CRIT,
  ELEMENT_ICON,
  Element,
  FRONT_DAMAGE_TAKEN,
  FRONT_SLOTS,
  RAGE_MAX,
  REACTIONS,
  RELICS,
  Reaction,
  RouteKind,
  SYNERGIES,
  TELEGRAPHS,
  TelegraphDef,
  UltDef,
  goldFor,
  reactionOf,
  synergyTiers,
  ultOf,
} from '../run';
import { RouteHost, chooseRoute, pickRelic, runCamp, runEvent, runShop } from './route';
import { CardView, UnitView, tweenP, txt, wait } from '../ui';
import { Background, addBackground } from '../three/battlefield';
import { enableOrbit, endFocus, focusOn, homeOrbit, isAway, isOrbiting, orbitBy, releaseOrbit, setTimeScale, zoomBy } from '../three/view';
import { addPoints, getDeck, rank, runPoints, talentPoints } from '../meta';

/** Flat stat bonuses from the unit-branch talents. */
function unitTalentBonus(key: string) {
  switch (key) {
    case 'grunt':
      return { atk: 2 * rank('u_grunt'), hp: 6 * rank('u_grunt') };
    case 'troll':
      return { atk: rank('u_troll'), hp: 0 };
    case 'tauren':
      return { atk: 0, hp: 8 * rank('u_tauren') };
    case 'mage':
      return { atk: rank('u_mage'), hp: 0 };
    case 'dwarf':
      return { atk: rank('u_dwarf'), hp: 0 };
    default:
      return { atk: 0, hp: 0 };
  }
}

interface Unit {
  side: 'ally' | 'enemy';
  key: string;
  name: string;
  baseAtk: number;
  bonusAtk: number;
  hp: number;
  maxHp: number;
  shield: number;
  armor: number;
  stun: number;
  burn?: { dmg: number; turns: number };
  level: number;
  taunt: boolean;
  skill?: UnitSkill;
  ai?: EnemyAI;
  aiParams?: EnemyAIParams;
  boss: boolean;
  turns: number;
  slot: number;
  dead: boolean;
  view: UnitView;
  label?: Phaser.GameObjects.Text;
  /** Heroes: 0..RAGE_MAX, full = ultimate ready. */
  rage: number;
  /** Iced stun: fire turns it to steam, physical shatters it. */
  frozen: boolean;
  /** Boss has entered its second phase. */
  enraged?: boolean;
}

interface Hit {
  element?: Element;
  crit?: boolean;
  from?: Unit;
  /** Splash and damage over time don't set off reactions. */
  noReact?: boolean;
}

const realWait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

type Reward =
  | { kind: 'card'; cardId: string }
  | { kind: 'perk'; id: string; title: string; desc: string; color: number; glyph: string };

const ALLY_SLOTS = [
  { x: 150, y: 490 },
  { x: 270, y: 505 },
  { x: 390, y: 490 },
  { x: 205, y: 595 },
  { x: 335, y: 595 },
];
const ENEMY_SLOTS = [
  { x: 140, y: 335 },
  { x: 270, y: 350 },
  { x: 400, y: 335 },
  { x: 110, y: 210 },
  { x: 270, y: 195 },
  { x: 430, y: 210 },
];
const ENEMY_FILL_ORDER = [1, 0, 2, 4, 3, 5];
const BOSS_SLOT = 4;
/** Drags starting on empty ground between the top bar and the bottom HUD orbit the camera. */
const ORBIT_TOP = 56;
const ORBIT_BOTTOM = 650;
/** Feet sit this far below a unit view's origin (UnitView radius 36 × 0.85). */
const UNIT_FOOT = 31;
const HAND_Y = 868;
const HUD_Y = 715;
const BASE_POS = { x: 215, y: HUD_Y };
const MAX_LEVEL = 5;
const HAND_SIZE = 5;
/** Last-hit cinematic: world speed and how long it lasts in real time. */
const SLOWMO = 0.3;
const SLOWMO_MS = 1500;

export class BattleScene extends Phaser.Scene {
  private bg!: Background;
  private bgScroll = 0;
  private orbiting = false;

  private deck: string[] = [];
  private drawPile: string[] = [];
  private discard: string[] = [];
  private hand: CardView[] = [];
  private selected: CardView | null = null;

  private allies: (Unit | null)[] = [];
  private enemies: (Unit | null)[] = [];
  /** Dead units still playing their death, kept so they are drawn from the orbited view. */
  private fading: Unit[] = [];
  private finale: Promise<void> | null = null;
  /** Unit-less figures (the airstrike dragon) drawn from the orbited view. */
  private extras: UnitView[] = [];
  /** Ground markers, laid out in 2D and projected like units. */
  private decals: { obj: Phaser.GameObjects.Container; x: number; y: number }[] = [];
  private marks: { boss: Unit; slots: number[]; def: TelegraphDef } | null = null;
  /** Bosses that crossed half health, waiting for a safe moment to transform. */
  private pending: Unit[] = [];
  private slowBase = 1;
  private stopUntil = 0;
  private drag: { u: Unit; x: number; y: number; moved: boolean; slot: number } | null = null;
  private dragGhost?: Phaser.GameObjects.Arc;
  private slotHint?: Phaser.GameObjects.Ellipse;

  private gold = 0;
  private relics: string[] = [];
  private nodeKind: RouteKind = 'fight';
  private killEnergyUsed = false;
  /** Cards and ultimates can still be played this turn (energy refunds matter). */
  private playerPhase = false;
  private host!: RouteHost;
  private goldText!: Phaser.GameObjects.Text;
  private relicRow!: Phaser.GameObjects.Container;
  private synRow!: Phaser.GameObjects.Container;
  private hudSig = '';

  private wave = 1;
  private turn = 0;
  private energy = 3;
  private maxEnergy = 3;
  private baseHp = 60;
  private baseMaxHp = 60;
  private spellPower = 0;
  private handSize = HAND_SIZE;
  private firstWave = 1;
  private bossKills = 0;
  private echoUsed = false;
  private busy = true;
  private over = false;

  private waveText!: Phaser.GameObjects.Text;
  private bossHint!: Phaser.GameObjects.Text;
  private pileText!: Phaser.GameObjects.Text;
  private energyText!: Phaser.GameObjects.Text;
  private baseFill!: Phaser.GameObjects.Rectangle;
  private baseText!: Phaser.GameObjects.Text;
  private hint!: Phaser.GameObjects.Text;
  private endBtn!: Phaser.GameObjects.Container;

  constructor() {
    super('battle');
  }

  create() {
    this.deck = getDeck();
    this.drawPile = [];
    this.discard = [];
    this.hand = [];
    this.selected = null;
    this.allies = new Array(ALLY_SLOTS.length).fill(null);
    this.enemies = new Array(ENEMY_SLOTS.length).fill(null);
    this.fading = [];
    this.finale = null;
    this.extras = [];
    this.decals = [];
    this.marks = null;
    this.pending = [];
    this.drag = null;
    this.gold = 0;
    this.relics = [];
    this.nodeKind = 'fight';
    this.hudSig = '';
    this.stopUntil = 0;
    this.setSlow(1);
    this.host = this.makeHost();
    this.wave = Math.max(1, Number(new URLSearchParams(location.search).get('wave')) || 1);
    this.firstWave = this.wave;
    this.turn = 0;
    this.maxEnergy = 3 + rank('e_well');
    this.energy = this.maxEnergy;
    this.baseHp = this.baseMaxHp = 80 + 15 * rank('b_wall');
    this.spellPower = rank('s_power');
    this.handSize = HAND_SIZE + rank('e_draw');
    this.bossKills = 0;
    this.busy = true;
    this.over = false;

    this.bg = addBackground(this);
    this.bgScroll = 0;

    this.buildHud();
    this.cameras.main.fadeIn(300);
    this.startWave();
  }

  update() {
    this.bg.setScroll(this.bgScroll);
  }

  // ---------------------------------------------------------------- HUD

  private buildHud() {
    const { width } = this.scale;
    this.add.rectangle(0, 0, width, 56, 0x140c06, 0.75).setOrigin(0);
    this.waveText = txt(this, width / 2, 20, '', 22, '#ffcf4a', 5);
    this.bossHint = txt(this, width / 2, 44, '', 13, '#e0b0ff', 3);
    this.pileText = txt(this, width - 70, 28, '', 13, '#e8dcc0', 3);

    const bottom = this.add.graphics();
    bottom.fillGradientStyle(0x000000, 0x000000, 0x140c06, 0x140c06, 0, 0, 0.95, 0.95);
    bottom.fillRect(0, 660, width, 300);

    const orb = this.add.circle(48, HUD_Y, 30, 0x1d6fd8).setStrokeStyle(4, 0xbfe2ff);
    this.tweens.add({ targets: orb, scale: 1.05, duration: 800, yoyo: true, repeat: -1 });
    this.energyText = txt(this, 48, HUD_Y, '', 20, '#ffffff', 5);

    txt(this, BASE_POS.x, HUD_Y - 22, '部落大本营', 13, '#ffcf4a', 3);
    this.add.rectangle(BASE_POS.x, HUD_Y + 2, 214, 22, 0x140c06).setStrokeStyle(2, 0xd99a1e);
    this.baseFill = this.add.rectangle(BASE_POS.x - 105, HUD_Y + 2, 210, 18, 0x3fae3a).setOrigin(0, 0.5);
    this.baseText = txt(this, BASE_POS.x, HUD_Y + 2, '', 13, '#ffffff', 3);

    this.endBtn = this.add.container(450, HUD_Y);
    const g = this.add.graphics();
    g.fillStyle(0x7a1a10, 1).fillRoundedRect(-68, -26, 136, 52, 12);
    g.lineStyle(3, 0xffcf4a, 1).strokeRoundedRect(-68, -26, 136, 52, 12);
    const label = txt(this, 0, 0, '结束回合', 20, '#ffeec2', 5);
    const hit = this.add.rectangle(0, 0, 136, 52, 0, 0.001).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => this.endTurn());
    this.endBtn.add([g, label, hit]);

    this.hint = txt(this, width / 2, 668, '', 14, '#f3e3c0', 4).setWordWrapWidth(500);

    this.goldText = txt(this, 14, 20, '', 16, '#ffd700', 4).setOrigin(0, 0.5);
    this.relicRow = this.add.container(0, 0);
    this.synRow = this.add.container(0, 0);

    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, objs: Phaser.GameObjects.GameObject[]) => {
      if (objs.length === 0 && this.selected) this.deselect();
    });
    this.setupOrbit();
    this.setupHeroDrag();
  }

  /** Rebuild the relic and synergy rows when what they show changes. */
  private refreshRunHud() {
    this.goldText.setText(`💰 ${this.gold}`);
    const tiers = synergyTiers(this.liveAllies().map((a) => a.key));
    const sig = this.relics.join() + '|' + SYNERGIES.map((s) => `${tiers[s.id].count}`).join();
    if (sig === this.hudSig) return;
    const synergyChanged = sig.split('|')[1] !== this.hudSig.split('|')[1];
    this.hudSig = sig;
    this.relicRow.removeAll(true);
    this.relics.forEach((id, i) => {
      const r = RELICS[id];
      const t = this.add.text(16 + i * 28, 72, r.icon, { fontSize: '20px' }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
      const show = () => this.hint.setText(`${r.icon} ${r.name}：${r.desc}`);
      t.on('pointerover', show).on('pointerdown', show);
      this.relicRow.add(t);
    });
    this.synRow.removeAll(true);
    let x = 14;
    for (const s of SYNERGIES) {
      const { tier, count } = tiers[s.id];
      if (count === 0) continue;
      const next = s.need.find((n) => n > count);
      const label = `${s.icon}${s.name} ${count}/${next ?? s.need[s.need.length - 1]}`;
      const chip = txt(this, x, this.relics.length ? 100 : 76, label, 12, tier ? '#7dff7a' : '#9a8a70', 3).setOrigin(0, 0.5).setInteractive({ useHandCursor: true });
      const show = () => this.hint.setText(`${s.icon} ${s.name}（${s.need.join('/')}）：${s.desc.map((d, i) => `${i < tier ? '✅' : '▫️'}${s.need[i]} 名：${d}`).join('  ')}`);
      chip.on('pointerover', show).on('pointerdown', show);
      this.synRow.add(chip);
      x += chip.width + 8;
    }
    if (synergyChanged) this.liveAllies().forEach((a) => this.refreshUnit(a));
  }

  // ---------------------------------------------------------------- hero drag / tap

  /** Tap a hero to unleash a ready ultimate; drag it to another slot to reposition (player turn only). */
  private setupHeroDrag() {
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      const d = this.drag;
      if (!d || !p.isDown) return;
      if (!d.moved && Math.hypot(p.x - d.x, p.y - d.y) < 12) return;
      if (this.busy || this.over) return;
      d.moved = true;
      this.dragGhost ??= this.add.circle(0, 0, 30).setStrokeStyle(3, 0xffe066).setDepth(60);
      this.slotHint ??= this.onGround(this.add.ellipse(0, 0, 100, 40, 0xffe066, 0.25).setStrokeStyle(3, 0xffe066));
      this.dragGhost.setPosition(p.x, p.y).setVisible(true);
      d.slot = this.slotNear(p.x, p.y);
      if (d.slot === -1) this.slotHint.setVisible(false);
      else {
        const s = ALLY_SLOTS[d.slot];
        const at = isOrbiting() ? this.bg.remap(s.x, s.y + UNIT_FOOT) : { x: s.x, y: s.y + UNIT_FOOT, scale: 1 };
        this.slotHint.setPosition(at.x, at.y).setScale(at.scale).setVisible(true);
        const front = FRONT_SLOTS.includes(d.slot);
        this.hint.setText(front ? '前排：受到伤害 -15%' : '后排：暴击率 +10%');
      }
    });
    this.input.on('pointerup', () => {
      const d = this.drag;
      this.drag = null;
      this.dragGhost?.setVisible(false);
      this.slotHint?.setVisible(false);
      if (!d || d.u.dead) return;
      if (!d.moved) this.tapHero(d.u);
      else if (d.slot !== -1 && d.slot !== d.u.slot && !this.busy && !this.over) this.moveHero(d.u, d.slot);
    });
  }

  /** Draw just above the battlefield image, under every unit. */
  private onGround<T extends Phaser.GameObjects.GameObject>(obj: T) {
    this.children.moveTo(obj, 1);
    return obj;
  }

  /** Hero slot whose drawn ground spot is nearest the pointer (within reach). */
  private slotNear(x: number, y: number) {
    let best = -1;
    let bestD = 80;
    ALLY_SLOTS.forEach((s, i) => {
      const at = this.pt(s.x, s.y);
      const d = Math.hypot(at.x - x, at.y - y);
      if (d < bestD) (best = i), (bestD = d);
    });
    return best;
  }

  private moveHero(u: Unit, slot: number) {
    const other = this.allies[slot];
    this.allies[u.slot] = other;
    if (other) {
      other.slot = u.slot;
      const to = ALLY_SLOTS[other.slot];
      this.tweens.add({ targets: other.view, x: to.x, y: to.y, duration: 260, ease: 'Cubic.out' });
    }
    this.allies[slot] = u;
    u.slot = slot;
    const to = ALLY_SLOTS[slot];
    this.tweens.add({ targets: u.view, x: to.x, y: to.y, duration: 260, ease: 'Cubic.out' });
    if (this.marks) this.hint.setText(this.marks.slots.includes(slot) ? '⚠ 这个位置会被首领轰击！' : '✅ 已离开危险区域');
  }

  private tapHero(u: Unit) {
    if (this.busy || this.over) return;
    if (u.rage >= RAGE_MAX) {
      void this.castUlt(u);
      return;
    }
    const ult = ultOf(u.key, u.skill);
    this.hint.setText(`怒气 ${Math.floor(u.rage)}/${RAGE_MAX} · 大招【${ult.name}】${ult.desc}\n攻击、受击、击杀会积攒怒气；拖动英雄可换位`);
  }

  // ---------------------------------------------------------------- camera orbit

  /**
   * Drag empty battlefield to look around; the view stays where released.
   * Units keep their 2D layout for gameplay and tweens, and are drawn (and hit-tested)
   * where the orbited camera sees their ground spot. Wheel zooms. Double-tap or ⟲ returns home.
   */
  private setupOrbit() {
    this.orbiting = false;
    if (!this.bg.orbitable) return;
    enableOrbit(true);
    const { width } = this.scale;
    const home = txt(this, width - 48, 82, '⟲ 视角', 15, '#ffeec2', 4).setDepth(60).setVisible(false);
    home.setInteractive({ useHandCursor: true }).on('pointerdown', () => homeOrbit());
    let downAt = { x: 0, y: 0 };
    let lastTap = 0;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer, objs: Phaser.GameObjects.GameObject[]) => {
      if (objs.length > 0 || p.y <= ORBIT_TOP || p.y >= ORBIT_BOTTOM) return;
      this.orbiting = true;
      downAt = { x: p.x, y: p.y };
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (this.orbiting && p.isDown) orbitBy(p.x - p.prevPosition.x, p.y - p.prevPosition.y);
    });
    const end = (p?: Phaser.Input.Pointer) => {
      if (!this.orbiting) return;
      this.orbiting = false;
      releaseOrbit();
      if (!p || Math.hypot(p.x - downAt.x, p.y - downAt.y) > 8) return;
      const now = this.time.now;
      if (now - lastTap < 320) homeOrbit();
      lastTap = now;
    };
    this.input.on('pointerup', end);
    this.input.on('gameout', () => end());
    this.input.on('wheel', (p: Phaser.Input.Pointer, _objs: unknown, _dx: number, dy: number) => {
      if (p.y > ORBIT_TOP && p.y < ORBIT_BOTTOM) zoomBy(dy);
    });

    const restores: (() => void)[] = [];
    const units = () => [...this.allies, ...this.enemies, ...this.fading].filter((u): u is Unit => !!u?.view.active);
    const project = () => {
      home.setVisible(isAway());
      if (!isOrbiting()) {
        units().forEach((u) => u.view.clearProjection());
        this.extras.forEach((v) => v.clearProjection());
        return;
      }
      const remap = this.bg.remap;
      for (const v of this.extras) if (v.active) restores.push(v.project(remap));
      for (const d of this.decals) {
        const { obj, x, y } = d;
        if (!obj.active) continue;
        const q = remap(x, y);
        obj.setPosition(q.x, q.y).setScale(q.scale);
        restores.push(() => obj.setPosition(x, y).setScale(1));
      }
      for (const u of units()) {
        restores.push(u.view.project(remap));
        const l = u.label;
        if (l?.active) {
          const { x, y } = l;
          const q = remap(x, y);
          l.setPosition(q.x, q.y);
          restores.push(() => l.setPosition(x, y));
        }
      }
    };
    const restore = () => restores.splice(0).forEach((f) => f());
    this.events.on(Phaser.Scenes.Events.PRE_RENDER, project);
    this.events.on(Phaser.Scenes.Events.RENDER, restore);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.events.off(Phaser.Scenes.Events.PRE_RENDER, project);
      this.events.off(Phaser.Scenes.Events.RENDER, restore);
      enableOrbit(false);
      setTimeScale(1);
    });
  }

  /** Scale both Phaser clocks and the 3D animation clock. */
  private setSlow(s: number) {
    this.slowBase = s;
    this.applySlow();
  }

  private applySlow() {
    const s = performance.now() < this.stopUntil ? 0.03 : this.slowBase;
    this.time.timeScale = s;
    this.tweens.timeScale = s;
    setTimeScale(s);
  }

  /** Freeze-frame on heavy impacts (real milliseconds), on top of any slow motion. */
  private hitStop(ms: number) {
    this.stopUntil = Math.max(this.stopUntil, performance.now() + ms);
    this.applySlow();
    setTimeout(() => this.sys.isActive() && this.applySlow(), ms + 5);
  }

  /** The wave's last enemy falls: slow motion while the camera swoops onto it, then back to the player's view. */
  private async lastHit(u: Unit) {
    const { width, height } = this.scale;
    const real = (ms: number) => ms * SLOWMO;
    const g = this.bg.groundOffset(u.view.x, u.view.y + u.view.radius * 0.85);
    focusOn(g.x, g.z, u.boss ? 0.72 : 0.6, u.view.x < width / 2 ? 0.28 : -0.28);
    this.setSlow(SLOWMO);
    this.cameras.main.flash(180, 255, 236, 190);

    const bars = [
      this.add.rectangle(0, 0, width, 64, 0x000000).setOrigin(0, 1),
      this.add.rectangle(0, height, width, 64, 0x000000).setOrigin(0, 0),
    ].map((b) => b.setDepth(55));
    this.tweens.add({ targets: bars[0], y: 64, duration: real(260), ease: 'Cubic.out' });
    this.tweens.add({ targets: bars[1], y: height - 64, duration: real(260), ease: 'Cubic.out' });
    const title = txt(this, width / 2, 150, '最后一击！', 46, u.boss ? '#ff6a5a' : '#ffd040', 8).setDepth(56).setScale(2.2).setAlpha(0);
    this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: real(280), ease: 'Back.out' });

    await new Promise((r) => setTimeout(r, SLOWMO_MS));
    if (!this.sys.isActive()) return;
    this.setSlow(1);
    endFocus();
    this.tweens.add({ targets: bars[0], y: 0, duration: 320, ease: 'Cubic.in' });
    this.tweens.add({ targets: bars[1], y: height, duration: 320, ease: 'Cubic.in', onComplete: () => bars.forEach((b) => b.destroy()) });
    await tweenP(this, { targets: title, alpha: 0, y: title.y - 30, duration: 320 });
    title.destroy();
  }

  /**
   * Effects are authored at unit layout points (around view.x/y); place them where
   * that unit is drawn under the orbited camera. HUD points below the field stay put.
   */
  private pt(x: number, y: number) {
    if (!isOrbiting() || y >= ORBIT_BOTTOM) return { x, y };
    const p = this.bg.remap(x, y + UNIT_FOOT);
    return { x: p.x, y: p.y - UNIT_FOOT * p.scale };
  }

  private refreshHud() {
    const boss = isBossWave(this.wave);
    this.waveText.setText(boss ? `第 ${this.wave} 波 · BOSS 战` : `第 ${this.wave} 波`).setColor(boss ? '#ff6a5a' : '#ffcf4a');
    const left = BOSS_EVERY - (this.wave % BOSS_EVERY);
    this.bossHint.setText(boss ? '击败首领获得丰厚奖励' : `距离 BOSS 还有 ${left} 波`);
    this.pileText.setText(`牌库 ${this.drawPile.length}\n弃牌 ${this.discard.length}`);
    this.energyText.setText(`${this.energy}/${this.maxEnergy}`);
    const ratio = Phaser.Math.Clamp(this.baseHp / this.baseMaxHp, 0, 1);
    this.tweens.add({ targets: this.baseFill, width: 210 * ratio, duration: 200 });
    this.baseFill.fillColor = ratio > 0.5 ? 0x3fae3a : ratio > 0.25 ? 0xd9a21e : 0xd03a2a;
    this.baseText.setText(`${Math.max(0, this.baseHp)} / ${this.baseMaxHp}`);
    this.endBtn.setAlpha(this.busy ? 0.5 : 1);
    this.hand.forEach((c) => c.setPlayable(this.canPlay(c.cardId)));
    this.refreshRunHud();
  }

  // ---------------------------------------------------------------- run state

  private makeHost(): RouteHost {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return {
      scene: this,
      get gold() {
        return self.gold;
      },
      set gold(v: number) {
        self.gold = v;
        self.refreshHud();
      },
      get relics() {
        return self.relics;
      },
      get deck() {
        return self.deck;
      },
      addRelic: (id) => this.addRelic(id),
      healBase: (n) => this.healBase(n),
      hurtBase: (n) => this.damageBase(n),
      raiseBaseMax: (n) => {
        this.baseMaxHp += n;
        this.healBase(n);
      },
      healHeroes: () => this.liveAllies().forEach((a) => this.healUnit(a, a.maxHp)),
      starUpRandom: () => {
        const pool = this.liveAllies().filter((a) => a.level < MAX_LEVEL);
        if (!pool.length) return null;
        const a = Phaser.Utils.Array.GetRandom(pool) as Unit;
        a.level++;
        this.applyLevel(a);
        a.hp = a.maxHp;
        this.refreshUnit(a);
        return a.name;
      },
      fillRage: () => this.liveAllies().forEach((a) => this.gainRage(a, RAGE_MAX, true)),
      rollCard: (r) => this.rollCard(r),
      refreshHud: () => this.refreshHud(),
    };
  }

  private has(relic: string) {
    return this.relics.includes(relic);
  }

  private addRelic(id: string) {
    if (this.has(id)) return;
    this.relics.push(id);
    const r = RELICS[id];
    const t = txt(this, 270, 300, `获得遗物 ${r.icon} ${r.name}`, 24, '#e0b0ff', 6).setDepth(120).setAlpha(0);
    this.tweens.add({ targets: t, alpha: 1, y: 280, duration: 250, yoyo: true, hold: 900, onComplete: () => t.destroy() });
    this.refreshHud();
  }

  private addGold(n: number) {
    const g = Math.round(n * (this.has('coin') ? 1.5 : 1));
    this.gold += g;
    this.floatText(60, 40, `+${g} 💰`, '#ffd700', 18);
    this.refreshHud();
  }

  private tiers() {
    return synergyTiers(this.liveAllies().map((a) => a.key));
  }

  private atkOf(u: Unit) {
    return u.baseAtk + u.bonusAtk + (u.side === 'ally' && this.tiers().horde.tier ? 2 : 0);
  }

  private spellBonus() {
    return this.spellPower + (this.tiers().caster.tier ? 3 : 0);
  }

  private rollCrit(a: Unit) {
    const chance = 0.1 + 0.15 * this.tiers().hunter.tier + (FRONT_SLOTS.includes(a.slot) ? 0 : BACK_CRIT) + (this.has('dagger') ? 0.1 : 0);
    return Math.random() < chance;
  }

  private gainRage(u: Unit, n: number, flat = false) {
    if (u.side !== 'ally' || u.dead) return;
    const mul = flat ? 1 : (this.tiers().elf.tier ? 1.5 : 1) * (this.has('badge') ? 1.4 : 1);
    const was = u.rage;
    u.rage = Math.min(RAGE_MAX, u.rage + n * mul);
    u.view.setRage(u.rage / RAGE_MAX);
    if (was < RAGE_MAX && u.rage >= RAGE_MAX) this.floatText(u.view.x, u.view.y - 60, '大招就绪！点我释放', '#ffe066', 15);
  }

  private freeze(u: Unit, turns: number) {
    if (u.dead) return;
    u.stun = Math.max(u.stun, turns);
    u.frozen = true;
    u.view.setFrozen(true);
    this.refreshUnit(u);
  }

  /** Skip-a-turn bookkeeping; the ice melts with the stun. */
  private tickStun(u: Unit) {
    u.stun--;
    if (u.stun <= 0 && u.frozen) {
      u.frozen = false;
      u.view.setFrozen(false);
    }
  }

  private async banner(text: string, color = '#ffcf4a', size = 40) {
    const { width } = this.scale;
    const band = this.add.rectangle(width / 2, 420, width, 80, 0x000000, 0.6).setDepth(50);
    const t = txt(this, width / 2, 420, text, size, color, 7).setDepth(51).setScale(0.4).setAlpha(0);
    await tweenP(this, { targets: t, scale: 1, alpha: 1, duration: 220, ease: 'Back.out' });
    await wait(this, 550);
    await tweenP(this, { targets: [t, band], alpha: 0, duration: 200 });
    t.destroy();
    band.destroy();
  }

  private floatText(x0: number, y0: number, str: string, color: string, size = 22) {
    const { x, y } = this.pt(x0, y0);
    const t = txt(this, x, y, str, size, color, 5).setDepth(40);
    this.tweens.add({ targets: t, y: y - 50, alpha: 0, duration: 800, ease: 'Cubic.out', onComplete: () => t.destroy() });
  }

  // ---------------------------------------------------------------- waves

  private async startWave() {
    this.busy = true;
    this.turn = 0;
    this.drawPile = Phaser.Utils.Array.Shuffle([...this.deck]);
    this.discard = [];
    this.refreshHud();

    const list = buildWave(this.wave);
    const boss = isBossWave(this.wave);
    const cycle = Math.floor((this.wave - 1) / (BOSS_EVERY * 3));
    const fill = boss ? [BOSS_SLOT, 1, 0, 2] : ENEMY_FILL_ORDER;
    const elite = !boss && this.nodeKind === 'elite';
    this.bg.setMood(boss ? 'boss' : elite ? 'elite' : 'day');
    list.forEach((key, i) => this.spawnEnemy(key, fill[i], cycle, elite));

    for (const a of this.liveAllies()) {
      if (this.has('horn')) a.shield += 6;
      if (this.has('crown')) this.gainRage(a, 30, true);
      this.refreshUnit(a);
    }
    if (boss) {
      this.cameras.main.shake(400, 0.01);
      this.cameras.main.flash(300, 120, 0, 0);
      await this.banner(`首领来袭：${ENEMIES[list[0]].name}`, '#ff6a5a', 32);
    } else if (elite) {
      this.cameras.main.shake(300, 0.008);
      await this.banner('💀 精英敌军来袭！', '#ffb040', 32);
    } else {
      await wait(this, 400);
    }
    this.startPlayerTurn();
  }

  private spawnEnemy(key: string, slot: number, cycle = 0, elite = false) {
    const def = ENEMIES[key];
    if (!def) return null;
    if (slot < 0 || slot >= ENEMY_SLOTS.length || this.enemies[slot]) return null;
    const scale = waveScale(this.wave) * (1 + cycle * 0.5) * (elite ? 1.3 : 1);
    const pos = ENEMY_SLOTS[slot];
    const view = new UnitView(this, pos.x, pos.y - 260, def.art, false, !!def.boss, def.model);
    const u: Unit = {
      side: 'enemy',
      key,
      name: def.name,
      baseAtk: Math.round(def.atk * scale),
      bonusAtk: 0,
      hp: Math.round(def.hp * scale * (elite ? 1.15 : 1)),
      maxHp: Math.round(def.hp * scale * (elite ? 1.15 : 1)),
      rage: 0,
      frozen: false,
      shield: 0,
      armor: def.armor ?? 0,
      stun: 0,
      level: 0,
      taunt: false,
      ai: def.ai,
      aiParams: def.aiParams,
      boss: !!def.boss,
      turns: 0,
      slot,
      dead: false,
      view,
    };
    view.setAlpha(0);
    this.tweens.add({ targets: view, y: pos.y, alpha: 1, duration: 450, ease: 'Bounce.out', delay: slot * 60 });
    if (u.boss || elite) {
      u.label = txt(this, pos.x, pos.y + view.radius + 14, u.boss ? def.name : '💀 精英', 15, u.boss ? '#e0b0ff' : '#ffb040', 4).setAlpha(0);
      this.tweens.add({ targets: u.label, alpha: 1, duration: 400, delay: 400 });
    }
    view.portrait.setInteractive({ useHandCursor: true });
    view.portrait.on('pointerdown', () => this.onEnemyClick(u));
    view.portrait.on('pointerover', () => {
      if (!this.selected) this.hint.setText(`${def.name}  攻${this.atkOf(u)}  血${Math.ceil(u.hp)}/${u.maxHp}${def.desc ? '  · ' + def.desc : ''}`);
    });
    view.refresh({ ...u, atk: this.atkOf(u), level: undefined });
    this.enemies[slot] = u;
    return u;
  }

  private async onWaveCleared() {
    this.busy = true;
    this.deselect();
    this.playerPhase = false;
    await this.finale;
    this.finale = null;
    this.clearMarks();
    await wait(this, 300);
    await this.discardHand();
    const boss = isBossWave(this.wave);
    this.liveAllies().forEach((a, i) => this.time.delayedCall(i * 90, () => a.view.act('cheer')));
    await this.banner(boss ? '首领已被击败！' : `第 ${this.wave} 波 胜利！`, '#7dff7a');
    this.addGold(goldFor(this.wave, boss ? 'boss' : this.nodeKind === 'elite' ? 'elite' : 'fight'));

    for (const a of this.liveAllies()) {
      a.bonusAtk = 0;
      this.healUnit(a, boss ? a.maxHp : Math.round(a.maxHp * 0.25));
    }
    if (rank('b_repair')) this.healBase(6 * rank('b_repair'));
    this.refreshHud();
    this.showRewards(boss);
  }

  private async advance() {
    this.wave++;
    this.hint.setText('部落大军继续前进...');
    const allies = this.liveAllies();
    allies.forEach((a, i) => {
      if (a.view.hasModel) a.view.setWalking(true);
      else this.tweens.add({ targets: a.view, y: a.view.y - 10, duration: 180, yoyo: true, repeat: 3, delay: i * 50 });
    });
    await tweenP(this, { targets: this, bgScroll: this.bgScroll - 420, duration: 1500, ease: 'Sine.inOut' });
    allies.forEach((a) => a.view.setWalking(false));
    this.hint.setText('');
    this.startWave();
  }

  // ---------------------------------------------------------------- turns

  private async startPlayerTurn() {
    if (this.over) return;
    this.turn++;
    this.energy = this.maxEnergy + (this.turn === 1 ? rank('e_surge') : 0);
    this.echoUsed = false;
    this.killEnergyUsed = false;
    this.playerPhase = true;
    const regen = this.tiers().shaman.tier ? 4 : 0;
    for (const a of this.liveAllies()) {
      a.shield = 0;
      if (regen) this.healUnit(a, regen);
      this.refreshUnit(a);
    }
    await this.drawCards(this.handSize + (this.has('orb') ? 1 : 0));
    this.busy = false;
    this.hint.setText(this.marks ? '⚠ 首领下回合将轰击红圈区域！拖动英雄换位躲避' : '点击卡牌查看并打出，打完后点「结束回合」\n怒气满的英雄点击释放大招，拖动英雄可换位');
    this.refreshHud();
  }

  private async endTurn() {
    if (this.busy || this.over) return;
    this.busy = true;
    this.playerPhase = false;
    this.deselect();
    this.hint.setText('');
    this.refreshHud();
    await this.discardHand();

    for (const a of this.liveAllies()) {
      if (this.liveEnemies().length === 0) break;
      if (a.stun > 0) {
        this.floatText(a.view.x, a.view.y - 20, a.frozen ? '冰冻' : '眩晕', '#c0c0ff', 16);
        this.tickStun(a);
        this.refreshUnit(a);
        await a.view.act('stun');
        await wait(this, 200);
        continue;
      }
      await this.allyAct(a);
      await this.resolvePending();
      await wait(this, 120);
    }
    if (this.liveEnemies().length === 0) return this.onWaveCleared();

    await this.tickBurn();
    await this.resolvePending();
    if (this.liveEnemies().length === 0) return this.onWaveCleared();

    await this.banner('敌方回合', '#ff8a7a', 30);
    for (const e of this.liveEnemies()) {
      if (this.over) return;
      if (e.dead) continue;
      if (e.stun > 0) {
        this.floatText(e.view.x, e.view.y - 20, e.frozen ? '冰冻' : '眩晕', '#c0c0ff', 16);
        this.tickStun(e);
        this.refreshUnit(e);
        await e.view.act('stun');
        await wait(this, 200);
        continue;
      }
      e.turns++;
      await this.enemyAct(e);
      await wait(this, 120);
    }
    if (this.over) return;
    this.startPlayerTurn();
  }

  // ---------------------------------------------------------------- cards

  private async drawCards(n: number) {
    for (let i = 0; i < n; i++) {
      if (this.drawPile.length === 0) {
        if (this.discard.length === 0) break;
        this.drawPile = Phaser.Utils.Array.Shuffle(this.discard);
        this.discard = [];
      }
      const id = this.drawPile.pop()!;
      const cv = new CardView(this, 500, HUD_Y, id).setScale(0.3).setAlpha(0).setDepth(20);
      cv.hit.on('pointerdown', () => this.onCardClick(cv));
      cv.hit.on('pointerover', () => !this.selected && this.hint.setText(this.cardDesc(id)));
      this.hand.push(cv);
      this.layoutHand();
      await wait(this, 90);
    }
    this.refreshHud();
  }

  private layoutHand() {
    const n = this.hand.length;
    const spacing = Math.min(104, 520 / Math.max(1, n));
    this.hand.forEach((cv, i) => {
      const x = 270 + (i - (n - 1) / 2) * spacing;
      cv.baseY = HAND_Y;
      this.tweens.add({ targets: cv, x, y: HAND_Y, scale: 1, alpha: 1, duration: 220, ease: 'Cubic.out' });
    });
  }

  private async discardHand() {
    const cards = [...this.hand];
    this.hand = [];
    for (const cv of cards) this.discard.push(cv.cardId);
    await Promise.all(
      cards.map((cv, i) =>
        tweenP(this, { targets: cv, y: 1050, alpha: 0, duration: 250, delay: i * 40 }).then(() => cv.destroy()),
      ),
    );
    this.refreshHud();
  }

  private cardDesc(id: string) {
    const def = CARDS[id];
    if (def.kind === 'unit') {
      const u = UNITS[def.ref];
      const existing = this.liveAllies().find((a) => a.key === u.id);
      const extra = existing && existing.level < MAX_LEVEL ? `（场上已有，打出则升至 ${existing.level + 1} 星）` : '';
      return `【${u.name}】攻${u.atk} 血${u.hp} · ${u.desc}${extra}`;
    }
    const s = SPELLS[def.ref];
    const sp = this.spellPower > 0 ? `（法术强度 +${this.spellPower}）` : '';
    return `【${s.name}】${s.desc}${sp}`;
  }

  private canPlay(id: string) {
    const def = CARDS[id];
    if (this.energy < def.cost) return false;
    if (def.kind === 'unit') return this.unitPlayable(def.ref);
    return true;
  }

  private unitPlayable(key: string) {
    const existing = this.liveAllies().find((a) => a.key === key && a.level < MAX_LEVEL);
    return !!existing || this.allies.indexOf(null) !== -1;
  }

  private onCardClick(cv: CardView) {
    if (this.busy || this.over) return;
    if (this.selected === cv) {
      const def = CARDS[cv.cardId];
      if (def.kind === 'spell' && SPELLS[def.ref].target === 'enemy') return;
      this.playCard(cv, null);
      return;
    }
    this.deselect();
    const def = CARDS[cv.cardId];
    if (this.energy < def.cost) {
      this.hint.setText('能量不足！');
      return;
    }
    if (def.kind === 'unit' && !this.unitPlayable(def.ref)) {
      this.hint.setText('战场已满，只能打出场上已有的英雄来升星');
      return;
    }
    this.selected = cv;
    cv.setSelected(true);
    const needsTarget = def.kind === 'spell' && SPELLS[def.ref].target === 'enemy';
    if (needsTarget) this.liveEnemies().forEach((e) => e.view.setTargetable(true));
    this.hint.setText(`${this.cardDesc(cv.cardId)}\n${needsTarget ? '👉 点击一个敌人释放' : '👉 再次点击卡牌打出'}`);
  }

  private deselect() {
    if (this.selected) this.selected.setSelected(false);
    this.selected = null;
    this.liveEnemies().forEach((e) => e.view.setTargetable(false));
  }

  private onEnemyClick(u: Unit) {
    if (this.busy || !this.selected || u.dead) return;
    const def = CARDS[this.selected.cardId];
    if (def.kind === 'spell' && SPELLS[def.ref].target === 'enemy') this.playCard(this.selected, u);
  }

  private async playCard(cv: CardView, target: Unit | null) {
    const def = CARDS[cv.cardId];
    if (!this.canPlay(cv.cardId)) return;
    this.busy = true;
    this.deselect();
    this.energy -= def.cost;
    this.hand = this.hand.filter((c) => c !== cv);
    this.discard.push(cv.cardId);
    this.layoutHand();
    this.refreshHud();
    this.hint.setText('');
    this.tweens.add({ targets: cv, y: cv.y - 160, alpha: 0, scale: 1.3, duration: 300, onComplete: () => cv.destroy() });

    if (def.kind === 'unit') await this.playUnit(def.ref);
    else await this.castSpell(def.ref, target);
    await this.resolvePending();
    if (def.kind === 'spell' && rank('s_echo') && !this.echoUsed && this.liveEnemies().length > 0) {
      this.echoUsed = true;
      this.floatText(270, HUD_Y - 60, '法术回响：抽 1 张', '#c8a0ff', 16);
      await this.drawCards(1);
    }

    if (this.liveEnemies().length === 0) return this.onWaveCleared();
    this.busy = false;
    this.refreshHud();
  }

  private async playUnit(key: string) {
    const existing = this.liveAllies().find((a) => a.key === key && a.level < MAX_LEVEL);
    if (existing) {
      existing.level++;
      this.applyLevel(existing);
      existing.hp = existing.maxHp;
      this.refreshUnit(existing);
      this.floatText(existing.view.x, existing.view.y - 30, '升星！', '#ffd700', 24);
      await tweenP(this, { targets: existing.view, scale: 1.25, duration: 150, yoyo: true });
      return;
    }
    const slot = this.allies.indexOf(null);
    if (slot === -1) return;
    const def = UNITS[key];
    const pos = ALLY_SLOTS[slot];
    const view = new UnitView(this, pos.x, pos.y + 40, def.art, true, false, def.model);
    const u: Unit = {
      side: 'ally',
      key,
      name: def.name,
      baseAtk: def.atk,
      bonusAtk: 0,
      hp: def.hp,
      maxHp: def.hp,
      shield: 0,
      armor: 0,
      stun: 0,
      level: rank('u_elite') ? 2 : 1,
      taunt: !!def.taunt,
      skill: def.skill,
      boss: false,
      turns: 0,
      slot,
      dead: false,
      view,
      rage: 0,
      frozen: false,
    };
    view.portrait.setInteractive({ useHandCursor: true });
    view.portrait.on('pointerover', () => {
      if (!this.selected && !this.drag) this.hint.setText(`${def.name} ${'★'.repeat(u.level)}  攻${this.atkOf(u)}  血${Math.ceil(u.hp)}/${u.maxHp} · ${def.desc}  · 怒气 ${Math.floor(u.rage)}/${RAGE_MAX}`);
    });
    view.portrait.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (!this.selected) this.drag = { u, x: p.x, y: p.y, moved: false, slot: -1 };
    });
    this.allies[slot] = u;
    this.applyLevel(u);
    this.refreshUnit(u);
    view.setRage(0);
    this.refreshHud();
    view.setAlpha(0).setScale(1.6);
    await tweenP(this, { targets: view, y: pos.y, alpha: 1, scale: 1, duration: 300, ease: 'Back.out' });
    this.cameras.main.shake(100, 0.004);
  }

  private applyLevel(u: Unit) {
    const def = UNITS[u.key];
    const mul = 1 + 0.35 * (u.level - 1);
    const oldMax = u.maxHp;
    const bonus = unitTalentBonus(u.key);
    u.baseAtk = Math.round(def.atk * mul) + bonus.atk;
    u.maxHp = Math.round(def.hp * mul) + bonus.hp;
    u.hp += u.maxHp - oldMax;
  }

  /** Effects run in list order, so the editor can compose new spells without touching code. */
  private spellElement(spell: SpellDef, effect: SpellEffect): Element {
    if (effect.kind === 'burn' || effect.kind === 'airstrike') return 'fire';
    if (effect.kind === 'chain' || effect.visual === 'lightning') return 'lightning';
    if (effect.visual === 'fire') return 'fire';
    if (effect.visual === 'ice') return 'ice';
    return ELEMENT_ICON[spell.icon] ?? 'arcane';
  }

  private async castSpell(id: string, target: Unit | null) {
    const spell = SPELLS[id];
    if (!spell) return;
    const sp = this.spellBonus();
    const origin = { x: 270, y: 780 };
    for (const effect of spell.effects ?? []) {
      const element = this.spellElement(spell, effect);
      switch (effect.kind) {
        case 'damage_single': {
          if (!target) break;
          await this.playSkillVisual(effect.visual ?? (element === 'ice' ? 'ice' : 'fire'), origin, target.view, 0xff6a1a, 14);
          if (effect.visual === undefined && element !== 'ice') this.burst(target.view.x, target.view.y, 0xff8a2a);
          this.damage(target, effect.amount + sp, { element });
          if (effect.stun && !target.dead) {
            if (element === 'ice') this.freeze(target, effect.stun);
            else target.stun = effect.stun;
            this.floatText(target.view.x, target.view.y - 50, element === 'ice' ? '冰冻！' : '眩晕！', '#9fe3ff', 18);
            this.refreshUnit(target);
          }
          break;
        }
        case 'execute': {
          if (!target) break;
          await this.playSkillVisual(effect.visual ?? 'projectile', origin, target.view, 0xd02020, 10);
          const low = target.hp <= target.maxHp * (effect.threshold ?? 0.5);
          if (low) this.floatText(target.view.x, target.view.y - 50, '斩杀！', '#ff4040', 26);
          this.damage(target, (low ? effect.bonus : effect.amount) + sp, { element, crit: low });
          break;
        }
        case 'damage_all': {
          const targets = this.liveEnemies();
          await Promise.all(targets.map((e) => this.playSkillVisual(effect.visual ?? (element === 'fire' ? 'fire' : 'ice'), origin, e.view, spell.color)));
          targets.forEach((e) => this.damage(e, effect.amount + sp, { element }));
          break;
        }
        case 'airstrike': {
          await this.airstrike(effect.amount + sp, effect.burn);
          break;
        }
        case 'chain': {
          let from: { x: number; y: number } = origin;
          for (let i = 0; i < effect.hits; i++) {
            const pool = this.liveEnemies();
            if (pool.length === 0) break;
            const t = Phaser.Utils.Array.GetRandom(pool) as Unit;
            await this.playSkillVisual(effect.visual ?? 'lightning', from, t.view, spell.color);
            this.damage(t, effect.amount + sp, { element });
            from = { x: t.view.x, y: t.view.y };
            await wait(this, 180);
          }
          break;
        }
        case 'heal_all': {
          await Promise.all([...this.liveAllies().map(a => a.view), ...(effect.base ? [BASE_POS] : [])].map(to => this.playSkillVisual(effect.visual ?? 'heal', origin, to, spell.color)));
          this.liveAllies().forEach((a) => {
            this.healUnit(a, effect.amount + sp);
          });
          if (effect.base) this.healBase(effect.base + sp);
          await wait(this, 300);
          break;
        }
        case 'buff_all': {
          if (effect.visual === undefined) this.cameras.main.flash(200, 160, 20, 20);
          else await Promise.all(this.liveAllies().map(a => this.playSkillVisual(effect.visual!, origin, a.view, spell.color)));
          this.liveAllies().forEach((a) => {
            a.bonusAtk += effect.atk;
            this.floatText(a.view.x, a.view.y - 30, `攻击 +${effect.atk}`, '#ff7060', 18);
            if (effect.shield) a.shield += effect.shield + sp;
            this.refreshUnit(a);
          });
          await wait(this, 300);
          break;
        }
        case 'shield_all': {
          await Promise.all(this.liveAllies().map(a => this.playSkillVisual(effect.visual ?? 'shield', origin, a.view, spell.color)));
          this.liveAllies().forEach((a) => {
            a.shield += effect.amount + sp;
            this.refreshUnit(a);
          });
          await wait(this, 300);
          break;
        }
        case 'draw': {
          if (effect.visual !== undefined) await this.playSkillVisual(effect.visual, origin, origin, spell.color);
          this.floatText(270, HUD_Y - 60, `奥术智慧：抽 ${effect.count} 张`, '#c8a0ff', 16);
          await this.drawCards(effect.count);
          break;
        }
        case 'burn': {
          const targets = this.liveEnemies();
          await Promise.all(targets.map((e) => this.playSkillVisual(effect.visual ?? 'fire', origin, e.view, spell.color)));
          targets.forEach((e) => this.applyBurn(e, effect.amount + sp, effect.turns ?? 3));
          break;
        }
      }
    }
  }

  // ---------------------------------------------------------------- combat

  private liveAllies() {
    return this.allies.filter((u): u is Unit => !!u && !u.dead);
  }

  private liveEnemies() {
    return this.enemies.filter((u): u is Unit => !!u && !u.dead);
  }

  private frontEnemy() {
    const list = this.liveEnemies();
    if (list.length === 0) return null;
    return list.reduce((a, b) => (b.view.y > a.view.y ? b : a));
  }

  private weakestEnemy() {
    const list = this.liveEnemies();
    if (list.length === 0) return null;
    return list.reduce((a, b) => (b.hp < a.hp ? b : a));
  }

  private pickAllyTarget(exclude: Unit[] = []) {
    const list = this.liveAllies().filter((a) => !exclude.includes(a));
    if (list.length === 0) return null;
    const taunts = list.filter((a) => a.taunt);
    return Phaser.Utils.Array.GetRandom(taunts.length ? taunts : list) as Unit;
  }

  private refreshUnit(u: Unit) {
    u.view.refresh({ hp: u.hp, maxHp: u.maxHp, atk: this.atkOf(u), shield: u.shield, stun: u.stun, level: u.side === 'ally' ? u.level : undefined });
  }

  private damage(u: Unit, amount: number, hit: Hit = {}) {
    if (u.dead) return 0;
    const element = hit.element ?? 'physical';
    const react = hit.noReact ? null : reactionOf(element, u.frozen, !!u.burn);
    const crit = !!hit.crit || react === 'shatter';
    let raw = amount * (crit ? 1.8 + (this.has('dagger') ? 0.5 : 0) : 1);
    if (u.frozen && u.side === 'enemy' && this.has('frost')) raw *= 1.3;
    let bonus = react === 'steam' ? 8 + raw * 0.5 : react === 'overload' ? (u.burn?.dmg ?? 0) * 3 + 4 : 0;
    if (bonus && this.has('hammer')) bonus *= 1.5;
    raw += bonus;
    if (u.side === 'ally') {
      const warrior = this.tiers().warrior.tier;
      raw -= warrior >= 2 ? 3 : warrior ? 1 : 0;
      if (FRONT_SLOTS.includes(u.slot)) raw *= FRONT_DAMAGE_TAKEN;
    }
    let dmg = Math.max(1, Math.round(raw) - u.armor);
    if (u.shield > 0) {
      const absorbed = Math.min(u.shield, dmg);
      u.shield -= absorbed;
      dmg -= absorbed;
      if (absorbed > 0) this.floatText(u.view.x + 20, u.view.y - 10, `🛡-${absorbed}`, '#9fe3ff', 16);
    }
    u.hp -= dmg;
    if (crit && dmg > 0) this.critText(u, dmg);
    else if (dmg > 0) this.floatText(u.view.x, u.view.y - 20, `-${dmg}`, u.side === 'enemy' ? '#ffd040' : '#ff5050', u.boss ? 28 : 22);
    if (react) {
      if (react === 'overload') {
        u.burn = undefined;
        u.view.setBurn(false);
      } else {
        u.frozen = false;
        u.stun = 0;
        u.view.setFrozen(false);
      }
      this.reactionFx(u, react);
    }
    u.view.hitFlash();
    if (dmg > 0) this.gainRage(u, 12);
    this.refreshUnit(u);
    if (crit || react) this.hitStop(react ? 110 : 70);

    const mates = () => (u.side === 'enemy' ? this.liveEnemies() : this.liveAllies()).filter((o) => o !== u);
    if (u.hp <= 0) {
      const over = -u.hp;
      this.kill(u, { knock: crit || !!react || over >= u.maxHp * 0.3, from: hit.from });
      if (over > 0 && u.side === 'enemy' && this.has('cleaver') && !hit.noReact) {
        const o = Phaser.Utils.Array.GetRandom(mates()) as Unit | undefined;
        if (o) {
          this.lightning(u.view, o.view);
          this.damage(o, over, { noReact: true });
        }
      }
    } else if (u.boss && u.side === 'enemy' && !u.enraged && u.hp <= u.maxHp / 2) {
      u.enraged = true;
      this.pending.push(u);
    }
    if (react === 'steam') mates().forEach((o) => this.damage(o, Math.round(bonus * 0.5), { element: 'arcane', noReact: true }));
    if (react === 'overload') {
      const o = Phaser.Utils.Array.GetRandom(mates()) as Unit | undefined;
      if (o) {
        this.lightning(u.view, o.view);
        this.damage(o, Math.round(bonus), { element: 'lightning', noReact: true });
      }
    }
    return dmg;
  }

  private critText(u: Unit, dmg: number) {
    const { x, y } = this.pt(u.view.x, u.view.y - 30);
    const t = txt(this, x, y, `暴击 ${dmg}`, 34, '#ff9a1a', 6).setDepth(41).setScale(1.9);
    this.tweens.add({ targets: t, scale: 1, duration: 140, ease: 'Back.out' });
    this.tweens.add({ targets: t, y: y - 60, alpha: 0, duration: 700, delay: 300, ease: 'Cubic.in', onComplete: () => t.destroy() });
    this.cameras.main.shake(120, 0.006);
  }

  private reactionFx(u: Unit, r: Reaction) {
    const info = REACTIONS[r];
    const { x, y } = this.pt(u.view.x, u.view.y);
    const ring = this.add.circle(x, y, 14).setStrokeStyle(6, info.tint, 1).setDepth(36);
    this.tweens.add({ targets: ring, scale: 7, alpha: 0, duration: 420, ease: 'Cubic.out', onComplete: () => ring.destroy() });
    const flash = this.add.circle(x, y, 40, info.tint, 0.7).setDepth(36);
    this.tweens.add({ targets: flash, scale: 2.5, alpha: 0, duration: 300, onComplete: () => flash.destroy() });
    this.burst(u.view.x, u.view.y, info.tint, 20);
    const t = txt(this, x, y - 70, `${info.name}！`, 32, info.color, 7).setDepth(42).setScale(0.5);
    this.tweens.add({ targets: t, scale: 1.15, duration: 160, ease: 'Back.out' });
    this.tweens.add({ targets: t, y: y - 110, alpha: 0, duration: 600, delay: 650, onComplete: () => t.destroy() });
    this.cameras.main.shake(200, 0.012);
  }

  /** Apply (or refresh) a burn: lasts `turns` rounds; if already burning the per-turn damage doubles. */
  private applyBurn(u: Unit, dmg: number, turns: number) {
    if (u.dead) return;
    if (u.side === 'enemy' && this.has('ember')) dmg += 2;
    if (u.burn) {
      u.burn.dmg = dmg * 2;
      u.burn.turns = Math.max(u.burn.turns, turns);
      this.floatText(u.view.x, u.view.y - 50, '燃烧加剧！', '#ff7a2a', 18);
    } else {
      u.burn = { dmg, turns };
    }
    u.view.setBurn(true);
    this.refreshUnit(u);
  }

  /** Tick burning units once per round (start of the enemy phase), then decay the status. */
  private async tickBurn() {
    const burning = [...this.liveEnemies(), ...this.liveAllies()].filter((u) => !!u.burn && !u.dead);
    for (const u of burning) {
      if (!u.burn) continue;
      this.floatText(u.view.x, u.view.y - 50, `灼烧 ${u.burn.dmg}`, '#ff7a2a', 18);
      this.burst(u.view.x, u.view.y, 0xff6a1a, 10);
      this.damage(u, u.burn.dmg, { element: 'fire', noReact: true });
      if (u.dead) {
        u.burn = undefined;
        u.view.setBurn(false);
        continue;
      }
      u.burn.turns--;
      if (u.burn.turns <= 0) {
        u.burn = undefined;
        u.view.setBurn(false);
      }
      this.refreshUnit(u);
      await wait(this, 180);
    }
  }

  private kill(u: Unit, opt: { knock?: boolean; from?: Unit } = {}) {
    u.dead = true;
    if (u.side === 'ally') this.allies[u.slot] = null;
    else this.enemies[u.slot] = null;
    u.view.setTargetable(false);
    u.view.portrait.disableInteractive();
    if (u.boss) this.cameras.main.shake(500, 0.015);
    if (u.boss && u.side === 'enemy') this.bossKills++;
    if (this.marks?.boss === u) this.clearMarks();
    this.pending = this.pending.filter((p) => p !== u);
    if (opt.from) this.gainRage(opt.from, 10);
    if (u.side === 'enemy' && this.has('totem') && !this.killEnergyUsed && this.playerPhase) {
      this.killEnergyUsed = true;
      this.energy++;
      this.floatText(48, HUD_Y - 40, '+1 ⚡', '#9fe3ff', 18);
    }
    this.burst(u.view.x, u.view.y, u.side === 'enemy' ? 0x8aff8a : 0xff4a4a, 18);
    const has3d = u.view.hasModel;
    if (has3d) u.view.act('die');
    if (opt.knock) {
      // sent flying away from the attackers
      const dir = u.side === 'enemy' ? -1 : 1;
      this.tweens.add({ targets: u.view, y: u.view.y + dir * 75, duration: 450, ease: 'Cubic.out' });
      if (!has3d) this.tweens.add({ targets: u.view, angle: dir * 200, duration: 450 });
      this.burst(u.view.x, u.view.y + 20, 0xc8b090, 12);
    }
    if (u.side === 'enemy' && !this.finale && this.liveEnemies().length === 0) this.finale = this.lastHit(u);
    this.fading.push(u);
    this.tweens.add({
      targets: [u.view, u.label].filter(Boolean),
      alpha: 0,
      scale: has3d ? 1 : 0.3,
      angle: has3d ? 0 : u.side === 'enemy' ? 30 : -30,
      duration: has3d ? 300 : 400,
      delay: has3d ? 650 : 150,
      onComplete: () => {
        this.fading = this.fading.filter((f) => f !== u);
        u.view.destroy();
        u.label?.destroy();
      },
    });
  }

  private healUnit(u: Unit, n: number) {
    const before = u.hp;
    u.hp = Math.min(u.maxHp, u.hp + n);
    const healed = Math.round(u.hp - before);
    if (healed > 0) this.floatText(u.view.x, u.view.y - 20, `+${healed}`, '#6aff6a', 20);
    this.refreshUnit(u);
  }

  private healBase(n: number) {
    this.baseHp = Math.min(this.baseMaxHp, this.baseHp + n);
    this.floatText(BASE_POS.x, HUD_Y - 20, `+${n}`, '#6aff6a', 20);
    this.refreshHud();
  }

  private damageBase(n: number) {
    const dmg = Math.max(1, Math.round(n) - (this.has('scale') ? 2 : 0));
    this.baseHp -= dmg;
    this.floatText(BASE_POS.x, HUD_Y - 20, `-${dmg}`, '#ff5050', 24);
    this.cameras.main.shake(180, 0.008);
    this.refreshHud();
    if (this.baseHp <= 0 && !this.over) this.gameOver();
  }

  private async lunge(u: Unit, to: { x: number; y: number }, animation: 'attack' | 'cast' | 'cheer' = 'attack') {
    const { x, y } = u.view;
    const tx = x + (to.x - x) * 0.55;
    const ty = y + (to.y - y) * 0.55;
    u.view.setDepth(10);
    const swing = u.view.act(animation);
    await tweenP(this, { targets: u.view, x: tx, y: ty, duration: 130, ease: 'Quad.in' });
    await swing;
    this.tweens.add({ targets: u.view, x, y, duration: 180, ease: 'Quad.out', onComplete: () => u.view.setDepth(0) });
  }

  private async playSkillVisual(visual: string, from: { x: number; y: number }, to: { x: number; y: number }, color: number, size = 8) {
    if (visual === 'none') return;
    if (visual === 'ice') await this.iceShards(to);
    else if (visual === 'lightning') { this.lightning(from, to); await wait(this, 260); }
    else if (visual === 'heal' || visual === 'shield' || visual === 'burst') { this.burst(to.x, to.y, visual === 'heal' ? 0x6aff6a : visual === 'shield' ? 0x9fe3ff : color, 14); await wait(this, 280); }
    else await this.projectile(from, to, visual === 'fire' ? 0xff6a1a : color, visual === 'fire' ? 14 : size, visual === 'fire' ? 'cast' : 'attack');
  }

  private async projectile(src: { x: number; y: number }, dst: { x: number; y: number }, color: number, size = 8, animation: 'attack' | 'cast' | 'cheer' = 'attack') {
    // Units wind up a throw / cast and release the projectile on the impact frame.
    if (src instanceof UnitView) await src.act(animation);
    const from = this.pt(src.x, src.y);
    const to = this.pt(dst.x, dst.y);
    const p = this.add.circle(from.x, from.y, size, color).setDepth(30);
    const glow = this.add.circle(from.x, from.y, size * 2, color, 0.35).setDepth(29);
    await tweenP(this, { targets: [p, glow], x: to.x, y: to.y, duration: 260, ease: 'Quad.in' });
    p.destroy();
    glow.destroy();
  }

  private burst(x0: number, y0: number, color: number, count = 10) {
    const { x, y } = this.pt(x0, y0);
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 30 + Math.random() * 40;
      const s = this.add.circle(x, y, 3 + Math.random() * 4, color).setDepth(35);
      this.tweens.add({ targets: s, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, scale: 0.2, duration: 450, onComplete: () => s.destroy() });
    }
  }

  private async iceShards(at: { x: number; y: number }) {
    const target = this.pt(at.x, at.y);
    const shards = [];
    for (let i = 0; i < 4; i++) {
      const s = this.add.rectangle(target.x + (Math.random() - 0.5) * 50, target.y - 200 - i * 30, 6, 22, 0xbfeaff).setDepth(30).setAngle(15);
      shards.push(tweenP(this, { targets: s, y: target.y, duration: 260 + i * 40, ease: 'Quad.in' }).then(() => s.destroy()));
    }
    await Promise.all(shards);
    this.burst(at.x, at.y, 0x9fe3ff, 8);
  }

  private lightning(src: { x: number; y: number }, dst: { x: number; y: number }) {
    const from = this.pt(src.x, src.y);
    const to = this.pt(dst.x, dst.y);
    const g = this.add.graphics().setDepth(30);
    g.lineStyle(4, 0xd0c8ff, 1);
    g.beginPath();
    g.moveTo(from.x, from.y);
    const steps = 6;
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      g.lineTo(from.x + (to.x - from.x) * t + (Math.random() - 0.5) * 30, from.y + (to.y - from.y) * t + (Math.random() - 0.5) * 30);
    }
    g.lineTo(to.x, to.y);
    g.strokePath();
    this.tweens.add({ targets: g, alpha: 0, duration: 300, onComplete: () => g.destroy() });
  }

  /** Healing / shielding scales with stars unless an action opts out via `flat`. */
  private skillAmount(a: Unit, amount: number, flat?: boolean) {
    const star = flat ? 1 : 1 + 0.35 * (a.level - 1);
    const talent = a.key === 'elf' ? 3 * rank('u_elf') : a.key === 'tauren' ? 2 * rank('u_tauren') : 0;
    return Math.round(amount * star) + talent;
  }

  /** Runs a unit's skill as an ordered action list, so new skills need no code. */
  private async allyAct(a: Unit) {
    this.gainRage(a, 20);
    const atk = this.atkOf(a);
    const hit = (): Hit => ({ element: ATTACK_ELEMENT[a.key] ?? 'physical', crit: this.rollCrit(a), from: a });
    const skill = unitSkill(a.skill);
    const actions: UnitAction[] = skill?.actions?.length ? skill.actions : [{ kind: 'attack_front' }];
    const present = async (action: UnitAction, targets: Unit[], visual: string) => {
      const animation = action.animation ?? (action.kind.startsWith('attack') ? 'attack' : 'cast');
      if (animation !== 'none') await a.view.act(animation);
      const from = { x: a.view.x, y: a.view.y };
      await Promise.all(targets.map(t => this.playSkillVisual(action.visual ?? visual, from, t.view, 0x7ab8ff)));
    };
    for (const action of actions) {
      if (this.liveEnemies().length === 0 && action.kind.startsWith('attack')) return;
      switch (action.kind) {
        case 'attack_front': {
          const t = this.frontEnemy();
          if (!t) return;
          if (action.animation === undefined && action.visual === undefined) await this.lunge(a, t.view);
          else await present(action, [t], 'none');
          const bonus = action.bonusVsLowHp && t.hp <= t.maxHp / 2 ? action.bonusVsLowHp : 0;
          const dealt = this.damage(t, atk * (action.ratio ?? 1) + bonus, hit());
          if (action.lifesteal && dealt > 0) this.healUnit(a, Math.round(dealt * action.lifesteal));
          if (action.stunChance && !t.dead) {
            const chance = action.stunChance + 0.1 * rank('u_dwarf') * (t.boss ? 0.5 : 1);
            if (Math.random() < chance) {
              t.stun = action.stunTurns ?? 1;
              this.floatText(t.view.x, t.view.y - 50, '眩晕！', '#c0c0ff', 18);
              this.refreshUnit(t);
            }
          }
          break;
        }
        case 'attack_weakest': {
          const talentThrows = a.key === 'troll' && rank('u_troll') >= 3 ? 3 : 0;
          const times = Math.max(action.times ?? 1, talentThrows);
          for (let i = 0; i < times; i++) {
            const t = this.weakestEnemy();
            if (!t) return;
            await present(action, [t], 'projectile');
            const bonus = action.bonusVsLowHp && t.hp <= t.maxHp / 2 ? action.bonusVsLowHp : 0;
            this.damage(t, atk * (action.ratio ?? 1) + bonus, hit());
          }
          break;
        }
        case 'attack_all': {
          const targets = this.liveEnemies().slice(0, action.maxTargets ?? 99);
          await present(action, targets, 'projectile');
          targets.forEach((t, i) => this.damage(t, atk * (action.ratio ?? 1) * Math.pow(1 - (action.decay ?? 0), i), hit()));
          break;
        }
        case 'heal_lowest': {
          const allies = this.liveAllies();
          if (allies.length === 0) break;
          const low = allies.reduce((x, y) => (y.hp / y.maxHp < x.hp / x.maxHp ? y : x));
          await present(action, [low], 'heal');
          this.healUnit(low, this.skillAmount(a, action.amount, action.flat));
          break;
        }
        case 'heal_all': {
          const targets = this.liveAllies();
          await present(action, targets, 'heal');
          targets.forEach((o) => this.healUnit(o, this.skillAmount(a, action.amount, action.flat)));
          break;
        }
        case 'shield_all': {
          const targets = this.liveAllies();
          await present(action, targets, 'shield');
          targets.forEach((o) => {
            o.shield += this.skillAmount(a, action.amount, action.flat);
            this.refreshUnit(o);
          });
          break;
        }
      }
    }
  }

  private async enemyHit(e: Unit, target: Unit | null, mult = 1) {
    if (target) {
      await this.lunge(e, target.view);
      return this.damage(target, this.atkOf(e) * mult);
    }
    await this.projectile(e.view, BASE_POS, 0xff4030, 9);
    this.damageBase(this.atkOf(e) * mult);
    const spikes = 4 * rank('b_spikes');
    if (spikes > 0 && !this.over && !e.dead) {
      this.floatText(e.view.x, e.view.y - 50, '尖刺反伤', '#ffb060', 15);
      this.damage(e, spikes + e.armor);
    }
    return 0;
  }

  private freeEnemySlot() {
    return ENEMY_FILL_ORDER.find((s) => !this.enemies[s]) ?? -1;
  }

  /** Numbers come from EnemyDef.aiParams, so the editor can retune encounters. */
  private async enemyAct(e: Unit) {
    const p = e.aiParams ?? {};
    if (e.boss && e.ai && TELEGRAPHS[e.ai]) {
      if (this.marks?.boss === e) return this.unleash(e);
      if (e.turns % 3 === 2 && this.liveAllies().length) {
        await this.markSlots(e, TELEGRAPHS[e.ai]);
        return void (await this.enemyHit(e, this.pickAllyTarget()));
      }
    }
    switch (e.ai) {
      case 'summoner': {
        const key = p.summonKey ?? 'skeleton';
        if (e.turns % 2 === 0 && this.freeEnemySlot() !== -1) {
          this.floatText(e.view.x, e.view.y - 50, '亡者复苏！', '#8aff8a', 18);
          await e.view.act('cast');
          this.burst(e.view.x, e.view.y, 0x6aff6a);
          for (let i = 0; i < Math.max(1, p.summonCount ?? 1); i++) {
            const slot = this.freeEnemySlot();
            if (slot !== -1) this.spawnEnemy(key, slot);
          }
          await wait(this, 450);
        } else {
          await this.enemyHit(e, this.pickAllyTarget());
        }
        break;
      }
      case 'cleave': {
        const t1 = this.pickAllyTarget();
        await this.enemyHit(e, t1);
        const t2 = t1 ? this.pickAllyTarget([t1]) : null;
        if (t2) this.damage(t2, this.atkOf(e) * (p.cleaveRatio ?? 0.6));
        break;
      }
      case 'boss_dragon': {
        if (e.turns % 3 === 0) {
          this.floatText(e.view.x, e.view.y + 80, '冰霜吐息！', '#9fe3ff', 26);
          await e.view.act('cast');
          const allies = this.liveAllies();
          await Promise.all(allies.map((a) => this.iceShards(a.view)));
          allies.forEach((a) => this.damage(a, this.atkOf(e) * (p.aoeRatio ?? 0.7)));
          await this.projectile(e.view, BASE_POS, 0x9fe3ff, 14);
          this.damageBase(p.aoeBaseDamage ?? 5);
        } else {
          await this.enemyHit(e, this.pickAllyTarget());
        }
        break;
      }
      case 'boss_lich': {
        const phase = e.turns % 3;
        if (phase === 1) {
          this.floatText(e.view.x, e.view.y + 80, '亡灵大军！', '#8aff8a', 26);
          await e.view.act('cast');
          for (let i = 0; i < Math.max(1, p.summonCount ?? 2); i++) {
            const slot = this.freeEnemySlot();
            if (slot !== -1) this.spawnEnemy(p.summonKey ?? 'ghoul', slot);
          }
          await wait(this, 500);
        } else if (phase === 2) {
          this.floatText(e.view.x, e.view.y + 80, '冰霜新星！', '#9fe3ff', 26);
          await e.view.act('cast');
          this.cameras.main.flash(200, 120, 200, 255);
          const allies = this.liveAllies();
          allies.forEach((a) => this.damage(a, this.atkOf(e) * (p.aoeRatio ?? 0.5)));
          const frozen = this.pickAllyTarget();
          if (frozen) this.freeze(frozen, p.stunTurns ?? 1);
          if (allies.length === 0) await this.enemyHit(e, null, 0.6);
          await wait(this, 400);
        } else {
          await this.enemyHit(e, this.pickAllyTarget());
        }
        break;
      }
      case 'boss_demon': {
        if (e.turns % 3 === 0) {
          this.floatText(e.view.x, e.view.y + 80, '邪能火雨！', '#8aff4a', 26);
          await e.view.act('cast');
          const allies = this.liveAllies();
          allies.forEach((a) => {
            this.burst(a.view.x, a.view.y, 0x8aff4a);
            this.damage(a, this.atkOf(e) * (p.aoeRatio ?? 0.5));
          });
          await this.projectile(e.view, BASE_POS, 0x8aff4a, 14);
          this.damageBase(p.aoeBaseDamage ?? 8);
        } else {
          const allies = this.liveAllies();
          const strongest = allies.length ? allies.reduce((x, y) => (this.atkOf(y) > this.atkOf(x) ? y : x)) : null;
          const dealt = await this.enemyHit(e, strongest, 1.4);
          if (p.lifesteal && dealt > 0) this.healUnit(e, Math.round(dealt * p.lifesteal));
        }
        break;
      }
      default:
        await this.enemyHit(e, this.pickAllyTarget());
    }
  }

  // ---------------------------------------------------------------- ultimates

  private async castUlt(a: Unit) {
    const ult = ultOf(a.key, a.skill);
    this.busy = true;
    this.deselect();
    this.hint.setText('');
    this.refreshHud();
    a.rage = 0;
    a.view.setRage(0);
    await this.ultCutscene(a, ult);

    const atk = this.atkOf(a);
    const hit = (crit = false): Hit => ({ element: ult.element, crit: crit || this.rollCrit(a), from: a });
    await a.view.act(ult.element === 'physical' ? 'attack' : 'cast');
    const c = Phaser.Display.Color.IntegerToColor(ult.color);
    this.cameras.main.flash(180, c.red, c.green, c.blue);
    this.cameras.main.shake(260, 0.012);
    let dealt = 0;
    if (ult.all) {
      const targets = this.liveEnemies();
      await Promise.all(targets.map((t) => this.ultVisual(ult, a, t)));
      targets.forEach((t) => (dealt += this.damage(t, atk * ult.all!, hit())));
    }
    if (ult.hits) {
      for (let i = 0; i < ult.hits[0]; i++) {
        const t = Phaser.Utils.Array.GetRandom(this.liveEnemies()) as Unit | undefined;
        if (!t) break;
        await this.ultVisual(ult, a, t);
        dealt += this.damage(t, atk * ult.hits[1], hit());
        await wait(this, 70);
      }
    }
    if (ult.front) {
      const t = this.frontEnemy();
      if (t) {
        await this.ultVisual(ult, a, t);
        dealt += this.damage(t, atk * ult.front, hit(ult.crit));
      }
    }
    for (const e of this.liveEnemies()) {
      if (ult.stunAll) e.stun = Math.max(e.stun, ult.stunAll);
      if (ult.freezeAll) this.freeze(e, ult.freezeAll);
      if (ult.burnAll) this.applyBurn(e, ult.burnAll, 3);
      this.refreshUnit(e);
    }
    for (const o of this.liveAllies()) {
      if (ult.healAll) this.healUnit(o, ult.healAll);
      if (ult.shieldAll) {
        o.shield += ult.shieldAll;
        this.refreshUnit(o);
      }
    }
    if (ult.drain && dealt > 0) this.healUnit(a, Math.round(dealt * 0.5));
    await wait(this, 300);
    await this.resolvePending();
    if (this.over) return;
    if (this.liveEnemies().length === 0) return this.onWaveCleared();
    this.busy = false;
    this.refreshHud();
  }

  /** Camera swoops to the hero in slow motion while the ultimate's name slashes across the screen. */
  private async ultCutscene(a: Unit, ult: UltDef) {
    const { width, height } = this.scale;
    const slow = 0.35;
    const real = (ms: number) => ms * slow;
    const g = this.bg.groundOffset(a.view.x, a.view.y + a.view.radius * 0.85);
    focusOn(g.x, g.z, 0.6, a.view.x < width / 2 ? 0.3 : -0.3);
    this.setSlow(slow);
    const dim = this.add.rectangle(0, 0, width, height, 0x000000, 0).setOrigin(0).setDepth(5);
    a.view.setDepth(10);
    this.tweens.add({ targets: dim, fillAlpha: 0.5, duration: real(220) });
    const stripe = this.add.rectangle(-width, 250, width * 1.5, 96, ult.color, 0.92).setAngle(-6).setDepth(56);
    const edge = this.add.rectangle(-width, 302, width * 1.5, 6, 0xffffff, 0.9).setAngle(-6).setDepth(56);
    const who = txt(this, -width, 232, `${a.name} ${'★'.repeat(a.level)}`, 18, '#ffffff', 4).setDepth(57);
    const name = txt(this, -width, 266, ult.name, 46, '#fff6d0', 8).setDepth(57);
    this.tweens.add({ targets: [stripe, edge], x: width / 2, duration: real(240), ease: 'Cubic.out' });
    this.tweens.add({ targets: [who, name], x: width / 2, duration: real(320), ease: 'Back.out', delay: real(60) });
    void a.view.act('cheer');
    await realWait(1050);
    if (!this.sys.isActive()) return;
    this.setSlow(1);
    endFocus();
    this.tweens.add({ targets: [stripe, edge, who, name], x: width * 2, duration: 220, ease: 'Cubic.in', onComplete: () => [stripe, edge, who, name].forEach((o) => o.destroy()) });
    this.tweens.add({ targets: dim, fillAlpha: 0, duration: 260, onComplete: () => dim.destroy() });
    a.view.setDepth(0);
    await wait(this, 180);
  }

  private async ultVisual(ult: UltDef, a: Unit, t: Unit) {
    switch (ult.element) {
      case 'ice':
        return this.iceShards(t.view);
      case 'lightning':
        this.lightning({ x: t.view.x + Phaser.Math.Between(-40, 40), y: t.view.y - 320 }, t.view);
        this.burst(t.view.x, t.view.y, 0xd0c8ff, 12);
        return wait(this, 110);
      case 'fire':
        return this.projectile({ x: a.view.x, y: a.view.y }, t.view, ult.color, 14);
      default:
        this.burst(t.view.x, t.view.y, ult.color, 16);
        return wait(this, 90);
    }
  }

  // ---------------------------------------------------------------- boss telegraphs

  /** Glowing warning circle on a hero slot's ground spot. */
  private addDecal(slot: number, color: number) {
    const s = ALLY_SLOTS[slot];
    const x = s.x;
    const y = s.y + UNIT_FOOT;
    const c = this.onGround(this.add.container(x, y));
    const fill = this.add.ellipse(0, 0, 104, 44, 0xff2a1a, 0.28).setStrokeStyle(3, 0xff3a2a, 1);
    const inner = this.add.ellipse(0, 0, 104, 44, color, 0.35);
    const warn = txt(this, 0, -2, '⚠', 22, '#ffdd55', 4);
    c.add([fill, inner, warn]);
    this.tweens.add({ targets: inner, scaleX: { from: 0.2, to: 1 }, scaleY: { from: 0.2, to: 1 }, alpha: { from: 0.6, to: 0 }, duration: 900, repeat: -1 });
    this.tweens.add({ targets: fill, alpha: { from: 1, to: 0.55 }, duration: 450, yoyo: true, repeat: -1 });
    this.decals.push({ obj: c, x, y });
  }

  private clearMarks() {
    this.marks = null;
    for (const d of this.decals) this.tweens.add({ targets: d.obj, alpha: 0, duration: 250, onComplete: () => d.obj.destroy() });
    this.decals = [];
  }

  private async markSlots(boss: Unit, def: TelegraphDef) {
    const filled = (ids: number[]) => ids.filter((i) => this.allies[i]).length;
    let slots: number[];
    if (def.pattern === 'row') {
      const back = [3, 4];
      slots = filled(FRONT_SLOTS) >= filled(back) ? [...FRONT_SLOTS] : back;
      if (boss.enraged) slots.push(Phaser.Utils.Array.GetRandom((slots === back ? FRONT_SLOTS : back).slice()));
    } else {
      const n = def.pattern + (boss.enraged ? 1 : 0);
      const all = ALLY_SLOTS.map((_, i) => i);
      const occupied = Phaser.Utils.Array.Shuffle(all.filter((i) => this.allies[i]));
      const empty = Phaser.Utils.Array.Shuffle(all.filter((i) => !this.allies[i]));
      slots = [...occupied, ...empty].slice(0, n);
    }
    const hex = `#${def.color.toString(16).padStart(6, '0')}`;
    this.floatText(boss.view.x, boss.view.y + 80, `${def.name} 蓄力中！`, hex, 24);
    await boss.view.act('cast');
    slots.forEach((s) => this.addDecal(s, def.color));
    this.marks = { boss, slots, def };
    await wait(this, 350);
  }

  private async unleash(boss: Unit) {
    const m = this.marks!;
    this.marks = null;
    this.floatText(boss.view.x, boss.view.y + 80, `${m.def.name}！`, '#ff6a4a', 30);
    await boss.view.act('cast');
    this.cameras.main.shake(450, 0.016);
    const c = Phaser.Display.Color.IntegerToColor(m.def.color);
    this.cameras.main.flash(220, c.red, c.green, c.blue);
    await Promise.all(
      m.slots.map(async (s) => {
        const at = { x: ALLY_SLOTS[s].x, y: ALLY_SLOTS[s].y };
        if (m.def.element === 'ice') await this.iceShards(at);
        else await this.projectile({ x: at.x + 60, y: at.y - 420 }, at, m.def.color, 18);
        this.burst(at.x, at.y, m.def.color, 18);
      }),
    );
    let hits = 0;
    for (const s of m.slots) {
      const a = this.allies[s];
      if (!a) continue;
      hits++;
      this.damage(a, this.atkOf(boss) * 2.2, { element: m.def.element });
      if (a.dead) continue;
      if (m.def.element === 'ice') this.freeze(a, 1);
      else this.applyBurn(a, 4, 2);
    }
    this.clearMarks();
    if (hits === 0) {
      const t = txt(this, 270, 470, '完美闪避！', 40, '#7dff7a', 7).setDepth(50).setScale(0.5);
      this.tweens.add({ targets: t, scale: 1.1, duration: 200, ease: 'Back.out' });
      this.tweens.add({ targets: t, alpha: 0, y: 430, delay: 900, duration: 300, onComplete: () => t.destroy() });
    }
    await wait(this, 450);
  }

  // ---------------------------------------------------------------- boss phase two

  private async resolvePending() {
    while (this.pending.length && !this.over) {
      const b = this.pending.shift()!;
      if (!b.dead) await this.bossPhase(b);
    }
  }

  private async bossPhase(b: Unit) {
    const { width } = this.scale;
    const slow = 0.4;
    const g = this.bg.groundOffset(b.view.x, b.view.y + b.view.radius * 0.85);
    focusOn(g.x, g.z, 0.78, 0);
    this.setSlow(slow);
    this.cameras.main.flash(300, 255, 40, 20);
    this.cameras.main.shake(900, 0.018);
    this.bg.setMood('rage');
    const title = txt(this, width / 2, 330, `${b.name} 狂暴化！`, 40, '#ff5a3a', 8).setDepth(56).setScale(2).setAlpha(0);
    const sub = txt(this, width / 2, 380, '攻击 +30% · 召唤援军 · 技能范围扩大', 16, '#ffd0b0', 4).setDepth(56).setAlpha(0);
    this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 300 * slow, ease: 'Back.out' });
    this.tweens.add({ targets: sub, alpha: 1, duration: 300 * slow, delay: 200 * slow });
    void b.view.act('cheer');
    await realWait(1400);
    if (!this.sys.isActive()) return;
    this.setSlow(1);
    endFocus();
    b.bonusAtk += Math.round(b.baseAtk * 0.3);
    b.label?.setText(`${b.name} · 狂暴`).setColor('#ff6a5a');
    this.refreshUnit(b);
    const minion = b.aiParams?.summonKey ?? Object.keys(ENEMIES).find((k) => !ENEMIES[k].boss);
    for (let i = 0; i < 2 && minion; i++) {
      const slot = this.freeEnemySlot();
      if (slot !== -1) this.spawnEnemy(minion, slot);
    }
    this.tweens.add({ targets: [title, sub], alpha: 0, y: '-=30', duration: 350, onComplete: () => (title.destroy(), sub.destroy()) });
    await wait(this, 500);
  }

  // ---------------------------------------------------------------- legendary: dragon airstrike

  private async airstrike(amount: number, burn: number) {
    const { width } = this.scale;
    const title = txt(this, width / 2, 190, '巨龙空袭！', 50, '#ff7a2a', 8).setDepth(56).setScale(2.4).setAlpha(0);
    this.tweens.add({ targets: title, scale: 1, alpha: 1, duration: 260, ease: 'Back.out' });
    this.cameras.main.shake(700, 0.006);
    focusOn(0, -2, 1.22, 0);
    const from = { x: -170, y: 720 };
    const to = { x: width + 170, y: 60 };
    const dragon = new UnitView(this, from.x, from.y, 'b_dragon', false, true).bare();
    dragon.portrait.y -= 150;
    dragon.setFacing(Math.PI * 0.78).setScale(1.35).setDepth(20);
    this.extras.push(dragon);
    void dragon.act('attack');
    const dur = 1700;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len2 = dx * dx + dy * dy;
    for (const t of this.liveEnemies()) {
      const prog = Phaser.Math.Clamp(((t.view.x - from.x) * dx + (t.view.y - from.y) * dy) / len2, 0.08, 0.92);
      this.time.delayedCall(dur * prog, () => {
        if (t.dead) return;
        this.burst(t.view.x, t.view.y, 0xff6a1a, 22);
        this.damage(t, amount, { element: 'fire' });
        this.applyBurn(t, burn, 3);
      });
    }
    const trail = this.time.addEvent({ delay: 60, loop: true, callback: () => this.burst(dragon.x, dragon.y + 20, Phaser.Utils.Array.GetRandom([0xff6a1a, 0xffb03a, 0xff3a1a]), 5) });
    await tweenP(this, { targets: dragon, x: to.x, y: to.y, duration: dur, ease: 'Sine.inOut' });
    trail.remove();
    this.extras = this.extras.filter((v) => v !== dragon);
    dragon.destroy();
    endFocus();
    this.tweens.add({ targets: title, alpha: 0, y: 160, duration: 300, onComplete: () => title.destroy() });
    await wait(this, 350);
  }

  // ---------------------------------------------------------------- rewards

  private rollCard(forced?: Rarity) {
    const r = Math.random();
    const rarity = forced ?? (r < 0.5 ? 'common' : r < 0.85 ? 'rare' : 'epic');
    const pool = Object.values(CARDS).filter((c) => c.rarity === rarity);
    return Phaser.Utils.Array.GetRandom(pool).id as string;
  }

  private buildRewards(boss: boolean): Reward[] {
    const perks: Reward[] = [
      { kind: 'perk', id: 'base_heal', title: '修缮大本营', desc: '大本营恢复 25 点生命', color: 0x3fae3a, glyph: '🏰' },
      { kind: 'perk', id: 'base_max', title: '加固城墙', desc: '大本营生命上限 +15\n并恢复 15 点', color: 0x8a6a30, glyph: '🧱' },
      { kind: 'perk', id: 'spell', title: '术士秘典', desc: '所有法术的伤害、\n治疗、护盾 +2', color: 0x8a4fd0, glyph: '📖' },
    ];
    if (boss) {
      const list: Reward[] = [];
      if (this.maxEnergy < 6) list.push({ kind: 'perk', id: 'energy', title: '能量之泉', desc: '每回合能量上限 +1', color: 0x1d6fd8, glyph: '⚡' });
      list.push({ kind: 'perk', id: 'starup', title: '先祖祝福', desc: '场上所有英雄 +1 星', color: 0xd99a1e, glyph: '⭐' });
      const epics = Object.values(CARDS).filter((c) => c.rarity === 'epic');
      while (list.length < 3) list.push({ kind: 'card', cardId: Phaser.Utils.Array.GetRandom(epics).id });
      return list;
    }
    const list: Reward[] = [];
    const used = new Set<string>();
    while (list.length < 2) {
      const id = this.rollCard();
      if (used.has(id)) continue;
      used.add(id);
      list.push({ kind: 'card', cardId: id });
    }
    list.push(Math.random() < 0.55 ? Phaser.Utils.Array.GetRandom(perks) : { kind: 'card', cardId: this.rollCard() });
    return list;
  }

  private showRewards(boss: boolean) {
    const { width, height } = this.scale;
    const layer = this.add.container(0, 0).setDepth(100);
    const shade = this.add.rectangle(0, 0, width, height, 0x000000, 0.72).setOrigin(0).setInteractive();
    layer.add(shade);
    layer.add(txt(this, width / 2, 230, boss ? '首领战利品' : '选择一项奖励', 34, '#ffcf4a', 6));
    layer.add(txt(this, width / 2, 275, `牌组 ${this.deck.length} 张 · 已通过 ${this.wave} 波`, 15, '#e8dcc0', 3));

    const rewards = this.buildRewards(boss);
    const close = () => {
      layer.destroy();
      void this.afterRewards(boss);
    };
    rewards.forEach((rw, i) => {
      const x = width / 2 + (i - 1) * 165;
      const y = 470;
      const item = this.add.container(x, y);
      layer.add(item);
      let title: string;
      let desc: string;
      if (rw.kind === 'card') {
        const cv = new CardView(this, 0, 0, rw.cardId).setScale(1.25);
        cv.hit.disableInteractive();
        item.add(cv);
        const def = CARDS[rw.cardId];
        if (def.kind === 'unit') {
          const u = UNITS[def.ref];
          title = u.name;
          desc = `攻${u.atk} 血${u.hp}\n${u.desc}`;
        } else {
          title = SPELLS[def.ref].name;
          desc = SPELLS[def.ref].desc;
        }
        title = `加入牌组：${title}`;
      } else {
        const g = this.add.graphics();
        g.fillStyle(0x23160c, 1).fillRoundedRect(-62, -92, 124, 184, 12);
        g.fillStyle(rw.color, 1).fillRoundedRect(-57, -87, 114, 174, 10);
        g.lineStyle(3, 0xf3d68a, 1).strokeRoundedRect(-57, -87, 114, 174, 10);
        item.add([g, txt(this, 0, -20, rw.glyph, 56)]);
        title = rw.title;
        desc = rw.desc;
      }
      item.add(txt(this, 0, 118, title, 14, '#ffeec2', 4).setWordWrapWidth(150));
      item.add(txt(this, 0, 158, desc, 12, '#d8ccb0', 3).setWordWrapWidth(150));
      const hit = this.add.rectangle(0, 20, 150, 290, 0, 0.001).setInteractive({ useHandCursor: true });
      item.add(hit);
      item.setScale(0.6).setAlpha(0);
      this.tweens.add({ targets: item, scale: 1, alpha: 1, duration: 300, delay: 150 + i * 100, ease: 'Back.out' });
      hit.on('pointerover', () => item.setScale(1.05));
      hit.on('pointerout', () => item.setScale(1));
      hit.on('pointerdown', () => {
        this.applyReward(rw);
        close();
      });
    });

    const skip = txt(this, width / 2, 790, '跳过 ›', 20, '#a09070', 4).setInteractive({ useHandCursor: true });
    skip.on('pointerdown', close);
    layer.add(skip);
  }

  /** Elite and boss fights drop a relic; then pick the road ahead (detours don't cost a wave). */
  private async afterRewards(boss: boolean) {
    if (boss || this.nodeKind === 'elite') await pickRelic(this.host, 3, boss ? '首领遗物' : '精英遗物');
    const next = this.wave + 1;
    const bossNext = isBossWave(next);
    const bossIn = BOSS_EVERY - ((next - 1) % BOSS_EVERY);
    let detour = false;
    for (;;) {
      const opts: RouteKind[] = bossNext ? ['boss'] : next > 2 ? ['fight', 'elite'] : ['fight'];
      if (!detour) opts.push(bossNext ? 'camp' : (Phaser.Utils.Array.GetRandom(['camp', 'shop', 'event']) as RouteKind));
      const pick = await chooseRoute(this.host, opts, next, bossIn);
      if (pick === 'camp') await runCamp(this.host);
      else if (pick === 'shop') await runShop(this.host);
      else if (pick === 'event') await runEvent(this.host);
      else {
        this.nodeKind = pick;
        break;
      }
      this.refreshHud();
      detour = true;
    }
    this.advance();
  }

  private applyReward(rw: Reward) {
    if (rw.kind === 'card') {
      this.deck.push(rw.cardId);
      return;
    }
    switch (rw.id) {
      case 'base_heal':
        this.healBase(25);
        break;
      case 'base_max':
        this.baseMaxHp += 15;
        this.healBase(15);
        break;
      case 'spell':
        this.spellPower += 2;
        break;
      case 'energy':
        this.maxEnergy++;
        break;
      case 'starup':
        this.liveAllies().forEach((a) => {
          if (a.level < MAX_LEVEL) {
            a.level++;
            this.applyLevel(a);
            a.hp = a.maxHp;
            this.refreshUnit(a);
          }
        });
        break;
    }
    this.refreshHud();
  }

  // ---------------------------------------------------------------- end

  private gameOver() {
    this.over = true;
    this.busy = true;
    const reached = this.wave;
    const best = Math.max(reached, Number(localStorage.getItem('horde_best') || 0));
    localStorage.setItem('horde_best', String(best));
    const earned = runPoints(reached - this.firstWave, this.bossKills);
    addPoints(earned);

    const { width, height } = this.scale;
    this.time.delayedCall(600, () => {
      const layer = this.add.container(0, 0).setDepth(200);
      layer.add(this.add.rectangle(0, 0, width, height, 0x000000, 0.8).setOrigin(0).setInteractive());
      layer.add(txt(this, width / 2, 330, '大本营已陷落', 44, '#ff5a4a', 7));
      layer.add(txt(this, width / 2, 400, `本次到达第 ${reached} 波`, 24, '#ffeec2', 5));
      layer.add(txt(this, width / 2, 440, `最远纪录：第 ${best} 波`, 18, '#9fe3ff', 4));
      layer.add(txt(this, width / 2, 482, `获得天赋点 +${earned}（可用 ${talentPoints()}）`, 18, '#ffd27a', 4));
      const again = txt(this, width / 2, 560, '再次远征', 30, '#ffcf4a', 6).setInteractive({ useHandCursor: true });
      again.on('pointerdown', () => this.scene.restart());
      const talents = txt(this, width / 2, 625, '⭐ 学习天赋', 22, '#ffeec2', 4).setInteractive({ useHandCursor: true });
      talents.on('pointerdown', () => this.scene.start('talents'));
      const menu = txt(this, width / 2, 680, '返回主菜单', 20, '#c0b090', 4).setInteractive({ useHandCursor: true });
      menu.on('pointerdown', () => this.scene.start('menu'));
      layer.add([again, talents, menu]);
    });
  }
}
