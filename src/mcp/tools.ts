/**
 * MCP tools. Each handler: auth → scope → validate → rate-limit → backend.
 * Tool failures return isError results (client-friendly); auth/scope
 * failures throw protocol errors. Nothing here touches provider code.
 */
import { Authenticator } from '../auth.js';
import type { McpConfig } from '../config.js';
import { McpError } from '../errors.js';
import { log } from '../logging.js';
import { RateLimit } from '../rate-limit.js';
import type { Backend } from '../services/orin.js';
import type { McpContext } from '../types.js';
import { cleanGenerateArgs, cleanText } from '../validation.js';

export interface ToolDeps {
  auth: Authenticator;
  backend: Backend;
  limits: RateLimit;
  config: McpConfig;
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

function ok(text: string): ToolResult {
  return { content: [{ type: 'text', text }] };
}

function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

async function gated(
  deps: ToolDeps, token: string | null, scope: 'chat:generate' | 'models:read' | 'usage:read',
  requestId: string, tool: string, fn: (ctx: McpContext) => Promise<ToolResult>,
): Promise<ToolResult> {
  const t0 = Date.now();
  try {
    const ctx = await deps.auth.identify(token, requestId);
    deps.auth.requireScope(ctx, scope);
    if (!deps.limits.allow(ctx.identity.tokenHash, deps.config.perMin)) {
      throw new McpError('RATE_LIMITED', 'Too many requests — slow down.');
    }
    const out = await fn(ctx);
    log('info', 'tool ok', { requestId, tool, model: '', status: 'ok', latencyMs: Date.now() - t0, tokenHash: ctx.identity.tokenHash, uid: ctx.identity.uid });
    return out;
  } catch (e: unknown) {
    const msg = e instanceof McpError ? e.message : 'Tool failed.';
    const code = e instanceof McpError ? e.code : 'INTERNAL_ERROR';
    log(code === 'INTERNAL_ERROR' ? 'error' : 'warn', 'tool fail', { requestId, tool, status: code, error: msg, latencyMs: Date.now() - t0 });
    if (e instanceof McpError && (code === 'AUTHENTICATION_FAILED' || code === 'AUTHORIZATION_FAILED')) throw e;
    return fail(`${code}: ${msg}`);
  }
}

export const TOOL_DEFS = [
  {
    name: 'orin_chat',
    description: 'Ask Orin a question with full message history. Returns the assistant reply.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        model: { type: 'string', description: 'orin-thinking, orin-balanced, orin-coding, orin-cheap (default orin-balanced)' },
        messages: { type: 'array', description: 'Chat messages [{role, content}]', items: { type: 'object' } },
        temperature: { type: 'number', description: '0–2' },
        max_tokens: { type: 'number', description: '1–16000' },
      },
      required: ['messages'],
    },
  },
  {
    name: 'orin_generate',
    description: 'Single-prompt generation on an Orin model. Simpler than orin_chat for one-shot asks.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        model: { type: 'string', description: 'orin-* preset (default orin-balanced)' },
        prompt: { type: 'string', description: 'The prompt' },
        system: { type: 'string', description: 'Optional system instruction' },
        temperature: { type: 'number' },
        max_tokens: { type: 'number' },
      },
      required: ['prompt'],
    },
  },
  {
    name: 'orin_list_models',
    description: 'List available Orin models with ids and capabilities.',
    inputSchema: { type: 'object' as const, properties: {} },
  },
  {
    name: 'orin_usage',
    description: 'Show the token owner’s Orin usage counters (text/images/videos).',
    inputSchema: { type: 'object' as const, properties: {} },
  },
];

const CAPABILITIES: Record<string, string[]> = {
  'orin-thinking': ['text', 'reasoning'],
  'orin-balanced': ['text'],
  'orin-coding': ['text', 'code'],
  'orin-cheap': ['text'],
};

export async function callTool(
  deps: ToolDeps, token: string | null, requestId: string, name: string, args: unknown,
): Promise<ToolResult> {
  switch (name) {
    case 'orin_chat':
    case 'orin_generate':
      return gated(deps, token, 'chat:generate', requestId, name, async () => {
        const a = cleanGenerateArgs(args, deps.config.maxMessages, deps.config.maxMessageChars);
        const r = await deps.backend.chat(token as string, {
          model: a.model, messages: a.messages, temperature: a.temperature, maxTokens: a.max_tokens,
        });
        return ok(JSON.stringify({ response: r.text, model: r.model, request_id: requestId }));
      });
    case 'orin_list_models':
      return gated(deps, token, 'models:read', requestId, name, async () => {
        const models = await deps.backend.models(token as string);
        return ok(JSON.stringify({
          models: models.map((m) => ({
            id: m.id, provider: m.owned_by,
            capabilities: CAPABILITIES[m.id] ?? ['text'],
            modalities: ['text'],
          })),
        }));
      });
    case 'orin_usage':
      return gated(deps, token, 'usage:read', requestId, name, async () => {
        const u = await deps.backend.usage(token as string);
        return ok(JSON.stringify({ usage: u, request_id: requestId }));
      });
    default:
      throw new McpError('INVALID_REQUEST', `Unknown tool '${String(name).slice(0, 60)}'.`);
  }
}

export function cleanCodeReviewArgs(raw: unknown): { code: string; language: string } {
  if (!raw || typeof raw !== 'object') throw new McpError('INVALID_REQUEST', 'Arguments object required.');
  const a = raw as Record<string, unknown>;
  return {
    code: cleanText(a.code, 'code', 30_000),
    language: typeof a.language === 'string' ? a.language.slice(0, 40) : 'auto',
  };
}
