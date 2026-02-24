import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SettingsToggle } from './SettingsToggle';

describe('SettingsToggle', () => {
  it('renders label and handles change', () => {
    const onChange = vi.fn();
    render(
      <SettingsToggle
        label="Test Toggle"
        checked={false}
        onChange={onChange}
        description="A test description"
      />
    );

    expect(screen.getByText('Test Toggle')).toBeDefined();
    expect(screen.getByText('A test description')).toBeDefined();

    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
