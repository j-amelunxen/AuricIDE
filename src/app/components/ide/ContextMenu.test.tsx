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
});
