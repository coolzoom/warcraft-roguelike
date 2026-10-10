import { BOSS_EVERY, BOSS_ORDER, ENEMIES, isBossWave } from './data';

/** Roadside visitors who appear between fights, foretell what lies ahead, then vanish. */
export type OracleKey = 'prophet' | 'raven';

export interface OracleDef {
  name: string;
  art: string;
  /** Particle colour for the entrance/exit and the speech bubble trim. */
  color: number;
  nameColor: string;
  side: 'left' | 'right';
}

export const ORACLES: Record<OracleKey, OracleDef> = {
  prophet: { name: '德莱尼先知', art: 'n_prophet', color: 0xffe08a, nameColor: '#ffe08a', side: 'right' },
  raven: { name: '乌鸦领主', art: 'n_raven', color: 0xa070ff, nameColor: '#c9a0ff', side: 'left' },
};

export interface OracleVisit {
  who: OracleKey;
  lines: string[];
}

/** Chance of an unprompted visit on an ordinary wave, and the minimum gap between visits. */
const RANDOM_CHANCE = 0.3;
const MIN_GAP = 2;

const FORETELL: Record<string, string[]> = {
  dragon: ['我看见冰霜之翼遮蔽了天空……冰霜骨龙将在下一战降临。', '它的吐息会冻结一整排战士。看到地上的红圈，就把英雄拖开！'],
  lich: ['寒冰王冠正在召唤它的仆从……霜冠巫妖就在前方。', '它会唤来食尸鬼，冻住你的战士。先用寒冰，再用烈火，蒸汽会替你清场。'],
  demon: ['空气里满是邪能的气息……恐惧魔王正在暗处窥视。', '它专吸最强战士的生命，半血后还会狂暴。把大招留到那一刻！'],
};

const PROPHET_TIPS = [
  '三名同族战士并肩作战时，羁绊之力会护佑他们。',
  '前排替后排挡下刀剑，后排的箭矢就更容易命中要害。',
  '疲惫时去营火旁歇一歇吧，圣光会抚平伤痕。',
  '命运并非注定，孩子们。每一次选择，都会改变前方的路。',
];

const RAVEN_TIPS = [
  '乌鸦告诉我：前方的路分岔了。精英那边有遗物在发光……也有死亡。嘎。',
  '我闻到了金币的味道。地精的商店就在不远处，别空着手去。',
  '你们的战士在怒吼。怒气满时点一下他们，看看会发生什么。',
  '火焰与冰霜相遇时……嘎嘎，那爆裂声真是动听。',
];

/** The boss met on the given boss wave. */
export function bossOn(wave: number) {
  const key = BOSS_ORDER[(wave / BOSS_EVERY - 1) % BOSS_ORDER.length];
  return { key, name: ENEMIES[key].name };
}

/**
 * Who (if anyone) shows up at the start of `wave`. Story beats always play: the opening, the
 * warning before each boss, and the raven's taunt after one falls; otherwise a visit is a chance roll.
 */
export function oracleFor(wave: number, lastVisit: number, elite: boolean, rnd = Math.random): OracleVisit | null {
  if (isBossWave(wave)) return null;
  if (wave === 1) {
    return { who: 'prophet', lines: ['部落的勇士们，我在圣光中看见了你们的远征。', '北方的亡灵天灾正在苏醒。每走五段路，就会有一位首领挡在前方。'] };
  }
  if (isBossWave(wave + 1)) return { who: 'prophet', lines: FORETELL[bossOn(wave + 1).key] };
  if (isBossWave(wave - 1)) {
    const next = bossOn(wave - 1 + BOSS_EVERY);
    return { who: 'raven', lines: ['哼，一位首领倒下了，可乌鸦们早已飞向别处。', `下一个等着你们的，是${next.name}。我会看着——看你们能走多远。`] };
  }
  if (elite) return { who: 'raven', lines: ['这些敌人身上有我熟悉的黑暗……是精英。打赢它们，遗物就归你们。'] };
  if (wave - lastVisit < MIN_GAP || rnd() >= RANDOM_CHANCE) return null;
  const who: OracleKey = rnd() < 0.5 ? 'prophet' : 'raven';
  const pool = who === 'prophet' ? PROPHET_TIPS : RAVEN_TIPS;
  return { who, lines: [pool[Math.floor(rnd() * pool.length)]] };
}
