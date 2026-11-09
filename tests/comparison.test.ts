import test from "node:test";
import assert from "node:assert/strict";
import {
  buildComparisonRow,
  buildComparisonRows,
  parseTestOutput,
  recommendationForScore,
  sortComparisonRows,
  testCountsForAttempt,
  timeTakenMinutes,
  topOverallAttemptIds,
  type ComparisonAttemptInput,
  type ComparisonRow
} from "../app/lib/comparison.ts";
import { aggregateScore } from "../app/lib/domain/score.ts";
import type { RubricWeights } from "../app/lib/domain/rubric.ts";

const allFours = {
  requirements: 4,
  testAndEvalQuality: 4,
  debuggingDiscipline: 4,
  codeQuality: 4,
  aiCollaboration: 4,
  productionReadiness: 4,
  communication: 4
};

function attempt(overrides: Partial<ComparisonAttemptInput> = {}): ComparisonAttemptInput {
  return {
    id: "a1",
    status: "reviewed",
    candidate: { name: "Ada Lovelace", email: "ada@example.com" },
    startedAt: new Date("2026-01-01T10:00:00Z"),
    submittedAt: new Date("2026-01-01T11:30:00Z"),
    scorecard: { ...allFours, reviewerOverrideScore: null },
    artifacts: [],
    evalRuns: [],
    ...overrides
  };
}

function row(id: string, fields: Partial<ComparisonRow> = {}): ComparisonRow {
  return { ...buildComparisonRow(attempt({ id, scorecard: null, startedAt: null })), ...fields };
}

const ids = (rows: ComparisonRow[]) => rows.map((entry) => entry.attemptId);

// --- row building -----------------------------------------------------------

test("overall score uses equal weighting when the template has no weights", () => {
  const result = buildComparisonRow(attempt(), null);
  assert.equal(result.overallScore, aggregateScore(allFours));
  assert.equal(result.overallScore, 80);
  assert.equal(result.criteria.requirements, 4);
  assert.equal(result.criteria.communication, 4);
  assert.equal(result.recommendation, "hire");
  assert.equal(result.reportUrl, "/admin/attempts/a1");
  assert.equal(result.pdfUrl, "/api/admin/attempts/a1/report");
  assert.equal(result.candidateName, "Ada Lovelace");
  assert.equal(result.candidateEmail, "ada@example.com");
});

test("overall score honours custom rubric weights", () => {
  const weights: RubricWeights = {
    requirements: 100,
    codeQuality: 0,
    testAndEvalQuality: 0,
    debuggingDiscipline: 0,
    aiCollaboration: 0,
    productionReadiness: 0,
    communication: 0
  };
  const result = buildComparisonRow(attempt({ scorecard: { ...allFours, requirements: 2 } }), weights);
  assert.equal(result.overallScore, 40);
  assert.equal(result.recommendation, "no_hire");
  // Invalid stored weights fall back to equal weighting.
  const fallback = buildComparisonRow(attempt({ scorecard: { ...allFours, requirements: 2 } }), { requirements: 50 });
  assert.equal(fallback.overallScore, aggregateScore({ ...allFours, requirements: 2 }));
});

test("reviewer override score takes precedence over computed score and drives recommendation", () => {
  const result = buildComparisonRow(attempt({ scorecard: { ...allFours, reviewerOverrideScore: 65 } }));
  assert.equal(result.overallScore, 65);
  assert.equal(result.recommendation, "lean_no_hire");
  assert.equal(result.criteria.codeQuality, 4);
});

test("missing scorecard yields null score, criteria and recommendation", () => {
  const result = buildComparisonRow(attempt({ scorecard: null, status: "in_progress" }));
  assert.equal(result.overallScore, null);
  assert.equal(result.recommendation, null);
  assert.ok(Object.values(result.criteria).every((value) => value === null));
  assert.equal(result.status, "in_progress");
});

test("recommendation thresholds match the report bands", () => {
  assert.equal(recommendationForScore(null), null);
  assert.equal(recommendationForScore(78), "hire");
  assert.equal(recommendationForScore(77), "lean_hire");
  assert.equal(recommendationForScore(68), "lean_hire");
  assert.equal(recommendationForScore(67), "lean_no_hire");
  assert.equal(recommendationForScore(60), "lean_no_hire");
  assert.equal(recommendationForScore(59), "no_hire");
  assert.equal(recommendationForScore(0), "no_hire");
});

