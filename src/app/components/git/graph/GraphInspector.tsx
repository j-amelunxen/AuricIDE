import { useEffect, useRef, useState } from 'react';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { useStore } from '@/lib/store';
import { graphDetailKey } from '@/lib/store/gitGraphSlice';
import type { GitRef, GraphCommit } from '@/lib/tauri/gitGraph';
import type { GitNameStatus } from '@/lib/tauri/git';
import { absoluteDate } from './graphDates';
import { SHORT_OID_LENGTH } from './graphCopy';
import { RefPill } from './RefPill';
import type { Point } from './GraphRowItem';

const STATUS: Record<GitNameStatus['status'], { letter: string; label: string; tone: string }> = {
  added: { letter: 'A', label: 'Added', tone: 'text-git-added' },
  modified: { letter: 'M', label: 'Modified', tone: 'text-git-modified' },
  deleted: { letter: 'D', label: 'Deleted', tone: 'text-git-deleted' },
};

const ICON_BUTTON =
  'flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-foreground-muted transition-[background-color,color,transform] duration-100 ease-out hover:bg-white/10 hover:text-foreground active:scale-[0.96] motion-reduce:transition-none motion-reduce:active:scale-100';
const SECTION_TITLE = 'text-[11px] font-semibold uppercase tracking-wider text-foreground-muted';

export interface GraphInspectorProps {
  repoPath: string;
  commit: GraphCommit;
  refs: GitRef[];
  /** The commit's lane colour, which tints its ref pills as in the list. */
  laneColor: string;
  parentSummary: (oid: string) => string | undefined;
  onSelectParent: (oid: string) => void;
  onFileClick: (path: string, parentIndex: number) => void;
  onCopySha: (oid: string) => void;
  onOpenMenu: (point: Point) => void;
  onRefMenu: (ref: GitRef, point: Point) => void;
}

const centreBelow = (el: HTMLElement): Point => {
  const box = el.getBoundingClientRect();
  return { x: box.left, y: box.bottom + 4 };
};

function Person({
  role,
  name,
  email,
  time,
}: {
  role: string;
  name: string;
  email: string;
  time: number;
}) {
  return (
    <p className="text-[11px] leading-5 text-foreground-muted">
      <span className="text-foreground">{role}</span> {name} &lt;{email}&gt;
      <br />
      <span className="tabular-nums">{absoluteDate(time)}</span>
    </p>
  );
}

const PARENT_LABELS = ['First Parent', 'Second Parent'];
const parentLabel = (index: number) => PARENT_LABELS[index] ?? `Parent ${index + 1}`;

function ParentPicker({
  count,
  value,
  onChange,
}: {
  count: number;
  value: number;
  onChange: (i: number) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Compare with" className="flex rounded-md bg-white/5 p-0.5">
      {Array.from({ length: count }, (_, i) => (
        <label
          key={i}
          className={`flex-1 cursor-default rounded px-2 py-1 text-center text-[11px] transition-[background-color,color] duration-100 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-primary motion-reduce:transition-none ${
            i === value
              ? 'bg-foreground/20 font-semibold text-foreground shadow-sm'
              : 'font-medium text-foreground-muted hover:text-foreground'
          }`}
        >
          <input
            type="radio"
            name="graph-parent"
            className="sr-only"
            checked={i === value}
            onChange={() => onChange(i)}
            aria-label={parentLabel(i)}
          />
          {parentLabel(i)}
        </label>
      ))}
    </div>
  );
}

function FileRow({ file, onClick }: { file: GitNameStatus; onClick: () => void }) {
  const status = STATUS[file.status];
  const slash = file.path.lastIndexOf('/');
  const dir = slash === -1 ? '' : file.path.slice(0, slash + 1);
  const base = file.path.slice(slash + 1);
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        title={file.path}
        className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors duration-100 hover:bg-white/5 motion-reduce:transition-none"
      >
        <span
          aria-hidden="true"
          className={`w-3 shrink-0 text-center font-mono font-semibold ${status.tone}`}
        >
          {status.letter}
        </span>
        <span className="sr-only">{status.label}</span>
        <span className="min-w-0 flex-1 truncate font-mono">
          <span className="text-foreground-muted">{dir}</span>
          <span className="text-foreground">{base}</span>
        </span>
      </button>
    </li>
  );
}

