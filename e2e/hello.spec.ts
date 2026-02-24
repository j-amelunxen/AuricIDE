import { expect, test } from '@playwright/test';

test('app loads with title', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle('AuricIDE');
});

test('IDE shell renders with header, activity bar, and status bar', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('ide-shell')).toBeVisible();
  await expect(page.getByTestId('header')).toBeVisible();
  await expect(page.getByTestId('activity-bar')).toBeVisible();
  await expect(page.getByTestId('status-bar')).toBeVisible();
});

test('header shows logo and connection status', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('header-logo')).toContainText('AgenticDE');
  await expect(page.getByTestId('connection-badge')).toContainText('Connected');
});

test('status bar shows branch name', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('status-branch')).toContainText('main');
});
