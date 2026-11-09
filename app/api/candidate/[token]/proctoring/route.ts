import { NextResponse } from "next/server";
import { z } from "zod";
import { logAttemptEvent } from "@/app/lib/events";
import { redeemInvite } from "@/app/lib/invite-actions";

const proctoringEventSchema = z.object({
  eventType: z.string().min(2).max(80),
  details: z.record(z.unknown()).optional()
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const input = proctoringEventSchema.parse(await request.json());
    const invitation = await redeemInvite(token);
    const attemptId = invitation.attempt?.id;

    if (!attemptId) {
      return NextResponse.json({ error: "Assessment has not started." }, { status: 400 });
    }

    await logAttemptEvent(attemptId, `proctoring.${input.eventType}`, `Proctoring event: ${input.eventType}`, input.details);
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to record proctoring event";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
