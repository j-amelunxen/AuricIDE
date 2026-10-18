'use client';

import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '@/lib/store';
import { useDialogA11y } from '@/lib/hooks/useDialogA11y';
import { useOverlayLayer } from '@/lib/overlays/useOverlayLayer';
import { LlmContent } from './settings/LlmContent';
import { JudgeLlmContent } from './settings/JudgeLlmContent';
import { AgentContent } from './settings/AgentContent';
import { ProjectAgentContent } from './settings/ProjectAgentContent';
import { GitContent } from './settings/GitContent';
import { CredentialsContent } from './settings/CredentialsContent';
import { ProviderPolicyContent } from './settings/ProviderPolicyContent';
import { CommandsContent } from './settings/CommandsContent';
import { EditorContent } from './settings/EditorContent';
import { AppearanceContent } from './settings/AppearanceContent';
import { SystemContent } from './settings/SystemContent';
import { MaintenanceContent } from './settings/MaintenanceContent';
import { McpSettingsContent } from './McpSettingsContent';
import { BlueprintSyncContent } from './settings/BlueprintSyncContent';
import { ExcalidrawContent } from './settings/ExcalidrawContent';
import { VideoImportContent } from './settings/VideoImportContent';
import { PushoverContent } from './settings/PushoverContent';
import { AuricSkillsContent } from './settings/AuricSkillsContent';
import {
  SUPERVISOR_SECTIONS,
  SupervisorContent,
  type SupervisorSection,
} from './settings/SupervisorContent';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { InfoTooltip } from '@/app/components/ui/InfoTooltip';

const JUDGE_HINT =
  'A second model that reviews claimed work. Independent of the one that built it.';

export type SettingsCategory =
  | 'agent'
  | 'skills'
  | 'supervisor'
  | 'credentials'
  | 'llm'
  | 'judge'
  | 'commands'
  | 'editor'
  | 'appearance'
  | 'system'
  | 'mcp'
  | 'blueprints'
  | 'excalidraw'
  | 'video-import'
  | 'pushover'
  | 'providers'
  | 'project-agent'
  | 'git'
  | 'maintenance';

/**
 * Which layer a setting belongs to. The split is the whole point of this
 * screen: application settings follow the install across every project,
 * project settings travel with one repository in its own database. Mixing them
 * in one list is what made it impossible to tell which was which.
 */
export type SettingsScope = 'application' | 'project';

export const SCOPE_LABELS: Record<SettingsScope, string> = {
  application: 'Application',
  project: 'Project',
};

export const SCOPE_BLURBS: Record<SettingsScope, string> = {
  application: 'Applies to every project on this machine.',
  project: 'Stored with the open project.',
};

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialCategory?: SettingsCategory;
}

interface SettingsNavItem {
  id: SettingsCategory;
  icon: string;
  label: string;
  /** Pages of this category, listed beneath it while it is open or a search finds them. */
  pages?: readonly { id: SupervisorSection; label: string }[];
}

interface SettingsNavGroup {
  id: string;
  label: string;
  scope: SettingsScope;
  items: SettingsNavItem[];
}

