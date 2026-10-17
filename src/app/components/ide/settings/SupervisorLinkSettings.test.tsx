import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import type { SupervisorLinkPolicy } from '@/lib/tauri/supervisorLink';
import { SupervisorLinkSettings } from './SupervisorLinkSettings';

const { supervisorLinkPolicyGet, supervisorLinkPolicySet, supervisorLinkJobsUsage } = vi.hoisted(
  () => ({
    supervisorLinkPolicyGet: vi.fn(),
    supervisorLinkPolicySet: vi.fn(async (policy: SupervisorLinkPolicy) => policy),
    supervisorLinkJobsUsage: vi.fn(),
  })
);

vi.mock('@/lib/tauri/supervisorLink', () => ({
  supervisorLinkPolicyGet,
  supervisorLinkPolicySet,
  supervisorLinkJobsUsage,
}));

const PROJECTS = [
  { path: '/work/project-a', name: 'project-a', starredAt: 0 },
  { path: '/work/project-b/', name: 'project-b', starredAt: 1 },
];

const DIAGRAMS = {
  documentTypes: [{ name: 'diagram', globs: ['docs/**/*.diagram.json'] }],
  jobKinds: [],
};

const STORED: SupervisorLinkPolicy = {
  projects: { '/work/project-b': DIAGRAMS },
  jobs: { dailyLimit: 20, perProjectDailyLimit: null },
};

beforeEach(() => {
  supervisorLinkPolicyGet.mockReset().mockResolvedValue(STORED);
  supervisorLinkPolicySet.mockReset().mockImplementation(async (policy) => policy);
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

  it('shows which projects are shared, with their configuration and the counter', async () => {
    render(<SupervisorLinkSettings />);
    await waitFor(() => expect(toggle('project-b').checked).toBe(true));
    expect(toggle('project-a').checked).toBe(false);
    const config = screen.getByTestId('supervisor-link-config-project-b') as HTMLTextAreaElement;
    expect(JSON.parse(config.value)).toEqual(DIAGRAMS);
    expect(await screen.findByTestId('supervisor-link-usage')).toHaveTextContent(
      '3 of 20 used in the last 24 hours, 1 running.'
    );
  });

  it('shares a project with an empty configuration and unshares it', async () => {
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

  it('saves edited JSON under the stored path and shows what Rust refuses', async () => {
    render(<SupervisorLinkSettings />);
    const config = (await screen.findByTestId(
      'supervisor-link-config-project-b'
    )) as HTMLTextAreaElement;
    const kinds = {
      ...DIAGRAMS,
      jobKinds: [{ kind: 'diagram.draw', instructions: 'docs/agents/draw.md' }],
    };
    fireEvent.change(config, { target: { value: JSON.stringify(kinds) } });
    fireEvent.click(screen.getByTestId('supervisor-link-save-project-b'));
    await waitFor(() =>
      expect(supervisorLinkPolicySet).toHaveBeenLastCalledWith({
        ...STORED,
        projects: { '/work/project-b': kinds },
      })
    );
    // Stored: the editor shows what Rust kept, and there is nothing left to save.
    await waitFor(() =>
      expect(screen.getByTestId('supervisor-link-save-project-b')).toBeDisabled()
    );

    supervisorLinkPolicySet.mockRejectedValueOnce('job kind "Draw" needs a unique lowercase name');
    // The row starts afresh from what was stored, so the editor is a new element.
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
