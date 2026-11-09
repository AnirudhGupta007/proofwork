import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminShell } from "@/app/components/AdminShell";
import { CandidateComparisonTable } from "@/app/components/CandidateComparisonTable";
import { getAdminContext } from "@/app/lib/admin-context";
import { loadTemplateComparison } from "./data";

export const dynamic = "force-dynamic";

export default async function CandidateComparisonPage({ params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const { organization } = await getAdminContext();
  const comparison = await loadTemplateComparison(organization.id, templateId);
  if (!comparison) notFound();

  const { template, rows } = comparison;
  const scored = rows.filter((row) => row.overallScore !== null).length;

  return (
    <AdminShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Candidate comparison</p>
          <h1>{template.title}</h1>
          <p className="muted">
            {rows.length} candidate{rows.length === 1 ? "" : "s"} · {scored} scored ·{" "}
            {template.hasCustomWeights ? "custom rubric weights" : "equal rubric weights"}
          </p>
        </div>
        <Link className="button secondary" href="/admin/assessments">
          Back to assessments
        </Link>
      </div>

      {rows.length === 0 ? (
        <section className="comparison-empty">
          <p className="comparison-empty-title">No candidates yet</p>
          <p className="muted">Invite candidates to this assessment and their scores will line up here once they submit.</p>
          <Link className="button secondary" href="/admin/invitations">
            Invite candidates
          </Link>
        </section>
      ) : (
        <CandidateComparisonTable rows={rows} />
      )}
    </AdminShell>
  );
}
