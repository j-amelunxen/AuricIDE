/**
 * Reads a mission's shared memory (`missions/<slug>/shared/`, the folder the
 * mission-to-goals skill writes) into what the goal view shows: the phase of
 * each sub-goal from its state file, the questions still waiting for a person,
 * and the independent reviews with their rating and approval.
 *
 * The files are written by agents and people by hand, so the reader assumes
 * they can be wrong. A file it cannot make sense of becomes a named entry in
 * `problems` and the rest is still read: a broken state file must look
 * broken, not like a sub-goal that does not exist.
 */
import { readDirectory, readFile } from '@/lib/tauri/fs';
import { GOAL_REVIEW_VERDICTS, type GoalReviewDecision } from '@/lib/goals/goalReviewDecision';

export const MISSION_PHASES = [
  'nicht begonnen',
  'läuft',
  'blockiert',
  'wartet auf Mensch',
  'erreicht',
] as const;

export type MissionPhase = (typeof MISSION_PHASES)[number];

export interface SubGoalState {
  /** `<NN>-<slug>`, from the frontmatter, else the file name. */
  goal: string;
  number: string;
  /** `null` when the file names a phase outside `MISSION_PHASES`. */
  phase: MissionPhase | null;
  rawPhase: string;
  updated: string | null;
  updatedBy: string | null;
  nextStep: string | null;
  blockers: string[];
  file: string;
}

export interface OpenQuestion {
  file: string;
  goal: string | null;
  author: string | null;
  date: string | null;
  title: string;
}

export interface ReviewRating {
  label: string;
  score: number;
  max: number;
}

export interface ReviewAttempt {
  file: string;
  attempt: number;
  date: string | null;
  decision: GoalReviewDecision;
  reviewerVerdict: string | null;
  title: string;
  ratings: ReviewRating[];
}

export interface SubGoalReviews {
  goal: string;
  /** Oldest attempt first; one attempt number can appear in more than one file. */
  attempts: ReviewAttempt[];
  /**
   * The review that counts now: the one a valid approval names, else the
   * highest attempt. `null` when the goal has no readable review.
   */
  latest: ReviewAttempt | null;
  /** True only when an approval names an approving review of this goal that no later attempt overtook. */
  approved: boolean;
  approvalFile: string | null;
}

export interface MissionMemoryProblem {
  /** Relative to `shared/`, e.g. `state/02-ui.md`, or a folder like `state/`. */
  file: string;
  message: string;
}

export interface MissionMemory {
  subGoals: SubGoalState[];
  openQuestions: OpenQuestion[];
  reviews: SubGoalReviews[];
  problems: MissionMemoryProblem[];
}

export interface MissionMemoryFile {
  name: string;
  content: string;
}

export interface MissionMemoryInput {
  state: MissionMemoryFile[];
  notes: MissionMemoryFile[];
  reviews: MissionMemoryFile[];
}

/** The two fs calls the loader needs; the IDE passes the Tauri wrappers. */
export interface MissionFs {
  readDirectory(path: string): Promise<{ name: string; path: string; isDirectory: boolean }[]>;
  readFile(path: string): Promise<string>;
}

const tauriFs: MissionFs = { readDirectory, readFile };

type Section = 'state' | 'notes' | 'reviews';
const SECTIONS: Section[] = ['state', 'notes', 'reviews'];
const QUESTION_STATUSES: readonly string[] = ['open', 'resolved'];
/** The note kinds of shared/README.md; any other kind is a typo that would hide a note. */
const NOTE_KINDS: readonly string[] = [
  'finding',
  'decision',
  'question',
  'answer',
  'assumption-check',
  'handoff',
];

