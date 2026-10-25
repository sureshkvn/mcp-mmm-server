import type { WorkOrderService } from '../domain/service.js';
import type { ActionId, Role, WorkOrder } from '../domain/types.js';

/** Anything the SDK lets us hide/show: RegisteredTool and RegisteredPrompt both satisfy this. */
export interface Toggleable {
  readonly enabled: boolean;
  enable(): void;
  disable(): void;
}

export interface DisclosureContext {
  role: Role;
  focused?: WorkOrder;
}

export type DisclosurePolicy = (ctx: DisclosureContext) => boolean;

export interface GateChange {
  kind: 'tool' | 'prompt';
  name: string;
  visible: boolean;
}

interface Entry {
  kind: GateChange['kind'];
  name: string;
  target: Toggleable;
  policy: DisclosurePolicy;
}

/**
 * Progressive disclosure gate. Each gated capability carries a policy; `sync` reconciles
 * visibility with the current context. Toggling a handle makes the SDK emit
 * notifications/tools/list_changed (or prompts/list_changed) to the client.
 */
export class DisclosureGate {
  private readonly entries: Entry[] = [];

  add(kind: GateChange['kind'], name: string, target: Toggleable, policy: DisclosurePolicy): this {
    this.entries.push({ kind, name, target, policy });
    return this;
  }

  sync(ctx: DisclosureContext): GateChange[] {
    const changes: GateChange[] = [];
    for (const entry of this.entries) {
      const visible = entry.policy(ctx);
      if (visible === entry.target.enabled) continue;
      if (visible) entry.target.enable();
      else entry.target.disable();
      changes.push({ kind: entry.kind, name: entry.name, visible });
    }
    return changes;
  }
}

export const policies = {
  always: (() => true) as DisclosurePolicy,

  /** Visible only while the focused work order permits this action for the current role. */
  actionAvailable:
    (service: WorkOrderService, action: ActionId): DisclosurePolicy =>
    ({ role, focused }) =>
      focused !== undefined && service.check(action, focused, role).ok,

  /** Visible only while the focused work order is in one of the given states. */
  focusedInState:
    (...states: WorkOrder['state'][]): DisclosurePolicy =>
    ({ focused }) =>
      focused !== undefined && states.includes(focused.state),
};
