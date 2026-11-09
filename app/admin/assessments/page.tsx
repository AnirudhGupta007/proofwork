import Link from "next/link";
import { AdminShell } from "@/app/components/AdminShell";
import { AssessmentTemplateActions } from "@/app/components/AssessmentTemplateActions";
import { getAdminContext } from "@/app/lib/admin-context";
import { db } from "@/app/lib/db";

export const dynamic = "force-dynamic";

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function preflightStatus(value: unknown) {
  if (!value || typeof value !== "object") return "not checked";
  const preflight = (value as { preflight?: unknown }).preflight;
  if (!preflight || typeof preflight !== "object") return "not checked";
  return (preflight as { passed?: unknown }).passed ? "passed" : "failed";
}

export default async function AssessmentsPage() {
  const { organization } = await getAdminContext();
  const templates = await db.assessmentTemplate.findMany({
    where: { organizationId: organization.id },
    include: {
      _count: {
        select: { invitations: true, attempts: true }
      }
    },
    orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }]
  });

  return (
    <AdminShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Assessment library</p>
          <h1>Saved assessment templates</h1>
          <p className="muted">
            Reuse generated assessments instead of rebuilding them for every applicant. Invite candidates from any template.
          </p>
        </div>
        <Link className="button" href="/admin/invitations">
          Create or invite
        </Link>
      </div>

      <section className="template-library">
        {templates.map((template) => {
          const evaluationPlan =
            template.evaluationPlan && typeof template.evaluationPlan === "object"
              ? (template.evaluationPlan as {
                  focus?: unknown;
                  requiredEvidence?: unknown;
                  repository?: { source?: string; repoUrl?: string };
                  reviewWorkspace?: {
                    status?: string;
                    appPreviewUrl?: string;
                    terminalUrl?: string;
                    error?: string;
                    readyAt?: string;
                    expiresAt?: string;
                  };
                })
              : null;
          const focus = stringList(evaluationPlan?.focus);
          const evidence = stringList(evaluationPlan?.requiredEvidence);
          const preflight = preflightStatus(template.evaluationPlan);
          const reviewWorkspace = evaluationPlan?.reviewWorkspace;

          return (
            <article className={template.isActive ? "template-card active" : "template-card"} key={template.id}>
              <div className="template-card-header">
                <div>
                  <p className="eyebrow">{template.roleTitle ?? "Position"} · {template.durationMin} min</p>
                  <h2>{template.title}</h2>
                </div>
                <AssessmentTemplateActions templateId={template.id} isActive={template.isActive} />
              </div>
              <p className="muted">{template.taskBrief ?? template.instructions.split("\n")[0]}</p>

              <div className="template-meta-grid">
                <div>
                  <strong>Repo</strong>
                  <span>{evaluationPlan?.repository?.source === "github" ? evaluationPlan.repository.repoUrl : template.repoUrl}</span>
                </div>
                <div>
                  <strong>Preflight</strong>
                  <span className={preflight === "passed" ? "status green" : "status amber"}>{preflight}</span>
                </div>
                <div>
                  <strong>Review workspace</strong>
                  <span className={reviewWorkspace?.status === "ready" ? "status green" : reviewWorkspace?.status === "failed" ? "status red" : "status amber"}>
                    {reviewWorkspace?.status ?? "not created"}
                  </span>
                </div>
                <div>
                  <strong>Usage</strong>
                  <span>{template._count.invitations} invites · {template._count.attempts} attempts</span>
                </div>
                <div>
                  <strong>Updated</strong>
                  <span>{template.updatedAt.toLocaleString()}</span>
                </div>
              </div>

              {reviewWorkspace?.status === "ready" ? (
                <div className="button-row">
                  {reviewWorkspace.appPreviewUrl ? (
                    <a className="button" href={reviewWorkspace.appPreviewUrl} target="_blank" rel="noreferrer">
                      Review running project
                    </a>
                  ) : null}
                  {reviewWorkspace.terminalUrl ? (
                    <a className="button secondary" href={reviewWorkspace.terminalUrl} target="_blank" rel="noreferrer">
                      Open review terminal
                    </a>
                  ) : null}
                  {reviewWorkspace.expiresAt ? <span className="muted">Expires {new Date(reviewWorkspace.expiresAt).toLocaleString()}</span> : null}
                </div>
              ) : reviewWorkspace?.status === "failed" ? (
                <p className="error-text">Review workspace failed: {reviewWorkspace.error}</p>
              ) : null}

              <div className="template-detail-grid">
                <div>
                  <p className="eyebrow">Eval focus</p>
                  <ul>
                    {(focus.length ? focus : ["No eval focus saved."]).slice(0, 6).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
                <div>
                  <p className="eyebrow">Expected evidence</p>
                  <ul>
                    {(evidence.length ? evidence : ["No expected evidence saved."]).slice(0, 6).map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            </article>
          );
        })}
        {templates.length === 0 ? (
          <section className="card">
            <h2>No templates yet</h2>
            <p className="muted">Create your first assessment from the invitations page. It will appear here for reuse.</p>
          </section>
        ) : null}
      </section>
    </AdminShell>
  );
}
