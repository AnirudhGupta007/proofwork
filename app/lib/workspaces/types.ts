export type WorkspaceAssessmentContext = {
  title: string;
  roleTitle?: string | null;
  level: string;
  instructions: string;
  taskBrief?: string | null;
  evaluationFocus?: string[];
  requiredEvidence?: string[];
  assessmentMode?: string;
};

export type WorkspaceProvisionInput = {
  attemptId: string;
  candidateName: string;
  repoUrl: string | null;
  durationMin: number;
  assessment: WorkspaceAssessmentContext;
};

export type WorkspaceHandle = {
  provider: "daytona" | "fake";
  externalId: string;
  accessUrl: string;
  opencodeUser?: string;
  opencodePass?: string;
  expiresAt: Date;
  metadata?: {
    repoUrl?: string;
    repoDir?: string;
    candidateName?: string;
    appPreviewUrl?: string;
    terminalUrl?: string;
    terminalPort?: number;
    terminalService?: string;
    opencodeWebUrl?: string | null;
    opencodeWebPort?: number;
    opencodePrimarySurface?: "cli" | "web";
    signedUrlsRefreshedAt?: string;
    signedUrlsExpireAt?: string;
    provisioningTimings?: Array<{ label: string; durationMs: number; exitCode?: number }>;
    [key: string]: unknown;
  };
};

// A warmed sandbox before it gets attached to an attempt. Includes
// only the work that's safe to do without a candidate: repo clone,
// dependency install, opencode binaries fetched, env file written
// with non-secret defaults. Per-attempt steps (opencode password,
// commit eval hook, dev server + terminal startup) are done later
// in attachWarmToAttempt.
export type WarmInput = {
  templateId: string;
  repoUrl: string | null;
  // Heavy-step setup uses the same assessment context shape as the
  // cold path so the pre-cloned repo is identical to what the
  // attempt would have seen.
  assessment: WorkspaceAssessmentContext;
};

export type WarmHandle = {
  provider: "daytona" | "fake";
  externalId: string;
  // Captured at warm time; if the upstream repo has moved past this
  // by assign time, the pool entry is evicted as stale.
  repoCommitSha?: string;
  metadata?: Record<string, unknown>;
};

export type AttachWarmInput = WorkspaceProvisionInput & {
  warmExternalId: string;
};

export type WorkspaceAccessUrls = {
  accessUrl: string;
  metadata: {
    appPreviewUrl?: string;
    terminalUrl?: string;
    opencodeWebUrl?: string | null;
    signedUrlsRefreshedAt: string;
    signedUrlsExpireAt: string;
  };
};

export type CommandResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type CollectedArtifact = {
  kind: "git_diff" | "test_output" | "command_log" | "opencode_log" | "screenshot" | "file_tree" | "proctoring_recording";
  label: string;
  uri: string;
  metadata?: Record<string, unknown>;
};

export interface WorkspaceProvider {
  provisionWorkspace(input: WorkspaceProvisionInput): Promise<WorkspaceHandle>;
  // Warm-pool: do all candidate-agnostic setup (clone, install, write
  // env defaults) and leave the sandbox idle. Returns enough to track
  // it in WorkspacePoolEntry. Implementations may throw if warming
  // isn't supported; the pool service treats that as "fall back to
  // cold provisioning".
  warmWorkspace?(input: WarmInput): Promise<WarmHandle>;
  // Warm-pool: finalize a warmed sandbox for an attempt (opencode
  // password, commit hook, dev server, terminals). Returns the same
  // WorkspaceHandle shape as provisionWorkspace.
  attachWarmToAttempt?(input: AttachWarmInput): Promise<WorkspaceHandle>;
  startOpenCode(externalId: string): Promise<{ accessUrl: string }>;
  getAccessUrl(externalId: string): Promise<string>;
  refreshAccessUrls(externalId: string): Promise<WorkspaceAccessUrls>;
  runCommand(externalId: string, command: string, timeoutMs?: number): Promise<CommandResult>;
  collectArtifacts(externalId: string, attemptId: string): Promise<CollectedArtifact[]>;
  stopWorkspace(externalId: string): Promise<void>;
  destroyWorkspace(externalId: string): Promise<void>;
}
