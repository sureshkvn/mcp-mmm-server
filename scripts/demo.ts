/**
 * End-to-end demo over an in-memory transport:
 *   Part 1 - the same domain exposed at L0..L4 (what each level gives an agent)
 *   Part 2 - a live L4 session showing progressive disclosure, list_changed, completion,
 *            resource templates, prompt templates and next-best-action discovery.
 *
 * Run: npm run demo
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  PromptListChangedNotificationSchema,
  ResourceListChangedNotificationSchema,
  ToolListChangedNotificationSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { LEVELS } from '../src/levels/index.js';
import type { LevelId } from '../src/levels/level.js';
import { createServer } from '../src/server.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const heading = (text: string) => console.log(`\n${'='.repeat(72)}\n${text}\n${'='.repeat(72)}`);
const step = (text: string) => console.log(`\n--- ${text}`);

interface Connection {
  client: Client;
  counts: { tools: number; prompts: number; resources: number };
  lastTools: Set<string>;
  lastPrompts: Set<string>;
}

async function connect(level: LevelId): Promise<Connection> {
  const { server } = createServer(level);
  const client = new Client({ name: 'mmm-demo', version: '1.0.0' });
  const counts = { tools: 0, prompts: 0, resources: 0 };
  client.setNotificationHandler(ToolListChangedNotificationSchema, async () => void counts.tools++);
  client.setNotificationHandler(PromptListChangedNotificationSchema, async () => void counts.prompts++);
  client.setNotificationHandler(ResourceListChangedNotificationSchema, async () => void counts.resources++);

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, counts, lastTools: new Set(), lastPrompts: new Set() };
}

const names = (items: { name: string }[]) => items.map((i) => i.name).sort();

async function tryList<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

/** Re-list tools/prompts after any notifications, and report exactly what the server announced. */
async function surface(conn: Connection, label: string): Promise<void> {
  await sleep(30);
  const { client, counts } = conn;
  const tools = new Set(names((await client.listTools()).tools));
  const prompts = new Set(
    names((await tryList(() => client.listPrompts(), { prompts: [] as { name: string }[] })).prompts),
  );

  const diff = (now: Set<string>, before: Set<string>) => ({
    added: [...now].filter((n) => !before.has(n)),
    removed: [...before].filter((n) => !now.has(n)),
  });
  const t = diff(tools, conn.lastTools);
  const p = diff(prompts, conn.lastPrompts);

  console.log(`  [${label}]`);
  console.log(
    `  notifications: tools/list_changed x${counts.tools}, prompts/list_changed x${counts.prompts}, resources/list_changed x${counts.resources}`,
  );
  console.log(`  tools (${tools.size}): ${[...tools].join(', ')}`);
  if (t.added.length || t.removed.length) console.log(`    +${t.added.join(', +') || '-'}  -${t.removed.join(', -') || '-'}`);
  console.log(`  prompts (${prompts.size}): ${[...prompts].join(', ') || '(none)'}`);
  if (p.added.length || p.removed.length) console.log(`    +${p.added.join(', +') || '-'}  -${p.removed.join(', -') || '-'}`);

  counts.tools = counts.prompts = counts.resources = 0;
  conn.lastTools = tools;
  conn.lastPrompts = prompts;
}

async function call(client: Client, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as { type: string; text?: string }[]).find((c) => c.type === 'text')?.text ?? '';
  return { text, data: result.structuredContent as Record<string, any> | undefined, isError: Boolean(result.isError) };
}

async function partOne(): Promise<void> {
  heading('PART 1 - Same domain, five MCP maturity levels');
  for (const id of [0, 1, 2, 3, 4] as LevelId[]) {
    const { client } = await connect(id);
    const tools = (await client.listTools()).tools;
    const resources = await tryList(() => client.listResources(), { resources: [] });
    const templates = await tryList(() => client.listResourceTemplates(), { resourceTemplates: [] });
    const prompts = await tryList(() => client.listPrompts(), { prompts: [] });
    const annotated = tools.filter((t) => t.annotations && Object.keys(t.annotations).length).length;
    const typed = tools.filter((t) => t.outputSchema).length;

    console.log(`\n${LEVELS[id].name}`);
    console.log(`  ${LEVELS[id].summary}`);
    console.log(
      `  tools=${tools.length} (annotated=${annotated}, output-schema=${typed})  resources=${resources.resources.length}  templates=${templates.resourceTemplates.length}  prompts=${prompts.prompts.length}`,
    );
    await client.close();
  }
}

