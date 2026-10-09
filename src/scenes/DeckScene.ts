import Phaser from 'phaser';
import { CARDS, SPELLS, UNITS } from '../data';
import { COPY_LIMIT, DECK_MAX, DECK_MIN, deckError, getDeck, setDeck } from '../meta';
import { STARTING_DECK } from '../data';
import { addBackground } from '../three/battlefield';
import { CardView, button, txt } from '../ui';

const COLS = 5;
const ORDER = Object.values(CARDS)
  .sort((a, b) => (a.kind === b.kind ? a.cost - b.cost : a.kind === 'unit' ? -1 : 1))
  .map((c) => c.id);

/** Starting-deck builder: +/- copies of each card within the size and per-rarity copy limits. */
export class DeckScene extends Phaser.Scene {
  private deck: string[] = [];
  private layer!: Phaser.GameObjects.Container;
  private hint!: Phaser.GameObjects.Text;

  constructor() {
    super('deck');
  }

  create() {
    const { width, height } = this.scale;
    addBackground(this);
    this.add.rectangle(0, 0, width, height, 0x0a0604, 0.78).setOrigin(0);
    this.deck = getDeck();
    txt(this, width / 2, 42, '卡组编辑', 34, '#ffcf4a', 6);
    const back = txt(this, 52, 42, '‹ 返回', 18, '#e8dcc0', 4).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.scene.start('menu'));
    this.hint = txt(this, width / 2, 705, '点击卡牌查看效果', 14, '#f3e3c0', 4).setWordWrapWidth(480);
    this.layer = this.add.container(0, 0);
    this.draw();
    this.cameras.main.fadeIn(200);
  }

  private count(id: string) {
    return this.deck.filter((c) => c === id).length;
  }

  private draw() {
    const { width } = this.scale;
    this.layer.removeAll(true);
    const L = this.layer;
    const units = this.deck.filter((id) => CARDS[id].kind === 'unit').length;
    const avg = this.deck.reduce((s, id) => s + CARDS[id].cost, 0) / Math.max(1, this.deck.length);
    const err = deckError(this.deck);
    L.add(txt(this, width / 2, 84, `${this.deck.length} 张（${DECK_MIN}–${DECK_MAX}）· 英雄 ${units} · 法术 ${this.deck.length - units} · 平均费用 ${avg.toFixed(1)}`, 15, '#ffeec2', 4));
    L.add(txt(this, width / 2, 108, '同名上限：普通 3 · 稀有 2 · 史诗 1', 12, '#a09070', 3));

    ORDER.forEach((id, i) => {
      const x = width / 2 + ((i % COLS) - (COLS - 1) / 2) * 100;
      const y = 200 + Math.floor(i / COLS) * 172;
      const n = this.count(id);
      const limit = COPY_LIMIT[CARDS[id].rarity];
      const cv = new CardView(this, x, y, id).setScale(0.72).setAlpha(n > 0 ? 1 : 0.55);
      cv.hit.on('pointerdown', () => this.hint.setText(this.describe(id)));
      L.add(cv);
      L.add(txt(this, x, y + 68, `${n}/${limit}`, 15, n > 0 ? '#ffd700' : '#a09070', 4));
      const minus = txt(this, x - 32, y + 68, '－', 22, n > 0 ? '#ff8a7a' : '#5a4a3a', 4).setInteractive({ useHandCursor: true });
      const plus = txt(this, x + 32, y + 68, '＋', 22, n < limit && this.deck.length < DECK_MAX ? '#7dff7a' : '#5a4a3a', 4).setInteractive({ useHandCursor: true });
      minus.on('pointerdown', () => this.change(id, -1));
      plus.on('pointerdown', () => this.change(id, 1));
      L.add([minus, plus]);
    });

    L.add(txt(this, width / 2, 745, err ? `⚠ ${err}` : '✓ 卡组可用', 15, err ? '#ff7a6a' : '#7dff7a', 4));
    const box = this.add.container(0, 0);
    L.add(box);
    button(this, box, width / 2 - 125, 820, 150, 54, '恢复默认', () => {
      this.deck = [...STARTING_DECK];
      this.draw();
    }).draw(false);
    button(this, box, width / 2 + 45, 820, 150, 54, '保存', () => {
      if (setDeck(this.deck)) this.hint.setText('卡组已保存，下次远征生效');
    }).draw(!err);
    button(this, box, width / 2 + 180, 820, 100, 54, '出征', () => {
      if (setDeck(this.deck)) this.scene.start('battle');
    }).draw(!err);
  }

  private change(id: string, d: number) {
    const n = this.count(id);
    if (d > 0 && (n >= COPY_LIMIT[CARDS[id].rarity] || this.deck.length >= DECK_MAX)) return;
    if (d < 0) {
      if (n === 0) return;
      this.deck.splice(this.deck.indexOf(id), 1);
    } else {
      this.deck.push(id);
    }
    this.hint.setText(this.describe(id));
    this.draw();
  }

  private describe(id: string) {
    const def = CARDS[id];
    if (def.kind === 'unit') {
      const u = UNITS[def.ref];
      return `【${u.name}】${def.cost} 费 · 攻${u.atk} 血${u.hp} · ${u.desc}`;
    }
    const s = SPELLS[def.ref];
    return `【${s.name}】${def.cost} 费 · ${s.desc}`;
  }
}
