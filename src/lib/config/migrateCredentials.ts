import { dbDelete, dbGet, dbList, dbSet } from '@/lib/tauri/db';
import {
  CREDENTIAL_NAMESPACES,
  loadAppCredentials,
  setAppCredential,
} from '@/lib/tauri/appCredentials';
import { PROJECT_CONFIG_NAMESPACE } from './projectConfig';

/** Set once a project has been through the move, so it never runs twice. */
const MIGRATION_MARKER = 'credentialsMigratedV1';

export interface CredentialMigration {
  /** Namespaces that gave up at least one value to the application store. */
  lifted: string[];
}

/**
 * Moves a project's credentials into the application store, once.
 *
 * API keys used to live in each project's database, so every project you opened
 * wanted them typed again. They are application-wide now — but a project that
 * already had its own must not lose it, and one that was deliberately given a
 * different key must keep it.
 *
 * The rule, field by field: if the application store has nothing for that
 * field, the project's value moves up and the project copy goes (left behind,
 * the identical value would read as a deliberate override). If the application
 * store already has one, the project's value stays exactly where it is and
 * becomes an override.
 */
export async function migrateProjectCredentials(rootPath: string): Promise<CredentialMigration> {
  const lifted: string[] = [];
  if (!rootPath) return { lifted };

  try {
    if ((await dbGet(rootPath, PROJECT_CONFIG_NAMESPACE, MIGRATION_MARKER)) === 'true') {
      return { lifted };
    }
  } catch {
    // No reachable database is nothing to migrate.
    return { lifted };
  }

  let failed = false;

  for (const namespace of Object.values(CREDENTIAL_NAMESPACES)) {
    try {
      const [projectEntries, globalValues] = await Promise.all([
        dbList(rootPath, namespace),
        loadAppCredentials(namespace),
      ]);

      let liftedHere = false;
      for (const entry of projectEntries) {
        if (!entry.value.trim()) continue;
        // Field by field: a project that set only the model must not lose it
        // because the key it never set was already global.
        if ((globalValues[entry.key] ?? '').trim()) continue;

        await setAppCredential(namespace, entry.key, entry.value);
        // Only after the write succeeded — deleting first would lose the key
        // if the application store could not be written.
        await dbDelete(rootPath, namespace, entry.key);
        liftedHere = true;
      }
      if (liftedHere) lifted.push(namespace);
    } catch {
      // Leave this namespace as it was and try again next launch.
      failed = true;
    }
  }

  // Marked even when there was nothing to move, so a project does not re-scan
  // four namespaces on every launch — but never after a failure, or the values
  // that did not make it would be stranded.
  if (!failed) {
    try {
      await dbSet(rootPath, PROJECT_CONFIG_NAMESPACE, MIGRATION_MARKER, 'true');
    } catch {
      // Unmarked means it runs again, which is the harmless direction.
    }
  }

  return { lifted };
}
