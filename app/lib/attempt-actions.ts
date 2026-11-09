import type { Prisma } from "@prisma/client";
import { db } from "@/app/lib/db";
import { logAttemptEvent } from "@/app/lib/events";
import { isLiveInterviewPlan } from "@/app/lib/interviews/scheduling";
import { redeemInvite } from "@/app/lib/invite-actions";
import { getWorkspaceProvider } from "@/app/lib/workspaces/provider";

const activeAttemptStatuses = ["in_progress", "workspace_provisioning"] as const;

type ProctoringPreflight = {
  camera?: boolean;
  screen?: boolean;
  recording?: boolean;
};

function isPastDue(dueAt: Date | null, now = new Date()) {
  return Boolean(dueAt && dueAt.getTime() <= now.getTime());
}

async function runEvaluation(attemptId: string, reason: "submit" | "timeout") {
  if (process.env.USE_INNGEST_JOBS === "true") {
    const { inngest } = await import("@/app/lib/inngest");
    await inngest.send({ name: "attempt/evaluate", data: { attemptId, reason } });
  } else {
    const { queueEvaluateAttemptInline } = await import("@/app/lib/local-jobs");
    queueEvaluateAttemptInline(attemptId);
  }
}

async function timeoutAttempt(attemptId: string) {
  const attempt = await db.attempt.findUnique({ where: { id: attemptId } });
  if (!attempt || !activeAttemptStatuses.includes(attempt.status as (typeof activeAttemptStatuses)[number])) {
    return attempt;
  }
  if (!isPastDue(attempt.dueAt)) return attempt;

  const updated = await db.attempt.update({
    where: { id: attemptId },
    data: { status: "timed_out", timedOutAt: new Date() }
  });
  await logAttemptEvent(attemptId, "attempt.timed_out", "Assessment window elapsed");
  await runEvaluation(attemptId, "timeout");
  return updated;
}

function signedUrlsNeedRefresh(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return true;
  const expiresAt = (metadata as { signedUrlsExpireAt?: unknown }).signedUrlsExpireAt;
  if (typeof expiresAt !== "string") return true;
  const expiresAtMs = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiresAtMs)) return true;
  return expiresAtMs - Date.now() < 15 * 60_000;
}

export async function refreshAttemptWorkspaceUrls(attemptId: string, force = false) {
  const attempt = await db.attempt.findUnique({
    where: { id: attemptId },
    include: { workspace: true }
  });

  if (!attempt?.workspace) return null;
  if (!["workspace_provisioning", "in_progress"].includes(attempt.status)) return attempt.workspace;
  if (attempt.workspace.status !== "running") return attempt.workspace;
  if (!attempt.workspace.externalId) return attempt.workspace;
  if (!force && !signedUrlsNeedRefresh(attempt.workspace.metadata)) return attempt.workspace;

  const existingMetadata =
    attempt.workspace.metadata && typeof attempt.workspace.metadata === "object" && !Array.isArray(attempt.workspace.metadata)
      ? (attempt.workspace.metadata as Record<string, unknown>)
      : {};
  let refreshed;
  try {
    refreshed = await getWorkspaceProvider().refreshAccessUrls(attempt.workspace.externalId);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Could not refresh workspace URLs";
    await db.$transaction([
      db.workspace.update({
        where: { id: attempt.workspace.id },
        data: { status: "failed" }
      }),
      db.attempt.update({
        where: { id: attempt.id },
        data: { status: "failed" }
      }),
      db.eventLog.create({
        data: {
          attemptId: attempt.id,
          type: "workspace.unavailable",
          message,
          metadata: { externalId: attempt.workspace.externalId } as Prisma.InputJsonValue
        }
      })
    ]);
    return db.workspace.findUnique({ where: { id: attempt.workspace.id } });
  }

  return db.workspace.update({
    where: { id: attempt.workspace.id },
    data: {
      accessUrl: refreshed.accessUrl,
      metadata: {
        ...existingMetadata,
        ...refreshed.metadata
      } as Prisma.InputJsonValue
    }
  });
}

export async function getCurrentAttempt(token: string) {
  const invitation = await redeemInvite(token);
  if (!invitation.attempt) return null;

  await timeoutAttempt(invitation.attempt.id);
  await refreshAttemptWorkspaceUrls(invitation.attempt.id).catch((err) =>
    logAttemptEvent(invitation.attempt!.id, "workspace.url_refresh_failed", err instanceof Error ? err.message : "Could not refresh workspace URLs")
  );

  return db.attempt.findUniqueOrThrow({
    where: { id: invitation.attempt.id },
    include: { workspace: true, template: true, candidate: true, scorecard: true }
  });
}

