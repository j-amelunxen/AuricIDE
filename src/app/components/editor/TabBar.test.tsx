import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TabBar, type TabItem } from './TabBar';

const tabs: TabItem[] = [
  { id: '/a.md', name: 'a.md', isDirty: false },
  { id: '/b.md', name: 'b.md', isDirty: true },
  { id: '/c.md', name: 'c.md', isDirty: false },
];

describe('TabBar', () => {
  it('renders all tabs', () => {
    render(<TabBar tabs={tabs} activeTabId="/a.md" onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByText('a.md')).toBeInTheDocument();
    expect(screen.getByText('b.md')).toBeInTheDocument();
    expect(screen.getByText('c.md')).toBeInTheDocument();
  });

  it('marks active tab with border', () => {
    render(<TabBar tabs={tabs} activeTabId="/a.md" onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId('tab-/a.md')).toHaveClass('border-t-2');
  });

  it('shows dirty indicator for unsaved tabs', () => {
    render(<TabBar tabs={tabs} activeTabId="/a.md" onSelect={() => {}} onClose={() => {}} />);
    expect(screen.getByTestId('dirty-/b.md')).toBeInTheDocument();
    expect(screen.queryByTestId('dirty-/a.md')).not.toBeInTheDocument();
  });

  it('calls onSelect when tab is clicked', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<TabBar tabs={tabs} activeTabId="/a.md" onSelect={onSelect} onClose={() => {}} />);

    await user.click(screen.getByText('b.md'));
    expect(onSelect).toHaveBeenCalledWith('/b.md');
  });

  it('calls onClose when close button is clicked', async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<TabBar tabs={tabs} activeTabId="/a.md" onSelect={() => {}} onClose={onClose} />);

    await user.click(screen.getByTestId('close-/a.md'));
    expect(onClose).toHaveBeenCalledWith('/a.md');
  });

  it('shows context menu on right-click', async () => {
    const user = userEvent.setup();
    render(
      <TabBar
        tabs={tabs}
        activeTabId="/a.md"
        onSelect={() => {}}
        onClose={() => {}}
        onCloseOthers={() => {}}
        onCloseAll={() => {}}
        onCloseToRight={() => {}}
      />
    );
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('tab-/b.md') });
    expect(screen.getByText('Close')).toBeInTheDocument();
    expect(screen.getByText('Close Others')).toBeInTheDocument();
    expect(screen.getByText('Close All')).toBeInTheDocument();
    expect(screen.getByText('Close to the Right')).toBeInTheDocument();
  });

  it('calls onCloseOthers from context menu', async () => {
    const onCloseOthers = vi.fn();
    const user = userEvent.setup();
    render(
      <TabBar
        tabs={tabs}
        activeTabId="/a.md"
        onSelect={() => {}}
        onClose={() => {}}
        onCloseOthers={onCloseOthers}
        onCloseAll={() => {}}
        onCloseToRight={() => {}}
      />
    );
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('tab-/b.md') });
    await user.click(screen.getByText('Close Others'));
    expect(onCloseOthers).toHaveBeenCalledWith('/b.md');
  });

  it('calls onCloseAll from context menu', async () => {
    const onCloseAll = vi.fn();
    const user = userEvent.setup();
    render(
      <TabBar
        tabs={tabs}
        activeTabId="/a.md"
        onSelect={() => {}}
        onClose={() => {}}
        onCloseOthers={() => {}}
        onCloseAll={onCloseAll}
        onCloseToRight={() => {}}
      />
    );
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('tab-/a.md') });
    await user.click(screen.getByText('Close All'));
    expect(onCloseAll).toHaveBeenCalled();
  });

  it('calls onCloseToRight from context menu', async () => {
    const onCloseToRight = vi.fn();
    const user = userEvent.setup();
    render(
      <TabBar
        tabs={tabs}
        activeTabId="/a.md"
        onSelect={() => {}}
        onClose={() => {}}
        onCloseOthers={() => {}}
        onCloseAll={() => {}}
        onCloseToRight={onCloseToRight}
      />
    );
    await user.pointer({ keys: '[MouseRight]', target: screen.getByTestId('tab-/a.md') });
    await user.click(screen.getByText('Close to the Right'));
    expect(onCloseToRight).toHaveBeenCalledWith('/a.md');
  });
});
