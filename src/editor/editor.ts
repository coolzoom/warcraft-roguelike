import type { CardDef, EnemyAI, EnemyDef, Rarity, SpellDef, SpellEffect, UnitAction, UnitDef, UnitSkillDef } from '../data';
import { CARDS, ENEMIES, SPELLS, STARTING_DECK, UNITS, UNIT_SKILLS } from '../data';
import { catalog, isAnimation, isModel, isVisual, presentationIssues } from '../presentation';

interface CardDataFile {
  units: Record<string, UnitDef>;
  spells: Record<string, SpellDef>;
  cards: Record<string, CardDef>;
  enemies: Record<string, EnemyDef>;
  unitSkills: Record<string, UnitSkillDef>;
  startingDeck: string[];
}

const STORAGE_KEY = 'horde_card_editor_v1';
const STORAGE_VERSION = 3;
const RARITY_STARS: Record<Rarity, number> = { common: 3, rare: 4, epic: 5 };
const RARITY_LABEL: Record<Rarity, string> = { common: '普通', rare: '稀有', epic: '史诗' };
const ANIMATION_LABEL = catalog.animations as Record<string, string>;
const VISUAL_LABEL = catalog.visuals as Record<string, string>;
const MODEL_LABEL = catalog.models as Record<string, string>;

/** Merge old drafts with seed entries without discarding their edited records. */
function normalize(raw: Partial<CardDataFile> | null | undefined): CardDataFile {
  const seed = seedFromSource();
  const merge = <T>(draft: Record<string, T> | undefined, fallback: Record<string, T>) => ({ ...fallback, ...(draft ?? {}) });
  const data: CardDataFile = {
    units: merge(raw?.units, seed.units),
    spells: merge(raw?.spells, seed.spells),
    cards: merge(raw?.cards, seed.cards),
    enemies: merge(raw?.enemies, seed.enemies),
    unitSkills: merge(raw?.unitSkills, seed.unitSkills),
    startingDeck: Array.isArray(raw?.startingDeck) ? [...raw.startingDeck] : [...seed.startingDeck],
  };
  Object.values(data.spells).forEach((spell) => {
    spell.effects = Array.isArray(spell.effects) ? spell.effects : [];
  });
  Object.values(data.unitSkills).forEach((skill) => {
    skill.actions = Array.isArray(skill.actions) ? skill.actions : [];
  });
  return data;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function validateImportedData(raw: unknown): raw is Partial<CardDataFile> {
  if (!isRecord(raw)) return false;
  for (const key of ['units', 'spells', 'cards', 'enemies', 'unitSkills'] as const) {
    if (raw[key] !== undefined && !isRecord(raw[key])) return false;
  }
  if (raw.startingDeck !== undefined && (!Array.isArray(raw.startingDeck) || !raw.startingDeck.every((id) => typeof id === 'string'))) return false;
  for (const table of ['units', 'spells', 'cards', 'enemies', 'unitSkills'] as const) {
    const entries = raw[table];
    if (!isRecord(entries)) continue;
    for (const [id, value] of Object.entries(entries)) {
      if (!isRecord(value) || value.id !== id) return false;
      if (table === 'spells' && value.effects !== undefined && !Array.isArray(value.effects)) return false;
      if (table === 'unitSkills' && value.actions !== undefined && !Array.isArray(value.actions)) return false;
    }
  }
  return true;
}

const EFFECT_LABEL: Record<SpellEffect['kind'], string> = {
  damage_single: '单体伤害',
  execute: '斩杀（残血加伤）',
  damage_all: '群体伤害',
  chain: '闪电连锁',
  heal_all: '群体治疗',
  buff_all: '群体增益',
  shield_all: '群体护盾',
  draw: '抽牌',
  burn: '灼烧（持续伤害）',
};

const AI_HINT: Record<EnemyAI, string> = {
  basic: '每回合随机攻击一名友军；没有友军时攻击大本营。',
  armored: '同普通攻击，armor 会减免每次受到的伤害。',
  summoner: '偶数回合召唤 summonKey，其余回合普通攻击。',
  cleave: '攻击主目标后，用 cleaveRatio 倍率顺劈第二个目标。',
  boss_dragon: '每 3 回合用 aoeRatio 群体伤害，并用 aoeBaseDamage 攻击大本营。',
  boss_lich: '循环：召唤 summonCount 个 summonKey → 群体伤害并按 stunTurns 冰冻一名友军 → 普通攻击。',
  boss_demon: '每 3 回合群体伤害并打大本营；其余回合攻击最强友军并按 lifesteal 吸血。',
};

const ACTION_LABEL: Record<UnitAction['kind'], string> = {
  attack_front: '攻击最前排',
  attack_weakest: '攻击最残血',
  attack_all: '攻击多个敌人',
  heal_lowest: '治疗最残血友军',
  heal_all: '治疗全体友军',
  shield_all: '全体护盾',
};

let data: CardDataFile = { units: {}, spells: {}, cards: {}, enemies: {}, unitSkills: {}, startingDeck: [] };
let mode: 'cards' | 'skills' | 'enemies' = 'cards';
let selectedId = '';
let selectedSkillId = '';
let selectedEnemyId = '';
let fileInputTarget: 'json' | null = null;

const el = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function seedFromSource(): CardDataFile {
  return clone({ units: UNITS, spells: SPELLS, cards: CARDS, enemies: ENEMIES, unitSkills: UNIT_SKILLS, startingDeck: [...STARTING_DECK] });
}

function artPool(): string[] {
  const set = new Set<string>();
  Object.values(UNITS).forEach((u) => set.add(u.art));
  Object.values(ENEMIES).forEach((e) => set.add(e.art));
  Object.values(data.units).forEach((u) => set.add(u.art));
  Object.values(data.enemies).forEach((e) => set.add(e.art));
  return [...set].sort();
}

function iconPool(): string[] {
  const set = new Set<string>();
  Object.values(SPELLS).forEach((s) => set.add(s.icon));
  Object.values(data.spells).forEach((s) => set.add(s.icon));
  return [...set].sort();
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: STORAGE_VERSION, ...data }));
  } catch {
    /* storage unavailable - editing still works in-memory */
  }
}

function setStatus(text: string, bad = false, target = 'status') {
  const node = el(target);
  node.textContent = text;
  node.classList.toggle('bad', bad);
}

function toHex(color: number) {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function num(id: string, fallback: number) {
  const raw = Number(el<HTMLInputElement>(id).value);
  return Number.isFinite(raw) ? raw : fallback;
}

// ---------------------------------------------------------------- loading

async function loadInitialRaw(): Promise<Partial<CardDataFile> & { version?: number }> {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored) {
    try {
      const parsed = JSON.parse(stored) as Partial<CardDataFile> & { version?: number };
      if (parsed.cards && Object.keys(parsed.cards).length) return parsed;
    } catch {
      /* ignore broken draft and fall back */
    }
  }
  try {
    const res = await fetch('card-data.json', { cache: 'no-store' });
    if (res.ok) return { ...((await res.json()) as Partial<CardDataFile>), version: STORAGE_VERSION };
  } catch {
    /* fall through to source seed */
  }
  return { ...seedFromSource(), version: STORAGE_VERSION };
}

async function loadInitial(): Promise<CardDataFile> {
  return normalize(await loadInitialRaw());
}

// ---------------------------------------------------------------- lookups

function currentCard(): CardDef | null {
  return data.cards[selectedId] ?? null;
}

function unitOf(id: string) {
  return Object.values(data.units).find((u) => u.id === id);
}

function spellOf(id: string) {
  return Object.values(data.spells).find((s) => s.id === id);
}

function selectCard(id: string) {
  mode = 'cards';
  selectedId = id;
  render();
}

function selectSkill(id: string) {
  mode = 'skills';
  selectedSkillId = id;
  render();
}

function selectEnemy(id: string) {
  mode = 'enemies';
  selectedEnemyId = id;
  render();
}

// ---------------------------------------------------------------- rendering

