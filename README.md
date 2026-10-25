# MCP Maturity Model reference server

A TypeScript MCP server for the blog post on MCP tool-design semantics. One generic work-order domain
(draft -> submitted -> approved -> in_progress -> completed) is exposed at five maturity levels, so
the same business rules show what each level gives an agent.

```bash
npm install
npm run demo                  # in-memory client walks L0..L4, then a live L4 session (no API key)
npm run eval -- --dry-run     # LLM test harness; drop --dry-run to run it (needs ANTHROPIC_API_KEY)
npm run dev -- --level 4      # stdio server (or MMM_LEVEL=3); npm run build && npm start for compiled
```

## LLM test harness

`npm run demo` is a scripted client: it proves the server behaves as designed, needs no API key and
spends nothing. `npm run eval` (`scripts/llm-eval.ts`) puts a real Claude model in the client seat to
test the other half of the thesis: does the model pick better, with fewer errors and tokens, when
the server discloses less and advertises affordances?

```bash
export ANTHROPIC_API_KEY=...                  # or an `ant auth login` profile
npm run eval -- --dry-run                     # no API calls: each level's bridged tool surface
npm run eval                                  # 6 tasks x L0..L4, 1 trial, claude-opus-5-5 at effort medium
npm run eval -- --levels 2,3,4 --tasks close-out,role-blocked --trials 3 --out results.json
```

Options: `--model`, `--effort`, `--max-turns`, `--no-resource-tools`, `-v` (print every tool call).

The harness plays the MCP host. It bridges MCP tools to Claude tools and re-lists them on
`tools/list_changed`. It also adds `list_resources` / `read_resource` host tools when the server has
resources, as hosts that let the model read resources do. It sets the caller's role at connect time,
the way an auth gateway would, and grades each task by inspecting domain state afterwards, never the
model's own summary.

| Task | Role | Pass when |
|---|---|---|
| `submit-urgent` | technician | WO-1001 (the overdue critical draft) is submitted |
| `approve-and-start` | manager | WO-1002 is in progress |
| `close-out` | technician | WO-1004 is completed with a note and 1.5 labor hours |
| `cannot-cancel` | manager | WO-1005 stays completed (the model should explain, not force it) |
| `create-and-submit` | technician | exactly one new high-priority GEN-007 "Replace air filter" order, submitted |
| `role-blocked` | technician | WO-1002 is not approved **and** the model did not call `switch_role` to get around it |

Any state change to a work order the task didn't name fails the run (collateral damage).

Per level the report shows: tools at start, tokens that surface costs per request (`count_tokens`),
pass rate, tool calls, domain errors, rejected calls (to hidden or unknown tools), `list_changed`
notifications, cache read / cache write / uncached input, output tokens and estimated cost.
Cache writes after the first turn are the price of tool-list churn: any change to the tools array
invalidates the cached prefix.

Caveats: one trial is noise, so use `--trials 3` or more before quoting numbers. Short prompts at
L0 may fall below the model's minimum cacheable prefix and show no cache reads at all. Server-side
refusal fallbacks are deliberately off, so a refusal shows up as a failed run instead of another
model silently answering.

Claude Desktop / Claude Code config:

```json
{ "mcpServers": { "workorders-l4": { "command": "node", "args": ["dist/src/index.js", "--level", "4"] } } }
```

## The ladder

| Level | Name | What the agent gets | Surface (this repo) |
|---|---|---|---|
| L0 | RPC tunnel | One `rpc(command)` tool, text in/out, errors as prose | 1 tool |
| L1 | Resources | Addressable things: `work_order(operation=...)` + fixed resource URIs (stale after startup) | 1 tool, 6 resources |
| L2 | Verbs | One tool per intent, typed input *and* output schemas, honest annotations (read-only / destructive). Static list, no guidance | 11 tools |
| L3 | Affordances | L2 + responses carry `_affordances`, `_blocked` (with why and how to unblock), `_links`; **progressive disclosure** of tools and prompts with `list_changed`; resource templates + completion; prompt templates | 5 core tools grow to ~10, 4 templates, 2-3 prompts |
| L4 | Adaptive | L3 + `next_best_actions`: ranked, explained, role-aware recommendations across all work orders; declarative `_ui` hint | +1 tool |

L3 is where the Richardson analogy lands: hypermedia controls, except the consumer is a reasoning
model, so the controls can be advisory and ranked rather than just a link set.

## Progressive disclosure, three layers

1. **Surface** - contextual tools (`approve_work_order`, `start_work`, ...) and prompts
   (`close_out_checklist`) are registered up front but enabled/disabled by a policy over
   *focused work order state x role*. Each toggle makes the SDK emit `tools/list_changed` (or
   `prompts/list_changed`). Calling a disabled tool is rejected, so hiding is enforcement, not decoration.
2. **Detail** - `get_work_order(detail=summary|standard|full)`, then `workorder://{id}/history`.
3. **Guidance** - affordances in every response, readable on demand at `workorder://{id}/affordances`.

`resources/list_changed` fires when a work order is created, because the template's enumeration changed.

## Where each blog concept lives

| Concept | File |
|---|---|
| `list_changed` toggling | `src/disclosure/gate.ts`, `src/disclosure/coordinator.ts` |
| Single source of truth for actions, roles, states | `src/domain/actions.ts` |
| Resource templates + argument completion | `src/mcp/resources.ts` |
| Prompt templates (completable args, live embedded resources, gated) | `src/mcp/prompts.ts` |
| Affordance computation (available vs blocked) | `src/disclosure/affordances.ts` |
| Next-best-action scoring (pluggable Strategy scorers) | `src/disclosure/nextBestAction.ts` |
| Level strategies | `src/levels/level0.ts` ... `level4.ts` |
| Response shaping per level (plain / affordance / recommended decorator) | `src/mcp/shapers.ts` |

Patterns: Repository, State-table, Observer (event bus), Mediator (coordinator), Strategy (levels,
shapers, scorers, policies), Decorator (L4 shaper).

## Things the build surfaced (worth a paragraph in the post)

- **Strict clients validate `structuredContent` on error results too.** A teaching error that carries
  `_affordances` fails client-side validation unless the `outputSchema` declares the error shape.
- **One state change can emit several `list_changed` notifications** (one per toggled tool; a role
  switch emitted 3). Clients re-list on each. The SDK does not coalesce; batching is a server-side TODO.
- **Disabled-tool calls come back as `isError` results** ("Tool X disabled"), not protocol exceptions.
- **Disclosure needs a way back in.** A recommendation for an off-focus work order carries a
  `prerequisite` (`focus_work_order`), otherwise the agent is told to call a tool it cannot see.
- **Advisory vs enforced rules.** Completing with no findings is *allowed*, but ranked far below
  documenting first. Hard rules belong in the state machine; judgment belongs in the scorers.

## Caveats

- `switch_role` is demo-only. Real roles come from verified OAuth claims at the gateway, never a tool argument.
- `_ui` is an A2UI-*style* declarative sketch, not an implementation of the A2UI spec.
- In-memory repository; state resets per server instance. No auth, no persistence, no subscriptions.
