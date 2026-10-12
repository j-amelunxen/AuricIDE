import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { $, $$, browser } from '@wdio/globals';

/**
 * The merge panel's demo moments in the real app: a merge started with the git
 * CLI shows up in Source Control, is resolved with buttons, a key and an edit,
 * and committed; a second one is aborted; a hunk is staged on its own. Every
 * outcome is checked on disk with the git CLI, not in the store.
 *
 * Launched by scripts/run-tauri-merge-e2e.mts. No step calls a model.
 */

type TauriApi = {
  core: {
    invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  };
};

type TauriBrowser = {
  tauri: {
    execute<ReturnValue, Arguments extends unknown[]>(
      script: (tauri: TauriApi, ...args: Arguments) => ReturnValue | Promise<ReturnValue>,
      ...args: Arguments
    ): Promise<Awaited<ReturnValue>>;
  };
};

/** The WebdriverIO browser commands this spec uses; the global typing here lacks them. */
type WdioBrowser = {
  execute<ReturnValue, Arguments extends unknown[]>(
    script: (...args: Arguments) => ReturnValue,
    ...args: Arguments
  ): Promise<Awaited<ReturnValue>>;
  waitUntil(
    condition: () => Promise<boolean> | boolean,
    options?: { timeout?: number; interval?: number; timeoutMsg?: string }
  ): Promise<true>;
  saveScreenshot(path: string): Promise<unknown>;
  refresh(): Promise<void>;
};

type Hook = (
  body: (this: { currentTest?: { state?: string; title: string } }) => Promise<void>
) => void;
declare const describe: (name: string, body: () => void) => void;
declare const it: (name: string, body: () => Promise<void>) => void;
declare const before: (body: () => Promise<void>) => void;
declare const afterEach: Hook;

const tauriBrowser = browser as typeof browser & TauriBrowser;
const wdio = browser as unknown as WdioBrowser;

const projectPath = process.env.VFY_TAURI_MERGE_PROJECT_PATH;
const screenshotDir = process.env.VFY_TAURI_SCREENSHOT_DIR;

const FEATURE = 'feature/billing-export';
const SECOND_FEATURE = 'feature/report-columns';
const FILE_A = 'src/invoice.txt';
const FILE_B = 'config/export.yml';
const UNRELATED = 'notes/readme.txt';
const HUNKS = 'docs/hunks.txt';
const PREVIEW_FEATURE = 'feature/preview-clash';
const REBASE_FEATURE = 'feature/rebase-me';
const REBASE_NOTE = 'docs/rebase-note.txt';
const TERMINAL_REBASE = 'feature/terminal-rebase';

const filler = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `context line ${from + i}`);

function invoiceWith(alpha: string, beta: string): string {
  return ['# Invoice', alpha, ...filler(1, 8), beta, '# End', ''].join('\n');
}

const exportWith = (format: string) =>
  ['export:', `  format: ${format}`, '  gzip: false', ''].join('\n');
const hunkLines = Array.from({ length: 30 }, (_, i) => `row ${i + 1}`);

