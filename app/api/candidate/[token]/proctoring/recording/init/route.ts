import { NextResponse } from "next/server";
import { z } from "zod";
import { redeemInvite } from "@/app/lib/invite-actions";
import { startProctoringUpload } from "@/app/lib/proctoring-uploads";

export const runtime = "nodejs";

const initSchema = z.object({
  kind: z.enum(["camera", "screen"]),
  mimeType: z
    .string()
    .min(3)
    .max(120)
    .regex(/^[a-z0-9.+\-/=;,_ ]+$/i)
    .default("video/webm")
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = await request.json();
    const input = initSchema.parse(body);

    const invitation = await redeemInvite(token);
    const attemptId = invitation.attempt?.id;
    if (!attemptId) {
      return NextResponse.json({ error: "Assessment has not started." }, { status: 400 });
    }

    const session = await startProctoringUpload({
      attemptId,
      kind: input.kind,
      mimeType: input.mimeType
    });

    return NextResponse.json({
      ok: true,
      uploadId: session.uploadId,
      key: session.key,
      bucket: session.bucket
    });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to initialize proctoring upload";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
