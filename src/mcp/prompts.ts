import type { RegisteredPrompt } from '@modelcontextprotocol/sdk/server/mcp.js';
import { completable } from '@modelcontextprotocol/sdk/server/completable.js';
import type { GetPromptResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { buildAffordances } from '../disclosure/affordances.js';
import { policies, type DisclosurePolicy } from '../disclosure/gate.js';
import { ROLES, TERMINAL_STATES } from '../domain/types.js';
import type { LevelContext } from '../levels/level.js';
import { project } from './projection.js';

export interface PromptRegistration {
  name: string;
  handle: RegisteredPrompt;
  /** Prompts are progressively disclosed too: a close-out checklist only makes sense mid-job. */
  policy: DisclosurePolicy;
}

const embedded = (uri: string, value: unknown) =>
  ({
    type: 'resource' as const,
    resource: { uri, mimeType: 'application/json', text: JSON.stringify(value, null, 2) },
  });

export function registerPrompts(ctx: LevelContext): PromptRegistration[] {
  const { server, service, session } = ctx;
  const idArg = () =>
    completable(z.string().describe('Work order id, e.g. WO-1004.'), async (value) =>
      service.list().map((wo) => wo.id).filter((id) => id.toLowerCase().startsWith(value.toLowerCase())),
    );

  const failure = (message: string): GetPromptResult => ({
    messages: [{ role: 'user', content: { type: 'text', text: message } }],
  });

  const triage = server.registerPrompt(
    'triage_work_order',
    {
      title: 'Triage a work order',
      description: 'Assess urgency and pick exactly one next action from the live affordances.',
      argsSchema: { id: idArg() },
    },
    async ({ id }): Promise<GetPromptResult> => {
      const found = service.get(id);
      if (!found.ok) return failure(found.error.message);
      const wo = found.value;
      const set = buildAffordances(wo, session.role, service, { focusedId: session.focusedId, gated: true });
      return {
        description: `Triage ${wo.id}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `You are assisting an operations team that works through work orders. Triage work order ${wo.id} (acting role: ${session.role}).`,
                '1. Read the snapshot and the available affordances below.',
                '2. Judge urgency and what is blocking progress.',
                '3. Recommend exactly ONE next action chosen from the affordances. Do not invent tools.',
                '4. If that action lists a prerequisite, say to call it first.',
              ].join('\n'),
            },
          },
          { role: 'user', content: embedded(`workorder://${wo.id}`, project(wo, 'standard')) },
          { role: 'user', content: embedded(`workorder://${wo.id}/affordances`, set) },
        ],
      };
    },
  );

  const closeOut = server.registerPrompt(
    'close_out_checklist',
    {
      title: 'Close-out checklist',
      description: 'Verify findings, labor and resolution before completing. Disclosed only while a work order is in progress.',
      argsSchema: { id: idArg() },
    },
    async ({ id }): Promise<GetPromptResult> => {
      const found = service.get(id);
      if (!found.ok) return failure(found.error.message);
      const wo = found.value;
      return {
        description: `Close out ${wo.id}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: [
                `Walk me through closing out ${wo.id}. Check, in order:`,
                `- Findings recorded? (${wo.notes.length} note(s) so far; if none, call add_note first)`,
                '- Parts and labor accounted for? Ask for labor_hours if unknown.',
                '- A resolution that says what was found and what was fixed.',
                'Only then call complete_work_order.',
              ].join('\n'),
            },
          },
          { role: 'user', content: embedded(`workorder://${wo.id}`, project(wo, 'full')) },
        ],
      };
    },
  );

  const handoff = server.registerPrompt(
    'shift_handoff',
    {
      title: 'Shift handoff',
      description: 'Summarise open work for the next shift, tailored to the audience.',
      argsSchema: {
        audience: completable(z.enum(ROLES).describe('Who the handoff is for.'), async (value) =>
          ROLES.filter((r) => r.startsWith(value)),
        ),
      },
    },
    async ({ audience }): Promise<GetPromptResult> => {
      const open = service.list().filter((wo) => !TERMINAL_STATES.includes(wo.state));
      return {
        description: `Shift handoff for ${audience}`,
        messages: [
          {
            role: 'user',
            content: {
              type: 'text',
              text: `Write a shift handoff for a ${audience}. Group by priority, call out anything overdue, and end with the single most important action.`,
            },
          },
          { role: 'user', content: embedded('workorders://open', open.map((wo) => project(wo, 'standard'))) },
        ],
      };
    },
  );

  return [
    { name: 'triage_work_order', handle: triage, policy: policies.always },
    { name: 'close_out_checklist', handle: closeOut, policy: policies.focusedInState('in_progress') },
    { name: 'shift_handoff', handle: handoff, policy: policies.always },
  ];
}
