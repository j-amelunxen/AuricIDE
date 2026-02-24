import { render, screen, fireEvent } from '@testing-library/react';
import { QAPanel } from './QAPanel';
import { useStore } from '@/lib/store';
import { vi, describe, it, expect, beforeEach } from 'vitest';

vi.mock('@/lib/store');

describe('QAPanel', () => {
  const mockSetSpawnDialogOpen = vi.fn();
  const mockSetInitialAgentTask = vi.fn();
  const mockLoadCoverage = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      coverageStatus: 'idle',
      coverageSummary: null,
      fileCoverage: [],
      rootPath: '/test/project',
      setSpawnDialogOpen: mockSetSpawnDialogOpen,
      setInitialAgentTask: mockSetInitialAgentTask,
      loadCoverage: mockLoadCoverage,
    });
  });

  it('renders loading state', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      coverageStatus: 'loading',
      coverageSummary: null,
      fileCoverage: [],
      rootPath: '/test/project',
      loadCoverage: mockLoadCoverage,
    });

    render(<QAPanel />);
    expect(screen.getByText(/Loading coverage data.../i)).toBeInTheDocument();
  });

  it('renders not found state with setup button', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      coverageStatus: 'not-found',
      coverageSummary: null,
      fileCoverage: [],
      rootPath: '/test/project',
      setSpawnDialogOpen: mockSetSpawnDialogOpen,
      setInitialAgentTask: mockSetInitialAgentTask,
      loadCoverage: mockLoadCoverage,
    });

    render(<QAPanel />);
    expect(screen.getByText(/No coverage information available/i)).toBeInTheDocument();

    const setupButton = screen.getByText(/Setup Coverage/i);
    fireEvent.click(setupButton);

    expect(mockSetInitialAgentTask).toHaveBeenCalledWith(
      expect.stringContaining('Coverage-Informationen')
    );
    expect(mockSetSpawnDialogOpen).toHaveBeenCalledWith(true);
  });

  it('renders not found state with configure location button', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      coverageStatus: 'not-found',
      coverageSummary: null,
      fileCoverage: [],
      rootPath: '/test/project',
      setSpawnDialogOpen: mockSetSpawnDialogOpen,
      setInitialAgentTask: mockSetInitialAgentTask,
      loadCoverage: mockLoadCoverage,
    });

    render(<QAPanel />);

    const configureButton = screen.getByText(/Configure Coverage Location/i);
    expect(configureButton).toBeInTheDocument();
  });

  it('configure location button opens agent dialog with correct task', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      coverageStatus: 'not-found',
      coverageSummary: null,
      fileCoverage: [],
      rootPath: '/test/project',
      setSpawnDialogOpen: mockSetSpawnDialogOpen,
      setInitialAgentTask: mockSetInitialAgentTask,
      loadCoverage: mockLoadCoverage,
    });

    render(<QAPanel />);

    const configureButton = screen.getByText(/Configure Coverage Location/i);
    fireEvent.click(configureButton);

    expect(mockSetInitialAgentTask).toHaveBeenCalledWith(expect.stringContaining('coverage'));
    expect(mockSetSpawnDialogOpen).toHaveBeenCalledWith(true);
  });

  it('setup and configure buttons are both visible in not-found state', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      coverageStatus: 'not-found',
      coverageSummary: null,
      fileCoverage: [],
      rootPath: '/test/project',
      setSpawnDialogOpen: mockSetSpawnDialogOpen,
      setInitialAgentTask: mockSetInitialAgentTask,
      loadCoverage: mockLoadCoverage,
    });

    render(<QAPanel />);

    expect(screen.getByText(/Setup Coverage/i)).toBeInTheDocument();
    expect(screen.getByText(/Configure Coverage Location/i)).toBeInTheDocument();
  });

  it('renders coverage summary cards when data is available', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      coverageStatus: 'idle',
      coverageSummary: {
        lines: 85,
        statements: 80,
        functions: 75,
        branches: 70,
      },
      fileCoverage: [
        { path: 'src/main.ts', lines: 90, statements: 85, functions: 80, branches: 75 },
      ],
      rootPath: '/test/project',
      loadCoverage: mockLoadCoverage,
    });

    render(<QAPanel />);
    expect(screen.getByText('85%')).toBeInTheDocument(); // Lines pct
  });

  it('shows "View Full Report" button when coverage data is available', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      coverageStatus: 'idle',
      coverageSummary: { lines: 85, statements: 80, functions: 75, branches: 70 },
      fileCoverage: [],
      rootPath: '/test/project',
      loadCoverage: mockLoadCoverage,
    });

    render(<QAPanel />);
    expect(screen.getByRole('button', { name: /View Full Report/i })).toBeInTheDocument();
  });

  it('does not show file list inline in the sidebar', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      coverageStatus: 'idle',
      coverageSummary: { lines: 85, statements: 80, functions: 75, branches: 70 },
      fileCoverage: [
        { path: 'src/main.ts', lines: 90, statements: 85, functions: 80, branches: 75 },
      ],
      rootPath: '/test/project',
      loadCoverage: mockLoadCoverage,
    });

    render(<QAPanel />);
    // The file list should be in the modal, not the sidebar panel
    expect(screen.queryByText('main.ts')).not.toBeInTheDocument();
  });

  it('opens coverage modal when "View Full Report" is clicked', () => {
    (useStore as unknown as ReturnType<typeof vi.fn>).mockReturnValue({
      coverageStatus: 'idle',
      coverageSummary: { lines: 85, statements: 80, functions: 75, branches: 70 },
      fileCoverage: [
        { path: 'src/main.ts', lines: 90, statements: 85, functions: 80, branches: 75 },
      ],
      rootPath: '/test/project',
      loadCoverage: mockLoadCoverage,
    });

    render(<QAPanel />);
    fireEvent.click(screen.getByRole('button', { name: /View Full Report/i }));
    expect(screen.getByText(/Coverage Report/i)).toBeInTheDocument();
    expect(screen.getByText('main.ts')).toBeInTheDocument();
  });
});
