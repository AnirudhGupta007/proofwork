import { AdminShell } from "@/app/components/AdminShell";
import { InterviewPanelForm } from "@/app/components/InterviewPanelForm";
import { getAdminContext } from "@/app/lib/admin-context";
import { db } from "@/app/lib/db";

export const dynamic = "force-dynamic";

function minutesLabel(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function InterviewersPage() {
  const { organization } = await getAdminContext();
  const interviewers = await db.interviewPanelMember.findMany({
    where: { organizationId: organization.id },
    include: {
      availability: { orderBy: [{ dayOfWeek: "asc" }, { startMinutes: "asc" }] },
      bookings: {
        where: { scheduledStart: { gte: new Date() }, status: "scheduled" },
        include: { candidate: true },
        orderBy: { scheduledStart: "asc" },
        take: 5
      }
    },
    orderBy: [{ isActive: "desc" }, { name: "asc" }]
  });

  return (
    <AdminShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Live interviews</p>
          <h1>Interview panel</h1>
          <p className="muted">Invite employees, let them set their own availability, and let candidates book live guided assessment slots.</p>
        </div>
      </div>
      <div className="grid">
        <InterviewPanelForm />
        <section className="card">
          <h2>Panel members</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Interviewer</th>
                <th>Availability</th>
                <th>Invite status</th>
                <th>Upcoming bookings</th>
              </tr>
            </thead>
            <tbody>
              {interviewers.map((member) => (
                <tr key={member.id}>
                  <td>
                    {member.name}
                    <div className="muted">{member.email}</div>
                    <div className="muted">{member.title ?? "Interviewer"} · {member.timezone}</div>
                  </td>
                  <td>
                    {member.availability.length > 0 ? (
                      member.availability.map((slot) => (
                        <div key={slot.id}>
                          {days[slot.dayOfWeek]} {minutesLabel(slot.startMinutes)}-{minutesLabel(slot.endMinutes)}
                        </div>
                      ))
                    ) : (
                      <span className="muted">Waiting for availability.</span>
                    )}
                  </td>
                  <td>
                    {member.availabilityUpdatedAt ? (
                      <span className="status green">availability set</span>
                    ) : member.invitedAt ? (
                      <span className="status amber">invited</span>
                    ) : (
                      <span className="status amber">not invited</span>
                    )}
                    <div className="muted">
                      {member.availabilityUpdatedAt
                        ? `Updated ${member.availabilityUpdatedAt.toLocaleString()}`
                        : member.invitedAt
                          ? `Sent ${member.invitedAt.toLocaleString()}`
                          : ""}
                    </div>
                  </td>
                  <td>
                    {member.bookings.length > 0
                      ? member.bookings.map((booking) => (
                          <div key={booking.id}>
                            {booking.candidate.name} · {booking.scheduledStart.toLocaleString()}
                          </div>
                        ))
                      : <span className="muted">No upcoming bookings.</span>}
                  </td>
                </tr>
              ))}
              {interviewers.length === 0 ? (
                <tr>
                  <td colSpan={4} className="muted">
                    No interviewers added yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </section>
      </div>
    </AdminShell>
  );
}
