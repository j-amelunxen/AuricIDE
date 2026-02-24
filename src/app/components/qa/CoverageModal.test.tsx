import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { CoverageModal } from './CoverageModal';
import type { CoverageSummary, FileCoverage } from '@/lib/qa/coverageParser';

const mockSummary: CoverageSummary = {
  lines: 74.5,
  statements: 74.4,
  functions: 73.5,
  branches: 64.2,
};

const mockFiles: FileCoverage[] = [
  { path: 'src/app/page.tsx', size: 100, lines: 95, statements: 93, functions: 88, branches: 80 },
  { path: 'src/lib/tauri/terminal.ts', size: 0, lines: 0, statements: 0, functions: 0, branches: 0 },
  { path: 'src/lib/store/qaSlice.ts', size: 200, lines: 100, statements: 100, functions: 100, branches: 100 },
  {
    path: 'src/app/components/qa/QAPanel.tsx',
    size: 80,
    lines: 60,
    statements: 58,
    functions: 55,
    branches: 50,
  },
];

describe('CoverageModal', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <CoverageModal isOpen={false} onClose={vi.fn()} summary={mockSummary} files={mockFiles} />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders when isOpen is true', () => {
    render(
      <CoverageModal isOpen={true} onClose={vi.fn()} summary={mockSummary} files={mockFiles} />
    );
    expect(screen.getByText(/Coverage Report/i)).toBeInTheDocument();
  });

  it('displays all four summary metrics', () => {
    render(
      <CoverageModal isOpen={true} onClose={vi.fn()} summary={mockSummary} files={mockFiles} />
    );
    // Multiple elements will match (summary header + file rows) – verify at least one exists
    expect(screen.getAllByText(/Lines/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Statements/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Functions/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Branches/i).length).toBeGreaterThan(0);
  });

  it('displays summary percentage values', () => {
    render(
      <CoverageModal isOpen={true} onClose={vi.fn()} summary={mockSummary} files={mockFiles} />
    );
    // Summary shows rounded values
    expect(screen.getByText('75%')).toBeInTheDocument(); // lines 74.5 → 75%
  });

  it('displays all file names', () => {
    render(
      <CoverageModal isOpen={true} onClose={vi.fn()} summary={mockSummary} files={mockFiles} />
    );
    expect(screen.getByText('page.tsx')).toBeInTheDocument();
    expect(screen.getByText('terminal.ts')).toBeInTheDocument();
    expect(screen.getByText('qaSlice.ts')).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <CoverageModal isOpen={true} onClose={onClose} summary={mockSummary} files={mockFiles} />
    );
    fireEvent.click(screen.getByRole('button', { name: /close/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('calls onClose when backdrop is clicked', () => {
    const onClose = vi.fn();
    render(
      <CoverageModal isOpen={true} onClose={onClose} summary={mockSummary} files={mockFiles} />
    );
    fireEvent.click(screen.getByTestId('coverage-modal-backdrop'));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows file count', () => {
    render(
      <CoverageModal isOpen={true} onClose={vi.fn()} summary={mockSummary} files={mockFiles} />
    );
    expect(screen.getByText(/4 files/i)).toBeInTheDocument();
  });

  it('sorts files by lines coverage ascending by default (worst first)', () => {
    render(
      <CoverageModal isOpen={true} onClose={vi.fn()} summary={mockSummary} files={mockFiles} />
    );
    const fileNames = screen.getAllByTestId('coverage-file-name').map((el) => el.textContent);
    // terminal.ts (0%) should be before page.tsx (95%)
    const terminalIdx = fileNames.findIndex((n) => n?.includes('terminal.ts'));
    const pageIdx = fileNames.findIndex((n) => n?.includes('page.tsx'));
    expect(terminalIdx).toBeLessThan(pageIdx);
  });

  it('filters files by search input', () => {
    render(
      <CoverageModal isOpen={true} onClose={vi.fn()} summary={mockSummary} files={mockFiles} />
    );
    const searchInput = screen.getByPlaceholderText(/filter files/i);
    fireEvent.change(searchInput, { target: { value: 'terminal' } });
    expect(screen.getByText('terminal.ts')).toBeInTheDocument();
    expect(screen.queryByText('page.tsx')).not.toBeInTheDocument();
  });

  it('shows "no files match" message when filter matches nothing', () => {
    render(
      <CoverageModal isOpen={true} onClose={vi.fn()} summary={mockSummary} files={mockFiles} />
    );
    const searchInput = screen.getByPlaceholderText(/filter files/i);
    fireEvent.change(searchInput, { target: { value: 'xyznotexisting' } });
    expect(screen.getByText(/no files match/i)).toBeInTheDocument();
  });

  it('changes sort direction when clicking the active sort option again', () => {
    render(
      <CoverageModal isOpen={true} onClose={vi.fn()} summary={mockSummary} files={mockFiles} />
    );
    // Default: lines ascending. Click "Lines" button to flip to descending.
    fireEvent.click(screen.getByRole('button', { name: /sort by lines/i }));
    const fileNames = screen.getAllByTestId('coverage-file-name').map((el) => el.textContent);
    // Now descending: qaSlice.ts (100%) should be first
    const topFile = fileNames[0];
    expect(topFile).toContain('qaSlice.ts');
  });
});
