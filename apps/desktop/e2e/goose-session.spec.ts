import type { CliInstall } from '@styx/core';
import { test, expect } from '@playwright/test';
import { launchStyx } from './launch';

type StyxWindow = Window & {
  styx: { command: (name: string, input: unknown) => Promise<{ ok: boolean; value?: unknown }> };
};

for (const theme of ['dark', 'light'] as const) {
  test(`Goose over ACP: chat, MCP handoff, permission approval and mode switch (${theme})`, async ({}, testInfo) => {
    const { app, page } = await launchStyx({ screen: 'agents', fixture: 'demo', theme, chrome: 'win' });
    try {
      await page.locator('[data-screen-ready="agents"]').waitFor({ state: 'attached', timeout: 20_000 });
      const detected = await page.evaluate(() =>
        (window as unknown as StyxWindow).styx.command('detect.clis', {}),
      );
      const goose = (detected.value as { clis: CliInstall[] }).clis.find((c) => c.agent === 'goose');
      expect(goose?.binary).toMatch(/e2e[/\\]fixtures[/\\]bin[/\\]goose(\.cmd)?$/);
      expect(goose?.capabilities['acp']).toBe(true);
      await page.getByRole('button', { name: '+ Spawn agent' }).click();
      const modal = page.locator('[data-spawn-modal]');
      await modal.locator('[data-agent="goose"]').click();
      await modal.getByLabel('First message').fill('hi');
      await page.screenshot({ path: testInfo.outputPath('goose-spawn.png') });
      await page
        .getByRole('dialog')
        .getByRole('button', { name: /^Spawn/ })
        .click();
      const chat = page.locator('[data-chat-pane]');
      await expect(
        chat.locator('[data-kind="agent"]').filter({ hasText: 'pong (styx tools: yes)' }),
      ).toBeVisible({ timeout: 20_000 });
      const decision = chat.locator('[data-kind="decision"]');
      await expect(decision).toBeVisible({ timeout: 20_000 });
      await expect(decision).toContainText('echo pong');
      await page.screenshot({ path: testInfo.outputPath('goose-approval.png') });
      await decision.getByRole('button', { name: 'Allow' }).click();
      await expect(chat.locator('[data-kind="steps"] li[data-status="ok"]')).toBeVisible({ timeout: 20_000 });
      await expect(chat.locator('[data-lane-meta]')).not.toContainText('waiting on you');
      const snapshot = await page.evaluate(() =>
        (window as unknown as StyxWindow).styx.command('store.snapshot', {}),
      );
      const session = (
        snapshot.value as { sessions: { id: string; agent: string; runner: string }[] }
      ).sessions.find((s) => s.agent === 'goose');
      expect(session?.runner).toBe('stream');
      const configured = await page.evaluate(
        (sessionId) =>
          (window as unknown as StyxWindow).styx.command('session.configure', {
            sessionId,
            permissionMode: 'bypassPermissions',
          }),
        session?.id,
      );
      expect(configured.ok).toBe(true);
      await expect(
        chat.locator('[data-kind="system"]').filter({ hasText: 'permissions: Bypass permissions' }),
      ).toBeVisible({ timeout: 20_000 });
      const composer = chat.getByRole('textbox', { name: /^Message Goose/ });
      await composer.fill('again');
      await composer.press('Enter');
      await expect(chat.locator('[data-kind="receipt"]')).toHaveCount(1, { timeout: 20_000 });
      await expect(chat.locator('[data-kind="steps"] li[data-status="ok"]')).toHaveCount(1, {
        timeout: 20_000,
      });
      await expect(
        chat.locator('[data-kind="system"]').filter({ hasText: /error|refused|no equivalent/ }),
      ).toHaveCount(0);
    } finally {
      await app.close();
    }
  });
}
