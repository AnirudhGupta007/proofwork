import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionAttempt, isTerminalAttemptStatus } from "../app/lib/domain/attempt-status.ts";
import { createInviteToken, hashInviteToken, isInviteExpired, verifyTokenHash } from "../app/lib/domain/invites.ts";
import { aggregateScore, clampScore, normalizeScores } from "../app/lib/domain/score.ts";
import { addMinutes, formatTimer, msUntil } from "../app/lib/domain/time.ts";
import { normalizedAssessmentRole } from "../app/lib/domain/role-detection.ts";
import {
  applyScoreCaps,
  liveInterviewSignalsFromEvents,
  promptQualitySignalsFromArtifacts,
  scoreAttemptFromSignals,
  summarizeScore,
  workLoopSignalsFromArtifacts
} from "../app/lib/evals/scorer.ts";
import { companyNameFromDomain, emailDomain, isCompanyEmail, slugifyCompanyName } from "../app/lib/company-email.ts";
import { generateAssessmentFromJd, generateAssessmentIdeasFromJd } from "../app/lib/assessment-generator.ts";
import { parseAvailabilityText } from "../app/lib/interviews/availability.ts";
import { sanitizeJsonForPostgres } from "../app/lib/json-sanitize.ts";

test("attempt status machine allows only expected forward transitions", () => {
  assert.equal(canTransitionAttempt("invited", "opened"), true);
  assert.equal(canTransitionAttempt("opened", "workspace_provisioning"), true);
  assert.equal(canTransitionAttempt("workspace_provisioning", "in_progress"), true);
  assert.equal(canTransitionAttempt("in_progress", "submitted"), true);
  assert.equal(canTransitionAttempt("submitted", "evaluating"), true);
  assert.equal(canTransitionAttempt("evaluating", "reviewed"), true);
  assert.equal(canTransitionAttempt("reviewed", "in_progress"), false);
  assert.equal(isTerminalAttemptStatus("reviewed"), true);
});

test("invite token hashing verifies without exposing raw token", () => {
  const token = createInviteToken();
  const hash = hashInviteToken(token);

  assert.equal(token.length > 32, true);
  assert.notEqual(token, hash);
  assert.equal(verifyTokenHash(token, hash), true);
  assert.equal(verifyTokenHash(`${token}x`, hash), false);
});

test("invite expiry uses exact boundary", () => {
  const now = new Date("2026-05-07T10:00:00.000Z");

  assert.equal(isInviteExpired(new Date("2026-05-07T09:59:59.999Z"), now), true);
  assert.equal(isInviteExpired(now, now), true);
  assert.equal(isInviteExpired(new Date("2026-05-07T10:00:00.001Z"), now), false);
});

test("score normalization clamps each dimension and aggregates to percent", () => {
  const normalized = normalizeScores({
    requirements: 7,
    testAndEvalQuality: -1,
    debuggingDiscipline: 3.2,
    codeQuality: 4.7,
    aiCollaboration: Number.NaN,
    productionReadiness: 5,
    communication: 2
  });

  assert.deepEqual(normalized, {
    requirements: 5,
    testAndEvalQuality: 0,
    debuggingDiscipline: 3,
    codeQuality: 5,
    aiCollaboration: 0,
    productionReadiness: 5,
    communication: 2
  });
  assert.equal(clampScore(2.6), 3);
  assert.equal(aggregateScore(normalized), 57);
});

test("assessment timer helpers are stable", () => {
  const now = new Date("2026-05-07T10:00:00.000Z");
  const due = addMinutes(now, 180);

  assert.equal(due.toISOString(), "2026-05-07T13:00:00.000Z");
  assert.equal(msUntil(due, now), 10_800_000);
  assert.equal(formatTimer(10_800_000), "03:00:00");
});

test("artifact metadata sanitizer removes postgres-invalid null bytes", () => {
  assert.deepEqual(
    sanitizeJsonForPostgres({
      stdout: "hello\u0000world",
      nested: ["ok\u0000", { stderr: "\u0000trim" }]
    }),
    {
      stdout: "helloworld",
      nested: ["ok", { stderr: "trim" }]
    }
  );
});

test("role detection lets explicit engineering roles win over product wording in JD", () => {
  assert.equal(
    normalizedAssessmentRole(
      "Software Development Engineer",
      "Build a chatbot product with strong tests, evals, and agent collaboration."
    ),
    "software"
  );
  assert.equal(normalizedAssessmentRole("Product Manager", "Own AI product strategy."), "product");
});

