'use client';

import { useState, useEffect, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useStore } from '@/lib/store';
import { BlueprintCreateModal } from './BlueprintCreateModal';
import type { Blueprint } from '@/lib/tauri/blueprints';
import {
  COMPLEXITY_OPTIONS,
  COMPLEXITY_MAP,
  CATEGORY_OPTIONS,
  CATEGORY_LABELS,
} from '@/lib/blueprints/constants';

export function BlueprintsGallery() {
  const blueprintsGalleryOpen = useStore((s) => s.blueprintsGalleryOpen);
  const setBlueprintsGalleryOpen = useStore((s) => s.setBlueprintsGalleryOpen);
  const blueprintsDraft = useStore((s) => s.blueprintsDraft);
  const blueprintsDirty = useStore((s) => s.blueprintsDirty);
  const blueprintsModalOpen = useStore((s) => s.blueprintsModalOpen);
  const selectedBlueprintId = useStore((s) => s.selectedBlueprintId);
  const blueprintServerUrl = useStore((s) => s.blueprintServerUrl);
  const blueprintSyncStatus = useStore((s) => s.blueprintSyncStatus);
  const blueprintSyncError = useStore((s) => s.blueprintSyncError);
  const rootPath = useStore((s) => s.rootPath);
  const addBlueprint = useStore((s) => s.addBlueprint);
  const updateBlueprint = useStore((s) => s.updateBlueprint);
  const deleteBlueprint = useStore((s) => s.deleteBlueprint);
  const discardBlueprintChanges = useStore((s) => s.discardBlueprintChanges);
  const saveBlueprints = useStore((s) => s.saveBlueprints);
  const setBlueprintsModalOpen = useStore((s) => s.setBlueprintsModalOpen);
  const setSelectedBlueprintId = useStore((s) => s.setSelectedBlueprintId);

  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [complexityFilter, setComplexityFilter] = useState<string>('all');
  const [editTarget, setEditTarget] = useState<Blueprint | null>(null);
  const [readingOpen, setReadingOpen] = useState(false);

  useEffect(() => {
    if (!blueprintsGalleryOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !blueprintsModalOpen) {
        if (readingOpen) {
          setReadingOpen(false);
        } else {
          setBlueprintsGalleryOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [blueprintsGalleryOpen, blueprintsModalOpen, readingOpen, setBlueprintsGalleryOpen]);

  const filtered = blueprintsDraft
    .filter(
      (bp) =>
        search === '' ||
        [bp.name, bp.goal, bp.techStack, bp.description, bp.spec].some((f) =>
          f.toLowerCase().includes(search.toLowerCase())
        )
    )
    .filter((bp) => categoryFilter === 'all' || bp.category === categoryFilter)
    .filter((bp) => complexityFilter === 'all' || bp.complexity === complexityFilter);

  const selectedBlueprint = blueprintsDraft.find((bp) => bp.id === selectedBlueprintId) ?? null;

  const handleSave = useCallback(
    (data: Omit<Blueprint, 'id' | 'createdAt' | 'updatedAt'>) => {
      if (editTarget) {
        updateBlueprint(editTarget.id, { ...data, updatedAt: new Date().toISOString() });
      } else {
        const now = new Date().toISOString();
        addBlueprint({ id: crypto.randomUUID(), createdAt: now, updatedAt: now, ...data });
      }
      setBlueprintsModalOpen(false);
      setEditTarget(null);
    },
    [editTarget, addBlueprint, updateBlueprint, setBlueprintsModalOpen]
  );

  const handleEdit = useCallback(
    (bp: Blueprint) => {
      setEditTarget(bp);
      setBlueprintsModalOpen(true);
    },
    [setBlueprintsModalOpen]
  );

  const handleDelete = useCallback(
    (id: string) => {
      deleteBlueprint(id);
      if (selectedBlueprintId === id) setSelectedBlueprintId(null);
    },
    [deleteBlueprint, selectedBlueprintId, setSelectedBlueprintId]
  );

  if (!blueprintsGalleryOpen) return null;

  const syncIcon =
    blueprintSyncStatus === 'syncing'
      ? 'sync'
      : blueprintSyncStatus === 'success'
        ? 'check_circle'
        : blueprintSyncStatus === 'error'
          ? 'error'
          : blueprintSyncStatus === 'unreachable'
            ? 'wifi_off'
            : null;

  const syncColor =
    blueprintSyncStatus === 'syncing'
      ? 'text-amber-400'
      : blueprintSyncStatus === 'success'
        ? 'text-emerald-400'
        : blueprintSyncStatus === 'error'
          ? 'text-rose-400'
          : 'text-foreground-muted';

  return (
    <div className="fixed inset-0 z-[300] bg-black/80 backdrop-blur-sm flex items-center justify-center">
      <div className="w-[95vw] h-[90vh] flex flex-col bg-[#0a0a10] rounded-xl border border-white/10 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/10 flex-shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="material-symbols-outlined text-primary-light text-[20px]">
              library_books
            </span>
            <h2 className="text-sm font-bold text-foreground">Blueprints</h2>
            {blueprintServerUrl && blueprintSyncStatus !== 'idle' && syncIcon && (
              <span
                title={
                  blueprintSyncStatus === 'error'
                    ? (blueprintSyncError ?? 'Sync error')
                    : blueprintSyncStatus === 'syncing'
                      ? 'Syncing…'
                      : blueprintSyncStatus === 'success'
                        ? 'Synced'
                        : 'Server unreachable'
                }
                className={syncColor}
              >
                <span
                  className={`material-symbols-outlined text-[14px] ${blueprintSyncStatus === 'syncing' ? 'animate-spin' : ''}`}
                >
                  {syncIcon}
                </span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setEditTarget(null);
                setBlueprintsModalOpen(true);
              }}
              className="flex items-center gap-1.5 rounded-lg bg-primary/15 border border-primary/20 px-3 py-1.5 text-xs font-medium text-primary-light hover:bg-primary/25 transition-colors"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
              New
            </button>
            <button
              onClick={() => setBlueprintsGalleryOpen(false)}
              className="rounded-lg p-1.5 text-foreground-muted hover:bg-white/10 hover:text-foreground transition-colors"
              aria-label="Close blueprints gallery"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left column */}
          <div className="w-[340px] flex-shrink-0 flex flex-col border-r border-white/10">
            {/* Filters */}
            <div className="p-3 border-b border-white/5 flex flex-col gap-2.5 flex-shrink-0">
              <div className="relative">
                <span className="material-symbols-outlined absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] text-foreground-muted pointer-events-none">
                  search
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search blueprints…"
                  className="w-full bg-white/5 border border-white/10 rounded-lg pl-8 pr-3 py-2 text-xs text-foreground placeholder:text-foreground-muted/40 focus:border-primary/50 focus:outline-none transition-colors"
                />
              </div>
              <div className="flex flex-wrap gap-1">
                <button
                  onClick={() => setCategoryFilter('all')}
                  className={`rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                    categoryFilter === 'all'
                      ? 'bg-primary/15 border-primary/30 text-primary-light'
                      : 'border-white/10 text-foreground-muted hover:bg-white/5'
                  }`}
                >
                  All
                </button>
                {CATEGORY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setCategoryFilter(opt.value)}
                    className={`rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                      categoryFilter === opt.value
                        ? 'bg-primary/15 border-primary/30 text-primary-light'
                        : 'border-white/10 text-foreground-muted hover:bg-white/5'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => setComplexityFilter('all')}
                  className={`rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                    complexityFilter === 'all'
                      ? 'bg-white/10 border-white/20 text-foreground'
                      : 'border-white/10 text-foreground-muted hover:bg-white/5'
                  }`}
                >
                  All
                </button>
                {COMPLEXITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setComplexityFilter(opt.value)}
                    className={`rounded-md border px-2.5 py-1 text-[10px] font-medium transition-colors ${
                      complexityFilter === opt.value
                        ? opt.className
                        : 'border-white/10 text-foreground-muted hover:bg-white/5'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Card grid */}
            <div className="flex-1 overflow-y-auto p-3 custom-scrollbar">
              {filtered.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <span className="material-symbols-outlined mb-3 text-3xl text-foreground-muted opacity-40">
                    library_books
                  </span>
                  <p className="text-xs text-foreground-muted">
                    {blueprintsDraft.length === 0 ? 'No blueprints yet' : 'No results'}
                  </p>
                  {blueprintsDraft.length === 0 && (
                    <button
                      onClick={() => {
                        setEditTarget(null);
                        setBlueprintsModalOpen(true);
                      }}
                      className="mt-3 rounded-lg bg-primary/15 px-4 py-2 text-xs font-bold text-primary-light transition-all hover:bg-primary/25"
                    >
                      Create Blueprint
                    </button>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {filtered.map((bp) => {
                    const complexity = COMPLEXITY_MAP[bp.complexity];
                    const isSelected = bp.id === selectedBlueprintId;
                    return (
                      <button
                        key={bp.id}
                        onClick={() => setSelectedBlueprintId(isSelected ? null : bp.id)}
                        className={`text-left rounded-xl border p-3 transition-all ${
                          isSelected
                            ? 'bg-primary/10 border-primary/30 shadow-[0_0_12px_rgba(188,19,254,0.1)]'
                            : 'bg-white/2 border-white/8 hover:bg-white/5 hover:border-white/15'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-1 mb-1.5">
                          <span className="text-xs font-semibold text-foreground leading-snug line-clamp-1">
                            {bp.name}
                          </span>
                          {complexity && (
                            <span
                              className={`flex-shrink-0 rounded border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${complexity.className}`}
                            >
                              {complexity.label}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-foreground-muted mb-1.5">
                          {CATEGORY_LABELS[bp.category] ?? bp.category}
                        </p>
                        {bp.techStack && (
                          <p className="text-[9px] text-primary-light/60 font-mono mb-1.5 line-clamp-1">
                            {bp.techStack}
                          </p>
                        )}
                        {bp.goal && (
                          <p className="text-[10px] text-foreground-muted/70 leading-snug line-clamp-2">
                            {bp.goal}
                          </p>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Save/Discard bar */}
            {blueprintsDirty && (
              <div className="flex gap-2 p-3 border-t border-white/5 flex-shrink-0">
                <button
                  onClick={discardBlueprintChanges}
                  className="flex-1 rounded-lg px-3 py-2 text-xs font-medium text-foreground-muted hover:bg-white/5 transition-colors"
                >
                  Discard
                </button>
                <button
                  onClick={() => rootPath && saveBlueprints(rootPath)}
                  className="flex-1 rounded-lg bg-primary px-4 py-2 text-xs font-bold text-white hover:bg-primary/80 transition-colors shadow-lg shadow-primary/20"
                >
                  Save
                </button>
              </div>
            )}
          </div>

          {/* Right column — detail panel */}
          <div className="flex-1 overflow-y-auto p-6 custom-scrollbar">
            {selectedBlueprint ? (
              <div>
                <div className="flex items-start justify-between gap-4 mb-4">
                  <h3 className="text-lg font-bold text-foreground leading-snug">
                    {selectedBlueprint.name}
                  </h3>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      onClick={() => setReadingOpen(true)}
                      className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-foreground-muted hover:bg-white/5 hover:text-foreground transition-colors"
                      title="Open full reading view"
                    >
                      <span className="material-symbols-outlined text-[14px]">open_in_full</span>
                      Read
                    </button>
                    <button
                      onClick={() => handleEdit(selectedBlueprint)}
                      className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-foreground-muted hover:bg-white/5 hover:text-foreground transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">edit</span>
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(selectedBlueprint.id)}
                      className="flex items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 hover:bg-rose-500/20 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[14px]">delete</span>
                      Delete
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 mb-4">
                  {COMPLEXITY_MAP[selectedBlueprint.complexity] && (
                    <span
                      className={`rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${COMPLEXITY_MAP[selectedBlueprint.complexity].className}`}
                    >
                      {COMPLEXITY_MAP[selectedBlueprint.complexity].label}
                    </span>
                  )}
                  <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-foreground-muted">
                    {CATEGORY_LABELS[selectedBlueprint.category] ?? selectedBlueprint.category}
                  </span>
                </div>

                {selectedBlueprint.techStack && (
                  <div className="mb-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-1.5">
                      Tech Stack
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {selectedBlueprint.techStack.split(',').map((t) => (
                        <span
                          key={t}
                          className="rounded border border-primary/15 bg-primary/5 px-2 py-0.5 text-[10px] font-mono text-primary-light"
                        >
                          {t.trim()}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedBlueprint.goal && (
                  <div className="mb-4">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-1.5">
                      Goal
                    </p>
                    <p className="text-sm text-foreground/80 leading-relaxed">
                      {selectedBlueprint.goal}
                    </p>
                  </div>
                )}

                <div className="border-t border-white/10 my-4" />

                {selectedBlueprint.description ? (
                  <div className="[&_h1]:text-base [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:text-foreground [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mb-2 [&_h2]:text-foreground [&_h3]:text-xs [&_h3]:font-bold [&_h3]:mb-2 [&_h3]:text-foreground [&_p]:text-foreground/70 [&_p]:leading-relaxed [&_p]:mb-3 [&_p]:text-sm [&_code]:font-mono [&_code]:text-primary-light [&_code]:bg-primary/5 [&_code]:px-1 [&_code]:rounded [&_code]:text-[12px] [&_pre]:bg-white/5 [&_pre]:border [&_pre]:border-white/10 [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:mb-3 [&_ul]:mb-3 [&_ul]:pl-4 [&_ol]:mb-3 [&_ol]:pl-4 [&_li]:text-foreground/70 [&_li]:text-sm [&_li]:leading-relaxed [&_strong]:text-foreground [&_a]:text-primary-light [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:text-foreground-muted">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>
                      {selectedBlueprint.description}
                    </ReactMarkdown>
                  </div>
                ) : (
                  <p className="text-sm text-foreground-muted/50 italic">No description.</p>
                )}

                {selectedBlueprint.spec && (
                  <>
                    <div className="border-t border-white/10 my-4" />
                    <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-3">
                      Full Spec
                    </p>
                    <div className="[&_h1]:text-base [&_h1]:font-bold [&_h1]:mb-3 [&_h1]:text-foreground [&_h2]:text-sm [&_h2]:font-bold [&_h2]:mb-2 [&_h2]:text-foreground [&_h3]:text-xs [&_h3]:font-bold [&_h3]:mb-2 [&_h3]:text-foreground [&_p]:text-foreground/70 [&_p]:leading-relaxed [&_p]:mb-3 [&_p]:text-sm [&_code]:font-mono [&_code]:text-primary-light [&_code]:bg-primary/5 [&_code]:px-1 [&_code]:rounded [&_code]:text-[12px] [&_pre]:bg-white/5 [&_pre]:border [&_pre]:border-white/10 [&_pre]:rounded-lg [&_pre]:p-4 [&_pre]:overflow-x-auto [&_pre]:mb-3 [&_ul]:mb-3 [&_ul]:pl-4 [&_ol]:mb-3 [&_ol]:pl-4 [&_li]:text-foreground/70 [&_li]:text-sm [&_li]:leading-relaxed [&_strong]:text-foreground [&_a]:text-primary-light [&_blockquote]:border-l-2 [&_blockquote]:border-primary/30 [&_blockquote]:pl-3 [&_blockquote]:text-foreground-muted">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>
                        {selectedBlueprint.spec}
                      </ReactMarkdown>
                    </div>
                  </>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center opacity-40">
                <span className="material-symbols-outlined text-5xl text-foreground-muted mb-3">
                  auto_stories
                </span>
                <p className="text-sm text-foreground-muted">Select a blueprint to view details</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {readingOpen && selectedBlueprint && (
        <div className="fixed inset-0 z-[310] bg-[#07070f]/95 backdrop-blur-sm overflow-y-auto custom-scrollbar">
          <div className="max-w-3xl mx-auto px-6 py-10">
            {/* Reading header */}
            <div className="flex items-center justify-between mb-8">
              <button
                onClick={() => setReadingOpen(false)}
                className="flex items-center gap-1.5 text-xs font-medium text-foreground-muted hover:text-foreground transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">arrow_back</span>
                Back to gallery
              </button>
              <button
                onClick={() => handleEdit(selectedBlueprint)}
                className="flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-1.5 text-xs font-medium text-foreground-muted hover:bg-white/5 hover:text-foreground transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">edit</span>
                Edit
              </button>
            </div>

            {/* Title */}
            <h1 className="text-3xl font-bold text-foreground mb-4 leading-tight">
              {selectedBlueprint.name}
            </h1>

            {/* Badges */}
            <div className="flex flex-wrap gap-2 mb-6">
              {COMPLEXITY_MAP[selectedBlueprint.complexity] && (
                <span
                  className={`rounded-md border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${COMPLEXITY_MAP[selectedBlueprint.complexity].className}`}
                >
                  {COMPLEXITY_MAP[selectedBlueprint.complexity].label}
                </span>
              )}
              <span className="rounded-md border border-white/10 bg-white/5 px-2.5 py-1 text-[10px] font-medium text-foreground-muted">
                {CATEGORY_LABELS[selectedBlueprint.category] ?? selectedBlueprint.category}
              </span>
            </div>

            {/* Tech stack */}
            {selectedBlueprint.techStack && (
              <div className="mb-5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-2">
                  Tech Stack
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {selectedBlueprint.techStack.split(',').map((t) => (
                    <span
                      key={t}
                      className="rounded border border-primary/15 bg-primary/5 px-2 py-0.5 text-[11px] font-mono text-primary-light"
                    >
                      {t.trim()}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Goal */}
            {selectedBlueprint.goal && (
              <div className="mb-6">
                <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-2">
                  Goal
                </p>
                <p className="text-base text-foreground/80 leading-relaxed">
                  {selectedBlueprint.goal}
                </p>
              </div>
            )}

            <div className="border-t border-white/10 mb-8" />

            {/* Full description */}
            {selectedBlueprint.description ? (
              <div className="[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:text-foreground [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-foreground [&_h3]:text-base [&_h3]:font-bold [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-foreground [&_p]:text-foreground/75 [&_p]:leading-[1.8] [&_p]:mb-4 [&_p]:text-base [&_code]:font-mono [&_code]:text-primary-light [&_code]:bg-primary/5 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_pre]:bg-white/5 [&_pre]:border [&_pre]:border-white/10 [&_pre]:rounded-xl [&_pre]:p-5 [&_pre]:overflow-x-auto [&_pre]:mb-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:mb-4 [&_ul]:pl-5 [&_ol]:mb-4 [&_ol]:pl-5 [&_li]:text-foreground/75 [&_li]:text-base [&_li]:leading-[1.8] [&_li]:mb-1 [&_strong]:text-foreground [&_a]:text-primary-light [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:my-4 [&_blockquote]:text-foreground-muted [&_hr]:border-white/10 [&_hr]:my-6 [&_table]:w-full [&_table]:mb-4 [&_th]:text-left [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-foreground-muted [&_th]:pb-2 [&_th]:border-b [&_th]:border-white/10 [&_td]:py-2 [&_td]:text-sm [&_td]:text-foreground/70 [&_td]:border-b [&_td]:border-white/5">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>
                  {selectedBlueprint.description}
                </ReactMarkdown>
              </div>
            ) : (
              <p className="text-base text-foreground-muted/50 italic">No description.</p>
            )}

            {selectedBlueprint.spec && (
              <>
                <div className="border-t border-white/10 my-8" />
                <p className="text-[10px] font-bold uppercase tracking-wider text-foreground-muted mb-6">
                  Full Spec
                </p>
                <div className="[&_h1]:text-2xl [&_h1]:font-bold [&_h1]:mb-4 [&_h1]:text-foreground [&_h2]:text-xl [&_h2]:font-bold [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-foreground [&_h3]:text-base [&_h3]:font-bold [&_h3]:mb-2 [&_h3]:mt-6 [&_h3]:text-foreground [&_p]:text-foreground/75 [&_p]:leading-[1.8] [&_p]:mb-4 [&_p]:text-base [&_code]:font-mono [&_code]:text-primary-light [&_code]:bg-primary/5 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded [&_code]:text-sm [&_pre]:bg-white/5 [&_pre]:border [&_pre]:border-white/10 [&_pre]:rounded-xl [&_pre]:p-5 [&_pre]:overflow-x-auto [&_pre]:mb-4 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_ul]:mb-4 [&_ul]:pl-5 [&_ol]:mb-4 [&_ol]:pl-5 [&_li]:text-foreground/75 [&_li]:text-base [&_li]:leading-[1.8] [&_li]:mb-1 [&_strong]:text-foreground [&_a]:text-primary-light [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-4 [&_blockquote]:my-4 [&_blockquote]:text-foreground-muted [&_hr]:border-white/10 [&_hr]:my-6 [&_table]:w-full [&_table]:mb-4 [&_th]:text-left [&_th]:text-xs [&_th]:font-bold [&_th]:uppercase [&_th]:tracking-wider [&_th]:text-foreground-muted [&_th]:pb-2 [&_th]:border-b [&_th]:border-white/10 [&_td]:py-2 [&_td]:text-sm [&_td]:text-foreground/70 [&_td]:border-b [&_td]:border-white/5">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {selectedBlueprint.spec}
                  </ReactMarkdown>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      <BlueprintCreateModal
        isOpen={blueprintsModalOpen}
        onSave={handleSave}
        onClose={() => {
          setBlueprintsModalOpen(false);
          setEditTarget(null);
        }}
        initialValues={editTarget ?? undefined}
      />
    </div>
  );
}
