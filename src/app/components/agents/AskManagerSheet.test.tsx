import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AskManagerSheet } from './AskManagerSheet';

type Props = React.ComponentProps<typeof AskManagerSheet>;

function open(over: Partial<Props> = {}) {
  const onSend = vi.fn();
  const onClose = vi.fn();
  const props: Props = { name: 'Release Desk', running: true, onSend, onClose, ...over };
  const view = render(<AskManagerSheet {...props} />);
  return { onSend, onClose, view, props };
}

const field = () => screen.getByRole('textbox', { name: 'Task' });
const write = (value: string) => fireEvent.change(field(), { target: { value } });
const REASON = 'Write what Release Desk should do.';

describe('AskManagerSheet', () => {
  it('is a dialog titled with the manager, with the field focused', () => {
    open();
    expect(screen.getByRole('dialog', { name: 'Ask Release Desk' })).toBeInTheDocument();
    expect(field()).toHaveFocus();
  });

  it('says a stopped manager starts, and names the button for it', () => {
    open({ running: false });
    expect(screen.getByText('Release Desk starts and works on this first.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
  });

  it('says a running manager gets a message, and names the button for it', () => {
    open({ running: true });
    expect(
      screen.getByText('Release Desk is running; this goes in as a message.')
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('follows the manager starting or stopping while the sheet is open, in a live region', () => {
    const { view, props } = open({ running: false });
    const hint = screen.getByText('Release Desk starts and works on this first.');
    expect(hint).toHaveAttribute('aria-live', 'polite');
    view.rerender(<AskManagerSheet {...props} running />);
    expect(screen.getByText('Release Desk is running; this goes in as a message.')).toBe(hint);
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
  });

  it('ties the hint to the field', () => {
    open();
    const hint = screen.getByText(/is running; this goes in/);
    expect(field().getAttribute('aria-describedby')).toContain(hint.id);
  });

  it('shows no complaint on a fresh sheet, but keeps the button inert', () => {
    const { onSend } = open();
    expect(screen.queryByText(REASON)).toBeNull();
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send).toHaveAttribute('aria-disabled', 'true');
    expect(send).not.toBeDisabled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it('explains after the text was emptied again', () => {
    open();
    write('x');
    write('  ');
    expect(screen.getByText(REASON)).toBeInTheDocument();
    expect(field().getAttribute('aria-describedby')).toContain(screen.getByText(REASON).id);
  });

  it('explains and refocuses the field when Send is pressed on blank text', () => {
    const { onSend, onClose } = open();
    screen.getByRole('button', { name: 'Send' }).focus();
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByText(REASON)).toBeInTheDocument();
    expect(field()).toHaveFocus();
    expect(onSend).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sends the trimmed text on the button and closes', () => {
    const { onSend, onClose } = open();
    write('  Summarise the open tickets.  ');
    fireEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledWith('Summarise the open tickets.');
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('sends on Cmd+Enter and on Ctrl+Enter', () => {
    const { onSend } = open();
    write('One');
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true });
    fireEvent.keyDown(field(), { key: 'Enter', ctrlKey: true });
    expect(onSend).toHaveBeenCalledTimes(2);
  });

  it('keeps a plain Enter as a new line', () => {
    const { onSend } = open();
    write('One');
    fireEvent.keyDown(field(), { key: 'Enter' });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not send blank text on Cmd+Enter', () => {
    const { onSend } = open();
    fireEvent.keyDown(field(), { key: 'Enter', metaKey: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it('cancels with the Cancel button without sending', () => {
    const { onSend, onClose } = open();
    write('Something');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSend).not.toHaveBeenCalled();
  });

  it('does not close on a click outside, so typed text is not lost', () => {
    const { onClose } = open();
    write('Half a thought');
    fireEvent.click(screen.getByRole('dialog').parentElement as HTMLElement);
    expect(onClose).not.toHaveBeenCalled();
    expect(field()).toHaveValue('Half a thought');
  });

  it('returns focus to the control it is told to, even though the opener is gone', () => {
    const target = document.createElement('button');
    document.body.append(target);
    const { view } = open({ returnFocusTo: () => target });
    view.unmount();
    expect(target).toHaveFocus();
    target.remove();
  });
});
