'use client';

import { useState, useEffect, useRef } from 'react';

interface PDFViewerProps {
  src: string; // base64-encoded PDF
  fileName: string;
}

export function PDFViewer({ src, fileName }: PDFViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [scale, setScale] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  // Hold the loaded pdf document across renders
  const pdfDocRef = useRef<import('pdfjs-dist').PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<import('pdfjs-dist').RenderTask | null>(null);

  // Load document when src changes
  useEffect(() => {
    let cancelled = false;

    async function loadPdf() {
      setLoading(true);
      setError(null);
      setCurrentPage(1);

      try {
        const pdfjsLib = await import('pdfjs-dist');
        // Use the bundled worker entry point
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/build/pdf.worker.mjs',
          import.meta.url
        ).href;

        // Decode base64 to Uint8Array
        const binary = atob(src.includes(',') ? src.split(',')[1] : src);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        const doc = await pdfjsLib.getDocument({ data: bytes }).promise;
        if (cancelled) {
          doc.destroy();
          return;
        }
        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
      } catch (e) {
        if (!cancelled) setError(String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadPdf();
    return () => {
      cancelled = true;
      pdfDocRef.current?.destroy();
      pdfDocRef.current = null;
    };
  }, [src]);

  // Render current page whenever page or scale changes
  useEffect(() => {
    if (!pdfDocRef.current || !canvasRef.current || loading) return;
    let cancelled = false;

    async function renderPage() {
      const doc = pdfDocRef.current;
      const canvas = canvasRef.current;
      if (!doc || !canvas) return;

      // Cancel any in-progress render
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel();
        renderTaskRef.current = null;
      }

      try {
        const page = await doc.getPage(currentPage);
        if (cancelled) return;

        const viewport = page.getViewport({ scale });
        const ctx = canvas.getContext('2d')!;
        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const renderTask = page.render({ canvasContext: ctx, viewport, canvas });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
      } catch (e: unknown) {
        // Ignore cancellation errors
        if (e instanceof Error && e.message !== 'Rendering cancelled, page 1') {
          if (!cancelled) setError(String(e));
        }
      }
    }

    renderPage();
    return () => {
      cancelled = true;
    };
  }, [currentPage, scale, loading]);

  const handleZoomIn = () => setScale((s) => Math.min(s + 0.25, 4));
  const handleZoomOut = () => setScale((s) => Math.max(s - 0.25, 0.25));
  const handleReset = () => setScale(1);
  const handlePrevPage = () => setCurrentPage((p) => Math.max(p - 1, 1));
  const handleNextPage = () => setCurrentPage((p) => Math.min(p + 1, numPages));

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-editor-bg select-none">
      {/* HUD Toolbar */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 px-3 py-1.5 glass border border-white/10 rounded-full shadow-2xl">
        {/* Zoom controls */}
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
        <button
          onClick={handleReset}
          className="p-1 hover:text-primary transition-colors"
          title="Reset Zoom"
        >
          <span className="material-symbols-outlined text-sm">restart_alt</span>
        </button>

        {numPages > 1 && (
          <>
            <div className="w-[1px] h-3 bg-white/10 mx-1" />
            {/* Page navigation */}
            <button
              onClick={handlePrevPage}
              disabled={currentPage <= 1}
              className="p-1 hover:text-primary transition-colors disabled:opacity-30"
              title="Previous Page"
            >
              <span className="material-symbols-outlined text-sm">chevron_left</span>
            </button>
            <span className="text-[10px] font-mono min-w-[50px] text-center">
              {currentPage} / {numPages}
            </span>
            <button
              onClick={handleNextPage}
              disabled={currentPage >= numPages}
              className="p-1 hover:text-primary transition-colors disabled:opacity-30"
              title="Next Page"
            >
              <span className="material-symbols-outlined text-sm">chevron_right</span>
            </button>
          </>
        )}
      </div>

      {/* PDF Canvas */}
      <div className="flex-1 flex items-center justify-center overflow-auto">
        {loading && <span className="text-foreground-muted text-sm">Loading PDF…</span>}
        {error && <span className="text-red-400 text-sm">Failed to load PDF: {error}</span>}
        {!loading && !error && (
          <div className="glass-card p-2 rounded-lg my-8">
            <canvas ref={canvasRef} className="shadow-2xl" />
          </div>
        )}
      </div>

      {/* Info Footer */}
      <div className="absolute bottom-4 right-4 px-3 py-1 glass border border-white/10 rounded text-[9px] text-foreground-muted font-mono uppercase tracking-widest pointer-events-none">
        {fileName}
      </div>
    </div>
  );
}
