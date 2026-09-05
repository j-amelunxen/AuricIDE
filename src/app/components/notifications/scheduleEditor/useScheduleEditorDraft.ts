'use client';

import { useEffect, useMemo, useState } from 'react';
import type { SkillLaunchPins } from '@/lib/agents/skillLaunch';
import type { NotificationLaunch } from '@/lib/notifications/types';
import { quickAccessCombos, quickAccessSkills } from '@/lib/store/starredProjectsSlice';
import { goalsLoad, type PmGoal } from '@/lib/tauri/goals';
import type { Schedule, ScheduleCatchUp } from '@/lib/tauri/schedules';
import {
  actionDraftOf,
  buildScheduleDraft,
  comboSnapshotStale,
  findLiveSkill,
  launchPinsOf,
  parsePayload,
  pinnedInvocationsOf,
  resolveProjectName,
  rhythmOf,
  skillSnapshotStale,
  snapshotFromCombo,
  snapshotFromDiscovered,
  snapshotFromPin,
  visibleSkillIds,
  withLaunchPins,
} from './helpers';
import {
  DEFAULT_CONDUCTOR_DRAFT,
  DISCOVERED_PREFIX,
  type ActionDraft,
  type ConductorActionDraft,
  type RhythmChoice,
  type RunSkillAction,
  type ScheduleEditorProps,
  type TaskLaunchDraft,
} from './types';

