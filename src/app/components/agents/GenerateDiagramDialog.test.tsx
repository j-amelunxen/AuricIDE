import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { GenerateDiagramDialog } from './GenerateDiagramDialog';
import { FALLBACK_CRUSH_PROVIDER, type ProviderInfo } from '@/lib/tauri/providers';

const dummyGeminiProvider: ProviderInfo = {
  id: 'gemini',
  name: 'Gemini CLI',
  models: [{ value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }],
  permissionModes: [{ value: 'default', label: 'Interactive', description: '' }],
  defaultModel: 'gemini-1.5-pro',
  defaultPermissionMode: 'default',
};
vi.mock('@/lib/tauri/providers', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/providers')>();
  return {
    ...actual,
    listProviders: vi.fn().mockRejectedValue(new Error('browser mode')),
  };
});

describe('GenerateDiagramDialog', () => {
  const defaultProps = {
    isOpen: true,
    onClose: vi.fn(),
    onGenerate: vi.fn(),
    folderPath: '/projects/my-app',
  };

  it('renders nothing when isOpen is false', () => {
    const { container } = render(<GenerateDiagramDialog {...defaultProps} isOpen={false} />);
    expect(container.innerHTML).toBe('');
  });

  it('renders modal with dropdowns when isOpen is true', () => {
    render(<GenerateDiagramDialog {...defaultProps} />);
    expect(screen.getByText('Generate Diagram')).toBeInTheDocument();
    expect(screen.getByLabelText(/diagram type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/detail level/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/provider/i)).toBeInTheDocument();
  });

  it('diagram type dropdown shows "Flowchart"', () => {
    render(<GenerateDiagramDialog {...defaultProps} />);
    expect(screen.getByText('Flowchart')).toBeInTheDocument();
  });

  it('detail level dropdown shows Abstract, Medium, Detailed', () => {
    render(<GenerateDiagramDialog {...defaultProps} />);
    expect(screen.getByText('Abstract')).toBeInTheDocument();
    expect(screen.getByText('Medium')).toBeInTheDocument();
    expect(screen.getByText('Detailed')).toBeInTheDocument();
  });

  it('shows fallback provider in dropdown when in browser mode', () => {
    render(<GenerateDiagramDialog {...defaultProps} />);
    expect(screen.getByLabelText(/provider/i)).toBeInTheDocument();
    expect(screen.getByText('Crush')).toBeInTheDocument();
  });

  it('shows all loaded providers in dropdown', async () => {
    const { listProviders } = await import('@/lib/tauri/providers');
    vi.mocked(listProviders).mockResolvedValueOnce([FALLBACK_CRUSH_PROVIDER, dummyGeminiProvider]);

    render(<GenerateDiagramDialog {...defaultProps} />);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Gemini CLI' })).toBeInTheDocument();
    });
    expect(screen.getByRole('option', { name: 'Crush' })).toBeInTheDocument();
  });

  it('calls onGenerate with correct AgentConfig on generate', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<GenerateDiagramDialog {...defaultProps} onGenerate={onGenerate} />);

    await user.click(screen.getByRole('button', { name: /generate/i }));

    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Diagram (my-app)',
        model: 'auto',
        cwd: '/projects/my-app',
        permissionMode: 'acceptEdits',
        provider: 'crush',
        task: expect.stringContaining('/projects/my-app'),
      })
    );
    // Verify the task includes diagram type and detail level
    const call = onGenerate.mock.calls[0][0];
    expect(call.task).toContain('flowchart');
    expect(call.task).toContain('abstract');
  });

  it('uses selected provider in onGenerate', async () => {
    const user = userEvent.setup();
    const { listProviders } = await import('@/lib/tauri/providers');
    vi.mocked(listProviders).mockResolvedValueOnce([FALLBACK_CRUSH_PROVIDER, dummyGeminiProvider]);

    const onGenerate = vi.fn();
    render(<GenerateDiagramDialog {...defaultProps} onGenerate={onGenerate} />);

    await waitFor(() => {
      expect(screen.getByRole('option', { name: 'Gemini CLI' })).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText(/provider/i), 'gemini');
    await user.click(screen.getByRole('button', { name: /generate/i }));

    expect(onGenerate).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'gemini',
        model: dummyGeminiProvider.defaultModel,
      })
    );
  });

  it('includes selected detail level in the agent task', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<GenerateDiagramDialog {...defaultProps} onGenerate={onGenerate} />);

    await user.selectOptions(screen.getByLabelText(/detail level/i), 'detailed');
    await user.click(screen.getByRole('button', { name: /generate/i }));

    const call = onGenerate.mock.calls[0][0];
    expect(call.task).toContain('detailed');
  });

  it('calls onClose on cancel', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<GenerateDiagramDialog {...defaultProps} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: /cancel/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose on backdrop click', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<GenerateDiagramDialog {...defaultProps} onClose={onClose} />);

    // Click the backdrop (outermost div)
    const backdrop = screen.getByText('Generate Diagram').closest('.fixed')!;
    await user.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it('diagram type dropdown includes "Component / Module Diagram" option', () => {
    render(<GenerateDiagramDialog {...defaultProps} />);
    expect(screen.getByText('Component / Module Diagram')).toBeInTheDocument();
  });

  it('component diagram task includes architecture and data flow keywords', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<GenerateDiagramDialog {...defaultProps} onGenerate={onGenerate} />);

    await user.selectOptions(screen.getByLabelText(/diagram type/i), 'component-diagram');
    await user.click(screen.getByRole('button', { name: /generate/i }));

    const { task } = onGenerate.mock.calls[0][0];
    expect(task).toContain('/projects/my-app');
    expect(task).toMatch(/component|architecture/i);
    expect(task).toMatch(/data flow/i);
    expect(task).toMatch(/IPC|communication/i);
  });

  it('component diagram task instructs agent to stay at high-level architectural scope', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<GenerateDiagramDialog {...defaultProps} onGenerate={onGenerate} />);

    await user.selectOptions(screen.getByLabelText(/diagram type/i), 'component-diagram');
    await user.click(screen.getByRole('button', { name: /generate/i }));

    const { task } = onGenerate.mock.calls[0][0];
    expect(task).toMatch(/high.?level|broad|architectural|module/i);
  });

  it('component diagram task mentions data storage', async () => {
    const user = userEvent.setup();
    const onGenerate = vi.fn();
    render(<GenerateDiagramDialog {...defaultProps} onGenerate={onGenerate} />);

    await user.selectOptions(screen.getByLabelText(/diagram type/i), 'component-diagram');
    await user.click(screen.getByRole('button', { name: /generate/i }));

    const { task } = onGenerate.mock.calls[0][0];
    expect(task).toMatch(/storage|persist|database/i);
  });
});
