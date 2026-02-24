'use client';

interface DependencySuggestion {
  id: string;
  name: string;
  reason: string;
}

interface DependencyProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  suggestions: DependencySuggestion[];
  selectedIds: string[];
  onToggleSuggestion: (id: string) => void;
  isLoading: boolean;
}

export function DependencyProposalModal({
  isOpen,
  onClose,
  onConfirm,
  suggestions,
  selectedIds,
  onToggleSuggestion,
  isLoading,
}: DependencyProposalModalProps) {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-[500px] max-h-[80vh] flex flex-col bg-[#0e0e18] border border-white/10 rounded-2xl shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-[20px]">lightbulb</span>
            <h3 className="text-sm font-semibold text-foreground">Proposed Dependencies</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close dialog"
            className="rounded-lg p-1 text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="p-5 overflow-y-auto">
          {isLoading ? (
            <div className="py-12 flex flex-col items-center justify-center gap-4 text-foreground-muted">
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
              <p className="text-sm animate-pulse">Analyzing dependencies...</p>
            </div>
          ) : suggestions.length > 0 ? (
            <div className="flex flex-col gap-3">
              <p className="text-xs text-foreground-muted mb-2">
                The LLM analyzed the Epic and found potential technical dependencies for this
                ticket:
              </p>
              {suggestions.map((suggestion) => (
                <div
                  key={suggestion.id}
                  onClick={() => onToggleSuggestion(suggestion.id)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex gap-3 ${
                    selectedIds.includes(suggestion.id)
                      ? 'bg-primary/10 border-primary/30 text-foreground shadow-[0_4px_12px_rgba(59,130,246,0.1)]'
                      : 'bg-white/5 border-white/10 text-foreground-muted hover:bg-white/10'
                  }`}
                >
                  <div className="shrink-0 mt-0.5">
                    <div
                      className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${
                        selectedIds.includes(suggestion.id)
                          ? 'bg-primary border-primary text-white'
                          : 'bg-transparent border-white/20 text-transparent'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[14px] font-bold">check</span>
                    </div>
                    <input
                      type="checkbox"
                      className="hidden"
                      checked={selectedIds.includes(suggestion.id)}
                      readOnly
                    />
                  </div>
                  <div className="flex flex-col gap-1 min-w-0">
                    <span className="text-sm font-bold truncate">{suggestion.name}</span>
                    <span className="text-[11px] leading-relaxed opacity-80">
                      {suggestion.reason}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-8 flex flex-col items-center justify-center gap-3 text-foreground-muted">
              <span className="material-symbols-outlined text-[48px] opacity-20">search_off</span>
              <p className="text-sm">No potential dependencies found.</p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/10 shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-foreground-muted hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          {!isLoading && suggestions.length > 0 && (
            <button
              type="button"
              onClick={onConfirm}
              className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-white hover:bg-primary/80 transition-colors shadow-lg shadow-primary/20"
            >
              Add Selected ({selectedIds.length})
            </button>
          )}
          {!isLoading && suggestions.length === 0 && (
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg bg-white/5 border border-white/10 px-5 py-2 text-xs font-bold text-foreground hover:bg-white/10 transition-colors"
            >
              OK
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
