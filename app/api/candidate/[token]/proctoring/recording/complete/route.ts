import { NextResponse } from "next/server";
import { z } from "zod";
import { redeemInvite } from "@/app/lib/invite-actions";
import { abortProctoringUpload, finalizeProctoringUpload } from "@/app/lib/proctoring-uploads";

export const runtime = "nodejs";

const completeSchema = z.object({
  kind: z.enum(["camera", "screen"]),
  // Optional client-side hint: when true, finalize even if no parts
  // were uploaded (server will abort cleanly). Defaults false so a
  // misrouted complete call doesn't silently throw away an upload.
  abortIfEmpty: z.boolean().optional()
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = await request.json();
    const input = completeSchema.parse(body);

    const invitation = await redeemInvite(token);
    const attemptId = invitation.attempt?.id;
    if (!attemptId) {
      return NextResponse.json({ error: "Assessment has not started." }, { status: 400 });
    }

    if (input.abortIfEmpty) {
      await abortProctoringUpload({ attemptId, kind: input.kind });
      return NextResponse.json({ ok: true, aborted: true });
    }

    const artifact = await finalizeProctoringUpload({ attemptId, kind: input.kind });
    if (!artifact) {
      return NextResponse.json({ ok: true, aborted: true });
    }
    return NextResponse.json({ ok: true, artifactId: artifact.id });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to finalize proctoring upload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
