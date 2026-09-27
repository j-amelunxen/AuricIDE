import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { diskMissionFs, MISSION_FIXTURES } from './missionFs.testing';
import {
  loadMissionMemory,
  parseMissionMemory,
  type MissionFs,
  type MissionMemory,
} from './missionMemory';

/** A `shared/` listing that holds exactly these section folders. */
function sections(dir: string, names: string[]) {
  return names.map((name) => ({ name, path: `${dir}/${name}`, isDirectory: true }));
}

function load(name: string): Promise<MissionMemory> {
  return loadMissionMemory(path.join(MISSION_FIXTURES, name), diskMissionFs);
}

describe('loadMissionMemory — a healthy mission', () => {
  it('reports one phase per sub-goal from the state files, mission summary left out', async () => {
    const memory = await load('mission-sample');
    expect(memory.subGoals.map((s) => [s.goal, s.phase])).toEqual([
      ['01-daten-schicht', 'erreicht'],
      ['02-oberflaeche', 'läuft'],
      ['03-freigabe', 'wartet auf Mensch'],
    ]);
    expect(memory.problems).toEqual([]);
  });

  it('carries the next step and the blockers a person needs to act on', async () => {
    const memory = await load('mission-sample');
    const ui = memory.subGoals.find((s) => s.goal === '02-oberflaeche');
    expect(ui).toMatchObject({
      number: '02',
      updated: '2026-01-11 11:30',
      updatedBy: 'agent 02 (Sitzung 2)',
      nextStep:
        'Station 2: Liste rendern, Test in `src/ui/list.test.tsx` zuerst.\nDanach Station 3.',
      blockers: ['Farbwahl, siehe notes/2026-01-10-02-frage-farben.md', 'Review von 01'],
      file: 'state/02-oberflaeche.md',
    });
  });

  it('treats a "nichts" blocker line as no blocker', async () => {
    const memory = await load('mission-sample');
    expect(memory.subGoals.find((s) => s.goal === '01-daten-schicht')?.blockers).toEqual([]);
  });

  it('lists only questions nobody has answered or resolved', async () => {
    const memory = await load('mission-sample');
    expect(memory.openQuestions).toEqual([
      {
        file: 'notes/2026-01-10-02-frage-farben.md',
        goal: '02-oberflaeche',
        author: 'agent 02',
        date: '2026-01-10',
        title: 'Welche Farbe bekommt der Status "blockiert"?',
      },
    ]);
  });

  it('groups reviews per sub-goal, oldest attempt first, with the rating and the approval', async () => {
    const memory = await load('mission-sample');
    expect(memory.reviews).toHaveLength(1);
    const [data] = memory.reviews;
    expect(data.goal).toBe('01-daten-schicht');
    expect(data.approved).toBe(true);
    expect(data.approvalFile).toBe('reviews/01-daten-schicht-approved.md');
    expect(data.attempts.map((a) => [a.attempt, a.decision, a.reviewerVerdict])).toEqual([
      [1, 'rework', 'rework'],
      [2, 'approve', 'approve'],
    ]);
    expect(data.attempts[1]).toMatchObject({
      file: 'reviews/01-daten-schicht-2026-01-11-r2.md',
      date: '2026-01-11',
      title: 'Review 01-daten-schicht, Versuch 2: approve',
      ratings: [
        { label: 'Erfolgskriterien erfüllt', score: 5, max: 5 },
        { label: 'Löst das Problem fachlich', score: 5, max: 5 },
        { label: 'Sinnvoll gelöst', score: 4, max: 5 },
        { label: 'Scope und Regeln eingehalten', score: 5, max: 5 },
      ],
    });
  });
});

