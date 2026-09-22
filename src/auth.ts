/**
 * Authentication + authorization. Every tool handler flows through here.
 * Verification results cache 60s by token hash (revocation propagates
 * within a minute); failures cache 10s to blunt brute force.
 */
import crypto from 'node:crypto';
import { McpError } from './errors.js';
import type { Backend } from './services/orin.js';
import type { McpContext, Scope } from './types.js';

interface CacheRow {
  at: number;
  identity?: { uid: string; scopes: Scope[]; tokenHash: string };
  error?: string;
}

const TTL_OK_MS = 60_000;
const TTL_FAIL_MS = 10_000;

export function bearerToken(header: string | null | undefined): string | null {
  if (!header) return null;
  const m = /^Bearer\s+(.+)$/i.exec(header.trim());
  return m ? m[1] : null;
}

export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export class Authenticator {
  private cache = new Map<string, CacheRow>();
  private backend: Backend;
  private now: () => number;
  constructor(backend: Backend, now?: () => number) {
    this.backend = backend;
    this.now = now ?? (() => Date.now());
  }

  async identify(token: string | null, requestId: string): Promise<McpContext> {
    if (!token) throw new McpError('AUTHENTICATION_FAILED', 'Missing MCP credential (Authorization: Bearer …).');
    const key = hashToken(token);
    const hit = this.cache.get(key);
    const now = this.now();
    if (hit && now - hit.at < (hit.error ? TTL_FAIL_MS : TTL_OK_MS)) {
      if (hit.error || !hit.identity) throw new McpError('AUTHENTICATION_FAILED', hit.error ?? 'Credential rejected.');
      return { identity: hit.identity, requestId };
    }
    try {
      const id = await this.backend.verify(token);
      const identity = { uid: id.uid, scopes: id.scopes, tokenHash: key.slice(0, 16) };
      this.cache.set(key, { at: now, identity });
      if (this.cache.size > 2000) {
        const oldest = [...this.cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (oldest) this.cache.delete(oldest[0]);
      }
      return { identity, requestId };
    } catch (e: unknown) {
      const msg = e instanceof McpError ? e.message : 'Credential verification failed.';
      this.cache.set(key, { at: now, error: msg });
      throw new McpError('AUTHENTICATION_FAILED', msg);
    }
  }

  requireScope(ctx: McpContext, scope: Scope): void {
    if (!ctx.identity.scopes.includes(scope)) {
      throw new McpError(
        'AUTHORIZATION_FAILED',
        `This credential lacks the '${scope}' scope. Mint one with it in Orin Chat → Account → MCP tokens.`,
      );
    }
  }
}
