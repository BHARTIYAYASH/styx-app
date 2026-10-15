import { z } from 'zod';
import { makeCredentialRef } from '../services/credential-vault';
import { CliAuthError, cliFailure, readCliEntry, semver } from './cli-auth';
import { cloudflareScopeOfCommand } from './cloudflare-scope';
import type {
  AdapterDeps,
  CliCommand,
  CliStatus,
  ConnectInput,
  GrantInfo,
  HealthResult,
  IssuedCredential,
  ProjectSource,
  ProviderAdapter,
  ProviderProject,
  Scope,
  TargetInfo,
  TestResult,
} from './types';

const accountIdSchema = z.string().regex(/^[a-f0-9]{32}$/);
const workerNameSchema = z.string().regex(/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/);
const selectionSchema = z.object({ accountId: accountIdSchema, workerName: workerNameSchema });
const whoamiSchema = z.discriminatedUnion('loggedIn', [
  z.object({ loggedIn: z.literal(false) }),
  z.object({
    loggedIn: z.literal(true),
    accounts: z.array(z.object({ id: accountIdSchema, name: z.string().min(1) })),
  }),
]);
const tokenSchema = z.object({
  type: z.enum(['oauth', 'api_token']),
  token: z.string().min(1).regex(/^\S+$/),
});
const workersSchema = z.object({
  success: z.literal(true),
  result: z.array(z.object({ id: workerNameSchema })),
});

// Auth probes must use Wrangler's own login, not an inherited CI token or API endpoint override. These are
// per-call overrides (the draft is not registered). Integration must also strip these from agent launch env.
const CLI_UNSET_ENV = [
  'CLOUDFLARE_API_TOKEN',
  'CF_API_TOKEN',
  'CLOUDFLARE_API_KEY',
  'CF_API_KEY',
  'CLOUDFLARE_EMAIL',
  'CF_EMAIL',
  'CLOUDFLARE_ACCOUNT_ID',
  'CF_ACCOUNT_ID',
  'CLOUDFLARE_API_BASE_URL',
  'CF_API_BASE_URL',
  'WRANGLER_API_BASE_URL',
  'WRANGLER_API_ENVIRONMENT',
  'WRANGLER_AUTH_DOMAIN',
  'WRANGLER_AUTH_URL',
  'WRANGLER_TOKEN_URL',
  'WRANGLER_REVOKE_URL',
  'WRANGLER_CLIENT_ID',
  'NODE_OPTIONS',
];
const CLI_ENV: Record<string, string> = {
  WRANGLER_SEND_METRICS: 'false',
  WRANGLER_SEND_ERROR_REPORTS: 'false',
  WRANGLER_WRITE_LOGS: 'false',
  CI: '1',
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
};

class SelectionError extends Error {}

type DraftTarget = Pick<TargetInfo, 'config' | 'credentialRef'>;
type DraftProjectSource =
  Exclude<ProjectSource, { kind: 'target' }> | { kind: 'target'; target: DraftTarget };

/**
 * Early draft for #22, deliberately NOT in ProviderRegistry, the core enum, or SHIM_TOOLS.
 * CLI login only; the vault stores { kind: 'cli', account }, never a token. Only the reviewed Wrangler 4.151.0
 * contract is accepted, with disk logs disabled (older releases log auth-token stdout without an opt-out).
 * Auth-token retrieval may refresh Wrangler's OAuth login; tests use FakeCliRunner only.
 * Worker discovery uses the selected account's fixed HTTPS API endpoint, never a repository's Wrangler config.
 *
 * read = the small listing/logging vocabulary in cloudflare-scope; upload/traffic changes = deploy; destructive
 * verbs = delete; unknown = write. Classification is NOT an execution allowlist. No env credential is issued:
 * Wrangler's OAuth/API tokens are unscoped to the grant, and issue(grant, target) cannot constrain argv/config.
 * Production traffic, DNS, D1/R2 writes, and even the proposed non-production version upload remain unavailable
 * until command-bound execution is reviewed and tested. See docs/contributing/cloudflare-draft.md.
 *
 * Omit only the provider tag so the draft checks the existing adapter surface without advertising a usable
 * provider in the domain schema, database or UI. Registration is a separate, explicit integration step.
 */
export class CloudflareAdapter implements Omit<ProviderAdapter, 'provider'> {
  readonly provider = 'cloudflare' as const;
  readonly authMethod = 'oauth' as const;
  readonly tools = ['wrangler'];
  readonly projectKey = 'workerName';

