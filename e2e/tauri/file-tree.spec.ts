import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import { $, browser } from '@wdio/globals';

/**
 * The explorer in the real app: rows dragged onto folders move on disk (the
 * whole selection when a selected row is grabbed), open tabs follow the move,
 * a folder never goes into itself, a name clash is asked about, Shift+click
 * selects a range that "Delete 2 Items" removes with one confirmation, two
 * selected files open in the diff viewer through "Compare Selected", and a
 * Finder drop copies into the folder under the pointer.
 *
 * Pointer input is dispatched as DOM mouse events at the rows' real
 * coordinates, so WebKit's own hit-testing decides where a drop lands. A
 * Finder drop cannot be performed through WebDriver: it is replayed as the
 * webview drag-drop events Tauri raises for one, and the copy is real.
 *
 * Launched by scripts/run-tauri-file-tree-e2e.mts. No step calls a model.
 */

type TauriApi = {
  core: { invoke(command: string, args?: Record<string, unknown>): Promise<unknown> };
};
type TauriBrowser = {
  tauri: {
    execute<ReturnValue, Arguments extends unknown[]>(
      script: (tauri: TauriApi, ...args: Arguments) => ReturnValue | Promise<ReturnValue>,
      ...args: Arguments
    ): Promise<Awaited<ReturnValue>>;
  };
};
type WdioBrowser = {
  execute<ReturnValue, Arguments extends unknown[]>(
    script: (...args: Arguments) => ReturnValue | Promise<ReturnValue>,
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

const projectPath = process.env.VFY_TAURI_FILE_TREE_PROJECT_PATH;
const screenshotDir = process.env.VFY_TAURI_SCREENSHOT_DIR;

const abs = (relative: string) => join(projectPath as string, relative);
const outside = () => join(dirname(projectPath as string), 'outside-the-project');

function write(path: string, content: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}
const read = (relative: string) => readFileSync(abs(relative), 'utf8');

function createProject() {
  write(abs('archive/.keep'), '');
  write(abs('docs/clash.md'), 'the one already in docs\n');
  write(abs('docs/sub/.keep'), '');
  write(abs('inbox/one.md'), '# One\n');
  write(abs('inbox/two.md'), '# Two\n');
  write(abs('inbox/clash.md'), 'the one being moved\n');
  write(abs('left.txt'), 'alpha\nshared line\nbeta from the left\n');
  write(abs('right.txt'), 'alpha\nshared line\ngamma from the right\n');
  write(abs('trash1.md'), 'x\n');
  write(abs('trash2.md'), 'y\n');
  write(join(outside(), 'report.txt'), 'dropped from Finder\n');
}

const rowSelector = (relative: string) => `[data-testid="tree-item-${abs(relative)}"]`;

async function waitForRow(relative: string, timeout = 15_000) {
  await (
    await $(rowSelector(relative))
  ).waitForExist({
    timeout,
    timeoutMsg: `row ${relative} never appeared`,
  });
}

async function waitForNoRow(relative: string) {
  await (
    await $(rowSelector(relative))
  ).waitForExist({
    reverse: true,
    timeout: 15_000,
    timeoutMsg: `row ${relative} never went away`,
  });
}

async function waitForText(text: string, timeout = 15_000) {
  await wdio.waitUntil(
    async () => await wdio.execute((t) => document.body.innerText.includes(t), text),
    { timeout, timeoutMsg: `"${text}" never appeared` }
  );
}

async function waitForDisk(check: () => boolean, what: string) {
  await wdio.waitUntil(async () => check(), { timeout: 15_000, timeoutMsg: what });
}

/** A click as the pointer makes it, with modifier keys. */
async function clickRow(relative: string, mods: { meta?: boolean; shift?: boolean } = {}) {
  await waitForRow(relative);
  await wdio.execute(
    (testId, meta, shift) => {
      const row = [...document.querySelectorAll<HTMLElement>('[data-testid^="tree-item-"]')].find(
        (el) => el.getAttribute('data-testid') === testId
      );
      if (!row) throw new Error(`no row ${testId}`);
      row.scrollIntoView({ block: 'center' });
      row.dispatchEvent(
        new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: meta, shiftKey: shift })
      );
    },
    `tree-item-${abs(relative)}`,
    !!mods.meta,
    !!mods.shift
  );
}

