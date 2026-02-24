'use client';

import { useState } from 'react';
import { useStore } from '@/lib/store';
import { SettingsSection } from '../../ui/settings/SettingsSection';

export function CommandsContent() {
  const customSlashCommands = useStore((s) => s.customSlashCommands);
  const addCustomSlashCommand = useStore((s) => s.addCustomSlashCommand);
  const removeCustomSlashCommand = useStore((s) => s.removeCustomSlashCommand);

  const [newTrigger, setNewTrigger] = useState('');
  const [newLabel, setNewLabel] = useState('');
  const [newTemplate, setNewTemplate] = useState('');

  return (
    <div className="space-y-4">
      <SettingsSection title="Slash Commands" icon="terminal">
        {customSlashCommands.length === 0 ? (
          <p className="text-[10px] text-foreground-muted opacity-60">
            No custom commands defined.
          </p>
        ) : (
          <ul className="space-y-2">
            {customSlashCommands.map((cmd) => (
              <li key={cmd.trigger} className="flex items-center justify-between group">
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-foreground">{cmd.label}</span>
                    <span className="text-[9px] text-primary-light font-mono">/{cmd.trigger}</span>
                  </div>
                  <span className="text-[9px] text-foreground-muted opacity-60 truncate">
                    {cmd.template}
                  </span>
                </div>
                <button
                  data-testid={`slash-delete-${cmd.trigger}`}
                  onClick={() => removeCustomSlashCommand(cmd.trigger)}
                  className="text-foreground-muted hover:text-red-400 transition-colors p-1 opacity-0 group-hover:opacity-100"
                >
                  <span className="material-symbols-outlined text-[14px]">delete</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        <div className="pt-2 border-t border-white/5 space-y-2">
          <div className="flex gap-2">
            <input
              type="text"
              data-testid="slash-trigger-input"
              value={newTrigger}
              onChange={(e) => setNewTrigger(e.target.value.replace(/[^a-zA-Z0-9]/g, ''))}
              placeholder="trigger"
              className="w-20 rounded border border-border-dark bg-editor-bg px-2 py-1 text-xs font-mono text-foreground placeholder:text-foreground-muted focus:border-primary focus:outline-none"
            />
            <input
              type="text"
              data-testid="slash-label-input"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              placeholder="Label"
              className="flex-1 rounded border border-border-dark bg-editor-bg px-2 py-1 text-xs text-foreground placeholder:text-foreground-muted focus:border-primary focus:outline-none"
            />
          </div>
          <textarea
            data-testid="slash-template-input"
            value={newTemplate}
            onChange={(e) => setNewTemplate(e.target.value)}
            placeholder="Template (Markdown)"
            rows={2}
            className="w-full rounded border border-border-dark bg-editor-bg px-2 py-1 text-xs font-mono text-foreground placeholder:text-foreground-muted focus:border-primary focus:outline-none resize-none"
          />
          <button
            data-testid="slash-add-button"
            onClick={() => {
              if (newTrigger.trim() && newLabel.trim() && newTemplate.trim()) {
                addCustomSlashCommand({
                  trigger: newTrigger.trim(),
                  label: newLabel.trim(),
                  template: newTemplate,
                });
                setNewTrigger('');
                setNewLabel('');
                setNewTemplate('');
              }
            }}
            disabled={!newTrigger.trim() || !newLabel.trim() || !newTemplate.trim()}
            className="w-full rounded border border-primary/20 bg-primary/10 px-3 py-1.5 text-[10px] font-bold text-primary-light uppercase tracking-wider transition-colors hover:bg-primary/20 disabled:opacity-30 disabled:cursor-not-allowed"
          >
            Add Command
          </button>
        </div>
      </SettingsSection>
    </div>
  );
}
