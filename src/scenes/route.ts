import Phaser from 'phaser';
import { CARDS, Rarity } from '../data';
import { RELICS, ROUTE_INFO, RouteKind, SHOP_PRICE, randomRelics } from '../run';
import { CardView, txt } from '../ui';

/** What the between-wave screens may change in the run. */
export interface RouteHost {
  scene: Phaser.Scene;
  gold: number;
  readonly relics: string[];
  readonly deck: string[];
  addRelic(id: string): void;
  healBase(n: number): void;
  hurtBase(n: number): void;
  raiseBaseMax(n: number): void;
  healHeroes(): void;
  /** Name of the hero that gained a star, or null when none could. */
  starUpRandom(): string | null;
  fillRage(): void;
  rollCard(rarity?: Rarity): string;
  refreshHud(): void;
}

const W = 540;
const H = 960;

function overlay(scene: Phaser.Scene, title: string, sub = '') {
  const layer = scene.add.container(0, 0).setDepth(100);
  layer.add(scene.add.rectangle(0, 0, W, H, 0x000000, 0.78).setOrigin(0).setInteractive());
  layer.add(txt(scene, W / 2, 150, title, 34, '#ffcf4a', 6));
  if (sub) layer.add(txt(scene, W / 2, 192, sub, 15, '#e8dcc0', 3).setWordWrapWidth(480));
  return layer;
}

function panel(scene: Phaser.Scene, x: number, y: number, w: number, h: number, color: number) {
  const g = scene.add.graphics();
  g.fillStyle(0x23160c, 1).fillRoundedRect(x - w / 2 - 5, y - h / 2 - 5, w + 10, h + 10, 14);
  g.fillStyle(color, 1).fillRoundedRect(x - w / 2, y - h / 2, w, h, 12);
  g.lineStyle(3, 0xf3d68a, 1).strokeRoundedRect(x - w / 2, y - h / 2, w, h, 12);
  return g;
}

/** A tappable row: panel + icon + title + description. */
function choiceRow(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, y: number, icon: string, title: string, desc: string, color: number, onPick: () => void, enabled = true) {
  const item = scene.add.container(W / 2, y);
  item.add(panel(scene, 0, 0, 440, 96, enabled ? color : 0x3a3a3a));
  item.add(txt(scene, -170, 0, icon, 42));
  item.add(txt(scene, 20, -20, title, 22, enabled ? '#ffeec2' : '#999999', 4).setOrigin(0.5));
  item.add(txt(scene, 20, 18, desc, 13, enabled ? '#f0e4c8' : '#888888', 3).setWordWrapWidth(300));
  const hit = scene.add.rectangle(0, 0, 450, 106, 0, 0.001);
  item.add(hit);
  layer.add(item);
  item.setAlpha(0).setScale(0.8);
  scene.tweens.add({ targets: item, alpha: 1, scale: 1, duration: 260, ease: 'Back.out', delay: Math.max(0, y - 300) * 0.6 });
  if (enabled) {
    hit.setInteractive({ useHandCursor: true });
    hit.on('pointerover', () => item.setScale(1.03));
    hit.on('pointerout', () => item.setScale(1));
    hit.on('pointerdown', onPick);
  }
  return item;
}

function leaveButton(scene: Phaser.Scene, layer: Phaser.GameObjects.Container, label: string, onClick: () => void, y = 860) {
  const b = txt(scene, W / 2, y, label, 22, '#c0b090', 4).setInteractive({ useHandCursor: true });
  b.on('pointerdown', onClick);
  layer.add(b);
}

// ---------------------------------------------------------------- route map

/** Pick the next node. The strip at the top shows how far the boss is. */
export function chooseRoute(host: RouteHost, options: RouteKind[], wave: number, bossIn: number): Promise<RouteKind> {
  const { scene } = host;
  return new Promise((resolve) => {
    const layer = overlay(scene, '选择前进路线', `下一站：第 ${wave} 波 · 💰 ${host.gold}`);
    // path strip: upcoming waves up to the boss
    const steps = Math.min(bossIn, 5);
    const x0 = W / 2 - ((steps - 1) * 70) / 2;
    const line = scene.add.graphics();
    line.lineStyle(4, 0x8a6a3a, 1).lineBetween(x0, 250, x0 + (steps - 1) * 70, 250);
    layer.add(line);
    for (let i = 0; i < steps; i++) {
      const boss = i === bossIn - 1;
      const dot = scene.add.circle(x0 + i * 70, 250, boss ? 18 : i === 0 ? 14 : 9, boss ? 0x9a2ad8 : i === 0 ? 0xffcf4a : 0x6a5236).setStrokeStyle(3, 0xf3d68a);
      layer.add(dot);
      if (boss) layer.add(txt(scene, dot.x, 250, '👹', 18));
      layer.add(txt(scene, dot.x, 282, boss ? '首领' : `${wave + i}`, 12, '#d8ccb0', 3));
    }
    options.forEach((kind, i) => {
      const info = ROUTE_INFO[kind];
      choiceRow(scene, layer, 380 + i * 130, info.icon, info.name, info.desc, info.color, () => {
        layer.destroy();
        resolve(kind);
      });
    });
  });
}

