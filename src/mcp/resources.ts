import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ErrorCode, McpError, type ReadResourceResult } from '@modelcontextprotocol/sdk/types.js';
import { buildAffordances } from '../disclosure/affordances.js';
import type { WorkOrder } from '../domain/types.js';
import type { LevelContext } from '../levels/level.js';
import { project } from './projection.js';

const JSON_MIME = 'application/json';

const asJson = (uri: URL, value: unknown): ReadResourceResult => ({
  contents: [{ uri: uri.href, mimeType: JSON_MIME, text: JSON.stringify(value, null, 2) }],
});

const first = (value: string | string[] | undefined): string => (Array.isArray(value) ? value[0] ?? '' : value ?? '');

function requireWorkOrder(ctx: LevelContext, id: string): WorkOrder {
  const found = ctx.service.get(id);
  if (!found.ok) throw new McpError(ErrorCode.InvalidParams, found.error.message);
  return found.value;
}

/** Describes the maturity level being served, so a client (or a blog reader) can see what to expect. */
export function registerAbout(server: McpServer, markdown: string): void {
  server.registerResource(
    'about',
    'mmm://about',
    { title: 'About this server', description: 'Which MCP maturity level this is and what to try.', mimeType: 'text/markdown' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: markdown }] }),
  );
}

/**
 * L1/L2: a fixed list of concrete resources, enumerated once at startup.
 * Addressable, but stale as soon as anything is created, and no way to ask for "the history of X".
 */
export function registerStaticResources(ctx: LevelContext): void {
  for (const wo of ctx.service.list()) {
    ctx.server.registerResource(
      `work-order-${wo.id}`,
      `workorder://${wo.id}`,
      { title: `${wo.id} ${wo.title}`, description: 'Work order snapshot', mimeType: JSON_MIME },
      async (uri) => asJson(uri, project(requireWorkOrder(ctx, wo.id), 'full')),
    );
  }
}

/**
 * L3+: parameterised resource templates with live enumeration and argument completion.
 * Nothing is hard-coded: new work orders become addressable the moment they exist, and the server
 * emits resources/list_changed when they do.
 */
export function registerResourceTemplates(ctx: LevelContext): void {
  const { server, service, session } = ctx;
  const completeIds = async (value: string) =>
    service.list().map((wo) => wo.id).filter((id) => id.toLowerCase().startsWith(value.toLowerCase()));
  const completeAssets = async (value: string) =>
    [...new Set(service.list().map((wo) => wo.assetId))].filter((v) => v.toLowerCase().startsWith(value.toLowerCase()));

  server.registerResource(
    'work-order',
    new ResourceTemplate('workorder://{id}', {
      list: async () => ({
        resources: service.list().map((wo) => ({
          uri: `workorder://${wo.id}`,
          name: wo.id,
          title: wo.title,
          mimeType: JSON_MIME,
        })),
      }),
      complete: { id: completeIds },
    }),
    { title: 'Work order', description: 'Standard-detail snapshot of one work order.', mimeType: JSON_MIME },
    async (uri, vars) => asJson(uri, project(requireWorkOrder(ctx, first(vars.id)), 'standard')),
  );

  server.registerResource(
    'work-order-history',
    new ResourceTemplate('workorder://{id}/history', { list: undefined, complete: { id: completeIds } }),
    { title: 'Work order history', description: 'Notes and audit trail: the deep layer of detail.', mimeType: JSON_MIME },
    async (uri, vars) => {
      const wo = requireWorkOrder(ctx, first(vars.id));
      return asJson(uri, { id: wo.id, notes: wo.notes, history: wo.history });
    },
  );

  server.registerResource(
    'work-order-affordances',
    new ResourceTemplate('workorder://{id}/affordances', { list: undefined, complete: { id: completeIds } }),
    {
      title: 'Work order affordances',
      description: 'What can happen next for the current role: the same hypermedia controls tool responses carry, readable on demand.',
      mimeType: JSON_MIME,
    },
    async (uri, vars) => {
      const wo = requireWorkOrder(ctx, first(vars.id));
      return asJson(uri, {
        role: session.role,
        ...buildAffordances(wo, session.role, service, { focusedId: session.focusedId, gated: true }),
      });
    },
  );

  server.registerResource(
    'asset-work-orders',
    new ResourceTemplate('asset://{asset_id}/work-orders', {
      list: undefined,
      complete: { asset_id: completeAssets },
    }),
    { title: 'Work orders for an asset', description: 'Summaries of every work order on one asset.', mimeType: JSON_MIME },
    async (uri, vars) => {
      const assetId = first(vars.asset_id);
      return asJson(
        uri,
        service.list({ assetId }).map((wo) => project(wo, 'summary')),
      );
    },
  );
}
