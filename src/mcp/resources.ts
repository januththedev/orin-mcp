/**
 * MCP resources — only where the semantics fit (read-only snapshots):
 * orin://models (catalog) and orin://usage (counters). No orin://account:
 * there is nothing safe and useful to expose there.
 */
import type { Backend } from '../services/orin.js';

export const RESOURCE_DEFS = [
  {
    uri: 'orin://models',
    name: 'Orin models',
    description: 'Available Orin model presets with capabilities.',
    mimeType: 'application/json',
  },
  {
    uri: 'orin://usage',
    name: 'Orin usage',
    description: 'Token owner usage counters.',
    mimeType: 'application/json',
  },
];

export async function readResource(
  backend: Backend, token: string, uri: string,
): Promise<{ contents: Array<{ uri: string; mimeType: string; text: string }> }> {
  if (uri === 'orin://models') {
    const models = await backend.models(token);
    return {
      contents: [{
        uri, mimeType: 'application/json',
        text: JSON.stringify({ models: models.map((m) => ({ id: m.id, provider: m.owned_by, capabilities: ['text'] })) }),
      }],
    };
  }
  if (uri === 'orin://usage') {
    const usage = await backend.usage(token);
    return { contents: [{ uri, mimeType: 'application/json', text: JSON.stringify({ usage }) }] };
  }
  const err = new Error(`Unknown resource '${uri.slice(0, 80)}'.`) as Error & { code?: number };
  err.code = -32002;
  throw err;
}
