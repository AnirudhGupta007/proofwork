import { notFound } from "next/navigation";
import { AdminShell } from "@/app/components/AdminShell";
import { InterviewTranscriptLogger } from "@/app/components/InterviewTranscriptLogger";
import { ScorecardForm } from "@/app/components/ScorecardForm";
import { getAdminContext } from "@/app/lib/admin-context";
import { rehydrateArtifactTexts } from "@/app/lib/artifacts";
import { db } from "@/app/lib/db";
import { overallScoreForScorecard } from "@/app/lib/domain/rubric";

export const dynamic = "force-dynamic";

function artifactOutput(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const output = (metadata as { stdout?: unknown; stderr?: unknown }).stdout ?? (metadata as { stdout?: unknown; stderr?: unknown }).stderr;
  return typeof output === "string" && output.trim() ? output : null;
}

function promptQualitySummary(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return null;
  const record = metadata as { qualityScore?: unknown; promptCount?: unknown; strengths?: unknown; concerns?: unknown; summary?: unknown };
  const qualityScore = typeof record.qualityScore === "number" ? `${record.qualityScore}/5` : "Pending";
  const promptCount = typeof record.promptCount === "number" ? record.promptCount : 0;
  const strengths = Array.isArray(record.strengths) ? record.strengths.join(", ") : "none captured";
  const concerns = Array.isArray(record.concerns) ? record.concerns.join(", ") : "none";
  const summary = typeof record.summary === "string" ? record.summary : "Prompt quality analysis was not available.";

  return { qualityScore, promptCount, strengths, concerns, summary };
}

function hiringRecommendation(score: number | null) {
  if (score === null) return "Pending";
  if (score >= 78) return "Hire";
  if (score >= 68) return "Lean hire";
  if (score >= 60) return "Lean no hire";
  return "No hire";
}

function workspacePerformance(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return [];
  const timings = (metadata as { provisioningTimings?: unknown }).provisioningTimings;
  if (!Array.isArray(timings)) return [];
  return timings
    .map((timing) => {
      if (!timing || typeof timing !== "object") return null;
      const record = timing as { label?: unknown; durationMs?: unknown; exitCode?: unknown };
      if (typeof record.label !== "string" || typeof record.durationMs !== "number") return null;
      return {
        label: record.label.replaceAll("_", " "),
        duration: record.durationMs >= 1000 ? `${(record.durationMs / 1000).toFixed(1)}s` : `${record.durationMs}ms`,
        exitCode: typeof record.exitCode === "number" ? record.exitCode : null
      };
    })
    .filter((item): item is { label: string; duration: string; exitCode: number | null } => Boolean(item));
}

