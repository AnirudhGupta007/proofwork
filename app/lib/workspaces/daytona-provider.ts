import { readFile, readdir } from "fs/promises";
import { randomBytes } from "crypto";
import path from "path";
import { addMinutes } from "../domain/time.ts";
import { env } from "../env.ts";
import type { AttachWarmInput, CommandResult, WarmHandle, WarmInput, WorkspaceAssessmentContext, WorkspaceHandle, WorkspaceProvider, WorkspaceProvisionInput } from "./types";

type DaytonaSandbox = {
  id: string;
  process: {
    executeCommand: (command: string, cwd?: string, env?: Record<string, string>, timeout?: number) => Promise<unknown>;
  };
  fs: {
    uploadFiles: (files: Array<{ source: string | Buffer; destination: string }>, timeout?: number) => Promise<void>;
  };
  getWorkDir: () => Promise<string | undefined>;
  getSignedPreviewUrl: (port: number, expiresInSeconds?: number) => Promise<{ url: string }>;
};

type ProvisionTiming = {
  label: string;
  durationMs: number;
  exitCode?: number;
};

function outputToCommandResult(output: unknown): CommandResult {
  if (typeof output === "object" && output !== null) {
    const record = output as Record<string, unknown>;
    return {
      exitCode: Number(record.exitCode ?? record.exit_code ?? 0),
      stdout: String(record.stdout ?? record.result ?? ""),
      stderr: String(record.stderr ?? "")
    };
  }

  return {
    exitCode: 0,
    stdout: String(output ?? ""),
    stderr: ""
  };
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function timeoutSeconds(timeoutMs: number) {
  return Math.max(1, Math.ceil(timeoutMs / 1000));
}

function uniqueOrigins(origins: Array<string | undefined>) {
  const normalized = origins
    .filter((origin): origin is string => Boolean(origin))
    .map((origin) => {
      try {
        const parsed = new URL(origin);
        return parsed.origin;
      } catch {
        return null;
      }
    })
    .filter((origin): origin is string => Boolean(origin));

  return Array.from(new Set(normalized));
}

function isPlaceholderRepoUrl(repoUrl: string | null | undefined) {
  // Null / empty → no real repo, use local task-template/ baseline.
  // This is the canonical "placeholder" state after the
  // repoUrl-optional migration. The string variants below are kept
  // for back-compat until existing rows are migrated to null.
  if (!repoUrl || repoUrl.trim() === "") return true;
  if (repoUrl.startsWith("proofwork-generated://")) return true;

  try {
    const parsed = new URL(repoUrl);
    if (parsed.hostname === "github.com" && parsed.pathname.startsWith("/your-org/")) return true;
  } catch {
    // Fall through to the legacy substring checks for malformed placeholder values.
  }

  return (
    repoUrl.includes("your-org/sde2-proofwork-task") ||
    repoUrl.includes("your-org/support-ops-intelligence-studio") ||
    repoUrl.includes("your-org/clawchat-assessment") ||
    repoUrl.includes("your-org/one-person-product-team-assessment")
  );
}

async function listLocalTaskFiles(root: string, destinationRoot: string, current = root): Promise<Array<{ source: string; destination: string }>> {
  const entries = await readdir(current, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute);
      if (relative.split(path.sep).includes("hidden")) return [];
      if (entry.isDirectory()) return listLocalTaskFiles(root, destinationRoot, absolute);
      if (!entry.isFile()) return [];

      return [{ source: absolute, destination: path.posix.join(destinationRoot, relative.split(path.sep).join("/")) }];
    })
  );

  return files.flat();
}

function markdownList(items: string[] | undefined, fallback: string[]) {
  const source = items?.length ? items : fallback;
  return source.map((item) => `- ${item}`).join("\n");
}

function concreteAssignment(assessment: WorkspaceAssessmentContext) {
  const brief = oneLine(assessment.taskBrief, assessment.instructions.split("\n")[0] ?? "Build the selected assessment task.");
  const lower = `${assessment.title} ${brief} ${assessment.roleTitle ?? ""}`.toLowerCase();

  if (/reviewer|assessment reviewer|feedback triage panel|hiring manager/.test(lower)) {
    return {
      product: "Reviewer Feedback Triage Panel",
      problem:
        "Hiring teams receive messy candidate, interviewer, and hiring-manager feedback, but reviewers cannot quickly tell which comments need action, which are product gaps, and which are not actionable.",
      assignment:
        "Turn the starter app into a reviewer-facing Feedback Triage Panel. It should group feedback by assessment and candidate, show the source snippets behind each item, let reviewers classify items as bug, product gap, or not actionable, and keep the workflow focused instead of adding broad notification or bulk-editing features.",
      required: [
        "A reviewer dashboard view with feedback grouped by assessment or candidate.",
        "At least eight source snippets that remain visible while triaging.",
        "Status controls for bug, product gap, and not actionable.",
        "State or API behavior that persists triage status in the existing repo style.",
        "Empty, error, or no-actionable-feedback state.",
        "Tests or evals covering grouping, status changes, and shallow/overbroad triage."
      ],
      optional: [
        "A small feedback synthesis table mapping source snippets to product requirements.",
        "ITERATION.md describing one change after a reviewer complaint."
      ],
      supportSnippets: [
        {
          source: "Hiring manager note",
          text:
            "I cannot tell whether Priya's poor score is because the task was confusing or because she missed the core requirement."
        },
        {
          source: "Reviewer Slack",
          text:
            "Three candidates mention that the browser preview failed, but the report treats it like candidate performance. This needs action."
        },
        {
          source: "Interview debrief",
          text:
            "The candidate did strong planning, but the report only highlights tests. We need to tag this as a product gap in the scorecard."
        },
        {
          source: "Support ticket",
          text:
            "A reviewer marked 'no hire' because the final notes were thin, but the commit history shows real progress. Can the dashboard surface that evidence?"
        },
        {
          source: "Customer call",
          text:
            "Do not send me notifications for every comment. I just need a triage queue before the hiring committee meeting."
        },
        {
          source: "QA note",
          text:
            "The same camera warning appears across five attempts. That is likely a platform bug, not candidate behavior."
        },
        {
          source: "Recruiter feedback",
          text:
            "I need to know which comments require a task fix before inviting the next batch of candidates."
        },
        {
          source: "Engineer reviewer",
          text:
            "Bulk editing can wait. First make individual feedback items explainable and easy to classify."
        }
      ],
      usageSignals: [
        { label: "Reviewer comments without triage status", value: "64%" },
        { label: "Reports reopened before committee", value: "37%" },
        { label: "Most common unresolved label", value: "task unclear" },
        { label: "Requested first action", value: "classify feedback" }
      ]
    };
  }

  if (/messy feedback|feedback|one-person product|product slice|product team/.test(lower)) {
    return {
      product: "Feedback Triage Copilot",
      problem:
        "The starter app shows a generic AI assistant, but users are actually asking for help turning scattered support threads and product feedback into one clear next shipping decision.",
      assignment:
        "Turn the starter app into a focused Feedback Triage Copilot. It should help a product engineer review messy feedback, identify the top user problem, choose one scoped product improvement, reject distracting requests, and show evidence that the chosen slice is ready to ship.",
      required: [
        "A visible feedback/support panel with the provided snippets and usage signals.",
        "A clear first action for the user, such as Analyze feedback or Create shipping plan.",
        "An output that separates top problem, chosen scope, explicitly rejected scope, and success metric.",
        "At least one implemented product/UI improvement in the starter app.",
        "A deterministic test or eval that catches shallow summarization or one-shot overbuilding."
      ],
      optional: [
        "Telemetry-style event or checklist showing how the shipped slice would be measured.",
        "A lightweight prompt/eval harness for comparing weak versus strong assistant output."
      ],
      supportSnippets: [
        {
          source: "WhatsApp user note",
          text:
            "I pasted five customer complaints and the assistant gave me a generic roadmap. I needed it to tell me which one thing to fix this week."
        },
        {
          source: "Sales call note",
          text:
            "The buyer likes the AI summary, but they do not trust it unless it shows the exact feedback that led to the recommendation."
        },
        {
          source: "Support ticket",
          text:
            "The current flow jumps straight into building features. It never asks what segment, workflow, or success metric matters."
        },
        {
          source: "Founder request",
          text:
            "Can it also generate ten unrelated feature ideas? Nice to have, but not useful until the core triage flow is trustworthy."
        }
      ],
      usageSignals: [
        { label: "Users who abandon after first AI answer", value: "41%" },
        { label: "Sessions with copied output", value: "18%" },
        { label: "Top repeated phrase in feedback", value: "What should I do next?" },
        { label: "Most requested proof", value: "Show source snippets" }
      ]
    };
  }

  return {
    product: assessment.title,
    problem: brief,
    assignment:
      "Use the provided starter app to ship one coherent product slice that satisfies the role brief. Keep the scope narrow enough to finish, verify, and explain within the assessment window.",
    required: [
      "A clear user-facing workflow in the app.",
      "A working implementation of the chosen behavior.",
      "Tests or evals that verify the important behavior.",
      "PLAN.md, meaningful commits, and final verification notes."
    ],
    optional: ["A small polish pass on UX copy, empty states, loading states, or error handling."],
    supportSnippets: [
      {
        source: "User note",
        text: "The current product flow is hard to act on. I need one clear next step and evidence that supports it."
      },
      {
        source: "Support ticket",
        text: "The assistant output looks plausible, but I cannot tell what changed or how to verify it."
      }
    ],
    usageSignals: [
      { label: "Unclear next-step sessions", value: "32%" },
      { label: "Users requesting evidence", value: "24%" }
    ]
  };
}

