import { describe, expect, it } from 'vitest';
import policyFixtures from '@/lib/config/supervisorPolicy.fixtures.json';
import { visibleProjects, type SupervisorPolicy } from '@/lib/config/supervisorPolicy';
import type { ProviderPolicy } from '@/lib/config/providerPolicy';
import type { ProviderInfo } from '@/lib/tauri/providers';
import {
  buildSupervisorLaunchPrompt,
  supervisorPromptSkills,
  modelSizeLabel,
  supervisorPromptProjects,
} from './supervisorLaunchPrompt';

const provider = (id: string, models: [string, string, number | null][]): ProviderInfo => ({
  id,
  name: id,
  models: models.map(([value, label, rank]) => ({ value, label, rank })),
  permissionModes: [],
  defaultModel: models[0]?.[0] ?? '',
  defaultPermissionMode: 'default',
});

// Deliberately not in rank order, to prove the prompt sorts.
const PROVIDERS: ProviderInfo[] = [
  provider('claude', [
    ['opus', 'Opus', 3],
    ['haiku', 'Haiku', 1],
    ['fable', 'Fable', 4],
    ['sonnet', 'Sonnet', 2],
  ]),
  provider('codex', [
    ['auto', 'Auto', null],
    ['gpt-6-sol', 'GPT-6 Sol', 3],
    ['gpt-6-luna', 'GPT-6 Luna', 1],
    ['gpt-6-terra', 'GPT-6 Terra', 2],
    ['gpt-6-astra', 'GPT-6 Astra', 4],
  ]),
  provider('grok', [['grok-5', 'Grok 5', null]]),
];

/** The first visibleProjects fixture: project-a codex-only, project-b claude-only, c off. */
const fixtureCase = policyFixtures.visibleProjects[0];
const visible = visibleProjects(
  fixtureCase.policy as SupervisorPolicy,
  fixtureCase.projectPolicies as Record<string, ProviderPolicy>,
  fixtureCase.offeredModels as unknown as Record<string, string[]>
);
const projects = supervisorPromptProjects(visible, PROVIDERS, {
  '/abs/project-a': 'A small example service that parses invoices.',
});

describe('modelSizeLabel', () => {
  it('names the four ranks and calls anything else unknown', () => {
    expect([1, 2, 3, 4].map(modelSizeLabel)).toEqual(['small', 'medium', 'large', 'largest']);
    expect(modelSizeLabel(null)).toBe('size unknown');
    expect(modelSizeLabel(undefined)).toBe('size unknown');
    expect(modelSizeLabel(0)).toBe('size unknown');
    expect(modelSizeLabel(5)).toBe('largest');
  });
});

describe('supervisorPromptProjects', () => {
  it('takes labels and ranks from the providers but models only from the policy', () => {
    expect(projects[0].providers).toEqual([
      {
        id: 'codex',
        permissionMode: 'acceptEdits',
        weight: null,
        models: [
          { id: 'gpt-6-luna', label: 'GPT-6 Luna', rank: 1 },
          { id: 'gpt-6-sol', label: 'GPT-6 Sol', rank: 3 },
        ],
      },
    ]);
  });

  it('keeps a model the registry does not describe, with its id as label and no size', () => {
    const [project] = supervisorPromptProjects(
      [
        {
          path: '/abs/x',
          allowInteractive: false,
          maxRunning: 1,
          providers: [{ id: 'new', models: ['m1'], permissionMode: null, weight: null }],
        },
      ],
      PROVIDERS
    );
    expect(project.providers[0].models).toEqual([{ id: 'm1', label: 'm1', rank: null }]);
    expect(project.description).toBeNull();
  });
});

