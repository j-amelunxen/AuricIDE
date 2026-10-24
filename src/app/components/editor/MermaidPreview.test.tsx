import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MermaidPreview } from './MermaidPreview';

const { mockInitialize, mockRender } = vi.hoisted(() => ({
  mockInitialize: vi.fn(),
  mockRender: vi.fn().mockResolvedValue({ svg: '<svg>mock diagram</svg>' }),
}));

vi.mock('mermaid', () => ({
  default: {
    initialize: mockInitialize,
    render: mockRender,
  },
}));

describe('MermaidPreview', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRender.mockResolvedValue({ svg: '<svg>mock diagram</svg>' });
  });

  it('renders the preview container with data-testid="mermaid-preview"', () => {
    render(<MermaidPreview code="graph TD; A-->B" />);
    expect(screen.getByTestId('mermaid-preview')).toBeInTheDocument();
  });

  it('shows loading state initially', () => {
    render(<MermaidPreview code="graph TD; A-->B" />);
    expect(screen.getByText('Rendering diagram...')).toBeInTheDocument();
  });

  it('renders SVG after mermaid.render resolves', async () => {
    render(<MermaidPreview code="graph TD; A-->B" />);

    await waitFor(() => {
      expect(screen.getByTestId('mermaid-preview').innerHTML).toContain('<svg>mock diagram</svg>');
    });
  });

  it('shows error state for invalid syntax', async () => {
    mockRender.mockRejectedValue(new Error('Parse error: invalid syntax'));

    render(<MermaidPreview code="not valid mermaid" />);

    await waitFor(() => {
      expect(screen.getByText(/Parse error: invalid syntax/)).toBeInTheDocument();
    });
  });

  it('calls mermaid.initialize with dark theme config', async () => {
    render(<MermaidPreview code="graph TD; A-->B" />);
    await waitFor(() => expect(mockInitialize).toHaveBeenCalled());

    expect(mockInitialize).toHaveBeenCalledWith(
      expect.objectContaining({
        theme: 'dark',
        themeVariables: expect.objectContaining({
          darkMode: true,
          background: '#0c1219',
          primaryColor: '#137fec',
          primaryTextColor: '#e2e8f0',
          lineColor: '#2a3b4d',
          secondaryColor: '#151e29',
        }),
      })
    );
  });

  it('re-renders when code prop changes', async () => {
    const { rerender } = render(<MermaidPreview code="graph TD; A-->B" />);

    await waitFor(() => {
      expect(mockRender).toHaveBeenCalledTimes(1);
    });

    mockRender.mockResolvedValue({ svg: '<svg>updated diagram</svg>' });

    await act(async () => {
      rerender(<MermaidPreview code="graph LR; X-->Y" />);
    });

    await waitFor(() => {
      expect(mockRender).toHaveBeenCalledTimes(2);
    });

    await waitFor(() => {
      expect(screen.getByTestId('mermaid-preview').innerHTML).toContain(
        '<svg>updated diagram</svg>'
      );
    });
  });

  it('opens and closes a fullscreen view with its own zoom controls', async () => {
    render(<MermaidPreview code="graph TD; A-->B" />);
    fireEvent.click(await screen.findByLabelText('Expand'));

    const dialog = screen.getByRole('dialog', { name: 'Diagram fullscreen' });
    expect(dialog.innerHTML).toContain('<svg>mock diagram</svg>');

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('zooms with the buttons and resets with Fit', async () => {
    render(<MermaidPreview code="graph TD; A-->B" />);
    await screen.findByLabelText('Zoom in');
    const content = screen.getByTestId('mermaid-panzoom-content');

    fireEvent.click(screen.getByLabelText('Zoom in'));
    expect(content.style.transform).toContain('scale(1.25)');

    fireEvent.click(screen.getByLabelText('Reset zoom'));
    expect(content.style.transform).toContain('scale(1)');
  });

  it('does not hijack the plain wheel inline, only Ctrl/Cmd+wheel zooms', async () => {
    render(<MermaidPreview code="graph TD; A-->B" />);
    const frame = await screen.findByTestId('mermaid-panzoom-frame');
    const content = screen.getByTestId('mermaid-panzoom-content');

    fireEvent.wheel(frame, { deltaY: -200 });
    expect(content.style.transform).toContain('scale(1)');

    fireEvent.wheel(frame, { deltaY: -200, ctrlKey: true });
    expect(content.style.transform).not.toContain('scale(1)');
  });
});
