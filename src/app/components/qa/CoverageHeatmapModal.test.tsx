import { fireEvent, render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { CoverageSummary, FileCoverage } from '@/lib/qa/coverageParser';

// The heatmap renders a WebGL scene; stub the 3D libraries so it mounts in jsdom.
// The WebGL scene lives inside <Canvas>; the dialog chrome (heading, controls)
// renders outside it, so stubbing Canvas to render nothing keeps the test in jsdom.
vi.mock('@react-three/fiber', () => ({
  Canvas: () => <div data-testid="r3f-canvas" />,
}));
vi.mock('@react-three/drei', () => ({
  OrbitControls: () => null,
  Html: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { CoverageHeatmapModal } from './CoverageHeatmapModal';

const mockSummary: CoverageSummary = {
  lines: 74.5,
  statements: 74.4,
  functions: 73.5,
  branches: 64.2,
};

const mockFiles: FileCoverage[] = [
  { path: 'src/app/page.tsx', size: 100, lines: 95, statements: 93, functions: 88, branches: 80 },
  {
    path: 'src/lib/store/qaSlice.ts',
    size: 200,
    lines: 100,
    statements: 100,
    functions: 100,
    branches: 100,
  },
];

describe('CoverageHeatmapModal', () => {
  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <CoverageHeatmapModal
        isOpen={false}
        onClose={vi.fn()}
        summary={mockSummary}
        files={mockFiles}
      />
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders the heatmap when open', () => {
    render(
      <CoverageHeatmapModal
        isOpen={true}
        onClose={vi.fn()}
        summary={mockSummary}
        files={mockFiles}
      />
    );
    expect(screen.getByText('3D Coverage Code City')).toBeInTheDocument();
  });

  it('exposes an accessible dialog when open', () => {
    render(
      <CoverageHeatmapModal
        isOpen={true}
        onClose={vi.fn()}
        summary={mockSummary}
        files={mockFiles}
      />
    );
    expect(screen.getByRole('dialog', { name: /3d coverage code city/i })).toBeInTheDocument();
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <CoverageHeatmapModal
        isOpen={true}
        onClose={onClose}
        summary={mockSummary}
        files={mockFiles}
      />
    );
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('names the icon-only close button Close', () => {
    render(
      <CoverageHeatmapModal
        isOpen={true}
        onClose={vi.fn()}
        summary={mockSummary}
        files={mockFiles}
      />
    );
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('shows the coverage legend', () => {
    render(
      <CoverageHeatmapModal
        isOpen={true}
        onClose={vi.fn()}
        summary={mockSummary}
        files={mockFiles}
      />
    );
    expect(screen.getByText('0% Coverage')).toBeInTheDocument();
    expect(screen.getByText('Building height = File size')).toBeInTheDocument();
  });
});