describe('buildSupervisorLaunchPrompt', () => {
  const prompt = buildSupervisorLaunchPrompt(projects);

  it('keeps the human reachable while children work', () => {
    expect(prompt).toContain('## Nie blockierend warten');
    expect(prompt).toContain(
      'For headless children, end your turn and wait for the IDE finish pingback.'
    );
    expect(prompt).toContain('For interactive children or as a fallback');
    expect(prompt).toContain('run_in_background: true');
    expect(prompt).toContain('waitSeconds: 0');
    expect(prompt).toContain('end your turn');
    expect(prompt).not.toContain('then call await_agent_result until done');
  });

  it('matches the snapshot', () => {
    expect(prompt).toMatchSnapshot();
  });

  it('never names a model, provider or project the policy does not show', () => {
    for (const hidden of [
      'gpt-6-astra',
      'gpt-6-terra',
      'opus',
      'fable',
      'auto',
      'grok',
      'project-c',
    ]) {
      expect(prompt).not.toContain(hidden);
    }
  });

  it('lists models smallest first, unknown sizes last', () => {
    const [project] = supervisorPromptProjects(
      [
        {
          path: '/abs/project-a',
          allowInteractive: true,
          maxRunning: 2,
          providers: [
            {
              id: 'codex',
              models: ['auto', 'gpt-6-astra', 'gpt-6-luna', 'gpt-6-sol'],
              permissionMode: null,
              weight: null,
            },
          ],
        },
      ],
      PROVIDERS
    );
    const text = buildSupervisorLaunchPrompt([project]);
    const order = ['gpt-6-luna', 'gpt-6-sol', 'gpt-6-astra', '`auto`'].map((id) =>
      text.indexOf(id)
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(text).toContain('`auto` (Auto) — size unknown');
  });

  it('names its tools and run folder, with only timer sleep without a skill', () => {
    expect(prompt).toContain('The file tools reach only your run folder');
    expect(prompt).toContain(
      'No skill is approved for you; the shell only allows timer `sleep N`.'
    );
    expect(prompt).not.toMatch(/Bash, Edit and every other tool ask/);
  });

  it("names a project's auric-pm server, and tells it to load deferred tools", () => {
    const text = buildSupervisorLaunchPrompt([{ ...projects[0], pmServer: 'auric-pm-alpha' }]);
    expect(text).toContain('the `auric-pm-alpha` tools (`mcp__auric-pm-alpha__*`)');
    expect(text).toContain('fetch them with ToolSearch');
  });

  it('mentions the browser and its limits only when Chrome is switched on', () => {
    expect(prompt).not.toContain('## Browser');
    const text = buildSupervisorLaunchPrompt(projects, { chrome: true });
    expect(text).toContain('## Browser');
    expect(text).toContain('never touch tabs you did not open');
  });

  it('lists approved skills by folder name with exactly their shell commands', () => {
    const skills = supervisorPromptSkills({
      '/abs/skills/video-to-tasklist/': { bash: ['/abs/skills/video-to-tasklist/scripts/*'] },
      '/abs/skills/notes': { bash: [] },
    });
    expect(skills.map((skill) => skill.name)).toEqual(['notes', 'video-to-tasklist']);
    const text = buildSupervisorLaunchPrompt(projects, { skills });
    expect(text).toContain('- `/notes` — no shell');
    expect(text).toContain(
      '- `/video-to-tasklist` — shell commands it may run: `/abs/skills/video-to-tasklist/scripts/*`'
    );
    expect(text.indexOf('## Skills')).toBeLessThan(text.indexOf('## Starting an agent'));
  });

  it('lists approved tools, and stops saying there is no shell once one exists', () => {
    expect(prompt).not.toContain('## Tools');
    const text = buildSupervisorLaunchPrompt(projects, { tools: ['umi', '/opt/bin/mytool'] });
    expect(text).toContain('## Tools');
    expect(text).toContain('`umi`, `/opt/bin/mytool`');
    expect(text).toContain('No skill is approved for you.');
    expect(text).not.toContain('you have no shell');
    expect(text.indexOf('## Tools')).toBeLessThan(text.indexOf('## Starting an agent'));
  });

  it('ends with the first task when a skill started it', () => {
    const text = buildSupervisorLaunchPrompt(projects, {
      firstTask: '  Ask every project for its status  ',
    });
    expect(text.endsWith('## Your first task\n\nAsk every project for its status')).toBe(true);
    expect(buildSupervisorLaunchPrompt(projects, { firstTask: '   ' })).toBe(prompt);
  });

  it("adds the human's own instructions after the built-in rules, before the first task", () => {
    expect(prompt).not.toContain('## Instructions from the human');
    const text = buildSupervisorLaunchPrompt(projects, {
      instructions: '  Answer in German.\nPrefer codex for reviews.  ',
      firstTask: 'Ask every project for its status',
    });
    expect(text).toContain('## Instructions from the human');
    expect(text).toContain('Answer in German.\nPrefer codex for reviews.');
    expect(text).toContain('a refused call stays refused');
    expect(text.indexOf('## Reporting')).toBeLessThan(
      text.indexOf('## Instructions from the human')
    );
    expect(text.indexOf('## Instructions from the human')).toBeLessThan(
      text.indexOf('## Your first task')
    );
    expect(buildSupervisorLaunchPrompt(projects, { instructions: ' \n ' })).toBe(prompt);
  });

  it('has a resumed supervisor catch up on its folder, newest first, before anything else', () => {
    expect(prompt).not.toContain('## Picking up an earlier run');
    const text = buildSupervisorLaunchPrompt(projects, {
      resumedRun: '2026-10-16_185017',
      firstTask: 'Ask every project for its status',
    });
    expect(text).toContain('## Picking up an earlier run');
    expect(text).toContain('2026-10-16_185017');
    expect(text).toContain('modification time, newest first');
    // Rust re-parents the earlier run's children onto the resumed supervisor.
    expect(text).not.toContain('not your children');
    expect(text).toContain('list_agents shows them as yours');
    expect(text.indexOf('## Reporting')).toBeLessThan(text.indexOf('## Picking up an earlier run'));
    expect(text.indexOf('## Picking up an earlier run')).toBeLessThan(
      text.indexOf('## Your first task')
    );
    const alone = buildSupervisorLaunchPrompt(projects, { resumedRun: '2026-10-16_185017' });
    expect(alone.endsWith('wait for the go-ahead before you start any agent.')).toBe(true);
  });

  it('says plainly when nothing is allowed', () => {
    expect(buildSupervisorLaunchPrompt([])).toContain('Settings → Supervisor');
  });

  it('marks a project whose providers all fell away as unusable', () => {
    const text = buildSupervisorLaunchPrompt([
      {
        path: '/abs/project-a',
        description: null,
        allowInteractive: false,
        maxRunning: 2,
        providers: [],
      },
    ]);
    expect(text).toContain('No provider is usable here right now');
  });

  it('describes each model by size, what it is for and its relative cost', () => {
    const described: ProviderInfo = {
      ...provider('claude', []),
      models: [
        {
          value: 'sonnet',
          label: 'Sonnet',
          rank: 2,
          useFor: 'Browsing, reading, coding.',
          relativeCost: 3,
        },
        {
          value: 'haiku',
          label: 'Haiku',
          rank: 1,
          useFor: 'Lookups and formatting.',
          relativeCost: 1,
        },
        { value: 'opus', label: 'Opus', rank: 3 },
      ],
    };
    const [project] = supervisorPromptProjects(
      [
        {
          path: '/abs/project-a',
          allowInteractive: true,
          maxRunning: 2,
          providers: [
            {
              id: 'claude',
              models: ['sonnet', 'haiku', 'opus'],
              permissionMode: null,
              weight: null,
            },
          ],
        },
      ],
      [described]
    );
    const text = buildSupervisorLaunchPrompt([project]);
    expect(text).toContain(
      '`haiku` (Haiku) — small, cost 1× (the cheapest) — picked when you leave model out. ' +
        'Use for: Lookups and formatting.'
    );
    expect(text).toContain(
      '`sonnet` (Sonnet) — medium, cost 3×. Use for: Browsing, reading, coding.'
    );
    expect(text).toContain('`opus` (Opus) — large, needs modelReason');
  });

  it('picks models by the kind of task, and makes a large one a stated exception', () => {
    expect(prompt).toContain('list_projects with `project`');
    expect(prompt).toContain('Leaving `model` out picks the smallest');
    expect(prompt).toContain('modelReason');
    expect(prompt).toMatch(/rank 2 is the default: driving a browser, reading text/i);
    expect(prompt).toContain('Publicly visible work or a matter of taste is no reason');
  });

  it('states a load-balancing ratio only for a project that has one, unnamed providers at 0', () => {
    const weighted = policyFixtures.visibleProjects.find((c) => c.name.includes('its weight'))!;
    const [project] = supervisorPromptProjects(
      visibleProjects(
        weighted.policy as SupervisorPolicy,
        weighted.projectPolicies as Record<string, ProviderPolicy>,
        weighted.offeredModels as unknown as Record<string, string[]>
      ),
      PROVIDERS
    );
    const text = buildSupervisorLaunchPrompt([project]);
    expect(text).toContain('Load balancing: antigravity 0 : claude 2 : codex 1');
    expect(text).toContain('`balancing.next`');
    expect(prompt).not.toContain('Load balancing:');
  });
});
