import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";

function stamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

async function loadDotEnv() {
  const envPath = path.join(process.cwd(), ".env");
  const content = await readFile(envPath, "utf8").catch(() => "");
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

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined>, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function humanDelay(min = 240, max = 820) {
  return new Promise((resolve) => setTimeout(resolve, min + Math.floor(Math.random() * (max - min))));
}

const roleScenarios = [
  {
    roleTitle: "SDE2 Full Stack Product Engineer",
    level: "SDE2",
    prompt: "Test planning, UI/API implementation, AI-agent judgment, eval quality, and final communication.",
    jd: "Own end-to-end TypeScript product features in an existing SaaS app. Build UI and APIs, reason through ambiguous product requests, use AI coding tools responsibly, add tests/evals, and explain tradeoffs."
  },
  {
    roleTitle: "Frontend Engineer",
    level: "Mid",
    prompt: "Test UI craft, state management, browser verification, accessibility judgment, and fast iteration.",
    jd: "Build polished React interfaces from product briefs. Candidate should handle state, responsive layout, API integration, accessibility, visual QA, and concise communication."
  },
  {
    roleTitle: "Backend Platform Engineer",
    level: "Senior SDE2",
    prompt: "Test API design, data modeling, reliability, observability, and production readiness.",
    jd: "Design and implement backend workflows for a product team. Candidate should reason about APIs, persistence, background jobs, failure modes, tests, and operational readiness."
  },
  {
    roleTitle: "AI Product Engineer",
    level: "SDE2",
    prompt: "Test agentic workflow design, prompt/eval loops, guardrails, product UX, and code quality.",
    jd: "Build AI-native product experiences with practical guardrails. Candidate should create useful assistant workflows, deterministic checks, evals, and a clear product surface."
  },
  {
    roleTitle: "Data Engineer",
    level: "SDE2",
    prompt: "Test data modeling, pipeline correctness, observability, edge cases, and stakeholder communication.",
    jd: "Create reliable data workflows and analytics surfaces for product teams. Candidate should handle schemas, transformations, validation, monitoring, and clear tradeoffs."
  },
  {
    roleTitle: "QA Automation Engineer",
    level: "Mid",
    prompt: "Test test strategy, eval design, bug isolation, automation quality, and written debugging discipline.",
    jd: "Improve product quality through automation and practical debugging. Candidate should find gaps, write targeted tests/evals, stabilize flaky behavior, and communicate risk."
  },
  {
    roleTitle: "DevOps SRE Engineer",
    level: "Senior SDE2",
    prompt: "Test incident thinking, reliability fixes, deployment risk, observability, and rollback judgment.",
    jd: "Support reliable product delivery with infrastructure and runtime ownership. Candidate should reason about incidents, monitoring, deployment safety, logs, and remediation."
  },
  {
    roleTitle: "Product Manager, AI Workflows",
    level: "Product Manager",
    prompt: "Test product judgment, prioritization, AI quality bar, launch metrics, and decision writing.",
    jd: "Own AI workflow product strategy. Candidate should define users, prioritize MVP scope, design evaluation criteria, identify launch blockers, and write a clear recommendation."
  },
  {
    roleTitle: "Technical Program Manager",
    level: "Product Manager",
    prompt: "Test execution planning, cross-functional risk, sequencing, dependency management, and crisp updates.",
    jd: "Coordinate complex technical launches. Candidate should structure milestones, identify dependencies, manage risk, define status signals, and produce decision-ready communication."
  },
  {
    roleTitle: "UX Engineer",
    level: "SDE2",
    prompt: "Test product taste, interaction details, frontend implementation, accessibility, and verification notes.",
    jd: "Bridge design and engineering for product workflows. Candidate should implement refined UI behavior, explain UX decisions, verify edge cases, and maintain code quality."
  }
];

await loadDotEnv();
process.env.WORKSPACE_PROVIDER = "fake";
delete process.env.INNGEST_EVENT_KEY;

const { db } = await import("../app/lib/db.ts");
const { generateAssessmentFromJd } = await import("../app/lib/assessment-generator.ts");
const { defaultRubric } = await import("../app/lib/domain/score.ts");
const { addMinutes } = await import("../app/lib/domain/time.ts");
const { createInviteToken, hashInviteToken } = await import("../app/lib/domain/invites.ts");
const { sendInviteEmail } = await import("../app/lib/email/invites.ts");
const { startAssessment, submitAssessment } = await import("../app/lib/attempt-actions.ts");
const { logAttemptEvent } = await import("../app/lib/events.ts");
const { buildCandidateReportPdf } = await import("../app/lib/reports/candidate-report.ts");

const runStamp = stamp();
const candidateEmail = process.env.E2E_CANDIDATE_EMAIL ?? "reports@example.com";
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
const reportsDir = path.join(process.cwd(), "reports", `role-cohort-${runStamp}`);
await mkdir(reportsDir, { recursive: true });

const organization = await db.organization.upsert({
  where: { slug: "proofwork-role-cohort" },
  update: { evaluationCredits: { increment: roleScenarios.length } },
  create: {
    name: "Proofwork Role Cohort",
    slug: "proofwork-role-cohort",
    planName: "E2E cohort",
    evaluationCredits: roleScenarios.length + 5,
    onboardedAt: new Date()
  }
});

const results = [];

for (const [index, scenario] of roleScenarios.entries()) {
  await humanDelay();
  const generated = generateAssessmentFromJd({
    roleTitle: scenario.roleTitle,
    level: scenario.level,
    jobDescription: scenario.jd,
    assessmentPrompt: scenario.prompt,
    assessmentIdea: "custom-focus",
    proctoringEnabled: true
  });

  const templateId = `role-cohort-${organization.id}-${index + 1}`;
  const template = await db.assessmentTemplate.upsert({
    where: { id: templateId },
    update: {
      title: generated.title,
      roleTitle: generated.roleTitle,
      level: generated.level,
      durationMin: generated.durationMin,
      repoUrl: process.env.ASSESSMENT_TASK_REPO_URL ?? generated.repoUrl,
      instructions: generated.instructions,
      generatedFromJd: generated.generatedFromJd,
      taskBrief: generated.taskBrief,
      evaluationPlan: generated.evaluationPlan as Prisma.InputJsonValue,
      proctoringConfig: generated.proctoringConfig as Prisma.InputJsonValue,
      rubric: defaultRubric
    },
    create: {
      id: templateId,
      organizationId: organization.id,
      title: generated.title,
      roleTitle: generated.roleTitle,
      level: generated.level,
      durationMin: generated.durationMin,
      repoUrl: process.env.ASSESSMENT_TASK_REPO_URL ?? generated.repoUrl,
      instructions: generated.instructions,
      generatedFromJd: generated.generatedFromJd,
      taskBrief: generated.taskBrief,
      evaluationPlan: generated.evaluationPlan as Prisma.InputJsonValue,
      proctoringConfig: generated.proctoringConfig as Prisma.InputJsonValue,
      rubric: defaultRubric
    }
  });

  const candidateName = `${scenario.roleTitle} Candidate ${runStamp}-${index + 1}`;
  const candidate = await db.candidate.upsert({
    where: { email_name: { email: candidateEmail, name: candidateName } },
    update: {},
    create: { email: candidateEmail, name: candidateName }
  });

  const token = createInviteToken();
  const expiresAt = addMinutes(new Date(), 7 * 24 * 60);
  const invitation = await db.invitation.create({
    data: {
      organizationId: organization.id,
      templateId: template.id,
      candidateId: candidate.id,
      tokenHash: hashInviteToken(token),
      creditCost: 1,
      expiresAt
    }
  });
  const inviteUrl = `${appUrl}/assessment/${token}`;

  const inviteResult = await sendInviteEmail({
    to: candidateEmail,
    candidateName,
    assessmentTitle: template.title,
    durationMin: template.durationMin,
    inviteUrl,
    expiresAt
  });

  await humanDelay(300, 1100);
  const startedAttempt = await startAssessment(token, { camera: true, screen: true, recording: true });
  await logAttemptEvent(startedAttempt.id, "proctoring.camera_active", "Proctoring event: camera_active", { source: "role-cohort" });
  await logAttemptEvent(startedAttempt.id, "proctoring.screen_share_active", "Proctoring event: screen_share_active", { source: "role-cohort" });
  await logAttemptEvent(startedAttempt.id, "proctoring.preflight_passed", "Proctoring event: preflight_passed", { source: "role-cohort" });

  await waitFor(`${scenario.roleTitle} workspace`, async () => {
    const current = await db.attempt.findUnique({ where: { id: startedAttempt.id }, include: { workspace: true } });
    return current?.status === "in_progress" && current.workspace ? current : null;
  });

  await humanDelay(500, 1600);
  await submitAssessment(
    token,
    `Completed the ${scenario.roleTitle} work simulation with a plan, iterative checkpoints, verification, and final tradeoff notes. Focus tested: ${scenario.prompt}`
  );

  const reviewedAttempt = await waitFor(`${scenario.roleTitle} review`, async () => {
    const current = await db.attempt.findUnique({
      where: { id: startedAttempt.id },
      include: { scorecard: true, evalRuns: { orderBy: { createdAt: "desc" }, take: 1 }, artifacts: true }
    });
    return current?.status === "reviewed" && current.scorecard ? current : null;
  });

  const pdf = await buildCandidateReportPdf(reviewedAttempt.id);
  const reportPath = path.join(reportsDir, `${String(index + 1).padStart(2, "0")}-${scenario.roleTitle.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.pdf`);
  await writeFile(reportPath, pdf);

  results.push({
    roleTitle: scenario.roleTitle,
    level: scenario.level,
    assessmentTitle: template.title,
    inviteUrl,
    invitationId: invitation.id,
    attemptId: reviewedAttempt.id,
    inviteEmailId: "data" in inviteResult ? inviteResult.data?.id : inviteResult.id,
    finalStatus: reviewedAttempt.status,
    score: reviewedAttempt.scorecard,
    reportPath,
    artifacts: reviewedAttempt.artifacts.map((artifact) => artifact.label)
  });
}

const summaryPath = path.join(reportsDir, "summary.json");
await writeFile(summaryPath, JSON.stringify({ runStamp, candidateEmail, results }, null, 2));
console.log(JSON.stringify({ runStamp, candidateEmail, summaryPath, results }, null, 2));
await db.$disconnect();
process.exit(0);