export function buildWorkspaceReadme(assessment: WorkspaceAssessmentContext) {
  const assignment = concreteAssignment(assessment);
  return [
    `# ${assessment.title}`,
    "",
    `Candidate: ${assessment.roleTitle ?? "Candidate"}${assessment.level ? ` (${assessment.level})` : ""}`,
    "",
    "## Exact Assignment",
    "",
    assignment.assignment,
    "",
    "## Product Problem",
    "",
    assignment.problem,
    "",
    "## Must Ship",
    "",
    markdownList(assignment.required, []),
    "",
    "## Work Loop",
    "",
    "- Read TASK.md and EVALS.md before editing.",
    "- Create PLAN.md before implementation.",
    "- Work in meaningful commits; each commit runs the platform checkpoint eval.",
    "- Use OpenCode from the terminal, but review and verify the output.",
    "- Keep final notes short and evidence-focused.",
    "",
    "The full candidate task is in TASK.md. Hidden evaluator material is not present in this workspace.",
    "",
    "## Starter App",
    "",
    "This repo is a small Node/TypeScript-style web app starter. You may change the UI, API behavior, data model, and evals to fit the assessment brief.",
    "",
    "Keep the app runnable with:",
    "",
    "```bash",
    "npm run dev",
    "npm test",
    "```",
    "",
    "The platform may run hidden evals after submission. Do not remove the basic app/test entry points unless you replace them with equivalent commands."
  ].join("\n");
}

function compactInstructions(value: string, maxChars = 3600) {
  const normalized = value.replace(/\n{3,}/g, "\n\n").trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, maxChars).trim()}\n\n[Instructions were shortened for agent context. Ask the reviewer-facing task brief for the complete role rationale if needed.]`;
}

export function buildWorkspaceTask(assessment: WorkspaceAssessmentContext) {
  const assignment = concreteAssignment(assessment);
  return [
    `# ${assessment.title}`,
    "",
    "## What You Are Building",
    "",
    assignment.assignment,
    "",
    "## User Problem",
    "",
    assignment.problem,
    "",
    "## Must Ship",
    "",
    markdownList(assignment.required, []),
    "",
    "## Optional If Time Remains",
    "",
    markdownList(assignment.optional, ["Small UX polish that improves clarity without changing scope."]),
    "",
    "## Assessment Context",
    "",
    compactInstructions(assessment.instructions),
    "",
    "## Required Evidence",
    "",
    markdownList(assessment.requiredEvidence, [
      "PLAN.md before implementation",
      "working product slice",
      "tests or evals",
      "meaningful commit history",
      "final verification notes"
    ]),
    "",
    "## Scoring Focus",
    "",
    markdownList(assessment.evaluationFocus, [
      "requirements correctness",
      "test/eval quality",
      "agent orchestration judgment",
      "code and UX quality",
      "production readiness"
    ]),
    "",
    "## What Not To Do",
    "",
    "- Do not paste the entire task into the agent and accept a one-shot implementation without review.",
    "- Do not remove tests or hide broken behavior.",
    "- Do not include secrets in commits, logs, or final notes."
  ].join("\n");
}

export function buildWorkspaceEvals(assessment: WorkspaceAssessmentContext) {
  return [
    "# Eval Requirement",
    "",
    "Add or improve at least one lightweight eval that measures behavior the employer cares about for this selected assessment.",
    "",
    "## Scoring Focus",
    "",
    markdownList(assessment.evaluationFocus, [
      "requirements correctness",
      "test/eval quality",
      "agent orchestration judgment",
      "code and UX quality",
      "production readiness"
    ]),
    "",
    "## Eval Expectations",
    "",
    "- Capture behavior or product quality, not just implementation details.",
    "- Prefer a small deterministic check that runs inside `npm test`.",
    "- Make the eval fail for a plausible bad product or bad assistant-agent output.",
    "- Mention in final notes what regression your eval would catch.",
    "",
    "Strong evals for this task may cover:",
    "",
    markdownList(assessment.requiredEvidence, [
      "plan quality",
      "user workflow behavior",
      "agent output verification",
      "launch readiness",
      "iteration quality"
    ])
  ].join("\n");
}

export function buildProofworkContext(assessment: WorkspaceAssessmentContext) {
  return [
    "# Proofwork Assessment Context",
    "",
    `Title: ${assessment.title}`,
    `Role: ${assessment.roleTitle ?? "Candidate"}`,
    `Level: ${assessment.level}`,
    `Mode: ${assessment.assessmentMode ?? "solo"}`,
    "",
    "OpenCode guidance:",
    "- Start by reading README.md, TASK.md, and EVALS.md.",
    "- Help the candidate inspect the existing app before editing.",
    "- Encourage a written PLAN.md, small commits, tests/evals, and verification notes.",
    "- Do not one-shot the entire assignment without asking the candidate to review and verify.",
    "- Treat hidden evals as unknown reviewer checks; optimize for robust product behavior."
  ].join("\n");
}

function oneLine(value: string | null | undefined, fallback: string) {
  return (value ?? fallback).replace(/\s+/g, " ").trim();
}

