import { db } from "@/app/lib/db";
import { hashInviteToken } from "@/app/lib/domain/invites";

export async function redeemInterviewerAccessToken(token: string) {
  const tokenHash = hashInviteToken(token);
  const interviewer = await db.interviewPanelMember.findUnique({
    where: { accessTokenHash: tokenHash },
    include: {
      organization: true,
      availability: { orderBy: [{ dayOfWeek: "asc" }, { startMinutes: "asc" }] },
      bookings: {
        where: { scheduledStart: { gte: new Date() }, status: "scheduled" },
        include: { candidate: true, invitation: { include: { template: true } } },
        orderBy: { scheduledStart: "asc" },
        take: 10
      }
    }
  });

  if (!interviewer) throw new Error("Interviewer invite not found.");
  if (interviewer.accessTokenExpiresAt && interviewer.accessTokenExpiresAt.getTime() <= Date.now()) {
    throw new Error("Interviewer invite expired. Ask the admin to resend it.");
  }

  await db.interviewPanelMember.update({
    where: { id: interviewer.id },
    data: { lastAccessedAt: new Date() }
  });

  return interviewer;
}
