import type { Role } from '../domain/types.js';

/**
 * Per-connection conversational state. Progressive disclosure keys off this:
 * what the agent is "looking at" (focus) and who it is acting as (role).
 *
 * NOTE: In production the role comes from verified OAuth claims at the
 * gateway, never from a tool argument. It is a tool here only so the demo
 * can show disclosure changing with authority.
 */
export class SessionContext {
  private _role: Role = 'technician';
  private _focusedId: string | undefined;
  private readonly listeners = new Set<() => void>();

  get role(): Role {
    return this._role;
  }

  get focusedId(): string | undefined {
    return this._focusedId;
  }

  setRole(role: Role): void {
    if (role === this._role) return;
    this._role = role;
    this.emit();
  }

  focus(id: string | undefined): void {
    if (id === this._focusedId) return;
    this._focusedId = id;
    this.emit();
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(): void {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (error) {
        console.error('[session] listener failed:', error);
      }
    }
  }
}
