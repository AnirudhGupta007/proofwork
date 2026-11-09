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

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined>, timeoutMs = 25_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 350));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function safeSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const scenarios = [
  {
    roleTitle: "SDE 1 Product Engineer",
    level: "SDE1",
    prompt:
      "Test codebase navigation, small feature implementation, clear planning, visible tests, basic eval thinking, and communication under ambiguity.",
    jd:
      "Entry-level software development engineer joining a product team. They should understand an existing TypeScript app, ask clarifying questions, ship a focused UI/API change, write or update tests, and explain what they verified."
  },
  {
    roleTitle: "SDE 2 Product Engineer",
    level: "SDE2",
    prompt:
      "Test end-to-end product implementation, AI-agent judgment, multi-step planning, eval quality, debugging discipline, and production tradeoffs.",
    jd:
      "Mid-level product engineer expected to own ambiguous features end-to-end. They should use coding agents thoughtfully, plan the work, implement UI and API behavior, improve tests/evals, make meaningful commits, and communicate tradeoffs."
  },
  {
    roleTitle: "Senior SDE Product Engineer",
    level: "Senior SDE",
    prompt:
      "Test product judgment, architecture judgment, what-not-to-build decisions, agent orchestration, verification depth, and launch readiness.",
    jd:
      "Senior software engineer who can operate as a one-person product team. They should turn messy user feedback into a focused product slice, orchestrate agents without blindly trusting them, improve evals, identify risks, and produce a launch/iteration memo."
  }
];

