import { expect, test } from '@playwright/test';

test('the built page loads with a CSP that forbids network connections', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('AlphaZetaMac');
  const csp = await page.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');
  expect(csp).toContain("connect-src 'none'");
});
