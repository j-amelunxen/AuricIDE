import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useStore } from '@/lib/store';

const mockStartMcp = vi.fn();
const mockStopMcp = vi.fn();
vi.mock('@/lib/tauri/mcp', () => ({
  startMcp: (...args: unknown[]) => mockStartMcp(...args),
  stopMcp: (...args: unknown[]) => mockStopMcp(...args),
  mcpStatus: vi.fn(),
}));

import { McpSettingsContent } from './McpSettingsContent';

describe('McpSettingsContent', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.setState({
      rootPath: '/test/project',
      mcpServerRunning: false,
      mcpAutoStart: false,
      mcpPid: null,
    });
  });

  it('renders the MCP Server heading', () => {
    render(<McpSettingsContent />);
    expect(screen.getByText('MCP Server')).toBeInTheDocument();
  });

  it('shows stopped status when server is not running', () => {
    render(<McpSettingsContent />);
    expect(screen.getByText('Stopped')).toBeInTheDocument();
  });

  it('shows running status with PID when server is running', () => {
    useStore.setState({ mcpServerRunning: true, mcpPid: 1234 });
    render(<McpSettingsContent />);
    expect(screen.getByText('Running (PID: 1234)')).toBeInTheDocument();
  });

  it('renders start button when stopped', () => {
    render(<McpSettingsContent />);
    expect(screen.getByTestId('mcp-toggle-button')).toHaveTextContent('Start');
  });

  it('renders stop button when running', () => {
    useStore.setState({ mcpServerRunning: true, mcpPid: 1234 });
    render(<McpSettingsContent />);
    expect(screen.getByTestId('mcp-toggle-button')).toHaveTextContent('Stop');
  });

  it('renders auto-start toggle', () => {
    render(<McpSettingsContent />);
    expect(screen.getByTestId('mcp-autostart-toggle')).toBeInTheDocument();
  });

  it('toggles auto-start', async () => {
    const user = userEvent.setup();
    render(<McpSettingsContent />);
    const toggle = screen.getByTestId('mcp-autostart-toggle');
    expect(toggle).not.toBeChecked();
    await user.click(toggle);
    expect(useStore.getState().mcpAutoStart).toBe(true);
  });

  it('renders config snippet with project path', () => {
    render(<McpSettingsContent />);
    const snippet = screen.getByTestId('mcp-config-snippet');
    expect(snippet.textContent).toContain('/test/project');
    expect(snippet.textContent).toContain('auric-pm');
    expect(snippet.textContent).toContain('server.ts');
  });

  it('renders copy button', () => {
    render(<McpSettingsContent />);
    expect(screen.getByTestId('mcp-copy-button')).toBeInTheDocument();
  });

  it('renders status indicator', () => {
    render(<McpSettingsContent />);
    expect(screen.getByTestId('mcp-status-indicator')).toBeInTheDocument();
  });
});
