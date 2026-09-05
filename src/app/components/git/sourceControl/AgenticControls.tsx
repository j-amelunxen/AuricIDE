import type { ProviderInfo } from '@/lib/tauri/providers';

export function AgenticControls({
  agenticCommit,
  providers,
  selectedProviderId,
  onAgenticToggle,
  onProviderChange,
}: {
  agenticCommit: boolean;
  providers: ProviderInfo[];
  selectedProviderId?: string;
  onAgenticToggle?: (value: boolean) => void;
  onProviderChange?: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2 cursor-pointer">
        <input
          type="checkbox"
          checked={agenticCommit}
          onChange={(e) => onAgenticToggle?.(e.target.checked)}
          className="h-3.5 w-3.5 accent-primary"
        />
        <span className="text-xs text-foreground-muted">Agentic</span>
      </label>

      {agenticCommit && providers.length > 0 && (
        <select
          value={selectedProviderId}
          onChange={(e) => onProviderChange?.(e.target.value)}
          className="w-full rounded border border-border-dark bg-editor-bg px-2 py-1 text-[10px] text-foreground-muted outline-none focus:border-primary"
        >
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
    </div>
  );
}
