/** Shared domain types. One definition, imported everywhere. */

export type Scope = 'models:read' | 'chat:generate' | 'usage:read';

export interface McpIdentity {
  uid: string;
  scopes: Scope[];
  /** sha256 of the credential — safe to log, never the secret. */
  tokenHash: string;
}

export interface McpContext {
  identity: McpIdentity;
  requestId: string;
}

export interface OrinMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerateArgs {
  model?: string;
  messages?: OrinMessage[];
  prompt?: string;
  system?: string;
  temperature?: number;
  max_tokens?: number;
}

export interface BackendResult {
  text: string;
  model: string;
}

export interface BackendModel {
  id: string;
  owned_by: string;
}

export interface BackendUsage {
  text: number;
  images: number;
  videos: number;
}
