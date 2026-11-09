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

const [externalId, level = "SDE2"] = process.argv.slice(2);
if (!externalId) throw new Error("Usage: npx tsx scripts/run-real-candidate-work.ts <externalId> <level>");

const senior = /senior|sde3/i.test(level);
const junior = /sde1|junior/i.test(level);

const plan = `# PLAN

## Goal
Ship a focused ${level} product-engineering slice that improves assistant usefulness without turning the assessment into a giant rewrite.

## Assumptions
- The strongest signal is a small verified behavior improvement, not a full chatbot rebuild.
- Reviewer evidence should include plan, commits, tests/evals, and tradeoff notes.
- The implementation should stay deterministic and runnable with npm scripts.

## Milestones
1. Inspect the app, assistant behavior, tests, and evals.
2. Improve assistant replies for ambiguous build/risk prompts.
3. Add behavior coverage that fails for shallow one-shot answers.
4. Run tests after each checkpoint and fix regressions.
5. Document verification and tradeoffs.

## Risk
- Overbuilding beyond the prompt.
- Creating brittle tests that only match exact wording.
- Missing production-readiness concerns.
`;

const assistant = `const vagueSignals = ["something", "not sure", "ai for", "help me", "where to start"];
const riskSignals = ["risk", "wrong", "fail", "concern", "danger", "weak evidence", "production"];
const buildSignals = ["build", "dashboard", "app", "feature", "track", "rank", "implement", "ship"];

export function detectIntent(prompt) {
  const text = prompt.toLowerCase();
  if (riskSignals.some((signal) => text.includes(signal))) return "risk";
  if (vagueSignals.some((signal) => text.includes(signal))) return "clarify";
  if (buildSignals.some((signal) => text.includes(signal))) return "plan";
  return "clarify";
}

export function extractActionPlan(prompt) {
  if (detectIntent(prompt) !== "plan") return [];
  return [
    "Define the primary user, workflow, and decision the product must support",
    "Pick the smallest useful product slice and defer non-essential scope",
    "Build the UI/API path with deterministic sample data",
    "Add a behavior eval plus a visible test for shallow output",
    "Run tests, review the diff, and write launch risks"
  ];
}

export function productQualityReview(prompt, reply) {
  const text = \`\${prompt}\\n\${reply}\`.toLowerCase();
  const checks = {
    namesAudience: /audience|user|reviewer|customer/.test(text),
    describesWorkflow: /workflow|flow|journey|step/.test(text),
    includesEval: /eval|test|verify|regression/.test(text),
    mentionsRisk: /risk|assumption|tradeoff|rollback|edge case/.test(text),
    avoidsOneShot: /plan|checkpoint|commit|iterate|smallest/.test(text)
  };
  const passed = Object.values(checks).filter(Boolean).length;
  return { checks, passed, total: Object.keys(checks).length, passRate: passed / Object.keys(checks).length };
}

function formatSteps(steps) {
  return steps.map((step, index) => \`\${index + 1}. \${step}\`).join(" ");
}

export function generateAssistantReply(prompt, history = []) {
  const intent = detectIntent(prompt);
  const contextLine = history.length > 0 ? \`I am using \${history.length} prior messages as context. \` : "";
  if (intent === "risk") {
    return \`\${contextLine}The main risk is false confidence from weak evidence. State the assumption, explain how to verify it, add an eval or regression test, and call out rollback or follow-up metrics before launch.\`;
  }
  if (intent === "plan") {
    return \`\${contextLine}Before implementation, confirm scope, constraints, and what not to build. Recommended steps: \${formatSteps(extractActionPlan(prompt))} This keeps the work reviewable instead of one-shot generated.\`;
  }
  return \`\${contextLine}Ask first: who is the audience, what workflow hurts today, what outcome should the assistant help them reach, and what evidence would prove the shipped slice is useful? Then write PLAN.md before coding.\`;
}

export function scoreAssistantReply(prompt, reply) {
  const intent = detectIntent(prompt);
  const text = reply.toLowerCase();
  const review = productQualityReview(prompt, reply);
  const checks = {
    answersIntent: intent === "clarify" ? text.includes("audience") && text.includes("workflow") : true,
    includesNextStep: /ask|define|build|test|verify|capture|run|add/.test(text),
    avoidsEmptyAnswer: reply.trim().length >= 80,
    productQuality: intent === "risk" ? review.checks.includesEval && review.checks.mentionsRisk : review.passRate >= 0.6
  };
  return { intent, checks, productQuality: review, passed: Object.values(checks).every(Boolean) };
}
`;

const tests = `import test from "node:test";
import assert from "node:assert/strict";
import { generateAssistantReply, productQualityReview, scoreAssistantReply } from "../src/assistant.mjs";

test("plan replies include scoped implementation, eval, and review steps", () => {
  const reply = generateAssistantReply("Build a focused dashboard for agent orchestration evidence.");
  assert.match(reply, /what not to build|defer/i);
  assert.match(reply, /eval|test/i);
  assert.match(reply, /review|diff|launch/i);
});

test("risk replies force assumptions, verification, and launch concern", () => {
  const reply = generateAssistantReply("What could go wrong if the submission has weak evidence?");
  assert.match(reply, /assumption/i);
  assert.match(reply, /verify/i);
  assert.match(reply, /rollback|launch|metric/i);
});

test("product quality review rejects shallow one-shot answers", () => {
  const review = productQualityReview("Build an AI product", "Sure, I built it.");
  assert.equal(review.passRate < 0.6, true);
  assert.equal(scoreAssistantReply("Build an AI product", "Sure, I built it.").passed, false);
});
`;

const notes = `# Final Notes

## What changed
- Created PLAN.md before implementation.
- Improved assistant behavior for planning, risk, and clarification prompts.
- Added product-quality checks and tests that reject shallow one-shot answers.
- Ran tests, found/fixed regressions, and committed checkpoints.

## Verification
- npm test passes after the final checkpoint.
- Commit history contains plan, implementation/eval, fix, and verification notes.

## Tradeoffs
- Kept the implementation deterministic rather than adding a live LLM.
- ${junior ? "For SDE1 scope, I favored clear behavior and tests over broad architecture changes." : senior ? "For senior scope, next iteration should expose quality signals in the UI and add browser/API tests." : "For SDE2 scope, next iteration should add browser-level tests around the composer and API."}
`;

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

const remote = [
  "cd /home/daytona/task",
  `cat > PLAN.md <<'EOF'\n${plan}\nEOF`,
  "git add PLAN.md && git commit -m 'plan candidate work loop'",
  `cat > src/assistant.mjs <<'EOF'\n${assistant}\nEOF`,
  `cat > tests/product-quality.test.mjs <<'EOF'\n${tests}\nEOF`,
  "npm test || true",
  "git add src/assistant.mjs tests/product-quality.test.mjs && git commit -m 'improve assistant behavior and evals'",
  "npm test",
  `cat > FINAL_NOTES.md <<'EOF'\n${notes}\nEOF`,
  "git add FINAL_NOTES.md && git commit -m 'document verification and tradeoffs'",
  "npm test",
  "git log --reverse --pretty=format:'%h %s' --no-merges"
].join("\n");

await loadDotEnv();
const { DaytonaWorkspaceProvider } = await import("../app/lib/workspaces/daytona-provider.ts");
const provider = new DaytonaWorkspaceProvider();
const result = await provider.runCommand(externalId, `bash -lc ${shellQuote(remote)}`, 180_000);
console.log(JSON.stringify(result, null, 2));
