// Validates public/card-data.json so broken card edits are caught without opening the game.
import { readFileSync } from 'node:fs';

const file = new URL('../public/card-data.json', import.meta.url);
const data = JSON.parse(readFileSync(file, 'utf8'));
const issues = [];
const notes = [];
const presentation = JSON.parse(readFileSync(new URL('../src/presentation.json', import.meta.url), 'utf8'));
const modelIds = new Set(Object.keys(presentation.models));
const animationIds = new Set(Object.keys(presentation.animations));
const visualIds = new Set(Object.keys(presentation.visuals));
const checkPresentation = (label, entry, allowAnimation) => {
  if (entry.model !== undefined && !modelIds.has(entry.model)) issues.push(`${label} model ${entry.model} 不存在`);
  if (entry.visual !== undefined && !visualIds.has(entry.visual)) issues.push(`${label} visual ${entry.visual} 不存在`);
  if (entry.animation !== undefined && (!allowAnimation || !animationIds.has(entry.animation))) issues.push(`${label} animation ${entry.animation} 不存在或不适用`);
};

const used = new Set();
const requireNum = (label, value) => {
  if (typeof value !== 'number' || Number.isNaN(value)) issues.push(`${label} 必须是数字`);
};

Object.entries(data.unitSkills ?? {}).forEach(([id, skill]) => {
  if (!skill.actions?.length) issues.push(`技能 ${id} 没有任何行为`);
  (skill.actions ?? []).forEach((action, i) => {
    if (!action.kind) issues.push(`技能 ${id} 第 ${i + 1} 个行为缺少 kind`);
    if (action.kind === 'heal_lowest' || action.kind === 'heal_all' || action.kind === 'shield_all') requireNum(`技能 ${id} 第 ${i + 1} 个行为 amount`, action.amount);
    checkPresentation(`技能 ${id} 第 ${i + 1} 个行为`, action, true);
  });
});

Object.entries(data.units ?? {}).forEach(([id, unit]) => {
  if (unit.skill && !data.unitSkills?.[unit.skill]) issues.push(`单位 ${id} 引用的技能 ${unit.skill} 不存在`);
  if (!unit.art) issues.push(`单位 ${id} 缺少立绘 art`);
  checkPresentation(`单位 ${id}`, unit, false);
  requireNum(`单位 ${id} atk`, unit.atk);
  requireNum(`单位 ${id} hp`, unit.hp);
  if (!(unit.hp > 0)) issues.push(`单位 ${id} 生命值必须大于 0`);
});

Object.entries(data.spells ?? {}).forEach(([id, spell]) => {
  if (!spell.effects?.length) issues.push(`法术 ${id} 没有任何效果`);
  const needsTarget = (spell.effects ?? []).some((e) => e.kind === 'damage_single' || e.kind === 'execute');
  if (needsTarget && spell.target !== 'enemy') issues.push(`法术 ${id} 需要选择目标，但 target 不是 enemy`);
  (spell.effects ?? []).forEach((effect, i) => checkPresentation(`法术 ${id} 第 ${i + 1} 个效果`, effect, false));
});

Object.entries(data.enemies ?? {}).forEach(([id, enemy]) => {
  if (!(enemy.hp > 0)) issues.push(`敌人 ${id} 生命值必须大于 0`);
  if (enemy.aiParams?.summonKey && !data.enemies?.[enemy.aiParams.summonKey]) issues.push(`敌人 ${id} 的召唤物 ${enemy.aiParams.summonKey} 不存在`);
  if (!enemy.art) issues.push(`敌人 ${id} 缺少立绘 art`);
  checkPresentation(`敌人 ${id}`, enemy, false);
});

Object.entries(data.cards ?? {}).forEach(([id, card]) => {
  if (card.kind === 'unit' && !data.units?.[card.ref]) issues.push(`卡牌 ${id} 引用的单位 ${card.ref} 不存在`);
  if (card.kind === 'spell' && !data.spells?.[card.ref]) issues.push(`卡牌 ${id} 引用的法术 ${card.ref} 不存在`);
  if (!['common', 'rare', 'epic'].includes(card.rarity)) issues.push(`卡牌 ${id} 稀有度非法`);
});

Object.values(data.units ?? {}).forEach((unit) => unit.skill && used.add(unit.skill));
Object.keys(data.unitSkills ?? {}).forEach((id) => {
  if (!used.has(id)) notes.push(`技能 ${id} 没有被任何单位使用`);
});

(data.startingDeck ?? []).forEach((id, i) => {
  if (!data.cards?.[id]) issues.push(`起始牌组第 ${i + 1} 张 ${id} 不在卡库中`);
});

console.log(`卡牌 ${Object.keys(data.cards ?? {}).length} 张，单位 ${Object.keys(data.units ?? {}).length}，法术 ${Object.keys(data.spells ?? {}).length}，技能 ${Object.keys(data.unitSkills ?? {}).length}，敌人 ${Object.keys(data.enemies ?? {}).length}，起始牌组 ${(data.startingDeck ?? []).length} 张`);
notes.forEach((n) => console.log(`[提示] ${n}`));
if (issues.length) {
  issues.forEach((n) => console.log(`[错误] ${n}`));
  process.exit(1);
}
console.log('卡库校验通过');
