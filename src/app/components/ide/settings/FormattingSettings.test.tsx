import { beforeEach, describe, expect, it } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import { FormattingSettings } from './FormattingSettings';

beforeEach(() => localStorage.clear());

describe('FormattingSettings', () => {
  it('shows the defaults: on save, not on blur, Markdown off', () => {
    render(<FormattingSettings />);
    expect(screen.getByTestId('format-on-save-toggle')).toBeChecked();
    expect(screen.getByTestId('format-on-blur-toggle')).not.toBeChecked();
    expect(screen.getByTestId('format-language-typescript')).toBeChecked();
    expect(screen.getByTestId('format-language-markdown')).not.toBeChecked();
  });

  it('writes each switch to the application preferences', () => {
    render(<FormattingSettings />);
    fireEvent.click(screen.getByTestId('format-on-blur-toggle'));
    fireEvent.click(screen.getByTestId('format-language-python'));
    expect(localStorage.getItem(APP_CONFIG_KEYS.formatOnBlur)).toBe('true');
    expect(JSON.parse(localStorage.getItem(APP_CONFIG_KEYS.formatLanguages)!)).toEqual({
      python: false,
    });
    expect(screen.getByTestId('format-language-python')).not.toBeChecked();
  });

  it('says why the languages do nothing while both triggers are off', () => {
    render(<FormattingSettings />);
    fireEvent.click(screen.getByTestId('format-on-save-toggle'));
    expect(screen.getByText(/Formatting is off/)).toBeInTheDocument();
  });
});
