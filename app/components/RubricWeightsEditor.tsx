"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_RUBRIC_WEIGHTS,
  RUBRIC_CRITERIA,
  isDefaultRubricWeights,
  parseRubricWeights,
  rubricWeightsTotal,
  type RubricKey,
  type RubricWeights
} from "@/app/lib/domain/rubric";

/** Controlled per-criterion weight inputs with a live total and reset. */
export function RubricWeightsFields({
  weights,
  onChange,
  disabled = false,
  idPrefix = "rubric"
}: {
  weights: RubricWeights;
  onChange: (next: RubricWeights) => void;
  disabled?: boolean;
  idPrefix?: string;
}) {
  const total = rubricWeightsTotal(weights);
  const balanced = total === 100;
  const isDefault = isDefaultRubricWeights(weights);

  function setWeight(key: RubricKey, raw: string) {
    const parsed = Math.round(Number(raw));
    const value = Number.isFinite(parsed) ? Math.min(100, Math.max(0, parsed)) : 0;
    onChange({ ...weights, [key]: value });
  }

  return (
    <div className="rubric-fields">
      <ul className="rubric-list">
        {RUBRIC_CRITERIA.map((criterion) => {
          const inputId = `${idPrefix}-${criterion.key}`;
          return (
            <li className="rubric-row" key={criterion.key}>
              <label htmlFor={inputId} className="rubric-label">
                <strong>{criterion.label}</strong>
                <span>{criterion.description}</span>
              </label>
              <input
                aria-label={`${criterion.label} weight slider`}
                className="rubric-slider"
                type="range"
                min={0}
                max={100}
                step={1}
                value={weights[criterion.key]}
                disabled={disabled}
                onChange={(event) => setWeight(criterion.key, event.target.value)}
              />
              <div className="rubric-number">
                <input
                  id={inputId}
                  className="input"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={100}
                  step={1}
                  value={weights[criterion.key]}
                  disabled={disabled}
                  onChange={(event) => setWeight(criterion.key, event.target.value)}
                />
                <span aria-hidden="true">%</span>
              </div>
            </li>
          );
        })}
      </ul>
      <div className="rubric-footer">
        <span className={balanced ? "rubric-total ok" : "rubric-total off"} role="status" aria-live="polite">
          Total {total}%{balanced ? "" : ` · ${total > 100 ? "remove" : "add"} ${Math.abs(100 - total)}% to reach 100%`}
        </span>
        <span className="muted rubric-hint">{isDefault ? "Default: equal weighting across all criteria." : "Custom weighting."}</span>
        <button
          className="button secondary"
          type="button"
          disabled={disabled || isDefault}
          onClick={() => onChange({ ...DEFAULT_RUBRIC_WEIGHTS })}
        >
          Reset to default
        </button>
      </div>
    </div>
  );
}

/** Edits the scoring weights of an existing template (PATCH .../rubric). */
export function RubricWeightsEditor({ templateId, initialWeights }: { templateId: string; initialWeights: unknown }) {
  const router = useRouter();
  const initial = parseRubricWeights(initialWeights) ?? { ...DEFAULT_RUBRIC_WEIGHTS };
  const [weights, setWeights] = useState<RubricWeights>(initial);
  const [saved, setSaved] = useState<RubricWeights>(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const total = rubricWeightsTotal(weights);
  const dirty = RUBRIC_CRITERIA.some((criterion) => weights[criterion.key] !== saved[criterion.key]);

  async function save() {
    setBusy(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch(`/api/admin/assessment-template/${templateId}/rubric`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scoringWeights: weights })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error ?? "Unable to save scoring rubric.");
      setSaved(weights);
      setMessage("Scoring rubric saved. Scores for this template now use these weights.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to save scoring rubric.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <details className="rubric-editor">
      <summary>
        <span>Scoring rubric</span>
        <span className="muted">{isDefaultRubricWeights(saved) ? "Equal weighting" : "Custom weighting"}</span>
      </summary>
      <RubricWeightsFields weights={weights} onChange={setWeights} disabled={busy} idPrefix={`rubric-${templateId}`} />
      <div className="button-row">
        <button className="button" type="button" onClick={save} disabled={busy || total !== 100 || !dirty}>
          {busy ? "Saving…" : "Save rubric"}
        </button>
        {message ? <span className="muted">{message}</span> : null}
        {error ? <span className="error-text">{error}</span> : null}
      </div>
    </details>
  );
}
