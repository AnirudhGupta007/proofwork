import { defaultRubric, normalizeScores, type ScoreDimensions } from "../domain/score.ts";
import { parseRubricWeights, weightedOverallScore, type RubricWeights } from "../domain/rubric.ts";

type EvalSignal = {
  visiblePassed?: boolean;
  hiddenPassed?: boolean;
  hasDiff?: boolean;
  hasOpenCodeLog?: boolean;
  hasPlan?: boolean;
  commitCount?: number;
  hasCommitEvalLog?: boolean;
  promptQualityScore?: number;
  promptCount?: number;
  interviewQualityScore?: number;
  finalNotes?: string | null;
  assessmentLevel?: string | null;
  minimumMeaningfulCommits?: number;
};

const scoreKeys: Array<keyof ScoreDimensions> = [
  "requirements",
  "testAndEvalQuality",
  "debuggingDiscipline",
  "codeQuality",
  "aiCollaboration",
  "productionReadiness",
  "communication"
];

type EvidenceArtifact = {
  kind: string;
  label: string;
  metadata?: unknown;
};

function artifactOutput(artifact?: EvidenceArtifact) {
  if (!artifact?.metadata || typeof artifact.metadata !== "object") return "";
  const record = artifact.metadata as { stdout?: unknown; stderr?: unknown };
  return String(record.stdout ?? record.stderr ?? "");
}

function redactedOutput(value: string) {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED_API_KEY]")
    .replace(/dtn_[A-Za-z0-9_-]{12,}/g, "[REDACTED_DAYTONA_KEY]")
    .replace(/re_[A-Za-z0-9_-]{12,}/g, "[REDACTED_RESEND_KEY]");
}

export function workLoopSignalsFromArtifacts(artifacts: EvidenceArtifact[]) {
  const planOutput = artifactOutput(artifacts.find((artifact) => artifact.label === "Plan evidence"));
  const commitHistoryOutput = artifactOutput(artifacts.find((artifact) => artifact.label === "Commit history"));
  const commitEvalOutput = artifactOutput(artifacts.find((artifact) => artifact.label === "Commit checkpoint evals"));
  const commitCount = commitHistoryOutput
    .split(/\r?\n/)
    .filter((line) => /^commit=/.test(line) && !/subject=initial task baseline\b/i.test(line)).length;

  return {
    hasPlan: /PLAN\.md found/i.test(planOutput),
    commitCount,
    hasCommitEvalLog: /=== commit /i.test(commitEvalOutput)
  };
}

function countPromptMarkers(output: string) {
  const markers = [
    /(?:^|\n)\s*(?:user|human|candidate)\s*[:>]/gi,
    /"role"\s*:\s*"user"/gi,
    /(?:^|\n)#+\s*(?:user|human|candidate)\b/gi,
    /args=\["run","--model","[^"]+","/gi
  ];
  const count = markers.reduce((total, pattern) => total + (output.match(pattern) ?? []).length, 0);
  return count || Math.min(8, Math.max(0, (output.match(/\?\s*(?:\n|$)/g) ?? []).length));
}

