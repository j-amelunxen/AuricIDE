import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickAccessSettingsDialog } from './QuickAccessSettingsDialog';
import { useStore } from '@/lib/store';
import { getGlyph } from '@/lib/icons/registry';
import type { ProjectSkill } from '@/lib/tauri/projectSkills';
import type { ProjectIconCandidate } from '@/lib/tauri/projectIcons';
import { clearImageIconCache } from '@/lib/quickAccess/imageIconCache';
import type { StarredProject } from '@/lib/store/starredProjectsSlice';

const mockListProjectSkills = vi.fn<() => Promise<ProjectSkill[]>>();
const mockFindProjectIconCandidates = vi.fn<() => Promise<ProjectIconCandidate[]>>();
const mockReadImageAsDataUri = vi.fn<() => Promise<string | null>>();

vi.mock('@/lib/tauri/projectSkills', () => ({
  listProjectSkills: () => mockListProjectSkills(),
}));

vi.mock('@/lib/tauri/projectIcons', () => ({
  findProjectIconCandidates: () => mockFindProjectIconCandidates(),
  readImageAsDataUri: () => mockReadImageAsDataUri(),
}));

const candidate = (overrides: Partial<ProjectIconCandidate>): ProjectIconCandidate => ({
  path: '/a/website/public/favicon.ico',
  relativePath: 'public/favicon.ico',
  fileName: 'favicon.ico',
  sizeBytes: 4286,
  ...overrides,
});

vi.mock('@/lib/tauri/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/providers')>();
  return {
    ...actual,
    listProviders: async () => [
      {
        id: 'claude',
        name: 'Claude',
        models: [
          { value: 'opus', label: 'Opus' },
          { value: 'sonnet', label: 'Sonnet' },
        ],
        permissionModes: [{ value: 'plan', label: 'Plan' }],
        defaultModel: 'sonnet',
        defaultPermissionMode: 'plan',
      },
      {
        id: 'crush',
        name: 'Crush',
        models: [{ value: 'auto', label: 'Auto' }],
        permissionModes: [{ value: 'default', label: 'Default' }],
        defaultModel: 'auto',
        defaultPermissionMode: 'default',
      },
    ],
  };
});

const website: StarredProject = { path: '/a/website', name: 'website', starredAt: 1 };

const discovery = (overrides: Partial<ProjectSkill>): ProjectSkill => ({
  invocation: '/changelog',
  name: 'Changelog',
  description: 'Summarises recent changes',
  source: 'skill',
  scope: 'user',
  path: '/Users/dev/.claude/skills/changelog/SKILL.md',
  sourceId: 'claude',
  ...overrides,
});

function renderDialog(project: StarredProject = website, onClose = vi.fn()) {
  useStore.setState({ starredProjects: [project] });
  render(<QuickAccessSettingsDialog project={project} onClose={onClose} />);
  return onClose;
}

