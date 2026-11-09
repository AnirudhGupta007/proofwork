// Warm pool of pre-provisioned Daytona sandboxes, keyed by assessment
// template. Sized via WORKSPACE_POOL_SIZE_PER_TEMPLATE; refilled
// on-demand after each assignment. Pool is fully bypassable: if it's
// disabled, empty, or any operation throws, callers fall back to the
// existing cold provisioning path.
//
// Logging convention: every catch logs via console.error with a "pool:"
// prefix. Failures are still non-fatal (refill is fire-and-forget), but
// we MUST surface them in pod stdout so kubectl logs is diagnostic.

import type { Prisma } from "@prisma/client";
import { db } from "@/app/lib/db";
import { env } from "@/app/lib/env";
import { logAttemptEvent } from "@/app/lib/events";
import type { WorkspaceHandle, WarmHandle } from "./types";
import { getWorkspaceProvider } from "./provider";

function poolEntryTtlMs() {
  return env.WORKSPACE_POOL_TTL_HOURS * 60 * 60 * 1000;
}

// Master toggle for the whole warm-pool feature (per-invite +
// generic template buffer + claim + reap). When false, every pool
// function early-returns and the cold-path provisionWorkspace
// handles the attempt directly.
function poolEnabled() {
  return env.WORKSPACE_POOL_ENABLED;
}

// Generic template buffer is a separate dial. Set to 0 to only do
// per-invite warming (warmOneForInvitation continues to fire) and
// skip the auto-refill that would maintain a generic template warm.
function genericRefillEnabled() {
  return env.WORKSPACE_POOL_SIZE_PER_TEMPLATE > 0;
}

function logErr(scope: string, err: unknown, context: Record<string, unknown> = {}) {
  // eslint-disable-next-line no-console
  console.error(`pool: ${scope} failed`, {
    error: err instanceof Error ? err.message : String(err),
    stack: err instanceof Error ? err.stack : undefined,
    ...context
  });
}

export async function tryClaimPoolEntry(input: {
  attemptId: string;
  templateId: string;
  invitationId?: string | null;
}): Promise<{ externalId: string; entryId: string; source: "invitation" | "template" } | null> {
  if (!poolEnabled()) return null;

  // Per-invite hybrid: first try the sandbox reserved for THIS
  // invitation (warmed at invite-send time). Falls back to the
  // generic template-tagged pool, then to cold path via null return.
  if (input.invitationId) {
    const invitationCandidate = await db.workspacePoolEntry.findFirst({
      where: { invitationId: input.invitationId, status: "idle" }
    });
    if (invitationCandidate) {
      const claimed = await db.workspacePoolEntry.updateMany({
        where: { id: invitationCandidate.id, status: "idle" },
        data: { status: "assigning", assignedAttemptId: input.attemptId }
      });
      if (claimed.count === 1) {
        return { externalId: invitationCandidate.externalId, entryId: invitationCandidate.id, source: "invitation" };
      }
    }
  }

  // Generic template-only entries (no invitationId reservation).
  const templateCandidate = await db.workspacePoolEntry.findFirst({
    where: { templateId: input.templateId, status: "idle", invitationId: null },
    orderBy: { warmedAt: "asc" }
  });
  if (!templateCandidate) return null;

  const claimed = await db.workspacePoolEntry.updateMany({
    where: { id: templateCandidate.id, status: "idle" },
    data: { status: "assigning", assignedAttemptId: input.attemptId }
  });
  if (claimed.count !== 1) return null;

  return { externalId: templateCandidate.externalId, entryId: templateCandidate.id, source: "template" };
}

export async function markPoolEntryAssigned(entryId: string) {
  await db.workspacePoolEntry.update({
    where: { id: entryId },
    data: { status: "assigned", lastHeartbeatAt: new Date() }
  });
}

export async function markPoolEntryFailed(entryId: string, reason: string) {
  await db.workspacePoolEntry
    .update({ where: { id: entryId }, data: { status: "failed", failureReason: reason } })
    .catch((err: unknown) => logErr("markPoolEntryFailed", err, { entryId, reason }));
}

export async function recyclePoolEntryForAttempt(attemptId: string) {
  if (!poolEnabled()) return;
  await db.workspacePoolEntry
    .updateMany({
      where: { assignedAttemptId: attemptId, status: "assigned" },
      data: { status: "draining" }
    })
    .catch((err: unknown) => logErr("recyclePoolEntryForAttempt", err, { attemptId }));
}

