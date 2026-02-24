'use client';

import { useState } from 'react';
import { ResizablePanel } from './ResizablePanel';

export interface IDEShellProps {
  header: React.ReactNode;
  activityBar?: React.ReactNode;
  leftPanel?: React.ReactNode;
  centerContent?: React.ReactNode;
  rightPanel?: React.ReactNode;
  bottomPanel?: React.ReactNode;
  statusBar: React.ReactNode;
  bottomCollapsed?: boolean;
  onBottomToggle?: (collapsed: boolean) => void;
}

export function IDEShell({
  header,
  activityBar,
  leftPanel,
  centerContent,
  rightPanel,
  bottomPanel,
  statusBar,
  bottomCollapsed: bottomCollapsedProp,
  onBottomToggle,
}: IDEShellProps) {
  const [leftCollapsed, setLeftCollapsed] = useState(false);
  const [bottomCollapsedInternal, setBottomCollapsedInternal] = useState(false);

  // Sync with prop if provided
  const isBottomCollapsed =
    bottomCollapsedProp !== undefined ? bottomCollapsedProp : bottomCollapsedInternal;

  const handleBottomToggle = () => {
    if (onBottomToggle) {
      onBottomToggle(!isBottomCollapsed);
    } else {
      setBottomCollapsedInternal(!bottomCollapsedInternal);
    }
  };

  return (
    <div data-testid="ide-shell" className="flex h-screen w-screen flex-col bg-background-dark">
      {/* Header */}
      {header}

      {/* Main area: activity bar + panels */}
      <div className="flex flex-1 overflow-hidden">
        {/* Activity Bar */}
        {activityBar}

        {/* Left Panel */}
        {leftPanel && (
          <ResizablePanel
            direction="horizontal"
            defaultSize={250}
            minSize={150}
            maxSize={500}
            collapsed={leftCollapsed}
          >
            <div
              data-testid="left-panel-container"
              className="h-full"
              style={leftCollapsed ? { width: '0px' } : undefined}
            >
              {leftPanel}
            </div>
          </ResizablePanel>
        )}

        {/* Center + Bottom */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Center Content */}
          <div className="flex-1 overflow-hidden bg-editor-bg">{centerContent}</div>

          {/* Bottom Panel */}
          {bottomPanel && (
            <ResizablePanel
              direction="vertical"
              defaultSize={200}
              minSize={100}
              maxSize={500}
              collapsed={isBottomCollapsed}
              handlePosition="start"
            >
              <div
                data-testid="bottom-panel-container"
                className="h-full w-full"
                style={isBottomCollapsed ? { height: '0px' } : undefined}
              >
                {bottomPanel}
              </div>
            </ResizablePanel>
          )}
        </div>

        {/* Right Panel */}
        {rightPanel && (
          <ResizablePanel
            direction="horizontal"
            defaultSize={280}
            minSize={200}
            maxSize={500}
            handlePosition="start"
          >
            {rightPanel}
          </ResizablePanel>
        )}
      </div>

      {/* Toggle Buttons (hidden, triggered via keyboard or programmatic) */}
      <button
        data-testid="toggle-left-panel"
        className="sr-only"
        onClick={() => setLeftCollapsed((c) => !c)}
        aria-label="Toggle left panel"
      />
      <button
        data-testid="toggle-bottom-panel"
        className="sr-only"
        onClick={handleBottomToggle}
        aria-label="Toggle bottom panel"
      />

      {/* Status Bar */}
      {statusBar}
    </div>
  );
}
