import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DisclosureCoordinator } from '../disclosure/coordinator.js';
import type { DomainEvent, EventBus } from '../domain/events.js';
import type { WorkOrderService } from '../domain/service.js';
import type { ShapeContext } from '../mcp/shapers.js';
import type { SessionContext } from '../session/context.js';

export type LevelId = 0 | 1 | 2 | 3 | 4;

export interface LevelContext {
  server: McpServer;
  service: WorkOrderService;
  session: SessionContext;
  bus: EventBus<DomainEvent>;
  /** Present from L3 up. Set by the level when it wires progressive disclosure. */
  coordinator?: DisclosureCoordinator;
  /** Snapshot of session + pending disclosure delta. Call once per response, *after* mutating. */
  shapeContext(): ShapeContext;
}

/** Strategy: each maturity level decides what MCP surface to expose over the same domain. */
export interface MaturityLevel {
  readonly id: LevelId;
  readonly name: string;
  readonly summary: string;
  /** Server-level instructions sent to the client during initialize. */
  readonly instructions: string;
  register(ctx: LevelContext): void;
}
