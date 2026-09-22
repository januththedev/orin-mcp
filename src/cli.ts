#!/usr/bin/env node
/**
 * orin-mcp — stdio MCP server for Claude Code / Cursor / local configs.
 * Token from ORIN_MCP_TOKEN (or --token). Same tools, scopes, and limits
 * as the hosted endpoint; revocation applies within a minute.
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Authenticator } from './auth.js';
import { loadConfig } from './config.js';
import { log } from './logging.js';
import { RateLimit } from './rate-limit.js';
import { orinBackend } from './services/orin.js';
import { buildMcpServer } from './mcp/server.js';
import crypto from 'node:crypto';

function flag(name: string): string | null {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : null;
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const token = flag('--token') || process.env.ORIN_MCP_TOKEN || '';
  if (!token) {
    console.error('orin-mcp: set ORIN_MCP_TOKEN (mint in Orin Chat → Account → MCP tokens) or pass --token.');
    process.exit(2);
  }
  const backend = orinBackend(cfg);
  // Fail fast on a bad/revoked token instead of serving broken tools.
  try {
    await backend.verify(token);
  } catch (e) {
    console.error(`orin-mcp: credential rejected (${e instanceof Error ? e.message : 'unknown'}). Mint a fresh one.`);
    process.exit(1);
  }
  const server = buildMcpServer({
    backend,
    config: cfg,
    auth: new Authenticator(backend),
    limits: new RateLimit(),
    getToken: () => token,
    requestId: () => (typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `${Date.now()}`),
  });
  const transport = new StdioServerTransport();
  await server.connect(transport);
  log('info', 'stdio server up', {});
}

main().catch((e) => {
  log('error', 'stdio fatal', { error: e instanceof Error ? e.message : 'unknown' });
  process.exit(1);
});
