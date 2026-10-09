/**
 * Run-level systems layered on top of the card tables: hero ultimates, elements,
 * faction synergies, relics and route events. Pure data; BattleScene applies it.
 */

export type Element = 'physical' | 'fire' | 'ice' | 'lightning' | 'arcane';

// ---------------------------------------------------------------- ultimates

export interface UltDef {
  name: string;
  color: number;
  element: Element;
  desc: string;
  /** Damage to every enemy, × attack. */
  all?: number;
  /** Random hits: count × (× attack). */
  hits?: [number, number];
  /** One hit on the front enemy, × attack. */
  front?: number;
  /** The front hit always crits. */
  crit?: boolean;
  stunAll?: number;
  freezeAll?: number;
  /** Burn per turn applied to every enemy. */
  burnAll?: number;
  healAll?: number;
  shieldAll?: number;
  /** Heal the caster for the damage dealt. */
  drain?: boolean;
}

export const RAGE_MAX = 100;

export const ULTS: Record<string, UltDef> = {
  grunt: { name: '旋风斩', color: 0xd04a20, element: 'physical', all: 1.6, desc: '对全体敌人造成 160% 攻击伤害' },
  troll: { name: '飞斧风暴', color: 0x3aa860, element: 'physical', hits: [6, 0.9], desc: '随机投出 6 把飞斧，每把 90% 攻击' },
  tauren: { name: '战争践踏', color: 0xb8883a, element: 'physical', all: 1.2, stunAll: 1, desc: '全体 120% 攻击伤害并眩晕 1 回合' },
  mage: { name: '冰封领域', color: 0x4ab8ff, element: 'ice', all: 2.2, freezeAll: 1, desc: '全体 220% 攻击冰霜伤害并冰冻' },
  dwarf: { name: '雷霆一击', color: 0xffc040, element: 'physical', front: 4, crit: true, desc: '对前排造成 400% 必定暴击' },
  elf: { name: '星辰坠落', color: 0xc8a0ff, element: 'arcane', all: 2, healAll: 14, desc: '全体 200% 攻击伤害，治疗友军 14' },
  paladin: { name: '圣光审判', color: 0xffe08a, element: 'arcane', front: 2.5, shieldAll: 12, desc: '前排 250% 伤害，全队护盾 12' },
  ranger: { name: '箭雨', color: 0x6ad070, element: 'physical', hits: [8, 0.8], desc: '8 支箭随机落下，每支 80% 攻击' },
  warlock: { name: '灵魂虹吸', color: 0x9a4ad8, element: 'fire', all: 1.6, burnAll: 4, drain: true, desc: '全体 160% 暗影烈焰并灼烧，吸取生命' },
  shaman: { name: '雷霆风暴', color: 0x8a7cf0, element: 'lightning', hits: [6, 1.1], desc: '6 道落雷，每道 110% 攻击（引爆灼烧）' },
};

const ULT_BY_SKILL: Record<string, string> = { front: 'grunt', double: 'troll', taunt_heal: 'tauren', aoe: 'mage', stun: 'dwarf', heal: 'elf', guard: 'paladin', snipe: 'ranger', drain: 'warlock', chain_attack: 'shaman' };

export function ultOf(unitKey: string, skill?: string): UltDef {
  return ULTS[unitKey] ?? ULTS[ULT_BY_SKILL[skill ?? ''] ?? 'grunt'];
}

// ---------------------------------------------------------------- elements

export const REACTIONS = {
  steam: { name: '蒸汽爆炸', color: '#ffffff', tint: 0xe8f4ff },
  overload: { name: '超载', color: '#c8b0ff', tint: 0x9a7cff },
  shatter: { name: '碎冰', color: '#9fe3ff', tint: 0x9fe3ff },
} as const;
export type Reaction = keyof typeof REACTIONS;

/** Fire on frozen → steam, lightning on burning → overload, physical on frozen → shatter. */
export function reactionOf(el: Element, frozen: boolean, burning: boolean): Reaction | null {
  if (frozen && el === 'fire') return 'steam';
  if (frozen && el === 'physical') return 'shatter';
  if (burning && el === 'lightning') return 'overload';
  return null;
}

export const ELEMENT_ICON: Record<string, Element> = { ic_fireball: 'fire', 'ic_frozen-orb': 'ice', 'ic_lightning-storm': 'lightning' };

/** Element of a hero's regular attacks (physical when absent). */
export const ATTACK_ELEMENT: Record<string, Element> = { mage: 'ice', shaman: 'lightning', warlock: 'fire' };

// ---------------------------------------------------------------- boss telegraphs

export interface TelegraphDef {
  name: string;
  color: number;
  element: Element;
  /** 'row' = the hero row with more units; a number = that many slots, occupied first. */
  pattern: 'row' | number;
}

/** Bosses mark hero slots one turn ahead, then strike them; heroes can be dragged out of the way. */
export const TELEGRAPHS: Record<string, TelegraphDef> = {
  boss_dragon: { name: '冰霜吐息', color: 0x9fe3ff, element: 'ice', pattern: 'row' },
  boss_lich: { name: '冰柱坠落', color: 0x9fe3ff, element: 'ice', pattern: 2 },
  boss_demon: { name: '邪能陨石', color: 0x8aff4a, element: 'fire', pattern: 3 },
};

// ---------------------------------------------------------------- synergies

