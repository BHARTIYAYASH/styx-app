import { expect, test } from '@playwright/test';
import { launchStyx } from './launch';

type StyxWindow = Window & { styx: { command: (name: string, input: unknown) => Promise<unknown> } };

test('review enables edit tracking without leaving the screen', async () => {
  const { app, page } = await launchStyx({ screen: 'diff', env: { STYX_DEMO_REPOS: '1' } });
  try {
    await page.evaluate(() =>
      (window as unknown as StyxWindow).styx.command('settings.set', { patch: { trackAgentEdits: false } }),
    );
    await expect(page.locator('[data-diff-empty="off"]')).toBeVisible();

    await page.getByRole('button', { name: 'Turn on tracking' }).click();

    await expect(page.locator('[data-diff-empty="off"]')).toHaveCount(0);
    await expect(page.locator('[data-diff-review] [data-hunk]').first()).toBeVisible();
  } finally {
    await app.close();
  }
});
