import { expect, test, type Page } from '@playwright/test';

/**
 * The merge and review demo moments that need a model or a seeded change set,
 * run in the browser against a fake Tauri IPC with deterministic answers. The
 * native run (e2e/tauri/merge-panel.spec.ts) covers what git itself does; this
 * one covers what the panel shows and when it writes.
 */

const REPO = '/virtual/billing-service';
const OURS = 'main';
const THEIRS = 'feature/billing-export';
const CONFLICTED = 'src/invoice.txt';

const BASE = ['# Invoice', 'total: 100', 'line', 'currency: EUR', '# End', ''].join('\n');
const OURS_TEXT = ['# Invoice', 'total: 120', 'line', 'currency: EUR', '# End', ''].join('\n');
const THEIRS_TEXT = ['# Invoice', 'total: 110', 'line', 'currency: USD', '# End', ''].join('\n');

/**
 * diff3 text in the shape `git2::merge_file` writes. The second region is one
 * git can hand over (zealous merging joins near hunks): only incoming changed it.
 */
const MERGED = [
  '# Invoice',
  `<<<<<<< ${OURS}`,
  'total: 120',
  '||||||| base',
  'total: 100',
  '=======',
  'total: 110',
  `>>>>>>> ${THEIRS}`,
  'line',
  `<<<<<<< ${OURS}`,
  'currency: EUR',
  '||||||| base',
  'currency: EUR',
  '=======',
  'currency: USD',
  `>>>>>>> ${THEIRS}`,
  '# End',
  '',
].join('\n');

const PROPOSAL = {
  resolution: 'total: 120\n',
  rationale: 'main raised the total after the export branch forked, so its value is the newer one.',
  confidence: 'high',
};

const TEST_FILE = 'src/billing.test.ts';
const SOURCE_FILE = 'src/billing.ts';
const PATCHES: Record<string, string> = {
  [TEST_FILE]: [
    `diff --git a/${TEST_FILE} b/${TEST_FILE}`,
    'index 1111111..2222222 100644',
    `--- a/${TEST_FILE}`,
    `+++ b/${TEST_FILE}`,
    '@@ -1,9 +1,5 @@',
    " import { total } from './billing';",
    ' ',
    "-it('adds tax', () => {",
    '-  expect(total(100)).toBe(119);',
    '-});',
    '-',
    " it('rounds to cents', () => {",
    '   expect(total(0.333)).toBe(0.4);',
    ' });',
    '',
  ].join('\n'),
  [SOURCE_FILE]: [
    `diff --git a/${SOURCE_FILE} b/${SOURCE_FILE}`,
    'index 3333333..4444444 100644',
    `--- a/${SOURCE_FILE}`,
    `+++ b/${SOURCE_FILE}`,
    '@@ -1,3 +1,3 @@',
    ' export function total(net: number): number {',
    '-  return net * 1.19;',
    '+  return Math.round(net * 119) / 100;',
    ' }',
    '',
  ].join('\n'),
};

/**
 * A JSON conflict for the syntax check: the composed file is what gets
 * parsed, so a proposal that drops a comma is caught before it is written.
 */
const JSON_FILE = 'config/limits.json';
const JSON_SCENARIO: Scenario = {
  conflicted: JSON_FILE,
  base: ['{', '  "maxSeats": 3,', '  "trialDays": 14', '}', ''].join('\n'),
  oursText: ['{', '  "maxSeats": 5,', '  "trialDays": 14', '}', ''].join('\n'),
  theirsText: ['{', '  "maxSeats": 4,', '  "trialDays": 14', '}', ''].join('\n'),
  merged: [
    '{',
    `<<<<<<< ${OURS}`,
    '  "maxSeats": 5,',
    '||||||| base',
    '  "maxSeats": 3,',
    '=======',
    '  "maxSeats": 4,',
    `>>>>>>> ${THEIRS}`,
    '  "trialDays": 14',
    '}',
    '',
  ].join('\n'),
  proposal: {
    resolution: '  "maxSeats": 5,\n',
    rationale: 'Five seats already allow the fourth seat the feature branch asked for.',
    confidence: 'medium',
  },
};

interface Scenario {
  conflicted: string;
  base: string;
  oursText: string;
  theirsText: string;
  merged: string;
  proposal: { resolution: string; rationale: string; confidence: string };
}

const INVOICE_SCENARIO: Scenario = {
  conflicted: CONFLICTED,
  base: BASE,
  oursText: OURS_TEXT,
  theirsText: THEIRS_TEXT,
  merged: MERGED,
  proposal: PROPOSAL,
};

type Call = { cmd: string; args: Record<string, unknown> };

