/**
 * Structured MCP errors. Codes are stable, client-safe, and never carry
 * secrets, stack traces, or provider internals.
 */
export type McpCode =
  | 'AUTHENTICATION_FAILED'
  | 'AUTHORIZATION_FAILED'
  | 'MODEL_NOT_FOUND'
  | 'MODEL_UNAVAILABLE'
  | 'RATE_LIMITED'
  | 'INVALID_REQUEST'
  | 'PROVIDER_ERROR'
  | 'TIMEOUT'
  | 'INTERNAL_ERROR';

export class McpError extends Error {
  readonly code: McpCode;
  constructor(code: McpCode, message: string) {
    super(message);
    this.name = 'McpError';
    this.code = code;
  }
}