test("company email validation blocks common personal domains", () => {
  assert.equal(emailDomain("founder@acme.ai"), "acme.ai");
  assert.equal(isCompanyEmail("founder@acme.ai"), true);
  assert.equal(isCompanyEmail("founder@gmail.com"), false);
  assert.equal(companyNameFromDomain("acme-labs.ai"), "Acme Labs");
  assert.equal(slugifyCompanyName("Acme Labs, Inc."), "acme-labs-inc");
});

test("interviewer availability parser supports 24-hour and am/pm windows", () => {
  assert.deepEqual(parseAvailabilityText("Mon 10:00-13:30\nThu 2pm-5pm", "Asia/Kolkata"), [
    { dayOfWeek: 1, startMinutes: 600, endMinutes: 810, timezone: "Asia/Kolkata" },
    { dayOfWeek: 4, startMinutes: 840, endMinutes: 1020, timezone: "Asia/Kolkata" }
  ]);

  assert.throws(() => parseAvailabilityText("Monday 5pm-2pm"), /End time must be after start time/);
});

test("work-loop scoring penalizes one-shot submissions", () => {
  const oneShot = scoreAttemptFromSignals({
    visiblePassed: true,
    hiddenPassed: false,
    hasDiff: true,
    hasOpenCodeLog: true,
    hasPlan: false,
    commitCount: 1,
    hasCommitEvalLog: false,
    finalNotes: "I changed the app."
  });
  const iterative = scoreAttemptFromSignals({
    visiblePassed: true,
    hiddenPassed: false,
    hasDiff: true,
    hasOpenCodeLog: true,
    hasPlan: true,
    commitCount: 3,
    hasCommitEvalLog: true,
    finalNotes: "I planned the work, shipped in checkpoints, ran tests, added eval coverage, and documented remaining tradeoffs."
  });

  assert.equal(oneShot.debuggingDiscipline < iterative.debuggingDiscipline, true);
  assert.equal(oneShot.aiCollaboration < iterative.aiCollaboration, true);
  assert.equal(iterative.testAndEvalQuality, 4);
});

test("passing baseline tests without candidate work scores as insufficient evidence", () => {
  const scores = scoreAttemptFromSignals({
    visiblePassed: true,
    hiddenPassed: true,
    hasDiff: false,
    hasOpenCodeLog: true,
    hasPlan: true,
    commitCount: 0,
    hasCommitEvalLog: false,
    promptQualityScore: 5,
    promptCount: 2,
    finalNotes: "I submitted after looking around."
  });

  assert.equal(scores.requirements, 1);
  assert.equal(scores.testAndEvalQuality, 1);
  assert.equal(scores.codeQuality, 1);
  assert.equal(scores.productionReadiness, 1);
  assert.equal(aggregateScore(scores) < 50, true);
});

test("work-loop commit count ignores the platform baseline commit", () => {
  assert.deepEqual(
    workLoopSignalsFromArtifacts([
      { kind: "command_log", label: "Plan evidence", metadata: { stdout: "PLAN.md found\n---\nMilestones" } },
      {
        kind: "command_log",
        label: "Commit history",
        metadata: {
          stdout:
            "commit=a | time=now | subject=initial task baseline\ncommit=b | time=now | subject=implementation\ncommit=c | time=now | subject=evals"
        }
      },
      { kind: "command_log", label: "Commit checkpoint evals", metadata: { stdout: "=== commit abc 2026 ===\nnpm test\nexit=0" } }
    ]),
    { hasPlan: true, commitCount: 2, hasCommitEvalLog: true }
  );
});

test("scoring applies a higher work-loop bar for senior assessments", () => {
  const sharedSignals = {
    visiblePassed: true,
    hiddenPassed: true,
    hasDiff: true,
    hasOpenCodeLog: true,
    hasPlan: true,
    commitCount: 4,
    hasCommitEvalLog: true,
    promptQualityScore: 5,
    promptCount: 3,
    finalNotes: "I planned the work, shipped checkpoints, verified with tests and evals, and documented product risks."
  };
  const sde1 = scoreAttemptFromSignals({ ...sharedSignals, assessmentLevel: "SDE1" });
  const senior = scoreAttemptFromSignals({ ...sharedSignals, assessmentLevel: "Senior SDE" });

  assert.equal(sde1.debuggingDiscipline, 5);
  assert.equal(senior.debuggingDiscipline, 3);
  assert.equal(senior.productionReadiness < sde1.productionReadiness, true);
  assert.equal(aggregateScore(senior) < aggregateScore(sde1), true);
});

