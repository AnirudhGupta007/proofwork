import { NextResponse } from "next/server";
import { refreshAttemptWorkspaceUrls } from "@/app/lib/attempt-actions";
import { redeemInvite } from "@/app/lib/invite-actions";
import { db } from "@/app/lib/db";

export async function POST(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const invite = await redeemInvite(token);
    if (!invite.attempt?.workspace?.id) {
      return NextResponse.json({ ok: true, workspace: null });
    }

    await db.workspace.update({
      where: { id: invite.attempt.workspace.id },
      data: { lastHeartbeatAt: new Date() }
    });
    const workspace = await refreshAttemptWorkspaceUrls(invite.attempt.id);

    return NextResponse.json({ ok: true, workspace });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Heartbeat failed";
    return NextResponse.json({ ok: false, error: message }, { status: 404 });
  }
}
