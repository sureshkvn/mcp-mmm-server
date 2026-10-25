import { registerCoreTools } from '../mcp/coreTools.js';
import { registerAbout, registerStaticResources } from '../mcp/resources.js';
import { plainShaper } from '../mcp/shapers.js';
import { registerVerbTools } from '../mcp/verbTools.js';
import type { MaturityLevel } from './level.js';

/**
 * L2 "Verbs": one tool per intent, with typed input/output schemas and honest annotations
 * (read-only, destructive). Hosts can now auto-approve reads and confirm cancellations.
 * But the surface is static and flat: every tool is always listed, full objects are always
 * returned, and nothing tells the agent which verb makes sense *right now*.
 */
export const level2: MaturityLevel = {
  id: 2,
  name: 'L2 - Verbs',
  summary: 'Intent-shaped tools with schemas and annotations; static tool list; no guidance on what to do next.',
  instructions: 'Tools map one-to-one to workflow verbs. Pass explicit work order ids.',
  register(ctx) {
    registerAbout(ctx.server, '# L2 - Verbs\nTyped tools with annotations. The tool list never changes and responses never suggest next steps.');
    registerStaticResources(ctx);
    registerCoreTools(ctx, plainShaper, { focus: false });
    registerVerbTools(ctx, plainShaper, { idMode: 'required' });
  },
};