function render() {
  el('tab-cards').classList.toggle('active', mode === 'cards');
  el('tab-skills').classList.toggle('active', mode === 'skills');
  el('tab-enemies').classList.toggle('active', mode === 'enemies');
  el('deck-section').classList.toggle('hidden', mode !== 'cards');
  renderList();
  renderEditor();
  renderPreview();
  renderDeck();
  validate();
}

/** Defensive accessors: a malformed draft must never blank the whole page. */
function tables() {
  return {
    units: data.units ?? {},
    spells: data.spells ?? {},
    cards: data.cards ?? {},
    enemies: data.enemies ?? {},
    skills: data.unitSkills ?? {},
    deck: data.startingDeck ?? [],
  };
}

function renderList() {
  const list = el('card-list');
  const t = tables();
  const query = el<HTMLInputElement>('search').value.trim().toLowerCase();
  list.innerHTML = '';
  if (mode === 'cards') {
    Object.keys(t.cards)
      .filter((id) => {
        const card = t.cards[id];
        return !query || labelOf(card).toLowerCase().includes(query) || id.includes(query);
      })
      .forEach((id) => {
        const card = t.cards[id];
        const row = document.createElement('button');
        row.className = `card-row${id === selectedId ? ' active' : ''} ${card.rarity}`;
        row.innerHTML = `<span class="badge ${card.rarity}">${card.kind === 'unit' ? '兵' : '法'}</span>
          <span class="row-name">${labelOf(card)}</span>
          <span class="row-meta">${card.cost}费 · ${RARITY_LABEL[card.rarity] ?? card.rarity}</span>`;
        row.onclick = () => selectCard(id);
        list.appendChild(row);
      });
  } else if (mode === 'skills') {
    Object.keys(t.skills)
      .filter((id) => {
        const skill = t.skills[id];
        return !query || (skill?.name ?? '').toLowerCase().includes(query) || id.includes(query);
      })
      .forEach((id) => {
        const skill = t.skills[id];
        const row = document.createElement('button');
        row.className = `card-row${id === selectedSkillId ? ' active' : ''} epic`;
        row.innerHTML = `<span class="badge epic">技</span>
          <span class="row-name">${skill?.name ?? id}</span>
          <span class="row-meta">${skill?.actions?.length ?? 0} 个行为</span>`;
        row.onclick = () => selectSkill(id);
        list.appendChild(row);
      });
  } else {
    Object.keys(t.enemies)
      .filter((id) => {
        const enemy = t.enemies[id];
        return !query || (enemy?.name ?? '').toLowerCase().includes(query) || id.includes(query);
      })
      .forEach((id) => {
        const enemy = t.enemies[id];
        const row = document.createElement('button');
        row.className = `card-row${id === selectedEnemyId ? ' active' : ''} ${enemy?.boss ? 'rare' : 'common'}`;
        row.innerHTML = `<span class="badge ${enemy?.boss ? 'rare' : 'common'}">${enemy?.boss ? '王' : '敌'}</span>
          <span class="row-name">${enemy?.name ?? id}</span>
          <span class="row-meta">攻${enemy?.atk ?? '-'} · 血${enemy?.hp ?? '-'}</span>`;
        row.onclick = () => selectEnemy(id);
        list.appendChild(row);
      });
  }
  el('summary').textContent = `卡牌 ${Object.keys(t.cards).length} · 单位 ${Object.keys(t.units).length} · 法术 ${Object.keys(t.spells).length} · 技能 ${Object.keys(t.skills).length} · 敌人 ${Object.keys(t.enemies).length} · 起始牌组 ${t.deck.length}`;
}

function labelOf(card: CardDef | null) {
  if (!card) return '?';
  return card.kind === 'unit' ? unitOf(card.ref)?.name ?? card.ref : spellOf(card.ref)?.name ?? card.ref;
}

function fillSelect(select: HTMLSelectElement, values: string[], current: string, labels: Record<string, string> = {}) {
  const keep = current && !values.includes(current) ? [current, ...values] : values;
  select.innerHTML = '';
  keep.forEach((v) => {
    const option = document.createElement('option');
    option.value = v;
    option.textContent = labels[v] ? `${v} · ${labels[v]}` : v;
    select.appendChild(option);
  });
}

function modelPool() {
  return Object.keys(MODEL_LABEL).filter(isModel).sort();
}

function animationOptions() {
  return ['', ...Object.keys(ANIMATION_LABEL).filter(isAnimation)];
}

function visualOptions() {
  return ['', ...Object.keys(VISUAL_LABEL).filter(isVisual)];
}

function renderEditor() {
  const cardBody = el('card-body');
  const skillBody = el('skill-body');
  const enemyBody = el('enemy-body');
  const empty = el('editor-empty');
  cardBody.classList.add('hidden');
  skillBody.classList.add('hidden');
  enemyBody.classList.add('hidden');
  if (mode === 'cards' && currentCard()) {
    empty.classList.add('hidden');
    cardBody.classList.remove('hidden');
    const saved = currentCard()!;
    fillSelect(el<HTMLSelectElement>('unit-skill'), Object.keys(data.unitSkills), saved.kind === 'unit' ? unitOf(saved.ref)?.skill ?? '' : '');
    renderCardEditor();
    return;
  }
  if (mode === 'skills' && tables().skills[selectedSkillId]) {
    empty.classList.add('hidden');
    skillBody.classList.remove('hidden');
    renderSkillEditor();
    return;
  }
  if (mode === 'enemies' && tables().enemies[selectedEnemyId]) {
    empty.classList.add('hidden');
    enemyBody.classList.remove('hidden');
    renderEnemyEditor();
    return;
  }
  empty.classList.remove('hidden');
}

function renderCardEditor() {
  const card = currentCard();
  if (!card) return;
  el<HTMLInputElement>('card-id').value = card.id;
  el<HTMLInputElement>('card-cost').value = String(card.cost);
  el<HTMLSelectElement>('card-rarity').value = card.rarity;

  const unitWrap = el('unit-fields');
  const spellWrap = el('spell-fields');
  unitWrap.classList.toggle('hidden', card.kind !== 'unit');
  spellWrap.classList.toggle('hidden', card.kind !== 'spell');

  fillSelect(el<HTMLSelectElement>('unit-art'), artPool(), '');
  fillSelect(el<HTMLSelectElement>('spell-icon'), iconPool(), '');

  if (card.kind === 'unit') {
    const unit = unitOf(card.ref);
    el('ref-title').textContent = `单位数据 · ref = ${card.ref}`;
    if (unit) {
      fillSelect(el<HTMLSelectElement>('unit-skill'), Object.keys(data.unitSkills), unit.skill);
      el<HTMLInputElement>('unit-name').value = unit.name;
      el<HTMLSelectElement>('unit-art').value = unit.art;
      fillSelect(el<HTMLSelectElement>('unit-model'), ['', ...modelPool()], unit.model ?? '', { ...MODEL_LABEL, '': '自动：跟随立绘和游戏设置' });
      el<HTMLSelectElement>('unit-model').value = unit.model ?? '';
      el<HTMLInputElement>('unit-atk').value = String(unit.atk);
      el<HTMLInputElement>('unit-hp').value = String(unit.hp);
      el<HTMLSelectElement>('unit-skill').value = unit.skill;
      el<HTMLInputElement>('unit-taunt').checked = !!unit.taunt;
      el<HTMLInputElement>('unit-desc').value = unit.desc;
    }
  } else {
    const spell = spellOf(card.ref);
    el('ref-title').textContent = `法术数据 · ref = ${card.ref}`;
    if (spell) {
      el<HTMLInputElement>('spell-name').value = spell.name;
      el<HTMLSelectElement>('spell-icon').value = spell.icon;
      el<HTMLSelectElement>('spell-target').value = spell.target;
      el<HTMLInputElement>('spell-color').value = toHex(spell.color);
      el<HTMLInputElement>('spell-desc').value = spell.desc;
      renderEffectList(spell);
    }
  }
}

