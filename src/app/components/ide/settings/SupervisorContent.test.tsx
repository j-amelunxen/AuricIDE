import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emptySupervisorPolicy, type SupervisorPolicy } from '@/lib/config/supervisorPolicy';
import { useStore } from '@/lib/store';
import type { ProviderInfo } from '@/lib/tauri/providers';
import { SupervisorContent } from './SupervisorContent';

const { supervisorPolicyGet, supervisorPolicySet, projectProviderPolicyGet, listProviders } =
  vi.hoisted(() => ({
    listProviders: vi.fn(),
    supervisorPolicyGet: vi.fn(),
    supervisorPolicySet: vi.fn(async (policy: unknown) => ({ policy, rejected: [] })),
    projectProviderPolicyGet: vi.fn(),
  }));

const PROVIDERS: ProviderInfo[] = [
  {
    id: 'claude',
    name: 'Claude Code',
    models: [
      { value: 'opus', label: 'Opus', rank: 3 },
      { value: 'haiku', label: 'Haiku', rank: 1 },
      { value: 'custom', label: 'Custom' },
    ],
    permissionModes: [
      { value: 'default', label: 'Default', description: '' },
      { value: 'acceptEdits', label: 'Accept edits', description: '' },
      { value: 'bypassPermissions', label: 'Bypass permissions', description: '' },
    ],
    defaultModel: 'opus',
    defaultPermissionMode: 'default',
  },
  {
    id: 'codex',
    name: 'Codex',
    models: [{ value: 'gpt-luna', label: 'Luna', rank: 1 }],
    permissionModes: [],
    defaultModel: 'gpt-luna',
    defaultPermissionMode: 'default',
  },
];

vi.mock('@/lib/tauri/supervisorPolicy', () => ({ supervisorPolicyGet, supervisorPolicySet }));
vi.mock('@/lib/tauri/providers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/tauri/providers')>()),
  listProviders,
}));
vi.mock('@/lib/tauri/providerPolicy', () => ({ projectProviderPolicyGet }));

const OPEN = '/work/project-open';
const CLOSED = '/work/project-closed';

function policy(projects: SupervisorPolicy['projects'] = {}): SupervisorPolicy {
  return { ...emptySupervisorPolicy(), projects };
}

async function renderLoaded() {
  render(<SupervisorContent />);
  await screen.findByTestId('supervisor-save');
}