const SETTINGS_GROUPS: SettingsNavGroup[] = [
  {
    id: 'app-agent',
    label: 'Agents',
    scope: 'application',
    items: [
      { id: 'agent', icon: 'robot_2', label: 'Agent' },
      { id: 'skills', icon: 'auto_awesome', label: 'Skills' },
      {
        id: 'supervisor',
        icon: 'account_tree',
        label: 'Supervisor',
        pages: SUPERVISOR_SECTIONS,
      },
    ],
  },
  {
    id: 'app-credentials',
    label: 'Credentials',
    scope: 'application',
    items: [{ id: 'credentials', icon: 'key', label: 'Keys & Endpoints' }],
  },
  {
    id: 'app-editor',
    label: 'Editor',
    scope: 'application',
    items: [
      { id: 'editor', icon: 'edit_note', label: 'Editor' },
      { id: 'appearance', icon: 'palette', label: 'Appearance' },
      { id: 'commands', icon: 'terminal', label: 'Commands' },
    ],
  },
  {
    id: 'app-integrations',
    label: 'Integrations',
    scope: 'application',
    items: [
      { id: 'mcp', icon: 'hub', label: 'MCP' },
      { id: 'blueprints', icon: 'sync', label: 'Blueprints' },
      { id: 'pushover', icon: 'notifications_active', label: 'Pushover' },
    ],
  },
  {
    id: 'project-agents',
    label: 'Agents',
    scope: 'project',
    items: [
      { id: 'providers', icon: 'shield', label: 'Providers' },
      { id: 'project-agent', icon: 'commit', label: 'Agent & Commits' },
    ],
  },
  {
    id: 'project-overrides',
    label: 'Overrides',
    scope: 'project',
    items: [
      { id: 'llm', icon: 'psychology', label: 'LLM' },
      { id: 'judge', icon: 'gavel', label: 'Judge' },
      { id: 'excalidraw', icon: 'draw', label: 'Excalidraw+' },
      { id: 'video-import', icon: 'video_file', label: 'Video Import' },
    ],
  },
  {
    id: 'project-system',
    label: 'System',
    scope: 'project',
    items: [
      { id: 'git', icon: 'visibility_off', label: 'Git' },
      { id: 'system', icon: 'info', label: 'System' },
      { id: 'maintenance', icon: 'auto_fix_high', label: 'Maintenance' },
    ],
  },
];

const SCOPE_ORDER: SettingsScope[] = ['application', 'project'];

