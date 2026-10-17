# Cloudflare execution: maintainer decision needed

Status: proposed; not an accepted ADR or an enabled feature. Related to [issue #22](https://github.com/NicholasFlemmer/styx-app/issues/22).
The adapter/classifier draft stays unregistered and `issue()` refuses every scope.

## Decision requested

Approve a **broker-owned execution mode** alongside credential-issuing providers: an explicit target ID and typed
operation enter main; bounded output and an exit/result status leave it. The Cloudflare credential must remain
inside main and its controlled child, never in a shim response, `get_credential`, or an agent environment.

This changes the transport described in [ADR-0001](../adr/0001-grant-transport-local-broker.md). An adapter-only
change cannot provide the promised restrictions. The alternative is to keep Cloudflare execution disabled; returning
a broad token or an empty env bundle is not a safe substitute for the new mode.

For the first upload, confirm the narrower scope: **one prebuilt single-module artifact to a separately selected,
human-confirmed non-production Worker**, with resource/secret inheritance excluded until reviewed. A target label
such as `staging`, or a successful planner result, does not prove that the remote Worker is isolated.

Also confirm the security boundary: these controls govern Styx-managed operations. The current shims steer CLI
use; they do not sandbox same-user agents away from a Wrangler login stored in the user's home. Preventing direct
CLI/auth-store bypass needs a separate process/credential isolation design, not a classifier claim.

## Why the existing route cannot enforce the slice

| Current code | Consequence for Cloudflare |
| --- | --- |
| [Broker protocol](../../packages/broker/src/protocol.ts), `exec_authorize.result` | Returns `{ grantId, useId, env }`, not a host-executed result. |
| [CLI wrap](../../packages/cli/src/wrap.ts), `wrap()` | Spawns the original arguments locally with the returned environment. The agent receives the broad token. |
| [Broker host](../../apps/desktop/src/main/broker/host.ts), `get_credential` | Exposes the same credential without command classification. |
| [Broker host](../../apps/desktop/src/main/broker/host.ts), `pickTarget()` | Chooses by provider/environment, then falls back to the first target. An exact account/Worker is not an authorization key. |
| [Grant service](../../apps/desktop/src/main/services/grant-service.ts), `issue()` | Calls adapter credential issuance before activation. An execution-only grant has no representation. |
| [Grant service](../../apps/desktop/src/main/services/grant-service.ts), revoke effects | Releases cached credentials and notifies clients; it does not cancel a host-owned tail or upload. |
| [CLI runner](../../apps/desktop/src/main/providers/cli-runner.ts), `CliRunOptions` | Has timeout/env/cwd, but no cancellation signal, bounded output stream, or complete inherited-environment allowlist. |

The `cwd` supplied to `exec_authorize` is not used to snapshot or bind an upload artifact. A reusable `read` or
`deploy` grant is not approval of arbitrary resource names, arguments, repository configuration or changing files.

## Safe local groundwork

The pure `cloudflare-operation.ts` planner validates a narrow operation vocabulary and produces normalized plans
for exact-target version/deployment lists, bounded log tails, and a proposed non-production version upload.
Its tests exercise target mismatches, dangerous/unknown flags and commands, production uploads, invalid manifests,
and operation budgets. It performs no filesystem reads, token retrieval, provider calls, login or execution.

**A plan is neither authorization nor an executable command.** The planner receives a target snapshot and artifact
manifest; it cannot prove their provenance or verify a digest against file contents. Main must obtain the target
from its database, bind its revision, capture immutable artifact bytes and compute their digest itself before
approval. An agent-provided manifest must never be treated as that verification.

## Required integration contract

1. Introduce an execution-only provider capability and a typed operation RPC. Do not activate a grant by inventing
   an `IssuedCredential` with empty env. Deny `get_credential` and the old env-returning `exec_authorize` for this mode.
2. Bind the authenticated broker session and project to an explicit target ID, target revision, account ID, Worker,
   operation and (for upload) artifact digest. Do not reuse `pickTarget()`'s first-target fallback.
3. Request approval for that immutable operation. Immediately before dispatch, re-read persisted grant state,
   expiry, target revision and session ownership after all asynchronous auth/artifact preparation. A cached
   credential or a supplied `GrantInfo` is not a liveness check.
4. Define atomic `once` consumption and operation start. The expected once-consumed transition must not cancel its
   own operation; user revoke, expiry, target change, disconnect and session end must stop it.
5. Execute in an owned scratch directory with a minimal generated config and a controlled environment. Never run
   repository build hooks or pass through agent flags, `.env`, `--config`, `--cwd`, bindings, assets, migrations,
   containers, secrets, account/endpoint overrides or unreviewed settings. Keep output bounded and redacted.
6. For log tails, main owns the temporary remote tail session, bounded stream and cleanup. Cancellation must attempt
   graceful cleanup before force termination. Tailing is observational but creates/removes a remote session.
7. For upload, use the immutable artifact and exact approved non-production Worker. Reject production/scm targets;
   never fall back from version upload to `deploy`, and never change routes, domains or deployment percentages.
   Review remote inherited secrets/resources and race behavior before claiming isolation.
8. Audit approval, denial, start, finish, cancellation and failure through existing append-only services. Main must
   report actual completion; an agent-supplied exit code is not evidence of a broker-owned operation.

Integration tests must cover expired/revoked grants, cross-session/project/target requests, changed targets/artifacts,
parallel once use, disconnect/timeout/cleanup, credential API denial, output limits, and bypass attempts through both
legacy broker routes. Production traffic, DNS and destructive D1/R2 paths remain unavailable.

No maintainer message, issue reply or publication has been sent. This proposal and the code are local review materials.
