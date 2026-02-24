import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ActivityBar } from './ActivityBar';

describe('ActivityBar', () => {
  const items = [
    { id: 'explorer', icon: 'folder', label: 'Explorer' },
    { id: 'source-control', icon: 'commit', label: 'Source Control', badge: 3 },
    { id: 'extensions', icon: 'extension', label: 'Extensions' },
    { id: 'settings', icon: 'settings', label: 'Settings' },
  ];

  it('renders all activity items plus terminal toggle', () => {
    render(<ActivityBar items={items} activeId="explorer" onSelect={() => {}} />);
    // 4 activity items + 1 terminal toggle button
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('marks the active item with primary styling', () => {
    render(<ActivityBar items={items} activeId="explorer" onSelect={() => {}} />);
    const activeButton = screen.getByTestId('activity-item-explorer');
    expect(activeButton).toHaveClass('bg-primary/10');
  });

  it('inactive items do not have primary styling', () => {
    render(<ActivityBar items={items} activeId="explorer" onSelect={() => {}} />);
    const inactiveButton = screen.getByTestId('activity-item-extensions');
    expect(inactiveButton).not.toHaveClass('bg-primary/10');
  });

  it('calls onSelect when an item is clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ActivityBar items={items} activeId="explorer" onSelect={onSelect} />);

    await user.click(screen.getByTestId('activity-item-source-control'));
    expect(onSelect).toHaveBeenCalledWith('source-control');
  });

  it('shows badge count when present', () => {
    render(<ActivityBar items={items} activeId="explorer" onSelect={() => {}} />);
    expect(screen.getByTestId('badge-source-control')).toHaveTextContent('3');
  });
});
