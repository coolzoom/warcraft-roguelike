import Phaser from 'phaser';
import { BOSS_EVERY } from '../data';
import { txt } from '../ui';

export class MenuScene extends Phaser.Scene {
  private bg!: Phaser.GameObjects.TileSprite;

  constructor() {
    super('menu');
  }

  update() {
    this.bg.tilePositionY -= 0.4;
  }

  create() {
    const { width, height } = this.scale;
    this.bg = this.add.tileSprite(0, 0, width, height, 'bg_loop').setOrigin(0);
    this.bg.tileScaleX = this.bg.tileScaleY = width / this.textures.get('bg').getSourceImage().width;
    this.add.rectangle(0, 0, width, height, 0x000000, 0.45).setOrigin(0);

    const heroes = ['p_orc', 'p_mage', 'p_dwarf'];
    heroes.forEach((h, i) => {
      const x = width / 2 + (i - 1) * 150;
      const img = this.add.image(x, 330, h).setDisplaySize(140, 140);
      this.add.rectangle(x, 330, 144, 144).setStrokeStyle(4, 0xd99a1e);
      this.tweens.add({ targets: img, y: 320, duration: 1200 + i * 200, yoyo: true, repeat: -1, ease: 'Sine.inOut' });
    });

    txt(this, width / 2, 140, '部落远征', 64, '#ffcf4a', 8);
    txt(this, width / 2, 205, 'Horde Expedition · 肉鸽卡牌', 20, '#f3e3c0', 4);

    const lines = [
      '打出卡牌召唤英雄、释放法术',
      '结束回合后英雄自动战斗',
      '每清空一波敌人，选择奖励继续前进',
      `每 ${BOSS_EVERY} 波遭遇强大的 BOSS`,
      '重复召唤同名英雄可升星',
    ];
    lines.forEach((l, i) => txt(this, width / 2, 480 + i * 34, `· ${l}`, 17, '#e8dcc0', 4));

    const best = Number(localStorage.getItem('horde_best') || 0);
    if (best > 0) txt(this, width / 2, 680, `最远到达：第 ${best} 波`, 18, '#9fe3ff', 4);

    const btn = this.add.container(width / 2, 770);
    const g = this.add.graphics();
    g.fillStyle(0x7a1a10, 1).fillRoundedRect(-120, -36, 240, 72, 16);
    g.lineStyle(4, 0xffcf4a, 1).strokeRoundedRect(-120, -36, 240, 72, 16);
    const label = txt(this, 0, 0, '开始远征', 30, '#ffeec2', 6);
    const hit = this.add.rectangle(0, 0, 240, 72, 0, 0.001).setInteractive({ useHandCursor: true });
    btn.add([g, label, hit]);
    this.tweens.add({ targets: btn, scale: 1.06, duration: 700, yoyo: true, repeat: -1 });
    hit.on('pointerdown', () => {
      this.cameras.main.fadeOut(300, 0, 0, 0);
      this.cameras.main.once('camerafadeoutcomplete', () => this.scene.start('battle'));
    });

    txt(this, width / 2, height - 24, '美术：AI 生成立绘 · 图标 game-icons.net (CC BY 3.0)', 12, '#a09070', 3);
  }
}
