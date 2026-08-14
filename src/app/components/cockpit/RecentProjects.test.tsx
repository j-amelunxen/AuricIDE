import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RecentProjects } from './RecentProjects';
import { useStore } from '@/lib/store';

describe('RecentProjects', () => {
  beforeEach(() => {
    useStore.setState({
      starredProjects: [],
      recentProjects: [
        { path: '/w/alpha', name: 'alpha', openedAt: 2000 },
        { path: '/w/bravo', name: 'bravo', openedAt: 1000 },
      ],
      toasts: [],
    });
  });

  it('renders one tile per recent project, newest first', () => {
    render(<RecentProjects />);
    const tiles = screen.getAllByTestId(/^recent-tile-/);
    expect(tiles.map((t) => t.getAttribute('data-testid'))).toEqual([
      'recent-tile-/w/alpha',
      'recent-tile-/w/bravo',
    ]);
  });

  it('opens a project when its tile is clicked', () => {
    const onOpenProject = vi.fn();
    render(<RecentProjects onOpenProject={onOpenProject} />);
    fireEvent.click(screen.getByTestId('recent-tile-/w/alpha'));
    expect(onOpenProject).toHaveBeenCalledWith('/w/alpha');
  });

  it('stars a recent project into Quick Access without opening it', () => {
    const onOpenProject = vi.fn();
    render(<RecentProjects onOpenProject={onOpenProject} />);
    fireEvent.click(screen.getByTestId('star-recent-/w/alpha'));
    expect(useStore.getState().isProjectStarred('/w/alpha')).toBe(true);
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it('drops a project from the recents without opening it', () => {
    const onOpenProject = vi.fn();
    render(<RecentProjects onOpenProject={onOpenProject} />);
    fireEvent.click(screen.getByTestId('remove-recent-/w/alpha'));
    expect(screen.queryByTestId('recent-tile-/w/alpha')).not.toBeInTheDocument();
    expect(screen.getByTestId('recent-tile-/w/bravo')).toBeInTheDocument();
    expect(onOpenProject).not.toHaveBeenCalled();
  });

  it('says the list is empty rather than showing nothing at all', () => {
    useStore.setState({ recentProjects: [] });
    render(<RecentProjects />);
    expect(screen.getByTestId('recent-projects')).toBeInTheDocument();
    expect(screen.getByTestId('recent-projects-empty')).toBeInTheDocument();
  });
});