export async function loadMissionMemory(
  missionPath: string,
  fs: MissionFs = tauriFs
): Promise<MissionMemory> {
  const shared = `${missionPath.replace(/\/+$/, '')}/shared`;
  let folders: Set<string>;
  try {
    const entries = await fs.readDirectory(shared);
    folders = new Set(entries.filter((e) => e.isDirectory).map((e) => e.name));
  } catch (err) {
    return {
      ...emptyMemory(),
      problems: [
        { file: 'shared/', message: `No shared/ folder in ${missionPath}: ${errorText(err)}` },
      ],
    };
  }

  const problems: MissionMemoryProblem[] = [];
  const input: MissionMemoryInput = { state: [], notes: [], reviews: [] };
  for (const section of SECTIONS) {
    // Every mission has state files; notes and reviews appear only once written.
    // Absence is decided from the shared/ listing, so a folder that is there but
    // cannot be read is reported rather than taken for an empty one.
    if (!folders.has(section)) {
      if (section === 'state') problems.push({ file: 'state/', message: 'No state/ folder.' });
      continue;
    }
    let entries: Awaited<ReturnType<MissionFs['readDirectory']>>;
    try {
      entries = await fs.readDirectory(`${shared}/${section}`);
    } catch (err) {
      problems.push({ file: `${section}/`, message: `Cannot read ${section}/: ${errorText(err)}` });
      continue;
    }
    for (const entry of entries) {
      if (entry.isDirectory || !isMarkdown(entry.name)) continue;
      try {
        input[section].push({ name: entry.name, content: await fs.readFile(entry.path) });
      } catch (err) {
        problems.push({
          file: `${section}/${entry.name}`,
          message: `Cannot read file: ${errorText(err)}`,
        });
      }
    }
  }

  const memory = parseMissionMemory(input);
  return { ...memory, problems: sortProblems([...problems, ...memory.problems]) };
}

export function parseMissionMemory(input: MissionMemoryInput): MissionMemory {
  const problems: MissionMemoryProblem[] = [];
  const subGoals = parseStates(input.state, problems);
  const openQuestions = parseQuestions(input.notes, problems);
  const reviews = parseReviews(input.reviews, problems);
  return { subGoals, openQuestions, reviews, problems: sortProblems(problems) };
}

function emptyMemory(): MissionMemory {
  return { subGoals: [], openQuestions: [], reviews: [], problems: [] };
}

// --- state ---------------------------------------------------------------

function parseStates(files: MissionMemoryFile[], problems: MissionMemoryProblem[]) {
  const out: SubGoalState[] = [];
  for (const { name, file, fields, body } of parsedMarkdown(files, 'state', problems)) {
    const goal = text(fields.goal) ?? name.replace(/\.md$/i, '');
    // The mission-wide summary is not a sub-goal.
    if (goal.startsWith('00-')) continue;
    const rawPhase = text(fields.phase);
    if (rawPhase === null) {
      problems.push({ file, message: 'Frontmatter has no phase.' });
      continue;
    }
    const phase = MISSION_PHASES.find((p) => p === rawPhase) ?? null;
    if (phase === null) {
      problems.push({
        file,
        message: `Unknown phase "${rawPhase}"; expected one of: ${MISSION_PHASES.join(', ')}.`,
      });
    }
    out.push({
      goal,
      number: goal.match(/^(\d+)/)?.[1] ?? '',
      phase,
      rawPhase,
      updated: text(fields.updated),
      updatedBy: text(fields.updated_by),
      nextStep: sectionText(body, 'Nächster Schritt'),
      blockers: sectionBullets(body, 'Blocker').filter((b) => !/^nichts\b/i.test(b)),
      file,
    });
  }
  return out.sort((a, b) => a.goal.localeCompare(b.goal));
}

// --- notes ---------------------------------------------------------------

function parseQuestions(files: MissionMemoryFile[], problems: MissionMemoryProblem[]) {
  const questions: (OpenQuestion & { name: string; status: string | null })[] = [];
  const answers: { file: string; answers: string }[] = [];
  const noteNames = new Set<string>();

  for (const { name, file, fields, body } of parsedMarkdown(files, 'notes', problems)) {
    noteNames.add(name);
    const kind = text(fields.kind);
    if (kind === null) {
      problems.push({ file, message: 'Frontmatter has no kind.' });
      continue;
    }
    if (!NOTE_KINDS.includes(kind)) {
      problems.push({
        file,
        message: `Unknown kind "${kind}"; expected one of: ${NOTE_KINDS.join(', ')}.`,
      });
      continue;
    }
    if (kind === 'question') {
      questions.push({
        name,
        file,
        goal: text(fields.goal),
        author: text(fields.author),
        date: text(fields.date),
        title: heading(body) ?? name,
        status: text(fields.status),
      });
    } else if (kind === 'answer') {
      const target = text(fields.answers);
      if (target === null) problems.push({ file, message: 'Answer note has no answers: field.' });
      else answers.push({ file, answers: target });
    }
  }

  const answered = new Set<string>();
  for (const a of answers) {
    if (noteNames.has(a.answers)) answered.add(a.answers);
    else problems.push({ file: a.file, message: `Answers ${a.answers}, which does not exist.` });
  }

  for (const q of questions) {
    // status is required on every question, answered or not (shared/README.md).
    if (q.status === null) {
      problems.push({ file: q.file, message: 'Question has no status: (open or resolved).' });
    } else if (q.status !== null && !QUESTION_STATUSES.includes(q.status)) {
      // A typo must not make an open question disappear from the view.
      problems.push({
        file: q.file,
        message: `Unknown status "${q.status}"; expected open or resolved.`,
      });
    }
  }

  return questions
    .filter((q) => q.status === 'open' && !answered.has(q.name))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ file, goal, author, date, title }) => ({ file, goal, author, date, title }));
}

