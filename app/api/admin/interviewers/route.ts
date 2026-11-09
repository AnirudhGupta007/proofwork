import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/app/lib/admin-context";
import { db } from "@/app/lib/db";
import { createInviteToken, hashInviteToken } from "@/app/lib/domain/invites";
import { addMinutes } from "@/app/lib/domain/time";
import { sendInterviewerInviteEmail } from "@/app/lib/email/interviewers";
import { env } from "@/app/lib/env";
import { parseAvailabilityText } from "@/app/lib/interviews/scheduling";

const interviewerSchema = z.object({
  name: z.string().min(2),
  email: z.string().email(),
  title: z.string().optional(),
  timezone: z.string().min(2).default("Asia/Kolkata"),
  availabilityText: z.string().optional()
});

export async function GET() {
  const { organization } = await getAdminContext();
  const interviewers = await db.interviewPanelMember.findMany({
    where: { organizationId: organization.id },
    include: { availability: { orderBy: [{ dayOfWeek: "asc" }, { startMinutes: "asc" }] } },
    orderBy: [{ isActive: "desc" }, { name: "asc" }]
  });

  return NextResponse.json({ interviewers });
}

export async function POST(request: Request) {
  try {
    const input = interviewerSchema.parse(await request.json());
    const { organization } = await getAdminContext();
    const availability = input.availabilityText?.trim() ? parseAvailabilityText(input.availabilityText, input.timezone) : [];
    const accessToken = createInviteToken();
    const accessTokenExpiresAt = addMinutes(new Date(), 30 * 24 * 60);

    const member = await db.$transaction(async (tx) => {
      const saved = await tx.interviewPanelMember.upsert({
        where: {
          organizationId_email: {
            organizationId: organization.id,
            email: input.email.trim().toLowerCase()
          }
        },
        update: {
          name: input.name.trim(),
          title: input.title?.trim() || null,
          timezone: input.timezone,
          isActive: true,
          accessTokenHash: hashInviteToken(accessToken),
          accessTokenExpiresAt,
          invitedAt: new Date()
        },
        create: {
          organizationId: organization.id,
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          title: input.title?.trim() || null,
          timezone: input.timezone,
          isActive: true,
          accessTokenHash: hashInviteToken(accessToken),
          accessTokenExpiresAt,
          invitedAt: new Date()
        }
      });

      if (availability.length > 0) {
        await tx.interviewAvailability.deleteMany({ where: { panelMemberId: saved.id } });
        await tx.interviewAvailability.createMany({
          data: availability.map((entry) => ({
            panelMemberId: saved.id,
            dayOfWeek: entry.dayOfWeek,
            startMinutes: entry.startMinutes,
            endMinutes: entry.endMinutes,
            timezone: entry.timezone ?? input.timezone
          }))
        });
        await tx.interviewPanelMember.update({
          where: { id: saved.id },
          data: { availabilityUpdatedAt: new Date() }
        });
      }

      return tx.interviewPanelMember.findUniqueOrThrow({
        where: { id: saved.id },
        include: { availability: { orderBy: [{ dayOfWeek: "asc" }, { startMinutes: "asc" }] } }
      });
    });

    const accessUrl = `${env.NEXT_PUBLIC_APP_URL}/interviewer/${accessToken}`;
    await sendInterviewerInviteEmail({
      to: member.email,
      interviewerName: member.name,
      organizationName: organization.name,
      accessUrl,
      expiresAt: accessTokenExpiresAt
    });

    return NextResponse.json({ interviewer: member, accessUrl }, { status: 201 });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to save interviewer";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
