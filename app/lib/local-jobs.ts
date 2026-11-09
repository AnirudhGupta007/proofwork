import type { Prisma } from "@prisma/client";
import { persistArtifactPayloadsToR2 } from "@/app/lib/artifacts";
import { db } from "@/app/lib/db";
import { parseRubricWeights, weightedOverallScore } from "@/app/lib/domain/rubric";
import { evaluateAttemptWithGpt } from "@/app/lib/evals/gpt-evaluator";
import {
  liveInterviewSignalsFromEvents,
  promptQualitySignalsFromArtifacts,
  scoreAttemptFromSignals,
  workLoopSignalsFromArtifacts
} from "@/app/lib/evals/scorer";
import { logAttemptEvent } from "@/app/lib/events";
import { sanitizeJsonForPostgres } from "@/app/lib/json-sanitize";
import { sendCandidateReportEmail } from "@/app/lib/reports/candidate-report";
import { recyclePoolEntryForAttempt, tryProvisionFromPool } from "@/app/lib/workspaces/pool";
import { getWorkspaceProvider } from "@/app/lib/workspaces/provider";

const scheduledTimeouts = new Set<string>();
const provisioningAttempts = new Set<string>();
const evaluatingAttempts = new Set<string>();

export function queueProvisionAttemptInline(attemptId: string) {
  if (provisioningAttempts.has(attemptId)) return;
  provisioningAttempts.add(attemptId);

  void provisionAttemptInline(attemptId)
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : "Workspace provisioning failed";
      const previousFailures = await db.eventLog.count({ where: { attemptId, type: "workspace.failed" } }).catch(() => 1);
      await logAttemptEvent(attemptId, "workspace.failed", message).catch(() => undefined);

      if (previousFailures === 0) {
        await db.attempt.update({ where: { id: attemptId }, data: { status: "workspace_provisioning", startedAt: null, dueAt: null } }).catch(() => undefined);
        await logAttemptEvent(attemptId, "workspace.auto_retry_scheduled", "Provisioning failed once; automatically retrying with a fresh devbox", {
          reason: message
        }).catch(() => undefined);
        setTimeout(() => queueProvisionAttemptInline(attemptId), 1500);
        return;
      }

      await db.attempt.update({ where: { id: attemptId }, data: { status: "failed" } }).catch(() => undefined);
    })
    .finally(() => {
      provisioningAttempts.delete(attemptId);
    });
}

export function queueEvaluateAttemptInline(attemptId: string) {
  if (evaluatingAttempts.has(attemptId)) return;
  evaluatingAttempts.add(attemptId);

  void evaluateAttemptInline(attemptId)
    .catch(async (err) => {
      const message = err instanceof Error ? err.message : "Inline evaluation failed";
      await db.attempt.update({ where: { id: attemptId }, data: { status: "failed" } }).catch(() => undefined);
      await logAttemptEvent(attemptId, "eval.failed", message).catch(() => undefined);
    })
    .finally(() => {
      evaluatingAttempts.delete(attemptId);
    });
}

function artifactText(artifact?: { metadata?: unknown }) {
  if (!artifact?.metadata || typeof artifact.metadata !== "object") return "";
  const record = artifact.metadata as { stdout?: unknown; stderr?: unknown };
  return String(record.stdout ?? record.stderr ?? "");
}

function minimumMeaningfulCommits(evaluationPlan: unknown) {
  if (!evaluationPlan || typeof evaluationPlan !== "object") return undefined;
  const policy = (evaluationPlan as { antiOneShotPolicy?: { minimumMeaningfulCommits?: unknown } }).antiOneShotPolicy;
  return typeof policy?.minimumMeaningfulCommits === "number" ? policy.minimumMeaningfulCommits : undefined;
}

function artifactHasOutput(artifact?: { metadata?: unknown }) {
  return artifactText(artifact).trim().length > 0;
}

function artifactExitCode(artifact?: { metadata?: unknown }) {
  if (!artifact?.metadata || typeof artifact.metadata !== "object") return undefined;
  const record = artifact.metadata as { exitCode?: unknown };
  return typeof record.exitCode === "number" ? record.exitCode : undefined;
}

