import Link from "next/link";
import { AdminShell } from "@/app/components/AdminShell";
import { getAdminContext } from "@/app/lib/admin-context";
import { db } from "@/app/lib/db";
import { overallScoreForScorecard } from "@/app/lib/domain/rubric";

export const dynamic = "force-dynamic";

function statusTone(status: string) {
  if (["reviewed", "in_progress"].includes(status)) return "green";
  if (["failed", "timed_out"].includes(status)) return "red";
  return "amber";
}

export default async function AdminDashboard() {
  const { organization } = await getAdminContext();
  const [attempts, invitations] = await Promise.all([
    db.attempt.findMany({
      where: { organizationId: organization.id },
      include: { candidate: true, template: true, scorecard: true },
      orderBy: { updatedAt: "desc" },
      take: 12
    }),
    db.invitation.findMany({
      where: { organizationId: organization.id },
      include: { candidate: true },
      orderBy: { createdAt: "desc" },
      take: 8
    })
  ]);

  const active = attempts.filter((attempt) => ["workspace_provisioning", "in_progress", "evaluating"].includes(attempt.status)).length;
  const completed = attempts.filter((attempt) => attempt.status === "reviewed").length;

  return (
    <AdminShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Hiring console</p>
          <h1>Real-world candidate assessments</h1>
          <p className="muted">Track role-based work trials, hosted workspaces, evidence, recordings, and reviewer scorecards.</p>
        </div>
        <Link className="button" href="/admin/invitations">
          Invite candidate
        </Link>
      </div>

      <section className="grid cols-3">
        <div className="card metric">
          <span className="muted">Assessment credits</span>
          <span className="metric-value">{organization.evaluationCredits}</span>
          <span className="status green">{organization.planName}</span>
        </div>
        <div className="card metric">
          <span className="muted">Invitations</span>
          <span className="metric-value">{invitations.length}</span>
        </div>
        <div className="card metric">
          <span className="muted">Active attempts</span>
          <span className="metric-value">{active}</span>
        </div>
      </section>

      <section className="card" style={{ marginTop: 18 }}>
        <h2>Recent attempts</h2>
        <table className="table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Task</th>
              <th>Status</th>
              <th>Score</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((attempt) => (
              <tr key={attempt.id}>
                <td>
                  <Link href={`/admin/attempts/${attempt.id}`}>{attempt.candidate.name}</Link>
                  <div className="muted">{attempt.candidate.email}</div>
                </td>
                <td>{attempt.template.title}</td>
                <td>
                  <span className={`status ${statusTone(attempt.status)}`}>{attempt.status}</span>
                </td>
                <td>
                  {attempt.scorecard
                    ? overallScoreForScorecard(attempt.scorecard, attempt.template.scoringWeights)
                    : "Pending"}
                </td>
                <td>{attempt.updatedAt.toLocaleString()}</td>
              </tr>
            ))}
            {attempts.length === 0 ? (
              <tr>
                <td colSpan={5} className="muted">
                  No attempts yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </section>
    </AdminShell>
  );
}
