import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AppearanceContent } from './AppearanceContent';
import { ACCENTS, ACCENT_STORAGE_KEY } from '@/lib/theme/accent';

describe('AppearanceContent — accent picker', () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.accent;
  });

  afterEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.accent;
  });

  it('renders a selectable swatch for every accent', () => {
    render(<AppearanceContent />);
    for (const accent of ACCENTS) {
      expect(screen.getByRole('radio', { name: accent.label })).toBeInTheDocument();
    }
  });

  it('marks the current accent as selected', () => {
    localStorage.setItem(ACCENT_STORAGE_KEY, 'blue');
    render(<AppearanceContent />);
    expect(screen.getByRole('radio', { name: 'Electric Blue' })).toBeChecked();
  });

  it('applies and persists the accent when a swatch is picked', async () => {
    const user = userEvent.setup();
    render(<AppearanceContent />);

    await user.click(screen.getByRole('radio', { name: 'Electric Blue' }));

    expect(document.documentElement.dataset.accent).toBe('blue');
    expect(localStorage.getItem(ACCENT_STORAGE_KEY)).toBe('blue');
    expect(screen.getByRole('radio', { name: 'Electric Blue' })).toBeChecked();
  });
});
