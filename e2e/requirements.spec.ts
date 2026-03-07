import { expect, test } from '@playwright/test';

test.describe('Requirements', () => {
  test('activity bar shows requirements item', async ({ page }) => {
    await page.goto('/');
    const activityBar = page.getByTestId('activity-bar');
    await expect(activityBar).toBeVisible();
    await expect(page.getByTestId('activity-item-requirements')).toBeVisible();
  });

  test('clicking requirements opens modal', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('activity-item-requirements').click();
    await expect(page.getByTestId('requirements-modal')).toBeVisible();
  });

  test('modal shows filter panel, empty list, and empty detail', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('activity-item-requirements').click();
    await expect(page.getByTestId('requirement-filter-panel')).toBeVisible();
    await expect(page.getByTestId('requirement-list-empty')).toBeVisible();
    await expect(page.getByTestId('requirement-detail-empty')).toBeVisible();
  });

  test('clicking + New opens create dialog', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('activity-item-requirements').click();
    await page.getByTestId('requirements-create-btn').click();
    await expect(page.getByTestId('requirement-create-dialog')).toBeVisible();
  });

  test('Escape closes create dialog but keeps modal open', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('activity-item-requirements').click();
    await page.getByTestId('requirements-create-btn').click();
    await expect(page.getByTestId('requirement-create-dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('requirement-create-dialog')).not.toBeVisible();
    await expect(page.getByTestId('requirements-modal')).toBeVisible();
  });

  test('Escape closes modal', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('activity-item-requirements').click();
    await expect(page.getByTestId('requirements-modal')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('requirements-modal')).not.toBeVisible();
  });

  test('modal has search input and close button', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('activity-item-requirements').click();
    await expect(page.getByTestId('requirements-search')).toBeVisible();
    await expect(page.getByTestId('requirements-close-btn')).toBeVisible();
  });

  test('close button closes modal', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('activity-item-requirements').click();
    await expect(page.getByTestId('requirements-modal')).toBeVisible();
    await page.getByTestId('requirements-close-btn').click();
    await expect(page.getByTestId('requirements-modal')).not.toBeVisible();
  });
});
