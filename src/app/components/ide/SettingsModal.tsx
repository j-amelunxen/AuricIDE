'use client';

import { useMemo, useState } from 'react';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { LlmContent } from './settings/LlmContent';
import { JudgeLlmContent } from './settings/JudgeLlmContent';
import { AgentContent } from './settings/AgentContent';
import { CommandsContent } from './settings/CommandsContent';
import { EditorContent } from './settings/EditorContent';
import { AppearanceContent } from './settings/AppearanceContent';
import { SystemContent } from './settings/SystemContent';
import { McpSettingsContent } from './McpSettingsContent';
import { BlueprintSyncContent } from './settings/BlueprintSyncContent';
import { ExcalidrawContent } from './settings/ExcalidrawContent';
import { VideoImportContent } from './settings/VideoImportContent';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { InfoTooltip } from '@/app/components/ui/InfoTooltip';

const JUDGE_HINT =
  'A second model that reviews claimed work. Independent of the one that built it.';

export type SettingsCategory =
  | 'agent'
  | 'llm'
  | 'judge'
  | 'commands'
  | 'editor'
  | 'appearance'
  | 'system'
  | 'mcp'
  | 'blueprints'
  | 'excalidraw'
  | 'video-import';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory?: SettingsCategory;
}

interface SettingsNavItem {
  id: SettingsCategory;
  icon: string;
  label: string;
}

interface SettingsNavGroup {
  id: string;
  label: string;
  items: SettingsNavItem[];
}

const SETTINGS_GROUPS: SettingsNavGroup[] = [
  {
    id: 'agent-models',
    label: 'Agent & models',
    items: [
      { id: 'agent', icon: 'robot_2', label: 'Agent' },
      { id: 'llm', icon: 'psychology', label: 'LLM' },
      { id: 'judge', icon: 'gavel', label: 'Judge' },
    ],
  },
  {
    id: 'editor',
    label: 'Editor',
    items: [
      { id: 'editor', icon: 'edit_note', label: 'Editor' },
      { id: 'appearance', icon: 'palette', label: 'Appearance' },
      { id: 'commands', icon: 'terminal', label: 'Commands' },
    ],
  },
  {
    id: 'integrations',
    label: 'Integrations',
    items: [
      { id: 'mcp', icon: 'hub', label: 'MCP' },
      { id: 'blueprints', icon: 'sync', label: 'Blueprints' },
      { id: 'excalidraw', icon: 'draw', label: 'Excalidraw+' },
      { id: 'video-import', icon: 'video_file', label: 'Video Import' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    items: [{ id: 'system', icon: 'info', label: 'System' }],
  },
];

function SettingsDialog({
  onClose,
  initialCategory,
}: Pick<SettingsModalProps, 'onClose' | 'initialCategory'>) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(
    initialCategory ?? 'agent'
  );
  const [search, setSearch] = useState('');
  const dialogRef = useDialogA11y<HTMLDivElement>();

  useOverlayLayer({ id: 'settings', kind: 'tool', active: true, onEscape: onClose });

  const visibleGroups = useMemo(() => {
    const query = search.trim().toLowerCase();
    return SETTINGS_GROUPS.map((group) => ({
      ...group,
      items: query
        ? group.items.filter((item) => item.label.toLowerCase().includes(query))
        : group.items,
    })).filter((group) => group.items.length > 0);
  }, [search]);

  const renderContent = () => {
    switch (activeCategory) {
      case 'agent':
        return <AgentContent />;
      case 'llm':
        return <LlmContent />;
      case 'judge':
        return <JudgeLlmContent />;
      case 'commands':
        return <CommandsContent />;
      case 'editor':
        return <EditorContent />;
      case 'appearance':
        return <AppearanceContent />;
      case 'system':
        return <SystemContent />;
      case 'mcp':
        return <McpSettingsContent />;
      case 'blueprints':
        return <BlueprintSyncContent />;
      case 'excalidraw':
        return <ExcalidrawContent />;
      case 'video-import':
        return <VideoImportContent />;
    }
  };

  return (
    <div
      data-testid="settings-modal-backdrop"
      className="fixed inset-0 z-[var(--z-tool)] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        data-testid="settings-modal"
        className="glass-card w-[900px] max-w-[95vw] h-[78vh] overflow-hidden rounded-xl border border-white/10 bg-[#0a0a10] shadow-2xl animate-in fade-in zoom-in duration-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-2">
            <AuricIcon name="settings" className="text-primary text-sm" />
            <h2
              id="settings-modal-title"
              className="text-sm font-bold tracking-tight text-foreground uppercase"
            >
              Settings
            </h2>
          </div>
          <button
            data-testid="settings-modal-close"
            aria-label="Close"
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground transition-colors rounded hover:bg-white/10 p-1"
          >
            <AuricIcon name="close" className="text-[18px]" />
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebar Nav */}
          <div className="w-[200px] flex-shrink-0 border-r border-white/5 py-2 flex flex-col">
            <div className="px-3 pb-2">
              <input
                data-testid="settings-search"
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search settings"
                className="w-full rounded-lg bg-white/5 px-2.5 py-1.5 text-xs text-foreground outline-none placeholder:text-foreground-muted/50 focus:ring-1 focus:ring-primary/30"
              />
            </div>
            <div className="flex-1 overflow-y-auto">
              {visibleGroups.length === 0 ? (
                <p className="px-4 py-2 text-xs text-foreground-muted">No matching settings</p>
              ) : (
                visibleGroups.map((group) => (
                  <div key={group.id} className="mb-2">
                    <div className="px-4 pt-2 pb-1 text-[10px] font-semibold tracking-wide text-foreground-muted/70">
                      {group.label}
                    </div>
                    {group.items.map((cat) => {
                      const isActive = activeCategory === cat.id;
                      const isJudge = cat.id === 'judge';
                      return (
                        <div key={cat.id} className="flex items-center">
                          <button
                            data-testid={`settings-nav-${cat.id}`}
                            onClick={() => setActiveCategory(cat.id)}
                            title={isJudge ? JUDGE_HINT : undefined}
                            className={`min-w-0 flex-1 flex items-center gap-3 px-4 py-2.5 text-xs transition-colors border-l-2 ${
                              isActive
                                ? 'border-primary text-primary-light bg-primary/5'
                                : 'border-transparent text-foreground-muted hover:text-foreground hover:bg-white/5'
                            }`}
                          >
                            <AuricIcon name={cat.icon} className="text-sm" />
                            {cat.label}
                          </button>
                          {isJudge && <InfoTooltip description={JUDGE_HINT} />}
                        </div>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Right Content */}
          <div className="flex-1 overflow-y-auto p-6">{renderContent()}</div>
        </div>
      </div>
    </div>
  );
}

export function SettingsModal({ isOpen, onClose, initialCategory }: SettingsModalProps) {
  if (!isOpen) return null;
  return <SettingsDialog onClose={onClose} initialCategory={initialCategory} />;
}
