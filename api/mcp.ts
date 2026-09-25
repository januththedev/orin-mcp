/** Vercel route: POST/GET/DELETE /api/mcp → Streamable HTTP (stateless). */
import mcpHttp from '../src/mcp/transport/http.js';

export const config = { maxDuration: 60 };

export default async function handler(req: any, res: any): Promise<void> {
  await mcpHttp(req, res);
}
