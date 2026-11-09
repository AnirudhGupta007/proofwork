import { AdminShell } from "@/app/components/AdminShell";
import { AssessmentDesigner } from "@/app/components/AssessmentDesigner";
import { InviteForm } from "@/app/components/InviteForm";
import { InvitationActions } from "@/app/components/InvitationActions";
import { toSavedAssessmentIdeaView } from "@/app/lib/assessment-idea-store";
import { getAdminContext } from "@/app/lib/admin-context";
import { db } from "@/app/lib/db";

export const dynamic = "force-dynamic";

export default async function InvitationsPage() {
  const { organization, template } = await getAdminContext();
  const invitations = await db.invitation.findMany({
    where: { organizationId: organization.id },
    include: { candidate: true, template: true, attempt: true, interviewer: true, interviewBooking: true },
    orderBy: { createdAt: "desc" }
  });
  const savedIdeas = await db.savedAssessmentIdea.findMany({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "desc" },
    take: 30
  });
  const templates = await db.assessmentTemplate.findMany({
    where: { organizationId: organization.id },
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      title: true,
      roleTitle: true,
      level: true,
      durationMin: true,
      taskBrief: true,
      isActive: true,
      evaluationPlan: true,
      updatedAt: true
    }
  });
  const interviewers = await db.interviewPanelMember.findMany({
    where: { organizationId: organization.id, isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, title: true, timezone: true }
  });

  return (
    <AdminShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Invitations</p>
          <h1>Invite candidates</h1>
          <p className="muted">
            Each email contains only the candidate name, assessment title, expiry, and magic link. Credits are used when candidates start.
          </p>
        </div>
      </div>

      <div className="grid">
        <section className="credit-panel">
          <div>
            <p className="eyebrow">Free trial</p>
            <h2>{organization.evaluationCredits} assessment credits remaining</h2>
            <p className="muted">Your trial starts with 5 started assessments. Upgrade later to add packs or team seats.</p>
          </div>
          <span className="status green">{organization.planName}</span>
        </section>
        <AssessmentDesigner initialTemplate={JSON.parse(JSON.stringify(template))} initialIdeas={savedIdeas.map(toSavedAssessmentIdeaView)} />
        <InviteForm
          creditsRemaining={organization.evaluationCredits}
          templates={JSON.parse(JSON.stringify(templates))}
          defaultTemplateId={template.id}
          interviewers={JSON.parse(JSON.stringify(interviewers))}
        />
        <section className="card">
          <h2>Invite history</h2>
          <table className="table">
            <thead>
              <tr>
                <th>Candidate</th>
                <th>Assessment</th>
                <th>Interviewer</th>
                <th>Status</th>
                <th>Expires</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {invitations.map((invite) => (
                <tr key={invite.id}>
                  <td>
                    {invite.candidate.name}
                    <div className="muted">{invite.candidate.email}</div>
                  </td>
                  <td>{invite.template.title}</td>
                  <td>
                    {invite.interviewer ? invite.interviewer.name : "Any available"}
                    {invite.interviewBooking ? <div className="muted">{invite.interviewBooking.scheduledStart.toLocaleString()}</div> : null}
                  </td>
                  <td>
                    <span className="status amber">{invite.status}</span>
                  </td>
                  <td>{invite.expiresAt.toLocaleString()}</td>
                  <td>
                    <InvitationActions
                      invitationId={invite.id}
                      canModify={!invite.attempt && !["cancelled", "redeemed"].includes(invite.status)}
                    />
                  </td>
                </tr>
              ))}
              {invitations.length === 0 ? (
                <tr>
                  <td colSpan={6} className="muted">
                    No invitations yet.
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