function git(args: string[], allowFailure = false): string {
  try {
    return execFileSync('git', args, {
      cwd: projectPath,
      encoding: 'utf8',
      env: {
        ...process.env,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'E2E Author',
        GIT_AUTHOR_EMAIL: 'e2e@example.invalid',
        GIT_COMMITTER_NAME: 'E2E Author',
        GIT_COMMITTER_EMAIL: 'e2e@example.invalid',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    if (allowFailure) return '';
    throw error;
  }
}

function write(relative: string, content: string) {
  const target = join(projectPath as string, relative);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content);
}

const read = (relative: string) => readFileSync(join(projectPath as string, relative), 'utf8');

/** Back to a clean main: the earlier scenarios leave staged hunks and an unrelated edit. */
function cleanMain() {
  git(['checkout', '-q', 'main']);
  git(['reset', '-q', '--hard', 'HEAD']);
  assert.equal(git(['status', '--porcelain']), '');
}
const gitDir = () => join(projectPath as string, '.git');

function commitAll(message: string) {
  git(['add', '-A']);
  git(['commit', '-q', '-m', message]);
}

/** main and feature/billing-export conflict twice in FILE_A and once in FILE_B. */
function createRepository() {
  git(['init', '-q', '-b', 'main']);
  // git2 inside the app reads the signature from config, not from GIT_* env.
  git(['config', 'user.name', 'E2E Author']);
  git(['config', 'user.email', 'e2e@example.invalid']);
  git(['config', 'commit.gpgsign', 'false']);
  write('.gitignore', '.auric/\n');
  write(FILE_A, invoiceWith('alpha', 'beta'));
  write(FILE_B, exportWith('csv'));
  write(UNRELATED, 'Notes\nkeep this line\n');
  write(HUNKS, `${hunkLines.join('\n')}\n`);
  commitAll('Base');

  git(['checkout', '-q', '-b', FEATURE]);
  write(FILE_A, invoiceWith('alpha from feature', 'beta from feature'));
  write(FILE_B, exportWith('parquet'));
  commitAll('Export as parquet');

  git(['checkout', '-q', 'main']);
  write(FILE_A, invoiceWith('alpha from main', 'beta from main'));
  write(FILE_B, exportWith('json'));
  commitAll('Export as json');
}

/** `git merge` the way a terminal would; a conflict exits 1 and leaves MERGE_HEAD. */
function mergeInTerminal(branch: string) {
  git(['merge', '--no-edit', branch], true);
  assert.ok(
    existsSync(join(gitDir(), 'MERGE_HEAD')),
    `git merge ${branch} must stop on a conflict`
  );
}

const xpathText = (tag: string, text: string) =>
  `//${tag}[contains(normalize-space(.), ${JSON.stringify(text)})]`;

async function waitForText(text: string, timeout = 15_000) {
  await wdio.waitUntil(
    async () => await wdio.execute((t) => document.body.innerText.includes(t), text),
    { timeout, timeoutMsg: `"${text}" never appeared` }
  );
}

async function waitForNoText(text: string, timeout = 15_000) {
  await wdio.waitUntil(
    async () => !(await wdio.execute((t) => document.body.innerText.includes(t), text)),
    { timeout, timeoutMsg: `"${text}" never went away` }
  );
}

/**
 * Clicks the way a pointer does: focus first, then click. The embedded
 * WebDriver's element click calls `el.click()` and then `el.focus()` on the
 * same element (tauri-plugin-wdio-webdriver 1.4.0, executor.rs click_element),
 * which takes focus back from wherever the app just moved it and, once the
 * button unmounts, leaves it on body. That would test the harness, not the app.
 */
async function userClick(selector: string, timeoutMsg = `nothing matches ${selector}`) {
  const el = await $(selector);
  await el.waitForExist({ timeoutMsg });
  await wdio.execute(
    (node: HTMLElement) => {
      node.scrollIntoView({ block: 'center' });
      node.focus();
      node.click();
    },
    el as unknown as HTMLElement
  );
}

/** Focuses without clicking, so a menu item's focus handler runs and nothing else does. */
async function userFocus(selector: string) {
  const el = await $(selector);
  await el.waitForExist({ timeoutMsg: `nothing matches ${selector}` });
  await wdio.execute((node: HTMLElement) => node.focus(), el as unknown as HTMLElement);
}

async function clickButton(text: string, scope = '') {
  await userClick(`${scope}${xpathText('button', text)}`, `no button "${text}"`);
}

/** Where focus is, described so an assertion message says it. */
async function focusDescription(): Promise<string> {
  return await wdio.execute(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return 'body';
    const card = el.closest('[data-testid^="conflict-card-"]');
    return `${el.tagName.toLowerCase()}${card ? ` in ${card.getAttribute('data-testid')}` : ''}`;
  });
}

/**
 * Presses ⌥ + key on the focused element. The embedded WebDriver's action
 * handler synthesizes arrow keys without modifier flags (tauri-plugin-wdio-
 * webdriver 1.4.0, executor.rs: the arrow branch builds its KeyboardEvent
 * without altKey), so the event is dispatched here the same way, with the flag.
 */
async function pressAlt(key: 'ArrowLeft' | 'ArrowRight' | 'ArrowDown') {
  await wdio.execute((k) => {
    const target = document.activeElement ?? document.body;
    target.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: k,
        code: k,
        altKey: true,
        bubbles: true,
        cancelable: true,
      })
    );
  }, key);
}

