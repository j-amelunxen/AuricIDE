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

const mockInitMcpJson = vi.fn();
vi.mock('@/lib/settings/mcpConfig', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/settings/mcpConfig')>();
  return {
    ...actual,
    initMcpJson: (...args: unknown[]) => mockInitMcpJson(...args),
  };
});

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

  it('renders the Init .mcp.json button', () => {
    render(<McpSettingsContent />);
    expect(screen.getByTestId('mcp-init-button')).toBeInTheDocument();
  });

  it('writes .mcp.json into the project root on click', async () => {
    mockInitMcpJson.mockResolvedValue('created');
    const user = userEvent.setup();
    render(<McpSettingsContent />);

    await user.click(screen.getByTestId('mcp-init-button'));

    expect(mockInitMcpJson).toHaveBeenCalledWith('/test/project');
    expect(await screen.findByText(/\.mcp\.json created/i)).toBeInTheDocument();
  });

  it('reports when an existing .mcp.json was updated', async () => {
    mockInitMcpJson.mockResolvedValue('updated');
    const user = userEvent.setup();
    render(<McpSettingsContent />);

    await user.click(screen.getByTestId('mcp-init-button'));

    expect(await screen.findByText(/\.mcp\.json updated/i)).toBeInTheDocument();
  });

  it('shows an error message when init fails', async () => {
    mockInitMcpJson.mockRejectedValue(new Error('.mcp.json exists but contains invalid JSON'));
    const user = userEvent.setup();
    render(<McpSettingsContent />);

    await user.click(screen.getByTestId('mcp-init-button'));

    expect(await screen.findByText(/invalid JSON/i)).toBeInTheDocument();
  });

  it('disables the init button when no project is open', () => {
    useStore.setState({ rootPath: null });
    render(<McpSettingsContent />);
    expect(screen.getByTestId('mcp-init-button')).toBeDisabled();
  });
});
