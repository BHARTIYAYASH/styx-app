import { describe, expect, it, vi } from 'vitest';
import { MemoryVault } from '../services/credential-vault';
import { FakeCliRunner } from './cli-runner';
import { CloudflareAdapter } from './cloudflare';
import { ProviderRegistry } from './index';
import type { AdapterDeps, GrantInfo, Scope } from './types';

const ACCOUNT = 'a'.repeat(32);
const OTHER_ACCOUNT = 'b'.repeat(32);
const WORKER = 'fixture-preview-worker';
const TOKEN = 'FIXTURE-CLOUDFLARE-TOKEN';
const REF = 'styx:v1:cloudflare:FIXTURE-target:cli';
const target = () => ({ credentialRef: REF, config: { accountId: ACCOUNT, workerName: WORKER } });

function setup() {
  const vault = new MemoryVault();
  const cli = new FakeCliRunner()
    .install('wrangler')
    .on('wrangler', ['--version'], { stdout: '4.151.0' })
    .on('wrangler', ['whoami', '--json'], {
      stdout: JSON.stringify({ loggedIn: true, accounts: [{ id: ACCOUNT, name: 'FIXTURE account' }] }),
    })
    .on('wrangler', ['auth', 'token', '--json'], {
      stdout: JSON.stringify({ type: 'oauth', token: TOKEN }),
    });
  const fetch = vi.fn<AdapterDeps['fetch']>(async () =>
    Response.json({ success: true, result: [{ id: WORKER }] }),
  );
  const deps: AdapterDeps = { cli, vault, fetch, now: () => 1_700_000_000_000 };
  const adapter = new CloudflareAdapter(deps);
  const connect = (config: Record<string, unknown> = { workerName: WORKER }, account = ACCOUNT) =>
    adapter.connect({ method: 'cli', account, config }, 'FIXTURE-target');
  return { deps, cli, vault, fetch, adapter, connect };
}

