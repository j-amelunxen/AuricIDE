const MARKDOWN_EXTENSION = /\.(md|markdown)$/i;

/** Whether a file is Markdown by its name: `.md` or `.markdown`, any case. */
export function isMarkdownPath(path: string): boolean {
  return MARKDOWN_EXTENSION.test(path);
}

/** The name without its Markdown extension; other names unchanged. */
export function stripMarkdownExtension(name: string): string {
  return name.replace(MARKDOWN_EXTENSION, '');
}
