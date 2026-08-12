import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickAccess } from './QuickAccess';
import { useStore } from '@/lib/store';

describe('QuickAccess', () => {
  beforeEach(() => {
    useStore.setState({ starredProjects: [], toasts: [] });
  });

  it('renders a tile for each starred project, sorted alphabetically by name', () => {
    useStore.setState({
      starredProjects: [
        { path: '/a/website', name: 'website', starredAt: 1 },
        { path: '/a/apps', name: 'apps', starredAt: 2 },
        { path: '/a/Backend', name: 'Backend', starredAt: 3 },
      ],
    });
    render(<QuickAccess currentPath="/a/apps" />);
    const tiles = screen.getAllByTestId(/^quick-access-tile-/);
    expect(tiles).toHaveLength(3);
    expect(tiles[0]).toHaveAttribute('data-testid', 'quick-access-tile-/a/apps');
    expect(tiles[1]).toHaveAttribute('data-testid', 'quick-access-tile-/a/Backend');
    expect(tiles[2]).toHaveAttribute('data-testid', 'quick-access-tile-/a/website');
  });

  it('keeps the alphabetical order regardless of when projects were starred', () => {
    useStore.setState({
      starredProjects: [
        { path: '/w/charlie-full', name: 'charlie-full', starredAt: 5 },
        { path: '/w/alpha-pipeline', name: 'alpha-pipeline', starredAt: 1 },
        { path: '/w/bravoFlow', name: 'bravoFlow', starredAt: 9 },
      ],
    });
    render(<QuickAccess currentPath={null} />);
    const tiles = screen.getAllByTestId(/^quick-access-tile-/);
    expect(tiles.map((t) => t.getAttribute('data-testid'))).toEqual([
      'quick-access-tile-/w/alpha-pipeline',
      'quick-access-tile-/w/bravoFlow',
      'quick-access-tile-/w/charlie-full',
    ]);
  });

  it('switches to a project when its tile is clicked', () => {
    const onSwitchProject = vi.fn();
    useStore.setState({
      starredProjects: [{ path: '/a/website', name: 'website', starredAt: 1 }],
    });
    render(<QuickAccess currentPath="/a/apps" onSwitchProject={onSwitchProject} />);
    fireEvent.click(screen.getByTestId('quick-access-tile-/a/website'));
    expect(onSwitchProject).toHaveBeenCalledWith('/a/website');
  });

  it('does not switch when clicking the already-active project', () => {
    const onSwitchProject = vi.fn();
    useStore.setState({
      starredProjects: [{ path: '/a/apps', name: 'apps', starredAt: 1 }],
    });
    render(<QuickAccess currentPath="/a/apps" onSwitchProject={onSwitchProject} />);
    fireEvent.click(screen.getByTestId('quick-access-tile-/a/apps'));
    expect(onSwitchProject).not.toHaveBeenCalled();
  });

  describe('unstarring (hold to confirm)', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: true });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('does not unstar on a quick tap — a tap alone must not remove the tile', async () => {
      useStore.setState({
        starredProjects: [{ path: '/a/website', name: 'website', starredAt: 1 }],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      const unstarBtn = screen.getByTestId('quick-access-unstar-/a/website');
      fireEvent.pointerDown(unstarBtn);
      fireEvent.pointerUp(unstarBtn);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(useStore.getState().starredProjects).toHaveLength(1);
    });

    it('cancels the hold when the pointer leaves before the threshold', async () => {
      useStore.setState({
        starredProjects: [{ path: '/a/website', name: 'website', starredAt: 1 }],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      const unstarBtn = screen.getByTestId('quick-access-unstar-/a/website');
      fireEvent.pointerDown(unstarBtn);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(200);
      });
      fireEvent.pointerLeave(unstarBtn);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(useStore.getState().starredProjects).toHaveLength(1);
    });

    it('unstars a project once the hold is sustained past the threshold', async () => {
      const onSwitchProject = vi.fn();
      useStore.setState({
        starredProjects: [{ path: '/a/website', name: 'website', starredAt: 1 }],
      });
      render(<QuickAccess currentPath="/a/apps" onSwitchProject={onSwitchProject} />);
      const unstarBtn = screen.getByTestId('quick-access-unstar-/a/website');
      fireEvent.pointerDown(unstarBtn);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(useStore.getState().starredProjects).toHaveLength(0);
      expect(onSwitchProject).not.toHaveBeenCalled();
    });

    it('supports the same hold-to-confirm via keyboard (Enter)', async () => {
      useStore.setState({
        starredProjects: [{ path: '/a/website', name: 'website', starredAt: 1 }],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      const unstarBtn = screen.getByTestId('quick-access-unstar-/a/website');
      fireEvent.keyDown(unstarBtn, { key: 'Enter' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });
      fireEvent.keyUp(unstarBtn, { key: 'Enter' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(useStore.getState().starredProjects).toHaveLength(1);

      fireEvent.keyDown(unstarBtn, { key: 'Enter' });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000);
      });
      expect(useStore.getState().starredProjects).toHaveLength(0);
    });
  });

  it('offers to star the current project when it is not yet starred', () => {
    render(<QuickAccess currentPath="/a/apps" />);
    fireEvent.click(screen.getByTestId('quick-access-add-current'));
    expect(useStore.getState().isProjectStarred('/a/apps')).toBe(true);
  });

  it('hides the star-current affordance once the current project is starred', () => {
    useStore.setState({
      starredProjects: [{ path: '/a/apps', name: 'apps', starredAt: 1 }],
    });
    render(<QuickAccess currentPath="/a/apps" />);
    expect(screen.queryByTestId('quick-access-add-current')).not.toBeInTheDocument();
  });

  it('hints at the hold-to-remove gesture once at least one project is starred', () => {
    useStore.setState({
      starredProjects: [{ path: '/a/apps', name: 'apps', starredAt: 1 }],
    });
    render(<QuickAccess currentPath="/a/apps" />);
    expect(screen.getByTestId('quick-access-hint')).toHaveTextContent(/hold/i);
  });

  it('does not show the hold-to-remove hint when nothing is starred yet', () => {
    render(<QuickAccess currentPath="/a/apps" />);
    expect(screen.queryByTestId('quick-access-hint')).not.toBeInTheDocument();
  });

  it('renders nothing meaningful — no tiles — when nothing is starred and no current project', () => {
    render(<QuickAccess currentPath={null} />);
    expect(screen.queryAllByTestId(/^quick-access-tile-/)).toHaveLength(0);
    expect(screen.queryByTestId('quick-access-add-current')).not.toBeInTheDocument();
  });

  describe('context menu — Start Agent', () => {
    beforeEach(() => {
      useStore.setState({
        spawnDialogOpen: false,
        spawnAgentRepoPath: null,
        spawnAgentTicketId: null,
        spawnAgentGoalId: null,
        initialAgentTask: '',
      });
    });

    it('opens a context menu with a Start Agent item on right-click', () => {
      useStore.setState({
        starredProjects: [{ path: '/a/website', name: 'website', starredAt: 1 }],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      fireEvent.contextMenu(screen.getByTestId('quick-access-tile-/a/website'));
      expect(screen.getByRole('menuitem', { name: /start agent/i })).toBeInTheDocument();
    });

    it("seeds the Spawn Agent dialog with the right-clicked project's path and opens it", () => {
      useStore.setState({
        starredProjects: [{ path: '/a/website', name: 'website', starredAt: 1 }],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      fireEvent.contextMenu(screen.getByTestId('quick-access-tile-/a/website'));
      fireEvent.click(screen.getByRole('menuitem', { name: /start agent/i }));
      expect(useStore.getState().spawnAgentRepoPath).toBe('/a/website');
      expect(useStore.getState().spawnDialogOpen).toBe(true);
    });

    it('clears stale ticket/goal context when starting an agent from Quick Access', () => {
      useStore.setState({
        starredProjects: [{ path: '/a/website', name: 'website', starredAt: 1 }],
        spawnAgentTicketId: 'tk-1',
        spawnAgentGoalId: 'goal-1',
        initialAgentTask: 'old task',
      });
      render(<QuickAccess currentPath="/a/apps" />);
      fireEvent.contextMenu(screen.getByTestId('quick-access-tile-/a/website'));
      fireEvent.click(screen.getByRole('menuitem', { name: /start agent/i }));
      expect(useStore.getState().spawnAgentTicketId).toBeNull();
      expect(useStore.getState().spawnAgentGoalId).toBeNull();
      expect(useStore.getState().initialAgentTask).toBe('');
      expect(useStore.getState().spawnAgentRepoPath).toBe('/a/website');
    });

    it("right-clicking one tile while another tile's menu is open replaces it, not stacks it", () => {
      useStore.setState({
        starredProjects: [
          { path: '/a/apps', name: 'apps', starredAt: 1 },
          { path: '/a/website', name: 'website', starredAt: 2 },
        ],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      fireEvent.contextMenu(screen.getByTestId('quick-access-tile-/a/apps'));
      fireEvent.contextMenu(screen.getByTestId('quick-access-tile-/a/website'));
      expect(screen.getAllByRole('menu')).toHaveLength(1);
      fireEvent.click(screen.getByRole('menuitem', { name: /start agent/i }));
      expect(useStore.getState().spawnAgentRepoPath).toBe('/a/website');
    });

    it('does not start the unstar hold-to-confirm gesture when right-clicking the tile', () => {
      useStore.setState({
        starredProjects: [{ path: '/a/website', name: 'website', starredAt: 1 }],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      fireEvent.contextMenu(screen.getByTestId('quick-access-tile-/a/website'));
      expect(screen.getByTestId('quick-access-unstar-/a/website')).toHaveAttribute(
        'data-holding',
        'false'
      );
    });

    it('does not attach a context menu to the star-current-project affordance', () => {
      render(<QuickAccess currentPath="/a/apps" />);
      fireEvent.contextMenu(screen.getByTestId('quick-access-add-current'));
      expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    });

    it('copies the working directory path to the clipboard via "Copy Working Directory"', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.assign(navigator, { clipboard: { writeText } });
      useStore.setState({
        starredProjects: [{ path: '/a/website', name: 'website', starredAt: 1 }],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      fireEvent.contextMenu(screen.getByTestId('quick-access-tile-/a/website'));
      fireEvent.click(screen.getByRole('menuitem', { name: /copy working directory/i }));
      expect(writeText).toHaveBeenCalledWith('/a/website');
      await waitFor(() => expect(useStore.getState().toasts[0]?.variant).toBe('success'));
    });

    it('says so when the copy fails instead of looking like it worked', async () => {
      Object.assign(navigator, {
        clipboard: { writeText: vi.fn().mockRejectedValue(new Error('denied')) },
      });
      useStore.setState({
        starredProjects: [{ path: '/a/website', name: 'website', starredAt: 1 }],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      fireEvent.contextMenu(screen.getByTestId('quick-access-tile-/a/website'));
      fireEvent.click(screen.getByRole('menuitem', { name: /copy working directory/i }));
      await waitFor(() => expect(useStore.getState().toasts[0]?.variant).toBe('error'));
    });

    it('says so when there is no clipboard to copy into', () => {
      // Insecure contexts (and jsdom) have no navigator.clipboard at all —
      // reaching for it unguarded throws inside the click handler.
      Object.assign(navigator, { clipboard: undefined });
      useStore.setState({
        starredProjects: [{ path: '/a/website', name: 'website', starredAt: 1 }],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      fireEvent.contextMenu(screen.getByTestId('quick-access-tile-/a/website'));
      fireEvent.click(screen.getByRole('menuitem', { name: /copy working directory/i }));
      expect(useStore.getState().toasts[0]?.variant).toBe('error');
    });
  });

  describe('context menu — skills', () => {
    const website = { path: '/a/website', name: 'website', starredAt: 1 };
    const changelog = {
      id: 's1',
      label: 'Changelog',
      prompt: '/changelog',
      providerId: 'claude',
      model: 'opus',
      permissionMode: 'plan' as const,
    };
    const seo = { id: 's2', label: 'SEO-Check', prompt: '/seo-check' };

    const openMenu = (path = '/a/website') =>
      fireEvent.contextMenu(screen.getByTestId(`quick-access-tile-${path}`));

    beforeEach(() => {
      useStore.setState({
        spawnDialogOpen: false,
        spawnAgentRepoPath: null,
        spawnAgentPreset: null,
        initialAgentTask: '',
      });
    });

    it('offers Quick Access Settings as the last entry', () => {
      useStore.setState({ starredProjects: [website] });
      render(<QuickAccess currentPath="/a/apps" />);
      openMenu();
      const items = screen.getAllByRole('menuitem');
      expect(items[items.length - 1]).toHaveTextContent(/quick access settings/i);
    });

    it('shows no skills section for a project that has none', () => {
      useStore.setState({ starredProjects: [website] });
      render(<QuickAccess currentPath="/a/apps" />);
      openMenu();
      expect(screen.queryByText(/^skills$/i)).not.toBeInTheDocument();
    });

    it('lists the project skills above the built-in actions', () => {
      useStore.setState({ starredProjects: [{ ...website, skills: [changelog, seo] }] });
      render(<QuickAccess currentPath="/a/apps" />);
      openMenu();
      const labels = screen.getAllByRole('menuitem').map((el) => el.textContent);
      expect(labels.slice(0, 2)).toEqual(['Changelog', 'SEO-Check']);
      expect(screen.getByText('Skills')).toBeInTheDocument();
    });

    it('scopes the skills to the tile that was right-clicked', () => {
      useStore.setState({
        starredProjects: [
          { path: '/a/apps', name: 'apps', starredAt: 1, skills: [seo] },
          { ...website, skills: [changelog] },
        ],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      openMenu('/a/website');
      expect(screen.getByRole('menuitem', { name: 'Changelog' })).toBeInTheDocument();
      expect(screen.queryByRole('menuitem', { name: 'SEO-Check' })).not.toBeInTheDocument();
    });

    it('sends the overflow to the settings dialog rather than growing the menu', () => {
      const many = Array.from({ length: 12 }, (_, i) => ({
        id: `s${i}`,
        label: `Skill ${i}`,
        prompt: `/s${i}`,
      }));
      useStore.setState({ starredProjects: [{ ...website, skills: many }] });
      render(<QuickAccess currentPath="/a/apps" />);
      openMenu();
      expect(screen.getAllByRole('menuitem', { name: /^Skill \d+$/ })).toHaveLength(8);
      expect(screen.getByRole('menuitem', { name: /4 more/i })).toBeInTheDocument();
    });

    it('prefills the agent dialog with the skill prompt and working directory', () => {
      useStore.setState({ starredProjects: [{ ...website, skills: [changelog] }] });
      render(<QuickAccess currentPath="/a/apps" />);
      openMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Changelog' }));
      expect(useStore.getState().initialAgentTask).toBe('/changelog');
      expect(useStore.getState().spawnAgentRepoPath).toBe('/a/website');
      expect(useStore.getState().spawnDialogOpen).toBe(true);
    });

    it("carries the skill's provider, model and permission mode as a preset", () => {
      useStore.setState({ starredProjects: [{ ...website, skills: [changelog] }] });
      render(<QuickAccess currentPath="/a/apps" />);
      openMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Changelog' }));
      expect(useStore.getState().spawnAgentPreset).toEqual({
        providerId: 'claude',
        model: 'opus',
        permissionMode: 'plan',
      });
    });

    it('leaves the preset null for a skill that pins no provider', () => {
      useStore.setState({ starredProjects: [{ ...website, skills: [seo] }] });
      render(<QuickAccess currentPath="/a/apps" />);
      openMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: 'SEO-Check' }));
      expect(useStore.getState().spawnAgentPreset).toBeNull();
    });

    // Plain Start Agent must not inherit whatever a skill launched last.
    it('lists combos above skills and marks them with a plus', () => {
      const combo = {
        id: 'c1',
        label: 'Draft and polish',
        steps: [
          { id: 's1', label: 'Finalize', prompt: '/finalize' },
          { id: 's2', label: 'Rewrite', prompt: '/rewrite' },
        ],
      };
      useStore.setState({
        starredProjects: [{ ...website, skills: [changelog], combos: [combo] }],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      openMenu();
      const labels = screen.getAllByRole('menuitem').map((el) => el.textContent);
      expect(labels[0]).toBe('Draft and polish +');
      expect(screen.getByText('Combos')).toBeInTheDocument();
      expect(screen.getByRole('menuitem', { name: 'Changelog' })).toBeInTheDocument();
    });

    it('starts a combo without opening the spawn dialog', () => {
      const startSkillCombo = vi.fn();
      const combo = {
        id: 'c1',
        label: 'Draft and polish',
        steps: [
          { id: 's1', label: 'Finalize', prompt: '/finalize' },
          { id: 's2', label: 'Rewrite', prompt: '/rewrite' },
        ],
      };
      useStore.setState({
        starredProjects: [{ ...website, combos: [combo] }],
        spawnDialogOpen: false,
        startSkillCombo,
      });
      render(<QuickAccess currentPath="/a/apps" />);
      openMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: 'Draft and polish +' }));
      expect(startSkillCombo).toHaveBeenCalledWith('/a/website', combo);
      expect(useStore.getState().spawnDialogOpen).toBe(false);
    });

    it('clears a stale preset when starting a plain agent', () => {
      useStore.setState({
        starredProjects: [website],
        spawnAgentPreset: { providerId: 'claude', model: 'opus' },
      });
      render(<QuickAccess currentPath="/a/apps" />);
      openMenu();
      fireEvent.click(screen.getByRole('menuitem', { name: /start agent/i }));
      expect(useStore.getState().spawnAgentPreset).toBeNull();
    });
  });

  describe('tile face', () => {
    it('draws a chosen glyph instead of the initials', () => {
      useStore.setState({
        starredProjects: [
          {
            path: '/a/website',
            name: 'website',
            starredAt: 1,
            icon: { kind: 'glyph', value: 'rocket_launch' },
          },
        ],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      const face = screen.getByTestId('tile-face-/a/website');
      expect(face).toHaveAttribute('data-icon-kind', 'glyph');
      expect(face.querySelector('[data-icon="rocket_launch"]')).toBeInTheDocument();
    });

    it('marks a tile with a plus when the project has a combo', () => {
      useStore.setState({
        starredProjects: [
          {
            path: '/a/website',
            name: 'website',
            starredAt: 1,
            combos: [
              {
                id: 'c1',
                label: 'Draft and polish',
                steps: [
                  { id: 's1', label: 'Finalize', prompt: '/finalize' },
                  { id: 's2', label: 'Rewrite', prompt: '/rewrite' },
                ],
              },
            ],
          },
        ],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      expect(screen.getByTestId('quick-access-combo-mark-/a/website')).toHaveTextContent('+');
    });

    it('draws a chosen emoji', () => {
      useStore.setState({
        starredProjects: [
          {
            path: '/a/website',
            name: 'website',
            starredAt: 1,
            icon: { kind: 'emoji', value: '🚀' },
          },
        ],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      const face = screen.getByTestId('tile-face-/a/website');
      expect(face).toHaveAttribute('data-icon-kind', 'emoji');
      expect(face).toHaveTextContent('🚀');
    });

    it('falls back to the generated initials when the glyph no longer exists', () => {
      useStore.setState({
        starredProjects: [
          {
            path: '/a/website',
            name: 'website',
            starredAt: 1,
            icon: { kind: 'glyph', value: 'gone_from_the_registry' },
          },
        ],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      expect(screen.getByTestId('tile-face-/a/website')).toHaveAttribute(
        'data-icon-kind',
        'initials'
      );
    });

    it('keeps the generated gradient whatever the mark is', () => {
      useStore.setState({
        starredProjects: [
          { path: '/a/website', name: 'website', starredAt: 1 },
          {
            path: '/a/website2',
            name: 'website2',
            starredAt: 2,
            icon: { kind: 'emoji', value: '🚀' },
          },
        ],
      });
      render(<QuickAccess currentPath="/a/apps" />);
      // Same derivation, different paths — what matters is that a customized
      // tile still gets a gradient at all.
      expect(screen.getByTestId('tile-face-/a/website2').style.backgroundImage).toMatch(
        /linear-gradient/
      );
    });
  });

  it('marks the active project tile', () => {
    useStore.setState({
      starredProjects: [
        { path: '/a/apps', name: 'apps', starredAt: 1 },
        { path: '/a/website', name: 'website', starredAt: 2 },
      ],
    });
    render(<QuickAccess currentPath="/a/apps" />);
    expect(screen.getByTestId('quick-access-tile-/a/apps')).toHaveAttribute('data-active', 'true');
    expect(screen.getByTestId('quick-access-tile-/a/website')).toHaveAttribute(
      'data-active',
      'false'
    );
  });
});
