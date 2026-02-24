'use client';

import { useStore } from '@/lib/store';
import { save, open, message, ask } from '@tauri-apps/plugin-dialog';
import { exportDatabase, importDatabase } from '@/lib/tauri/db';
import { SettingsSection } from '../../ui/settings/SettingsSection';

export function SystemContent() {
  const rootPath = useStore((s) => s.rootPath);
  const pmDirty = useStore((s) => s.pmDirty);
  const savePmData = useStore((s) => s.savePmData);
  const loadPmData = useStore((s) => s.loadPmData);
  const clearPmData = useStore((s) => s.clearPmData);

  const handleExport = async () => {
    if (!rootPath) return;
    try {
      if (pmDirty) {
        await savePmData(rootPath);
      }
      const path = await save({
        filters: [{ name: 'SQLite Database', extensions: ['db'] }],
        defaultPath: 'auric-backup.db',
      });
      if (path) {
        await exportDatabase(rootPath, path);
        await message('Database exported successfully', { title: 'Success', kind: 'info' });
      }
    } catch (err) {
      await message(String(err), { title: 'Export Failed', kind: 'error' });
    }
  };

  const handleImport = async () => {
    if (!rootPath) return;
    try {
      const path = await open({
        filters: [{ name: 'SQLite Database', extensions: ['db'] }],
        multiple: false,
      });
      if (path && typeof path === 'string') {
        await importDatabase(rootPath, path);
        await loadPmData(rootPath);
        await message('Database imported successfully.', { title: 'Success', kind: 'info' });
      }
    } catch (err) {
      await message(String(err), { title: 'Import Failed', kind: 'error' });
    }
  };

  const handleClearTickets = async () => {
    if (!rootPath) return;
    const confirmed = await ask(
      'Are you sure you want to clear ALL tickets and epics? This cannot be undone.',
      { title: 'Clear Ticket Database', kind: 'warning' }
    );
    if (confirmed) {
      try {
        await clearPmData(rootPath);
        await message('Ticket database cleared successfully.', { title: 'Success', kind: 'info' });
      } catch (err) {
        await message(String(err), { title: 'Clear Failed', kind: 'error' });
      }
    }
  };

  return (
    <div className="space-y-6">
      <SettingsSection title="Database Management" icon="database">
        <div className="grid grid-cols-2 gap-4">
          <button
            onClick={handleExport}
            className="flex flex-col items-start gap-2 p-3 rounded border border-white/5 bg-white/5 hover:bg-white/10 hover:border-primary/30 transition-all group text-left"
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-sm text-primary group-hover:neon-glow">
                download
              </span>
              <span className="text-xs font-bold text-foreground">Export Database</span>
            </div>
            <p className="text-[9px] text-foreground-muted opacity-60">
              Create a backup of your local project data (.auric/project.db)
            </p>
          </button>

          <button
            onClick={handleImport}
            className="flex flex-col items-start gap-2 p-3 rounded border border-white/5 bg-white/5 hover:bg-white/10 hover:border-red-500/30 transition-all group text-left"
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-sm text-red-400">upload</span>
              <span className="text-xs font-bold text-foreground">Import Database</span>
            </div>
            <p className="text-[9px] text-foreground-muted opacity-60">
              Overwrite current project data with a backup file (Destructive)
            </p>
          </button>

          <button
            data-testid="clear-pm-button"
            onClick={handleClearTickets}
            className="flex flex-col items-start gap-2 p-3 rounded border border-white/5 bg-white/5 hover:bg-white/10 hover:border-red-500/30 transition-all group text-left"
          >
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-sm text-red-500">delete_sweep</span>
              <span className="text-xs font-bold text-foreground">Clear Ticket Database</span>
            </div>
            <p className="text-[9px] text-foreground-muted opacity-60">
              Permanently delete all Epics, Tickets and Test Cases
            </p>
          </button>
        </div>
      </SettingsSection>

      <section className="space-y-4 pt-6 border-t border-white/5">
        <div className="flex items-center gap-2 text-primary-light opacity-60">
          <span className="material-symbols-outlined text-sm">info</span>
          <h3 className="text-[10px] font-black uppercase tracking-widest">System Info</h3>
        </div>
        <div className="space-y-1 pl-1">
          <div className="flex justify-between items-center text-[9px] font-mono uppercase tracking-tighter text-foreground-muted">
            <span>Core Version</span>
            <span>0.1.0-alpha</span>
          </div>
          <div className="flex justify-between items-center text-[9px] font-mono uppercase tracking-tighter text-foreground-muted mt-1">
            <span>Terminal Engine</span>
            <span>PTY/XTERM</span>
          </div>
        </div>
      </section>
    </div>
  );
}
