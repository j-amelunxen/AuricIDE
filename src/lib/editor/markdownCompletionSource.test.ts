import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { CompletionContext } from '@codemirror/autocomplete';
import {
  codeFenceLanguageSource,
  headingLevelSource,
  linkTargetSource,
  imageTargetSource,
  filePathsFacet,
} from './markdownCompletionSource';

function createCtx(doc: string, pos?: number, filePaths: string[] = []) {
  const state = EditorState.create({
    doc,
    extensions: [markdown({ base: markdownLanguage }), filePathsFacet.of(filePaths)],
    selection: { anchor: pos ?? doc.length },
  });
  return new CompletionContext(state, pos ?? doc.length, false);
}

describe('codeFenceLanguageSource', () => {
  it('returns languages on info-string line', () => {
    const doc = '```';
    const result = codeFenceLanguageSource(createCtx(doc));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain('javascript');
    expect(labels).toContain('typescript');
    expect(labels).toContain('python');
    expect(labels).toContain('rust');
    expect(labels).toContain('mermaid');
  });

  it('filters by partial typed language', () => {
    const doc = '```py';
    const result = codeFenceLanguageSource(createCtx(doc));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain('python');
  });

  it('returns null on a non-fence line', () => {
    const doc = 'just text';
    const result = codeFenceLanguageSource(createCtx(doc));
    expect(result).toBeNull();
  });

  it('returns null inside an existing code block', () => {
    const doc = '```js\nsome code\n```';
    const pos = doc.indexOf('some');
    const result = codeFenceLanguageSource(createCtx(doc, pos));
    expect(result).toBeNull();
  });
});

describe('headingLevelSource', () => {
  it('returns heading levels after # at line start', () => {
    const doc = '#';
    const result = headingLevelSource(createCtx(doc));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain('# ');
    expect(labels).toContain('###### ');
  });

  it('returns null for # mid-line', () => {
    const doc = 'text #';
    const result = headingLevelSource(createCtx(doc));
    expect(result).toBeNull();
  });

  it('filters by typed hashes', () => {
    const doc = '###';
    const result = headingLevelSource(createCtx(doc));
    expect(result).not.toBeNull();
    // Should include ### and higher (more hashes)
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain('### ');
    expect(labels).toContain('#### ');
    expect(labels).not.toContain('# ');
  });
});

describe('linkTargetSource', () => {
  it('returns paths after [', () => {
    const files = ['README.md', 'src/index.ts', 'docs/guide.md'];
    const doc = 'See [';
    const result = linkTargetSource(createCtx(doc, doc.length, files));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain('README.md');
    expect(labels).toContain('src/index.ts');
    expect(labels).toContain('docs/guide.md');
  });

  it('does not trigger after ![', () => {
    const files = ['image.png'];
    const doc = '![';
    const result = linkTargetSource(createCtx(doc, doc.length, files));
    expect(result).toBeNull();
  });

  it('returns null when no [ is present', () => {
    const files = ['file.md'];
    const doc = 'just text';
    const result = linkTargetSource(createCtx(doc, doc.length, files));
    expect(result).toBeNull();
  });

  it('filters by partial typed text', () => {
    const files = ['README.md', 'src/index.ts'];
    const doc = '[READ';
    const result = linkTargetSource(createCtx(doc, doc.length, files));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain('README.md');
    expect(labels).not.toContain('src/index.ts');
  });
});

describe('imageTargetSource', () => {
  it('returns image files after ![', () => {
    const files = ['photo.png', 'logo.svg', 'README.md', 'assets/banner.jpg', 'script.ts'];
    const doc = '![alt](';
    const result = imageTargetSource(createCtx(doc, doc.length, files));
    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label);
    expect(labels).toContain('photo.png');
    expect(labels).toContain('logo.svg');
    expect(labels).toContain('assets/banner.jpg');
    // Non-image files should be excluded
    expect(labels).not.toContain('README.md');
    expect(labels).not.toContain('script.ts');
  });

  it('returns null without ![ prefix', () => {
    const files = ['photo.png'];
    const doc = 'text(';
    const result = imageTargetSource(createCtx(doc, doc.length, files));
    expect(result).toBeNull();
  });
});
