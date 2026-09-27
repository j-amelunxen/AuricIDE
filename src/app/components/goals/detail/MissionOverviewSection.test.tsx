import path from 'node:path';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { diskMissionFs, MISSION_FIXTURES } from '@/lib/missions/missionFs.testing';
import type { MissionFs } from '@/lib/missions/missionMemory';
import { MissionOverviewSection } from './MissionOverviewSection';

function renderMission(name: string, fs: MissionFs = diskMissionFs) {
  return render(
    <MissionOverviewSection
      missionPath={path.join(MISSION_FIXTURES, name)}
      labelCls="label"
      fs={fs}
    />
  );
}

async function loaded() {
  await waitFor(() => expect(screen.queryByTestId('mission-loading')).toBeNull());
}

describe('MissionOverviewSection — a healthy mission', () => {
  it('shows the phase of every sub-goal, with next step and blockers', async () => {
    renderMission('mission-sample');
    await loaded();
    const rows = screen.getAllByTestId('mission-subgoal');
    expect(rows.map((r) => within(r).getByTestId('mission-subgoal-name').textContent)).toEqual([
      '01-daten-schicht',
      '02-oberflaeche',
      '03-freigabe',
    ]);
    expect(rows.map((r) => within(r).getByTestId('mission-phase').textContent)).toEqual([
      'Achieved',
      'Running',
      'Waiting for you',
    ]);
    expect(rows[1]).toHaveTextContent('Station 2: Liste rendern');
    expect(
      within(rows[1])
        .getAllByTestId('mission-blocker')
        .map((b) => b.textContent)
    ).toEqual(['Farbwahl, siehe notes/2026-01-10-02-frage-farben.md', 'Review von 01']);
    expect(within(rows[0]).queryAllByTestId('mission-blocker')).toHaveLength(0);
  });

  it('lists only the open question, with its sub-goal and file', async () => {
    renderMission('mission-sample');
    await loaded();
    const questions = screen.getAllByTestId('mission-question');
    expect(questions).toHaveLength(1);
    expect(questions[0]).toHaveTextContent('Welche Farbe bekommt der Status "blockiert"?');
    expect(questions[0]).toHaveTextContent('02-oberflaeche');
    expect(questions[0]).toHaveTextContent('notes/2026-01-10-02-frage-farben.md');
  });

  it('shows the latest review with its rating and the approval', async () => {
    renderMission('mission-sample');
    await loaded();
    const [review] = screen.getAllByTestId('mission-review');
    expect(review).toHaveTextContent('01-daten-schicht');
    expect(within(review).getByTestId('mission-review-decision')).toHaveTextContent('approve');
    expect(within(review).getByTestId('mission-review-approved')).toHaveTextContent('Approved');
    expect(review).toHaveTextContent('Attempt 2');
    expect(review).not.toHaveTextContent(/Attempt 2 of/);
    expect(within(review).getByTestId('mission-review-rating')).toHaveTextContent(
      'Erfolgskriterien erfüllt 5/5'
    );
    expect(within(review).getByTestId('mission-review-rating')).toHaveTextContent(
      'Sinnvoll gelöst 4/5'
    );
  });

  it('shows no problem list when nothing is broken', async () => {
    renderMission('mission-sample');
    await loaded();
    expect(screen.queryByTestId('mission-problems')).toBeNull();
  });
});

describe('MissionOverviewSection — a goal reviewed more than once', () => {
  it('shows the review the approval names, by its attempt number alone', async () => {
    renderMission('mission-retried');
    await loaded();
    const [review] = screen.getAllByTestId('mission-review');
    expect(within(review).getByTestId('mission-review-decision')).toHaveTextContent('approve');
    expect(within(review).getByTestId('mission-review-approved')).toBeInTheDocument();
    expect(review).toHaveTextContent('Attempt 5');
    expect(review).toHaveTextContent('09-x-2026-01-12-r5.md');
    // Three files are not three attempts: no count derived from files.
    expect(review).not.toHaveTextContent(/Attempt 5 of/);
    expect(screen.queryByTestId('mission-problems')).toBeNull();
  });
});

