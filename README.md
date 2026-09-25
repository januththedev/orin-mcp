# Orin MCP

Use Orin's four model chains from Claude, Cursor, VS Code, and other MCP clients through hosted Streamable HTTP or local stdio.

## Install

Mint a scoped token in **Orin Chat → Account → MCP tokens**, then install from GitHub:

```bash
npx -y github:januththedev/orin-mcp
ORIN_MCP_TOKEN=… orin-mcp
```

The package runs `prepare`/`prepack`, so `dist/cli.js` is built before execution. The npm dry-run package test verifies that the binary is included.

Hosted endpoint:

```text
https://mcp.orinai.org/api/mcp
Authorization: Bearer <scoped-token>
```

## Tools and scopes

- `orin_chat`, `orin_generate` — `chat:generate`
- `orin_list_models` and `orin://models` — `models:read`
- `orin_usage` and `orin://usage` — `usage:read`

Core enforces the same scopes on its direct `/api/mcp` endpoint. A token cannot bypass MCP scope checks by calling Orin Core directly.

## Presets

- `orin-cheap`
- `orin-balanced`
- `orin-thinking`
- `orin-coding`

MCP requests are bounded to 100 messages, 12,000 characters per message, and 64 KiB aggregate request size.

## Configuration

| Variable | Required | Purpose |
|---|---|---|
| `ORIN_MCP_TOKEN` | stdio | Scoped Orin MCP credential |
| `ORIN_API` | No | `https://orinai.org`; loopback requires `ORIN_ALLOW_LOCAL_CORE=1` |
| `ORIN_MCP_PER_MIN` | No | Per-credential limit, default 60/min |
| `ORIN_MCP_TIMEOUT_MS` | No | Backend timeout, capped at 30 seconds |

Diagnostics always use stderr so stdio stdout remains valid JSON-RPC.

## Development

```bash
npm ci
npm run platform:build
npm run typecheck
npm test
npm run test:package
```

Tests are hermetic and use only local fakes. No live Orin, model, or external network call is made.

## Security

- Tokens and provider secrets are never logged.
- Core verifies revocation and exact token type/scopes.
- HTTP accepts only a bounded bearer token shape.
- Provider API URLs are fixed to the trusted Orin Core origin.
- Local stdio logs cannot corrupt the MCP protocol stream.
- Unknown tool input is rejected before backend access.

## License

MIT
