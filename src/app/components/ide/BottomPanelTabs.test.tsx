import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { BottomPanelTabs } from './BottomPanelTabs';

describe('BottomPanelTabs', () => {
  it('renders Terminal and Problems tabs', () => {
    render(
      <BottomPanelTabs
        activeTab="terminal"
        onTabChange={() => {}}
        problemCount={0}
        terminalContent={<div>Terminal</div>}
        problemsContent={<div>Problems</div>}
      />
    );
    expect(screen.getByRole('tab', { name: /Terminal/i })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Problems/i })).toBeInTheDocument();
  });

  it('shows terminal content by default', () => {
    render(
      <BottomPanelTabs
        activeTab="terminal"
        onTabChange={() => {}}
        problemCount={0}
        terminalContent={<div data-testid="terminal-content">Terminal</div>}
        problemsContent={<div data-testid="problems-content">Problems</div>}
      />
    );
    expect(screen.getByTestId('terminal-content')).toBeInTheDocument();
    expect(screen.queryByTestId('problems-content')).not.toBeInTheDocument();
  });

  it('shows problems content when problems tab is active', () => {
    render(
      <BottomPanelTabs
        activeTab="problems"
        onTabChange={() => {}}
        problemCount={3}
        terminalContent={<div data-testid="terminal-content">Terminal</div>}
        problemsContent={<div data-testid="problems-content">Problems</div>}
      />
    );
    expect(screen.queryByTestId('terminal-content')).not.toBeInTheDocument();
    expect(screen.getByTestId('problems-content')).toBeInTheDocument();
  });

  it('calls onTabChange when tab is clicked', () => {
    const onTabChange = vi.fn();
    render(
      <BottomPanelTabs
        activeTab="terminal"
        onTabChange={onTabChange}
        problemCount={0}
        terminalContent={<div>Terminal</div>}
        problemsContent={<div>Problems</div>}
      />
    );
    fireEvent.click(screen.getByRole('tab', { name: /Problems/i }));
    expect(onTabChange).toHaveBeenCalledWith('problems');
  });

  it('shows badge with problem count when > 0', () => {
    render(
      <BottomPanelTabs
        activeTab="terminal"
        onTabChange={() => {}}
        problemCount={5}
        terminalContent={<div>Terminal</div>}
        problemsContent={<div>Problems</div>}
      />
    );
    expect(screen.getByTestId('problems-badge')).toHaveTextContent('5');
  });

  it('hides badge when problem count is 0', () => {
    render(
      <BottomPanelTabs
        activeTab="terminal"
        onTabChange={() => {}}
        problemCount={0}
        terminalContent={<div>Terminal</div>}
        problemsContent={<div>Problems</div>}
      />
    );
    expect(screen.queryByTestId('problems-badge')).not.toBeInTheDocument();
  });
});