async function isSelected(relative: string): Promise<boolean> {
  return (await (await $(rowSelector(relative))).getAttribute('data-selected')) === 'true';
}

/**
 * Press on one row, move in steps to another, release there. The release
 * point is hit-tested by WebKit (`elementFromPoint`), exactly as for a hand.
 * Returns what the target row showed while hovered.
 */
async function dragRow(fromRelative: string, toRelative: string): Promise<string | null> {
  await waitForRow(fromRelative);
  await waitForRow(toRelative);
  return await wdio.execute(
    async (fromId, toId) => {
      const find = (id: string) =>
        [...document.querySelectorAll<HTMLElement>('[data-testid^="tree-item-"]')].find(
          (el) => el.getAttribute('data-testid') === id
        );
      const from = find(fromId);
      const to = find(toId);
      if (!from || !to) throw new Error('drag rows missing');
      const a = from.getBoundingClientRect();
      const b = to.getBoundingClientRect();
      const start = { x: a.left + 30, y: a.top + a.height / 2 };
      const end = { x: b.left + 30, y: b.top + b.height / 2 };
      const opts = (x: number, y: number) => ({
        bubbles: true,
        cancelable: true,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: 1,
      });
      from.dispatchEvent(new MouseEvent('mousedown', opts(start.x, start.y)));
      for (let i = 1; i <= 5; i++) {
        const x = start.x + ((end.x - start.x) * i) / 5;
        const y = start.y + ((end.y - start.y) * i) / 5;
        window.dispatchEvent(new MouseEvent('mousemove', opts(x, y)));
      }
      // Let React commit the hover state before reading it.
      await new Promise((resolve) => setTimeout(resolve, 150));
      const shown = to.getAttribute('data-drop-target');
      const target = document.elementFromPoint(end.x, end.y) ?? to;
      target.dispatchEvent(new MouseEvent('mouseup', opts(end.x, end.y)));
      target.dispatchEvent(new MouseEvent('click', opts(end.x, end.y)));
      return shown;
    },
    `tree-item-${abs(fromRelative)}`,
    `tree-item-${abs(toRelative)}`
  );
}

async function rightClickRow(relative: string) {
  await waitForRow(relative);
  await wdio.execute(
    (testId) => {
      const row = [...document.querySelectorAll<HTMLElement>('[data-testid^="tree-item-"]')].find(
        (el) => el.getAttribute('data-testid') === testId
      );
      if (!row) throw new Error(`no row ${testId}`);
      const r = row.getBoundingClientRect();
      row.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          clientX: r.left + 30,
          clientY: r.top + r.height / 2,
          button: 2,
        })
      );
    },
    `tree-item-${abs(relative)}`
  );
}

async function clickMenuItem(label: string) {
  const item = await $(
    `//*[@role="menuitem"][contains(normalize-space(.), ${JSON.stringify(label)})]`
  );
  await item.waitForExist({ timeout: 10_000, timeoutMsg: `no menu item "${label}"` });
  await wdio.execute((el: HTMLElement) => el.click(), item as unknown as HTMLElement);
}

async function clickButton(label: string) {
  const button = await $(`//button[normalize-space(.)=${JSON.stringify(label)}]`);
  await button.waitForExist({ timeout: 10_000, timeoutMsg: `no button "${label}"` });
  await wdio.execute((el: HTMLElement) => el.click(), button as unknown as HTMLElement);
}

async function hasTab(path: string): Promise<boolean> {
  return await wdio.execute(
    (id) =>
      [...document.querySelectorAll('[data-testid^="tab-"]')].some(
        (el) => el.getAttribute('data-testid') === id
      ),
    `tab-${path}`
  );
}

