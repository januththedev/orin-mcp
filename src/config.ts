/** Runtime config. No secrets with defaults that matter. */
export interface McpConfig {
  orinApi: string;
  perMin: number;
  timeoutMs: number;
  maxMessageChars: number;
  maxMessages: number;
  version: string;
}

function num(v: string | undefined, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): McpConfig {
  return {
    orinApi: (env.ORIN_API || 'https://orinai.org').replace(/\/+$/, ''),
    perMin: num(env.ORIN_MCP_PER_MIN, 60),
    timeoutMs: num(env.ORIN_MCP_TIMEOUT_MS, 120_000),
    maxMessageChars: 50_000,
    maxMessages: 100,
    version: '1.0.0',
  };
}
