import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InboxTextSheet } from './InboxTextSheet';

vi.mock('@/lib/overlays/useOverlayLayer', () => ({ useOverlayLayer: vi.fn() }));

const MAIL = [
  'From: client@example.com',
  'Subject: Invoice 2024-118 is overdue',
  '',
  'Hi, the invoice from January is still open. Can you check?',
].join('\n');

function renderSheet(props: Partial<React.ComponentProps<typeof InboxTextSheet>> = {}) {
  const onAttach = vi.fn();
  const onClose = vi.fn();
  render(<InboxTextSheet onAttach={onAttach} onClose={onClose} {...props} />);
  return { onAttach, onClose };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('InboxTextSheet', () => {
  it('is a labelled modal dialog', () => {
    renderSheet();
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'true');
  });

  it('hands the typed text and a derived name to onAttach', async () => {
    const user = userEvent.setup();
    const { onAttach } = renderSheet();

    await user.click(screen.getByLabelText(/^text$/i));
    await user.paste(MAIL);
    await user.click(screen.getByRole('button', { name: /attach/i }));

    expect(onAttach).toHaveBeenCalledWith('invoice-2024-118-is-overdue.md', MAIL);
  });

  it('shows the derived name and keeps it in step until the user edits it', async () => {
    const user = userEvent.setup();
    const { onAttach } = renderSheet();
    const body = screen.getByLabelText(/^text$/i);
    const name = screen.getByLabelText(/file name/i);

    await user.click(body);
    await user.paste('Subject: First guess\n\nbody text here');
    expect(name).toHaveValue('first-guess.md');

    await user.clear(name);
    await user.type(name, 'client-mail');
    await user.click(body);
    await user.paste('\nSubject: Second guess');

    expect(name).toHaveValue('client-mail');
    await user.click(screen.getByRole('button', { name: /attach/i }));
    expect(onAttach).toHaveBeenCalledWith('client-mail', expect.stringContaining('Second guess'));
  });

  it('starts from text that was already pasted into the capture bar', () => {
    renderSheet({ initialBody: MAIL });
    expect(screen.getByLabelText(/^text$/i)).toHaveValue(MAIL);
    expect(screen.getByLabelText(/file name/i)).toHaveValue('invoice-2024-118-is-overdue.md');
  });

  it('refuses to attach nothing', async () => {
    const user = userEvent.setup();
    const { onAttach, onClose } = renderSheet();

    await user.click(screen.getByLabelText(/^text$/i));
    await user.paste('   \n  ');
    await user.click(screen.getByRole('button', { name: /attach/i }));

    expect(onAttach).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('attaches on Cmd+Enter without leaving the textarea', async () => {
    const user = userEvent.setup();
    const { onAttach } = renderSheet({ initialBody: 'A whole email' });

    await user.click(screen.getByLabelText(/^text$/i));
    await user.keyboard('{Meta>}{Enter}{/Meta}');

    expect(onAttach).toHaveBeenCalledWith('a-whole-email.md', 'A whole email');
  });

  it('closes without attaching on Cancel', async () => {
    const user = userEvent.setup();
    const { onAttach, onClose } = renderSheet({ initialBody: 'text' });

    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
    expect(onAttach).not.toHaveBeenCalled();
  });
});
