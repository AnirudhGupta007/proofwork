import { execFile, spawn } from "node:child_process";
import { mkdtemp, cp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { WorkspaceAssessmentContext } from "./workspaces/types.ts";
import {
  buildProofworkContext,
  buildWorkspaceEvals,
  buildWorkspaceReadme,
  buildWorkspaceSampleData
} from "./workspaces/daytona-provider.ts";

const execFileAsync = promisify(execFile);

export type AssessmentPreflightResult = {
  passed: boolean;
  command: string;
  stdout: string;
  stderr: string;
  checkedAt: string;
};

export async function preflightAssessmentWorkspace(assessment: WorkspaceAssessmentContext): Promise<AssessmentPreflightResult> {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "proofwork-assessment-"));
  const workspaceDir = path.join(tempRoot, "task");

  try {
    await cp(path.join(process.cwd(), "task-template"), workspaceDir, {
      recursive: true,
      filter: (source) => !source.split(path.sep).includes("hidden")
    });
    await writeFile(path.join(workspaceDir, "README.md"), buildWorkspaceReadme(assessment));
    await writeFile(path.join(workspaceDir, "EVALS.md"), buildWorkspaceEvals(assessment));
    await writeFile(path.join(workspaceDir, "PROOFWORK_CONTEXT.md"), buildProofworkContext(assessment));
    await writeFile(path.join(workspaceDir, "src", "sample-data.mjs"), buildWorkspaceSampleData(assessment));

    const result = await execFileAsync("npm", ["test"], {
      cwd: workspaceDir,
      timeout: 60_000,
      maxBuffer: 1024 * 1024
    });
    await verifyDevServer(workspaceDir);

    return {
      passed: true,
      command: "npm test",
      stdout: result.stdout,
      stderr: result.stderr,
      checkedAt: new Date().toISOString()
    };
  } catch (err) {
    const error = err as { stdout?: string; stderr?: string; message?: string };
    return {
      passed: false,
      command: "npm test",
      stdout: String(error.stdout ?? ""),
      stderr: String(error.stderr ?? error.message ?? "Assessment preflight failed"),
      checkedAt: new Date().toISOString()
    };
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
}

async function verifyDevServer(workspaceDir: string) {
  const port = 3917 + Math.floor(Math.random() * 2000);
  const child = spawn("npm", ["run", "dev"], {
    cwd: workspaceDir,
    env: { ...process.env, HOST: "127.0.0.1", PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });

  try {
    for (let index = 0; index < 40; index += 1) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) {
          const page = await fetch(`http://127.0.0.1:${port}/`);
          if (page.ok) return;
        }
      } catch {
        // Keep polling until the starter server is ready or the attempt budget is exhausted.
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`Dev server did not pass /health preflight. ${output.slice(-1000)}`);
  } finally {
    child.kill("SIGTERM");
  }
}
