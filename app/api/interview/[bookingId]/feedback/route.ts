import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/app/lib/db";
import { logAttemptEvent } from "@/app/lib/events";

const feedbackSchema = z.object({
  technicalDepth: z.number().int().min(1).max(5),
  productJudgment: z.number().int().min(1).max(5),
  communication: z.number().int().min(1).max(5),
  aiCollaboration: z.number().int().min(1).max(5),
  hireRecommendation: z.enum(["strong_hire", "hire", "lean_hire", "lean_no_hire", "no_hire"]),
  summary: z.string().min(10).max(4000),
  strengths: z.string().min(2).max(4000),
  concerns: z.string().min(2).max(4000),
  followUps: z.string().max(4000).optional().default("")
});

function feedbackEventMessage(input: z.infer<typeof feedbackSchema>) {
  return [
    `interviewer recommendation: ${input.hireRecommendation.replaceAll("_", " ")}`,
    `summary: ${input.summary}`,
    `strengths: ${input.strengths}`,
    `concerns: ${input.concerns}`,
    input.followUps ? `follow-ups: ${input.followUps}` : null
  ]
    .filter(Boolean)
    .join("\n");
}

export async function POST(request: Request, { params }: { params: Promise<{ bookingId: string }> }) {
  try {
    const { bookingId } = await params;
    const input = feedbackSchema.parse(await request.json());
    const booking = await db.interviewBooking.findFirst({
      where: { OR: [{ id: bookingId }, { calendarUid: bookingId }] },
      include: {
        panelMember: true,
        invitation: { include: { attempt: true } }
      }
    });

    if (!booking) {
      return NextResponse.json({ error: "Interview booking not found" }, { status: 404 });
    }

    const attemptId = booking.invitation.attempt?.id ?? null;
    const feedback = await db.interviewFeedback.upsert({
      where: { bookingId: booking.id },
      update: {
        interviewerId: booking.panelMemberId,
        attemptId,
        ...input
      },
      create: {
        bookingId: booking.id,
        interviewerId: booking.panelMemberId,
        attemptId,
        ...input
      }
    });

    if (attemptId) {
      await logAttemptEvent(attemptId, "interview.feedback", feedbackEventMessage(input), {
        speaker: "interviewer",
        kind: "feedback",
        interviewerId: booking.panelMemberId,
        interviewerName: booking.panelMember.name,
        technicalDepth: input.technicalDepth,
        productJudgment: input.productJudgment,
        communication: input.communication,
        aiCollaboration: input.aiCollaboration,
        hireRecommendation: input.hireRecommendation,
        summary: input.summary,
        strengths: input.strengths,
        concerns: input.concerns,
        followUps: input.followUps
      });
    }

    return NextResponse.json({ feedback });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to save interviewer feedback";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
