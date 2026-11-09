import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/app/lib/db";
import { env } from "@/app/lib/env";
import { sendInterviewCalendarInvite } from "@/app/lib/interviews/calendar";
import { availableInterviewSlots, isLiveInterviewPlan } from "@/app/lib/interviews/scheduling";
import { redeemInvite } from "@/app/lib/invite-actions";

const bookingSchema = z.object({
  panelMemberId: z.string().min(2),
  startsAt: z.string().datetime()
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const input = bookingSchema.parse(await request.json());
    const invite = await redeemInvite(token);
    if (!isLiveInterviewPlan(invite.template.evaluationPlan)) throw new Error("This assessment does not require a live interview.");
    if (invite.interviewBooking) return NextResponse.json({ booking: invite.interviewBooking });
    if (invite.interviewerId && invite.interviewerId !== input.panelMemberId) throw new Error("Choose a slot with the assigned interviewer.");

    const slots = await availableInterviewSlots({
      organizationId: invite.organizationId,
      interviewerId: invite.interviewerId,
      durationMin: invite.template.durationMin
    });
    const slot = slots.find((candidateSlot) => candidateSlot.panelMemberId === input.panelMemberId && candidateSlot.startsAt === input.startsAt);
    if (!slot) throw new Error("This slot is no longer available. Pick another time.");

    const startsAt = new Date(slot.startsAt);
    const endsAt = new Date(slot.endsAt);
    const calendarUid = `${randomUUID()}@proofwork.local`;

    const booking = await db.$transaction(async (tx) => {
      const conflict = await tx.interviewBooking.findFirst({
        where: {
          panelMemberId: input.panelMemberId,
          status: "scheduled",
          scheduledStart: { lt: endsAt },
          scheduledEnd: { gt: startsAt }
        }
      });
      if (conflict) throw new Error("This slot was just booked. Pick another time.");

      return tx.interviewBooking.create({
        data: {
          organizationId: invite.organizationId,
          invitationId: invite.id,
          candidateId: invite.candidateId,
          panelMemberId: input.panelMemberId,
          scheduledStart: startsAt,
          scheduledEnd: endsAt,
          timezone: slot.timezone,
          meetingUrl: `${env.NEXT_PUBLIC_APP_URL}/interview/${calendarUid}`,
          calendarUid
        },
        include: { panelMember: true, candidate: true, invitation: { include: { template: true } } }
      });
    });

    await sendInterviewCalendarInvite({
      candidateName: booking.candidate.name,
      candidateEmail: booking.candidate.email,
      interviewerName: booking.panelMember.name,
      interviewerEmail: booking.panelMember.email,
      assessmentTitle: booking.invitation.template.title,
      startsAt: booking.scheduledStart,
      endsAt: booking.scheduledEnd,
      meetingUrl: booking.meetingUrl,
      calendarUid: booking.calendarUid
    });

    return NextResponse.json({ booking }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to book interview";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
