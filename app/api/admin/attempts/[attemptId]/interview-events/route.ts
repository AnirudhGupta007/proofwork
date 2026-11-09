import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/app/lib/admin-context";
import { db } from "@/app/lib/db";
import { logAttemptEvent } from "@/app/lib/events";

const interviewEventSchema = z.object({
  speaker: z.enum(["interviewer", "candidate", "system"]),
  text: z.string().min(2).max(4000),
  kind: z.enum(["question", "answer", "hint", "observation", "decision"]).default("observation")
});

export async function POST(request: Request, { params }: { params: Promise<{ attemptId: string }> }) {
  try {
    const { attemptId } = await params;
    const { organization } = await getAdminContext();
    const input = interviewEventSchema.parse(await request.json());
    const attempt = await db.attempt.findFirst({ where: { id: attemptId, organizationId: organization.id }, select: { id: true } });

    if (!attempt) {
      return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
    }

    const event = await logAttemptEvent(attemptId, `interview.${input.kind}`, `${input.speaker}: ${input.text}`, {
      speaker: input.speaker,
      text: input.text,
      kind: input.kind
    });

    return NextResponse.json({ event });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to log interview event";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
