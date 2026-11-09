import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Prisma } from "@prisma/client";

function stamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

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

const scenarios = [
  {
    roleTitle: "SDE 1 Product Engineer",
    level: "SDE1",
    prompt: "Test codebase navigation, small feature implementation, visible tests, basic eval thinking, and concise communication.",
    jd: "Entry-level software engineer joining a product team. They should understand an existing TypeScript app, ship a focused UI/API change, update tests, and explain verification."
  },
  {
    roleTitle: "SDE 2 Product Engineer",
    level: "SDE2",
    prompt: "Test end-to-end implementation, AI-agent judgment, planning, eval quality, debugging discipline, and production tradeoffs.",
    jd: "Mid-level product engineer expected to own ambiguous features end-to-end with thoughtful AI-agent use, tests/evals, meaningful commits, and tradeoff communication."
  },
  {
    roleTitle: "Senior SDE Product Engineer",
    level: "Senior SDE",
    prompt: "Test product judgment, architecture judgment, what-not-to-build decisions, agent orchestration, verification depth, and launch readiness.",
    jd: "Senior engineer who can operate as a one-person product team, turn messy feedback into a focused product slice, orchestrate agents, improve evals, and identify launch risks."
  }
];

await loadDotEnv();
const { db } = await import("../app/lib/db.ts");
const { generateAssessmentFromJd } = await import("../app/lib/assessment-generator.ts");
const { defaultRubric } = await import("../app/lib/domain/score.ts");
const { addMinutes } = await import("../app/lib/domain/time.ts");
const { createInviteToken, hashInviteToken } = await import("../app/lib/domain/invites.ts");

const runStamp = stamp();
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
const outputDir = path.join(process.cwd(), "reports", `ui-sde-browser-${runStamp}`);
await mkdir(outputDir, { recursive: true });

const organization = await db.organization.upsert({
  where: { slug: "proofwork-ui-sde-browser" },
  update: { evaluationCredits: { increment: scenarios.length } },
  create: {
    name: "Proofwork UI SDE Browser",
    slug: "proofwork-ui-sde-browser",
    planName: "UI browser test",
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
    proctoringEnabled: false
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

  const candidateName = `UI ${scenario.level} Candidate ${runStamp}`;
  const candidate = await db.candidate.upsert({
    where: { email_name: { email: "reports@example.com", name: candidateName } },
    update: {},
    create: { email: "reports@example.com", name: candidateName }
  });

  const token = createInviteToken();
  const invitation = await db.invitation.create({
    data: {
      organizationId: organization.id,
      templateId: template.id,
      candidateId: candidate.id,
      tokenHash: hashInviteToken(token),
      creditCost: 1,
      expiresAt: addMinutes(new Date(), 7 * 24 * 60)
    }
  });

  results.push({
    index: index + 1,
    roleTitle: scenario.roleTitle,
    level: scenario.level,
    candidateName,
    invitationId: invitation.id,
    templateId: template.id,
    inviteUrl: `${appUrl}/assessment/${token}`
  });
}

const summaryPath = path.join(outputDir, "setup-summary.json");
await writeFile(summaryPath, JSON.stringify({ runStamp, outputDir, results }, null, 2));
console.log(JSON.stringify({ runStamp, outputDir, summaryPath, results }, null, 2));
await db.$disconnect();
