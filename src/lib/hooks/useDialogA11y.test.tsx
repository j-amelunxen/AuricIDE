import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useState } from 'react';
import { useDialogA11y } from './useDialogA11y';

function TestDialog({ children }: { children?: React.ReactNode }) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  return (
    <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Test dialog">
      {children}
    </div>
  );
}

function Harness({ dialogChildren }: { dialogChildren?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button data-testid="trigger" onClick={() => setOpen(true)}>
        Open
      </button>
      {open && (
        <TestDialog>
          {dialogChildren ?? (
            <>
              <button data-testid="first">First</button>
              <button data-testid="second">Second</button>
              <button data-testid="last" onClick={() => setOpen(false)}>
                Close
              </button>
            </>
          )}
        </TestDialog>
      )}
    </div>
  );
}

describe('useDialogA11y', () => {
  it('moves focus to the first focusable element when the dialog opens', () => {
    render(<Harness />);
    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).toBe(screen.getByTestId('first'));
  });

  it('focuses the dialog container itself when it has no focusable children', () => {
    render(<Harness dialogChildren={<p>Just text</p>} />);
    fireEvent.click(screen.getByTestId('trigger'));
    expect(document.activeElement).toBe(screen.getByRole('dialog'));
  });

  it('wraps Tab from the last element to the first', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    const last = screen.getByTestId('last');
    last.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByTestId('first'));
  });

  it('wraps Shift+Tab from the first element to the last', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    const first = screen.getByTestId('first');
    first.focus();
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByTestId('last'));
  });

  it('restores focus to the previously focused element when the dialog closes', () => {
    render(<Harness />);
    const trigger = screen.getByTestId('trigger');
    trigger.focus();
    fireEvent.click(trigger);
    expect(document.activeElement).not.toBe(trigger);
    fireEvent.click(screen.getByTestId('last'));
    expect(document.activeElement).toBe(trigger);
  });

  it('does not steal focus from an element the dialog already focused itself', () => {
    render(
      <Harness
        dialogChildren={
          <>
            <button data-testid="first">First</button>
            {/* React commits autoFocus before effects run, like CommandPalette's input */}
            <input data-testid="search" autoFocus />
          </>
        }
      />
    );
    fireEvent.click(screen.getByTestId('trigger'));
    expect(document.activeElement).toBe(screen.getByTestId('search'));
  });

  it('makes the dialog container programmatically focusable', () => {
    render(<Harness />);
    fireEvent.click(screen.getByTestId('trigger'));
    expect(screen.getByRole('dialog').getAttribute('tabindex')).toBe('-1');
  });
});

describe('useDialogA11y returnFocusTo', () => {
  function Returning({
    target,
    autoFocus,
  }: {
    target: () => HTMLElement | null;
    autoFocus?: boolean;
  }) {
    const ref = useDialogA11y<HTMLDivElement>({ returnFocusTo: target });
    return (
      <div ref={ref} role="dialog" aria-label="Returning">
        <button autoFocus={autoFocus}>Inside</button>
      </div>
    );
  }

  it('hands focus to the named element on close, not to whatever had it before', () => {
    const elsewhere = document.createElement('button');
    const wanted = document.createElement('button');
    document.body.append(elsewhere, wanted);
    elsewhere.focus();
    const { unmount } = render(<Returning target={() => wanted} />);
    unmount();
    expect(wanted).toHaveFocus();
    elsewhere.remove();
    wanted.remove();
  });

  it('still works when the dialog autofocuses its own button on mount', () => {
    const wanted = document.createElement('button');
    document.body.append(wanted);
    const { unmount } = render(<Returning target={() => wanted} autoFocus />);
    unmount();
    expect(wanted).toHaveFocus();
    wanted.remove();
  });

  it('falls back to the previously focused element when the target is gone', () => {
    const before = document.createElement('button');
    document.body.append(before);
    before.focus();
    const { unmount } = render(<Returning target={() => null} />);
    unmount();
    expect(before).toHaveFocus();
    before.remove();
  });
});
