import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useConfirm } from './useConfirm';

/**
 * These tests encode the invariant that `window.confirm` failed to hold inside
 * the Tauri webview: there, the native dialog appears but JavaScript keeps
 * running, so every `if (confirm(...))` gate let its destructive action fire
 * before the user had answered. The decisive assertion in each case is that
 * nothing settles while the dialog is still on screen.
 */

function Harness({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const { confirm, confirmDialog } = useConfirm();
  return (
    <div>
      <button
        onClick={async () => {
          onAnswer(
            await confirm({
              title: 'Delete file?',
              message: 'This removes it permanently.',
              confirmLabel: 'Delete',
            })
          );
        }}
      >
        Trigger
      </button>
      {confirmDialog}
    </div>
  );
}

describe('useConfirm', () => {
  it('keeps the caller waiting while the dialog is open', async () => {
    const onAnswer = vi.fn();
    render(<Harness onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));

    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    // The whole point: an open question has no answer yet.
    expect(onAnswer).not.toHaveBeenCalled();
  });

  it('answers true only once the user confirms', async () => {
    const onAnswer = vi.fn();
    render(<Harness onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }));

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(true));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('answers false when the user cancels', async () => {
    const onAnswer = vi.fn();
    render(<Harness onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('answers false when the user presses Escape', async () => {
    const onAnswer = vi.fn();
    render(<Harness onAnswer={onAnswer} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    fireEvent.keyDown(await screen.findByRole('dialog'), { key: 'Escape' });

    await waitFor(() => expect(onAnswer).toHaveBeenCalledWith(false));
  });

  it('renders the copy it was asked for', async () => {
    render(<Harness onAnswer={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));

    expect(await screen.findByText('Delete file?')).toBeInTheDocument();
    expect(screen.getByText('This removes it permanently.')).toBeInTheDocument();
  });

  it('applies the discard confirm style when asked', async () => {
    function DiscardHarness() {
      const { confirm, confirmDialog } = useConfirm();
      return (
        <div>
          <button
            onClick={() => {
              void confirm({
                title: 'Discard changes?',
                message: 'Discard unsaved changes?',
                confirmLabel: 'Discard',
                variant: 'discard',
              });
            }}
          >
            Trigger
          </button>
          {confirmDialog}
        </div>
      );
    }
    render(<DiscardHarness />);
    fireEvent.click(screen.getByRole('button', { name: 'Trigger' }));
    const confirmBtn = await screen.findByRole('button', { name: 'Discard' });
    expect(confirmBtn.className).toContain('bg-white/10');
    expect(confirmBtn.className).not.toContain('bg-red-500');
  });

  it('settles a superseded request as false rather than leaving it hanging', async () => {
    const answers: boolean[] = [];
    function TwoTriggers() {
      const { confirm, confirmDialog } = useConfirm();
      const ask = async (title: string) => {
        answers.push(await confirm({ title, message: `${title} in detail`, confirmLabel: 'Go' }));
      };
      return (
        <div>
          <button onClick={() => void ask('First')}>First</button>
          <button onClick={() => void ask('Second')}>Second</button>
          {confirmDialog}
        </div>
      );
    }
    render(<TwoTriggers />);

    fireEvent.click(screen.getByRole('button', { name: 'First' }));
    fireEvent.click(screen.getByRole('button', { name: 'Second' }));

    // A dropped promise would never resolve and the caller would hang forever.
    await waitFor(() => expect(answers).toEqual([false]));
    expect(await screen.findByRole('heading', { name: 'Second' })).toBeInTheDocument();
  });
});
