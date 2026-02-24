'use client';

import { useCallback, useRef, useState } from 'react';

export interface ResizablePanelProps {
  direction: 'horizontal' | 'vertical';
  defaultSize: number;
  minSize: number;
  maxSize?: number;
  collapsed?: boolean;
  children: React.ReactNode;
  className?: string;
  handlePosition?: 'start' | 'end';
}

export function ResizablePanel({
  direction,
  defaultSize,
  minSize,
  maxSize,
  collapsed = false,
  children,
  className = '',
  handlePosition = 'end',
}: ResizablePanelProps) {
  const [size, setSize] = useState(defaultSize);
  const panelRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const isHorizontal = direction === 'horizontal';
  const currentSize = collapsed ? 0 : size;

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      dragging.current = true;

      const startPos = isHorizontal ? e.clientX : e.clientY;
      const startSize = size;
      const flip = handlePosition === 'start' ? -1 : 1;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!dragging.current) return;
        const currentPos = isHorizontal ? moveEvent.clientX : moveEvent.clientY;
        const delta = (currentPos - startPos) * flip;
        const newSize = Math.max(
          minSize,
          maxSize ? Math.min(maxSize, startSize + delta) : startSize + delta
        );
        setSize(newSize);
      };

      const handleMouseUp = () => {
        dragging.current = false;
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [isHorizontal, size, minSize, maxSize, handlePosition]
  );

  const sizeStyle = isHorizontal ? { width: `${currentSize}px` } : { height: `${currentSize}px` };

  const handleClasses = isHorizontal
    ? 'w-1 cursor-col-resize hover:bg-primary/50'
    : 'h-1 cursor-row-resize hover:bg-primary/50';

  return (
    <div
      ref={panelRef}
      data-testid="resizable-panel"
      className={`relative flex overflow-hidden ${isHorizontal ? 'flex-row' : 'flex-col'} ${className}`}
      style={sizeStyle}
    >
      {handlePosition === 'start' && !collapsed && (
        <div
          data-testid="resize-handle"
          className={`flex-shrink-0 transition-colors ${handleClasses}`}
          onMouseDown={handleMouseDown}
        />
      )}
      <div className="flex-1 min-h-0 min-w-0">{children}</div>
      {handlePosition === 'end' && !collapsed && (
        <div
          data-testid="resize-handle"
          className={`flex-shrink-0 transition-colors ${handleClasses}`}
          onMouseDown={handleMouseDown}
        />
      )}
    </div>
  );
}
