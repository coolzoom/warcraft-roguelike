export type Rarity = 'common' | 'rare' | 'epic';

/** Skills are looked up by id from UNIT_SKILLS, so new skills are pure data. */
export type UnitSkill = string;

export type SkillAnimation = 'attack' | 'cast' | 'cheer' | 'none';
export type SkillVisual = 'none' | 'projectile' | 'fire' | 'ice' | 'lightning' | 'heal' | 'shield' | 'burst';
export interface SkillPresentation {
  animation?: SkillAnimation;
  visual?: SkillVisual;
}

export type UnitAction =
  | ({ kind: 'attack_front'; ratio?: number; stunChance?: number; stunChanceBoss?: number; stunTurns?: number; lifesteal?: number; bonusVsLowHp?: number } & SkillPresentation)
  | ({ kind: 'attack_weakest'; times?: number; ratio?: number; bonusVsLowHp?: number } & SkillPresentation)
  | ({ kind: 'attack_all'; ratio?: number; decay?: number; maxTargets?: number } & SkillPresentation)
  | ({ kind: 'heal_lowest'; amount: number; flat?: boolean } & SkillPresentation)
  | ({ kind: 'heal_all'; amount: number; flat?: boolean } & SkillPresentation)
  | ({ kind: 'shield_all'; amount: number; flat?: boolean } & SkillPresentation);

export interface UnitSkillDef {
  id: string;
  name: string;
  desc: string;
  actions: UnitAction[];
}

export const UNIT_SKILLS: Record<string, UnitSkillDef> = {
  front: { id: 'front', name: '正面突击', desc: '攻击最前方的敌人', actions: [{ kind: 'attack_front' }] },
  double: { id: 'double', name: '双掷飞斧', desc: '两次攻击残血的敌人', actions: [{ kind: 'attack_weakest', times: 2 }] },
  taunt_heal: { id: 'taunt_heal', name: '先祖祝福', desc: '攻击前排后治疗全体友军', actions: [{ kind: 'attack_front' }, { kind: 'heal_all', amount: 3 }] },
  aoe: { id: 'aoe', name: '奥术风暴', desc: '攻击全部敌人', actions: [{ kind: 'attack_all' }] },
  stun: { id: 'stun', name: '重锤', desc: '攻击前排，35% 几率眩晕目标', actions: [{ kind: 'attack_front', stunChance: 0.35, stunChanceBoss: 0.15, stunTurns: 1 }] },
  heal: { id: 'heal', name: '月神之光', desc: '治疗最残血的友军并攻击前排', actions: [{ kind: 'heal_lowest', amount: 8 }, { kind: 'attack_front' }] },
  guard: { id: 'guard', name: '圣盾打击', desc: '攻击前排后全队获得护盾', actions: [{ kind: 'attack_front' }, { kind: 'shield_all', amount: 3 }] },
  snipe: { id: 'snipe', name: '精准狙击', desc: '狙击残血敌人，目标半血以下额外伤害', actions: [{ kind: 'attack_weakest', bonusVsLowHp: 4 }] },
  drain: { id: 'drain', name: '生命汲取', desc: '攻击前排并按伤害吸血', actions: [{ kind: 'attack_front', lifesteal: 1 }] },
  chain_attack: { id: 'chain_attack', name: '雷霆链涌', desc: '闪电攻击最多 3 个敌人，伤害递减', actions: [{ kind: 'attack_all', maxTargets: 3, decay: 0.25 }] },
};

export function unitSkill(id: string | undefined): UnitSkillDef | undefined {
  return id ? UNIT_SKILLS[id] : undefined;
}

export interface UnitDef {
  id: string;
  name: string;
  art: string;
  model?: string;
  atk: number;
  hp: number;
  skill: UnitSkill;
  taunt?: boolean;
  desc: string;
}

export type SpellTarget = 'enemy' | 'none';