describe('loadMissionMemory — a mission written in English', () => {
  it('reads English phases and headings as well as the German ones', async () => {
    const memory = await load('mission-english');
    expect(memory.problems).toEqual([]);
    expect(memory.subGoals.map((s) => [s.goal, s.phase])).toEqual([
      ['01-data-layer', 'erreicht'],
      ['02-interface', 'wartet auf Mensch'],
      ['03-release', 'läuft'],
      ['04-rollout', 'nicht begonnen'],
      ['05-support', 'blockiert'],
    ]);
    const ui = memory.subGoals[1];
    expect(ui.nextStep).toBe('Render the list once the colour is decided.');
    expect(ui.blockers).toEqual(['Colour choice, see notes/2026-01-11-02-question-colour.md']);
    // "nothing" under Blockers is the English "nichts": no blocker.
    expect(memory.subGoals[0].blockers).toEqual([]);
    expect(memory.openQuestions.map((q) => q.title)).toEqual([
      'Which colour marks a blocked sub-goal?',
    ]);
    expect(memory.reviews[0]).toMatchObject({ approved: true, latest: { decision: 'approve' } });
    expect(memory.reviews[0].latest?.ratings.map((r) => r.label)).toEqual([
      'Success criteria met',
      'Solves the problem',
      'Solved sensibly',
      'Scope and rules respected',
    ]);
  });

  it('names both spellings when a phase is unknown', () => {
    const memory = parseMissionMemory({
      state: [{ name: '01-a.md', content: '---\ngoal: 01-a\nphase: almost there\n---\n' }],
      notes: [],
      reviews: [],
    });
    expect(memory.problems[0].message).toMatch(/läuft/);
    expect(memory.problems[0].message).toMatch(/in progress/);
  });
});

