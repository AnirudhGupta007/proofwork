"use client";

import type { Route } from "next";
import Link from "next/link";
import { useMemo, useState } from "react";
import {
  COMPARISON_CRITERIA,
  formatDuration,
  RECOMMENDATION_LABELS,
  sortComparisonRows,
  topOverallAttemptIds,
  type ComparisonRow,
  type SortColumn,
  type SortDirection
} from "@/app/lib/comparison";

type ColumnDef = {
  column: SortColumn;
  label: string;
  title?: string;
  numeric: boolean;
  /** Direction applied the first time a column is clicked. */
  firstDirection: SortDirection;
};

const COLUMNS: ColumnDef[] = [
  { column: "candidate", label: "Candidate", numeric: false, firstDirection: "asc" },
  { column: "overall", label: "Overall", title: "Overall score (0-100)", numeric: true, firstDirection: "desc" },
  ...COMPARISON_CRITERIA.map<ColumnDef>((criterion) => ({
    column: criterion.key,
    label: criterion.shortLabel,
    title: `${criterion.label} (0-5)`,
    numeric: true,
    firstDirection: "desc"
  })),
  { column: "tests", label: "Tests", title: "Tests passed (visible + hidden)", numeric: true, firstDirection: "desc" },
  { column: "time", label: "Time", title: "Time taken (start to submission)", numeric: true, firstDirection: "asc" },
  { column: "recommendation", label: "Recommendation", numeric: false, firstDirection: "desc" }
];

function statusTone(status: string) {
  if (status === "reviewed" || status === "submitted") return "green";
  if (status === "failed" || status === "timed_out") return "red";
  return "amber";
}

function testsTitle(row: ComparisonRow) {
  const parts: string[] = [];
  if (row.visibleTests) parts.push(`Visible ${row.visibleTests.passed}/${row.visibleTests.total}`);
  if (row.hiddenTests) parts.push(`Hidden ${row.hiddenTests.passed}/${row.hiddenTests.total}`);
  return parts.join(" · ") || undefined;
}

export function CandidateComparisonTable({ rows }: { rows: ComparisonRow[] }) {
  const [sort, setSort] = useState<{ column: SortColumn; direction: SortDirection }>({ column: "overall", direction: "desc" });
  const sorted = useMemo(() => sortComparisonRows(rows, sort.column, sort.direction), [rows, sort]);
  const topIds = useMemo(() => topOverallAttemptIds(rows), [rows]);

  function toggle(def: ColumnDef) {
    setSort((current) =>
      current.column === def.column
        ? { column: def.column, direction: current.direction === "asc" ? "desc" : "asc" }
        : { column: def.column, direction: def.firstDirection }
    );
  }

  return (
    <div className="comparison-scroll" role="region" aria-label="Candidate comparison" tabIndex={0}>
      <table className="comparison-table">
        <caption className="comparison-sr-only">
          Candidates sorted by {COLUMNS.find((def) => def.column === sort.column)?.label ?? sort.column},{" "}
          {sort.direction === "asc" ? "ascending" : "descending"}. Unscored values are listed last.
        </caption>
        <thead>
          <tr>
            {COLUMNS.map((def) => {
              const active = sort.column === def.column;
              return (
                <th
                  key={def.column}
                  scope="col"
                  className={def.numeric ? "num" : undefined}
                  aria-sort={active ? (sort.direction === "asc" ? "ascending" : "descending") : "none"}
                >
                  <button type="button" className="comparison-sort" onClick={() => toggle(def)} title={def.title}>
                    <span>{def.label}</span>
                    <span className="comparison-sort-icon" aria-hidden="true">
                      {active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
                    </span>
                  </button>
                </th>
              );
            })}
            <th scope="col">
              <span className="comparison-sr-only">Report</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => {
            const isTop = topIds.has(row.attemptId);
            return (
              <tr key={row.attemptId} className={isTop ? "is-top" : undefined}>
                <th scope="row">
                  <div className="comparison-candidate">
                    <Link href={row.reportUrl as Route}>{row.candidateName}</Link>
                    <span className="comparison-email">{row.candidateEmail}</span>
                    <span className={`status ${statusTone(row.status)}`}>{row.status.replaceAll("_", " ")}</span>
                  </div>
                </th>
                <td className="num comparison-overall">
                  {row.overallScore ?? <span className="comparison-null">Pending</span>}
                  {isTop ? <span className="comparison-top-badge">Top</span> : null}
                </td>
                {COMPARISON_CRITERIA.map((criterion) => {
                  const value = row.criteria[criterion.key];
                  return (
                    <td key={criterion.key} className="num">
                      {value === null ? <span className="comparison-null">—</span> : value}
                    </td>
                  );
                })}
                <td className="num" title={testsTitle(row)}>
                  {row.testsPassed === null || row.testsTotal === null ? (
                    <span className="comparison-null">—</span>
                  ) : (
                    `${row.testsPassed}/${row.testsTotal}`
                  )}
                </td>
                <td className="num">
                  {row.timeTakenMinutes === null ? <span className="comparison-null">—</span> : formatDuration(row.timeTakenMinutes)}
                </td>
                <td>
                  {row.recommendation ? (
                    <span className={`comparison-rec rec-${row.recommendation}`}>{RECOMMENDATION_LABELS[row.recommendation]}</span>
                  ) : (
                    <span className="comparison-null">Pending</span>
                  )}
                </td>
                <td className="comparison-links">
                  <Link href={row.reportUrl as Route}>Full report</Link>
                  <a href={row.pdfUrl} target="_blank" rel="noreferrer">
                    PDF
                  </a>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