export type SpellEffect = { visual?: SkillVisual } & (
  | { kind: 'damage_single'; amount: number; stun?: number }
  | { kind: 'execute'; amount: number; bonus: number; threshold: number }
  | { kind: 'damage_all'; amount: number }
  | { kind: 'chain'; hits: number; amount: number }
  | { kind: 'heal_all'; amount: number; base: number }
  | { kind: 'buff_all'; atk: number; shield?: number }
  | { kind: 'shield_all'; amount: number }
  | { kind: 'draw'; count: number }
  | { kind: 'burn'; amount: number; turns?: number });

export interface SpellDef {
  id: string;
  name: string;
  icon: string;
  color: number;
  target: SpellTarget;
  desc: string;
  effects: SpellEffect[];
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
  paladin: { id: 'paladin', name: '圣盾卫士', art: 'p_dwarf', atk: 5, hp: 30, skill: 'guard', desc: '攻击前排敌人，然后全队获得 3 点护盾' },
  ranger: { id: 'ranger', name: '游侠', art: 'p_elf', atk: 5, hp: 18, skill: 'snipe', desc: '攻击血量最低的敌人，半血以下额外造成 4 点伤害' },
  warlock: { id: 'warlock', name: '暗影术士', art: 'p_mage', atk: 5, hp: 20, skill: 'drain', desc: '攻击前排敌人，并按实际生命伤害吸血' },
  shaman: { id: 'shaman', name: '雷鸣萨满', art: 'p_tauren', atk: 6, hp: 22, skill: 'chain_attack', desc: '闪电攻击最多 3 个不同敌人，伤害逐次衰减' },
};

export const SPELLS: Record<string, SpellDef> = {
  fireball: { id: 'fireball', name: '火球术', icon: 'ic_fireball', color: 0xe8541c, target: 'enemy', desc: '对一个敌人造成 10 点伤害', effects: [{ kind: 'damage_single', amount: 10 }] },
  blizzard: { id: 'blizzard', name: '暴风雪', icon: 'ic_frozen-orb', color: 0x3aa0e8, target: 'none', desc: '对所有敌人造成 5 点伤害', effects: [{ kind: 'damage_all', amount: 5 }] },
  heal: { id: 'heal', name: '治疗波', icon: 'ic_health-normal', color: 0x4fc45a, target: 'none', desc: '治疗全体友军 8，大本营 5', effects: [{ kind: 'heal_all', amount: 8, base: 5 }] },
  bloodlust: { id: 'bloodlust', name: '嗜血术', icon: 'ic_axe-swing', color: 0xc8302c, target: 'none', desc: '本波战斗全体友军攻击 +3', effects: [{ kind: 'buff_all', atk: 3 }] },
  chain: { id: 'chain', name: '闪电链', icon: 'ic_lightning-storm', color: 0x8a7cf0, target: 'none', desc: '随机 3 次闪电，每次 7 点伤害', effects: [{ kind: 'chain', hits: 3, amount: 7 }] },
  shieldwall: { id: 'shieldwall', name: '盾墙', icon: 'ic_checked-shield', color: 0xb8a060, target: 'none', desc: '全体友军获得 8 点护盾', effects: [{ kind: 'shield_all', amount: 8 }] },
  execute: { id: 'execute', name: '斩杀', icon: 'ic_crossed-swords', color: 0x9a2020, target: 'enemy', desc: '造成 6 点伤害，目标半血以下改为 20', effects: [{ kind: 'execute', amount: 6, bonus: 20, threshold: 0.5 }] },
  frostbolt: { id: 'frostbolt', name: '寒冰箭', icon: 'ic_frozen-orb', color: 0x3aa0e8, target: 'enemy', desc: '对一个敌人造成 6 点伤害并眩晕 1 回合', effects: [{ kind: 'damage_single', amount: 6, stun: 1 }] },
  meteor: { id: 'meteor', name: '陨石术', icon: 'ic_fireball', color: 0xe8541c, target: 'none', desc: '对所有敌人造成 9 点伤害，并施加 3 回合灼烧（每回合 3 点，已灼烧时翻倍）', effects: [{ kind: 'damage_all', amount: 9 }, { kind: 'burn', amount: 3, turns: 3 }] },
  renew: { id: 'renew', name: '复苏术', icon: 'ic_health-normal', color: 0x4fc45a, target: 'none', desc: '治疗全体友军 12 点，大本营 8 点', effects: [{ kind: 'heal_all', amount: 12, base: 8 }] },
  arcane_intellect: { id: 'arcane_intellect', name: '奥术智慧', icon: 'ic_lightning-storm', color: 0x8a7cf0, target: 'none', desc: '抽 2 张牌', effects: [{ kind: 'draw', count: 2 }] },
  rally: { id: 'rally', name: '集结号令', icon: 'ic_checked-shield', color: 0xb8a060, target: 'none', desc: '本波战斗全体友军攻击 +2，并获得 4 点护盾', effects: [{ kind: 'buff_all', atk: 2, shield: 4 }] },
  smite: { id: 'smite', name: '惩击', icon: 'ic_crossed-swords', color: 0x9a2020, target: 'enemy', desc: '对一个敌人造成 14 点伤害', effects: [{ kind: 'damage_single', amount: 14 }] },
};

