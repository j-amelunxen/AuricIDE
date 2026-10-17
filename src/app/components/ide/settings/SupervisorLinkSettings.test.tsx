import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import type {
  EffectiveLinkPolicy,
  PolicyProposals,
  StoredLinkPolicy,
} from '@/lib/tauri/supervisorLink';
import { SupervisorLinkSettings } from './SupervisorLinkSettings';

const mocks = vi.hoisted(() => ({
  supervisorLinkPolicyGet: vi.fn(),
  supervisorLinkPolicySet: vi.fn(),
  supervisorLinkPolicyEffective: vi.fn(),
  supervisorLinkJobsUsage: vi.fn(),
  supervisorLinkProposals: vi.fn(),
  supervisorLinkProposalDecide: vi.fn(),
}));

vi.mock('@/lib/tauri/supervisorLink', () => mocks);

const {
  supervisorLinkPolicyGet,
  supervisorLinkPolicySet,
  supervisorLinkPolicyEffective,
  supervisorLinkJobsUsage,
  supervisorLinkProposals,
  supervisorLinkProposalDecide,
} = mocks;

const PROJECTS = [
  { path: '/work/project-a', name: 'project-a', starredAt: 0 },
  { path: '/work/project-b/', name: 'project-b', starredAt: 1 },
];

const SCENE = { name: 'scene', globs: ['docs/**/*.scene.json'] };
const DIAGRAM = { name: 'diagram', globs: ['docs/**/*.diagram.json'] };
const DRAW = { kind: 'scene.draw', globalInstructions: 'scene.draw.md' };

const ENTRY_B = { documentTypes: [DIAGRAM], jobKinds: [], dailyLimit: 3 };

const STORED: StoredLinkPolicy = {
  defaults: { documentTypes: [SCENE], jobKinds: [DRAW] },
  projects: { '/work/project-b': ENTRY_B },
  jobs: { dailyLimit: 20, perProjectDailyLimit: null },
};

const EFFECTIVE: EffectiveLinkPolicy = {
  projects: {
    '/work/project-b': {
      documentTypes: [SCENE, DIAGRAM],
      jobKinds: [{ ...DRAW, instructions: 'docs/agents/draw.md' }],
    },
  },
  jobs: STORED.jobs,
  projectDailyLimits: { '/work/project-b': 3 },
  origins: {
    '/work/project-b': {
      documentTypes: { scene: 'global', diagram: 'project' },
      jobKinds: { 'scene.draw': 'override' },
    },
  },
};

const PROPOSAL = {
  id: 'p-1',
  createdAt: 1_000,
  expiresAt: Date.now() + 2 * 60 * 60 * 1000,
  proposedBy: { agentId: 'agent-7', name: 'Scene planner' },
  reason: 'The scene folder moved',
  changes: [{ op: 'set_default_document_type' }],
  diff: ['~ default document type scene: globs docs/**/*.scene.json → scenes/*.json'],
  base: null,
};

const PROPOSALS: PolicyProposals = {
  pending: [PROPOSAL],
  recent: [
    {
      ...PROPOSAL,
      id: 'p-0',
      reason: 'Share the notes project',
      at: Date.parse('2026-10-16T09:30:00Z'),
      outcome: 'discarded',
    },
  ],
};

beforeEach(() => {
  supervisorLinkPolicyGet.mockReset().mockResolvedValue(STORED);
  supervisorLinkPolicySet.mockReset().mockImplementation(async (policy) => policy);
  supervisorLinkPolicyEffective.mockReset().mockResolvedValue(EFFECTIVE);
  supervisorLinkProposals.mockReset().mockResolvedValue({ pending: [], recent: [] });
  supervisorLinkProposalDecide.mockReset().mockResolvedValue('applied');
  supervisorLinkJobsUsage.mockReset().mockResolvedValue({
    limits: STORED.jobs,
    inWindow: 3,
    byProject: { '/work/project-b': 3 },
    running: 1,
    nextSlotAt: null,
  });
  useStore.setState({ starredProjects: PROJECTS });
});

const toggle = (name: string) =>
  screen.getByTestId(`supervisor-link-project-${name}`) as HTMLInputElement;