// --- reviews -------------------------------------------------------------

function parseReviews(files: MissionMemoryFile[], problems: MissionMemoryProblem[]) {
  const byGoal = new Map<string, SubGoalReviews>();
  const entry = (goal: string) => {
    let r = byGoal.get(goal);
    if (!r) {
      r = { goal, attempts: [], latest: null, approved: false, approvalFile: null };
      byGoal.set(goal, r);
    }
    return r;
  };
  const approvals: { file: string; goal: string; review: string | null }[] = [];

  for (const { file, fields, body } of parsedMarkdown(files, 'reviews', problems)) {
    const kind = text(fields.kind);
    const goal = text(fields.goal);
    if (kind === null || goal === null) {
      problems.push({ file, message: `Frontmatter has no ${kind === null ? 'kind' : 'goal'}.` });
      continue;
    }
    if (kind === 'review-approval') {
      approvals.push({ file, goal, review: text(fields.review) });
      continue;
    }
    if (kind !== 'review') {
      problems.push({ file, message: `Unknown kind "${kind}" in reviews/.` });
      continue;
    }
    const rawDecision = text(fields.decision);
    const attempt = Number(text(fields.attempt));
    if (rawDecision === null) {
      problems.push({ file, message: 'Review has no decision.' });
      continue;
    }
    const decision = GOAL_REVIEW_VERDICTS.find((d) => d === rawDecision);
    if (decision === undefined) {
      problems.push({
        file,
        message: `Unknown decision "${rawDecision}"; expected approve, rework or escalate.`,
      });
      continue;
    }
    if (!Number.isInteger(attempt) || attempt < 1) {
      problems.push({ file, message: 'Review has no valid attempt number.' });
      continue;
    }
    entry(goal).attempts.push({
      file,
      attempt,
      date: text(fields.date),
      decision,
      reviewerVerdict: text(fields.reviewer_verdict),
      title: heading(body) ?? file,
      ratings: ratings(body),
    });
  }

  const out = [...byGoal.values()].sort((a, b) => a.goal.localeCompare(b.goal));
  for (const r of out) {
    r.attempts.sort((a, b) => a.attempt - b.attempt || a.file.localeCompare(b.file));
    r.latest = r.attempts.at(-1) ?? null;
  }
  for (const approval of approvals) applyApproval(approval, byGoal, problems);
  for (const r of out) reportUndecidedDuplicates(r, problems);
  return out;
}

/**
 * An approval counts only when it names a review that exists, belongs to its
 * goal, approved, and is not overtaken by a later attempt: decide.py removes the
 * approval on a later rejection, so one that outlived it is stale.
 */
function applyApproval(
  approval: { file: string; goal: string; review: string | null },
  byGoal: Map<string, SubGoalReviews>,
  problems: MissionMemoryProblem[]
) {
  const fail = (message: string) => problems.push({ file: approval.file, message });
  if (approval.review === null) {
    fail('Approval names no review: file.');
    return;
  }
  const reviewFile = `reviews/${approval.review}`;
  const named = [...byGoal.values()]
    .flatMap((reviews) => reviews.attempts.map((attempt) => ({ reviews, attempt })))
    .find((x) => x.attempt.file === reviewFile);
  if (!named) {
    fail(`Approval points to ${approval.review}, which is not a readable review.`);
    return;
  }
  const r = named.reviews;
  if (r.goal !== approval.goal) {
    fail(`Approval for ${approval.goal} points to a review of ${r.goal}.`);
    return;
  }
  if (named.attempt.decision !== 'approve') {
    fail(`Approval points to ${approval.review}, which decided ${named.attempt.decision}.`);
    return;
  }
  const newest = Math.max(...r.attempts.map((a) => a.attempt));
  if (newest > named.attempt.attempt) {
    fail(`Approval is stale: attempt ${newest} came after ${approval.review}.`);
    return;
  }
  r.approved = true;
  r.approvalFile = approval.file;
  r.latest = named.attempt;
}