export const CARDS: Record<string, CardDef> = {
  grunt: { id: 'grunt', kind: 'unit', cost: 2, rarity: 'common', ref: 'grunt' },
  troll: { id: 'troll', kind: 'unit', cost: 2, rarity: 'common', ref: 'troll' },
  elf: { id: 'elf', kind: 'unit', cost: 2, rarity: 'rare', ref: 'elf' },
  mage: { id: 'mage', kind: 'unit', cost: 3, rarity: 'rare', ref: 'mage' },
  tauren: { id: 'tauren', kind: 'unit', cost: 3, rarity: 'epic', ref: 'tauren' },
  dwarf: { id: 'dwarf', kind: 'unit', cost: 3, rarity: 'epic', ref: 'dwarf' },
  paladin: { id: 'paladin', kind: 'unit', cost: 2, rarity: 'common', ref: 'paladin' },
  ranger: { id: 'ranger', kind: 'unit', cost: 2, rarity: 'common', ref: 'ranger' },
  warlock: { id: 'warlock', kind: 'unit', cost: 3, rarity: 'rare', ref: 'warlock' },
  shaman: { id: 'shaman', kind: 'unit', cost: 3, rarity: 'epic', ref: 'shaman' },
  fireball: { id: 'fireball', kind: 'spell', cost: 1, rarity: 'common', ref: 'fireball' },
  blizzard: { id: 'blizzard', kind: 'spell', cost: 2, rarity: 'rare', ref: 'blizzard' },
  heal: { id: 'heal', kind: 'spell', cost: 1, rarity: 'common', ref: 'heal' },
  bloodlust: { id: 'bloodlust', kind: 'spell', cost: 1, rarity: 'rare', ref: 'bloodlust' },
  chain: { id: 'chain', kind: 'spell', cost: 2, rarity: 'epic', ref: 'chain' },
  shieldwall: { id: 'shieldwall', kind: 'spell', cost: 1, rarity: 'common', ref: 'shieldwall' },
  execute: { id: 'execute', kind: 'spell', cost: 1, rarity: 'rare', ref: 'execute' },
  frostbolt: { id: 'frostbolt', kind: 'spell', cost: 1, rarity: 'common', ref: 'frostbolt' },
  meteor: { id: 'meteor', kind: 'spell', cost: 3, rarity: 'epic', ref: 'meteor' },
  renew: { id: 'renew', kind: 'spell', cost: 2, rarity: 'rare', ref: 'renew' },
  arcane_intellect: { id: 'arcane_intellect', kind: 'spell', cost: 1, rarity: 'common', ref: 'arcane_intellect' },
  rally: { id: 'rally', kind: 'spell', cost: 1, rarity: 'rare', ref: 'rally' },
  smite: { id: 'smite', kind: 'spell', cost: 2, rarity: 'rare', ref: 'smite' },
};

