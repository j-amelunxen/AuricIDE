'use client';

import { ModalShell } from '@/app/components/ui/ModalShell';

export interface SupervisorCandidateInfo {
  id: string;
  name: string;
}

export interface SupervisorProviderChoice {
  candidates: SupervisorCandidateInfo[];
  resolve: (providerId: string | null) => void;
}

export interface SupervisorProviderModalProps {
  choice: SupervisorProviderChoice | null;
  onClose: () => void;
}

export function SupervisorProviderModal({ choice, onClose }: SupervisorProviderModalProps) {
  if (!choice) return null;

  const handleSelect = (providerId: string) => {
    choice.resolve(providerId);
    onClose();
  };

  const handleCancel = () => {
    choice.resolve(null);
    onClose();
  };

  return (
    <ModalShell
      id="supervisor-provider-modal"
      title="Start Supervisor"
      titleId="supervisor-provider-modal-title"
      className="w-96"
      onClose={handleCancel}
    >
      <div className="space-y-4">
        <p className="text-xs text-foreground-muted">
          Multiple supervisor providers are enabled. Choose which provider to start:
        </p>

        <div className="flex flex-col gap-2.5">
          {choice.candidates.map((c) => (
            <button
              key={c.id}
              type="button"
              data-testid={`supervisor-start-provider-${c.id}`}
              onClick={() => handleSelect(c.id)}
              className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-left transition-all hover:border-primary hover:bg-primary/10 group cursor-pointer"
            >
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-foreground group-hover:text-primary-light">
                  {c.name}
                </span>
                <span className="text-[10px] text-foreground-muted uppercase tracking-wider font-mono">
                  {c.id}
                </span>
              </div>
              <span className="text-xs text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                Start →
              </span>
            </button>
          ))}
        </div>

        <div className="flex justify-end pt-2 border-t border-white/5">
          <button
            type="button"
            data-testid="supervisor-start-provider-cancel"
            onClick={handleCancel}
            className="rounded px-3 py-1.5 text-xs text-foreground-muted hover:bg-white/5 hover:text-foreground transition-colors cursor-pointer"
          >
            Cancel
          </button>
        </div>
      </div>
    </ModalShell>
  );
}