export function promptQualitySignalsFromArtifacts(artifacts: EvidenceArtifact[]) {
  const openCodeOutputs = artifacts
    .filter((artifact) => artifact.kind === "opencode_log" || /opencode|prompt|session/i.test(artifact.label))
    .map((artifact) => artifactOutput(artifact))
    .filter(Boolean);
  const output = redactedOutput(openCodeOutputs.join("\n"));
  const lower = output.toLowerCase();
  const promptCount = countPromptMarkers(output);
  const promptCharCount = output.length;
  const hasPlanningPrompt = /\b(plan|approach|milestone|break down|first inspect|strategy|assumption)\b/i.test(output);
  const hasContextPrompt = /\b(file|codebase|test output|error|stack trace|requirement|acceptance|existing behavior|logs?)\b/i.test(output);
  const hasVerificationPrompt = /\b(test|eval|verify|browser|screenshot|build|lint|typecheck|regression)\b/i.test(output);
  const hasIterationPrompt = /\b(failing|failed|fix|try again|re-run|rerun|result|diff|commit|next checkpoint|tradeoff)\b/i.test(output);
  const hasRiskPrompt = /\b(edge case|risk|security|privacy|performance|accessibility|rollback|production)\b/i.test(output);
  const oneShotPromptRisk = promptCount <= 1 && promptCharCount > 1200;
  const emptyPromptEvidence = promptCharCount < 120;
  const rawQualityScore = emptyPromptEvidence
    ? 0
    : Math.max(
        1,
        Math.min(
          5,
          1 +
            Number(promptCount >= 3) +
            Number(hasPlanningPrompt) +
            Number(hasContextPrompt) +
            Number(hasVerificationPrompt) +
            Number(hasIterationPrompt || hasRiskPrompt) -
            Number(oneShotPromptRisk)
        )
      );
  const qualityScore = promptCount <= 1 ? Math.min(rawQualityScore, 2) : promptCount === 2 ? Math.min(rawQualityScore, 3) : rawQualityScore;

  const strengths = [
    hasPlanningPrompt ? "planning" : null,
    hasContextPrompt ? "context sharing" : null,
    hasVerificationPrompt ? "verification requests" : null,
    hasIterationPrompt ? "iteration" : null,
    hasRiskPrompt ? "risk awareness" : null
  ].filter((item): item is string => Boolean(item));

  const concerns = [
    emptyPromptEvidence ? "no usable prompt transcript captured" : null,
    oneShotPromptRisk ? "large one-shot prompt with little iteration evidence" : null,
    !hasVerificationPrompt && !emptyPromptEvidence ? "limited verification prompting" : null,
    !hasContextPrompt && !emptyPromptEvidence ? "limited codebase/test context in prompts" : null
  ].filter((item): item is string => Boolean(item));

  return {
    promptCount,
    promptCharCount,
    qualityScore,
    hasPlanningPrompt,
    hasContextPrompt,
    hasVerificationPrompt,
    hasIterationPrompt,
    hasRiskPrompt,
    oneShotPromptRisk,
    strengths,
    concerns,
    summary:
      qualityScore >= 4
        ? `Strong prompting signal: ${strengths.join(", ")}.`
        : qualityScore >= 2
          ? `Mixed prompting signal: ${strengths.join(", ") || "some AI use evidence"}; concerns: ${concerns.join(", ") || "needs reviewer inspection"}.`
          : `Weak prompting signal: ${concerns.join(", ") || "insufficient prompt evidence"}.`
  };
}

type InterviewEvent = {
  type: string;
  message: string;
  metadata?: unknown;
  createdAt?: Date | string;
};

