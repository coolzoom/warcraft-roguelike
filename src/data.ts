export type Rarity = 'common' | 'rare' | 'epic';

export type UnitSkill = 'front' | 'double' | 'taunt_heal' | 'aoe' | 'stun' | 'heal';

export interface UnitDef {
  id: string;
  name: string;
  art: string;
  atk: number;
  hp: number;
  skill: UnitSkill;
  taunt?: boolean;
  desc: string;
}

export type SpellTarget = 'enemy' | 'none';

export interface SpellDef {
  id: string;
  name: string;
  icon: string;
  color: number;
  target: SpellTarget;
  desc: string;
}

export interface CardDef {
  id: string;
  kind: 'unit' | 'spell';
  cost: number;
  rarity: Rarity;
  ref: string;
}

export const UNITS: Record<string, UnitDef> = {
  grunt: { id: 'grunt', name: '兽人步兵', art: 'p_orc', atk: 6, hp: 24, skill: 'front', desc: '攻击最前方的敌人' },
  troll: { id: 'troll', name: '巨魔猎手', art: 'p_troll', atk: 4, hp: 15, skill: 'double', desc: '投掷两次飞斧，优先残血' },
  tauren: { id: 'tauren', name: '牛头人萨满', art: 'p_tauren', atk: 4, hp: 34, skill: 'taunt_heal', taunt: true, desc: '嘲讽。每回合治疗全体友军 3' },
  mage: { id: 'mage', name: '冰霜法师', art: 'p_mage', atk: 3, hp: 14, skill: 'aoe', desc: '奥术风暴：攻击全部敌人' },
  dwarf: { id: 'dwarf', name: '矮人狂战士', art: 'p_dwarf', atk: 8, hp: 28, skill: 'stun', desc: '重锤：35% 几率眩晕目标' },
  elf: { id: 'elf', name: '月神祭司', art: 'p_elf', atk: 2, hp: 16, skill: 'heal', desc: '治疗血量最低的友军 8' },
};

export const SPELLS: Record<string, SpellDef> = {
  fireball: { id: 'fireball', name: '火球术', icon: 'ic_fireball', color: 0xe8541c, target: 'enemy', desc: '对一个敌人造成 10 点伤害' },
  blizzard: { id: 'blizzard', name: '暴风雪', icon: 'ic_frozen-orb', color: 0x3aa0e8, target: 'none', desc: '对所有敌人造成 5 点伤害' },
  heal: { id: 'heal', name: '治疗波', icon: 'ic_health-normal', color: 0x4fc45a, target: 'none', desc: '治疗全体友军 8，大本营 5' },
  bloodlust: { id: 'bloodlust', name: '嗜血术', icon: 'ic_axe-swing', color: 0xc8302c, target: 'none', desc: '本波战斗全体友军攻击 +3' },
  chain: { id: 'chain', name: '闪电链', icon: 'ic_lightning-storm', color: 0x8a7cf0, target: 'none', desc: '随机 3 次闪电，每次 7 点伤害' },
  shieldwall: { id: 'shieldwall', name: '盾墙', icon: 'ic_checked-shield', color: 0xb8a060, target: 'none', desc: '全体友军获得 8 点护盾' },
  execute: { id: 'execute', name: '斩杀', icon: 'ic_crossed-swords', color: 0x9a2020, target: 'enemy', desc: '造成 6 点伤害，若目标血量低于一半则改为 20' },
};

