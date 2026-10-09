import type { CardDef, EnemyDef, SpellDef, UnitDef, UnitSkillDef } from './data';
import { CARDS, ENEMIES, SPELLS, STARTING_DECK, UNITS, UNIT_SKILLS } from './data';
import { isModel, isAnimation, isVisual } from './presentation';

export interface CardDataFile {
  units?: Record<string, UnitDef>;
  spells?: Record<string, SpellDef>;
  cards?: Record<string, CardDef>;
  enemies?: Record<string, EnemyDef>;
  unitSkills?: Record<string, UnitSkillDef>;
  startingDeck?: string[];
}

function clear(obj: Record<string, unknown>) {
  Object.keys(obj).forEach((key) => delete obj[key]);
}

/** Replace the built-in tables with an externally edited set (public/card-data.json). */
function applyCardData(file: CardDataFile) {
  if (!file || typeof file !== 'object' || Array.isArray(file)) throw new Error('Invalid card data');
  for (const key of ['units', 'spells', 'cards', 'enemies', 'unitSkills'] as const) {
    const table = file[key] as Record<string, { id?: unknown }> | undefined;
    if (table !== undefined && (!table || typeof table !== 'object' || Array.isArray(table))) throw new Error(`Invalid ${key} table`);
    if (table && Object.entries(table).some(([id, value]) => !value || typeof value !== 'object' || value.id !== id)) throw new Error(`Invalid ${key} entries`);
  }
  if (file.startingDeck !== undefined && (!Array.isArray(file.startingDeck) || !file.startingDeck.every((id) => typeof id === 'string'))) throw new Error('Invalid startingDeck');
  if (file.units && Object.keys(file.units).length) {
    clear(UNITS);
    Object.assign(UNITS, file.units);
    Object.values(UNITS).forEach((u) => {
      if (!u.skill) u.skill = 'front';
      if (u.model !== undefined && !isModel(u.model)) delete u.model;
    });
  }
  if (file.spells && Object.keys(file.spells).length) {
    clear(SPELLS);
    Object.assign(SPELLS, file.spells);
    Object.values(SPELLS).forEach((s) => {
      if (!Array.isArray(s.effects)) s.effects = [];
      if (!s.target) s.target = 'none';
      s.effects.forEach(e => { if (e.visual !== undefined && !isVisual(e.visual)) delete e.visual; });
    });
  }
  if (file.unitSkills && Object.keys(file.unitSkills).length) {
    clear(UNIT_SKILLS);
    Object.assign(UNIT_SKILLS, file.unitSkills);
    Object.values(UNIT_SKILLS).forEach((s) => {
      if (!Array.isArray(s.actions)) s.actions = [];
      s.actions.forEach((a) => {
        if (a.animation !== undefined && !isAnimation(a.animation)) delete a.animation;
        if (a.visual !== undefined && !isVisual(a.visual)) delete a.visual;
      });
    });
  }
  if (file.cards && Object.keys(file.cards).length) {
    clear(CARDS);
    Object.assign(CARDS, file.cards);
  }
  if (file.enemies && Object.keys(file.enemies).length) {
    clear(ENEMIES);
    Object.assign(ENEMIES, file.enemies);
    Object.values(ENEMIES).forEach((e) => {
      if (e.model !== undefined && !isModel(e.model)) delete e.model;
    });
  }
  if (Array.isArray(file.startingDeck)) {
    STARTING_DECK.splice(0, STARTING_DECK.length, ...file.startingDeck.filter((id) => !!CARDS[id]));
  }
  if (STARTING_DECK.length === 0 && file.startingDeck === undefined) {
    STARTING_DECK.push(...Object.keys(CARDS).slice(0, 10));
  }
}

/** Load custom cards before the game boots so all scenes see the same tables. */
export async function loadCardData(): Promise<boolean> {
  try {
    const res = await fetch('card-data.json', { cache: 'no-store' });
    if (!res.ok) return false;
    applyCardData((await res.json()) as CardDataFile);
    return true;
  } catch {
    return false;
  }
}
