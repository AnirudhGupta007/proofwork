import { aggregateScore, normalizeScores, type ScoreDimensions } from "./score.ts";

export type RubricKey = keyof ScoreDimensions;

/** Integer percentages per criterion; must sum to exactly 100. */
export type RubricWeights = Record<RubricKey, number>;

export type RubricCriterion = {
  key: RubricKey;
  label: string;
  description: string;
};

export const RUBRIC_CRITERIA: readonly RubricCriterion[] = [
  {
    key: "requirements",
    label: "Correctness & requirements",
    description: "Delivers what the brief asked for and the solution actually works."
  },
  {
    key: "codeQuality",
    label: "Code quality",
    description: "Readable, well-structured, maintainable code with sensible abstractions."
  },
  {
    key: "testAndEvalQuality",
    label: "Testing & evals",
    description: "Meaningful tests or evals that prove behaviour and catch regressions."
  },
  {
    key: "debuggingDiscipline",
    label: "Debugging discipline",
    description: "Reproduces, isolates and verifies fixes instead of guessing."
  },
  {
    key: "aiCollaboration",
    label: "AI collaboration",
    description: "Uses AI tools deliberately, reviews their output and owns the result."
  },
  {
    key: "productionReadiness",
    label: "Production readiness",
    description: "Error handling, security, performance and operability considered."
  },
  {
    key: "communication",
    label: "Communication & commits",
    description: "Clear commits, notes and explanation of trade-offs."
  }
] as const;

export const RUBRIC_KEYS: readonly RubricKey[] = RUBRIC_CRITERIA.map((criterion) => criterion.key);

/**
 * Default weighting shown in the editor. 7 criteria cannot split 100 evenly, so
 * the defaults are 15/15/15/15/14/13/13. Note: a template with no stored weights
 * (null) does NOT use these numbers - it uses the legacy exact equal weighting
 * (aggregateScore) so historical data scores identically.
 */
export const DEFAULT_RUBRIC_WEIGHTS: RubricWeights = {
  requirements: 15,
  codeQuality: 15,
  testAndEvalQuality: 15,
  debuggingDiscipline: 15,
  aiCollaboration: 14,
  productionReadiness: 13,
  communication: 13
};

export type RubricValidationResult =
  | { ok: true; weights: RubricWeights }
  | { ok: false; error: string };

export function rubricWeightsTotal(weights: Partial<Record<RubricKey, number>>) {
  return RUBRIC_KEYS.reduce((sum, key) => sum + (Number(weights[key]) || 0), 0);
}

export function validateRubricWeights(input: unknown): RubricValidationResult {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, error: "Scoring weights must be an object." };
  }
  const record = input as Record<string, unknown>;
  const weights = {} as RubricWeights;
  for (const criterion of RUBRIC_CRITERIA) {
    const value = record[criterion.key];
    if (value === undefined || value === null) {
      return { ok: false, error: `Missing weight for ${criterion.label}.` };
    }
    if (typeof value !== "number" || !Number.isInteger(value)) {
      return { ok: false, error: `Weight for ${criterion.label} must be a whole number.` };
    }
    if (value < 0 || value > 100) {
      return { ok: false, error: `Weight for ${criterion.label} must be between 0 and 100.` };
    }
    weights[criterion.key] = value;
  }
  const unknownKeys = Object.keys(record).filter((key) => !RUBRIC_KEYS.includes(key as RubricKey));
  if (unknownKeys.length > 0) {
    return { ok: false, error: `Unknown rubric criteria: ${unknownKeys.join(", ")}.` };
  }
  const total = rubricWeightsTotal(weights);
  if (total !== 100) {
    return { ok: false, error: `Weights must add up to 100% (currently ${total}%).` };
  }
  return { ok: true, weights };
}

/** Parses a stored JSON value. Returns null (meaning "use default weighting") when absent or invalid. */
export function parseRubricWeights(json: unknown): RubricWeights | null {
  let value = json;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  const result = validateRubricWeights(value);
  return result.ok ? result.weights : null;
}

/** Overall 0-100 score. With no weights this is exactly aggregateScore (legacy equal weighting). */
export function weightedOverallScore(scores: ScoreDimensions, weights?: RubricWeights | null): number {
  const parsed = weights ? parseRubricWeights(weights) : null;
  if (!parsed) return aggregateScore(scores);
  const normalized = normalizeScores(scores);
  const weighted = RUBRIC_KEYS.reduce((sum, key) => sum + (normalized[key] / 5) * parsed[key], 0);
  return Math.min(100, Math.max(0, Math.round(weighted)));
}

export type ScorecardScoreFields = ScoreDimensions & {
  reviewerOverrideScore?: number | null;
};

/** Overall score for a stored scorecard; a reviewer override always wins. */
export function overallScoreForScorecard(
  scorecard: ScorecardScoreFields,
  /** Parsed weights, or the raw stored Json (scoringWeights column); invalid/null → equal weighting. */
  weights?: unknown
): number {
  if (typeof scorecard.reviewerOverrideScore === "number") return scorecard.reviewerOverrideScore;
  return weightedOverallScore(pickScoreDimensions(scorecard), parseRubricWeights(weights ?? null));
}

export function pickScoreDimensions(source: ScoreDimensions): ScoreDimensions {
  return Object.fromEntries(RUBRIC_KEYS.map((key) => [key, source[key]])) as ScoreDimensions;
}

/** True when the weights are explicitly custom (not null). */
export function hasCustomRubric(json: unknown) {
  return parseRubricWeights(json) !== null;
}

export function isDefaultRubricWeights(weights: Partial<Record<RubricKey, number>> | null | undefined) {
  if (!weights) return true;
  return RUBRIC_KEYS.every((key) => weights[key] === DEFAULT_RUBRIC_WEIGHTS[key]);
}

/**
 * Value to persist in AssessmentTemplate.scoringWeights. The default weights
 * are the editor's rendering of "equal weighting", so they are stored as null
 * (legacy exact equal weighting) rather than as 15/15/15/15/14/13/13.
 */
export function rubricWeightsForStorage(weights: RubricWeights | null | undefined): RubricWeights | null {
  if (!weights || isDefaultRubricWeights(weights)) return null;
  return weights;
}