// Warm a sandbox specifically reserved for the given invitation. Called
// fire-and-forget from /api/admin/invitations POST after the invitation
// row is committed. Sets invitationId on the pool entry so
// tryClaimPoolEntry picks it up first when that invitation's attempt
// starts. No-op if pool disabled or invitation already has one.
export async function warmOneForInvitation(invitationId: string): Promise<void> {
  if (!poolEnabled()) return;

  const provider = getWorkspaceProvider();
  if (!provider.warmWorkspace) {
    // eslint-disable-next-line no-console
    console.log("pool: warmOneForInvitation skipped — provider has no warmWorkspace method", { invitationId });
    return;
  }

  const invitation = await db.invitation.findUnique({
    where: { id: invitationId },
    include: { template: true }
  });
  if (!invitation) {
    logErr("warmOneForInvitation", new Error("invitation not found"), { invitationId });
    return;
  }
  // Idempotency: skip if this invitation already has a non-failed entry.
  const existing = await db.workspacePoolEntry.findUnique({ where: { invitationId } });
  if (existing && existing.status !== "failed") {
    // eslint-disable-next-line no-console
    console.log("pool: warmOneForInvitation already warmed", { invitationId, entryId: existing.id, status: existing.status });
    return;
  }

  const expiresAt = new Date(Date.now() + poolEntryTtlMs());
  let warmHandle: WarmHandle | undefined;
  const startedAt = Date.now();

  try {
    warmHandle = await provider.warmWorkspace({
      templateId: invitation.templateId,
      repoUrl: invitation.template.repoUrl,
      assessment: {
        title: invitation.template.title,
        roleTitle: invitation.template.roleTitle,
        level: invitation.template.level,
        instructions: invitation.template.instructions,
        taskBrief: invitation.template.taskBrief,
        evaluationFocus: [],
        requiredEvidence: [],
        assessmentMode: undefined
      }
    });

    await db.workspacePoolEntry.create({
      data: {
        templateId: invitation.templateId,
        invitationId,
        externalId: warmHandle.externalId,
        repoCommitSha: warmHandle.repoCommitSha,
        status: "idle",
        warmedAt: new Date(),
        readyAt: new Date(),
        expiresAt,
        metadata: warmHandle.metadata as Prisma.InputJsonValue | undefined
      }
    });

    // eslint-disable-next-line no-console
    console.log("pool: warmOneForInvitation ok", {
      invitationId,
      templateId: invitation.templateId,
      externalId: warmHandle.externalId,
      durationMs: Date.now() - startedAt
    });
  } catch (err) {
    logErr("warmOneForInvitation", err, {
      invitationId,
      templateId: invitation.templateId,
      externalId: warmHandle?.externalId,
      durationMs: Date.now() - startedAt
    });
    if (warmHandle?.externalId) {
      await db.workspacePoolEntry
        .create({
          data: {
            templateId: invitation.templateId,
            invitationId,
            externalId: warmHandle.externalId,
            status: "failed",
            failureReason: err instanceof Error ? err.message : "warm failed",
            warmedAt: new Date(),
            expiresAt
          }
        })
        .catch((dbErr: unknown) => logErr("warmOneForInvitation.record-failed-entry", dbErr, { invitationId, externalId: warmHandle?.externalId }));
    }
  }
}

export async function refillPool(opts: { templateId?: string } = {}) {
  if (!poolEnabled()) return;
  // Generic template buffer is opt-in. Per-invite warming via
  // warmOneForInvitation always runs when the pool feature itself is
  // enabled; refill is what maintains a steady-state idle entry for
  // back-to-back invites or click-before-invite races.
  if (!genericRefillEnabled()) {
    // eslint-disable-next-line no-console
    console.log("pool: refillPool skipped (WORKSPACE_POOL_SIZE_PER_TEMPLATE=0)");
    return;
  }

  const templates = await db.assessmentTemplate.findMany({
    where: { isActive: true, ...(opts.templateId ? { id: opts.templateId } : {}) }
  });

  // eslint-disable-next-line no-console
  console.log(`pool: refillPool called`, { templates: templates.length, targetDepth: env.WORKSPACE_POOL_SIZE_PER_TEMPLATE });

  await Promise.all(
    templates.map(async (template) => {
      const currentDepth = await db.workspacePoolEntry.count({
        where: { templateId: template.id, status: { in: ["warming", "idle"] } }
      });
      const needed = env.WORKSPACE_POOL_SIZE_PER_TEMPLATE - currentDepth;
      if (needed <= 0) return;
      // eslint-disable-next-line no-console
      console.log(`pool: warming template`, { templateId: template.id, title: template.title, currentDepth, needed });
      for (let i = 0; i < needed; i++) {
        void warmOne(template.id, template.repoUrl).catch((err: unknown) =>
          logErr("warmOne", err, { templateId: template.id })
        );
      }
    })
  );
}