function renderEffectList(spell: SpellDef) {
  const box = el('effect-list');
  box.innerHTML = '';
  if (!spell.effects.length) {
    box.innerHTML = '<div class="muted">这个法术还没有效果，添加后才会生效</div>';
    return;
  }
  spell.effects.forEach((effect, index) => {
    const row = document.createElement('div');
    row.className = 'effect-row';
    row.innerHTML = '<div class="effect-head"></div><div class="effect-fields"></div>';
    const head = row.querySelector('.effect-head') as HTMLElement;
    const fields = row.querySelector('.effect-fields') as HTMLElement;
    head.innerHTML = `<span class="effect-title">${EFFECT_LABEL[effect.kind]}</span>
      <span class="effect-btns">
        <button data-act="up" data-i="${index}">↑</button>
        <button data-act="down" data-i="${index}">↓</button>
        <button data-act="del" data-i="${index}">×</button>
      </span>`;
    fields.innerHTML = effectFieldsHtml(effect);
    if (!fields.querySelector('[data-key="visual"]')) {
      const label = document.createElement('label');
      label.className = 'field small';
      label.textContent = '法术特效';
      const select = document.createElement('select');
      select.className = 'input';
      select.dataset.key = 'visual';
      fillSelect(select, visualOptions(), effect.visual ?? '', { ...VISUAL_LABEL, '': '默认' });
      select.value = effect.visual ?? '';
      label.appendChild(select);
      fields.appendChild(label);
    }
    fields.querySelectorAll('input, select').forEach((input) => {
      input.addEventListener('change', () => {
        readEffectFields(effect, fields);
        spell.desc = describeSpell(spell);
        commit(false);
      });
    });
    head.querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => {
        const act = btn.getAttribute('data-act');
        const i = Number(btn.getAttribute('data-i'));
        if (act === 'del') spell.effects.splice(i, 1);
        if (act === 'up' && i > 0) [spell.effects[i - 1], spell.effects[i]] = [spell.effects[i], spell.effects[i - 1]];
        if (act === 'down' && i < spell.effects.length - 1) [spell.effects[i + 1], spell.effects[i]] = [spell.effects[i], spell.effects[i + 1]];
        spell.desc = describeSpell(spell);
        commit();
      };
    });
    box.appendChild(row);
  });
}

function effectFieldsHtml(effect: SpellEffect) {
  const field = (name: string, label: string, value: number | string, step = '1') =>
    `<label class="field small"><span>${label}</span><input class="input" data-key="${name}" type="number" step="${step}" value="${value}" /></label>`;
  const select = (name: string, label: string, values: string[], current: string, labels: Record<string, string>) =>
    `<label class="field small"><span>${label}</span><select class="input" data-key="${name}">${values.map((v) => `<option value="${v}" ${v === current ? 'selected' : ''}>${v ? `${v} · ${labels[v] ?? ''}` : '默认'}</option>`).join('')}</select></label>`;
  const presentation = select('visual', '法术特效', visualOptions(), effect.visual ?? '', { ...VISUAL_LABEL, '': '默认特效' });
  switch (effect.kind) {
    case 'damage_single':
      return `<div class="effect-grid">${presentation}${field('amount', '伤害', effect.amount)}${field('stun', '眩晕回合', effect.stun ?? 0)}</div>`;
    case 'execute':
      return `<div class="effect-grid">${presentation}${field('amount', '基础伤害', effect.amount)}${field('bonus', '残血伤害', effect.bonus)}${field('threshold', '残血阈值(0-1)', effect.threshold, '0.05')}</div>`;
    case 'damage_all':
      return `<div class="effect-grid">${field('amount', '全体伤害', effect.amount)}</div>`;
    case 'chain':
      return `<div class="effect-grid">${field('hits', '弹射次数', effect.hits)}${field('amount', '每次伤害', effect.amount)}</div>`;
    case 'heal_all':
      return `<div class="effect-grid">${field('amount', '友军治疗', effect.amount)}${field('base', '大本营治疗', effect.base)}</div>`;
    case 'buff_all':
      return `<div class="effect-grid">${field('atk', '攻击加成', effect.atk)}${field('shield', '护盾', effect.shield ?? 0)}</div>`;
    case 'shield_all':
      return `<div class="effect-grid">${field('amount', '护盾', effect.amount)}</div>`;
    case 'draw':
      return `<div class="effect-grid">${field('count', '抽牌数量', effect.count)}</div>`;
    case 'burn':
      return `<div class="effect-grid">${presentation}${field('amount', '每回合伤害', effect.amount)}${field('turns', '持续回合', effect.turns ?? 3)}</div>`;
  }
}

function readEffectFields(effect: SpellEffect, container: HTMLElement) {
  const read = (key: string) => Number((container.querySelector(`[data-key="${key}"]`) as HTMLInputElement | null)?.value ?? 0);
  const visual = (container.querySelector('[data-key="visual"]') as HTMLSelectElement | null)?.value ?? '';
  if (visual && isVisual(visual)) effect.visual = visual;
  else delete effect.visual;
  switch (effect.kind) {
    case 'damage_single':
      effect.amount = read('amount');
      effect.stun = read('stun') > 0 ? read('stun') : undefined;
      break;
    case 'execute':
      effect.amount = read('amount');
      effect.bonus = read('bonus');
      effect.threshold = Math.min(1, Math.max(0, read('threshold')));
      break;
    case 'damage_all':
      effect.amount = read('amount');
      break;
    case 'chain':
      effect.hits = Math.max(1, read('hits'));
      effect.amount = read('amount');
      break;
    case 'heal_all':
      effect.amount = read('amount');
      effect.base = read('base');
      break;
    case 'buff_all':
      effect.atk = read('atk');
      effect.shield = read('shield') > 0 ? read('shield') : undefined;
      break;
    case 'shield_all':
      effect.amount = read('amount');
      break;
    case 'draw':
      effect.count = Math.max(1, read('count'));
      break;
    case 'burn':
      effect.amount = read('amount');
      effect.turns = read('turns') > 0 ? read('turns') : undefined;
      break;
  }
}

function describeSpell(spell: SpellDef) {
  const parts = spell.effects.map((effect) => {
    switch (effect.kind) {
      case 'damage_single':
        return effect.stun ? `对单个敌人造成 ${effect.amount} 点伤害并眩晕 ${effect.stun} 回合` : `对单个敌人造成 ${effect.amount} 点伤害`;
      case 'execute':
        return `造成 ${effect.amount} 点伤害，目标血量低于 ${Math.round(effect.threshold * 100)}% 时改为 ${effect.bonus}`;
      case 'damage_all':
        return `对所有敌人造成 ${effect.amount} 点伤害`;
      case 'chain':
        return `随机 ${effect.hits} 次闪电，每次 ${effect.amount} 点伤害`;
      case 'heal_all':
        return `治疗全体友军 ${effect.amount}，大本营 ${effect.base}`;
      case 'buff_all':
        return effect.shield ? `本波全体友军攻击 +${effect.atk}，获得 ${effect.shield} 点护盾` : `本波全体友军攻击 +${effect.atk}`;
      case 'shield_all':
        return `全体友军获得 ${effect.amount} 点护盾`;
      case 'draw':
        return `抽 ${effect.count} 张牌`;
      case 'burn':
        return `使目标灼烧 ${effect.turns ?? 3} 回合，每回合 ${effect.amount} 点伤害（已灼烧时翻倍）`;
    }
  });
  return parts.join('，') || (el<HTMLInputElement>('spell-desc').value.trim() || spell.name);
}

function defaultEffect(kind: SpellEffect['kind']): SpellEffect {
  switch (kind) {
    case 'damage_single':
      return { kind, amount: 8 };
    case 'execute':
      return { kind, amount: 6, bonus: 20, threshold: 0.5 };
    case 'damage_all':
      return { kind, amount: 5 };
    case 'chain':
      return { kind, hits: 3, amount: 7 };
    case 'heal_all':
      return { kind, amount: 8, base: 5 };
    case 'buff_all':
      return { kind, atk: 3, shield: 0 };
    case 'shield_all':
      return { kind, amount: 8 };
    case 'draw':
      return { kind, count: 2 };
    case 'burn':
      return { kind, amount: 3, turns: 3 };
  }
}

