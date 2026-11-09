import test from "node:test";
import assert from "node:assert/strict";
import { aggregateScore, type ScoreDimensions } from "../app/lib/domain/score.ts";
import {
  DEFAULT_RUBRIC_WEIGHTS,
  RUBRIC_CRITERIA,
  RUBRIC_KEYS,
  isDefaultRubricWeights,
  overallScoreForScorecard,
  parseRubricWeights,
  rubricWeightsForStorage,
  rubricWeightsTotal,
  validateRubricWeights,
  weightedOverallScore,
  type RubricWeights
} from "../app/lib/domain/rubric.ts";
import { applyScoreCaps, summarizeScore } from "../app/lib/evals/scorer.ts";

const scoreSets: ScoreDimensions[] = [
  { requirements: 0, testAndEvalQuality: 0, debuggingDiscipline: 0, codeQuality: 0, aiCollaboration: 0, productionReadiness: 0, communication: 0 },
  { requirements: 5, testAndEvalQuality: 5, debuggingDiscipline: 5, codeQuality: 5, aiCollaboration: 5, productionReadiness: 5, communication: 5 },
  { requirements: 4, testAndEvalQuality: 3, debuggingDiscipline: 2, codeQuality: 4, aiCollaboration: 1, productionReadiness: 3, communication: 3 },
  { requirements: 5, testAndEvalQuality: 1, debuggingDiscipline: 0, codeQuality: 2, aiCollaboration: 4, productionReadiness: 2, communication: 5 },
  { requirements: 7, testAndEvalQuality: -1, debuggingDiscipline: 2.6, codeQuality: 3, aiCollaboration: 3, productionReadiness: 3, communication: 3 }
];

function only(key: keyof ScoreDimensions): RubricWeights {
  return Object.fromEntries(RUBRIC_KEYS.map((k) => [k, k === key ? 100 : 0])) as RubricWeights;
}

test("rubric criteria cover every score dimension exactly once with labels", () => {
  assert.equal(RUBRIC_CRITERIA.length, 7);
  assert.equal(new Set(RUBRIC_KEYS).size, 7);
  for (const key of Object.keys(scoreSets[0])) assert.ok(RUBRIC_KEYS.includes(key as keyof ScoreDimensions), key);
  const labels = Object.fromEntries(RUBRIC_CRITERIA.map((c) => [c.key, c.label]));
  assert.equal(labels.requirements, "Correctness & requirements");
  assert.equal(labels.codeQuality, "Code quality");
  assert.equal(labels.testAndEvalQuality, "Testing & evals");
  assert.equal(labels.communication, "Communication & commits");
  for (const criterion of RUBRIC_CRITERIA) assert.ok(criterion.description.length > 10);
});

test("default rubric weights are valid and sum to 100", () => {
  assert.equal(rubricWeightsTotal(DEFAULT_RUBRIC_WEIGHTS), 100);
  assert.deepEqual(validateRubricWeights(DEFAULT_RUBRIC_WEIGHTS), { ok: true, weights: DEFAULT_RUBRIC_WEIGHTS });
});

test("null/undefined weights score identically to legacy aggregateScore", () => {
  for (const scores of scoreSets) {
    assert.equal(weightedOverallScore(scores), aggregateScore(scores));
    assert.equal(weightedOverallScore(scores, null), aggregateScore(scores));
    assert.equal(weightedOverallScore(scores, undefined), aggregateScore(scores));
  }
});

test("invalid stored weights fall back to legacy equal weighting", () => {
  const bad = { ...DEFAULT_RUBRIC_WEIGHTS, requirements: 50 } as RubricWeights;
  for (const scores of scoreSets) assert.equal(weightedOverallScore(scores, bad), aggregateScore(scores));
});

test("custom weights change the overall score as expected", () => {
  const scores = scoreSets[3];
  assert.equal(weightedOverallScore(scores, only("requirements")), 100);
  assert.equal(weightedOverallScore(scores, only("debuggingDiscipline")), 0);
  assert.equal(weightedOverallScore(scores, only("codeQuality")), 40);
  const split = { ...only("requirements"), requirements: 50, debuggingDiscipline: 50 };
  assert.equal(weightedOverallScore(scores, split), 50);
  // scores are clamped/rounded before weighting
  assert.equal(weightedOverallScore(scoreSets[4], only("requirements")), 100);
  assert.equal(weightedOverallScore(scoreSets[4], only("testAndEvalQuality")), 0);
  // all-5s is 100 under any valid weighting, all-0s is 0
  assert.equal(weightedOverallScore(scoreSets[1], DEFAULT_RUBRIC_WEIGHTS), 100);
  assert.equal(weightedOverallScore(scoreSets[0], only("communication")), 0);
});

