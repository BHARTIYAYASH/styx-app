import type { CliInstall } from '@styx/core';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect } from '@playwright/test';
import { launchStyx } from './launch';

type StyxWindow = Window & {
  styx: { command: (name: string, input: unknown) => Promise<{ ok: boolean; value?: unknown }> };
};
type Turn = {
  text: string;
  cwd: string;
  settings: Record<string, unknown>;
  mcp: Record<string, { command: string; args: string[]; env?: unknown }>;
  args: string[];
};

for (const theme of ['dark', 'light'] as const) {
  test(`Amp: terminal worktree and multiline first/subsequent turns (${theme})`, async ({}, testInfo) => {
    const { app, page, userData } = await launchStyx({
      screen: 'agents',
      fixture: 'demo',
      theme,
      chrome: 'win',
    });
    try {
      await page.locator('[data-screen-ready="agents"]').waitFor({ state: 'attached', timeout: 20_000 });
      const detected = await page.evaluate(() =>
        (window as unknown as StyxWindow).styx.command('detect.clis', {}),
      );
      const amp = (detected.value as { clis: CliInstall[] }).clis.find((c) => c.agent === 'amp');
      expect(amp?.binary).toMatch(/e2e[/\\]fixtures[/\\]bin[/\\]amp(\.cmd)?$/);
      expect(amp?.capabilities['streamJson']).toBe(true);
      await page.getByRole('button', { name: '+ Spawn agent' }).click();
      const modal = page.locator('[data-spawn-modal]');
      await modal.locator('[data-agent="amp"]').click();
      await modal.getByLabel('First message').fill('first line\nsecond line');
      await page.screenshot({ path: testInfo.outputPath('amp-spawn.png') });
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /^Spawn/ })
        .click();
      await expect(modal).toBeHidden({ timeout: 20_000 });
      const snapshot = await page.evaluate(() =>
        (window as unknown as StyxWindow).styx.command('store.snapshot', {}),
      );
      const session = (
        snapshot.value as { sessions: { id: string; agent: string; runner: string; worktreeId: string }[] }
      ).sessions.find((s) => s.agent === 'amp');
      expect(session?.runner).toBe('pty');
      const history = join(userData, 'agents', session!.id, 'input.history');
      const turns = (): Turn[] => {
        try {
          return readFileSync(history, 'utf8')
            .trim()
            .split('\n')
            .map((s) => JSON.parse(s) as Turn);
        } catch {
          return [];
        }
      };
      await expect.poll(() => turns().length).toBe(1);
      expect(turns()[0]?.text).toMatch(/first line\nsecond line$/);
      expect(turns()[0]?.settings).toMatchObject({
        'amp.dangerouslyAllowAll': false,
        'amp.permissions': [{ tool: '*', action: 'ask' }],
      });
      expect(turns()[0]?.mcp['styx']?.args).toContain('mcp');
      expect(turns()[0]?.mcp['styx']?.env).toBeUndefined();
      expect(turns()[0]?.cwd).toMatch(/worktrees[/\\]/);
      await page.getByRole('tab', { name: 'Terminal', exact: true }).click();
      const terminal = page.locator('[data-terminal]');
      await expect(terminal.locator('.xterm-screen')).toBeVisible();
      await terminal.locator('.xterm-helper-textarea').focus();
      await page.keyboard.type('y');
      await page.keyboard.press('Enter');
      await expect.poll(() => turns().length).toBe(2);
      expect(turns()[1]?.text).toBe('y');
      const composer = page.locator('[data-chat-pane]').getByRole('textbox', { name: /^Message Amp/ });
      await composer.fill('another\nmessage');
      await composer.press('Enter');
      await expect.poll(() => turns().length, { timeout: 15_000 }).toBe(3);
      expect(turns()[2]?.text).toBe('another\nmessage');
      await page.screenshot({ path: testInfo.outputPath('amp-session.png') });
    } finally {
      await app.close();
    }
  });
}
