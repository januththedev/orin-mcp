export interface McpConfig {
  orinApi: string;
  perMin: number;
  timeoutMs: number;
  maxMessageChars: number;
  maxMessages: number;
  maxRequestBytes: number;
  version: string;
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function trustedApi(raw: string | undefined, allowLocal: boolean): string {
  const value = new URL((raw || 'https://orinai.org').replace(/\/+$/, ''));
  if (value.username || value.password || value.search || value.hash) throw new Error('ORIN_API is not trusted');
  if (value.origin === 'https://orinai.org' && value.pathname === '/') return value.origin;
  if (allowLocal && value.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(value.hostname) && value.port) return value.origin;
  throw new Error('ORIN_API must be https://orinai.org or an explicitly enabled loopback origin');
}

export function loadConfig(env: Record<string, string | undefined> = process.env): McpConfig {
  return {
    orinApi: trustedApi(env.ORIN_API, env.ORIN_ALLOW_LOCAL_CORE === '1'),
    perMin: num(env.ORIN_MCP_PER_MIN, 60),
    timeoutMs: Math.min(num(env.ORIN_MCP_TIMEOUT_MS, 15_000), 30_000),
    maxMessageChars: 12_000,
    maxMessages: 100,
    maxRequestBytes: 64 * 1024,
    version: '1.1.0',
  };
}
