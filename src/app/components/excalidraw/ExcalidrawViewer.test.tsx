import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { ExcalidrawViewer } from './ExcalidrawViewer';
import { useStore } from '@/lib/store';

interface CapturedCanvasProps {
  elements: unknown[];
  viewMode?: boolean;
  onSceneChange?: (
    elements: readonly unknown[],
    appState: Record<string, unknown>,
    files: Record<string, unknown>
  ) => void;
}

let lastCanvasProps: CapturedCanvasProps | null = null;
vi.mock('./ExcalidrawCanvas', () => ({
  ExcalidrawCanvas: (props: CapturedCanvasProps) => {
    lastCanvasProps = props;
    return (
      <div data-testid="excalidraw-canvas" data-view-mode={String(props.viewMode)}>
        {props.elements.length} elements
      </div>
    );
  },
}));

const mockWriteFile = vi.fn();
vi.mock('@/lib/tauri/fs', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, writeFile: (...args: unknown[]) => mockWriteFile(...args) };
});

const mockSceneUrl = vi.fn();
vi.mock('@/lib/tauri/excalidraw', () => ({
  excalidrawSceneUrl: (...args: unknown[]) => mockSceneUrl(...args),
}));

const mockOpenExternal = vi.fn();
vi.mock('@/lib/tauri/opener', () => ({
  openExternalUrl: (...args: unknown[]) => mockOpenExternal(...args),
}));

const PROJECT = '/tmp/project';
const FILE = `${PROJECT}/specs/checkout-flow.excalidraw`;

const VALID_CONTENT = JSON.stringify({
  type: 'excalidraw',
  version: 2,
  elements: [{ id: 'r1', type: 'rectangle' }],
  appState: { viewBackgroundColor: '#fff' },
  files: {},
});

const LINKED = {
  'specs/checkout-flow.excalidraw': {
    sceneId: 'scn_1',
    collectionId: 'col_1',
    workspaceId: 'ws_1',
    sceneName: 'Checkout Flow',
    importedAt: '2026-07-01T00:00:00Z',
  },
};