describe('loadMissionMemory — broken files are reported, never swallowed', () => {
  it('names every broken file and why, and still reads the good ones', async () => {
    const memory = await load('mission-broken');
    expect(memory.subGoals.map((s) => s.goal)).toEqual(['03-unbekannte-phase', '04-gut']);
    expect(memory.problems.map((p) => p.file)).toEqual([
      'state/01-ohne-frontmatter.md',
      'state/02-kaputte-zeile.md',
      'state/03-unbekannte-phase.md',
      'state/05-ohne-ende.md',
      'notes/2026-01-01-01-frage-ohne-kind.md',
      'notes/2026-01-02-01-antwort-ins-leere.md',
      'notes/2026-01-04-01-frage-ohne-status.md',
      'notes/2026-01-05-01-frage-tippfehler-status.md',
      'notes/2026-01-06-01-kind-tippfehler.md',
      'notes/2026-01-07-01-frage-beantwortet-ohne-status.md',
      'notes/2026-01-09-01-frage-doppelter-status.md',
      'reviews/01-x-2026-01-01-r1.md',
      'reviews/01-x-2026-01-02-r2.md',
      'reviews/02-y-approved.md',
      'reviews/03-z-approved.md',
      'reviews/05-v-approved.md',
      'reviews/06-u-approved.md',
      'reviews/08-s-2026-01-01-r1.md',
    ]);
    const why = Object.fromEntries(memory.problems.map((p) => [p.file, p.message]));
    expect(why['state/01-ohne-frontmatter.md']).toMatch(/frontmatter/i);
    expect(why['state/02-kaputte-zeile.md']).toMatch(/line 4/);
    expect(why['state/03-unbekannte-phase.md']).toMatch(/fast fertig/);
    expect(why['state/05-ohne-ende.md']).toMatch(/frontmatter/i);
    expect(why['notes/2026-01-01-01-frage-ohne-kind.md']).toMatch(/kind/);
    expect(why['notes/2026-01-02-01-antwort-ins-leere.md']).toMatch(
      /2026-01-01-01-gibt-es-nicht\.md/
    );
    expect(why['notes/2026-01-04-01-frage-ohne-status.md']).toMatch(/status/);
    expect(why['reviews/01-x-2026-01-01-r1.md']).toMatch(/decision/);
    expect(why['notes/2026-01-05-01-frage-tippfehler-status.md']).toMatch(/opne/);
    expect(why['notes/2026-01-05-01-frage-tippfehler-status.md']).toMatch(/open or resolved/);
    expect(why['reviews/01-x-2026-01-02-r2.md']).toMatch(/vielleicht/);
    expect(why['reviews/01-x-2026-01-02-r2.md']).toMatch(/approve, rework or escalate/);
    expect(why['notes/2026-01-06-01-kind-tippfehler.md']).toMatch(/qustion/);
    expect(why['notes/2026-01-07-01-frage-beantwortet-ohne-status.md']).toMatch(/status/);
    expect(why['reviews/02-y-approved.md']).toMatch(/review:/);
    expect(why['reviews/03-z-approved.md']).toMatch(/03-z-2026-01-01-r9\.md/);
    expect(why['reviews/05-v-approved.md']).toMatch(/rework/);
    expect(why['reviews/06-u-approved.md']).toMatch(/review of 07-t/);
    // A key written twice is ambiguous: neither value may win quietly.
    expect(why['notes/2026-01-09-01-frage-doppelter-status.md']).toMatch(
      /line 6 repeats the key "status"/
    );
    expect(why['reviews/08-s-2026-01-01-r1.md']).toMatch(/line 7 repeats the key "decision"/);
  });

  it('counts an approval only when it names an approving review of its own goal', async () => {
    const memory = await load('mission-broken');
    expect(memory.reviews.filter((r) => r.approved)).toEqual([]);
    // The invalid approvals do not invent review rows either.
    expect(memory.reviews.map((r) => r.goal)).toEqual(['05-v', '07-t']);
    expect(memory.reviews[0]).toMatchObject({ approvalFile: null, latest: { decision: 'rework' } });
    // 07-t's own review approved, but no approval of 07-t exists; 06-u's does not count for it.
    expect(memory.reviews[1]).toMatchObject({ approved: false, latest: { decision: 'approve' } });
  });

  it('never shows a review whose decision is not one the rule can give', async () => {
    const memory = await load('mission-broken');
    const decisions = memory.reviews.flatMap((r) => r.attempts.map((a) => a.decision));
    expect(decisions).not.toContain('vielleicht');
    expect(memory.reviews.find((r) => r.goal === '01-x')).toBeUndefined();
  });

  it('keeps a sub-goal with an unknown phase visible, phase marked unknown', async () => {
    const memory = await load('mission-broken');
    expect(memory.subGoals[0]).toMatchObject({
      goal: '03-unbekannte-phase',
      phase: null,
      rawPhase: 'fast fertig',
    });
  });

  it('still lists the open question next to the broken notes', async () => {
    const memory = await load('mission-broken');
    expect(memory.openQuestions.map((q) => q.title)).toEqual(['Echte offene Frage']);
  });
});

describe('loadMissionMemory — empty and missing missions', () => {
  it('reads an empty mission as empty, not as broken', async () => {
    const memory = await load('mission-empty');
    expect(memory).toEqual({ subGoals: [], openQuestions: [], reviews: [], problems: [] });
  });

  it('says so when the mission folder has no shared/ memory', async () => {
    const memory = await load('does-not-exist');
    expect(memory.subGoals).toEqual([]);
    expect(memory.problems).toHaveLength(1);
    expect(memory.problems[0]).toMatchObject({ file: 'shared/' });
    expect(memory.problems[0].message).toMatch(/shared/);
  });

  it('reports a missing state/ folder but still reads notes and reviews', async () => {
    const fs: MissionFs = {
      async readDirectory(dir) {
        if (dir.endsWith('shared')) return sections(dir, ['notes', 'reviews']);
        if (dir.endsWith('notes')) {
          return [{ name: 'q.md', path: `${dir}/q.md`, isDirectory: false }];
        }
        return [];
      },
      readFile: async () => '---\nkind: question\ngoal: 01-a\nstatus: open\n---\n\n# Offen\n',
    };
    const memory = await loadMissionMemory('/m', fs);
    expect(memory.problems).toEqual([{ file: 'state/', message: expect.stringMatching(/state/) }]);
    expect(memory.openQuestions.map((q) => q.title)).toEqual(['Offen']);
  });

  it('reports a file that cannot be read and keeps going', async () => {
    const fs: MissionFs = {
      readDirectory: async (dir) =>
        dir.endsWith('shared')
          ? sections(dir, ['state'])
          : dir.endsWith('state')
            ? [
                { name: '01-a.md', path: `${dir}/01-a.md`, isDirectory: false },
                { name: '02-b.md', path: `${dir}/02-b.md`, isDirectory: false },
              ]
            : [],
      readFile: async (file) => {
        if (file.endsWith('01-a.md')) throw new Error('permission denied');
        return '---\ngoal: 02-b\nphase: läuft\n---\n';
      },
    };
    const memory = await loadMissionMemory('/m', fs);
    expect(memory.subGoals.map((s) => s.goal)).toEqual(['02-b']);
    expect(memory.problems).toEqual([
      { file: 'state/01-a.md', message: expect.stringMatching(/permission denied/) },
    ]);
  });
});

