import { z } from 'zod';
import { rankNextBestActions } from '../disclosure/nextBestAction.js';
import { recommendationList } from '../disclosure/ui.js';
import { TERMINAL_STATES } from '../domain/types.js';
import type { LevelContext } from '../levels/level.js';
import { toolError, toolOk } from './results.js';
import { LooseRecord } from './schemas.js';

/**
 * L4: dynamic next-best-action discovery across all work orders.
 * The server ranks what the *current role* can do right now, explains why, and says what a
 * different role would unlock. Because MCP hosts can reason, this is advice, not a fixed script.
 */
export function registerNextBestActionTool(ctx: LevelContext): void {
  ctx.server.registerTool(
    'next_best_actions',
    {
      title: 'Next best actions',
      description:
        'Ranked suggestions for what to do next across all active work orders (or one), with reasons, prerequisites and what a different role could unlock. Start here when unsure.',
      inputSchema: {
        id: z.string().optional().describe('Limit to one work order.'),
        limit: z.number().int().min(1).max(10).optional(),
      },
      outputSchema: {
        role: z.string(),
        focusedId: z.string().optional(),
        recommendations: z.array(LooseRecord),
        unlockable: z.array(LooseRecord),
        _ui: LooseRecord,
      },
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ id, limit }) => {
      const pool = id ? ctx.service.get(id) : undefined;
      if (pool && !pool.ok) return toolError(`${pool.error.code}: ${pool.error.message}`);
      const workOrders = pool?.ok ? [pool.value] : ctx.service.list().filter((wo) => !TERMINAL_STATES.includes(wo.state));

      const { recommendations, unlockable } = rankNextBestActions({
        workOrders,
        role: ctx.session.role,
        service: ctx.service,
        focusedId: ctx.session.focusedId,
        limit: limit ?? 5,
      });

      const top = recommendations[0];
      const text = top
        ? [
            `Top pick: ${top.title} on ${top.workOrderId} (score ${top.score}): ${top.why.join('; ') || 'no special signals'}.`,
            top.prerequisite ? `First call ${top.prerequisite.tool}(${JSON.stringify(top.prerequisite.args)}).` : `Call ${top.tool}(${JSON.stringify(top.args)}).`,
            unlockable.length ? `${unlockable.length} more action(s) would unlock with a different role.` : '',
          ]
            .filter(Boolean)
            .join('\n')
        : 'Nothing actionable for the current role.';

      return toolOk(
        {
          role: ctx.session.role,
          ...(ctx.session.focusedId ? { focusedId: ctx.session.focusedId } : {}),
          recommendations,
          unlockable,
          _ui: recommendationList(recommendations, unlockable),
        },
        text,
      );
    },
  );
}
