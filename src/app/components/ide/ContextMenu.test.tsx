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
    const { container } = render(<ContextMenu x={0} y={0} options={options} onClose={vi.fn()} />);
    const icons = container.querySelectorAll('[data-icon]');
    expect(icons.length).toBeGreaterThan(0);
    icons.forEach((icon) => expect(icon).toHaveAttribute('aria-hidden', 'true'));
  });

  it('runs an item action on click', async () => {
    const user = userEvent.setup();
    const action = vi.fn();
    render(<ContextMenu x={0} y={0} options={[{ label: 'Red', action }]} onClose={vi.fn()} />);

    await user.click(screen.getByRole('menuitem', { name: 'Red' }));
    expect(action).toHaveBeenCalled();
  });

  it('closes on Escape', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<ContextMenu x={0} y={0} options={options} onClose={onClose} />);

    await user.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });
});
