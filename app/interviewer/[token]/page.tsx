import Link from "next/link";
import { InterviewerAvailabilityForm } from "@/app/components/InterviewerAvailabilityForm";
import { redeemInterviewerAccessToken } from "@/app/lib/interviews/interviewer-access";

export const dynamic = "force-dynamic";

const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function minutesLabel(value: number) {
  const hours = Math.floor(value / 60);
  const minutes = value % 60;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

function availabilityToText(
  availability: Array<{ dayOfWeek: number; startMinutes: number; endMinutes: number }>
) {
  return availability
    .map((slot) => `${days[slot.dayOfWeek]} ${minutesLabel(slot.startMinutes)}-${minutesLabel(slot.endMinutes)}`)
    .join("\n");
}

export default async function InterviewerAvailabilityPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await redeemInterviewerAccessToken(token)
    .then((interviewer) => ({ interviewer, error: null as string | null }))
    .catch((error: Error) => ({ interviewer: null, error: error.message }));

  if (!result.interviewer) {
    return (
      <main className="candidate-shell">
        <section className="card grid">
          <div>
            <p className="eyebrow">Proofwork interview panel</p>
            <h1>Interviewer link unavailable</h1>
            <p className="muted">{result.error ?? "This link is invalid or expired."}</p>
          </div>
          <Link className="button secondary" href="/">
            Back to Proofwork
          </Link>
        </section>
      </main>
    );
  }

  const interviewer = result.interviewer;
  const initialAvailabilityText = availabilityToText(interviewer.availability);

  return (
    <main className="candidate-shell">
      <section className="card grid">
        <div>
          <p className="eyebrow">Proofwork interview panel</p>
          <h1>Set your availability</h1>
          <p className="muted">
            {interviewer.organization.name} invited you to run live guided candidate assessments.
          </p>
        </div>
        <div className="generated-assessment">
          <div>
            <strong>Name</strong>
            <span>{interviewer.name}</span>
          </div>
          <div>
            <strong>Email</strong>
            <span>{interviewer.email}</span>
          </div>
          <div>
            <strong>Panel role</strong>
            <span>{interviewer.title ?? "Interviewer"}</span>
          </div>
        </div>
      </section>

      <div className="grid cols-2" style={{ marginTop: 16 }}>
        <InterviewerAvailabilityForm
          token={token}
          initialAvailabilityText={initialAvailabilityText}
          initialTimezone={interviewer.timezone}
        />
        <section className="card grid">
          <div>
            <p className="eyebrow">Upcoming bookings</p>
            <h2>Your candidate calls</h2>
            <p className="muted">These are already reserved and will not be offered as open slots.</p>
          </div>
          {interviewer.bookings.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Candidate</th>
                  <th>When</th>
                  <th>Round</th>
                </tr>
              </thead>
              <tbody>
                {interviewer.bookings.map((booking) => (
                  <tr key={booking.id}>
                    <td>
                      {booking.candidate.name}
                      <div className="muted">{booking.candidate.email}</div>
                    </td>
                    <td>{booking.scheduledStart.toLocaleString()}</td>
                    <td>{booking.invitation.template.title}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">No candidate calls booked yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}
