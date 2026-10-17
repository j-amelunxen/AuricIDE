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

export interface JobKind {
  kind: string;
  instructions: string;
  /** Empty: the globs of every document type. */
  writes?: string[];
}

export interface LinkProjectConfig {
  documentTypes: DocumentType[];
  jobKinds: JobKind[];
}

export interface JobLimits {
  dailyLimit: number;
  perProjectDailyLimit: number | null;
}

export interface SupervisorLinkPolicy {
  /** Canonical project path → its configuration. Listed = visible. */
  projects: Record<string, LinkProjectConfig>;
  jobs: JobLimits;
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

export async function supervisorLinkPolicyGet(): Promise<SupervisorLinkPolicy> {
  return await invoke<SupervisorLinkPolicy>('supervisor_link_policy_get');
}

/** Answers with the file as it now reads back (paths canonical). */
export async function supervisorLinkPolicySet(
  policy: SupervisorLinkPolicy
): Promise<SupervisorLinkPolicy> {
  return await invoke<SupervisorLinkPolicy>('supervisor_link_policy_set', { policy });
}

export async function supervisorLinkJobsUsage(): Promise<JobsUsage> {
  return await invoke<JobsUsage>('supervisor_link_jobs_usage');
}
