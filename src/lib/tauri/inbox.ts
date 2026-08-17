import type { Priority, TicketStatus } from '@/lib/pm/enums';
import { invoke } from './invoke';

/**
 * A globally captured task, before or after it becomes a real ticket.
 *
 * `projectPath`/`projectName`/`ticketId`/`assignedAt` are all set together, by
 * `inboxAssign` — an item is either unassigned (all four null) or assigned
 * (all four set). `dismissedAt` is a soft delete: dismissed rows never come
 * back from `inboxList`.
 */
export interface InboxItem {
  id: string;
  title: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
  projectPath: string | null;
  projectName: string | null;
  ticketId: string | null;
  assignedAt: string | null;
  dismissedAt: string | null;
}

export interface InboxItemInput {
  title: string;
  notes?: string;
}

export interface InboxItemPatch {
  title?: string;
  notes?: string;
}

export interface InboxAssignRequest {
  itemId: string;
  projectPath: string;
  /** Omitted → the backend uses (or creates) an epic named "Inbox". */
  epicId?: string | null;
  /** Omitted → 'normal'. */
  priority?: Priority | null;
}

export interface ProjectTicketDigest {
  id: string;
  name: string;
  status: TicketStatus;
  priority: Priority;
  epicId: string;
  epicName: string;
  updatedAt: string;
}

export interface ProjectEpicDigest {
  id: string;
  name: string;
}

/**
 * A read-only snapshot of one project's PM state, for the inbox's
 * cross-project overview. Never opens a project db for writing and never
 * creates one — `hasDb: false` just means the project has not been used yet.
 */
export interface ProjectPmOverview {
  projectPath: string;
  projectName: string;
  hasDb: boolean;
  open: number;
  inProgress: number;
  inReview: number;
  done: number;
  epics: ProjectEpicDigest[];
  /** Non-done, non-archived tickets only, newest updated first. */
  tickets: ProjectTicketDigest[];
  error: string | null;
}

export async function inboxList(): Promise<InboxItem[]> {
  return invoke<InboxItem[]>('inbox_list');
}

export async function inboxAdd(input: InboxItemInput): Promise<InboxItem> {
  return invoke<InboxItem>('inbox_add', {
    input: { title: input.title, notes: input.notes ?? '' },
  });
}

export async function inboxUpdate(id: string, patch: InboxItemPatch): Promise<InboxItem> {
  return invoke<InboxItem>('inbox_update', { id, patch });
}

export async function inboxDismiss(id: string): Promise<void> {
  return invoke<void>('inbox_dismiss', { id });
}

export async function inboxAssign(request: InboxAssignRequest): Promise<InboxItem> {
  return invoke<InboxItem>('inbox_assign', { request });
}

export async function inboxUnassign(id: string): Promise<InboxItem> {
  return invoke<InboxItem>('inbox_unassign', { id });
}

export async function projectsPmOverview(projectPaths: string[]): Promise<ProjectPmOverview[]> {
  return invoke<ProjectPmOverview[]>('projects_pm_overview', { projectPaths });
}
