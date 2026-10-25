import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { EventBus, type DomainEvent } from './domain/events.js';
import { InMemoryWorkOrderRepository, seedWorkOrders, type WorkOrderRepository } from './domain/repository.js';
import { WorkOrderService } from './domain/service.js';
import { LEVELS } from './levels/index.js';
import type { LevelContext, LevelId, MaturityLevel } from './levels/level.js';
import { SessionContext } from './session/context.js';

export interface CreatedServer {
  server: McpServer;
  level: MaturityLevel;
  service: WorkOrderService;
  session: SessionContext;
}

/** Composition root: one fresh, isolated server (and session) per connection. */
export function createServer(levelId: LevelId, repo: WorkOrderRepository = new InMemoryWorkOrderRepository(seedWorkOrders())): CreatedServer {
  const level = LEVELS[levelId];
  const bus = new EventBus<DomainEvent>();
  const service = new WorkOrderService(repo, bus);
  const session = new SessionContext();

  const server = new McpServer(
    { name: `mmm-workorders-l${levelId}`, version: '1.0.0' },
    { instructions: level.instructions },
  );

  const ctx: LevelContext = {
    server,
    service,
    session,
    bus,
    shapeContext: () => ({
      role: session.role,
      focusedId: session.focusedId,
      delta: ctx.coordinator?.takeDelta(),
    }),
  };

  level.register(ctx);
  return { server, level, service, session };
}
