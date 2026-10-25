import type { Priority, State, WorkOrder } from './types.js';

export interface WorkOrderFilter {
  state?: State;
  assetId?: string;
  query?: string;
}

export interface WorkOrderRepository {
  list(filter?: WorkOrderFilter): WorkOrder[];
  get(id: string): WorkOrder | undefined;
  save(workOrder: WorkOrder): void;
  nextId(): string;
}

export class InMemoryWorkOrderRepository implements WorkOrderRepository {
  private readonly store = new Map<string, WorkOrder>();

  constructor(seed: WorkOrder[] = []) {
    for (const wo of seed) this.store.set(wo.id, structuredClone(wo));
  }

  list(filter: WorkOrderFilter = {}): WorkOrder[] {
    const q = filter.query?.toLowerCase();
    return [...this.store.values()]
      .filter((wo) => !filter.state || wo.state === filter.state)
      .filter((wo) => !filter.assetId || wo.assetId.toLowerCase() === filter.assetId.toLowerCase())
      .filter(
        (wo) =>
          !q || wo.id.toLowerCase().includes(q) || wo.title.toLowerCase().includes(q) || wo.assetId.toLowerCase().includes(q),
      )
      .map((wo) => structuredClone(wo));
  }

  get(id: string): WorkOrder | undefined {
    const wo = this.store.get(id.toUpperCase());
    return wo ? structuredClone(wo) : undefined;
  }

  save(workOrder: WorkOrder): void {
    this.store.set(workOrder.id, structuredClone(workOrder));
  }

  nextId(): string {
    const max = Math.max(1000, ...[...this.store.keys()].map((id) => Number(id.replace(/\D/g, '')) || 0));
    return `WO-${max + 1}`;
  }
}

const HOUR = 3_600_000;

function seedOrder(
  id: string,
  title: string,
  assetId: string,
  priority: Priority,
  state: State,
  dueInHours: number,
): WorkOrder {
  const now = Date.now();
  const createdAt = new Date(now - 72 * HOUR).toISOString();
  return {
    id,
    title,
    assetId,
    priority,
    state,
    createdAt,
    dueAt: new Date(now + dueInHours * HOUR).toISOString(),
    notes: [],
    history: [{ at: createdAt, actor: 'technician', action: 'created', to: 'draft' }],
  };
}

/** A small, deliberately varied set: every lifecycle state, one overdue critical item. */
export function seedWorkOrders(): WorkOrder[] {
  return [
    seedOrder('WO-1001', 'Replace worn bearing - abnormal vibration', 'PUMP-204', 'critical', 'draft', -24),
    seedOrder('WO-1002', 'Scheduled quarterly service', 'HVAC-118', 'normal', 'submitted', 48),
    seedOrder('WO-1003', 'Replace cracked access panel', 'HVAC-118', 'high', 'approved', 24),
    seedOrder('WO-1004', 'Diagnose fault alarm', 'PUMP-204', 'high', 'in_progress', 4),
    seedOrder('WO-1005', 'Routine inspection', 'GEN-007', 'low', 'completed', -96),
  ];
}