export const STARTING_DECK = [
  'grunt', 'grunt', 'troll', 'elf', 'mage', 'paladin', 'ranger',
  'fireball', 'fireball', 'heal', 'bloodlust', 'shieldwall', 'frostbolt', 'arcane_intellect',
];

export const RARITY_COLOR: Record<Rarity, number> = {
  common: 0x3b6fb6,
  rare: 0x8a4fd0,
  epic: 0xd99a1e,
};

export const RARITY_STARS: Record<Rarity, number> = { common: 3, rare: 4, epic: 5 };

export type EnemyAI = 'basic' | 'armored' | 'summoner' | 'cleave' | 'boss_dragon' | 'boss_lich' | 'boss_demon';

export interface EnemyAIParams {
  summonKey?: string;
  summonCount?: number;
  cleaveRatio?: number;
  aoeRatio?: number;
  aoeBaseDamage?: number;
  lifesteal?: number;
  stunTurns?: number;
}

export interface EnemyDef {
  id: string;
  name: string;
  art: string;
  model?: string;
  atk: number;
  hp: number;
  ai: EnemyAI;
  aiParams?: EnemyAIParams;
  armor?: number;
  boss?: boolean;
  desc: string;
}

export const ENEMIES: Record<string, EnemyDef> = {
  ghoul: { id: 'ghoul', name: '食尸鬼', art: 'e_ghoul', atk: 4, hp: 14, ai: 'basic', desc: '普通攻击' },
  skeleton: { id: 'skeleton', name: '骷髅战士', art: 'e_skeleton', atk: 3, hp: 16, ai: 'armored', armor: 2, desc: '护甲 2' },
  necro: { id: 'necro', name: '死灵法师', art: 'e_necro', atk: 3, hp: 16, ai: 'summoner', aiParams: { summonKey: 'skeleton', summonCount: 1 }, desc: '每 2 回合召唤骷髅' },
  abom: { id: 'abom', name: '憎恶', art: 'e_abom', atk: 6, hp: 42, ai: 'cleave', aiParams: { cleaveRatio: 0.6 }, desc: '顺劈：同时攻击两个目标' },
  dragon: { id: 'dragon', name: '冰霜骨龙', art: 'b_dragon', atk: 8, hp: 150, ai: 'boss_dragon', aiParams: { aoeRatio: 0.7, aoeBaseDamage: 5 }, boss: true, desc: '每 3 回合：冰霜吐息攻击全体' },
  lich: { id: 'lich', name: '霜冠巫妖', art: 'b_lich', atk: 9, hp: 190, ai: 'boss_lich', aiParams: { summonKey: 'ghoul', summonCount: 2, aoeRatio: 0.5, stunTurns: 1 }, boss: true, desc: '召唤亡灵，冰冻友军' },
  demon: { id: 'demon', name: '恐惧魔王', art: 'b_demon', atk: 11, hp: 230, ai: 'boss_demon', aiParams: { aoeRatio: 0.5, aoeBaseDamage: 8, lifesteal: 1 }, boss: true, desc: '吸血攻击最强的友军' },
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
  const allIds = Object.keys(ENEMIES);
  if (allIds.length === 0) return [];
  if (isBossWave(wave)) {
    const bosses = allIds.filter((id) => ENEMIES[id].boss);
    const index = wave / BOSS_EVERY - 1;
    if (bosses.length === 0) return allIds.slice(0, Math.min(3, allIds.length));
    const boss = bosses[index % bosses.length];
    const minions = allIds.filter((id) => !ENEMIES[id].boss);
    const weak = minions.length ? minions : [boss];
    return wave >= 10 ? [boss, weak[0], weak[weak.length - 1]] : [boss];
  }
  const count = Math.min(5, 2 + Math.floor((wave + 1) / 3));
  const pool = allIds.filter((id) => !ENEMIES[id].boss);
  if (pool.length === 0) return [];
  const list: string[] = [];
  for (let i = 0; i < count; i++) list.push(pool[Math.floor(Math.random() * pool.length)]);
  return list;
}
