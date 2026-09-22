/** Argument validation. Typed schemas, hard caps, no `Record<string, any>`. */
import { McpError } from './errors.js';
import type { GenerateArgs, OrinMessage } from './types.js';

export function cleanMessages(raw: unknown, maxN: number, maxChars: number): OrinMessage[] {
  if (!Array.isArray(raw) || !raw.length) throw new McpError('INVALID_REQUEST', '"messages" must be a non-empty array.');
  if (raw.length > maxN) throw new McpError('INVALID_REQUEST', `Too many messages (max ${maxN}).`);
  return raw.map((m, i) => {
    const role = (m as { role?: unknown })?.role;
    if (role !== 'system' && role !== 'user' && role !== 'assistant') {
      throw new McpError('INVALID_REQUEST', `Message ${i} has an invalid role.`);
    }
    const c = (m as { content?: unknown })?.content;
    const content = typeof c === 'string' ? c
      : Array.isArray(c) ? c.map((p) => (typeof p === 'string' ? p : (p as { text?: unknown })?.text ?? '')).join('\n')
      : '';
    if (!content.trim()) throw new McpError('INVALID_REQUEST', `Message ${i} is empty.`);
    if (content.length > maxChars) throw new McpError('INVALID_REQUEST', `Message ${i} exceeds ${maxChars} chars.`);
    return { role, content };
  });
}

export function cleanGenerateArgs(raw: unknown, maxN: number, maxChars: number): Required<Pick<GenerateArgs, 'model' | 'messages'>> & GenerateArgs {
  if (!raw || typeof raw !== 'object') throw new McpError('INVALID_REQUEST', 'Arguments object required.');
  const a = raw as Record<string, unknown>;
  let messages: OrinMessage[];
  if (typeof a.prompt === 'string' && a.prompt.trim()) {
    if (a.prompt.length > maxChars) throw new McpError('INVALID_REQUEST', `"prompt" exceeds ${maxChars} chars.`);
    const prompt = a.prompt.trim();
    messages = [];
    if (typeof a.system === 'string' && a.system.trim()) {
      if (a.system.length > maxChars) throw new McpError('INVALID_REQUEST', `"system" exceeds ${maxChars} chars.`);
      messages.push({ role: 'system', content: a.system.trim() });
    }
    messages.push({ role: 'user', content: prompt });
  } else if (a.messages !== undefined) {
    messages = cleanMessages(a.messages, maxN, maxChars);
  } else {
    throw new McpError('INVALID_REQUEST', 'Provide "prompt" or "messages".');
  }
  const model = typeof a.model === 'string' && a.model ? a.model : 'orin-balanced';
  const out: Required<Pick<GenerateArgs, 'model' | 'messages'>> & GenerateArgs = { model, messages };
  if (typeof a.temperature === 'number') {
    if (a.temperature < 0 || a.temperature > 2) throw new McpError('INVALID_REQUEST', '"temperature" must be 0–2.');
    out.temperature = a.temperature;
  }
  if (typeof a.max_tokens === 'number') {
    if (!Number.isInteger(a.max_tokens) || a.max_tokens < 1 || a.max_tokens > 16000) {
      throw new McpError('INVALID_REQUEST', '"max_tokens" must be 1–16000.');
    }
    out.max_tokens = a.max_tokens;
  }
  return out;
}

export function cleanText(raw: unknown, field: string, max: number): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new McpError('INVALID_REQUEST', `"${field}" is required.`);
  if (raw.length > max) throw new McpError('INVALID_REQUEST', `"${field}" exceeds ${max} chars.`);
  return raw;
}
