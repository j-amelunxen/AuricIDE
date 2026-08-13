'use client';

import { LinkGraphView } from './LinkGraphView';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

interface LinkGraphModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFileSelect: (path: string) => void;
}

export function LinkGraphModal({ isOpen, onClose, onFileSelect }: LinkGraphModalProps) {
  if (!isOpen) return null;
  return <LinkGraphDialog onClose={onClose} onFileSelect={onFileSelect} />;
}

function LinkGraphDialog({ onClose, onFileSelect }: Omit<LinkGraphModalProps, 'isOpen'>) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  useOverlayLayer({ id: 'link-graph', kind: 'tool', active: true, onEscape: onClose });

  return (
    <div
      data-testid="link-graph-modal-backdrop"
      className="fixed inset-0 z-[var(--z-tool)] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4 md:p-8"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="link-graph-modal-title"
        className="flex flex-col w-full h-full rounded-2xl border border-white/10 bg-[#050510] shadow-[0_0_50px_rgba(0,0,0,0.5)] overflow-hidden animate-in fade-in zoom-in duration-300"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-white/2 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary neon-glow border border-primary/20">
              <AuricIcon name="hub" className="text-xl" />
            </div>
            <div>
              <h2
                id="link-graph-modal-title"
                className="text-sm font-bold text-foreground tracking-tight"
              >
                Link Graph Overview
              </h2>
              <p className="text-[10px] text-foreground-muted uppercase tracking-[0.2em] font-medium opacity-70">
                Visualizing Wiki-Link Connections
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="hidden md:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/5 border border-white/5 text-[10px] text-foreground-muted">
              <AuricIcon name="keyboard" className="text-xs" />
              <span>
                Press{' '}
                <kbd className="px-1 py-0.5 rounded bg-white/10 text-primary-light font-mono">
                  ESC
                </kbd>{' '}
                to close
              </span>
            </div>
            <button
              onClick={onClose}
              title="Close"
              className="group relative flex h-10 w-10 items-center justify-center rounded-xl text-foreground-muted transition-all duration-300 hover:bg-white/5 hover:text-foreground border border-transparent hover:border-white/10"
            >
              <AuricIcon name="close" className="text-xl group-hover:scale-110" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 relative min-h-0">
          <LinkGraphView
            hideFullscreen
            onFileSelect={(path) => {
              onFileSelect(path);
              onClose();
            }}
          />
        </div>
      </div>
    </div>
  );
}