function renderSkillEditor() {
  const skill = data.unitSkills[selectedSkillId];
  if (!skill) return;
  el<HTMLInputElement>('skill-id').value = skill.id;
  el<HTMLInputElement>('skill-name').value = skill.name;
  el<HTMLInputElement>('skill-desc').value = skill.desc;
  renderActionList(skill);
}

function renderActionList(skill: UnitSkillDef) {
  const box = el('action-list');
  box.innerHTML = '';
  if (!skill.actions.length) {
    box.innerHTML = '<div class="muted">这个技能还没有行为，添加一个后才会在回合中生效</div>';
    return;
  }
  skill.actions.forEach((action, index) => {
    const row = document.createElement('div');
    row.className = 'effect-row';
    row.innerHTML = '<div class="effect-head"></div><div class="effect-fields"></div>';
    const head = row.querySelector('.effect-head') as HTMLElement;
    const fields = row.querySelector('.effect-fields') as HTMLElement;
    head.innerHTML = `<span class="effect-title">${ACTION_LABEL[action.kind]}</span>
      <span class="effect-btns">
        <button data-act="up" data-i="${index}">↑</button>
        <button data-act="down" data-i="${index}">↓</button>
        <button data-act="del" data-i="${index}">×</button>
      </span>`;
    fields.innerHTML = actionFieldsHtml(action);
    fields.querySelectorAll('input, select').forEach((input) => {
      input.addEventListener('change', () => {
        readActionFields(action, fields);
        skill.desc = describeSkill(skill);
        commit(false);
      });
    });
    head.querySelectorAll('button').forEach((btn) => {
      btn.onclick = () => {
        const act = btn.getAttribute('data-act');
        const i = Number(btn.getAttribute('data-i'));
        if (act === 'del') skill.actions.splice(i, 1);
        if (act === 'up' && i > 0) [skill.actions[i - 1], skill.actions[i]] = [skill.actions[i], skill.actions[i - 1]];
        if (act === 'down' && i < skill.actions.length - 1) [skill.actions[i + 1], skill.actions[i]] = [skill.actions[i], skill.actions[i + 1]];
        skill.desc = describeSkill(skill);
        commit();
      };
    });
    box.appendChild(row);
  });
}

function actionFieldsHtml(action: UnitAction) {
  const field = (name: string, label: string, value: number, step = '0.1') =>
    `<label class="field small"><span>${label}</span><input class="input" data-key="${name}" type="number" step="${step}" value="${value}" /></label>`;
  const select = (name: string, label: string, values: string[], current: string, labels: Record<string, string>) =>
    `<label class="field small"><span>${label}</span><select class="input" data-key="${name}">${values.map((v) => `<option value="${v}" ${v === current ? 'selected' : ''}>${v ? `${v} · ${labels[v] ?? ''}` : '默认'}</option>`).join('')}</select></label>`;
  const presentation = `${select('animation', '角色动作', animationOptions(), action.animation ?? '', { ...ANIMATION_LABEL, '': '默认动作' })}${select('visual', '技能特效', visualOptions(), action.visual ?? '', { ...VISUAL_LABEL, '': '默认特效' })}`;
  const check = (name: string, label: string, checked: boolean) =>
    `<label class="field small checkbox"><span>${label}</span><input data-key="${name}" type="checkbox" ${checked ? 'checked' : ''} /></label>`;
  switch (action.kind) {
    case 'attack_front':
      return `<div class="effect-grid">${presentation}${field('ratio', '伤害倍率', action.ratio ?? 1)}${field('stunChance', '眩晕几率', action.stunChance ?? 0, '0.05')}${field('stunChanceBoss', 'BOSS 眩晕几率', action.stunChanceBoss ?? 0, '0.05')}${field('stunTurns', '眩晕回合', action.stunTurns ?? 0, '1')}${field('lifesteal', '吸血比例', action.lifesteal ?? 0)}${field('bonusVsLowHp', '残血加伤', action.bonusVsLowHp ?? 0, '1')}</div>`;
    case 'attack_weakest':
      return `<div class="effect-grid">${presentation}${field('times', '攻击次数', action.times ?? 1, '1')}${field('ratio', '伤害倍率', action.ratio ?? 1)}${field('bonusVsLowHp', '残血加伤', action.bonusVsLowHp ?? 0, '1')}</div>`;
    case 'attack_all':
      return `<div class="effect-grid">${presentation}${field('ratio', '伤害倍率', action.ratio ?? 1)}${field('decay', '逐个衰减', action.decay ?? 0, '0.05')}${field('maxTargets', '最多目标数', action.maxTargets ?? 0, '1')}</div>`;
    case 'heal_lowest':
      return `<div class="effect-grid">${presentation}${field('amount', '治疗量', action.amount, '1')}${check('flat', '不随星级成长', !!action.flat)}</div>`;
    case 'heal_all':
      return `<div class="effect-grid">${presentation}${field('amount', '治疗量', action.amount, '1')}${check('flat', '不随星级成长', !!action.flat)}</div>`;
    case 'shield_all':
      return `<div class="effect-grid">${presentation}${field('amount', '护盾量', action.amount, '1')}${check('flat', '不随星级成长', !!action.flat)}</div>`;
  }
}

function readActionFields(action: UnitAction, container: HTMLElement) {
  const read = (key: string) => Number((container.querySelector(`[data-key="${key}"]`) as HTMLInputElement | null)?.value ?? 0);
  const readText = (key: string) => (container.querySelector(`[data-key="${key}"]`) as HTMLSelectElement | null)?.value ?? '';
  const isChecked = (key: string) => (container.querySelector(`[data-key="${key}"]`) as HTMLInputElement | null)?.checked ?? false;
  const animation = readText('animation');
  const visual = readText('visual');
  if (animation && isAnimation(animation)) action.animation = animation;
  else delete action.animation;
  if (visual && isVisual(visual)) action.visual = visual;
  else delete action.visual;
  const optional = (v: number) => (v > 0 ? v : undefined);
  switch (action.kind) {
    case 'attack_front':
      action.ratio = read('ratio') || 1;
      action.stunChance = optional(read('stunChance'));
      action.stunChanceBoss = optional(read('stunChanceBoss'));
      action.stunTurns = optional(read('stunTurns'));
      action.lifesteal = optional(read('lifesteal'));
      action.bonusVsLowHp = optional(read('bonusVsLowHp'));
      break;
    case 'attack_weakest':
      action.times = Math.max(1, read('times') || 1);
      action.ratio = read('ratio') || 1;
      action.bonusVsLowHp = optional(read('bonusVsLowHp'));
      break;
    case 'attack_all':
      action.ratio = read('ratio') || 1;
      action.decay = optional(read('decay'));
      action.maxTargets = optional(read('maxTargets'));
      break;
    case 'heal_lowest':
    case 'heal_all':
    case 'shield_all':
      action.amount = read('amount');
      action.flat = isChecked('flat') || undefined;
      break;
  }
}

function describeSkill(skill: UnitSkillDef) {
  const parts = skill.actions.map((action) => {
    switch (action.kind) {
      case 'attack_front': {
        const extra = [
          action.stunChance ? `${Math.round(action.stunChance * 100)}% 眩晕` : '',
          action.lifesteal ? '并吸血' : '',
          action.bonusVsLowHp ? '目标残血加伤' : '',
        ].filter(Boolean).join('，');
        return extra ? `攻击最前排敌人（${extra}）` : '攻击最前排敌人';
      }
      case 'attack_weakest':
        return action.times && action.times > 1 ? `攻击残血敌人 ${action.times} 次` : '攻击残血的敌人';
      case 'attack_all':
        return action.maxTargets ? `攻击最多 ${action.maxTargets} 个敌人` : '攻击全部敌人';
      case 'heal_lowest':
        return `治疗最残血友军 ${action.amount}`;
      case 'heal_all':
        return `治疗全体友军 ${action.amount}`;
      case 'shield_all':
        return `全体友军获得 ${action.amount} 点护盾`;
    }
  });
  return parts.join('，') || el<HTMLInputElement>('skill-desc').value.trim() || skill.name;
}

