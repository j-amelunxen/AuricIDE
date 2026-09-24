import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { useStore } from '@/lib/store';

const mockMcpLaunchSpec = vi.fn();
vi.mock('@/lib/tauri/mcp', () => ({
  mcpLaunchSpec: (...args: unknown[]) => mockMcpLaunchSpec(...args),
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
    mockMcpLaunchSpec.mockResolvedValue({
      command: 'node',
      args: ['/app/auric-mcp/server.mjs', '--project-root', '/test/project'],
    });
    useStore.setState({
      rootPath: '/test/project',
      mcpServerRunning: false,
      mcpAutoStart: false,
      mcpPid: null,
      mcpPhase: 'stopped',
      mcpProjectPath: null,
      mcpError: null,
    });
  });

  it('explains that agent MCP bindings survive UI project changes', () => {
    render(<McpSettingsContent />);
    expect(screen.getByText('Project MCP configuration')).toBeInTheDocument();
    expect(screen.getByText(/switching or closing the project/i)).toBeInTheDocument();
  });

  it('renders config snippet with project path and no project-owned server source', async () => {
    render(<McpSettingsContent />);
    const snippet = screen.getByTestId('mcp-config-snippet');
    expect(snippet.textContent).toContain('/test/project');
    expect(snippet.textContent).toContain('auric-pm');
    expect(snippet.textContent).not.toContain('/test/project/src/mcp/server.ts');
    expect(
      await screen.findByText((content) => content.includes('/app/auric-mcp/server.mjs'))
    ).toBe(snippet);
  });

  it('renders copy button', () => {
    render(<McpSettingsContent />);
    expect(screen.getByTestId('mcp-copy-button')).toBeInTheDocument();
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
