import { NextResponse } from "next/server";
import { z } from "zod";
import { redeemInvite } from "@/app/lib/invite-actions";
import { getActiveProctoringUpload } from "@/app/lib/proctoring-uploads";
import { signR2UploadPartUrl } from "@/app/lib/storage/r2";

export const runtime = "nodejs";

// S3 multipart caps:
// - 1..10000 parts per upload
// - last part may be any size; preceding parts must be >= 5 MiB
const partSchema = z.object({
  kind: z.enum(["camera", "screen"]),
  partNumber: z.number().int().min(1).max(10000)
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const body = await request.json();
    const input = partSchema.parse(body);

    const invitation = await redeemInvite(token);
    const attemptId = invitation.attempt?.id;
    if (!attemptId) {
      return NextResponse.json({ error: "Assessment has not started." }, { status: 400 });
    }

    const session = await getActiveProctoringUpload({ attemptId, kind: input.kind });
    if (!session) {
      return NextResponse.json({ error: "No active proctoring upload. Call /init first." }, { status: 409 });
    }

    // Short TTL: per-part URL is single-use and the browser uses it
    // immediately. 300s is plenty for a retry with backoff.
    const url = await signR2UploadPartUrl({
      key: session.r2Key,
      uploadId: session.r2UploadId,
      partNumber: input.partNumber,
      ttlSeconds: 300
    });

    return NextResponse.json({ ok: true, url, partNumber: input.partNumber });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to sign proctoring upload part";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
