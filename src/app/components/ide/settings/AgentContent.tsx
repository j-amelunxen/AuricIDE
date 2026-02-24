'use client';

import { useStore } from '@/lib/store';
import { extractTicket } from '@/lib/git/branchTicket';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingsToggle } from '../../ui/settings/SettingsToggle';
import { SettingsInput } from '../../ui/settings/SettingsInput';
import { GUIDANCE } from '@/lib/ui/descriptions';

export function AgentContent() {
  const agentSettings = useStore((s) => s.agentSettings);
  const updateAgentSettings = useStore((s) => s.updateAgentSettings);
  const providers = useStore((s) => s.providers);
  const branchName = useStore((s) => s.branchInfo?.name ?? '');

  const selectedProviderId = agentSettings.commitProviderId || providers[0]?.id;

  return (
    <div className="space-y-8">
      <SettingsSection title="Agent Deployment" icon="robot_2">
        <SettingsToggle
          label="Auto-Accept Edits"
          description="Skip manual confirmation for file changes"
          tooltip={GUIDANCE.settings.autoAcceptEdits}
          checked={agentSettings.autoAcceptEdits}
          onChange={(checked) => updateAgentSettings({ autoAcceptEdits: checked })}
        />

        <SettingsToggle
          label="Bypass Permissions"
          description="Grant full system access (Danger)"
          tooltip={GUIDANCE.settings.dangerouslyIgnorePermissions}
          checked={agentSettings.dangerouslyIgnorePermissions}
          onChange={(checked) => updateAgentSettings({ dangerouslyIgnorePermissions: checked })}
          danger
        />

        <SettingsToggle
          label="Agentic Commit"
          description="Use a CLI agent for commit & push"
          tooltip={GUIDANCE.settings.agenticCommit}
          checked={agentSettings.agenticCommit}
          onChange={(checked) => updateAgentSettings({ agenticCommit: checked })}
          testId="agentic-commit-toggle"
        />

        {agentSettings.agenticCommit && providers.length > 0 && (
          <div className="flex flex-col gap-1 pl-4 border-l border-white/5 ml-1">
            <span className="text-[10px] text-foreground-muted uppercase tracking-wider">
              Commit Provider
            </span>
            <select
              value={selectedProviderId}
              onChange={(e) => updateAgentSettings({ commitProviderId: e.target.value })}
              className="w-full rounded border border-border-dark bg-editor-bg px-2 py-1 text-xs text-foreground outline-none focus:border-primary transition-colors"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
        )}

        <SettingsInput
          label="Commit Prompt"
          value={agentSettings.agenticCommitPrompt}
          onChange={(val) => updateAgentSettings({ agenticCommitPrompt: val })}
          hint="Placeholders: {ticket} (extracted ID), {branch} (full name)"
          testId="agentic-prompt-input"
        />

        <div className="flex flex-col gap-1">
          <SettingsInput
            label="Ticket Pattern (regex)"
            value={agentSettings.branchTicketPattern}
            onChange={(val) => updateAgentSettings({ branchTicketPattern: val })}
            mono
            testId="ticket-pattern-input"
          />
          {branchName && (
            <div data-testid="ticket-preview" className="mt-1 flex items-center gap-2 text-[10px]">
              <span className="text-foreground-muted">Preview:</span>
              <span className="font-mono text-primary-light">
                {extractTicket(branchName, agentSettings.branchTicketPattern) ?? '(no match)'}
              </span>
              <span className="text-foreground-muted opacity-50">from {branchName}</span>
            </div>
          )}
        </div>
      </SettingsSection>
    </div>
  );
}