describe('SupervisorContent', () => {
  beforeEach(() => {
    supervisorPolicySet.mockClear();
    listProviders.mockResolvedValue(PROVIDERS);
    supervisorPolicyGet.mockResolvedValue({ policy: policy(), rejected: [] });
    // Rust reads both off disk; the closed one only permits Claude by an allow list.
    projectProviderPolicyGet.mockImplementation(async (path: string) =>
      path === OPEN ? { allow: null, deny: ['codex'] } : { allow: ['claude'], deny: [] }
    );
    useStore.setState({
      toasts: [],
      starredProjects: [
        { path: OPEN, name: 'project-open', starredAt: 1 },
        { path: CLOSED, name: 'project-closed', starredAt: 2 },
      ],
    });
  });

  it('lists every starred project, switched off by default', async () => {
    await renderLoaded();
    expect(screen.getByTestId(`supervisor-allowed-${OPEN}`)).not.toBeChecked();
    expect(screen.getByTestId(`supervisor-allowed-${CLOSED}`)).not.toBeChecked();
    expect(screen.getByTestId('supervisor-save')).toBeDisabled();
  });

  // code-gate: complexity-function-length - test cases in one describe, each short on its own
  it("disables a provider the project's own policy denies and says why", async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId(`supervisor-allowed-${OPEN}`));

    const codex = screen.getByTestId(`supervisor-provider-${OPEN}-codex`);
    expect(codex).toBeDisabled();
    expect(codex).not.toBeChecked();
    expect(codex.closest('label')).toHaveTextContent(/blocked by this project's own provider/i);
    expect(screen.getByTestId(`supervisor-provider-${OPEN}-claude`)).toBeEnabled();
  });

  it('applies the provider rules of a project that is not open as well', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId(`supervisor-allowed-${CLOSED}`));
    expect(screen.getByTestId(`supervisor-provider-${CLOSED}-codex`)).toBeDisabled();
    expect(screen.getByTestId(`supervisor-provider-${CLOSED}-claude`)).toBeEnabled();
    expect(projectProviderPolicyGet).toHaveBeenCalledWith(CLOSED);
  });

  it('never offers bypassPermissions', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId(`supervisor-allowed-${OPEN}`));
    const select = screen.getByTestId(`supervisor-permission-${OPEN}-claude`);
    const values = Array.from(select.querySelectorAll('option')).map((o) => o.value);
    expect(values).toEqual(['', 'default', 'acceptEdits']);
  });

  it('orders models by size and labels each one', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId(`supervisor-allowed-${OPEN}`));
    const group = screen.getByRole('group', { name: 'Claude Code models' });
    expect(Array.from(group.querySelectorAll('label')).map((l) => l.textContent)).toEqual([
      'Haikusmall',
      'Opuslarge',
      'Customsize unknown',
    ]);
  });

  it('saves exactly the edited policy', async () => {
    await renderLoaded();
    fireEvent.click(screen.getByTestId(`supervisor-allowed-${OPEN}`));
    fireEvent.click(screen.getByTestId(`supervisor-model-${OPEN}-claude-opus`));
    fireEvent.change(screen.getByTestId(`supervisor-permission-${OPEN}-claude`), {
      target: { value: 'acceptEdits' },
    });
    fireEvent.change(screen.getByTestId(`supervisor-max-running-${OPEN}`), {
      target: { value: '3' },
    });
    fireEvent.change(screen.getByTestId('supervisor-model'), { target: { value: 'haiku' } });
    fireEvent.change(screen.getByTestId('supervisor-max-children'), { target: { value: '4' } });
    fireEvent.click(screen.getByTestId('supervisor-chrome'));

    fireEvent.click(screen.getByTestId('supervisor-save'));

    await waitFor(() => expect(supervisorPolicySet).toHaveBeenCalledTimes(1));
    expect(supervisorPolicySet).toHaveBeenCalledWith({
      ...emptySupervisorPolicy(),
      supervisor: { provider: 'claude', model: 'haiku', chrome: true },
      maxRunningChildren: 4,
      projects: {
        [OPEN]: {
          allowed: true,
          providers: null,
          models: { claude: ['haiku', 'custom'] },
          permissionMode: { claude: 'acceptEdits' },
          allowInteractive: expect.any(Boolean),
          maxRunning: 3,
        },
      },
    });
    await waitFor(() =>
      expect(useStore.getState().toasts.at(-1)?.message).toBe('Supervisor settings saved')
    );
    expect(screen.getByTestId('supervisor-save')).toBeDisabled();
  });

  it('takes what Rust wrote back as the new saved state', async () => {
    supervisorPolicySet.mockImplementationOnce(async () => ({
      policy: { ...policy(), maxRunningChildren: 9 },
      rejected: [],
    }));
    await renderLoaded();
    fireEvent.change(screen.getByTestId('supervisor-max-children'), { target: { value: '7' } });
    fireEvent.click(screen.getByTestId('supervisor-save'));
    await waitFor(() => expect(screen.getByTestId('supervisor-max-children')).toHaveValue(9));
    expect(screen.getByTestId('supervisor-save')).toBeDisabled();
  });

  it('shows what the stored file had rejected', async () => {
    supervisorPolicyGet.mockResolvedValue({
      policy: policy(),
      rejected: [{ project: '/work/legacy', reason: 'bypass_permissions' }],
    });
    await renderLoaded();
    expect(screen.getByTestId('supervisor-rejected')).toHaveTextContent('/work/legacy');
  });
});

/** A CLI whose own default runs without asking — the case the select must not hand out. */
const UNATTENDED_BY_DEFAULT: ProviderInfo = {
  id: 'agy',
  name: 'Antigravity',
  models: [{ value: 'agy-model', label: 'Agy model', rank: 2 }],
  permissionModes: [
    { value: 'auto', label: 'Auto', description: '', unattended: true },
    { value: 'yolo', label: 'Yolo', description: '', unattended: true },
    { value: 'plan', label: 'Plan', description: '' },
  ],
  defaultModel: 'agy-model',
  defaultPermissionMode: 'auto',
};