async function partTwo(): Promise<void> {
  heading('PART 2 - Live L4 session: progressive disclosure + list_changed + next-best-action');
  const conn = await connect(4);
  const { client } = conn;

  step('Initial surface (only core tools are disclosed)');
  await surface(conn, 'after initialize');

  step('Resource templates (L3+): parameterised, enumerable, completable');
  const templates = (await client.listResourceTemplates()).resourceTemplates;
  for (const t of templates) console.log(`  ${t.uriTemplate}`);
  const completion = await client.complete({
    ref: { type: 'ref/resource', uri: 'workorder://{id}' },
    argument: { name: 'id', value: 'WO-100' },
  });
  console.log(`  complete id "WO-100" -> ${completion.completion.values.join(', ')}`);

  step('Dynamic next-best-action as a technician (all work orders)');
  let r = await call(client, 'next_best_actions', { limit: 3 });
  console.log(r.text.split('\n').map((l) => `  ${l}`).join('\n'));
  for (const rec of r.data!.recommendations) {
    console.log(`  #${rec.rank} ${rec.title} ${rec.workOrderId} score=${rec.score} [${rec.why.join('; ')}]`);
  }

  step('Focus WO-1002 (submitted) -> tools disclosed for this state and role');
  r = await call(client, 'focus_work_order', { id: 'WO-1002' });
  console.log(r.text.split('\n').map((l) => `  ${l}`).join('\n'));
  await surface(conn, 'after focus_work_order(WO-1002) as technician');
  console.log(`  _blocked: ${r.data!._blocked.map((b: any) => `${b.tool} (${b.reason})`).join('; ')}`);

  step('Calling a tool that is not disclosed is rejected, not just hidden');
  r = await call(client, 'approve_work_order', { id: 'WO-1002' });
  console.log(`  approve_work_order as technician -> isError=${r.isError}: ${r.text}`);

  step('Switch to manager -> approve/reject/cancel appear');
  r = await call(client, 'switch_role', { role: 'manager' });
  await surface(conn, 'after switch_role(manager)');

  step('Next-best-action as manager (with rationale and what it unlocks)');
  r = await call(client, 'next_best_actions', { limit: 6 });
  for (const rec of r.data!.recommendations) {
    const pre = rec.prerequisite ? ` (first: ${rec.prerequisite.tool})` : '';
    console.log(`  #${rec.rank} ${rec.title} ${rec.workOrderId} score=${rec.score}${pre} [${rec.why.join('; ')}]`);
  }
  console.log(`  declarative UI hint: ${r.data!._ui.component} with ${r.data!._ui.items.length} item(s)`);

  step('Approve WO-1002 -> state machine moves; approve leaves, start_work arrives');
  r = await call(client, 'approve_work_order', { comment: 'ok to proceed' });
  console.log(`  ${r.text.split('\n')[0]}`);
  await surface(conn, 'after approve_work_order');

  step('Focus WO-1004 (in_progress) -> complete tool AND close_out_checklist prompt appear');
  await call(client, 'focus_work_order', { id: 'WO-1004' });
  await surface(conn, 'after focus_work_order(WO-1004)');

  step('Advisory ranking: completing with no findings is allowed but ranked below documenting');
  r = await call(client, 'next_best_actions', { id: 'WO-1004' });
  for (const rec of r.data!.recommendations) {
    console.log(`  #${rec.rank} ${rec.title} score=${rec.score} [${rec.why.join('; ')}]`);
  }

  step('Errors teach: a visible tool aimed at the wrong target says what IS possible');
  r = await call(client, 'cancel_work_order', { id: 'WO-1005', reason: 'testing a wrong-state call' });
  console.log(`  cancel_work_order on completed WO-1005 -> isError=${r.isError}: ${r.text.split('\n').join(' | ')}`);
  r = await call(client, 'start_work', { id: 'WO-1004' });
  console.log(`  start_work (not disclosed while WO-1004 is in_progress) -> isError=${r.isError}: ${r.text}`);

  step('Prompt templates: triage_work_order (args completable, content built from live state)');
  const prompt = await client.getPrompt({ name: 'triage_work_order', arguments: { id: 'WO-1004' } });
  console.log(`  ${prompt.messages.length} messages; embedded resources: ${prompt.messages.filter((m) => m.content.type === 'resource').map((m: any) => m.content.resource.uri).join(', ')}`);

  step('Document, then complete -> surface collapses; close_out_checklist prompt withdrawn');
  await call(client, 'add_note', { text: 'Found failing temperature sensor; replaced.' });
  r = await call(client, 'complete_work_order', { resolution: 'Replaced temperature sensor, cleared alarm.', labor_hours: 1.5 });
  console.log(`  ${r.text.split('\n')[0]}`);
  await surface(conn, 'after complete_work_order');

  step('Create a work order -> resources/list_changed, and a new URI exists via the template');
  r = await call(client, 'create_work_order', { title: 'Replace air filter', asset_id: 'GEN-007', priority: 'low' });
  console.log(`  ${r.text.split('\n')[0]}`);
  await surface(conn, 'after create_work_order');
  const read = await client.readResource({ uri: 'workorder://WO-1006' });
  console.log(`  read workorder://WO-1006 -> ${(read.contents[0] as any).text.replace(/\s+/g, ' ').slice(0, 110)}...`);

  await client.close();
}

await partOne();
await partTwo();
console.log('\nDone.');
