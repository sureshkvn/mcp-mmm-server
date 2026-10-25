import type { WorkOrder } from '../domain/types.js';

/** Progressive disclosure of *detail*: the same entity at three depths. */
export type Detail = 'summary' | 'standard' | 'full';

export function project(wo: WorkOrder, detail: Detail): Record<string, unknown> {
  const summary = {
    id: wo.id,
    title: wo.title,
    assetId: wo.assetId,
    priority: wo.priority,
    state: wo.state,
    ...(wo.dueAt ? { dueAt: wo.dueAt } : {}),
  };
  if (detail === 'summary') return summary;

  const standard = {
    ...summary,
    noteCount: wo.notes.length,
    ...(wo.laborHours !== undefined ? { laborHours: wo.laborHours } : {}),
    ...(wo.resolution ? { resolution: wo.resolution } : {}),
  };
  if (detail === 'standard') return standard;

  return { ...standard, createdAt: wo.createdAt, notes: wo.notes, history: wo.history };
}
