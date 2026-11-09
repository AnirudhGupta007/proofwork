// Candidate comparison for a single assessment template.
//
// Pure module (no Prisma / Next imports) so it can be unit-tested with
// node:test. The server page / API route fetch attempts and hand plain
// objects to buildComparisonRows; the client table re-sorts rows with
// sortComparisonRows.

import { overallScoreForScorecard, RUBRIC_CRITERIA, type RubricKey, type RubricWeights } from "./domain/rubric.ts";

export type CriterionKey = RubricKey;

export type Recommendation = "hire" | "lean_hire" | "lean_no_hire" | "no_hire";

export type TestCounts = { passed: number; total: number };

export type ComparisonRow = {
  attemptId: string;
  candidateName: string;
  candidateEmail: string;
  status: string;
  overallScore: number | null;
  /** Raw 0-5 criterion scores; null when there is no scorecard yet. */
  criteria: Record<CriterionKey, number | null>;
  testsPassed: number | null;
  testsTotal: number | null;
  visibleTests: TestCounts | null;
  hiddenTests: TestCounts | null;
  timeTakenMinutes: number | null;
  recommendation: Recommendation | null;
  /** Admin attempt detail page (full evidence + scorecard). */
  reportUrl: string;
  /** Generated candidate PDF report. */
  pdfUrl: string;
};

type DateLike = Date | string | null | undefined;

export type ComparisonScorecardInput = {
  requirements: number;
  testAndEvalQuality: number;
  debuggingDiscipline: number;
  codeQuality: number;
  aiCollaboration: number;
  productionReadiness: number;
  communication: number;
  reviewerOverrideScore?: number | null;
};

export type ComparisonArtifactInput = {
  kind: string;
  label: string;
  metadata: unknown;
};

export type ComparisonEvalRunInput = {
  visibleTests?: unknown;
  hiddenTests?: unknown;
  createdAt?: DateLike;
};

export type ComparisonAttemptInput = {
  id: string;
  status: string;
  startedAt?: DateLike;
  submittedAt?: DateLike;
  timedOutAt?: DateLike;
  candidate: { name: string; email: string };
  scorecard?: ComparisonScorecardInput | null;
  artifacts?: ComparisonArtifactInput[];
  evalRuns?: ComparisonEvalRunInput[];
};

export const CRITERION_KEYS: readonly CriterionKey[] = RUBRIC_CRITERIA.map((criterion) => criterion.key);

const SHORT_LABELS: Record<CriterionKey, string> = {
  requirements: "Correct",
  codeQuality: "Code",
  testAndEvalQuality: "Evals",
  debuggingDiscipline: "Debugging",
  aiCollaboration: "AI use",
  productionReadiness: "Prod ready",
  communication: "Comms"
};

export type ComparisonCriterion = { key: CriterionKey; label: string; shortLabel: string; description: string };

export const COMPARISON_CRITERIA: readonly ComparisonCriterion[] = RUBRIC_CRITERIA.map((criterion) => ({
  key: criterion.key,
  label: criterion.label,
  shortLabel: SHORT_LABELS[criterion.key] ?? criterion.label,
  description: criterion.description
}));

// Same bands as the PDF report and the attempt detail page.
export function recommendationForScore(score: number | null): Recommendation | null {
  if (score === null || !Number.isFinite(score)) return null;
  if (score >= 78) return "hire";
  if (score >= 68) return "lean_hire";
  if (score >= 60) return "lean_no_hire";
  return "no_hire";
}

export const RECOMMENDATION_LABELS: Record<Recommendation, string> = {
  hire: "Hire",
  lean_hire: "Lean hire",
  lean_no_hire: "Lean no hire",
  no_hire: "No hire"
};

const RECOMMENDATION_RANK: Record<Recommendation, number> = {
  no_hire: 0,
  lean_no_hire: 1,
  lean_hire: 2,
  hire: 3
};

// ---------------------------------------------------------------------------
// Test output parsing
// ---------------------------------------------------------------------------

function stripAnsi(value: string) {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[()][A-Za-z0-9]/g, "");
}

function lastInt(text: string, pattern: RegExp): number | null {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const matches = [...text.matchAll(new RegExp(pattern.source, flags))];
  if (matches.length === 0) return null;
  const value = Number(matches[matches.length - 1][1]);
  return Number.isFinite(value) ? value : null;
}

/**
 * Parses passed/total from raw test-runner output. Understands:
 * - node:test / TAP summaries ("# pass 6", "# fail 1", "ℹ tests 7")
 * - Jest ("Tests:  1 failed, 6 passed, 7 total")
 * - Vitest ("Tests  6 passed | 1 failed (7)")
 * - pytest ("6 passed, 1 failed in 0.4s")
 * - the fake provider / report format ("pass 6\nfail 1")
 * Returns null when nothing recognisable is found.
 */