/** Two files claiming the newest attempt, with no approval saying which one counts. */
function reportUndecidedDuplicates(r: SubGoalReviews, problems: MissionMemoryProblem[]) {
  if (r.approved || r.latest === null) return;
  const newest = r.latest.attempt;
  const same = r.attempts.filter((a) => a.attempt === newest);
  if (same.length < 2) return;
  const [first, ...rest] = same;
  problems.push({
    file: first.file,
    message: `Attempt ${newest} is also in ${rest.map((a) => a.file.replace(/^reviews\//, '')).join(', ')}; no approval says which one counts.`,
  });
}

function ratings(body: string): ReviewRating[] {
  const out: ReviewRating[] = [];
  for (const line of sectionLines(body, 'Rating')) {
    const m = line.match(/^\|\s*([^|]+?)\s*\|\s*(\d+)\s*\/\s*(\d+)\s*\|/);
    if (m) out.push({ label: m[1], score: Number(m[2]), max: Number(m[3]) });
  }
  return out;
}

// --- Markdown + frontmatter ----------------------------------------------

interface ParsedFile {
  name: string;
  file: string;
  fields: Record<string, string>;
  body: string;
}

function parsedMarkdown(
  files: MissionMemoryFile[],
  section: Section,
  problems: MissionMemoryProblem[]
): ParsedFile[] {
  const out: ParsedFile[] = [];
  for (const { name, content } of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    if (!isMarkdown(name)) continue;
    const file = `${section}/${name}`;
    const parsed = splitFrontmatter(content.normalize('NFC'));
    if ('error' in parsed) {
      problems.push({ file, message: parsed.error });
      continue;
    }
    out.push({ name, file, ...parsed });
  }
  return out;
}

/**
 * The memory files use flat `key: value` frontmatter, written by hand and by
 * agents. It is read line by line rather than as YAML: evidence lines such as
 * `ran at 00:06:47 -> then: planned` are what people write, and a strict YAML
 * parser rejects every one of them for the second colon.
 */
function splitFrontmatter(
  content: string
): { fields: Record<string, string>; body: string } | { error: string } {
  const lines = content.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return { error: 'No frontmatter (---) at the top of the file.' };
  const end = lines.findIndex((l, i) => i > 0 && l.trim() === '---');
  if (end === -1) return { error: 'Frontmatter is never closed with ---.' };
  const fields: Record<string, string> = {};
  for (let i = 1; i < end; i++) {
    const line = lines[i];
    if (line.trim() === '' || line.trim().startsWith('#')) continue;
    const m = line.match(/^([A-Za-z_][\w-]*):(?:\s+(.*))?$/);
    if (!m) return { error: `Frontmatter line ${i + 1} is not "key: value": ${line.trim()}` };
    fields[m[1]] = unquote((m[2] ?? '').replace(/\s+#.*$/, '').trim());
  }
  return { fields, body: lines.slice(end + 1).join('\n') };
}

function unquote(value: string): string {
  const m = value.match(/^(["'])(.*)\1$/);
  return m ? m[2] : value;
}

function text(value: string | undefined): string | null {
  return value === undefined || value === '' ? null : value;
}

function heading(body: string): string | null {
  return body.match(/^#\s+(.+?)\s*$/m)?.[1] ?? null;
}

/** Lines under the `## <title...>` heading, up to the next heading. */
function sectionLines(body: string, titleStart: string): string[] {
  const lines = body.split('\n');
  const start = lines.findIndex((l) => /^##\s/.test(l) && l.slice(2).trim().startsWith(titleStart));
  if (start === -1) return [];
  const rest = lines.slice(start + 1);
  const next = rest.findIndex((l) => /^#{1,2}\s/.test(l));
  return (next === -1 ? rest : rest.slice(0, next)).map((l) => l.trim());
}

function sectionText(body: string, titleStart: string): string | null {
  const joined = sectionLines(body, titleStart).join('\n').trim();
  return joined === '' ? null : joined;
}

function sectionBullets(body: string, titleStart: string): string[] {
  return sectionLines(body, titleStart)
    .filter((l) => /^[-*]\s+/.test(l))
    .map((l) => l.replace(/^[-*]\s+/, '').trim())
    .filter((l) => l !== '');
}

function isMarkdown(name: string): boolean {
  return /\.md$/i.test(name) && !name.startsWith('.');
}

function sortProblems(problems: MissionMemoryProblem[]): MissionMemoryProblem[] {
  const rank = (file: string) => {
    const i = ['shared', ...SECTIONS].indexOf(file.split('/')[0]);
    return i === -1 ? SECTIONS.length + 1 : i;
  };
  return [...problems].sort((a, b) => rank(a.file) - rank(b.file) || a.file.localeCompare(b.file));
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
