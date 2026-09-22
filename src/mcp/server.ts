/**
 * MCP protocol wiring (SDK Server). One builder for every transport —
 * stdio, Streamable HTTP, in-memory tests. Auth resolved per call from
 * getToken(), so revocation takes effect without restarts.
 */
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  CallToolRequestSchema,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { Authenticator } from '../auth.js';
import type { McpConfig } from '../config.js';
import { McpError } from '../errors.js';
import { RateLimit } from '../rate-limit.js';
import type { Backend } from '../services/orin.js';
import { getPrompt, PROMPT_DEFS } from './prompts.js';
import { readResource, RESOURCE_DEFS } from './resources.js';
import { callTool, TOOL_DEFS, type ToolDeps } from './tools.js';

export interface ServerDeps {
  backend: Backend;
  config: McpConfig;
  /** Current credential (per-request closure on HTTP, env on stdio). */
  getToken: () => string | null;
  requestId: () => string;
  auth?: Authenticator;
  limits?: RateLimit;
}

export function buildMcpServer(deps: ServerDeps): Server {
  const auth = deps.auth ?? new Authenticator(deps.backend);
  const limits = deps.limits ?? new RateLimit();
  const toolDeps: ToolDeps = { auth, backend: deps.backend, limits, config: deps.config };

  const server = new Server(
    { name: 'orin-mcp', version: deps.config.version },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const token = deps.getToken();
    const out = await callTool(toolDeps, token, deps.requestId(), req.params.name, req.params.arguments ?? {});
    return { content: out.content, ...(out.isError ? { isError: true } : {}) };
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources: RESOURCE_DEFS }));

  server.setRequestHandler(ReadResourceRequestSchema, async (req) => {
    const token = deps.getToken();
    if (!token) throw new McpError('AUTHENTICATION_FAILED', 'Missing MCP credential.');
    const ctx = await auth.identify(token, deps.requestId());
    auth.requireScope(ctx, req.params.uri === 'orin://usage' ? 'usage:read' : 'models:read');
    return readResource(deps.backend, token, req.params.uri);
  });

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts: PROMPT_DEFS }));

  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const raw = req.params.arguments as unknown;
    const args: Record<string, string> = {};
    if (Array.isArray(raw)) {
      for (const a of raw as Array<{ name?: unknown; value?: unknown }>) {
        if (typeof a?.name === 'string' && typeof a?.value === 'string') args[a.name] = a.value;
      }
    } else if (raw && typeof raw === 'object') {
      for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === 'string') args[k] = v;
      }
    }
    return getPrompt(req.params.name, args);
  });

  return server;
}
