'use client';

import { useEffect, useState } from 'react';
import { SettingsInput } from '@/app/components/ui/settings/SettingsInput';
import { SettingsSection } from '@/app/components/ui/settings/SettingsSection';
import { SettingsToggle } from '@/app/components/ui/settings/SettingsToggle';
import {
  CREDENTIAL_NAMESPACES,
  loadAppCredentials,
  setAppCredentials,
} from '@/lib/tauri/appCredentials';
import { sendPushoverTest } from '@/lib/tauri/pushover';

const NAMESPACE = CREDENTIAL_NAMESPACES.pushover;

export function PushoverContent() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedValues, setSavedValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<{
    kind: 'success' | 'error';
    message: string;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadAppCredentials(NAMESPACE).then((loaded) => {
      if (!cancelled) {
        setValues(loaded);
        setSavedValues(loaded);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const update = (key: string, value: string) => {
    setValues((current) => ({ ...current, [key]: value }));
    setFeedback(null);
  };

  const configured =
    (values.api_token?.trim().length ?? 0) > 0 && (values.user_key?.trim().length ?? 0) > 0;
  const dirty = JSON.stringify(values) !== JSON.stringify(savedValues);

  const save = async () => {
    if (values.enabled === 'true' && !configured) {
      setFeedback({ kind: 'error', message: 'Enter both credentials before enabling Pushover.' });
      return;
    }
    setSaving(true);
    setFeedback(null);
    try {
      await setAppCredentials(NAMESPACE, values);
      setSavedValues(values);
      setFeedback({ kind: 'success', message: 'Pushover configuration saved.' });
    } catch (error) {
      setFeedback({ kind: 'error', message: `Could not save: ${String(error)}` });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setFeedback(null);
    try {
      await sendPushoverTest();
      setFeedback({ kind: 'success', message: 'Test sent. Check your Pushover device.' });
    } catch (error) {
      setFeedback({ kind: 'error', message: `Test failed: ${String(error)}` });
    } finally {
      setTesting(false);
    }
  };

  if (loading) {
    return <p className="text-xs text-foreground-muted">Loading Pushover settings…</p>;
  }

  return (
    <div className="space-y-8">
      <p className="text-xs leading-relaxed text-foreground-muted">
        Deliver important AuricIDE inbox notifications to Pushover. Notifications are always stored
        locally first; network delivery never blocks or replaces the inbox. Matching notification
        titles, bodies, project names, and origins are sent to Pushover.
      </p>

      <SettingsSection title="Pushover" icon="notifications_active">
        <SettingsToggle
          label="Enable Pushover"
          description="New matching notifications are queued for delivery. Existing inbox history is not sent."
          checked={values.enabled === 'true'}
          onChange={(checked) => {
            if (checked && !configured) {
              setFeedback({
                kind: 'error',
                message: 'Enter both credentials before enabling Pushover.',
              });
              return;
            }
            update('enabled', String(checked));
          }}
          testId="pushover-enabled"
        />
        <SettingsInput
          label="Application API token"
          value={values.api_token ?? ''}
          onChange={(value) => update('api_token', value)}
          type="password"
          testId="pushover-api-token"
        />
        <SettingsInput
          label="User key"
          value={values.user_key ?? ''}
          onChange={(value) => update('user_key', value)}
          type="password"
          testId="pushover-user-key"
        />

        <label className="flex flex-col gap-1.5 text-xs text-foreground">
          Minimum severity
          <select
            data-testid="pushover-minimum-severity"
            value={values.minimum_severity ?? 'warn'}
            onChange={(event) => update('minimum_severity', event.target.value)}
            className="w-full rounded border border-border-dark bg-editor-bg px-2 py-1.5 text-xs text-foreground focus:border-primary focus:outline-none"
          >
            <option value="info">All notifications</option>
            <option value="warn">Warnings and errors</option>
            <option value="error">Errors only</option>
          </select>
          <span className="text-[9px] text-foreground-muted opacity-60">
            Defaults to warnings and errors so routine inbox activity stays quiet.
          </span>
        </label>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving || !dirty || (values.enabled === 'true' && !configured)}
            className="rounded-lg border border-white/10 px-3 py-1.5 text-xs font-semibold text-foreground transition-colors hover:bg-white/10 disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save configuration'}
          </button>
          <button
            type="button"
            onClick={() => void test()}
            disabled={testing || saving || dirty || !configured}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-primary-light disabled:opacity-50"
          >
            {testing ? 'Sending…' : 'Send test'}
          </button>
          {feedback && (
            <span
              role={feedback.kind === 'error' ? 'alert' : 'status'}
              className={
                feedback.kind === 'error'
                  ? 'text-[10px] text-red-400'
                  : 'text-[10px] text-foreground-muted'
              }
            >
              {feedback.message}
            </span>
          )}
        </div>
      </SettingsSection>
    </div>
  );
}