async function screenshot(name: string) {
  if (!screenshotDir) return;
  mkdirSync(screenshotDir, { recursive: true });
  await wdio.saveScreenshot(join(screenshotDir, `${name}.png`));
}

async function openSourceControl() {
  const item = await $('[data-testid="activity-item-source-control"]');
  await item.waitForExist({ timeout: 20_000 });
  const already = await $('[data-testid^="merge-banner-"], [aria-label="Merge commit message"]');
  if (!(await already.isExisting())) await item.click();
}

async function resolvedCount(): Promise<number> {
  return (await $$('[data-testid="resolution-summary"]')).length;
}

async function captureFailure(name: string) {
  await screenshot(`failed-${name}`);
  const text = await wdio.execute(() => document.body.innerText.slice(0, 6000));
  if (screenshotDir) writeFileSync(join(screenshotDir, `failed-${name}.txt`), text);
}

/** Registers the repository as a recent project and opens it from the start screen. */
async function openProject(path: string) {
  await tauriBrowser.tauri.execute(async (tauri, p) => {
    await tauri.core.invoke('recent_projects_add', { path: p });
  }, path);
  await wdio.refresh();
  // The start screen opens on Quick Access; recent projects are the second tab.
  const recentTab = await $(xpathText('button', 'Recent'));
  await recentTab.waitForExist({ timeout: 30_000 });
  await recentTab.click();
  const open = await $(`[aria-label="Open ${basename(path)}"]`);
  await open.waitForExist({ timeout: 30_000 });
  await open.click();
  await openSourceControl();
}

const describeNative = projectPath ? describe : (_: string, __: () => void) => undefined;

