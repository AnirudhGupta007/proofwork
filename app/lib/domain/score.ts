export type ScoreDimensions = {
  requirements: number;
  testAndEvalQuality: number;
  debuggingDiscipline: number;
  codeQuality: number;
  aiCollaboration: number;
  productionReadiness: number;
  communication: number;
};

const scoreKeys = [
  "requirements",
  "testAndEvalQuality",
  "debuggingDiscipline",
  "codeQuality",
  "aiCollaboration",
  "productionReadiness",
  "communication"
] as const;

export function clampScore(score: number) {
  if (Number.isNaN(score)) return 0;
  return Math.min(5, Math.max(0, Math.round(score)));
}

export function normalizeScores(scores: ScoreDimensions): ScoreDimensions {
  return Object.fromEntries(
    scoreKeys.map((key) => [key, clampScore(scores[key])])
  ) as ScoreDimensions;
}

export function aggregateScore(scores: ScoreDimensions) {
  const normalized = normalizeScores(scores);
  const total = scoreKeys.reduce((sum, key) => sum + normalized[key], 0);
  return Math.round((total / (scoreKeys.length * 5)) * 100);
}

export const defaultRubric: ScoreDimensions = {
  requirements: 0,
  testAndEvalQuality: 0,
  debuggingDiscipline: 0,
  codeQuality: 0,
  aiCollaboration: 0,
  productionReadiness: 0,
  communication: 0
};
