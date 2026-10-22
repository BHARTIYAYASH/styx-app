import { commands } from '@styx/core';
import { describe, expect, it, vi } from 'vitest';
import { makeTestApp } from '../../test-support';

describe('target.connect.installGuide', () => {
  it.each([
    ['vercel', 'https://vercel.com/docs/cli'],
    ['aws', 'https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html'],
    ['gcp', 'https://docs.cloud.google.com/sdk/docs/install-sdk'],
    ['supabase', 'https://supabase.com/docs/guides/local-development/cli/getting-started'],
    ['github', 'https://cli.github.com/'],
    ['fly', 'https://docs.fly.io/flyctl/install'],
    ['railway', 'https://docs.railway.com/cli'],
    ['render', 'https://render.com/docs/cli'],
  ] as const)('opens the official %s CLI install page', async (provider, url) => {
    const openExternal = vi.fn(async (_url: string) => undefined);
    const { app, sender } = makeTestApp({ openExternal });
    const result = await app.bus.dispatch(sender, 'target.connect.installGuide', { provider });
    expect(result).toEqual({ ok: true, value: {} });
    if (result.ok)
      expect(commands['target.connect.installGuide'].output.safeParse(result.value).success).toBe(true);
    expect(openExternal).toHaveBeenCalledOnce();
    expect(openExternal).toHaveBeenCalledWith(url);
  });

  it('rejects SSH, which has no provider CLI', async () => {
    const openExternal = vi.fn(async (_url: string) => undefined);
    const { app, sender } = makeTestApp({ openExternal });
    expect(await app.bus.dispatch(sender, 'target.connect.installGuide', { provider: 'ssh' })).toMatchObject({
      ok: false,
      error: { code: 'invalid-input' },
    });
    expect(openExternal).not.toHaveBeenCalled();
  });
});