export function parseTestOutput(output: unknown): TestCounts | null {
  if (typeof output !== "string" || !output.trim()) return null;
  const text = stripAnsi(output);

  // Jest: "Tests:       1 failed, 2 skipped, 6 passed, 9 total"
  const jestLine = [...text.matchAll(/^\s*Tests:\s*(.+)$/gim)].pop()?.[1];
  if (jestLine && /\btotal\b/i.test(jestLine)) {
    const passed = lastInt(jestLine, /(\d+)\s+passed/i) ?? 0;
    const total = lastInt(jestLine, /(\d+)\s+total/i);
    if (total !== null) return { passed: Math.min(passed, total), total };
  }

  // Vitest: "Tests  6 passed | 1 failed (7)"
  const vitestLine = [...text.matchAll(/^\s*Tests\s+(.+\(\s*\d+\s*\))\s*$/gim)].pop()?.[1];
  if (vitestLine) {
    const passed = lastInt(vitestLine, /(\d+)\s+passed/i) ?? 0;
    const total = lastInt(vitestLine, /\(\s*(\d+)\s*\)/);
    if (total !== null) return { passed: Math.min(passed, total), total };
  }

  // node:test / TAP / fake provider: "# pass 6", "ℹ pass 6", "pass 6"
  const tapPass = lastInt(text, /^\s*(?:#|ℹ)?\s*pass\s+(\d+)\s*$/im);
  const tapFail = lastInt(text, /^\s*(?:#|ℹ)?\s*fail\s+(\d+)\s*$/im);
  if (tapPass !== null || tapFail !== null) {
    const passed = tapPass ?? 0;
    const tapTests = lastInt(text, /^\s*(?:#|ℹ)?\s*tests\s+(\d+)\s*$/im);
    const total = tapTests !== null && tapTests >= passed ? tapTests : passed + (tapFail ?? 0);
    return { passed, total };
  }

  // pytest: "==== 6 passed, 1 failed, 1 error in 0.40s ===="
  const pyPassed = lastInt(text, /(\d+)\s+passed\b/i);
  const pyFailed = lastInt(text, /(\d+)\s+failed\b/i);
  const pyErrors = lastInt(text, /(\d+)\s+errors?\b/i);
  if (pyPassed !== null || pyFailed !== null) {
    const passed = pyPassed ?? 0;
    return { passed, total: passed + (pyFailed ?? 0) + (pyErrors ?? 0) };
  }

  // Loose fallback matching the PDF report's parser ("pass 6 ... fail 1").
  const loosePass = lastInt(text, /\bpass\s+(\d+)/i);
  const looseFail = lastInt(text, /\bfail\s+(\d+)/i);
  if (loosePass !== null || looseFail !== null) {
    const passed = loosePass ?? 0;
    return { passed, total: passed + (looseFail ?? 0) };
  }

  return null;
}

function metadataText(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as { stdout?: unknown; stderr?: unknown; content?: unknown };
  const parts = [record.stdout, record.stderr, record.content].filter(
    (part): part is string => typeof part === "string" && part.length > 0
  );
  return parts.length ? parts.join("\n") : null;
}

/** Structured counts some producers may store directly on metadata / eval-run JSON. */
function structuredCounts(value: unknown): TestCounts | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const passed = [record.passedCount, record.passCount, record.numPassed, record.testsPassed].find(
    (entry): entry is number => typeof entry === "number" && Number.isFinite(entry)
  );
  const total = [record.total, record.totalCount, record.numTotal, record.testsTotal].find(
    (entry): entry is number => typeof entry === "number" && Number.isFinite(entry)
  );
  if (passed === undefined || total === undefined || total < 0) return null;
  return { passed: Math.max(0, Math.min(passed, total)), total };
}

function countsFromArtifact(artifact: ComparisonArtifactInput | undefined): TestCounts | null {
  if (!artifact) return null;
  return structuredCounts(artifact.metadata) ?? parseTestOutput(metadataText(artifact.metadata));
}

/**
 * Visible + hidden test counts for an attempt. Visible tests are the
 * `test_output` artifact ("Test output"); hidden tests are the
 * "Hidden test output" command_log artifact. The latest eval run's
 * visibleTests/hiddenTests JSON is consulted for structured counts as a
 * fallback (today it only stores {collected, passed, exitCode}).
 */
export function testCountsForAttempt(input: Pick<ComparisonAttemptInput, "artifacts" | "evalRuns">) {
  const artifacts = input.artifacts ?? [];
  const visibleArtifact =
    artifacts.find((artifact) => artifact.label === "Test output") ??
    artifacts.find((artifact) => artifact.kind === "test_output");
  const hiddenArtifact = artifacts.find((artifact) => artifact.label === "Hidden test output");
  const latestEval = latestEvalRun(input.evalRuns ?? []);

  const visible = countsFromArtifact(visibleArtifact) ?? structuredCounts(latestEval?.visibleTests);
  const hidden = countsFromArtifact(hiddenArtifact) ?? structuredCounts(latestEval?.hiddenTests);

  if (!visible && !hidden) return { visible, hidden, passed: null, total: null };
  return {
    visible,
    hidden,
    passed: (visible?.passed ?? 0) + (hidden?.passed ?? 0),
    total: (visible?.total ?? 0) + (hidden?.total ?? 0)
  };
}

function toTime(value: DateLike): number | null {
  if (value === null || value === undefined || value === "") return null;
  const time = value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

function latestEvalRun(runs: ComparisonEvalRunInput[]) {
  if (runs.length <= 1) return runs[0];
  return [...runs].sort((a, b) => (toTime(b.createdAt) ?? 0) - (toTime(a.createdAt) ?? 0))[0];
}

/** Whole minutes between start and submission (or time-out). */
export function timeTakenMinutes(input: Pick<ComparisonAttemptInput, "startedAt" | "submittedAt" | "timedOutAt">) {
  const start = toTime(input.startedAt);
  const end = toTime(input.submittedAt) ?? toTime(input.timedOutAt);
  if (start === null || end === null || end < start) return null;
  return Math.round((end - start) / 60000);
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export function buildComparisonRow(attempt: ComparisonAttemptInput, weights?: RubricWeights | null | unknown): ComparisonRow {
  const scorecard = attempt.scorecard ?? null;
  const overallScore = scorecard ? overallScoreForScorecard(scorecard, weights ?? null) : null;
  const criteria = Object.fromEntries(
    CRITERION_KEYS.map((key) => {
      const value = scorecard?.[key];
      return [key, typeof value === "number" && Number.isFinite(value) ? value : null];
    })
  ) as Record<CriterionKey, number | null>;
  const tests = testCountsForAttempt(attempt);

  return {
    attemptId: attempt.id,
    candidateName: attempt.candidate.name,
    candidateEmail: attempt.candidate.email,
    status: attempt.status,
    overallScore,
    criteria,
    testsPassed: tests.passed,
    testsTotal: tests.total,
    visibleTests: tests.visible,
    hiddenTests: tests.hidden,
    timeTakenMinutes: timeTakenMinutes(attempt),
    recommendation: recommendationForScore(overallScore),
    reportUrl: `/admin/attempts/${attempt.id}`,
    pdfUrl: `/api/admin/attempts/${attempt.id}/report`
  };
}

export function buildComparisonRows(attempts: ComparisonAttemptInput[], weights?: RubricWeights | null | unknown): ComparisonRow[] {
  return attempts.map((attempt) => buildComparisonRow(attempt, weights));
}

/** Attempt ids holding the highest overall score (ties all count). */
export function topOverallAttemptIds(rows: ComparisonRow[]): Set<string> {
  const scores = rows.map((row) => row.overallScore).filter((score): score is number => score !== null);
  if (scores.length === 0) return new Set();
  const top = Math.max(...scores);
  return new Set(rows.filter((row) => row.overallScore === top).map((row) => row.attemptId));
}

// ---------------------------------------------------------------------------
// Sorting
// ---------------------------------------------------------------------------

export type SortColumn = "candidate" | "status" | "overall" | CriterionKey | "tests" | "time" | "recommendation";
export type SortDirection = "asc" | "desc";

export const SORT_COLUMNS: readonly SortColumn[] = ["candidate", "status", "overall", ...CRITERION_KEYS, "tests", "time", "recommendation"];

export function isSortColumn(value: unknown): value is SortColumn {
  return typeof value === "string" && (SORT_COLUMNS as readonly string[]).includes(value);
}

type SortValue = string | number | null;

function sortValue(row: ComparisonRow, column: SortColumn): SortValue {
  switch (column) {
    case "candidate":
      return row.candidateName.toLocaleLowerCase();
    case "status":
      return row.status.toLocaleLowerCase();
    case "overall":
      return row.overallScore;
    case "tests":
      if (row.testsPassed === null || row.testsTotal === null) return null;
      // Ratio first; passed count as a sub-key so 6/6 ranks above 1/1.
      return row.testsTotal === 0 ? 0 : row.testsPassed / row.testsTotal + row.testsPassed * 1e-6;
    case "time":
      return row.timeTakenMinutes;
    case "recommendation":
      return row.recommendation ? RECOMMENDATION_RANK[row.recommendation] : null;
    default:
      return row.criteria[column] ?? null;
  }
}

/**
 * Stable sort. Nulls always sort last regardless of direction; strings
 * compare case-insensitively; recommendation sorts by strength
 * (no hire < lean no hire < lean hire < hire).
 */
export function sortComparisonRows(rows: ComparisonRow[], column: SortColumn, direction: SortDirection): ComparisonRow[] {
  const factor = direction === "asc" ? 1 : -1;
  return rows
    .map((row, index) => ({ row, index, value: sortValue(row, column) }))
    .sort((a, b) => {
      if (a.value === null && b.value === null) return a.index - b.index;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      let cmp: number;
      if (typeof a.value === "string" || typeof b.value === "string") {
        cmp = String(a.value).localeCompare(String(b.value), undefined, { sensitivity: "base" });
      } else {
        cmp = a.value - b.value;
      }
      return cmp !== 0 ? cmp * factor : a.index - b.index;
    })
    .map((entry) => entry.row);
}

export function formatDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h ${rest}m` : `${hours}h`;
}