export function buildWorkspaceSampleData(assessment: WorkspaceAssessmentContext) {
  const assignment = concreteAssignment(assessment);
  const focus = assessment.evaluationFocus?.length
    ? assessment.evaluationFocus
    : ["requirements judgment", "verification quality", "production readiness"];
  const requiredCapabilities = assessment.requiredEvidence?.length
    ? assessment.requiredEvidence
    : ["PLAN.md before implementation", "working product slice", "tests or evals", "final verification notes"];
  const brief = oneLine(assessment.taskBrief, assessment.instructions.split("\n")[0] ?? "Build the selected assessment task.");
  const data = {
    productBrief: {
      name: assignment.product,
      tagline: assignment.assignment,
      audience: `${assessment.roleTitle ?? "candidate"} reviewers evaluating ${assessment.level} role signal`,
      problem: assignment.problem,
      constraints: [
        `${assessment.level} assessment window`,
        "Use the existing starter app unless you deliberately replace it",
        "Create PLAN.md before implementation",
        "Keep tests/evals deterministic and runnable"
      ],
      requiredCapabilities
    },
    supportSnippets: assignment.supportSnippets,
    usageSignals: assignment.usageSignals,
    conversations: [
      {
        id: "conv-assessment-brief",
        title: assignment.product,
        messages: [
          {
            id: "m1",
            role: "user",
            content: "Here are messy support notes. Tell me the one product improvement we should ship this week and what not to build.",
            createdAt: "2026-05-07T09:00:00.000Z"
          },
          {
            id: "m2",
            role: "assistant",
            content: `Start by grouping the feedback, naming the top user problem, choosing a narrow slice, and verifying it with tests or evals focused on ${focus
              .slice(0, 3)
              .join(", ")}.`,
            createdAt: "2026-05-07T09:00:10.000Z"
          }
        ]
      }
    ],
    evalCases: [
      {
        id: "vague-scope",
        prompt: `I want to build something for ${assessment.roleTitle ?? "this role"}, but I am not sure where to start.`,
        expected: { intent: "clarify", mustMention: ["audience", "workflow"] }
      },
      {
        id: "build-selected-slice",
        prompt: `Build a focused dashboard for ${focus[0] ?? "the selected assessment"} and show the reviewer useful evidence.`,
        expected: { intent: "plan", mustMention: ["steps", "test"] }
      },
      {
        id: "risk-selected-slice",
        prompt: `What could go wrong if this ${assessment.title} submission looks good but has weak evidence?`,
        expected: { intent: "risk", mustMention: ["assumption", "verify"] }
      }
    ]
  };

  return [
    `export const productBrief = ${JSON.stringify(data.productBrief, null, 2)};`,
    "",
    `export const conversations = ${JSON.stringify(data.conversations, null, 2)};`,
    "",
    `export const supportSnippets = ${JSON.stringify(data.supportSnippets, null, 2)};`,
    "",
    `export const usageSignals = ${JSON.stringify(data.usageSignals, null, 2)};`,
    "",
    `export const evalCases = ${JSON.stringify(data.evalCases, null, 2)};`,
    ""
  ].join("\n");
}

async function uploadAssessmentContext(sandbox: DaytonaSandbox, repoDir: string, assessment: WorkspaceAssessmentContext, overrideReadme = true) {
  const files = [
    { source: Buffer.from(buildProofworkContext(assessment)), destination: path.posix.join(repoDir, "PROOFWORK_CONTEXT.md") },
    { source: Buffer.from(buildWorkspaceTask(assessment)), destination: path.posix.join(repoDir, "TASK.md") },
    { source: Buffer.from(buildWorkspaceSampleData(assessment)), destination: path.posix.join(repoDir, "src", "sample-data.mjs") },
    ...(overrideReadme
      ? [
          { source: Buffer.from(buildWorkspaceReadme(assessment)), destination: path.posix.join(repoDir, "README.md") },
          { source: Buffer.from(buildWorkspaceEvals(assessment)), destination: path.posix.join(repoDir, "EVALS.md") }
        ]
      : [])
  ];
  await sandbox.fs.uploadFiles(files, 30);
}

function assertCommandSucceeded(command: string, result: CommandResult) {
  if (result.exitCode !== 0) {
    throw new Error(`Command failed (${result.exitCode}): ${command}\n${result.stderr || result.stdout}`);
  }
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

function installCommitEvalHookCommand(repoDir: string, attemptId: string) {
  const logPath = `/tmp/commit-evals-${attemptId}.log`;
  const lines = [
    "#!/bin/sh",
    `LOG=${shellQuote(logPath)}`,
    "{",
    "echo \"=== commit $(git rev-parse --short HEAD) $(date -Iseconds) ===\"",
    "npm test",
    "echo \"exit=$?\"",
    "} >> \"$LOG\" 2>&1"
  ];

  return `cd ${shellQuote(repoDir)} && mkdir -p .git/hooks && printf '%s\\n' ${lines.map(shellQuote).join(" ")} > .git/hooks/post-commit && chmod +x .git/hooks/post-commit`;
}

function buildOpenCodeConfig(model: string) {
  const cors = uniqueOrigins([env.NEXT_PUBLIC_APP_URL, "http://localhost:3001", "http://localhost:3002"]);

  return {
    $schema: "https://opencode.ai/config.json",
    model,
    small_model: env.OPENCODE_SMALL_MODEL_NAME ? `${env.OPENCODE_MODEL_PROVIDER}/${env.OPENCODE_SMALL_MODEL_NAME}` : model,
    server: {
      port: env.OPENCODE_WEB_PORT,
      hostname: "0.0.0.0",
      mdns: false,
      cors
    },
    provider: {
      [env.OPENCODE_MODEL_PROVIDER]: {
        options: {
          timeout: env.OPENCODE_PROVIDER_TIMEOUT_MS,
          chunkTimeout: env.OPENCODE_PROVIDER_CHUNK_TIMEOUT_MS
        }
      }
    },
    enabled_providers: [env.OPENCODE_MODEL_PROVIDER],
    instructions: ["PROOFWORK_CONTEXT.md", "TASK.md", "EVALS.md"],
    watcher: {
      ignore: [
        "node_modules/**",
        ".git/**",
        ".next/**",
        ".platform-hidden/**",
        "coverage/**",
        "dist/**",
        "build/**",
        "reports/**",
        "storage/**",
        "tmp/**",
        "*.log"
      ]
    },
    share: "disabled"
  };
}

function terminalLauncherCommand(repoDir: string, attemptId: string) {
  // Both the launcher shell-script and the terminal server itself are
  // now BAKED into the runtime image:
  //   /opt/opencode-bin/proofwork-terminal-server.mjs   (NodeJS server)
  //   /opt/opencode-bin/node_modules/.bin/opencode      (on $PATH)
  // The launcher only needs to set the per-attempt env (model + API
  // keys) and exec opencode. We synthesize it inline here as a single
  // bash -c string so attach.terminal_start is one shell round-trip.
  const launcherInline = [
    `cd ${shellQuote(repoDir)}`,
    `export OPENAI_API_KEY=${shellQuote(env.OPENAI_API_KEY ?? "")}`,
    `export DEEPSEEK_API_KEY=${shellQuote(env.DEEPSEEK_API_KEY ?? "")}`,
    `export OPENCODE_MODEL_PROVIDER=${shellQuote(env.OPENCODE_MODEL_PROVIDER)}`,
    `export OPENCODE_MODEL_NAME=${shellQuote(env.OPENCODE_MODEL_NAME)}`,
    ...(env.OPENCODE_SMALL_MODEL_NAME ? [`export OPENCODE_SMALL_MODEL_NAME=${shellQuote(env.OPENCODE_SMALL_MODEL_NAME)}`] : []),
    `exec opencode`
  ].join("; ");
  const terminalCommand = `/bin/sh -c ${shellQuote(launcherInline)}`;
  // setsid + < /dev/null gives the node process its own session and
  // detaches stdin so Daytona's process.executeCommand can return
  // without reaping the backgrounded process. The terminal-server +
  // node_modules live in the same directory in the runtime image —
  // ESM resolution is fast and no symlink hop needed.
  return `setsid env PROOFWORK_TERMINAL_PORT=${env.OPENCODE_TERMINAL_PORT} PROOFWORK_TERMINAL_COMMAND=${shellQuote(terminalCommand)} PROOFWORK_REPO_DIR=${shellQuote(repoDir)} PROOFWORK_TERMINAL_LOG=/tmp/terminal-${attemptId}.log nohup node /opt/opencode-bin/proofwork-terminal-server.mjs >> /tmp/terminal-${attemptId}.log 2>&1 < /dev/null &`;
}

function waitForHttpCommand(url: string, label: string, attempts = 80, logPath?: string) {
  return [
    `i=0`,
    `until curl -fsS ${shellQuote(url)} >/dev/null 2>&1; do i=$((i+1))`,
    `if [ "$i" -ge ${attempts} ]; then echo ${shellQuote(`${label} did not become ready`)} >&2; ${logPath ? `cat ${shellQuote(logPath)} >&2 || true; ` : ""}exit 1; fi`,
    `sleep 1`,
    `done`
  ].join("; ");
}

async function hiddenEvalUpload(sandbox: DaytonaSandbox, repoDir: string) {
  const hiddenRoot = path.join(process.cwd(), "task-template", "evals", "hidden");
  const entries = await readdir(hiddenRoot, { withFileTypes: true });
  const files: Array<{ source: Buffer; destination: string }> = [];

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const source = path.join(hiddenRoot, entry.name);
    const hiddenEval = (await readFile(source, "utf8")).replaceAll("../../src/", "../src/");
    files.push({
      source: Buffer.from(hiddenEval),
      destination: path.posix.join(repoDir, ".platform-hidden", entry.name)
    });
  }

  await sandbox.fs.uploadFiles(files, 30);
}

