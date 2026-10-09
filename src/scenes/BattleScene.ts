import Phaser from 'phaser';
import {
  BOSS_EVERY,
  CARDS,
  ENEMIES,
  EnemyAI,
  EnemyAIParams,
  SPELLS,
  UNITS,
  UnitAction,
  UnitSkill,
  buildWave,
  isBossWave,
  unitSkill,
  waveScale,
} from '../data';
import { CardView, UnitView, tweenP, txt, wait } from '../ui';
import { Background, addBackground } from '../three/battlefield';
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
}

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
const HAND_Y = 868;
const HUD_Y = 715;
const BASE_POS = { x: 215, y: HUD_Y };
const MAX_LEVEL = 5;
const HAND_SIZE = 5;

const atkOf = (u: Unit) => u.baseAtk + u.bonusAtk;

export class BattleScene extends Phaser.Scene {
  private bg!: Background;
  private bgScroll = 0;

  private deck: string[] = [];
  private drawPile: string[] = [];
  private discard: string[] = [];
  private hand: CardView[] = [];
  private selected: CardView | null = null;

  private allies: (Unit | null)[] = [];
  private enemies: (Unit | null)[] = [];

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

    this.input.on('pointerdown', (_p: Phaser.Input.Pointer, objs: Phaser.GameObjects.GameObject[]) => {
      if (objs.length === 0 && this.selected) this.deselect();
    });
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

  private floatText(x: number, y: number, str: string, color: string, size = 22) {
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
    this.bg.setMood(boss ? 'boss' : 'day');
    list.forEach((key, i) => this.spawnEnemy(key, fill[i], cycle));

    if (boss) {
      this.cameras.main.shake(400, 0.01);
      this.cameras.main.flash(300, 120, 0, 0);
      await this.banner(`首领来袭：${ENEMIES[list[0]].name}`, '#ff6a5a', 32);
    } else {
      await wait(this, 400);
    }
    this.startPlayerTurn();
  }

