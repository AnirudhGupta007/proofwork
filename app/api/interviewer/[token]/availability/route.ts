import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/app/lib/db";
import { parseAvailabilityText } from "@/app/lib/interviews/scheduling";
import { redeemInterviewerAccessToken } from "@/app/lib/interviews/interviewer-access";

const availabilitySchema = z.object({
  timezone: z.string().min(2),
  availabilityText: z.string().min(8, "Add at least one availability window.")
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const input = availabilitySchema.parse(await request.json());
    const interviewer = await redeemInterviewerAccessToken(token);
    const availability = parseAvailabilityText(input.availabilityText, input.timezone);

    const saved = await db.$transaction(async (tx) => {
      await tx.interviewPanelMember.update({
        where: { id: interviewer.id },
        data: {
          timezone: input.timezone.trim(),
          availabilityUpdatedAt: new Date(),
          lastAccessedAt: new Date()
        }
      });

      await tx.interviewAvailability.deleteMany({ where: { panelMemberId: interviewer.id } });
      await tx.interviewAvailability.createMany({
        data: availability.map((entry) => ({
          panelMemberId: interviewer.id,
          dayOfWeek: entry.dayOfWeek,
          startMinutes: entry.startMinutes,
          endMinutes: entry.endMinutes,
          timezone: entry.timezone ?? input.timezone.trim()
        }))
      });

      return tx.interviewPanelMember.findUniqueOrThrow({
        where: { id: interviewer.id },
        include: {
          availability: { orderBy: [{ dayOfWeek: "asc" }, { startMinutes: "asc" }] },
          bookings: {
            where: { scheduledStart: { gte: new Date() }, status: "scheduled" },
            include: { candidate: true, invitation: { include: { template: true } } },
            orderBy: { scheduledStart: "asc" },
            take: 10
          }
        }
      });
    });

    return NextResponse.json({ interviewer: saved });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to save availability.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