export default async function AttemptDetailPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const { organization } = await getAdminContext();
  const attempt = await db.attempt.findFirst({
    where: { id: attemptId, organizationId: organization.id },
    include: {
      candidate: true,
      template: true,
      workspace: true,
      artifacts: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "desc" }, take: 20 },
      evalRuns: { orderBy: { createdAt: "desc" }, take: 5 },
      scorecard: true
    }
  });

  if (!attempt) notFound();

  // Pull R2-backed artifact bodies into metadata.stdout in parallel
  // so artifactOutput / promptQualitySummary / etc. see the legacy
  // shape regardless of where the bytes actually live. No-op for
  // inline:// artifacts.
  await rehydrateArtifactTexts(attempt.artifacts);

  const scorecard = attempt.scorecard;
  const latestArtifacts = Array.from(
    attempt.artifacts
      .reduce((byLabel, artifact) => {
        if (!byLabel.has(artifact.label)) byLabel.set(artifact.label, artifact);
        return byLabel;
      }, new Map<string, (typeof attempt.artifacts)[number]>())
      .values()
  );
  const aggregate = scorecard
    ? overallScoreForScorecard(scorecard, attempt.template.scoringWeights)
    : null;
  const promptQuality = promptQualitySummary(latestArtifacts.find((artifact) => artifact.label === "Prompt quality analysis")?.metadata);
  const evaluationPlan =
    attempt.template.evaluationPlan && typeof attempt.template.evaluationPlan === "object"
      ? (attempt.template.evaluationPlan as { assessmentMode?: string; liveInterview?: { enabled?: boolean } })
      : null;
  const liveInterviewEnabled = evaluationPlan?.assessmentMode === "live_guided" || Boolean(evaluationPlan?.liveInterview?.enabled);
  const interviewEvents = attempt.events
    .filter((event) => event.type.startsWith("interview."))
    .map((event) => ({
      id: event.id,
      type: event.type,
      message: event.message,
      createdAt: event.createdAt.toISOString()
    }));
  const recordings = latestArtifacts.filter((artifact) => artifact.kind === "proctoring_recording");
  const performance = workspacePerformance(attempt.workspace?.metadata);

  return (
    <AdminShell>
      <div className="topbar">
        <div>
          <p className="eyebrow">Attempt review</p>
          <h1>{attempt.candidate.name}</h1>
          <p className="muted">
            {attempt.candidate.email} · {attempt.template.title}
          </p>
        </div>
        <div className="button-row">
          <a className="button secondary" href={`/api/admin/attempts/${attempt.id}/report`} target="_blank" rel="noreferrer">
            Preview PDF
          </a>
          <form action={`/api/admin/attempts/${attempt.id}/rerun-eval`} method="post">
            <button className="button secondary" type="submit">
              Rerun eval
            </button>
          </form>
        </div>
      </div>

      <section className="grid cols-3">
        <div className="card metric">
          <span className="muted">Status</span>
          <span className="metric-value" style={{ fontSize: 20 }}>
            {attempt.status}
          </span>
        </div>
        <div className="card metric">
          <span className="muted">Score</span>
          <span className="metric-value">{aggregate ?? "Pending"}</span>
        </div>
        <div className="card metric">
          <span className="muted">Recommendation</span>
          <span className="metric-value" style={{ fontSize: 20 }}>
            {hiringRecommendation(aggregate)}
          </span>
        </div>
        <div className="card metric">
          <span className="muted">Due</span>
          <span className="metric-value" style={{ fontSize: 20 }}>
            {attempt.dueAt?.toLocaleString() ?? "Not started"}
          </span>
        </div>
      </section>

      <div className="grid cols-2" style={{ marginTop: 18 }}>
        {recordings.length > 0 ? (
          <section className="card">
            <p className="eyebrow">Interview video</p>
            <h2>Recordings</h2>
            <div className="grid">
              {recordings.map((artifact) => (
                <div key={artifact.id}>
                  <strong>{artifact.label}</strong>
                  <video className="recording-video" controls preload="metadata" src={`/api/admin/artifacts/${artifact.id}/download`} />
                  <div>
                    <a className="button secondary" href={`/api/admin/artifacts/${artifact.id}/download`} target="_blank" rel="noreferrer">
                      Open video
                    </a>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ) : null}
        {liveInterviewEnabled ? <InterviewTranscriptLogger attemptId={attempt.id} initialEvents={interviewEvents} /> : null}
        {promptQuality ? (
          <section className="card">
            <p className="eyebrow">Prompting signal</p>
            <h2>AI prompt quality</h2>
            <p className="muted">{promptQuality.summary}</p>
            <div className="grid cols-2" style={{ marginTop: 14 }}>
              <div>
                <strong>{promptQuality.qualityScore}</strong>
                <div className="muted">Prompt quality score</div>
              </div>
              <div>
                <strong>{promptQuality.promptCount}</strong>
                <div className="muted">Captured prompt markers</div>
              </div>
            </div>
            <p className="muted" style={{ marginTop: 14 }}>
              Strengths: {promptQuality.strengths}
            </p>
            <p className="muted">Concerns: {promptQuality.concerns}</p>
          </section>
        ) : null}
        <section className="card">
          <p className="eyebrow">Evidence</p>
          <h2>Artifacts</h2>
          <ul className="artifact-list">
            {latestArtifacts.map((artifact) => (
              <li key={artifact.id}>
                <strong>{artifact.label}</strong>
                <div className="muted">
                  {artifact.kind} · {artifact.uri}
                </div>
                {artifactOutput(artifact.metadata) ? <pre className="artifact-output">{artifactOutput(artifact.metadata)}</pre> : null}
              </li>
            ))}
            {latestArtifacts.length === 0 ? <li className="muted">No artifacts collected yet.</li> : null}
          </ul>
        </section>

        <section className="card">
          <p className="eyebrow">Automation</p>
          <h2>Eval runs</h2>
          <ul className="artifact-list">
            {attempt.evalRuns.map((run) => (
              <li key={run.id}>
                <strong>{run.status}</strong>
                <div className="muted">{run.summary ?? run.error ?? "No summary"}</div>
              </li>
            ))}
            {attempt.evalRuns.length === 0 ? <li className="muted">No eval runs yet.</li> : null}
          </ul>
        </section>
      </div>

      <div className="grid cols-2" style={{ marginTop: 18 }}>
        {scorecard ? <ScorecardForm attemptId={attempt.id} initial={scorecard} /> : null}
        <section className="card">
          <p className="eyebrow">Timeline</p>
          <h2>Events</h2>
          <ul className="artifact-list">
            {attempt.events.map((event) => (
              <li key={event.id}>
                <strong>{event.type}</strong>
                <div>{event.message}</div>
                <div className="muted">{event.createdAt.toLocaleString()}</div>
              </li>
            ))}
            {attempt.events.length === 0 ? <li className="muted">No events yet.</li> : null}
          </ul>
        </section>
      </div>
      {performance.length > 0 ? (
        <section className="card" style={{ marginTop: 18 }}>
          <p className="eyebrow">Workspace Performance</p>
          <h2>Provisioning latency</h2>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Step</th>
                  <th>Duration</th>
                  <th>Exit</th>
                </tr>
              </thead>
              <tbody>
                {performance.map((timing) => (
                  <tr key={timing.label}>
                    <td>{timing.label}</td>
                    <td>{timing.duration}</td>
                    <td>{timing.exitCode ?? "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}
    </AdminShell>
  );
}
