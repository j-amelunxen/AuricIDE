import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { IDEShell } from './IDEShell';

describe('IDEShell', () => {
  it('renders header slot', () => {
    render(<IDEShell header={<div data-testid="custom-header">Header</div>} statusBar={<div />} />);
    expect(screen.getByTestId('custom-header')).toBeInTheDocument();
  });

  it('renders left panel slot', () => {
    render(
      <IDEShell
        header={<div />}
        leftPanel={<div data-testid="left-panel">Explorer</div>}
        statusBar={<div />}
      />
    );
    expect(screen.getByTestId('left-panel')).toBeInTheDocument();
  });

  it('renders center content slot', () => {
    render(
      <IDEShell
        header={<div />}
        centerContent={<div data-testid="center">Editor</div>}
        statusBar={<div />}
      />
    );
    expect(screen.getByTestId('center')).toBeInTheDocument();
  });

  it('renders right panel slot', () => {
    render(
      <IDEShell
        header={<div />}
        rightPanel={<div data-testid="right-panel">Agents</div>}
        statusBar={<div />}
      />
    );
    expect(screen.getByTestId('right-panel')).toBeInTheDocument();
  });

  it('renders bottom panel slot', () => {
    render(
      <IDEShell
        header={<div />}
        bottomPanel={<div data-testid="bottom-panel">Terminal</div>}
        statusBar={<div />}
      />
    );
    expect(screen.getByTestId('bottom-panel')).toBeInTheDocument();
  });

  it('renders status bar slot', () => {
    render(<IDEShell header={<div />} statusBar={<div data-testid="custom-status">Status</div>} />);
    expect(screen.getByTestId('custom-status')).toBeInTheDocument();
  });

  it('renders activity bar slot', () => {
    render(
      <IDEShell
        header={<div />}
        activityBar={<div data-testid="nav-icons">Nav</div>}
        statusBar={<div />}
      />
    );
    expect(screen.getByTestId('nav-icons')).toBeInTheDocument();
  });

  it('can toggle left panel visibility', async () => {
    const user = userEvent.setup();
    render(
      <IDEShell
        header={<div />}
        leftPanel={<div data-testid="left-content">Explorer</div>}
        statusBar={<div />}
      />
    );

    const toggle = screen.getByTestId('toggle-left-panel');
    await user.click(toggle);

    const panel = screen.getByTestId('left-panel-container');
    expect(panel.style.width).toBe('0px');
  });

  it('can toggle bottom panel visibility', async () => {
    const user = userEvent.setup();
    render(
      <IDEShell
        header={<div />}
        bottomPanel={<div data-testid="bottom-content">Terminal</div>}
        statusBar={<div />}
      />
    );

    const toggle = screen.getByTestId('toggle-bottom-panel');
    await user.click(toggle);

    const panel = screen.getByTestId('bottom-panel-container');
    expect(panel.style.height).toBe('0px');
  });

  it('collapses the right panel to zero width when rightCollapsed is set', () => {
    render(
      <IDEShell
        header={<div />}
        rightPanel={<div data-testid="right-content">Agents</div>}
        rightCollapsed
        statusBar={<div />}
      />
    );

    const panel = screen.getByTestId('right-panel-container');
    expect(panel.style.width).toBe('0px');
  });

  it('shows the right panel at full width when rightCollapsed is false', () => {
    render(
      <IDEShell
        header={<div />}
        rightPanel={<div data-testid="right-content">Agents</div>}
        rightCollapsed={false}
        statusBar={<div />}
      />
    );

    const panel = screen.getByTestId('right-panel-container');
    expect(panel.style.width).not.toBe('0px');
  });

  it('lets the center pane shrink when the right panel takes width', () => {
    render(
      <IDEShell
        header={<div />}
        centerContent={<div data-testid="center">Editor</div>}
        rightPanel={<div>Agents</div>}
        rightCollapsed={false}
        statusBar={<div />}
      />
    );

    // Flex items default to min-width: auto, so a wide cockpit would refuse
    // to yield and the agents bar would clip it instead of compressing it.
    expect(screen.getByTestId('center-pane')).toHaveClass('min-w-0');
  });

  it('notifies onRightToggle when the right panel toggle is clicked', async () => {
    const onRightToggle = vi.fn();
    const user = userEvent.setup();
    render(
      <IDEShell
        header={<div />}
        rightPanel={<div data-testid="right-content">Agents</div>}
        rightCollapsed={false}
        onRightToggle={onRightToggle}
        statusBar={<div />}
      />
    );

    await user.click(screen.getByTestId('toggle-right-panel'));
    expect(onRightToggle).toHaveBeenCalledWith(true);
  });

  it('can toggle right panel visibility without external state', async () => {
    const user = userEvent.setup();
    render(
      <IDEShell
        header={<div />}
        rightPanel={<div data-testid="right-content">Agents</div>}
        statusBar={<div />}
      />
    );

    const toggle = screen.getByTestId('toggle-right-panel');
    await user.click(toggle);

    const panel = screen.getByTestId('right-panel-container');
    expect(panel.style.width).toBe('0px');
  });
});
