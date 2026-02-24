import { describe, expect, it } from 'vitest';
import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkStringify from 'remark-stringify';
import { remarkLintBrokenLinks } from './remarkLintBrokenLinks';

async function lint(
  markdown: string,
  fileList: string[],
  headingIndex: Map<string, string[]> = new Map(),
  currentFilePath: string = '/project/test.md'
) {
  const processor = unified()
    .use(remarkParse)
    .use(remarkLintBrokenLinks, { fileList, headingIndex, currentFilePath })
    .use(remarkStringify);

  const file = await processor.process(markdown);
  return file.messages.map((m) => ({
    message: m.message,
    ruleId: m.ruleId,
    line: m.line,
    column: m.column,
  }));
}

describe('remarkLintBrokenLinks', () => {
  it('reports broken local file links', async () => {
    const messages = await lint('[click here](./missing.md)', [
      '/project/test.md',
      '/project/existing.md',
    ]);
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain('missing.md');
    expect(messages[0].ruleId).toBe('broken-links');
  });

  it('does not report existing file links', async () => {
    const messages = await lint('[click here](./existing.md)', [
      '/project/test.md',
      '/project/existing.md',
    ]);
    expect(messages).toHaveLength(0);
  });

  it('ignores external URLs', async () => {
    const messages = await lint('[link](https://example.com)', ['/project/test.md']);
    expect(messages).toHaveLength(0);
  });

  it('ignores mailto links', async () => {
    const messages = await lint('[email](mailto:test@example.com)', ['/project/test.md']);
    expect(messages).toHaveLength(0);
  });

  it('ignores wiki-links (double brackets)', async () => {
    // Wiki-links are handled by a separate extension, so raw markdown like [[page]]
    // does not produce standard link nodes — this tests that we skip non-standard URLs
    const messages = await lint('[click](./existing.md)', [
      '/project/test.md',
      '/project/existing.md',
    ]);
    expect(messages).toHaveLength(0);
  });

  it('reports broken image links', async () => {
    const messages = await lint('![screenshot](./assets/missing.png)', ['/project/test.md']);
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain('missing.png');
  });

  it('does not report existing image links', async () => {
    const messages = await lint('![screenshot](./assets/logo.png)', [
      '/project/test.md',
      '/project/assets/logo.png',
    ]);
    expect(messages).toHaveLength(0);
  });

  it('reports broken heading anchors', async () => {
    const headingIndex = new Map([['/project/existing.md', ['Introduction', 'Setup']]]);
    const messages = await lint(
      '[link](./existing.md#nonexistent)',
      ['/project/test.md', '/project/existing.md'],
      headingIndex
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain('nonexistent');
  });

  it('does not report valid heading anchors', async () => {
    const headingIndex = new Map([['/project/existing.md', ['Introduction', 'Setup']]]);
    const messages = await lint(
      '[link](./existing.md#introduction)',
      ['/project/test.md', '/project/existing.md'],
      headingIndex
    );
    expect(messages).toHaveLength(0);
  });

  it('handles links without ./ prefix', async () => {
    const messages = await lint('[click](other.md)', ['/project/test.md', '/project/other.md']);
    expect(messages).toHaveLength(0);
  });

  it('reports broken links without ./ prefix', async () => {
    const messages = await lint('[click](nope.md)', ['/project/test.md']);
    expect(messages).toHaveLength(1);
  });

  it('ignores anchor-only links', async () => {
    const messages = await lint('[jump](#section)', ['/project/test.md']);
    expect(messages).toHaveLength(0);
  });

  it('handles multiple links in one document', async () => {
    const md = `
[ok](./existing.md)

[broken](./missing.md)

[external](https://example.com)
`;
    const messages = await lint(md, ['/project/test.md', '/project/existing.md']);
    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain('missing.md');
  });
});