async function installFakeIpc(page: Page, scenario: Scenario) {
  await page.addInitScript(
    ({ repo, ours, theirs, conflicted, base, oursText, theirsText, merged, proposal, patches }) => {
      const calls: { cmd: string; args: Record<string, unknown> }[] = [];
      let conflictOpen = true;
      const w = window as unknown as Record<string, unknown>;
      w.__AURIC_IPC_CALLS__ = calls;
      const mergeState = () => ({
        inProgress: conflictOpen,
        operation: conflictOpen ? 'merge' : 'none',
        oursLabel: ours,
        theirsLabel: conflictOpen ? theirs : null,
        theirsOid: conflictOpen ? 'abc1234def' : null,
        message: conflictOpen ? `Merge branch '${theirs}'` : null,
        conflicts: conflictOpen ? [{ path: conflicted, kind: 'content' }] : [],
      });
      const answers: Record<string, (args: Record<string, unknown>) => unknown> = {
        git_merge_state: () => mergeState(),
        git_conflict_file: () => ({
          path: conflicted,
          kind: 'content',
          base,
          ours: oursText,
          theirs: theirsText,
          merged,
          oursLabel: ours,
          theirsLabel: theirs,
        }),
        git_resolve_conflict: () => {
          conflictOpen = false;
          return null;
        },
        llm_call: () => ({ content: JSON.stringify(proposal) }),
        git_status: (args) =>
          args.repoPath === repo
            ? Object.keys(patches).map((path) => ({
                path,
                status: 'modified',
                staged: null,
                unstaged: 'modified',
              }))
            : [],
        git_diff: (args) => patches[String(args.filePath)] ?? '',
        db_get: () => null,
        db_set: () => null,
      };
      w.__TAURI_INTERNALS__ = {
        transformCallback: () => 0,
        invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
          calls.push({ cmd, args });
          if (cmd.startsWith('plugin:event|')) return 0;
          const answer = answers[cmd];
          if (!answer) throw new Error(`unhandled invoke: ${cmd}`);
          return answer(args);
        },
      };
    },
    {
      repo: REPO,
      ours: OURS,
      theirs: THEIRS,
      ...scenario,
      patches: PATCHES,
    }
  );
}

async function callsOf(page: Page, cmd: string): Promise<Call[]> {
  return await page.evaluate(
    (name) =>
      ((window as unknown as { __AURIC_IPC_CALLS__: Call[] }).__AURIC_IPC_CALLS__ ?? []).filter(
        (c) => c.cmd === name
      ),
    cmd
  );
}

async function expectFocusOffBody(page: Page, after: string) {
  const onBody = await page.evaluate(
    () => !document.activeElement || document.activeElement === document.body
  );
  expect(onBody, `focus fell to body after ${after}`).toBe(false);
}

type StoreHandle = {
  getState: () => {
    openConflict: (repoPath: string, filePath: string) => Promise<string>;
    openReviewSession: (source: { kind: 'worktree'; repoPath: string }) => string;
    openTab: (tab: { id: string; path: string; name: string }) => void;
  };
};

/** The same two calls `openMergeTab` makes from the banner. */
async function openMergeTab(page: Page, file = CONFLICTED) {
  await page.evaluate(
    async ({ repo, file }) => {
      const store = (window as unknown as { __AURIC_STORE__: StoreHandle }).__AURIC_STORE__;
      const id = await store.getState().openConflict(repo, file);
      store.getState().openTab({ id, path: file, name: `${file.split('/').pop()} (merge)` });
    },
    { repo: REPO, file }
  );
}

async function start(page: Page, scenario: Scenario) {
  await installFakeIpc(page, scenario);
  await page.goto('/');
  await expect(page.getByTestId('ide-shell')).toBeVisible();
}

/** The same two calls `openReviewTab` makes from "Review changes". */
async function openReviewTab(page: Page) {
  await page.evaluate((repo) => {
    const store = (window as unknown as { __AURIC_STORE__: StoreHandle }).__AURIC_STORE__;
    const id = store.getState().openReviewSession({ kind: 'worktree', repoPath: repo });
    store.getState().openTab({ id, path: repo, name: 'Review: billing-service' });
  }, REPO);
}