export class DaytonaWorkspaceProvider implements WorkspaceProvider {
  private async createClient() {
    if (!env.DAYTONA_API_KEY) {
      throw new Error("DAYTONA_API_KEY is required for Daytona workspaces");
    }

    const mod = await import("@daytona/sdk");
    const Daytona = (mod as Record<string, unknown>).Daytona as new (config: Record<string, unknown>) => unknown;
    return new Daytona({
      apiKey: env.DAYTONA_API_KEY,
      ...(env.DAYTONA_ORGANIZATION_ID ? { organizationId: env.DAYTONA_ORGANIZATION_ID } : {})
    }) as {
      create: (opts?: Record<string, unknown>, options?: Record<string, unknown>) => Promise<DaytonaSandbox>;
      get: (id: string) => Promise<DaytonaSandbox>;
      delete: (sandbox: DaytonaSandbox, timeout?: number) => Promise<void>;
    };
  }

  async provisionWorkspace(input: WorkspaceProvisionInput): Promise<WorkspaceHandle> {
    const client = await this.createClient();
    const provisioningTimings: ProvisionTiming[] = [];
    const opencodeUsername = env.OPENCODE_SERVER_USERNAME;
    const opencodePassword = env.OPENCODE_REQUIRE_PASSWORD
      ? env.OPENCODE_SERVER_PASSWORD ?? randomBytes(18).toString("base64url")
      : "";
    const opencodeAuthEnv = opencodePassword
      ? `OPENCODE_SERVER_USERNAME=${shellQuote(opencodeUsername)} OPENCODE_SERVER_PASSWORD=${shellQuote(opencodePassword)} `
      : "";
    const sandboxEnvVars = {
      OPENAI_API_KEY: env.OPENAI_API_KEY ?? "",
      DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY ?? "",
      OPENCODE_MODEL_PROVIDER: env.OPENCODE_MODEL_PROVIDER,
      OPENCODE_MODEL_NAME: env.OPENCODE_MODEL_NAME,
      ...(env.OPENCODE_SMALL_MODEL_NAME ? { OPENCODE_SMALL_MODEL_NAME: env.OPENCODE_SMALL_MODEL_NAME } : {}),
      ...(opencodePassword
        ? {
            OPENCODE_SERVER_USERNAME: opencodeUsername,
            OPENCODE_SERVER_PASSWORD: opencodePassword
          }
        : {})
    };
    const createStartedAt = Date.now();
    const sandbox = await client
      .create(
        {
          language: "typescript",
          envVars: sandboxEnvVars,
          // Prefer the registered Daytona snapshot (pre-pulled on the
          // runner — sub-second sandbox create) over the OCI image
          // (pulled fresh per cold sandbox). Either pins to the
          // proofwork runtime; empty (defaults) leaves Daytona on its
          // baseline image.
          ...(env.WORKSPACE_DAYTONA_SNAPSHOT
            ? { snapshot: env.WORKSPACE_DAYTONA_SNAPSHOT }
            : env.WORKSPACE_SANDBOX_IMAGE
              ? { image: env.WORKSPACE_SANDBOX_IMAGE }
              : {}),
          labels: {
            app: "proofwork",
            attemptId: input.attemptId
          },
          // public: true bypasses Daytona's "Preview URL Warning"
          // click-through that's shown every browser session for
          // private sandboxes. Candidate URLs are already
          // unguessable (UUID-prefixed subdomain) and the proxied
          // app server has no auth either; the warning was just
          // friction in the assessment flow.
          public: true,
          autoStopInterval: input.durationMin + 30,
          autoArchiveInterval: input.durationMin + 60,
          autoDeleteInterval: input.durationMin + 120
        },
        { timeout: 600 }
      )
      .catch((err: unknown) => {
        throw new Error(`Provisioning step "workspace_create" failed: ${errorMessage(err)}`);
      });
    provisioningTimings.push({ label: "workspace_create", durationMs: Date.now() - createStartedAt });

    if (!sandbox) throw new Error("Daytona SDK did not return a sandbox");

    const externalId = sandbox.id;
    if (!externalId) throw new Error("Daytona sandbox is missing an id");

    // Block until the in-container agent is exec-ready. Without this
    // the first runCommand below hangs ~120s on freshly-created
    // sandboxes (Daytona resolves create before toolbox is up).
    const readyStartedAt = Date.now();
    await this.awaitSandboxReady(sandbox).catch((err: unknown) => {
      throw new Error(`Provisioning step "agent_ready" failed: ${errorMessage(err)}`);
    });
    provisioningTimings.push({ label: "agent_ready", durationMs: Date.now() - readyStartedAt });

    // Skip sandbox.getWorkDir() — same exec-not-ready-after-snapshot
    // hang we hit in warm/attach paths. Hardcode the known default.
    const workDir = "/home/daytona";
    const repoDir = path.posix.join(workDir, "task");
    const opencodeModel = `${env.OPENCODE_MODEL_PROVIDER}/${env.OPENCODE_MODEL_NAME}`;
    const opencodeConfig = buildOpenCodeConfig(opencodeModel);
    // Symlink the prebaked opencode bundle if the image (e.g.
    // registry.example.com/proofwork/runtime) provides it at
    // /opt/opencode-bin. The existing test-then-install check after
    // this passes and skips the npm install of opencode-ai + xterm,
    // saving 60-90s per cold start. Falls through cleanly if the
    // prebaked path isn't present (upstream daytonaio/sandbox base).
    const installCommand = `cd ${shellQuote(repoDir)} && { if [ -d /opt/opencode-bin/node_modules ]; then mkdir -p $HOME/.opencode-bin && rm -rf $HOME/.opencode-bin/node_modules && ln -s /opt/opencode-bin/node_modules $HOME/.opencode-bin/node_modules; fi; npm install --prefer-offline --no-audit --no-fund & repo_install=$!; (test -x "$HOME/.opencode-bin/node_modules/.bin/opencode" && test -d "$HOME/.opencode-bin/node_modules/ws" && test -d "$HOME/.opencode-bin/node_modules/@xterm/xterm" || npm install --prefix ~/.opencode-bin --no-audit --no-fund opencode-ai ws @xterm/xterm @xterm/addon-fit) & tooling_install=$!; wait "$repo_install"; repo_code=$?; wait "$tooling_install"; tooling_code=$?; [ "$repo_code" -eq 0 ] && [ "$tooling_code" -eq 0 ]; }`;
    const envFileLines = [
      `OPENAI_API_KEY=${env.OPENAI_API_KEY ?? ""}`,
      `DEEPSEEK_API_KEY=${env.DEEPSEEK_API_KEY ?? ""}`,
      `OPENCODE_MODEL_PROVIDER=${env.OPENCODE_MODEL_PROVIDER}`,
      `OPENCODE_MODEL_NAME=${env.OPENCODE_MODEL_NAME}`,
      ...(env.OPENCODE_SMALL_MODEL_NAME ? [`OPENCODE_SMALL_MODEL_NAME=${env.OPENCODE_SMALL_MODEL_NAME}`] : []),
      ...(opencodePassword ? [`OPENCODE_SERVER_USERNAME=${opencodeUsername}`, `OPENCODE_SERVER_PASSWORD=${opencodePassword}`] : [])
    ];
    const placeholderRepo = isPlaceholderRepoUrl(input.repoUrl);
    const setupSteps = [
      { label: "repo_directory", command: `mkdir -p ${shellQuote(repoDir)}`, timeoutMs: 180_000 },
      placeholderRepo ? null : { label: "repo_clone", command: `git clone ${shellQuote(input.repoUrl ?? "")} ${repoDir}`, timeoutMs: 180_000 },
      {
        label: "repo_ignore_files",
        command: placeholderRepo
          ? `cd ${repoDir} && printf '%s\\n' '.env*' 'node_modules/' '.next/' '.opencode/' '.platform-hidden/' > .gitignore`
          : `cd ${repoDir} && printf '%s\\n' '.env.local' '.opencode/' '.platform-hidden/' >> .git/info/exclude`,
        timeoutMs: 60_000
      },
      { label: "dependency_and_tool_install", command: installCommand, timeoutMs: 180_000 },
      { label: "model_env_write", command: `cd ${repoDir} && printf '%s\\n' ${envFileLines.map(shellQuote).join(" ")} > .env.local`, timeoutMs: 60_000 },
      { label: "opencode_config_write", command: `cd ${repoDir} && printf '%s\\n' ${shellQuote(JSON.stringify(opencodeConfig, null, 2))} > opencode.json`, timeoutMs: 60_000 },
      placeholderRepo
        ? {
            label: "baseline_commit",
            command: `cd ${repoDir} && git init -b main && git config user.email platform@example.com && git config user.name 'Proofwork Platform' && git add . && git commit -m 'initial task baseline'`,
            timeoutMs: 60_000
          }
        : null,
      { label: "commit_eval_hook", command: installCommitEvalHookCommand(repoDir, input.attemptId), timeoutMs: 60_000 },
      {
        label: "app_preview_start",
        command: `cd ${repoDir} && node -e "const p=require('./package.json'); process.exit(p.scripts&&p.scripts.dev?0:1)" && setsid env HOST=0.0.0.0 PORT=3000 nohup npm run dev > /tmp/app-${input.attemptId}.log 2>&1 < /dev/null & true`,
        timeoutMs: 60_000
      },
      {
        label: "terminal_start",
        command: terminalLauncherCommand(repoDir, input.attemptId),
        timeoutMs: 60_000
      },
      env.OPENCODE_WEB_FALLBACK_ENABLED
        ? {
            label: "opencode_web_fallback_start",
            command: `cd ${repoDir} && OPENCODE_BIN=$(command -v opencode || echo ~/.opencode-bin/node_modules/.bin/opencode) && setsid env OPENAI_API_KEY=${shellQuote(env.OPENAI_API_KEY ?? "")} DEEPSEEK_API_KEY=${shellQuote(env.DEEPSEEK_API_KEY ?? "")} ${opencodeAuthEnv}nohup "$OPENCODE_BIN" web --hostname 0.0.0.0 --port ${env.OPENCODE_WEB_PORT} > /tmp/opencode-${input.attemptId}.log 2>&1 < /dev/null &`,
            timeoutMs: 60_000
          }
        : null,
      {
        label: "terminal_ready",
        command: waitForHttpCommand(`http://127.0.0.1:${env.OPENCODE_TERMINAL_PORT}`, "OpenCode terminal", 170, `/tmp/terminal-${input.attemptId}.log`),
        timeoutMs: 180_000
      },
      env.OPENCODE_WEB_FALLBACK_ENABLED
        ? {
            label: "opencode_web_fallback_ready",
            command: waitForHttpCommand(`http://127.0.0.1:${env.OPENCODE_WEB_PORT}`, "OpenCode web fallback", 45, `/tmp/opencode-${input.attemptId}.log`),
            timeoutMs: 90_000
          }
        : null,
      {
        label: "app_preview_ready",
        command: waitForHttpCommand("http://127.0.0.1:3000/health", "App preview", 45, `/tmp/app-${input.attemptId}.log`),
        timeoutMs: 90_000
      }
    ].filter((step): step is { label: string; command: string; timeoutMs: number } => Boolean(step));

    const runSetupStep = async (label: string, command: string, timeoutMs: number) => {
      const startedAt = Date.now();
      try {
        const result = await this.runCommand(externalId, command, timeoutMs);
        provisioningTimings.push({ label, durationMs: Date.now() - startedAt, exitCode: result.exitCode });
        assertCommandSucceeded(command, result);
      } catch (err) {
        provisioningTimings.push({ label, durationMs: Date.now() - startedAt, exitCode: -1 });
        throw new Error(`Provisioning step "${label}" failed: ${errorMessage(err)}`);
      }
    };

    for (const step of setupSteps) {
      if (step.label === "repo_directory" && placeholderRepo) {
        await runSetupStep(step.label, step.command, step.timeoutMs);
        const uploadStartedAt = Date.now();
        await sandbox.fs.uploadFiles(await listLocalTaskFiles(path.join(process.cwd(), "task-template"), repoDir), 120).catch((err: unknown) => {
          throw new Error(`Provisioning step "starter_repo_upload" failed: ${errorMessage(err)}`);
        });
        provisioningTimings.push({ label: "starter_repo_upload", durationMs: Date.now() - uploadStartedAt });
        const contextStartedAt = Date.now();
        await uploadAssessmentContext(sandbox, repoDir, input.assessment).catch((err: unknown) => {
          throw new Error(`Provisioning step "assessment_context_upload" failed: ${errorMessage(err)}`);
        });
        provisioningTimings.push({ label: "assessment_context_upload", durationMs: Date.now() - contextStartedAt });
        continue;
      }

      await runSetupStep(step.label, step.command, step.timeoutMs);
      if (step.label === "repo_clone") {
        const contextStartedAt = Date.now();
        await uploadAssessmentContext(sandbox, repoDir, input.assessment, false).catch((err: unknown) => {
          throw new Error(`Provisioning step "assessment_context_upload" failed: ${errorMessage(err)}`);
        });
        provisioningTimings.push({ label: "assessment_context_upload", durationMs: Date.now() - contextStartedAt });
      }
    }

    const urlBundle = await this.refreshAccessUrls(externalId);
    const accessUrl = urlBundle.accessUrl;
    const opencodeWebUrl = urlBundle.metadata.opencodeWebUrl ?? null;
    const appPreviewUrl = urlBundle.metadata.appPreviewUrl;

    return {
      provider: "daytona",
      externalId,
      accessUrl,
      opencodeUser: opencodePassword ? opencodeUsername : "",
      opencodePass: opencodePassword,
      expiresAt: addMinutes(new Date(), input.durationMin),
      metadata: {
        repoDir,
        candidateName: input.candidateName,
        assessmentTitle: input.assessment.title,
        appPreviewUrl,
        terminalUrl: accessUrl,
        terminalPort: env.OPENCODE_TERMINAL_PORT,
        terminalService: "proofwork-xterm-opencode-cli",
        opencodeWebUrl,
        opencodeWebPort: env.OPENCODE_WEB_PORT,
        opencodePrimarySurface: "cli",
        opencodeModel: opencodeModel,
        opencodeSmallModel: env.OPENCODE_SMALL_MODEL_NAME ? `${env.OPENCODE_MODEL_PROVIDER}/${env.OPENCODE_SMALL_MODEL_NAME}` : opencodeModel,
        signedUrlsRefreshedAt: urlBundle.metadata.signedUrlsRefreshedAt,
        signedUrlsExpireAt: urlBundle.metadata.signedUrlsExpireAt,
        provisioningTimings
      }
    };
  }

