"use client";

import { useState } from "react";
import { MessageSquarePlus } from "lucide-react";

type InterviewEvent = {
  id: string;
  type: string;
  message: string;
  createdAt: Date | string;
};

export function InterviewTranscriptLogger({ attemptId, initialEvents }: { attemptId: string; initialEvents: InterviewEvent[] }) {
  const [speaker, setSpeaker] = useState<"interviewer" | "candidate" | "system">("interviewer");
  const [kind, setKind] = useState<"question" | "answer" | "hint" | "observation" | "decision">("question");
  const [text, setText] = useState("");
  const [events, setEvents] = useState(initialEvents);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (text.trim().length < 2) return;
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/admin/attempts/${attemptId}/interview-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ speaker, kind, text })
    });
    const payload = await response.json();
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Unable to log interview event.");
      return;
    }

    setEvents([payload.event, ...events]);
    setText("");
  }

  return (
    <section className="card grid">
      <div>
        <p className="eyebrow">Live interview</p>
        <h2>Guidance transcript</h2>
        <p className="muted">Log interviewer questions, hints, and candidate answers. This transcript is scored with the final work.</p>
      </div>
      <div className="grid cols-2">
        <div className="field">
          <label htmlFor="interviewSpeaker">Speaker</label>
          <select id="interviewSpeaker" className="input" value={speaker} onChange={(event) => setSpeaker(event.target.value as typeof speaker)}>
            <option value="interviewer">Interviewer</option>
            <option value="candidate">Candidate</option>
            <option value="system">System note</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="interviewKind">Type</label>
          <select id="interviewKind" className="input" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
            <option value="question">Question</option>
            <option value="answer">Answer</option>
            <option value="hint">Hint</option>
            <option value="observation">Observation</option>
            <option value="decision">Decision</option>
          </select>
        </div>
      </div>
      <div className="field">
        <label htmlFor="interviewText">Transcript entry</label>
        <textarea
          id="interviewText"
          className="textarea compact"
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder="Example: Can you explain why you chose this API shape and how you would verify it?"
        />
      </div>
      <button className="button secondary" type="button" onClick={save} disabled={busy || text.trim().length < 2}>
        <MessageSquarePlus size={16} />
        {busy ? "Logging" : "Log transcript entry"}
      </button>
      {error ? <p className="error-text">{error}</p> : null}
      <ul className="artifact-list">
        {events.map((event) => (
          <li key={event.id}>
            <strong>{event.type.replace("interview.", "")}</strong>
            <div>{event.message}</div>
            <div className="muted">{new Date(event.createdAt).toLocaleString()}</div>
          </li>
        ))}
        {events.length === 0 ? <li className="muted">No live interview transcript entries yet.</li> : null}
      </ul>
    </section>
  );
}
