import { CandidateAssessmentControls } from "@/app/components/CandidateAssessmentControls";
import { CandidateInterviewScheduler } from "@/app/components/CandidateInterviewScheduler";
import { CandidateInviteFallback } from "@/app/components/CandidateInviteFallback";
import { redeemInvite } from "@/app/lib/invite-actions";

export const dynamic = "force-dynamic";

function toCandidateVoice(value: string | null | undefined) {
  return (value ?? "")
    .replace(/\bGive the candidate\b/g, "You will get")
    .replace(/\bgive the candidate\b/g, "you will get")
    .replace(/\bThe candidate must\b/g, "Your job is to")
    .replace(/\bthe candidate must\b/g, "your job is to")
    .replace(/\bCandidates receive\b/g, "You will receive")
    .replace(/\bcandidates receive\b/g, "you will receive")
    .replace(/\bCandidates are asked to\b/g, "You are asked to")
    .replace(/\bcandidates are asked to\b/g, "you are asked to")
    .replace(/\bCandidates must\b/g, "You must")
    .replace(/\bcandidates must\b/g, "you must")
    .replace(/\bThe candidate\b/g, "You")
    .replace(/\bthe candidate\b/g, "you")
    .trim();
}

function sentence(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function durationLabel(minutes: number) {
  if (minutes < 60) return `${minutes}-minute`;
  if (minutes % 60 === 0) return `${minutes / 60}-hour`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export default async function CandidateAssessmentPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await redeemInvite(token).catch(() => null);

  if (!invite) {
    return <CandidateInviteFallback token={token} />;
  }

  const initialAttempt = invite.attempt ? JSON.parse(JSON.stringify(invite.attempt)) : null;
  const liveInterviewRequired = Boolean(
    invite.template.evaluationPlan &&
      typeof invite.template.evaluationPlan === "object" &&
      ((invite.template.evaluationPlan as { assessmentMode?: string; liveInterview?: { enabled?: boolean } }).assessmentMode === "live_guided" ||
        (invite.template.evaluationPlan as { liveInterview?: { enabled?: boolean } }).liveInterview?.enabled)
  );
  const proctoringConfig = invite.proctoringConfig ? JSON.parse(JSON.stringify(invite.proctoringConfig)) : null;
  const proctoringRequired = Boolean(
    proctoringConfig &&
      typeof proctoringConfig === "object" &&
      (proctoringConfig as { enabled?: boolean }).enabled
  );
  const assessmentWindow = durationLabel(invite.template.durationMin);
  const attemptStatus = invite.attempt?.status;
  const headerMessage =
    attemptStatus === "in_progress"
      ? `Hi ${invite.candidate.name}. Your hosted OpenCode workspace is live and the assessment timer is running.`
      : attemptStatus === "workspace_provisioning"
        ? `Hi ${invite.candidate.name}. Your devbox is being prepared; the timer starts when the workspace is ready.`
        : attemptStatus === "failed"
          ? `Hi ${invite.candidate.name}. Workspace setup hit a platform issue; retry after camera and screen checks are active.`
          : `Hi ${invite.candidate.name}. You will receive a hosted OpenCode workspace and a ${assessmentWindow} timer once you start.`;
      const evaluationPlan = invite.template.evaluationPlan
    ? (JSON.parse(JSON.stringify(invite.template.evaluationPlan)) as {
        focus?: string[];
        requiredEvidence?: string[];
        antiOneShotPolicy?: { minimumMeaningfulCommits?: number; planRequired?: boolean };
        liveInterview?: { enabled?: boolean; interviewerRole?: string; scoringSignals?: string[]; guidancePolicy?: string };
      })
    : null;
  const requiredEvidence = evaluationPlan?.requiredEvidence?.length
    ? evaluationPlan.requiredEvidence
    : [
        "PLAN.md with chosen scope, rejected scope, and success criteria",
        "working product slice in the provided app",
        "tests, evals, or QA checklist covering the changed flow",
        "short agent orchestration log describing prompts and manual review",
        "final notes with verification, tradeoffs, and next steps"
      ];
  const assignmentBrief = sentence(toCandidateVoice(invite.template.taskBrief ?? invite.template.instructions.split("\n")[0]));

  return (
    <main className="candidate-shell">
      <div className="topbar">
        <div>
          <p className="eyebrow">Candidate assessment</p>
          <h1>{invite.template.title}</h1>
          <p className="muted">{headerMessage}</p>
        </div>
      </div>

      <section className="candidate-brief-grid">
        <div className="card candidate-assignment-card">
          <p className="eyebrow">Your goal</p>
          <h2>{invite.template.title}</h2>
          <p className="muted">{assignmentBrief}</p>
          <div className="candidate-repo-note">
            <strong>Workspace</strong>
            <span>You will work in a runnable starter repo with task files, tests, app preview, and OpenCode CLI already set up.</span>
          </div>
        </div>
        <div className="card">
          <p className="eyebrow">Definition of done</p>
          <ul className="candidate-rule-list candidate-evidence-list">
            {requiredEvidence.slice(0, 7).map((item) => (
              <li key={item}>{sentence(toCandidateVoice(item))}</li>
            ))}
          </ul>
        </div>
        <div className="card">
          <p className="eyebrow">Start here</p>
          <ol className="candidate-rule-list">
            {proctoringRequired ? <li>Reconnect camera and screen share if prompted.</li> : null}
            <li>Open the terminal and read README.md, TASK.md, and EVALS.md.</li>
            <li>Create PLAN.md before editing code.</li>
            <li>Make a small scoped change, test it, commit it, then iterate.</li>
          </ol>
        </div>
        <div className="card">
          <p className="eyebrow">Work-loop rules</p>
          <ul className="candidate-rule-list">
            <li>Create `PLAN.md` before implementation.</li>
            <li>Make at least {evaluationPlan?.antiOneShotPolicy?.minimumMeaningfulCommits ?? 3} meaningful commits.</li>
            <li>Run tests and add or improve an eval.</li>
            <li>Use OpenCode, but review and verify its output.</li>
            <li>Explain verification, tradeoffs, and risks in final notes.</li>
          </ul>
        </div>
        <div className="card">
          <p className="eyebrow">Scoring focus</p>
          <p className="muted">{evaluationPlan?.focus?.join(", ") ?? "Requirements, tests/evals, debugging, AI judgment, production readiness."}</p>
        </div>
        {evaluationPlan?.liveInterview?.enabled ? (
          <div className="card">
            <p className="eyebrow">Live guided session</p>
            <h2>Two-way engineering discussion</h2>
            <p className="muted">
              A {evaluationPlan.liveInterview.interviewerRole ?? "company engineer"} may join to ask follow-up questions and give light
              guidance. Your explanations, clarifying questions, and responses to feedback are logged and scored with your work.
            </p>
          </div>
        ) : null}
      </section>

      <CandidateInterviewScheduler token={token} required={liveInterviewRequired} />
      <CandidateAssessmentControls
        token={token}
        initialAttempt={initialAttempt}
        proctoringConfig={proctoringConfig}
        durationMin={invite.template.durationMin}
      />
    </main>
  );
}
