import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "../app/lib/db.ts";
import { buildCandidateReportPdf } from "../app/lib/reports/candidate-report.ts";

const runStamp = process.argv[2];
if (!runStamp) throw new Error("Usage: npx tsx scripts/export-ui-sde-results.ts <runStamp>");

function slug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "attempt";
}

const out = path.join(process.cwd(), "reports", `ui-sde-browser-${runStamp}`);
await mkdir(out, { recursive: true });

const attempts = await db.attempt.findMany({
  where: { candidate: { name: { contains: runStamp } } },
  include: { candidate: true, template: true, scorecard: true, artifacts: true },
  orderBy: { createdAt: "asc" }
});

const rows = [];
for (const attempt of attempts) {
  const score = attempt.scorecard
    ? Math.round(
        ((attempt.scorecard.requirements +
          attempt.scorecard.testAndEvalQuality +
          attempt.scorecard.debuggingDiscipline +
          attempt.scorecard.codeQuality +
          attempt.scorecard.aiCollaboration +
          attempt.scorecard.productionReadiness +
          attempt.scorecard.communication) /
          35) *
          100
      )
    : null;
  const reportPath = path.join(out, `${slug(attempt.template.level)}-${attempt.id}-ui-report.pdf`);
  await writeFile(reportPath, await buildCandidateReportPdf(attempt.id));
  rows.push({
    attemptId: attempt.id,
    candidate: attempt.candidate.name,
    level: attempt.template.level,
    title: attempt.template.title,
    status: attempt.status,
    score,
    dimensions: attempt.scorecard,
    adminUrl: `http://localhost:3001/admin/attempts/${attempt.id}`,
    reportPath,
    artifacts: attempt.artifacts.map((artifact) => artifact.label)
  });
}

const resultsPath = path.join(out, "ui-results.json");
await writeFile(resultsPath, JSON.stringify(rows, null, 2));
console.log(JSON.stringify({ out, resultsPath, rows }, null, 2));
await db.$disconnect();
