import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { ACTIONS } from '../domain/actions.js';
import type { ActionId, ActionPayload } from '../domain/types.js';
import type { LevelContext } from '../levels/level.js';
import type { ResponseShaper } from './shapers.js';

export interface VerbToolOptions {
  /** L2 requires an explicit id; L3+ defaults to the focused work order. */
  idMode: 'required' | 'defaultsToFocus';
}

const EXTRA_INPUT: Record<ActionId, Record<string, z.ZodType>> = {
  submit: {},
  approve: { comment: z.string().optional() },
  reject: { reason: z.string().min(3) },
  start: {},
  complete: {
    resolution: z.string().min(3).describe('What was found and fixed.'),
    labor_hours: z.number().min(0),
  },
  cancel: { reason: z.string().min(3) },
  add_note: { text: z.string().min(1) },
};

const toPayload = (args: Record<string, unknown>): ActionPayload => ({
  comment: args.comment as string | undefined,
  reason: args.reason as string | undefined,
  text: args.text as string | undefined,
  resolution: args.resolution as string | undefined,
  laborHours: args.labor_hours as number | undefined,
});

/**
 * One tool per workflow verb, generated from the action catalog. Annotations tell the host which
 * calls are safe to auto-approve (read-only) and which deserve a confirmation (destructive).
 */
export function registerVerbTools(
  ctx: LevelContext,
  shaper: ResponseShaper,
  options: VerbToolOptions,
): Map<ActionId, RegisteredTool> {
  const handles = new Map<ActionId, RegisteredTool>();
  const idField =
    options.idMode === 'required'
      ? z.string().describe('Work order id, e.g. WO-1001.')
      : z.string().optional().describe('Work order id. Defaults to the focused work order.');

  for (const spec of ACTIONS) {
    const handle = ctx.server.registerTool(
      spec.tool,
      {
        title: spec.title,
        description: spec.description,
        inputSchema: { id: idField, ...EXTRA_INPUT[spec.id] },
        outputSchema: shaper.outputShape,
        annotations: {
          readOnlyHint: false,
          destructiveHint: spec.kind === 'destructive',
          idempotentHint: false,
          openWorldHint: false,
        },
      },
      async (args: Record<string, unknown>) => {
        const id = (args.id as string | undefined) ?? ctx.session.focusedId;
        if (!id) {
          return shaper.failure(
            { code: 'invalid_input', message: 'No id given and no work order is focused.' },
            undefined,
            ctx.shapeContext(),
          );
        }

        const result = ctx.service.apply(spec.id, id, ctx.session.role, toPayload(args));
        // Build the shape context only now: domain events fired during apply() may have changed
        // the disclosed surface, and the response should report that.
        const sc = ctx.shapeContext();
        if (!result.ok) {
          const current = ctx.service.get(id);
          return shaper.failure(result.error, current.ok ? current.value : undefined, sc);
        }
        return shaper.success(result.value, `${spec.title}: ${result.value.id} is now "${result.value.state}".`, sc);
      },
    );
    handles.set(spec.id, handle);
  }
  return handles;
}
