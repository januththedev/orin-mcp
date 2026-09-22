# Orin MCP

Bring Orin models into Claude, Cursor and VS Code. MCP server
(Streamable HTTP + stdio) + connection site. Part of the
[Orin AI ecosystem](https://orinai.org) · MIT licensed.

Live: `https://mcp.orinai.org` · **Not a Claude-limit bypass** — your
subscription is untouched; Orin usage flows through your Orin quotas.

## Architecture

```
Claude / Cursor / VS Code
  │  MCP (Streamable HTTP @ /api/mcp, or stdio via `orin-mcp`)
  ▼
ORIN MCP (this repo — protocol, auth, scopes, limits)
  │  Bearer MCP token → verify → scope check → backend
  ▼
Orin backend (orinai.org — chat/models/usage, same quotas as web)
```

```
src/
  mcp/server.ts        protocol wiring (tools/resources/prompts)
  mcp/tools.ts         orin_chat/generate/list_models/usage + gating
  mcp/resources.ts     orin://models, orin://usage
  mcp/prompts.ts       orin_summarize, orin_code_review
  mcp/transport/http.ts  stateless Streamable HTTP glue
  auth.ts              Bearer → verify (60s cache) → scopes
  services/orin.ts     the ONLY backend client
  validation.ts        typed schemas + hard caps (no Record<string,any>)
  rate-limit.ts        per-credential limiter
  errors.ts            stable client-safe codes
  logging.ts           structured logs, request IDs, no secrets
  config.ts            env
  cli.ts               stdio entry
api/mcp.ts             Vercel route (thin skin over transport/http)
test/                  18 protocol/auth/security tests (mocked, no network)
index.html             connection site (connect/models/clients/docs)
```

## Getting Started

```bash
git clone https://github.com/januththedev/orin-mcp
cd orin-mcp
npm install
npm test            # 18 tests, mocked backend — no keys, no network
```

1. Sign in to Orin Chat → Account → **MCP tokens** → name, scopes, copy once.
2. Paste the config for your client (all four on the site).
3. Enable Orin, ask your client to use it.

Local stdio alternative:

```bash
npm i -g github:januththedev/orin-mcp
ORIN_MCP_TOKEN=… orin-mcp
```

## Configuration

| Variable | Required | What |
|---|---|---|
| `ORIN_API` | No | Backend base (default `https://orinai.org`). Point at Orin Router when it serves the same compat shape. |
| `ORIN_MCP_PER_MIN` | No | Tool calls/min/credential (default 60). |
| `ORIN_MCP_TIMEOUT_MS` | No | Backend timeout ms (default 120000). |
| `ORIN_MCP_TOKEN` | stdio only | Credential for local runs. |

## Deployment

Vercel → Add New → Project → import → Deploy (no env needed), map
`mcp.orinai.org`. One function (`api/mcp.ts`, 120s). Static `index.html`
serves the connection site from the same deployment.

## API (MCP)

- Tools: `orin_chat`, `orin_generate` (`chat:generate`), `orin_list_models`
  (`models:read`), `orin_usage` (`usage:read`).
- Resources: `orin://models`, `orin://usage` (scope-gated).
- Prompts: `orin_summarize`, `orin_code_review`.
- Auth: `Authorization: Bearer <mcp-token>` per request (HTTP) or
  `ORIN_MCP_TOKEN` (stdio, verified at boot + per call).
- Errors: `AUTHENTICATION_FAILED`, `AUTHORIZATION_FAILED`,
  `MODEL_NOT_FOUND`, `MODEL_UNAVAILABLE`, `RATE_LIMITED`,
  `INVALID_REQUEST`, `PROVIDER_ERROR`, `TIMEOUT`, `INTERNAL_ERROR` —
  never secrets, never traces.

## Development

```bash
npm run typecheck   # tsc --noEmit (strict, no any-leaks)
npm run build       # dist/cli.js for the bin
npm test            # node --test, 18 tests, mocked backend
```

Conventions: no `any` without justification, no `console.*` outside
`logging.ts`, no backend calls outside `services/orin.ts`, no provider
logic in routing/tools.

## Contributing

Fork → branch → PR against `main`. One concern per PR, tests for new
behavior. No keys, no paid services, no telemetry, no fakes.

## License

MIT — see [LICENSE](LICENSE).

## Security

Threat model + mitigations are documented in code (`auth.ts`,
`validation.ts`, `rate-limit.ts`, `services/orin.ts`) and covered by
`test/security.test.mjs`: invalid/expired/revoked tokens, wrong/missing
scopes, oversized/malformed input, prompt-injection non-interference,
backend failure containment, concurrent isolation. Found something?
Open an issue — no public exploits before a fix.
