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

  it('names its tools and the run folder they reach, and no shell without a skill', () => {
    expect(prompt).toContain('The file tools reach only your run folder');
    expect(prompt).toContain('No skill is approved for you, and you have no shell.');
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
