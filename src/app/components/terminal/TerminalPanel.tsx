'use client';

import { useState, useCallback } from 'react';
import type { AgentInfo } from '@/lib/tauri/agents';
import { sendToAgent } from '@/lib/tauri/agents';
import { XtermTerminal } from './XtermTerminal';
import { useNow } from '@/lib/hooks/useNow';
import { useStore } from '@/lib/store';

export type TerminalTabId = 'terminal' | string;

export interface LogEntry {
  tab: string;
  text: string;
  timestamp: number;
  agentId?: string;
}

export interface ExtraTerminal {
  id: string;
  label: string;
  cwd: string;
}

interface TerminalPanelProps {
  selectedAgentId?: string | null;
  agents?: AgentInfo[];
  onSelectAgent?: (agentId: string | null) => void;
  rootPath?: string | null;
  extraTerminals?: ExtraTerminal[];
  onCloseTerminal?: (id: string) => void;
}

export function TerminalPanel({
  selectedAgentId,
  agents = [],
  onSelectAgent,
  rootPath,
  extraTerminals = [],
  onCloseTerminal,
}: TerminalPanelProps) {
  const [activeTab, setActiveTab] = useState<TerminalTabId>('terminal');
  const now = useNow();
  const agentLogs = useStore(useCallback((s) => s.agentLogs, []));

  // Synchronize activeTab with selectedAgentId
  const [prevAgentId, setPrevAgentId] = useState(selectedAgentId);
  if (selectedAgentId !== prevAgentId) {
    setPrevAgentId(selectedAgentId);
    if (selectedAgentId) {
      setActiveTab(selectedAgentId);
    }
  }

  const getTabLabel = (id: string) => {
    if (id === 'terminal') return 'Main Terminal';
    const extra = extraTerminals.find((t) => t.id === id);
    if (extra) return extra.label;
    const agent = agents.find((a) => a.id === id);
    return agent ? agent.name : id;
  };

  const staticTabs = ['terminal'];
  const extraIds = extraTerminals.map((t) => t.id);
  const activeAgentIds = agents.map((a) => a.id);
  const allTabs = [...staticTabs, ...extraIds, ...activeAgentIds];

  const shellCmd =
    typeof window !== 'undefined' && window.navigator.platform.includes('Mac') ? '/bin/zsh' : 'sh';

  return (
    <div
      data-testid="terminal-panel"
      className="flex h-full w-full flex-col bg-panel-bg overflow-hidden border-t border-white/5"
    >
      {/* Tab bar */}
      <div className="flex items-center justify-between border-b border-white/10 px-2 glass h-10 overflow-x-auto no-scrollbar flex-shrink-0">
        <div className="flex gap-1 h-full items-end">
          {allTabs.map((tabId) => {
            const isActive = activeTab === tabId;
            const isExtra = extraIds.includes(tabId);
            const isAgent = !staticTabs.includes(tabId) && !isExtra;
            const agent = agents.find((a) => a.id === tabId);
            const isLive = agent?.lastActivityAt && now - agent.lastActivityAt < 2000;

            return (
              <button
                key={tabId}
                onClick={() => {
                  setActiveTab(tabId);
                  if (isAgent) onSelectAgent?.(tabId);
                  else onSelectAgent?.(null);
                }}
                className={`group flex items-center gap-2 px-4 h-[85%] text-[10px] font-black uppercase tracking-[0.1em] transition-all duration-300 whitespace-nowrap rounded-t-lg border-x border-t ${
                  isActive
                    ? 'bg-primary/20 text-white border-primary/40 shadow-[0_0_15px_rgba(188,19,254,0.2)] z-10'
                    : 'bg-black/40 text-foreground-muted border-white/5 hover:bg-white/5 hover:text-foreground'
                }`}
              >
                {isAgent && (
                  <span
                    className={`material-symbols-outlined text-[14px] ${isLive ? 'text-primary animate-pulse' : 'text-primary/50'}`}
                  >
                    {isLive ? 'sensors' : 'smart_toy'}
                  </span>
                )}
                {isExtra && (
                  <span className="material-symbols-outlined text-[14px] text-green-400/70">
                    terminal
                  </span>
                )}
                <span>{getTabLabel(tabId)}</span>
                {isLive && (
                  <span className="flex h-1.5 w-1.5 rounded-full bg-primary animate-ping ml-1" />
                )}
                {isExtra && (
                  <span
                    role="button"
                    aria-label="Close terminal"
                    onClick={(e) => {
                      e.stopPropagation();
                      onCloseTerminal?.(tabId);
                    }}
                    className="ml-1 text-[12px] opacity-0 group-hover:opacity-70 hover:!opacity-100 transition-opacity cursor-pointer"
                  >
                    ×
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Terminal Area — only mount active agent tab; keep shell tabs alive */}
      <div className="flex-1 relative bg-black/60 overflow-hidden min-h-0">
        {allTabs.map((tabId) => {
          const extra = extraTerminals.find((t) => t.id === tabId);
          const isAgent = !staticTabs.includes(tabId) && !extra;

          // Only mount agent terminals when they are the active tab
          if (isAgent && activeTab !== tabId) return null;

          const termId =
            tabId === 'terminal' ? 'main-terminal' : extra ? `extra-${tabId}` : `agent-${tabId}`;
          const termCwd = extra ? extra.cwd : rootPath || undefined;
          return (
            <div
              key={tabId + (tabId === 'terminal' ? rootPath || '' : '')}
              className={`absolute inset-0 p-2 ${activeTab === tabId ? 'z-10 visible' : 'z-0 invisible pointer-events-none'}`}
            >
              <XtermTerminal
                id={termId}
                initialCommand={tabId === 'terminal' ? shellCmd : extra ? shellCmd : undefined}
                cwd={termCwd}
                replayData={isAgent ? agentLogs[tabId] : undefined}
                onInput={isAgent ? (data) => sendToAgent(tabId, data) : undefined}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