describeNative('merge panel in the native app', () => {
  before(async () => {
    assert.ok(projectPath);
    createRepository();
    mergeInTerminal(FEATURE);
    try {
      await openProject(projectPath);
    } catch (error) {
      await captureFailure('open-project');
      throw error;
    }
  });

  afterEach(async function () {
    if (this.currentTest?.state === 'failed') {
      await captureFailure(this.currentTest.title.replace(/\W+/g, '-'));
    }
  });

  it('shows a merge started in a terminal, resolves it by button, key and edit, and commits', async () => {
    const banner = await $('[data-testid^="merge-banner-"]');
    await banner.waitForExist({ timeout: 20_000 });
    await waitForText(`Merging ${FEATURE} into main`);
    await waitForText('2 files left to resolve');
    await screenshot('01-banner');

    // File A: conflict 1 by button, conflict 2 by ⌥→.
    await userClick(`//button[@title="Resolve ${FILE_A}"]`);
    await (await $('[data-testid="merge-view"]')).waitForExist();
    const cards = await $$('[data-testid^="conflict-card-"]');
    assert.equal(cards.length, 2, 'file A has two conflict regions');
    // Each side header names the commit that changed it since the merge base.
    const incomingOrigin = await $(
      '[data-testid="conflict-card-0"] [data-side="theirs"] [data-testid="side-origin"]'
    );
    await incomingOrigin.waitForExist({ timeout: 10_000 });
    assert.match(await incomingOrigin.getText(), /Export as parquet/);
    await screenshot('02-merge-view');

    const firstCard = await cards[0].getAttribute('data-testid');
    const secondCard = await cards[1].getAttribute('data-testid');
    await clickButton('Take yours', `//*[@data-testid="${firstCard}"]`);
    await wdio.waitUntil(async () => (await resolvedCount()) === 1);
    const focusAfterButton = await focusDescription();
    assert.ok(
      focusAfterButton.endsWith(`in ${secondCard}`),
      `Take yours must move focus to the next open conflict, got ${focusAfterButton}`
    );

    await pressAlt('ArrowRight');
    await wdio.waitUntil(async () => (await resolvedCount()) === 2, {
      timeoutMsg: `⌥→ did not resolve the second conflict (focus was ${focusAfterButton})`,
    });
    const summaries = await $$('[data-testid="resolution-summary"]');
    assert.match(await summaries[0].getText(), /main|yours/i);
    assert.match(await summaries[1].getText(), /billing-export|incoming/i);
    assert.notEqual(await focusDescription(), 'body', 'focus must not fall to body after ⌥→');
    await screenshot('03-file-a-decided');

    await clickButton('Mark resolved', '//*[@data-testid="merge-toolbar"]');
    await waitForText('1 file left to resolve');
    assert.equal(read(FILE_A), invoiceWith('alpha from main', 'beta from feature'));
    assert.equal(git(['ls-files', '-u', '--', FILE_A]), '', 'file A is staged as resolved');

    // File B: a hand-written resolution.
    await userClick(`//button[@title="Resolve ${FILE_B}"]`);
    await wdio.waitUntil(async () => (await $$('[data-testid^="conflict-card-"]')).length === 1, {
      timeoutMsg: 'file B did not open with one conflict',
    });
    await clickButton('Edit', '//*[@role="group" and @aria-label="Resolve this conflict"]');
    const editor = await $('[aria-label="Resolution for conflict 1"]');
    await editor.waitForExist();
    await editor.setValue('  format: xlsx');
    await clickButton('Use this text');
    await wdio.waitUntil(async () => (await resolvedCount()) === 1);
    await clickButton('Mark resolved', '//*[@data-testid="merge-toolbar"]');
    await waitForText('All conflicts resolved');
    assert.equal(read(FILE_B), exportWith('xlsx'));

    // Commit.
    const message = await $('[aria-label="Merge commit message"]');
    if (!(await message.getValue()).trim()) await message.setValue(`Merge ${FEATURE}`);
    await screenshot('04-ready-to-commit');
    await clickButton('Commit merge');
    await wdio.waitUntil(async () => !existsSync(join(gitDir(), 'MERGE_HEAD')), {
      timeout: 15_000,
      timeoutMsg: 'MERGE_HEAD is still there after Commit merge',
    });
    await (await $('[data-testid^="merge-banner-"]')).waitForExist({ reverse: true });
    await screenshot('05-committed');

    const parents = git(['rev-list', '--parents', '-n', '1', 'HEAD']).trim().split(' ');
    assert.equal(parents.length, 3, 'HEAD is a merge commit with two parents');
    assert.equal(
      parents[2],
      git(['rev-parse', FEATURE]).trim(),
      'second parent is the feature tip'
    );
    assert.equal(
      git(['show', `HEAD:${FILE_A}`]),
      invoiceWith('alpha from main', 'beta from feature')
    );
    assert.equal(git(['show', `HEAD:${FILE_B}`]), exportWith('xlsx'));
    assert.equal(git(['status', '--porcelain']), '');
  });

  it('aborts a second merge back to the exact pre-merge state, keeping an unrelated edit', async () => {
    git(['checkout', '-q', '-b', SECOND_FEATURE]);
    write(FILE_B, exportWith('ods'));
    commitAll('Export as ods');
    git(['checkout', '-q', 'main']);
    write(FILE_B, exportWith('tsv'));
    commitAll('Export as tsv');

    write(UNRELATED, 'Notes\nkeep this line\nan edit nobody committed\n');
    const headBefore = git(['rev-parse', 'HEAD']).trim();
    const statusBefore = git(['status', '--porcelain']);
    const fileBBefore = read(FILE_B);

    mergeInTerminal(SECOND_FEATURE);

    await waitForText(`Merging ${SECOND_FEATURE} into main`, 30_000);
    await waitForText('1 file left to resolve');
    await screenshot('06-second-merge');
    await clickButton('Abort merge', '//*[starts-with(@data-testid, "merge-banner-")]');
    const dialog = await $('[role="dialog"]');
    await dialog.waitForExist();
    await screenshot('07-abort-confirm');
    await clickButton('Abort merge', '//*[@role="dialog"]');
    await wdio.waitUntil(async () => !existsSync(join(gitDir(), 'MERGE_HEAD')), {
      timeoutMsg: 'MERGE_HEAD is still there after Abort merge',
    });
    await waitForNoText(`Merging ${SECOND_FEATURE} into main`);

    assert.equal(git(['rev-parse', 'HEAD']).trim(), headBefore);
    assert.equal(git(['status', '--porcelain']), statusBefore);
    assert.equal(read(FILE_B), fileBBefore);
    assert.equal(read(UNRELATED), 'Notes\nkeep this line\nan edit nobody committed\n');
    assert.equal(git(['ls-files', '-u']), '', 'no conflict stages left in the index');
  });

  it('stages only the second of two hunks from the diff viewer', async () => {
    const changed = [...hunkLines];
    changed[1] = 'row 2 changed early';
    changed[27] = 'row 28 changed late';
    write(HUNKS, `${changed.join('\n')}\n`);
    assert.equal(git(['diff', '--cached']), '');

    const row = await $(
      `//*[@role="button"][.//span[normalize-space(.)=${JSON.stringify(HUNKS)}]]`
    );
    await row.waitForExist({ timeout: 20_000, timeoutMsg: `${HUNKS} never showed up in Changes` });
    await row.click();

    await wdio.waitUntil(async () => (await $$('[data-testid="hunk-action-stage"]')).length === 2, {
      timeoutMsg: 'the diff did not show two stageable hunks',
    });
    await screenshot('08-diff-two-hunks');
    await userClick(`[aria-label="Stage hunk 2 of 2 in ${basename(HUNKS)}"]`);

    await wdio.waitUntil(async () => git(['diff', '--cached']) !== '', {
      timeoutMsg: 'nothing was staged',
    });
    const staged = git(['diff', '--cached', '-U0', '--', HUNKS]);
    const unstaged = git(['diff', '-U0', '--', HUNKS]);
    assert.match(staged, /^\+row 28 changed late$/m);
    assert.match(staged, /^-row 28$/m);
    assert.doesNotMatch(staged, /row 2 changed early/);
    assert.match(unstaged, /^\+row 2 changed early$/m);
    assert.doesNotMatch(unstaged, /row 28/);
    await screenshot('09-hunk-staged');
    assert.notEqual(
      await focusDescription(),
      'body',
      'focus must not fall to body after Stage hunk'
    );
  });

  it('previews a conflicting merge in the Merge… menu and names the file before merging', async () => {
    cleanMain();
    git(['checkout', '-q', '-b', PREVIEW_FEATURE]);
    write(FILE_B, exportWith('avro'));
    commitAll('Export as avro');
    git(['checkout', '-q', 'main']);
    write(FILE_B, exportWith('orc'));
    commitAll('Export as orc');
    const headBefore = git(['rev-parse', 'HEAD']).trim();
    const indexBefore = readFileSync(join(gitDir(), 'index'));

    await clickButton('Merge into main…');
    const item = `//*[@role="menuitem"][.//span[normalize-space(.)=${JSON.stringify(PREVIEW_FEATURE)}]]`;
    await userFocus(item);
    await wdio.waitUntil(
      async () => (await (await $(item)).getText()).includes('Conflicts in 1 file: export.yml'),
      { timeout: 10_000, timeoutMsg: 'the menu never previewed the conflict' }
    );
    await screenshot('10-merge-preview');
    // The preview built the merge in memory only.
    assert.equal(git(['rev-parse', 'HEAD']).trim(), headBefore);
    assert.ok(readFileSync(join(gitDir(), 'index')).equals(indexBefore), 'index untouched');
    assert.ok(!existsSync(join(gitDir(), 'MERGE_HEAD')));

    await userClick(item);
    const dialog = await $('[role="dialog"]');
    await dialog.waitForExist();
    assert.match(await dialog.getText(), /config\/export\.yml/);
    await screenshot('11-merge-preview-confirm');
    await clickButton('Cancel', '//*[@role="dialog"]');
    await dialog.waitForExist({ reverse: true });
    assert.ok(!existsSync(join(gitDir(), 'MERGE_HEAD')), 'Cancel merged nothing');
    assert.equal(git(['rev-parse', 'HEAD']).trim(), headBefore);
  });

  it('finishes a rebase started in a terminal with Continue rebase', async () => {
    cleanMain();
    git(['checkout', '-q', '-b', REBASE_FEATURE]);
    write(FILE_B, exportWith('feather'));
    commitAll('Export as feather');
    write(REBASE_NOTE, 'replayed without a conflict\n');
    commitAll('Add a rebase note');
    git(['checkout', '-q', 'main']);
    write(FILE_B, exportWith('arrow'));
    commitAll('Export as arrow');
    const mainTip = git(['rev-parse', 'main']).trim();

    git(['checkout', '-q', REBASE_FEATURE]);
    git(['rebase', 'main'], true);
    assert.ok(existsSync(join(gitDir(), 'rebase-merge')), 'git rebase must stop on a conflict');

    await waitForText('A rebase is in progress', 30_000);
    await waitForText('Replaying commit 1 of 2: Export as feather');
    await screenshot('12-rebase-banner');
    const continueSelector = xpathText('button', 'Continue rebase');
    assert.equal(
      await (await $(continueSelector)).isEnabled(),
      false,
      'Continue rebase waits for the conflict'
    );

    await userClick(`//button[@title="Resolve ${FILE_B}"]`);
    await wdio.waitUntil(async () => (await $$('[data-testid^="conflict-card-"]')).length === 1, {
      timeoutMsg: 'the rebase conflict did not open',
    });
    await clickButton('Take your commit', '//*[starts-with(@data-testid, "conflict-card-")]');
    await wdio.waitUntil(async () => (await resolvedCount()) === 1);
    await clickButton('Mark resolved', '//*[@data-testid="merge-toolbar"]');
    await waitForText('Continue rebase in Source Control');
    await waitForText('All conflicts resolved');
    await screenshot('13-rebase-resolved');

    await clickButton('Continue rebase', '//*[starts-with(@data-testid, "merge-banner-")]');
    await wdio.waitUntil(async () => !existsSync(join(gitDir(), 'rebase-merge')), {
      timeout: 30_000,
      timeoutMsg: '.git/rebase-merge is still there after Continue rebase',
    });
    await waitForNoText('A rebase is in progress');
    await screenshot('14-rebase-finished');

    assert.equal(git(['branch', '--show-current']).trim(), REBASE_FEATURE);
    assert.equal(
      git(['log', '--format=%s', 'main..HEAD']),
      'Add a rebase note\nExport as feather\n'
    );
    assert.equal(git(['rev-list', '--merges', 'main..HEAD']), '', 'history is linear');
    assert.equal(git(['rev-parse', 'HEAD~2']).trim(), mainTip, 'replayed onto main');
    assert.equal(git(['show', `HEAD:${FILE_B}`]), exportWith('feather'));
    assert.equal(read(FILE_B), exportWith('feather'));
    assert.equal(read(REBASE_NOTE), 'replayed without a conflict\n');
    assert.equal(git(['status', '--porcelain']), '');
  });

  it('ends an open conflict tab when the rebase is continued in a terminal', async () => {
    cleanMain();
    git(['checkout', '-q', '-b', TERMINAL_REBASE]);
    write(FILE_B, exportWith('first'));
    commitAll('Export first');
    write(FILE_B, exportWith('second'));
    commitAll('Export second');
    git(['checkout', '-q', 'main']);
    write(FILE_B, exportWith('main-side'));
    commitAll('Export main-side');
    git(['checkout', '-q', TERMINAL_REBASE]);
    git(['rebase', 'main'], true);
    assert.ok(existsSync(join(gitDir(), 'rebase-merge')), 'git rebase must stop on a conflict');

    await waitForText('Replaying commit 1 of 2: Export first', 30_000);
    await userClick(`//button[@title="Resolve ${FILE_B}"]`);
    await wdio.waitUntil(async () => (await $$('[data-testid^="conflict-card-"]')).length === 1, {
      timeoutMsg: 'the first stop did not open',
    });

    // Resolve and continue outside the IDE: the next commit stops on the same path.
    write(FILE_B, exportWith('settled in a terminal'));
    git(['add', FILE_B]);
    git(['-c', 'core.editor=true', 'rebase', '--continue'], true);
    assert.equal(git(['ls-files', '-u', '--', FILE_B]) !== '', true, 'the second commit conflicts');

    await waitForText('Replaying commit 2 of 2: Export second', 30_000);
    await waitForText('This conflict is closed', 15_000);
    await screenshot('15-terminal-continue-ended');
    assert.equal(
      (await $$('[data-testid^="conflict-card-"]')).length,
      0,
      'the stale conflict cards of commit 1 are gone'
    );

    git(['rebase', '--abort']);
    assert.ok(!existsSync(join(gitDir(), 'rebase-merge')));
  });
});
