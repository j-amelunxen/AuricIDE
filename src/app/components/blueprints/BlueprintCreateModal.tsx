'use client';

import { useState } from 'react';
import type { Blueprint } from '@/lib/tauri/blueprints';
import { COMPLEXITY_OPTIONS, CATEGORY_OPTIONS } from '@/lib/blueprints/constants';

interface BlueprintCreateModalProps {
  isOpen: boolean;
  onSave: (blueprint: Omit<Blueprint, 'id' | 'createdAt' | 'updatedAt'>) => void;
  onClose: () => void;
}

function BlueprintCreateForm({ onSave, onClose }: Omit<BlueprintCreateModalProps, 'isOpen'>) {
  const [name, setName] = useState('');
  const [techStack, setTechStack] = useState('');
  const [goal, setGoal] = useState('');
  const [complexity, setComplexity] = useState<Blueprint['complexity']>('MEDIUM');
  const [category, setCategory] = useState<Blueprint['category']>('architectures');
  const [description, setDescription] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({
      name: name.trim(),
      techStack,
      goal,
      complexity,
      category,
      description,
    });
  };

  return (
    <div className="fixed inset-0 z-[210] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative w-[520px] max-h-[85vh] overflow-y-auto bg-[#0e0e18] border border-white/10 rounded-2xl shadow-2xl custom-scrollbar"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
          <h3 className="text-sm font-semibold text-foreground">New Blueprint</h3>
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
        <div className="p-5 flex flex-col gap-4">
          {/* Name */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground-muted">
              Name <span className="text-red-400/70">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Blueprint name"
              autoFocus
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/40 focus:border-primary/50 focus:outline-none transition-colors"
            />
          </div>

          {/* Tech Stack */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground-muted">
              Tech Stack
            </label>
            <input
              type="text"
              value={techStack}
              onChange={(e) => setTechStack(e.target.value)}
              placeholder="React, TypeScript, Node.js"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/40 focus:border-primary/50 focus:outline-none transition-colors"
            />
          </div>

          {/* Goal */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground-muted">Goal</label>
            <input
              type="text"
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What does this blueprint achieve?"
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/40 focus:border-primary/50 focus:outline-none transition-colors"
            />
          </div>

          {/* Complexity + Category row */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground-muted">
                Complexity
              </label>
              <div className="flex gap-1" data-testid="complexity-selector">
                {COMPLEXITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setComplexity(opt.value)}
                    className={`flex-1 rounded-lg border py-2 text-[10px] font-medium transition-colors leading-none ${
                      complexity === opt.value
                        ? opt.className
                        : 'border-transparent text-foreground-muted hover:bg-white/5 hover:text-foreground'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-foreground-muted">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as Blueprint['category'])}
                className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground focus:border-primary/50 focus:outline-none"
              >
                {CATEGORY_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Description */}
          <div>
            <label className="mb-1.5 block text-xs font-medium text-foreground-muted">
              Description
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Markdown description and spec..."
              rows={6}
              className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2.5 text-sm text-foreground placeholder:text-foreground-muted/40 focus:border-primary/50 focus:outline-none resize-none transition-colors font-mono"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-white/10">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-4 py-2 text-xs font-medium text-foreground-muted hover:bg-white/5 transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!name.trim()}
            className="rounded-lg bg-primary px-5 py-2 text-xs font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-primary/80 transition-colors shadow-lg shadow-primary/20"
          >
            Save & Close
          </button>
        </div>
      </form>
    </div>
  );
}

export function BlueprintCreateModal({ isOpen, ...props }: BlueprintCreateModalProps) {
  if (!isOpen) return null;
  return <BlueprintCreateForm {...props} />;
}
