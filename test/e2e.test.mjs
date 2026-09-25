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
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      const url = req.url || '';
      const send = (code, value) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(value)); };
      if (url === '/api/auth/mcp/verify') {
        calls.verify++;
        if (req.headers.authorization === `Bearer ${TOKEN}`) return send(200, { uid: 'u-e2e', scopes: ['models:read', 'chat:generate', 'usage:read'] });
        return send(401, { error: 'Invalid credential' });
      }
      if (url === '/api/mcp') {
        const input = JSON.parse(body || '{}');
        if (input.action === 'models') { calls.models++; return send(200, { object: 'list', data: [{ id: 'orin-balanced', object: 'model', owned_by: 'orin' }] }); }
        if (input.action === 'usage') { calls.usage++; return send(200, { text: 3, images: 1, videos: 0 }); }
        if (input.action === 'chat') {
          calls.chat++;
          if (input.model === 'orin-bogus') return send(400, { error: { message: 'Unknown model.' } });
          return send(200, { id: 'x', object: 'chat.completion', created: 1, model: input.model, choices: [{ index: 0, message: { role: 'assistant', content: `e2e:${input.messages?.length ?? 0}` }, finish_reason: 'stop' }], usage: {} });
        }
      }
      return send(404, { error: { message: 'nope' } });
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    resolve({ server, calls, base: `http://127.0.0.1:${address.port}` });
  }));
}

async function pair(base) {
  const config = { orinApi: base, perMin: 60, timeoutMs: 10000, maxMessageChars: 12000, maxMessages: 100, maxRequestBytes: 65536, version: 'test' };
  const backend = orinBackend(config);
  const server = buildMcpServer({ backend, config, auth: new Authenticator(backend), limits: new RateLimit(), getToken: () => TOKEN, requestId: () => 'req-e2e' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'e2e', version: '1' }, { capabilities: {} });
  await Promise.all([client.connect(clientTransport), server.connect(serverTransport)]);
  return { client, close: () => Promise.all([client.close(), server.close()]) };
}

test('e2e: verify → models → chat → usage over real HTTP', async (t) => {
  const stub = await stubBackend();
  t.after(() => new Promise((resolve) => stub.server.close(resolve)));
  const { client, close } = await pair(stub.base);
  try {
    assert.equal((await client.listTools()).tools.length, 4);
    assert.match((await client.callTool({ name: 'orin_list_models', arguments: {} })).content[0].text, /orin-balanced/);
    assert.match((await client.callTool({ name: 'orin_generate', arguments: { prompt: 'hello', model: 'orin-balanced' } })).content[0].text, /e2e:1/);
    assert.match((await client.callTool({ name: 'orin_usage', arguments: {} })).content[0].text, /"text":3/);
    assert.ok(stub.calls.verify >= 1);
    assert.equal(stub.calls.chat, 1);
  } finally { await close(); }
});

test('e2e: backend 400 surfaces as a tool error with the backend message', async (t) => {
  const stub = await stubBackend();
  t.after(() => new Promise((resolve) => stub.server.close(resolve)));
  const { client, close } = await pair(stub.base);
  try {
    const result = await client.callTool({ name: 'orin_generate', arguments: { prompt: 'x', model: 'orin-bogus' } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Unknown model/);
  } finally { await close(); }
});

test('e2e: backend down fails at auth as a protocol error', async (t) => {
  const stub = await stubBackend();
  t.after(() => new Promise((resolve) => stub.server.close(resolve)));
  const { client, close } = await pair('http://127.0.0.1:1');
  try {
    await assert.rejects(client.callTool({ name: 'orin_generate', arguments: { prompt: 'hi' } }), /Cannot reach the Orin backend/);
  } finally { await close(); }
});
