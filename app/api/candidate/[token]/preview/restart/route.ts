import { NextResponse } from "next/server";
import { logAttemptEvent } from "@/app/lib/events";
import { redeemInvite } from "@/app/lib/invite-actions";
import { getWorkspaceProvider } from "@/app/lib/workspaces/provider";

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const invite = await redeemInvite(token);
    const attempt = invite.attempt;
    const workspace = attempt?.workspace;

    if (!attempt || !workspace) throw new Error("Workspace is not ready yet.");
    if (attempt.status !== "in_progress") throw new Error("Preview can only be restarted while the assessment is in progress.");
    if (workspace.status !== "running" || !workspace.externalId) throw new Error("Workspace is not running.");

    const metadata = workspace.metadata && typeof workspace.metadata === "object" && !Array.isArray(workspace.metadata) ? workspace.metadata : {};
    const repoDir = typeof metadata.repoDir === "string" ? metadata.repoDir : "/home/daytona/task";
    const logPath = `/tmp/app-${attempt.id}.log`;
    // The `&` background + setsid detaches the dev server from the
    // bash that Daytona's runCommand spawns — without it, Daytona's
    // process group reap kills the dev server as soon as runCommand
    // returns (same root cause as the attach-time terminal_start
    // hang we fixed in #76). The `true` after `&` is what separates
    // the background from the next statement; without it, `& ; for`
    // is a bash syntax error.
    const command = [
      "pkill -f 'node src/server.mjs' || true",
      `cd ${shellQuote(repoDir)} && setsid env HOST=0.0.0.0 PORT=3000 nohup npm run dev > ${shellQuote(logPath)} 2>&1 < /dev/null & true`,
      "for i in $(seq 1 20); do curl -fsS http://127.0.0.1:3000/health >/dev/null && exit 0; sleep 1; done",
      `cat ${shellQuote(logPath)}`,
      "exit 1"
    ].join("; ");

    const result = await getWorkspaceProvider().runCommand(workspace.externalId, command, 45_000);
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || result.stdout || "Preview did not become ready.");
    }

    await logAttemptEvent(attempt.id, "workspace.preview_restarted", "Candidate restarted the app preview");
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to restart preview";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
