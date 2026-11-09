"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";

type InviteTemplateOption = {
  id: string;
  title: string;
  roleTitle?: string | null;
  level: string;
  durationMin: number;
  taskBrief?: string | null;
  isActive: boolean;
  evaluationPlan?: unknown;
  updatedAt?: string;
};

type InterviewerOption = {
  id: string;
  name: string;
  email: string;
  title?: string | null;
  timezone: string;
};

export function InviteForm({
  creditsRemaining,
  templates = [],
  defaultTemplateId,
  interviewers = []
}: {
  creditsRemaining: number;
  templates?: InviteTemplateOption[];
  defaultTemplateId?: string;
  interviewers?: InterviewerOption[];
}) {
  const router = useRouter();
  const [candidateName, setCandidateName] = useState("");
  const [candidateEmail, setCandidateEmail] = useState("");
  const [bulkCandidates, setBulkCandidates] = useState("");
  const [templateId, setTemplateId] = useState(defaultTemplateId ?? templates[0]?.id ?? "");
  const [interviewerId, setInterviewerId] = useState("");
  const [proctoringEnabled, setProctoringEnabled] = useState(true);
  const [result, setResult] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const selectedTemplate = templates.find((template) => template.id === templateId) ?? templates[0];
  const evaluationPlan =
    selectedTemplate?.evaluationPlan && typeof selectedTemplate.evaluationPlan === "object"
      ? (selectedTemplate.evaluationPlan as { assessmentMode?: string; liveInterview?: { enabled?: boolean } })
      : null;
  const requiresInterviewer = evaluationPlan?.assessmentMode === "live_guided" || evaluationPlan?.liveInterview?.enabled === true;

  function parseBulkCandidates() {
    return bulkCandidates
      .split(/\n+/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const angleMatch = line.match(/^(.*?)<([^>]+)>$/);
        if (angleMatch) return { name: angleMatch[1].trim().replace(/,$/, ""), email: angleMatch[2].trim() };

        const csvParts = line.split(",").map((part) => part.trim());
        if (csvParts.length >= 2) return { name: csvParts[0], email: csvParts[1] };

        const emailOnly = line.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
        const email = emailOnly?.[0] ?? "";
        return { name: line.replace(email, "").trim() || email.split("@")[0] || "Candidate", email };
      });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const parsedBulk = parseBulkCandidates();
    const candidates = parsedBulk.length > 0 ? parsedBulk : [{ name: candidateName, email: candidateEmail }];
    const invalid = candidates.find((candidate) => !candidate.name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate.email));
    if (invalid) {
      setResult(`Fix this candidate before sending: ${invalid.name || "Missing name"} / ${invalid.email || "missing email"}`);
      return;
    }

    setIsSending(true);
    setResult(null);

    const response = await fetch("/api/admin/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        candidates,
        templateId: templateId || undefined,
        interviewerId: interviewerId || undefined,
        proctoringEnabled
      })
    });

    const payload = await response.json();
    setIsSending(false);

    if (!response.ok) {
      setResult(payload.error ?? "Invite failed");
      return;
    }

    setCandidateName("");
    setCandidateEmail("");
    setBulkCandidates("");
    const sent = payload.invitations?.length ?? 0;
    const failed = payload.failures?.length ?? 0;
    setResult(
      `${sent} invite${sent === 1 ? "" : "s"} sent${failed ? `, ${failed} failed` : ""}. Assessment credits remaining: ${payload.creditsRemaining}`
    );
    router.refresh();
  }

  return (
    <form className="card grid" onSubmit={submit}>
      <div>
        <p className="eyebrow">New invite</p>
        <h2>Send an assessment</h2>
        <p className="muted">
          Choose a saved template, then send single-use magic links. Credits are used only when candidates start timed workspaces.
        </p>
      </div>
      {templates.length > 0 ? (
        <div className="field">
          <label htmlFor="inviteTemplate">Assessment template</label>
          <select id="inviteTemplate" className="input" value={templateId} onChange={(event) => setTemplateId(event.target.value)}>
            {templates.map((template) => (
              <option key={template.id} value={template.id}>
                {template.isActive ? "Current - " : ""}
                {template.title} ({template.durationMin} min)
              </option>
            ))}
          </select>
          {selectedTemplate ? (
            <p className="muted">
              {selectedTemplate.roleTitle ? `${selectedTemplate.roleTitle}. ` : ""}
              {selectedTemplate.taskBrief ?? "Saved assessment template."}
            </p>
          ) : null}
        </div>
      ) : null}
      {requiresInterviewer ? (
        <div className="field">
          <label htmlFor="interviewerId">Live interviewer</label>
          <select id="interviewerId" className="input" value={interviewerId} onChange={(event) => setInterviewerId(event.target.value)}>
            <option value="">Any available panel member</option>
            {interviewers.map((interviewer) => (
              <option key={interviewer.id} value={interviewer.id}>
                {interviewer.name} ({interviewer.title ?? "interviewer"}, {interviewer.timezone})
              </option>
            ))}
          </select>
          <p className="muted">
            Candidates will book a slot before they can start. Already booked slots are hidden automatically.
            {interviewers.length === 0 ? " Add interviewers in Interview panel first." : ""}
          </p>
        </div>
      ) : null}
      <label className="check-row">
        <input type="checkbox" checked={proctoringEnabled} onChange={(event) => setProctoringEnabled(event.target.checked)} />
        Require camera, screen sharing, and recorded proctoring for this invite
      </label>
      <div className={creditsRemaining > 0 ? "credit-banner" : "credit-banner danger"}>
        <strong>{creditsRemaining} assessment credits remaining</strong>
        <span>{creditsRemaining > 0 ? "Invites are free; starts consume credits." : "Candidates can be invited, but starts need credits."}</span>
      </div>
      <div className="grid cols-2">
        <div className="field">
          <label htmlFor="candidateName">Candidate name</label>
          <input
            id="candidateName"
            className="input"
            value={candidateName}
            onChange={(event) => setCandidateName(event.target.value)}
            required={!bulkCandidates.trim()}
          />
        </div>
        <div className="field">
          <label htmlFor="candidateEmail">Candidate email</label>
          <input
            id="candidateEmail"
            className="input"
            type="email"
            value={candidateEmail}
            onChange={(event) => setCandidateEmail(event.target.value)}
            required={!bulkCandidates.trim()}
          />
        </div>
      </div>
      <div className="field">
        <label htmlFor="bulkCandidates">Invite multiple applicants</label>
        <textarea
          id="bulkCandidates"
          className="textarea compact"
          value={bulkCandidates}
          onChange={(event) => setBulkCandidates(event.target.value)}
          placeholder={"One per line: Jane Doe <jane@company.com>\\nRahul Sharma, rahul@company.com"}
        />
        <p className="muted">If this box has candidates, it will be used instead of the single-candidate fields.</p>
      </div>
      <button className="button" disabled={isSending} type="submit">
        <Send size={16} />
        {isSending ? "Sending" : "Send invite"}
      </button>
      {result ? <p className="muted">{result}</p> : null}
    </form>
  );
}
