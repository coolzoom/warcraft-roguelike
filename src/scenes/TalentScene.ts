import Phaser from 'phaser';
import { BRANCHES, Branch, TALENT, TALENTS, canUpgrade, rank, resetTalents, spentPoints, talentPoints, upgrade } from '../meta';
import { addBackground } from '../three/battlefield';
import { button, txt } from '../ui';

const ROWS: { branch: Branch; ids: string[]; y: number }[] = [
  { branch: 'base', ids: ['b_wall', 'b_repair', 'b_spikes'], y: 168 },
  { branch: 'energy', ids: ['e_surge', 'e_well', 'e_draw'], y: 296 },
  { branch: 'spell', ids: ['s_power', 's_echo'], y: 424 },
  { branch: 'unit', ids: ['u_grunt', 'u_troll', 'u_tauren', 'u_mage'], y: 552 },
  { branch: 'unit', ids: ['u_dwarf', 'u_elf', 'u_elite'], y: 660 },
];

/** Permanent talent tree: spend points earned on runs, refund any time to try another build. */
export class TalentScene extends Phaser.Scene {
  private layer!: Phaser.GameObjects.Container;
  private selected = TALENTS[0].id;

  constructor() {
    super('talents');
  }

  create() {
    const { width, height } = this.scale;
    addBackground(this);
    this.add.rectangle(0, 0, width, height, 0x0a0604, 0.78).setOrigin(0);
    this.layer = this.add.container(0, 0);
    this.draw();
    this.cameras.main.fadeIn(200);
  }

  private draw() {
    const { width } = this.scale;
    this.layer.removeAll(true);
    const L = this.layer;
    L.add(txt(this, width / 2, 46, '天赋', 36, '#ffcf4a', 6));
    L.add(txt(this, width / 2, 92, `可用天赋点 ${talentPoints()}   ·   已投入 ${spentPoints()}`, 17, '#ffeec2', 4));
    const back = txt(this, 52, 46, '‹ 返回', 18, '#e8dcc0', 4).setInteractive({ useHandCursor: true });
    back.on('pointerdown', () => this.scene.start('menu'));
    L.add(back);

    const headed = new Set<Branch>();
    for (const row of ROWS) {
      const b = BRANCHES[row.branch];
      if (!headed.has(row.branch)) {
        headed.add(row.branch);
        const hy = row.y - 50;
        L.add(this.add.rectangle(width / 2, hy, width - 40, 2, b.color, 0.6));
        L.add(txt(this, width / 2, hy, `  ${b.name}  `, 15, '#ffffff', 4).setBackgroundColor('#1a120c'));
      }
      row.ids.forEach((id, i) => this.node(id, width / 2 + (i - (row.ids.length - 1) / 2) * 118, row.y, b.color));
    }
    this.detail();

    const reset = this.add.container(0, 0);
    L.add(reset);
    button(this, reset, width / 2 - 95, 905, 170, 54, '重置天赋', () => {
      resetTalents();
      this.draw();
    }).draw(false);
    button(this, reset, width / 2 + 95, 905, 170, 54, '开始远征', () => this.scene.start('battle')).draw(true);
  }

  private node(id: string, x: number, y: number, color: number) {
    const t = TALENT[id];
    const r = rank(id);
    const sel = id === this.selected;
    const g = this.add.graphics();
    g.fillStyle(r > 0 ? Phaser.Display.Color.IntegerToColor(color).darken(40).color : 0x221810, 1).fillCircle(x, y, 32);
    g.lineStyle(sel ? 5 : 3, sel ? 0xffe066 : r > 0 ? color : 0x6a5236, 1).strokeCircle(x, y, 32);
    if (canUpgrade(id)) g.lineStyle(2, 0xffe066, 0.7).strokeCircle(x, y, 38);
    const glyph = txt(this, x, y, t.glyph, 26).setAlpha(r > 0 ? 1 : 0.55);
    const pips = txt(this, x, y + 42, `${r}/${t.max}`, 13, r === t.max ? '#ffd700' : '#e8dcc0', 3);
    const name = txt(this, x, y + 60, t.name, 12, '#cbbd9c', 3);
    const hit = this.add.circle(x, y, 40, 0, 0.001).setInteractive({ useHandCursor: true });
    hit.on('pointerdown', () => {
      this.selected = id;
      this.draw();
    });
    this.layer.add([g, glyph, pips, name, hit]);
  }

  private detail() {
    const { width } = this.scale;
    const t = TALENT[this.selected];
    const r = rank(t.id);
    const L = this.layer;
    const g = this.add.graphics();
    g.fillStyle(0x1e130a, 0.95).fillRoundedRect(30, 730, width - 60, 130, 14);
    g.lineStyle(3, BRANCHES[t.branch].color, 1).strokeRoundedRect(30, 730, width - 60, 130, 14);
    L.add(g);
    L.add(txt(this, 60, 756, `${t.glyph} ${t.name}  ${r}/${t.max}`, 18, '#ffcf4a', 4).setOrigin(0, 0.5));
    L.add(txt(this, 60, 792, r > 0 ? `当前：${t.desc(r)}` : '尚未学习', 14, '#e8dcc0', 3).setOrigin(0, 0.5).setWordWrapWidth(300));
    L.add(txt(this, 60, 826, r < t.max ? `下一级：${t.desc(r + 1)}` : '已满级', 14, '#9fe3ff', 3).setOrigin(0, 0.5).setWordWrapWidth(300));
    const box = this.add.container(0, 0);
    L.add(box);
    if (r < t.max) {
      const b = button(this, box, width - 110, 795, 130, 56, `升级 · ${t.cost}点`, () => {
        if (upgrade(t.id)) {
          this.cameras.main.flash(150, 255, 220, 120);
          this.draw();
        }
      });
      b.draw(canUpgrade(t.id));
      b.text.setFontSize(16);
    }
  }
}
