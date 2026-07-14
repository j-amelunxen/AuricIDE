import { render, screen, fireEvent, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QuickAccess } from './QuickAccess';
import { useStore } from '@/lib/store';

describe('QuickAccess', () => {
  beforeEach(() => {
    useStore.setState({ starredProjects: [] });
  });

  it('renders a tile for each starred project in stable insertion order', () => {
    useStore.setState({
      starredProjects: [
        { path: '/a/apps', name: 'apps', starredAt: 1 },
        { path: '/a/website', name: 'website', starredAt: 2 },
      ],
    });
    render(<QuickAccess currentPath="/a/apps" />);
    const tiles = screen.getAllByTestId(/^quick-access-tile-/);
    expect(tiles).toHaveLength(2);
    expect(tiles[0]).toHaveAttribute('data-testid', 'quick-access-tile-/a/apps');
    expect(tiles[1]).toHaveAttribute('data-testid', 'quick-access-tile-/a/website');
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
