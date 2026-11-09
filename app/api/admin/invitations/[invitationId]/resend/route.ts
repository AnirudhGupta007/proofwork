import { NextResponse } from "next/server";
import { getAdminContext } from "@/app/lib/admin-context";
import { db } from "@/app/lib/db";
import { createInviteToken, hashInviteToken } from "@/app/lib/domain/invites";
import { addMinutes } from "@/app/lib/domain/time";
import { sendInviteEmail } from "@/app/lib/email/invites";
import { env } from "@/app/lib/env";

export async function POST(_request: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params;
  const { organization } = await getAdminContext();
  const invitation = await db.invitation.findFirst({
    where: { id: invitationId, organizationId: organization.id },
    include: { candidate: true, template: true, attempt: true }
  });

  if (!invitation) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  if (invitation.attempt) return NextResponse.json({ error: "Candidate has already started this assessment." }, { status: 400 });
  if (invitation.status === "cancelled") return NextResponse.json({ error: "Cannot resend a cancelled invite." }, { status: 400 });

  const token = createInviteToken();
  const expiresAt = addMinutes(new Date(), 7 * 24 * 60);
  const inviteUrl = `${env.NEXT_PUBLIC_APP_URL}/assessment/${token}`;

  await db.invitation.update({
    where: { id: invitation.id },
    data: {
      tokenHash: hashInviteToken(token),
      expiresAt,
      status: "pending",
      cancelledAt: null
    }
  });

  await sendInviteEmail({
    to: invitation.candidate.email,
    candidateName: invitation.candidate.name,
    assessmentTitle: invitation.template.title,
    durationMin: invitation.template.durationMin,
    inviteUrl,
    expiresAt
  });

  return NextResponse.json({ inviteUrl });
}
