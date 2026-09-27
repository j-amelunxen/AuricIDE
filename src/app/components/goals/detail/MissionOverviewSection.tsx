'use client';

import { useEffect, useId, useState } from 'react';
import {
  loadMissionMemory,
  type MissionFs,
  type MissionMemory,
  type MissionPhase,
  type SubGoalReviews,
  type SubGoalState,
} from '@/lib/missions/missionMemory';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

export interface MissionOverviewSectionProps {
  /** Absolute path of the mission folder (`<project>/missions/<slug>`). */
  missionPath: string;
  labelCls: string;
  /** Injected in tests; the IDE reads through the Tauri fs wrappers. */
  fs?: MissionFs;
}

const PHASE_LABELS: Record<MissionPhase, string> = {
  'nicht begonnen': 'Not started',
  läuft: 'Running',
  blockiert: 'Blocked',
  'wartet auf Mensch': 'Waiting for you',
  erreicht: 'Achieved',
};

const PHASE_STYLES: Record<MissionPhase, string> = {
  'nicht begonnen': 'bg-white/5 text-foreground-muted',
  läuft: 'bg-primary/15 text-primary-light',
  blockiert: 'bg-red-500/15 text-red-400',
  'wartet auf Mensch': 'bg-amber-500/15 text-amber-400',
  erreicht: 'bg-emerald-500/15 text-emerald-400',
};

function announce(memory: MissionMemory): string {
  const broken = memory.problems.length;
  const read = `${memory.subGoals.length} sub-goals, ${memory.openQuestions.length} open questions`;
  if (broken === 0) return `Mission read: ${read}.`;
  return `Mission read: ${read}. ${broken === 1 ? '1 file needs' : `${broken} files need`} fixing.`;
}

const chipCls = 'shrink-0 rounded px-1.5 py-0.5 text-[9px] font-medium';

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * What a mission's shared memory says right now: the phase of each sub-goal,
 * the questions waiting for a person and the independent reviews. Read from
 * the files, never stored: the files are the truth and agents rewrite them.
 * A file the reader could not use is listed by name, so a broken state file
 * looks broken rather than like a sub-goal that is missing.
 */
