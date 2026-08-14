'use client';

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
          Both reset when the app restarts — an agent should never inherit free rein from a session
          you have forgotten.
        </p>

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
      </SettingsSection>

      <SettingsSection title="Agent Providers" icon="extension">
        <p className="text-xs text-foreground-muted leading-relaxed">
          Agent CLIs (Claude Code, Gemini, …) are configured via dynamic-provider JSON files. Import
          one to make it available for spawning — useful in the packaged app, which ships without
          them. Which of them a given project may use is set under Project → Providers.
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
    </div>
  );
}
