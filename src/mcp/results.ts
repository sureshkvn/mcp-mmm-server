import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { ResourceLink } from '../disclosure/affordances.js';

export function toolOk(
  structured: Record<string, unknown>,
  text: string,
  links: ResourceLink[] = [],
): CallToolResult {
  return {
    content: [
      { type: 'text', text },
      ...links.map((link) => ({
        type: 'resource_link' as const,
        uri: link.uri,
        name: link.rel,
        description: link.description,
      })),
    ],
    structuredContent: structured,
  };
}

export function toolError(text: string, structured?: Record<string, unknown>): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}