  constructor(private readonly deps: AdapterDeps) {}

  private async run(args: string[]) {
    try {
      return await this.deps.cli.run('wrangler', args, {
        env: { ...CLI_ENV },
        unsetEnv: CLI_UNSET_ENV,
        cwd: this.deps.cli.home,
        timeoutMs: 20_000,
      });
    } catch {
      // Execa and parser errors may contain stdout (including auth tokens). Never propagate them.
      throw new CliAuthError('Could not run Wrangler', false);
    }
  }

  private failure(result: Awaited<ReturnType<CloudflareAdapter['run']>>): CliAuthError {
    const failure = cliFailure('wrangler', result);
    const message = result.missing
      ? 'Wrangler is not installed'
      : result.timedOut
        ? 'Wrangler timed out'
        : failure.expired
          ? 'Wrangler login is unavailable; reconnect using Wrangler'
          : 'Wrangler could not check the Cloudflare login';
    return new CliAuthError(message, failure.expired);
  }

  private async installation() {
    let binary: string | null;
    try {
      binary = await this.deps.cli.which('wrangler');
    } catch {
      throw new CliAuthError('Could not locate Wrangler', false);
    }
    if (!binary) throw new CliAuthError('Wrangler is not installed', false);
    const result = await this.run(['--version']);
    if (result.exitCode !== 0 || result.missing || result.timedOut) throw this.failure(result);
    const version = semver(result.stdout);
    // Earlier JSON-capable versions can log bearer-token stdout to disk and ignore WRANGLER_WRITE_LOGS.
    // Accept only the inspected version, including no prerelease suffix, until another contract is reviewed.
    const supported = result.stdout.trim() === '4.151.0';
    return { binary, version, supported };
  }

  private async accounts() {
    const installation = await this.installation();
    if (!installation.supported)
      throw new CliAuthError('This draft requires the reviewed Wrangler version 4.151.0', false);
    const result = await this.run(['whoami', '--json']);
    // A timeout/missing executable must not look like an expired login, even if partial stdout says logged out.
    if (result.missing || result.timedOut) throw this.failure(result);
    const parsed = whoamiSchema.safeParse(parseJson(result.stdout));
    if (parsed.success && !parsed.data.loggedIn)
      throw new CliAuthError('Wrangler is not logged in; reconnect using Wrangler', true);
    if (result.exitCode !== 0) throw this.failure(result);
    if (!parsed.success || !parsed.data.loggedIn)
      throw new CliAuthError('Wrangler returned an unreadable account list', false);
    return parsed.data.accounts;
  }

  async cliStatus(): Promise<CliStatus> {
    const loginCommand = 'wrangler login';
    let binary: string | null;
    try {
      binary = await this.deps.cli.which('wrangler');
    } catch {
      throw new CliAuthError('Could not locate Wrangler', false);
    }
    if (!binary) return { installed: false, binary: null, version: null, loginCommand, accounts: [] };
    const installed = await this.installation();
    const accounts = installed.supported
      ? await this.accounts().catch((error: unknown) => {
          if (error instanceof CliAuthError && error.expired) return [];
          throw error;
        })
      : [];
    return {
      installed: true,
      binary: installed.binary,
      version: installed.version,
      loginCommand,
      // Membership is not a default selection. Even a single account requires an explicit pick at connect.
      accounts: accounts.map((a) => ({ id: a.id, label: a.name, active: false })),
    };
  }

  cliLoginCommand(): CliCommand {
    // Returned for a future user-visible connect flow; this adapter never runs login itself.
    return { bin: 'wrangler', args: ['login'] };
  }

  private account(value: unknown): string {
    const parsed = accountIdSchema.safeParse(value);
    if (!parsed.success) throw new SelectionError('Choose an exact Cloudflare account ID');
    return parsed.data;
  }

