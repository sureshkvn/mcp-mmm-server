import { z } from 'zod';
import { ACTION_BY_ID } from '../domain/actions.js';
import { PRIORITIES, STATES, type ActionId } from '../domain/types.js';
import { registerAbout, registerStaticResources } from '../mcp/resources.js';
import type { LevelContext, MaturityLevel } from './level.js';

const text = (value: unknown, isError = false) => ({
  isError,
  content: [{ type: 'text' as const, text: typeof value === 'string' ? value : JSON.stringify(value, null, 2) }],
});

/**
 * L1 "Resources": things are now addressable (a noun-shaped tool plus fixed resource URIs),
 * but there is still one tool with an `operation` switch. Verbs are hidden inside an argument,
 * so hosts cannot annotate risk per operation, and nothing says which operation fits which state.
 */
export const level1: MaturityLevel = {
  id: 1,
  name: 'L1 - Resources',
  summary: 'Addressable work orders (fixed resource URIs) behind a single operation-switch tool.',
  instructions: 'Use the work_order tool; read workorder:// resources for snapshots.',
  register(ctx: LevelContext) {
    registerAbout(ctx.server, '# L1 - Resources\nOne `work_order` tool with an `operation` argument, plus a fixed list of resources captured at startup (new work orders will not appear).');
    registerStaticResources(ctx);

    ctx.server.registerTool(
      'work_order',
      {
        title: 'Work order',
        description:
          'Operate on work orders. operation: list | get | create | transition | note. transition needs action (submit|approve|reject|start|complete|cancel).',
        inputSchema: {
          operation: z.enum(['list', 'get', 'create', 'transition', 'note']),
          id: z.string().optional(),
          action: z.enum(['submit', 'approve', 'reject', 'start', 'complete', 'cancel']).optional(),
          state: z.enum(STATES).optional(),
          asset_id: z.string().optional(),
          title: z.string().optional(),
          priority: z.enum(PRIORITIES).optional(),
          text: z.string().optional(),
          reason: z.string().optional(),
          resolution: z.string().optional(),
          labor_hours: z.number().optional(),
        },
      },
      async (a) => {
        const { service, session } = ctx;
        switch (a.operation) {
          case 'list':
            return text(service.list({ state: a.state, assetId: a.asset_id }));
          case 'get': {
            const found = service.get(a.id ?? '');
            return found.ok ? text(found.value) : text(`Error: ${found.error.message}`, true);
          }
          case 'create': {
            if (!a.title || !a.asset_id) return text('Error: title and asset_id are required.', true);
            return text(service.create({ title: a.title, assetId: a.asset_id, priority: a.priority ?? 'normal' }, session.role));
          }
          case 'note': {
            const r = service.apply('add_note', a.id ?? '', session.role, { text: a.text });
            return r.ok ? text(r.value) : text(`Error: ${r.error.message}`, true);
          }
          case 'transition': {
            if (!a.action) return text('Error: action is required for transition.', true);
            const id: ActionId = ACTION_BY_ID[a.action].id;
            const r = service.apply(id, a.id ?? '', session.role, {
              reason: a.reason,
              resolution: a.resolution,
              laborHours: a.labor_hours,
            });
            return r.ok ? text(r.value) : text(`Error: ${r.error.message}`, true);
          }
        }
      },
    );
  },
};
