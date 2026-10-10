import Phaser from 'phaser';
import { ENEMIES, SPELLS, UNITS } from '../data';
import { ORACLES } from '../oracle';
import { loadModels } from '../three/models';
import { FONT, txt } from '../ui';

const allArts = () =>
  new Set([...Object.values(UNITS).map((u) => u.art), ...Object.values(ENEMIES).map((e) => e.art), ...Object.values(ORACLES).map((o) => o.art)]);

const ICONS = ['fireball', 'frozen-orb', 'health-normal', 'axe-swing', 'lightning-storm', 'checked-shield', 'crossed-swords'];

export class BootScene extends Phaser.Scene {
  constructor() {
    super('boot');
  }

  preload() {
    const { width, height } = this.scale;
    const label = txt(this, width / 2, height / 2 - 30, '加载中...', 22, '#ffd27a');
    const bar = this.add.rectangle(width / 2 - 150, height / 2 + 10, 0, 14, 0xd99a1e).setOrigin(0, 0.5);
    this.add.rectangle(width / 2, height / 2 + 10, 304, 18).setStrokeStyle(2, 0x8a6a30);
    this.load.on('progress', (p: number) => {
      bar.width = 300 * p;
      label.setText(`加载中... ${Math.round(p * 100)}%`);
    });

    this.load.image('bg', 'assets/bg_forest.jpg');
    allArts().forEach((a) => this.load.image(a, `assets/${a}.jpg`));
    ICONS.forEach((i) => this.load.svg(`ic_${i}`, `assets/icons/${i}.svg`, { width: 128, height: 128 }));
  }

  create() {
    allArts().forEach((a) => this.makeCircle(a));
    Object.values(SPELLS).forEach((s) => this.makeSpellArt(s.id, s.icon, s.color, s.name));
    this.makeMirroredBg();
    const { width, height } = this.scale;
    txt(this, width / 2, height / 2 + 50, '召唤部落勇士...', 18, '#ffd27a');
    // Without the 3D models units fall back to their round portraits.
    loadModels()
      .catch((err) => console.warn('3D models unavailable:', err))
      .then(() => this.scene.start('menu'));
  }

  /** Round battlefield token cropped around the face of a square bust portrait. */
  private makeCircle(key: string) {
    const src = this.textures.get(key).getSourceImage() as HTMLImageElement;
    const size = 160;
    const tex = this.textures.createCanvas(`c_${key}`, size, size)!;
    const ctx = tex.getContext();
    ctx.save();
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
    ctx.clip();
    const s = src.width * 0.72;
    ctx.drawImage(src, src.width * 0.14, src.height * 0.04, s, s, 0, 0, size, size);
    ctx.restore();
    tex.refresh();
  }

  private makeSpellArt(id: string, iconKey: string, color: number, name: string) {
    const size = 160;
    const tex = this.textures.createCanvas(`art_${id}`, size, size)!;
    const ctx = tex.getContext();
    const c = Phaser.Display.Color.IntegerToColor(color);
    const grad = ctx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size * 0.75);
    grad.addColorStop(0, `rgb(${Math.min(255, c.red + 90)},${Math.min(255, c.green + 90)},${Math.min(255, c.blue + 90)})`);
    grad.addColorStop(0.5, `rgb(${c.red},${c.green},${c.blue})`);
    grad.addColorStop(1, '#120a05');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    if (this.textures.exists(iconKey)) {
      const icon = this.textures.get(iconKey).getSourceImage() as HTMLImageElement;
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 10;
      ctx.drawImage(icon, 22, 22, size - 44, size - 44);
    } else {
      ctx.fillStyle = '#fff';
      ctx.font = `bold 72px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(name[0], size / 2, size / 2);
    }
    tex.refresh();
  }

  /** Stack the background with a flipped copy so it can scroll forever without a seam. */
  private makeMirroredBg() {
    const src = this.textures.get('bg').getSourceImage() as HTMLImageElement;
    const tex = this.textures.createCanvas('bg_loop', src.width, src.height * 2)!;
    const ctx = tex.getContext();
    ctx.drawImage(src, 0, 0);
    ctx.save();
    ctx.translate(0, src.height * 2);
    ctx.scale(1, -1);
    ctx.drawImage(src, 0, 0);
    ctx.restore();
    tex.refresh();
  }
}
