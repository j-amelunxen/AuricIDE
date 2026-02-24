import { act, render, screen, waitFor } from '@testing-library/react';
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

  it('calls mermaid.initialize with dark theme config', () => {
    render(<MermaidPreview code="graph TD; A-->B" />);

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
});
