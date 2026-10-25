import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { DomainEvent, EventBus } from '../domain/events.js';
import type { WorkOrderService } from '../domain/service.js';
import type { SessionContext } from '../session/context.js';
import type { DisclosureGate, GateChange } from './gate.js';

/** What changed in the visible surface since the last response: lets the agent see disclosure happen. */
export interface DisclosureDelta {
  toolsAdded: string[];
  toolsRemoved: string[];
  promptsAdded: string[];
  promptsRemoved: string[];
}

const emptyDelta = (): DisclosureDelta => ({ toolsAdded: [], toolsRemoved: [], promptsAdded: [], promptsRemoved: [] });

export interface CoordinatorDeps {
  server: McpServer;
  service: WorkOrderService;
  session: SessionContext;
  gate: DisclosureGate;
  bus: EventBus<DomainEvent>;
}

/**
 * Mediator between domain events, session changes and the MCP surface.
 * Anything that can change what the agent *should* see funnels into `sync()`.
 */
export class DisclosureCoordinator {
  private pending = emptyDelta();

  constructor(private readonly deps: CoordinatorDeps) {}

  start(): void {
    const { bus, session, server } = this.deps;
    bus.subscribe((event) => {
      if (event.type === 'created') server.sendResourceListChanged(); // new URI now exists
      this.sync();
    });
    session.onChange(() => this.sync());
    this.sync(); // establish the initial surface before any client connects
    this.pending = emptyDelta(); // the starting surface is not a "change" anyone needs to hear about
  }

  sync(): GateChange[] {
    const { service, session, gate } = this.deps;
    const focusedId = session.focusedId;
    const focused = focusedId ? (() => { const r = service.get(focusedId); return r.ok ? r.value : undefined; })() : undefined;
    const changes = gate.sync({ role: session.role, focused });
    for (const change of changes) this.record(change);
    return changes;
  }

  /** Returns and clears the accumulated delta, or undefined if nothing changed. */
  takeDelta(): DisclosureDelta | undefined {
    const delta = this.pending;
    this.pending = emptyDelta();
    const changed = Object.values(delta).some((names: string[]) => names.length > 0);
    return changed ? delta : undefined;
  }

  private record(change: GateChange): void {
    const bucket =
      change.kind === 'tool'
        ? change.visible ? this.pending.toolsAdded : this.pending.toolsRemoved
        : change.visible ? this.pending.promptsAdded : this.pending.promptsRemoved;
    bucket.push(change.name);
  }
}