describe('loadMissionMemory — folders', () => {
  const stateFile = '---\ngoal: 01-a\nphase: läuft\n---\n';

  it('reads a mission that has no notes/ or reviews/ yet without a problem', async () => {
    const fs: MissionFs = {
      readDirectory: async (dir) =>
        dir.endsWith('shared')
          ? sections(dir, ['state'])
          : [{ name: '01-a.md', path: `${dir}/01-a.md`, isDirectory: false }],
      readFile: async () => stateFile,
    };
    const memory = await loadMissionMemory('/m', fs);
    expect(memory.problems).toEqual([]);
    expect(memory.subGoals.map((s) => s.goal)).toEqual(['01-a']);
  });

  it.each(['notes', 'reviews'])(
    'reports a %s/ folder that is there but cannot be read',
    async (broken) => {
      const fs: MissionFs = {
        async readDirectory(dir) {
          if (dir.endsWith('shared')) return sections(dir, ['state', 'notes', 'reviews']);
          if (dir.endsWith(broken)) throw new Error('permission denied');
          return dir.endsWith('state')
            ? [{ name: '01-a.md', path: `${dir}/01-a.md`, isDirectory: false }]
            : [];
        },
        readFile: async () => stateFile,
      };
      const memory = await loadMissionMemory('/m', fs);
      expect(memory.problems).toEqual([
        { file: `${broken}/`, message: expect.stringMatching(/permission denied/) },
      ]);
      expect(memory.subGoals.map((s) => s.goal)).toEqual(['01-a']);
    }
  );
});

