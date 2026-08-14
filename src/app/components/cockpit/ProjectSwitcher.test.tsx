import { render, screen, fireEvent } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectSwitcher } from './ProjectSwitcher';
import { PROJECT_TILE_COLUMNS } from './projectGrid';
import { useStore } from '@/lib/store';

describe('ProjectSwitcher', () => {
  beforeEach(() => {
    useStore.setState({
      starredProjects: [{ path: '/w/alpha', name: 'alpha', starredAt: 1 }],
      recentProjects: [
        { path: '/w/alpha', name: 'alpha', openedAt: 2000 },
        { path: '/w/bravo', name: 'bravo', openedAt: 1000 },
      ],
      toasts: [],
    });
  });

  it('opens on Quick Access and keeps the recents behind their tab', () => {
    render(<ProjectSwitcher currentPath="/w/alpha" />);
    expect(screen.getByTestId('project-switcher-tab-quick')).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByTestId('quick-access')).toBeInTheDocument();
    expect(screen.queryByTestId('recent-projects')).not.toBeInTheDocument();
  });

  it('shows the recents once their tab is chosen, and only those', () => {
    render(<ProjectSwitcher currentPath="/w/alpha" />);
    fireEvent.click(screen.getByTestId('project-switcher-tab-recent'));
    expect(screen.getByTestId('recent-projects')).toBeInTheDocument();
    expect(screen.queryByTestId('quick-access')).not.toBeInTheDocument();
    expect(screen.getByTestId('project-switcher-tab-recent')).toHaveAttribute(
      'aria-selected',
      'true'
    );
  });

  it('moves between tabs with the arrow keys', () => {
    render(<ProjectSwitcher currentPath={null} />);
    const quick = screen.getByTestId('project-switcher-tab-quick');
    fireEvent.keyDown(quick, { key: 'ArrowRight' });
    expect(screen.getByTestId('recent-projects')).toBeInTheDocument();
    fireEvent.keyDown(screen.getByTestId('project-switcher-tab-recent'), { key: 'ArrowLeft' });
    expect(screen.getByTestId('quick-access')).toBeInTheDocument();
  });

  it('states on each tab how much is behind it', () => {
    render(<ProjectSwitcher currentPath={null} />);
    expect(screen.getByTestId('project-switcher-count-quick')).toHaveTextContent('1');
    expect(screen.getByTestId('project-switcher-count-recent')).toHaveTextContent('2');
  });

  it('lays both tabs out on the same eight-column grid', () => {
    render(<ProjectSwitcher currentPath={null} />);
    expect(screen.getByTestId('quick-access-row')).toHaveAttribute(
      'data-columns',
      String(PROJECT_TILE_COLUMNS)
    );
    fireEvent.click(screen.getByTestId('project-switcher-tab-recent'));
    expect(screen.getByTestId('recent-projects-row')).toHaveAttribute(
      'data-columns',
      String(PROJECT_TILE_COLUMNS)
    );
  });

  it('keeps the hold-to-remove hint in the header, on the tab it belongs to', () => {
    render(<ProjectSwitcher currentPath={null} />);
    expect(screen.getByTestId('quick-access-hint')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('project-switcher-tab-recent'));
    expect(screen.queryByTestId('quick-access-hint')).not.toBeInTheDocument();
  });

  it('drops the hint when there is nothing to remove', () => {
    useStore.setState({ starredProjects: [] });
    render(<ProjectSwitcher currentPath={null} />);
    expect(screen.queryByTestId('quick-access-hint')).not.toBeInTheDocument();
  });

  it('opens a recent project from its tile', () => {
    const onOpenProject = vi.fn();
    render(<ProjectSwitcher currentPath={null} onOpenProject={onOpenProject} />);
    fireEvent.click(screen.getByTestId('project-switcher-tab-recent'));
    fireEvent.click(screen.getByTestId('recent-tile-/w/bravo'));
    expect(onOpenProject).toHaveBeenCalledWith('/w/bravo');
  });

  it('opens a starred project from its tile', () => {
    const onOpenProject = vi.fn();
    render(<ProjectSwitcher currentPath={null} onOpenProject={onOpenProject} />);
    fireEvent.click(screen.getByTestId('quick-access-tile-/w/alpha'));
    expect(onOpenProject).toHaveBeenCalledWith('/w/alpha');
  });
});
