import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProblemsPanel } from './ProblemsPanel';
import type { StoreDiagnostic } from '@/lib/store/diagnosticsSlice';

const sampleDiags: StoreDiagnostic[] = [
  {
    line: 5,
    column: 1,
    message: 'Broken link: "missing.md" not found',
    ruleId: 'remark-lint:broken-links',
    severity: 'error',
  },
  {
    line: 12,
    column: 1,
    message: 'Ordered list marker should be "."',
    ruleId: 'remark-lint:ordered-list-marker-style',
    severity: 'warning',
  },
  {
    line: 18,
    column: 1,
    message: 'Heading levels should increment by one',
    ruleId: 'remark-lint:heading-increment',
    severity: 'warning',
  },
];

describe('ProblemsPanel', () => {
  it('renders diagnostic messages', () => {
    render(
      <ProblemsPanel
        diagnostics={sampleDiags}
        filePath="/project/doc.md"
        onClose={() => {}}
        onNavigate={() => {}}
      />
    );
    expect(screen.getByText(/missing\.md/)).toBeInTheDocument();
    expect(screen.getByText(/Ordered list marker/)).toBeInTheDocument();
    expect(screen.getByText(/Heading levels/)).toBeInTheDocument();
  });

  it('displays error and warning counts', () => {
    render(
      <ProblemsPanel
        diagnostics={sampleDiags}
        filePath="/project/doc.md"
        onClose={() => {}}
        onNavigate={() => {}}
      />
    );
    // 1 error, 2 warnings
    expect(screen.getByTestId('error-count')).toHaveTextContent('1');
    expect(screen.getByTestId('warning-count')).toHaveTextContent('2');
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <ProblemsPanel
        diagnostics={sampleDiags}
        filePath="/project/doc.md"
        onClose={onClose}
        onNavigate={() => {}}
      />
    );
    fireEvent.click(screen.getByLabelText('Close'));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('calls onNavigate with correct line on row click', () => {
    const onNavigate = vi.fn();
    render(
      <ProblemsPanel
        diagnostics={sampleDiags}
        filePath="/project/doc.md"
        onClose={() => {}}
        onNavigate={onNavigate}
      />
    );
    // Click the first diagnostic row (line 5)
    fireEvent.click(screen.getByText(/missing\.md/));
    expect(onNavigate).toHaveBeenCalledWith(5);
  });

  it('renders empty state when no diagnostics', () => {
    render(
      <ProblemsPanel
        diagnostics={[]}
        filePath="/project/doc.md"
        onClose={() => {}}
        onNavigate={() => {}}
      />
    );
    expect(screen.getByText(/No problems/)).toBeInTheDocument();
  });

  it('shows file name from filePath', () => {
    render(
      <ProblemsPanel
        diagnostics={sampleDiags}
        filePath="/project/doc.md"
        onClose={() => {}}
        onNavigate={() => {}}
      />
    );
    expect(screen.getByText('doc.md')).toBeInTheDocument();
  });
});