function requireProctoringPreflight(config: unknown, preflight?: ProctoringPreflight) {
  if (!config || typeof config !== "object") return;
  const settings = config as { enabled?: unknown; cameraRequired?: unknown; screenShareRequired?: unknown; recordVideo?: unknown; recordScreen?: unknown };
  if (!settings.enabled) return;

  const missing: string[] = [];
  if (settings.cameraRequired && !preflight?.camera) missing.push("camera");
  if (settings.screenShareRequired && !preflight?.screen) missing.push("screen sharing");
  if ((settings.recordVideo || settings.recordScreen) && !preflight?.recording) missing.push("recording");

  if (missing.length > 0) {
    throw new Error(`Complete proctoring before starting: ${missing.join(", ")}.`);
  }
}

export async function startAssessment(token: string, proctoringPreflight?: ProctoringPreflight) {
  const invitation = await redeemInvite(token);
  if (isLiveInterviewPlan(invitation.template.evaluationPlan) && !invitation.interviewBooking) {
    throw new Error("Book your live interview slot before starting this assessment.");
  }
  requireProctoringPreflight(invitation.proctoringConfig, proctoringPreflight);
  const now = new Date();

  const attempt = await db.$transaction(async (tx) => {
    const chargeMarker = await tx.invitation.updateMany({
      where: { id: invitation.id, creditChargedAt: null },
      data: { creditChargedAt: now }
    });

    if (chargeMarker.count > 0) {
      const creditCharge = await tx.organization.updateMany({
        where: { id: invitation.organizationId, evaluationCredits: { gte: invitation.creditCost } },
        data: { evaluationCredits: { decrement: invitation.creditCost } }
      });

      if (creditCharge.count === 0) {
        throw new Error("No assessment credits remaining. Ask the hiring team to add credits before starting.");
      }
    }

    await tx.invitation.update({
      where: { id: invitation.id },
      data: { status: "redeemed", redeemedAt: invitation.redeemedAt ?? now }
    });

    return tx.attempt.upsert({
      where: { invitationId: invitation.id },
      update: {},
      create: {
        organizationId: invitation.organizationId,
        templateId: invitation.templateId,
        candidateId: invitation.candidateId,
        invitationId: invitation.id,
        status: "opened",
        startedAt: null,
        dueAt: null
      },
      include: { workspace: true, template: true, candidate: true }
    });
  });

  const needsProvisioning =
    attempt.status === "opened" ||
    attempt.status === "invited" ||
    attempt.status === "failed" ||
    (attempt.status === "workspace_provisioning" && !attempt.workspace);

  if (needsProvisioning) {
    await db.attempt.update({
      where: { id: attempt.id },
      data: { status: "workspace_provisioning", startedAt: null, dueAt: null }
    });
    await logAttemptEvent(
      attempt.id,
      attempt.status === "failed" ? "workspace.retry_requested" : "attempt.started",
      attempt.status === "failed" ? "Candidate retried workspace provisioning" : "Candidate started the assessment"
    );
    if (process.env.USE_INNGEST_JOBS === "true") {
      const { inngest } = await import("@/app/lib/inngest");
      await inngest.send({ name: "attempt/workspace.provision", data: { attemptId: attempt.id } });
    } else {
      const { queueProvisionAttemptInline } = await import("@/app/lib/local-jobs");
      queueProvisionAttemptInline(attempt.id);
    }
  }

  return db.attempt.findUniqueOrThrow({
    where: { id: attempt.id },
    include: { workspace: true, template: true, candidate: true }
  });
}

export async function submitAssessment(token: string, finalNotes: string) {
  const invitation = await redeemInvite(token);
  const attempt = await db.attempt.findUniqueOrThrow({ where: { invitationId: invitation.id } });

  if (activeAttemptStatuses.includes(attempt.status as (typeof activeAttemptStatuses)[number]) && isPastDue(attempt.dueAt)) {
    await timeoutAttempt(attempt.id);
    return db.attempt.findUniqueOrThrow({
      where: { id: attempt.id },
      include: { workspace: true, scorecard: true }
    });
  }

  if (!activeAttemptStatuses.includes(attempt.status as (typeof activeAttemptStatuses)[number])) {
    return db.attempt.findUniqueOrThrow({
      where: { id: attempt.id },
      include: { workspace: true, scorecard: true }
    });
  }

  const updated = await db.attempt.update({
    where: { id: attempt.id },
    data: {
      status: "submitted",
      submittedAt: new Date(),
      finalNotes
    }
  });

  await logAttemptEvent(attempt.id, "attempt.submitted", "Candidate submitted the assessment");
  await runEvaluation(attempt.id, "submit");
  return db.attempt.findUniqueOrThrow({
    where: { id: updated.id },
    include: { workspace: true, scorecard: true }
  });
}
