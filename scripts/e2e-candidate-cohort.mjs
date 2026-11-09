import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { PrismaClient } from "@prisma/client";
import { createInviteToken, hashInviteToken } from "../app/lib/domain/invites.ts";
import { aggregateScore, defaultRubric } from "../app/lib/domain/score.ts";
import { generateAssessmentFromJd } from "../app/lib/assessment-generator.ts";

const db = new PrismaClient();
const appUrl = process.env.E2E_APP_URL ?? "http://localhost:3001";
const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const runId = `e2e-${Date.now().toString(36)}`;
const outputRoot = path.resolve("reports", runId);
const screenshotRoot = path.join(outputRoot, "screens");

const candidateProfiles = [
  ["Junior", "Asha Junior", "ships a first pass, light verification"],
  ["Junior", "Ben Junior", "gets the workflow running but misses edge cases"],
  ["Junior", "Casey Junior", "struggles with hidden eval quality"],
  ["Mid", "Devi Mid", "solid plan and reasonable checkpoints"],
  ["Mid", "Evan Mid", "good debugging trail, average UX polish"],
  ["Mid", "Farah Mid", "strong eval thinking and clear notes"],
  ["Senior SDE2", "Gita Senior", "excellent iteration and risk handling"],
  ["Senior SDE2", "Hari Senior", "strong architecture and verification"],
  ["Senior SDE2", "Ira Senior", "excellent product judgment and evals"],
  ["SDE2", "Jules SDE2", "balanced SDE2-level execution"]
];

function waitForSocketOpen(socket, timeoutMs = 5_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Timed out waiting for Chrome DevTools socket")), timeoutMs);
    socket.addEventListener("open", () => {
      clearTimeout(timer);
      resolve();
    });
    socket.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("Unable to open Chrome DevTools socket"));
    });
  });
}

async function screenshot(url, file, size = "1440,1000") {
  if (!existsSync(chromePath)) return { ok: false, error: `Chrome not found at ${chromePath}` };
  const [width, height] = size.split(",").map((value) => Number.parseInt(value, 10));
  const userDataDir = await mkdtemp(path.join(tmpdir(), "proofwork-e2e-chrome-"));
  const child = spawn(chromePath, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-first-run",
    "--no-default-browser-check",
    `--window-size=${width},${height}`,
    `--user-data-dir=${userDataDir}`,
    "--remote-debugging-port=0",
    "about:blank"
  ], { stdio: ["ignore", "ignore", "pipe"] });

  try {
    let stderr = "";
    const wsUrl = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for Chrome DevTools URL. ${stderr}`)), 8_000);
      child.stderr?.on("data", (chunk) => {
        stderr += String(chunk);
        const match = stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.on("exit", (code) => {
        clearTimeout(timer);
        reject(new Error(`Chrome exited before screenshot with code ${code}. ${stderr}`));
      });
    });

    const socket = new WebSocket(wsUrl);
    await waitForSocketOpen(socket);

    let id = 0;
    const pending = new Map();
    let documentStatus = null;
    let documentUrl = null;
    let loadResolver = null;
    let pageSessionId = null;

    socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data.toString());
      if (message.id && pending.has(message.id)) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
        return;
      }

      if (message.sessionId === pageSessionId && message.method === "Network.responseReceived" && message.params?.type === "Document") {
        documentStatus = message.params.response.status;
        documentUrl = message.params.response.url;
      }

      if (message.sessionId === pageSessionId && message.method === "Page.loadEventFired" && loadResolver) {
        loadResolver();
        loadResolver = null;
      }
    });

    function send(method, params = {}, sessionId = null) {
      const messageId = (id += 1);
      const payload = JSON.stringify({ id: messageId, method, params, ...(sessionId ? { sessionId } : {}) });
      return new Promise((resolve, reject) => {
        pending.set(messageId, { resolve, reject });
        socket.send(payload);
      });
    }

    const target = await send("Target.createTarget", { url: "about:blank" });
    const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
    pageSessionId = attached.sessionId;

    await send("Page.enable", {}, pageSessionId);
    await send("Network.enable", {}, pageSessionId);
    await send(
      "Emulation.setDeviceMetricsOverride",
      { width, height, deviceScaleFactor: 1, mobile: false },
      pageSessionId
    );
    const navigation = await send("Page.navigate", { url }, pageSessionId);
    if (navigation.errorText) throw new Error(navigation.errorText);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out loading ${url}`)), 15_000);
      loadResolver = () => {
        clearTimeout(timer);
        resolve();
      };
    });

    const image = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true }, pageSessionId);
    await writeFile(file, Buffer.from(image.data, "base64"));
    await send("Target.closeTarget", { targetId: target.targetId }).catch(() => undefined);
    socket.close();

    const ok = typeof documentStatus === "number" && documentStatus >= 200 && documentStatus < 400;
    return {
      ok,
      status: documentStatus,
      error: ok ? null : `Screenshot captured unhealthy page status=${documentStatus ?? "unknown"} url=${documentUrl ?? url}`
    };
  } catch (err) {
    return { ok: false, status: null, error: err instanceof Error ? err.message : String(err) };
  } finally {
    child.kill("SIGTERM");
    await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function captureScreenshot(result, url, file, label) {
  result.screenshots.push(file);
  let captured = await screenshot(url, file);
  for (const delayMs of [1200, 2400]) {
    if (captured.ok) break;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    captured = await screenshot(url, file);
  }
  result.checks.push(`${label} screenshot status=${captured.status ?? "unknown"}`);
  if (!captured.ok) {
    throw new Error(`${label} screenshot failed: ${captured.error}`);
  }
}

async function postJson(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {})
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `POST ${url} failed with ${response.status}`);
  return payload;
}

