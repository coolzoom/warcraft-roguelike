import catalog from './presentation.json';
import type { SkillAnimation, SkillVisual } from './data';

export { catalog };
export const isModel = (value: unknown): value is string => typeof value === 'string' && Object.hasOwn(catalog.models, value);
export const isAnimation = (value: unknown): value is SkillAnimation => typeof value === 'string' && Object.hasOwn(catalog.animations, value);
export const isVisual = (value: unknown): value is SkillVisual => typeof value === 'string' && Object.hasOwn(catalog.visuals, value);

/** 编辑器与运行时共用；非法表现不影响数值行为，运行时按默认表现回退。 */
export function presentationIssues(data: Record<string, unknown>): string[] {
  const issues: string[] = [];
  for (const table of ['units', 'enemies']) {
    for (const [id, value] of Object.entries((data[table] ?? {}) as object)) {
      const entry = value as { model?: unknown };
      if (entry?.model !== undefined && !isModel(entry.model)) issues.push(`${table}.${id}.model 无效`);
    }
  }
  for (const [table, field] of [['unitSkills', 'actions'], ['spells', 'effects']]) {
    for (const [id, value] of Object.entries((data[table] ?? {}) as object)) {
      const actions = (value as Record<string, unknown>)?.[field];
      if (!Array.isArray(actions)) continue;
      actions.forEach((action, index) => {
        if (!action || typeof action !== 'object') { issues.push(`${table}.${id}.${field}[${index}] 无效`); return; }
        if (action.visual !== undefined && !isVisual(action.visual)) issues.push(`${table}.${id}.${field}[${index}].visual 无效`);
        if (action.animation !== undefined && (table !== 'unitSkills' || !isAnimation(action.animation))) issues.push(`${table}.${id}.${field}[${index}].animation 无效`);
      });
    }
  }
  return issues;
}
