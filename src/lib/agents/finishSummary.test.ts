import { describe, expect, it } from 'vitest';
import { deriveFinishSummary, FINISH_SUMMARY_MAX_CHARS } from './finishSummary';

describe('deriveFinishSummary', () => {
  it('says nothing when the tail is empty or only noise', () => {
    expect(deriveFinishSummary([])).toBeNull();
    expect(deriveFinishSummary(['', '  ', '\n'])).toBeNull();
    expect(deriveFinishSummary(['────────\n', 'esc to interrupt\n'])).toBeNull();
  });

  it('takes the last words the agent said', () => {
    expect(deriveFinishSummary(['Working…\n', 'Deployed auric-website to production.\n'])).toBe(
      'Deployed auric-website to production.'
    );
  });

  it('strips ANSI so the inbox does not render garbage glyphs', () => {
    expect(deriveFinishSummary(['\x1b[32mWrote draft.md\x1b[0m\n'])).toBe('Wrote draft.md');
  });

  it('drops tool-call chrome a headless TUI still prints', () => {
    const summary = deriveFinishSummary([
      '⏺ Read(src/app/page.tsx)\n',
      '⏺ Bash(pnpm build)\n',
      'Built the production bundle. Ready to ship.\n',
    ]);
    expect(summary).toBe('Built the production bundle. Ready to ship.');
    expect(summary).not.toContain('Read(');
  });

  it('keeps a few last sentences rather than only the final line', () => {
    const summary = deriveFinishSummary([
      'Checked the deploy logs.\n',
      'Pushed the current main to production.\n',
      'The site is live at auric-ide.tech.\n',
    ]);
    expect(summary).toContain('Pushed the current main to production.');
    expect(summary).toContain('The site is live at auric-ide.tech.');
  });

  it('fits the inbox body — two short lines, not a transcript', () => {
    const long = Array.from({ length: 40 }, (_, i) => `Step ${i} finished successfully.\n`);
    const summary = deriveFinishSummary(long);
    expect(summary).not.toBeNull();
    expect(summary!.length).toBeLessThanOrEqual(FINISH_SUMMARY_MAX_CHARS + 1);
    expect(summary).toContain('Step 39');
    expect(summary).not.toContain('Step 0');
  });

  it('clips a single long last line rather than overflowing the inbox', () => {
    const summary = deriveFinishSummary([`Done. ${'x'.repeat(400)}\n`]);
    expect(summary).not.toBeNull();
    expect(summary!.length).toBeLessThanOrEqual(FINISH_SUMMARY_MAX_CHARS + 1);
    expect(summary).toContain('…');
  });
});
