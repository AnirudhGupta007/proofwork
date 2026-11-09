import { addMinutes } from "@/app/lib/domain/time";
import { db } from "@/app/lib/db";
import type { CommandResult, WorkspaceHandle, WorkspaceProvider, WorkspaceProvisionInput } from "./types";

export class FakeWorkspaceProvider implements WorkspaceProvider {
  async provisionWorkspace(input: WorkspaceProvisionInput): Promise<WorkspaceHandle> {
    return {
      provider: "fake",
      externalId: `fake-${input.attemptId}`,
      accessUrl: `https://workspace.local/${input.attemptId}`,
      opencodeUser: "opencode",
      opencodePass: "",
      expiresAt: addMinutes(new Date(), input.durationMin),
      metadata: {
        repoUrl: input.repoUrl ?? undefined,
        candidateName: input.candidateName,
        assessmentTitle: input.assessment.title,
        appPreviewUrl: `https://workspace.local/${input.attemptId}/preview`,
        terminalUrl: `https://workspace.local/${input.attemptId}/terminal`,
        terminalService: "fake-opencode-cli",
        opencodeWebUrl: `https://workspace.local/${input.attemptId}/opencode-web`,
        opencodePrimarySurface: "cli",
        provisioningTimings: [
          { label: "workspace_create", durationMs: 0 },
          { label: "terminal_ready", durationMs: 0 },
          { label: "app_preview_ready", durationMs: 0 }
        ]
      }
    };
  }

  async startOpenCode(externalId: string) {
    return { accessUrl: `https://workspace.local/${externalId}/opencode` };
  }

  async getAccessUrl(externalId: string) {
    return `https://workspace.local/${externalId}/opencode`;
  }

  async refreshAccessUrls(externalId: string) {
    const now = new Date();
    const expireAt = addMinutes(now, 12 * 60);
    return {
      accessUrl: `https://workspace.local/${externalId}/terminal`,
      metadata: {
        appPreviewUrl: `https://workspace.local/${externalId}/preview`,
        terminalUrl: `https://workspace.local/${externalId}/terminal`,
        opencodeWebUrl: `https://workspace.local/${externalId}/opencode-web`,
        signedUrlsRefreshedAt: now.toISOString(),
        signedUrlsExpireAt: expireAt.toISOString()
      }
    };
  }

  async runCommand(_externalId: string, command: string): Promise<CommandResult> {
    return {
      exitCode: 0,
      stdout: `fake command completed: ${command}`,
      stderr: ""
    };
  }

