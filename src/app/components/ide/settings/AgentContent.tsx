'use client';

import { useStore } from '@/lib/store';
import { extractTicket } from '@/lib/git/branchTicket';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingsToggle } from '../../ui/settings/SettingsToggle';
import { SettingsInput } from '../../ui/settings/SettingsInput';
import { GUIDANCE } from '@/lib/ui/descriptions';
import { importProvider, listProviders } from '@/lib/tauri/providers';
import { AuricIcon } from '@/app/components/ui/AuricIcon';

export function AgentContent() {
  const agentSettings = useStore((s) => s.agentSettings);
  const updateAgentSettings = useStore((s) => s.updateAgentSettings);
  const providers = useStore((s) => s.providers);
  const setProviders = useStore((s) => s.setProviders);
  const showToast = useStore((s) => s.showToast);
  const branchName = useStore((s) => s.branchInfo?.name ?? '');

  const selectedProviderId = agentSettings.commitProviderId || providers[0]?.id;

  const handleImportProvider = async () => {
    try {
      const { open } = await import('@tauri-apps/plugin-dialog');
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Provider Config', extensions: ['json'] }],
      });
      if (!selected || typeof selected !== 'string') return;
      const { readFile } = await import('@/lib/tauri/fs');
      const json = await readFile(selected);
      const imported = await importProvider(json);
      setProviders(await listProviders());
      showToast(`Imported agent provider "${imported.name}"`, 'success');
    } catch (err) {
      showToast(typeof err === 'string' ? err : 'Could not import provider', 'error');
    }
  };

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

      <SettingsSection title="Agent Providers" icon="extension">
        <p className="text-xs text-foreground-muted leading-relaxed">
          Agent CLIs (Claude Code, Gemini, …) are configured via dynamic-provider JSON files. Import
          one to make it available for spawning — useful in the packaged app, which ships without
          them.
        </p>
        <div className="flex flex-wrap gap-1.5" data-testid="provider-list">
          {providers.map((p) => (
            <span
              key={p.id}
              className="rounded-md border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-foreground-muted"
            >
              {p.name}
            </span>
          ))}
        </div>
        <button
          onClick={handleImportProvider}
          data-testid="import-provider-button"
          className="mt-1 flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/10 px-4 py-2 text-xs font-bold text-primary-light transition-colors duration-150 hover:bg-primary/20 active:scale-[0.98]"
        >
          <AuricIcon name="upload_file" aria-hidden="true" className="text-[16px]" />
          Import Provider…
        </button>
      </SettingsSection>
    </div>
  );
}
