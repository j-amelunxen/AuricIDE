import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { useStore } from '@/lib/store';
import { TicketColumnMenu } from './TicketColumnMenu';

function Dialog({ onEscape }: { onEscape: () => void }) {
  useOverlayLayer({ id: 'tickets-dialog', kind: 'tool', active: true, onEscape });
  return <TicketColumnMenu columns={[]} onToggle={vi.fn()} />;
}

describe('TicketColumnMenu', () => {
  afterEach(() => useStore.setState({ overlayStack: { layers: [] } }));

  it('Escape closes the open menu and leaves the dialog around it open', async () => {
    const user = userEvent.setup();
    const dialogEscape = vi.fn();
    render(<Dialog onEscape={dialogEscape} />);

    await user.click(screen.getByRole('button', { name: 'Columns' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(dialogEscape).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');
    expect(dialogEscape).toHaveBeenCalledTimes(1);
  });
});