function defaultAction(kind: UnitAction['kind']): UnitAction {
  switch (kind) {
    case 'attack_front':
      return { kind, ratio: 1 };
    case 'attack_weakest':
      return { kind, times: 1, ratio: 1 };
    case 'attack_all':
      return { kind, ratio: 1 };
    case 'heal_lowest':
      return { kind, amount: 8 };
    case 'heal_all':
      return { kind, amount: 3 };
    case 'shield_all':
      return { kind, amount: 3 };
  }
}

function renderEnemyEditor() {
  const enemy = data.enemies[selectedEnemyId];
  if (!enemy) return;
  el<HTMLInputElement>('enemy-id').value = enemy.id;
  el<HTMLInputElement>('enemy-name').value = enemy.name;
  el<HTMLInputElement>('enemy-atk').value = String(enemy.atk);
  el<HTMLInputElement>('enemy-hp').value = String(enemy.hp);
  el<HTMLInputElement>('enemy-armor').value = String(enemy.armor ?? 0);
  el<HTMLSelectElement>('enemy-ai').value = enemy.ai;
  el<HTMLInputElement>('enemy-boss').checked = !!enemy.boss;
  el<HTMLInputElement>('enemy-desc').value = enemy.desc;

  fillSelect(el<HTMLSelectElement>('enemy-art'), artPool(), enemy.art);
  el<HTMLSelectElement>('enemy-art').value = enemy.art;
  fillSelect(el<HTMLSelectElement>('enemy-model'), ['', ...modelPool()], enemy.model ?? '', { ...MODEL_LABEL, '': '自动：跟随立绘和游戏设置' });
  el<HTMLSelectElement>('enemy-model').value = enemy.model ?? '';
  fillSelect(el<HTMLSelectElement>('enemy-summon-key'), Object.keys(data.enemies), '');
  el<HTMLSelectElement>('enemy-summon-key').value = enemy.aiParams?.summonKey ?? '';

  const p = enemy.aiParams ?? {};
  el<HTMLInputElement>('enemy-summon-count').value = String(p.summonCount ?? 0);
  el<HTMLInputElement>('enemy-cleave').value = String(p.cleaveRatio ?? 0);
  el<HTMLInputElement>('enemy-aoe').value = String(p.aoeRatio ?? 0);
  el<HTMLInputElement>('enemy-aoe-base').value = String(p.aoeBaseDamage ?? 0);
  el<HTMLInputElement>('enemy-lifesteal').value = String(p.lifesteal ?? 0);
  el<HTMLInputElement>('enemy-stun').value = String(p.stunTurns ?? 0);
  el('enemy-ai-hint').textContent = AI_HINT[enemy.ai] ?? '';
}

function renderPreview() {
  const box = el('preview');
  if (mode === 'skills') {
    const skill = data.unitSkills[selectedSkillId];
    if (!skill) {
      box.className = 'preview-card empty';
      box.textContent = '暂无预览';
      return;
    }
    box.className = 'preview-card epic';
    box.innerHTML = `
      <div class="gem">技</div>
      <div class="kind">技</div>
      <div class="art skill-art">${skill.actions.map((a) => `<span>${ACTION_LABEL[a.kind]}</span>`).join('<span class="arrow">→</span>') || '<span>暂无行为</span>'}</div>
      <div class="pname">${skill.name}</div>
      <div class="stars">${skill.actions.length} 个行为</div>
      <div class="pdesc">${skill.desc}</div>`;
    return;
  }
  if (mode === 'enemies') {
    const enemy = data.enemies[selectedEnemyId];
    if (!enemy) {
      box.className = 'preview-card empty';
      box.textContent = '暂无预览';
      return;
    }
    box.className = `preview-card ${enemy.boss ? 'epic' : 'rare'}`;
    box.innerHTML = `
      <div class="gem">${enemy.atk}</div>
      <div class="kind">${enemy.boss ? '王' : '敌'}</div>
      <img class="art" src="assets/${enemy.art}.jpg" alt="" />
      <div class="pname">${enemy.name}</div>
      <div class="stars">${enemy.boss ? 'BOSS' : '普通敌人'}</div>
      <div class="stats">血 ${enemy.hp} · 护甲 ${enemy.armor ?? 0}</div>
      <div class="pdesc">${enemy.desc || AI_HINT[enemy.ai]}</div>`;
    return;
  }

  const card = currentCard();
  if (!card) {
    box.className = 'preview-card empty';
    box.textContent = '暂无预览';
    return;
  }
  if (card.kind === 'unit') {
    const unit = unitOf(card.ref);
    box.className = `preview-card ${card.rarity}`;
    box.innerHTML = `
      <div class="gem">${card.cost}</div>
      <div class="kind">兵</div>
      <img class="art" src="assets/${unit?.art ?? 'p_orc'}.jpg" alt="" />
      <div class="pname">${unit?.name ?? '未知单位'}</div>
      <div class="stars">${'★'.repeat(RARITY_STARS[card.rarity])}</div>
      <div class="stats">攻 ${unit?.atk ?? '-'} · 血 ${unit?.hp ?? '-'}</div>
      <div class="pdesc">${unit?.desc ?? ''}</div>`;
  } else {
    const spell = spellOf(card.ref);
    const hex = toHex(typeof spell?.color === 'number' ? spell.color : 0x888888);
    box.className = `preview-card ${card.rarity}`;
    box.innerHTML = `
      <div class="gem">${card.cost}</div>
      <div class="kind">法</div>
      <img class="art" src="assets/icons/${(spell?.icon ?? 'ic_fireball').replace('ic_', '')}.svg" alt="" />
      <div class="pname">${spell?.name ?? '未知法术'}</div>
      <div class="stars">${'★'.repeat(RARITY_STARS[card.rarity])}</div>
      <div class="stats" style="color:${hex}">${spell?.target === 'enemy' ? '需要选择敌人' : '无需选择目标'}</div>
      <div class="pdesc">${spell?.desc ?? ''}</div>`;
  }
}

function renderDeck() {
  const list = el('deck-list');
  const t = tables();
  list.innerHTML = '';
  const counts = new Map<string, number>();
  t.deck.forEach((id) => counts.set(id, (counts.get(id) ?? 0) + 1));
  if (counts.size === 0) list.innerHTML = '<div class="muted">起始牌组为空</div>';
  counts.forEach((count, id) => {
    const card = t.cards[id];
    const row = document.createElement('div');
    row.className = `deck-row-item${card ? '' : ' bad'} ${card?.rarity ?? ''}`;
    row.innerHTML = `<span class="deck-name">${labelOf(card ?? null)}${card ? '' : '（已失效）'}</span>
      <span class="deck-count">x${count}</span>
      <span class="deck-btns"><button data-act="inc" data-id="${id}">+</button><button data-act="dec" data-id="${id}">-</button></span>`;
    list.appendChild(row);
  });
  list.querySelectorAll('button').forEach((btn) => {
    btn.onclick = () => {
      const id = btn.getAttribute('data-id') ?? '';
      if (btn.getAttribute('data-act') === 'inc') data.startingDeck.push(id);
      else data.startingDeck.splice(data.startingDeck.indexOf(id), 1);
      commit();
    };
  });
  fillSelect(el<HTMLSelectElement>('deck-add'), Object.keys(t.cards), '');
}

