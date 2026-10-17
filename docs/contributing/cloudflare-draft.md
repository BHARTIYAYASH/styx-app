# Cloudflare adapter: early review draft

This is the adapter and classification-test starting point invited in
[issue #22](https://github.com/NicholasFlemmer/styx-app/issues/22#issuecomment-6057956906).
It follows the [target guide](adding-a-target.md), also published as
[Add a deploy target](https://heystyx.com/docs/contributing/add-a-target).
It does not complete the accepted connection → reads/logs → non-production upload slice.

## Present boundary

`CloudflareAdapter` is intentionally absent from the provider registry, core provider enum, database migrations,
connect UI and CLI shims. It implements the existing adapter surface except the closed provider type.
`issue()` always throws: no grant receives credentials, no Wrangler command is broker-executable through this
adapter, and no executable non-production upload path is enabled. `revoke()` has nothing to revoke.
Classification below describes risk; it is not an execution allowlist. A separate pure operation planner validates
exact-target read/log requests and proposed upload manifests without executing them or authorizing a grant.
The concrete transport blockers and maintainer decision are in
[Cloudflare execution: maintainer decision needed](cloudflare-execution-decision.md).

## Connection and health

- CLI login is the only connection method. `cliLoginCommand()` describes `wrangler login` for a future visible
  login flow; the adapter does not run login. Advanced token paste is unavailable.
- Wrangler must be **exactly 4.151.0**, the reviewed source version; it was not installed or run for this draft.
  Other versions, including prereleases, are refused until their authentication and logging contracts are reviewed.
  JSON support alone is insufficient: 4.65.0's
  [auth command](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.65.0/packages/wrangler/src/user/commands.ts)
  sends token output through a [logger](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.65.0/packages/wrangler/src/logger.ts)
  that writes it to disk and lacks the logging opt-out used here.
- `whoami --json` supplies account membership. The caller must choose an exact, 32-character lowercase hex
  account ID, even when only one account exists. Account display names and an active-account default are not selectors.
- Discovery temporarily reads a bearer token through `auth token --json`, then performs a GET against the fixed
  `https://api.cloudflare.com/client/v4/accounts/<accountId>/workers/scripts` endpoint with redirects refused.
  It accepts OAuth/API-token JSON and rejects global API-key/email credentials.
- Connection requires an explicit Worker name found in that account: lowercase letters, digits and hyphens,
  with alphanumeric endpoints and at most 63 characters, matching the classifier. Target config contains only
  `accountId` and `workerName`; the vault stores only `{ kind: 'cli', account: accountId }`. No token is copied into the vault.
  Every discovery/health check obtains the current credential again and verifies the saved selection.
- CLI probes run outside the lane directory. `CliRunOptions.unsetEnv` removes inherited Cloudflare credentials,
  account/API/auth overrides and `NODE_OPTIONS` entirely; excluded names are matched case-insensitively on Windows.
  Each call sets `WRANGLER_WRITE_LOGS=false`, supported by the pinned
  [4.151.0 logger](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.151.0/packages/wrangler/src/logger.ts),
  to prevent the [auth command's](https://github.com/cloudflare/workers-sdk/blob/wrangler%404.151.0/packages/wrangler/src/user/commands.ts)
  token output reaching disk logs. These per-call controls do not replace integration-wide environment hygiene.
- Health distinguishes a logged-out CLI or HTTP 401 from missing binaries, timeouts, malformed responses,
  selection errors and HTTP 403 permission failures. Diagnostics never include token stdout or response bodies.

Cloudflare documents that [`auth token`](https://developers.cloudflare.com/workers/wrangler/commands/general/#auth-token)
may refresh an expired OAuth token. It is therefore not guaranteed to leave Wrangler's own credential store
untouched. All draft checks use fakes; no live login, credential refresh, keychain access or Cloudflare request
was performed while developing them.

## Classification table

Inputs are argument arrays after the `wrangler` binary name. Read forms must match exactly; `<worker>` in the
read forms is lowercase alphanumeric/hyphen, at most 63 characters, with alphanumeric endpoints.

| Invocation or command head | Scope |
| --- | --- |
| One standalone `--help`, `-h`, `--version` or `-v` | `read` |
| `whoami` or `whoami --json` | `read` |
| `versions list --name <worker>` or `deployments list --name <worker>` | `read` |
| Same list forms with `--name=<worker>` and/or one optional `--json` | `read` |
| `tail <worker> --format json` | `read` |
| `deploy`, `publish`, `rollback`, `versions upload`, `versions deploy`, `triggers deploy` | `deploy` |
| `pages deploy`, `pages publish` | `deploy` |
| `delete`, `d1 delete`, `d1 time-travel restore` | `delete` |
| `r2 bucket delete`, `r2 object delete` | `delete` |
| `kv namespace delete`, `kv key delete`, `kv bulk delete` | `delete` |
| `secret delete`, `versions secret delete`, `pages project delete`, `pages deployment delete` | `delete` |
| Everything else, including login/logout, `auth token`, config/global overrides, D1/R2 lists, SQL and unknown verbs | `write` |

Empty arguments, control characters and shell syntax fail closed to `write` before the command table is applied.
Mutation heads retain their scope with appended help flags. Read-looking option values, duplicate flags, extra
positionals and aliases do not establish read access. `envOfCommand()` always returns `null`; neither
`--env staging` nor a version upload proves isolation from production resources. The tests exercise these distinctions.

## Proposed next path

`cloudflare-operation.ts` is the next local groundwork: it produces normalized, bounded operation plans instead of
passing through raw CLI arguments. It rejects target mismatches, unsupported flags and production uploads. An upload
manifest is only a description; main must snapshot the artifact, compute its digest, and bind approval to those bytes.
A successful plan does not grant access or prove that a remote Worker is non-production.

The next candidate is [`versions upload`](https://developers.cloudflare.com/workers/wrangler/commands/workers/#versions-upload)
to a separately selected non-production Worker. Cloudflare separates a version upload from a deployment that
changes traffic, but uploading still mutates remote state and therefore remains classified `deploy`.

Before enabling it, execution must be bound to the approved command, account, Worker and artifact. Styx must own
a minimal configuration and use a prebuilt artifact, excluding repository build hooks, arbitrary configuration,
bindings, migrations, assets and account/endpoint overrides until each is reviewed. Credentials must stay inside
that execution path and must never be exposed through `get_credential` or a general agent environment bundle.
Broad Wrangler credentials cannot honestly be described as narrowed to a Styx grant.

Production traffic changes, DNS, D1/R2 mutations and destructive operations remain forbidden. A Pages preview
path is not part of this draft. A classification entry for a dangerous command does not enable that command.

## Before registration

- [ ] Review and implement command-bound execution, credential containment, exact target binding, audit events,
      expiry/revoke behavior and denial of unsupported operations. Test broker bypasses and `get_credential` denial.
- [ ] Resolve the CLI credential-refresh behavior and approved login flow; verify environment/profile/config
      isolation and the pinned Wrangler contract on macOS, Windows and Linux with fixture CLIs. Review logging
      and authentication again before accepting another Wrangler version.
- [ ] Add the core/provider types, database migration, registry, shims and absolute-path CLI detection together.
- [ ] Add global credential stripping/redaction, fixture credentials, fake Wrangler binaries and Windows twins.
- [ ] Integrate account/Worker selection, health/reconnect UI, grant copy and provider lists; add the required
      stories, screenshots, discrepancy row and website/README documentation without advertising disabled features.
- [ ] Implement the constrained non-production upload and test that production traffic, DNS, D1/R2 operations,
      repository configuration and build hooks cannot be reached through it.
- [ ] Run the repository security reviewer and required typecheck, lint, unit, broker/service and applicable UI
      checks. Record actual command results in the review; this note does not claim any checks passed.

Tests use `MemoryVault`, `FakeCliRunner` and stubbed fetch responses only. No real credentials or live provider
mutations are needed to review this draft. It was authored with OpenAI Codex assistance; no specific model identity
is asserted. No additional AI-attribution mandate was found in the repository contribution rules or PR template.
