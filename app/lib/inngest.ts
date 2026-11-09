import { Inngest } from "inngest";
import type { Prisma } from "@prisma/client";
import { persistArtifactPayloadsToR2 } from "@/app/lib/artifacts";
import { db } from "@/app/lib/db";
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
import { getWorkspaceProvider } from "@/app/lib/workspaces/provider";

export const inngest = new Inngest({ id: "proofwork-assessments" });

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

export const provisionWorkspace = inngest.createFunction(
  { id: "provision-workspace" },
  { event: "attempt/workspace.provision" },
  async ({ event, step }) => {
    const attemptId = event.data.attemptId as string;

    const attempt = await step.run("load-attempt", () =>
      db.attempt.findUniqueOrThrow({
        where: { id: attemptId },
        include: { candidate: true, template: true }
      })
    );

    await step.run("mark-provisioning", () =>
      db.attempt.update({ where: { id: attemptId }, data: { status: "workspace_provisioning" } })
    );

    const handle = await step.run("create-devbox", () =>
      getWorkspaceProvider().provisionWorkspace({
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
      })
    );

    await step.run("persist-workspace", async () => {
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
        data: {
          status: "in_progress",
          startedAt: attempt.startedAt ?? new Date(),
          dueAt: handle.expiresAt
        }
      });

      await logAttemptEvent(attemptId, "workspace.ready", "Workspace is ready", {
        provider: handle.provider,
        externalId: handle.externalId,
        primarySurface: handle.metadata?.opencodePrimarySurface,
        terminalService: handle.metadata?.terminalService,
        provisioningTimings: handle.metadata?.provisioningTimings
      });
    });

    await step.sendEvent("schedule-timeout", {
      name: "attempt/timeout.schedule",
      data: { attemptId }
    });

    return { attemptId, accessUrl: handle.accessUrl };
  }
);

export const scheduleTimeout = inngest.createFunction(
  { id: "enforce-attempt-timeout" },
  { event: "attempt/timeout.schedule" },
  async ({ event, step }) => {
    const attemptId = event.data.attemptId as string;
    const attempt = await step.run("load-attempt", () => db.attempt.findUniqueOrThrow({ where: { id: attemptId } }));
    if (!attempt.dueAt) return { skipped: "missing dueAt" };

    await step.sleepUntil("sleep-until-due", attempt.dueAt);

    const fresh = await step.run("reload-attempt", () => db.attempt.findUniqueOrThrow({ where: { id: attemptId } }));
    if (fresh.status !== "in_progress") return { skipped: fresh.status };

    await step.run("mark-timed-out", () =>
      db.attempt.update({
        where: { id: attemptId },
        data: { status: "timed_out", timedOutAt: new Date() }
      })
    );

    await step.sendEvent("evaluate-timeout", {
      name: "attempt/evaluate",
      data: { attemptId, reason: "timeout" }
    });

    return { attemptId, timedOut: true };
  }
);

export const evaluateAttempt = inngest.createFunction(
  { id: "evaluate-attempt" },
  { event: "attempt/evaluate" },
  async ({ event, step }) => {
    const attemptId = event.data.attemptId as string;

    await step.run("mark-evaluating", () =>
      db.attempt.update({ where: { id: attemptId }, data: { status: "evaluating" } })
    );

    const attempt = await step.run("load-workspace", () =>
      db.attempt.findUniqueOrThrow({
        where: { id: attemptId },
        include: { candidate: true, workspace: true, template: true, events: { orderBy: { createdAt: "asc" } }, artifacts: true }
      })
    );

    const workspaceExternalId = attempt.workspace?.externalId;
    const shouldCollectFromWorkspace = Boolean(workspaceExternalId && !["destroyed", "failed"].includes(attempt.workspace?.status ?? ""));
    const collectedArtifacts = await step.run("collect-artifacts", async () => {
      if (!shouldCollectFromWorkspace) {
        return reusableEvidenceArtifacts(attempt.artifacts);
      }
      return getWorkspaceProvider().collectArtifacts(workspaceExternalId!, attemptId);
    });
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
    await step.run("persist-artifacts", async () => {
      // Stream each artifact's text payload to R2 before persistence;
      // helper falls back to inline storage when R2 isn't configured.
      const stored = await persistArtifactPayloadsToR2({ attemptId, artifacts: artifactsToPersist });
      return db.artifact.createMany({
        data: stored.map((artifact) => ({
          attemptId,
          kind: artifact.kind,
          label: artifact.label,
          uri: artifact.uri,
          metadata: sanitizeJsonForPostgres(artifact.metadata) as Prisma.InputJsonValue | undefined
        })) as Prisma.ArtifactCreateManyInput[]
      });
    });

    await step.run("stop-workspace", async () => {
      if (!attempt.workspace?.externalId) return;
      if (["destroyed", "failed"].includes(attempt.workspace.status)) return;
      const provider = getWorkspaceProvider();
      await provider.stopWorkspace(attempt.workspace.externalId);
      await provider.destroyWorkspace(attempt.workspace.externalId);
      await db.workspace.update({ where: { id: attempt.workspace.id }, data: { status: "destroyed" } });
    });

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
    const evaluator = await step.run("gpt-5.5-evaluator", () =>
      evaluateAttemptWithGpt({
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
        heuristicScores
      })
    );
    const scores = evaluator.scores;
    const summary = evaluator.summary;

    await step.run("persist-eval-and-scorecard", async () => {
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
        create: {
          attemptId,
          ...scores,
          automatedSummary: summary
        }
      });

      await db.attempt.update({ where: { id: attemptId }, data: { status: "reviewed" } });
      await logAttemptEvent(attemptId, "eval.completed", `Automated evaluation completed with ${evaluator.source}`, {
        model: evaluator.model,
        recommendation: evaluator.recommendation,
        cap: evaluator.cap
      });
      await logAttemptEvent(attemptId, "eval.prompt_quality", promptQualitySignals.summary, promptQualitySignals);
      if (liveInterviewSignals.enabled) {
        await logAttemptEvent(attemptId, "eval.live_interview", liveInterviewSignals.summary, liveInterviewSignals);
      }
    });

    await step.run("email-candidate-report", () => sendCandidateReportEmail(attemptId));

    return { attemptId, artifactCount: artifacts.length };
  }
);

export const cleanupExpiredWorkspaces = inngest.createFunction(
  { id: "cleanup-expired-workspaces" },
  { cron: "0 * * * *" },
  async ({ step }) => {
    const expired = await step.run("load-expired", () =>
      db.workspace.findMany({
        where: {
          expiresAt: { lt: new Date() },
          status: { in: ["running", "provisioning"] }
        }
      })
    );

    for (const workspace of expired) {
      await step.run(`destroy-${workspace.id}`, async () => {
        if (workspace.externalId) {
          await getWorkspaceProvider().destroyWorkspace(workspace.externalId);
        }
        await db.workspace.update({ where: { id: workspace.id }, data: { status: "destroyed" } });
      });
    }

    return { cleaned: expired.length };
  }
);

export const functions = [provisionWorkspace, scheduleTimeout, evaluateAttempt, cleanupExpiredWorkspaces];
