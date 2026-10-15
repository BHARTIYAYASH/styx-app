import { describe, expect, it } from 'vitest';
import { cloudflareScopeOfCommand } from './cloudflare-scope';
import type { Scope } from './types';

describe('cloudflareScopeOfCommand', () => {
  it.each<[string[], Scope]>([
    [['--help'], 'read'],
    [['-h'], 'read'],
    [['--version'], 'read'],
    [['-v'], 'read'],
    [['whoami'], 'read'],
    [['whoami', '--json'], 'read'],
    [['versions', 'list', '--name', 'worker'], 'read'],
    [['versions', 'list', '--name=worker'], 'read'],
    [['versions', 'list', '--name', 'my-worker-1', '--json'], 'read'],
    [['versions', 'list', '--json', '--name', 'worker'], 'read'],
    [['deployments', 'list', '--name', 'worker'], 'read'],
    [['deployments', 'list', '--name=worker', '--json'], 'read'],
    [['deployments', 'list', '--json', '--name', 'worker'], 'read'],
    [['tail', 'worker', '--format', 'json'], 'read'],
    [['tail', 'my-worker-1', '--format', 'json'], 'read'],

    // Scope is never inferred from option values, aliases, or a help flag in a larger command.
    [[], 'write'],
    [[''], 'write'],
    [['help'], 'write'],
    [['version'], 'write'],
    [['--v'], 'write'],
    [['--help=true'], 'write'],
    [['--version=false'], 'write'],
    [['--help', '--version'], 'write'],
    [['help', 'deploy'], 'write'],
    [['--help', 'deploy'], 'write'],
    [['--version', 'delete'], 'write'],
    [['whoami', '--help'], 'write'],
    [['whoami', '--json', '--help'], 'write'],
    [['whoami', '--json=true'], 'write'],
    [['whoami', '--json', 'false'], 'write'],
    [['whoami', '--json', '--json'], 'write'],
    [['whoami', '--account', 'account-id'], 'write'],
    [['--json', 'whoami'], 'write'],
    [['wrangler', 'whoami'], 'write'],
    [['npx', 'wrangler', 'whoami'], 'write'],
    [['login'], 'write'],
    [['logout'], 'write'],
    [['auth', 'token'], 'write'],
    [['init'], 'write'],
    [['dev'], 'write'],
    [['types'], 'write'],
    [['unknown', '--name', 'list'], 'write'],
    [['unknown', '--name', 'help'], 'write'],
    [['unknown', '--value', '--help'], 'write'],
    [['secret', 'put', 'whoami'], 'write'],
    [['secret', 'put', '--help'], 'write'],
    [['versions', 'view', 'list'], 'write'],
    [['versions', 'ls', '--name', 'worker'], 'write'],
    [['deployments', 'status', '--name', 'worker'], 'write'],
    [['pages', 'project', 'list'], 'write'],
    [['d1', 'list'], 'write'],
    [['r2', 'bucket', 'list'], 'write'],
    [['d1', 'execute', 'db', '--command', 'SELECT 1'], 'write'],
    [['d1', 'migrations', 'apply', 'db'], 'write'],
    [['r2', 'object', 'put', 'bucket/key'], 'write'],
    [['versions', 'list'], 'write'],
    [['versions', 'list', 'worker'], 'write'],
    [['versions', 'list', '--name'], 'write'],
    [['versions', 'list', '--name', ''], 'write'],
    [['versions', 'list', '--name='], 'write'],
    [['versions', 'list', '--name', '--help'], 'write'],
    [['versions', 'list', '--name=--help'], 'write'],
    [['versions', 'list', '--name', 'worker', 'extra'], 'write'],
    [['versions', 'list', '--name', 'worker', '--name', 'other'], 'write'],
    [['versions', 'list', '--name=worker', '--name=other'], 'write'],
    [['versions', 'list', '--name', 'worker', '--json', '--json'], 'write'],
    [['versions', 'list', '--name', 'worker', '--json=false'], 'write'],
    [['versions', 'list', '--name', 'worker', '--json', 'false'], 'write'],
    [['versions', 'list', '--name', 'worker', '--unknown'], 'write'],
    [['versions', 'list', '--name', 'worker', '--help'], 'write'],
    [['versions', 'list', '-n', 'worker'], 'write'],
    [['versions', 'list', '--name', 'worker', '--'], 'write'],
    [['versions', 'list', '--', '--name', 'worker'], 'write'],
    [['versions', '--name', 'worker', 'list'], 'write'],
    [['versions', 'list', '--name', 'worker.example.com'], 'write'],
    [['versions', 'list', '--name', '../worker'], 'write'],
    [['versions', 'list', '--name', 'worker name'], 'write'],
    [['versions', 'list', '--name', '-worker'], 'write'],
    [['versions', 'list', '--name', 'worker-'], 'write'],
    [['versions', 'list', '--name', 'w'.repeat(64)], 'write'],
    [['tail'], 'write'],
    [['tail', 'worker'], 'write'],
    [['tail', 'worker', '--format', 'pretty'], 'write'],
    [['tail', 'worker', '--format=json'], 'write'],
    [['tail', '--format', 'json'], 'write'],
    [['tail', '--help', '--format', 'json'], 'write'],
    [['tail', 'worker', '--format', 'json', '--search', 'help'], 'write'],
    [['tail', 'https://example.com/*', '--format', 'json'], 'write'],
    [['tail', 'worker', '--format', 'json', 'extra'], 'write'],

    // Known remote mutations stay privileged even when a help/dry-run/preview-looking value is appended.
    [['deploy'], 'deploy'],
    [['deploy', '--help'], 'deploy'],
    [['deploy', '--dry-run'], 'deploy'],
    [['publish', '--name', 'worker'], 'deploy'],
    [['rollback'], 'deploy'],
    [['rollback', '--message', '--help'], 'deploy'],
    [['versions', 'upload', 'src/index.ts'], 'deploy'],
    [['versions', 'upload', '--name', 'worker', '--env', 'preview'], 'deploy'],
    [['versions', 'upload', '--no-bundle', '--help'], 'deploy'],
    [['versions', 'deploy', 'version-id@100%'], 'deploy'],
    [['versions', 'deploy', '--help'], 'deploy'],
    [['triggers', 'deploy', '--dry-run'], 'deploy'],
    [['pages', 'deploy', './dist', '--branch', 'preview'], 'deploy'],
    [['pages', 'publish', './dist'], 'deploy'],
    [['delete', '--name', 'worker'], 'delete'],
    [['delete', '--help'], 'delete'],
    [['d1', 'delete', 'db'], 'delete'],
    [['d1', 'delete', '--help'], 'delete'],
    [['d1', 'time-travel', 'restore', 'db'], 'delete'],
    [['r2', 'bucket', 'delete', 'bucket'], 'delete'],
    [['r2', 'object', 'delete', 'bucket/key'], 'delete'],
    [['kv', 'namespace', 'delete', '--namespace-id', 'id'], 'delete'],
    [['kv', 'key', 'delete', 'key'], 'delete'],
    [['kv', 'bulk', 'delete', 'keys.json'], 'delete'],
    [['secret', 'delete', 'TOKEN'], 'delete'],
    [['versions', 'secret', 'delete', 'TOKEN'], 'delete'],
    [['pages', 'project', 'delete', 'site'], 'delete'],
    [['pages', 'deployment', 'delete', 'id'], 'delete'],
  ])('%j needs %s', (argv, scope) => {
    expect(cloudflareScopeOfCommand(argv)).toEqual([scope]);
  });

  const readCommands = [
    ['whoami', '--json'],
    ['versions', 'list', '--name', 'worker'],
    ['deployments', 'list', '--name', 'worker'],
    ['tail', 'worker', '--format', 'json'],
  ];

  it.each([
    ['--config', 'wrangler.toml'],
    ['--config=wrangler.toml'],
    ['-c', 'wrangler.toml'],
    ['-cwrangler.toml'],
    ['--c', 'wrangler.toml'],
    ['--cwd', '/tmp'],
    ['--cwd=/tmp'],
    ['--env', 'preview'],
    ['--env=preview'],
    ['-e', 'preview'],
    ['-epreview'],
    ['--e', 'preview'],
    ['--env-file', 'config.txt'],
    ['--env-file=config.txt'],
    ['--profile', 'other'],
    ['--profile=other'],
    ['--install-skills'],
    ['--experimental-json-config'],
  ])('rejects global overrides %j before and after every read command', (...override) => {
    for (const command of readCommands) {
      expect(cloudflareScopeOfCommand([...override, ...command])).toEqual(['write']);
      expect(cloudflareScopeOfCommand([...command, ...override])).toEqual(['write']);
    }
  });

  it.each([';', '&&', '|', '>', '<', '`whoami`', '$(whoami)', '\n', '\r', '\0', '\\', '(whoami)'])(
    'rejects shell syntax %j even with a read or mutating head',
    (syntax) => {
      expect(cloudflareScopeOfCommand(['whoami', syntax])).toEqual(['write']);
      expect(cloudflareScopeOfCommand(['deploy', syntax])).toEqual(['write']);
      expect(cloudflareScopeOfCommand(['delete', syntax])).toEqual(['write']);
      expect(cloudflareScopeOfCommand(['tail', `worker${syntax}`, '--format', 'json'])).toEqual(['write']);
    },
  );

  it('does not mutate argv or share result arrays between calls', () => {
    const argv = ['versions', 'list', '--name', 'worker'];
    const before = [...argv];
    const first = cloudflareScopeOfCommand(argv);
    first.push('delete');
    expect(argv).toEqual(before);
    expect(cloudflareScopeOfCommand(argv)).toEqual(['read']);
  });
});