describe('SupervisorContent — modes that skip permission prompts', () => {
  const allowedWith = (entry: Partial<SupervisorPolicy['projects'][string]>) =>
    policy({
      [OPEN]: {
        allowed: true,
        providers: null,
        models: {},
        permissionMode: {},
        allowInteractive: false,
        maxRunning: 2,
        ...entry,
      },
    });

  beforeEach(() => {
    supervisorPolicySet.mockClear();
    listProviders.mockResolvedValue([...PROVIDERS, UNATTENDED_BY_DEFAULT]);
    projectProviderPolicyGet.mockResolvedValue({ allow: null, deny: [] });
    useStore.setState({
      toasts: [],
      starredProjects: [{ path: OPEN, name: 'project-open', starredAt: 1 }],
    });
  });

  it('never offers an unattended mode', async () => {
    supervisorPolicyGet.mockResolvedValue({ policy: allowedWith({}), rejected: [] });
    await renderLoaded();
    const select = screen.getByTestId(`supervisor-permission-${OPEN}-agy`);
    const values = Array.from(select.querySelectorAll('option:not([disabled])')).map(
      (o) => (o as HTMLOptionElement).value
    );
    expect(values).toEqual(['plan']);
  });

  it('asks for an attended mode when the provider default skips prompts, and blocks Save until then', async () => {
    supervisorPolicyGet.mockResolvedValue({ policy: allowedWith({}), rejected: [] });
    await renderLoaded();
    fireEvent.change(screen.getByTestId('supervisor-max-children'), { target: { value: '7' } });

    expect(screen.getByTestId(`supervisor-unattended-${OPEN}-agy`)).toHaveTextContent(
      /Antigravity.*Auto.*without asking/
    );
    const save = screen.getByTestId('supervisor-save');
    expect(save).toBeDisabled();
    expect(screen.getByTestId('supervisor-save-hint')).toHaveTextContent(/pick a permission mode/i);

    fireEvent.change(screen.getByTestId(`supervisor-permission-${OPEN}-agy`), {
      target: { value: 'plan' },
    });
    expect(screen.queryByTestId(`supervisor-unattended-${OPEN}-agy`)).toBeNull();
    expect(save).toBeEnabled();
    fireEvent.click(save);
    await waitFor(() => expect(supervisorPolicySet).toHaveBeenCalledTimes(1));
    const saved = supervisorPolicySet.mock.calls[0][0] as SupervisorPolicy;
    expect(saved.projects[OPEN].permissionMode).toEqual({
      agy: 'plan',
    });
  });

  it('does not block Save for a deselected provider', async () => {
    supervisorPolicyGet.mockResolvedValue({
      policy: allowedWith({ providers: ['claude'] }),
      rejected: [],
    });
    await renderLoaded();
    fireEvent.change(screen.getByTestId('supervisor-max-children'), { target: { value: '7' } });
    expect(screen.queryByTestId(`supervisor-unattended-${OPEN}-agy`)).toBeNull();
    expect(screen.getByTestId('supervisor-save')).toBeEnabled();
  });

  it('does not block Save for a project the supervisor may not use', async () => {
    supervisorPolicyGet.mockResolvedValue({
      policy: allowedWith({ allowed: false }),
      rejected: [],
    });
    await renderLoaded();
    fireEvent.change(screen.getByTestId('supervisor-max-children'), { target: { value: '7' } });
    expect(screen.getByTestId('supervisor-save')).toBeEnabled();
  });

  it("does not block Save for a provider the project's own rules deny", async () => {
    projectProviderPolicyGet.mockResolvedValue({ allow: null, deny: ['agy'] });
    supervisorPolicyGet.mockResolvedValue({ policy: allowedWith({}), rejected: [] });
    await renderLoaded();
    fireEvent.change(screen.getByTestId('supervisor-max-children'), { target: { value: '7' } });
    expect(screen.getByTestId('supervisor-save')).toBeEnabled();
  });
});