async function screenshot(name: string) {
  if (!screenshotDir) return;
  mkdirSync(screenshotDir, { recursive: true });
  await wdio.saveScreenshot(join(screenshotDir, `${name}.png`));
}

async function captureFailure(name: string) {
  await screenshot(`failed-${name}`);
  const text = await wdio.execute(() => document.body.innerText.slice(0, 6000));
  if (screenshotDir) writeFileSync(join(screenshotDir, `failed-${name}.txt`), text);
}

/** Registers the folder as a recent project and opens it from the start screen. */
async function openProject(path: string) {
  await tauriBrowser.tauri.execute(async (tauri, p) => {
    await tauri.core.invoke('recent_projects_add', { path: p });
  }, path);
  await wdio.refresh();
  const recentTab = await $(`//button[contains(normalize-space(.), "Recent")]`);
  await recentTab.waitForExist({ timeout: 30_000 });
  await recentTab.click();
  const open = await $(`[aria-label="Open ${basename(path)}"]`);
  await open.waitForExist({ timeout: 30_000 });
  await open.click();
  await waitForRow('inbox', 30_000);
}

/** Expands a collapsed folder row by clicking it. */
async function expand(relative: string, child: string) {
  if (await (await $(rowSelector(child))).isExisting()) return;
  await clickRow(relative);
  await waitForRow(child);
}

/** Replays the drag-drop events Tauri raises for a Finder drop at a row's position. */
async function finderDrop(paths: string[], ontoRelative: string) {
  await waitForRow(ontoRelative);
  await wdio.execute(
    async (testId, dropped) => {
      const row = [...document.querySelectorAll<HTMLElement>('[data-testid^="tree-item-"]')].find(
        (el) => el.getAttribute('data-testid') === testId
      );
      if (!row) throw new Error(`no row ${testId}`);
      const r = row.getBoundingClientRect();
      const scale = window.devicePixelRatio || 1;
      // Tauri reports physical pixels.
      const position = { x: (r.left + 30) * scale, y: (r.top + r.height / 2) * scale };
      const tauri = (
        window as unknown as {
          __TAURI__: {
            event: {
              emitTo(target: unknown, event: string, payload: unknown): Promise<void>;
            };
          };
        }
      ).__TAURI__;
      const target = { kind: 'Webview', label: 'main' };
      await tauri.event.emitTo(target, 'tauri://drag-enter', { paths: dropped, position });
      await tauri.event.emitTo(target, 'tauri://drag-over', { position });
      await tauri.event.emitTo(target, 'tauri://drag-drop', { paths: dropped, position });
    },
    `tree-item-${abs(ontoRelative)}`,
    paths
  );
}

const describeNative = projectPath ? describe : (_: string, __: () => void) => undefined;

