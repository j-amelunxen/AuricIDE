import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ResizablePanel } from './ResizablePanel';

describe('ResizablePanel', () => {
  it('renders children', () => {
    render(
      <ResizablePanel direction="horizontal" defaultSize={250} minSize={150}>
        <div data-testid="panel-content">Content</div>
      </ResizablePanel>
    );
    expect(screen.getByTestId('panel-content')).toHaveTextContent('Content');
  });

  it('renders with default width for horizontal panels', () => {
    render(
      <ResizablePanel direction="horizontal" defaultSize={250} minSize={150}>
        <div>Content</div>
      </ResizablePanel>
    );
    const panel = screen.getByTestId('resizable-panel');
    expect(panel.style.width).toBe('250px');
  });

  it('renders with default height for vertical panels', () => {
    render(
      <ResizablePanel direction="vertical" defaultSize={200} minSize={100}>
        <div>Content</div>
      </ResizablePanel>
    );
    const panel = screen.getByTestId('resizable-panel');
    expect(panel.style.height).toBe('200px');
  });

  it('renders drag handle', () => {
    render(
      <ResizablePanel direction="horizontal" defaultSize={250} minSize={150}>
        <div>Content</div>
      </ResizablePanel>
    );
    expect(screen.getByTestId('resize-handle')).toBeInTheDocument();
  });

  it('hides content when collapsed', () => {
    render(
      <ResizablePanel direction="horizontal" defaultSize={250} minSize={150} collapsed>
        <div data-testid="panel-content">Content</div>
      </ResizablePanel>
    );
    const panel = screen.getByTestId('resizable-panel');
    expect(panel.style.width).toBe('0px');
  });
});