// ---------------------------------------------------------------- relic pick

export function pickRelic(host: RouteHost, count: number, title = '选择一件遗物'): Promise<void> {
  const { scene } = host;
  const ids = randomRelics(host.relics, count);
  if (ids.length === 0) return Promise.resolve();
  return new Promise((resolve) => {
    const layer = overlay(scene, title, '遗物整局生效');
    ids.forEach((id, i) => {
      const r = RELICS[id];
      choiceRow(scene, layer, 330 + i * 130, r.icon, r.name, r.desc, 0x5a3a7a, () => {
        host.addRelic(id);
        layer.destroy();
        resolve();
      });
    });
    leaveButton(scene, layer, '跳过 ›', () => {
      layer.destroy();
      resolve();
    }, 780);
  });
}

// ---------------------------------------------------------------- camp

export function runCamp(host: RouteHost): Promise<void> {
  const { scene } = host;
  return new Promise((resolve) => {
    const layer = overlay(scene, '🔥 营火', '部落勇士围坐在篝火旁……选择一项');
    const done = (msg: string) => {
      layer.destroy();
      const t = txt(scene, W / 2, 420, msg, 26, '#ffcf4a', 6).setDepth(101);
      scene.tweens.add({ targets: t, alpha: 0, y: 380, delay: 900, duration: 400, onComplete: () => (t.destroy(), resolve()) });
    };
    choiceRow(scene, layer, 330, '😴', '休息', '全体英雄回满生命\n大本营 +20', 0x7a4a1a, () => {
      host.healHeroes();
      host.healBase(20);
      done('精力充沛！');
    });
    choiceRow(scene, layer, 460, '⚒️', '锻造', '随机一名英雄 +1 星\n（无英雄时大本营上限 +15）', 0x6a5a2a, () => {
      const name = host.starUpRandom();
      if (!name) host.raiseBaseMax(15);
      done(name ? `${name} 升星！` : '城墙加固！');
    });
    choiceRow(scene, layer, 590, '🧘', '冥想', '全体英雄怒气充满\n下一战开场即可释放大招', 0x4a3a7a, () => {
      host.fillRage();
      done('怒火在燃烧！');
    });
  });
}

// ---------------------------------------------------------------- shop

export function runShop(host: RouteHost): Promise<void> {
  const { scene } = host;
  return new Promise((resolve) => {
    const layer = overlay(scene, '🛒 地精商店', '');
    const goldText = txt(scene, W / 2, 192, '', 18, '#ffd700', 4);
    layer.add(goldText);
    const items: { refresh: () => void }[] = [];
    const refreshAll = () => {
      goldText.setText(`💰 ${host.gold}`);
      items.forEach((i) => i.refresh());
    };
    const rarities: Rarity[] = ['common', 'rare', 'epic'];
    const cards = rarities.map((r) => host.rollCard(r));
    if (Math.random() < 0.35) cards[2] = 'dragon_strike';
    cards.forEach((id, i) => {
      if (!CARDS[id]) return;
      const x = W / 2 + (i - 1) * 165;
      const price = id === 'dragon_strike' ? 120 : SHOP_PRICE[CARDS[id].rarity];
      const cv = new CardView(scene, x, 340, id).setScale(1.1);
      cv.hit.disableInteractive();
      const tag = txt(scene, x, 462, `💰 ${price}`, 18, '#ffd700', 4);
      const hit = scene.add.rectangle(x, 380, 150, 230, 0, 0.001).setInteractive({ useHandCursor: true });
      layer.add([cv, tag, hit]);
      let sold = false;
      hit.on('pointerdown', () => {
        if (sold || host.gold < price) return;
        host.gold -= price;
        host.deck.push(id);
        sold = true;
        tag.setText('已购买');
        cv.setAlpha(0.4);
        refreshAll();
      });
      items.push({ refresh: () => !sold && tag.setColor(host.gold >= price ? '#ffd700' : '#886644') });
    });
    const relic = randomRelics(host.relics, 1)[0];
    if (relic) {
      const r = RELICS[relic];
      let sold = false;
      const row = choiceRow(scene, layer, 600, r.icon, `${r.name}  💰 ${SHOP_PRICE.relic}`, r.desc, 0x5a3a7a, () => {
        if (sold || host.gold < SHOP_PRICE.relic) return;
        host.gold -= SHOP_PRICE.relic;
        host.addRelic(relic);
        sold = true;
        row.setAlpha(0.4);
        refreshAll();
      });
      items.push({ refresh: () => !sold && row.setAlpha(host.gold >= SHOP_PRICE.relic ? 1 : 0.6) });
    }
    let healed = false;
    const heal = choiceRow(scene, layer, 720, '🏰', `修缮城墙  💰 ${SHOP_PRICE.heal}`, '大本营恢复 20 点生命', 0x2a6a3a, () => {
      if (healed || host.gold < SHOP_PRICE.heal) return;
      host.gold -= SHOP_PRICE.heal;
      host.healBase(20);
      healed = true;
      heal.setAlpha(0.4);
      refreshAll();
    });
    items.push({ refresh: () => !healed && heal.setAlpha(host.gold >= SHOP_PRICE.heal ? 1 : 0.6) });
    refreshAll();
    leaveButton(scene, layer, '离开商店 ›', () => {
      layer.destroy();
      host.refreshHud();
      resolve();
    });
  });
}