describe('QuickAccessSettingsDialog', () => {
  beforeEach(() => {
    mockListProjectSkills.mockResolvedValue([]);
    mockFindProjectIconCandidates.mockResolvedValue([]);
    mockReadImageAsDataUri.mockResolvedValue('data:image/x-icon;base64,AAA');
    // The cache is module state and would leak a previous test's answer.
    clearImageIconCache();
    useStore.setState({ starredProjects: [], overlayStack: { layers: [] } });
  });

  afterEach(() => {
    useStore.setState({ overlayStack: { layers: [] } });
  });

  it('names the dialog after the project it edits', () => {
    renderDialog();
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveTextContent('website');
  });

  it('closes on Escape when nothing was edited', () => {
    const onClose = renderDialog();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('asks before discarding unsaved edits', () => {
    const onClose = renderDialog();
    fireEvent.click(screen.getByRole('radio', { name: 'rocket launch' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByText(/discard changes/i)).toBeInTheDocument();
  });

  describe('icon', () => {
    it('previews a glyph the moment it is picked', () => {
      renderDialog();
      fireEvent.click(screen.getByRole('radio', { name: 'rocket launch' }));
      expect(screen.getByTestId('tile-face-/a/website')).toHaveAttribute('data-icon-kind', 'glyph');
    });

    it('replaces a glyph when an emoji is picked', () => {
      renderDialog();
      fireEvent.click(screen.getByRole('radio', { name: 'rocket launch' }));
      fireEvent.click(screen.getByTestId('quick-access-icon-emoji'));
      fireEvent.click(screen.getByRole('button', { name: 'test' }));
      expect(screen.getByTestId('tile-face-/a/website')).toHaveAttribute('data-icon-kind', 'emoji');
    });

    it('saves the emoji that was picked', () => {
      renderDialog();
      fireEvent.click(screen.getByTestId('quick-access-icon-emoji'));
      fireEvent.click(screen.getByRole('button', { name: 'rocket' }));
      fireEvent.click(screen.getByTestId('quick-access-settings-save'));
      expect(useStore.getState().starredProjects[0].icon).toEqual({
        kind: 'emoji',
        value: '🚀',
      });
    });

    it('resets to the generated initials', () => {
      renderDialog({ ...website, icon: { kind: 'emoji', value: '🚀' } });
      fireEvent.click(screen.getByTestId('quick-access-icon-reset'));
      expect(screen.getByTestId('tile-face-/a/website')).toHaveAttribute(
        'data-icon-kind',
        'initials'
      );
    });

    it('only offers glyphs the registry can draw', () => {
      renderDialog();
      const unresolvable = screen
        .getAllByRole('radio')
        .map((el) => el.querySelector('[data-icon]')?.getAttribute('data-icon'))
        .filter((name) => !name || !getGlyph(name));
      expect(unresolvable).toEqual([]);
    });

    it('moves through the glyph grid with the arrow keys', () => {
      renderDialog();
      const radios = screen.getAllByRole('radio');
      radios[0].focus();
      fireEvent.keyDown(radios[0], { key: 'ArrowRight' });
      expect(document.activeElement).toBe(radios[1]);
    });
  });

  describe('emoji picker', () => {
    const openPicker = () => fireEvent.click(screen.getByTestId('quick-access-icon-emoji'));

    it('stays closed until asked for', () => {
      renderDialog();
      expect(screen.queryByTestId('quick-access-emoji-panel')).not.toBeInTheDocument();
    });

    it('opens a browsable palette', () => {
      renderDialog();
      openPicker();
      expect(screen.getByTestId('quick-access-emoji-panel')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'rocket' })).toBeInTheDocument();
    });

    it('filters the palette by keyword', () => {
      renderDialog();
      openPicker();
      fireEvent.change(screen.getByTestId('quick-access-emoji-search'), {
        target: { value: 'bug' },
      });
      expect(screen.getByRole('button', { name: 'bug' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'rocket' })).not.toBeInTheDocument();
    });

    // The palette is curated, so the escape hatch has to actually work.
    it('offers a pasted emoji the palette has never heard of', () => {
      renderDialog();
      openPicker();
      fireEvent.change(screen.getByTestId('quick-access-emoji-search'), {
        target: { value: '🦕' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'pasted' }));
      expect(screen.getByTestId('tile-face-/a/website')).toHaveTextContent('🦕');
    });

    it('says so when a search matches nothing', () => {
      renderDialog();
      openPicker();
      fireEvent.change(screen.getByTestId('quick-access-emoji-search'), {
        target: { value: 'zzzznope' },
      });
      expect(screen.getByText(/nothing matches/i)).toBeInTheDocument();
    });

    it('closes after picking and shows the choice on the trigger', () => {
      renderDialog();
      openPicker();
      fireEvent.click(screen.getByRole('button', { name: 'rocket' }));
      expect(screen.queryByTestId('quick-access-emoji-panel')).not.toBeInTheDocument();
      expect(screen.getByTestId('quick-access-icon-emoji')).toHaveTextContent('🚀');
    });

    // The first Escape belongs to the thing that just opened, not the dialog.
    it('closes the palette on Escape without closing the dialog', () => {
      const onClose = renderDialog();
      openPicker();
      fireEvent.keyDown(screen.getByTestId('quick-access-emoji-panel'), { key: 'Escape' });
      expect(screen.queryByTestId('quick-access-emoji-panel')).not.toBeInTheDocument();
      expect(onClose).not.toHaveBeenCalled();
    });

    it('clears the emoji back to the generated tile', () => {
      renderDialog({ ...website, icon: { kind: 'emoji', value: '🚀' } });
      fireEvent.click(screen.getByTestId('quick-access-icon-emoji-clear'));
      expect(screen.getByTestId('tile-face-/a/website')).toHaveAttribute(
        'data-icon-kind',
        'initials'
      );
    });

    it('moves through the palette with the arrow keys', () => {
      renderDialog();
      openPicker();
      const cells = screen
        .getByTestId('quick-access-emoji-panel')
        .querySelectorAll<HTMLButtonElement>('[data-emoji-cell]');
      cells[0].focus();
      fireEvent.keyDown(cells[0], { key: 'ArrowRight' });
      expect(document.activeElement).toBe(cells[1]);
    });
  });

  describe('favicon finder', () => {
    it('does not scan until asked', () => {
      renderDialog();
      expect(mockFindProjectIconCandidates).not.toHaveBeenCalled();
    });

    it('lists what it found, best first', async () => {
      mockFindProjectIconCandidates.mockResolvedValue([
        candidate({ relativePath: 'public/favicon.ico', fileName: 'favicon.ico' }),
        candidate({
          path: '/a/website/docs/logo.png',
          relativePath: 'docs/logo.png',
          fileName: 'logo.png',
        }),
      ]);
      renderDialog();
      fireEvent.click(screen.getByTestId('quick-access-find-favicon'));
      const results = await screen.findByTestId('quick-access-favicon-results');
      expect(results).toHaveTextContent('favicon.ico');
      expect(results).toHaveTextContent('docs/logo.png');
    });

    it('sets a chosen favicon as the tile icon', async () => {
      mockFindProjectIconCandidates.mockResolvedValue([candidate({})]);
      renderDialog();
      fireEvent.click(screen.getByTestId('quick-access-find-favicon'));
      fireEvent.click(await screen.findByRole('button', { name: /favicon\.ico/ }));

      await waitFor(() =>
        expect(screen.getByTestId('tile-face-/a/website')).toHaveAttribute(
          'data-icon-kind',
          'image'
        )
      );

      fireEvent.click(screen.getByTestId('quick-access-settings-save'));
      expect(useStore.getState().starredProjects[0].icon).toEqual({
        kind: 'image',
        value: '/a/website/public/favicon.ico',
      });
    });

    it('says so when the project has no icon to find', async () => {
      mockFindProjectIconCandidates.mockResolvedValue([]);
      renderDialog();
      fireEvent.click(screen.getByTestId('quick-access-find-favicon'));
      expect(await screen.findByText(/no favicon or logo found/i)).toBeInTheDocument();
    });

    // A favicon that moved must leave the tile as it was, not broken.
    it('falls back to the initials when the stored image cannot be read', async () => {
      mockReadImageAsDataUri.mockResolvedValue(null);
      renderDialog({ ...website, icon: { kind: 'image', value: '/gone/favicon.ico' } });
      await waitFor(() =>
        expect(screen.getByTestId('tile-face-/a/website')).toHaveAttribute(
          'data-icon-kind',
          'initials'
        )
      );
    });
  });

  describe('skills', () => {
    it('adds a row and focuses its name field', () => {
      renderDialog();
      fireEvent.click(screen.getByTestId('quick-access-add-skill'));
      expect(document.activeElement).toBe(screen.getByLabelText('Skill 1 name'));
    });

    it('announces every list mutation', () => {
      renderDialog();
      fireEvent.click(screen.getByTestId('quick-access-add-skill'));
      expect(screen.getByRole('status')).toHaveTextContent(/added skill 1/i);
    });

    it('reorders skills', () => {
      renderDialog({
        ...website,
        skills: [
          { id: 'a', label: 'First', prompt: '/a' },
          { id: 'b', label: 'Second', prompt: '/b' },
        ],
      });
      fireEvent.click(screen.getByRole('button', { name: 'Move Second up' }));
      expect(screen.getByLabelText('Skill 1 name')).toHaveValue('Second');
    });

    it('removes a skill', () => {
      renderDialog({ ...website, skills: [{ id: 'a', label: 'First', prompt: '/a' }] });
      fireEvent.click(screen.getByRole('button', { name: 'Remove First' }));
      expect(screen.queryByLabelText('Skill 1 name')).not.toBeInTheDocument();
    });

    it('lists the models of the selected provider', async () => {
      renderDialog({ ...website, skills: [{ id: 'a', label: 'First', prompt: '/a' }] });
      await waitFor(() =>
        expect(screen.getByLabelText('Skill 1 provider')).toHaveTextContent('Claude')
      );
      fireEvent.change(screen.getByLabelText('Skill 1 provider'), { target: { value: 'claude' } });
      expect(screen.getByLabelText('Skill 1 model')).toHaveTextContent('Opus');
    });

    it('disables model and permission until a provider is chosen', async () => {
      renderDialog({ ...website, skills: [{ id: 'a', label: 'First', prompt: '/a' }] });
      await waitFor(() =>
        expect(screen.getByLabelText('Skill 1 provider')).toHaveTextContent('Claude')
      );
      expect(screen.getByLabelText('Skill 1 model')).toBeDisabled();
      expect(screen.getByLabelText('Skill 1 permission mode')).toBeDisabled();
    });

    // Carrying a Claude model id over to Crush only produces a preset that
    // degrades again at launch time.
    it('clears the model when the provider changes', async () => {
      renderDialog({
        ...website,
        skills: [{ id: 'a', label: 'First', prompt: '/a', providerId: 'claude', model: 'opus' }],
      });
      await waitFor(() => expect(screen.getByLabelText('Skill 1 model')).toHaveValue('opus'));
      fireEvent.change(screen.getByLabelText('Skill 1 provider'), { target: { value: 'crush' } });
      expect(screen.getByLabelText('Skill 1 model')).toHaveValue('');
    });
  });

  describe('discovery', () => {
    it('groups project skills above user skills', async () => {
      mockListProjectSkills.mockResolvedValue([
        discovery({ scope: 'user', name: 'User One', invocation: '/user-one', path: '/u1' }),
        discovery({ scope: 'project', name: 'Repo One', invocation: '/repo-one', path: '/p1' }),
      ]);
      renderDialog();
      await screen.findByTestId('quick-access-discovery-project');
      const groups = screen.getAllByTestId(/^quick-access-discovery-(project|user)$/);
      expect(groups[0]).toHaveAttribute('data-testid', 'quick-access-discovery-project');
      expect(groups[1]).toHaveAttribute('data-testid', 'quick-access-discovery-user');
    });

    it('hides a group with nothing in it', async () => {
      mockListProjectSkills.mockResolvedValue([discovery({ scope: 'user' })]);
      renderDialog();
      await screen.findByTestId('quick-access-discovery-user');
      expect(screen.queryByTestId('quick-access-discovery-project')).not.toBeInTheDocument();
    });

    it('adopts a discovered skill with its invocation as the prompt', async () => {
      mockListProjectSkills.mockResolvedValue([discovery({})]);
      renderDialog();
      fireEvent.click(await screen.findByRole('button', { name: 'Add Changelog' }));
      expect(screen.getByLabelText('Skill 1 name')).toHaveValue('Changelog');
      expect(screen.getByLabelText('Skill 1 prompt')).toHaveValue('/changelog');
    });

    it('marks an already adopted entry as added', async () => {
      mockListProjectSkills.mockResolvedValue([discovery({})]);
      renderDialog({
        ...website,
        skills: [{ id: 'a', label: 'Changelog', prompt: '/changelog', invocation: '/changelog' }],
      });
      expect(await screen.findByRole('button', { name: /changelog added/i })).toBeDisabled();
    });

    it('stays quiet when the discovery command is unavailable', async () => {
      mockListProjectSkills.mockResolvedValue([]);
      renderDialog();
      expect(await screen.findByText(/nothing found/i)).toBeInTheDocument();
    });
  });

  describe('completion', () => {
    const type = (label: string, value: string) =>
      fireEvent.change(screen.getByLabelText(label), { target: { value } });

    it('completes a prompt from the skills found on disk', async () => {
      mockListProjectSkills.mockResolvedValue([discovery({})]);
      renderDialog({ ...website, skills: [{ id: 'a', label: '', prompt: '' }] });
      await screen.findByTestId('quick-access-discovery');

      type('Skill 1 prompt', '/change');
      expect(screen.getByRole('option', { name: /changelog/i })).toBeInTheDocument();
    });

    it('fills in the name of a picked skill when none was typed', async () => {
      mockListProjectSkills.mockResolvedValue([discovery({})]);
      renderDialog({ ...website, skills: [{ id: 'a', label: '', prompt: '' }] });
      await screen.findByTestId('quick-access-discovery');

      type('Skill 1 prompt', '/change');
      fireEvent.mouseDown(screen.getByRole('option', { name: /changelog/i }));

      expect(screen.getByLabelText('Skill 1 prompt')).toHaveValue('/changelog');
      expect(screen.getByLabelText('Skill 1 name')).toHaveValue('Changelog');
    });

    it('never overwrites a name the user already chose', async () => {
      mockListProjectSkills.mockResolvedValue([discovery({})]);
      renderDialog({ ...website, skills: [{ id: 'a', label: 'My own name', prompt: '' }] });
      await screen.findByTestId('quick-access-discovery');

      type('Skill 1 prompt', '/change');
      fireEvent.mouseDown(screen.getByRole('option', { name: /changelog/i }));

      expect(screen.getByLabelText('Skill 1 name')).toHaveValue('My own name');
    });

    it('completes combo steps the same way', async () => {
      mockListProjectSkills.mockResolvedValue([discovery({})]);
      renderDialog({
        ...website,
        combos: [{ id: 'c1', label: 'Draft run', steps: [{ id: 's1', label: '', prompt: '' }] }],
      });
      await screen.findByTestId('quick-access-discovery');

      type('Combo 1 step 1 prompt', '/change');
      fireEvent.mouseDown(screen.getByRole('option', { name: /changelog/i }));

      expect(screen.getByLabelText('Combo 1 step 1 prompt')).toHaveValue('/changelog');
      expect(screen.getByLabelText('Combo 1 step 1 name')).toHaveValue('Changelog');
    });

    it('names combo steps apart from the loose skills, so no two fields share a label', () => {
      renderDialog({
        ...website,
        skills: [{ id: 'a', label: 'Loose', prompt: '/a' }],
        combos: [{ id: 'c1', label: 'Chain', steps: [{ id: 's1', label: 'Step', prompt: '/s' }] }],
      });
      expect(screen.getAllByLabelText('Skill 1 prompt')).toHaveLength(1);
      expect(screen.getByLabelText('Combo 1 step 1 prompt')).toHaveValue('/s');
    });

    it('lists what is on disk once, not again inside every combo', async () => {
      mockListProjectSkills.mockResolvedValue([discovery({})]);
      renderDialog({
        ...website,
        combos: [{ id: 'c1', label: 'Chain', steps: [{ id: 's1', label: 'Step', prompt: '/s' }] }],
      });
      await screen.findByTestId('quick-access-discovery');
      expect(screen.getAllByTestId('quick-access-discovery')).toHaveLength(1);
    });
  });

  describe('saving', () => {
    it('writes the settings for this project only on Save', () => {
      const onClose = renderDialog();
      fireEvent.click(screen.getByRole('radio', { name: 'rocket launch' }));
      expect(useStore.getState().starredProjects[0].icon).toBeUndefined();

      fireEvent.click(screen.getByTestId('quick-access-settings-save'));

      expect(useStore.getState().starredProjects[0].icon).toEqual({
        kind: 'glyph',
        value: 'rocket_launch',
      });
      expect(onClose).toHaveBeenCalled();
    });

    it('trims what it saves', () => {
      renderDialog({
        ...website,
        skills: [{ id: 'a', label: '  Draft  ', prompt: '  /change  ' }],
      });
      fireEvent.click(screen.getByTestId('quick-access-settings-save'));
      expect(useStore.getState().starredProjects[0].skills?.[0]).toMatchObject({
        label: 'Draft',
        prompt: '/change',
      });
    });

    it('refuses to save a skill without a name or a prompt', () => {
      renderDialog();
      fireEvent.click(screen.getByTestId('quick-access-add-skill'));
      expect(screen.getByTestId('quick-access-settings-save')).toBeDisabled();
      expect(screen.getByText(/every skill needs a name and a prompt/i)).toBeInTheDocument();
    });

    it('writes a combo on Save', () => {
      renderDialog();
      fireEvent.click(screen.getByTestId('quick-access-add-combo'));
      fireEvent.change(screen.getByLabelText(/combo 1 name/i), {
        target: { value: 'Draft and polish' },
      });
      fireEvent.click(screen.getByRole('button', { name: /add step/i }));
      fireEvent.change(screen.getByLabelText('Combo 1 step 1 name'), {
        target: { value: 'Draft' },
      });
      fireEvent.change(screen.getByLabelText('Combo 1 step 1 prompt'), {
        target: { value: '/finalize' },
      });
      fireEvent.click(screen.getByRole('button', { name: /add step/i }));
      fireEvent.change(screen.getByLabelText('Combo 1 step 2 name'), {
        target: { value: 'Rewrite' },
      });
      fireEvent.change(screen.getByLabelText('Combo 1 step 2 prompt'), {
        target: { value: '/rewrite' },
      });
      fireEvent.click(screen.getByTestId('quick-access-settings-save'));
      const [saved] = useStore.getState().starredProjects[0].combos ?? [];
      expect(saved.label).toBe('Draft and polish');
      expect(saved.steps.map((step) => step.label)).toEqual(['Draft', 'Rewrite']);
    });

    it('refuses to save a combo without two complete steps', () => {
      renderDialog();
      fireEvent.click(screen.getByTestId('quick-access-add-combo'));
      fireEvent.change(screen.getByLabelText(/combo 1 name/i), {
        target: { value: 'Draft and polish' },
      });
      expect(screen.getByTestId('quick-access-settings-save')).toBeDisabled();
      expect(
        screen.getByText(/every combo needs a name and at least two complete steps/i)
      ).toBeInTheDocument();
    });

    it('shows the plus preview of the combo steps', () => {
      renderDialog({
        ...website,
        combos: [
          {
            id: 'c1',
            label: 'Draft and polish',
            steps: [
              { id: 's1', label: 'Draft', prompt: '/finalize' },
              { id: 's2', label: 'Rewrite', prompt: '/rewrite' },
            ],
          },
        ],
      });
      expect(screen.getByTestId('quick-access-combo-preview-c1')).toHaveTextContent(
        'Draft + Rewrite'
      );
    });

    it('discards edits on Cancel', () => {
      renderDialog();
      fireEvent.click(screen.getByRole('radio', { name: 'rocket launch' }));
      fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
      expect(useStore.getState().starredProjects[0].icon).toBeUndefined();
    });
  });
});
