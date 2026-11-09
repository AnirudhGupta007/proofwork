import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import { aggregateScore, defaultRubric } from "../app/lib/domain/score.ts";
import { createInviteToken, hashInviteToken } from "../app/lib/domain/invites.ts";

const db = new PrismaClient();

const runId = `sim-${Date.now().toString(36)}`;
const candidates = [
  ["Junior", "Asha Junior", [2, 2, 2, 2, 2, 2, 3]],
  ["Junior", "Ben Junior", [3, 2, 2, 3, 2, 2, 2]],
  ["Junior", "Casey Junior", [2, 1, 2, 2, 2, 1, 2]],
  ["Mid", "Devi Mid", [4, 3, 3, 3, 3, 3, 4]],
  ["Mid", "Evan Mid", [3, 3, 4, 3, 4, 3, 3]],
  ["Mid", "Farah Mid", [4, 4, 3, 4, 3, 3, 4]],
  ["Senior SDE2", "Gita Senior", [5, 4, 5, 4, 5, 4, 5]],
  ["Senior SDE2", "Hari Senior", [4, 5, 4, 5, 5, 4, 4]],
  ["Senior SDE2", "Ira Senior", [5, 5, 5, 5, 4, 5, 5]],
  ["SDE2", "Jules SDE2", [4, 4, 4, 4, 4, 4, 4]]
];

function scoreObject(values) {
  const [requirements, testAndEvalQuality, debuggingDiscipline, codeQuality, aiCollaboration, productionReadiness, communication] = values;
  return { requirements, testAndEvalQuality, debuggingDiscipline, codeQuality, aiCollaboration, productionReadiness, communication };
}

function generateSimulationAssessment({ roleTitle, level, jobDescription, durationMin, proctoringEnabled }) {
  return {
    title: `${level} Vibecoding: ClawChat Product Build`,
    roleTitle,
    level,
    durationMin,
    repoUrl: "https://github.com/your-org/clawchat-assessment.git",
    instructions: [
      "Build a focused AI chat workspace inspired by modern assistant products. Improve the chat UX, implement conversation APIs, add deterministic assistant behavior, create evals for assistant quality, and verify the experience in browser and tests.",
      "",
      "Candidate workflow:",
      "1. Read the product brief and create PLAN.md before coding.",
      "2. Build the smallest convincing product slice.",
      "3. Run tests and add/improve at least one eval.",
      "4. Commit meaningful checkpoints; each commit is evaluation-worthy.",
      "5. Submit final notes covering verification, tradeoffs, and next steps."
    ].join("\n"),
    generatedFromJd: jobDescription,
    taskBrief:
      "Build a focused AI chat workspace inspired by modern assistant products. Improve the chat UX, implement conversation APIs, add deterministic assistant behavior, create evals for assistant quality, and verify the experience in browser and tests.",
    evaluationPlan: {
      role: "software",
      focus: ["requirements", "UI workflow", "API correctness", "eval quality", "AI collaboration", "production readiness"],
      requiredEvidence: [
        "PLAN.md before implementation",
        "Usable chat UI with clear starting point",
        "Conversation state and message API",
        "Assistant behavior for vague, concrete, and risk prompts",
        "At least one behavior-focused eval",
        "Final notes with verification and tradeoffs"
      ],
      commitPolicy: "Every commit should trigger a checkpoint eval; final submit uses the latest commit.",
      recommendationThresholds: { hire: 78, leanHire: 68, noHire: 60 }
    },
    proctoringConfig: {
      enabled: Boolean(proctoringEnabled),
      cameraRequired: Boolean(proctoringEnabled),
      screenShareRequired: Boolean(proctoringEnabled),
      recordVideo: Boolean(proctoringEnabled),
      recordScreen: Boolean(proctoringEnabled),
      events: ["face_missing", "screen_share_stopped", "tab_blur", "copy_paste_large", "network_disconnect"]
    }
  };
}

function recommendation(score) {
  if (score >= 78) return "HIRE";
  if (score >= 68) return "LEAN HIRE";
  if (score >= 60) return "LEAN NO HIRE";
  return "NO HIRE";
}

function escapePdfText(value) {
  return String(value).replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)").replaceAll("\r", "");
}

