'use client';

import type { PmRequirement } from '@/lib/tauri/requirements';

interface RequirementListProps {
  requirements: PmRequirement[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}

const TYPE_BADGE: Record<string, { label: string; className: string }> = {
  functional: { label: 'FUNC', className: 'bg-blue-500/20 text-blue-300' },
  non_functional: { label: 'NFR', className: 'bg-amber-500/20 text-amber-300' },
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: 'text-red-400',
  high: 'text-orange-400',
  normal: 'text-foreground-muted',
  low: 'text-foreground-muted/60',
};

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-gray-400',
  active: 'bg-blue-400',
  implemented: 'bg-green-400',
  verified: 'bg-emerald-400',
  deprecated: 'bg-red-400/60',
};

const STALE_THRESHOLD_MS = 30 * 86400000;

function getVerificationIndicator(req: PmRequirement): {
  className: string;
  label: string;
  type: 'dot' | 'dash';
} {
  if (req.lastVerifiedAt === null) {
    return { className: 'text-foreground-muted', label: 'never', type: 'dash' };
  }
  const age = Date.now() - Date.parse(req.lastVerifiedAt);
  if (age <= STALE_THRESHOLD_MS) {
    return { className: 'bg-green-400', label: 'fresh', type: 'dot' };
  }
  return { className: 'bg-amber-400', label: 'stale', type: 'dot' };
}

export function RequirementList({ requirements, selectedId, onSelect }: RequirementListProps) {
  if (requirements.length === 0) {
    return (
      <div
        data-testid="requirement-list-empty"
        className="flex flex-1 items-center justify-center text-sm text-foreground-muted"
      >
        No requirements match the current filters
      </div>
    );
  }

  return (
    <div data-testid="requirement-list" className="flex-1 overflow-y-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="sticky top-0 border-b border-white/5 bg-background-dark/95 text-left text-[10px] uppercase tracking-wider text-foreground-muted">
            <th className="px-3 py-2 font-medium">Req ID</th>
            <th className="px-3 py-2 font-medium">Title</th>
            <th className="px-3 py-2 font-medium">Type</th>
            <th className="px-3 py-2 font-medium">Category</th>
            <th className="px-3 py-2 font-medium">Priority</th>
            <th className="px-3 py-2 font-medium">Status</th>
            <th className="px-3 py-2 font-medium">Verified</th>
          </tr>
        </thead>
        <tbody>
          {requirements.map((req) => {
            const isSelected = req.id === selectedId;
            const badge = TYPE_BADGE[req.type] ?? TYPE_BADGE.functional;
            return (
              <tr
                key={req.id}
                data-testid={`requirement-row-${req.reqId}`}
                onClick={() => onSelect(req.id)}
                className={`cursor-pointer border-b border-white/[0.03] transition-colors ${
                  isSelected ? 'bg-primary/10' : 'hover:bg-white/5'
                }`}
              >
                <td className="px-3 py-2 font-mono text-primary-light">{req.reqId}</td>
                <td className="max-w-[200px] truncate px-3 py-2 text-foreground">{req.title}</td>
                <td className="px-3 py-2">
                  <span
                    className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-bold ${badge.className}`}
                  >
                    {badge.label}
                  </span>
                </td>
                <td className="px-3 py-2 text-foreground-muted">{req.category || '—'}</td>
                <td className={`px-3 py-2 font-medium ${PRIORITY_COLORS[req.priority] ?? ''}`}>
                  {req.priority}
                </td>
                <td className="px-3 py-2">
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${STATUS_DOT[req.status] ?? 'bg-gray-400'}`}
                    />
                    <span className="text-foreground-muted">{req.status}</span>
                  </span>
                </td>
                <td className="px-3 py-2" data-testid={`verification-indicator-${req.reqId}`}>
                  {(() => {
                    const indicator = getVerificationIndicator(req);
                    if (indicator.type === 'dash') {
                      return <span className={indicator.className}>—</span>;
                    }
                    return (
                      <span className="flex items-center gap-1.5">
                        <span
                          className={`inline-block h-1.5 w-1.5 rounded-full ${indicator.className}`}
                        />
                        <span className="text-foreground-muted">{indicator.label}</span>
                      </span>
                    );
                  })()}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
