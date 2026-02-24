import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { ReferencesPanel } from './ReferencesPanel';
import type { ReferenceResult } from '@/lib/refactoring/findReferences';

const sampleResults: ReferenceResult[] = [
  {
    type: 'entity',
    filePath: '/project/a.md',
    lineNumber: 3,
    lineText: 'Use DataPipeline here',
    charFrom: 4,
    charTo: 16,
  },
  {
    type: 'entity',
    filePath: '/project/a.md',
    lineNumber: 10,
    lineText: 'The DataPipeline processes data',
    charFrom: 4,
    charTo: 16,
  },
  {
    type: 'entity',
    filePath: '/project/b.md',
    lineNumber: 1,
    lineText: 'DataPipeline is great',
    charFrom: 0,
    charTo: 12,
  },
];

describe('ReferencesPanel', () => {
  it('renders the query in the header', () => {
    render(
      <ReferencesPanel
        results={sampleResults}
        query="DataPipeline"
        onClose={() => {}}
        onNavigate={() => {}}
      />
    );

    // The header contains the "References" heading
    const header = screen.getByRole('heading', { name: /references/i });
    expect(header).toBeInTheDocument();
    // The query appears in the summary span near the heading
    const headerContainer = header.closest('div')!;
    expect(within(headerContainer).getByText(/DataPipeline/)).toBeInTheDocument();
  });

  it('shows total reference count', () => {
    render(
      <ReferencesPanel
        results={sampleResults}
        query="DataPipeline"
        onClose={() => {}}
        onNavigate={() => {}}
      />
    );

    expect(screen.getByText(/3 references/i)).toBeInTheDocument();
  });

  it('groups results by file path', () => {
    render(
      <ReferencesPanel
        results={sampleResults}
        query="DataPipeline"
        onClose={() => {}}
        onNavigate={() => {}}
      />
    );

    // File group headers show just the filename
    const fileHeaders = screen.getAllByText('a.md');
    expect(fileHeaders.length).toBeGreaterThanOrEqual(1);
    const bHeaders = screen.getAllByText('b.md');
    expect(bHeaders.length).toBeGreaterThanOrEqual(1);
  });

  it('shows line text for each result', () => {
    render(
      <ReferencesPanel
        results={sampleResults}
        query="DataPipeline"
        onClose={() => {}}
        onNavigate={() => {}}
      />
    );

    expect(screen.getByText('Use DataPipeline here')).toBeInTheDocument();
    expect(screen.getByText('DataPipeline is great')).toBeInTheDocument();
  });

  it('shows line numbers', () => {
    render(
      <ReferencesPanel
        results={sampleResults}
        query="DataPipeline"
        onClose={() => {}}
        onNavigate={() => {}}
      />
    );

    expect(screen.getByText(':3')).toBeInTheDocument();
    expect(screen.getByText(':10')).toBeInTheDocument();
    expect(screen.getByText(':1')).toBeInTheDocument();
  });

  it('calls onNavigate when clicking a result', () => {
    const onNavigate = vi.fn();
    render(
      <ReferencesPanel
        results={sampleResults}
        query="DataPipeline"
        onClose={() => {}}
        onNavigate={onNavigate}
      />
    );

    const lineButton = screen.getByText('Use DataPipeline here').closest('button');
    expect(lineButton).toBeTruthy();
    fireEvent.click(lineButton!);

    expect(onNavigate).toHaveBeenCalledWith('/project/a.md', 3);
  });

  it('calls onClose when clicking the close button', () => {
    const onClose = vi.fn();
    render(
      <ReferencesPanel
        results={sampleResults}
        query="DataPipeline"
        onClose={onClose}
        onNavigate={() => {}}
      />
    );

    const closeButton = screen.getByRole('button', { name: /close/i });
    fireEvent.click(closeButton);

    expect(onClose).toHaveBeenCalled();
  });

  it('shows empty state when no results', () => {
    render(
      <ReferencesPanel results={[]} query="Unknown" onClose={() => {}} onNavigate={() => {}} />
    );

    // Both the summary and the body show "no references found";
    // use getAllByText to verify at least one exists
    const noRefElements = screen.getAllByText(/no references found/i);
    expect(noRefElements.length).toBeGreaterThanOrEqual(1);
  });
});
