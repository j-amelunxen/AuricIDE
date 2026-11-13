import { describe, expect, it } from 'vitest';
import names from './backendNames.fixtures.json';
import { APP_CONFIG_KEYS } from '@/lib/config/appConfig';
import { NOTIFICATIONS_CHANGED_EVENT } from './notifications';
import { USAGE_LIMITS_CHANGED_EVENT } from './usageEvents';
import { FILE_EVENTS_EVENT } from './watcher';
import { AGENT_WAITING_CHANGED_EVENT } from './agentWaiting';
import { AGENT_USAGE_RECORDED_EVENT } from './agentUsage';
import { VIDEO_IMPORT_SETUP_PROGRESS_EVENT } from './videoImport';
import { UI_PING_EVENT } from './uiWatchdog';
import { MENU_CLOSE_TAB_EVENT, MENU_COMMAND_EVENT } from './appMenu';
import { AGENT_STATUS_EVENT } from './agentEvents';
import { TERMINAL_OUTPUT_EVENT_PREFIX } from './terminal';
import { CREDENTIAL_NAMESPACES } from './appCredentials';
import { PRIORITIES, TICKET_STATUSES } from '@/lib/pm/enums';
import {
  SCHEDULE_CATCH_UPS,
  SCHEDULE_EVERY_UNITS,
  SCHEDULE_SPEC_KINDS,
} from '@/lib/notifications/scheduleVocabulary';
import { AURIC_PM_SERVER } from '@/lib/config/mcpServerName';
import { PRUNED_DIRS } from '@/mcp/stationEvidence';
import { MCP_SCHEDULE_ID_PREFIX } from '@/lib/notifications/trust';
import { MAX_GRANT_BUDGET, MAX_GRANT_CONCURRENT } from '@/lib/notifications/launchGrants';
import { LAUNCH_RUN_STATUSES } from './notifications';
import { DOCK_MAX } from '@/lib/quickAccess/dock';
import { BADGE_MAX_CHARS } from '@/lib/quickAccess/badge';

// Rust reads these prefs and emits these events by the same names
// (src-tauri/src/backend_names_tests.rs); a rename on one side alone would
// switch a feature off without an error anywhere.
describe('names shared with the backend', () => {
  it.each(Object.entries(names.prefKeys))('pref %s', (name, key) => {
    expect(APP_CONFIG_KEYS[name as keyof typeof APP_CONFIG_KEYS]).toBe(key);
  });

  it('events', () => {
    expect({
      notificationsChanged: NOTIFICATIONS_CHANGED_EVENT,
      usageLimitsChanged: USAGE_LIMITS_CHANGED_EVENT,
      fileEvents: FILE_EVENTS_EVENT,
      agentWaitingChanged: AGENT_WAITING_CHANGED_EVENT,
      agentUsageRecorded: AGENT_USAGE_RECORDED_EVENT,
      videoImportSetupProgress: VIDEO_IMPORT_SETUP_PROGRESS_EVENT,
      uiPing: UI_PING_EVENT,
      menuCommand: MENU_COMMAND_EVENT,
      menuCloseTab: MENU_CLOSE_TAB_EVENT,
      agentStatus: AGENT_STATUS_EVENT,
    }).toEqual(names.events);
    expect(TERMINAL_OUTPUT_EVENT_PREFIX).toBe(names.terminalOutputEventPrefix);
  });

  it('the ticket statuses and priorities', () => {
    expect([...TICKET_STATUSES]).toEqual(names.ticketStatuses);
    expect([...PRIORITIES]).toEqual(names.priorities);
  });

  it('the words a schedule is stored with', () => {
    expect({
      specKinds: [...SCHEDULE_SPEC_KINDS],
      everyUnits: [...SCHEDULE_EVERY_UNITS],
      catchUps: [...SCHEDULE_CATCH_UPS],
    }).toEqual(names.scheduleVocabulary);
  });

  it('the credential namespaces', () => {
    expect(CREDENTIAL_NAMESPACES).toEqual(names.credentialNamespaces);
  });

  it('the MCP server name and the folders the file list leaves out', () => {
    expect(AURIC_PM_SERVER).toBe(names.mcpServerName);
    expect([...PRUNED_DIRS]).toEqual(names.fileListPrunedDirs);
  });

  it('the id prefix that marks a schedule an agent wrote', () => {
    expect(MCP_SCHEDULE_ID_PREFIX).toBe(names.mcpScheduleIdPrefix);
  });

  it('the launch grant ceilings and launch run statuses', () => {
    expect({ maxConcurrent: MAX_GRANT_CONCURRENT, maxBudget: MAX_GRANT_BUDGET }).toEqual(
      names.launchGrantLimits
    );
    expect([...LAUNCH_RUN_STATUSES]).toEqual(names.launchRunStatuses);
  });

  it('the Quick Access dock size and badge length', () => {
    expect({ dockMax: DOCK_MAX, badgeMaxChars: BADGE_MAX_CHARS }).toEqual(names.quickAccessLimits);
  });
});