describe('SupervisorLinkSettings', () => {
  it('is the supervisor link, not a product of its own', async () => {
    render(<SupervisorLinkSettings />);
    expect(screen.getByText('Supervisor link')).toBeInTheDocument();
    expect(screen.queryByText(/companion/i)).toBeNull();
  });

  it('shows the defaults, which projects are shared with their entry, and the counter', async () => {
    render(<SupervisorLinkSettings />);
    await waitFor(() => expect(toggle('project-b').checked).toBe(true));
    expect(toggle('project-a').checked).toBe(false);
    const defaults = screen.getByLabelText(/Global defaults/) as HTMLTextAreaElement;
    expect(JSON.parse(defaults.value)).toEqual(STORED.defaults);
    const entry = screen.getByTestId('supervisor-link-config-project-b') as HTMLTextAreaElement;
    expect(JSON.parse(entry.value)).toEqual(ENTRY_B);
    expect(await screen.findByTestId('supervisor-link-usage')).toHaveTextContent(
      '3 of 20 used in the last 24 hours, 1 running.'
    );
  });

  it('saves the global defaults in the stored shape and reads the effective policy again', async () => {
    render(<SupervisorLinkSettings />);
    const defaults = await screen.findByTestId('supervisor-link-defaults');
    await waitFor(() => expect(supervisorLinkPolicyEffective).toHaveBeenCalledTimes(1));
    const next = { documentTypes: [SCENE, DIAGRAM] };
    fireEvent.change(defaults, { target: { value: JSON.stringify(next) } });
    fireEvent.click(screen.getByTestId('supervisor-link-defaults-save'));

    await waitFor(() =>
      expect(supervisorLinkPolicySet).toHaveBeenLastCalledWith({
        ...STORED,
        defaults: { documentTypes: [SCENE, DIAGRAM], jobKinds: [] },
      })
    );
    await waitFor(() => expect(supervisorLinkPolicyEffective).toHaveBeenCalledTimes(2));
  });

  it('shares a project with an empty entry that inherits everything, and unshares it', async () => {
    render(<SupervisorLinkSettings />);
    await waitFor(() => expect(toggle('project-b').checked).toBe(true));

    fireEvent.click(toggle('project-a'));
    await waitFor(() =>
      expect(supervisorLinkPolicySet).toHaveBeenLastCalledWith({
        ...STORED,
        projects: { ...STORED.projects, '/work/project-a': { documentTypes: [], jobKinds: [] } },
      })
    );

    fireEvent.click(toggle('project-b'));
    await waitFor(() =>
      expect(supervisorLinkPolicySet).toHaveBeenLastCalledWith({
        ...STORED,
        projects: { '/work/project-a': { documentTypes: [], jobKinds: [] } },
      })
    );
  });

  it('saves a project entry with its inheritance fields and shows what Rust refuses', async () => {
    render(<SupervisorLinkSettings />);
    const config = await screen.findByTestId('supervisor-link-config-project-b');
    const entry = { inherit: true, disabledJobKinds: ['scene.draw'], documentTypes: [DIAGRAM] };
    fireEvent.change(config, { target: { value: JSON.stringify(entry) } });
    fireEvent.click(screen.getByTestId('supervisor-link-save-project-b'));
    await waitFor(() =>
      expect(supervisorLinkPolicySet).toHaveBeenLastCalledWith({
        ...STORED,
        projects: { '/work/project-b': { ...entry, jobKinds: [] } },
      })
    );
    await waitFor(() =>
      expect(screen.getByTestId('supervisor-link-save-project-b')).toBeDisabled()
    );

    supervisorLinkPolicySet.mockRejectedValueOnce('job kind "Draw" needs a unique lowercase name');
    fireEvent.change(screen.getByTestId('supervisor-link-config-project-b'), {
      target: { value: '{"jobKinds":[]}' },
    });
    fireEvent.click(screen.getByTestId('supervisor-link-save-project-b'));
    expect(await screen.findByRole('alert')).toHaveTextContent('unique lowercase name');
  });

  it('refuses text that is not JSON before asking Rust', async () => {
    render(<SupervisorLinkSettings />);
    const config = await screen.findByTestId('supervisor-link-config-project-b');
    fireEvent.change(config, { target: { value: '{ nope' } });
    fireEvent.click(screen.getByTestId('supervisor-link-save-project-b'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Not JSON');
    expect(supervisorLinkPolicySet).not.toHaveBeenCalled();
  });

  it('lists what a shared project effectively offers and where each entry comes from', async () => {
    render(<SupervisorLinkSettings />);
    const effective = within(await screen.findByTestId('supervisor-link-effective-project-b'));
    expect(effective.getByText('scene').closest('li')).toHaveTextContent('Global');
    expect(effective.getByText('diagram').closest('li')).toHaveTextContent('Project');
    expect(effective.getByText('scene.draw').closest('li')).toHaveTextContent('Override');
    expect(effective.getByTestId('supervisor-link-effective-limit')).toHaveTextContent(
      '3 jobs per 24 h, set by the project'
    );
  });

  it('says plainly when a shared project is missing from the effective policy', async () => {
    supervisorLinkPolicyEffective.mockResolvedValue({ ...EFFECTIVE, projects: {}, origins: {} });
    render(<SupervisorLinkSettings />);
    expect(await screen.findByTestId('supervisor-link-effective-project-b')).toHaveTextContent(
      /merged configuration is invalid.*does not see this project/
    );
  });

  it('applies a pending proposal by its id and reads everything again', async () => {
    supervisorLinkProposals.mockResolvedValue(PROPOSALS);
    render(<SupervisorLinkSettings />);
    const pending = within(await screen.findByTestId('supervisor-link-proposal-p-1'));
    expect(pending.getByText('Scene planner', { exact: false })).toBeInTheDocument();
    expect(pending.getByText('The scene folder moved')).toBeInTheDocument();
    expect(pending.getByText(PROPOSAL.diff[0])).toBeInTheDocument();
    expect(pending.getByText(/expires in 1h 59m|expires in 2h 0m/)).toBeInTheDocument();
    expect(screen.getByTestId('supervisor-link-recent')).toHaveTextContent(
      /Discarded.*Share the notes project/
    );
    await waitFor(() => expect(supervisorLinkPolicyGet).toHaveBeenCalledTimes(1));

    fireEvent.click(pending.getByRole('button', { name: 'Apply' }));
    await waitFor(() => expect(supervisorLinkProposalDecide).toHaveBeenCalledWith('p-1', 'apply'));
    await waitFor(() => {
      expect(supervisorLinkPolicyGet).toHaveBeenCalledTimes(2);
      expect(supervisorLinkPolicyEffective).toHaveBeenCalledTimes(2);
      expect(supervisorLinkProposals).toHaveBeenCalledTimes(2);
    });
  });

  it('shows why Rust refused a decision', async () => {
    supervisorLinkProposals.mockResolvedValue(PROPOSALS);
    supervisorLinkProposalDecide.mockRejectedValue('the policy changed since the proposal');
    render(<SupervisorLinkSettings />);
    const pending = within(await screen.findByTestId('supervisor-link-proposal-p-1'));
    fireEvent.click(pending.getByRole('button', { name: 'Discard' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('policy changed since');
    expect(supervisorLinkProposalDecide).toHaveBeenCalledWith('p-1', 'discard');
  });

  it('says in one line when nothing is waiting', async () => {
    render(<SupervisorLinkSettings />);
    expect(await screen.findByTestId('supervisor-link-proposals-empty')).toHaveTextContent(
      'No proposals'
    );
  });

  it('writes the job limits when a field is left', async () => {
    render(<SupervisorLinkSettings />);
    const daily = (await screen.findByTestId('supervisor-link-daily-limit')) as HTMLInputElement;
    fireEvent.change(daily, { target: { value: '5' } });
    fireEvent.blur(daily);
    await waitFor(() =>
      expect(supervisorLinkPolicySet).toHaveBeenLastCalledWith({
        ...STORED,
        jobs: { dailyLimit: 5, perProjectDailyLimit: null },
      })
    );
    const perProject = screen.getByTestId('supervisor-link-project-limit') as HTMLInputElement;
    fireEvent.change(perProject, { target: { value: '2' } });
    fireEvent.blur(perProject);
    await waitFor(() =>
      expect(supervisorLinkPolicySet).toHaveBeenLastCalledWith({
        ...STORED,
        jobs: { dailyLimit: 5, perProjectDailyLimit: 2 },
      })
    );
  });

  it('says so when the settings cannot be read', async () => {
    supervisorLinkPolicyGet.mockRejectedValue(new Error('no backend'));
    render(<SupervisorLinkSettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent('no backend');
  });
});
