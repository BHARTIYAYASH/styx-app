import type { Options } from 'execa';
import { describe, expect, it, vi } from 'vitest';
import { ExecaCliRunner } from './cli-runner';

const { run } = vi.hoisted(() => ({
  run: vi.fn(async (_file: string, _args: string[], _options: Options) => ({
    exitCode: 0,
    stdout: '',
    stderr: '',
    timedOut: false,
  })),
}));
vi.mock('execa', () => ({ execa: run }));

describe('provider CLI environment', () => {
  it('excludes case variants on Windows, where environment names are case insensitive', async () => {
    const runner = new ExecaCliRunner({
      platform: 'win32',
      env: {
        wrangler_token_url: 'https://fixture.invalid',
        Cloudflare_Api_Token: 'FIXTURE-TOKEN',
        gh_token: 'FIXTURE-GH',
        KEEP: 'normal',
      },
      loginPath: async () => 'C:\\fixture',
    });
    vi.spyOn(runner, 'which').mockResolvedValue('C:\\fixture\\wrangler.cmd');
    await runner.run('wrangler', ['whoami', '--json'], {
      unsetEnv: ['WRANGLER_TOKEN_URL', 'CLOUDFLARE_API_TOKEN'],
    });
    const options = run.mock.calls.at(-1)?.[2];
    expect(options?.env).toMatchObject({ KEEP: 'normal' });
    expect(options?.env).not.toHaveProperty('wrangler_token_url');
    expect(options?.env).not.toHaveProperty('Cloudflare_Api_Token');
    expect(options?.env).not.toHaveProperty('gh_token');
  });

  it('removes per-call inherited overrides rather than replacing them with empty strings', async () => {
    const inherited = {
      CLOUDFLARE_API_TOKEN: 'FIXTURE-TOKEN',
      CLOUDFLARE_API_BASE_URL: 'https://fixture.invalid',
      WRANGLER_TOKEN_URL: 'https://fixture.invalid/token',
      NODE_OPTIONS: 'FIXTURE-OPTIONS',
      SUPABASE_ACCESS_TOKEN: 'FIXTURE-OTHER-TOKEN',
      KEEP: 'ordinary-setting',
    };
    const runner = new ExecaCliRunner({ env: inherited, loginPath: async () => '/fixture/bin' });
    vi.spyOn(runner, 'which').mockResolvedValue('/fixture/bin/wrangler');
    await runner.run('wrangler', ['whoami', '--json'], {
      unsetEnv: ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_BASE_URL', 'WRANGLER_TOKEN_URL', 'NODE_OPTIONS'],
      env: { WRANGLER_SEND_METRICS: 'false' },
    });
    expect(run).toHaveBeenLastCalledWith(
      '/fixture/bin/wrangler',
      ['whoami', '--json'],
      expect.objectContaining({
        extendEnv: false,
        stdin: 'ignore',
        env: expect.objectContaining({
          KEEP: 'ordinary-setting',
          PATH: '/fixture/bin',
          CI: '1',
          WRANGLER_SEND_METRICS: 'false',
        }),
      }),
    );
    const options = run.mock.calls.at(-1)?.[2];
    for (const name of [
      'CLOUDFLARE_API_TOKEN',
      'CLOUDFLARE_API_BASE_URL',
      'WRANGLER_TOKEN_URL',
      'NODE_OPTIONS',
      'SUPABASE_ACCESS_TOKEN',
    ])
      expect(options?.env).not.toHaveProperty(name);
    expect(inherited.CLOUDFLARE_API_TOKEN).toBe('FIXTURE-TOKEN');
  });

  it('retains the existing inherited and explicit env behavior without per-call exclusions', async () => {
    const runner = new ExecaCliRunner({
      env: { KEEP: 'inherited', GH_TOKEN: 'FIXTURE-STRIPPED' },
      loginPath: async () => '/fixture/bin',
    });
    vi.spyOn(runner, 'which').mockResolvedValue('/fixture/bin/gh');
    await runner.run('gh', ['api', 'user'], { env: { KEEP: 'explicit' } });
    const options = run.mock.calls.at(-1)?.[2];
    expect(options?.env).toMatchObject({ KEEP: 'explicit', PATH: '/fixture/bin' });
    expect(options?.env).not.toHaveProperty('GH_TOKEN');
  });
});