test.describe('merge and review demo moments', () => {
  test('the wand explains itself, and a proposal is shown, not written, until Mark resolved', async ({
    page,
  }) => {
    await start(page, INVOICE_SCENARIO);
    await openMergeTab(page);
    const view = page.getByTestId('merge-view');
    await expect(view).toBeVisible();
    await expect(view.locator('[data-testid^="conflict-card-"]')).toHaveCount(2);

    // Wand: only the incoming side touched the second region.
    await view.getByRole('button', { name: /Resolve simple conflicts/ }).click();
    const reason = view.getByTestId('auto-reason');
    await expect(reason).toHaveCount(1);
    await expect(reason).toContainText(/only|incoming|changed/i);
    await expectFocusOffBody(page, 'the wand');

    // Ask agent on the real conflict.
    const first = view.locator('[data-testid^="conflict-card-"]').first();
    await first.getByRole('button', { name: /Ask agent/ }).click();
    const ready = first.getByTestId('proposal-ready');
    await expect(ready).toBeVisible();
    await expect(ready).toContainText(PROPOSAL.rationale);
    await expect(first.getByTestId('proposal-confidence')).toContainText(/high/i);
    expect(await callsOf(page, 'llm_call')).toHaveLength(1);
    expect(await callsOf(page, 'git_resolve_conflict')).toHaveLength(0);
    await expectFocusOffBody(page, 'Ask agent');

    await first.getByRole('button', { name: 'Use proposal' }).click();
    await expect(view.getByTestId('resolution-summary')).toHaveCount(2);
    expect(await callsOf(page, 'git_resolve_conflict')).toHaveLength(0);
    await expectFocusOffBody(page, 'Use proposal');

    await view
      .getByTestId('merge-toolbar')
      .getByRole('button', { name: /Mark resolved/ })
      .click();
    await expect.poll(async () => (await callsOf(page, 'git_resolve_conflict')).length).toBe(1);
    const [write] = await callsOf(page, 'git_resolve_conflict');
    expect(write.args).toMatchObject({ repoPath: REPO, filePath: CONFLICTED });
    expect(write.args.content).toBe(
      ['# Invoice', 'total: 120', 'line', 'currency: USD', '# End', ''].join('\n')
    );
    await expectFocusOffBody(page, 'Mark resolved');
  });

  test('review flags a removed test, V moves on, Approve waits with a reason, ? opens the sheet', async ({
    page,
  }) => {
    await start(page, INVOICE_SCENARIO);
    await openReviewTab(page);
    const items = page.getByTestId('review-file-item');
    await expect(items).toHaveCount(2);
    // Risk order: the file that removes a test comes first.
    await expect(items.first()).toHaveAttribute('title', TEST_FILE);
    await expect(page.getByText('Removes 1 test').first()).toBeVisible();

    const approve = page.getByTestId('review-approve');
    await expect(approve).toBeDisabled();
    await expect(page.getByTestId('review-approve-reason')).toContainText(
      'Approve waits: 2 files not viewed yet'
    );

    const sections = page.getByTestId('review-file-section');
    await sections.first().getByRole('heading').first().click();
    await page.keyboard.press('v');
    await expect(page.getByTestId('review-approve-reason')).toContainText(
      'Approve waits: 1 file not viewed yet'
    );
    await expectFocusOffBody(page, 'V');
    const focusedIn = await page.evaluate(
      () =>
        document.activeElement?.closest('[data-testid="review-file-section"]')?.textContent ?? ''
    );
    // The section shows the basename; 'billing.ts' is not a substring of 'billing.test.ts'.
    expect(focusedIn, 'V moves focus to the next unviewed file').toContain('billing.ts');
    await expect(approve).toBeDisabled();

    await page.keyboard.press('?');
    const sheet = page.getByRole('dialog', { name: /Review shortcuts/ });
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();
    await expectFocusOffBody(page, 'closing the shortcut sheet');

    await page.keyboard.press('v');
    await expect(approve).toBeEnabled();
    await expect(page.getByTestId('review-approve-reason')).toHaveCount(0);
    await expectFocusOffBody(page, 'the last V');
  });
  test('a proposal that keeps the file valid says what was checked', async ({ page }) => {
    await start(page, JSON_SCENARIO);
    await openMergeTab(page, JSON_FILE);
    const card = page.getByTestId('merge-view').locator('[data-testid^="conflict-card-"]').first();
    await card.getByRole('button', { name: /Ask agent/ }).click();
    const syntax = card.getByTestId('proposal-syntax');
    await expect(syntax).toContainText('Parses as JSON');
    await expect(syntax).toContainText('This checks that the file parses, not what it means.');
    await expect(syntax).toHaveAttribute('data-kind', 'ok');
  });

  test('a proposal that would break the file warns, and Mark resolved needs a second press', async ({
    page,
  }) => {
    await start(page, {
      ...JSON_SCENARIO,
      proposal: { ...JSON_SCENARIO.proposal, resolution: '  "maxSeats": 5\n' },
    });
    await openMergeTab(page, JSON_FILE);
    const view = page.getByTestId('merge-view');
    const card = view.locator('[data-testid^="conflict-card-"]').first();
    await card.getByRole('button', { name: /Ask agent/ }).click();
    const syntax = card.getByTestId('proposal-syntax');
    await expect(syntax).toContainText('Would break: not valid JSON at line 3');
    await expect(syntax).toHaveAttribute('data-kind', 'problem');

    // Still usable: the check advises, it does not lock.
    await card.getByRole('button', { name: 'Use proposal' }).click();
    const toolbar = view.getByTestId('merge-toolbar');
    await toolbar.getByRole('button', { name: /Mark resolved/ }).click();
    await expect(toolbar.getByTestId('mark-resolved-syntax')).toContainText(
      'Would break: not valid JSON at line 3'
    );
    expect(await callsOf(page, 'git_resolve_conflict')).toHaveLength(0);
    await expectFocusOffBody(page, 'the first Mark resolved');

    await toolbar.getByRole('button', { name: /Mark resolved anyway/ }).click();
    await expect.poll(async () => (await callsOf(page, 'git_resolve_conflict')).length).toBe(1);
    const [write] = await callsOf(page, 'git_resolve_conflict');
    expect(write.args.content).toBe(
      ['{', '  "maxSeats": 5', '  "trialDays": 14', '}', ''].join('\n')
    );
  });
});
