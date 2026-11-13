import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LinkGraphView } from './LinkGraphView';

// Mock zustand store
const activeTab = vi.hoisted(() => ({ id: null as string | null }));
vi.mock('@/lib/store', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  useStore: vi.fn((selector: (s: any) => any) => {
    const state = {
      linkIndex: new Map(),
      brokenLinks: new Map(),
      allFilePaths: [],
      activeTabId: activeTab.id,
    };
    return selector(state);
  }),
}));

// Mock @xyflow/react
vi.mock('@xyflow/react', () => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ReactFlow: ({ children, ...props }: any) => (
    <div data-testid="react-flow" {...props}>
      {children}
    </div>
  ),
  Background: () => <div data-testid="rf-background" />,
  Controls: () => <div data-testid="rf-controls" />,
  MiniMap: () => <div data-testid="rf-minimap" />,
  Handle: ({ type }: { type: string }) => <div data-testid={`handle-${type}`} />,
  Position: { Left: 'left', Right: 'right', Top: 'top', Bottom: 'bottom' },
}));

// Mock linkGraphLayout
vi.mock('@/lib/graph/linkGraphLayout', () => ({
  layoutLinkGraph: vi.fn(() => ({ nodes: [], edges: [] })),
}));

describe('LinkGraphView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    activeTab.id = null;
  });

  it.each([
    ['a file tab', '/repo/notes.md', '/repo/notes.md'],
    ['a diff tab', 'diff:unstaged:/repo:/repo/notes.md', null],
    ['the git graph', 'git-graph:/repo', null],
    ['a mindmap tab', 'mindmap::/repo/notes.md', null],
  ])('highlights only a real file: %s', async (_, id, expected) => {
    const { layoutLinkGraph } = await import('@/lib/graph/linkGraphLayout');
    activeTab.id = id;
    render(<LinkGraphView />);
    expect(vi.mocked(layoutLinkGraph)).toHaveBeenLastCalledWith(
      expect.objectContaining({ activeFilePath: expected })
    );
  });

  it('renders the graph view container', () => {
    render(<LinkGraphView />);
    expect(screen.getByTestId('link-graph-view')).toBeDefined();
  });

  it('shows empty state when no links exist', () => {
    render(<LinkGraphView />);
    expect(screen.getByText('No wiki-links found')).toBeDefined();
  });

  it('renders search input', () => {
    render(<LinkGraphView />);
    expect(screen.getByTestId('link-graph-search')).toBeDefined();
  });

  it('renders fullscreen toggle', () => {
    render(<LinkGraphView />);
    expect(screen.getByTestId('link-graph-fullscreen')).toBeDefined();
  });

  it('shows node and edge counts', () => {
    render(<LinkGraphView />);
    expect(screen.getByText('0 nodes')).toBeDefined();
    expect(screen.getByText('0 edges')).toBeDefined();
  });

  it('renders ReactFlow when links exist', async () => {
    const { layoutLinkGraph } = await import('@/lib/graph/linkGraphLayout');
    (layoutLinkGraph as ReturnType<typeof vi.fn>).mockReturnValue({
      nodes: [
        {
          id: 'a.md',
          type: 'linkGraph',
          position: { x: 0, y: 0 },
          data: {
            label: 'a.md',
            fullPath: '/p/a.md',
            isActive: false,
            isBroken: false,
            linkCount: 1,
            backlinkCount: 0,
          },
        },
      ],
      edges: [],
    });

    render(<LinkGraphView />);
    expect(screen.getByTestId('react-flow')).toBeDefined();
    expect(screen.getByText('1 nodes')).toBeDefined();
  });
});
