import type { WorkOrderService } from '../domain/service.js';
import { TERMINAL_STATES, type Priority, type Role, type WorkOrder } from '../domain/types.js';
import { buildAffordances, type Affordance, type BlockedAffordance, type ToolCallHint } from './affordances.js';

export interface ScoringInput {
  wo: WorkOrder;
  affordance: Affordance;
  now: number;
}

export interface ScoreContribution {
  delta: number;
  why: string;
}

/** Strategy: each scorer contributes to, or subtracts from, an action's rank, and says why. */
export interface Scorer {
  readonly name: string;
  evaluate(input: ScoringInput): ScoreContribution | undefined;
}

const PRIORITY_WEIGHT: Record<Priority, number> = { critical: 40, high: 25, normal: 10, low: 0 };
const FORWARD_RELS = new Set(['submit', 'approve', 'start', 'complete']);
const HOUR = 3_600_000;

export const priorityScorer: Scorer = {
  name: 'priority',
  evaluate: ({ wo }) => {
    const delta = PRIORITY_WEIGHT[wo.priority];
    return delta ? { delta, why: `${wo.priority} priority` } : undefined;
  },
};

export const dueDateScorer: Scorer = {
  name: 'due-date',
  evaluate: ({ wo, now }) => {
    if (!wo.dueAt) return undefined;
    const hoursLeft = (Date.parse(wo.dueAt) - now) / HOUR;
    if (hoursLeft < 0) return { delta: 30, why: `overdue by ${Math.round(-hoursLeft)}h` };
    if (hoursLeft <= 6) return { delta: 10, why: `due within ${Math.max(1, Math.round(hoursLeft))}h` };
    return undefined;
  },
};

export const forwardProgressScorer: Scorer = {
  name: 'forward-progress',
  evaluate: ({ affordance }) =>
    FORWARD_RELS.has(affordance.rel) ? { delta: 15, why: 'advances the workflow' } : undefined,
};

/** Advisory, not enforced: completing is *allowed* without notes, but it is rarely the best next move. */
export const documentationScorer: Scorer = {
  name: 'documentation',
  evaluate: ({ wo, affordance }) => {
    if (affordance.rel === 'complete' && wo.notes.length === 0) {
      return { delta: -35, why: 'no findings recorded yet - document before closing' };
    }
    if (affordance.rel === 'add_note' && wo.state === 'in_progress' && wo.notes.length === 0) {
      return { delta: 25, why: 'record findings before completion' };
    }
    return undefined;
  },
};

export const riskScorer: Scorer = {
  name: 'risk',
  evaluate: ({ affordance }) => {
    if (affordance.kind === 'destructive') return { delta: -25, why: 'destructive - confirm intent first' };
    if (affordance.rel === 'reject') return { delta: -10, why: 'sends work backwards' };
    return undefined;
  },
};

export const DEFAULT_SCORERS: readonly Scorer[] = [
  priorityScorer,
  dueDateScorer,
  forwardProgressScorer,
  documentationScorer,
  riskScorer,
];

export interface Recommendation {
  rank: number;
  score: number;
  workOrderId: string;
  workOrderTitle: string;
  tool: string;
  title: string;
  args: Record<string, unknown>;
  needs: string[];
  kind: Affordance['kind'];
  prerequisite?: ToolCallHint;
  why: string[];
}

export interface UnlockHint extends BlockedAffordance {
  workOrderId: string;
}

export interface RankInput {
  workOrders: WorkOrder[];
  role: Role;
  service: WorkOrderService;
  focusedId?: string;
  scorers?: readonly Scorer[];
  limit?: number;
  now?: number;
}

export interface RankResult {
  recommendations: Recommendation[];
  unlockable: UnlockHint[];
}

/** Dynamic next-best-action discovery: derived from live state, role and policy, never hard-coded. */
export function rankNextBestActions(input: RankInput): RankResult {
  const { workOrders, role, service, focusedId, scorers = DEFAULT_SCORERS, limit = 5, now = Date.now() } = input;
  const scored: Omit<Recommendation, 'rank'>[] = [];
  const unlockable: UnlockHint[] = [];

  for (const wo of workOrders) {
    if (TERMINAL_STATES.includes(wo.state)) continue;
    const set = buildAffordances(wo, role, service, { focusedId, gated: true });

    for (const affordance of set.available) {
      if (affordance.kind !== 'write' && affordance.kind !== 'destructive') continue;
      let score = 0;
      const why: string[] = [];
      for (const scorer of scorers) {
        const contribution = scorer.evaluate({ wo, affordance, now });
        if (!contribution) continue;
        score += contribution.delta;
        why.push(contribution.why);
      }
      scored.push({
        score,
        workOrderId: wo.id,
        workOrderTitle: wo.title,
        tool: affordance.tool,
        title: affordance.title,
        args: affordance.args,
        needs: affordance.needs,
        kind: affordance.kind,
        ...(affordance.prerequisite ? { prerequisite: affordance.prerequisite } : {}),
        why,
      });
    }

    for (const blocked of set.blocked) unlockable.push({ ...blocked, workOrderId: wo.id });
  }

  scored.sort((a, b) => b.score - a.score || a.workOrderId.localeCompare(b.workOrderId));
  return {
    recommendations: scored.slice(0, limit).map((r, i) => ({ rank: i + 1, ...r })),
    unlockable: unlockable.slice(0, limit),
  };
}
