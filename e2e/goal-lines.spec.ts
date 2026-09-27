import { expect, test } from '@playwright/test';
import { openSeededProject, openWorkTab } from './support/project';

// Browser-mode smoke. Goal Lines is the "Lines" view inside the Work place,
// which only exists once a project is open; `openSeededProject` sets the open
// project in the store because browser mode cannot open a folder, and the rest
// goes through the rail and the tabs. No project DB is behind it, so these
// cover the entry point, the empty state, leaving the view, and the empty
// state's route to Goals. Correctness of the board itself lives in the unit
// and store tests.
test.describe('Goal Lines', () => {
  test.beforeEach(async ({ page }) => {
    await openSeededProject(page);
  });

  test('the Work place offers the Lines tab', async ({ page }) => {
    await page.getByTestId('activity-item-work').click();
    await expect(page.getByTestId('work-tab-lines')).toBeVisible();
  });

  test('selecting the tab opens the board with its empty state', async ({ page }) => {
    await openWorkTab(page, 'lines');
    await expect(page.getByTestId('work-panel-lines')).toBeVisible();
    await expect(page.getByTestId('goal-lines-open-goals')).toBeVisible();
  });

  test('leaving the Work place through the rail closes the board', async ({ page }) => {
    await openWorkTab(page, 'lines');
    await expect(page.getByTestId('work-panel-lines')).toBeVisible();
    await page.getByTestId('activity-item-cockpit').click();
    await expect(page.getByTestId('work-panel-lines')).not.toBeVisible();
  });

  test('the empty state routes to Goals', async ({ page }) => {
    await openWorkTab(page, 'lines');
    await page.getByTestId('goal-lines-open-goals').click();
    await expect(page.getByTestId('work-panel-lines')).not.toBeVisible();
    await expect(page.getByTestId('work-tab-goals')).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('work-panel-goals')).toBeVisible();
  });
});
