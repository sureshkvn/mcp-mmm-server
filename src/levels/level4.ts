import { registerNextBestActionTool } from '../mcp/adaptiveTools.js';
import { createAffordanceShaper, withRecommendations } from '../mcp/shapers.js';
import type { MaturityLevel } from './level.js';
import { level3, registerAffordanceSurface } from './level3.js';

/**
 * L4 "Adaptive": L3 plus a policy-driven recommender. The server ranks next-best actions from live
 * state, role, priority, due dates and documentation gaps, explains why, says what a different role
 * would unlock, and ships a declarative UI hint the host may render however it likes.
 */
export const level4: MaturityLevel = {
  id: 4,
  name: 'L4 - Adaptive',
  summary: 'L3 plus ranked next-best-action discovery with rationale, and a declarative UI hint (A2UI-style sketch).',
  instructions: `${level3.instructions}\nWhen unsure what to do, call next_best_actions. It ranks open work orders and explains why.`,
  register(ctx) {
    const shaper = withRecommendations(createAffordanceShaper(ctx.service), ctx.service);
    registerAffordanceSurface(
      ctx,
      shaper,
      '# L4 - Adaptive\nEverything in L3, plus `next_best_actions` (ranked, explained, role-aware) and a declarative `_ui` hint on responses.',
    );
    registerNextBestActionTool(ctx);
  },
};
