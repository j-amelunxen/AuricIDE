import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ManagerAskComposer } from './ManagerAskComposer';

const field = () => screen.getByRole('textbox', { name: 'Ask Billing PM…' });

describe('ManagerAskComposer', () => {
  it('sends the trimmed task with the Send button and empties the field once it went', async () => {
    const onSend = vi.fn(async () => true);
    render(<ManagerAskComposer name="Billing PM" running={false} onSend={onSend} />);
    fireEvent.change(field(), { target: { value: '  Retry the failed invoices.  ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('Retry the failed invoices.');
    await waitFor(() => expect(field()).toHaveValue(''));
  });

  it('keeps the text when the send did not go through, and sends once while it is under way', async () => {
    let settle: (sent: boolean) => void = () => undefined;
    const onSend = vi.fn(() => new Promise<boolean>((resolve) => (settle = resolve)));
    render(<ManagerAskComposer name="Billing PM" running={false} onSend={onSend} />);
    fireEvent.change(field(), { target: { value: 'Retry the failed invoices.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true });
    expect(onSend).toHaveBeenCalledTimes(1);
    settle(false);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Send' })).not.toHaveAttribute('aria-disabled')
    );
    expect(field()).toHaveValue('Retry the failed invoices.');
  });

  it('sends on Cmd+Enter and keeps Enter for a new line, as the Ask sheet does', () => {
    const onSend = vi.fn(async () => true);
    render(<ManagerAskComposer name="Billing PM" running onSend={onSend} />);
    fireEvent.change(field(), { target: { value: 'Two lines' } });
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true });
    expect(onSend).toHaveBeenCalledWith('Two lines');
  });

  it('sends nothing while the field is blank', () => {
    const onSend = vi.fn();
    render(<ManagerAskComposer name="Billing PM" running={false} onSend={onSend} />);
    fireEvent.change(field(), { target: { value: '   ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).not.toHaveBeenCalled();
  });

  it('says what Send will do: a message to a running manager, a start for a stopped one', () => {
    const { rerender } = render(<ManagerAskComposer name="Billing PM" running onSend={vi.fn()} />);
    expect(field()).toHaveAccessibleDescription(/goes to the running session as a message/i);
    rerender(<ManagerAskComposer name="Billing PM" running={false} onSend={vi.fn()} />);
    expect(field()).toHaveAccessibleDescription(/starts Billing PM with this as its first task/i);
  });

  it('turns off, with the reason, when it cannot send', () => {
    const onSend = vi.fn();
    render(
      <ManagerAskComposer
        name="Billing PM"
        running={false}
        blockedReason="The manager registry could not be read."
        onSend={onSend}
      />
    );
    expect(field()).toBeDisabled();
    expect(field()).toHaveAccessibleDescription('The manager registry could not be read.');
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(send);
    expect(onSend).not.toHaveBeenCalled();
  });
});