function validate() {
  const box = el('validation');
  const t = tables();
  const issues: string[] = presentationIssues({ ...data });
  Object.entries(t.cards).forEach(([id, card]) => {
    if (card.kind === 'unit' && !t.units[card.ref]) issues.push(`卡牌 ${id} 引用的单位 ${card.ref} 不存在`);
    if (card.kind === 'spell' && !t.spells[card.ref]) issues.push(`卡牌 ${id} 引用的法术 ${card.ref} 不存在`);
    if (card.cost < 0) issues.push(`卡牌 ${id} 费用为负数`);
  });
  Object.entries(t.spells).forEach(([id, spell]) => {
    if (!spell.effects?.length) issues.push(`法术 ${id} 没有任何效果，打出后不生效`);
    const needsTarget = spell.effects?.some((e) => e.kind === 'damage_single' || e.kind === 'execute');
    if (needsTarget && spell.target !== 'enemy') issues.push(`法术 ${id} 需要选目标，但 target 不是 enemy`);
  });
  Object.entries(t.units).forEach(([id, unit]) => {
    if (unit.skill && !t.skills[unit.skill]) issues.push(`单位 ${id} 引用的技能 ${unit.skill} 不存在，将退化为普通攻击`);
  });
  Object.entries(t.skills).forEach(([id, skill]) => {
    if (!skill.actions?.length) issues.push(`技能 ${id} 没有任何行为，单位回合中不会行动`);
  });
  Object.entries(t.enemies).forEach(([id, enemy]) => {
    if (enemy.hp < 1) issues.push(`敌人 ${id} 生命值必须大于 0`);
    if (enemy.aiParams?.summonKey && !t.enemies[enemy.aiParams.summonKey]) issues.push(`敌人 ${id} 的召唤物 ${enemy.aiParams.summonKey} 不存在`);
  });
  t.deck.forEach((id, i) => {
    if (!t.cards[id]) issues.push(`起始牌组第 ${i + 1} 张 ${id} 不在卡库中`);
  });
  if (issues.length === 0) {
    box.innerHTML = '<div class="ok">全部通过，可以写入项目</div>';
    return true;
  }
  box.innerHTML = issues.map((s) => `<div class="issue">${s}</div>`).join('');
  return false;
}

function commit(rerender = true) {
  saveLocal();
  if (rerender) render();
  else {
    renderPreview();
    validate();
  }
}

// ---------------------------------------------------------------- saving

function renameRef(oldId: string, newId: string) {
  if (newId === oldId || !newId) return oldId;
  const card = data.cards[oldId];
  if (!card) return oldId;
  delete data.cards[oldId];
  data.cards[newId] = { ...card, id: newId, ref: newId };
  if (card.kind === 'unit') {
    const unit = data.units[oldId];
    if (unit) {
      delete data.units[oldId];
      data.units[newId] = { ...unit, id: newId };
    }
  } else {
    const spell = data.spells[oldId];
    if (spell) {
      delete data.spells[oldId];
      data.spells[newId] = { ...spell, id: newId };
    }
  }
  data.startingDeck = data.startingDeck.map((id) => (id === oldId ? newId : id));
  return newId;
}

function saveCardFields() {
  const card = currentCard();
  if (!card) return;
  card.cost = Number(el<HTMLInputElement>('card-cost').value) || 0;
  card.rarity = el<HTMLSelectElement>('card-rarity').value as Rarity;
  selectedId = renameRef(selectedId, el<HTMLInputElement>('card-id').value.trim());
  const saved = currentCard();
  if (!saved) return;
  if (saved.kind === 'unit') {
    const unit = unitOf(saved.ref);
    if (unit) {
      unit.name = el<HTMLInputElement>('unit-name').value.trim() || unit.id;
      unit.art = el<HTMLSelectElement>('unit-art').value;
      unit.model = el<HTMLSelectElement>('unit-model').value || undefined;
      unit.atk = num('unit-atk', unit.atk);
      unit.hp = Math.max(1, num('unit-hp', unit.hp));
      unit.skill = el<HTMLSelectElement>('unit-skill').value;
      unit.taunt = el<HTMLInputElement>('unit-taunt').checked;
      unit.desc = el<HTMLInputElement>('unit-desc').value.trim();
    }
  } else {
    const spell = spellOf(saved.ref);
    if (spell) {
      spell.name = el<HTMLInputElement>('spell-name').value.trim() || spell.id;
      spell.icon = el<HTMLSelectElement>('spell-icon').value;
      spell.target = el<HTMLSelectElement>('spell-target').value as SpellDef['target'];
      spell.color = parseInt(el<HTMLInputElement>('spell-color').value.replace('#', ''), 16);
      const manual = el<HTMLInputElement>('spell-desc').value.trim();
      spell.effects = spell.effects ?? [];
      if (manual && manual !== spell.desc) spell.desc = manual;
      else spell.desc = spell.effects.length ? describeSpell(spell) : manual;
    }
  }
  commit();
  setStatus('已保存到浏览器草稿');
}

function saveSkillFields() {
  const oldId = selectedSkillId;
  const skill = data.unitSkills[oldId];
  if (!skill) return;
  const newId = el<HTMLInputElement>('skill-id').value.trim();
  skill.name = el<HTMLInputElement>('skill-name').value.trim() || skill.name;
  const manual = el<HTMLInputElement>('skill-desc').value.trim();
  if (manual && manual !== skill.desc) skill.desc = manual;
  else skill.desc = skill.actions.length ? describeSkill(skill) : manual;
  if (newId && newId !== oldId && !data.unitSkills[newId]) {
    delete data.unitSkills[oldId];
    data.unitSkills[newId] = { ...skill, id: newId };
    Object.values(data.units).forEach((u) => {
      if (u.skill === oldId) u.skill = newId;
    });
    selectedSkillId = newId;
  }
  commit();
  setStatus('技能已保存', false, 'status-skill');
}

function saveEnemyFields() {
  const oldId = selectedEnemyId;
  const newId = el<HTMLInputElement>('enemy-id').value.trim();
  if (!oldId || !data.enemies[oldId]) return;
  const enemy = data.enemies[oldId];
  const name = el<HTMLInputElement>('enemy-name').value.trim() || enemy.name;
  Object.assign(enemy, {
    name,
    art: el<HTMLSelectElement>('enemy-art').value,
    model: el<HTMLSelectElement>('enemy-model').value || undefined,
    atk: num('enemy-atk', enemy.atk),
    hp: Math.max(1, num('enemy-hp', enemy.hp)),
    armor: Math.max(0, num('enemy-armor', 0)),
    ai: el<HTMLSelectElement>('enemy-ai').value as EnemyAI,
    boss: el<HTMLInputElement>('enemy-boss').checked,
    desc: el<HTMLInputElement>('enemy-desc').value.trim(),
    aiParams: {
      summonKey: el<HTMLSelectElement>('enemy-summon-key').value || undefined,
      summonCount: Math.max(0, num('enemy-summon-count', 0)) || undefined,
      cleaveRatio: num('enemy-cleave', 0) || undefined,
      aoeRatio: num('enemy-aoe', 0) || undefined,
      aoeBaseDamage: num('enemy-aoe-base', 0) || undefined,
      lifesteal: num('enemy-lifesteal', 0) || undefined,
      stunTurns: num('enemy-stun', 0) || undefined,
    },
  });
  if (newId && newId !== oldId && !data.enemies[newId]) {
    delete data.enemies[oldId];
    data.enemies[newId] = { ...enemy, id: newId };
    Object.values(data.enemies).forEach((e) => {
      if (e.aiParams?.summonKey === oldId) e.aiParams.summonKey = newId;
    });
    selectedEnemyId = newId;
  }
  commit();
  setStatus('敌人已保存', false, 'status-enemy');
}

// ---------------------------------------------------------------- mutations

function uniqueId(base: string) {
  let id = base;
  let n = 2;
  while (data.cards[id] || data.enemies[id]) id = `${base}${n++}`;
  return id;
}

function createCard(kind: 'unit' | 'spell') {
  if (kind === 'unit') {
    const id = uniqueId('new_unit');
    data.units[id] = { id, name: '新单位', art: 'p_orc', atk: 3, hp: 12, skill: 'front', desc: '描述新单位的效果' };
    data.cards[id] = { id, kind: 'unit', cost: 1, rarity: 'common', ref: id };
  } else {
    const id = uniqueId('new_spell');
    data.spells[id] = { id, name: '新法术', icon: 'ic_fireball', color: 0xe8541c, target: 'enemy', desc: '', effects: [{ kind: 'damage_single', amount: 8 }] };
    data.spells[id].desc = describeSpell(data.spells[id]);
    data.cards[id] = { id, kind: 'spell', cost: 1, rarity: 'common', ref: id };
  }
  selectedId = kind === 'unit' ? Object.keys(data.cards).pop()! : Object.keys(data.cards).pop()!;
  mode = 'cards';
  commit();
  setStatus('已新建卡牌，请在右侧设置数值与效果');
}