  private async workers(account: string): Promise<ProviderProject[]> {
    const accountId = this.account(account);
    const accounts = await this.accounts();
    if (!accounts.some((a) => a.id === accountId))
      throw new SelectionError('The selected Cloudflare account is not available to the Wrangler login');
    const result = await this.run(['auth', 'token', '--json']);
    if (result.exitCode !== 0 || result.missing || result.timedOut) throw this.failure(result);
    const parsed = tokenSchema.safeParse(parseJson(result.stdout));
    if (!parsed.success)
      throw new CliAuthError('Wrangler did not return a supported bearer credential', false);
    let response: Response;
    try {
      response = await this.deps.fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts`,
        {
          method: 'GET',
          headers: { Authorization: `Bearer ${parsed.data.token}` },
          redirect: 'error',
          signal: AbortSignal.timeout(20_000),
        },
      );
    } catch {
      throw new CliAuthError('Could not reach Cloudflare to list Workers', false);
    }
    if (!response.ok)
      throw new CliAuthError(
        `Cloudflare could not list Workers (${response.status})`,
        response.status === 401,
      );
    const workers = workersSchema.safeParse(await response.json().catch(() => null));
    if (!workers.success) throw new CliAuthError('Cloudflare returned an unreadable Worker list', false);
    return workers.data.result.map((worker) => ({ id: worker.id, name: worker.id, region: null }));
  }

  private async savedAccount(target: Pick<TargetInfo, 'config' | 'credentialRef'>): Promise<string> {
    const accountId = this.account(target.config['accountId']);
    let entry;
    try {
      entry = await readCliEntry(this.deps.vault, target);
    } catch {
      throw new CliAuthError('Cloudflare CLI connection is missing or unreadable', false);
    }
    if (!entry) throw new CliAuthError('Connect Cloudflare using the Wrangler login', false);
    if (entry.account !== accountId)
      throw new SelectionError('The saved Cloudflare account does not match the target');
    return accountId;
  }

  async listProjects(source: DraftProjectSource): Promise<ProviderProject[]> {
    if (source.kind === 'token') throw new Error('This Cloudflare draft supports the Wrangler login only');
    return this.workers(source.kind === 'cli' ? source.account : await this.savedAccount(source.target));
  }

  async connect(input: ConnectInput, targetId: string) {
    if (input.method !== 'cli') throw new Error('This Cloudflare draft supports the Wrangler login only');
    const accountId = this.account(input.account);
    const selection = selectionSchema.safeParse({ ...input.config, accountId });
    if (!selection.success) throw new SelectionError('Choose an exact Cloudflare Worker name');
    if (input.config?.['accountId'] !== undefined && input.config['accountId'] !== accountId)
      throw new SelectionError('The selected Cloudflare account does not match the target');
    const workers = await this.workers(accountId);
    if (!workers.some((w) => w.id === selection.data.workerName))
      throw new SelectionError('The selected Worker is not available in this Cloudflare account');
    const ref = makeCredentialRef('cloudflare', targetId, 'cli');
    await this.deps.vault.set(ref, JSON.stringify({ kind: 'cli', account: accountId }));
    return { credentialRef: ref, config: selection.data, label: input.name ?? 'Cloudflare' };
  }

  private async check(target: Pick<TargetInfo, 'config' | 'credentialRef'>) {
    const parsed = selectionSchema.safeParse(target.config);
    if (!parsed.success) throw new SelectionError('Choose an exact Cloudflare account and Worker');
    const account = await this.savedAccount(target);
    const workers = await this.workers(account);
    if (!workers.some((w) => w.id === parsed.data.workerName))
      throw new SelectionError('The selected Worker is not available in this Cloudflare account');
    return { ok: true as const, identity: `${parsed.data.workerName} (${account})` };
  }

  async test(target: Pick<TargetInfo, 'config' | 'credentialRef'>): Promise<TestResult> {
    try {
      return await this.check(target);
    } catch (error) {
      return {
        ok: false,
        error: this.safeMessage(error),
        ...(error instanceof SelectionError ? { needsProject: true } : {}),
      };
    }
  }

  async health(target: Pick<TargetInfo, 'config' | 'credentialRef'>): Promise<HealthResult> {
    try {
      return await this.check(target);
    } catch (error) {
      return {
        ok: false,
        expired: error instanceof CliAuthError && error.expired,
        error: this.safeMessage(error),
      };
    }
  }

  private safeMessage(error: unknown): string {
    return error instanceof SelectionError || error instanceof CliAuthError
      ? error.message
      : 'Could not check the Cloudflare connection';
  }

  async issue(
    _grant: GrantInfo,
    _target: Pick<TargetInfo, 'config' | 'credentialRef'>,
  ): Promise<IssuedCredential> {
    throw new Error(
      'Cloudflare execution is unavailable in this draft; command-bound enforcement is required',
    );
  }

  async revoke(): Promise<void> {}

  scopeOfCommand(argv: string[]): Scope[] {
    return cloudflareScopeOfCommand(argv);
  }

  envOfCommand(): null {
    // Neither --env staging nor versions upload proves isolation from production resources/configuration.
    return null;
  }
}
