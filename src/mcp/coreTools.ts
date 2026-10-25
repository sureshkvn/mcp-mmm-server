import type { RegisteredTool } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { LevelContext } from '../levels/level.js';
import { PRIORITIES, ROLES, STATES } from '../domain/types.js';
import { project, type Detail } from './projection.js';
import { toolOk } from './results.js';
import type { ResponseShaper } from './shapers.js';

export interface CoreToolOptions {
  /** L3+: adds focus_work_order and lets id default to the focused work order. */
  focus: boolean;
}

/** Always-visible tools: discovery, creation, and the session controls that drive disclosure. */
export function registerCoreTools(
  ctx: LevelContext,
  shaper: ResponseShaper,
  options: CoreToolOptions,
): Map<string, RegisteredTool> {
  const { server, service, session } = ctx;
  const tools = new Map<string, RegisteredTool>();
  const idField = options.focus
    ? z.string().optional().describe('Work order id. Defaults to the focused work order.')
    : z.string().describe('Work order id, e.g. WO-1001.');

  tools.set(
    'search_work_orders',
    server.registerTool(
      'search_work_orders',
      {
        title: 'Search work orders',
        description: 'List work orders, optionally filtered by state, asset or free text.',
        inputSchema: {
          state: z.enum(STATES).optional(),
          asset_id: z.string().optional(),
          query: z.string().optional().describe('Matches id, title or asset.'),
          limit: z.number().int().min(1).max(50).optional(),
        },
        outputSchema: shaper.listOutputShape,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      },
      async ({ state, asset_id, query, limit }) => {
        const found = service.list({ state, assetId: asset_id, query }).slice(0, limit ?? 50);
        return shaper.list(found, ctx.shapeContext());
      },
    ),
  );

  tools.set(
    'get_work_order',
    server.registerTool(
      'get_work_order',
      {
        title: 'Get work order',
        description: shaper.detailAware
          ? 'Read one work order. Choose detail: summary < standard (default) < full (adds notes and history).'
          : 'Read one work order, including notes and history.',
        inputSchema: {
          id: idField,
          ...(shaper.detailAware ? { detail: z.enum(['summary', 'standard', 'full']).optional() } : {}),
        },
        outputSchema: shaper.outputShape,
        annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
      },
      async (args: { id?: string; detail?: Detail }) => {
        const id = args.id ?? session.focusedId;
        if (!id) {
          return shaper.failure({ code: 'invalid_input', message: 'No id given and no work order is focused.' }, undefined, ctx.shapeContext());
        }
        const found = service.get(id);
        const sc = ctx.shapeContext();
        if (!found.ok) return shaper.failure(found.error, undefined, sc);
        return shaper.success(found.value, `${found.value.id}: ${found.value.title}`, sc, args.detail);
      },
    ),
  );

  tools.set(
    'create_work_order',
    server.registerTool(
      'create_work_order',
      {
        title: 'Create work order',
        description: options.focus
          ? 'Create a draft work order. It becomes the focused work order, which discloses the tools that act on it.'
          : 'Create a draft work order.',
        inputSchema: {
          title: z.string().min(3),
          asset_id: z.string().min(2).describe('Asset id, e.g. PUMP-204.'),
          priority: z.enum(PRIORITIES).default('normal'),
          due_in_hours: z.number().min(0).optional(),
        },
        outputSchema: shaper.outputShape,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
      },
      async ({ title, asset_id, priority, due_in_hours }) => {
        const wo = service.create({ title, assetId: asset_id, priority, dueInHours: due_in_hours }, session.role);
        if (options.focus) session.focus(wo.id);
        return shaper.success(wo, `Created ${wo.id} as draft${options.focus ? ' and focused it' : ''}.`, ctx.shapeContext());
      },
    ),
  );

  if (options.focus) {
    tools.set(
      'focus_work_order',
      server.registerTool(
        'focus_work_order',
        {
          title: 'Focus work order',
          description:
            'Select the work order you intend to act on. The tools that apply to its current state and your role are disclosed (the tool list changes).',
          inputSchema: { id: z.string().describe('Work order id, e.g. WO-1002.') },
          outputSchema: shaper.outputShape,
          annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
        },
        async ({ id }) => {
          const found = ctx.service.get(id);
          if (!found.ok) return shaper.failure(found.error, undefined, ctx.shapeContext());
          session.focus(found.value.id);
          return shaper.success(found.value, `Focused ${found.value.id}.`, ctx.shapeContext());
        },
      ),
    );
  }

  tools.set(
    'switch_role',
    server.registerTool(
      'switch_role',
      {
        title: 'Switch role (demo only)',
        description:
          'DEMO ONLY: change the acting role so you can watch tool disclosure react to authority. Real deployments derive the role from verified OAuth claims, never from a tool argument.',
        inputSchema: { role: z.enum(ROLES) },
        outputSchema: {
          role: z.enum(ROLES),
          focusedId: z.string().optional(),
          _disclosure: z.record(z.string(), z.array(z.string())).optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ role }) => {
        session.setRole(role);
        const sc = ctx.shapeContext();
        return toolOk(
          { role, ...(session.focusedId ? { focusedId: session.focusedId } : {}), ...(sc.delta ? { _disclosure: { ...sc.delta } } : {}) },
          `Now acting as ${role}.${sc.delta ? ` Tool surface changed: ${JSON.stringify(sc.delta)}` : ''}`,
        );
      },
    ),
  );

  void project; // projection is applied inside the shapers
  return tools;
}
