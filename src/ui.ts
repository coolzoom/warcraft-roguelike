import Phaser from 'phaser';
import { CARDS, RARITY_COLOR, RARITY_STARS, SPELLS, UNITS } from './data';

export const FONT = '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';

export function txt(
  scene: Phaser.Scene,
  x: number,
  y: number,
  str: string,
  size = 16,
  color = '#ffffff',
  stroke = 4,
) {
  return scene.add
    .text(x, y, str, {
      fontFamily: FONT,
      fontSize: `${size}px`,
      fontStyle: 'bold',
      color,
      stroke: '#1a0f08',
      strokeThickness: stroke,
      align: 'center',
    })
    .setOrigin(0.5);
}

export function tweenP(scene: Phaser.Scene, cfg: Phaser.Types.Tweens.TweenBuilderConfig) {
  return new Promise<void>((resolve) => {
    scene.tweens.add({ ...cfg, onComplete: () => resolve() });
  });
}

export function wait(scene: Phaser.Scene, ms: number) {
  return new Promise<void>((resolve) => scene.time.delayedCall(ms, resolve));
}

export class UnitView extends Phaser.GameObjects.Container {
  readonly radius: number;
  private ring: Phaser.GameObjects.Arc;
  private hpFill: Phaser.GameObjects.Rectangle;
  private hpText: Phaser.GameObjects.Text;
  private atkText: Phaser.GameObjects.Text;
  private shieldText: Phaser.GameObjects.Text;
  private starText: Phaser.GameObjects.Text;
  private stunText: Phaser.GameObjects.Text;
  private targetRing: Phaser.GameObjects.Arc;
  readonly portrait: Phaser.GameObjects.Image;
  private barW: number;
  private idle?: Phaser.Tweens.Tween;

  constructor(scene: Phaser.Scene, x: number, y: number, art: string, ally: boolean, boss: boolean) {
    super(scene, x, y);
    this.radius = boss ? 62 : 36;
    const r = this.radius;
    const teamColor = ally ? 0x4aa3ff : 0xe0453a;

    const shadow = scene.add.ellipse(0, r * 0.85, r * 1.9, r * 0.6, 0x000000, 0.45);
    this.targetRing = scene.add.circle(0, 0, r + 9).setStrokeStyle(4, 0xffe066).setVisible(false);
    this.ring = scene.add.circle(0, 0, r + 3, 0x000000).setStrokeStyle(4, boss ? 0xb44dff : teamColor);
    this.portrait = scene.add.image(0, 0, `c_${art}`).setDisplaySize(r * 2, r * 2);

    this.barW = boss ? 130 : 74;
    const barY = -r - 16;
    const barBg = scene.add.rectangle(0, barY, this.barW + 4, 12, 0x140c06).setStrokeStyle(1, 0x000000);
    this.hpFill = scene.add
      .rectangle(-this.barW / 2, barY, this.barW, 8, ally ? 0x3d8bff : 0xe23b2e)
      .setOrigin(0, 0.5);
    const badge = scene.add.circle(-this.barW / 2 - 6, barY, 9, ally ? 0x2a5fa8 : 0xa8322a).setStrokeStyle(2, 0xf0e0b0);
    this.hpText = txt(scene, 0, barY, '', 10, '#ffffff', 3);
    this.shieldText = txt(scene, this.barW / 2 + 14, barY, '', 12, '#9fe3ff', 3);
    const atkBadge = scene.add.circle(r * 0.72, r * 0.68, 13, 0x2a1408).setStrokeStyle(2, 0xffd27a);
    const atkIcon = scene.add.image(r * 0.72 - 9, r * 0.68 - 9, 'ic_crossed-swords').setDisplaySize(14, 14).setTint(0xffd27a);
    this.atkText = txt(scene, r * 0.72, r * 0.68 + 1, '', 13, '#ffffff', 3);
    this.starText = txt(scene, 0, r + 10, '', 12, '#ffd700', 3);
    this.stunText = txt(scene, -r * 0.8, -r * 0.6, '💫', 18).setVisible(false);

    this.add([shadow, this.targetRing, this.ring, this.portrait, barBg, this.hpFill, badge, this.hpText, this.shieldText, atkBadge, atkIcon, this.atkText, this.starText, this.stunText]);
    scene.add.existing(this);

    this.idle = scene.tweens.add({
      targets: this.portrait,
      scaleY: this.portrait.scaleY * 1.03,
      duration: 900 + Math.random() * 400,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });
  }

  refresh(u: { hp: number; maxHp: number; atk: number; shield: number; level?: number; stun: number }) {
    const ratio = Phaser.Math.Clamp(u.hp / u.maxHp, 0, 1);
    this.scene.tweens.add({ targets: this.hpFill, width: this.barW * ratio, duration: 200 });
    this.hpText.setText(`${Math.max(0, Math.ceil(u.hp))}`);
    this.atkText.setText(`${u.atk}`);
    this.shieldText.setText(u.shield > 0 ? `🛡${u.shield}` : '');
    this.starText.setText(u.level ? '★'.repeat(u.level) : '');
    this.stunText.setVisible(u.stun > 0);
  }

