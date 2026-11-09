"use client";

import { useState } from "react";
import { CheckCircle2, Save } from "lucide-react";

type Feedback = {
  technicalDepth: number;
  productJudgment: number;
  communication: number;
  aiCollaboration: number;
  hireRecommendation: string;
  summary: string;
  strengths: string;
  concerns: string;
  followUps: string;
};

const defaultFeedback: Feedback = {
  technicalDepth: 3,
  productJudgment: 3,
  communication: 3,
  aiCollaboration: 3,
  hireRecommendation: "lean_hire",
  summary: "",
  strengths: "",
  concerns: "",
  followUps: ""
};

const ratingFields: Array<{ key: keyof Pick<Feedback, "technicalDepth" | "productJudgment" | "communication" | "aiCollaboration">; label: string }> = [
  { key: "technicalDepth", label: "Technical depth" },
  { key: "productJudgment", label: "Product judgment" },
  { key: "communication", label: "Communication" },
  { key: "aiCollaboration", label: "AI collaboration" }
];

function feedbackFromInitial(initialFeedback?: Partial<Feedback> | null): Feedback {
  return { ...defaultFeedback, ...initialFeedback };
}

export function InterviewFeedbackForm({
  bookingId,
  initialFeedback
}: {
  bookingId: string;
  initialFeedback?: Partial<Feedback> | null;
}) {
  const [feedback, setFeedback] = useState(() => feedbackFromInitial(initialFeedback));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(Boolean(initialFeedback));
  const [error, setError] = useState<string | null>(null);

  function update<K extends keyof Feedback>(key: K, value: Feedback[K]) {
    setFeedback((current) => ({ ...current, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setBusy(true);
    setError(null);
    const response = await fetch(`/api/interview/${encodeURIComponent(bookingId)}/feedback`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(feedback)
    });
    const payload = await response.json().catch(() => ({}));
    setBusy(false);

    if (!response.ok) {
      setError(payload.error ?? "Unable to save interviewer feedback.");
      return;
    }

    setSaved(true);
  }

  const canSave = feedback.summary.trim().length >= 10 && feedback.strengths.trim().length >= 2 && feedback.concerns.trim().length >= 2;

  return (
    <section className="card grid">
      <div>
        <p className="eyebrow">Human review</p>
        <h2>Interviewer feedback</h2>
        <p className="muted">
          For live guided rounds, this is the primary review signal. GPT-5.5 can summarize and calibrate evidence, but it should not replace the
          interviewer judgment captured here.
        </p>
      </div>

      <div className="feedback-rating-grid">
        {ratingFields.map((field) => (
          <label className="rating-field" key={field.key}>
            <span>{field.label}</span>
            <select
              className="input"
              value={feedback[field.key]}
              onChange={(event) => update(field.key, Number(event.target.value))}
            >
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value} / 5
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      <div className="field">
        <label htmlFor="hireRecommendation">Recommendation</label>
        <select
          id="hireRecommendation"
          className="input"
          value={feedback.hireRecommendation}
          onChange={(event) => update("hireRecommendation", event.target.value)}
        >
          <option value="strong_hire">Strong hire</option>
          <option value="hire">Hire</option>
          <option value="lean_hire">Lean hire</option>
          <option value="lean_no_hire">Lean no hire</option>
          <option value="no_hire">No hire</option>
        </select>
      </div>

      <div className="field">
        <label htmlFor="feedbackSummary">Overall feedback</label>
        <textarea
          id="feedbackSummary"
          className="textarea compact"
          value={feedback.summary}
          onChange={(event) => update("summary", event.target.value)}
          placeholder="What did you observe about the candidate's judgment, execution, and collaboration?"
        />
      </div>

      <div className="grid cols-2">
        <div className="field">
          <label htmlFor="feedbackStrengths">Strengths</label>
          <textarea
            id="feedbackStrengths"
            className="textarea compact"
            value={feedback.strengths}
            onChange={(event) => update("strengths", event.target.value)}
            placeholder="Specific moments that created confidence."
          />
        </div>
        <div className="field">
          <label htmlFor="feedbackConcerns">Concerns</label>
          <textarea
            id="feedbackConcerns"
            className="textarea compact"
            value={feedback.concerns}
            onChange={(event) => update("concerns", event.target.value)}
            placeholder="Risks, gaps, or follow-up areas."
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor="feedbackFollowUps">Suggested follow-ups</label>
        <textarea
          id="feedbackFollowUps"
          className="textarea compact"
          value={feedback.followUps}
          onChange={(event) => update("followUps", event.target.value)}
          placeholder="Optional questions or checks for a next round."
        />
      </div>

      <div className="button-row">
        <button className="button" type="button" onClick={save} disabled={busy || !canSave}>
          <Save size={16} />
          {busy ? "Saving feedback" : "Save interviewer feedback"}
        </button>
        {saved ? (
          <span className="saved-inline">
            <CheckCircle2 size={16} /> Saved to the candidate evidence report
          </span>
        ) : null}
      </div>
      {error ? <p className="error-text">{error}</p> : null}
    </section>
  );
}