export async function warmOne(templateId: string, repoUrl: string | null): Promise<void> {
  const provider = getWorkspaceProvider();
  if (!provider.warmWorkspace) {
    // eslint-disable-next-line no-console
    console.log("pool: warmOne skipped — provider has no warmWorkspace method", { templateId });
    return;
  }

  const template = await db.assessmentTemplate.findUnique({ where: { id: templateId } });
  if (!template) {
    logErr("warmOne", new Error("template not found"), { templateId });
    return;
  }

  const expiresAt = new Date(Date.now() + poolEntryTtlMs());
  let warmHandle: WarmHandle | undefined;
  const startedAt = Date.now();

  try {
    warmHandle = await provider.warmWorkspace({
      templateId,
      repoUrl,
      assessment: {
        title: template.title,
        roleTitle: template.roleTitle,
        level: template.level,
        instructions: template.instructions,
        taskBrief: template.taskBrief,
        evaluationFocus: [],
        requiredEvidence: [],
        assessmentMode: undefined
      }
    });

    await db.workspacePoolEntry.create({
      data: {
        templateId,
        externalId: warmHandle.externalId,
        repoCommitSha: warmHandle.repoCommitSha,
        status: "idle",
        warmedAt: new Date(),
        readyAt: new Date(),
        expiresAt,
        metadata: warmHandle.metadata as Prisma.InputJsonValue | undefined
      }
    });

    // eslint-disable-next-line no-console
    console.log("pool: warmOne ok", {
      templateId,
      externalId: warmHandle.externalId,
      durationMs: Date.now() - startedAt,
      repoCommitSha: warmHandle.repoCommitSha
    });
  } catch (err) {
    logErr("warmOne", err, {
      templateId,
      externalId: warmHandle?.externalId,
      durationMs: Date.now() - startedAt
    });
    // If the provider partially succeeded (sandbox created but later
    // step failed), record a failed entry so the reaper destroys it.
    // Also try to clean up the orphan sandbox directly so we don't
    // wait on Daytona's autoStop.
    if (warmHandle?.externalId) {
      await db.workspacePoolEntry
        .create({
          data: {
            templateId,
            externalId: warmHandle.externalId,
            status: "failed",
            failureReason: err instanceof Error ? err.message : "warm failed",
            warmedAt: new Date(),
            expiresAt
          }
        })
        .catch((dbErr: unknown) => logErr("warmOne.record-failed-entry", dbErr, { templateId, externalId: warmHandle?.externalId }));
    }
  }
}

export async function reapPool() {
  if (!poolEnabled()) return;
  const provider = getWorkspaceProvider();

  const now = new Date();
  const reapable = await db.workspacePoolEntry.findMany({
    where: {
      OR: [
        { status: "draining" },
        { status: "failed" },
        { status: { in: ["warming", "idle", "assigning"] }, expiresAt: { lt: now } }
      ]
    },
    take: 20
  });

  if (reapable.length > 0) {
    // eslint-disable-next-line no-console
    console.log("pool: reapPool", { count: reapable.length });
  }

  for (const entry of reapable) {
    await provider
      .destroyWorkspace(entry.externalId)
      .catch((err: unknown) => logErr("reapPool.destroyWorkspace", err, { entryId: entry.id, externalId: entry.externalId }));
    await db.workspacePoolEntry
      .delete({ where: { id: entry.id } })
      .catch((err: unknown) => logErr("reapPool.delete-row", err, { entryId: entry.id }));
  }
}

export async function tryProvisionFromPool(input: {
  attemptId: string;
  templateId: string;
  invitationId?: string | null;
  warmInput: import("./types").AttachWarmInput;
}): Promise<WorkspaceHandle | null> {
  if (!poolEnabled()) return null;

  const provider = getWorkspaceProvider();
  if (!provider.attachWarmToAttempt) return null;

  const claim = await tryClaimPoolEntry({
    attemptId: input.attemptId,
    templateId: input.templateId,
    invitationId: input.invitationId
  });
  if (!claim) {
    // eslint-disable-next-line no-console
    console.log("pool: tryProvisionFromPool miss (no idle entry)", {
      attemptId: input.attemptId,
      templateId: input.templateId,
      invitationId: input.invitationId
    });
    // First-of-template stays cold forever without this — refill only
    // fires on hits and per-invite pre-warm only fires at invite-send.
    void refillPool({ templateId: input.templateId });
    return null;
  }

  try {
    const handle = await provider.attachWarmToAttempt({
      ...input.warmInput,
      warmExternalId: claim.externalId
    });
    await markPoolEntryAssigned(claim.entryId);
    await logAttemptEvent(
      input.attemptId,
      "workspace.pool_hit",
      "Workspace assigned from warm pool",
      { entryId: claim.entryId, externalId: claim.externalId }
    ).catch((err: unknown) => logErr("logAttemptEvent.pool_hit", err, { attemptId: input.attemptId }));
    // eslint-disable-next-line no-console
    console.log("pool: tryProvisionFromPool hit", { attemptId: input.attemptId, templateId: input.templateId, entryId: claim.entryId, source: claim.source });
    // Fire-and-forget refill so depth recovers without blocking the
    // candidate's request.
    void refillPool({ templateId: input.templateId });
    return handle;
  } catch (err) {
    logErr("tryProvisionFromPool.attach", err, { attemptId: input.attemptId, entryId: claim.entryId, externalId: claim.externalId });
    await markPoolEntryFailed(
      claim.entryId,
      err instanceof Error ? err.message : "attach failed"
    );
    await logAttemptEvent(
      input.attemptId,
      "workspace.pool_attach_failed",
      err instanceof Error ? err.message : "Pool attach failed",
      { entryId: claim.entryId }
    ).catch((logErr2: unknown) => logErr("logAttemptEvent.pool_attach_failed", logErr2, { attemptId: input.attemptId }));
    return null;
  }
}