export function liveInterviewSignalsFromEvents(events: InterviewEvent[]) {
  const interviewEvents = events.filter((event) => event.type.startsWith("interview."));
  const transcriptEvents = interviewEvents.filter((event) => event.type !== "interview.feedback");
  const feedbackEvent = interviewEvents.find((event) => event.type === "interview.feedback");
  const feedbackMetadata =
    feedbackEvent?.metadata && typeof feedbackEvent.metadata === "object" ? (feedbackEvent.metadata as Record<string, unknown>) : null;
  const transcript = transcriptEvents
    .map((event) => {
      const metadata = event.metadata && typeof event.metadata === "object" ? (event.metadata as Record<string, unknown>) : {};
      const speaker = typeof metadata.speaker === "string" ? metadata.speaker : "speaker";
      const text = typeof metadata.text === "string" ? metadata.text : event.message;
      return `${speaker}: ${text}`;
    })
    .join("\n");
  const lower = transcript.toLowerCase();
  const candidateTurns = (transcript.match(/^candidate\s*:/gim) ?? []).length;
  const interviewerTurns = (transcript.match(/^interviewer\s*:/gim) ?? []).length;
  const hasClarifyingQuestions = /\b(clarify|question|assumption|do you mean|should i|constraint|priority)\b/i.test(transcript);
  const hasTechnicalExplanation = /\b(because|tradeoff|approach|architecture|state|api|test|eval|edge case|risk)\b/i.test(transcript);
  const respondsToGuidance = /\b(hint|guidance|feedback|follow-up|change direction|based on that|i will adjust)\b/i.test(transcript);
  const hasVerificationNarration = /\b(run|verify|test|eval|browser|build|typecheck|checked|confirmed)\b/i.test(transcript);
  const hasTranscript = transcript.trim().length > 0;
  const feedbackCommunication = typeof feedbackMetadata?.communication === "number" ? feedbackMetadata.communication : null;
  const transcriptQualityScore = hasTranscript
    ? Math.max(
        1,
        Math.min(
          5,
          1 +
            Number(candidateTurns >= 3) +
            Number(interviewerTurns >= 1) +
            Number(hasClarifyingQuestions) +
            Number(hasTechnicalExplanation) +
            Number(respondsToGuidance || hasVerificationNarration)
        )
      )
    : 0;
  const qualityScore = feedbackCommunication ? Math.max(transcriptQualityScore, feedbackCommunication) : transcriptQualityScore;

  const strengths = [
    feedbackMetadata ? "structured interviewer feedback" : null,
    hasClarifyingQuestions ? "clarifying questions" : null,
    hasTechnicalExplanation ? "technical explanation" : null,
    respondsToGuidance ? "response to guidance" : null,
    hasVerificationNarration ? "verification narration" : null
  ].filter((item): item is string => Boolean(item));

  const concerns = [
    !hasTranscript && !feedbackMetadata ? "no live interview transcript captured" : null,
    hasTranscript && candidateTurns < 2 ? "limited candidate discussion turns" : null,
    hasTranscript && !hasClarifyingQuestions ? "few clarifying questions" : null,
    hasTranscript && !hasTechnicalExplanation ? "limited technical explanation" : null
  ].filter((item): item is string => Boolean(item));

  return {
    enabled: hasTranscript || Boolean(feedbackMetadata),
    transcript,
    eventCount: interviewEvents.length,
    candidateTurns,
    interviewerTurns,
    qualityScore,
    hasClarifyingQuestions,
    hasTechnicalExplanation,
    respondsToGuidance,
    hasVerificationNarration,
    strengths,
    concerns,
    summary:
      qualityScore >= 4
        ? `Strong live interview signal: ${strengths.join(", ")}.`
        : qualityScore >= 2
          ? `Mixed live interview signal: ${strengths.join(", ") || "some discussion evidence"}; concerns: ${concerns.join(", ") || "needs reviewer inspection"}.`
          : `Weak live interview signal: ${concerns.join(", ") || "insufficient transcript evidence"}.`
  };
}

