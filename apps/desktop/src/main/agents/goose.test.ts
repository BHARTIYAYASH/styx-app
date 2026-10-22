import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gooseLaunch } from './goose';
import { PREAMBLE_AGENTS, type AgentLaunchContext } from './types';

const context = (over: Partial<AgentLaunchContext> = {}): AgentLaunchContext => {
  const worktreePath = mkdtempSync(join(tmpdir(), 'styx-goose-'));
  return {
    agent: 'goose',
    binary: '/bin/goose',
    sessionId: 's',
    worktreePath,
    projectPath: worktreePath,
    firstMessage: 'hello',
    model: null,
    runner: 'stream',
    capabilities: { acp: true },
    autoApproveEdits: false,
    permissionMode: 'default',
    effort: null,
    resumeSessionId: null,
    configDir: join(worktreePath, '..', 'config'),
    shimDir: '/shims',
    platform: 'darwin',
    env: { STYX_SESSION_ID: 's', STYX_BROKER: '/broker', STYX_TOKEN: 'FIXTURE-broker-token' },
    ...over,
  };
};

describe('gooseLaunch', () => {
  it('uses ACP with developer tools and explicit approval, without writing config or secrets', async () => {
    const ctx = context({ model: 'my-model' });
    const launch = await gooseLaunch(ctx);
    expect(launch).toMatchObject({
      command: ctx.binary,
      args: ['acp', '--with-builtin', 'developer'],
      stream: { kind: 'acp' },
      typeFirstMessage: false,
      env: { GOOSE_MODE: 'approve', GOOSE_MODEL: 'my-model' },
    });
    expect(JSON.stringify(launch)).not.toContain(ctx.env['STYX_TOKEN']);
    await launch.cleanup();
    expect(readdirSync(ctx.worktreePath)).toEqual([]);
    expect(PREAMBLE_AGENTS).toContain('goose');
  });

  it.each([
    ['default', 'approve'],
    ['acceptEdits', 'approve'],
    ['auto', 'approve'],
    ['plan', 'chat'],
    ['dontAsk', 'chat'],
    ['bypassPermissions', 'auto'],
  ] as const)('%s starts with the conservative Goose mode %s', async (permissionMode, mode) => {
    expect((await gooseLaunch(context({ permissionMode }))).env).toEqual({ GOOSE_MODE: mode });
  });

  it.each([
    ['darwin', "/shim's dir", '"/shim\'s dir/styx" "mcp"'],
    ['win32', 'C:\\My shims', '"cmd.exe" "/d" "/c" "C:\\My shims\\styx.cmd" "mcp"'],
  ] as const)(
    'the %s terminal fallback passes the inherited MCP command without a token',
    async (platform, shimDir, extension) => {
      const ctx = context({ runner: 'pty', capabilities: {}, platform, shimDir });
      const launch = await gooseLaunch(ctx);
      expect(launch.args).toEqual(['session', '--with-builtin', 'developer', '--with-extension', extension]);
      expect(launch.stream).toBeUndefined();
      expect(launch.typeFirstMessage).toBe(true);
      expect(JSON.stringify(launch)).not.toContain(ctx.env['STYX_TOKEN']);
      await launch.cleanup();
      expect(readdirSync(ctx.worktreePath)).toEqual([]);
    },
  );

  it.each(['/a"b', '/a=b'])('refuses an unrepresentable terminal MCP command: %s', async (shimDir) => {
    await expect(gooseLaunch(context({ runner: 'pty', capabilities: {}, shimDir }))).rejects.toThrow(
      /Update Goose/,
    );
  });
});
