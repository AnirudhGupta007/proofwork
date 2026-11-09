import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const WebSocket = require("ws");

type PromptStep = {
  label: string;
  prompt: string;
  waitMs: number;
  idleMs: number;
};

function stripAnsi(value: string) {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[()][A-Za-z0-9]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForIdle(getLastMessageAt: () => number, minWaitMs: number, idleMs: number) {
  const started = Date.now();
  while (Date.now() - started < minWaitMs) await delay(1000);
  while (Date.now() - getLastMessageAt() < idleMs) await delay(1000);
}

async function main() {
  const terminalUrl = process.argv[2];
  if (!terminalUrl) throw new Error("Usage: node --experimental-strip-types scripts/drive-opencode-terminal.ts <terminalUrl>");
  const wsUrl = terminalUrl.replace(/^http:/, "ws:").replace(/^https:/, "wss:").replace(/\/$/, "") + "/terminal";
  const ws = new WebSocket(wsUrl, { headers: { Origin: "http://localhost:3001" } });
  let log = "";
  let lastMessageAt = Date.now();

  ws.on("message", (chunk: Buffer) => {
    lastMessageAt = Date.now();
    log += chunk.toString();
  });

  await new Promise<void>((resolve, reject) => {
    ws.on("open", () => {
      ws.send(JSON.stringify({ type: "resize", cols: 130, rows: 42 }));
      resolve();
    });
    ws.on("error", reject);
  });

  const steps: PromptStep[] = [
    {
      label: "plan",
      waitMs: 75_000,
      idleMs: 20_000,
      prompt:
        "Act as the candidate. Read README.md, TASK.md, EVALS.md, and src/sample-data.mjs. Do not implement yet. Create a concise PLAN.md with assumptions, scoped milestones, rejected scope, tests/evals to run, and commit it as the first meaningful checkpoint.",
    },
    {
      label: "implementation",
      waitMs: 150_000,
      idleMs: 25_000,
      prompt:
        "Now implement the smallest useful Support Triage Copilot slice from the plan. Focus on a clear feedback/support panel, source evidence, top problem, chosen scope, rejected scope, and success metric. Keep changes maintainable. Run npm test and commit this implementation as the second meaningful checkpoint.",
    },
    {
      label: "eval-polish",
      waitMs: 160_000,
      idleMs: 25_000,
      prompt:
        "Add or improve a lightweight deterministic eval/test that would fail for shallow summarization or overbuilding. Polish any obvious empty/loading/error state if needed, run npm test again, write ITERATION.md or final verification notes with tradeoffs and risks, then commit as the third meaningful checkpoint.",
    }
  ];

  for (const step of steps) {
    log += `\n\n===== PROOFWORK DRIVER STEP: ${step.label} =====\n`;
    ws.send(JSON.stringify({ type: "input", data: `${step.prompt}\r` }));
    await waitForIdle(() => lastMessageAt, step.waitMs, step.idleMs);
  }

  await writeFile("tmp/opencode-terminal-e2e.log", stripAnsi(log));
  ws.close();
  console.log(stripAnsi(log).slice(-4000));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
