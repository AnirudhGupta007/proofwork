import { NextResponse } from "next/server";
import { availableInterviewSlots, isLiveInterviewPlan } from "@/app/lib/interviews/scheduling";
import { redeemInvite } from "@/app/lib/invite-actions";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const invite = await redeemInvite(token);
    if (!isLiveInterviewPlan(invite.template.evaluationPlan)) {
      return NextResponse.json({ required: false, slots: [], booking: null });
    }

    const slots = invite.interviewBooking
      ? []
      : await availableInterviewSlots({
          organizationId: invite.organizationId,
          interviewerId: invite.interviewerId,
          durationMin: invite.template.durationMin
        });

    return NextResponse.json({
      required: true,
      slots,
      booking: invite.interviewBooking
        ? {
            id: invite.interviewBooking.id,
            startsAt: invite.interviewBooking.scheduledStart,
            endsAt: invite.interviewBooking.scheduledEnd,
            meetingUrl: invite.interviewBooking.meetingUrl,
            interviewerName: invite.interviewBooking.panelMember.name,
            interviewerEmail: invite.interviewBooking.panelMember.email
          }
        : null
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to load interview slots";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
