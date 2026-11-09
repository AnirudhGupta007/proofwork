import { NextResponse } from "next/server";
import { getAdminContext } from "@/app/lib/admin-context";
import { db } from "@/app/lib/db";

export async function POST(_request: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params;
  const { organization } = await getAdminContext();
  const invitation = await db.invitation.findFirst({
    where: { id: invitationId, organizationId: organization.id },
    include: { attempt: true }
  });

  if (!invitation) return NextResponse.json({ error: "Invitation not found" }, { status: 404 });
  if (invitation.attempt) return NextResponse.json({ error: "Cannot cancel an invite after an attempt has started." }, { status: 400 });

  const cancelled = await db.invitation.update({
    where: { id: invitation.id },
    data: { status: "cancelled", cancelledAt: new Date() }
  });

  return NextResponse.json({ invitation: cancelled });
}