test("scoring labels product and program assessments without falling back to sde1", () => {
  const scores = scoreAttemptFromSignals({
    visiblePassed: true,
    hiddenPassed: true,
    hasDiff: true,
    hasOpenCodeLog: true,
    hasPlan: true,
    commitCount: 3,
    hasCommitEvalLog: true,
    promptQualityScore: 5,
    promptCount: 3,
    finalNotes: "I planned the product work, explained tradeoffs, and documented verification signals.",
    assessmentLevel: "Product Manager Product Manager, AI Workflows"
  });

  const summary = summarizeScore(scores, "Generated by test.", {
    hasPlan: true,
    commitCount: 3,
    hasCommitEvalLog: true,
    promptQualityScore: 5,
    promptCount: 3,
    assessmentLevel: "Product Manager Product Manager, AI Workflows"
  });

  assert.equal(summary.includes("Level bar: product/program expects 4+"), true);
  assert.equal(summary.includes("Level bar: sde1"), false);
});

test("work-loop signals are derived from captured artifacts", () => {
  assert.deepEqual(
    workLoopSignalsFromArtifacts([
      { kind: "command_log", label: "Plan evidence", metadata: { stdout: "PLAN.md found\n---\nMilestones" } },
      {
        kind: "command_log",
        label: "Commit history",
        metadata: { stdout: "commit=a | time=now | subject=plan\ncommit=b | time=now | subject=implementation\ncommit=c | time=now | subject=evals" }
      },
      { kind: "command_log", label: "Commit checkpoint evals", metadata: { stdout: "=== commit abc 2026 ===\nnpm test\nexit=0" } }
    ]),
    { hasPlan: true, commitCount: 3, hasCommitEvalLog: true }
  );
});

test("prompt quality signals reward iterative context-rich agent use", () => {
  const weak = promptQualitySignalsFromArtifacts([
    {
      kind: "opencode_log",
      label: "OpenCode session transcript",
      metadata: { stdout: "user: build the whole thing exactly from these instructions in one go" }
    }
  ]);
  const strong = promptQualitySignalsFromArtifacts([
    {
      kind: "opencode_log",
      label: "OpenCode session transcript",
      metadata: {
        stdout: [
          "user: inspect the codebase and make a plan before editing",
          "user: use the failing test output and logs as context for the fix",
          "user: add an eval, rerun tests, verify in browser, and call out production risks"
        ].join("\n")
      }
    }
  ]);

  assert.equal(strong.qualityScore > weak.qualityScore, true);
  assert.equal(strong.hasPlanningPrompt, true);
  assert.equal(strong.hasVerificationPrompt, true);
});

test("prompt quality counts opencode run prompts from logs", () => {
  const signals = promptQualitySignalsFromArtifacts([
    {
      kind: "opencode_log",
      label: "OpenCode session transcript",
      metadata: {
        stdout: [
          'INFO args=["run","--model","deepseek/deepseek-chat","Act as the candidate. First inspect the codebase and create a plan before implementation."] opencode',
          'INFO args=["run","--model","deepseek/deepseek-chat","Continue as the candidate. Use test output, implement the scoped change, and commit the result."] opencode',
          'INFO args=["run","--model","deepseek/deepseek-chat","Final checkpoint. Add a regression eval, verify in browser, document risks, and rerun tests."] opencode'
        ].join("\n")
      }
    }
  ]);

  assert.equal(signals.promptCount, 3);
  assert.equal(signals.qualityScore >= 4, true);
});

