import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import type { DisclosureDelta } from '../disclosure/coordinator.js';
import { buildAffordances } from '../disclosure/affordances.js';
import { rankNextBestActions } from '../disclosure/nextBestAction.js';
import { workOrderCard } from '../disclosure/ui.js';
import type { WorkOrderService } from '../domain/service.js';
import type { DomainError, Role, WorkOrder } from '../domain/types.js';
import { project, type Detail } from './projection.js';
import { toolError, toolOk } from './results.js';
import { DisclosureDeltaSchema, LooseRecord, WorkOrderViewSchema } from './schemas.js';

export interface ShapeContext {
  role: Role;
  focusedId?: string;
  delta?: DisclosureDelta;
}

type Shape = Record<string, z.ZodType>;

/**
 * Strategy that decides *how a result is presented*. The tools and business rules stay identical
 * across maturity levels; only the shaper changes:
 *   plain       (L2): typed data, nothing else
 *   affordance  (L3): data + what you can do next + links + what just got disclosed
 *   recommended (L4): affordance + ranked advice + a declarative UI hint (decorator)
 */
export interface ResponseShaper {
  readonly detailAware: boolean;
  readonly outputShape: Shape;
  readonly listOutputShape: Shape;
  success(wo: WorkOrder, message: string, ctx: ShapeContext, detail?: Detail): CallToolResult;
  failure(error: DomainError, wo: WorkOrder | undefined, ctx: ShapeContext): CallToolResult;
  list(workOrders: WorkOrder[], ctx: ShapeContext): CallToolResult;
}

/** L2: well-typed, accurately annotated, but silent about what to do next. */
export const plainShaper: ResponseShaper = {
  detailAware: false,
  outputShape: { workOrder: WorkOrderViewSchema },
  listOutputShape: { workOrders: z.array(WorkOrderViewSchema), count: z.number() },
  success: (wo, message) => toolOk({ workOrder: project(wo, 'full') }, message),
  failure: (error) => toolError(`${error.code}: ${error.message}`),
  list: (workOrders) =>
    toolOk(
      { workOrders: workOrders.map((wo) => project(wo, 'full')), count: workOrders.length },
      `${workOrders.length} work order(s).`,
    ),
};

/** L3: every response is a hypermedia document. */
export function createAffordanceShaper(service: WorkOrderService): ResponseShaper {
  const affordancesOf = (wo: WorkOrder, ctx: ShapeContext) =>
    buildAffordances(wo, ctx.role, service, { focusedId: ctx.focusedId, gated: true });

  return {
    detailAware: true,
    // One schema covers success and failure: strict clients validate structuredContent even when
    // isError is set, so the error payload has to be declared here too.
    outputShape: {
      workOrder: WorkOrderViewSchema.optional(),
      error: z.object({ code: z.string(), message: z.string() }).optional(),
      _affordances: z.array(LooseRecord).optional(),
      _blocked: z.array(LooseRecord).optional(),
      _links: z.array(LooseRecord).optional(),
      _disclosure: DisclosureDeltaSchema.optional(),
    },
    listOutputShape: {
      workOrders: z.array(WorkOrderViewSchema),
      count: z.number(),
      _links: z.array(LooseRecord),
      _hint: z.string(),
    },

    success(wo, message, ctx, detail = 'standard') {
      const set = affordancesOf(wo, ctx);
      const next = set.available.filter((a) => a.kind !== 'read' && a.kind !== 'session').map((a) => a.tool);
      const lines = [message];
      if (next.length) lines.push(`Next: ${next.join(', ')}`);
      if (set.blocked.length) lines.push(`Blocked for role "${ctx.role}": ${set.blocked.map((b) => b.tool).join(', ')}`);
      if (ctx.delta) lines.push(`Tool surface changed: ${JSON.stringify(ctx.delta)}`);
      return toolOk(
        {
          workOrder: project(wo, detail),
          _affordances: set.available,
          _blocked: set.blocked,
          _links: set.links,
          ...(ctx.delta ? { _disclosure: ctx.delta } : {}),
        },
        lines.join('\n'),
        set.links.filter((l) => l.rel === 'history' || l.rel === 'affordances'),
      );
    },

    // Errors teach: they say what *is* possible instead of just what failed.
    failure(error, wo, ctx) {
      const text = [`${error.code}: ${error.message}`];
      const structured: Record<string, unknown> = { error };
      if (wo) {
        const set = affordancesOf(wo, ctx);
        structured._affordances = set.available;
        structured._blocked = set.blocked;
        const usable = set.available.filter((a) => a.kind !== 'read' && a.kind !== 'session').map((a) => a.tool);
        text.push(usable.length ? `Possible now: ${usable.join(', ')}` : 'No actions are possible from this state.');
      }
      return toolError(text.join('\n'), structured);
    },

    list(workOrders, ctx) {
      const links = workOrders.map((wo) => ({ rel: wo.id, uri: `workorder://${wo.id}`, description: wo.title }));
      const hint = `Summaries only. Call focus_work_order(id) to act on one, or get_work_order(id, detail) to see more.`;
      return toolOk(
        { workOrders: workOrders.map((wo) => project(wo, 'summary')), count: workOrders.length, _links: links, _hint: hint },
        `${workOrders.length} work order(s). Role: ${ctx.role}. ${hint}`,
      );
    },
  };
}

/** L4: decorate the affordance shaper with ranked advice and a declarative UI hint. */
export function withRecommendations(inner: ResponseShaper, service: WorkOrderService): ResponseShaper {
  return {
    ...inner,
    outputShape: {
      ...inner.outputShape,
      _recommended: z.array(LooseRecord).optional(),
      _ui: LooseRecord.optional(),
    },
    success(wo, message, ctx, detail) {
      const base = inner.success(wo, message, ctx, detail);
      const { recommendations } = rankNextBestActions({
        workOrders: [wo],
        role: ctx.role,
        service,
        focusedId: ctx.focusedId,
        limit: 3,
      });
      return {
        ...base,
        structuredContent: {
          ...base.structuredContent,
          _recommended: recommendations,
          _ui: workOrderCard(wo, recommendations),
        },
      };
    },
  };
}
