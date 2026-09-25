/**
 * Orin backend client — the ONLY module that talks to orinai.org.
 * Reuses the OpenAI-compat gateway (chat + models) and the usage endpoint.
 * No model logic lives anywhere else in this repo.
 */
import crypto from 'node:crypto';
import { McpError } from '../errors.js';
import type { McpConfig } from '../config.js';
import type { BackendModel, BackendResult, BackendUsage, McpIdentity, OrinMessage, Scope } from '../types.js';

export interface Backend {
  verify(token: string): Promise<McpIdentity>;
  models(token: string): Promise<BackendModel[]>;
  chat(token: string, args: {
    model: string; messages: OrinMessage[]; temperature?: number; maxTokens?: number;
  }): Promise<BackendResult>;
  usage(token: string): Promise<BackendUsage>;
}

function sha256(s: string): string {
  return crypto.createHash('sha256').update(s).digest('hex');
}

async function withTimeout<T>(ms: number, fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fn(ctrl.signal);
  } catch (e: unknown) {
    if (e instanceof Error && e.name === 'AbortError') throw new McpError('TIMEOUT', 'Orin backend timed out.');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function toMcpError(status: number, body: string, fallback: string): McpError {
  if (status === 401) return new McpError('AUTHENTICATION_FAILED', 'Orin credential rejected.');
  if (status === 403) return new McpError('AUTHORIZATION_FAILED', 'Orin refused the request.');
  if (status === 429) return new McpError('RATE_LIMITED', 'Orin rate limit hit — slow down.');
  if (status === 400) return new McpError('INVALID_REQUEST', body.slice(0, 200) || fallback);
  if (status >= 500) return new McpError('PROVIDER_ERROR', 'Orin backend failed — retry shortly.');
  return new McpError('PROVIDER_ERROR', body.slice(0, 200) || fallback);
}

export function orinBackend(cfg: McpConfig): Backend {
  async function call(path: string, init: RequestInit, token: string, signal: AbortSignal): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(cfg.orinApi + path, {
        ...init,
        signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(init.headers ?? {}) },
      });
    } catch (e: unknown) {
      if (e instanceof Error && e.name === 'AbortError') throw new McpError('TIMEOUT', 'Orin backend timed out.');
      throw new McpError('PROVIDER_ERROR', 'Cannot reach the Orin backend.');
    }
    if (!res.ok) throw toMcpError(res.status, await res.text().catch(() => ''), 'Orin request failed.');
    try {
      return await res.json();
    } catch {
      throw new McpError('PROVIDER_ERROR', 'Orin returned a malformed response.');
    }
  }

  return {
    async verify(token: string): Promise<McpIdentity> {
      const json = await withTimeout(cfg.timeoutMs, (signal) =>
        call('/api/auth/mcp/verify', {
          method: 'POST',
          body: JSON.stringify({}),
        }, token, signal),
      ) as { uid?: unknown; scopes?: unknown };
      if (!json || typeof json.uid !== 'string' || !json.uid) {
        throw new McpError('AUTHENTICATION_FAILED', 'Credential verification failed.');
      }
      const scopes = Array.isArray(json.scopes)
        ? json.scopes.filter((s): s is Scope => s === 'models:read' || s === 'chat:generate' || s === 'usage:read')
        : [];
      return { uid: json.uid, scopes, tokenHash: sha256(token).slice(0, 16) };
    },

    async models(token: string): Promise<BackendModel[]> {
      const json = await withTimeout(cfg.timeoutMs, (signal) =>
        call('/api/mcp', { method: 'POST', body: JSON.stringify({ action: 'models' }) }, token, signal),
      ) as { data?: unknown };
      const data = Array.isArray(json?.data) ? json.data : [];
      return data
        .filter((m): m is { id: unknown; owned_by?: unknown } => !!m && typeof m === 'object')
        .filter((m) => typeof m.id === 'string' && m.id)
        .map((m) => ({ id: m.id as string, owned_by: typeof m.owned_by === 'string' ? m.owned_by : 'orin' }));
    },

    async chat(token, args): Promise<BackendResult> {
      const json = await withTimeout(cfg.timeoutMs, (signal) =>
        call('/api/mcp', {
          method: 'POST',
          body: JSON.stringify({
            action: 'chat',
            model: args.model,
            messages: args.messages,
            ...(typeof args.temperature === 'number' ? { temperature: args.temperature } : {}),
            ...(typeof args.maxTokens === 'number' ? { max_tokens: args.maxTokens } : {}),
          }),
        }, token, signal),
      ) as { choices?: Array<{ message?: { content?: unknown } }>; model?: unknown };
      const text = json?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new McpError('PROVIDER_ERROR', 'Orin returned an empty answer.');
      return { text: text.trim(), model: typeof json.model === 'string' ? json.model : args.model };
    },

    async usage(token: string): Promise<BackendUsage> {
      const json = await withTimeout(cfg.timeoutMs, (signal) =>
        call('/api/mcp', {
          method: 'POST',
          body: JSON.stringify({ action: 'usage' }),
        }, token, signal),
      ) as { text?: unknown; images?: unknown; videos?: unknown };
      const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      return { text: num(json?.text), images: num(json?.images), videos: num(json?.videos) };
    },
  };
}