test("live interview transcript signals score collaborative problem solving", () => {
  const signals = liveInterviewSignalsFromEvents([
    {
      type: "interview.question",
      message: "interviewer: What tradeoff are you making in this API design?",
      metadata: { speaker: "interviewer", text: "What tradeoff are you making in this API design?" }
    },
    {
      type: "interview.answer",
      message: "candidate: I want to clarify the priority, then I will verify with tests and an eval.",
      metadata: {
        speaker: "candidate",
        text: "I want to clarify the priority, then I will verify with tests and an eval."
      }
    },
    {
      type: "interview.hint",
      message: "interviewer: Consider the edge case where the assistant returns nothing.",
      metadata: { speaker: "interviewer", text: "Consider the edge case where the assistant returns nothing." }
    },
    {
      type: "interview.answer",
      message: "candidate: Based on that feedback I will adjust the guardrail and rerun the browser check.",
      metadata: {
        speaker: "candidate",
        text: "Based on that feedback I will adjust the guardrail and rerun the browser check."
      }
    },
    {
      type: "interview.answer",
      message: "candidate: The risk is false confidence, so I will call it out in the final notes.",
      metadata: {
        speaker: "candidate",
        text: "The risk is false confidence, so I will call it out in the final notes."
      }
    }
  ]);

  assert.equal(signals.qualityScore >= 4, true);
  assert.equal(signals.hasClarifyingQuestions, true);
  assert.equal(signals.respondsToGuidance, true);
});

test("structured interviewer feedback becomes live interview signal", () => {
  const signals = liveInterviewSignalsFromEvents([
    {
      type: "interview.feedback",
      message: "interviewer recommendation: hire",
      metadata: {
        speaker: "interviewer",
        kind: "feedback",
        communication: 5,
        technicalDepth: 4,
        productJudgment: 4,
        aiCollaboration: 5,
        hireRecommendation: "hire"
      }
    }
  ]);

  assert.equal(signals.enabled, true);
  assert.equal(signals.qualityScore, 5);
  assert.equal(signals.strengths.includes("structured interviewer feedback"), true);
});

test("agentic product engineer JD generates product-team assessment ideas", () => {
  const ideas = generateAssessmentIdeasFromJd({
    roleTitle: "Founding Product Engineer",
    level: "Founding Product Engineer",
    jobDescription:
      "Own a product surface end-to-end, talk to users over WhatsApp, ship to production weekly, run Claude Code, Codex, and OpenCode in parallel, decide what not to build, and use taste to make the product loved.",
    assessmentPrompt:
      "Test user discovery, product taste, multi-agent orchestration, shipping discipline, evals, and what-not-to-build judgment."
  });

  assert.equal(ideas[0].id, "custom-focus");
  assert.equal(ideas.some((idea) => idea.id === "one-person-product-team"), true);
  assert.equal(ideas.some((idea) => idea.evaluationFocus.includes("agent orchestration")), true);
});

test("selected assessment idea details are saved into generated template", () => {
  const generated = generateAssessmentFromJd({
    roleTitle: "Founding Product Engineer",
    level: "Founding Product Engineer",
    jobDescription:
      "Own a product surface end-to-end, talk to users, orchestrate coding agents, ship weekly, and iterate until the product is loved.",
    assessmentIdea: "llm-custom",
    assessmentIdeaDetails: {
      id: "llm-custom",
      title: "Founding Product Engineer User-to-Ship Sprint",
      summary: "Synthesize user feedback, orchestrate agents, ship a product slice, and define the next iteration.",
      durationMin: 150,
      evaluationFocus: ["user discovery", "agent orchestration", "shipping judgment"],
      deliverables: ["feedback synthesis", "agent plan", "working product", "iteration memo"]
    }
  });

  assert.equal(generated.title, "Founding Product Engineer User-to-Ship Sprint");
  assert.equal(generated.taskBrief.includes("Synthesize user feedback"), true);
  assert.equal((generated.evaluationPlan.requiredEvidence as string[]).includes("agent plan"), true);
});

test("generated assessments default to a shorter work sample duration", () => {
  const generated = generateAssessmentFromJd({
    roleTitle: "Product Engineer",
    level: "Mid",
    jobDescription: "Build product workflows with AI agents, ship quickly, add evals, and explain tradeoffs."
  });

  assert.equal(generated.durationMin, 120);
});

test("generated project assessments preserve employer project brief", () => {
  const generated = generateAssessmentFromJd({
    roleTitle: "Product Engineer",
    level: "SDE2",
    repoSource: "generated",
    projectBrief: "Build a feedback triage panel for hiring managers reviewing candidate reports.",
    jobDescription: "Own product workflow, implementation, tests, evals, and shipping tradeoffs.",
    assessmentPrompt: "Test product judgment, implementation quality, and eval design."
  });

  assert.equal(generated.instructions.includes("Project mode"), false);
  assert.equal(generated.instructions.includes("generated starter repo"), true);
  assert.equal(generated.instructions.includes("feedback triage panel"), true);
  assert.equal(generated.evaluationPlan.repository.source, "generated");
  assert.equal(generated.evaluationPlan.repository.projectBrief, "Build a feedback triage panel for hiring managers reviewing candidate reports.");
});

