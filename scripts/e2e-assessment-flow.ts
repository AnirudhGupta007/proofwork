import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";

function loadDotEnv() {
  const envPath = path.join(process.cwd(), ".env");
  return readFile(envPath, "utf8")
    .then((content) => {
      for (const line of content.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const index = trimmed.indexOf("=");
        if (index === -1) continue;
        const key = trimmed.slice(0, index);
        let value = trimmed.slice(index + 1);
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1);
        }
        process.env[key] ??= value;
      }
    })
    .catch(() => undefined);
}

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined>, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

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

const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const candidateName = process.env.E2E_CANDIDATE_NAME ?? `Senior E2E Candidate ${stamp}`;
const candidateEmail = process.env.E2E_CANDIDATE_EMAIL ?? `candidate+proofwork-e2e-${stamp}@example.com`;
const recipient = process.env.CANDIDATE_REPORT_EMAIL_TO ?? "reports@example.com";

const assessment = generateAssessmentFromJd({
  roleTitle: "Software Development Engineer",
  level: "SDE2",
  jobDescription:
    "SDE2 product engineer who can build an AI chatbot product, plan implementation, use coding agents responsibly, add tests/evals, and communicate tradeoffs.",
  proctoringEnabled: true
});

const organization = await db.organization.upsert({
  where: { slug: "proofwork-e2e" },
  update: { evaluationCredits: { increment: 1 } },
  create: {
    name: "Proofwork E2E",
    slug: "proofwork-e2e",
    planName: "E2E test",
    evaluationCredits: 5,
    onboardedAt: new Date()
  }
});

const template = await db.assessmentTemplate.upsert({
  where: { id: `proofwork-e2e-template-${organization.id}` },
  update: {
    title: assessment.title,
    roleTitle: assessment.roleTitle,
    level: assessment.level,
    durationMin: assessment.durationMin,
    repoUrl: process.env.ASSESSMENT_TASK_REPO_URL ?? assessment.repoUrl,
    instructions: assessment.instructions,
    generatedFromJd: assessment.generatedFromJd,
    taskBrief: assessment.taskBrief,
    evaluationPlan: assessment.evaluationPlan as Prisma.InputJsonValue,
    proctoringConfig: assessment.proctoringConfig as Prisma.InputJsonValue,
    rubric: defaultRubric
  },
  create: {
    id: `proofwork-e2e-template-${organization.id}`,
    organizationId: organization.id,
    title: assessment.title,
    roleTitle: assessment.roleTitle,
    level: assessment.level,
    durationMin: assessment.durationMin,
    repoUrl: process.env.ASSESSMENT_TASK_REPO_URL ?? assessment.repoUrl,
    instructions: assessment.instructions,
    generatedFromJd: assessment.generatedFromJd,
    taskBrief: assessment.taskBrief,
    evaluationPlan: assessment.evaluationPlan as Prisma.InputJsonValue,
    proctoringConfig: assessment.proctoringConfig as Prisma.InputJsonValue,
    rubric: defaultRubric
  }
});

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

const inviteUrl = `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001"}/assessment/${token}`;
const inviteResult = await sendInviteEmail({
  to: candidateEmail,
  candidateName,
  assessmentTitle: template.title,
  durationMin: template.durationMin,
  inviteUrl,
  expiresAt
});

const startedAttempt = await startAssessment(token, { camera: true, screen: true, recording: true });
const attemptId = startedAttempt.id;
await logAttemptEvent(attemptId, "proctoring.camera_active", "Proctoring event: camera_active", { source: "e2e" });
await logAttemptEvent(attemptId, "proctoring.screen_share_active", "Proctoring event: screen_share_active", { source: "e2e" });
await logAttemptEvent(attemptId, "proctoring.preflight_passed", "Proctoring event: preflight_passed", { source: "e2e" });

await waitFor("fake workspace readiness", async () => {
  const current = await db.attempt.findUnique({ where: { id: attemptId }, include: { workspace: true } });
  return current?.status === "in_progress" && current.workspace ? current : null;
});

await submitAssessment(
  token,
  "Implemented the chatbot work plan, made iterative commits, added visible and hidden eval coverage, and verified behavior with tests before submission."
);

const reviewedAttempt = await waitFor("reviewed attempt", async () => {
  const current = await db.attempt.findUnique({
    where: { id: attemptId },
    include: { scorecard: true, evalRuns: { orderBy: { createdAt: "desc" }, take: 1 }, artifacts: true }
  });
  return current?.status === "reviewed" && current.scorecard ? current : null;
});

const pdf = await buildCandidateReportPdf(reviewedAttempt.id);
const reportsDir = path.join(process.cwd(), "reports");
await mkdir(reportsDir, { recursive: true });
const reportPath = path.join(reportsDir, `e2e-${stamp}-${reviewedAttempt.id}-candidate-report.pdf`);
await writeFile(reportPath, pdf);

const reportArtifact = reviewedAttempt.artifacts.find((artifact) => artifact.kind === "reviewer_export");

console.log(
  JSON.stringify(
    {
      candidateName,
      candidateEmail,
      inviteUrl,
      invitationId: invitation.id,
      attemptId: reviewedAttempt.id,
      finalStatus: reviewedAttempt.status,
      inviteEmailSent: "data" in inviteResult ? Boolean(inviteResult.data?.id) : inviteResult.id !== "dry-run",
      inviteEmailId: "data" in inviteResult ? inviteResult.data?.id : inviteResult.id,
      reportEmailRecipient: recipient,
      reportEmailArtifact: reportArtifact?.uri ?? null,
      scorecard: reviewedAttempt.scorecard,
      latestEval: reviewedAttempt.evalRuns[0],
      artifactLabels: reviewedAttempt.artifacts.map((artifact) => artifact.label),
      reportPath
    },
    null,
    2
  )
);

await db.$disconnect();
process.exit(0);
