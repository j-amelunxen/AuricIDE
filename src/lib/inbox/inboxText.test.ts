import { describe, expect, it } from 'vitest';
import {
  PASTED_DOCUMENT_MIN_LENGTH,
  fileNameForPastedText,
  looksLikePastedDocument,
  titleForPastedText,
} from './inboxText';

describe('looksLikePastedDocument', () => {
  it('leaves a short one-liner as a title', () => {
    expect(looksLikePastedDocument('Call the tax office')).toBe(false);
  });

  it('keeps a two-line paste a title but files three lines away', () => {
    expect(looksLikePastedDocument('Call the tax office\nabout the invoice')).toBe(false);
    expect(looksLikePastedDocument('Line one\nLine two\nLine three')).toBe(true);
  });

  it('treats a long single line as a document', () => {
    expect(looksLikePastedDocument('x'.repeat(PASTED_DOCUMENT_MIN_LENGTH + 1))).toBe(true);
  });

  it('ignores trailing whitespace when measuring', () => {
    expect(looksLikePastedDocument(`Short note${' '.repeat(400)}`)).toBe(false);
  });

  it('is never a document when there is nothing to attach', () => {
    expect(looksLikePastedDocument('   \n \n ')).toBe(false);
  });
});

describe('titleForPastedText', () => {
  it('uses the subject line of a pasted email', () => {
    const mail = [
      'From: someone@example.com',
      'To: me@example.com',
      'Subject: Invoice 2024-118 is overdue',
      'Date: Mon, 3 Feb 2026 09:12:00 +0100',
      '',
      'Hi there, ...',
    ].join('\n');
    expect(titleForPastedText(mail)).toBe('Invoice 2024-118 is overdue');
  });

  it('understands a German header too', () => {
    const mail = [
      'Von: jemand@example.com',
      'Betreff: Angebot Dachsanierung',
      '',
      'Hallo, ...',
    ].join('\n');
    expect(titleForPastedText(mail)).toBe('Angebot Dachsanierung');
  });

  it('ignores a subject line that only appears deep inside the body', () => {
    const body = `${Array.from({ length: 60 }, (_, i) => `line ${i}`).join('\n')}\nSubject: not a header`;
    expect(titleForPastedText(body)).toBe('line 0');
  });

  it('falls back to the first meaningful line', () => {
    expect(titleForPastedText('\n\n  Rework the onboarding copy\nand ship it\n')).toBe(
      'Rework the onboarding copy'
    );
  });

  it('strips markdown heading markers', () => {
    expect(titleForPastedText('## Release checklist\n\n- one\n- two')).toBe('Release checklist');
  });

  it('shortens a very long first line at a word boundary', () => {
    const long = `${'word '.repeat(60)}end`;
    const title = titleForPastedText(long);
    expect(title.length).toBeLessThanOrEqual(121);
    expect(title.endsWith('…')).toBe(true);
    expect(title).not.toContain('  ');
  });

  it('never returns an empty title', () => {
    expect(titleForPastedText('   \n\n  ')).toBe('Pasted note');
  });
});

describe('fileNameForPastedText', () => {
  it('slugs the derived title into a markdown file name', () => {
    expect(fileNameForPastedText('Subject: Invoice 2024-118 is overdue\n\nbody')).toBe(
      'invoice-2024-118-is-overdue.md'
    );
  });

  it('collapses punctuation and diacritics into single dashes', () => {
    expect(fileNameForPastedText('Angebot: Dachsanierung — Größe?\n\nbody')).toBe(
      'angebot-dachsanierung-grosse.md'
    );
  });

  it('caps the length so the stored name stays sane', () => {
    const name = fileNameForPastedText(`${'segment '.repeat(40)}\n\nbody`);
    expect(name.length).toBeLessThanOrEqual(63);
    expect(name.endsWith('.md')).toBe(true);
    expect(name.startsWith('-')).toBe(false);
    expect(name.replace(/\.md$/, '').endsWith('-')).toBe(false);
  });

  it('falls back to a generic name when nothing survives slugging', () => {
    expect(fileNameForPastedText('!!! ???\n\n...')).toBe('note.md');
  });
});