test("github repo assessments preserve repo URL and existing-codebase brief", () => {
  const generated = generateAssessmentFromJd({
    roleTitle: "Senior Frontend Engineer",
    level: "Senior",
    repoSource: "github",
    repoUrl: "https://github.com/acme/product.git",
    existingProjectBrief: "Improve onboarding analytics without rewriting the dashboard architecture.",
    jobDescription: "Work inside a real product repo, improve UI behavior, and verify with tests.",
    assessmentPrompt: "Test codebase navigation, scoped implementation, and verification."
  });

  assert.equal(generated.repoUrl, "https://github.com/acme/product.git");
  assert.equal(generated.instructions.includes("existing GitHub codebase"), true);
  assert.equal(generated.instructions.includes("Improve onboarding analytics"), true);
  assert.equal(generated.evaluationPlan.repository.source, "github");
  assert.equal(generated.evaluationPlan.repository.generatedCodebase, false);
});

test("assessment ideas change meaningfully between new project and existing repo modes", () => {
  const common = {
    roleTitle: "Product Engineer",
    level: "SDE2",
    jobDescription:
      "Own product surfaces end-to-end, use coding agents, talk to users, ship quickly, add evals, and explain what not to build.",
    assessmentPrompt: "Test product judgment, implementation, agent orchestration, and eval quality."
  };
  const generatedProjectIdeas = generateAssessmentIdeasFromJd({
    ...common,
    repoSource: "generated",
    projectBrief: "Build a new workflow for triaging messy customer feedback."
  });
  const existingRepoIdeas = generateAssessmentIdeasFromJd({
    ...common,
    repoSource: "github",
    repoUrl: "https://github.com/acme/product.git",
    existingProjectBrief: "Improve a confusing workflow in the current app without rewriting architecture."
  });

  assert.equal(generatedProjectIdeas[0].title.toLowerCase().includes("new project"), true);
  assert.equal(generatedProjectIdeas[0].summary.toLowerCase().includes("new generated project"), true);
  assert.equal(existingRepoIdeas[0].title.toLowerCase().includes("existing repo"), true);
  assert.equal(existingRepoIdeas[0].summary.toLowerCase().includes("existing codebase"), true);
});

test("score caps prevent high scores without work-loop evidence", () => {
  const capped = applyScoreCaps(
    {
      requirements: 5,
      testAndEvalQuality: 5,
      debuggingDiscipline: 5,
      codeQuality: 5,
      aiCollaboration: 5,
      productionReadiness: 5,
      communication: 5
    },
    {
      visiblePassed: true,
      hiddenPassed: true,
      hasDiff: true,
      hasPlan: false,
      commitCount: 1,
      hasCommitEvalLog: false,
      promptQualityScore: 1,
      promptCount: 1,
      finalNotes: "Thin notes",
      assessmentLevel: "Senior SDE2"
    }
  );

  assert.equal(capped.cap.maxScore <= 60, true);
  assert.equal(capped.cap.reasons.some((reason) => /one-shot/i.test(reason)), true);
});

test("score caps respect template minimum meaningful commits", () => {
  const capped = applyScoreCaps(
    {
      requirements: 5,
      testAndEvalQuality: 5,
      debuggingDiscipline: 4,
      codeQuality: 4,
      aiCollaboration: 4,
      productionReadiness: 4,
      communication: 4
    },
    {
      visiblePassed: true,
      hiddenPassed: true,
      hasDiff: true,
      hasOpenCodeLog: true,
      hasPlan: true,
      commitCount: 3,
      hasCommitEvalLog: true,
      promptQualityScore: 4,
      promptCount: 3,
      finalNotes: "Verified tests, evals, browser health, tradeoffs, risks, and next steps.",
      assessmentLevel: "SDE2 Product Engineer",
      minimumMeaningfulCommits: 3
    }
  );

  assert.equal(capped.cap.reasons.some((reason) => /expects 4/i.test(reason)), false);
  assert.equal(capped.cap.maxScore, 100);
});
