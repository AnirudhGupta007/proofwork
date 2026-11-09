import { NextResponse } from "next/server";
import { z } from "zod";
import { persistProctoringRecording } from "@/app/lib/proctoring-recordings";
import { redeemInvite } from "@/app/lib/invite-actions";

export const runtime = "nodejs";

const recordingSchema = z.object({
  kind: z.enum(["camera", "screen"]),
  file: z.instanceof(File)
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const form = await request.formData();
    const input = recordingSchema.parse({
      kind: form.get("kind"),
      file: form.get("file")
    });
    const invitation = await redeemInvite(token);
    const attemptId = invitation.attempt?.id;

    if (!attemptId) {
      return NextResponse.json({ error: "Assessment has not started." }, { status: 400 });
    }

    const artifact = await persistProctoringRecording({
      attemptId,
      kind: input.kind,
      file: input.file
    });

    return NextResponse.json({ ok: true, artifactId: artifact.id });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to upload proctoring recording";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
