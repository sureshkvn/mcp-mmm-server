import type { ActionId, Role, State } from './types.js';

/**
 * The action catalog is the single source of truth for:
 *   - the workflow state machine (from -> to)
 *   - who may perform an action (roles)
 *   - the MCP tool name/description that exposes it
 *   - which tools are *disclosed* at any moment (progressive disclosure)
 *   - which affordances a response advertises (HATEOAS-style links)
 */
export interface ActionSpec {
  id: ActionId;
  tool: string;
  title: string;
  description: string;
  from: readonly State[];
  roles: readonly Role[];
  kind: 'write' | 'destructive';
  to?: State;
  /** Wire-level argument names the caller must still supply. */
  needs: readonly string[];
}

const ANY: readonly Role[] = ['technician', 'manager'];
const MANAGER: readonly Role[] = ['manager'];
const ACTIVE: readonly State[] = ['draft', 'submitted', 'approved', 'in_progress'];

export const ACTIONS: readonly ActionSpec[] = [
  {
    id: 'submit',
    tool: 'submit_work_order',
    title: 'Submit for approval',
    description: 'Move a draft work order to "submitted" so a manager can review it.',
    from: ['draft'],
    roles: ANY,
    kind: 'write',
    to: 'submitted',
    needs: [],
  },
  {
    id: 'approve',
    tool: 'approve_work_order',
    title: 'Approve',
    description: 'Approve a submitted work order so work can begin. Manager only.',
    from: ['submitted'],
    roles: MANAGER,
    kind: 'write',
    to: 'approved',
    needs: [],
  },
  {
    id: 'reject',
    tool: 'reject_work_order',
    title: 'Reject back to draft',
    description: 'Send a submitted work order back to draft with a reason. Manager only.',
    from: ['submitted'],
    roles: MANAGER,
    kind: 'write',
    to: 'draft',
    needs: ['reason'],
  },
  {
    id: 'start',
    tool: 'start_work',
    title: 'Start work',
    description: 'Begin work on an approved work order.',
    from: ['approved'],
    roles: ANY,
    kind: 'write',
    to: 'in_progress',
    needs: [],
  },
  {
    id: 'complete',
    tool: 'complete_work_order',
    title: 'Complete',
    description: 'Close an in-progress work order with a resolution and labor hours.',
    from: ['in_progress'],
    roles: ANY,
    kind: 'write',
    to: 'completed',
    needs: ['resolution', 'labor_hours'],
  },
  {
    id: 'cancel',
    tool: 'cancel_work_order',
    title: 'Cancel',
    description: 'Cancel an active work order. Irreversible. Manager only.',
    from: ACTIVE,
    roles: MANAGER,
    kind: 'destructive',
    to: 'cancelled',
    needs: ['reason'],
  },
  {
    id: 'add_note',
    tool: 'add_note',
    title: 'Add note',
    description: 'Append a finding or comment to an active work order.',
    from: ACTIVE,
    roles: ANY,
    kind: 'write',
    needs: ['text'],
  },
];

export const ACTION_BY_ID = Object.fromEntries(ACTIONS.map((a) => [a.id, a])) as Record<ActionId, ActionSpec>;
export const ACTION_BY_TOOL = Object.fromEntries(ACTIONS.map((a) => [a.tool, a])) as Record<string, ActionSpec>;