test("time taken uses submittedAt, falls back to timedOutAt, accepts ISO strings", () => {
  assert.equal(timeTakenMinutes({ startedAt: new Date("2026-01-01T10:00:00Z"), submittedAt: new Date("2026-01-01T11:30:00Z") }), 90);
  assert.equal(
    timeTakenMinutes({ startedAt: "2026-01-01T10:00:00Z", submittedAt: null, timedOutAt: "2026-01-01T12:00:00Z" }),
    120
  );
  assert.equal(
    timeTakenMinutes({
      startedAt: "2026-01-01T10:00:00Z",
      submittedAt: "2026-01-01T10:45:20Z",
      timedOutAt: "2026-01-01T12:00:00Z"
    }),
    45
  );
  assert.equal(timeTakenMinutes({ startedAt: null, submittedAt: new Date() }), null);
  assert.equal(timeTakenMinutes({ startedAt: new Date(), submittedAt: null, timedOutAt: null }), null);
  assert.equal(timeTakenMinutes({ startedAt: "2026-01-01T10:00:00Z", submittedAt: "2026-01-01T09:00:00Z" }), null);
  assert.equal(timeTakenMinutes({ startedAt: "not a date", submittedAt: "2026-01-01T09:00:00Z" }), null);
  assert.equal(buildComparisonRow(attempt()).timeTakenMinutes, 90);
});

test("buildComparisonRows maps every attempt", () => {
  const rows = buildComparisonRows([attempt({ id: "x" }), attempt({ id: "y", scorecard: null })]);
  assert.deepEqual(ids(rows), ["x", "y"]);
});

test("topOverallAttemptIds returns all ids tied for the top score", () => {
  const rows = [row("a", { overallScore: 70 }), row("b", { overallScore: 88 }), row("c", { overallScore: 88 }), row("d")];
  assert.deepEqual([...topOverallAttemptIds(rows)].sort(), ["b", "c"]);
  assert.equal(topOverallAttemptIds([row("z")]).size, 0);
});

// --- test output parsing ------------------------------------------------------

test("parseTestOutput handles node:test / TAP summaries", () => {
  assert.deepEqual(parseTestOutput("TAP version 13\nok 1 - a\n# tests 7\n# suites 0\n# pass 6\n# fail 1\n# cancelled 0"), {
    passed: 6,
    total: 7
  });
  assert.deepEqual(parseTestOutput("\u001b[34mℹ tests 3\u001b[39m\n\u001b[34mℹ pass 3\u001b[39m\nℹ fail 0"), { passed: 3, total: 3 });
  // Fake provider format.
  assert.deepEqual(parseTestOutput("pass 4\nfail 2\nfake visible tests failed"), { passed: 4, total: 6 });
});

test("parseTestOutput handles jest, vitest and pytest summaries", () => {
  assert.deepEqual(parseTestOutput("Test Suites: 1 failed, 1 total\nTests:       2 failed, 1 skipped, 5 passed, 8 total\nTime: 1s"), {
    passed: 5,
    total: 8
  });
  assert.deepEqual(parseTestOutput(" Test Files  1 passed (1)\n      Tests  6 passed | 1 failed (7)\n"), { passed: 6, total: 7 });
  assert.deepEqual(parseTestOutput("========= 6 passed, 1 failed, 1 error in 0.42s ========="), { passed: 6, total: 8 });
  assert.deepEqual(parseTestOutput("==== 3 passed in 0.01s ===="), { passed: 3, total: 3 });
});

test("parseTestOutput is defensive about junk input", () => {
  assert.equal(parseTestOutput(""), null);
  assert.equal(parseTestOutput(null), null);
  assert.equal(parseTestOutput(42), null);
  assert.equal(parseTestOutput("npm ERR! missing script: test"), null);
});

test("testCountsForAttempt sums visible and hidden artifacts and falls back to structured eval-run counts", () => {
  const counts = testCountsForAttempt({
    artifacts: [
      { kind: "test_output", label: "Test output", metadata: { exitCode: 1, stdout: "pass 4\nfail 2" } },
      { kind: "command_log", label: "Hidden test output", metadata: { exitCode: 0, stdout: "pass 2\nfail 0" } }
    ]
  });
  assert.deepEqual(counts, { visible: { passed: 4, total: 6 }, hidden: { passed: 2, total: 2 }, passed: 6, total: 8 });

  // R2-backed artifact with no text, and an eval run that only has booleans: unknown.
  const unknown = testCountsForAttempt({
    artifacts: [{ kind: "test_output", label: "Test output", metadata: { exitCode: 0, storage: "r2" } }],
    evalRuns: [{ visibleTests: { collected: true, passed: true, exitCode: 0 } }]
  });
  assert.equal(unknown.passed, null);
  assert.equal(unknown.total, null);

  const structured = testCountsForAttempt({
    artifacts: [],
    evalRuns: [{ visibleTests: { passedCount: 3, total: 5 }, hiddenTests: "garbage" }]
  });
  assert.deepEqual(structured, { visible: { passed: 3, total: 5 }, hidden: null, passed: 3, total: 5 });

  const row = buildComparisonRow(
    attempt({ artifacts: [{ kind: "test_output", label: "Test output", metadata: { stdout: "# pass 9\n# fail 1" } }] })
  );
  assert.equal(row.testsPassed, 9);
  assert.equal(row.testsTotal, 10);
});

