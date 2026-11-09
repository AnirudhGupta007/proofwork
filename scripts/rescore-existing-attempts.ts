import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";

async function loadDotEnv() {
  const content = await readFile(path.join(process.cwd(), ".env"), "utf8").catch(() => "");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index);
    let value = trimmed.slice(index + 1);
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[key] ??= value;
  }
}

function artifactText(artifact?: { metadata?: unknown }) {
  if (!artifact?.metadata || typeof artifact.metadata !== "object") return "";
  const record = artifact.metadata as { stdout?: unknown; stderr?: unknown };
  return String(record.stdout ?? record.stderr ?? "");
}

function latestArtifacts<T extends { label: string; kind: string }>(artifacts: T[]) {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    const key = `${artifact.kind}:${artifact.label}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

const attemptIds = process.argv.slice(2);
if (attemptIds.length === 0) throw new Error("Usage: npx tsx scripts/rescore-existing-attempts.ts <attemptId...>");

await loadDotEnv();

const { db } = await import("../app/lib/db.ts");
const {
  liveInterviewSignalsFromEvents,
  promptQualitySignalsFromArtifacts,
  scoreAttemptFromSignals,
  summarizeScore,
  workLoopSignalsFromArtifacts
} = await import("../app/lib/evals/scorer.ts");
const { aggregateScore } = await import("../app/lib/domain/score.ts");

for (const attemptId of attemptIds) {
  const attempt = await db.attempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: {
      candidate: true,
      template: true,
      events: { orderBy: { createdAt: "asc" } },
      artifacts: { orderBy: { createdAt: "desc" } }
    }
  });
  const artifacts = latestArtifacts(attempt.artifacts);
  const promptQualitySignals = promptQualitySignalsFromArtifacts(artifacts);
  const liveInterviewSignals = liveInterviewSignalsFromEvents(attempt.events);
  const testArtifact = artifacts.find((artifact) => artifact.kind === "test_output");
  const hiddenTestArtifact = artifacts.find((artifact) => artifact.label === "Hidden test output");
  const testExitCode =
    testArtifact?.metadata && typeof testArtifact.metadata === "object" && typeof (testArtifact.metadata as { exitCode?: unknown }).exitCode === "number"
      ? (testArtifact.metadata as { exitCode: number }).exitCode
      : undefined;
  const hiddenTestExitCode =
    hiddenTestArtifact?.metadata &&
    typeof hiddenTestArtifact.metadata === "object" &&
    typeof (hiddenTestArtifact.metadata as { exitCode?: unknown }).exitCode === "number"
      ? (hiddenTestArtifact.metadata as { exitCode: number }).exitCode
      : undefined;
  const workLoopSignals = workLoopSignalsFromArtifacts(artifacts);
  const finalNotesFile = artifactText(artifacts.find((artifact) => artifact.label === "Final notes file"));
  const finalNotesForScoring = attempt.finalNotes || (/FINAL_NOTES\.md found/i.test(finalNotesFile) ? finalNotesFile : attempt.finalNotes);
  const scoreSignals = {
    visiblePassed: testExitCode === 0,
    hiddenPassed: hiddenTestExitCode === 0,
    hasDiff: artifacts.some((artifact) => artifact.kind === "git_diff"),
    hasOpenCodeLog: artifacts.some((artifact) => artifact.kind === "opencode_log"),
    ...workLoopSignals,
    promptQualityScore: promptQualitySignals.qualityScore,
    promptCount: promptQualitySignals.promptCount,
    interviewQualityScore: liveInterviewSignals.qualityScore,
    finalNotes: finalNotesForScoring,
    assessmentLevel: attempt.template.level
  };
  const scores = scoreAttemptFromSignals(scoreSignals);
  const summary = summarizeScore(scores, "Rescored from existing artifacts after rubric update.", scoreSignals);

  await db.evalRun.create({
    data: {
      attemptId,
      status: "completed",
      visibleTests: { collected: Boolean(testArtifact), passed: testExitCode === 0, exitCode: testExitCode },
      hiddenTests: { collected: Boolean(hiddenTestArtifact), passed: hiddenTestExitCode === 0, exitCode: hiddenTestExitCode },
      llmRubric: { ...scores, workLoopSignals, promptQualitySignals, liveInterviewSignals, rescored: true },
      summary
    }
  });
  const scorecard = await db.scorecard.upsert({
    where: { attemptId },
    update: { ...scores, automatedSummary: summary },
    create: { attemptId, ...scores, automatedSummary: summary }
  });
  const score = scorecard.reviewerOverrideScore ?? aggregateScore(scores);
  console.log(JSON.stringify({ attemptId, candidate: attempt.candidate.name, level: attempt.template.level, score, scores, summary }));
}

await db.$disconnect();
