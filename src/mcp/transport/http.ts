/**
 * Streamable HTTP transport glue for serverless (stateless: one Server +
 * one transport per request). Auth happens BEFORE the transport sees the
 * request — unauthenticated callers get plain 401, never MCP.
 */
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { Authenticator } from '../../auth.js';
import { loadConfig } from '../../config.js';
import { log } from '../../logging.js';
import { RateLimit } from '../../rate-limit.js';
import { orinBackend } from '../../services/orin.js';
import { buildMcpServer } from '../server.js';
import crypto from 'node:crypto';

const cfg = loadConfig();
const backend = orinBackend(cfg);
const auth = new Authenticator(backend);
const limits = new RateLimit();

function bearer(req: { headers?: Record<string, string | string[] | undefined> }): string | null {
  const h = req.headers?.authorization;
  const v = Array.isArray(h) ? h[0] : h;
  if (!v) return null;
  const m = /^Bearer\s+([A-Za-z0-9._~-]{40,4096})$/.exec(v.trim());
  return m ? m[1] : null;
}

export default async function mcpHttp(req: any, res: any): Promise<void> {
  const requestId = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  if (req.method !== 'POST' && req.method !== 'GET' && req.method !== 'DELETE') {
    res.status(405).json({ error: 'POST (GET/DELETE for stream management)' });
    return;
  }

  // Stateless server per request — no sessions to hijack or leak.
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  const token = bearer(req);
  const server = buildMcpServer({
    backend, config: cfg, auth, limits,
    getToken: () => token,
    requestId: () => requestId,
  });

  // Pre-auth: reject garbage before any protocol runs (cheap, no verify call
  // for missing tokens; verify happens inside tool handlers with caching).
  if (!token && req.method === 'POST') {
    res.status(401).json({ error: 'Missing MCP credential (Authorization: Bearer …).' });
    await transport.close().catch(() => undefined);
    return;
  }

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (e: unknown) {
    log('error', 'http transport fail', { requestId, error: e instanceof Error ? e.message : 'unknown' });
    if (!res.headersSent) res.status(500).json({ error: 'MCP request failed.' });
  } finally {
    await transport.close().catch(() => undefined);
    await server.close().catch(() => undefined);
  }
}
