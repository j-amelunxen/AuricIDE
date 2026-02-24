'use client';

import { useState } from 'react';
import fuzzysort from 'fuzzysort';
import type { PmDependency } from '@/lib/tauri/pm';

interface DependencySelectorProps {
  dependencies: PmDependency[];
  availableItems: { id: string; type: 'epic' | 'ticket'; name: string }[];
  currentItemId: string;
  onAdd: (dep: PmDependency) => void;
  onRemove: (id: string) => void;
}

export function DependencySelector({
  dependencies,
  availableItems,
  currentItemId,
  onAdd,
  onRemove,
}: DependencySelectorProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const addedTargetIds = new Set(dependencies.map((d) => d.targetId));

  const baseDropdownItems = availableItems.filter(
    (item) => item.id !== currentItemId && !addedTargetIds.has(item.id)
  );

  const dropdownItems = searchTerm
    ? fuzzysort.go(searchTerm, baseDropdownItems, { key: 'name' }).map((r) => r.obj)
    : baseDropdownItems;

  const resolveTargetName = (targetId: string) => {
    return availableItems.find((item) => item.id === targetId)?.name ?? targetId;
  };

  const handleSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const targetId = e.target.value;
    if (!targetId) return;

    const target = availableItems.find((item) => item.id === targetId);
    if (!target) return;

    onAdd({
      id: crypto.randomUUID(),
      sourceType: 'ticket',
      sourceId: currentItemId,
      targetType: target.type,
      targetId: target.id,
    });

    e.target.value = '';
    setSearchTerm('');
  };

  return (
    <div className="flex flex-col gap-2">
      {dependencies.length === 0 && (
        <p className="text-xs text-foreground-muted">No dependencies</p>
      )}

      <div className="flex flex-wrap gap-1.5">
        {dependencies.map((dep) => (
          <span
            key={dep.id}
            className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-xs text-foreground"
          >
            {resolveTargetName(dep.targetId)}
            <button
              type="button"
              aria-label="Remove dependency"
              onClick={() => onRemove(dep.id)}
              className="text-foreground-muted hover:text-foreground transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">close</span>
            </button>
          </span>
        ))}
      </div>

      <div className="flex flex-col gap-2">
        <input
          type="text"
          placeholder="Search dependencies..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-foreground focus:border-primary/50 focus:outline-none"
        />

        <select
          role="combobox"
          onChange={handleSelect}
          defaultValue=""
          className="bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-foreground focus:border-primary/50 focus:outline-none"
        >
          <option value="" disabled>
            {dropdownItems.length === 0 && searchTerm ? 'No matches' : 'Add dependency...'}
          </option>
          {dropdownItems.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
