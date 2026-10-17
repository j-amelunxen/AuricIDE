import { invoke } from './invoke';

/**
 * What the supervisor link may show and start per project
 * (`docs/design-supervisor-link.md`, "Who sees what"). The file is
 * `<app_data_dir>/supervisor-link.json`, Rust's alone: it is read on every
 * request, validated on every write and fails closed.
 */
export interface DocumentType {
  name: string;
  globs: string[];
  index?: { path: string; entriesKey?: string };
  nameField?: string;
  descriptionField?: string;
  schema?: string;
  /** Files the documents refer to (models, images), read-only via `documents.asset`. */
  assets?: string[];
  /** Largest asset handed out; Rust's default is 2 MiB, its maximum 16 MiB. */
  maxAssetBytes?: number;
}

/**
 * A job kind. It names `instructions` (project-relative; wins when the project
 * has the file), `globalInstructions` (an absolute path, or a file name under
 * `<app_data_dir>/job-kinds/`), or both. The IDE reads a global file itself
 * and puts it into the job prompt; it is never served to a client.
 */
export interface JobKind {
  kind: string;
  instructions?: string;
  globalInstructions?: string;
  /** Empty: the globs of every document type. */
  writes?: string[];
}

/** What every shared project inherits unless its entry says otherwise. */
export interface LinkDefaults {
  documentTypes: DocumentType[];
  jobKinds: JobKind[];
}

/**
 * One shared project's own entry. Same name as a default: override. New
 * name: the project's own. `inherit: false` drops every default, the
 * `disabled…` lists drop single ones. An empty entry inherits everything.
 */
export interface LinkProjectEntry {
  /** Absent means true. */
  inherit?: boolean;
  disabledDocumentTypes?: string[];
  disabledJobKinds?: string[];
  documentTypes: DocumentType[];
  jobKinds: JobKind[];
  /** This project's jobs per 24 h; absent or null: the global per-project limit. */
  dailyLimit?: number | null;
}

export interface JobLimits {
  dailyLimit: number;
  perProjectDailyLimit: number | null;
}

/** The policy file as stored (version 3) — what the settings edit. */
export interface StoredLinkPolicy {
  defaults: LinkDefaults;
  /** Canonical project path → its entry. Listed = visible. */
  projects: Record<string, LinkProjectEntry>;
  jobs: JobLimits;
}

/** Where an effective document type or job kind comes from. */
export type LinkOrigin = 'global' | 'project' | 'override';

/** One project's merged configuration, as the link acts on it. */
export interface EffectiveLinkProject {
  documentTypes: DocumentType[];
  jobKinds: JobKind[];
}

/**
 * The merged configuration. A project listed in the stored policy but absent
 * here has a merged configuration that breaks a rule; the link does not see it.
 */
export interface EffectiveLinkPolicy {
  projects: Record<string, EffectiveLinkProject>;
  jobs: JobLimits;
  /** Projects whose own entry sets a daily limit. */
  projectDailyLimits: Record<string, number>;
  origins: Record<
    string,
    { documentTypes: Record<string, LinkOrigin>; jobKinds: Record<string, LinkOrigin> }
  >;
}

export type ProposalDecision = 'apply' | 'discard';
export type ProposalOutcome = 'applied' | 'discarded' | 'expired' | 'outdated';

/** A change a supervisor asked for, waiting for a person to decide. */
export interface PolicyProposal {
  id: string;
  createdAt: number;
  /** Epoch milliseconds. */
  expiresAt: number;
  proposedBy: { agentId: string; name: string | null };
  reason: string;
  changes: unknown[];
  /** Human-readable lines, one per change. */
  diff: string[];
  base: unknown;
}

/** One line of the audit log: a proposal and how it ended. */
export interface ProposalAuditEntry extends PolicyProposal {
  at: number;
  outcome: ProposalOutcome;
}

export interface PolicyProposals {
  pending: PolicyProposal[];
  recent: ProposalAuditEntry[];
}

/** The job counter as it stands (jobs started in the last 24 hours). */
export interface JobsUsage {
  limits: JobLimits;
  inWindow: number;
  byProject: Record<string, number>;
  running: number;
  /** When a slot frees up again; null while there is room. */
  nextSlotAt: number | null;
}

export async function supervisorLinkPolicyGet(): Promise<StoredLinkPolicy> {
  return await invoke<StoredLinkPolicy>('supervisor_link_policy_get');
}

/**
 * Answers with the file as it now reads back (paths canonical); rejects with
 * a sentence naming the offending entry.
 */
export async function supervisorLinkPolicySet(policy: StoredLinkPolicy): Promise<StoredLinkPolicy> {
  return await invoke<StoredLinkPolicy>('supervisor_link_policy_set', { policy });
}

export async function supervisorLinkPolicyEffective(): Promise<EffectiveLinkPolicy> {
  return await invoke<EffectiveLinkPolicy>('supervisor_link_policy_effective');
}

export async function supervisorLinkJobsUsage(): Promise<JobsUsage> {
  return await invoke<JobsUsage>('supervisor_link_jobs_usage');
}

export async function supervisorLinkProposals(): Promise<PolicyProposals> {
  return await invoke<PolicyProposals>('supervisor_link_proposals');
}

/**
 * Applies or discards a pending proposal; answers the outcome. Rejects with a
 * readable sentence when it expired, is unknown, or the policy changed since.
 */
export async function supervisorLinkProposalDecide(
  proposalId: string,
  decision: ProposalDecision
): Promise<string> {
  return await invoke<string>('supervisor_link_proposal_decide', { proposalId, decision });
}