  async startOpenCode(externalId: string) {
    return { accessUrl: await this.getAccessUrl(externalId) };
  }

  async getAccessUrl(externalId: string) {
    return this.getSignedPreviewUrl(externalId, env.OPENCODE_TERMINAL_PORT);
  }

  async refreshAccessUrls(externalId: string) {
    const sandbox = await this.getSandbox(externalId);
    await sandbox.process.executeCommand("true", undefined, undefined, 5).catch((err: unknown) => {
      throw new Error(`Daytona workspace is unavailable: ${errorMessage(err)}`);
    });

    const now = new Date();
    const expireAt = addMinutes(now, 12 * 60);
    const accessUrl = await this.getSignedPreviewUrl(externalId, env.OPENCODE_TERMINAL_PORT);
    const opencodeWebUrl = env.OPENCODE_WEB_FALLBACK_ENABLED ? await this.getSignedPreviewUrl(externalId, env.OPENCODE_WEB_PORT) : null;
    const appPreviewUrl = await this.getSignedPreviewUrl(externalId, 3000);

    return {
      accessUrl,
      metadata: {
        appPreviewUrl,
        terminalUrl: accessUrl,
        opencodeWebUrl,
        signedUrlsRefreshedAt: now.toISOString(),
        signedUrlsExpireAt: expireAt.toISOString()
      }
    };
  }

