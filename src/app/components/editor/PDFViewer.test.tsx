import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PDFViewer } from './PDFViewer';

// Mock pdfjs-dist
const mockRenderTask = {
  promise: Promise.resolve(),
  cancel: vi.fn(),
};

const mockPage = {
  getViewport: vi.fn(() => ({ width: 800, height: 1000 })),
  render: vi.fn(() => mockRenderTask),
};

const mockDoc = {
  numPages: 3,
  getPage: vi.fn(async () => mockPage),
  destroy: vi.fn(),
};

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: vi.fn(() => ({
    promise: Promise.resolve(mockDoc),
  })),
}));

// Stub URL constructor for worker src
vi.stubGlobal(
  'URL',
  class {
    href: string;
    constructor(path: string, base?: string) {
      this.href = base ? `${base}/${path}` : path;
    }
  }
);

// Stub atob for base64 decoding
vi.stubGlobal('atob', (s: string) => s);

describe('PDFViewer', () => {
  const defaultSrc = 'dGVzdA=='; // base64 "test"

  beforeEach(() => {
    vi.clearAllMocks();
    mockDoc.getPage.mockResolvedValue(mockPage);
  });

  it('shows loading state initially', () => {
    render(<PDFViewer src={defaultSrc} fileName="test.pdf" />);
    expect(screen.getByText(/loading pdf/i)).toBeDefined();
  });

  it('renders toolbar with zoom controls', async () => {
    render(<PDFViewer src={defaultSrc} fileName="test.pdf" />);
    expect(screen.getByTitle('Zoom In')).toBeDefined();
    expect(screen.getByTitle('Zoom Out')).toBeDefined();
    expect(screen.getByTitle('Reset Zoom')).toBeDefined();
  });

  it('shows filename in the footer', async () => {
    render(<PDFViewer src={defaultSrc} fileName="my-document.pdf" />);
    expect(screen.getByText('my-document.pdf')).toBeDefined();
  });

  it('zoom buttons update zoom display', async () => {
    const user = userEvent.setup();
    render(<PDFViewer src={defaultSrc} fileName="test.pdf" />);

    // Initial zoom is 100%
    expect(screen.getByText('100%')).toBeDefined();

    await user.click(screen.getByTitle('Zoom In'));
    expect(screen.getByText('125%')).toBeDefined();

    await user.click(screen.getByTitle('Zoom Out'));
    expect(screen.getByText('100%')).toBeDefined();

    await user.click(screen.getByTitle('Reset Zoom'));
    expect(screen.getByText('100%')).toBeDefined();
  });
});