export function GraphInspector(props: GraphInspectorProps) {
  const { repoPath, commit } = props;
  const [parentIndex, setParentIndex] = useState(0);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const menuButton = useRef<HTMLButtonElement>(null);
  const detail = useStore(
    (s) => s.graphs[repoPath]?.details[graphDetailKey(commit.oid, parentIndex)]
  );
  const loadGraphDetail = useStore((s) => s.loadGraphDetail);

  const detailKey = graphDetailKey(commit.oid, parentIndex);
  const failed = failedKey === detailKey;

  useEffect(() => {
    let current = true;
    void loadGraphDetail(repoPath, commit.oid, parentIndex).then((loaded) => {
      if (current && !loaded) setFailedKey(graphDetailKey(commit.oid, parentIndex));
    });
    return () => {
      current = false;
    };
  }, [loadGraphDetail, repoPath, commit.oid, parentIndex, attempt]);

  const message = detail?.message ?? commit.summary;
  const [title, ...rest] = message.split('\n');
  const body = rest.join('\n').trim();
  const committerDiffers =
    detail &&
    (detail.committerName !== detail.authorName || detail.committerEmail !== detail.authorEmail);

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold leading-snug text-foreground [text-wrap:balance]">
          {title}
        </h2>
        {body && (
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-foreground-muted">
            {body}
          </p>
        )}
      </div>

      <div className="flex items-start gap-1">
        <code
          title={commit.oid}
          className="min-w-0 flex-1 select-text font-mono text-[11px] leading-7 text-foreground-muted"
        >
          {commit.oid.slice(0, SHORT_OID_LENGTH)}
        </code>
        <button
          type="button"
          aria-label="Copy SHA"
          title="Copy SHA"
          className={ICON_BUTTON}
          onClick={() => props.onCopySha(commit.oid)}
        >
          <AuricIcon name="content_copy" aria-hidden="true" className="text-sm" />
        </button>
        <button
          ref={menuButton}
          type="button"
          aria-label="More actions"
          aria-haspopup="menu"
          title="More actions"
          className={ICON_BUTTON}
          onClick={() => menuButton.current && props.onOpenMenu(centreBelow(menuButton.current))}
        >
          <AuricIcon name="more_horiz" aria-hidden="true" className="text-sm" />
        </button>
      </div>

      {props.refs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {props.refs.map((ref) => (
            <button
              key={ref.name}
              type="button"
              aria-label={`Actions for ${ref.shorthand}`}
              aria-haspopup="menu"
              className="rounded-full transition-transform duration-100 active:scale-[0.96] motion-reduce:transition-none"
              onClick={(e) => props.onRefMenu(ref, centreBelow(e.currentTarget))}
            >
              <RefPill gitRef={ref} color={props.laneColor} />
            </button>
          ))}
        </div>
      )}

      {detail ? (
        <div className="flex flex-col gap-1">
          <Person
            role="Author"
            name={detail.authorName}
            email={detail.authorEmail}
            time={detail.authorTime}
          />
          {committerDiffers && (
            <Person
              role="Committer"
              name={detail.committerName}
              email={detail.committerEmail}
              time={detail.committerTime}
            />
          )}
        </div>
      ) : (
        !failed && <p className="text-[11px] text-foreground-muted">Loading…</p>
      )}

      {commit.parents.length > 0 && (
        <section className="flex flex-col gap-1">
          <h3 className={SECTION_TITLE}>{commit.parents.length > 1 ? 'Parents' : 'Parent'}</h3>
          {commit.parents.map((oid) => (
            <button
              key={oid}
              type="button"
              aria-label={`Parent ${oid.slice(0, SHORT_OID_LENGTH)}: ${props.parentSummary(oid) ?? ''}`}
              onClick={() => props.onSelectParent(oid)}
              className="flex items-baseline gap-2 rounded-md px-2 py-1 text-left text-[11px] transition-colors duration-100 hover:bg-white/5 motion-reduce:transition-none"
            >
              <span className="font-mono text-foreground">{oid.slice(0, SHORT_OID_LENGTH)}</span>
              <span className="min-w-0 flex-1 truncate text-foreground-muted">
                {props.parentSummary(oid)}
              </span>
            </button>
          ))}
        </section>
      )}

      {failed && (
        <div className="flex items-center gap-2">
          <p role="alert" className="text-[11px] text-red-300">
            Could not read this commit.
          </p>
          <button
            type="button"
            className="rounded-md px-2 py-1 text-[11px] font-medium text-primary-light hover:bg-primary/15"
            onClick={() => setAttempt((n) => n + 1)}
          >
            Try Again
          </button>
        </div>
      )}

      {detail && (
        <section className="flex flex-col gap-2">
          <h3 className={SECTION_TITLE}>Changed Files ({detail.files.length})</h3>
          {commit.parents.length > 1 && (
            <ParentPicker
              count={commit.parents.length}
              value={parentIndex}
              onChange={setParentIndex}
            />
          )}
          <ul aria-label="Changed files" className="-mx-2 flex flex-col">
            {detail.files.map((file) => (
              <FileRow
                key={file.path}
                file={file}
                onClick={() => props.onFileClick(file.path, parentIndex)}
              />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
