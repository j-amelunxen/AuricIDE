import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { ExcalidrawBrowser } from './ExcalidrawBrowser';
import { useStore } from '@/lib/store';
import type { ExcalidrawSceneSummary } from '@/lib/excalidraw/types';

vi.mock('./ExcalidrawCanvas', () => ({
  ExcalidrawCanvas: () => <div data-testid="excalidraw-canvas" />,
}));

const PROJECT = '/tmp/project';

function makeScene(overrides: Partial<ExcalidrawSceneSummary> = {}): ExcalidrawSceneSummary {
  return {
    id: 'scn_checkout',
    name: 'Checkout Flow',
    collectionId: 'col_flows',
    workspaceId: 'ws_1',
    updatedAt: '2026-07-05T16:20:00Z',
    previewUrl: null,
    ...overrides,
  };
}

describe('ExcalidrawBrowser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useStore.getState().resetExcalidrawInMemory();
    useStore.setState({
      rootPath: PROJECT,
      excalidrawBrowserOpen: true,
      loadExcalidrawCollections: vi.fn(async () => {}),
      selectExcalidrawCollection: vi.fn(async () => {}),
      previewExcalidrawScene: vi.fn(async () => {}),
      markSceneAsSpec: vi.fn(async () => 'specs/checkout-flow.excalidraw'),
      resyncAllSpecs: vi.fn(async () => ({ synced: 0, failed: 0 })),
    });
  });

  it('renders nothing while closed', () => {
    useStore.setState({ excalidrawBrowserOpen: false });
    render(<ExcalidrawBrowser />);
    expect(screen.queryByTestId('excalidraw-browser')).not.toBeInTheDocument();
  });

  it('loads collections when opened', () => {
    const loadExcalidrawCollections = vi.fn(async () => {});
    useStore.setState({ loadExcalidrawCollections });
    render(<ExcalidrawBrowser />);
    expect(loadExcalidrawCollections).toHaveBeenCalledWith(PROJECT);
  });

  it('is an accessible dialog', () => {
    render(<ExcalidrawBrowser />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('lists collections and selects one to load its scenes', () => {
    const selectExcalidrawCollection = vi.fn(async () => {});
    useStore.setState({
      selectExcalidrawCollection,
      excalidrawCollections: [
        { id: 'col_arch', name: 'Architecture', emoji: '📐', updatedAt: null },
        { id: 'col_flows', name: 'Flow Specs', emoji: null, updatedAt: null },
      ],
    });
    render(<ExcalidrawBrowser />);

    fireEvent.click(screen.getByTestId('excalidraw-collection-col_flows'));
    expect(selectExcalidrawCollection).toHaveBeenCalledWith(PROJECT, 'col_flows');
  });

  it('marks a scene as spec and notifies for a tree refresh', async () => {
    const markSceneAsSpec = vi.fn(async () => 'specs/checkout-flow.excalidraw');
    const onImported = vi.fn();
    useStore.setState({
      markSceneAsSpec,
      excalidrawScenes: [makeScene()],
      excalidrawSelectedCollectionId: 'col_flows',
    });
    render(<ExcalidrawBrowser onImported={onImported} />);

    fireEvent.click(screen.getByTestId('excalidraw-mark-spec-scn_checkout'));

    await waitFor(() => {
      expect(markSceneAsSpec).toHaveBeenCalledWith(
        PROJECT,
        expect.objectContaining({ id: 'scn_checkout' })
      );
      expect(onImported).toHaveBeenCalled();
    });
  });

  it('shows a Spec badge and re-sync wording for already linked scenes', () => {
    useStore.setState({
      excalidrawScenes: [makeScene()],
      excalidrawSelectedCollectionId: 'col_flows',
      excalidrawSpecLinks: {
        'specs/checkout-flow.excalidraw': {
          sceneId: 'scn_checkout',
          collectionId: 'col_flows',
          workspaceId: 'ws_1',
          sceneName: 'Checkout Flow',
          importedAt: '2026-07-01T00:00:00Z',
        },
      },
    });
    render(<ExcalidrawBrowser />);
    expect(screen.getByTestId('excalidraw-spec-badge-scn_checkout')).toBeInTheDocument();
    expect(screen.getByTestId('excalidraw-mark-spec-scn_checkout')).toHaveTextContent('Re-sync');
  });

  const LINKED_CHECKOUT = {
    'specs/checkout-flow.excalidraw': {
      sceneId: 'scn_checkout',
      collectionId: 'col_flows',
      workspaceId: 'ws_1',
      sceneName: 'Checkout Flow',
      importedAt: '2026-07-01T00:00:00Z',
    },
  };

  it('removes the local copy of a linked scene after confirmation', async () => {
    const removeSpecFile = vi.fn(async () => {});
    const onImported = vi.fn();
    useStore.setState({
      removeSpecFile,
      excalidrawScenes: [makeScene()],
      excalidrawSelectedCollectionId: 'col_flows',
      excalidrawSpecLinks: LINKED_CHECKOUT,
    });
    render(<ExcalidrawBrowser onImported={onImported} />);

    fireEvent.click(screen.getByTestId('excalidraw-remove-local-scn_checkout'));
    const dialog = await screen.findByRole('dialog', { name: 'Delete local copy?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(removeSpecFile).toHaveBeenCalledWith(PROJECT, 'specs/checkout-flow.excalidraw');
      expect(onImported).toHaveBeenCalled();
    });
  });

  it('does not remove the local copy when the confirmation is declined', async () => {
    const removeSpecFile = vi.fn(async () => {});
    useStore.setState({
      removeSpecFile,
      excalidrawScenes: [makeScene()],
      excalidrawSelectedCollectionId: 'col_flows',
      excalidrawSpecLinks: LINKED_CHECKOUT,
    });
    render(<ExcalidrawBrowser />);

    fireEvent.click(screen.getByTestId('excalidraw-remove-local-scn_checkout'));
    const dialog = await screen.findByRole('dialog', { name: 'Delete local copy?' });
    // Nothing may happen while the question is still open — that was the bug.
    expect(removeSpecFile).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Delete local copy?' })).not.toBeInTheDocument()
    );
    expect(removeSpecFile).not.toHaveBeenCalled();
  });

  it('offers no remove-local action for scenes that are not linked', () => {
    useStore.setState({
      excalidrawScenes: [makeScene()],
      excalidrawSelectedCollectionId: 'col_flows',
    });
    render(<ExcalidrawBrowser />);
    expect(screen.queryByTestId('excalidraw-remove-local-scn_checkout')).not.toBeInTheDocument();
  });

  it('previews a scene lazily on demand', () => {
    const previewExcalidrawScene = vi.fn(async () => {});
    useStore.setState({
      previewExcalidrawScene,
      excalidrawScenes: [makeScene()],
      excalidrawSelectedCollectionId: 'col_flows',
    });
    render(<ExcalidrawBrowser />);

    fireEvent.click(screen.getByTestId('excalidraw-preview-scn_checkout'));
    expect(previewExcalidrawScene).toHaveBeenCalledWith(PROJECT, 'scn_checkout');
  });

  it('renders the preview canvas once content arrived', () => {
    useStore.setState({
      excalidrawScenes: [makeScene()],
      excalidrawPreview: { sceneId: 'scn_checkout', fileJson: '{"elements":[]}' },
    });
    render(<ExcalidrawBrowser />);
    expect(screen.getByTestId('excalidraw-canvas')).toBeInTheDocument();
  });

  it('points to the settings when the key is not configured', () => {
    useStore.setState({
      excalidrawCollectionsStatus: 'error',
      excalidrawError: 'EXCALIDRAW_NOT_CONFIGURED: no Excalidraw+ API key — add one in Settings',
    });
    render(<ExcalidrawBrowser />);
    expect(screen.getByTestId('excalidraw-configure-cta')).toBeInTheDocument();
  });

  it('shows the precise taxonomy error for other failures', () => {
    useStore.setState({
      excalidrawCollectionsStatus: 'error',
      excalidrawError: 'EXCALIDRAW_AUTH: Excalidraw+ rejected the API key (HTTP 401)',
    });
    render(<ExcalidrawBrowser />);
    expect(screen.getByTestId('excalidraw-browser-error')).toHaveTextContent('EXCALIDRAW_AUTH');
  });

  it('syncs all linked specs from the footer', async () => {
    const resyncAllSpecs = vi.fn(async () => ({ synced: 2, failed: 0 }));
    useStore.setState({
      resyncAllSpecs,
      excalidrawSpecLinks: {
        'specs/a.excalidraw': {
          sceneId: 's_a',
          collectionId: null,
          workspaceId: null,
          sceneName: 'A',
          importedAt: '',
        },
      },
    });
    render(<ExcalidrawBrowser />);

    fireEvent.click(screen.getByTestId('excalidraw-sync-all'));
    await waitFor(() => expect(resyncAllSpecs).toHaveBeenCalledWith(PROJECT));
  });

  it('closes via the close button', () => {
    render(<ExcalidrawBrowser />);
    fireEvent.click(screen.getByTestId('excalidraw-browser-close'));
    expect(useStore.getState().excalidrawBrowserOpen).toBe(false);
  });
});