describe('MissionOverviewSection — an approval that does not hold', () => {
  it('shows no approval for a goal whose approval points at a rework review', async () => {
    renderMission('mission-broken');
    await loaded();
    const reviews = screen.getAllByTestId('mission-review');
    expect(reviews).toHaveLength(2);
    expect(reviews[0]).toHaveTextContent('05-v');
    expect(within(reviews[0]).getByTestId('mission-review-decision')).toHaveTextContent('rework');
    expect(screen.queryByTestId('mission-review-approved')).toBeNull();
  });
});

describe('MissionOverviewSection — broken and empty missions', () => {
  it('names every broken file next to what could still be read', async () => {
    renderMission('mission-broken');
    await loaded();
    const problems = within(screen.getByTestId('mission-problems')).getAllByTestId(
      'mission-problem'
    );
    expect(problems).toHaveLength(16);
    expect(problems[0]).toHaveTextContent('state/01-ohne-frontmatter.md');
    expect(screen.getByTestId('mission-problems')).toHaveTextContent('16 files need fixing');
    // A typo in a question's status or an invented review decision is shown as
    // broken, never as a missing question or as a review result.
    const typo = problems.find((p) => p.textContent?.includes('2026-01-05-01-frage-tippfehler'));
    expect(typo).toHaveTextContent('opne');
    const invented = problems.find((p) => p.textContent?.includes('01-x-2026-01-02-r2.md'));
    expect(invented).toHaveTextContent('vielleicht');
    expect(
      screen.queryByText('vielleicht', { selector: '[data-testid="mission-review-decision"]' })
    ).toBeNull();
    expect(screen.getAllByTestId('mission-subgoal')).toHaveLength(2);
    expect(screen.getAllByTestId('mission-question')).toHaveLength(1);
  });

  it('marks an unknown phase as unknown and says what the file wrote', async () => {
    renderMission('mission-broken');
    await loaded();
    const [unknown] = screen.getAllByTestId('mission-subgoal');
    expect(within(unknown).getByTestId('mission-phase')).toHaveTextContent('Unknown: fast fertig');
  });

  it('says an empty mission is empty instead of showing blank lists', async () => {
    renderMission('mission-empty');
    await loaded();
    expect(screen.getByTestId('mission-empty')).toHaveTextContent(
      'No state files, questions or reviews yet'
    );
    expect(screen.queryByTestId('mission-subgoal')).toBeNull();
    expect(screen.queryByTestId('mission-problems')).toBeNull();
  });

  it('reports a mission path without a shared/ folder', async () => {
    renderMission('does-not-exist');
    await loaded();
    expect(screen.getByTestId('mission-problems')).toHaveTextContent('shared/');
    expect(screen.queryByTestId('mission-empty')).toBeNull();
  });

  it('turns an unexpected loader failure into a visible problem, not a blank panel', async () => {
    const fs: MissionFs = {
      readDirectory: () => Promise.reject(new Error('ipc down')),
      readFile: () => Promise.reject(new Error('ipc down')),
    };
    renderMission('mission-sample', fs);
    await loaded();
    expect(screen.getByTestId('mission-problems')).toHaveTextContent('ipc down');
  });
});

describe('MissionOverviewSection — refresh', () => {
  it('re-reads the mission when Refresh is pressed', async () => {
    const readDirectory = vi.fn(diskMissionFs.readDirectory);
    renderMission('mission-sample', { ...diskMissionFs, readDirectory });
    await loaded();
    const before = readDirectory.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: /refresh mission/i }));
    await waitFor(() => expect(readDirectory.mock.calls.length).toBeGreaterThan(before));
    await loaded();
    expect(screen.getAllByTestId('mission-subgoal')).toHaveLength(3);
  });

  it('shows the mission path it reads from', async () => {
    renderMission('mission-sample');
    await loaded();
    expect(screen.getByTestId('mission-path')).toHaveTextContent('mission-sample');
  });
});
