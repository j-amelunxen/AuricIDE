'use client';

interface VideoViewerProps {
  src: string;
  fileName: string;
}

export function VideoViewer({ src, fileName }: VideoViewerProps) {
  return (
    <div
      data-testid="video-viewer"
      className="relative flex h-full w-full flex-col overflow-hidden bg-editor-bg select-none"
    >
      <div className="flex-1 flex items-center justify-center p-8">
        <video
          src={src}
          controls
          playsInline
          preload="metadata"
          className="max-h-full max-w-full rounded-lg shadow-2xl"
        >
          This webview cannot play {fileName}.
        </video>
      </div>

      <div className="absolute bottom-4 right-4 px-3 py-1 glass border border-white/10 rounded text-[9px] text-foreground-muted font-mono uppercase tracking-widest pointer-events-none">
        {fileName}
      </div>
    </div>
  );
}