function pdfLine(text, x, y, size = 10, font = "F1") {
  return `BT /${font} ${size} Tf ${x} ${y} Td (${escapePdfText(text)}) Tj ET`;
}

function buildPdf(lines) {
  const pageHeight = 792;
  const pages = [];
  let y = 738;
  let stream = [];
  const push = () => {
    pages.push(stream.join("\n"));
    stream = [];
    y = 738;
  };

  for (const line of lines) {
    const size = line.size ?? 10;
    const gap = line.gap ?? size + 5;
    if (y < 60 + gap) push();
    stream.push(pdfLine(line.text, 54, y, size, line.font ?? "F1"));
    y -= gap;
  }
  if (stream.length) push();

  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${5 + index * 2} 0 R`).join(" ")}] /Count ${pages.length} >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"
  ];
  for (let index = 0; index < pages.length; index += 1) {
    const contentId = 6 + index * 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);
    objects.push(`<< /Length ${Buffer.byteLength(pages[index])} >>\nstream\n${pages[index]}\nendstream`);
  }

  const chunks = ["%PDF-1.4\n"];
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(chunks.join("")));
    chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
  }
  const xref = Buffer.byteLength(chunks.join(""));
  chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (let index = 1; index < offsets.length; index += 1) chunks.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
  chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return Buffer.from(chunks.join(""));
}

function bar(score) {
  const filled = Math.round(score / 10);
  return `[${"#".repeat(filled)}${"-".repeat(10 - filled)}] ${score}`;
}

const organization = await db.organization.upsert({
  where: { slug: "default" },
  update: {},
  create: { name: "Default Hiring Team", slug: "default" }
});

const generated = generateSimulationAssessment({
  roleTitle: "Software Development Engineer",
  level: "SDE2",
  jobDescription: "SDE2 engineer to build an OpenClaw-like AI chatbot product with planning, tool/eval behavior, tests, and strong agent collaboration.",
  durationMin: 180,
  proctoringEnabled: true
});

const template = await db.assessmentTemplate.upsert({
  where: { id: "sde2-proofwork-typescript" },
  update: {
    title: generated.title,
    roleTitle: generated.roleTitle,
    level: generated.level,
    durationMin: generated.durationMin,
    repoUrl: generated.repoUrl,
    instructions: generated.instructions,
    generatedFromJd: generated.generatedFromJd,
    taskBrief: generated.taskBrief,
    evaluationPlan: generated.evaluationPlan,
    proctoringConfig: generated.proctoringConfig,
    rubric: defaultRubric
  },
  create: {
    id: "sde2-proofwork-typescript",
    organizationId: organization.id,
    title: generated.title,
    roleTitle: generated.roleTitle,
    level: generated.level,
    durationMin: generated.durationMin,
    repoUrl: generated.repoUrl,
    instructions: generated.instructions,
    generatedFromJd: generated.generatedFromJd,
    taskBrief: generated.taskBrief,
    evaluationPlan: generated.evaluationPlan,
    proctoringConfig: generated.proctoringConfig,
    rubric: defaultRubric
  }
});

const rows = [];
for (let index = 0; index < candidates.length; index += 1) {
  const [level, name, scoresArray] = candidates[index];
  const scores = scoreObject(scoresArray);
  const total = aggregateScore(scores);
  const token = createInviteToken();
  const candidate = await db.candidate.create({
    data: { name: `${name} ${runId}`, email: `${runId}-${index + 1}@example.com` }
  });
  const invitation = await db.invitation.create({
    data: {
      organizationId: organization.id,
      templateId: template.id,
      candidateId: candidate.id,
      tokenHash: hashInviteToken(token),
      status: "redeemed",
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      openedAt: new Date(),
      redeemedAt: new Date()
    }
  });
  const attempt = await db.attempt.create({
    data: {
      organizationId: organization.id,
      templateId: template.id,
      candidateId: candidate.id,
      invitationId: invitation.id,
      status: "reviewed",
      startedAt: new Date(Date.now() - 1000 * 60 * 150),
      submittedAt: new Date(),
      dueAt: new Date(Date.now() + 1000 * 60 * 30),
      finalNotes: `${level} simulation: completed ClawChat vertical slice, committed checkpoints, ran tests/evals, and documented tradeoffs.`
    }
  });
  await db.workspace.create({
    data: {
      attemptId: attempt.id,
      provider: "simulation",
      externalId: `sim-${attempt.id}`,
      status: "stopped",
      metadata: { level, runId, proctoring: { cameraOk: true, screenShareOk: true, suspiciousEvents: index % 5 === 0 ? 1 : 0 } }
    }
  });
  await db.evalRun.create({
    data: {
      attemptId: attempt.id,
      status: "completed",
      visibleTests: { passed: total >= 55, exitCode: total >= 55 ? 0 : 1 },
      hiddenTests: { passed: total >= 65, exitCode: total >= 65 ? 0 : 1 },
      llmRubric: scores,
      summary: `Simulated ${level} checkpoint score: ${total}/100. Recommendation: ${recommendation(total)}.`
    }
  });
  await db.scorecard.create({
    data: {
      attemptId: attempt.id,
      ...scores,
      automatedSummary: `Simulated ${level} ClawChat assessment score: ${total}/100.`,
      reviewerOverrideScore: total,
      reviewerNotes: `Simulation cohort ${runId}: ${recommendation(total)}`
    }
  });
  await db.artifact.createMany({
    data: [
      { attemptId: attempt.id, kind: "git_diff", label: "Git diff", uri: `inline://${attempt.id}/diff`, metadata: { stdout: `Simulated ${level} implementation diff for ClawChat.` } },
      { attemptId: attempt.id, kind: "test_output", label: "Test output", uri: `inline://${attempt.id}/tests`, metadata: { exitCode: total >= 55 ? 0 : 1, stdout: `${total >= 55 ? "PASS" : "FAIL"} visible tests` } },
      { attemptId: attempt.id, kind: "command_log", label: "Hidden test output", uri: `inline://${attempt.id}/hidden-tests`, metadata: { exitCode: total >= 65 ? 0 : 1, stdout: `${total >= 65 ? "PASS" : "FAIL"} hidden evals` } },
      { attemptId: attempt.id, kind: "command_log", label: "Proctoring events", uri: `inline://${attempt.id}/proctoring`, metadata: { stdout: "camera=ok screen=ok suspicious_events=" + (index % 5 === 0 ? 1 : 0) } }
    ]
  });
  rows.push({ name: candidate.name, level, total, recommendation: recommendation(total), scores });
}

