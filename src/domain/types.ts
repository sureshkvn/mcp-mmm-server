export const ROLES = ['technician', 'manager'] as const;
export type Role = (typeof ROLES)[number];

export const PRIORITIES = ['low', 'normal', 'high', 'critical'] as const;
export type Priority = (typeof PRIORITIES)[number];

export const STATES = ['draft', 'submitted', 'approved', 'in_progress', 'completed', 'cancelled'] as const;
export type State = (typeof STATES)[number];

export const TERMINAL_STATES: readonly State[] = ['completed', 'cancelled'];

export type ActionId = 'submit' | 'approve' | 'reject' | 'start' | 'complete' | 'cancel' | 'add_note';

export interface Note {
  at: string;
  author: Role;
  text: string;
}

export interface HistoryEntry {
  at: string;
  actor: Role;
  action: string;
  from?: State;
  to?: State;
  detail?: string;
}

export interface WorkOrder {
  id: string;
  title: string;
  assetId: string;
  priority: Priority;
  state: State;
  createdAt: string;
  dueAt?: string;
  notes: Note[];
  history: HistoryEntry[];
  laborHours?: number;
  resolution?: string;
}

export interface ActionPayload {
  comment?: string;
  reason?: string;
  text?: string;
  resolution?: string;
  laborHours?: number;
}

export type DomainErrorCode = 'not_found' | 'invalid_state' | 'forbidden' | 'invalid_input';

export interface DomainError {
  code: DomainErrorCode;
  message: string;
}

/** Domain operations return Results instead of throwing; the MCP layer decides how to present them. */
export type Result<T> = { ok: true; value: T } | { ok: false; error: DomainError };

export const Ok = <T>(value: T): Result<T> => ({ ok: true, value });
export const Err = <T = never>(code: DomainErrorCode, message: string): Result<T> => ({
  ok: false,
  error: { code, message },
});
