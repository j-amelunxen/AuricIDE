import { nextScratchName } from './naming';

export interface SaveTerminalScreenArgs {
  agentName: string;
  /** Text of the visible terminal. Whitespace alone is not a screen. */
  screen: string;
  now?: Date;
  resolveDir: () => Promise<string | null>;
  existingNames: () => string[];
  write: (path: string, content: string) => Promise<void>;
  refresh: () => Promise<void>;
}

export type SaveTerminalScreenResult =
  { ok: true; name: string; path: string } | { ok: false; reason: 'empty' | 'no-dir' };

function formatCaptureStamp(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  const month = pad(date.getMonth() + 1);
  const day = pad(date.getDate());
  return `${date.getFullYear()}-${month}-${day} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function scratchTitle(agentName: string): string {
  const clean = agentName
    .replace(/[\r\n#]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return clean || 'Agent';
}

/** One longer than the longest backtick run, so a fence inside the screen cannot close it. */
function fence(text: string): string {
  let longest = 0;
  let run = 0;
  for (const char of text) {
    if (char === '`') {
      run += 1;
      if (run > longest) longest = run;
    } else {
      run = 0;
    }
  }
  return '`'.repeat(Math.max(3, longest + 1));
}

export function terminalScratchMarkdown(
  agentName: string,
  screen: string,
  capturedAt: Date
): string {
  const ticks = fence(screen);
  return [
    `# ${scratchTitle(agentName)}`,
    '',
    `Visible terminal, ${formatCaptureStamp(capturedAt)}.`,
    '',
    `${ticks}text`,
    screen,
    ticks,
    '',
  ].join('\n');
}

export async function saveTerminalScreen(
  args: SaveTerminalScreenArgs
): Promise<SaveTerminalScreenResult> {
  if (args.screen.trim().length === 0) return { ok: false, reason: 'empty' };
  const dir = await args.resolveDir();
  if (!dir) return { ok: false, reason: 'no-dir' };
  const name = nextScratchName(args.existingNames());
  const path = `${dir.replace(/\/+$/, '')}/${name}`;
  const body = terminalScratchMarkdown(args.agentName, args.screen, args.now ?? new Date());
  await args.write(path, body);
  await args.refresh();
  return { ok: true, name, path };
}
