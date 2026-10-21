'use client';

import { useEffect, useState } from 'react';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import { invoke } from '@/lib/tauri/invoke';
import {
  allowedConnectorTools,
  removeConnector,
  type ConnectorPolicy,
  type ConnectorRegistration,
} from '@/lib/config/connectorPolicy';
import { normalizeProjectPath, type SupervisorPolicy } from '@/lib/config/supervisorPolicy';

const button =
  'rounded-lg border border-white/10 bg-white/5 px-3 py-1 text-xs text-foreground hover:bg-white/10 disabled:opacity-50';
const EMPTY: ConnectorPolicy = { registry: {}, bindings: {} };
const inspect = (path: string) => invoke<ConnectorRegistration>('connector_inspect', { path });

/** Draft-only: registration, reapproval and grants take effect through the existing Save bar. */
export function SupervisorConnectors({
  policy,
  onChange,
}: {
  policy: SupervisorPolicy;
  onChange: (policy: SupervisorPolicy) => void;
}) {
  const connectors = policy.connectors ?? EMPTY;
  const [path, setPath] = useState('');
  const [preview, setPreview] = useState<ConnectorRegistration | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Record<string, string>>({});
  const change = (next: ConnectorPolicy) => onChange({ ...policy, connectors: next });
  useEffect(() => {
    let cancelled = false;
    for (const [id, entry] of Object.entries(connectors.registry)) {
      void inspect(entry.path)
        .then((current) => {
          if (!cancelled)
            setStatus((s) => ({
              ...s,
              [id]:
                current.digest === entry.digest
                  ? 'Approved digest matches'
                  : 'Disabled: manifest changed. Review and re-approve.',
            }));
        })
        .catch(() => {
          if (!cancelled)
            setStatus((s) => ({ ...s, [id]: 'Disabled: manifest missing or invalid' }));
        });
    }
    return () => {
      cancelled = true;
    };
  }, [connectors.registry]);
  const review = async (manifestPath: string) => {
    setBusy(true);
    setError(null);
    setPreview(null);
    try {
      setPreview(await inspect(manifestPath));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };
  const approve = () => {
    if (!preview) return;
    const id = preview.manifest.id;
    const existing = connectors.registry[id];
    if (existing && existing.path !== preview.path) {
      setError(`Connector id ${id} is already registered at another path. Remove it first.`);
      return;
    }
    // A changed inventory must not retain scopes that no longer exist.
    const bindings = Object.fromEntries(
      Object.entries(connectors.bindings).map(([root, grants]) => [
        root,
        {
          ...grants,
          ...(grants[id]
            ? { [id]: grants[id].filter((scope) => preview.manifest.scopes.includes(scope)) }
            : {}),
        },
      ])
    );
    change({ registry: { ...connectors.registry, [id]: preview }, bindings });
    setPreview(null);
    setPath('');
  };
  const grant = (root: string, id: string, scopes: string[] | null) => {
    const grants = { ...connectors.bindings[root] };
    if (scopes === null) delete grants[id];
    else grants[id] = scopes;
    change({ ...connectors, bindings: { ...connectors.bindings, [root]: grants } });
  };
  return (
    <SettingsSection title="External connectors" icon="extension">
      <p className="mb-3 text-xs text-foreground-muted">
        Import an owner-reviewed stdio MCP manifest. v0 supports non-secret configuration and auth:
        none. Grants apply only to new agents of an allowed project. Save to apply changes.
      </p>
      <p className="mb-3 text-xs text-foreground-muted">
        Codex and current Crush receive tool allowlists. Claude denies ungranted declared tools;
        undeclared tools are not blocked there. Other adapters that accept a full config argument
        receive config without tool filtering. Unbound adapters and adapters using only the Auric PM
        bridge receive no connectors. Provider global configuration and direct shell access are
        outside this boundary.
      </p>
      <div className="mb-3 flex flex-wrap gap-2">
        <input
          aria-label="Connector manifest path"
          placeholder="/absolute/path/auric-connector.yaml"
          value={path}
          onChange={(e) => {
            setPath(e.target.value);
            setPreview(null);
          }}
          className="min-w-0 flex-1 rounded border border-white/10 bg-white/5 px-2 py-1 font-mono text-xs text-foreground"
        />
        <button
          type="button"
          className={button}
          disabled={busy || !path.startsWith('/')}
          onClick={() => void review(path)}
        >
          Review manifest
        </button>
      </div>
      {error && (
        <p role="alert" className="mb-3 text-xs text-red-400">
          {error}
        </p>
      )}
      {preview && (
        <div className="mb-3 space-y-2 rounded border border-white/10 p-3 text-xs">
          <p>
            {preview.manifest.id} · {preview.manifest.version} · auth: {preview.manifest.auth}
          </p>
          <p className="break-all font-mono">{preview.path}</p>
          <p className="break-all font-mono">{preview.path}</p>
          <p className="break-all font-mono">SHA256: {preview.digest}</p>
          <pre className="overflow-auto whitespace-pre-wrap">
            {JSON.stringify(preview.manifest.launch, null, 2)}
          </pre>
          <p>Scopes: {preview.manifest.scopes.join(', ') || 'none'}</p>
          <p>
            Tools:{' '}
            {preview.manifest.tools
              .map((t) => `${t.name} (${t.scopes.join(', ') || 'no scope required'})`)
              .join('; ') || 'none'}
          </p>
          <p className="whitespace-pre-wrap">{preview.manifest.briefing}</p>
          <button type="button" className={button} onClick={approve}>
            Approve this digest
          </button>
        </div>
      )}
      {Object.keys(connectors.registry).length === 0 && (
        <p className="text-xs text-foreground-muted">
          No connector registered. Review a manifest by its absolute path to begin.
        </p>
      )}
      {Object.entries(connectors.registry).map(([id, entry]) => (
        <div key={id} className="mb-3 space-y-2 border-t border-white/10 pt-3 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <strong>
              {id} · {entry.manifest.version}
            </strong>
            <button
              type="button"
              className={button}
              disabled={busy}
              onClick={() => void review(entry.path)}
            >
              Review / re-approve
            </button>
            <button
              type="button"
              className={button}
              onClick={() => change(removeConnector(connectors, id))}
            >
              Remove
            </button>
          </div>
          <p role="status">{status[id] ?? 'Checking manifest…'}</p>
          <p className="break-all font-mono">
            {entry.path}
            <br />
            SHA256: {entry.digest}
          </p>
          {Object.entries(policy.projects).map(([projectPath, rules]) => {
            const root = normalizeProjectPath(projectPath);
            const scopes = connectors.bindings[root]?.[id];
            return (
              <fieldset
                key={root}
                disabled={!rules.allowed}
                className="space-y-2 disabled:opacity-50"
              >
                <legend className="break-all">
                  {root}
                  {!rules.allowed && ' — supervisor not allowed; no connector access'}
                </legend>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={scopes !== undefined}
                    onChange={(e) => grant(root, id, e.target.checked ? [] : null)}
                  />
                  Enable {id} for this project
                </label>
                {scopes !== undefined && (
                  <>
                    <div className="flex flex-wrap gap-3">
                      {entry.manifest.scopes.map((scope) => (
                        <label key={scope} className="flex items-center gap-1">
                          <input
                            type="checkbox"
                            checked={scopes.includes(scope)}
                            onChange={(e) =>
                              grant(
                                root,
                                id,
                                e.target.checked
                                  ? [...scopes, scope]
                                  : scopes.filter((s) => s !== scope)
                              )
                            }
                          />
                          {scope}
                        </label>
                      ))}
                    </div>
                    <p>
                      Allowed tools:{' '}
                      {allowedConnectorTools(entry, scopes).join(', ') ||
                        'none (connector will not launch)'}
                    </p>
                  </>
                )}
              </fieldset>
            );
          })}
        </div>
      ))}
    </SettingsSection>
  );
}
