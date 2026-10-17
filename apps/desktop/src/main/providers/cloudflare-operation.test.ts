import { describe, expect, it } from 'vitest';
import { planCloudflareOperation } from './cloudflare-operation';

const target = {
  targetId: '01K7H8QF0EQWH8N4RPS58XEQA7',
  accountId: 'a'.repeat(32),
  workerName: 'chosen-worker',
  environment: 'preview',
};
const artifact = { path: '/styx-artifacts/worker.mjs', sha256: 'b'.repeat(64), sizeBytes: 1024 };
const read = { target, argv: ['versions', 'list', '--name', target.workerName] };
const upload = {
  target,
  argv: ['versions', 'upload', artifact.path, '--name', target.workerName],
  artifact,
  compatibilityDate: '2026-10-15',
};

describe('planCloudflareOperation', () => {
  it.each([
    ['versions', ['--name', target.workerName]],
    ['versions', [`--name=${target.workerName}`]],
    ['versions', ['--name', target.workerName, '--json']],
    ['versions', ['--json', `--name=${target.workerName}`]],
    ['deployments', ['--json', '--name', target.workerName]],
    ['deployments', [`--name=${target.workerName}`, '--json']],
  ])('normalizes %s list %j into a fixed exact-target plan', (command, flags) => {
    expect(planCloudflareOperation({ target, argv: [command, 'list', ...flags] })).toEqual({
      ok: true,
      plan: {
        kind: command === 'versions' ? 'list-versions' : 'list-deployments',
        target,
        scope: 'read',
        output: 'json',
        budget: { timeoutMs: 20_000, maxOutputBytes: 1_048_576 },
      },
    });
  });

  it('caps tail duration and output without preserving arbitrary argv', () => {
    expect(
      planCloudflareOperation({ target, argv: ['tail', target.workerName, '--format', 'json'] }),
    ).toEqual({
      ok: true,
      plan: {
        kind: 'tail',
        target,
        scope: 'read',
        output: 'json',
        budget: { timeoutMs: 30_000, maxOutputBytes: 1_048_576 },
      },
    });
  });

  it.each(['prod', 'staging', 'preview', 'scm'])('can plan an exact read on %s', (environment) => {
    expect(planCloudflareOperation({ ...read, target: { ...target, environment } }).ok).toBe(true);
  });

  it.each(['staging', 'preview'])('plans a version upload on %s without authorizing it', (environment) => {
    expect(planCloudflareOperation({ ...upload, target: { ...target, environment } })).toEqual({
      ok: true,
      plan: {
        kind: 'upload-version',
        target: { ...target, environment },
        scope: 'deploy',
        artifact,
        compatibilityDate: upload.compatibilityDate,
        budget: { timeoutMs: 60_000, maxOutputBytes: 1_048_576 },
      },
    });
  });

  it.each(['prod', 'scm'])('refuses version uploads on %s', (environment) => {
    expect(planCloudflareOperation({ ...upload, target: { ...target, environment } })).toEqual({
      ok: false,
      reason: 'Upload requires a staging or preview target',
    });
  });

  it.each([
    null,
    undefined,
    {},
    [],
    { argv: read.argv },
    { target },
    { ...read, target: null },
    { ...read, target: { ...target, targetId: '' } },
    { ...read, target: { ...target, targetId: 'not-a-ulid' } },
    { ...read, target: { ...target, accountId: 'A'.repeat(32) } },
    { ...read, target: { ...target, accountId: 'a'.repeat(31) } },
    { ...read, target: { ...target, accountId: `../${'a'.repeat(32)}` } },
    { ...read, target: { ...target, workerName: 'worker/' } },
    { ...read, target: { ...target, environment: 'non-prod' } },
    { ...read, target: { ...target, environment: null } },
    { ...read, target: { ...target, token: 'FIXTURE-secret' } },
    { ...read, credential: 'FIXTURE-secret' },
    { ...read, config: { accountId: 'c'.repeat(32) } },
    { ...read, budget: { timeoutMs: 999_999 } },
    { ...read, grant: { scope: ['read', 'deploy'] } },
    { ...read, argv: null },
    { ...read, argv: [1] },
    { ...read, argv: ['x'.repeat(1025)] },
    { ...read, argv: Array.from({ length: 9 }, () => 'x') },
    { ...upload, artifact: { ...artifact, token: 'FIXTURE-secret' } },
  ])('refuses malformed or extra boundary fields: %j', (input) => {
    expect(planCloudflareOperation(input)).toEqual({
      ok: false,
      reason: 'Invalid Cloudflare operation input',
    });
  });

  it.each([
    [],
    [''],
    ['--help'],
    ['--version'],
    ['whoami', '--json'],
    ['versions', 'list'],
    ['versions', 'list', '--name'],
    ['versions', 'list', '--name='],
    ['versions', 'list', '--name', target.workerName, '--name', target.workerName],
    ['versions', 'list', `--name=${target.workerName}`, `--name=${target.workerName}`],
    ['versions', 'list', '--name', target.workerName, '--json', '--json'],
    ['versions', 'list', '--name', target.workerName, '--json=false'],
    ['versions', 'list', '--name', target.workerName, 'extra'],
    ['versions', 'ls', '--name', target.workerName],
    ['versions', '--name', target.workerName, 'list'],
    ['tail', target.workerName],
    ['tail', target.workerName, '--format=json'],
    ['tail', target.workerName, '--format', 'pretty'],
    ['tail', target.workerName, '--format', 'json', 'extra'],
    ['versions', 'upload', artifact.path, `--name=${target.workerName}`],
    ['versions', 'upload', artifact.path, '--name', target.workerName, '--no-bundle'],
    ['versions', 'upload', artifact.path, '--name', target.workerName, '--compatibility-date', '2026-10-15'],
    ['deploy'],
    ['deploy', '--dry-run'],
    ['publish'],
    ['rollback'],
    ['versions', 'deploy', 'version@100%'],
    ['triggers', 'deploy'],
    ['pages', 'deploy', '/dist', '--branch', 'preview'],
    ['delete'],
    ['dns', 'list'],
    ['dns', 'create'],
    ['d1', 'list'],
    ['d1', 'execute', 'db', '--command', 'SELECT 1'],
    ['d1', 'delete', 'db'],
    ['r2', 'bucket', 'list'],
    ['r2', 'object', 'put', 'bucket/key'],
    ['r2', 'object', 'delete', 'bucket/key'],
    ['login'],
    ['logout'],
    ['auth', 'token', '--json'],
    ['secret', 'put', 'TOKEN'],
    ['npx', 'wrangler', 'versions', 'list', '--name', target.workerName],
    ['unknown', '--name', 'list'],
  ])('refuses unsupported command %j regardless of upload metadata', (...argv) => {
    expect(planCloudflareOperation({ target, argv }).ok).toBe(false);
    expect(planCloudflareOperation({ ...upload, argv }).ok).toBe(false);
  });

  it.each([
    ['--account-id', 'c'.repeat(32)],
    ['--config', '/tmp/wrangler.toml'],
    ['--config=/tmp/wrangler.toml'],
    ['-c', '/tmp/wrangler.toml'],
    ['--env', 'preview'],
    ['-e', 'preview'],
    ['--cwd', '/tmp'],
    ['--env-file', '/tmp/override'],
    ['--profile', 'other'],
    ['--help'],
    ['--'],
    ['--name', 'other'],
  ])('refuses overrides before or after supported commands %j', (...override) => {
    for (const input of [read, { target, argv: ['tail', target.workerName, '--format', 'json'] }, upload]) {
      expect(planCloudflareOperation({ ...input, argv: [...override, ...input.argv] }).ok).toBe(false);
      expect(planCloudflareOperation({ ...input, argv: [...input.argv, ...override] }).ok).toBe(false);
    }
  });

  it.each(['other', `${target.workerName}-other`])(
    'binds every operation to the selected Worker: %s',
    (worker) => {
      for (const argv of [
        ['versions', 'list', '--name', worker],
        ['deployments', 'list', `--name=${worker}`],
        ['tail', worker, '--format', 'json'],
        ['versions', 'upload', artifact.path, '--name', worker],
      ]) {
        expect(
          planCloudflareOperation({
            target,
            argv,
            ...(argv[1] === 'upload' ? { artifact, compatibilityDate: upload.compatibilityDate } : {}),
          }),
        ).toEqual({
          ok: false,
          reason: 'Command Worker does not match target',
        });
      }
    },
  );

  it.each([
    '-worker',
    'worker-',
    'Worker',
    'w'.repeat(64),
    'worker.example.com',
    '../worker',
    'worker name',
    'worker\n',
    'worker\0',
    'worker;id',
    '$(id)',
    '`id`',
  ])('refuses invalid Worker identifiers %j', (worker) => {
    expect(
      planCloudflareOperation({
        target: { ...target, workerName: worker },
        argv: ['tail', worker, '--format', 'json'],
      }).ok,
    ).toBe(false);
    expect(planCloudflareOperation({ target, argv: ['tail', worker, '--format', 'json'] }).ok).toBe(false);
  });

  it.each([
    { ...upload, artifact: undefined },
    { ...upload, compatibilityDate: undefined },
    { ...upload, artifact: undefined, compatibilityDate: undefined },
  ])('requires both upload inputs', (input) => {
    expect(planCloudflareOperation(input)).toEqual({
      ok: false,
      reason: 'Upload requires an artifact manifest and compatibility date',
    });
  });

  it.each([
    { artifact },
    { compatibilityDate: upload.compatibilityDate },
    { artifact, compatibilityDate: upload.compatibilityDate },
  ])('refuses upload metadata on read operations %j', (extra) => {
    expect(planCloudflareOperation({ ...read, ...extra })).toEqual({
      ok: false,
      reason: 'Read operations do not accept upload inputs',
    });
  });

  it('refuses a manifest for a different file', () => {
    expect(
      planCloudflareOperation({ ...upload, artifact: { ...artifact, path: '/styx-artifacts/other.js' } }),
    ).toEqual({ ok: false, reason: 'Upload artifact path does not match manifest' });
  });

  it.each([
    'relative.mjs',
    './worker.mjs',
    '../worker.mjs',
    '/tmp/../worker.mjs',
    '/tmp/./worker.mjs',
    '/tmp//worker.mjs',
    '//server/worker.mjs',
    'C:\\tmp\\worker.mjs',
    'c:/tmp/worker.mjs',
    '/tmp/worker.ts',
    '/tmp/worker.mjs/',
    '/tmp/worker name.mjs',
    '/tmp/worker\n.mjs',
    '/tmp/worker?.mjs',
    '/tmp/worker%2f.mjs',
    '/tmp/worker:.mjs',
    '/tmp/nul.mjs',
    '/con/worker.mjs',
    '/tmp./worker.mjs',
    '/tmp/$token.mjs',
  ])('refuses unsafe or unsupported artifact paths %j', (path) => {
    expect(
      planCloudflareOperation({
        ...upload,
        argv: ['versions', 'upload', path, '--name', target.workerName],
        artifact: { ...artifact, path },
      }).ok,
    ).toBe(false);
  });

  it.each(['/styx-artifacts/worker.js', 'C:/styx-artifacts/worker.mjs'])(
    'accepts documented path spelling without reading or hashing %s',
    (path) => {
      const result = planCloudflareOperation({
        ...upload,
        argv: ['versions', 'upload', path, '--name', target.workerName],
        artifact: { ...artifact, path },
      });
      expect(result.ok).toBe(true);
      if (result.ok && result.plan.kind === 'upload-version')
        expect(result.plan.artifact).toEqual({ ...artifact, path });
    },
  );

  it.each([
    { ...artifact, sha256: 'b'.repeat(63) },
    { ...artifact, sha256: 'B'.repeat(64) },
    { ...artifact, sha256: 'z'.repeat(64) },
    { ...artifact, sizeBytes: 0 },
    { ...artifact, sizeBytes: -1 },
    { ...artifact, sizeBytes: 1.5 },
    { ...artifact, sizeBytes: 1_048_577 },
    { ...artifact, sizeBytes: Infinity },
    { ...artifact, sizeBytes: '1024' },
  ])('refuses invalid artifact metadata %j', (manifest) => {
    expect(planCloudflareOperation({ ...upload, artifact: manifest }).ok).toBe(false);
  });

  it.each([1, 1_048_576])('accepts inclusive artifact size boundary %s', (sizeBytes) => {
    expect(planCloudflareOperation({ ...upload, artifact: { ...artifact, sizeBytes } }).ok).toBe(true);
  });

  it.each([
    '2026-02-29',
    '1900-02-29',
    '2026-04-31',
    '2026-00-01',
    '2026-13-01',
    '2026-01-00',
    '0000-01-01',
    '2026-1-01',
    '2026-01-1',
    '2026-01-01T00:00:00Z',
    '2026-01-01\n',
  ])('requires a real calendar date: %j', (compatibilityDate) => {
    expect(planCloudflareOperation({ ...upload, compatibilityDate }).ok).toBe(false);
  });

  it.each(['2000-02-29', '2024-02-29', '2026-12-31'])(
    'accepts real calendar date %s',
    (compatibilityDate) => {
      expect(planCloudflareOperation({ ...upload, compatibilityDate }).ok).toBe(true);
    },
  );

  it('returns fixed failure text without echoing untrusted values', () => {
    expect(planCloudflareOperation({ ...read, token: 'FIXTURE-secret-do-not-echo' })).toEqual({
      ok: false,
      reason: 'Invalid Cloudflare operation input',
    });
    expect(planCloudflareOperation({ target, argv: ['FIXTURE-secret-do-not-echo'] })).toEqual({
      ok: false,
      reason: 'Operation is not supported by this Cloudflare draft',
    });
  });

  it('does not share mutable input or result objects across calls', () => {
    const before = structuredClone(upload);
    const result = planCloudflareOperation(upload);
    expect(result.ok).toBe(true);
    if (result.ok && result.plan.kind === 'upload-version') {
      result.plan.target.accountId = 'c'.repeat(32);
      result.plan.artifact.path = '/elsewhere/worker.mjs';
      result.plan.budget.timeoutMs = 999_999;
    }
    expect(upload).toEqual(before);
    expect(planCloudflareOperation(upload)).toEqual(planCloudflareOperation(before));
  });
});
