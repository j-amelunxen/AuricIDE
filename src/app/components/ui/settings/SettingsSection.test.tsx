import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { SettingsSection } from './SettingsSection';

describe('SettingsSection', () => {
  it('renders title and children', () => {
    render(
      <SettingsSection title="Test Section" icon="robot">
        <div data-testid="child">Child Content</div>
      </SettingsSection>
    );

    expect(screen.getByText('Test Section')).toBeDefined();
    expect(screen.getByTestId('child')).toBeDefined();
    expect(screen.getByText('robot')).toBeDefined(); // Material symbol icon
  });
});