export function scoreAttemptFromSignals(signals: EvalSignal): ScoreDimensions {
  const commitCount = signals.commitCount ?? 0;
  const level = seniorityBar(signals.assessmentLevel);
  const expectedCommits = signals.minimumMeaningfulCommits ?? level.expectedCommits;
  const hasCandidateWork = Boolean(signals.hasDiff || commitCount > 0 || signals.hasCommitEvalLog);
  const visiblePassed = Boolean(signals.visiblePassed && hasCandidateWork);
  const hiddenPassed = Boolean(signals.hiddenPassed && hasCandidateWork);
  const hasWorkLoop = Boolean(signals.hasPlan && commitCount >= 3 && signals.hasCommitEvalLog);
  const oneShotRisk = Boolean(signals.hasDiff && (!signals.hasPlan || commitCount <= 1));
  const promptQualityScore = signals.promptQualityScore ?? (signals.hasOpenCodeLog ? 3 : 2);
  const promptPenalty = promptQualityScore <= 1 || (signals.promptCount ?? 0) <= 1;
  const interviewCommunication = signals.interviewQualityScore && signals.interviewQualityScore > 0 ? signals.interviewQualityScore : 0;
  const meetsLevelWorkLoop = hasWorkLoop && commitCount >= expectedCommits;
  const aiCollaboration = signals.hasOpenCodeLog
    ? Math.max(1, Math.min(5, Math.round((promptQualityScore + (meetsLevelWorkLoop ? 4 : oneShotRisk ? 1 : 3)) / 2)))
    : 2;
  const strongPrompting = promptQualityScore >= 4 && (signals.promptCount ?? 0) >= 3;
  const strongWorkLoop = hasWorkLoop && commitCount >= expectedCommits;
  const excellentWorkLoop = hasWorkLoop && commitCount >= level.excellentCommits && strongPrompting;
  const belowLevelBar = hasWorkLoop && commitCount < expectedCommits;

  return {
    requirements: hiddenPassed && visiblePassed ? 5 : hiddenPassed ? 4 : visiblePassed ? 3 : 1,
    testAndEvalQuality:
      hiddenPassed && visiblePassed && signals.hasCommitEvalLog
        ? 5
        : visiblePassed && signals.hasCommitEvalLog
          ? 4
          : visiblePassed
            ? 3
            : 1,
    debuggingDiscipline: excellentWorkLoop
      ? 5
      : belowLevelBar
        ? 3
        : hasWorkLoop && !promptPenalty
          ? 4
          : oneShotRisk
            ? 1
            : signals.hasOpenCodeLog
              ? 3
              : 2,
    codeQuality: hiddenPassed && strongWorkLoop ? 5 : signals.hasDiff && !oneShotRisk ? 4 : signals.hasDiff ? 2 : 1,
    aiCollaboration: oneShotRisk && promptQualityScore <= 2 ? 1 : belowLevelBar ? Math.min(4, aiCollaboration) : aiCollaboration,
    productionReadiness: hiddenPassed && excellentWorkLoop
      ? 5
      : hiddenPassed && strongWorkLoop
        ? 4
        : hiddenPassed && hasWorkLoop
          ? 3
          : hiddenPassed
            ? 3
            : hasCandidateWork
              ? 2
              : 1,
    communication: Math.max(signals.finalNotes && signals.finalNotes.length > 40 ? 4 : 2, interviewCommunication)
  };
}

export function scoreCapFromSignals(signals: EvalSignal) {
  const level = seniorityBar(signals.assessmentLevel);
  const expectedCommits = signals.minimumMeaningfulCommits ?? level.expectedCommits;
  const commitCount = signals.commitCount ?? 0;
  const hasCandidateWork = Boolean(signals.hasDiff || commitCount > 0 || signals.hasCommitEvalLog);
  const oneShotRisk = Boolean(signals.hasDiff && (!signals.hasPlan || commitCount <= 1));
  const caps: Array<{ maxScore: number; reason: string }> = [];

  if (!hasCandidateWork) caps.push({ maxScore: 35, reason: "No candidate work evidence was captured." });
  if (!signals.hasDiff) caps.push({ maxScore: 45, reason: "No meaningful git diff was captured." });
  if (!signals.visiblePassed) caps.push({ maxScore: 60, reason: "Visible tests did not pass or were not collected." });
  if (!signals.hiddenPassed) caps.push({ maxScore: 75, reason: "Hidden evals did not pass or were not collected." });
  if (!signals.hasPlan) caps.push({ maxScore: 70, reason: "PLAN.md evidence was missing." });
  if (commitCount <= 1 && signals.hasDiff) caps.push({ maxScore: 60, reason: "One-shot or near one-shot submission based on commit history." });
  if (commitCount > 1 && commitCount < expectedCommits) {
    caps.push({ maxScore: 78, reason: `${level.label} bar expects ${expectedCommits}+ meaningful commits.` });
  }
  if (!signals.hasCommitEvalLog) caps.push({ maxScore: 80, reason: "Commit checkpoint eval evidence was missing." });
  if ((signals.promptCount ?? 0) <= 1 || (signals.promptQualityScore ?? 0) <= 1) {
    caps.push({ maxScore: 68, reason: "Prompt/agent collaboration evidence was weak or missing." });
  }
  if (!signals.finalNotes || signals.finalNotes.length < 40) {
    caps.push({ maxScore: 82, reason: "Final communication notes were missing or too thin." });
  }
  if (oneShotRisk) caps.push({ maxScore: 60, reason: "Submission looks like a large unverified one-shot diff." });

  const strongestCap = caps.reduce<{ maxScore: number; reasons: string[] }>(
    (current, cap) =>
      cap.maxScore < current.maxScore
        ? { maxScore: cap.maxScore, reasons: [cap.reason] }
        : cap.maxScore === current.maxScore
          ? { maxScore: current.maxScore, reasons: [...current.reasons, cap.reason] }
          : current,
    { maxScore: 100, reasons: [] }
  );

  return {
    maxScore: strongestCap.maxScore,
    reasons: caps.map((cap) => cap.reason),
    bindingReasons: strongestCap.reasons
  };
}