  private spawnEnemy(key: string, slot: number, cycle = 0) {
    const def = ENEMIES[key];
    if (!def) return null;
    if (slot < 0 || slot >= ENEMY_SLOTS.length || this.enemies[slot]) return null;
    const scale = waveScale(this.wave) * (1 + cycle * 0.5);
    const pos = ENEMY_SLOTS[slot];
    const view = new UnitView(this, pos.x, pos.y - 260, def.art, false, !!def.boss, def.model);
    const u: Unit = {
      side: 'enemy',
      key,
      name: def.name,
      baseAtk: Math.round(def.atk * scale),
      bonusAtk: 0,
      hp: Math.round(def.hp * scale),
      maxHp: Math.round(def.hp * scale),
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
    if (u.boss) {
      u.label = txt(this, pos.x, pos.y + view.radius + 14, def.name, 15, '#e0b0ff', 4).setAlpha(0);
      this.tweens.add({ targets: u.label, alpha: 1, duration: 400, delay: 400 });
    }
    view.portrait.setInteractive({ useHandCursor: true });
    view.portrait.on('pointerdown', () => this.onEnemyClick(u));
    view.portrait.on('pointerover', () => {
      if (!this.selected) this.hint.setText(`${def.name}  攻${atkOf(u)}  血${Math.ceil(u.hp)}/${u.maxHp}${def.desc ? '  · ' + def.desc : ''}`);
    });
    view.refresh({ ...u, atk: atkOf(u), level: undefined });
    this.enemies[slot] = u;
    return u;
  }

  private async onWaveCleared() {
    this.busy = true;
    this.deselect();
    await wait(this, 300);
    await this.discardHand();
    const boss = isBossWave(this.wave);
    this.liveAllies().forEach((a, i) => this.time.delayedCall(i * 90, () => a.view.act('cheer')));
    await this.banner(boss ? '首领已被击败！' : `第 ${this.wave} 波 胜利！`, '#7dff7a');

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
    for (const a of this.liveAllies()) {
      a.shield = 0;
      this.refreshUnit(a);
    }
    await this.drawCards(this.handSize);
    this.busy = false;
    this.hint.setText('点击卡牌查看并打出，打完后点「结束回合」');
    this.refreshHud();
  }

  private async endTurn() {
    if (this.busy || this.over) return;
    this.busy = true;
    this.deselect();
    this.hint.setText('');
    this.refreshHud();
    await this.discardHand();

    for (const a of this.liveAllies()) {
      if (this.liveEnemies().length === 0) break;
      if (a.stun > 0) {
        a.stun--;
        this.floatText(a.view.x, a.view.y - 20, '眩晕', '#c0c0ff', 16);
        this.refreshUnit(a);
        await a.view.act('stun');
        await wait(this, 200);
        continue;
      }
      await this.allyAct(a);
      await wait(this, 120);
    }
    if (this.liveEnemies().length === 0) return this.onWaveCleared();

    await this.tickBurn();
    if (this.liveEnemies().length === 0) return this.onWaveCleared();

    await this.banner('敌方回合', '#ff8a7a', 30);
    for (const e of this.liveEnemies()) {
      if (this.over) return;
      if (e.dead) continue;
      if (e.stun > 0) {
        e.stun--;
        this.floatText(e.view.x, e.view.y - 20, '眩晕', '#c0c0ff', 16);
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
    };
    view.portrait.setInteractive();
    view.portrait.on('pointerover', () => {
      if (!this.selected) this.hint.setText(`${def.name} ${'★'.repeat(u.level)}  攻${atkOf(u)}  血${Math.ceil(u.hp)}/${u.maxHp} · ${def.desc}`);
    });
    this.allies[slot] = u;
    this.applyLevel(u);
    this.refreshUnit(u);
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
  private async castSpell(id: string, target: Unit | null) {
    const spell = SPELLS[id];
    if (!spell) return;
    const sp = this.spellPower;
    const origin = { x: 270, y: 780 };
    for (const effect of spell.effects ?? []) {
      switch (effect.kind) {
        case 'damage_single': {
          if (!target) break;
          await this.playSkillVisual(effect.visual ?? 'fire', origin, target.view, 0xff6a1a, 14);
          if (effect.visual === undefined) this.burst(target.view.x, target.view.y, 0xff8a2a);
          this.damage(target, effect.amount + sp);
          if (effect.stun && !target.dead) {
            target.stun = effect.stun;
            this.floatText(target.view.x, target.view.y - 50, '冰冻！', '#9fe3ff', 18);
            this.refreshUnit(target);
          }
          break;
        }
        case 'execute': {
          if (!target) break;
          await this.playSkillVisual(effect.visual ?? 'projectile', origin, target.view, 0xd02020, 10);
          const low = target.hp <= target.maxHp * (effect.threshold ?? 0.5);
          if (low) this.floatText(target.view.x, target.view.y - 50, '斩杀！', '#ff4040', 26);
          this.damage(target, (low ? effect.bonus : effect.amount) + sp);
          break;
        }
        case 'damage_all': {
          const targets = this.liveEnemies();
          await Promise.all(targets.map((e) => this.playSkillVisual(effect.visual ?? 'ice', origin, e.view, spell.color)));
          targets.forEach((e) => this.damage(e, effect.amount + sp));
          break;
        }
        case 'chain': {
          let from: { x: number; y: number } = origin;
          for (let i = 0; i < effect.hits; i++) {
            const pool = this.liveEnemies();
            if (pool.length === 0) break;
            const t = Phaser.Utils.Array.GetRandom(pool) as Unit;
            await this.playSkillVisual(effect.visual ?? 'lightning', from, t.view, spell.color);
            this.damage(t, effect.amount + sp);
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
    u.view.refresh({ hp: u.hp, maxHp: u.maxHp, atk: atkOf(u), shield: u.shield, stun: u.stun, level: u.side === 'ally' ? u.level : undefined });
  }

  private damage(u: Unit, amount: number) {
    if (u.dead) return 0;
    let dmg = Math.max(1, Math.round(amount) - u.armor);
    if (u.shield > 0) {
      const absorbed = Math.min(u.shield, dmg);
      u.shield -= absorbed;
      dmg -= absorbed;
      if (absorbed > 0) this.floatText(u.view.x + 20, u.view.y - 10, `🛡-${absorbed}`, '#9fe3ff', 16);
    }
    u.hp -= dmg;
    if (dmg > 0) this.floatText(u.view.x, u.view.y - 20, `-${dmg}`, u.side === 'enemy' ? '#ffd040' : '#ff5050', u.boss ? 28 : 22);
    u.view.hitFlash();
    this.refreshUnit(u);
    if (u.hp <= 0) this.kill(u);
    return dmg;
  }

  /** Apply (or refresh) a burn: lasts `turns` rounds; if already burning the per-turn damage doubles. */
  private applyBurn(u: Unit, dmg: number, turns: number) {
    if (u.dead) return;
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
      this.damage(u, u.burn.dmg);
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

  private kill(u: Unit) {
    u.dead = true;
    if (u.side === 'ally') this.allies[u.slot] = null;
    else this.enemies[u.slot] = null;
    u.view.setTargetable(false);
    u.view.portrait.disableInteractive();
    if (u.boss) this.cameras.main.shake(500, 0.015);
    if (u.boss && u.side === 'enemy') this.bossKills++;
    this.burst(u.view.x, u.view.y, u.side === 'enemy' ? 0x8aff8a : 0xff4a4a, 18);
    const has3d = u.view.hasModel;
    if (has3d) u.view.act('die');
    this.tweens.add({
      targets: [u.view, u.label].filter(Boolean),
      alpha: 0,
      scale: has3d ? 1 : 0.3,
      angle: has3d ? 0 : u.side === 'enemy' ? 30 : -30,
      duration: has3d ? 300 : 400,
      delay: has3d ? 650 : 150,
      onComplete: () => {
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
    const dmg = Math.round(n);
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

  private async projectile(from: { x: number; y: number }, to: { x: number; y: number }, color: number, size = 8, animation: 'attack' | 'cast' | 'cheer' = 'attack') {
    // Units wind up a throw / cast and release the projectile on the impact frame.
    if (from instanceof UnitView) await from.act(animation);
    const p = this.add.circle(from.x, from.y, size, color).setDepth(30);
    const glow = this.add.circle(from.x, from.y, size * 2, color, 0.35).setDepth(29);
    await tweenP(this, { targets: [p, glow], x: to.x, y: to.y, duration: 260, ease: 'Quad.in' });
    p.destroy();
    glow.destroy();
  }

  private burst(x: number, y: number, color: number, count = 10) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = 30 + Math.random() * 40;
      const s = this.add.circle(x, y, 3 + Math.random() * 4, color).setDepth(35);
      this.tweens.add({ targets: s, x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, alpha: 0, scale: 0.2, duration: 450, onComplete: () => s.destroy() });
    }
  }

  private async iceShards(target: { x: number; y: number }) {
    const shards = [];
    for (let i = 0; i < 4; i++) {
      const s = this.add.rectangle(target.x + (Math.random() - 0.5) * 50, target.y - 200 - i * 30, 6, 22, 0xbfeaff).setDepth(30).setAngle(15);
      shards.push(tweenP(this, { targets: s, y: target.y, duration: 260 + i * 40, ease: 'Quad.in' }).then(() => s.destroy()));
    }
    await Promise.all(shards);
    this.burst(target.x, target.y, 0x9fe3ff, 8);
  }

  private lightning(from: { x: number; y: number }, to: { x: number; y: number }) {
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
    const atk = atkOf(a);
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
          const dealt = this.damage(t, atk * (action.ratio ?? 1) + bonus);
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
            this.damage(t, atk * (action.ratio ?? 1) + bonus);
          }
          break;
        }
        case 'attack_all': {
          const targets = this.liveEnemies().slice(0, action.maxTargets ?? 99);
          await present(action, targets, 'projectile');
          targets.forEach((t, i) => this.damage(t, atk * (action.ratio ?? 1) * Math.pow(1 - (action.decay ?? 0), i)));
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
      return this.damage(target, atkOf(e) * mult);
    }
    await this.projectile(e.view, BASE_POS, 0xff4030, 9);
    this.damageBase(atkOf(e) * mult);
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
        if (t2) this.damage(t2, atkOf(e) * (p.cleaveRatio ?? 0.6));
        break;
      }
      case 'boss_dragon': {
        if (e.turns % 3 === 0) {
          this.floatText(e.view.x, e.view.y + 80, '冰霜吐息！', '#9fe3ff', 26);
          await e.view.act('cast');
          const allies = this.liveAllies();
          await Promise.all(allies.map((a) => this.iceShards(a.view)));
          allies.forEach((a) => this.damage(a, atkOf(e) * (p.aoeRatio ?? 0.7)));
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
          allies.forEach((a) => this.damage(a, atkOf(e) * (p.aoeRatio ?? 0.5)));
          const frozen = this.pickAllyTarget();
          if (frozen) {
            frozen.stun = p.stunTurns ?? 1;
            this.refreshUnit(frozen);
          }
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
            this.damage(a, atkOf(e) * (p.aoeRatio ?? 0.5));
          });
          await this.projectile(e.view, BASE_POS, 0x8aff4a, 14);
          this.damageBase(p.aoeBaseDamage ?? 8);
        } else {
          const allies = this.liveAllies();
          const strongest = allies.length ? allies.reduce((x, y) => (atkOf(y) > atkOf(x) ? y : x)) : null;
          const dealt = await this.enemyHit(e, strongest, 1.4);
          if (p.lifesteal && dealt > 0) this.healUnit(e, Math.round(dealt * p.lifesteal));
        }
        break;
      }
      default:
        await this.enemyHit(e, this.pickAllyTarget());
    }
  }

  // ---------------------------------------------------------------- rewards

  private rollCard() {
    const r = Math.random();
    const rarity = r < 0.5 ? 'common' : r < 0.85 ? 'rare' : 'epic';
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
      this.advance();
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
