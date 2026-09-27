import { expect, test } from '@playwright/test';

// Browser-mode smoke of the shell a fresh start shows: no Tauri backend, no
// open project, no agent CLI. The header and status bar are checked for what
// they really show in that state — the AuricIDE brand, the "Disconnected"
// badge (the badge only appears while no CLI is connected), and the branch
// button, which falls back to "main" until git reports a branch.

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

test('header shows the brand and that no agent CLI is connected', async ({ page }) => {
  await page.goto('/');

  const logo = page.getByTestId('header-logo');
  await expect(logo.getByRole('img', { name: 'Auric Logo' })).toBeVisible();
  await expect(logo).toHaveText(/AURIC\s*IDE/);
  await expect(page.getByTestId('connection-badge')).toHaveText('Disconnected');
});

test('status bar shows branch name', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByTestId('status-branch')).toHaveText('main');
});