// --- sorting ------------------------------------------------------------------

test("sorts numeric overall score asc/desc with nulls last in both directions", () => {
  const rows = [row("a", { overallScore: 70 }), row("n1"), row("b", { overallScore: 90 }), row("c", { overallScore: 50 }), row("n2")];
  assert.deepEqual(ids(sortComparisonRows(rows, "overall", "desc")), ["b", "a", "c", "n1", "n2"]);
  assert.deepEqual(ids(sortComparisonRows(rows, "overall", "asc")), ["c", "a", "b", "n1", "n2"]);
  // Input untouched.
  assert.deepEqual(ids(rows), ["a", "n1", "b", "c", "n2"]);
});

test("sorting is stable for equal values in both directions", () => {
  const rows = [row("a", { overallScore: 80 }), row("b", { overallScore: 80 }), row("c", { overallScore: 70 }), row("d", { overallScore: 80 })];
  assert.deepEqual(ids(sortComparisonRows(rows, "overall", "desc")), ["a", "b", "d", "c"]);
  assert.deepEqual(ids(sortComparisonRows(rows, "overall", "asc")), ["c", "a", "b", "d"]);
});

test("sorts candidate names case-insensitively", () => {
  const rows = [row("1", { candidateName: "bob" }), row("2", { candidateName: "Alice" }), row("3", { candidateName: "carol" }), row("4", { candidateName: "ALICE" })];
  assert.deepEqual(ids(sortComparisonRows(rows, "candidate", "asc")), ["2", "4", "1", "3"]);
  assert.deepEqual(ids(sortComparisonRows(rows, "candidate", "desc")), ["3", "1", "2", "4"]);
});

test("sorts a criterion column with nulls last", () => {
  const withCriterion = (id: string, value: number | null) => {
    const base = row(id);
    return { ...base, criteria: { ...base.criteria, codeQuality: value } };
  };
  const rows = [withCriterion("a", 3), withCriterion("n", null), withCriterion("b", 5), withCriterion("c", 0)];
  assert.deepEqual(ids(sortComparisonRows(rows, "codeQuality", "desc")), ["b", "a", "c", "n"]);
  assert.deepEqual(ids(sortComparisonRows(rows, "codeQuality", "asc")), ["c", "a", "b", "n"]);
});

test("sorts tests by pass ratio, then passed count, nulls last", () => {
  const rows = [
    row("half", { testsPassed: 3, testsTotal: 6 }),
    row("none", { testsPassed: null, testsTotal: null }),
    row("all-small", { testsPassed: 1, testsTotal: 1 }),
    row("all-big", { testsPassed: 6, testsTotal: 6 }),
    row("zero", { testsPassed: 0, testsTotal: 0 })
  ];
  assert.deepEqual(ids(sortComparisonRows(rows, "tests", "desc")), ["all-big", "all-small", "half", "zero", "none"]);
  assert.deepEqual(ids(sortComparisonRows(rows, "tests", "asc")), ["zero", "half", "all-small", "all-big", "none"]);
});

test("sorts time taken with nulls last", () => {
  const rows = [row("slow", { timeTakenMinutes: 118 }), row("none"), row("fast", { timeTakenMinutes: 42 })];
  assert.deepEqual(ids(sortComparisonRows(rows, "time", "asc")), ["fast", "slow", "none"]);
  assert.deepEqual(ids(sortComparisonRows(rows, "time", "desc")), ["slow", "fast", "none"]);
});

test("sorts recommendation by strength, not alphabetically, nulls last", () => {
  const rows = [
    row("lnh", { recommendation: "lean_no_hire" }),
    row("pending"),
    row("hire", { recommendation: "hire" }),
    row("nh", { recommendation: "no_hire" }),
    row("lh", { recommendation: "lean_hire" })
  ];
  assert.deepEqual(ids(sortComparisonRows(rows, "recommendation", "desc")), ["hire", "lh", "lnh", "nh", "pending"]);
  assert.deepEqual(ids(sortComparisonRows(rows, "recommendation", "asc")), ["nh", "lnh", "lh", "hire", "pending"]);
});

test("sorts status case-insensitively", () => {
  const rows = [row("1", { status: "submitted" }), row("2", { status: "Reviewed" }), row("3", { status: "in_progress" })];
  assert.deepEqual(ids(sortComparisonRows(rows, "status", "asc")), ["3", "2", "1"]);
});
