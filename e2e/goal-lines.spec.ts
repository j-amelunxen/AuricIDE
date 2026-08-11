import { expect, test } from '@playwright/test';

// Browser-mode smoke: no project DB is seeded here, so these cover the
// entry point, the empty state, and the close paths. Correctness of the
// board itself lives in the unit and store tests.
test.describe('Goal Lines', () => {
  test('activity bar shows the goal lines item', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('activity-item-goal-lines')).toBeVisible();
  });

  test('clicking the item opens the board with its empty state', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('activity-item-goal-lines').click();
    await expect(page.getByTestId('goal-lines-modal')).toBeVisible();
    await expect(page.getByTestId('goal-lines-open-goals')).toBeVisible();
  });

  test('Escape closes the board', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('activity-item-goal-lines').click();
    await expect(page.getByTestId('goal-lines-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('goal-lines-modal')).not.toBeVisible();
  });

  test('the empty state routes to Goals', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('activity-item-goal-lines').click();
    await page.getByTestId('goal-lines-open-goals').click();
    await expect(page.getByTestId('goal-lines-modal')).not.toBeVisible();
    await expect(page.getByTestId('goals-modal')).toBeVisible();
  });
});
