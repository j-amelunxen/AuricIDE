import { expect, type Page } from '@playwright/test';

/**
 * Browser-mode Playwright has no Tauri backend, so no folder can be opened
 * through the real dialog and the start screen is all a fresh page shows.
 * Everything that needs a project (the Work place and its Requirements and
 * Lines views among them) is hidden until a project is open.
 *
 * This seeds only the one fact the UI keys that off — `rootPath` — through the
 * store the dev build exposes. From there the test walks the UI the way a user
 * would: rail item, then tab. Project IPC calls fail in browser mode, so the
 * project is empty, which is exactly the state these smoke tests cover.
 */
export const TEST_PROJECT_ROOT = '/workspace/test-project';

export async function openSeededProject(page: Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByTestId('ide-shell')).toBeVisible();

  await page.evaluate((rootPath) => {
    const store = (
      window as unknown as {
        __AURIC_STORE__?: { setState: (state: Record<string, unknown>) => void };
      }
    ).__AURIC_STORE__;
    if (!store) throw new Error('Auric store is not exposed in browser mode');
    store.setState({ rootPath });
  }, TEST_PROJECT_ROOT);

  await expect(page.getByTestId('activity-item-work')).toBeVisible();
}

/** Opens the Work place from the rail and selects one of its tabs. */
export async function openWorkTab(
  page: Page,
  tab: 'goals' | 'tickets' | 'requirements' | 'lines'
): Promise<void> {
  await page.getByTestId('activity-item-work').click();
  await expect(page.getByTestId('work-view')).toBeVisible();
  const tabButton = page.getByTestId(`work-tab-${tab}`);
  await tabButton.click();
  await expect(tabButton).toHaveAttribute('aria-selected', 'true');
}
