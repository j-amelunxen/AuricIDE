import { render, screen, within } from '@testing-library/react';
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
    render(
      <ActivityBar
        items={items}
        activeId="explorer"
        onSelect={() => {}}
        onTerminalToggle={() => {}}
      />
    );
    // 4 activity items + 1 terminal toggle button
    expect(screen.getAllByRole('button')).toHaveLength(5);
  });

  it('does not offer a terminal toggle when none is provided', () => {
    render(<ActivityBar items={items} activeId="explorer" onSelect={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Toggle Terminal (⌘J)' })).toBeNull();
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

  it('exposes each activity item by an accessible label', () => {
    render(<ActivityBar items={items} activeId="explorer" onSelect={() => {}} />);
    expect(screen.getByRole('button', { name: 'Explorer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Source Control' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extensions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('exposes the terminal toggle by an accessible label', () => {
    render(
      <ActivityBar
        items={items}
        activeId="explorer"
        onSelect={() => {}}
        onTerminalToggle={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: 'Toggle Terminal (⌘J)' })).toBeInTheDocument();
  });

  it('hides icon glyphs from assistive technology', () => {
    const { container } = render(
      <ActivityBar items={items} activeId="explorer" onSelect={() => {}} />
    );
    const icons = container.querySelectorAll('[data-icon]');
    expect(icons.length).toBeGreaterThan(0);
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
  });

  it('exposes the agents panel toggle by an accessible label', () => {
    render(
      <ActivityBar
        items={items}
        activeId="explorer"
        onSelect={() => {}}
        onAgentsToggle={() => {}}
      />
    );
    expect(screen.getByRole('button', { name: 'Toggle Agents Panel' })).toBeInTheDocument();
  });

  it('calls onAgentsToggle when the agents toggle is clicked', async () => {
    const user = userEvent.setup();
    const onAgentsToggle = vi.fn();
    render(
      <ActivityBar
        items={items}
        activeId="explorer"
        onSelect={() => {}}
        onAgentsToggle={onAgentsToggle}
      />
    );
    await user.click(screen.getByRole('button', { name: 'Toggle Agents Panel' }));
    expect(onAgentsToggle).toHaveBeenCalledTimes(1);
  });

  it('uses a color-only transition on the terminal toggle', () => {
    render(
      <ActivityBar
        items={items}
        activeId="explorer"
        onSelect={() => {}}
        onTerminalToggle={() => {}}
      />
    );
    const toggle = screen.getByRole('button', { name: 'Toggle Terminal (⌘J)' });
    expect(toggle).toHaveClass('transition-colors');
    expect(toggle).not.toHaveClass('transition-all');
  });

  it('reveals a fast in-app tooltip label on hover instead of the slow native title', async () => {
    const user = userEvent.setup();
    render(<ActivityBar items={items} activeId="explorer" onSelect={() => {}} />);
    const item = screen.getByTestId('activity-item-extensions');
    expect(screen.queryByTestId('activity-tooltip-extensions')).not.toBeInTheDocument();

    await user.hover(item);
    // Custom tooltip carries the label...
    const tip = screen.getByTestId('activity-tooltip-extensions');
    expect(tip).toHaveTextContent('Extensions');
    expect(tip).toHaveAttribute('role', 'tooltip');
    // ...and the native title (≈1s OS delay, unstyled) is gone.
    expect(item).not.toHaveAttribute('title');

    await user.unhover(item);
    expect(screen.queryByTestId('activity-tooltip-extensions')).not.toBeInTheDocument();
  });

  it('labels the panel toggles on hover as well', async () => {
    const user = userEvent.setup();
    render(
      <ActivityBar
        items={items}
        activeId="explorer"
        onSelect={() => {}}
        onTerminalToggle={() => {}}
        onAgentsToggle={() => {}}
      />
    );
    await user.hover(screen.getByRole('button', { name: 'Toggle Terminal (⌘J)' }));
    expect(screen.getByTestId('activity-tooltip-terminal')).toHaveTextContent(
      'Toggle Terminal (⌘J)'
    );
  });

  it('keeps the hover label out of the scrolling rail so it cannot widen it', async () => {
    const user = userEvent.setup();
    render(<ActivityBar items={items} activeId="explorer" onSelect={() => {}} />);
    await user.hover(screen.getByTestId('activity-item-extensions'));

    const tip = screen.getByTestId('activity-tooltip-extensions');
    const scroll = screen.getByTestId('activity-rail-scroll');
    // A label parked inside the scroller reaches ~120px past a 56px rail, and
    // `overflow-y: auto` computes `overflow-x` to `auto` — that is a horizontal
    // scrollbar under the icons, which then costs the height that summons a
    // vertical one. It has to hang outside the scroller entirely.
    expect(scroll.contains(tip)).toBe(false);
    expect(tip).toHaveClass('fixed');
  });

  it('anchors the hover label to the right edge of its icon', async () => {
    const user = userEvent.setup();
    render(<ActivityBar items={items} activeId="explorer" onSelect={() => {}} />);
    const item = screen.getByTestId('activity-item-extensions');
    vi.spyOn(item, 'getBoundingClientRect').mockReturnValue({
      top: 100,
      right: 56,
      height: 40,
    } as DOMRect);

    await user.hover(item);
    const tip = screen.getByTestId('activity-tooltip-extensions');
    expect(tip.style.left).toBe('68px'); // 56 + 12px gap
    expect(tip.style.top).toBe('120px'); // vertically centred on the icon
  });

  it('separates primary destinations from demoted tools', () => {
    const sectioned = [
      { id: 'cockpit', icon: 'space_dashboard', label: 'Mission Control' },
      { id: 'explorer', icon: 'folder', label: 'Explorer' },
      { id: 'outline', icon: 'toc', label: 'Outline', section: 'tools' as const },
      { id: 'settings', icon: 'settings', label: 'Settings', section: 'tools' as const },
    ];
    render(<ActivityBar items={sectioned} activeId="cockpit" onSelect={() => {}} />);
    expect(screen.getByTestId('activity-section-separator')).toBeInTheDocument();
    expect(
      screen.getByTestId('activity-item-settings').querySelector('[data-icon="settings"]')
    ).toBeInTheDocument();
  });

  it('renders tool items visually smaller than primary destinations', () => {
    const sectioned = [
      { id: 'explorer', icon: 'folder', label: 'Explorer' },
      { id: 'outline', icon: 'toc', label: 'Outline', section: 'tools' as const },
    ];
    render(<ActivityBar items={sectioned} activeId="explorer" onSelect={() => {}} />);
    expect(screen.getByTestId('activity-item-explorer')).toHaveClass('h-10');
    expect(screen.getByTestId('activity-item-outline')).toHaveClass('h-8');
  });

  it('renders no separator when every item is primary', () => {
    render(<ActivityBar items={items} activeId="explorer" onSelect={() => {}} />);
    expect(screen.queryByTestId('activity-section-separator')).not.toBeInTheDocument();
  });

  it('pins Settings to a footer region so it cannot scroll away', () => {
    const sectioned = [
      { id: 'cockpit', icon: 'space_dashboard', label: 'Mission Control' },
      { id: 'explorer', icon: 'folder', label: 'Explorer' },
      { id: 'outline', icon: 'toc', label: 'Outline', section: 'tools' as const },
      { id: 'extensions', icon: 'extension', label: 'Extensions', section: 'tools' as const },
      { id: 'settings', icon: 'settings', label: 'Settings', section: 'tools' as const },
    ];
    render(<ActivityBar items={sectioned} activeId="cockpit" onSelect={() => {}} />);

    const pin = screen.getByTestId('activity-settings-pin');
    expect(within(pin).getByRole('button', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mission Control' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Explorer' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Outline' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Extensions' })).toBeInTheDocument();

    const scroll = screen.getByTestId('activity-rail-scroll');
    expect(within(scroll).queryByRole('button', { name: 'Settings' })).not.toBeInTheDocument();
    expect(scroll).toHaveClass('overflow-y-auto');
    expect(pin).not.toHaveClass('overflow-y-auto');
    // Stretch to the shell row and allow shrinking so overflow actually scrolls.
    expect(screen.getByTestId('activity-bar')).toHaveClass('h-full', 'min-h-0');
  });

  it('does not render a Settings pin when Settings is not in the rail', () => {
    render(
      <ActivityBar
        items={[{ id: 'explorer', icon: 'folder', label: 'Explorer' }]}
        activeId="explorer"
        onSelect={() => {}}
      />
    );
    expect(screen.queryByTestId('activity-settings-pin')).not.toBeInTheDocument();
  });

  it('gives activity items a snappy press-and-hover feedback', () => {
    render(<ActivityBar items={items} activeId="explorer" onSelect={() => {}} />);
    const item = screen.getByTestId('activity-item-extensions');
    // Instant, color-scoped hover (no sluggish 300ms transition-all)
    expect(item).toHaveClass('transition-colors');
    expect(item).not.toHaveClass('transition-all');
    // Tactile pressed state
    expect(item.className).toMatch(/active:scale-/);
  });
});