export function MissionOverviewSection({ missionPath, labelCls, fs }: MissionOverviewSectionProps) {
  const [version, setVersion] = useState(0);
  const [result, setResult] = useState<{ key: string; memory: MissionMemory } | null>(null);
  const key = `${missionPath}\n${version}`;

  useEffect(() => {
    let current = true;
    loadMissionMemory(missionPath, fs)
      .catch((err): MissionMemory => ({
        subGoals: [],
        openQuestions: [],
        reviews: [],
        problems: [{ file: 'shared/', message: `Could not read the mission: ${message(err)}` }],
      }))
      .then((memory) => {
        // A slower earlier read must not overwrite a newer one.
        if (current) setResult({ key, memory });
      });
    return () => {
      current = false;
    };
  }, [key, missionPath, fs]);

  const loading = result?.key !== key;
  const memory = result?.memory ?? null;
  const refresh = () => setVersion((v) => v + 1);
  const headingId = useId();

  const empty =
    memory !== null &&
    memory.subGoals.length === 0 &&
    memory.openQuestions.length === 0 &&
    memory.reviews.length === 0 &&
    memory.problems.length === 0;

  return (
    <section
      data-testid="mission-overview"
      aria-labelledby={headingId}
      aria-busy={loading}
      className="space-y-3"
    >
      {/* One polite announcement per read, so a refresh is heard, not only seen. */}
      <p role="status" className="sr-only">
        {loading ? 'Reading mission…' : memory ? announce(memory) : ''}
      </p>
      <div className="flex items-center gap-2">
        <h3 id={headingId} className={labelCls}>
          Mission
        </h3>
        <span
          data-testid="mission-path"
          className="min-w-0 truncate text-[9px] text-foreground-muted"
          title={missionPath}
        >
          {missionPath}
        </span>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          aria-label="Refresh mission"
          className="ml-auto flex items-center gap-1 rounded-lg bg-white/5 border border-white/10 px-2 py-0.5 text-[10px] text-foreground hover:bg-white/10 transition-colors disabled:opacity-40"
        >
          <AuricIcon name="refresh" className="text-xs" />
          Refresh
        </button>
      </div>

      {loading && (
        <p data-testid="mission-loading" className="text-[10px] text-foreground-muted">
          Reading mission…
        </p>
      )}

      {memory && memory.problems.length > 0 && (
        <div
          data-testid="mission-problems"
          className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2"
        >
          <p className="text-[10px] font-medium text-amber-400">
            {memory.problems.length === 1
              ? '1 file needs fixing'
              : `${memory.problems.length} files need fixing`}
          </p>
          <ul className="mt-1 space-y-0.5">
            {memory.problems.map((p) => (
              <li
                key={`${p.file}:${p.message}`}
                data-testid="mission-problem"
                className="text-[10px]"
              >
                <code className="text-foreground">{p.file}</code>{' '}
                <span className="text-foreground-muted">{p.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {empty && (
        <p data-testid="mission-empty" className="text-[10px] text-foreground-muted">
          No state files, questions or reviews yet.
        </p>
      )}

      {memory && memory.subGoals.length > 0 && (
        <section aria-label="Sub-goal phases">
          <h4 className={labelCls}>Phase per sub-goal</h4>
          <ul className="space-y-1.5">
            {memory.subGoals.map((s) => (
              <SubGoalRow key={s.file} subGoal={s} />
            ))}
          </ul>
        </section>
      )}

      {memory && !empty && (
        <section aria-label="Open questions">
          <h4 className={labelCls}>Open questions</h4>
          {memory.openQuestions.length === 0 ? (
            <p className="text-[10px] text-foreground-muted">No open questions.</p>
          ) : (
            <ul className="space-y-1">
              {memory.openQuestions.map((q) => (
                <li
                  key={q.file}
                  data-testid="mission-question"
                  className="rounded-lg bg-amber-500/5 px-2 py-1.5 text-[11px] text-foreground"
                >
                  <span className="block">{q.title}</span>
                  <span className="block text-[9px] text-foreground-muted">
                    {[q.goal, q.author, q.date].filter(Boolean).join(' · ')} · <code>{q.file}</code>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {memory && memory.reviews.length > 0 && (
        <section aria-label="Reviews">
          <h4 className={labelCls}>Reviews</h4>
          <ul className="space-y-1.5">
            {memory.reviews.map((r) => (
              <ReviewRow key={r.goal} review={r} />
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}

function SubGoalRow({ subGoal: s }: { subGoal: SubGoalState }) {
  return (
    <li data-testid="mission-subgoal" className="rounded-lg bg-white/5 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span
          data-testid="mission-subgoal-name"
          className="min-w-0 truncate text-[11px] text-foreground"
        >
          {s.goal}
        </span>
        <span
          data-testid="mission-phase"
          className={`${chipCls} ml-auto ${s.phase ? PHASE_STYLES[s.phase] : 'bg-amber-500/15 text-amber-400'}`}
        >
          {s.phase ? PHASE_LABELS[s.phase] : `Unknown: ${s.rawPhase}`}
        </span>
      </div>
      {s.nextStep && (
        <p className="mt-0.5 whitespace-pre-line text-[10px] text-foreground-muted">
          <span className="text-foreground/70">Next: </span>
          {s.nextStep}
        </p>
      )}
      {s.blockers.length > 0 && (
        <ul className="mt-0.5 space-y-0.5">
          {s.blockers.map((b) => (
            <li key={b} data-testid="mission-blocker" className="text-[10px] text-amber-400">
              {b}
            </li>
          ))}
        </ul>
      )}
      {s.updated && (
        <p className="mt-0.5 text-[9px] text-foreground-muted/70">
          Updated {s.updated}
          {s.updatedBy ? ` by ${s.updatedBy}` : ''}
        </p>
      )}
    </li>
  );
}

function ReviewRow({ review: r }: { review: SubGoalReviews }) {
  const latest = r.latest;
  return (
    <li data-testid="mission-review" className="rounded-lg bg-white/5 px-2 py-1.5">
      <div className="flex items-center gap-2">
        <span className="min-w-0 truncate text-[11px] text-foreground">{r.goal}</span>
        {latest && (
          <span
            data-testid="mission-review-decision"
            className={`${chipCls} ml-auto bg-white/5 text-foreground`}
          >
            {latest.decision}
          </span>
        )}
        {r.approved && (
          <span
            data-testid="mission-review-approved"
            className={`${chipCls} ${latest ? '' : 'ml-auto'} bg-emerald-500/15 text-emerald-400`}
          >
            Approved
          </span>
        )}
      </div>
      {latest && (
        <>
          <p className="mt-0.5 text-[9px] text-foreground-muted">
            Attempt {latest.attempt}
            {latest.date ? ` · ${latest.date}` : ''} · <code>{latest.file}</code>
          </p>
          {latest.ratings.length > 0 && (
            <ul data-testid="mission-review-rating" className="mt-0.5 flex flex-wrap gap-x-3">
              {latest.ratings.map((rating) => (
                <li key={rating.label} className="text-[10px] text-foreground-muted">
                  {rating.label}{' '}
                  <span className="text-foreground">
                    {rating.score}/{rating.max}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </li>
  );
}
