"use client";

import { useRef, useState } from "react";
import { Save } from "lucide-react";

type Scorecard = {
  requirements: number;
  testAndEvalQuality: number;
  debuggingDiscipline: number;
  codeQuality: number;
  aiCollaboration: number;
  productionReadiness: number;
  communication: number;
  reviewerNotes?: string | null;
  reviewerOverrideScore?: number | null;
};

const labels: Array<[keyof Scorecard, string]> = [
  ["requirements", "Requirements"],
  ["testAndEvalQuality", "Tests and evals"],
  ["debuggingDiscipline", "Debugging discipline"],
  ["codeQuality", "Code quality"],
  ["aiCollaboration", "AI prompting and collaboration"],
  ["productionReadiness", "Production readiness"],
  ["communication", "Communication"]
];

export function ScorecardForm({ attemptId, initial }: { attemptId: string; initial: Scorecard }) {
  const [scorecard, setScorecard] = useState<Scorecard>(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setSaved(false);
    setError(null);

    const formData = new FormData(formRef.current ?? undefined);
    const nextScorecard: Scorecard = {
      requirements: Number(formData.get("requirements") ?? 0),
      testAndEvalQuality: Number(formData.get("testAndEvalQuality") ?? 0),
      debuggingDiscipline: Number(formData.get("debuggingDiscipline") ?? 0),
      codeQuality: Number(formData.get("codeQuality") ?? 0),
      aiCollaboration: Number(formData.get("aiCollaboration") ?? 0),
      productionReadiness: Number(formData.get("productionReadiness") ?? 0),
      communication: Number(formData.get("communication") ?? 0),
      reviewerNotes: String(formData.get("reviewerNotes") ?? ""),
      reviewerOverrideScore: formData.get("reviewerOverrideScore")
        ? Number(formData.get("reviewerOverrideScore"))
        : null
    };

    const response = await fetch(`/api/admin/attempts/${attemptId}/scorecard`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(nextScorecard)
    });
    const responseBody = await response.json();
    if (!response.ok) {
      setError(responseBody.error ?? "Unable to save review.");
      return;
    }
    setScorecard(responseBody.scorecard);
    setSaved(true);
  }

  return (
    <form ref={formRef} className="card grid" onSubmit={save}>
      <div>
        <p className="eyebrow">Reviewer scorecard</p>
        <h2>Human review</h2>
      </div>
      <div className="score-grid">
        {labels.map(([key, label]) => (
          <label className="score-row" key={key}>
            <span>{label}</span>
            <input
              className="input"
              name={key}
              type="number"
              min={0}
              max={5}
              value={Number(scorecard[key] ?? 0)}
              onChange={(event) => setScorecard({ ...scorecard, [key]: Number(event.target.value) })}
            />
          </label>
        ))}
      </div>
      <div className="field">
        <label htmlFor="reviewerNotes">Reviewer notes</label>
        <textarea
          id="reviewerNotes"
          name="reviewerNotes"
          className="textarea"
          value={scorecard.reviewerNotes ?? ""}
          onChange={(event) => setScorecard({ ...scorecard, reviewerNotes: event.target.value })}
        />
      </div>
      <div className="field">
        <label htmlFor="override">Final score override</label>
        <input
          id="override"
          className="input"
          name="reviewerOverrideScore"
          type="number"
          min={0}
          max={100}
          value={scorecard.reviewerOverrideScore ?? ""}
          onChange={(event) =>
            setScorecard({
              ...scorecard,
              reviewerOverrideScore: event.target.value ? Number(event.target.value) : null
            })
          }
        />
      </div>
      <button className="button" type="submit">
        <Save size={16} />
        Save review
      </button>
      {error ? <p className="error-text">{error}</p> : null}
      {saved ? <p className="muted">Saved.</p> : null}
    </form>
  );
}
