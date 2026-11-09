import { readFile } from "node:fs/promises";
import path from "node:path";

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

const attemptIds = process.argv.slice(2);
if (attemptIds.length === 0) throw new Error("Usage: npx tsx scripts/rerun-inline-eval.ts <attemptId...>");

await loadDotEnv();
delete process.env.INNGEST_EVENT_KEY;
const { evaluateAttemptInline } = await import("../app/lib/local-jobs.ts");
const { db } = await import("../app/lib/db.ts");

for (const attemptId of attemptIds) {
  await evaluateAttemptInline(attemptId);
  const attempt = await db.attempt.findUnique({ where: { id: attemptId }, include: { scorecard: true, candidate: true, template: true } });
  console.log(
    JSON.stringify({
      attemptId,
      candidate: attempt?.candidate.name,
      level: attempt?.template.level,
      status: attempt?.status,
      scorecard: attempt?.scorecard
    })
  );
}

await db.$disconnect();