describe('parseMissionMemory', () => {
  it('matches a phase written with decomposed umlauts', () => {
    const decomposed = 'läuft';
    const memory = parseMissionMemory({
      state: [{ name: '01-a.md', content: `---\ngoal: 01-a\nphase: ${decomposed}\n---\n` }],
      notes: [],
      reviews: [],
    });
    expect(memory.subGoals[0].phase).toBe('läuft');
    expect(memory.problems).toEqual([]);
  });

  it('falls back to the file name when a state file does not name its goal', () => {
    const memory = parseMissionMemory({
      state: [{ name: '07-ohne-goal.md', content: '---\nphase: blockiert\n---\n' }],
      notes: [],
      reviews: [],
    });
    expect(memory.subGoals[0]).toMatchObject({ goal: '07-ohne-goal', number: '07' });
  });

  it('reports an approval whose review is not on disk instead of showing it as approved', () => {
    const memory = parseMissionMemory({
      state: [],
      notes: [],
      reviews: [
        {
          name: '04-x-approved.md',
          content:
            '---\nkind: review-approval\ngoal: 04-x\ndate: 2026-01-01\n' +
            'review: 04-x-2026-01-01-r1.md\n---\n',
        },
      ],
    });
    expect(memory.reviews).toEqual([]);
    expect(memory.problems).toEqual([
      {
        file: 'reviews/04-x-approved.md',
        message: expect.stringMatching(/04-x-2026-01-01-r1\.md/),
      },
    ]);
  });

  it('reports an approval that a later attempt has overtaken', () => {
    const review = (n: number, decision: string) => ({
      name: `04-x-2026-01-0${n}-r${n}.md`,
      content: `---\nkind: review\ngoal: 04-x\nattempt: ${n}\ndecision: ${decision}\n---\n`,
    });
    const memory = parseMissionMemory({
      state: [],
      notes: [],
      reviews: [
        review(1, 'approve'),
        review(2, 'rework'),
        {
          name: '04-x-approved.md',
          content: '---\nkind: review-approval\ngoal: 04-x\nreview: 04-x-2026-01-01-r1.md\n---\n',
        },
      ],
    });
    expect(memory.reviews[0]).toMatchObject({ approved: false, latest: { attempt: 2 } });
    expect(memory.problems).toEqual([
      { file: 'reviews/04-x-approved.md', message: expect.stringMatching(/attempt 2/) },
    ]);
  });

  it('reads a value that itself contains a colon, and strips quotes and comments', () => {
    const memory = parseMissionMemory({
      state: [],
      notes: [
        {
          name: 'q.md',
          content:
            '---\nkind: question\ngoal: 01-a\nauthor: "agent: eins"\n' +
            'evidence: lief um 00:06:47 -> danach: planned\nstatus: open   # questions only\n---\n# Q\n',
        },
      ],
      reviews: [],
    });
    expect(memory.problems).toEqual([]);
    expect(memory.openQuestions[0]).toMatchObject({ author: 'agent: eins', title: 'Q' });
  });

  it('lets the approval decide which of two reviews with the same attempt number counts', async () => {
    const memory = await load('mission-retried');
    expect(memory.problems).toEqual([]);
    const [r] = memory.reviews;
    expect(r.attempts.map((a) => a.attempt)).toEqual([4, 5, 5]);
    expect(r).toMatchObject({
      approved: true,
      approvalFile: 'reviews/09-x-approved.md',
      latest: { file: 'reviews/09-x-2026-01-12-r5.md', decision: 'approve' },
    });
  });

  it('reports two reviews with the same latest attempt number when nothing decides between them', () => {
    const review = (decision: string) =>
      `---\nkind: review\ngoal: 09-x\nattempt: 5\ndecision: ${decision}\n---\n# ${decision}\n`;
    const memory = parseMissionMemory({
      state: [],
      notes: [],
      reviews: [
        { name: '09-x-2026-01-01-r5.md', content: review('rework') },
        { name: '09-x-2026-01-01-r5-escalated.md', content: review('escalate') },
      ],
    });
    expect(memory.reviews[0].approved).toBe(false);
    expect(memory.problems).toEqual([
      {
        file: 'reviews/09-x-2026-01-01-r5-escalated.md',
        message: expect.stringMatching(/also in 09-x-2026-01-01-r5\.md/),
      },
    ]);
  });

  it('keeps dates as text, never as Date objects', () => {
    const memory = parseMissionMemory({
      state: [],
      notes: [
        {
          name: 'q.md',
          content: '---\nkind: question\ngoal: 01-a\ndate: 2026-01-10\nstatus: open\n---\n# Q\n',
        },
      ],
      reviews: [],
    });
    expect(memory.openQuestions[0].date).toBe('2026-01-10');
  });

  it('ignores files that are not Markdown', () => {
    const memory = parseMissionMemory({
      state: [{ name: '.gitkeep', content: '' }],
      notes: [{ name: 'readme.txt', content: 'x' }],
      reviews: [],
    });
    expect(memory).toEqual({ subGoals: [], openQuestions: [], reviews: [], problems: [] });
  });
});
