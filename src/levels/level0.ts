import { z } from 'zod';
import type { ActionId, ActionPayload, Priority } from '../domain/types.js';
import { PRIORITIES, ROLES, type WorkOrder } from '../domain/types.js';
import type { LevelContext, MaturityLevel } from './level.js';

const HELP = [
  'Commands:',
  '  list [state]',
  '  show <id>',
  '  new <asset> <priority> <title...>',
  '  do <action> <id> [args...]   (submit approve reject start complete cancel note)',
  '  role <technician|manager>',
].join('\n');

const line = (wo: WorkOrder) => `${wo.id} | ${wo.state} | ${wo.priority} | ${wo.assetId} | ${wo.title}`;

const ACTION_ALIASES: Record<string, ActionId> = {
  submit: 'submit',
  approve: 'approve',
  reject: 'reject',
  start: 'start',
  complete: 'complete',
  cancel: 'cancel',
  note: 'add_note',
};

function run(command: string, ctx: LevelContext): string {
  const [verb, ...rest] = command.trim().split(/\s+/);
  const { service, session } = ctx;

  switch (verb?.toLowerCase()) {
    case 'help':
    case undefined:
    case '':
      return HELP;

    case 'list': {
      const state = rest[0];
      const rows = service.list(state ? { state: state as WorkOrder['state'] } : {});
      return rows.length ? rows.map(line).join('\n') : 'No work orders.';
    }

    case 'show': {
      const found = service.get(rest[0] ?? '');
      return found.ok ? JSON.stringify(found.value, null, 2) : `ERR ${found.error.message}`;
    }

    case 'new': {
      const [asset, priority, ...title] = rest;
      if (!asset || !priority || title.length === 0) return 'ERR usage: new <asset> <priority> <title...>';
      if (!PRIORITIES.includes(priority as Priority)) return `ERR priority must be one of ${PRIORITIES.join(', ')}`;
      return `OK created ${line(service.create({ title: title.join(' '), assetId: asset, priority: priority as Priority }, session.role))}`;
    }

    case 'role': {
      const role = rest[0];
      if (!ROLES.includes(role as (typeof ROLES)[number])) return `ERR role must be one of ${ROLES.join(', ')}`;
      session.setRole(role as (typeof ROLES)[number]);
      return `OK role is now ${role}`;
    }

    case 'do': {
      const [name, id, ...args] = rest;
      const action = ACTION_ALIASES[name ?? ''];
      if (!action || !id) return 'ERR usage: do <action> <id> [args...]';
      const text = args.join(' ');
      let payload: ActionPayload = {};
      if (action === 'add_note') payload = { text };
      else if (action === 'reject' || action === 'cancel') payload = { reason: text };
      else if (action === 'approve') payload = { comment: text || undefined };
      else if (action === 'complete') payload = { laborHours: Number(args[0]), resolution: args.slice(1).join(' ') };
      const result = service.apply(action, id, session.role, payload);
      return result.ok ? `OK ${line(result.value)}` : `ERR ${result.error.message}`;
    }

    default:
      return `ERR unknown command "${verb}". Try: help`;
  }
}

/**
 * L0 "RPC tunnel": one opaque tool, a free-text command, free-text answers.
 * Everything works, nothing is discoverable, and every error comes back as ordinary text.
 */
export const level0: MaturityLevel = {
  id: 0,
  name: 'L0 - RPC tunnel',
  summary: 'One tool, a command string, plain-text replies. Powerful, opaque, undiscoverable.',
  instructions: 'Use the rpc tool. Send "help" for the command list.',
  register(ctx) {
    ctx.server.registerTool(
      'rpc',
      {
        title: 'RPC',
        description: 'Run a work order command. Send "help" to see commands.',
        inputSchema: { command: z.string() },
      },
      async ({ command }) => ({ content: [{ type: 'text', text: run(command, ctx) }] }),
    );
  },
};