export const UNIT_TAGS: Record<string, string[]> = {
  grunt: ['warrior', 'horde'],
  troll: ['hunter', 'horde'],
  tauren: ['shaman', 'horde'],
  mage: ['caster'],
  dwarf: ['warrior'],
  elf: ['elf'],
  paladin: ['warrior'],
  ranger: ['hunter', 'elf'],
  warlock: ['caster'],
  shaman: ['shaman', 'horde'],
};

export interface SynergyDef {
  id: string;
  name: string;
  icon: string;
  /** Distinct heroes needed for each tier. */
  need: number[];
  desc: string[];
}

export const SYNERGIES: SynergyDef[] = [
  { id: 'warrior', name: '战士', icon: '⚔️', need: [2, 3], desc: ['全体受到伤害 -1', '全体受到伤害 -3'] },
  { id: 'hunter', name: '猎手', icon: '🏹', need: [2], desc: ['暴击率 +15%'] },
  { id: 'caster', name: '法师', icon: '🔮', need: [2], desc: ['法术伤害 +3'] },
  { id: 'shaman', name: '萨满', icon: '🌀', need: [2], desc: ['回合开始全体回复 4'] },
  { id: 'elf', name: '精灵', icon: '🌙', need: [2], desc: ['怒气获取 +50%'] },
  { id: 'horde', name: '部落', icon: '🐗', need: [3], desc: ['全体攻击 +2'] },
];

/** Active tier (1-based, 0 = inactive) of each synergy for the heroes on the field. */
export function synergyTiers(unitKeys: string[]) {
  const distinct = [...new Set(unitKeys)];
  const tiers: Record<string, { tier: number; count: number }> = {};
  for (const s of SYNERGIES) {
    const count = distinct.filter((k) => UNIT_TAGS[k]?.includes(s.id)).length;
    tiers[s.id] = { tier: s.need.filter((n) => count >= n).length, count };
  }
  return tiers;
}

/** Front row soaks, back row finds openings. */
export const FRONT_SLOTS = [0, 1, 2];
export const FRONT_DAMAGE_TAKEN = 0.85;
export const BACK_CRIT = 0.1;

// ---------------------------------------------------------------- relics

export interface RelicDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
}

export const RELICS: Record<string, RelicDef> = {
  horn: { id: 'horn', name: '战争号角', icon: '📯', desc: '每波开始，全体英雄获得 6 点护盾' },
  totem: { id: 'totem', name: '嗜血图腾', icon: '🗿', desc: '每回合首次击杀敌人，回复 1 点能量' },
  ember: { id: 'ember', name: '烈焰之心', icon: '🔥', desc: '灼烧每回合伤害 +2' },
  frost: { id: 'frost', name: '永冻之晶', icon: '🧊', desc: '被冰冻的敌人受到伤害 +30%' },
  hammer: { id: 'hammer', name: '雷霆之锤', icon: '🔨', desc: '元素反应伤害 +50%' },
  badge: { id: 'badge', name: '怒火徽记', icon: '💢', desc: '怒气获取 +40%' },
  dagger: { id: 'dagger', name: '致命匕首', icon: '🗡️', desc: '暴击率 +10%，暴击伤害 +50%' },
  orb: { id: 'orb', name: '先知法珠', icon: '🔮', desc: '每回合多抽 1 张牌' },
  scale: { id: 'scale', name: '龙鳞护符', icon: '🐉', desc: '大本营受到的伤害 -2' },
  cleaver: { id: 'cleaver', name: '屠夫砍刀', icon: '🪓', desc: '击杀时溢出伤害溅射给随机敌人' },
  crown: { id: 'crown', name: '先祖王冠', icon: '👑', desc: '每波开始，全体英雄怒气 +30' },
  coin: { id: 'coin', name: '地精金币', icon: '🪙', desc: '获得的金币 +50%' },
};

export function randomRelics(owned: string[], n: number) {
  const pool = Object.keys(RELICS).filter((id) => !owned.includes(id));
  const out: string[] = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}

// ---------------------------------------------------------------- route

export type RouteKind = 'fight' | 'elite' | 'boss' | 'camp' | 'shop' | 'event';

export const ROUTE_INFO: Record<RouteKind, { icon: string; name: string; desc: string; color: number }> = {
  fight: { icon: '⚔️', name: '战斗', desc: '普通敌军\n奖励：卡牌 + 金币', color: 0x7a3a1a },
  elite: { icon: '💀', name: '精英', desc: '强化敌军（生命 ×1.5）\n奖励：遗物 + 双倍金币', color: 0x8a1a2a },
  boss: { icon: '👹', name: '首领', desc: '首领来袭\n奖励：史诗战利品', color: 0x5a1a7a },
  camp: { icon: '🔥', name: '营火', desc: '休整：回复或锻造\n不消耗波次', color: 0xb8601a },
  shop: { icon: '🛒', name: '商店', desc: '用金币购买卡牌、遗物\n不消耗波次', color: 0x2a6a3a },
  event: { icon: '❓', name: '奇遇', desc: '未知的遭遇\n不消耗波次', color: 0x2a4a8a },
};

export const SHOP_PRICE = { common: 30, rare: 50, epic: 80, relic: 100, heal: 30 };

export function goldFor(wave: number, kind: RouteKind) {
  const base = 15 + wave * 3;
  return kind === 'boss' ? base * 3 : kind === 'elite' ? base * 2 : base;
}
