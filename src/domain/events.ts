import type { ActionId, State } from './types.js';

export type DomainEvent =
  | { type: 'created'; id: string }
  | { type: 'transitioned'; id: string; action: ActionId; from: State; to: State }
  | { type: 'noted'; id: string };

/** Minimal typed Observer. Handler failures never break the publisher. */
export class EventBus<E> {
  private readonly handlers = new Set<(event: E) => void>();

  subscribe(handler: (event: E) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  publish(event: E): void {
    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (error) {
        // stdout belongs to the MCP transport; log to stderr only.
        console.error('[event-bus] handler failed:', error);
      }
    }
  }
}
