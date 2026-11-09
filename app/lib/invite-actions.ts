import { db } from "@/app/lib/db";
import { hashInviteToken, isInviteExpired } from "@/app/lib/domain/invites";

const inviteInclude = {
  candidate: true,
  template: true,
  interviewer: true,
  interviewBooking: { include: { panelMember: true } },
  attempt: { include: { workspace: true, scorecard: true } }
} as const;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function redeemInvite(token: string) {
  const tokenHash = hashInviteToken(token);
  let invitation = await db.invitation.findUnique({
    where: { tokenHash },
    include: inviteInclude
  });

  for (const delayMs of [120, 300, 700]) {
    if (invitation) break;
    await wait(delayMs);
    invitation = await db.invitation.findUnique({
      where: { tokenHash },
      include: inviteInclude
    });
  }

  if (!invitation) throw new Error("Invite not found");
  if (invitation.status === "cancelled") throw new Error("Invite was cancelled");
  if (isInviteExpired(invitation.expiresAt)) {
    await db.invitation.update({ where: { id: invitation.id }, data: { status: "expired" } });
    throw new Error("Invite expired");
  }

  if (invitation.status === "pending") {
    await db.invitation.update({
      where: { id: invitation.id },
      data: { status: "opened", openedAt: new Date() }
    });
  }

  return invitation;
}
