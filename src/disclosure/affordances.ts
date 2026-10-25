import { ACTIONS } from '../domain/actions.js';
import type { WorkOrderService } from '../domain/service.js';
import type { Role, WorkOrder } from '../domain/types.js';

export interface ToolCallHint {
  tool: string;
  args: Record<string, unknown>;
}

/** Something the agent can do next, computed from current state: the "H" in HATEOAS. */
export interface Affordance {
  rel: string;
  tool: string;
  title: string;
  description: string;
  args: Record<string, unknown>;
  /** Argument names the caller still has to supply. */
  needs: string[];
  kind: 'read' | 'write' | 'destructive' | 'session';
  /** Call this first (e.g. focus the work order) or the tool will not be visible. */
  prerequisite?: ToolCallHint;
}

/** Something that exists in this state but is not available to the current role. Explains *why*. */
export interface BlockedAffordance {
  rel: string;
  tool: string;
  title: string;
  reason: string;
  unblock?: ToolCallHint;
}

export interface ResourceLink {
  rel: string;
  uri: string;
  description: string;
}

export interface AffordanceSet {
  available: Affordance[];
  blocked: BlockedAffordance[];
  links: ResourceLink[];
}

export interface AffordanceOptions {
  focusedId?: string;
  /** True when tools are progressively disclosed (L3+): off-focus actions need a focus step first. */
  gated: boolean;
}

export function buildAffordances(
  wo: WorkOrder,
  role: Role,
  service: WorkOrderService,
  options: AffordanceOptions,
): AffordanceSet {
  const available: Affordance[] = [];
  const blocked: BlockedAffordance[] = [];
  const needsFocus = options.gated && options.focusedId !== wo.id;
  const prerequisite: ToolCallHint | undefined = needsFocus
    ? { tool: 'focus_work_order', args: { id: wo.id } }
    : undefined;

  for (const spec of ACTIONS) {
    const verdict = service.check(spec.id, wo, role);
    if (verdict.ok) {
      available.push({
        rel: spec.id,
        tool: spec.tool,
        title: spec.title,
        description: spec.description,
        args: { id: wo.id },
        needs: [...spec.needs],
        kind: spec.kind,
        ...(prerequisite ? { prerequisite } : {}),
      });
    } else if (verdict.error.code === 'forbidden') {
      blocked.push({
        rel: spec.id,
        tool: spec.tool,
        title: spec.title,
        reason: verdict.error.message,
        unblock: { tool: 'switch_role', args: { role: spec.roles[0] } },
      });
    }
    // invalid_state: the action simply does not exist in this state, so it is not advertised at all.
  }

  available.push({
    rel: 'inspect',
    tool: 'get_work_order',
    title: 'Inspect in full detail',
    description: 'Read notes and history for this work order.',
    args: { id: wo.id, detail: 'full' },
    needs: [],
    kind: 'read',
  });

  if (needsFocus) {
    available.push({
      rel: 'focus',
      tool: 'focus_work_order',
      title: 'Focus this work order',
      description: 'Disclose the tools that act on this work order.',
      args: { id: wo.id },
      needs: [],
      kind: 'session',
    });
  }

  const links: ResourceLink[] = [
    { rel: 'self', uri: `workorder://${wo.id}`, description: 'Current snapshot' },
    { rel: 'history', uri: `workorder://${wo.id}/history`, description: 'Audit trail' },
    { rel: 'affordances', uri: `workorder://${wo.id}/affordances`, description: 'What can happen next' },
    {
      rel: 'asset',
      uri: `asset://${wo.assetId}/work-orders`,
      description: `All work orders for ${wo.assetId}`,
    },
  ];

  return { available, blocked, links };
}
