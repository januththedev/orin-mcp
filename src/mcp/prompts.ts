/**
 * MCP prompts — reusable message templates built on real chat capability.
 * Prompts only package messages; execution happens through orin_chat.
 */
import { cleanCodeReviewArgs } from './tools.js';
import { cleanText } from '../validation.js';

export const PROMPT_DEFS = [
  {
    name: 'orin_summarize',
    description: 'Summarize the given text in a few tight sentences.',
    arguments: [{ name: 'text', description: 'Text to summarize', required: true }],
  },
  {
    name: 'orin_code_review',
    description: 'Review code for bugs, security issues, and clarity.',
    arguments: [
      { name: 'code', description: 'Code to review', required: true },
      { name: 'language', description: 'Language hint (optional)', required: false },
    ],
  },
];

export function getPrompt(name: string, args: Record<string, string>): {
  description?: string;
  messages: Array<{ role: 'user'; content: { type: 'text'; text: string } }>;
} {
  if (name === 'orin_summarize') {
    const text = cleanText(args.text, 'text', 30_000);
    return {
      description: 'Summarize text with Orin',
      messages: [{ role: 'user', content: { type: 'text', text: `Summarize this in a few tight sentences:\n\n${text}` } }],
    };
  }
  if (name === 'orin_code_review') {
    const { code, language } = cleanCodeReviewArgs({ code: args.code, language: args.language });
    return {
      description: 'Review code with Orin',
      messages: [{
        role: 'user',
        content: {
          type: 'text',
          text: `Review this ${language} code for bugs, security issues, and clarity. Be specific with line-level findings:\n\n${code}`,
        },
      }],
    };
  }
  const err = new Error(`Unknown prompt '${String(name).slice(0, 60)}'.`) as Error & { code?: number };
  err.code = -32602;
  throw err;
}
