import Link from "next/link";
import { InterviewFeedbackForm } from "@/app/components/InterviewFeedbackForm";
import { db } from "@/app/lib/db";

export const dynamic = "force-dynamic";

export default async function InterviewRoomPage({ params }: { params: Promise<{ bookingId: string }> }) {
  const { bookingId } = await params;
  const booking = await db.interviewBooking.findFirst({
    where: { OR: [{ id: bookingId }, { calendarUid: bookingId }] },
    include: {
      candidate: true,
      feedback: true,
      panelMember: true,
      invitation: { include: { template: true, attempt: true } }
    }
  });

  if (!booking) {
    return (
      <main className="candidate-shell">
        <section className="card">
          <p className="eyebrow">Live interview</p>
          <h1>Interview not found</h1>
          <p className="muted">Check the calendar invite link or ask the hiring team to resend it.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="candidate-shell">
      <section className="card grid">
        <div>
          <p className="eyebrow">Proofwork live interview</p>
          <h1>{booking.invitation.template.title}</h1>
          <p className="muted">
            {booking.scheduledStart.toLocaleString()} with {booking.panelMember.name}
          </p>
        </div>
        <div className="generated-assessment">
          <div>
            <strong>Candidate</strong>
            <span>{booking.candidate.name} · {booking.candidate.email}</span>
          </div>
          <div>
            <strong>Interviewer</strong>
            <span>{booking.panelMember.name} · {booking.panelMember.email}</span>
          </div>
          <div>
            <strong>Round</strong>
            <span>{booking.invitation.template.roleTitle ?? "Live guided assessment"} · {booking.invitation.template.level}</span>
          </div>
        </div>
        <div className="notice-panel">
          <strong>Interview guidance</strong>
          <span>
            Join the candidate during the assessment window, ask clarifying and follow-up questions, and keep guidance light. Your written feedback
            after the call is the primary human review signal for this live guided round.
          </span>
        </div>
        <div className="button-row">
          <Link className="button" href="/admin/reports">
            Open reviewer reports
          </Link>
          {booking.invitation.attempt ? (
            <Link className="button secondary" href={`/admin/attempts/${booking.invitation.attempt.id}`}>
              Open attempt evidence
            </Link>
          ) : null}
        </div>
      </section>
      <InterviewFeedbackForm
        bookingId={booking.calendarUid}
        initialFeedback={
          booking.feedback
            ? {
                technicalDepth: booking.feedback.technicalDepth,
                productJudgment: booking.feedback.productJudgment,
                communication: booking.feedback.communication,
                aiCollaboration: booking.feedback.aiCollaboration,
                hireRecommendation: booking.feedback.hireRecommendation,
                summary: booking.feedback.summary,
                strengths: booking.feedback.strengths,
                concerns: booking.feedback.concerns,
                followUps: booking.feedback.followUps ?? ""
              }
            : null
        }
      />
    </main>
  );
}
