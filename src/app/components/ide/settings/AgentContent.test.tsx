import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AgentContent } from './AgentContent';

describe('AgentContent — agent providers', () => {
  it('lists the configured providers and offers an import button', () => {
    render(<AgentContent />);
    // The store seeds a Crush fallback provider in browser/test mode.
    const list = screen.getByTestId('provider-list');
    expect(list).toHaveTextContent(/Crush/i);
    expect(screen.getByTestId('import-provider-button')).toBeInTheDocument();
  });
});