test("validateRubricWeights rejects wrong sums, negatives, missing keys and non-integers", () => {
  const cases: unknown[] = [
    { ...DEFAULT_RUBRIC_WEIGHTS, requirements: 16 },
    { ...DEFAULT_RUBRIC_WEIGHTS, requirements: 14 },
    { ...only("requirements"), requirements: 110, codeQuality: -10 },
    { ...only("requirements"), requirements: 101, codeQuality: -1 },
    (() => {
      const { communication: _ignored, ...rest } = DEFAULT_RUBRIC_WEIGHTS;
      return { ...rest, requirements: rest.requirements + 13 };
    })(),
    { ...DEFAULT_RUBRIC_WEIGHTS, requirements: 14.5, codeQuality: 15.5 },
    { ...DEFAULT_RUBRIC_WEIGHTS, requirements: "15" },
    { ...DEFAULT_RUBRIC_WEIGHTS, extra: 0 },
    null,
    [],
    "100",
    42
  ];
  for (const input of cases) {
    const result = validateRubricWeights(input);
    assert.equal(result.ok, false, JSON.stringify(input));
    if (!result.ok) assert.ok(result.error.length > 0);
  }
  assert.equal(validateRubricWeights(only("aiCollaboration")).ok, true);
});

test("parseRubricWeights returns null for garbage and weights for valid input", () => {
  for (const garbage of [null, undefined, "", "not json", "{}", 7, true, [], {}, { requirements: 100 }, { ...DEFAULT_RUBRIC_WEIGHTS, codeQuality: NaN }]) {
    assert.equal(parseRubricWeights(garbage), null, String(garbage));
  }
  assert.deepEqual(parseRubricWeights(DEFAULT_RUBRIC_WEIGHTS), DEFAULT_RUBRIC_WEIGHTS);
  assert.deepEqual(parseRubricWeights(JSON.stringify(only("codeQuality"))), only("codeQuality"));
});

test("default weights are stored as null (legacy equal weighting)", () => {
  assert.equal(isDefaultRubricWeights(DEFAULT_RUBRIC_WEIGHTS), true);
  assert.equal(rubricWeightsForStorage(DEFAULT_RUBRIC_WEIGHTS), null);
  assert.equal(rubricWeightsForStorage(null), null);
  assert.deepEqual(rubricWeightsForStorage(only("requirements")), only("requirements"));
});

test("overallScoreForScorecard honours reviewer override first", () => {
  const scorecard = { ...scoreSets[3], reviewerOverrideScore: 42 };
  assert.equal(overallScoreForScorecard(scorecard, only("requirements")), 42);
  assert.equal(overallScoreForScorecard(scorecard, null), 42);
  assert.equal(overallScoreForScorecard({ ...scorecard, reviewerOverrideScore: 0 }, only("requirements")), 0);
  assert.equal(overallScoreForScorecard({ ...scorecard, reviewerOverrideScore: null }, only("requirements")), 100);
  assert.equal(overallScoreForScorecard({ ...scorecard, reviewerOverrideScore: null }, null), aggregateScore(scoreSets[3]));
  // raw stored Json is accepted too
  assert.equal(overallScoreForScorecard({ ...scoreSets[3] }, JSON.parse(JSON.stringify(only("communication")))), 100);
});

test("score caps apply to the weighted total", () => {
  const signals = {
    visiblePassed: false,
    hiddenPassed: true,
    hasDiff: true,
    hasPlan: true,
    commitCount: 6,
    hasCommitEvalLog: true,
    promptCount: 5,
    promptQualityScore: 4,
    finalNotes: "Detailed final notes describing the trade-offs, testing and remaining risks."
  };
  const strong = scoreSets[1];
  const legacy = applyScoreCaps(strong, signals);
  assert.equal(legacy.cap.maxScore, 60);
  assert.ok(aggregateScore(legacy.scores) <= 60);

  const weights = { ...only("requirements"), requirements: 70, communication: 30 };
  const weighted = applyScoreCaps(strong, signals, weights);
  assert.ok(weightedOverallScore(weighted.scores, weights) <= 60);
  // only weighted dimensions are reduced; unweighted ones are left alone
  assert.equal(weighted.scores.codeQuality, 5);
  assert.match(summarizeScore(weighted.scores, "ctx", signals, weights), new RegExp(`${weightedOverallScore(weighted.scores, weights)}/100`));
});
