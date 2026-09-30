import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useStore } from '@/lib/store';
import type { RepriceReport } from '@/lib/tauri/agentUsage';

const agentUsageReprice = vi.fn<(projectPath: string) => Promise<RepriceReport>>();

vi.mock('@/lib/tauri/agentUsage', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/tauri/agentUsage')>();
  return {
    ...actual,
    agentUsageReprice: (projectPath: string) => agentUsageReprice(projectPath),
  };
});

import { MaintenanceContent } from './MaintenanceContent';

const ROOT = '/work/project';

function report(overrides: Partial<RepriceReport>): RepriceReport {
  return {
    unpriced: 0,
    repriced: 0,
    stillUnpriced: 0,
    missingEvidence: 0,
    changedEvidence: 0,
    unpricedModels: [],
    ...overrides,
  };
}

beforeEach(() => {
  agentUsageReprice.mockReset();
  useStore.setState({
    rootPath: ROOT,
    loadAgentUsage: vi.fn(async () => {}),
    showToast: vi.fn(),
  });
});

describe('MaintenanceContent', () => {
  it('asks to open a project when none is open', () => {
    useStore.setState({ rootPath: null });
    render(<MaintenanceContent />);

    expect(screen.getByText(/open a project/i)).toBeInTheDocument();
    expect(screen.queryByTestId('reprice-runs')).not.toBeInTheDocument();
  });

  it('reprices the open project, says what it did and reloads its runs', async () => {
    const user = userEvent.setup();
    const loadAgentUsage = vi.fn(async () => {});
    useStore.setState({ loadAgentUsage });
    agentUsageReprice.mockResolvedValue(report({ unpriced: 15, repriced: 15 }));
    render(<MaintenanceContent />);

    await user.click(screen.getByTestId('reprice-runs'));

    expect(agentUsageReprice).toHaveBeenCalledWith(ROOT);
    expect(await screen.findByTestId('reprice-result')).toHaveTextContent(
      'Priced 15 of 15 runs without a price.'
    );
    expect(loadAgentUsage).toHaveBeenCalledWith(ROOT);
  });

  it('does not reload when nothing changed', async () => {
    const user = userEvent.setup();
    const loadAgentUsage = vi.fn(async () => {});
    useStore.setState({ loadAgentUsage });
    agentUsageReprice.mockResolvedValue(report({}));
    render(<MaintenanceContent />);

    await user.click(screen.getByTestId('reprice-runs'));

    expect(await screen.findByTestId('reprice-result')).toHaveTextContent(
      'Every run in this project already has a price.'
    );
    expect(loadAgentUsage).not.toHaveBeenCalled();
  });

  it('raises an error toast when the backend refuses', async () => {
    const user = userEvent.setup();
    const showToast = vi.fn();
    useStore.setState({ showToast });
    agentUsageReprice.mockRejectedValue(new Error('locked'));
    render(<MaintenanceContent />);

    await user.click(screen.getByTestId('reprice-runs'));

    await vi.waitFor(() =>
      expect(showToast).toHaveBeenCalledWith('Could not recalculate pricing', 'error')
    );
    expect(screen.queryByTestId('reprice-result')).not.toBeInTheDocument();
    expect(screen.getByTestId('reprice-runs')).toBeEnabled();
  });
});
