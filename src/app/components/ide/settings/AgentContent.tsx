'use client';

import { useState } from 'react';

import {
  AGENT_LOG_RETENTION_DAYS,
  AGENT_TERMINAL_FONT_SIZES,
  loadAppConfig,
  setAppConfigValue,
} from '@/lib/config/appConfig';
import { agentLogPurge } from '@/lib/tauri/agentLog';
import { useConfirm } from '@/lib/hooks/useConfirm';
import { useStore } from '@/lib/store';
import { SettingsSection } from '../../ui/settings/SettingsSection';
import { SettingsToggle } from '../../ui/settings/SettingsToggle';
import { GUIDANCE } from '@/lib/ui/descriptions';
import { importProvider, listProviders } from '@/lib/tauri/providers';
import { AuricIcon } from '@/app/components/ui/AuricIcon';
import { SkillDiscoveryContent } from './SkillDiscoveryContent';

/**
 * Agent settings that belong to the installation: which provider CLIs exist on
 * this machine, and how freely agents may act in this session.
 *
 * The two switches below are deliberately not persisted. A setting that lets an
 * agent edit and run without asking, silently restored days later, is one
 * nobody remembers leaving on — so both start off every launch. How this
 * project wants its commits written lives under Project → Agent &amp; Commits.
 */
