'use client';

import { useState, useEffect } from 'react';
import type { AgentConfig, PermissionMode } from '@/lib/tauri/agents';
import { listProviders, FALLBACK_CRUSH_PROVIDER, type ProviderInfo } from '@/lib/tauri/providers';
import { buildImportSpecPrompt } from '@/lib/pm/importSpecPrompt';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

interface ImportSpecDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onSpawn: (config: AgentConfig) => Promise<void>;
  workingDirectory?: string;
}

export function ImportSpecDialog(props: ImportSpecDialogProps) {
  if (!props.isOpen) return null;
  return <ImportSpecDialogPanel {...props} />;
}

/** Dropdown affordance for `appearance-none` selects. */
function SelectChevron() {
  return (
    <AuricIcon
      name="expand_more"
      aria-hidden="true"
      className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-base text-foreground-muted"
    />
  );
}

function ImportSpecDialogPanel({
  isOpen,
  onClose,
  onSpawn,
  workingDirectory = '',
}: ImportSpecDialogProps) {
  const dialogRef = useDialogA11y<HTMLDivElement>();
  const [specText, setSpecText] = useState('');
  const [providers, setProviders] = useState<ProviderInfo[]>([FALLBACK_CRUSH_PROVIDER]);
  const [selectedProviderId, setSelectedProviderId] = useState(FALLBACK_CRUSH_PROVIDER.id);
  const [model, setModel] = useState(FALLBACK_CRUSH_PROVIDER.defaultModel);
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(
    FALLBACK_CRUSH_PROVIDER.defaultPermissionMode as PermissionMode
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currentProvider = providers.find((p) => p.id === selectedProviderId) ?? providers[0];

  useEffect(() => {
    listProviders()
      .then((fetched) => {
        if (fetched.length > 0) {
          setProviders(fetched);
          const defaultProvider = fetched[0];
          setSelectedProviderId(defaultProvider.id);
          setModel(defaultProvider.defaultModel);
          setPermissionMode(defaultProvider.defaultPermissionMode as PermissionMode);
        }
      })
      .catch(() => {
        // Browser mode fallback
      });
  }, []);

  // Adjusting state while rendering, rather than in an effect: React re-runs
  // this render before touching the DOM, so the fields never paint with the
  // old provider's model and no second render reaches the screen.
  const [lastProviderId, setLastProviderId] = useState(currentProvider.id);
  if (lastProviderId !== currentProvider.id) {
    setLastProviderId(currentProvider.id);
    setModel(currentProvider.defaultModel);
    setPermissionMode(currentProvider.defaultPermissionMode as PermissionMode);
  }

  useOverlayLayer({
    id: 'import-spec',
    kind: 'tool',
    active: true,
    onEscape: onClose,
  });

  // Same reasoning: a fresh dialog is a reset of this render, not a follow-up
  // render after the stale text has already been shown.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) {
      setSpecText('');
      setIsLoading(false);
      setError(null);
    }
  }

  const handleImport = async () => {
    const prompt = buildImportSpecPrompt(specText);
    setIsLoading(true);
    setError(null);
    try {
      await onSpawn({
        name: 'Spec Import',
        model,
        task: prompt,
        cwd: workingDirectory || undefined,
        permissionMode,
        provider: selectedProviderId,
        headless: true,
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[var(--z-tool)] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-spec-title"
        className="glass-card w-full max-w-lg overflow-hidden rounded-xl border border-white/10 bg-[#0a0a10] p-6 shadow-2xl animate-in fade-in zoom-in duration-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-6 flex items-center gap-2">
          <AuricIcon name="description" className="text-primary" />
          <h2
            id="import-spec-title"
            className="text-sm font-bold tracking-tight text-foreground uppercase"
          >
            Import Project Spec
          </h2>
        </div>
        <p className="mb-5 -mt-4 text-[11px] leading-relaxed text-foreground-muted">
          Starts a headless agent that turns this spec into epics, tickets, and tests.
        </p>

        <div className="flex flex-col gap-5">
          <div className="space-y-1.5">
            <label
              htmlFor="spec-text"
              className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
            >
              Project Specification
            </label>
            <textarea
              id="spec-text"
              value={specText}
              onChange={(e) => setSpecText(e.target.value)}
              className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 text-xs text-foreground outline-none focus:border-primary/50 transition-colors resize-none min-h-[300px]"
              placeholder="Paste your project specification here..."
            />
          </div>

          {providers.length > 1 && (
            <div className="space-y-1.5">
              <label
                htmlFor="import-provider-select"
                className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
              >
                Provider
              </label>
              <div className="relative">
                <select
                  id="import-provider-select"
                  value={selectedProviderId}
                  onChange={(e) => setSelectedProviderId(e.target.value)}
                  className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 pr-8 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
                >
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <SelectChevron />
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label
                htmlFor="import-model-select"
                className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
              >
                Model
              </label>
              <div className="relative">
                <select
                  id="import-model-select"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 pr-8 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
                >
                  {currentProvider.models.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <SelectChevron />
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="import-permission-mode"
                className="text-[10px] font-bold text-foreground-muted uppercase tracking-wider"
              >
                Permission Mode
              </label>
              <div className="relative">
                <select
                  id="import-permission-mode"
                  value={permissionMode}
                  onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
                  className="w-full rounded-lg border border-white/5 bg-black/40 px-3 py-2 pr-8 text-xs text-foreground outline-none focus:border-primary/50 transition-colors appearance-none"
                >
                  {currentProvider.permissionModes.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
                <SelectChevron />
              </div>
            </div>
          </div>

          <p className="text-[10px] text-foreground-muted -mt-2">
            {currentProvider.permissionModes.find((o) => o.value === permissionMode)?.description ??
              'Agent will run headless to create epics, tickets, dependencies, and test cases.'}
          </p>

          {error && (
            <p className="text-[10px] text-red-400 -mt-2" role="alert">
              {error}
            </p>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-white/5">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-xs font-medium text-foreground-muted hover:text-foreground transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!specText.trim() || isLoading}
              onClick={handleImport}
              className="rounded-lg bg-primary px-6 py-2 text-xs font-bold text-white shadow-[0_0_15px_rgba(var(--primary-rgb),0.3)] hover:brightness-110 transition-all disabled:opacity-30 disabled:grayscale disabled:cursor-not-allowed"
            >
              {isLoading ? 'Starting…' : 'Start import agent'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