function SettingsDialog({
  onClose,
  initialCategory,
}: Pick<SettingsModalProps, 'onClose' | 'initialCategory'>) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>(
    initialCategory ?? 'agent'
  );
  const [supervisorSection, setSupervisorSection] = useState<SupervisorSection>('general');
  const [search, setSearch] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);
  const dialogRef = useDialogA11y<HTMLDivElement>();
  const rootPath = useStore((s) => s.rootPath);

  useOverlayLayer({ id: 'settings', kind: 'tool', active: true, onEscape: onClose });

  const query = search.trim().toLowerCase();
  const visibleGroups = useMemo(() => {
    const matches = (label: string) => label.toLowerCase().includes(query);
    return SETTINGS_GROUPS.map((group) => ({
      ...group,
      items: query
        ? group.items.flatMap((item) => {
            const pages = item.pages?.filter((page) => matches(page.label));
            if (matches(item.label)) return [item];
            return pages?.length ? [{ ...item, pages }] : [];
          })
        : group.items,
    })).filter((group) => group.items.length > 0);
  }, [query]);

  // A new page starts at its top, not wherever the previous one was scrolled to.
  useEffect(() => {
    contentRef.current?.scrollTo?.({ top: 0 });
  }, [activeCategory, supervisorSection]);

  const openPage = (category: SettingsCategory, page?: SupervisorSection) => {
    setActiveCategory(category);
    if (category === 'supervisor') setSupervisorSection(page ?? 'general');
  };

  // code-gate: complexity-cyclomatic - one case per settings section, a lookup with nothing to branch on
  const renderContent = () => {
    switch (activeCategory) {
      case 'agent':
        return <AgentContent />;
      case 'skills':
        return <AuricSkillsContent />;
      case 'supervisor':
        return <SupervisorContent section={supervisorSection} />;
      case 'credentials':
        return <CredentialsContent />;
      case 'providers':
        return <ProviderPolicyContent />;
      case 'project-agent':
        return <ProjectAgentContent />;
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
      case 'git':
        return <GitContent />;
      case 'system':
        return <SystemContent />;
      case 'maintenance':
        return <MaintenanceContent />;
      case 'mcp':
        return <McpSettingsContent />;
      case 'blueprints':
        return <BlueprintSyncContent />;
      case 'excalidraw':
        return <ExcalidrawContent />;
      case 'video-import':
        return <VideoImportContent />;
      case 'pushover':
        return <PushoverContent />;
    }
  };

  return (
    <div
      data-testid="settings-modal-backdrop"
      className="fixed inset-0 z-[var(--z-tool)] flex items-center justify-center bg-black/80 backdrop-blur-sm"
    >
      {/* No close on a click beside the dialog: several pages hold unsaved
          drafts, and a stray click took all of them. Esc and × still close. */}
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-modal-title"
        data-testid="settings-modal"
        className="glass-card w-[900px] max-w-[95vw] h-[78vh] overflow-hidden rounded-xl border border-white/10 bg-surface shadow-2xl animate-in fade-in zoom-in duration-200 flex flex-col"
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
                SCOPE_ORDER.map((scope) => {
                  const groups = visibleGroups.filter((group) => group.scope === scope);
                  if (groups.length === 0) return null;
                  return (
                    <div key={scope} data-testid={`settings-scope-${scope}`} className="mb-3">
                      {/* The heading carries the rule, so nobody has to guess
                          whether a value follows the install or the repo. */}
                      <div className="px-4 pt-3 pb-0.5 text-[11px] font-bold uppercase tracking-wider text-foreground">
                        {SCOPE_LABELS[scope]}
                      </div>
                      <div className="px-4 pb-1.5 text-[9px] leading-snug text-foreground-muted/70">
                        {scope === 'project' && !rootPath
                          ? 'No project open.'
                          : SCOPE_BLURBS[scope]}
                      </div>
                      {groups.map((group) => (
                        <div key={group.id} className="mb-2">
                          <div className="px-4 pt-1 pb-1 text-[10px] font-semibold tracking-wide text-foreground-muted/70">
                            {group.label}
                          </div>
                          {group.items.map((cat) => {
                            const isActive = activeCategory === cat.id;
                            const isJudge = cat.id === 'judge';
                            return (
                              <Fragment key={cat.id}>
                                <div className="flex items-center">
                                  <button
                                    data-testid={`settings-nav-${cat.id}`}
                                    aria-expanded={cat.pages ? isActive || !!query : undefined}
                                    onClick={() => openPage(cat.id)}
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
                                {cat.pages && (isActive || query) && (
                                  <SubPageNav
                                    category={cat.id}
                                    pages={cat.pages}
                                    current={isActive ? supervisorSection : null}
                                    onOpen={(page) => openPage(cat.id, page)}
                                  />
                                )}
                              </Fragment>
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Content */}
          <div ref={contentRef} className="flex-1 overflow-y-auto p-6">
            {renderContent()}
          </div>
        </div>
      </div>
    </div>
  );
}

interface SubPageNavProps {
  category: SettingsCategory;
  pages: readonly { id: SupervisorSection; label: string }[];
  current: SupervisorSection | null;
  onOpen: (page: SupervisorSection) => void;
}

function SubPageNav({ category, pages, current, onOpen }: SubPageNavProps) {
  return (
    <ul className="mb-1">
      {pages.map((page) => {
        const isCurrent = page.id === current;
        return (
          <li key={page.id}>
            <button
              data-testid={`settings-nav-${category}-${page.id}`}
              aria-current={isCurrent ? 'page' : undefined}
              onClick={() => onOpen(page.id)}
              className={`w-full py-1.5 pl-11 pr-4 text-left text-[11px] transition-colors ${
                isCurrent
                  ? 'text-primary-light'
                  : 'text-foreground-muted hover:text-foreground hover:bg-white/5'
              }`}
            >
              {page.label}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function SettingsModal({ isOpen, onClose, initialCategory }: SettingsModalProps) {
  if (!isOpen) return null;
  return <SettingsDialog onClose={onClose} initialCategory={initialCategory} />;
}