export function AgentContent() {
  const agentSettings = useStore((s) => s.agentSettings);
  const updateAgentSettings = useStore((s) => s.updateAgentSettings);
  const providers = useStore((s) => s.providers);
  const setProviders = useStore((s) => s.setProviders);
  const showToast = useStore((s) => s.showToast);
  const refreshUsageLimits = useStore((s) => s.refreshUsageLimits);
  const loadUsageLimits = useStore((s) => s.loadUsageLimits);
  const usageStatus = useStore((s) => s.usageStatus);
  const { confirm, confirmDialog } = useConfirm();

  // Read once on mount rather than held in the store: this is the only screen
  // that edits it, and the value's real home is the localStorage mirror that
  // Rust reads too.
  const [cliUsageLimits, setCliUsageLimits] = useState(() => loadAppConfig().cliUsageLimits);
  const [terminalFontSize, setTerminalFontSize] = useState(
    () => loadAppConfig().agentTerminalFontSize
  );
  const [agentConsoleAutoOpen, setAgentConsoleAutoOpen] = useState(
    () => loadAppConfig().agentConsoleAutoOpen
  );
  const [agentLogPersist, setAgentLogPersist] = useState(() => loadAppConfig().agentLogPersist);
  const [agentLogRetentionDays, setAgentLogRetentionDays] = useState(
    () => loadAppConfig().agentLogRetentionDays
  );

  const handleUsageLimitsChange = (checked: boolean) => {
    setAppConfigValue('cliUsageLimits', checked);
    setCliUsageLimits(checked);
    // Switching off must clear the chip immediately; the backend answers an
    // empty list once the mirror has caught up.
    void (checked ? refreshUsageLimits() : loadUsageLimits());
  };

  const handleAgentConsoleAutoOpenChange = (checked: boolean) => {
    setAppConfigValue('agentConsoleAutoOpen', checked);
    setAgentConsoleAutoOpen(checked);
  };

  // Switching this off is the destructive direction: it throws away everything
  // already written. Switching it on only starts a file, so it just happens.
  const handleAgentLogPersistChange = async (checked: boolean) => {
    if (checked) {
      setAppConfigValue('agentLogPersist', true);
      setAgentLogPersist(true);
      return;
    }

    const approved = await confirm({
      title: 'Stop keeping agent history?',
      message:
        'The activity already written to disk is deleted, and nothing new is recorded. This cannot be undone.',
      confirmLabel: 'Delete history',
      variant: 'destroy',
    });
    if (!approved) return;

    setAppConfigValue('agentLogPersist', false);
    setAgentLogPersist(false);
    try {
      await agentLogPurge();
    } catch {
      showToast('Could not delete the stored agent history', 'error');
    }
  };

  const handleAgentLogRetentionChange = (value: string) => {
    const days = Number(value);
    setAppConfigValue('agentLogRetentionDays', days);
    setAgentLogRetentionDays(days);
  };

  const handleTerminalFontSizeChange = (value: string) => {
    const fontSize = Number(value);
    setAppConfigValue('agentTerminalFontSize', fontSize);
    setTerminalFontSize(fontSize);
  };

  const handlePermissionPromptChange = async (checked: boolean) => {
    if (!checked) {
      updateAgentSettings({ dangerouslyIgnorePermissions: false });
      return;
    }

    const approved = await confirm({
      title: 'Skip permission prompts?',
      message:
        'New agents in this session can run commands and access files without asking. This resets when you restart AuricIDE. Enable it only for work you trust.',
      confirmLabel: 'Skip prompts',
      variant: 'destroy',
    });
    if (approved) updateAgentSettings({ dangerouslyIgnorePermissions: true });
  };

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
        <p className="text-xs text-foreground-muted leading-relaxed">
          Choose whether agents ask before making edits or running commands.
        </p>

        <SettingsToggle
          label="Auto-Accept Edits"
          description="Skip manual confirmation for file changes"
          tooltip={GUIDANCE.settings.autoAcceptEdits}
          checked={agentSettings.autoAcceptEdits}
          onChange={(checked) => updateAgentSettings({ autoAcceptEdits: checked })}
        />

        <SettingsToggle
          label="Skip Permission Prompts"
          description="Let agents run commands and access files without confirmation"
          tooltip={GUIDANCE.settings.dangerouslyIgnorePermissions}
          checked={agentSettings.dangerouslyIgnorePermissions}
          onChange={(checked) => void handlePermissionPromptChange(checked)}
          danger
        />
      </SettingsSection>

      <SettingsSection title="CLI Quota" icon="speed">
        <p className="text-xs text-foreground-muted leading-relaxed">
          Show remaining Claude Code and Codex usage in the status bar. Enabling this adds a
          settings file when AuricIDE starts a Claude Code agent. Codex is checked only when you
          refresh — that query costs credits.
        </p>
        <SettingsToggle
          label="Show CLI Quota in the Status Bar"
          description="Remaining usage and reset times"
          tooltip={GUIDANCE.settings.cliUsageLimits}
          testId="cli-usage-limits-toggle"
          checked={cliUsageLimits}
          onChange={handleUsageLimitsChange}
        />
        {cliUsageLimits && (
          <button
            type="button"
            data-testid="cli-usage-limits-refresh"
            onClick={() => void refreshUsageLimits()}
            disabled={usageStatus === 'loading'}
            className="mt-1 flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-foreground-muted transition-colors duration-150 hover:bg-white/10 hover:text-foreground disabled:opacity-50"
          >
            <AuricIcon
              name="refresh"
              aria-hidden="true"
              className={`text-[14px] ${usageStatus === 'loading' ? 'animate-spin' : ''}`}
            />
            Refresh quota now
          </button>
        )}
      </SettingsSection>

      <SettingsSection title="Agent Console" icon="dashboard">
        <SettingsToggle
          label="Open Agent Console on launch"
          description="When no project is open and agents are running, open the Agent Console instead of the start screen."
          tooltip={GUIDANCE.settings.agentConsoleAutoOpen}
          testId="agent-console-auto-open-toggle"
          checked={agentConsoleAutoOpen}
          onChange={handleAgentConsoleAutoOpenChange}
        />

        <SettingsToggle
          label="Keep a history of agent activity"
          description="Keeps the activity feed on disk between sessions, including the commands your agents run. Those sometimes carry API keys or passwords, so the stored copy masks the ones it recognises."
          testId="agent-log-persist-toggle"
          checked={agentLogPersist}
          onChange={(checked) => void handleAgentLogPersistChange(checked)}
        />
        <label className="flex items-center justify-between gap-4 text-xs text-foreground">
          <span>Keep History For</span>
          <select
            aria-label="Agent history retention"
            data-testid="agent-log-retention"
            value={agentLogRetentionDays}
            disabled={!agentLogPersist}
            onChange={(event) => handleAgentLogRetentionChange(event.target.value)}
            className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-foreground outline-none transition-colors focus:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/70 disabled:opacity-50"
          >
            {AGENT_LOG_RETENTION_DAYS.map((days) => (
              <option key={days} value={days}>
                {days === 0 ? 'No limit' : `${days} days`}
              </option>
            ))}
          </select>
        </label>
      </SettingsSection>

      <SettingsSection title="Agent Terminal" icon="terminal">
        <p className="text-xs text-foreground-muted leading-relaxed">
          Set the text size for agent terminals in the dock and fullscreen view.
        </p>
        <label className="mt-3 flex items-center justify-between gap-4 text-xs text-foreground">
          <span>Font Size</span>
          <select
            aria-label="Agent terminal font size"
            data-testid="agent-terminal-font-size"
            value={terminalFontSize}
            onChange={(event) => handleTerminalFontSizeChange(event.target.value)}
            className="rounded-md border border-white/10 bg-black/30 px-2 py-1 text-xs text-foreground outline-none transition-colors focus:border-primary/60 focus-visible:ring-2 focus-visible:ring-primary/70"
          >
            {AGENT_TERMINAL_FONT_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} px
              </option>
            ))}
          </select>
        </label>
      </SettingsSection>

      <SettingsSection title="Agent Providers" icon="extension">
        <p className="text-xs text-foreground-muted leading-relaxed">
          Import provider configuration files to add agent CLIs. Project settings decide which
          providers each project can use.
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

      <SkillDiscoveryContent />
      {confirmDialog}
    </div>
  );
}
