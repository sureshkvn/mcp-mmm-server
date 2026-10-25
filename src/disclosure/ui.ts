import type { WorkOrder } from '../domain/types.js';
import type { Recommendation, UnlockHint } from './nextBestAction.js';

/**
 * A declarative UI hint in the spirit of A2UI: the server describes *what* to show and which
 * tool calls the buttons map to; the host decides *how* to render it. This is a sketch for the
 * blog post, not an implementation of the A2UI specification.
 */
export type UiNode = Record<string, unknown>;

const styleFor = (kind: Recommendation['kind']): 'primary' | 'secondary' | 'danger' =>
  kind === 'destructive' ? 'danger' : kind === 'write' ? 'primary' : 'secondary';

export function actionButton(rec: Recommendation): UiNode {
  return {
    component: 'button',
    label: rec.title,
    style: styleFor(rec.kind),
    ...(rec.prerequisite ? { before: rec.prerequisite } : {}),
    call: { tool: rec.tool, args: rec.args },
    ...(rec.needs.length ? { collect: rec.needs } : {}),
    ...(rec.kind === 'destructive' ? { confirm: true } : {}),
  };
}

export function workOrderCard(wo: WorkOrder, recs: Recommendation[]): UiNode {
  return {
    component: 'card',
    title: `${wo.id} - ${wo.title}`,
    badges: [wo.state, wo.priority],
    fields: [
      { label: 'Asset', value: wo.assetId },
      { label: 'Due', value: wo.dueAt ?? 'n/a' },
      { label: 'Notes', value: String(wo.notes.length) },
    ],
    actions: recs.map(actionButton),
  };
}

export function recommendationList(recs: Recommendation[], unlockable: UnlockHint[]): UiNode {
  return {
    component: 'list',
    title: 'Suggested next actions',
    items: recs.map((rec) => ({
      component: 'list-item',
      headline: `${rec.title} - ${rec.workOrderId}`,
      supporting: rec.why.join('; '),
      score: rec.score,
      action: actionButton(rec),
    })),
    locked: unlockable.map((u) => ({
      headline: `${u.title} - ${u.workOrderId}`,
      supporting: u.reason,
      ...(u.unblock ? { unlock: u.unblock } : {}),
    })),
  };
}
