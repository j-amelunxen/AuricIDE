import { afterEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastHost } from './ToastHost';
import { useStore } from '@/lib/store';

describe('ToastHost', () => {
  afterEach(() => {
    act(() => useStore.setState({ toasts: [] }));
  });

  it('renders a toast added to the store', () => {
    render(<ToastHost />);
    act(() => {
      useStore.getState().showToast('An item named "x" already exists here', 'error');
    });
    const toast = screen.getByTestId('toast-error');
    expect(toast).toHaveTextContent('already exists');
    expect(toast).toHaveAttribute('role', 'alert');
  });

  it('non-error toasts use the polite status role', () => {
    render(<ToastHost />);
    act(() => useStore.getState().showToast('Saved', 'success'));
    expect(screen.getByTestId('toast-success')).toHaveAttribute('role', 'status');
  });

  it('dismisses a toast when its close button is clicked', async () => {
    const user = userEvent.setup();
    render(<ToastHost />);
    act(() => useStore.getState().showToast('bye', 'info'));

    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByTestId('toast-info')).not.toBeInTheDocument();
  });
});
