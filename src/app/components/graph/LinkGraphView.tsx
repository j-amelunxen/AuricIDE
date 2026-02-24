'use client';

import { useCallback, useMemo, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  type NodeTypes,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useStore } from '@/lib/store';
import { layoutLinkGraph } from '@/lib/graph/linkGraphLayout';
import { LinkGraphNode } from './LinkGraphNode';

const nodeTypes: NodeTypes = {
  // XYFlow requires NodeTypes to accept generic node props
  linkGraph: LinkGraphNode as NodeTypes[string],
};

export interface LinkGraphViewProps {
  onFileSelect?: (path: string) => void;
  hideFullscreen?: boolean;
}

export function LinkGraphView({ onFileSelect, hideFullscreen }: LinkGraphViewProps) {
  const linkIndex = useStore((s) => s.linkIndex);
  const brokenLinks = useStore((s) => s.brokenLinks);
  const allFilePaths = useStore((s) => s.allFilePaths);
  const [searchQuery, setSearchQuery] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);

  const activeFilePath = useStore((s) => {
    const activeTab = s.activeTabId;
    if (activeTab && !activeTab.startsWith('diff::') && !activeTab.startsWith('mindmap::')) {
      return activeTab;
    }
    return null;
  });

  const { nodes, edges } = useMemo(
    () => layoutLinkGraph({ linkIndex, brokenLinks, allFilePaths, activeFilePath }),
    [linkIndex, brokenLinks, allFilePaths, activeFilePath]
  );

  const filteredNodes = useMemo(() => {
    if (!searchQuery) return nodes;
    const lower = searchQuery.toLowerCase();
    return nodes.filter((n) => n.data.label.includes(lower));
  }, [nodes, searchQuery]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  const filteredEdges = useMemo(() => {
    if (!searchQuery) return edges;
    return edges.filter((e) => filteredNodeIds.has(e.source) && filteredNodeIds.has(e.target));
  }, [edges, searchQuery, filteredNodeIds]);

  const handleNodeClick: NodeMouseHandler = useCallback(
    (_event, node) => {
      const fullPath = node.data?.fullPath;
      if (fullPath && onFileSelect) {
        onFileSelect(fullPath as string);
      }
    },
    [onFileSelect]
  );

  const content = (
    <div
      data-testid="link-graph-view"
      className={isFullscreen ? 'flowchart-fullscreen-overlay' : 'h-full w-full'}
    >
      {/* Search + Fullscreen toolbar */}
      <div className="absolute top-2 left-2 z-10 flex items-center gap-2">
        <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-[rgba(10,10,16,0.9)] border border-white/10">
          <span className="material-symbols-outlined text-sm text-foreground-muted">search</span>
          <input
            data-testid="link-graph-search"
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter nodes..."
            className="bg-transparent text-xs text-foreground w-36 outline-none placeholder:text-foreground-muted/50"
          />
        </div>
        {!hideFullscreen && (
          <button
            data-testid="link-graph-fullscreen"
            onClick={() => setIsFullscreen(!isFullscreen)}
            className="flowchart-expand-btn"
          >
            <span className="material-symbols-outlined text-sm">
              {isFullscreen ? 'close_fullscreen' : 'open_in_full'}
            </span>
            {isFullscreen ? 'Exit' : 'Expand'}
          </button>
        )}
      </div>

      {/* Stats badge */}
      <div className="absolute top-2 right-2 z-10 flex items-center gap-2 px-2.5 py-1 rounded-lg bg-[rgba(10,10,16,0.9)] border border-white/10 text-[10px] text-foreground-muted">
        <span>{filteredNodes.length} nodes</span>
        <span className="text-white/20">|</span>
        <span>{filteredEdges.length} edges</span>
      </div>

      {nodes.length === 0 ? (
        <div className="flex h-full items-center justify-center text-foreground-muted text-sm">
          <div className="text-center">
            <span className="material-symbols-outlined text-3xl text-foreground-muted/40 mb-2 block">
              hub
            </span>
            <p>No wiki-links found</p>
            <p className="text-xs mt-1 opacity-60">Create [[links]] in your markdown files</p>
          </div>
        </div>
      ) : (
        <ReactFlow
          nodes={filteredNodes}
          edges={filteredEdges}
          nodeTypes={nodeTypes}
          onNodeClick={handleNodeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: false }}
          minZoom={0.1}
          maxZoom={2}
        >
          <Background color="#1a1a2e" gap={20} size={1} />
          <Controls />
          <MiniMap
            nodeColor={(node) => {
              if (node.data?.isBroken) return '#ff4a4a';
              if (node.data?.isActive) return '#bc13fe';
              return '#2a3b4d';
            }}
            maskColor="rgba(0, 0, 0, 0.7)"
          />
        </ReactFlow>
      )}
    </div>
  );

  return content;
}
