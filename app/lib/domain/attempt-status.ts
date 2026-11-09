export const attemptStatuses = [
  "invited",
  "opened",
  "workspace_provisioning",
  "in_progress",
  "submitted",
  "timed_out",
  "evaluating",
  "reviewed",
  "failed"
] as const;

export type AttemptStatus = (typeof attemptStatuses)[number];

const allowedTransitions: Record<AttemptStatus, AttemptStatus[]> = {
  invited: ["opened", "workspace_provisioning", "failed"],
  opened: ["workspace_provisioning", "failed"],
  workspace_provisioning: ["in_progress", "failed"],
  in_progress: ["submitted", "timed_out", "failed"],
  submitted: ["evaluating", "failed"],
  timed_out: ["evaluating", "failed"],
  evaluating: ["reviewed", "failed"],
  reviewed: [],
  failed: []
};

export function canTransitionAttempt(from: AttemptStatus, to: AttemptStatus) {
  return allowedTransitions[from]?.includes(to) ?? false;
}

export function assertAttemptTransition(from: AttemptStatus, to: AttemptStatus) {
  if (!canTransitionAttempt(from, to)) {
    throw new Error(`Invalid attempt transition: ${from} -> ${to}`);
  }
}

export function isTerminalAttemptStatus(status: AttemptStatus) {
  return status === "reviewed" || status === "failed";
}