  private async getSignedPreviewUrl(externalId: string, port: number) {
    const sandbox = await this.getSandbox(externalId);
    const preview = await sandbox.getSignedPreviewUrl(port, 60 * 60 * 12);
    return preview.url;
  }

  async runCommand(externalId: string, command: string, timeoutMs = 60_000): Promise<CommandResult> {
    const sandbox = await this.getSandbox(externalId);
    if (!sandbox.process.executeCommand) {
      throw new Error("Daytona sandbox does not expose process.executeCommand");
    }

    return outputToCommandResult(await sandbox.process.executeCommand(command, undefined, undefined, timeoutSeconds(timeoutMs)));
  }

  async collectArtifacts(externalId: string, attemptId: string) {
    const sandbox = await this.getSandbox(externalId);
    const workDir = (await sandbox.getWorkDir()) ?? "/home/daytona";
    const repoDir = path.posix.join(workDir, "task");
    await this.runCommand(externalId, `mkdir -p ${shellQuote(path.posix.join(repoDir, ".platform-hidden"))}`, 30_000);
    await hiddenEvalUpload(sandbox, repoDir);

    const [diff, tests, hiddenTests, tree, terminalLog, opencodeLog, opencodeTranscript, commitEvalLog, commitHistory, planEvidence, finalNotesEvidence] = await Promise.all([
      this.runCommand(
        externalId,
        `cd ${shellQuote(repoDir)} && BASE=$(git rev-list --max-parents=0 HEAD 2>/dev/null | head -1); if [ -n "$BASE" ]; then git diff "$BASE"..HEAD -- .; fi; git diff -- .`,
        30_000
      ),
      this.runCommand(externalId, `cd ${shellQuote(repoDir)} && npm test`, 120_000),
      this.runCommand(
        externalId,
        `cd ${shellQuote(repoDir)} && node --test .platform-hidden/*.test.mjs`,
        120_000
      ),
      this.runCommand(
        externalId,
        `cd ${shellQuote(repoDir)} && find . -maxdepth 3 \\( -path './.git' -o -path './node_modules' -o -path './.platform-hidden' -o -path './evals/hidden' \\) -prune -o -type f ! -name '.env.local' -print | sort`,
        30_000
      ),
      this.runCommand(externalId, `cat /tmp/terminal-${attemptId}.log || true`, 30_000),
      this.runCommand(externalId, `cat /tmp/opencode-${attemptId}.log || true`, 30_000),
      this.runCommand(
        externalId,
        `cd ${shellQuote(repoDir)} && { for dir in .opencode "$HOME/.local/share/opencode" "$HOME/.config/opencode"; do if [ -d "$dir" ]; then find "$dir" -maxdepth 5 -type f -size -2M -print -exec sh -c 'printf "\\n===FILE:%s===\\n" "$1"; sed -n "1,240p" "$1"' sh {} \\;; fi; done; } | sed -E 's/(sk-[A-Za-z0-9_-]{12,})/[REDACTED_API_KEY]/g; s/(dtn_[A-Za-z0-9_-]{12,})/[REDACTED_DAYTONA_KEY]/g; s/(re_[A-Za-z0-9_-]{12,})/[REDACTED_RESEND_KEY]/g' || true`,
        30_000
      ),
      this.runCommand(externalId, `cat /tmp/commit-evals-${attemptId}.log || true`, 30_000),
      this.runCommand(
        externalId,
        `cd ${shellQuote(repoDir)} && git log --reverse --pretty=format:'commit=%h | time=%cI | subject=%s' --shortstat --no-merges || true`,
        30_000
      ),
      this.runCommand(
        externalId,
        `cd ${shellQuote(repoDir)} && if [ -f PLAN.md ]; then printf 'PLAN.md found\\n---\\n'; sed -n '1,220p' PLAN.md; else printf 'PLAN.md missing\\n'; fi`,
        30_000
      ),
      this.runCommand(
        externalId,
        `cd ${shellQuote(repoDir)} && if [ -f FINAL_NOTES.md ]; then printf 'FINAL_NOTES.md found\\n---\\n'; sed -n '1,220p' FINAL_NOTES.md; else printf 'FINAL_NOTES.md missing\\n'; fi`,
        30_000
      )
    ]);

    return [
      { kind: "git_diff" as const, label: "Git diff", uri: `inline://${attemptId}/diff`, metadata: diff },
      { kind: "test_output" as const, label: "Test output", uri: `inline://${attemptId}/tests`, metadata: tests },
      { kind: "command_log" as const, label: "Hidden test output", uri: `inline://${attemptId}/hidden-tests`, metadata: hiddenTests },
      { kind: "file_tree" as const, label: "Final file tree", uri: `inline://${attemptId}/tree`, metadata: tree },
      { kind: "opencode_log" as const, label: "OpenCode terminal log", uri: `inline://${attemptId}/opencode-terminal`, metadata: terminalLog },
      { kind: "opencode_log" as const, label: "OpenCode log", uri: `inline://${attemptId}/opencode`, metadata: opencodeLog },
      { kind: "opencode_log" as const, label: "OpenCode session transcript", uri: `inline://${attemptId}/opencode-transcript`, metadata: opencodeTranscript },
      { kind: "command_log" as const, label: "Commit checkpoint evals", uri: `inline://${attemptId}/commit-evals`, metadata: commitEvalLog },
      { kind: "command_log" as const, label: "Commit history", uri: `inline://${attemptId}/commits`, metadata: commitHistory },
      { kind: "command_log" as const, label: "Plan evidence", uri: `inline://${attemptId}/plan`, metadata: planEvidence },
      { kind: "command_log" as const, label: "Final notes file", uri: `inline://${attemptId}/final-notes-file`, metadata: finalNotesEvidence }
    ];
  }

