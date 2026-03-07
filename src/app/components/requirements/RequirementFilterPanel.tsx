'use client';

interface RequirementFilterPanelProps {
  categories: string[];
  activeCategory: string;
  activeType: string;
  activeStatus: string;
  activeVerification: string;
  onCategoryChange: (category: string) => void;
  onTypeChange: (type: string) => void;
  onStatusChange: (status: string) => void;
  onVerificationChange: (verification: string) => void;
}

const TYPES = [
  { value: '', label: 'All' },
  { value: 'functional', label: 'Functional' },
  { value: 'non_functional', label: 'Non-Functional' },
];

const STATUSES = [
  { value: '', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'active', label: 'Active' },
  { value: 'implemented', label: 'Implemented' },
  { value: 'verified', label: 'Verified' },
  { value: 'deprecated', label: 'Deprecated' },
];

const VERIFICATIONS = [
  { value: '', label: 'All' },
  { value: 'fresh', label: 'Fresh' },
  { value: 'stale', label: 'Stale' },
  { value: 'unverified', label: 'Unverified' },
];

function FilterChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors ${
        active
          ? 'bg-primary/20 text-primary-light border border-primary/30'
          : 'bg-white/5 text-foreground-muted border border-white/5 hover:bg-white/10'
      }`}
    >
      {label}
    </button>
  );
}

export function RequirementFilterPanel({
  categories,
  activeCategory,
  activeType,
  activeStatus,
  activeVerification,
  onCategoryChange,
  onTypeChange,
  onStatusChange,
  onVerificationChange,
}: RequirementFilterPanelProps) {
  return (
    <div
      data-testid="requirement-filter-panel"
      className="flex w-[220px] flex-col gap-5 overflow-y-auto border-r border-white/5 p-4"
    >
      <div>
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-foreground-muted">
          Category
        </h3>
        <div className="flex flex-wrap gap-1.5">
          <FilterChip
            label="All"
            active={activeCategory === ''}
            onClick={() => onCategoryChange('')}
          />
          {categories.map((cat) => (
            <FilterChip
              key={cat}
              label={cat}
              active={activeCategory === cat}
              onClick={() => onCategoryChange(activeCategory === cat ? '' : cat)}
            />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-foreground-muted">
          Type
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {TYPES.map((t) => (
            <FilterChip
              key={t.value}
              label={t.label}
              active={activeType === t.value}
              onClick={() => onTypeChange(activeType === t.value && t.value !== '' ? '' : t.value)}
            />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-foreground-muted">
          Status
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <FilterChip
              key={s.value}
              label={s.label}
              active={activeStatus === s.value}
              onClick={() =>
                onStatusChange(activeStatus === s.value && s.value !== '' ? '' : s.value)
              }
            />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-[10px] font-bold uppercase tracking-[0.15em] text-foreground-muted">
          Verification
        </h3>
        <div className="flex flex-wrap gap-1.5">
          {VERIFICATIONS.map((v) => (
            <FilterChip
              key={v.value}
              label={v.label}
              active={activeVerification === v.value}
              onClick={() =>
                onVerificationChange(
                  activeVerification === v.value && v.value !== '' ? '' : v.value
                )
              }
            />
          ))}
        </div>
      </div>
    </div>
  );
}
