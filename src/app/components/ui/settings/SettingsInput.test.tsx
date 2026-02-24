import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { SettingsInput } from './SettingsInput';

describe('SettingsInput', () => {
  it('renders and handles input change', () => {
    const onChange = vi.fn();
    render(
      <SettingsInput
        label="Base URL"
        value="https://api.example.com"
        onChange={onChange}
        placeholder="Enter URL"
      />
    );

    expect(screen.getByLabelText('Base URL')).toBeDefined();
    const input = screen.getByPlaceholderText('Enter URL') as HTMLInputElement;
    expect(input.value).toBe('https://api.example.com');

    fireEvent.change(input, { target: { value: 'https://new.com' } });
    expect(onChange).toHaveBeenCalledWith('https://new.com');
  });
});