describe('Cloudflare draft connection', () => {
  it('connects only the explicitly selected account/Worker and stores metadata, not token or arbitrary config', async () => {
    const { connect, cli, vault, fetch } = setup();
    cli.on('wrangler', ['whoami'], {
      stdout: JSON.stringify({
        loggedIn: true,
        accounts: [
          { id: OTHER_ACCOUNT, name: 'First' },
          { id: ACCOUNT, name: 'Chosen' },
        ],
      }),
    });
    fetch.mockResolvedValue(Response.json({ success: true, result: [{ id: 'first' }, { id: WORKER }] }));
    const connected = await connect({
      accountId: ACCOUNT,
      workerName: WORKER,
      token: 'FIXTURE-UNTRUSTED',
      deployCommand: 'wrangler deploy',
    });
    expect(connected).toEqual({ credentialRef: REF, config: target().config, label: 'Cloudflare' });
    expect(await vault.listRefs()).toEqual([REF]);
    expect(JSON.parse((await vault.get(REF)) ?? '{}')).toEqual({ kind: 'cli', account: ACCOUNT });
    expect(JSON.stringify(connected)).not.toContain(TOKEN);
    expect(JSON.stringify(connected)).not.toContain('FIXTURE-UNTRUSTED');
    expect(fetch).toHaveBeenCalledWith(
      `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}/workers/scripts`,
      expect.objectContaining({
        method: 'GET',
        headers: { Authorization: `Bearer ${TOKEN}` },
        redirect: 'error',
        signal: expect.any(AbortSignal),
      }),
    );
    expect(cli.calls.map((call) => call.args)).toEqual([
      ['--version'],
      ['whoami', '--json'],
      ['auth', 'token', '--json'],
    ]);
  });

  it('rediscovers Workers and reads the current CLI token per use', async () => {
    const { connect, adapter, cli, fetch, vault } = setup();
    await connect();
    cli.on('wrangler', ['auth', 'token'], {
      stdout: JSON.stringify({ type: 'oauth', token: 'FIXTURE-ROTATED' }),
    });
    expect(await adapter.health(target())).toEqual({ ok: true, identity: `${WORKER} (${ACCOUNT})` });
    expect(fetch).toHaveBeenLastCalledWith(
      expect.any(String),
      expect.objectContaining({ headers: { Authorization: 'Bearer FIXTURE-ROTATED' } }),
    );
    expect(await vault.get(REF)).not.toContain('FIXTURE-ROTATED');
    expect(await adapter.listProjects({ kind: 'target', target: target() })).toEqual([
      { id: WORKER, name: WORKER, region: null },
    ]);
  });

  it.each(['', '--account', 'Account display name', '../account', 'a'.repeat(31), 'a'.repeat(33)])(
    'rejects invalid or absent account %j without probing',
    async (account) => {
      const { connect, cli, vault, fetch } = setup();
      await expect(connect(undefined, account)).rejects.toThrow('exact Cloudflare account ID');
      expect(cli.calls).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
      expect(await vault.listRefs()).toEqual([]);
    },
  );

  it.each([
    {},
    { workerName: '' },
    { workerName: '--name' },
    { workerName: '../worker' },
    { workerName: 'a'.repeat(64) },
  ])('requires an explicit plain Worker name: %j', async (config) => {
    const { connect, cli, vault } = setup();
    await expect(connect(config)).rejects.toThrow('exact Cloudflare Worker');
    expect(cli.calls).toEqual([]);
    expect(await vault.listRefs()).toEqual([]);
  });

  it('rejects conflicting account selection before probing', async () => {
    const { connect, cli } = setup();
    await expect(connect({ accountId: OTHER_ACCOUNT, workerName: WORKER })).rejects.toThrow('does not match');
    expect(cli.calls).toEqual([]);
  });

  it('does not select the first account, even if it is the only account', async () => {
    const { connect, cli, fetch, vault } = setup();
    await expect(connect(undefined, OTHER_ACCOUNT)).rejects.toThrow('not available');
    expect(fetch).not.toHaveBeenCalled();
    expect(cli.calls.some((call) => call.args[0] === 'auth')).toBe(false);
    expect(await vault.listRefs()).toEqual([]);
  });

  it('does not select the first Worker, even if it is the only Worker', async () => {
    const { connect, vault } = setup();
    await expect(connect({ workerName: 'other-worker' })).rejects.toThrow('not available');
    expect(await vault.listRefs()).toEqual([]);
  });

  it('rejects pasted tokens and key-based auth without storing anything', async () => {
    const { adapter, cli, vault } = setup();
    await expect(adapter.connect({ method: 'token', token: 'FIXTURE-paste' }, 'id')).rejects.toThrow(
      'Wrangler login only',
    );
    await expect(adapter.listProjects({ kind: 'token', token: 'FIXTURE-paste' })).rejects.toThrow(
      'Wrangler login only',
    );
    expect(cli.calls).toEqual([]);
    expect(await vault.listRefs()).toEqual([]);
  });

  it('overrides inherited credentials, account and endpoint settings for auth probes', async () => {
    const { connect, cli } = setup();
    const run = vi.spyOn(cli, 'run');
    await connect();
    for (const [, , options] of run.mock.calls) {
      expect(options).toMatchObject({
        cwd: cli.home,
        timeoutMs: 20_000,
        unsetEnv: expect.arrayContaining([
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
          'WRANGLER_API_ENVIRONMENT',
          'WRANGLER_AUTH_DOMAIN',
          'WRANGLER_AUTH_URL',
          'WRANGLER_TOKEN_URL',
          'WRANGLER_REVOKE_URL',
          'WRANGLER_CLIENT_ID',
          'NODE_OPTIONS',
        ]),
        env: {
          WRANGLER_SEND_METRICS: 'false',
          WRANGLER_SEND_ERROR_REPORTS: 'false',
          WRANGLER_WRITE_LOGS: 'false',
          CI: '1',
        },
      });
    }
  });

  it.each(['oauth', 'api_token'])('accepts the supported %s JSON bearer shape', async (type) => {
    const { connect, cli } = setup();
    cli.on('wrangler', ['auth', 'token'], { stdout: JSON.stringify({ type, token: TOKEN }) });
    await expect(connect()).resolves.toMatchObject({ credentialRef: REF });
  });

  it.each([
    { type: 'api_key', key: 'FIXTURE-KEY', email: 'fixture@example.test' },
    { type: 'oauth' },
    { type: 'oauth', token: '' },
    { type: 'oauth', token: 'FIXTURE\nTOKEN' },
    { type: 'unknown', token: TOKEN },
    'FIXTURE-NON-JSON',
  ])('rejects unsupported token output without quoting it: %j', async (output) => {
    const { connect, cli, fetch, vault } = setup();
    cli.on('wrangler', ['auth', 'token'], {
      stdout: typeof output === 'string' ? output : JSON.stringify(output),
    });
    await expect(connect()).rejects.toThrow('supported bearer credential');
    expect(fetch).not.toHaveBeenCalled();
    expect(await vault.listRefs()).toEqual([]);
  });

  it.each([
    'not json FIXTURE-SECRET',
    '{}',
    '{"loggedIn":true}',
    '{"loggedIn":true,"accounts":[{"id":"bad","name":"FIXTURE"}]}',
  ])('fails closed on malformed whoami output %j', async (stdout) => {
    const { connect, cli, fetch, vault } = setup();
    cli.on('wrangler', ['whoami'], { stdout });
    await expect(connect()).rejects.toThrow('unreadable account list');
    expect(fetch).not.toHaveBeenCalled();
    expect(await vault.listRefs()).toEqual([]);
  });

  it.each([
    { success: false, result: [{ id: WORKER }] },
    { success: true, result: [{}] },
    { success: true, result: [{ id: '../bad' }] },
    {},
  ])('rejects malformed API responses %j', async (body) => {
    const { connect, fetch, vault } = setup();
    fetch.mockResolvedValue(Response.json(body));
    await expect(connect()).rejects.toThrow('unreadable Worker list');
    expect(await vault.listRefs()).toEqual([]);
  });
});

