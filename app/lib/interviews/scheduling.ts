import { db } from "@/app/lib/db";
export { parseAvailabilityText } from "./availability";

export type InterviewSlot = {
  panelMemberId: string;
  interviewerName: string;
  interviewerEmail: string;
  startsAt: string;
  endsAt: string;
  timezone: string;
};

export function isLiveInterviewPlan(evaluationPlan: unknown) {
  if (!evaluationPlan || typeof evaluationPlan !== "object") return false;
  const plan = evaluationPlan as { assessmentMode?: unknown; liveInterview?: { enabled?: unknown } };
  return plan.assessmentMode === "live_guided" || plan.liveInterview?.enabled === true;
}

function startOfLocalDay(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function minutesToDate(day: Date, minutes: number) {
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0);
}

function overlaps(startA: Date, endA: Date, startB: Date, endB: Date) {
  return startA < endB && endA > startB;
}

export async function availableInterviewSlots({
  organizationId,
  interviewerId,
  durationMin,
  days = 14,
  now = new Date()
}: {
  organizationId: string;
  interviewerId?: string | null;
  durationMin: number;
  days?: number;
  now?: Date;
}) {
  const windowEnd = addDays(now, days);
  const members = await db.interviewPanelMember.findMany({
    where: {
      organizationId,
      isActive: true,
      ...(interviewerId ? { id: interviewerId } : {})
    },
    include: {
      availability: true,
      bookings: {
        where: {
          status: "scheduled",
          scheduledStart: { lt: windowEnd },
          scheduledEnd: { gt: now }
        }
      }
    },
    orderBy: [{ name: "asc" }]
  });

  const slots: InterviewSlot[] = [];
  for (const member of members) {
    for (let offset = 0; offset < days; offset += 1) {
      const day = addDays(startOfLocalDay(now), offset);
      const dayOfWeek = day.getDay();
      const windows = member.availability.filter((availability) => availability.dayOfWeek === dayOfWeek);
      for (const availability of windows) {
        for (let minute = availability.startMinutes; minute + durationMin <= availability.endMinutes; minute += durationMin) {
          const startsAt = minutesToDate(day, minute);
          const endsAt = minutesToDate(day, minute + durationMin);
          if (startsAt <= now) continue;
          const booked = member.bookings.some((booking) => overlaps(startsAt, endsAt, booking.scheduledStart, booking.scheduledEnd));
          if (booked) continue;
          slots.push({
            panelMemberId: member.id,
            interviewerName: member.name,
            interviewerEmail: member.email,
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
            timezone: availability.timezone || member.timezone
          });
        }
      }
    }
  }

  return slots.sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()).slice(0, 60);
}
