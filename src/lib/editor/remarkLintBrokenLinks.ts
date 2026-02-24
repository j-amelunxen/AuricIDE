import { lintRule } from 'unified-lint-rule';
import { visit } from 'unist-util-visit';
import type { Root, Link, Image } from 'mdast';

export interface BrokenLinksOptions {
  fileList: string[];
  headingIndex: Map<string, string[]>;
  currentFilePath: string;
}

function isExternalUrl(url: string): boolean {
  return /^https?:\/\//.test(url) || /^mailto:/.test(url) || /^#/.test(url);
}

function resolveLocalPath(url: string, currentFilePath: string, fileList: string[]): string | null {
  // Strip anchor
  const [pathPart] = url.split('#');
  if (!pathPart) return null;

  // Remove leading ./
  const cleaned = pathPart.replace(/^\.\//, '');

  // Resolve relative to current file directory
  const currentDir = currentFilePath.substring(0, currentFilePath.lastIndexOf('/'));
  const resolved = `${currentDir}/${cleaned}`;

  // Check if any file matches the resolved path
  const found = fileList.find((f) => f === resolved || f.endsWith('/' + cleaned));
  return found ?? null;
}

export const remarkLintBrokenLinks = lintRule<Root, BrokenLinksOptions>(
  {
    origin: 'remark-lint:broken-links',
    url: 'https://github.com/auricIDE/broken-links',
  },
  (tree, file, options) => {
    if (!options) return;

    const { fileList, headingIndex, currentFilePath } = options;

    visit(tree, (node) => {
      if (node.type !== 'link' && node.type !== 'image') return;

      const url = (node as Link | Image).url;
      if (!url || isExternalUrl(url)) return;

      const [pathPart, anchor] = url.split('#');

      // If there's only an anchor (e.g., #section), skip
      if (!pathPart) return;

      const resolvedPath = resolveLocalPath(url, currentFilePath, fileList);

      if (!resolvedPath) {
        const cleaned = pathPart.replace(/^\.\//, '');
        file.message(`Broken link: "${cleaned}" not found`, node);
        return;
      }

      // Check heading anchor if present
      if (anchor) {
        const headings = headingIndex.get(resolvedPath) ?? [];
        const normalizedAnchor = anchor.toLowerCase();
        const found = headings.some((h) => h.toLowerCase() === normalizedAnchor);
        if (!found) {
          file.message(
            `Broken anchor: "#${anchor}" not found in "${pathPart.replace(/^\.\//, '')}"`,
            node
          );
        }
      }
    });
  }
);
