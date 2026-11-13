import type {
  ModelPower,
  Priority,
  RequirementStatusValue,
  RequirementTypeValue,
  TicketStatus,
} from './enums';

export interface PmEpic {
  id: string;
  name: string;
  description: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PmContextItem {
  id: string;
  type: 'snippet' | 'file' | 'canvas-node';
  value: string;
}

export interface PmTicket {
  id: string;
  epicId: string;
  name: string;
  description: string;
  status: TicketStatus;
  statusUpdatedAt: string;
  sortOrder: number;
  workingDirectory?: string;
  context?: PmContextItem[];
  modelPower?: ModelPower;
  priority: Priority;
  needsHumanSupervision?: boolean;
  goalId?: string | null;
  /** Calendar day `YYYY-MM-DD`. Absent or null means nothing is due. */
  dueDate?: string | null;
  /**
   * Skill invocations to write in front of the agent prompt when this ticket
   * is launched (`/tdd`, `/frontend:component`). Empty means none.
   */
  skills?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface PmTestCase {
  id: string;
  ticketId: string;
  title: string;
  body: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PmDependency {
  id: string;
  sourceType: 'epic' | 'ticket';
  sourceId: string;
  targetType: 'epic' | 'ticket';
  targetId: string;
}

export interface PmStatusHistoryEntry {
  id: string;
  ticketId: string;
  fromStatus: string | null;
  toStatus: string;
  changedAt: string;
  source: string;
}

export interface PmRequirement {
  id: string;
  reqId: string;
  title: string;
  description: string;
  type: RequirementTypeValue;
  category: string;
  priority: Priority;
  status: RequirementStatusValue;
  rationale: string;
  acceptanceCriteria: string;
  source: string;
  lastVerifiedAt: string | null;
  appliesTo: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface PmRequirementTestLink {
  id: string;
  requirementId: string;
  testCaseId: string;
  createdAt: string;
}
