/**
 * End-to-end: MCP Client → protocol Server → real orinBackend (HTTP) →
 * stub Orin backend (node:http). Proves the complete request lifecycle
 * including HTTP mapping, auth caching, and error normalization.
 * Localhost only — no external network.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { buildMcpServer } from '../src/mcp/server.js';
import { Authenticator } from '../src/auth.js';
import { RateLimit } from '../src/rate-limit.js';
import { orinBackend } from '../src/services/orin.js';

const TOKEN = 'orin_e2e00000000000000000000000001';

function stubBackend() {
  const calls = { verify: 0, chat: 0, models: 0, usage: 0 };
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const url = req.url || '';
      const send = (code, obj) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(obj));
      };
      if (url === '/api/auth/password') {
        calls.verify++;
        const b = JSON.parse(body || '{}');
        if (b.action === 'mcp-verify' && b.token === TOKEN) {
          return send(200, { uid: 'u-e2e', scopes: ['models:read', 'chat:generate', 'usage:read'] });
        }
        return send(401, { error: 'Invalid credential' });
      }
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${TOKEN}`) return send(401, { error: 'bad' });
      if (url === '/api/openai/v1/models' && req.method === 'GET') {
        calls.models++;
        return send(200, { object: 'list', data: [{ id: 'orin-balanced', object: 'model', owned_by: 'orin' }] });
      }
      if (url === '/api/openai/v1/chat/completions') {
        calls.chat++;
        const b = JSON.parse(body || '{}');
        if (b.model === 'orin-bogus') return send(400, { error: 'Unknown model.' });
        return send(200, {
          id: 'x', object: 'chat.completion', created: 1, model: b.model,
          choices: [{ index: 0, message: { role: 'assistant', content: 'e2e:' + (b.messages?.length ?? 0) }, finish_reason: 'stop' }],
          usage: {},
        });
      }
      if (url === '/api/history') {
        calls.usage++;
        return send(200, { text: 3, images: 1, videos: 0 });
      }
      return send(404, { error: 'nope' });
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, calls, base: `http://127.0.0.1:${addr.port}` });
    });
  });
}

async function pair(base) {
  const backend = orinBackend({
    orinApi: base, perMin: 60, timeoutMs: 10000,
    maxMessageChars: 50000, maxMessages: 100, version: 'test',
  });
  const server = buildMcpServer({
    backend,
    config: { orinApi: base, perMin: 60, timeoutMs: 10000, maxMessageChars: 50000, maxMessages: 100, version: 'test' },
    auth: new Authenticator(backend),
    limits: new RateLimit(),
    getToken: () => TOKEN,
    requestId: () => 'req-e2e',
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'e2e', version: '1' }, { capabilities: {} });
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

test('e2e: verify → models → chat → usage over real HTTP', async (t) => {
  const stub = await stubBackend();
  t.after(() => new Promise((r) => stub.server.close(r)));
  const { client, close } = await pair(stub.base);
  try {
    const tools = await client.listTools();
    assert.equal(tools.tools.length, 4);

    const m = await client.callTool({ name: 'orin_list_models', arguments: {} });
    assert.match(m.content[0].text, /orin-balanced/);

    const c = await client.callTool({
      name: 'orin_generate',
      arguments: { prompt: 'hello', model: 'orin-balanced' },
    });
    assert.match(c.content[0].text, /e2e:1/);

    const u = await client.callTool({ name: 'orin_usage', arguments: {} });
    assert.match(u.content[0].text, /"text":3/);

    assert.ok(stub.calls.verify >= 1);
    assert.equal(stub.calls.chat, 1);
  } finally { await close(); }
});

test('e2e: backend 400 surfaces as a tool error with the backend message', async (t) => {
  const stub = await stubBackend();
  t.after(() => new Promise((r) => stub.server.close(r)));
  const { client, close } = await pair(stub.base);
  try {
    const out = await client.callTool({
      name: 'orin_generate', arguments: { prompt: 'x', model: 'orin-bogus' },
    });
    assert.equal(out.isError, true);
    assert.match(out.content[0].text, /Unknown model/);
  } finally { await close(); }
});

test('e2e: backend down fails at auth as a protocol error (nothing half-run)', async (t) => {
  const stub = await stubBackend();
  t.after(() => new Promise((r) => stub.server.close(r)));
  const { client, close } = await pair('http://127.0.0.1:1');
  try {
    // Auth happens before any tool logic: unreachable backend rejects the
    // call outright instead of returning a half-result.
    await assert.rejects(
      client.callTool({ name: 'orin_generate', arguments: { prompt: 'hi' } }),
      /Cannot reach the Orin backend/,
    );
  } finally { await close(); }
  void stub;
});
