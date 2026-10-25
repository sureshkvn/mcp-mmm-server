import { ACTION_BY_ID, type ActionSpec } from './actions.js';
import type { DomainEvent, EventBus } from './events.js';
import type { WorkOrderFilter, WorkOrderRepository } from './repository.js';
import {
  Err,
  Ok,
  type ActionId,
  type ActionPayload,
  type Priority,
  type Result,
  type Role,
  type WorkOrder,
} from './types.js';

const NEEDS_TO_PAYLOAD_KEY: Record<string, keyof ActionPayload> = {
  reason: 'reason',
  text: 'text',
  resolution: 'resolution',
  labor_hours: 'laborHours',
};

export interface CreateWorkOrderInput {
  title: string;
  assetId: string;
  priority: Priority;
  dueInHours?: number;
}

/** Application service: all business rules live here, so every MCP maturity level shares them. */
export class WorkOrderService {
  constructor(
    private readonly repo: WorkOrderRepository,
    private readonly bus: EventBus<DomainEvent>,
  ) {}

  list(filter?: WorkOrderFilter): WorkOrder[] {
    return this.repo.list(filter);
  }

  get(id: string): Result<WorkOrder> {
    const wo = this.repo.get(id);
    return wo ? Ok(wo) : Err('not_found', `Work order ${id} does not exist.`);
  }

  create(input: CreateWorkOrderInput, actor: Role): WorkOrder {
    const now = new Date();
    const wo: WorkOrder = {
      id: this.repo.nextId(),
      title: input.title,
      assetId: input.assetId.toUpperCase(),
      priority: input.priority,
      state: 'draft',
      createdAt: now.toISOString(),
      dueAt: input.dueInHours === undefined ? undefined : new Date(now.getTime() + input.dueInHours * 3_600_000).toISOString(),
      notes: [],
      history: [{ at: now.toISOString(), actor, action: 'created', to: 'draft' }],
    };
    this.repo.save(wo);
    this.bus.publish({ type: 'created', id: wo.id });
    return wo;
  }

  /** Is this action legal for this work order and role right now? */
  check(action: ActionId, wo: WorkOrder, role: Role): Result<ActionSpec> {
    const spec = ACTION_BY_ID[action];
    if (!spec.from.includes(wo.state)) {
      return Err('invalid_state', `${spec.title} is not possible while ${wo.id} is "${wo.state}".`);
    }
    if (!spec.roles.includes(role)) {
      return Err('forbidden', `${spec.title} requires the ${spec.roles.join(' or ')} role (current role: ${role}).`);
    }
    return Ok(spec);
  }

  apply(action: ActionId, id: string, role: Role, payload: ActionPayload = {}): Result<WorkOrder> {
    const found = this.get(id);
    if (!found.ok) return found;
    const wo = found.value;

    const checked = this.check(action, wo, role);
    if (!checked.ok) return checked;
    const spec = checked.value;

    for (const need of spec.needs) {
      const value = payload[NEEDS_TO_PAYLOAD_KEY[need]!];
      if (value === undefined || value === '') return Err('invalid_input', `Missing required field "${need}".`);
    }

    const at = new Date().toISOString();
    const from = wo.state;

    switch (action) {
      case 'add_note':
        wo.notes.push({ at, author: role, text: payload.text! });
        break;
      case 'complete':
        wo.resolution = payload.resolution;
        wo.laborHours = payload.laborHours;
        break;
      case 'reject':
      case 'cancel':
        wo.notes.push({ at, author: role, text: `${spec.title}: ${payload.reason}` });
        break;
      case 'approve':
        if (payload.comment) wo.notes.push({ at, author: role, text: `Approval comment: ${payload.comment}` });
        break;
      default:
        break;
    }

    if (spec.to) wo.state = spec.to;
    wo.history.push({
      at,
      actor: role,
      action,
      from,
      to: wo.state,
      detail: payload.reason ?? payload.comment ?? payload.text,
    });

    this.repo.save(wo);
    this.bus.publish(
      spec.to
        ? { type: 'transitioned', id: wo.id, action, from, to: wo.state }
        : { type: 'noted', id: wo.id },
    );
    return Ok(wo);
  }
}
