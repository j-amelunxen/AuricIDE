'use client';

import { useState, useEffect, useRef, useCallback } from 'react';

interface ImageViewerProps {
  src: string;
  fileName: string;
}

export function ImageViewer({ src, fileName }: ImageViewerProps) {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  const handleZoomIn = () => setScale((s) => Math.min(s + 0.25, 5));
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.25, 0.1));
  const handleReset = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      const delta = e.deltaY > 0 ? -0.1 : 0.1;
      setScale((s) => Math.max(0.1, Math.min(5, s + delta)));
    }
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button === 0) {
      // Left click
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (isDragging) {
        setPosition({
          x: e.clientX - dragStart.x,
          y: e.clientY - dragStart.y,
        });
      }
    },
    [isDragging, dragStart]
  );

  const handleMouseUp = () => setIsDragging(false);

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);
    } else {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging, handleMouseMove]);

  return (
    <div
      ref={containerRef}
      className="relative flex h-full w-full flex-col overflow-hidden bg-editor-bg select-none"
      onWheel={handleWheel}
    >
      {/* HUD Toolbar */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 glass border border-white/10 rounded-full shadow-2xl">
        <button
          onClick={handleZoomOut}
          className="p-1 hover:text-primary transition-colors"
          title="Zoom Out"
        >
          <span className="material-symbols-outlined text-sm">remove_circle</span>
        </button>
        <span className="text-[10px] font-mono min-w-[40px] text-center">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={handleZoomIn}
          className="p-1 hover:text-primary transition-colors"
          title="Zoom In"
        >
          <span className="material-symbols-outlined text-sm">add_circle</span>
        </button>
        <div className="w-[1px] h-3 bg-white/10 mx-1" />
        <button
          onClick={handleReset}
          className="p-1 hover:text-primary transition-colors"
          title="Reset View"
        >
          <span className="material-symbols-outlined text-sm">restart_alt</span>
        </button>
      </div>

      {/* Image Canvas */}
      <div
        className={`flex-1 flex items-center justify-center cursor-${isDragging ? 'grabbing' : 'grab'}`}
        onMouseDown={handleMouseDown}
      >
        <div
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.1s ease-out',
          }}
          className="glass-card p-2 rounded-lg"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={src}
            alt={fileName}
            className="max-w-none shadow-2xl pointer-events-none"
            style={{ maxHeight: '80vh' }}
          />
        </div>
      </div>

      {/* Info Footer */}
      <div className="absolute bottom-4 right-4 px-3 py-1 glass border border-white/10 rounded text-[9px] text-foreground-muted font-mono uppercase tracking-widest pointer-events-none">
        {fileName}
      </div>
    </div>
  );
}