function reusableEvidenceArtifacts(
  artifacts: Array<{ kind: string; label: string; uri: string; metadata?: unknown }>
) {
  return artifacts.filter(
    (artifact) =>
      artifact.kind !== "reviewer_export" &&
      artifact.kind !== "proctoring_recording" &&
      artifact.label !== "Prompt quality analysis" &&
      artifact.label !== "Live interview transcript"
  );
}

function scheduleAttemptTimeoutInline(attemptId: string, dueAt: Date) {
  if (scheduledTimeouts.has(attemptId)) return;
  scheduledTimeouts.add(attemptId);

  const delayMs = Math.max(0, dueAt.getTime() - Date.now());
  setTimeout(async () => {
    try {
      const attempt = await db.attempt.findUnique({ where: { id: attemptId } });
      if (!attempt || attempt.status !== "in_progress") return;

      await db.attempt.update({
        where: { id: attemptId },
        data: { status: "timed_out", timedOutAt: new Date() }
      });
      await logAttemptEvent(attemptId, "attempt.timed_out", "Assessment window elapsed");
      await evaluateAttemptInline(attemptId);
    } catch (err) {
      await logAttemptEvent(attemptId, "attempt.timeout_failed", err instanceof Error ? err.message : "Timeout evaluation failed");
    } finally {
      scheduledTimeouts.delete(attemptId);
    }
  }, delayMs);
}

export async function provisionAttemptInline(attemptId: string) {
  const attempt = await db.attempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: { candidate: true, template: true }
  });

  await db.attempt.update({ where: { id: attemptId }, data: { status: "workspace_provisioning" } });

  const provisionInput = {
    attemptId,
    candidateName: attempt.candidate.name,
    repoUrl: attempt.template.repoUrl,
    durationMin: attempt.template.durationMin,
    assessment: {
      title: attempt.template.title,
      roleTitle: attempt.template.roleTitle,
      level: attempt.template.level,
      instructions: attempt.template.instructions,
      taskBrief: attempt.template.taskBrief,
      evaluationFocus: Array.isArray((attempt.template.evaluationPlan as { focus?: unknown } | null)?.focus)
        ? ((attempt.template.evaluationPlan as { focus?: string[] }).focus ?? [])
        : [],
      requiredEvidence: Array.isArray((attempt.template.evaluationPlan as { requiredEvidence?: unknown } | null)?.requiredEvidence)
        ? ((attempt.template.evaluationPlan as { requiredEvidence?: string[] }).requiredEvidence ?? [])
        : [],
      assessmentMode: (attempt.template.evaluationPlan as { assessmentMode?: string } | null)?.assessmentMode
    }
  };

  // Try the warm pool first. Returns null when the pool is disabled,
  // empty, or the attach step failed — in which case we fall back to
  // cold provisioning. This means a broken pool never blocks an
  // attempt; the worst case is the existing slow path.
  const poolHandle = await tryProvisionFromPool({
    attemptId,
    templateId: attempt.templateId,
    // attempt.invitationId is non-null per schema — pass it so the
    // pool prefers the sandbox pre-warmed at invite-send time over
    // generic template-pool entries.
    invitationId: attempt.invitationId,
    warmInput: { ...provisionInput, warmExternalId: "" }
  }).catch(() => null);
  const handle = poolHandle ?? (await getWorkspaceProvider().provisionWorkspace(provisionInput));

  await db.workspace.upsert({
    where: { attemptId },
    update: {
      provider: handle.provider,
      externalId: handle.externalId,
      accessUrl: handle.accessUrl,
      opencodeUser: handle.opencodeUser,
      opencodePass: handle.opencodePass,
      status: "running",
      expiresAt: handle.expiresAt,
      metadata: handle.metadata as Prisma.InputJsonValue | undefined
    },
    create: {
      attemptId,
      provider: handle.provider,
      externalId: handle.externalId,
      accessUrl: handle.accessUrl,
      opencodeUser: handle.opencodeUser,
      opencodePass: handle.opencodePass,
      status: "running",
      expiresAt: handle.expiresAt,
      metadata: handle.metadata as Prisma.InputJsonValue | undefined
    }
  });

  await db.attempt.update({
    where: { id: attemptId },
    data: { status: "in_progress", startedAt: attempt.startedAt ?? new Date(), dueAt: handle.expiresAt }
  });

  await logAttemptEvent(attemptId, "workspace.ready", "Workspace is ready", {
    provider: handle.provider,
    externalId: handle.externalId,
    mode: "inline",
    primarySurface: handle.metadata?.opencodePrimarySurface,
    terminalService: handle.metadata?.terminalService,
    provisioningTimings: handle.metadata?.provisioningTimings
  });

  scheduleAttemptTimeoutInline(attemptId, handle.expiresAt);
}

