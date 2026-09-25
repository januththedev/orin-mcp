/**
 * Structured logs. Every line carries requestId + credential hash + model +
 * latency + status. Secrets are never logged — grep the codebase for
 * `console.` in review; only this module may emit.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  requestId?: string;
  tokenHash?: string;
  uid?: string;
  model?: string;
  tool?: string;
  latencyMs?: number;
  status?: string;
  error?: string;
}

function safe(v: unknown): string {
  if (v === undefined || v === null) return '';
  return String(v).slice(0, 300);
}

export function log(level: LogLevel, message: string, fields: LogFields = {}): void {
  const at = new Date().toISOString();
  const parts = [`[${at}]`, level.toUpperCase(), safe(message)];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined && v !== '') parts.push(`${k}=${safe(v)}`);
  }
  const line = parts.join(' ');
  console.error(line);
}