const average = Math.round(rows.reduce((sum, row) => sum + row.total, 0) / rows.length);
const lines = [
  { text: "Proofwork Cohort Simulation Report", size: 20, font: "F2", gap: 30 },
  { text: `Run: ${runId}` },
  { text: `Assessment: ${template.title}` },
  { text: `Candidates: ${rows.length}` },
  { text: `Average score: ${average}/100`, gap: 22 },
  { text: "Recommendation Distribution", size: 14, font: "F2", gap: 20 }
];
for (const label of ["HIRE", "LEAN HIRE", "LEAN NO HIRE", "NO HIRE"]) {
  const count = rows.filter((row) => row.recommendation === label).length;
  lines.push({ text: `${label.padEnd(14)} [${"#".repeat(count)}${"-".repeat(rows.length - count)}] ${count}` });
}
lines.push({ text: "", gap: 14 }, { text: "Candidate Ratings", size: 14, font: "F2", gap: 20 });
for (const row of rows) {
  lines.push({ text: `${row.name} (${row.level}) ${bar(row.total)} ${row.recommendation}` });
}
lines.push({ text: "", gap: 14 }, { text: "Factors Tested", size: 14, font: "F2", gap: 20 });
for (const factor of ["Requirements correctness", "Test/eval quality", "Debugging discipline", "Code quality", "AI collaboration", "Production readiness", "Communication", "Proctoring integrity"]) {
  lines.push({ text: `- ${factor}` });
}

await mkdir("reports", { recursive: true });
const output = path.resolve("reports", `${runId}-cohort-report.pdf`);
await writeFile(output, buildPdf(lines));

console.log(JSON.stringify({ runId, output, rows }, null, 2));
await db.$disconnect();