describeNative('explorer drag-and-drop, multi-selection and compare in the native app', () => {
  before(async () => {
    assert.ok(projectPath);
    createProject();
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

  it('Cmd+click builds a selection, and dragging it moves both files with their open tab', async () => {
    await expand('inbox', 'inbox/one.md');
    await clickRow('inbox/one.md');
    await wdio.waitUntil(async () => await hasTab(abs('inbox/one.md')), {
      timeoutMsg: 'clicking one.md did not open its tab',
    });
    await clickRow('inbox/two.md', { meta: true });
    await wdio.waitUntil(
      async () => (await isSelected('inbox/one.md')) && (await isSelected('inbox/two.md')),
      {
        timeoutMsg: 'Cmd+click did not add two.md to the selection',
      }
    );
    await screenshot('01-cmd-click-selection');

    const shown = await dragRow('inbox/one.md', 'archive');
    assert.equal(shown, 'valid', `archive must light up as a valid drop target, showed ${shown}`);

    await waitForDisk(
      () => existsSync(abs('archive/one.md')) && existsSync(abs('archive/two.md')),
      'one.md and two.md never arrived in archive/'
    );
    assert.ok(!existsSync(abs('inbox/one.md')) && !existsSync(abs('inbox/two.md')));
    await wdio.waitUntil(async () => await hasTab(abs('archive/one.md')), {
      timeoutMsg: 'the open tab did not follow one.md to archive/',
    });
    assert.equal(await hasTab(abs('inbox/one.md')), false, 'no tab is left on the old path');
    await screenshot('02-moved-into-archive');
  });

  it('refuses to move a folder into its own subfolder', async () => {
    await expand('docs', 'docs/sub');
    const shown = await dragRow('docs', 'docs/sub');
    assert.equal(shown, 'invalid', `docs/sub must be marked invalid, showed ${shown}`);
    await wdio.execute(() => new Promise((resolve) => setTimeout(resolve, 500)));
    assert.ok(existsSync(abs('docs/sub')), 'docs is untouched');
    assert.ok(!existsSync(abs('docs/sub/docs')), 'nothing moved into docs/sub');
  });

  it('asks on a name clash: Cancel leaves both, Keep Both numbers the moved file', async () => {
    await expand('inbox', 'inbox/clash.md');
    await clickRow('inbox/clash.md');
    await dragRow('inbox/clash.md', 'docs');
    await waitForText('Replace "clash.md"?');
    await screenshot('03-clash-question');
    await clickButton('Cancel');
    await wdio.execute(() => new Promise((resolve) => setTimeout(resolve, 500)));
    assert.equal(read('docs/clash.md'), 'the one already in docs\n');
    assert.equal(read('inbox/clash.md'), 'the one being moved\n');

    await dragRow('inbox/clash.md', 'docs');
    await waitForText('Replace "clash.md"?');
    await clickButton('Keep Both');
    await waitForDisk(() => existsSync(abs('docs/clash 2.md')), 'docs/clash 2.md never appeared');
    assert.equal(read('docs/clash.md'), 'the one already in docs\n', 'the existing file is kept');
    assert.equal(read('docs/clash 2.md'), 'the one being moved\n');
    assert.ok(!existsSync(abs('inbox/clash.md')));
  });

  it('Shift+click selects a range that one confirmation deletes', async () => {
    await clickRow('trash1.md');
    await clickRow('trash2.md', { shift: true });
    await wdio.waitUntil(
      async () => (await isSelected('trash1.md')) && (await isSelected('trash2.md')),
      {
        timeoutMsg: 'Shift+click did not select the range',
      }
    );
    await rightClickRow('trash2.md');
    await clickMenuItem('Delete 2 Items');
    await waitForText('Delete these items?');
    await clickButton('Delete');
    await waitForDisk(
      () => !existsSync(abs('trash1.md')) && !existsSync(abs('trash2.md')),
      'the two files were not deleted'
    );
    await waitForNoRow('trash1.md');
  });

  it('compares two selected files in the diff viewer', async () => {
    await clickRow('left.txt');
    await clickRow('right.txt', { meta: true });
    await rightClickRow('right.txt');
    await screenshot('04-compare-menu');
    await clickMenuItem('Compare Selected');
    await (
      await $('[data-testid="diff-viewer"]')
    ).waitForExist({
      timeout: 15_000,
      timeoutMsg: 'the diff viewer never opened',
    });
    await waitForText('beta from the left');
    await waitForText('gamma from the right');
    await waitForText('left.txt');
    await waitForText('right.txt');
    await screenshot('05-compare-diff');
  });

  it('copies a file dropped from Finder into the folder under the pointer', async () => {
    const source = join(outside(), 'report.txt');
    await finderDrop([source], 'archive');
    await waitForDisk(
      () => existsSync(abs('archive/report.txt')),
      'the Finder drop copied nothing'
    );
    assert.equal(read('archive/report.txt'), 'dropped from Finder\n');
    assert.ok(existsSync(source), 'a Finder drop copies, the original stays');
  });
});
