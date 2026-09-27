import { expect, test } from '@playwright/test';
import { openSeededProject, openWorkTab } from './support/project';

// Requirements is a view inside the Work place (not a modal of its own any
// more), and the Work place only exists once a project is open. Browser mode
// cannot open a folder, so `openSeededProject` sets the open project in the
// store and everything after that goes through the rail and the tabs like a
// user would. With no backend the project has no requirements, so these cover
// the entry point, the empty state, the create dialog and the ways out.
// Correctness of the data itself lives in the unit and store tests.
test.describe('Requirements', () => {
  test.beforeEach(async ({ page }) => {
    await openSeededProject(page);
  });

  test('the Work place offers a Requirements tab', async ({ page }) => {
    await page.getByTestId('activity-item-work').click();
    await expect(page.getByTestId('work-tab-requirements')).toBeVisible();
  });

  test('selecting the tab opens the Requirements view', async ({ page }) => {
    await openWorkTab(page, 'requirements');
    await expect(page.getByTestId('work-panel-requirements')).toBeVisible();
  });

  test('view shows filter panel, empty list, and empty detail', async ({ page }) => {
    await openWorkTab(page, 'requirements');
    await expect(page.getByTestId('requirement-filter-panel')).toBeVisible();
    await expect(page.getByTestId('requirement-list-empty')).toBeVisible();
    await expect(page.getByTestId('requirement-detail-empty')).toBeVisible();
  });

  test('view has a search input and a New button', async ({ page }) => {
    await openWorkTab(page, 'requirements');
    await expect(page.getByTestId('requirements-search')).toBeVisible();
    await expect(page.getByTestId('requirements-create-btn')).toBeVisible();
  });

  test('clicking + New opens create dialog', async ({ page }) => {
    await openWorkTab(page, 'requirements');
    await page.getByTestId('requirements-create-btn').click();
    await expect(page.getByTestId('requirement-create-dialog')).toBeVisible();
  });

  test('Escape closes create dialog but keeps the view open', async ({ page }) => {
    await openWorkTab(page, 'requirements');
    await page.getByTestId('requirements-create-btn').click();
    await expect(page.getByTestId('requirement-create-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('requirement-create-dialog')).not.toBeVisible();
    await expect(page.getByTestId('work-panel-requirements')).toBeVisible();
  });

  test('leaving the Work place through the rail closes the view', async ({ page }) => {
    await openWorkTab(page, 'requirements');
    await expect(page.getByTestId('work-panel-requirements')).toBeVisible();
    await page.getByTestId('activity-item-cockpit').click();
    await expect(page.getByTestId('work-view')).not.toBeVisible();
    await expect(page.getByTestId('work-panel-requirements')).not.toBeVisible();
  });
});