describe('ExcalidrawViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWriteFile.mockResolvedValue(undefined);
    lastCanvasProps = null;
    useStore.getState().resetExcalidrawInMemory();
    useStore.setState({ rootPath: PROJECT });
  });

  it('renders the canvas for a valid .excalidraw file', () => {
    render(<ExcalidrawViewer content={VALID_CONTENT} filePath={FILE} />);
    expect(screen.getByTestId('excalidraw-canvas')).toHaveTextContent('1 elements');
  });

  it('shows an error panel instead of crashing on invalid JSON', () => {
    render(<ExcalidrawViewer content="{not json" filePath={FILE} />);
    expect(screen.queryByTestId('excalidraw-canvas')).not.toBeInTheDocument();
    expect(screen.getByTestId('excalidraw-viewer-error')).toBeInTheDocument();
  });

  it('shows an error panel when elements are missing', () => {
    render(<ExcalidrawViewer content='{"type":"excalidraw"}' filePath={FILE} />);
    expect(screen.getByTestId('excalidraw-viewer-error')).toBeInTheDocument();
  });

  it('offers no sync actions for a file without a registered link', () => {
    render(<ExcalidrawViewer content={VALID_CONTENT} filePath={FILE} />);
    expect(screen.queryByTestId('excalidraw-resync')).not.toBeInTheDocument();
    expect(screen.queryByTestId('excalidraw-open-plus')).not.toBeInTheDocument();
  });

  it('opens plain local files in edit mode', () => {
    render(<ExcalidrawViewer content={VALID_CONTENT} filePath={FILE} />);
    expect(screen.getByTestId('excalidraw-canvas')).toHaveAttribute('data-view-mode', 'false');
    expect(screen.getByTestId('excalidraw-mode-badge')).toHaveTextContent(/editable/i);
  });

  it('keeps linked specs read-only — the source of truth is Excalidraw+', () => {
    useStore.setState({ excalidrawSpecLinks: LINKED });
    render(<ExcalidrawViewer content={VALID_CONTENT} filePath={FILE} />);
    expect(screen.getByTestId('excalidraw-canvas')).toHaveAttribute('data-view-mode', 'true');
    expect(screen.getByTestId('excalidraw-mode-badge')).toHaveTextContent(/read-only/i);
    expect(lastCanvasProps?.onSceneChange).toBeUndefined();
  });

  it('persists local edits back to the file, debounced', async () => {
    vi.useFakeTimers();
    try {
      render(<ExcalidrawViewer content={VALID_CONTENT} filePath={FILE} />);
      const onSceneChange = lastCanvasProps?.onSceneChange;
      expect(onSceneChange).toBeDefined();

      // First onChange establishes the baseline — must not write.
      onSceneChange!([{ id: 'r1', type: 'rectangle' }], {}, {});
      vi.advanceTimersByTime(2000);
      expect(mockWriteFile).not.toHaveBeenCalled();

      // A real edit gets written after the debounce.
      onSceneChange!(
        [
          { id: 'r1', type: 'rectangle' },
          { id: 'e2', type: 'ellipse' },
        ],
        {},
        {}
      );
      vi.advanceTimersByTime(2000);
      expect(mockWriteFile).toHaveBeenCalledTimes(1);
      const [writtenPath, written] = mockWriteFile.mock.calls[0] as [string, string];
      expect(writtenPath).toBe(FILE);
      expect(written).toContain('"e2"');
      expect(JSON.parse(written).type).toBe('excalidraw');
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not write when only ephemeral state changed', () => {
    vi.useFakeTimers();
    try {
      render(<ExcalidrawViewer content={VALID_CONTENT} filePath={FILE} />);
      const onSceneChange = lastCanvasProps!.onSceneChange!;

      onSceneChange([{ id: 'r1' }], { scrollX: 0 }, {});
      vi.advanceTimersByTime(2000);
      onSceneChange([{ id: 'r1' }], { scrollX: 500, zoom: { value: 2 } }, {});
      vi.advanceTimersByTime(2000);

      expect(mockWriteFile).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('offers Re-sync and Open in Excalidraw+ for a linked spec', () => {
    useStore.setState({
      excalidrawSpecLinks: {
        'specs/checkout-flow.excalidraw': {
          sceneId: 'scn_1',
          collectionId: 'col_1',
          workspaceId: 'ws_1',
          sceneName: 'Checkout Flow',
          importedAt: '2026-07-01T00:00:00Z',
        },
      },
    });
    render(<ExcalidrawViewer content={VALID_CONTENT} filePath={FILE} />);
    expect(screen.getByTestId('excalidraw-resync')).toBeInTheDocument();
    expect(screen.getByTestId('excalidraw-open-plus')).toBeInTheDocument();
  });

  it('re-syncs the spec and reloads the tab content', async () => {
    const resyncSpec = vi.fn(async () => {});
    const onReload = vi.fn();
    useStore.setState({
      resyncSpec,
      excalidrawSpecLinks: {
        'specs/checkout-flow.excalidraw': {
          sceneId: 'scn_1',
          collectionId: 'col_1',
          workspaceId: 'ws_1',
          sceneName: 'Checkout Flow',
          importedAt: '2026-07-01T00:00:00Z',
        },
      },
    });
    render(<ExcalidrawViewer content={VALID_CONTENT} filePath={FILE} onReload={onReload} />);

    fireEvent.click(screen.getByTestId('excalidraw-resync'));

    await waitFor(() => {
      expect(resyncSpec).toHaveBeenCalledWith(PROJECT, 'specs/checkout-flow.excalidraw');
      expect(onReload).toHaveBeenCalled();
    });
  });

  it('unlinks a spec: file survives and becomes editable', async () => {
    const unlinkSpec = vi.fn(async () => {});
    useStore.setState({ unlinkSpec, excalidrawSpecLinks: LINKED });
    render(<ExcalidrawViewer content={VALID_CONTENT} filePath={FILE} />);

    fireEvent.click(screen.getByTestId('excalidraw-unlink'));

    await waitFor(() => {
      expect(unlinkSpec).toHaveBeenCalledWith(PROJECT, 'specs/checkout-flow.excalidraw');
    });
  });

  it('deletes the local copy after confirmation and closes the tab', async () => {
    const removeSpecFile = vi.fn(async () => {});
    const closeTab = vi.fn();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    useStore.setState({ removeSpecFile, closeTab, excalidrawSpecLinks: LINKED });
    render(<ExcalidrawViewer content={VALID_CONTENT} filePath={FILE} />);

    fireEvent.click(screen.getByTestId('excalidraw-remove-local'));

    await waitFor(() => {
      expect(removeSpecFile).toHaveBeenCalledWith(PROJECT, 'specs/checkout-flow.excalidraw');
      expect(closeTab).toHaveBeenCalledWith(FILE);
    });
    confirmSpy.mockRestore();
  });

  it('does not delete anything when the confirmation is declined', async () => {
    const removeSpecFile = vi.fn(async () => {});
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    useStore.setState({ removeSpecFile, excalidrawSpecLinks: LINKED });
    render(<ExcalidrawViewer content={VALID_CONTENT} filePath={FILE} />);

    fireEvent.click(screen.getByTestId('excalidraw-remove-local'));

    expect(removeSpecFile).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('offers no unlink or delete for plain local files', () => {
    render(<ExcalidrawViewer content={VALID_CONTENT} filePath={FILE} />);
    expect(screen.queryByTestId('excalidraw-unlink')).not.toBeInTheDocument();
    expect(screen.queryByTestId('excalidraw-remove-local')).not.toBeInTheDocument();
  });

  it('opens the scene on Excalidraw+ via the opener', async () => {
    mockSceneUrl.mockResolvedValue('https://app.excalidraw.com/s/ws_1/scn_1');
    useStore.setState({
      excalidrawSpecLinks: {
        'specs/checkout-flow.excalidraw': {
          sceneId: 'scn_1',
          collectionId: 'col_1',
          workspaceId: 'ws_1',
          sceneName: 'Checkout Flow',
          importedAt: '2026-07-01T00:00:00Z',
        },
      },
    });
    render(<ExcalidrawViewer content={VALID_CONTENT} filePath={FILE} />);

    fireEvent.click(screen.getByTestId('excalidraw-open-plus'));

    await waitFor(() => {
      expect(mockSceneUrl).toHaveBeenCalledWith('ws_1', 'scn_1');
      expect(mockOpenExternal).toHaveBeenCalledWith('https://app.excalidraw.com/s/ws_1/scn_1');
    });
  });
});