export const CARDS: Record<string, CardDef> = {
  grunt: { id: 'grunt', kind: 'unit', cost: 2, rarity: 'common', ref: 'grunt' },
  troll: { id: 'troll', kind: 'unit', cost: 2, rarity: 'common', ref: 'troll' },
  elf: { id: 'elf', kind: 'unit', cost: 2, rarity: 'rare', ref: 'elf' },
  mage: { id: 'mage', kind: 'unit', cost: 3, rarity: 'rare', ref: 'mage' },
  tauren: { id: 'tauren', kind: 'unit', cost: 3, rarity: 'epic', ref: 'tauren' },
  dwarf: { id: 'dwarf', kind: 'unit', cost: 3, rarity: 'epic', ref: 'dwarf' },
  fireball: { id: 'fireball', kind: 'spell', cost: 1, rarity: 'common', ref: 'fireball' },
  blizzard: { id: 'blizzard', kind: 'spell', cost: 2, rarity: 'rare', ref: 'blizzard' },
  heal: { id: 'heal', kind: 'spell', cost: 1, rarity: 'common', ref: 'heal' },
  bloodlust: { id: 'bloodlust', kind: 'spell', cost: 1, rarity: 'rare', ref: 'bloodlust' },
  chain: { id: 'chain', kind: 'spell', cost: 2, rarity: 'epic', ref: 'chain' },
  shieldwall: { id: 'shieldwall', kind: 'spell', cost: 1, rarity: 'common', ref: 'shieldwall' },
  execute: { id: 'execute', kind: 'spell', cost: 1, rarity: 'rare', ref: 'execute' },
};

export const STARTING_DECK = [
  'grunt', 'grunt', 'troll', 'elf', 'mage',
  'fireball', 'fireball', 'heal', 'bloodlust', 'shieldwall',
];

export const RARITY_COLOR: Record<Rarity, number> = {
  common: 0x3b6fb6,
  rare: 0x8a4fd0,
  epic: 0xd99a1e,
};

export const RARITY_STARS: Record<Rarity, number> = { common: 3, rare: 4, epic: 5 };

export type EnemyAI = 'basic' | 'armored' | 'summoner' | 'cleave' | 'boss_dragon' | 'boss_lich' | 'boss_demon';

export interface EnemyDef {
  id: string;
  name: string;
  art: string;
  atk: number;
  hp: number;
  ai: EnemyAI;
  armor?: number;
  boss?: boolean;
  desc: string;
}

export const ENEMIES: Record<string, EnemyDef> = {
  ghoul: { id: 'ghoul', name: '食尸鬼', art: 'e_ghoul', atk: 4, hp: 14, ai: 'basic', desc: '' },
  skeleton: { id: 'skeleton', name: '骷髅战士', art: 'e_skeleton', atk: 3, hp: 16, ai: 'armored', armor: 2, desc: '护甲 2' },
  necro: { id: 'necro', name: '死灵法师', art: 'e_necro', atk: 3, hp: 16, ai: 'summoner', desc: '每 2 回合召唤骷髅' },
  abom: { id: 'abom', name: '憎恶', art: 'e_abom', atk: 6, hp: 42, ai: 'cleave', desc: '顺劈：同时攻击两个目标' },
  dragon: { id: 'dragon', name: '冰霜骨龙', art: 'b_dragon', atk: 8, hp: 150, ai: 'boss_dragon', boss: true, desc: '每 3 回合：冰霜吐息攻击全体' },
  lich: { id: 'lich', name: '霜冠巫妖', art: 'b_lich', atk: 9, hp: 190, ai: 'boss_lich', boss: true, desc: '召唤亡灵，冰冻友军' },
  demon: { id: 'demon', name: '恐惧魔王', art: 'b_demon', atk: 11, hp: 230, ai: 'boss_demon', boss: true, desc: '吸血攻击最强的友军' },
};

export const BOSS_EVERY = 5;
export const BOSS_ORDER = ['dragon', 'lich', 'demon'];

export function isBossWave(wave: number) {
  return wave % BOSS_EVERY === 0;
}

export function waveScale(wave: number) {
  return 1 + 0.1 * (wave - 1);
}

export function buildWave(wave: number): string[] {
  if (isBossWave(wave)) {
    const boss = BOSS_ORDER[(wave / BOSS_EVERY - 1) % BOSS_ORDER.length];
    return wave >= 10 ? [boss, 'ghoul', 'ghoul'] : [boss];
  }
  const count = Math.min(5, 2 + Math.floor((wave + 1) / 3));
  const pool = ['ghoul', 'ghoul', 'skeleton'];
  if (wave >= 2) pool.push('necro');
  if (wave >= 3) pool.push('abom');
  const list: string[] = [];
  for (let i = 0; i < count; i++) list.push(pool[Math.floor(Math.random() * pool.length)]);
  return list;
}
