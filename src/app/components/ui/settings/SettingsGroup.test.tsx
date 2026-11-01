import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { LearnMore, SettingsGroup } from './SettingsGroup';
import { SettingsSwitch } from './SettingsSwitch';

describe('SettingsGroup', () => {
  it('names the region by its heading and shows the short description', () => {
    render(
      <SettingsGroup title="Limits" description="How much may run at once.">
        <input aria-label="Max" />
      </SettingsGroup>
    );
    expect(screen.getByRole('region', { name: 'Limits' })).toHaveTextContent(
      'How much may run at once.'
    );
  });

  it('keeps the long explanation behind a disclosure, reachable but hidden', () => {
    render(<SettingsGroup title="Limits" learnMore="The whole story." />);
    const more = screen.getByRole('button', { name: 'Learn more' });
    expect(more).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByText('The whole story.')).not.toBeVisible();
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('The whole story.')).toBeVisible();
  });
});

describe('LearnMore', () => {
  it('takes its own label', () => {
    render(<LearnMore label="How jobs are limited">Detail</LearnMore>);
    expect(screen.getByRole('button', { name: 'How jobs are limited' })).toBeInTheDocument();
  });
});

describe('SettingsSwitch', () => {
  it('is a labelled switch that reports the new state', () => {
    const onChange = vi.fn();
    render(<SettingsSwitch checked={false} onChange={onChange} ariaLabel="Allow alpha" />);
    fireEvent.click(screen.getByRole('switch', { name: 'Allow alpha' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('puts the real input over the visible track, so a click on the track reaches it', () => {
    // happy-dom has no hit-testing; the contract is that the input covers its track and is
    // not screen-reader-only (sr-only is 1px, which left the track unclickable outside a label).
    render(<SettingsSwitch checked={false} onChange={vi.fn()} ariaLabel="Allow alpha" />);
    const input = screen.getByRole('switch', { name: 'Allow alpha' });
    expect(input.className).toContain('absolute');
    expect(input.className).toContain('inset-0');
    expect(input.className).not.toContain('sr-only');
  });
});
