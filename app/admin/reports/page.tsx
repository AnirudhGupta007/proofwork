import Link from "next/link";
import { AdminShell } from "@/app/components/AdminShell";
import { getAdminContext } from "@/app/lib/admin-context";
import { db } from "@/app/lib/db";
import { aggregateScore } from "@/app/lib/domain/score";

export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const { organization } = await getAdminContext();
  const attempts = await db.attempt.findMany({
    where: { organizationId: organization.id },
    include: {
      candidate: true,
      template: true,
      scorecard: true,
      artifacts: { where: { kind: { in: ["reviewer_export", "proctoring_recording"] } }, orderBy: { createdAt: "desc" } }
    },
    orderBy: { updatedAt: "desc" },
    take: 100
  });

  return (
    <AdminShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Reports</p>
          <h1>Candidate evidence reports</h1>
          <p className="muted">Review scorecards, PDF reports, proctoring videos, and interview evidence from one place.</p>
        </div>
      </div>

      <section className="card">
        <table className="table">
          <thead>
            <tr>
              <th>Candidate</th>
              <th>Position</th>
              <th>Status</th>
              <th>Score</th>
              <th>Evidence</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {attempts.map((attempt) => {
              const score = attempt.scorecard
                ? attempt.scorecard.reviewerOverrideScore ??
                  aggregateScore({
                    requirements: attempt.scorecard.requirements,
                    testAndEvalQuality: attempt.scorecard.testAndEvalQuality,
                    debuggingDiscipline: attempt.scorecard.debuggingDiscipline,
                    codeQuality: attempt.scorecard.codeQuality,
                    aiCollaboration: attempt.scorecard.aiCollaboration,
                    productionReadiness: attempt.scorecard.productionReadiness,
                    communication: attempt.scorecard.communication
                  })
                : null;
              const recordingCount = attempt.artifacts.filter((artifact) => artifact.kind === "proctoring_recording").length;

              return (
                <tr key={attempt.id}>
                  <td>
                    <Link href={`/admin/attempts/${attempt.id}`}>{attempt.candidate.name}</Link>
                    <div className="muted">{attempt.candidate.email}</div>
                  </td>
                  <td>{attempt.template.roleTitle ?? attempt.template.title}</td>
                  <td>
                    <span className={attempt.status === "reviewed" ? "status green" : "status amber"}>{attempt.status}</span>
                  </td>
                  <td>{score ?? "Pending"}</td>
                  <td>{recordingCount} video artifact(s)</td>
                  <td>
                    <div className="button-row">
                      <Link className="button secondary" href={`/admin/attempts/${attempt.id}`}>
                        Details
                      </Link>
                      <a className="button secondary" href={`/api/admin/attempts/${attempt.id}/report`} target="_blank" rel="noreferrer">
                        PDF
                      </a>
                    </div>
                  </td>
                </tr>
              );
            })}
            {attempts.length === 0 ? (
              <tr>
                <td colSpan={6} className="muted">
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