  async collectArtifacts(externalId: string, attemptId: string) {
    const attempt = await db.attempt.findUnique({ where: { id: attemptId }, include: { candidate: true, template: true } });
    const candidateName = attempt?.candidate.name.toLowerCase() ?? "";
    const level = `${attempt?.template.level ?? ""} ${attempt?.template.roleTitle ?? ""}`.toLowerCase();
    const isJunior = candidateName.includes("junior") || /\bsde\s*1\b|\bsde1\b/.test(level) || /\bsde\s*1\b|\bsde1\b/.test(candidateName);
    const isCasey = candidateName.includes("casey");
    const isMid = candidateName.includes("mid") || /\bsde\s*2\b|\bsde2\b/.test(level) || /\bsde\s*2\b|\bsde2\b/.test(candidateName);
    const isSenior = candidateName.includes("senior") || level.includes("senior") || /\bsde\s*3\b|\bsde3\b/.test(level);
    const expectedCommits = isSenior ? 5 : isMid ? 4 : isJunior ? 3 : /product manager|program manager|tpm/.test(level) ? 4 : 4;
    const cohortIndex = Number(candidateName.match(/-(\d+)$/)?.[1] ?? "0");
    const profileIndex =
      cohortIndex > 0
        ? (cohortIndex - 1) % 5
        : Array.from(candidateName).reduce((total, char) => total + char.charCodeAt(0), 0) % 5;
    const profile = isCasey
      ? { visiblePassed: false, hiddenPassed: false, commitCount: 1, promptStyle: "weak" as const }
      : [
          { visiblePassed: true, hiddenPassed: true, commitCount: expectedCommits + 1, promptStyle: "excellent" as const },
          { visiblePassed: true, hiddenPassed: false, commitCount: Math.max(2, expectedCommits - 1), promptStyle: "mixed" as const },
          { visiblePassed: true, hiddenPassed: true, commitCount: expectedCommits, promptStyle: "solid" as const },
          { visiblePassed: false, hiddenPassed: false, commitCount: 2, promptStyle: "weak" as const },
          { visiblePassed: true, hiddenPassed: true, commitCount: Math.max(3, expectedCommits - 1), promptStyle: "rushed" as const }
        ][profileIndex];
    const visiblePassed = profile.visiblePassed;
    const hiddenPassed = profile.hiddenPassed || candidateName.includes("ben");
    const commitCount = profile.commitCount;
    const commitLines = Array.from({ length: commitCount }, (_, index) => {
      const subjects = ["plan", "implementation", "tests and evals", "debug follow-up", "production polish"];
      return `commit=${String(index + 1).repeat(6)} | time=2026-05-13T10:${String(index * 12).padStart(2, "0")}:00Z | subject=${subjects[index] ?? "checkpoint"}`;
    }).join("\n");
    const commitEvalLines = Array.from({ length: commitCount }, (_, index) => {
      return `=== commit ${String(index + 1).repeat(6)} 2026-05-13T10:${String(index * 12).padStart(2, "0")}:00Z ===\nnpm test\nexit=0`;
    }).join("\n");

    return [
      {
        kind: "git_diff" as const,
        label: "Git diff",
        uri: `memory://${attemptId}/diff.patch`,
        metadata: { externalId, stdout: `fake diff for ${attempt?.candidate.name ?? attemptId}` }
      },
      {
        kind: "test_output" as const,
        label: "Test output",
        uri: `memory://${attemptId}/tests.txt`,
        metadata: {
          passed: visiblePassed,
          exitCode: visiblePassed ? 0 : 1,
          stdout: visiblePassed ? "pass 6\nfail 0\nfake visible tests passed" : "pass 4\nfail 2\nfake visible tests failed",
          stderr: ""
        }
      },
      {
        kind: "command_log" as const,
        label: "Hidden test output",
        uri: `memory://${attemptId}/hidden-tests.txt`,
        metadata: {
          passed: hiddenPassed,
          exitCode: hiddenPassed ? 0 : 1,
          stdout: hiddenPassed ? "pass 2\nfail 0\nfake hidden evals passed" : "pass 1\nfail 1\nfake hidden evals failed",
          stderr: ""
        }
      },
      {
        kind: "command_log" as const,
        label: "Commit checkpoint evals",
        uri: `memory://${attemptId}/commit-evals.txt`,
        metadata: {
          exitCode: 0,
          stdout: commitEvalLines,
          stderr: ""
        }
      },
      {
        kind: "command_log" as const,
        label: "Commit history",
        uri: `memory://${attemptId}/commits.txt`,
        metadata: { exitCode: 0, stdout: commitLines, stderr: "" }
      },
      {
        kind: "command_log" as const,
        label: "Plan evidence",
        uri: `memory://${attemptId}/plan.txt`,
        metadata: { exitCode: 0, stdout: "PLAN.md found\n---\nAssumptions, milestones, risks, and verification plan.", stderr: "" }
      },
      {
        kind: "command_log" as const,
        label: "Final notes file",
        uri: `memory://${attemptId}/final-notes-file.txt`,
        metadata: { exitCode: 0, stdout: "FINAL_NOTES.md found\n---\nVerification, tradeoffs, and next iteration notes.", stderr: "" }
      },
      {
        kind: "opencode_log" as const,
        label: "OpenCode session transcript",
        uri: `memory://${attemptId}/opencode-transcript.txt`,
        metadata: {
          exitCode: 0,
          stdout: fakePromptTranscript(profile.promptStyle),
          stderr: ""
        }
      }
    ];
  }

  async stopWorkspace() {}

  async destroyWorkspace() {}
}

function fakePromptTranscript(style: "excellent" | "solid" | "mixed" | "rushed" | "weak") {
  if (style === "weak") {
    return "user: Build the whole assessment in one go from the instructions.";
  }

  if (style === "mixed") {
    return [
      "user: First inspect the main files and tell me the likely implementation path.",
      "assistant: I will inspect the current code and tests.",
      "user: Implement the core behavior and run the visible tests."
    ].join("\n");
  }

  if (style === "rushed") {
    return [
      "user: Make a quick PLAN.md, then implement the core product surface.",
      "assistant: I will move quickly and keep the scope tight.",
      "user: Add a minimal eval and rerun tests before the final commit."
    ].join("\n");
  }

  if (style === "solid") {
    return [
      "user: First inspect the codebase, identify the main product flow, and make a short implementation plan before editing.",
      "assistant: I will inspect the files and tests first.",
      "user: Use the visible test output and app behavior as context, then fix in small commits.",
      "assistant: I found the failing area and will patch it.",
      "user: Add or update an eval for the important behavior, rerun tests, and summarize production risks before the final commit."
    ].join("\n");
  }

  return [
    "user: Inspect the codebase, current tests, product brief, and likely risk areas before editing. Propose milestones and what not to build.",
    "assistant: I will map the flow and tests first.",
    "user: Split the work into implementation, eval, and production polish checkpoints. Use the failing test output as context.",
    "assistant: I found the key workflow and a hidden-risk area.",
    "user: Add a behavior eval, verify in browser, rerun tests and typecheck, then review the diff for accessibility, performance, privacy, and rollback risks.",
    "assistant: I will verify and summarize tradeoffs before final submission."
  ].join("\n");
}
