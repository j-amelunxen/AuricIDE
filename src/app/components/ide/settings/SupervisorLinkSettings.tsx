'use client';

import { useEffect, useState } from 'react';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import { SettingsToggle } from '@/app/components/ui/settings/SettingsToggle';
import { useStore } from '@/lib/store';
import { normalizeProjectPath } from '@/lib/config/supervisorPolicy';
import {
  supervisorLinkPolicyGet,
  supervisorLinkPolicySet,
  type SupervisorLinkPolicy,
} from '@/lib/tauri/supervisorLink';

/**
 * The companion link (`docs/design-supervisor-link.md`): a companion app
 * talks to supervisors over a local socket and reads 3D scenes
 * (`docs/**\/*.scene.json`) from the projects switched on here. Each switch
 * applies at once, like the menu bar ones: it only lets the companion read
 * scenes, and every change it proposes arrives as a branch for review.
 */
export function SupervisorLinkSettings() {
  const starredProjects = useStore((s) => s.starredProjects);
  const showToast = useStore((s) => s.showToast);
  const [policy, setPolicy] = useState<SupervisorLinkPolicy | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supervisorLinkPolicyGet()
      .then((loaded) => !cancelled && setPolicy(loaded))
      .catch((reason: unknown) => !cancelled && setError(String(reason)));
    return () => {
      cancelled = true;
    };
  }, []);

  // Rust stores canonical paths; a starred path may differ only by a trailing slash.
  const visible = new Set((policy?.sceneProjects ?? []).map(normalizeProjectPath));

  const toggle = async (path: string, on: boolean) => {
    if (!policy) return;
    const rest = policy.sceneProjects.filter(
      (entry) => normalizeProjectPath(entry) !== normalizeProjectPath(path)
    );
    try {
      setPolicy(await supervisorLinkPolicySet(on ? [...rest, path] : rest));
    } catch (reason) {
      showToast(`Could not save the companion link settings: ${String(reason)}`, 'error');
    }
  };

  return (
    <SettingsSection title="Companion link" icon="hub">
      <p className="text-xs leading-relaxed text-foreground-muted">
        A companion app can start and talk to supervisors and their agents over a local socket. It
        sees nothing the human started in the IDE. Below: the projects whose scenes (
        <code>docs/**/*.scene.json</code>) it may read. Changes it proposes arrive as a branch you
        merge or delete.
      </p>
      {error ? (
        <p role="alert" className="text-xs text-red-400">
          Could not read the companion link settings: {error}
        </p>
      ) : !policy ? (
        <p className="text-xs text-foreground-muted">Loading…</p>
      ) : starredProjects.length === 0 ? (
        <p className="text-xs text-foreground-muted">
          Star a project in Quick Access to offer its scenes.
        </p>
      ) : (
        <div className="space-y-2">
          {starredProjects.map((project) => (
            <SettingsToggle
              key={project.path}
              label={project.name}
              description={project.path}
              checked={visible.has(normalizeProjectPath(project.path))}
              onChange={(on) => void toggle(project.path, on)}
              testId={`supervisor-link-scenes-${project.name}`}
            />
          ))}
        </div>
      )}
    </SettingsSection>
  );
}