export async function evaluateAttemptInline(attemptId: string) {
  await db.attempt.update({ where: { id: attemptId }, data: { status: "evaluating" } });

  const attempt = await db.attempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: { candidate: true, workspace: true, template: true, events: { orderBy: { createdAt: "asc" } }, artifacts: true }
  });

  const workspaceExternalId = attempt.workspace?.externalId;
  const shouldCollectFromWorkspace = Boolean(workspaceExternalId && !["destroyed", "failed"].includes(attempt.workspace?.status ?? ""));
  const collectedArtifacts = shouldCollectFromWorkspace
    ? await getWorkspaceProvider().collectArtifacts(workspaceExternalId!, attemptId)
    : reusableEvidenceArtifacts(attempt.artifacts);
  const promptQualitySignals = promptQualitySignalsFromArtifacts(collectedArtifacts);
  const liveInterviewSignals = liveInterviewSignalsFromEvents(attempt.events);
  const generatedArtifacts = [
    ...(liveInterviewSignals.enabled
      ? [
          {
            kind: "command_log" as const,
            label: "Live interview transcript",
            uri: `inline://${attemptId}/live-interview-transcript`,
            metadata: {
              exitCode: 0,
              stdout: liveInterviewSignals.transcript,
              ...liveInterviewSignals
            }
          }
        ]
      : []),
    {
      kind: "command_log" as const,
      label: "Prompt quality analysis",
      uri: `inline://${attemptId}/prompt-quality`,
      metadata: {
        exitCode: 0,
        stdout: promptQualitySignals.summary,
        ...promptQualitySignals
      }
    }
  ];
  const artifacts = [
    ...collectedArtifacts,
    ...generatedArtifacts
  ];

  const artifactsToPersist = shouldCollectFromWorkspace ? artifacts : generatedArtifacts;
  if (artifactsToPersist.length > 0) {
    // Stream each artifact's text payload to R2 before persistence
    // so we don't store multi-MB stdouts inline in Postgres. The
    // helper is a no-op when R2 isn't configured (local dev),
    // preserving the legacy inline:// shape.
    const stored = await persistArtifactPayloadsToR2({ attemptId, artifacts: artifactsToPersist });
    await db.artifact.createMany({
      data: stored.map((artifact) => ({
        attemptId,
        kind: artifact.kind,
        label: artifact.label,
        uri: artifact.uri,
        metadata: sanitizeJsonForPostgres(artifact.metadata) as Prisma.InputJsonValue | undefined
      })) as Prisma.ArtifactCreateManyInput[]
    });
  }

  if (attempt.workspace?.externalId && !["destroyed", "failed"].includes(attempt.workspace.status)) {
    const provider = getWorkspaceProvider();
    await provider.stopWorkspace(attempt.workspace.externalId);
    await provider.destroyWorkspace(attempt.workspace.externalId);
    await db.workspace.update({ where: { id: attempt.workspace.id }, data: { status: "destroyed" } });
  }

  // Mark the pool entry (if this attempt was served from the pool)
  // for the reaper to clean up. We already destroyed the sandbox
  // above, so the row just needs to leave the assigned state. No-op
  // when the attempt came from the cold path.
  await recyclePoolEntryForAttempt(attemptId).catch(() => undefined);

  const testArtifact = artifacts.find((artifact) => artifact.kind === "test_output");
  const hiddenTestArtifact = artifacts.find((artifact) => artifact.label === "Hidden test output");
  const testExitCode = artifactExitCode(testArtifact);
  const hiddenTestExitCode = artifactExitCode(hiddenTestArtifact);
  const workLoopSignals = workLoopSignalsFromArtifacts(artifacts);
  const hasDiff = artifactHasOutput(artifacts.find((artifact) => artifact.kind === "git_diff"));
  const hasOpenCodeLog = artifacts.some((artifact) => artifact.kind === "opencode_log" && artifactHasOutput(artifact));
  const finalNotesFile = artifactText(artifacts.find((artifact) => artifact.label === "Final notes file"));
  const finalNotesForScoring = attempt.finalNotes || (/FINAL_NOTES\.md found/i.test(finalNotesFile) ? finalNotesFile : attempt.finalNotes);
  const scoreSignals = {
    visiblePassed: testExitCode === 0,
    hiddenPassed: hiddenTestExitCode === 0,
    hasDiff,
    hasOpenCodeLog,
    ...workLoopSignals,
    promptQualityScore: promptQualitySignals.qualityScore,
    promptCount: promptQualitySignals.promptCount,
    interviewQualityScore: liveInterviewSignals.qualityScore,
    finalNotes: finalNotesForScoring,
    assessmentLevel: `${attempt.template.level} ${attempt.template.roleTitle}`,
    minimumMeaningfulCommits: minimumMeaningfulCommits(attempt.template.evaluationPlan)
  };
  const heuristicScores = scoreAttemptFromSignals(scoreSignals);
  const scoringWeights = parseRubricWeights(attempt.template.scoringWeights);
  const evaluator = await evaluateAttemptWithGpt({
    attemptId,
    candidate: { name: attempt.candidate.name, email: attempt.candidate.email },
    assessment: {
      title: attempt.template.title,
      roleTitle: attempt.template.roleTitle,
      level: attempt.template.level,
      taskBrief: attempt.template.taskBrief,
      instructions: attempt.template.instructions,
      evaluationPlan: attempt.template.evaluationPlan
    },
    artifacts,
    events: attempt.events,
    signals: scoreSignals,
    heuristicScores,
    scoringWeights
  });
  const scores = evaluator.scores;
  const summary = evaluator.summary;

  await db.evalRun.create({
    data: {
      attemptId,
      status: "completed",
      visibleTests: { collected: Boolean(testArtifact), passed: testExitCode === 0, exitCode: testExitCode },
      hiddenTests: { collected: Boolean(hiddenTestArtifact), passed: hiddenTestExitCode === 0, exitCode: hiddenTestExitCode },
      llmRubric: {
        evaluator: {
          source: evaluator.source,
          model: evaluator.model,
          recommendation: evaluator.recommendation,
          strengths: evaluator.strengths,
          concerns: evaluator.concerns,
          evidenceCitations: evaluator.evidenceCitations,
          cap: evaluator.cap,
          heuristicScores
        },
        ...scores,
        workLoopSignals,
        promptQualitySignals,
        liveInterviewSignals
      },
      summary
    }
  });

  await db.scorecard.upsert({
    where: { attemptId },
    update: { ...scores, automatedSummary: summary },
    create: { attemptId, ...scores, automatedSummary: summary }
  });

  await db.attempt.update({ where: { id: attemptId }, data: { status: "reviewed" } });
  await logAttemptEvent(attemptId, "eval.completed", `Inline evaluation completed with ${evaluator.source}`, {
    model: evaluator.model,
    recommendation: evaluator.recommendation,
    aggregate: weightedOverallScore(scores, scoringWeights),
    scoringWeights,
    cap: evaluator.cap
  });
  await logAttemptEvent(attemptId, "eval.prompt_quality", promptQualitySignals.summary, promptQualitySignals);
  if (liveInterviewSignals.enabled) {
    await logAttemptEvent(attemptId, "eval.live_interview", liveInterviewSignals.summary, liveInterviewSignals);
  }
  await sendCandidateReportEmail(attemptId);
}
