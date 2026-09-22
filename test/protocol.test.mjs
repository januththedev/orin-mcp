/**
 * Real MCP protocol: initialize, tool/resource/prompt discovery and calls
 * over an in-memory client↔server pair. If the protocol breaks, these fail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { linkedPair, TOKEN } from './_fake.mjs';

test('initialize negotiates and lists 4 tools', async () => {
  const { client, close } = await linkedPair();
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((t) => t.name).sort(), [
      'orin_chat', 'orin_generate', 'orin_list_models', 'orin_usage',
    ]);
    const chat = tools.tools.find((t) => t.name === 'orin_chat');
    assert.ok(chat.inputSchema);
  } finally { await close(); }
});

test('resources and prompts enumerate', async () => {
  const { client, close } = await linkedPair();
  try {
    const res = await client.listResources();
    assert.deepEqual(res.resources.map((r) => r.uri).sort(), ['orin://models', 'orin://usage']);
    const prompts = await client.listPrompts();
    assert.deepEqual(prompts.prompts.map((p) => p.name).sort(), ['orin_code_review', 'orin_summarize']);
  } finally { await close(); }
});

test('orin_generate round-trips through the protocol', async () => {
  const { client, close } = await linkedPair();
  try {
    const out = await client.callTool({ name: 'orin_generate', arguments: { prompt: 'hi', model: 'orin-cheap' } });
    assert.equal(out.isError, undefined);
    const text = out.content[0].text;
    assert.match(text, /"response"/);
    assert.match(text, /echo/);
  } finally { await close(); }
});

test('orin_chat passes messages and returns structured output', async () => {
  const { client, close } = await linkedPair();
  try {
    const out = await client.callTool({
      name: 'orin_chat',
      arguments: { model: 'orin-balanced', messages: [{ role: 'user', content: 'hello' }] },
    });
    const parsed = JSON.parse(out.content[0].text);
    assert.match(parsed.response, /hello/);
    assert.equal(parsed.model, 'orin-balanced');
    assert.equal(parsed.request_id, 'req-test');
  } finally { await close(); }
});

test('orin_list_models and orin_usage return catalogs', async () => {
  const { client, close } = await linkedPair();
  try {
    const m = await client.callTool({ name: 'orin_list_models', arguments: {} });
    const models = JSON.parse(m.content[0].text).models;
    assert.equal(models[0].id, 'orin-balanced');
    assert.ok(Array.isArray(models[0].capabilities));

    const u = await client.callTool({ name: 'orin_usage', arguments: {} });
    assert.deepEqual(JSON.parse(u.content[0].text).usage, { text: 7, images: 0, videos: 0 });
  } finally { await close(); }
});

test('unknown tool is a protocol error, not a crash', async () => {
  const { client, close } = await linkedPair();
  try {
    await assert.rejects(client.callTool({ name: 'nope', arguments: {} }), /Unknown tool/);
  } finally { await close(); }
});

test('resources read through the protocol', async () => {
  const { client, close } = await linkedPair();
  try {
    const m = await client.readResource({ uri: 'orin://models' });
    assert.match(m.contents[0].text, /orin-balanced/);
    const u = await client.readResource({ uri: 'orin://usage' });
    assert.match(u.contents[0].text, /"text":7/);
    await assert.rejects(client.readResource({ uri: 'orin://nope' }), /Unknown resource/);
  } finally { await close(); }
});

test('prompts render without executing', async () => {
  const { client, close } = await linkedPair();
  try {
    const s = await client.getPrompt({ name: 'orin_summarize', arguments: { text: 'long story' } });
    assert.match(s.messages[0].content.text, /long story/);
    const r = await client.getPrompt({ name: 'orin_code_review', arguments: { code: 'x=1', language: 'python' } });
    assert.match(r.messages[0].content.text, /python/);
    await assert.rejects(client.getPrompt({ name: 'nope', arguments: {} }), /Unknown prompt/);
  } finally { await close(); }
});