export function useScheduleEditorDraft({
  schedule,
  defaultProjectPath,
  defaultProjectName,
  starredProjects,
  projectOptions,
  discoveredSkills,
  onDraftChange,
}: Pick<
  ScheduleEditorProps,
  | 'schedule'
  | 'defaultProjectPath'
  | 'defaultProjectName'
  | 'starredProjects'
  | 'projectOptions'
  | 'discoveredSkills'
  | 'onDraftChange'
>) {
  // Stored null is app-wide, not "use the open project". `??` would rewrite it.
  const [projectPath, setProjectPath] = useState<string | null>(
    schedule === null ? defaultProjectPath : schedule.projectPath
  );
  const projectName = resolveProjectName({
    projectPath,
    projectOptions,
    schedule,
    defaultProjectPath,
    defaultProjectName,
  });

  const [name, setName] = useState(schedule?.name ?? '');
  const [rhythm, setRhythm] = useState<RhythmChoice>(() => rhythmOf(schedule));
  const [time, setTime] = useState(schedule?.timeOfDay ?? '09:00');
  const [weekdays, setWeekdays] = useState<string[]>(() => {
    const fields = schedule?.cronExpr?.trim().split(/\s+/) ?? [];
    return fields.length === 6 && /^[A-Z,]+$/.test(fields[5]) ? fields[5].split(',') : ['WED'];
  });
  const [everyN, setEveryN] = useState(schedule?.everyN ?? 14);
  const [everyUnit, setEveryUnit] = useState(schedule?.everyUnit ?? 'day');
  const [cronExpr, setCronExpr] = useState(schedule?.cronExpr ?? '0 0 9 * * MON');
  const [catchUp, setCatchUp] = useState<ScheduleCatchUp>(schedule?.catchUp ?? 'coalesce');
  const [actionDraft, setActionDraft] = useState<ActionDraft>(() => actionDraftOf(schedule));
  const [body, setBody] = useState(() => parsePayload(schedule?.payload ?? '{}').body ?? '');
  const [conductorGoals, setConductorGoals] = useState<PmGoal[]>([]);
  const [conductorGoalsLoading, setConductorGoalsLoading] = useState(false);

  const selectedProject =
    projectPath === null ? undefined : projectOptions.find((option) => option.path === projectPath);
  const starred =
    projectPath === null ? undefined : starredProjects.find((p) => p.path === projectPath);
  const pins = starred ? quickAccessSkills(starred) : [];
  const combos = starred ? quickAccessCombos(starred) : [];
  const unpinnedDiscovered = discoveredSkills.filter(
    (skill) => !pinnedInvocationsOf(pins).has(skill.invocation)
  );
  const noQuickAccess =
    projectPath !== null && starred === undefined && discoveredSkills.length === 0;

  /**
   * Anything picked from now on starts on the click; a schedule saved before
   * that was possible says nothing, and keeps stopping at the dialog until it
   * is told otherwise here.
   */
  const skillLaunch: NotificationLaunch =
    actionDraft.choice === 'skill' && actionDraft.snapshot !== undefined
      ? (actionDraft.snapshot.launch ?? 'dialog')
      : 'direct';

  const liveSkill =
    actionDraft.choice === 'skill' && actionDraft.snapshot
      ? findLiveSkill(pins, actionDraft.snapshot)
      : undefined;
  const skillStale =
    actionDraft.choice === 'skill' &&
    actionDraft.snapshot !== undefined &&
    liveSkill !== undefined &&
    skillSnapshotStale(actionDraft.snapshot, liveSkill);

  const liveCombo =
    actionDraft.choice === 'combo' && actionDraft.snapshot
      ? combos.find((combo) => combo.id === actionDraft.snapshot?.comboId)
      : undefined;
  const comboStale =
    actionDraft.choice === 'combo' &&
    actionDraft.snapshot !== undefined &&
    liveCombo !== undefined &&
    comboSnapshotStale(actionDraft.snapshot, liveCombo);

  const orphanSkill =
    actionDraft.choice === 'skill' &&
    actionDraft.snapshot !== undefined &&
    !visibleSkillIds(pins, discoveredSkills).has(actionDraft.snapshot.skillId)
      ? actionDraft.snapshot
      : undefined;
  const orphanCombo =
    actionDraft.choice === 'combo' &&
    actionDraft.snapshot !== undefined &&
    !combos.some((combo) => combo.id === actionDraft.snapshot?.comboId)
      ? actionDraft.snapshot
      : undefined;

  const draft = useMemo<Schedule>(
    () =>
      buildScheduleDraft({
        schedule,
        name,
        body,
        projectPath,
        projectName,
        actionDraft,
        rhythm,
        time,
        weekdays,
        everyN,
        everyUnit,
        cronExpr,
        catchUp,
      }),
    [
      actionDraft,
      body,
      catchUp,
      cronExpr,
      everyN,
      everyUnit,
      name,
      projectName,
      projectPath,
      rhythm,
      schedule,
      time,
      weekdays,
    ]
  );

  useEffect(() => {
    onDraftChange(draft);
  }, [draft, onDraftChange]);

  /**
   * The goal picker is scoped to whichever project the conductor would run
   * against, read fresh whenever that project changes. Gated on the conductor
   * being the current choice so every other schedule kind — the common case —
   * never opens this project's database at all.
   */
  useEffect(() => {
    if (actionDraft.choice !== 'conductor' || projectPath === null) return;
    const path = projectPath;
    let cancelled = false;

    async function loadGoals() {
      setConductorGoalsLoading(true);
      try {
        const state = await goalsLoad(path);
        if (cancelled) return;
        setConductorGoals(
          state.goals.filter((goal) => goal.status !== 'achieved' && goal.status !== 'archived')
        );
      } catch {
        // Browser mode, or a project with no database yet: the run simply
        // scopes to all tickets, same as if the field were left untouched.
        if (cancelled) return;
        setConductorGoals([]);
      } finally {
        if (!cancelled) setConductorGoalsLoading(false);
      }
    }

    void loadGoals();
    return () => {
      cancelled = true;
    };
  }, [actionDraft.choice, projectPath]);

  const toggleWeekday = (value: string) =>
    setWeekdays((current) =>
      current.includes(value) ? current.filter((day) => day !== value) : [...current, value]
    );

  /**
   * A skill or combo snapshot names something inside one specific project.
   * Carrying it across would keep the old label and prompt while pointing the
   * run at a different repository — so the selection is dropped and has to be
   * made again from the new project's catalogue. `saveBlocked` holds the save
   * until it is.
   */
  const chooseProject = (value: string) => {
    const next = value === '' ? null : value;
    setProjectPath(next);
    setActionDraft((current) => {
      if (current.choice === 'skill' || current.choice === 'combo') {
        return next === null ? { choice: 'none' } : { choice: current.choice };
      }
      if (current.choice === 'conductor') {
        // Budget, concurrency, review and launch belong to this reminder, not
        // to the project — only the goal, which names a row in one project's
        // own database, has to be re-picked.
        return next === null ? { choice: 'none' } : { ...current, goalId: null, goalName: null };
      }
      return current;
    });
  };

  const chooseAction = (choice: ActionDraft['choice']) => {
    if (
      (choice === 'skill' || choice === 'combo' || choice === 'conductor') &&
      projectPath === null
    )
      return;
    setActionDraft((current) => {
      if (current.choice === choice) return current;
      if (choice === 'none') return { choice: 'none' };
      if (choice === 'task') return { choice: 'task', task: '' };
      if (choice === 'conductor') return { ...DEFAULT_CONDUCTOR_DRAFT };
      return { choice };
    });
  };

  const setConductorDraft = (patch: Partial<ConductorActionDraft>) =>
    setActionDraft((current) =>
      current.choice === 'conductor' ? { ...current, ...patch } : current
    );

  const selectConductorGoal = (value: string) => {
    if (value === '') {
      setConductorDraft({ goalId: null, goalName: null });
      return;
    }
    const goal = conductorGoals.find((candidate) => candidate.id === value);
    setConductorDraft({ goalId: value, goalName: goal?.name ?? null });
  };

  /**
   * A skill picked here starts on the click. That is the whole point of
   * configuring the launch in advance — and it is still one click by a human,
   * on a button they wrote themselves. `setSkillLaunch` puts the dialog back
   * for anyone who wants to look before it runs.
   */
  const selectSkill = (value: string) => {
    if (projectPath === null) return;
    if (value === '') {
      setActionDraft({ choice: 'skill' });
      return;
    }
    const launch = actionDraft.choice === 'skill' ? skillLaunch : 'direct';
    const headless = actionDraft.choice === 'skill' ? actionDraft.snapshot?.headless : undefined;
    const withHeadless = (snapshot: RunSkillAction) =>
      headless === undefined ? snapshot : { ...snapshot, headless };
    const pin = pins.find((item) => item.id === value);
    if (pin) {
      setActionDraft({
        choice: 'skill',
        snapshot: withHeadless(snapshotFromPin(pin, projectPath, launch)),
      });
      return;
    }
    if (value.startsWith(DISCOVERED_PREFIX)) {
      const invocation = value.slice(DISCOVERED_PREFIX.length);
      const found = discoveredSkills.find((skill) => skill.invocation === invocation);
      if (found) {
        setActionDraft({
          choice: 'skill',
          snapshot: withHeadless(snapshotFromDiscovered(found, projectPath, launch)),
        });
      }
    }
  };

  const setSkillLaunch = (launch: NotificationLaunch) => {
    setActionDraft((current) =>
      current.choice === 'skill' && current.snapshot !== undefined
        ? {
            choice: 'skill',
            snapshot: {
              ...current.snapshot,
              launch,
              ...(launch === 'auto' ? { headless: true } : {}),
            },
          }
        : current
    );
  };

  const setSkillHeadless = (headless: boolean) => {
    setActionDraft((current) =>
      current.choice === 'skill' && current.snapshot !== undefined
        ? { choice: 'skill', snapshot: { ...current.snapshot, headless } }
        : current
    );
  };

  const setTaskLaunch = (patch: TaskLaunchDraft) => {
    setActionDraft((current) => (current.choice === 'task' ? { ...current, ...patch } : current));
  };

  const setTaskContent = (task: string) => {
    setActionDraft((current) => (current.choice === 'task' ? { ...current, task } : current));
  };

  /**
   * Changing the harness drops the model and the permission mode with it —
   * both name something inside the provider they were picked for, and left
   * standing they would be silently replaced at launch anyway.
   */
  const chooseTaskProvider = (providerId: string) =>
    setTaskLaunch(
      providerId === ''
        ? { providerId: undefined, model: undefined, permissionMode: undefined }
        : { providerId, model: undefined, permissionMode: undefined }
    );

  const setSkillPins = (patch: SkillLaunchPins) =>
    setActionDraft((current) =>
      current.choice === 'skill' && current.snapshot !== undefined
        ? {
            choice: 'skill',
            snapshot: withLaunchPins(current.snapshot, {
              ...launchPinsOf(current.snapshot),
              ...patch,
            }),
          }
        : current
    );

  /** Same rule as the custom agent: the harness carries its own two fields. */
  const chooseSkillProvider = (providerId: string) =>
    setSkillPins(
      providerId === ''
        ? { providerId: undefined, model: undefined, permissionMode: undefined }
        : { providerId, model: undefined, permissionMode: undefined }
    );

  const selectCombo = (value: string) => {
    if (projectPath === null) return;
    if (value === '') {
      setActionDraft({ choice: 'combo' });
      return;
    }
    const combo = combos.find((item) => item.id === value);
    if (combo) {
      setActionDraft({ choice: 'combo', snapshot: snapshotFromCombo(combo, projectPath) });
    }
  };

  /**
   * Takes the pin's wording over, and only its wording. The launch was decided
   * here and stays decided — a drifted prompt is no reason to start the run on
   * a different agent than the one the reminder says it uses.
   */
  const refreshSkillSnapshot = () => {
    if (projectPath === null || liveSkill === undefined) return;
    setActionDraft((current) => ({
      choice: 'skill',
      snapshot: withLaunchPins(
        snapshotFromPin(liveSkill, projectPath, skillLaunch),
        launchPinsOf(current.choice === 'skill' ? current.snapshot : undefined)
      ),
    }));
  };

  const refreshComboSnapshot = () => {
    if (projectPath === null || liveCombo === undefined) return;
    setActionDraft({ choice: 'combo', snapshot: snapshotFromCombo(liveCombo, projectPath) });
  };

  return {
    projectPath,
    projectName,
    selectedProject,
    name,
    setName,
    rhythm,
    setRhythm,
    time,
    setTime,
    weekdays,
    toggleWeekday,
    everyN,
    setEveryN,
    everyUnit,
    setEveryUnit,
    cronExpr,
    setCronExpr,
    catchUp,
    setCatchUp,
    actionDraft,
    body,
    setBody,
    draft,
    conductorGoals,
    conductorGoalsLoading,
    noQuickAccess,
    pins,
    combos,
    unpinnedDiscovered,
    skillLaunch,
    skillStale,
    comboStale,
    orphanSkill,
    orphanCombo,
    chooseProject,
    chooseAction,
    setConductorDraft,
    selectConductorGoal,
    selectSkill,
    setSkillLaunch,
    setSkillHeadless,
    chooseTaskProvider,
    setTaskLaunch,
    setTaskContent,
    setSkillPins,
    chooseSkillProvider,
    selectCombo,
    refreshSkillSnapshot,
    refreshComboSnapshot,
  };
}