  async stopWorkspace(externalId: string) {
    await this.runCommand(
      externalId,
      "pkill -f 'opencode web' || true; pkill -f 'proofwork-terminal-server' || true; pkill -f 'proofwork-opencode-cli' || true; pkill -f 'npm run dev' || true; pkill -f 'src/server.mjs' || true",
      30_000
    );
  }

  async destroyWorkspace(externalId: string) {
    const client = await this.createClient();
    const sandbox = await client.get(externalId);
    await client.delete(sandbox);
  }

  private async getSandbox(externalId: string): Promise<DaytonaSandbox> {
    const client = await this.createClient();
    const sandbox = await client.get(externalId);
    if (!sandbox) throw new Error(`Daytona sandbox not found: ${externalId}`);
    return sandbox;
  }

  // Daytona's client.create resolves with state="started" before the
  // in-container toolbox agent is ready to serve process.executeCommand
  // / fs.uploadFiles. The first SDK exec call against a freshly-spawned
  // sandbox hangs ~120s (the SDK's default operation timeout) before
  // failing. This poisoned every spawn cascade we hit — warm attach,
  // cold provision, and refill-on-miss all timed out on their first
  // exec, then the auto-retry path spawned MORE sandboxes that did
  // the same thing.
  //
  // Workaround: poll a cheap exec until it returns. Once the agent
  // serves one command, subsequent calls are fast.
  private async awaitSandboxReady(sandbox: DaytonaSandbox, timeoutMs = 90_000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    let attempt = 0;
    let lastErr: unknown = null;
    while (Date.now() < deadline) {
      attempt += 1;
      try {
        const res = (await sandbox.process.executeCommand("echo ready", undefined, undefined, 10)) as
          | { exitCode?: number; exit_code?: number }
          | undefined;
        if (res && (res.exitCode === 0 || res.exit_code === 0)) {
          // eslint-disable-next-line no-console
          console.log("daytona: sandbox ready", { sandboxId: sandbox.id, attempt });
          return;
        }
      } catch (err) {
        lastErr = err;
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Daytona sandbox failed to become ready within ${timeoutMs}ms: ${lastErr instanceof Error ? lastErr.message : "unknown"}`);
  }

  // ── Warm-pool support ────────────────────────────────────────────
  // warmWorkspace + attachWarmToAttempt let the pool service
  // (app/lib/workspaces/pool.ts) pre-create sandboxes per template
  // and then quickly attach them to a candidate. Cold path
  // (provisionWorkspace) remains the fallback for placeholder repos,
  // unusual templates, or when the pool is empty/disabled.
  //
  // Scope of this first cut: assumes non-placeholder repo (template
  // has a real git URL). Placeholder-repo templates always fall
  // through to cold via the pool's try-then-null contract.

  async warmWorkspace(input: WarmInput): Promise<WarmHandle> {
    // With the bake-everything runtime image (proofwork/runtime, see
    // docker/sandbox/Dockerfile), the snapshot already has:
    //   /home/daytona/task with task-template baseline + npm install
    //   /home/daytona/task/.git + baseline commit
    //   /opt/opencode-bin/node_modules (opencode-ai + ws + xterm)
    //   Node + tsc + python + go on PATH
    // So warmWorkspace is essentially client.create + return. The
    // per-attempt work (env file, opencode.json, commit hook, start
    // services) is all in attachWarmToAttempt, which runs at
    // candidate-assign time.
    //
    // For non-placeholder real-repo templates: same image, but
    // attach still needs to do the git clone (template's repo URL is
    // unknown at bake time). Pool can't help much there — the
    // dependency_and_tool_install would still run at attach. Future:
    // per-template image bake for real-repo templates.
    const client = await this.createClient();
    const sandboxEnvVars = {
      OPENAI_API_KEY: env.OPENAI_API_KEY ?? "",
      DEEPSEEK_API_KEY: env.DEEPSEEK_API_KEY ?? "",
      OPENCODE_MODEL_PROVIDER: env.OPENCODE_MODEL_PROVIDER,
      OPENCODE_MODEL_NAME: env.OPENCODE_MODEL_NAME,
      ...(env.OPENCODE_SMALL_MODEL_NAME ? { OPENCODE_SMALL_MODEL_NAME: env.OPENCODE_SMALL_MODEL_NAME } : {})
    };
    const sandbox = await client
      .create(
        {
          language: "typescript",
          envVars: sandboxEnvVars,
          ...(env.WORKSPACE_DAYTONA_SNAPSHOT
            ? { snapshot: env.WORKSPACE_DAYTONA_SNAPSHOT }
            : env.WORKSPACE_SANDBOX_IMAGE
              ? { image: env.WORKSPACE_SANDBOX_IMAGE }
              : {}),
          labels: { app: "proofwork", warmFor: input.templateId },
          // See cold-path comment for public:true rationale.
          public: true,
          // Warm sandboxes must outlive the pool's TTL so the reaper
          // is the one that destroys them (not Daytona's GC). The pool
          // reaper kicks the entry's externalId via destroyWorkspace
          // at pool TTL hours (default 24h, env-configurable). Sized
          // generously here so an empty-pool-no-exec sandbox isn't
          // reaped early by Daytona's idle-cleanup.
          //   stop:    24h × 60 = 1440 min
          //   archive: 1440 + 60 = 1500 min
          //   delete:  1500 + 60 = 1560 min (pool TTL = 24h reaper)
          autoStopInterval: 24 * 60,
          autoArchiveInterval: 24 * 60 + 60,
          autoDeleteInterval: 24 * 60 + 120
        },
        { timeout: 600 }
      )
      .catch((err: unknown) => {
        throw new Error(`Warm step "workspace_create" failed: ${errorMessage(err)}`);
      });

    if (!sandbox?.id) throw new Error("Daytona SDK did not return a warm sandbox id");
    const externalId = sandbox.id;

    // Force the toolbox agent online here at warm time (fire-and-forget
    // background) so the click-time attach doesn't pay the ~20-90s
    // first-exec hang. If readiness probe fails we still return the
    // warm handle — attachWarmToAttempt will retry from there.
    await this.awaitSandboxReady(sandbox).catch((err: unknown) => {
      // eslint-disable-next-line no-console
      console.error("daytona: warm sandbox readiness probe failed", {
        externalId,
        error: err instanceof Error ? err.message : String(err)
      });
    });

    return {
      provider: "daytona",
      externalId,
      metadata: { templateId: input.templateId }
    };
  }

  async attachWarmToAttempt(input: AttachWarmInput): Promise<WorkspaceHandle> {
    // Works for both real-repo and placeholder warm entries. Repo
    // type only affects WHAT lives in /home/daytona/task (already
    // populated at warm time); per-attempt steps are identical.
    const provisioningTimings: ProvisionTiming[] = [];
    const sandbox = await this.getSandbox(input.warmExternalId);
    const externalId = sandbox.id;

    // Even though warmWorkspace runs awaitSandboxReady at warm time,
    // it's possible the warm probe was a no-op (Daytona auto-stopped
    // and restarted the container during the warm-to-click window).
    // Re-probe cheaply before the first real exec. ~5s in the common
    // case (one round-trip), up to 90s on a cold restart.
    const readyStartedAt = Date.now();
    await this.awaitSandboxReady(sandbox).catch((err: unknown) => {
      throw new Error(`Attach step "agent_ready" failed: ${errorMessage(err)}`);
    });
    provisioningTimings.push({ label: "agent_ready", durationMs: Date.now() - readyStartedAt });
    // Same hardcode as warmWorkspace — skip the getWorkDir SDK call to
    // avoid the snapshot-create exec-not-ready timeout (see warmWorkspace).
    const workDir = "/home/daytona";
    const repoDir = path.posix.join(workDir, "task");

    const opencodeUsername = env.OPENCODE_SERVER_USERNAME;
    const opencodePassword = env.OPENCODE_REQUIRE_PASSWORD
      ? env.OPENCODE_SERVER_PASSWORD ?? randomBytes(18).toString("base64url")
      : "";
    const opencodeAuthEnv = opencodePassword
      ? `OPENCODE_SERVER_USERNAME=${shellQuote(opencodeUsername)} OPENCODE_SERVER_PASSWORD=${shellQuote(opencodePassword)} `
      : "";
    const opencodeModel = `${env.OPENCODE_MODEL_PROVIDER}/${env.OPENCODE_MODEL_NAME}`;
    const opencodeConfig = buildOpenCodeConfig(opencodeModel);
    const envFileLines = [
      `OPENAI_API_KEY=${env.OPENAI_API_KEY ?? ""}`,
      `DEEPSEEK_API_KEY=${env.DEEPSEEK_API_KEY ?? ""}`,
      `OPENCODE_MODEL_PROVIDER=${env.OPENCODE_MODEL_PROVIDER}`,
      `OPENCODE_MODEL_NAME=${env.OPENCODE_MODEL_NAME}`,
      ...(env.OPENCODE_SMALL_MODEL_NAME ? [`OPENCODE_SMALL_MODEL_NAME=${env.OPENCODE_SMALL_MODEL_NAME}`] : []),
      ...(opencodePassword ? [`OPENCODE_SERVER_USERNAME=${opencodeUsername}`, `OPENCODE_SERVER_PASSWORD=${opencodePassword}`] : [])
    ];

    const attemptSteps = [
      // opencode.json is written at attach (not bake) time because
      // OPENCODE_MODEL_PROVIDER/NAME come from env and may change
      // between deploys without rebaking the image.
      {
        label: "attach.opencode_config_write",
        command: `cd ${repoDir} && printf '%s\\n' ${shellQuote(JSON.stringify(opencodeConfig, null, 2))} > opencode.json`,
        timeoutMs: 60_000
      },
      // Per-attempt env file. Must come before any opencode/dev-server start.
      {
        label: "attach.model_env_write",
        command: `cd ${repoDir} && printf '%s\\n' ${envFileLines.map(shellQuote).join(" ")} > .env.local`,
        timeoutMs: 60_000
      },
      { label: "attach.commit_eval_hook", command: installCommitEvalHookCommand(repoDir, input.attemptId), timeoutMs: 60_000 },
      {
        label: "attach.app_preview_start",
        command: `cd ${repoDir} && node -e "const p=require('./package.json'); process.exit(p.scripts&&p.scripts.dev?0:1)" && setsid env HOST=0.0.0.0 PORT=3000 nohup npm run dev > /tmp/app-${input.attemptId}.log 2>&1 < /dev/null & true`,
        timeoutMs: 60_000
      },
      {
        label: "attach.terminal_start",
        command: terminalLauncherCommand(repoDir, input.attemptId),
        timeoutMs: 60_000
      },
      env.OPENCODE_WEB_FALLBACK_ENABLED
        ? {
            label: "attach.opencode_web_fallback_start",
            command: `cd ${repoDir} && OPENCODE_BIN=$(command -v opencode || echo ~/.opencode-bin/node_modules/.bin/opencode) && setsid env OPENAI_API_KEY=${shellQuote(env.OPENAI_API_KEY ?? "")} DEEPSEEK_API_KEY=${shellQuote(env.DEEPSEEK_API_KEY ?? "")} ${opencodeAuthEnv}nohup "$OPENCODE_BIN" web --hostname 0.0.0.0 --port ${env.OPENCODE_WEB_PORT} > /tmp/opencode-${input.attemptId}.log 2>&1 < /dev/null &`,
            timeoutMs: 60_000
          }
        : null,
      {
        label: "attach.terminal_ready",
        // Polling 170× × 1s ≈ 170s, just under the 180s step
        // timeout. The terminal server's first cold Node import +
        // http.createServer + WebSocketServer setup can run slow on
        // a freshly-spawned Daytona sandbox — observed >80s on the
        // proofwork-runtime snapshot — so the previous 80-attempt
        // budget timed out before the server bound to 7681.
        command: waitForHttpCommand(`http://127.0.0.1:${env.OPENCODE_TERMINAL_PORT}`, "OpenCode terminal", 170, `/tmp/terminal-${input.attemptId}.log`),
        timeoutMs: 180_000
      },
      env.OPENCODE_WEB_FALLBACK_ENABLED
        ? {
            label: "attach.opencode_web_fallback_ready",
            command: waitForHttpCommand(`http://127.0.0.1:${env.OPENCODE_WEB_PORT}`, "OpenCode web fallback", 45, `/tmp/opencode-${input.attemptId}.log`),
            timeoutMs: 90_000
          }
        : null,
      {
        label: "attach.app_preview_ready",
        command: waitForHttpCommand("http://127.0.0.1:3000/health", "App preview", 45, `/tmp/app-${input.attemptId}.log`),
        timeoutMs: 90_000
      }
    ].filter((step): step is { label: string; command: string; timeoutMs: number } => Boolean(step));

    // Upload the candidate's assessment context (markdown brief etc.).
    const contextStartedAt = Date.now();
    await uploadAssessmentContext(sandbox, repoDir, input.assessment, false).catch((err: unknown) => {
      throw new Error(`Attach step "assessment_context_upload" failed: ${errorMessage(err)}`);
    });
    provisioningTimings.push({ label: "attach.assessment_context_upload", durationMs: Date.now() - contextStartedAt });

    for (const step of attemptSteps) {
      const started = Date.now();
      try {
        const result = await this.runCommand(externalId, step.command, step.timeoutMs);
        provisioningTimings.push({ label: step.label, durationMs: Date.now() - started, exitCode: result.exitCode });
        assertCommandSucceeded(step.command, result);
      } catch (err) {
        provisioningTimings.push({ label: step.label, durationMs: Date.now() - started, exitCode: -1 });
        throw new Error(`Attach step "${step.label}" failed: ${errorMessage(err)}`);
      }
    }

    const urlBundle = await this.refreshAccessUrls(externalId);
    return {
      provider: "daytona",
      externalId,
      accessUrl: urlBundle.accessUrl,
      opencodeUser: opencodePassword ? opencodeUsername : "",
      opencodePass: opencodePassword,
      expiresAt: addMinutes(new Date(), input.durationMin),
      metadata: {
        repoDir,
        candidateName: input.candidateName,
        assessmentTitle: input.assessment.title,
        appPreviewUrl: urlBundle.metadata.appPreviewUrl,
        terminalUrl: urlBundle.accessUrl,
        terminalPort: env.OPENCODE_TERMINAL_PORT,
        terminalService: "proofwork-xterm-opencode-cli",
        opencodeWebUrl: urlBundle.metadata.opencodeWebUrl ?? null,
        opencodeWebPort: env.OPENCODE_WEB_PORT,
        opencodePrimarySurface: "cli",
        opencodeModel,
        opencodeSmallModel: env.OPENCODE_SMALL_MODEL_NAME ? `${env.OPENCODE_MODEL_PROVIDER}/${env.OPENCODE_SMALL_MODEL_NAME}` : opencodeModel,
        signedUrlsRefreshedAt: urlBundle.metadata.signedUrlsRefreshedAt,
        signedUrlsExpireAt: urlBundle.metadata.signedUrlsExpireAt,
        provisioningTimings
      }
    };
  }
}
