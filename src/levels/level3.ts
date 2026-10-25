import { DisclosureCoordinator } from '../disclosure/coordinator.js';
import { DisclosureGate, policies } from '../disclosure/gate.js';
import { ACTION_BY_ID } from '../domain/actions.js';
import { registerCoreTools } from '../mcp/coreTools.js';
import { registerPrompts } from '../mcp/prompts.js';
import { registerAbout, registerResourceTemplates } from '../mcp/resources.js';
import { createAffordanceShaper, type ResponseShaper } from '../mcp/shapers.js';
import { registerVerbTools } from '../mcp/verbTools.js';
import type { LevelContext, MaturityLevel } from './level.js';

/**
 * Shared wiring for L3 and L4: progressive disclosure of tools and prompts, resource templates,
 * and the coordinator that turns domain/session changes into list_changed notifications.
 */
export function registerAffordanceSurface(ctx: LevelContext, shaper: ResponseShaper, aboutMarkdown: string): DisclosureGate {
  const gate = new DisclosureGate();

  registerAbout(ctx.server, aboutMarkdown);
  registerCoreTools(ctx, shaper, { focus: true }); // always visible: no gate entry needed
  registerResourceTemplates(ctx);

  // Contextual tools: hidden until the focused work order's state and the caller's role permit them.
  for (const [actionId, handle] of registerVerbTools(ctx, shaper, { idMode: 'defaultsToFocus' })) {
    gate.add('tool', ACTION_BY_ID[actionId].tool, handle, policies.actionAvailable(ctx.service, actionId));
  }

  // Prompt templates are disclosed the same way.
  for (const prompt of registerPrompts(ctx)) gate.add('prompt', prompt.name, prompt.handle, prompt.policy);

  ctx.coordinator = new DisclosureCoordinator({
    server: ctx.server,
    service: ctx.service,
    session: ctx.session,
    gate,
    bus: ctx.bus,
  });
  ctx.coordinator.start();
  return gate;
}

/**
 * L3 "Affordances" (hypermedia for agents): every response carries what can happen next, what is
 * blocked and why, and links to deeper resources. The tool list itself is progressively disclosed
 * and the server announces changes with tools/list_changed.
 */
export const level3: MaturityLevel = {
  id: 3,
  name: 'L3 - Affordances',
  summary: 'Responses advertise next actions; tools and prompts are disclosed by state and role via list_changed; resource templates and prompt templates.',
  instructions: [
    'This server uses progressive disclosure: the tool list changes as you work.',
    'Call focus_work_order(id) to select what you are acting on; tools that apply then appear (you will receive tools/list_changed).',
    'Every response includes _affordances (what you can do now), _blocked (and why) and _links (deeper resources). Prefer those over guessing.',
  ].join('\n'),
  register(ctx) {
    registerAffordanceSurface(
      ctx,
      createAffordanceShaper(ctx.service),
      '# L3 - Affordances\nTools and prompts appear and disappear with state and role (list_changed). Responses carry `_affordances`, `_blocked` and `_links`. Resource templates replace the static resource list.',
    );
  },
};
