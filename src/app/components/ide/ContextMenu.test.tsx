import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ContextMenu, type ContextMenuOption } from './ContextMenu';

const options: ContextMenuOption[] = [
  { type: 'header', label: 'Colour' },
  { label: 'Red', icon: 'circle', iconColor: '#ff6b6b', action: vi.fn() },
  { type: 'separator' },
  { label: 'Remove colour', icon: 'format_color_reset', action: vi.fn() },
];

describe('ContextMenu', () => {
  it('names an item by its label alone', () => {
    // An icon that is not hidden from assistive tech would add its own name
    // ("circle") to the item's accessible name.
    render(<ContextMenu x={0} y={0} options={options} onClose={vi.fn()} />);
    expect(screen.getByRole('menuitem', { name: 'Red' })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Remove colour' })).toBeInTheDocument();
  });

  it('hides icon glyphs from assistive technology', () => {
    render(<ContextMenu x={0} y={0} options={options} onClose={vi.fn()} />);
    const icons = document.body.querySelectorAll('[role="menu"] [data-icon]');
    expect(icons.length).toBeGreaterThan(0);
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
  });

  it('portals to document.body so a transformed parent cannot trap it', () => {
    const { container } = render(
      <div style={{ transform: 'scale(1)' }}>
        <ContextMenu x={24} y={24} options={options} onClose={vi.fn()} />
      </div>
    );
    expect(container.querySelector('[role="menu"]')).toBeNull();
    expect(document.body.querySelector('[role="menu"]')).toBeTruthy();
  });

  it('runs an item action on click', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(<ContextMenu x={0} y={0} options={[{ label: 'Red', action }]} onClose={vi.fn()} />);

    await user.click(screen.getByRole('menuitem', { name: 'Red' }));
    expect(action).toHaveBeenCalled();
  });

  it('closes after running an item action by default', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <ContextMenu x={0} y={0} options={[{ label: 'Red', action: vi.fn() }]} onClose={onClose} />
    );

    await user.click(screen.getByRole('menuitem', { name: 'Red' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('stays open after running an item marked keepOpen, for a menu that leads to a sub-stage', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const action = vi.fn();
    render(
      <ContextMenu
        x={0}
        y={0}
        options={[{ label: 'Backend', action, keepOpen: true }]}
        onClose={onClose}
      />
    );

    await user.click(screen.getByRole('menuitem', { name: 'Backend' }));
    expect(action).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} options={options} onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('renders a custom leading node in place of the icon glyph', () => {
    render(
      <ContextMenu
        x={0}
        y={0}
        options={[
          {
            label: 'Alpha project',
            leading: <span data-testid="custom-mark">A</span>,
            action: vi.fn(),
          },
        ]}
        onClose={vi.fn()}
      />
    );
    const item = screen.getByRole('menuitem', { name: 'Alpha project' });
    expect(item.querySelector('[data-testid="custom-mark"]')).toBeInTheDocument();
  });

  it('hides a custom leading node from assistive technology, same as the icon glyph', () => {
    render(
      <ContextMenu
        x={0}
        y={0}
        options={[
          {
            label: 'Alpha project',
            leading: <span data-testid="custom-mark">A</span>,
            action: vi.fn(),
          },
        ]}
        onClose={vi.fn()}
      />
    );
    const item = screen.getByRole('menuitem', { name: 'Alpha project' });
    const leadingWrapper = item.querySelector('[data-testid="custom-mark"]')!.parentElement;
    expect(leadingWrapper).toHaveAttribute('aria-hidden', 'true');
  });
  it('keeps an item that cannot run visible, states why, and does not run it', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    const onClose = vi.fn();
    render(
      <ContextMenu
        x={0}
        y={0}
        options={[{ label: 'Delete…', action, disabledReason: 'You are on this branch' }]}
        onClose={onClose}
      />
    );
    const item = screen.getByRole('menuitem', { name: 'Delete…' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item).toHaveAccessibleDescription('You are on this branch');
    expect(screen.getByText('You are on this branch')).toBeVisible();
    await user.click(item);
    expect(action).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('takes its accessible name from the caller', () => {
    render(
      <ContextMenu x={0} y={0} options={options} onClose={vi.fn()} ariaLabel="Commit actions" />
    );
    expect(screen.getByRole('menu', { name: 'Commit actions' })).toBeInTheDocument();
  });

  it('draws compact rows only when asked', () => {
    const { rerender } = render(<ContextMenu x={0} y={0} options={options} onClose={vi.fn()} />);
    expect(screen.getByRole('menuitem', { name: 'Red' }).className).toContain('min-h-11');
    rerender(<ContextMenu x={0} y={0} options={options} onClose={vi.fn()} compact />);
    expect(screen.getByRole('menuitem', { name: 'Red' }).className).toContain('min-h-7');
  });

  it('makes a checked item a menuitemradio with its state', () => {
    render(
      <ContextMenu
        x={0}
        y={0}
        options={[
          { label: 'All', checked: true },
          { label: 'Current', checked: false },
        ]}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('menuitemradio', { name: 'All' })).toBeChecked();
    expect(screen.getByRole('menuitemradio', { name: 'Current' })).not.toBeChecked();
  });

  it('walks the items with the arrow keys, Home and End', async () => {
    const user = userEvent.setup();
    render(
      <ContextMenu
        x={0}
        y={0}
        options={[{ label: 'One' }, { label: 'Two' }, { label: 'Three' }]}
        onClose={vi.fn()}
      />
    );
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'Two' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('menuitem', { name: 'Three' })).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('menuitem', { name: 'Three' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('menuitem', { name: 'One' })).toHaveFocus();
  });

  it('gives focus back to what opened it when it closes', () => {
    const opener = document.createElement('button');
    document.body.appendChild(opener);
    opener.focus();
    const { unmount } = render(<ContextMenu x={0} y={0} options={options} onClose={vi.fn()} />);
    expect(opener).not.toHaveFocus();
    unmount();
    expect(opener).toHaveFocus();
    opener.remove();
  });

  it('does not steal focus from something the user clicked elsewhere', () => {
    const opener = document.createElement('button');
    const other = document.createElement('button');
    document.body.append(opener, other);
    opener.focus();
    const { unmount } = render(<ContextMenu x={0} y={0} options={options} onClose={vi.fn()} />);
    other.focus();
    unmount();
    expect(other).toHaveFocus();
    opener.remove();
    other.remove();
  });
});