  setTargetable(on: boolean) {
    this.targetRing.setVisible(on);
    if (on) {
      this.scene.tweens.add({ targets: this.targetRing, alpha: { from: 1, to: 0.3 }, duration: 400, yoyo: true, repeat: -1 });
    } else {
      this.scene.tweens.killTweensOf(this.targetRing);
      this.targetRing.setAlpha(1);
    }
  }

  hitFlash() {
    this.portrait.setTintFill(0xffffff);
    this.scene.time.delayedCall(80, () => this.portrait.setTint(0xff6060));
    this.scene.time.delayedCall(220, () => this.portrait.clearTint());
    const ox = this.x;
    this.scene.tweens.add({ targets: this, x: ox + 6, duration: 40, yoyo: true, repeat: 2, onComplete: () => (this.x = ox) });
  }

  destroy(fromScene?: boolean) {
    this.idle?.remove();
    super.destroy(fromScene);
  }
}

export const CARD_W = 100;
export const CARD_H = 148;

export class CardView extends Phaser.GameObjects.Container {
  readonly cardId: string;
  readonly hit: Phaser.GameObjects.Rectangle;
  private glow: Phaser.GameObjects.Graphics;
  private dim: Phaser.GameObjects.Graphics;
  baseY = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, cardId: string) {
    super(scene, x, y);
    this.cardId = cardId;
    const def = CARDS[cardId];
    const color = RARITY_COLOR[def.rarity];
    const w = CARD_W;
    const h = CARD_H;

    this.glow = scene.add.graphics();
    this.glow.lineStyle(6, 0xffe066, 1).strokeRoundedRect(-w / 2 - 4, -h / 2 - 4, w + 8, h + 8, 12).setVisible(false);

    const g = scene.add.graphics();
    g.fillStyle(0x000000, 0.5).fillRoundedRect(-w / 2 + 3, -h / 2 + 5, w, h, 10);
    g.fillStyle(0x23160c, 1).fillRoundedRect(-w / 2, -h / 2, w, h, 10);
    g.fillStyle(color, 1).fillRoundedRect(-w / 2 + 4, -h / 2 + 4, w - 8, h - 8, 8);

    let artKey: string;
    let name: string;
    let stats = '';
    if (def.kind === 'unit') {
      const u = UNITS[def.ref];
      artKey = u.art;
      name = u.name;
      stats = `攻${u.atk}  血${u.hp}`;
    } else {
      const s = SPELLS[def.ref];
      artKey = `art_${s.id}`;
      name = s.name;
    }
    const art = scene.add.image(0, -18, artKey).setDisplaySize(w - 14, w - 14);
    const frame = scene.add.graphics();
    frame.lineStyle(3, 0xf3d68a, 1).strokeRect(-(w - 14) / 2, -18 - (w - 14) / 2, w - 14, w - 14);

    const nameBg = scene.add.rectangle(0, 37, w - 8, 20, 0x1a0f08, 0.85);
    const nameText = txt(scene, 0, 37, name, 13, '#ffeec2', 3);
    const stars = txt(scene, 0, 58, '★'.repeat(RARITY_STARS[def.rarity]), 13, '#ffd700', 3);
    const statText = stats ? txt(scene, 0, 16, stats, 11, '#ffffff', 3) : null;

    const gem = scene.add.circle(-w / 2 + 12, -h / 2 + 12, 14, 0x1d6fd8).setStrokeStyle(3, 0xbfe2ff);
    const cost = txt(scene, -w / 2 + 12, -h / 2 + 12, `${def.cost}`, 17, '#ffffff', 4);
    const kind = txt(scene, w / 2 - 16, -h / 2 + 12, def.kind === 'unit' ? '兵' : '法', 11, '#ffeec2', 3);

    this.dim = scene.add.graphics();
    this.dim.fillStyle(0x000000, 0.55).fillRoundedRect(-w / 2, -h / 2, w, h, 10).setVisible(false);

    this.hit = scene.add.rectangle(0, 0, w, h, 0x000000, 0.001).setInteractive({ useHandCursor: true });

    const parts: Phaser.GameObjects.GameObject[] = [this.glow, g, art, frame, nameBg, nameText, stars];
    if (statText) parts.push(statText);
    parts.push(gem, cost, kind, this.dim, this.hit);
    this.add(parts);
    scene.add.existing(this);
  }

  setSelected(on: boolean) {
    this.glow.setVisible(on);
    this.scene.tweens.add({ targets: this, y: on ? this.baseY - 24 : this.baseY, scale: on ? 1.08 : 1, duration: 120 });
  }

  setPlayable(on: boolean) {
    this.dim.setVisible(!on);
  }
}
