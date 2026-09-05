import type { DiffTabState } from '@/lib/git/diffTab';
import type { useIDEState } from '@/lib/hooks/useIDEState';
import type { useIDEHandlers } from '@/lib/hooks/useIDEHandlers';
import { DiffViewer } from '../editor/DiffViewer';
import { ImageViewer } from '../editor/ImageViewer';
import { VideoViewer } from '../editor/VideoViewer';
import { PDFViewer } from '../editor/PDFViewer';
import { HtmlViewer } from '../editor/HtmlViewer';
import { ObsidianCanvasView } from '../obsidian-canvas/ObsidianCanvasView';
import { CanvasView } from '../canvas/CanvasView';
import { MindmapView } from '../mindmap/MindmapView';
import { ExcalidrawViewer } from '../excalidraw/ExcalidrawViewer';
import { MarkdownEditor } from '../editor/MarkdownEditor';

interface EditorContentRouterProps {
  state: ReturnType<typeof useIDEState>;
  handlers: ReturnType<typeof useIDEHandlers>;
  diffTab: DiffTabState | undefined;
}

export function EditorContentRouter({ state, handlers, diffTab }: EditorContentRouterProps) {
  if (!state.activeTabId) return null;

  if (handlers.isDiffTab && diffTab) {
    return (
      <DiffViewer
        diff={diffTab.patch}
        fileName={diffTab.filePath}
        repoPath={diffTab.repoPath}
        source={diffTab.source}
      />
    );
  }

  if (state.imageData) {
    return (
      <ImageViewer src={state.imageData} fileName={state.activeTabId.split('/').pop() || ''} />
    );
  }

  if (state.videoSrc) {
    return <VideoViewer src={state.videoSrc} fileName={state.activeTabId.split('/').pop() || ''} />;
  }

  if (state.pdfData) {
    return <PDFViewer src={state.pdfData} fileName={state.activeTabId.split('/').pop() || ''} />;
  }

  if (handlers.isObsidianCanvas) {
    return (
      <ObsidianCanvasView
        nodes={state.ocNodes}
        edges={state.ocEdges}
        onNodesChange={handlers.handleOcNodesChange}
        onEdgesChange={handlers.handleOcEdgesChange}
        onTextEdit={handlers.handleOcTextEdit}
        onResize={handlers.handleOcResize}
        onFileOpen={handlers.handleOcFileOpen}
        onNodeSelect={state.selectOcNode}
        loadFileContent={handlers.loadFileContent}
        onFileDrop={handlers.handleOcFileDrop}
        onNodeContextMenu={handlers.handleOcNodeContextMenu}
        onTicketClick={handlers.handleTicketBadgeClick}
      />
    );
  }

  if (handlers.isWorkflowFile) {
    return (
      <CanvasView
        nodes={state.canvasNodes}
        edges={state.canvasEdges}
        onNodesChange={handlers.handleCanvasNodesChange}
        onNodeSelect={state.selectNode}
      />
    );
  }

  if (handlers.isMindmapTab && state.mindmapData) {
    return (
      <MindmapView
        nodes={state.mindmapData.nodes}
        edges={state.mindmapData.edges}
        onNodeEdit={handlers.handleMindmapNodeEdit}
        onNodesChange={handlers.handleMindmapNodesChange}
      />
    );
  }

  if (handlers.isExcalidrawTab) {
    return (
      <ExcalidrawViewer
        content={state.editorContent}
        filePath={state.activeTabId}
        onReload={() => void handlers.loadTabContent(state.activeTabId!)}
      />
    );
  }

  if (handlers.isHtmlTab) {
    return (
      <HtmlViewer
        content={state.editorContent}
        fileName={state.activeTabId.split('/').pop() || ''}
      />
    );
  }

  return (
    <MarkdownEditor
      content={state.editorContent}
      filePath={state.activeTabId}
      projectFiles={state.projectFiles}
      scrollToLine={state.scrollToLine}
      onChange={handlers.handleEditorChange}
      onCursorChange={state.setCursorPos}
      onSelectionSpawn={handlers.handleSelectionSpawn}
      onWikiLinkNavigate={handlers.handleWikiLinkNavigate}
    />
  );
}
