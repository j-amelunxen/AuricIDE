import assert from 'node:assert/strict';

import { browser } from '@wdio/globals';

type TauriApi = {
  core: {
    invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  };
};

type TauriBrowser = {
  tauri: {
    execute<ReturnValue, Arguments extends unknown[]>(
      script: (tauri: TauriApi, ...args: Arguments) => ReturnValue | Promise<ReturnValue>,
      ...args: Arguments
    ): Promise<Awaited<ReturnValue>>;
  };
};

declare const describe: (name: string, body: () => void) => void;
declare const it: (name: string, body: () => Promise<void>) => void;

const tauriBrowser = browser as typeof browser & TauriBrowser;

const phase = process.env.VFY_TAURI_PHASE;
const projectPath = process.env.VFY_TAURI_PROJECT_PATH;
const runId = process.env.VFY_TAURI_RUN_ID;

if ((phase !== 'write' && phase !== 'read') || !projectPath || !runId) {
  throw new Error('VFY-05 must be launched by scripts/run-tauri-durability-e2e.mts.');
}

const requirement = {
  id: `vfy05-${runId}`,
  reqId: 'REQ-VFY-05',
  title: `Durable requirement ${runId}`,
  description: 'Persists through real Tauri IPC, SQLite, and process restart.',
  type: 'functional',
  category: 'verification',
  priority: 'high',
  status: 'active',
  rationale: 'Native persistence is a release invariant.',
  acceptanceCriteria: 'A second process loads the same requirement.',
  source: 'VFY-05',
  appliesTo: '["desktop"]',
  lastVerifiedAt: null,
  sortOrder: 0,
  createdAt: '2026-09-24 00:00:00',
  updatedAt: '2026-09-24 00:00:00',
};
const filePath = `${projectPath}/durability-${runId}.md`;
const content = `# VFY-05\n${requirement.title}\n`;
const missionName = 'Durable Market Discovery';
const missionSlug = 'durable-market-discovery';
const missionInput = {
  projectPath,
  projectName: 'VFY-05 native fixture',
  name: missionName,
  objective: 'Inspect the configured sources and record one bounded, verifiable update.',
  timezone: 'Europe/Berlin',
  recurrence: { kind: 'daily', timeOfDay: '09:15' },
};
const missionPath = `${projectPath}/.auric/missions/${missionSlug}`;

describe(`VFY-05 native durability (${phase})`, () => {
  if (phase === 'write') {
    it('creates durable project data and a scheduled mission over real Tauri IPC', async () => {
      const result = await tauriBrowser.tauri.execute(
        async (tauri, fixture) => {
          await tauri.core.invoke('init_project_db', { projectPath: fixture.projectPath });

          let failedSaveError: string | null = null;
          try {
            await tauri.core.invoke('requirements_save', {
              projectPath: fixture.projectPath,
              payload: {
                requirements: [fixture.requirement],
                testLinks: [
                  {
                    id: `broken-link-${fixture.requirement.id}`,
                    requirementId: fixture.requirement.id,
                    testCaseId: 'missing-test-case',
                    createdAt: fixture.requirement.createdAt,
                  },
                ],
              },
            });
          } catch (error) {
            failedSaveError = String(error);
          }
          const stateAfterFailedSave = await tauri.core.invoke('requirements_load', {
            projectPath: fixture.projectPath,
          });

          await tauri.core.invoke('requirements_save', {
            projectPath: fixture.projectPath,
            payload: { requirements: [fixture.requirement], testLinks: [] },
          });
          await tauri.core.invoke('write_file', {
            path: fixture.filePath,
            content: fixture.content,
          });
          const createdMission = await tauri.core.invoke('mission_create', {
            input: fixture.missionInput,
          });

          try {
            await tauri.core.invoke('requirements_load', {
              projectPath: `${fixture.projectPath}-uninitialized`,
            });
            return {
              createdMission,
              failedSaveError,
              stateAfterFailedSave,
              uninitializedProjectError: null,
            };
          } catch (error) {
            return {
              createdMission,
              failedSaveError,
              stateAfterFailedSave,
              uninitializedProjectError: String(error),
            };
          }
        },
        { projectPath, requirement, filePath, content, missionInput }
      );

      assert.match(
        result.uninitializedProjectError ?? '',
        /Database not initialized for this project/
      );
      assert.match(result.failedSaveError ?? '', /foreign key|constraint/i);
      assert.deepEqual(result.stateAfterFailedSave, { requirements: [], testLinks: [] });
      assert.equal(
        (result.createdMission as { mission: { slug: string } }).mission.slug,
        missionSlug
      );
      assert.equal(
        (result.createdMission as { schedule: { missionSlug: string } }).schedule.missionSlug,
        missionSlug
      );
    });
  } else {
    it('loads project data, mission files, and schedule through a second native process', async () => {
      const result = await tauriBrowser.tauri.execute(
        async (tauri, fixture) => {
          await tauri.core.invoke('init_project_db', { projectPath: fixture.projectPath });
          const state = (await tauri.core.invoke('requirements_load', {
            projectPath: fixture.projectPath,
          })) as {
            requirements: Array<Record<string, unknown>>;
            testLinks: Array<Record<string, unknown>>;
          };
          const content = await tauri.core.invoke('read_file', { path: fixture.filePath });
          const missionMarkdown = await tauri.core.invoke('read_file', {
            path: `${fixture.missionPath}/MISSION.md`,
          });
          const missionState = await tauri.core.invoke('read_file', {
            path: `${fixture.missionPath}/STATE.md`,
          });
          const schedules = await tauri.core.invoke('schedules_list');
          return { state, content, missionMarkdown, missionState, schedules };
        },
        { projectPath, filePath, missionPath }
      );

      assert.deepEqual(result.state, { requirements: [requirement], testLinks: [] });
      assert.equal(result.content, content);
      assert.match(String(result.missionMarkdown), /# Durable Market Discovery/);
      assert.match(String(result.missionState), /Not started/);
      const missionSchedules = (
        result.schedules as Array<{ enabled: boolean; missionSlug: string | null }>
      ).filter((schedule) => schedule.missionSlug === missionSlug);
      assert.equal(missionSchedules.length, 1, 'mission must keep exactly one linked schedule');
      const [missionSchedule] = missionSchedules;
      assert.ok(missionSchedule);
      assert.equal(missionSchedule.enabled, true);
    });
  }
});
