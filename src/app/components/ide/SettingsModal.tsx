'use client';

import { useState, useEffect } from 'react';
import { LlmContent } from './settings/LlmContent';
import { AgentContent } from './settings/AgentContent';
import { CommandsContent } from './settings/CommandsContent';
import { EditorContent } from './settings/EditorContent';
import { AppearanceContent } from './settings/AppearanceContent';
import { SystemContent } from './settings/SystemContent';
import { McpSettingsContent } from './McpSettingsContent';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
}

type SettingsCategory = 'agent' | 'llm' | 'commands' | 'editor' | 'appearance' | 'system' | 'mcp';

const CATEGORIES: { id: SettingsCategory; icon: string; label: string }[] = [
  { id: 'agent', icon: 'robot_2', label: 'Agent' },
  { id: 'llm', icon: 'psychology', label: 'LLM' },
  { id: 'commands', icon: 'terminal', label: 'Commands' },
  { id: 'editor', icon: 'edit_note', label: 'Editor' },
  { id: 'appearance', icon: 'palette', label: 'Appearance' },
  { id: 'system', icon: 'info', label: 'System' },
  { id: 'mcp', icon: 'hub', label: 'MCP' },
];

export function SettingsModal({ isOpen, onClose }: SettingsModalProps) {
  const [activeCategory, setActiveCategory] = useState<SettingsCategory>('agent');

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const renderContent = () => {
    switch (activeCategory) {
      case 'agent':
        return <AgentContent />;
      case 'llm':
        return <LlmContent />;
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
    }
  };

  return (
    <div
      data-testid="settings-modal-backdrop"
      className="fixed inset-0 z-[400] flex items-center justify-center bg-black/80 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        data-testid="settings-modal"
        className="glass-card w-[900px] max-w-[95vw] h-[78vh] overflow-hidden rounded-xl border border-white/10 bg-[#0a0a10] shadow-2xl animate-in fade-in zoom-in duration-200 flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-sm">settings</span>
            <h2 className="text-sm font-bold tracking-tight text-foreground uppercase">Settings</h2>
          </div>
          <button
            data-testid="settings-modal-close"
            onClick={onClose}
            className="text-foreground-muted hover:text-foreground transition-colors rounded hover:bg-white/10 p-1"
          >
            <span className="material-symbols-outlined text-[18px]">close</span>
          </button>
        </div>

        {/* Body */}
        <div className="flex flex-1 overflow-hidden">
          {/* Left Sidebar Nav */}
          <div className="w-[200px] flex-shrink-0 border-r border-white/5 py-2">
            {CATEGORIES.map((cat) => {
              const isActive = activeCategory === cat.id;
              return (
                <button
                  key={cat.id}
                  data-testid={`settings-nav-${cat.id}`}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 text-xs transition-colors border-l-2 ${
                    isActive
                      ? 'border-primary text-primary-light bg-primary/5'
                      : 'border-transparent text-foreground-muted hover:text-foreground hover:bg-white/5'
                  }`}
                >
                  <span className="material-symbols-outlined text-sm">{cat.icon}</span>
                  {cat.label}
                </button>
              );
            })}
          </div>

          {/* Right Content */}
          <div className="flex-1 overflow-y-auto p-6">{renderContent()}</div>
        </div>
      </div>
    </div>
  );
}
