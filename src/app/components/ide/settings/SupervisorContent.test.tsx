import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  defaultSupervisorProjectPolicy,
  emptySupervisorPolicy,
  type SupervisorPolicy,
} from '@/lib/config/supervisorPolicy';
import { useStore } from '@/lib/store';
import type { ProviderInfo } from '@/lib/tauri/providers';
import { SupervisorContent } from './SupervisorContent';

const {
  supervisorPolicyGet,
  supervisorPolicySet,
  supervisorResolveTool,
  projectProviderPolicyGet,
  listProviders,
} = vi.hoisted(() => ({
  supervisorResolveTool: vi.fn(async () => '/opt/homebrew/bin/umi'),
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

vi.mock('@/lib/tauri/supervisorPolicy', () => ({
  supervisorPolicyGet,
  supervisorPolicySet,
  supervisorResolveTool,
}));
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
          providerWeights: {},
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

  it('loads, edits and saves the standing instructions without touching the policy file', async () => {
    localStorage.setItem('auric.supervisor.instructions', 'Answer in German.');
    await renderLoaded();
    const field = screen.getByTestId('supervisor-instructions') as HTMLTextAreaElement;
    expect(field.value).toBe('Answer in German.');
    expect(screen.getByTestId('supervisor-save')).toBeDisabled();

    fireEvent.change(field, { target: { value: 'Prefer small models.' } });
    expect(screen.getByTestId('supervisor-save-hint')).toHaveTextContent('Unsaved changes');
    fireEvent.click(screen.getByTestId('supervisor-save'));

    await waitFor(() =>
      expect(localStorage.getItem('auric.supervisor.instructions')).toBe('Prefer small models.')
    );
    expect(supervisorPolicySet).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.getByTestId('supervisor-save')).toBeDisabled());
    localStorage.removeItem('auric.supervisor.instructions');
  });

  it('edits the description the supervisor reads in list_projects, on Save only', async () => {
    const setStarredProjectDescription = vi.fn();
    useStore.setState({
      setStarredProjectDescription,
      starredProjects: [
        { path: OPEN, name: 'project-open', starredAt: 1, description: 'Old words' },
        { path: CLOSED, name: 'project-closed', starredAt: 2 },
      ],
    });
    await renderLoaded();
    fireEvent.click(screen.getByTestId(`supervisor-allowed-${OPEN}`));
    const field = screen.getByTestId(`supervisor-description-${OPEN}`) as HTMLTextAreaElement;
    expect(field.value).toBe('Old words');

    fireEvent.change(field, { target: { value: 'The marketing site of the shop' } });
    expect(setStarredProjectDescription).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('supervisor-save'));

    await waitFor(() =>
      expect(setStarredProjectDescription).toHaveBeenCalledWith(
        OPEN,
        'The marketing site of the shop'
      )
    );
    expect(setStarredProjectDescription).toHaveBeenCalledTimes(1);
  });

  it('saves a description alone without writing the policy file, and discards it', async () => {
    const setStarredProjectDescription = vi.fn();
    supervisorPolicyGet.mockResolvedValue({
      policy: policy({
        [OPEN]: { ...defaultSupervisorProjectPolicy(), allowed: true },
      }),
      rejected: [],
    });
    useStore.setState({ setStarredProjectDescription });
    await renderLoaded();
    const field = screen.getByTestId(`supervisor-description-${OPEN}`) as HTMLTextAreaElement;

    fireEvent.change(field, { target: { value: 'typed' } });
    fireEvent.click(screen.getByText('Discard changes'));
    expect(field.value).toBe('');

    fireEvent.change(field, { target: { value: 'kept' } });
    fireEvent.click(screen.getByTestId('supervisor-save'));
    await waitFor(() => expect(setStarredProjectDescription).toHaveBeenCalledWith(OPEN, 'kept'));
    expect(supervisorPolicySet).not.toHaveBeenCalled();
  });

  it('removes the stored instructions when the field is cleared', async () => {
    localStorage.setItem('auric.supervisor.instructions', 'Answer in German.');
    await renderLoaded();
    fireEvent.change(screen.getByTestId('supervisor-instructions'), { target: { value: '  ' } });
    fireEvent.click(screen.getByTestId('supervisor-save'));
    await waitFor(() => expect(localStorage.getItem('auric.supervisor.instructions')).toBeNull());
  });

  it('allows selecting multiple candidate providers and saves them in policy', async () => {
    await renderLoaded();
    const claudeCheckbox = screen.getByTestId('supervisor-provider-candidate-claude');
    const codexCheckbox = screen.getByTestId('supervisor-provider-candidate-codex');

    expect(claudeCheckbox).toBeChecked();
    expect(claudeCheckbox).toBeDisabled(); // Cannot uncheck the only selected provider
    expect(codexCheckbox).not.toBeChecked();

    fireEvent.click(codexCheckbox);
    expect(codexCheckbox).toBeChecked();
    expect(claudeCheckbox).not.toBeDisabled();

    fireEvent.click(screen.getByTestId('supervisor-save'));
    await waitFor(() => expect(supervisorPolicySet).toHaveBeenCalledTimes(1));
    const saved = supervisorPolicySet.mock.calls[0][0] as SupervisorPolicy;
    expect(saved.supervisor.providers).toEqual(['claude', 'codex']);
  });

  it('supports provider-specific instructions tabs when multiple providers are active', async () => {
    supervisorPolicyGet.mockResolvedValue({
      policy: {
        ...policy(),
        supervisor: {
          provider: 'claude',
          providers: ['claude', 'codex'],
          model: null,
          chrome: false,
        },
      },
      rejected: [],
    });
    localStorage.setItem(
      'auric.supervisor.instructions',
      JSON.stringify({ claude: 'Claude instructions' })
    );

    await renderLoaded();

    // Verify both tabs are visible
    const claudeTab = screen.getByTestId('supervisor-instructions-tab-claude');
    const codexTab = screen.getByTestId('supervisor-instructions-tab-codex');
    expect(claudeTab).toBeInTheDocument();
    expect(codexTab).toBeInTheDocument();

    // Claude instructions are initially loaded
    const textarea = screen.getByTestId('supervisor-instructions') as HTMLTextAreaElement;
    expect(textarea.value).toBe('Claude instructions');

    // Switch to Codex tab and enter Codex instructions
    fireEvent.click(codexTab);
    expect(textarea.value).toBe('');
    fireEvent.change(textarea, { target: { value: 'Codex instructions' } });

    // Save and verify stored preference is updated map
    fireEvent.click(screen.getByTestId('supervisor-save'));
    await waitFor(() => {
      const stored = localStorage.getItem('auric.supervisor.instructions');
      expect(stored).not.toBeNull();
      const parsed = JSON.parse(stored!);
      expect(parsed).toEqual({
        claude: 'Claude instructions',
        codex: 'Codex instructions',
      });
    });
  });

  it('sets a load-balancing share per provider and states the split it makes', async () => {
    projectProviderPolicyGet.mockResolvedValue({ allow: null, deny: [] });
    await renderLoaded();
    fireEvent.click(screen.getByTestId(`supervisor-allowed-${OPEN}`));
    expect(screen.getByTestId(`supervisor-balancing-${OPEN}`)).toHaveTextContent(
      'No load balancing'
    );
    fireEvent.change(screen.getByTestId(`supervisor-weight-${OPEN}-claude`), {
      target: { value: '2' },
    });
    fireEvent.change(screen.getByTestId(`supervisor-weight-${OPEN}-codex`), {
      target: { value: '1' },
    });
    expect(screen.getByTestId(`supervisor-balancing-${OPEN}`)).toHaveTextContent(
      'Claude Code 67 % · Codex 33 %'
    );
    fireEvent.change(screen.getByTestId(`supervisor-weight-${OPEN}-codex`), {
      target: { value: '' },
    });
    expect(screen.getByTestId(`supervisor-balancing-${OPEN}`)).toHaveTextContent(
      'Claude Code 100 % · Codex 0 %'
    );

    fireEvent.click(screen.getByTestId('supervisor-save'));
    await waitFor(() => expect(supervisorPolicySet).toHaveBeenCalledTimes(1));
    expect(supervisorPolicySet.mock.calls[0][0]).toMatchObject({
      projects: { [OPEN]: { providerWeights: { claude: 2 } } },
    });
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

  it('saves an allowed tool with the policy, and blocks Save on a folder Rust would refuse', async () => {
    await renderLoaded();
    fireEvent.change(screen.getByTestId('supervisor-tool-name'), { target: { value: 'umi' } });
    fireEvent.click(screen.getByTestId('supervisor-tool-add'));
    const folders = await screen.findByLabelText(/Extra folders/);
    fireEvent.change(folders, { target: { value: 'relative' } });
    expect(screen.getByTestId('supervisor-save')).toBeDisabled();
    expect(screen.getByTestId('supervisor-save')).toHaveAttribute(
      'title',
      'Fix the entry marked under Tools'
    );

    fireEvent.change(folders, { target: { value: '/abs/data' } });
    fireEvent.click(screen.getByTestId('supervisor-save'));
    await waitFor(() => expect(supervisorPolicySet).toHaveBeenCalledTimes(1));
    expect(supervisorPolicySet).toHaveBeenCalledWith({
      ...emptySupervisorPolicy(),
      tools: { umi: { dirs: ['/abs/data'] } },
    });
  });

  it('names a rejected tool entry by its key', async () => {
    supervisorPolicyGet.mockResolvedValue({
      policy: policy(),
      rejected: [{ project: null, tool: 'umi; rm', reason: 'invalid_entry' }],
    });
    await renderLoaded();
    expect(screen.getByTestId('supervisor-rejected')).toHaveTextContent('umi; rm');
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
        providerWeights: {},
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
