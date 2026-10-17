import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import { SupervisorLinkSettings } from './SupervisorLinkSettings';

const { supervisorLinkPolicyGet, supervisorLinkPolicySet } = vi.hoisted(() => ({
  supervisorLinkPolicyGet: vi.fn(),
  supervisorLinkPolicySet: vi.fn(async (projects: string[]) => ({
    sceneProjects: [...projects].sort(),
  })),
}));

vi.mock('@/lib/tauri/supervisorLink', () => ({ supervisorLinkPolicyGet, supervisorLinkPolicySet }));

const PROJECTS = [
  { path: '/work/project-a', name: 'project-a', starredAt: 0 },
  { path: '/work/project-b/', name: 'project-b', starredAt: 1 },
];

beforeEach(() => {
  supervisorLinkPolicyGet.mockReset().mockResolvedValue({ sceneProjects: ['/work/project-b'] });
  supervisorLinkPolicySet.mockClear();
  useStore.setState({ starredProjects: PROJECTS });
});

const toggle = (name: string) =>
  screen.getByTestId(`supervisor-link-scenes-${name}`) as HTMLInputElement;

describe('SupervisorLinkSettings', () => {
  it('shows which starred projects the link may read scenes from', async () => {
    render(<SupervisorLinkSettings />);
    await waitFor(() => expect(toggle('project-b').checked).toBe(true));
    expect(toggle('project-a').checked).toBe(false);
  });

  it('writes the switch at once and shows what Rust stored', async () => {
    render(<SupervisorLinkSettings />);
    await waitFor(() => expect(toggle('project-b').checked).toBe(true));

    fireEvent.click(toggle('project-a'));
    await waitFor(() =>
      expect(supervisorLinkPolicySet).toHaveBeenCalledWith(['/work/project-b', '/work/project-a'])
    );
    await waitFor(() => expect(toggle('project-a').checked).toBe(true));

    fireEvent.click(toggle('project-b'));
    await waitFor(() =>
      expect(supervisorLinkPolicySet).toHaveBeenLastCalledWith(['/work/project-a'])
    );
  });

  it('says so when the settings cannot be read', async () => {
    supervisorLinkPolicyGet.mockRejectedValue(new Error('no backend'));
    render(<SupervisorLinkSettings />);
    expect(await screen.findByRole('alert')).toHaveTextContent('no backend');
  });
});
