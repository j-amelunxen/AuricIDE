const PREFIX = 'mindmap::';

/** The tab that shows a Markdown file as a mindmap; its `path` stays the file's. */
export function mindmapTabId(filePath: string): string {
  return `${PREFIX}${filePath}`;
}

export function isMindmapTabId(id: string): boolean {
  return id.startsWith(PREFIX);
}

/** The Markdown file a mindmap tab draws. */
export function mindmapFilePath(id: string): string {
  return id.slice(PREFIX.length);
}
