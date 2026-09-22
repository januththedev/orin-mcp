/** Shared fakes: backend, client/server pair over real MCP protocol. */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { Authenticator } from '../src/auth.js';
import { RateLimit } from '../src/rate-limit.js';
import { McpError } from '../src/errors.ts';

export const TOKEN = 'orin_testtoken00000000000000000001';
export const FULL_SCOPES = ['models:read', 'chat:generate', 'usage:read'];

export function fakeBackend(over = {}) {
  return {
    verified: [],
    async verify(token) {
      this.verified.push(token);
      if (over.verify) return over.verify(token);
      if (token !== TOKEN) throw new McpError('AUTHENTICATION_FAILED', 'bad');
      return { uid: 'u1', scopes: over.scopes ?? FULL_SCOPES, tokenHash: 'hash1' };
    },
    async models() {
      if (over.models) return over.models();
      return [{ id: 'orin-balanced', owned_by: 'orin' }];
    },
    async chat(_t, args) {
      if (over.chat) return over.chat(args);
      return { text: `echo:${args.messages.map((m) => m.content).join('|')}`, model: args.model };
    },
    async usage() {
      if (over.usage) return over.usage();
      return { text: 7, images: 0, videos: 0 };
    },
  };
}

const CFG = {
  orinApi: 'https://orinai.test', perMin: 60, timeoutMs: 5000,
  maxMessageChars: 50000, maxMessages: 100, version: 'test',
};

export async function linkedPair(over = {}, token = TOKEN) {
  const backend = fakeBackend(over.backend ?? {});
  const server = buildMcpServer({
    backend,
    config: over.config ?? CFG,
    auth: new Authenticator(backend),
    limits: new RateLimit(),
    getToken: () => over.token !== undefined ? over.token : token,
    requestId: () => 'req-test',
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1' }, { capabilities: {} });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, server, backend, close: () => Promise.all([client.close(), server.close()]) };
}