function createEnemy() {
  const id = uniqueId('new_enemy');
  data.enemies[id] = { id, name: '新敌人', art: 'e_ghoul', atk: 4, hp: 14, ai: 'basic', desc: '', aiParams: {} };
  selectedEnemyId = id;
  mode = 'enemies';
  commit();
  setStatus('已新建敌人', false, 'status-enemy');
}

function createSkill() {
  const id = uniqueId('new_skill');
  data.unitSkills[id] = { id, name: '新技能', desc: '', actions: [{ kind: 'attack_front', ratio: 1 }] };
  data.unitSkills[id].desc = describeSkill(data.unitSkills[id]);
  selectedSkillId = id;
  mode = 'skills';
  commit();
  setStatus('已新建技能', false, 'status-skill');
}

function duplicateSkill() {
  const skill = data.unitSkills[selectedSkillId];
  if (!skill) return;
  const id = uniqueId(`${skill.id}_copy`);
  data.unitSkills[id] = { ...skill, id, actions: clone(skill.actions) };
  selectedSkillId = id;
  commit();
  setStatus('已复制技能', false, 'status-skill');
}

function deleteSkill() {
  if (!selectedSkillId) return;
  const skill = data.unitSkills[selectedSkillId];
  const usedBy = Object.values(data.units).filter((u) => u.skill === selectedSkillId).map((u) => u.name);
  const warning = usedBy.length ? `\n\n注意：${usedBy.join('、')} 正在使用，删除后这些单位会退化为普通攻击。` : '';
  if (!window.confirm(`确定删除技能「${skill?.name ?? selectedSkillId}」？${warning}`)) return;
  delete data.unitSkills[selectedSkillId];
  selectedSkillId = Object.keys(data.unitSkills)[0] ?? '';
  commit();
  setStatus('已删除技能', false, 'status-skill');
}

function duplicateEnemy() {
  const enemy = data.enemies[selectedEnemyId];
  if (!enemy) return;
  const id = uniqueId(`${enemy.id}_copy`);
  data.enemies[id] = { ...enemy, id };
  selectedEnemyId = id;
  commit();
  setStatus('已复制敌人', false, 'status-enemy');
}

function deleteEnemy() {
  if (!selectedEnemyId) return;
  const enemy = data.enemies[selectedEnemyId];
  if (!window.confirm(`确定删除敌人「${enemy?.name ?? selectedEnemyId}」？`)) return;
  delete data.enemies[selectedEnemyId];
  Object.values(data.enemies).forEach((e) => {
    if (e.aiParams?.summonKey === selectedEnemyId) delete e.aiParams.summonKey;
  });
  selectedEnemyId = Object.keys(data.enemies)[0] ?? '';
  commit();
  setStatus('已删除敌人', false, 'status-enemy');
}

function duplicateSelected() {
  const card = currentCard();
  if (!card) return;
  if (card.kind === 'unit') {
    const unit = unitOf(card.ref);
    if (unit) {
      const id = uniqueId(`${card.id}_copy`);
      data.units[id] = { ...unit, id };
      data.cards[id] = { ...card, id, ref: id };
      selectedId = id;
    }
  } else {
    const spell = spellOf(card.ref);
    if (spell) {
      const id = uniqueId(`${card.id}_copy`);
      data.spells[id] = { ...spell, id, effects: clone(spell.effects ?? []) };
      data.cards[id] = { ...card, id, ref: id };
      selectedId = id;
    }
  }
  commit();
  setStatus('已复制卡牌');
}

function deleteSelected() {
  if (!selectedId) return;
  if (!window.confirm(`确定删除卡牌「${labelOf(currentCard())}」？`)) return;
  delete data.cards[selectedId];
  delete data.units[selectedId];
  delete data.spells[selectedId];
  data.startingDeck = data.startingDeck.filter((id) => id !== selectedId);
  selectedId = Object.keys(data.cards)[0] ?? '';
  commit();
  setStatus('已删除卡牌');
}

// ---------------------------------------------------------------- export

function buildCodeSnippet() {
  const q = (s: string) => `'${s.replace(/'/g, "\\'")}'`;
  const effectCode = (e: SpellEffect) => `{ kind: ${q(e.kind)}${'amount' in e ? `, amount: ${e.amount}` : ''}${'bonus' in e ? `, bonus: ${e.bonus}, threshold: ${e.threshold}` : ''}${'hits' in e ? `, hits: ${e.hits}` : ''}${'base' in e ? `, base: ${e.base}` : ''}${'turns' in e && (e as { turns?: number }).turns !== undefined ? `, turns: ${(e as { turns?: number }).turns}` : ''}${e.kind === 'buff_all' ? `, atk: ${e.atk}${e.shield !== undefined ? `, shield: ${e.shield}` : ''}` : ''}${e.kind === 'damage_single' && e.stun !== undefined ? `, stun: ${e.stun}` : ''}${e.kind === 'draw' ? `, count: ${e.count}` : ''} }`;
  const paramsCode = (e: EnemyDef) => {
    if (!e.aiParams) return '';
    const entries = Object.entries(e.aiParams).filter(([, v]) => v !== undefined);
    if (!entries.length) return '';
    return `, aiParams: { ${entries.map(([k, v]) => `${k}: ${typeof v === 'string' ? q(v) : v}`).join(', ')} }`;
  };
  const units = Object.values(data.units)
    .map((u) => `  ${q(u.id)}: { id: ${q(u.id)}, name: ${q(u.name)}, art: ${q(u.art)}${u.model ? `, model: ${q(u.model)}` : ''}, atk: ${u.atk}, hp: ${u.hp}, skill: ${q(u.skill)}${u.taunt ? ', taunt: true' : ''}, desc: ${q(u.desc)} },`)
    .join('\n');
  const spells = Object.values(data.spells)
    .map((s) => `  ${q(s.id)}: { id: ${q(s.id)}, name: ${q(s.name)}, icon: ${q(s.icon)}, color: 0x${s.color.toString(16).padStart(6, '0')}, target: ${q(s.target)}, desc: ${q(s.desc)}, effects: [${s.effects.map(e => e.visual === undefined ? effectCode(e) : JSON.stringify(e)).join(', ')}] },`)
    .join('\n');
  const enemies = Object.values(data.enemies)
    .map((e) => `  ${q(e.id)}: { id: ${q(e.id)}, name: ${q(e.name)}, art: ${q(e.art)}${e.model ? `, model: ${q(e.model)}` : ''}, atk: ${e.atk}, hp: ${e.hp}, ai: ${q(e.ai)}${paramsCode(e)}${e.armor ? `, armor: ${e.armor}` : ''}${e.boss ? ', boss: true' : ''}, desc: ${q(e.desc)} },`)
    .join('\n');
  const unitSkills = Object.values(data.unitSkills)
    .map((s) => `  ${q(s.id)}: { id: ${q(s.id)}, name: ${q(s.name)}, desc: ${q(s.desc)}, actions: [${s.actions.map((a) => JSON.stringify(a)).join(', ')}] },`)
    .join('\n');
  const cards = Object.values(data.cards)
    .map((c) => `  ${q(c.id)}: { id: ${q(c.id)}, kind: ${q(c.kind)}, cost: ${c.cost}, rarity: ${q(c.rarity)}, ref: ${q(c.ref)} },`)
    .join('\n');
  const deck = data.startingDeck.map((id) => q(id)).join(', ');
  return `export const UNIT_SKILLS: Record<string, UnitSkillDef> = {\n${unitSkills}\n};\n\nexport const UNITS: Record<string, UnitDef> = {\n${units}\n};\n\nexport const SPELLS: Record<string, SpellDef> = {\n${spells}\n};\n\nexport const ENEMIES: Record<string, EnemyDef> = {\n${enemies}\n};\n\nexport const CARDS: Record<string, CardDef> = {\n${cards}\n};\n\nexport const STARTING_DECK = [\n  ${deck},\n];\n`;
}