async function getJson(url) {
  const response = await fetch(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error ?? `GET ${url} failed with ${response.status}`);
  return payload;
}

async function pollAttempt(token, desiredStatuses, timeoutMs = 20_000) {
  const started = Date.now();
  let last = null;
  while (Date.now() - started < timeoutMs) {
    const payload = await getJson(`${appUrl}/api/candidate/${token}/attempt`);
    last = payload.attempt;
    if (last && desiredStatuses.includes(last.status)) return last;
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  throw new Error(`Timed out waiting for ${desiredStatuses.join("/")} after status ${last?.status ?? "none"}`);
}

async function ensureTemplate(organizationId) {
  const generated = generateAssessmentFromJd({
    roleTitle: "Software Development Engineer",
    level: "SDE2",
    jobDescription:
      "SDE2 engineer who can build an AI-native product, use coding agents responsibly, create PLAN.md, commit checkpoints, add tests/evals, and communicate tradeoffs.",
    durationMin: 180,
    proctoringEnabled: true,
    assessmentIdea: "product-build"
  });

  return db.assessmentTemplate.upsert({
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
      rubric: generated.rubric
    },
    create: {
      id: "sde2-proofwork-typescript",
      organizationId,
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
}

async function createInvite({ organizationId, templateId, name, email }) {
  const token = createInviteToken();
  const candidate = await db.candidate.create({ data: { name, email } });
  await db.invitation.create({
    data: {
      organizationId,
      templateId,
      candidateId: candidate.id,
      tokenHash: hashInviteToken(token),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    }
  });
  return { token, candidate };
}

function artifactSignal(artifacts, label) {
  const artifact = artifacts.find((item) => item.label === label);
  if (!artifact?.metadata || typeof artifact.metadata !== "object") return "";
  return String(artifact.metadata.stdout ?? artifact.metadata.stderr ?? "");
}

await mkdir(screenshotRoot, { recursive: true });

const organization = await db.organization.upsert({
  where: { slug: "default" },
  update: {},
  create: { name: "Default Hiring Team", slug: "default", planName: "Free trial", evaluationCredits: 5 }
});
const template = await ensureTemplate(organization.id);

const results = [];

for (let index = 0; index < candidateProfiles.length; index += 1) {
  const [level, baseName, persona] = candidateProfiles[index];
  const name = `${baseName} ${runId}`;
  const email = `${runId}-${index + 1}@example.com`;
  const slug = String(index + 1).padStart(2, "0");
  const candidateDir = path.join(screenshotRoot, `${slug}-${baseName.toLowerCase().replaceAll(" ", "-")}`);
  await mkdir(candidateDir, { recursive: true });

  const candidateResult = {
    index: index + 1,
    name,
    email,
    level,
    persona,
    screenshots: [],
    checks: [],
    errors: []
  };

  try {
    const { token } = await createInvite({ organizationId: organization.id, templateId: template.id, name, email });
    const assessmentUrl = `${appUrl}/assessment/${token}`;

    const preStart = path.join(candidateDir, "01-pre-start.png");
    await captureScreenshot(candidateResult, assessmentUrl, preStart, "pre-start");

    const startPayload = await postJson(`${appUrl}/api/candidate/${token}/start`, {
      proctoringPreflight: { camera: true, screen: true, recording: true }
    });
    candidateResult.checks.push(`start status=${startPayload.attempt?.status}`);

    const readyAttempt = await pollAttempt(token, ["in_progress", "failed"], 25_000);
    candidateResult.checks.push(`ready status=${readyAttempt.status}`);
    if (readyAttempt.status === "failed") throw new Error("Workspace provisioning failed");

    const readyShot = path.join(candidateDir, "02-workspace-ready.png");
    await captureScreenshot(candidateResult, assessmentUrl, readyShot, "workspace-ready");

    await postJson(`${appUrl}/api/candidate/${token}/proctoring`, {
      eventType: "camera_active",
      details: { simulated: true, cohortRun: runId }
    });
    await postJson(`${appUrl}/api/candidate/${token}/proctoring`, {
      eventType: "screen_share_active",
      details: { simulated: true, cohortRun: runId }
    });

    const submitPayload = await postJson(`${appUrl}/api/candidate/${token}/submit`, {
      finalNotes: `${level} candidate simulation. Persona: ${persona}. Created PLAN.md, worked in checkpoint commits, used OpenCode with review, ran tests/evals, and documented tradeoffs.`
    });
    candidateResult.checks.push(`submit returned status=${submitPayload.attempt?.status}`);

    const reviewedAttempt = await pollAttempt(token, ["reviewed", "failed", "evaluating"], 25_000);
    candidateResult.checks.push(`final status=${reviewedAttempt.status}`);

    const lockedShot = path.join(candidateDir, "03-submitted-locked.png");
    await captureScreenshot(candidateResult, assessmentUrl, lockedShot, "submitted-locked");

    const attempt = await db.attempt.findUniqueOrThrow({
      where: { id: reviewedAttempt.id },
      include: { scorecard: true, artifacts: true, events: true }
    });

    const plan = artifactSignal(attempt.artifacts, "Plan evidence");
    const commits = artifactSignal(attempt.artifacts, "Commit history");
    const commitEvals = artifactSignal(attempt.artifacts, "Commit checkpoint evals");
    candidateResult.score = attempt.scorecard
      ? attempt.scorecard.reviewerOverrideScore ??
        aggregateScore({
          requirements: attempt.scorecard.requirements,
          testAndEvalQuality: attempt.scorecard.testAndEvalQuality,
          debuggingDiscipline: attempt.scorecard.debuggingDiscipline,
          codeQuality: attempt.scorecard.codeQuality,
          aiCollaboration: attempt.scorecard.aiCollaboration,
          productionReadiness: attempt.scorecard.productionReadiness,
          communication: attempt.scorecard.communication
        })
      : null;
    candidateResult.status = attempt.status;
    candidateResult.artifactLabels = attempt.artifacts.map((artifact) => artifact.label);
    candidateResult.workLoop = {
      hasPlan: /PLAN\.md found/i.test(plan),
      commitCount: (commits.match(/^commit=/gm) ?? []).length,
      hasCommitEvals: /=== commit /i.test(commitEvals)
    };
    candidateResult.proctoringEvents = attempt.events.filter((event) => event.type.startsWith("proctoring.")).length;
  } catch (err) {
    candidateResult.errors.push(err instanceof Error ? err.message : String(err));
  }

  results.push(candidateResult);
}

const failures = results.filter((result) => result.errors.length > 0);
const missingWorkLoop = results.filter(
  (result) => !result.workLoop || !result.workLoop.hasPlan || result.workLoop.commitCount < 3 || !result.workLoop.hasCommitEvals
);

const report = {
  runId,
  appUrl,
  provider: process.env.WORKSPACE_PROVIDER ?? "default",
  generatedAt: new Date().toISOString(),
  totalCandidates: results.length,
  failures: failures.length,
  missingWorkLoopEvidence: missingWorkLoop.length,
  results
};

await writeFile(path.join(outputRoot, "report.json"), JSON.stringify(report, null, 2));
await writeFile(
  path.join(outputRoot, "report.md"),
  [
    `# Proofwork E2E Candidate Cohort`,
    ``,
    `Run: \`${runId}\``,
    `Candidates: ${results.length}`,
    `Failures: ${failures.length}`,
    `Missing work-loop evidence: ${missingWorkLoop.length}`,
    ``,
    `| # | Candidate | Status | Score | Work loop | Proctoring | Errors |`,
    `|---|---|---|---:|---|---:|---|`,
    ...results.map((result) => {
      const workLoop = result.workLoop
        ? `plan=${result.workLoop.hasPlan}, commits=${result.workLoop.commitCount}, commitEvals=${result.workLoop.hasCommitEvals}`
        : "missing";
      return `| ${result.index} | ${result.name} | ${result.status ?? "unknown"} | ${result.score ?? "n/a"} | ${workLoop} | ${
        result.proctoringEvents ?? 0
      } | ${result.errors.join("; ") || "none"} |`;
    }),
    ``,
    `Screenshots are under \`${screenshotRoot}\`.`
  ].join("\n")
);

console.log(JSON.stringify(report, null, 2));
await db.$disconnect();

if (failures.length > 0 || missingWorkLoop.length > 0) {
  process.exitCode = 1;
}
