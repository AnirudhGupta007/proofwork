import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import type { Prisma } from "@prisma/client";

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
};

type ChromePage = {
  child: ChildProcess;
  userDataDir: string;
  socket: WebSocket;
  sessionId: string;
  targetId: string;
  send: (method: string, params?: Record<string, unknown>) => Promise<any>;
  close: () => Promise<void>;
};

const chromePath = process.env.CHROME_PATH ?? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const appUrl = process.env.E2E_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001";
const outputRoot = path.resolve("reports", `human-terminal-browser-${new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}`);
const startIndex = Math.max(1, Number(process.env.START_INDEX ?? "1"));

const roleScenarios = [
  ["SDE1 Product Engineer", "SDE1", "small scoped implementation, clear plan, basic verification"],
  ["SDE2 Product Engineer", "SDE2", "ambiguous feature ownership, eval quality, terminal-first agent use"],
  ["Senior SDE Product Engineer", "Senior SDE", "architecture judgment, scope control, launch-risk thinking"],
  ["Frontend Engineer", "Mid", "UI state, browser verification, accessibility judgment"],
  ["Backend Platform Engineer", "Senior SDE2", "API behavior, tests, reliability, operational tradeoffs"],
  ["AI Product Engineer", "SDE2", "assistant behavior, prompt quality, guardrails, eval loop"],
  ["Data Engineer", "SDE2", "data validation, transformation correctness, quality checks"],
  ["QA Automation Engineer", "Mid", "bug isolation, test design, regression confidence"],
  ["Product Manager, AI Workflows", "Product Manager", "product judgment, quality bar, launch decision"],
  ["UX Engineer", "SDE2", "product taste, interaction design, frontend polish"]
] as const;

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

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stamp() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function waitForSocketOpen(socket: WebSocket, timeoutMs = 8_000) {
  return new Promise<void>((resolve, reject) => {
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

async function launchChrome(width = 1440, height = 1000): Promise<ChromePage> {
  if (!existsSync(chromePath)) throw new Error(`Chrome not found at ${chromePath}`);

  const userDataDir = await mkdtemp(path.join(tmpdir(), "proofwork-human-browser-"));
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

  let stderr = "";
  const wsUrl = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timed out waiting for Chrome DevTools URL. ${stderr}`)), 10_000);
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
      reject(new Error(`Chrome exited before DevTools was ready with code ${code}. ${stderr}`));
    });
  });

  const socket = new WebSocket(wsUrl);
  await waitForSocketOpen(socket);

  let messageId = 0;
  const pending = new Map<number, PendingRequest>();
  let pageSessionId = "";
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data.toString());
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id)!;
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    }
  });

  function sendRaw(method: string, params: Record<string, unknown> = {}, sessionId?: string) {
    const id = (messageId += 1);
    const payload = JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) });
    return new Promise<any>((resolve, reject) => {
      pending.set(id, { resolve, reject });
      socket.send(payload);
    });
  }

  const target = await sendRaw("Target.createTarget", { url: "about:blank" });
  const attached = await sendRaw("Target.attachToTarget", { targetId: target.targetId, flatten: true });
  pageSessionId = attached.sessionId;
  await sendRaw("Page.enable", {}, pageSessionId);
  await sendRaw("Runtime.enable", {}, pageSessionId);
  await sendRaw("Input.setIgnoreInputEvents", { ignore: false }, pageSessionId);

  return {
    child,
    userDataDir,
    socket,
    sessionId: pageSessionId,
    targetId: target.targetId,
    send: (method, params = {}) => sendRaw(method, params, pageSessionId),
    close: async () => {
      await sendRaw("Target.closeTarget", { targetId: target.targetId }).catch(() => undefined);
      socket.close();
      child.kill("SIGTERM");
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
    }
  };
}

async function navigate(page: ChromePage, url: string, timeoutMs = 30_000) {
  let loaded = false;
  const listener = (event: MessageEvent) => {
    const message = JSON.parse(event.data.toString());
    if (message.sessionId === page.sessionId && message.method === "Page.loadEventFired") loaded = true;
  };
  page.socket.addEventListener("message", listener);
  await page.send("Page.navigate", { url });
  const startedAt = Date.now();
  while (!loaded && Date.now() - startedAt < timeoutMs) await sleep(200);
  page.socket.removeEventListener("message", listener);
  if (!loaded) throw new Error(`Timed out loading ${url}`);
}

async function evaluate(page: ChromePage, expression: string) {
  const result = await page.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text ?? "Runtime evaluation failed");
  return result.result?.value;
}

async function screenshot(page: ChromePage, filePath: string) {
  const image = await page.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true });
  await writeFile(filePath, Buffer.from(image.data, "base64"));
}

async function clickText(page: ChromePage, text: string) {
  return evaluate(
    page,
    `(() => {
      const button = [...document.querySelectorAll('button')].find((node) => node.textContent && node.textContent.includes(${JSON.stringify(text)}));
      if (!button) return false;
      button.click();
      return true;
    })()`
  );
}

async function focusTerminal(page: ChromePage) {
  return evaluate(
    page,
    `(() => {
      const input = document.querySelector('.xterm-helper-textarea, textarea, [aria-label="Terminal input"]');
      if (!input) return false;
      input.focus();
      return true;
    })()`
  );
}

async function typeHuman(page: ChromePage, text: string, wpm: number) {
  const charsPerMinute = wpm * 5;
  const meanDelay = Math.max(18, Math.round(60_000 / charsPerMinute));
  const latencies: number[] = [];

  for (const char of text) {
    const startedAt = Date.now();
    await page.send("Input.insertText", { text: char });
    const elapsed = Date.now() - startedAt;
    latencies.push(elapsed);
    const jitter = Math.floor(Math.random() * meanDelay * 0.75);
    await sleep(meanDelay + jitter);
  }
  await page.send("Input.dispatchKeyEvent", { type: "keyDown", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: "Enter", code: "Enter" });
  await page.send("Input.dispatchKeyEvent", { type: "keyUp", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13, key: "Enter", code: "Enter" });
  return {
    chars: text.length,
    wpm,
    keyDispatchP50Ms: percentile(latencies, 50),
    keyDispatchP95Ms: percentile(latencies, 95)
  };
}

function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

async function waitFor<T>(label: string, fn: () => Promise<T | null | undefined>, timeoutMs = 900_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const value = await fn();
    if (value) return value;
    await sleep(1500);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

await loadDotEnv();
delete process.env.INNGEST_EVENT_KEY;
process.env.WORKSPACE_PROVIDER = "daytona";
await mkdir(outputRoot, { recursive: true });

const { db } = await import("../app/lib/db.ts");
const { generateAssessmentFromJd } = await import("../app/lib/assessment-generator.ts");
const { defaultRubric } = await import("../app/lib/domain/score.ts");
const { addMinutes } = await import("../app/lib/domain/time.ts");
const { createInviteToken, hashInviteToken } = await import("../app/lib/domain/invites.ts");

const runStamp = stamp();
const organization = await db.organization.upsert({
  where: { slug: "proofwork-human-terminal-browser" },
  update: { evaluationCredits: { increment: roleScenarios.length } },
  create: {
    name: "Proofwork Human Terminal Browser",
    slug: "proofwork-human-terminal-browser",
    planName: "Human browser cohort",
    evaluationCredits: roleScenarios.length + 5,
    onboardedAt: new Date()
  }
});

const results = [];

for (const [index, [roleTitle, level, focus]] of roleScenarios.entries()) {
  if (index + 1 < startIndex) continue;

  const token = createInviteToken();
  const candidateName = `${roleTitle} Human Browser ${runStamp}-${index + 1}`;
  const scenarioDir = path.join(outputRoot, String(index + 1).padStart(2, "0"));
  await mkdir(scenarioDir, { recursive: true });
  const result: Record<string, unknown> = {
    index: index + 1,
    roleTitle,
    level,
    focus,
    candidateName,
    token,
    status: "created",
    issues: []
  };

  let page: ChromePage | null = null;
  try {
    const generated = generateAssessmentFromJd({
      roleTitle,
      level,
      jobDescription: `Assess ${roleTitle}. The candidate should demonstrate ${focus}.`,
      assessmentPrompt: `Test ${focus} using the terminal-first OpenCode CLI.`,
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
        proctoringConfig: { enabled: false },
        rubric: defaultRubric
      }
    });
    const candidate = await db.candidate.create({ data: { name: candidateName, email: `human-browser-${runStamp}-${index + 1}@example.com` } });
    await db.invitation.create({
      data: {
        organizationId: organization.id,
        templateId: template.id,
        candidateId: candidate.id,
        tokenHash: hashInviteToken(token),
        creditCost: 1,
        expiresAt: addMinutes(new Date(), 7 * 24 * 60)
      }
    });

    page = await launchChrome();
    const inviteUrl = `${appUrl}/assessment/${token}`;
    result.inviteUrl = inviteUrl;
    await navigate(page, inviteUrl);
    await screenshot(page, path.join(scenarioDir, "01-pre-start.png"));
    await clickText(page, "Start assessment");
    result.status = "started_in_browser";

    const ready = await waitFor("workspace ready", async () => {
      const attempt = await db.attempt.findFirst({
        where: { invitation: { tokenHash: hashInviteToken(token) } },
        include: { workspace: true }
      });
      if (attempt?.status === "failed") return attempt;
      return attempt?.status === "in_progress" && attempt.workspace ? attempt : null;
    });
    result.attemptId = ready.id;
    if (ready.status === "failed") throw new Error("Workspace provisioning failed before terminal became available");
    result.externalId = ready.workspace?.externalId;
    result.provisioningTimings = ready.workspace?.metadata && typeof ready.workspace.metadata === "object"
      ? (ready.workspace.metadata as Record<string, unknown>).provisioningTimings
      : null;

    const terminalUrl = ready.workspace?.metadata && typeof ready.workspace.metadata === "object"
      ? String((ready.workspace.metadata as Record<string, unknown>).terminalUrl ?? "")
      : "";
    if (!terminalUrl) throw new Error("No terminal URL on ready workspace");

    await navigate(page, terminalUrl);
    await clickText(page, "I Understand");
    await sleep(1600);
    await screenshot(page, path.join(scenarioDir, "02-terminal-ready.png"));
    const focused = await focusTerminal(page);
    if (!focused) throw new Error("Unable to focus terminal input");

    const thinkMs = 2500 + Math.floor(Math.random() * 5500);
    await sleep(thinkMs);
    const prompt = [
      "Inspect the repo and act like a careful candidate.",
      "Create PLAN.md first, then make one small useful change for this assessment.",
      "Add or improve a lightweight test/eval, run npm test, commit meaningful checkpoints, and keep the scope tight.",
      `Role focus: ${focus}.`
    ].join(" ");
    result.terminalTyping = await typeHuman(page, prompt, 48 + Math.floor(Math.random() * 18));
    result.thinkingDelayMs = thinkMs;
    result.status = "typed_prompt_in_terminal";
    await screenshot(page, path.join(scenarioDir, "03-after-human-prompt.png"));

    await sleep(45_000);
    await screenshot(page, path.join(scenarioDir, "04-after-agent-wait.png"));

    await navigate(page, inviteUrl);
    await sleep(800);
    await evaluate(page, `(() => { const textarea = document.querySelector('textarea'); if (textarea) { textarea.value = ${JSON.stringify(`Submitted after browser-only terminal prompt. Focus: ${focus}. Human-style typing and thinking latency were simulated.`)}; textarea.dispatchEvent(new Event('input', { bubbles: true })); } return Boolean(textarea); })()`);
    await clickText(page, "Submit assessment");
    await waitFor("browser submission accepted", async () => {
      const attempt = await db.attempt.findUnique({ where: { id: ready.id } });
      return attempt && !["in_progress", "workspace_provisioning"].includes(attempt.status) ? attempt : null;
    }, 90_000);
    result.status = "submitted_in_browser";
    await screenshot(page, path.join(scenarioDir, "05-submitted.png"));

    const evaluated = await waitFor("evaluation and workspace cleanup", async () => {
      const attempt = await db.attempt.findUnique({
        where: { id: ready.id },
        include: { workspace: true, scorecard: true, evalRuns: { orderBy: { createdAt: "desc" }, take: 1 } }
      });
      if (!attempt) return null;
      const terminalState = ["reviewed", "failed"].includes(attempt.status);
      const workspaceCleaned = !attempt.workspace || ["destroyed", "failed"].includes(attempt.workspace.status);
      return terminalState && workspaceCleaned ? attempt : null;
    }, 420_000);
    result.finalAttemptStatus = evaluated.status;
    result.finalWorkspaceStatus = evaluated.workspace?.status ?? "none";
    result.evalStatus = evaluated.evalRuns[0]?.status ?? "none";
    result.hasScorecard = Boolean(evaluated.scorecard);
    result.status = evaluated.status === "reviewed" ? "reviewed_after_browser_submit" : "failed_after_browser_submit";
  } catch (error) {
    (result.issues as string[]).push(error instanceof Error ? error.message : String(error));
    result.status = "failed";
  } finally {
    if (page) await page.close();
  }

  results.push(result);
  await writeFile(path.join(outputRoot, "progress.json"), JSON.stringify({ runStamp, results }, null, 2));
}

await writeFile(path.join(outputRoot, "report.json"), JSON.stringify({ runStamp, appUrl, outputRoot, results }, null, 2));
console.log(JSON.stringify({ runStamp, appUrl, outputRoot, results }, null, 2));
await db.$disconnect();
