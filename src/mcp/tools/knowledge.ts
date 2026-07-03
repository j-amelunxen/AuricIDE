import { readdir, readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import type { FastMCP } from 'fastmcp';
import { z } from 'zod';

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.auric',
  '.next',
  'dist',
  'build',
  'target',
  'out',
]);

const MAX_SEARCH_HITS = 100;

export interface NoteHit {
  file: string;
  line: number;
  text: string;
}

function assertInsideRoot(projectRoot: string, filePath: string): string {
  const resolved = resolve(projectRoot, filePath);
  const root = resolve(projectRoot);
  if (!resolved.startsWith(root + sep) && resolved !== root) {
    throw new Error(`Path '${filePath}' is outside the project root`);
  }
  return resolved;
}

async function walkMarkdownFiles(root: string, dir = ''): Promise<string[]> {
  const entries = await readdir(join(root, dir), { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.')) continue;
      files.push(...(await walkMarkdownFiles(root, join(dir, entry.name))));
    } else if (entry.name.endsWith('.md')) {
      files.push(dir ? `${dir}/${entry.name}` : entry.name);
    }
  }
  return files;
}

/** Case-insensitive full-text search across all markdown notes in the project. */
export async function searchNotes(projectRoot: string, query: string): Promise<NoteHit[]> {
  const files = await walkMarkdownFiles(projectRoot);
  const needle = query.toLowerCase();
  const hits: NoteHit[] = [];
  for (const file of files) {
    const content = await readFile(join(projectRoot, file), 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (lines[i].toLowerCase().includes(needle)) {
        hits.push({ file: file.split(sep).join('/'), line: i + 1, text: lines[i].trim() });
        if (hits.length >= MAX_SEARCH_HITS) return hits;
      }
    }
  }
  return hits;
}

/** Reads a markdown note, sandboxed to the project root. */
export async function readNote(projectRoot: string, relPath: string): Promise<string> {
  const path = assertInsideRoot(projectRoot, relPath);
  return readFile(path, 'utf8');
}

function slugify(title: string): string {
  return (
    title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'finding'
  );
}

export interface FindingParams {
  title: string;
  content: string;
  agentId?: string;
  goalId?: string;
  /** Wiki link targets to connect this finding into the knowledge graph. */
  links?: string[];
}

/**
 * Writes an agent finding as a markdown note under findings/, with provenance
 * and wiki links so humans see it appear in the link graph. Never overwrites —
 * collisions get a numeric suffix.
 */
export async function writeFinding(
  projectRoot: string,
  params: FindingParams
): Promise<{ file: string }> {
  const dir = assertInsideRoot(projectRoot, 'findings');
  await mkdir(dir, { recursive: true });

  const base = slugify(params.title);
  let name = base;
  for (let counter = 2; ; counter++) {
    try {
      await access(join(dir, `${name}.md`));
      name = `${base}-${counter}`;
    } catch {
      break; // free slot
    }
  }

  const provenance = [
    `date: ${new Date().toISOString()}`,
    params.agentId ? `agent: ${params.agentId}` : null,
    params.goalId ? `goal: ${params.goalId}` : null,
  ]
    .filter(Boolean)
    .join('\n');

  const linksSection =
    params.links && params.links.length > 0
      ? `\n\n## Related\n${params.links.map((l) => `- [[${l}]]`).join('\n')}\n`
      : '\n';

  const body = `# ${params.title}\n\n<!--\n${provenance}\n-->\n\n${params.content}${linksSection}`;
  await writeFile(join(dir, `${name}.md`), body, 'utf8');
  return { file: `findings/${name}.md` };
}

/** Finds all notes containing a [[WikiLink]] to the given target. */
export async function getBacklinks(projectRoot: string, target: string): Promise<NoteHit[]> {
  const files = await walkMarkdownFiles(projectRoot);
  // Matches [[Target]], [[Target#Heading]], [[Target|Alias]]
  const escaped = target.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`\\[\\[${escaped}(?:#[^\\]|]*)?(?:\\|[^\\]]*)?\\]\\]`, 'i');
  const hits: NoteHit[] = [];
  for (const file of files) {
    const content = await readFile(join(projectRoot, file), 'utf8');
    const lines = content.split('\n');
    for (let i = 0; i < lines.length; i++) {
      if (pattern.test(lines[i])) {
        hits.push({ file: file.split(sep).join('/'), line: i + 1, text: lines[i].trim() });
      }
    }
  }
  return hits;
}

export function registerKnowledgeTools(server: FastMCP, projectRoot: string): void {
  server.addTool({
    name: 'search_notes',
    description:
      'Full-text search across all markdown notes in the project (the shared human+agent knowledge base). Returns file, line, and matching text.',
    parameters: z.object({
      query: z.string().describe('Case-insensitive text to search for'),
    }),
    execute: async ({ query }) => JSON.stringify(await searchNotes(projectRoot, query)),
  });

  server.addTool({
    name: 'read_note',
    description: 'Read a markdown note by project-relative path',
    parameters: z.object({
      path: z.string().describe('Project-relative path, e.g. "docs/architecture.md"'),
    }),
    execute: async ({ path }) => readNote(projectRoot, path),
  });

  server.addTool({
    name: 'write_finding',
    description:
      'Persist a finding as a markdown note under findings/ with provenance (agent, goal) and [[WikiLinks]] into the knowledge graph. Use this to leave knowledge for humans and future agents.',
    parameters: z.object({
      title: z.string().describe('Short finding title'),
      content: z.string().describe('Markdown body of the finding'),
      agentId: z.string().optional().describe('Your agent ID for provenance'),
      goalId: z.string().optional().describe('Goal this finding relates to'),
      links: z
        .array(z.string())
        .optional()
        .describe('Wiki link targets (note names) to cross-reference'),
    }),
    execute: async (params) => JSON.stringify(await writeFinding(projectRoot, params)),
  });

  server.addTool({
    name: 'get_backlinks',
    description:
      'Find all notes that wiki-link to a target note name (including [[Target#Heading]] and [[Target|Alias]] forms)',
    parameters: z.object({
      target: z.string().describe('The note name to find backlinks for'),
    }),
    execute: async ({ target }) => JSON.stringify(await getBacklinks(projectRoot, target)),
  });
}
