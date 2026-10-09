import { CARDS, Rarity, STARTING_DECK } from './data';

/**
 * Progress kept between runs: talent ranks bought with points earned per run, and
 * the starting deck built in the deck editor.
 */

export type Branch = 'base' | 'energy' | 'spell' | 'unit';

export interface TalentDef {
  id: string;
  branch: Branch;
  name: string;
  glyph: string;
  max: number;
  /** Points per rank. */
  cost: number;
  /** Effect at the given rank (1..max). */
  desc: (rank: number) => string;
}

export const BRANCHES: Record<Branch, { name: string; color: number }> = {
  base: { name: '大本营', color: 0x3fae3a },
  energy: { name: '能量', color: 0x1d6fd8 },
  spell: { name: '法术', color: 0x8a4fd0 },
  unit: { name: '兵种', color: 0xd99a1e },
};

export const TALENTS: TalentDef[] = [
  { id: 'b_wall', branch: 'base', name: '城墙加固', glyph: '🧱', max: 3, cost: 1, desc: (r) => `大本营生命上限 +${15 * r}` },
  { id: 'b_repair', branch: 'base', name: '战地修缮', glyph: '🔨', max: 2, cost: 1, desc: (r) => `每清空一波，大本营恢复 ${6 * r}` },
  { id: 'b_spikes', branch: 'base', name: '尖刺壁垒', glyph: '🌵', max: 2, cost: 1, desc: (r) => `敌人攻击大本营时受到 ${4 * r} 点反伤` },

  { id: 'e_surge', branch: 'energy', name: '战意激昂', glyph: '🔥', max: 2, cost: 1, desc: (r) => `每波第一回合额外 +${r} 能量` },
  { id: 'e_well', branch: 'energy', name: '能量之泉', glyph: '⚡', max: 1, cost: 3, desc: () => '每回合能量上限 +1' },
  { id: 'e_draw', branch: 'energy', name: '战术大师', glyph: '🃏', max: 1, cost: 2, desc: () => '每回合多抽 1 张牌' },

  { id: 's_power', branch: 'spell', name: '秘法研习', glyph: '📖', max: 3, cost: 1, desc: (r) => `法术的伤害、治疗、护盾 +${r}` },
  { id: 's_echo', branch: 'spell', name: '法术回响', glyph: '🌀', max: 1, cost: 2, desc: () => '每回合打出第一张法术后抽 1 张牌' },

  { id: 'u_grunt', branch: 'unit', name: '兽人血统', glyph: '🪓', max: 3, cost: 1, desc: (r) => `兽人步兵 攻击 +${2 * r}，生命 +${6 * r}` },
  { id: 'u_troll', branch: 'unit', name: '猎头者', glyph: '🎯', max: 3, cost: 1, desc: (r) => `巨魔猎手 攻击 +${r}${r >= 3 ? '，每回合投掷 3 次' : '（3 级：投掷 3 次）'}` },
  { id: 'u_tauren', branch: 'unit', name: '大地之母', glyph: '🐂', max: 3, cost: 1, desc: (r) => `牛头人萨满 生命 +${8 * r}，群体治疗 +${2 * r}` },
  { id: 'u_mage', branch: 'unit', name: '奥术精通', glyph: '❄️', max: 3, cost: 1, desc: (r) => `冰霜法师 攻击 +${r}` },
  { id: 'u_dwarf', branch: 'unit', name: '雷霆之锤', glyph: '🔨', max: 3, cost: 1, desc: (r) => `矮人狂战士 攻击 +${r}，眩晕几率 +${10 * r}%` },
  { id: 'u_elf', branch: 'unit', name: '月光祝福', glyph: '🌙', max: 3, cost: 1, desc: (r) => `月神祭司 治疗量 +${3 * r}` },
  { id: 'u_elite', branch: 'unit', name: '先祖之魂', glyph: '⭐', max: 1, cost: 4, desc: () => '新召唤的英雄直接为 2 星' },
];

export const TALENT = Object.fromEntries(TALENTS.map((t) => [t.id, t])) as Record<string, TalentDef>;

export const DECK_MIN = 10;
export const DECK_MAX = 16;
export const COPY_LIMIT: Record<Rarity, number> = { common: 3, rare: 2, epic: 1 };

interface Profile {
  points: number;
  talents: Record<string, number>;
  deck: string[];
}

const KEY = 'horde_profile';

function load(): Profile {
  try {
    const p = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<Profile>;
    const deck = Array.isArray(p.deck) && !deckError(p.deck) ? p.deck : [...STARTING_DECK];
    return { points: p.points ?? 0, talents: p.talents ?? {}, deck };
  } catch {
    return { points: 0, talents: {}, deck: [...STARTING_DECK] };
  }
}

let profile = load();

function save() {
  localStorage.setItem(KEY, JSON.stringify(profile));
}

export const talentPoints = () => profile.points;
export const rank = (id: string) => profile.talents[id] ?? 0;
export const spentPoints = () => TALENTS.reduce((s, t) => s + rank(t.id) * t.cost, 0);

export function canUpgrade(id: string) {
  const t = TALENT[id];
  return rank(id) < t.max && profile.points >= t.cost;
}

export function upgrade(id: string) {
  if (!canUpgrade(id)) return false;
  profile.points -= TALENT[id].cost;
  profile.talents[id] = rank(id) + 1;
  save();
  return true;
}

/** Refund every rank, so builds can be re-planned freely. */
export function resetTalents() {
  profile.points += spentPoints();
  profile.talents = {};
  save();
}

/** Points for a finished run: one per wave cleared, two more per boss slain. */
export function runPoints(wavesCleared: number, bossKills: number) {
  return Math.max(0, wavesCleared) + bossKills * 2;
}

export function addPoints(n: number) {
  profile.points += n;
  save();
}

export const getDeck = () => [...profile.deck];

/** Why a deck can't be used, or null when it's legal. */
export function deckError(deck: string[]): string | null {
  if (deck.length < DECK_MIN) return `至少需要 ${DECK_MIN} 张牌`;
  if (deck.length > DECK_MAX) return `最多 ${DECK_MAX} 张牌`;
  const counts = new Map<string, number>();
  for (const id of deck) {
    const def = CARDS[id];
    if (!def) return `未知卡牌 ${id}`;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (counts.get(id)! > (COPY_LIMIT[def.rarity] ?? 3)) return '超过同名卡牌数量上限';
  }
  if (!deck.some((id) => CARDS[id].kind === 'unit')) return '至少需要 1 张英雄牌';
  return null;
}

export function setDeck(deck: string[]) {
  if (deckError(deck)) return false;
  profile.deck = [...deck];
  save();
  return true;
}

/** For tests and the deck editor's "reset" button. */
export function resetDeck() {
  profile.deck = [...STARTING_DECK];
  save();
}

export function reloadProfile() {
  profile = load();
}