export function applyScoreCaps(scores: ScoreDimensions, signals: EvalSignal, weights?: RubricWeights | null) {
  const cap = scoreCapFromSignals(signals);
  const capped = normalizeScores(scores);
  const rubric = parseRubricWeights(weights ?? null);
  let safety = 100;

  // Caps apply to the (possibly weighted) overall score. With custom weights,
  // only dimensions that carry weight can lower the total, so skip zero-weight ones.
  while (weightedOverallScore(capped, rubric) > cap.maxScore && safety > 0) {
    const key = scoreKeys
      .filter((candidate) => capped[candidate] > 0 && (!rubric || rubric[candidate] > 0))
      .sort((a, b) => capped[b] - capped[a] || (rubric ? rubric[b] - rubric[a] : 0))[0];
    if (!key) break;
    capped[key] -= 1;
    safety -= 1;
  }

  return { scores: capped, cap };
}

function seniorityBar(level?: string | null) {
  const normalized = (level ?? "").toLowerCase();
  if (/\b(product\s*manager|program\s*manager|tpm|pm\b|product\s*lead|product\s*owner)\b/.test(normalized)) {
    return { label: "product/program", expectedCommits: 4, excellentCommits: 5 };
  }
  if (/\b(senior|staff|principal|lead)\b/.test(normalized)) {
    return { label: "senior", expectedCommits: 5, excellentCommits: 6 };
  }
  if (/\b(sde\s*2|sde2|mid|middle|l2|level\s*2)\b/.test(normalized)) {
    return { label: "sde2", expectedCommits: 4, excellentCommits: 5 };
  }
  return { label: "sde1", expectedCommits: 3, excellentCommits: 4 };
}

export function summarizeScore(
  scores: ScoreDimensions,
  context: string,
  signals?: EvalSignal,
  weights?: RubricWeights | null
) {
  const total = weightedOverallScore(scores, weights);
  const level = seniorityBar(signals?.assessmentLevel);
  const expectedCommits = signals?.minimumMeaningfulCommits ?? level.expectedCommits;
  const cap = signals ? scoreCapFromSignals(signals) : null;
  const workLoop = signals
    ? ` Work-loop evidence: ${signals.hasPlan ? "PLAN.md found" : "PLAN.md missing"}, ${signals.commitCount ?? 0} commits, ${
        signals.hasCommitEvalLog ? "commit evals captured" : "commit evals missing"
      }. Level bar: ${level.label} expects ${expectedCommits}+ meaningful commits for a strong process signal.`
    : "";
  const prompting = signals?.promptQualityScore !== undefined
    ? ` Prompt quality: ${signals.promptQualityScore}/5 across ${signals.promptCount ?? 0} captured prompt marker(s).`
    : "";
  const interview = signals?.interviewQualityScore !== undefined && signals.interviewQualityScore > 0
    ? ` Live interview communication: ${signals.interviewQualityScore}/5.`
    : "";
  const capSummary = cap && cap.maxScore < 100 ? ` Evidence cap: max ${cap.maxScore}/100 because ${cap.bindingReasons.join("; ")}.` : "";
  return `Automated assessment score: ${total}/100.${workLoop}${prompting}${interview}${capSummary} ${context}`;
}

export function emptyScorecardSummary() {
  return summarizeScore(defaultRubric, "No evaluation evidence was available.");
}