function download(name: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

interface SaveFileHandle {
  createWritable: () => Promise<{ write: (content: string) => Promise<void>; close: () => Promise<void> }>;
}

interface FilePickerWindow {
  showSaveFilePicker?: (options: unknown) => Promise<SaveFileHandle>;
}

async function writeToProject() {
  if (!validate()) {
    setStatus('存在校验错误，请先修复', true, mode === 'cards' ? 'status' : 'status-enemy');
    return;
  }
  const json = JSON.stringify(data, null, 2);
  const pickerWindow = window as unknown as FilePickerWindow;
  if (pickerWindow.showSaveFilePicker) {
    try {
      const handle = await pickerWindow.showSaveFilePicker({
        suggestedName: 'card-data.json',
        types: [{ description: 'JSON', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      setStatus('已写入 public/card-data.json', false, mode === 'cards' ? 'status' : 'status-enemy');
      return;
    } catch {
      /* cancelled or unavailable - fall back to download */
    }
  }
  download('card-data.json', json, 'application/json');
  setStatus('已下载 card-data.json，请放入 public 目录', false, mode === 'cards' ? 'status' : 'status-enemy');
}

async function importJson(file: File) {
  try {
    const parsed: unknown = JSON.parse(await file.text());
    if (!validateImportedData(parsed)) throw new Error('JSON 结构无效');
    data = normalize(parsed);
    selectedId = Object.keys(data.cards)[0] ?? '';
    selectedSkillId = Object.keys(data.unitSkills)[0] ?? '';
    selectedEnemyId = Object.keys(data.enemies)[0] ?? '';
    commit();
    setStatus('导入成功');
  } catch (error) {
    setStatus(`导入失败：${(error as Error).message}`, true);
  }
}

// ---------------------------------------------------------------- wiring

function bind() {
  const cardFields: Array<[string, 'input' | 'change']> = [
    ['card-cost', 'change'],
    ['card-rarity', 'change'],
    ['unit-name', 'input'],
    ['unit-art', 'change'],
    ['unit-model', 'change'],
    ['unit-atk', 'change'],
    ['unit-hp', 'change'],
    ['unit-skill', 'change'],
    ['unit-taunt', 'change'],
    ['unit-desc', 'input'],
    ['spell-name', 'input'],
    ['spell-icon', 'change'],
    ['spell-target', 'change'],
    ['spell-color', 'change'],
    ['spell-desc', 'input'],
  ];
  cardFields.forEach(([id, event]) => el(id).addEventListener(event, saveCardFields));
  el('card-id').addEventListener('change', saveCardFields);

  const enemyFields = ['enemy-name', 'enemy-atk', 'enemy-hp', 'enemy-armor', 'enemy-ai', 'enemy-art', 'enemy-model', 'enemy-desc', 'enemy-summon-key', 'enemy-summon-count', 'enemy-cleave', 'enemy-aoe', 'enemy-aoe-base', 'enemy-lifesteal', 'enemy-stun'];
  enemyFields.forEach((id) => el(id).addEventListener('change', saveEnemyFields));
  el('enemy-boss').addEventListener('change', saveEnemyFields);
  el('enemy-id').addEventListener('change', saveEnemyFields);

  const skillFields: Array<[string, 'input' | 'change']> = [
    ['skill-name', 'input'],
    ['skill-desc', 'input'],
  ];
  skillFields.forEach(([id, event]) => el(id).addEventListener(event, saveSkillFields));
  el('skill-id').addEventListener('change', saveSkillFields);
  el('btn-new-skill').onclick = createSkill;
  el('btn-skill-dupe').onclick = duplicateSkill;
  el('btn-skill-delete').onclick = deleteSkill;
  el('btn-action-add').onclick = () => {
    const skill = data.unitSkills[selectedSkillId];
    if (!skill) return;
    const kind = el<HTMLSelectElement>('action-new').value as UnitAction['kind'];
    skill.actions = skill.actions ?? [];
    skill.actions.push(defaultAction(kind));
    skill.desc = describeSkill(skill);
    commit();
    setStatus('已添加行为', false, 'status-skill');
  };

  el('tab-cards').onclick = () => {
    mode = 'cards';
    if (!selectedId) selectedId = Object.keys(data.cards)[0] ?? '';
    render();
  };
  el('tab-skills').onclick = () => {
    mode = 'skills';
    if (!selectedSkillId) selectedSkillId = Object.keys(data.unitSkills)[0] ?? '';
    render();
  };
  el('tab-enemies').onclick = () => {
    mode = 'enemies';
    if (!selectedEnemyId) selectedEnemyId = Object.keys(data.enemies)[0] ?? '';
    render();
  };
  el('search').addEventListener('input', renderList);

  el('btn-new-unit').onclick = () => createCard('unit');
  el('btn-new-spell').onclick = () => createCard('spell');
  el('btn-new-enemy').onclick = createEnemy;
  el('btn-enemy-dupe').onclick = duplicateEnemy;
  el('btn-enemy-delete').onclick = deleteEnemy;
  el('btn-dupe').onclick = duplicateSelected;
  el('btn-delete').onclick = deleteSelected;
  el('btn-effect-add').onclick = () => {
    const spell = spellOf(currentCard()?.ref ?? '');
    if (!spell) return;
    const kind = el<HTMLSelectElement>('effect-new').value as SpellEffect['kind'];
    spell.effects = spell.effects ?? [];
    spell.effects.push(defaultEffect(kind));
    spell.desc = describeSpell(spell);
    if (kind === 'damage_single' || kind === 'execute') spell.target = 'enemy';
    commit();
    setStatus('已添加效果');
  };
  el('btn-export').onclick = () => download('card-data.json', JSON.stringify(data, null, 2), 'application/json');
  el('btn-code').onclick = () => {
    el<HTMLTextAreaElement>('code-area').value = buildCodeSnippet();
    el<HTMLDialogElement>('code-dialog').showModal();
  };
  el('btn-close-code').onclick = () => el<HTMLDialogElement>('code-dialog').close();
  el('btn-copy-code').onclick = async () => {
    const area = el<HTMLTextAreaElement>('code-area');
    try {
      await navigator.clipboard.writeText(area.value);
      setStatus('代码已复制');
    } catch {
      area.select();
      setStatus('请按 Ctrl+C 复制');
    }
  };
  el('btn-save-project').onclick = writeToProject;
  el('btn-import').onclick = () => {
    fileInputTarget = 'json';
    el<HTMLInputElement>('file-input').click();
  };
  el<HTMLInputElement>('file-input').onchange = (event) => {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file && fileInputTarget === 'json') void importJson(file);
    input.value = '';
  };
  el('btn-reset').onclick = () => {
    if (!window.confirm('恢复到内置默认数据？当前草稿会被覆盖。')) return;
    data = seedFromSource();
    selectedId = Object.keys(data.cards)[0] ?? '';
    selectedSkillId = Object.keys(data.unitSkills)[0] ?? '';
    selectedEnemyId = Object.keys(data.enemies)[0] ?? '';
    commit();
    setStatus('已恢复默认');
  };
  el('btn-deck-add').onclick = () => {
    const id = el<HTMLSelectElement>('deck-add').value;
    if (!id) return;
    data.startingDeck.push(id);
    commit();
  };
}

async function boot() {
  let warning = '';
  let migrated = false;
  try {
    const raw = (await loadInitialRaw()) as Partial<CardDataFile> & { version?: number };
    data = normalize(raw);
    migrated = (raw.version ?? 0) < STORAGE_VERSION;
  } catch (error) {
    data = seedFromSource();
    warning = `读取草稿失败，当前使用内置数据但保留原草稿：${(error as Error).message}`;
  }
  selectedId = Object.keys(data.cards)[0] ?? '';
  selectedSkillId = Object.keys(data.unitSkills)[0] ?? '';
  selectedEnemyId = Object.keys(data.enemies)[0] ?? '';
  bind();
  try {
    render();
  } catch (error) {
    data = seedFromSource();
    render();
    warning = `草稿与当前版本不兼容，当前使用内置数据但保留原草稿：${(error as Error).message}`;
  }
  setStatus(warning || (migrated ? '检测到旧版草稿，已保留原有数据并补齐新增字段' : '草稿自动保存在浏览器'), !!warning);
  if (!warning) saveLocal();
}

void boot();