// ---------------------------------------------------------------- events

interface EventChoice {
  icon: string;
  title: string;
  desc: string;
  can?: (h: RouteHost) => boolean;
  run: (h: RouteHost) => Promise<string> | string;
}

const EVENTS: { title: string; text: string; choices: EventChoice[] }[] = [
  {
    title: '🗿 神秘祭坛',
    text: '一座刻满符文的古老祭坛在低语：以鲜血换取力量……',
    choices: [
      { icon: '🩸', title: '献祭', desc: '大本营 -15，获得一件遗物', run: async (h) => (h.hurtBase(15), await pickRelic(h, 3, '祭坛的馈赠'), '契约达成') },
      { icon: '🚶', title: '离开', desc: '什么也不会发生', run: () => '你转身离去' },
    ],
  },
  {
    title: '👺 流浪地精',
    text: '一个背着大包的地精拦住去路：“好东西！便宜卖！”',
    choices: [
      { icon: '💰', title: '购买神秘卡牌', desc: '花费 40 金币，获得一张随机史诗卡', can: (h) => h.gold >= 40, run: (h) => (h.gold -= 40, h.deck.push(h.rollCard('epic')), '获得史诗卡牌！') },
      { icon: '🗡️', title: '抢劫他', desc: '获得 50 金币，但大本营 -10', run: (h) => (h.gold += 50, h.hurtBase(10), '地精尖叫着逃走了') },
    ],
  },
  {
    title: '👻 先祖之灵',
    text: '篝火中浮现出先祖的身影，他愿意赐予你祝福。',
    choices: [
      { icon: '💢', title: '战意', desc: '全体英雄怒气充满', run: (h) => (h.fillRage(), '怒火在燃烧！') },
      { icon: '⭐', title: '传承', desc: '随机一名英雄 +1 星', run: (h) => h.starUpRandom() ? '英雄升星！' : '场上没有英雄……' },
    ],
  },
  {
    title: '📦 遗落的宝箱',
    text: '路边有一只上锁的宝箱，似乎有机关。',
    choices: [
      { icon: '🔓', title: '撬开', desc: '60%：获得 60 金币\n40%：陷阱，大本营 -12', run: (h) => (Math.random() < 0.6 ? (h.gold += 60, '获得 60 金币！') : (h.hurtBase(12), '中了陷阱！')) },
      { icon: '🚶', title: '无视', desc: '安全第一', run: () => '你继续前进' },
    ],
  },
];

export function runEvent(host: RouteHost): Promise<void> {
  const { scene } = host;
  const ev = Phaser.Utils.Array.GetRandom(EVENTS) as (typeof EVENTS)[number];
  return new Promise((resolve) => {
    const layer = overlay(scene, ev.title, ev.text);
    ev.choices.forEach((c, i) => {
      const ok = !c.can || c.can(host);
      choiceRow(scene, layer, 360 + i * 130, c.icon, c.title, c.desc, 0x2a4a8a, async () => {
        layer.setVisible(false);
        const msg = await c.run(host);
        layer.destroy();
        host.refreshHud();
        const t = txt(scene, W / 2, 420, msg, 26, '#ffcf4a', 6).setDepth(101);
        scene.tweens.add({ targets: t, alpha: 0, y: 380, delay: 900, duration: 400, onComplete: () => (t.destroy(), resolve()) });
      }, ok);
    });
  });
}