function recordingReplayHtml(input: {
  candidateName: string;
  roleTitle: string;
  assessmentTitle: string;
  attemptId: string;
  prompt: string;
}) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${input.candidateName} recording replay</title>
  <style>
    body { margin: 0; font-family: Arial, sans-serif; background: #f7f6f2; color: #1a1a1a; }
    main { max-width: 920px; margin: 40px auto; padding: 32px; background: white; border: 1px solid #d8d5cd; }
    h1 { font-family: Georgia, serif; font-size: 34px; margin: 0 0 8px; }
    .meta { color: #666; margin-bottom: 28px; }
    .frame { border: 1px solid #1a1a1a; min-height: 380px; display: grid; grid-template-columns: 1fr 260px; }
    .screen { padding: 24px; background: #1a1a1a; color: #fff; }
    .camera { padding: 18px; border-left: 1px solid #d8d5cd; background: #f7f6f2; }
    .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; background: #1f8a4c; margin-right: 8px; }
    li { margin: 10px 0; line-height: 1.45; }
    code { background: #efeee9; padding: 2px 5px; }
  </style>
</head>
<body>
  <main>
    <h1>${input.roleTitle} candidate session replay</h1>
    <div class="meta">${input.assessmentTitle} | Attempt ${input.attemptId}</div>
    <div class="frame">
      <section class="screen">
        <p><span class="dot"></span>Screen share active</p>
        <h2>Candidate work timeline</h2>
        <ol>
          <li>Opened assessment, read README/EVALS, and created <code>PLAN.md</code>.</li>
          <li>Used OpenCode to inspect app structure before editing.</li>
          <li>Implemented the focused product slice for: ${input.prompt}</li>
          <li>Committed plan, implementation, and verification checkpoints.</li>
          <li>Ran visible tests, added/improved an eval, and submitted final notes.</li>
        </ol>
      </section>
      <aside class="camera">
        <p><span class="dot"></span>Camera active</p>
        <strong>${input.candidateName}</strong>
        <p>Simulated E2E proctoring replay generated for reviewer QA. Real browser runs upload camera/screen WebM files through the candidate proctoring recorder.</p>
      </aside>
    </div>
  </main>
</body>
</html>`;
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

const runStamp = stamp();
const candidateEmail = process.env.E2E_CANDIDATE_EMAIL ?? "reports@example.com";
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
const outputDir = path.join(process.cwd(), "reports", `sde-cohort-${runStamp}`);
await mkdir(outputDir, { recursive: true });

const organization = await db.organization.upsert({
  where: { slug: "proofwork-sde-cohort" },
  update: { evaluationCredits: { increment: scenarios.length } },
  create: {
    name: "Proofwork SDE Cohort",
    slug: "proofwork-sde-cohort",
    planName: "E2E cohort",
    evaluationCredits: scenarios.length + 5,
    onboardedAt: new Date()
  }
});

const results = [];

for (const [index, scenario] of scenarios.entries()) {
  const generated = generateAssessmentFromJd({
    roleTitle: scenario.roleTitle,
    level: scenario.level,
    jobDescription: scenario.jd,
    assessmentPrompt: scenario.prompt,
    assessmentIdea: "custom-focus",
    repoSource: "generated",
    proctoringEnabled: true
  });

  const template = await db.assessmentTemplate.create({
    data: {
      organizationId: organization.id,
      title: generated.title,
      roleTitle: generated.roleTitle,
      level: generated.level,
      durationMin: generated.durationMin,
      repoUrl: generated.repoUrl,
      instructions: generated.instructions,
      generatedFromJd: generated.generatedFromJd,
      taskBrief: generated.taskBrief,
      evaluationPlan: generated.evaluationPlan as Prisma.InputJsonValue,
      proctoringConfig: generated.proctoringConfig as Prisma.InputJsonValue,
      rubric: defaultRubric,
      isActive: false
    }
  });

  const candidateName = `${scenario.level} Candidate ${runStamp}`;
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
  }).catch((error) => ({ error: error instanceof Error ? error.message : "invite email failed" }));

  const startedAttempt = await startAssessment(token, { camera: true, screen: true, recording: true });
  await logAttemptEvent(startedAttempt.id, "proctoring.camera_active", "Proctoring event: camera_active", { source: "sde-cohort" });
  await logAttemptEvent(startedAttempt.id, "proctoring.screen_share_active", "Proctoring event: screen_share_active", { source: "sde-cohort" });
  await logAttemptEvent(startedAttempt.id, "proctoring.preflight_passed", "Proctoring event: preflight_passed", { source: "sde-cohort" });

  await waitFor(`${scenario.roleTitle} workspace`, async () => {
    const current = await db.attempt.findUnique({ where: { id: startedAttempt.id }, include: { workspace: true } });
    return current?.status === "in_progress" && current.workspace ? current : null;
  });

  const recordingPath = path.join(outputDir, `${String(index + 1).padStart(2, "0")}-${safeSlug(scenario.level)}-recording-replay.html`);
  await writeFile(
    recordingPath,
    recordingReplayHtml({
      candidateName,
      roleTitle: scenario.roleTitle,
      assessmentTitle: template.title,
      attemptId: startedAttempt.id,
      prompt: scenario.prompt
    })
  );
  await db.artifact.create({
    data: {
      attemptId: startedAttempt.id,
      kind: "proctoring_recording",
      label: "Screen and camera recording replay",
      uri: `file://${recordingPath}`,
      metadata: {
        filename: path.basename(recordingPath),
        path: recordingPath,
        mimeType: "text/html",
        simulated: true,
        note: "E2E replay artifact. Browser candidate runs upload real camera/screen WebM recordings."
      } satisfies Prisma.InputJsonObject
    }
  });
  await logAttemptEvent(startedAttempt.id, "proctoring.recordings_uploaded", "E2E recording replay artifact uploaded", {
    path: recordingPath,
    simulated: true
  });

  await submitAssessment(
    token,
    `Completed the ${scenario.roleTitle} assessment as a candidate. I created a plan, used small implementation checkpoints, verified with tests/evals, and documented tradeoffs. Assessment focus: ${scenario.prompt}`
  );

  const reviewedAttempt = await waitFor(`${scenario.roleTitle} review`, async () => {
    const current = await db.attempt.findUnique({
      where: { id: startedAttempt.id },
      include: { scorecard: true, evalRuns: { orderBy: { createdAt: "desc" }, take: 1 }, artifacts: true }
    });
    return current?.status === "reviewed" && current.scorecard ? current : null;
  });

  const pdf = await buildCandidateReportPdf(reviewedAttempt.id);
  const reportPath = path.join(outputDir, `${String(index + 1).padStart(2, "0")}-${safeSlug(scenario.level)}-candidate-report.pdf`);
  await writeFile(reportPath, pdf);

  results.push({
    roleTitle: scenario.roleTitle,
    level: scenario.level,
    assessmentTitle: template.title,
    inviteUrl,
    invitationId: invitation.id,
    attemptId: reviewedAttempt.id,
    adminReviewUrl: `${appUrl}/admin/attempts/${reviewedAttempt.id}`,
    inviteEmail: inviteResult,
    finalStatus: reviewedAttempt.status,
    totalScore:
      reviewedAttempt.scorecard?.reviewerOverrideScore ??
      Math.round(
        ((reviewedAttempt.scorecard?.requirements ?? 0) +
          (reviewedAttempt.scorecard?.testAndEvalQuality ?? 0) +
          (reviewedAttempt.scorecard?.debuggingDiscipline ?? 0) +
          (reviewedAttempt.scorecard?.codeQuality ?? 0) +
          (reviewedAttempt.scorecard?.aiCollaboration ?? 0) +
          (reviewedAttempt.scorecard?.productionReadiness ?? 0) +
          (reviewedAttempt.scorecard?.communication ?? 0)) /
          35 *
          100
      ),
    reportPath,
    recordingReplayPath: recordingPath,
    artifactLabels: reviewedAttempt.artifacts.map((artifact) => artifact.label)
  });
}

const summaryPath = path.join(outputDir, "summary.json");
const summary = { runStamp, candidateEmail, outputDir, results };
await writeFile(summaryPath, JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ ...summary, summaryPath }, null, 2));
await db.$disconnect();
process.exit(0);
