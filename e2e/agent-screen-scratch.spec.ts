import { expect, test, type Page } from '@playwright/test';

/**
 * The browser has no app-data directory. These four commands are the scratch
 * filesystem the button writes through; every other invoke still fails.
 */
async function installScratchFilesystem(page: Page) {
  await page.addInitScript(() => {
    const files = new Map<string, string>();
    const dir = '/virtual/scratches';
    const w = window as Window & {
      __AURIC_SCRATCH_FILES__?: Map<string, string>;
      __TAURI_INTERNALS__?: {
        invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;
        transformCallback: () => number;
      };
    };
    w.__AURIC_SCRATCH_FILES__ = files;
    w.__TAURI_INTERNALS__ = {
      transformCallback: () => 0,
      invoke: async (cmd, args) => {
        if (cmd === 'get_scratch_dir') return dir;
        if (cmd === 'write_file') {
          files.set(String(args?.path), String(args?.content ?? ''));
          return null;
        }
        if (cmd === 'read_file') {
          const path = String(args?.path);
          const content = files.get(path);
          if (content === undefined) throw new Error(`no such file: ${path}`);
          return content;
        }
        if (cmd === 'read_directory') {
          const path = String(args?.path).replace(/\/+$/, '');
          if (path !== dir) return [];
          return [...files.keys()].map((filePath) => ({
            name: filePath.slice(dir.length + 1),
            path: filePath,
            is_directory: false,
            created_at: null,
            newest_file_created_at: null,
            modified_at: null,
          }));
        }
        throw new Error(`unhandled invoke: ${cmd}`);
      },
    };
  });
}

interface FleetAgent {
  id: string;
  name: string;
  status: 'running';
  model: string;
  provider: string;
  startedAt: number;
  lastActivityAt: number;
}

function agent(id: string, name: string, now: number): FleetAgent {
  return {
    id,
    name,
    status: 'running',
    model: 'test-model',
    provider: 'test',
    startedAt: now - 10_000,
    lastActivityAt: now,
  };
}

async function seedFleet(page: Page, logs: Record<string, string[]>) {
  const now = Date.now();
  await page.evaluate(
    ({ agents, agentLogs }) => {
      const store = (window as unknown as { __AURIC_STORE__?: { setState: (s: object) => void } })
        .__AURIC_STORE__;
      if (!store) throw new Error('store is not on the window');
      store.setState({ agents, agentLogs });
    },
    {
      agents: [agent('writer', 'Writer', now), agent('other', 'Other', now)],
      agentLogs: logs,
    }
  );
}

/** xterm paints a write on a later frame. Wait until that frame has landed. */
async function waitForTerminalPaint(page: Page) {
  await page.locator('[data-testid="agent-xterm"] .xterm-screen').waitFor();
  await page.evaluate(async () => {
    for (let frame = 0; frame < 8; frame += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)));
    }
  });
}

async function openTerminal(page: Page, agentId: string) {
  await page
    .getByTestId('start-screen-agents-line')
    .getByRole('button', { name: 'Open Agent Console' })
    .click();
  await page
    .getByTestId(`console-agent-card-${agentId}`)
    .getByRole('button', { name: 'Terminal', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: agentId === 'writer' ? 'Writer' : 'Other' })
  ).toBeVisible();
  await waitForTerminalPaint(page);
}

function longScreen(): string {
  const lines = ['SCROLLED-AWAY-LINE'];
  for (let i = 0; i < 120; i += 1) lines.push(`filler-${i}`);
  lines.push('ON-SCREEN-MARKER', 'second visible row');
  // `\n` alone leaves the cursor in its column, so each next line starts
  // further right and the marker wraps in half. A terminal line is CR+LF.
  return lines.join('\r\n');
}

test.describe('save the visible agent screen as a scratch', () => {
  test.beforeEach(async ({ page }) => {
    await installScratchFilesystem(page);
    await page.goto('/');
    await expect(page.getByTestId('ide-shell')).toBeVisible();
  });

  test('keeps the rows on screen and leaves the ones above them out', async ({ page }) => {
    await seedFleet(page, { writer: [`${longScreen()}\n`] });
    await openTerminal(page, 'writer');

    await expect(
      page.getByRole('button', { name: 'Save the visible screen of Other as a scratch' })
    ).toHaveCount(0);

    await page
      .getByRole('button', { name: 'Save the visible screen of Writer as a scratch' })
      .click();

    await expect(page.getByTestId('toast-success')).toContainText('Screen saved as scratch-1.md');
    await expect(page.getByRole('dialog', { name: 'Writer' })).toBeVisible();

    const saved = await page.evaluate(() => {
      const files = (window as unknown as { __AURIC_SCRATCH_FILES__?: Map<string, string> })
        .__AURIC_SCRATCH_FILES__;
      return files?.get('/virtual/scratches/scratch-1.md') ?? '';
    });
    expect(saved).toContain('# Writer');
    expect(saved).toContain('ON-SCREEN-MARKER');
    expect(saved).toContain('second visible row');
    expect(saved).not.toContain('SCROLLED-AWAY-LINE');

    await page.getByRole('button', { name: 'Close', exact: true }).click();
    await page.getByRole('button', { name: 'Close agent console' }).click();
    await page.getByTestId('activity-item-scratches').click();
    await page.getByText('scratch-1.md', { exact: true }).click();
    await expect(page.getByText('ON-SCREEN-MARKER')).toBeVisible();
    await expect(page.getByText('SCROLLED-AWAY-LINE')).toHaveCount(0);
  });

  test('saves nothing when the screen is empty', async ({ page }) => {
    await seedFleet(page, {});
    await openTerminal(page, 'other');

    await page
      .getByRole('button', { name: 'Save the visible screen of Other as a scratch' })
      .click();

    await expect(page.getByTestId('toast-info')).toContainText('Nothing on the screen to save');
    await expect(page.getByRole('dialog', { name: 'Other' })).toBeVisible();
    const written = await page.evaluate(() => {
      const files = (window as unknown as { __AURIC_SCRATCH_FILES__?: Map<string, string> })
        .__AURIC_SCRATCH_FILES__;
      return files?.size ?? 0;
    });
    expect(written).toBe(0);
  });
});
