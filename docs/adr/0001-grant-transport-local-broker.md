# ADR-0001 Grant transport is a local broker (MCP + CLI shims)

Status: accepted · 2026-09-04

The UX memo left open how agents request access. Decision: main runs a JSON-RPC broker on a per-user Unix socket / named pipe. Agents reach it through (a) a `styx mcp` stdio MCP server auto-injected into each CLI's MCP config (Claude Code `--mcp-config`, Codex `-c mcp_servers…`, Gemini `.gemini/settings.json`, cursor-agent `.cursor/mcp.json`) and (b) the `styx` CLI plus provider shims (`vercel gh aws gcloud supabase ssh`) prepended to the session PATH, which call `exec_authorize` and exec the real binary with injected credentials. Output-sniffing of failed auth is not implemented in v1.
Consequences: deterministic, auditable (captures the triggering command), works for shell sessions; agents that bypass the shims simply get "not logged in".

Update (2026-10): That consequence described the token-only setup at the time. Styx now reuses provider CLI logins by default, so an agent that calls a signed-in CLI by its full path can use that login without a Styx grant. Styx may warn about a detected bypass, but cannot block or audit that CLI use. See the [current security model](https://heystyx.com/docs/access/security-model).