describe('Cloudflare draft status and health', () => {
  it('lists account IDs without marking one active or reading a token', async () => {
    const { adapter, cli, fetch } = setup();
    expect(await adapter.cliStatus()).toEqual({
      installed: true,
      binary: '/usr/local/bin/wrangler',
      version: '4.151.0',
      loginCommand: 'wrangler login',
      accounts: [{ id: ACCOUNT, label: 'FIXTURE account', active: false }],
    });
    expect(cli.calls.some((call) => call.args[0] === 'auth')).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(adapter.cliLoginCommand()).toMatchObject({ bin: 'wrangler', args: ['login'] });
    expect(cli.calls.some((call) => call.args[0] === 'login')).toBe(false);
  });

  it('reports missing Wrangler without a login or token request', async () => {
    const { adapter, cli } = setup();
    cli.binaries.clear();
    expect(await adapter.cliStatus()).toMatchObject({ installed: false, accounts: [] });
    expect(cli.calls).toEqual([]);
  });

  it('shows an installed, logged-out CLI with no accounts', async () => {
    const { adapter, cli } = setup();
    cli.on('wrangler', ['whoami'], { exitCode: 1, stdout: '{"loggedIn":false}' });
    expect(await adapter.cliStatus()).toMatchObject({ installed: true, accounts: [] });
  });

  it.each(['3.114.0', '4.64.0', '4.65.0', '4.150.0', '4.152.0', '4.151.0-beta.1', '5.0.0', 'not a version'])(
    'requires the reviewed JSON contract (%s)',
    async (version) => {
      const { connect, adapter, cli } = setup();
      cli.on('wrangler', ['--version'], { stdout: version });
      expect(await adapter.cliStatus()).toMatchObject({ accounts: [] });
      await expect(connect()).rejects.toThrow('4.151.0');
      expect(cli.calls.every((call) => call.args[0] === '--version')).toBe(true);
    },
  );

  it('accepts the inspected version with its disk-log opt-out', async () => {
    const { connect, cli } = setup();
    cli.on('wrangler', ['--version'], { stdout: '4.151.0\n' });
    await expect(connect()).resolves.toMatchObject({ credentialRef: REF });
  });

  it.each([401, 403, 429, 500])(
    'distinguishes API auth failure from permission/transient failures (%i)',
    async (status) => {
      const { connect, adapter, fetch } = setup();
      await connect();
      fetch.mockResolvedValue(new Response('FIXTURE-SECRET', { status }));
      expect(await adapter.health(target())).toEqual({
        ok: false,
        expired: status === 401,
        error: `Cloudflare could not list Workers (${status})`,
      });
    },
  );

  it.each([
    { response: { exitCode: 1, stdout: '{"loggedIn":false}' }, expired: true },
    { response: { exitCode: 1, stdout: TOKEN, stderr: `not logged in ${TOKEN}` }, expired: true },
    { response: { exitCode: 1, stdout: TOKEN, stderr: `network failed ${TOKEN}` }, expired: false },
    { response: { exitCode: 124, timedOut: true, stdout: '{"loggedIn":false}' }, expired: false },
    { response: { stdout: TOKEN }, expired: false },
  ])('classifies failed CLI health without echoing output: %j', async ({ response, expired }) => {
    const { connect, adapter, cli } = setup();
    await connect();
    cli.on('wrangler', ['whoami'], response);
    const result = await adapter.health(target());
    expect(result).toMatchObject({ ok: false, expired });
    expect(JSON.stringify(result)).not.toContain(TOKEN);
  });

  it('treats disappearance of the CLI as transient', async () => {
    const { connect, adapter, cli } = setup();
    await connect();
    cli.binaries.clear();
    expect(await adapter.health(target())).toEqual({
      ok: false,
      expired: false,
      error: 'Wrangler is not installed',
    });
  });

  it('does not echo exceptions carrying tokens from the CLI or network', async () => {
    const { connect, adapter, cli, fetch } = setup();
    await connect();
    fetch.mockRejectedValue(new Error(TOKEN));
    expect(await adapter.health(target())).toEqual({
      ok: false,
      expired: false,
      error: 'Could not reach Cloudflare to list Workers',
    });
    vi.spyOn(cli, 'run').mockRejectedValue(new Error(TOKEN));
    expect(await adapter.test(target())).toEqual({ ok: false, error: 'Could not run Wrangler' });
  });

  it('requires selection repair, not reauthentication, for missing or vanished Workers', async () => {
    const { connect, adapter, fetch } = setup();
    await connect();
    expect(await adapter.test({ ...target(), config: { accountId: ACCOUNT } })).toMatchObject({
      ok: false,
      needsProject: true,
    });
    fetch.mockImplementation(async () => Response.json({ success: true, result: [] }));
    expect(await adapter.test(target())).toMatchObject({ ok: false, needsProject: true });
    expect(await adapter.health(target())).toMatchObject({ ok: false, expired: false });
  });

  it('rejects a changed saved account before any further CLI/API access', async () => {
    const { connect, adapter, cli, fetch } = setup();
    await connect();
    cli.calls.length = 0;
    fetch.mockClear();
    expect(
      await adapter.test({ ...target(), config: { ...target().config, accountId: OTHER_ACCOUNT } }),
    ).toMatchObject({ ok: false, needsProject: true });
    expect(cli.calls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([null, 'FIXTURE-MALFORMED', '{"kind":"cli"}'])(
    'sanitizes missing/malformed vault metadata (%j)',
    async (entry) => {
      const { adapter, vault, cli } = setup();
      if (entry !== null) await vault.set(REF, entry);
      expect(await adapter.health(target())).toEqual({
        ok: false,
        expired: false,
        error: 'Cloudflare CLI connection is missing or unreadable',
      });
      expect(cli.calls).toEqual([]);
    },
  );
});

describe('Cloudflare draft cannot execute', () => {
  it.each<Scope>(['read', 'write', 'deploy', 'delete'])(
    'refuses %s credential issuance without reading auth material',
    async (scope) => {
      const { adapter, cli, fetch, vault } = setup();
      const readVault = vi.spyOn(vault, 'get');
      const grant: GrantInfo = {
        id: 'FIXTURE-grant',
        scope: [scope],
        duration: 'once',
        expiresAt: 1_700_000_030_000,
      };
      await expect(adapter.issue(grant, target())).rejects.toThrow('execution is unavailable');
      expect(cli.calls).toEqual([]);
      expect(fetch).not.toHaveBeenCalled();
      expect(readVault).not.toHaveBeenCalled();
      await adapter.revoke();
      expect(await vault.listRefs()).toEqual([]);
    },
  );

  it('never labels uploads or environment names non-production and is not registered', () => {
    const { deps, adapter } = setup();
    expect(adapter.envOfCommand()).toBeNull();
    expect(adapter.scopeOfCommand(['versions', 'upload'])).toEqual(['deploy']);
    expect(adapter.scopeOfCommand(['whoami', '--json'])).toEqual(['read']);
    expect(new ProviderRegistry(deps).forTool('wrangler')).toBeNull();
    expect(new ProviderRegistry(deps).all().some((entry) => String(entry.provider) === 'cloudflare')).toBe(
      false,
    );
  });
});
