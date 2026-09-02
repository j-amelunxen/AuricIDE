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
  /** Same vocabulary as tickets. Default on create: `normal`. */
  priority: Priority;
  /** Calendar day `YYYY-MM-DD`, or null when nothing is due. */
  dueDate: string | null;
  /**
   * Images, videos and text documents copied into the app inbox store.
   * Absent on older fixtures.
   */
  attachments?: InboxAttachment[];
}

/**
 * `text` covers a pasted email, spec or thread. It is stored as a real file
 * next to the images rather than in a column, so it travels into the project
 * on assign through the same copy and can be opened in the editor afterwards.
 */
export type InboxAttachmentKind = 'image' | 'video' | 'text';

export interface InboxAttachment {
  id: string;
  itemId: string;
  kind: InboxAttachmentKind;
  fileName: string;
  storedPath: string;
  createdAt: string;
}

export interface InboxItemInput {
  title: string;
  notes?: string;
  priority?: Priority;
  dueDate?: string | null;
}

export interface InboxItemPatch {
  title?: string;
  notes?: string;
  priority?: Priority;
  /** `null` or `''` clears a previously set date. */
  dueDate?: string | null;
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
  /** Calendar day `YYYY-MM-DD`, or null when nothing is due. */
  dueDate?: string | null;
  /** Ticket description; omitted by older overview snapshots. */
  description?: string;
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
  /** Live tickets only (not done, archived or discarded), newest updated first. */
  tickets: ProjectTicketDigest[];
  error: string | null;
}

export async function inboxList(): Promise<InboxItem[]> {
  return invoke<InboxItem[]>('inbox_list');
}

export async function inboxAdd(input: InboxItemInput): Promise<InboxItem> {
  return invoke<InboxItem>('inbox_add', {
    input: {
      title: input.title,
      notes: input.notes ?? '',
      priority: input.priority,
      dueDate: input.dueDate ?? undefined,
    },
  });
}

export async function inboxUpdate(id: string, patch: InboxItemPatch): Promise<InboxItem> {
  return invoke<InboxItem>('inbox_update', {
    id,
    patch: {
      ...patch,
      // Rust's Option<String> treats JSON null as "leave alone"; an empty
      // string is the value that actually clears the date.
      dueDate: patch.dueDate === null ? '' : patch.dueDate,
    },
  });
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

export async function inboxAttach(itemId: string, sourcePath: string): Promise<InboxItem> {
  return invoke<InboxItem>('inbox_attach', { itemId, sourcePath });
}

/**
 * Stores `body` as a file on the item. `fileName` is a name, never a path —
 * the backend keeps only its last segment and forces a text extension.
 */
export async function inboxAttachText(
  itemId: string,
  fileName: string,
  body: string
): Promise<InboxItem> {
  return invoke<InboxItem>('inbox_attach_text', { itemId, fileName, body });
}

export async function inboxDetach(itemId: string, attachmentId: string): Promise<InboxItem> {
  return invoke<InboxItem>('inbox_detach', { itemId, attachmentId });
}

export async function projectsPmOverview(projectPaths: string[]): Promise<ProjectPmOverview[]> {
  return invoke<ProjectPmOverview[]>('projects_pm_overview', { projectPaths });
}

/** Writes a ticket status into that project's database, open or not. */
export async function inboxSetTicketStatus(args: {
  projectPath: string;
  ticketId: string;
  status: TicketStatus;
}): Promise<void> {
  return invoke<void>('inbox_set_ticket_status', args);
}
