import type { Artifact, EvalRun, EventLog, Scorecard } from "@prisma/client";
import { existsSync } from "fs";
import PDFDocument from "pdfkit";
import { Resend } from "resend";
import { rehydrateArtifactTexts } from "@/app/lib/artifacts";
import { db } from "@/app/lib/db";
import { aggregateScore } from "@/app/lib/domain/score";
import { env } from "@/app/lib/env";
import { callout, ctaButton, emailShell, escapeHtml, metadataTable } from "@/app/lib/email/brand";
import { logAttemptEvent } from "@/app/lib/events";
import { loadRecordingAttachment } from "@/app/lib/proctoring-recordings";

const reportArtifactLabel = "Candidate PDF report";
const reportVersion = 3;

type ReportArtifact = Pick<Artifact, "kind" | "label" | "uri" | "metadata" | "createdAt">;
type ReportEvalRun = Pick<EvalRun, "status" | "visibleTests" | "hiddenTests" | "llmRubric" | "summary" | "createdAt">;
type ReportEventLog = Pick<EventLog, "type" | "message" | "metadata" | "createdAt">;
type ReportScorecard = Pick<
  Scorecard,
  | "requirements"
  | "testAndEvalQuality"
  | "debuggingDiscipline"
  | "codeQuality"
  | "aiCollaboration"
  | "productionReadiness"
  | "communication"
  | "automatedSummary"
  | "reviewerOverrideScore"
> | null;

type CandidateReportData = {
  candidateName: string;
  candidateEmail: string;
  roleTitle: string | null;
  level: string;
  assessmentTitle: string;
  status: string;
  startedAt: Date | null;
  submittedAt: Date | null;
  dueAt: Date | null;
  finalNotes: string | null;
  scorecard: ReportScorecard;
  evalRuns: ReportEvalRun[];
  artifacts: ReportArtifact[];
  eventLogs: ReportEventLog[];
};

function escapePdfText(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)").replaceAll("\r", "");
}

function stripAnsi(value: string) {
  return value
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, "")
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, "")
    .replace(/\u001b[()][A-Za-z0-9]/g, "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "");
}

function metadataOutput(metadata: unknown, maxLength = 1200) {
  if (!metadata || typeof metadata !== "object") return "";
  const record = metadata as { stdout?: unknown; stderr?: unknown; exitCode?: unknown };
  const output = String(record.stdout ?? record.stderr ?? "");
  const exitCode = typeof record.exitCode === "number" ? `exit ${record.exitCode}: ` : "";
  return `${exitCode}${stripAnsi(output)}`.slice(0, maxLength);
}

function metadataRawOutput(metadata: unknown) {
  if (!metadata || typeof metadata !== "object") return "";
  const record = metadata as { stdout?: unknown; stderr?: unknown };
  return stripAnsi(String(record.stdout ?? record.stderr ?? "")).trim();
}

function formatDate(value: Date | null) {
  return value
    ? value.toLocaleString("en", {
        dateStyle: "medium",
        timeStyle: "short"
      })
    : "Not recorded";
}

function compactMiddle(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  const keep = Math.max(8, Math.floor((maxLength - 3) / 2));
  return `${value.slice(0, keep)}...${value.slice(-keep)}`;
}

function cleanAssessmentTitle(value: string) {
  const cleaned = value
    .replace(/^SDE2 Vibecoding:\s*/i, "SDE2 Product Build: ")
    .replace(/\bVibecoding\b/gi, "Product Build")
    .replace(/\bVibecode\b/gi, "Proofwork");
  return cleaned.replace(/^([A-Z0-9]+) Product Build:\s*(.+?)\s+Product Build$/i, "$1 Product Build: $2");
}

function scoreSummary(scorecard: ReportScorecard) {
  if (!scorecard) return "Pending";
  return String(
    scorecard.reviewerOverrideScore ??
      aggregateScore({
        requirements: scorecard.requirements,
        testAndEvalQuality: scorecard.testAndEvalQuality,
        debuggingDiscipline: scorecard.debuggingDiscipline,
        codeQuality: scorecard.codeQuality,
        aiCollaboration: scorecard.aiCollaboration,
        productionReadiness: scorecard.productionReadiness,
        communication: scorecard.communication
      })
  );
}

function recommendation(score: number | null) {
  if (score === null) return { label: "PENDING", reason: "Evaluation has not completed." };
  if (score >= 78) return { label: "HIRE", reason: "Strong evidence across implementation, evals, and communication." };
  if (score >= 68) return { label: "LEAN HIRE", reason: "Promising signal with some follow-up review needed." };
  if (score >= 60) return { label: "LEAN NO HIRE", reason: "Some signal, but not enough confidence for this bar." };
  return { label: "NO HIRE", reason: "Insufficient evidence for the target role." };
}

function numericScore(scorecard: ReportScorecard) {
  if (!scorecard) return null;
  return Number(scoreSummary(scorecard));
}

function wrapText(text: string, maxChars: number) {
  const words = text.replace(/\s+/g, " ").trim().split(" ");
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!word) continue;
    if (`${current} ${word}`.trim().length > maxChars) {
      if (current) lines.push(current);
      current = word;
    } else {
      current = `${current} ${word}`.trim();
    }
  }

  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function hexRgb(hex: string) {
  const value = hex.replace("#", "");
  const bigint = Number.parseInt(value, 16);
  const r = ((bigint >> 16) & 255) / 255;
  const g = ((bigint >> 8) & 255) / 255;
  const b = (bigint & 255) / 255;
  return `${r.toFixed(3)} ${g.toFixed(3)} ${b.toFixed(3)}`;
}

function parseTestCounts(output: string) {
  const pass = Number(output.match(/pass\s+(\d+)/i)?.[1] ?? 0);
  const fail = Number(output.match(/fail\s+(\d+)/i)?.[1] ?? 0);
  if (!pass && !fail) return null;
  return { pass, fail, total: pass + fail };
}

function artifactByLabel(artifacts: ReportArtifact[], label: string) {
  return artifacts.find((artifact) => artifact.label === label);
}

function outputForLabel(artifacts: ReportArtifact[], label: string, maxLength = 6000) {
  return metadataOutput(artifactByLabel(artifacts, label)?.metadata, maxLength);
}

function artifactHasUsefulOutput(artifacts: ReportArtifact[], label: string) {
  const output = metadataRawOutput(artifactByLabel(artifacts, label)?.metadata);
  return Boolean(output && !/No such file or directory|missing\s*$/i.test(output));
}

function commitEvalCaptured(artifacts: ReportArtifact[]) {
  return /=== commit /i.test(outputForLabel(artifacts, "Commit checkpoint evals", 4000));
}

function gitDiffCaptured(artifacts: ReportArtifact[]) {
  return artifactHasUsefulOutput(artifacts, "Git diff");
}

function includeArtifactInAppendix(artifact: ReportArtifact) {
  if (artifact.label === reportArtifactLabel) return false;
  if (artifact.kind === "opencode_log") return false;
  return true;
}

function promptQualityFromReport(data: CandidateReportData) {
  const artifact = artifactByLabel(data.artifacts, "Prompt quality analysis");
  const metadata = artifact?.metadata && typeof artifact.metadata === "object" ? (artifact.metadata as Record<string, unknown>) : null;
  const rubric = data.evalRuns[0]?.llmRubric && typeof data.evalRuns[0].llmRubric === "object" ? (data.evalRuns[0].llmRubric as Record<string, unknown>) : null;
  const fromRubric =
    rubric?.promptQualitySignals && typeof rubric.promptQualitySignals === "object"
      ? (rubric.promptQualitySignals as Record<string, unknown>)
      : null;
  const source = fromRubric ?? metadata;
  const score = typeof source?.qualityScore === "number" ? source.qualityScore : null;
  const promptCount = typeof source?.promptCount === "number" ? source.promptCount : null;
  const strengths = Array.isArray(source?.strengths) ? source.strengths.map(String) : [];
  const concerns = Array.isArray(source?.concerns) ? source.concerns.map(String) : [];
  const summary = typeof source?.summary === "string" ? source.summary : outputForLabel(data.artifacts, "Prompt quality analysis", 500);

  return { score, promptCount, strengths, concerns, summary };
}

function liveInterviewFromReport(data: CandidateReportData) {
  const artifact = artifactByLabel(data.artifacts, "Live interview transcript");
  const metadata = artifact?.metadata && typeof artifact.metadata === "object" ? (artifact.metadata as Record<string, unknown>) : null;
  const rubric = data.evalRuns[0]?.llmRubric && typeof data.evalRuns[0].llmRubric === "object" ? (data.evalRuns[0].llmRubric as Record<string, unknown>) : null;
  const fromRubric =
    rubric?.liveInterviewSignals && typeof rubric.liveInterviewSignals === "object"
      ? (rubric.liveInterviewSignals as Record<string, unknown>)
      : null;
  const source = fromRubric ?? metadata;
  const score = typeof source?.qualityScore === "number" ? source.qualityScore : null;
  const eventCount = typeof source?.eventCount === "number" ? source.eventCount : 0;
  const strengths = Array.isArray(source?.strengths) ? source.strengths.map(String) : [];
  const concerns = Array.isArray(source?.concerns) ? source.concerns.map(String) : [];
  const transcript = typeof source?.transcript === "string" ? source.transcript : outputForLabel(data.artifacts, "Live interview transcript", 1600);
  const summary = typeof source?.summary === "string" ? source.summary : "";
  const enabled = source?.enabled === true || eventCount > 0 || transcript.trim().length > 0;

  return { enabled, score, eventCount, strengths, concerns, transcript, summary };
}

function interviewerFeedbackFromReport(data: CandidateReportData) {
  const event = data.eventLogs.find((entry) => entry.type === "interview.feedback");
  const metadata = event?.metadata && typeof event.metadata === "object" ? (event.metadata as Record<string, unknown>) : null;
  if (!event || !metadata) return null;

  return {
    interviewerName: typeof metadata.interviewerName === "string" ? metadata.interviewerName : "Interviewer",
    recommendation:
      typeof metadata.hireRecommendation === "string" ? metadata.hireRecommendation.replaceAll("_", " ").toUpperCase() : "NOT RECORDED",
    technicalDepth: typeof metadata.technicalDepth === "number" ? metadata.technicalDepth : null,
    productJudgment: typeof metadata.productJudgment === "number" ? metadata.productJudgment : null,
    communication: typeof metadata.communication === "number" ? metadata.communication : null,
    aiCollaboration: typeof metadata.aiCollaboration === "number" ? metadata.aiCollaboration : null,
    summary: typeof metadata.summary === "string" ? metadata.summary : event.message,
    strengths: typeof metadata.strengths === "string" ? metadata.strengths : "",
    concerns: typeof metadata.concerns === "string" ? metadata.concerns : "",
    followUps: typeof metadata.followUps === "string" ? metadata.followUps : "",
    createdAt: event.createdAt
  };
}

function gptEvaluatorFromReport(data: CandidateReportData) {
  const rubric = data.evalRuns[0]?.llmRubric && typeof data.evalRuns[0].llmRubric === "object" ? (data.evalRuns[0].llmRubric as Record<string, unknown>) : null;
  const evaluator = rubric?.evaluator && typeof rubric.evaluator === "object" ? (rubric.evaluator as Record<string, unknown>) : null;
  const cap = evaluator?.cap && typeof evaluator.cap === "object" ? (evaluator.cap as Record<string, unknown>) : null;
  const source = typeof evaluator?.source === "string" ? evaluator.source : "heuristic";
  const model = typeof evaluator?.model === "string" ? evaluator.model : null;
  const recommendation = typeof evaluator?.recommendation === "string" ? evaluator.recommendation : null;
  const strengths = Array.isArray(evaluator?.strengths) ? evaluator.strengths.map(String) : [];
  const concerns = Array.isArray(evaluator?.concerns) ? evaluator.concerns.map(String) : [];
  const evidenceCitations = Array.isArray(evaluator?.evidenceCitations) ? evaluator.evidenceCitations.map(String) : [];
  const capReasons = Array.isArray(cap?.reasons) ? cap.reasons.map(String) : [];
  const bindingReasons = Array.isArray(cap?.bindingReasons) ? cap.bindingReasons.map(String) : [];
  const maxScore = typeof cap?.maxScore === "number" ? cap.maxScore : null;

  return { source, model, recommendation, strengths, concerns, evidenceCitations, capReasons, bindingReasons, maxScore };
}

const reportColors = {
  bg: "#fbfaf7",
  panel: "#ffffff",
  soft: "#f6f5f1",
  ink: "#1a1a1a",
  muted: "#555555",
  line: "#dedbd2",
  green: "#1f7a4d",
  yellow: "#a66a00",
  red: "#a52222"
};

function statusPill(score: number | null) {
  if (score === null) return { fill: reportColors.soft, text: reportColors.ink };
  if (score >= 78) return { fill: reportColors.green, text: "#ffffff" };
  if (score >= 68) return { fill: reportColors.yellow, text: "#ffffff" };
  if (score >= 60) return { fill: reportColors.yellow, text: reportColors.ink };
  return { fill: reportColors.red, text: "#ffffff" };
}

function metricColor(value: number) {
  if (value >= 4) return reportColors.green;
  if (value >= 3) return reportColors.yellow;
  return reportColors.red;
}

function decisionSummary(data: CandidateReportData, score: number | null) {
  const testCounts = parseTestCounts(outputForLabel(data.artifacts, "Test output"));
  const hiddenCounts = parseTestCounts(outputForLabel(data.artifacts, "Hidden test output"));
  const visibleFailed = testCounts ? testCounts.fail > 0 : false;
  const hiddenFailed = hiddenCounts ? hiddenCounts.fail > 0 : false;

  if (score === null) return "Evaluation is still pending. Reviewers should wait for automated evidence before making a decision.";
  if (score >= 78) return "Strong hire signal: the candidate met the bar across implementation, eval quality, communication, and production readiness.";
  if (score >= 68) return "Promising signal: the candidate likely deserves follow-up review, with attention to the weaker rubric areas and any failed evals.";
  if (score >= 60) return "Mixed signal: there is useful evidence, but the submission does not clear the hiring bar without a strong human override.";
  if (visibleFailed && hiddenFailed) return "No hire: both visible and hidden evals failed, creating low confidence that the candidate met core requirements.";
  return "No hire: insufficient evidence for the target role based on the automated scorecard and captured artifacts.";
}

function scoreBand(value: number) {
  if (value >= 4) return "Strong";
  if (value >= 3) return "Mixed";
  return "Needs work";
}

function sectionNarrative(label: string, value: number) {
  const lower = label.toLowerCase();
  if (value >= 4) {
    if (lower.includes("ai")) return "Used AI assistance with useful judgment and left enough evidence for review.";
    if (lower.includes("debug")) return "Showed a clear debugging loop with useful verification signals.";
    if (lower.includes("communication")) return "Communicated changes, verification, and tradeoffs clearly.";
    return "Strong signal for this dimension relative to the target level.";
  }
  if (value >= 3) return "Acceptable signal, but the reviewer should inspect supporting evidence before treating this as a strength.";
  if (lower.includes("requirements")) return "Core behavior did not clear the assessment bar; visible and hidden eval failures matter here.";
  if (lower.includes("eval")) return "Testing/eval coverage did not create enough confidence in correctness.";
  if (lower.includes("production")) return "Production readiness was limited; reliability and launch-readiness need follow-up.";
  return "Weak signal for this dimension and a material contributor to the final recommendation.";
}

function sectionRows(scorecard: ReportScorecard) {
  if (!scorecard) return [];
  return [
    { label: "Requirements correctness", value: scorecard.requirements },
    { label: "Test and eval quality", value: scorecard.testAndEvalQuality },
    { label: "Debugging discipline", value: scorecard.debuggingDiscipline },
    { label: "Code quality", value: scorecard.codeQuality },
    { label: "AI collaboration judgment", value: scorecard.aiCollaboration },
    { label: "Production readiness", value: scorecard.productionReadiness },
    { label: "Communication", value: scorecard.communication }
  ];
}

type PdfFont = "F1" | "F2";

class DesignedPdf {
  private readonly width = 612;
  private readonly height = 792;
  private readonly margin = 40;
  private pages: string[][] = [[]];
  private cursor = this.margin;

  private get stream() {
    return this.pages[this.pages.length - 1];
  }

  addPage() {
    this.pages.push([]);
    this.cursor = this.margin;
  }

  ensure(height: number) {
    if (this.cursor + height > this.height - this.margin) this.addPage();
  }

  private pdfY(top: number) {
    return this.height - top;
  }

  rect(x: number, top: number, width: number, height: number, fill: string, stroke?: string) {
    const y = this.height - top - height;
    this.stream.push(`q ${hexRgb(fill)} rg ${x} ${y} ${width} ${height} re f Q`);
    if (stroke) this.stream.push(`q 0.7 w ${hexRgb(stroke)} RG ${x} ${y} ${width} ${height} re S Q`);
  }

  text(text: string, x: number, top: number, size = 10, font: PdfFont = "F1", color = "#111827") {
    this.stream.push(`BT ${hexRgb(color)} rg /${font} ${size} Tf ${x} ${this.pdfY(top)} Td (${escapePdfText(text)}) Tj ET`);
  }

  wrapped(text: string, x: number, top: number, maxChars: number, options?: { size?: number; font?: PdfFont; color?: string; lineGap?: number }) {
    const size = options?.size ?? 10;
    const lineGap = options?.lineGap ?? size + 4;
    let y = top;
    for (const line of wrapText(text, maxChars)) {
      this.text(line, x, y, size, options?.font ?? "F1", options?.color ?? "#111827");
      y += lineGap;
    }
    return y;
  }

  card(x: number, top: number, width: number, height: number) {
    this.rect(x, top, width, height, "#ffffff", "#dbe3ef");
  }

  footer() {
    this.pages.forEach((page, index) => {
      page.push(`BT ${hexRgb("#64748b")} rg /F1 8 Tf 40 24 Td (${escapePdfText(`Proofwork Assessment Report | Page ${index + 1}`)}) Tj ET`);
    });
  }

  toBuffer() {
    this.footer();
    const pageStreams = this.pages.map((page) => page.join("\n"));
    const objects: string[] = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      `<< /Type /Pages /Kids [${pageStreams.map((_, index) => `${5 + index * 2} 0 R`).join(" ")}] /Count ${pageStreams.length} >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"
    ];

    for (let index = 0; index < pageStreams.length; index += 1) {
      const contentObjectId = 6 + index * 2;
      objects.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectId} 0 R >>`
      );
      objects.push(`<< /Length ${Buffer.byteLength(pageStreams[index], "utf8")} >>\nstream\n${pageStreams[index]}\nendstream`);
    }

    const chunks = ["%PDF-1.4\n"];
    const offsets: number[] = [0];
    for (let index = 0; index < objects.length; index += 1) {
      offsets.push(Buffer.byteLength(chunks.join(""), "utf8"));
      chunks.push(`${index + 1} 0 obj\n${objects[index]}\nendobj\n`);
    }

    const xrefOffset = Buffer.byteLength(chunks.join(""), "utf8");
    chunks.push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
    for (let index = 1; index < offsets.length; index += 1) {
      chunks.push(`${String(offsets[index]).padStart(10, "0")} 00000 n \n`);
    }
    chunks.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

    return Buffer.from(chunks.join(""), "utf8");
  }
}

function drawMetricCard(pdf: DesignedPdf, x: number, top: number, width: number, label: string, value: string, accent = "#0f766e") {
  pdf.card(x, top, width, 76);
  pdf.text(label.toUpperCase(), x + 16, top + 24, 8, "F2", "#64748b");
  pdf.text(value, x + 16, top + 52, 18, "F2", accent);
}

function drawScoreBar(pdf: DesignedPdf, x: number, top: number, label: string, value: number) {
  const color = metricColor(value);
  pdf.text(label, x, top + 10, 9, "F1", "#334155");
  pdf.rect(x + 150, top, 150, 10, "#e5e7eb");
  pdf.rect(x + 150, top, Math.max(4, (value / 5) * 150), 10, color);
  pdf.text(`${value}/5`, x + 314, top + 10, 9, "F2", color);
}

function drawEvidenceItem(pdf: DesignedPdf, x: number, top: number, label: string, ok: boolean) {
  pdf.rect(x, top, 12, 12, ok ? "#dcfce7" : "#fee2e2", ok ? "#86efac" : "#fecaca");
  pdf.text(ok ? "OK" : "!", x + 2, top + 10, 6, "F2", ok ? "#047857" : "#dc2626");
  pdf.wrapped(label, x + 20, top + 10, 25, { size: 9, color: "#334155", lineGap: 12 });
}

function buildDesignedPdf(data: CandidateReportData) {
  const latestEval = data.evalRuns[0];
  const latestByLabel = Array.from(
    data.artifacts
      .reduce((map, artifact) => {
        if (!map.has(artifact.label)) map.set(artifact.label, artifact);
        return map;
      }, new Map<string, ReportArtifact>())
      .values()
  );
  const pdf = new DesignedPdf();
  const score = numericScore(data.scorecard);
  const rec = recommendation(score);
  const recStyle = statusPill(score);
  const visibleCounts = parseTestCounts(outputForLabel(data.artifacts, "Test output"));
  const hiddenCounts = parseTestCounts(outputForLabel(data.artifacts, "Hidden test output"));
  const proctoringEvents = data.eventLogs.filter((event) => event.type.startsWith("proctoring."));

  pdf.rect(0, 0, 612, 112, "#111827");
  pdf.text("PROOFWORK ASSESSMENT REPORT", 40, 38, 9, "F2", "#99f6e4");
  pdf.wrapped(data.candidateName, 40, 68, 28, { size: 24, font: "F2", color: "#ffffff", lineGap: 28 });
  pdf.text(data.candidateEmail, 40, 96, 10, "F1", "#cbd5e1");
  pdf.rect(430, 36, 142, 38, recStyle.fill);
  pdf.text(rec.label, 450, 60, 14, "F2", recStyle.text);

  drawMetricCard(pdf, 40, 136, 122, "Score", score === null ? "Pending" : `${score}/100`, recStyle.fill);
  drawMetricCard(pdf, 176, 136, 178, "Status", data.status, "#111827");
  drawMetricCard(pdf, 368, 136, 204, "Assessment", cleanAssessmentTitle(data.assessmentTitle).replace(/^SDE2 Product Build:\s*/i, ""), "#111827");

  pdf.card(40, 232, 532, 92);
  pdf.text("Decision rationale", 58, 260, 12, "F2", "#111827");
  pdf.wrapped(decisionSummary(data, score), 58, 284, 83, { size: 10, color: "#334155", lineGap: 14 });

  pdf.card(40, 344, 328, 230);
  pdf.text("Score breakdown", 58, 372, 13, "F2", "#111827");
  if (data.scorecard) {
    const rows: Array<[string, number]> = [
      ["Requirements correctness", data.scorecard.requirements],
      ["Test and eval quality", data.scorecard.testAndEvalQuality],
      ["Debugging discipline", data.scorecard.debuggingDiscipline],
      ["Code quality", data.scorecard.codeQuality],
      ["AI collaboration", data.scorecard.aiCollaboration],
      ["Production readiness", data.scorecard.productionReadiness],
      ["Communication", data.scorecard.communication]
    ];
    rows.forEach(([label, value], index) => drawScoreBar(pdf, 58, 400 + index * 22, label, value));
  } else {
    pdf.text("Scorecard pending.", 58, 404, 10, "F1", "#64748b");
  }

  pdf.card(386, 344, 186, 230);
  pdf.text("Key evidence", 404, 372, 13, "F2", "#111827");
  drawEvidenceItem(
    pdf,
    404,
    398,
    visibleCounts ? `Visible tests: ${visibleCounts.pass}/${visibleCounts.total} passed` : "Visible tests collected",
    Boolean(visibleCounts && visibleCounts.fail === 0)
  );
  drawEvidenceItem(
    pdf,
    404,
    434,
    hiddenCounts ? `Hidden evals: ${hiddenCounts.pass}/${hiddenCounts.total} passed` : "Hidden evals collected",
    Boolean(hiddenCounts && hiddenCounts.fail === 0)
  );
  drawEvidenceItem(pdf, 404, 470, "Commit checkpoint eval captured", Boolean(artifactByLabel(data.artifacts, "Commit checkpoint evals")));
  drawEvidenceItem(pdf, 404, 506, "OpenCode session log captured", Boolean(artifactByLabel(data.artifacts, "OpenCode log")));
  drawEvidenceItem(pdf, 404, 542, `${proctoringEvents.length} proctoring events captured`, proctoringEvents.length > 0);

  pdf.card(40, 594, 532, 116);
  pdf.text("Assessment timeline", 58, 622, 13, "F2", "#111827");
  const timeline = [
    ["Started", formatDate(data.startedAt)],
    ["Submitted", formatDate(data.submittedAt)],
    ["Evaluation", latestEval ? `${latestEval.status} | ${formatDate(latestEval.createdAt)}` : "Pending"],
    ["Report", "Generated for reviewer email"]
  ];
  timeline.forEach(([label, value], index) => {
    const x = 58 + index * 128;
    pdf.rect(x, 650, 10, 10, "#0f766e");
    pdf.text(label, x, 678, 9, "F2", "#111827");
    pdf.wrapped(value, x, 696, 18, { size: 8, color: "#64748b", lineGap: 10 });
    if (index < timeline.length - 1) pdf.rect(x + 16, 654, 96, 2, "#cbd5e1");
  });

  pdf.addPage();
  pdf.text("Reviewer Summary", 40, 58, 18, "F2", "#111827");
  pdf.card(40, 84, 532, 108);
  pdf.text("Candidate notes", 58, 112, 12, "F2", "#111827");
  pdf.wrapped(data.finalNotes || "No final notes submitted.", 58, 138, 82, { size: 10, color: "#334155", lineGap: 14 });

  pdf.card(40, 216, 532, 116);
  pdf.text("Automated evaluation", 58, 244, 12, "F2", "#111827");
  pdf.wrapped(latestEval?.summary ?? data.scorecard?.automatedSummary ?? "No eval summary recorded.", 58, 270, 82, {
    size: 10,
    color: "#334155",
    lineGap: 14
  });
  pdf.text(`Visible tests: ${JSON.stringify(latestEval?.visibleTests ?? {})}`, 58, 314, 8, "F1", "#64748b");
  pdf.text(`Hidden tests: ${JSON.stringify(latestEval?.hiddenTests ?? {})}`, 58, 328, 8, "F1", "#64748b");

  if (proctoringEvents.length > 0) {
    pdf.card(40, 358, 532, 92);
    pdf.text("Proctoring", 58, 386, 12, "F2", "#111827");
    proctoringEvents.slice(0, 4).forEach((event, index) => {
      const metadata = event.metadata ? ` ${JSON.stringify(event.metadata)}` : "";
      pdf.wrapped(`${formatDate(event.createdAt)} | ${event.type}${metadata}`, 58, 412 + index * 16, 88, {
        size: 8,
        color: "#334155",
        lineGap: 10
      });
    });
  }

  pdf.addPage();
  pdf.text("Evidence Appendix", 40, 58, 18, "F2", "#111827");
  let y = 92;
  for (const artifact of latestByLabel) {
    if (artifact.label === reportArtifactLabel) continue;
    pdf.ensure(120);
    if (y > 680) {
      pdf.addPage();
      pdf.text("Evidence Appendix", 40, 58, 18, "F2", "#111827");
      y = 92;
    }
    pdf.text(artifact.label, 40, y, 12, "F2", "#111827");
    y += 18;
    pdf.text(`${artifact.kind} | ${artifact.uri}`, 40, y, 8, "F1", "#64748b");
    y += 16;
    const output = metadataOutput(artifact.metadata);
    const excerpt = output || `${artifact.kind} collected at ${formatDate(artifact.createdAt)}`;
    for (const text of wrapText(excerpt, 98).slice(0, 16)) {
      if (y > 720) {
        pdf.addPage();
        y = 58;
      }
      pdf.text(text, 40, y, 7, "F1", "#334155");
      y += 10;
    }
    y += 16;
  }

  return pdf.toBuffer();
}

function registerReportFonts(doc: PDFKit.PDFDocument) {
  const regular = "/System/Library/Fonts/Supplemental/Arial.ttf";
  const bold = "/System/Library/Fonts/Supplemental/Arial Bold.ttf";
  const display = "/System/Library/Fonts/Supplemental/Georgia.ttf";

  if (existsSync(regular) && existsSync(bold) && existsSync(display)) {
    doc.registerFont("ReportRegular", regular);
    doc.registerFont("ReportBold", bold);
    doc.registerFont("ReportDisplay", display);
    return { regular: "ReportRegular", bold: "ReportBold", display: "ReportDisplay" };
  }

  return { regular: "Helvetica", bold: "Helvetica-Bold", display: "Times-Roman" };
}

function pdfKitBuffer(doc: PDFKit.PDFDocument) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
}

function drawKitCard(doc: PDFKit.PDFDocument, x: number, y: number, width: number, height: number, fill = "#ffffff") {
  doc.rect(x, y, width, height).fillAndStroke(fill, reportColors.line);
}

function drawKitMetric(
  doc: PDFKit.PDFDocument,
  fonts: { regular: string; bold: string; display: string },
  x: number,
  y: number,
  width: number,
  label: string,
  value: string,
  color = "#111827"
) {
  drawKitCard(doc, x, y, width, 72);
  doc.font(fonts.bold).fontSize(8).fillColor(reportColors.muted).text(label.toUpperCase(), x + 16, y + 18, { width: width - 32, characterSpacing: 1.1 });
  const valueSize = value.length > 24 ? 14 : 18;
  doc.font(fonts.bold).fontSize(valueSize).fillColor(color).text(value, x + 16, y + 38, { width: width - 32, lineGap: -1 });
}

function drawKitBar(
  doc: PDFKit.PDFDocument,
  fonts: { regular: string; bold: string; display: string },
  x: number,
  y: number,
  label: string,
  value: number,
  width = 150
) {
  const color = metricColor(value);
  doc.font(fonts.regular).fontSize(9).fillColor(reportColors.ink).text(label, x, y, { width: 150 });
  doc.rect(x + 166, y + 2, width, 8).fill(reportColors.soft);
  doc.rect(x + 166, y + 2, Math.max(6, (value / 5) * width), 8).fill(color);
  doc.font(fonts.bold).fontSize(9).fillColor(color).text(`${value}/5`, x + 326, y - 1, { width: 36, align: "right" });
}

function drawKitEvidence(
  doc: PDFKit.PDFDocument,
  fonts: { regular: string; bold: string; display: string },
  x: number,
  y: number,
  label: string,
  ok: boolean
) {
  doc.rect(x, y, 18, 18).fillAndStroke(ok ? "#edf7f1" : "#fff2f2", ok ? reportColors.green : reportColors.red);
  doc.font(fonts.bold).fontSize(6.5).fillColor(ok ? reportColors.green : reportColors.red).text(ok ? "OK" : "!", x + 1, y + 5, { width: 16, align: "center" });
  doc.font(fonts.regular).fontSize(9).fillColor(reportColors.ink).text(label, x + 26, y + 1, { width: 138, lineGap: 2 });
}

function drawKitHeader(doc: PDFKit.PDFDocument, fonts: { regular: string; bold: string; display: string }, title: string) {
  doc.rect(0, 0, 612, 792).fill(reportColors.bg);
  doc.font(fonts.bold).fontSize(8).fillColor(reportColors.muted).text("PROOFWORK", 40, 34, { characterSpacing: 1.2 });
  doc.font(fonts.display).fontSize(28).fillColor(reportColors.ink).text(title, 40, 52);
  doc.moveTo(40, 88).lineTo(572, 88).strokeColor(reportColors.line).lineWidth(1).stroke();
}

function addFooter(doc: PDFKit.PDFDocument, fonts: { regular: string; bold: string; display: string }, page: number) {
  doc.font(fonts.regular).fontSize(8).fillColor(reportColors.muted).text(`Proofwork | Assessment report | Page ${page}`, 40, 760);
}

async function buildPdfKitReport(data: CandidateReportData) {
  const doc = new PDFDocument({ size: "LETTER", margin: 0, bufferPages: false });
  const done = pdfKitBuffer(doc);
  const fonts = registerReportFonts(doc);
  const score = numericScore(data.scorecard);
  const rec = recommendation(score);
  const recStyle = statusPill(score);
  const latestEval = data.evalRuns[0];
  const visibleCounts = parseTestCounts(outputForLabel(data.artifacts, "Test output"));
  const hiddenCounts = parseTestCounts(outputForLabel(data.artifacts, "Hidden test output"));
  const proctoringEvents = data.eventLogs.filter((event) => event.type.startsWith("proctoring."));
  const recordingCount = data.artifacts.filter((artifact) => artifact.kind === "proctoring_recording").length;
  const rows = sectionRows(data.scorecard);
  const promptQuality = promptQualityFromReport(data);
  const liveInterview = liveInterviewFromReport(data);
  const interviewerFeedback = interviewerFeedbackFromReport(data);
  const gptEvaluator = gptEvaluatorFromReport(data);
  const commitEvalOk = commitEvalCaptured(data.artifacts);
  const diffOk = gitDiffCaptured(data.artifacts);

  doc.rect(0, 0, 612, 792).fill(reportColors.bg);
  doc.rect(40, 34, 28, 28).fill(reportColors.ink);
  doc.font(fonts.bold).fontSize(8).fillColor("#ffffff").text("P", 49, 44);
  doc.font(fonts.bold).fontSize(9).fillColor(reportColors.ink).text("PROOFWORK", 78, 42, { characterSpacing: 1.4 });
  doc.font(fonts.regular).fontSize(9).fillColor(reportColors.muted).text("Proofwork assessment report", 78, 56);
  doc.moveTo(40, 84).lineTo(572, 84).strokeColor(reportColors.line).lineWidth(1).stroke();
  doc.font(fonts.bold).fontSize(8).fillColor(reportColors.muted).text("CANDIDATE", 40, 116, { characterSpacing: 1.3 });
  const candidateNameY = 134;
  const candidateNameSize = data.candidateName.length > 42 ? 22 : data.candidateName.length > 30 ? 26 : 30;
  doc.font(fonts.display).fontSize(candidateNameSize).fillColor(reportColors.ink);
  const candidateNameHeight = doc.heightOfString(data.candidateName, { width: 332, lineGap: 0 });
  doc.text(data.candidateName, 40, candidateNameY, { width: 332, lineGap: 0 });
  const candidateEmailY = Math.min(candidateNameY + candidateNameHeight + 8, 214);
  doc.font(fonts.regular).fontSize(9).fillColor(reportColors.muted).text(compactMiddle(data.candidateEmail, 44), 40, candidateEmailY, { width: 320 });
  doc.rect(418, 126, 154, 48).fill(recStyle.fill);
  doc.font(fonts.bold).fontSize(16).fillColor(recStyle.text).text(rec.label, 434, 142, { width: 122, align: "center" });

  drawKitMetric(doc, fonts, 40, 236, 118, "Score", score === null ? "Pending" : `${score}/100`, recStyle.fill);
  drawKitMetric(doc, fonts, 172, 236, 126, "Level", data.level, reportColors.ink);
  drawKitMetric(doc, fonts, 312, 236, 260, "Position", data.roleTitle || "Not specified", reportColors.ink);

  drawKitCard(doc, 40, 326, 532, 80);
  doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Decision rationale", 58, 348);
  doc.font(fonts.regular).fontSize(10.5).fillColor(reportColors.muted).text(decisionSummary(data, score), 58, 372, { width: 484, lineGap: 4 });

  drawKitCard(doc, 40, 428, 342, 214);
  doc.font(fonts.bold).fontSize(14).fillColor(reportColors.ink).text("Section performance", 58, 450);
  rows.forEach((row, index) => drawKitBar(doc, fonts, 58, 480 + index * 21, row.label, row.value, 146));

  drawKitCard(doc, 402, 428, 170, 214);
  doc.font(fonts.bold).fontSize(14).fillColor(reportColors.ink).text("Evidence", 420, 450);
  drawKitEvidence(
    doc,
    fonts,
    420,
    478,
    visibleCounts ? `Visible tests: ${visibleCounts.pass}/${visibleCounts.total} passed` : "Visible tests collected",
    Boolean(visibleCounts && visibleCounts.fail === 0)
  );
  drawKitEvidence(
    doc,
    fonts,
    420,
    518,
    hiddenCounts ? `Hidden evals: ${hiddenCounts.pass}/${hiddenCounts.total} passed` : "Hidden evals collected",
    Boolean(hiddenCounts && hiddenCounts.fail === 0)
  );
  drawKitEvidence(
    doc,
    fonts,
    420,
    558,
    commitEvalOk ? "Commit checkpoint eval captured" : "No commit checkpoint eval",
    commitEvalOk
  );
  drawKitEvidence(
    doc,
    fonts,
    420,
    598,
    promptQuality.score === null ? "Prompt quality unavailable" : `Prompt quality: ${promptQuality.score}/5`,
    promptQuality.score !== null && promptQuality.score >= 3
  );
  drawKitEvidence(
    doc,
    fonts,
    420,
    638,
    interviewerFeedback ? "Human interviewer feedback captured" : diffOk ? "Candidate code diff captured" : "No candidate code diff",
    Boolean(interviewerFeedback || diffOk)
  );

  drawKitCard(doc, 40, 666, 532, 54);
  doc.font(fonts.bold).fontSize(8).fillColor(reportColors.muted).text("ASSESSMENT", 58, 684, { characterSpacing: 0.8 });
  doc.font(fonts.regular).fontSize(9).fillColor(reportColors.ink).text(cleanAssessmentTitle(data.assessmentTitle), 150, 684, { width: 222 });
  doc.font(fonts.bold).fontSize(8).fillColor(reportColors.muted).text("SUBMITTED", 390, 684, { width: 76, characterSpacing: 0.8 });
  doc.font(fonts.regular).fontSize(8.5).fillColor(reportColors.ink).text(formatDate(data.submittedAt), 474, 684, { width: 82, lineGap: 1 });
  addFooter(doc, fonts, 1);

  doc.addPage({ size: "LETTER", margin: 0 });
  drawKitHeader(doc, fonts, "Detailed Performance By Section");
  let y = 98;
  rows.forEach((row) => {
    const band = scoreBand(row.value);
    const color = metricColor(row.value);
    drawKitCard(doc, 40, y, 532, 70, "#ffffff");
    doc.font(fonts.bold).fontSize(12).fillColor(reportColors.ink).text(row.label, 58, y + 18, { width: 220 });
    doc.rect(314, y + 17, 82, 22).fill(color);
    doc.font(fonts.bold).fontSize(9).fillColor("#ffffff").text(band, 324, y + 23, { width: 62, align: "center" });
    doc.font(fonts.bold).fontSize(14).fillColor(color).text(`${row.value}/5`, 416, y + 20, { width: 38, align: "right" });
    doc.font(fonts.regular).fontSize(9).fillColor(reportColors.muted).text(sectionNarrative(row.label, row.value), 58, y + 42, { width: 470, lineGap: 2 });
    y += 82;
  });
  addFooter(doc, fonts, 2);

  doc.addPage({ size: "LETTER", margin: 0 });
  drawKitHeader(doc, fonts, "GPT-5.5 Evaluation Review");
  drawKitCard(doc, 40, 96, 532, 118);
  doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Evaluator", 58, 120);
  doc.font(fonts.regular).fontSize(10).fillColor(reportColors.muted).text(
    `${gptEvaluator.source === "gpt-5.5" ? "GPT-5.5 assistant evidence review" : "Deterministic fallback evaluator"}${
      gptEvaluator.model ? ` | Model: ${gptEvaluator.model}` : ""
    }${gptEvaluator.recommendation ? ` | Recommendation: ${gptEvaluator.recommendation.replaceAll("_", " ")}` : ""}`,
    58,
    146,
    { width: 486, lineGap: 4 }
  );
  doc.font(fonts.regular).fontSize(9).fillColor(reportColors.muted).text(
    interviewerFeedback
      ? `Human interviewer feedback is the primary signal for this live guided round. GPT-5.5 is used for summarization and consistency checks only. ${
          gptEvaluator.maxScore ? `Hard evidence cap: ${gptEvaluator.maxScore}/100.` : ""
        }`
      : gptEvaluator.maxScore
        ? `Hard evidence cap: ${gptEvaluator.maxScore}/100. ${gptEvaluator.bindingReasons.join(" ") || gptEvaluator.capReasons.join(" ")}`
        : "No hard evidence cap was applied.",
    58,
    176,
    { width: 486, lineGap: 3 }
  );

  drawKitCard(doc, 40, 236, 258, 196);
  doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Strengths", 58, 260);
  doc.font(fonts.regular).fontSize(9.5).fillColor(reportColors.muted).text(
    gptEvaluator.strengths.length ? gptEvaluator.strengths.map((item) => `- ${item}`).join("\n") : "No strong evidence was called out by the evaluator.",
    58,
    288,
    { width: 220, height: 118, lineGap: 4 }
  );

  drawKitCard(doc, 314, 236, 258, 196);
  doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Concerns", 332, 260);
  doc.font(fonts.regular).fontSize(9.5).fillColor(reportColors.muted).text(
    gptEvaluator.concerns.length ? gptEvaluator.concerns.map((item) => `- ${item}`).join("\n") : "No major evaluator concerns were recorded.",
    332,
    288,
    { width: 220, height: 118, lineGap: 4 }
  );

  drawKitCard(doc, 40, 456, 532, 164);
  doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Evidence citations", 58, 480);
  doc.font(fonts.regular).fontSize(9.5).fillColor(reportColors.muted).text(
    gptEvaluator.evidenceCitations.length
      ? gptEvaluator.evidenceCitations.map((item) => `- ${item}`).join("\n")
      : "The evaluator did not return explicit citations; review the appendix evidence below.",
    58,
    508,
    { width: 486, height: 82, lineGap: 4 }
  );
  addFooter(doc, fonts, 3);

  doc.addPage({ size: "LETTER", margin: 0 });
  drawKitHeader(doc, fonts, "Reviewer Summary And Timeline");
  drawKitCard(doc, 40, 96, 532, 92);
  doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Candidate profile", 58, 120);
  const profileRows = [
    ["Name", data.candidateName],
    ["Email", data.candidateEmail],
    ["Position", data.roleTitle || "Not specified"],
    ["Assessment", cleanAssessmentTitle(data.assessmentTitle)]
  ];
  profileRows.forEach(([label, value], index) => {
    const col = index % 2;
    const row = Math.floor(index / 2);
    const x = 58 + col * 252;
    const yProfile = 146 + row * 20;
    doc.font(fonts.bold).fontSize(7.5).fillColor(reportColors.muted).text(label.toUpperCase(), x, yProfile, { width: 70, characterSpacing: 0.7 });
    const displayValue = label === "Email" ? compactMiddle(value, 38) : value;
    doc.font(fonts.regular).fontSize(8.5).fillColor(reportColors.ink).text(displayValue, x + 74, yProfile, { width: 164, lineGap: 1 });
  });

  drawKitCard(doc, 40, 212, 532, 104);
  doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Candidate notes", 58, 236);
  doc.font(fonts.regular).fontSize(10).fillColor(reportColors.muted).text(data.finalNotes || "No final notes submitted.", 58, 262, {
    width: 486,
    lineGap: 4
  });

  drawKitCard(doc, 40, 340, 532, 112);
  doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Automated evaluation", 58, 364);
  doc.font(fonts.regular).fontSize(10).fillColor(reportColors.muted).text(latestEval?.summary ?? data.scorecard?.automatedSummary ?? "No eval summary recorded.", 58, 390, {
    width: 486,
    lineGap: 4
  });
  doc.font(fonts.regular).fontSize(8).fillColor(reportColors.muted).text(`Visible tests: ${JSON.stringify(latestEval?.visibleTests ?? {})}`, 58, 434);
  doc.font(fonts.regular).fontSize(8).fillColor(reportColors.muted).text(`Hidden tests: ${JSON.stringify(latestEval?.hiddenTests ?? {})}`, 302, 434);

  drawKitCard(doc, 40, 476, 532, 104);
  doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Prompt quality", 58, 500);
  doc.font(fonts.regular).fontSize(10).fillColor(reportColors.muted).text(promptQuality.summary || "No prompt quality evidence was captured.", 58, 526, {
    width: 486,
    lineGap: 4
  });
  doc.font(fonts.regular).fontSize(8).fillColor(reportColors.muted).text(
    `Score: ${promptQuality.score === null ? "Pending" : `${promptQuality.score}/5`} | Captured prompt markers: ${
      promptQuality.promptCount ?? 0
    } | Strengths: ${promptQuality.strengths.join(", ") || "none captured"} | Concerns: ${promptQuality.concerns.join(", ") || "none"}`,
    58,
    562,
    { width: 486, lineGap: 2 }
  );

  drawKitCard(doc, 40, 604, 532, 116);
  doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Assessment timeline", 58, 628);
  const timeline = [
    ["Started", formatDate(data.startedAt)],
    ["Submitted", formatDate(data.submittedAt)],
    ["Evaluation", latestEval ? `${latestEval.status} | ${formatDate(latestEval.createdAt)}` : "Pending"],
    ["Report", "Generated for reviewer email"]
  ];
  timeline.forEach(([label, value], index) => {
    const x = 58 + index * 126;
    doc.rect(x, 660, 12, 12).fill(reportColors.ink);
    if (index < timeline.length - 1) doc.moveTo(x + 20, 666).lineTo(x + 102, 666).strokeColor(reportColors.line).lineWidth(2).stroke();
    doc.font(fonts.bold).fontSize(9).fillColor(reportColors.ink).text(label, x, 688, { width: 100 });
    doc.font(fonts.regular).fontSize(8).fillColor(reportColors.muted).text(value, x, 706, { width: 100, lineGap: 2 });
  });
  addFooter(doc, fonts, 4);

  let nextPage = 5;
  if (proctoringEvents.length > 0) {
    doc.addPage({ size: "LETTER", margin: 0 });
    drawKitHeader(doc, fonts, "Proctoring Events");
    drawKitCard(doc, 40, 96, 532, 168);
    doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Proctoring events", 58, 120);
    doc.font(fonts.regular).fontSize(9).fillColor(recordingCount > 0 ? reportColors.green : reportColors.red).text(
      recordingCount > 0 ? `${recordingCount} recording artifact(s) captured.` : "No camera or screen recording artifact was attached to this report.",
      58,
      144,
      { width: 486 }
    );
    proctoringEvents.slice(0, 4).forEach((event, index) => {
      const metadata = event.metadata ? ` ${JSON.stringify(event.metadata)}` : "";
      doc.font(fonts.regular).fontSize(8).fillColor(reportColors.muted).text(`${formatDate(event.createdAt)} | ${event.type}${metadata}`, 58, 174 + index * 18, {
        width: 486
      });
    });
    addFooter(doc, fonts, nextPage);
    nextPage += 1;
  }

  if (liveInterview.enabled) {
    doc.addPage({ size: "LETTER", margin: 0 });
    drawKitHeader(doc, fonts, "Live Interview Signal");
    drawKitCard(doc, 40, 96, 532, 116);
    doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Transcript-based communication score", 58, 120);
    doc.font(fonts.regular).fontSize(10).fillColor(reportColors.muted).text(liveInterview.summary || "Live interview transcript captured.", 58, 146, {
      width: 486,
      lineGap: 4
    });
    doc.font(fonts.regular).fontSize(8).fillColor(reportColors.muted).text(
      `Score: ${liveInterview.score === null ? "Pending" : `${liveInterview.score}/5`} | Events: ${
        liveInterview.eventCount
      } | Strengths: ${liveInterview.strengths.join(", ") || "none captured"} | Concerns: ${liveInterview.concerns.join(", ") || "none"}`,
      58,
      186,
      { width: 486, lineGap: 2 }
    );
    drawKitCard(doc, 40, 238, 532, 360);
    doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Transcript excerpt", 58, 262);
    doc.font(fonts.regular).fontSize(8.5).fillColor(reportColors.ink).text(liveInterview.transcript || "No transcript text available.", 58, 292, {
      width: 486,
      height: 276,
      lineGap: 3
    });
    addFooter(doc, fonts, nextPage);
    nextPage += 1;
  }

  if (interviewerFeedback) {
    doc.addPage({ size: "LETTER", margin: 0 });
    drawKitHeader(doc, fonts, "Human Interviewer Feedback");
    drawKitCard(doc, 40, 96, 532, 102);
    doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Final human signal", 58, 120);
    doc.font(fonts.regular).fontSize(10).fillColor(reportColors.muted).text(
      `${interviewerFeedback.interviewerName} submitted this feedback on ${formatDate(new Date(interviewerFeedback.createdAt))}. Recommendation: ${interviewerFeedback.recommendation}.`,
      58,
      146,
      { width: 486, lineGap: 4 }
    );
    doc.font(fonts.regular).fontSize(8.5).fillColor(reportColors.muted).text(
      `Technical depth: ${interviewerFeedback.technicalDepth ?? "n/a"}/5 | Product judgment: ${
        interviewerFeedback.productJudgment ?? "n/a"
      }/5 | Communication: ${interviewerFeedback.communication ?? "n/a"}/5 | AI collaboration: ${interviewerFeedback.aiCollaboration ?? "n/a"}/5`,
      58,
      178,
      { width: 486 }
    );

    drawKitCard(doc, 40, 222, 532, 126);
    doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Overall feedback", 58, 246);
    doc.font(fonts.regular).fontSize(10).fillColor(reportColors.muted).text(interviewerFeedback.summary, 58, 274, {
      width: 486,
      height: 52,
      lineGap: 4
    });

    drawKitCard(doc, 40, 374, 258, 160);
    doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Strengths", 58, 398);
    doc.font(fonts.regular).fontSize(9.5).fillColor(reportColors.muted).text(interviewerFeedback.strengths || "No strengths recorded.", 58, 426, {
      width: 220,
      height: 76,
      lineGap: 4
    });

    drawKitCard(doc, 314, 374, 258, 160);
    doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Concerns", 332, 398);
    doc.font(fonts.regular).fontSize(9.5).fillColor(reportColors.muted).text(interviewerFeedback.concerns || "No concerns recorded.", 332, 426, {
      width: 220,
      height: 76,
      lineGap: 4
    });

    drawKitCard(doc, 40, 560, 532, 104);
    doc.font(fonts.bold).fontSize(13).fillColor(reportColors.ink).text("Follow-ups", 58, 584);
    doc.font(fonts.regular).fontSize(10).fillColor(reportColors.muted).text(interviewerFeedback.followUps || "No follow-ups recorded.", 58, 612, {
      width: 486,
      lineGap: 4
    });
    addFooter(doc, fonts, nextPage);
    nextPage += 1;
  }

  doc.addPage({ size: "LETTER", margin: 0 });
  drawKitHeader(doc, fonts, "Evidence Appendix");
  let appendixY = 96;
  const latestByLabel = Array.from(
    data.artifacts
      .reduce((map, artifact) => {
        if (!map.has(artifact.label)) map.set(artifact.label, artifact);
        return map;
      }, new Map<string, ReportArtifact>())
      .values()
  ).filter(includeArtifactInAppendix);
  let page = nextPage;
  for (const artifact of latestByLabel) {
    if (appendixY > 650) {
      addFooter(doc, fonts, page);
      page += 1;
      doc.addPage({ size: "LETTER", margin: 0 });
      drawKitHeader(doc, fonts, "Evidence Appendix");
      appendixY = 96;
    }
    doc.font(fonts.bold).fontSize(12).fillColor(reportColors.ink).text(artifact.label, 40, appendixY);
    doc.font(fonts.regular).fontSize(8).fillColor(reportColors.muted).text(`${artifact.kind} | ${artifact.uri}`, 40, appendixY + 16);
    const excerpt = metadataOutput(artifact.metadata, 1800) || `${artifact.kind} collected at ${formatDate(artifact.createdAt)}`;
    doc.font(fonts.regular).fontSize(7.5).fillColor(reportColors.ink).text(excerpt, 40, appendixY + 34, {
      width: 532,
      height: 112,
      lineGap: 2
    });
    appendixY += 164;
  }
  addFooter(doc, fonts, page);

  doc.end();
  return done;
}

export async function buildCandidateReportPdf(attemptId: string) {
  const attempt = await db.attempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: {
      candidate: true,
      template: true,
      scorecard: true,
      evalRuns: { orderBy: { createdAt: "desc" }, take: 3 },
      artifacts: { orderBy: { createdAt: "desc" } },
      events: { orderBy: { createdAt: "desc" }, take: 50 }
    }
  });

  // For artifacts whose text payload lives in R2 (post PR #88/#90),
  // pull the body back into metadata.stdout in parallel so the PDF
  // builder's existing metadataOutput/metadataRawOutput helpers see
  // the same shape they always did. No-op for legacy inline://
  // artifacts.
  await rehydrateArtifactTexts(attempt.artifacts);

  return buildPdfKitReport({
      candidateName: attempt.candidate.name,
      candidateEmail: attempt.candidate.email,
      roleTitle: attempt.template.roleTitle,
      level: attempt.template.level,
      assessmentTitle: attempt.template.title,
      status: attempt.status,
      startedAt: attempt.startedAt,
      submittedAt: attempt.submittedAt,
      dueAt: attempt.dueAt,
      finalNotes: attempt.finalNotes,
      scorecard: attempt.scorecard,
      evalRuns: attempt.evalRuns,
      artifacts: attempt.artifacts,
      eventLogs: attempt.events
    });
}

export async function sendCandidateReportEmail(attemptId: string) {
  const attempt = await db.attempt.findUniqueOrThrow({
    where: { id: attemptId },
    include: {
      candidate: true,
      template: true,
      scorecard: true,
      artifacts: {
        where: {
          OR: [
            { kind: "reviewer_export", label: reportArtifactLabel },
            { kind: "proctoring_recording" }
          ]
        },
        orderBy: { createdAt: "asc" }
      }
    }
  });

  const score = numericScore(attempt.scorecard);
  const latestReportArtifact = [...attempt.artifacts]
    .reverse()
    .find((artifact) => artifact.kind === "reviewer_export" && artifact.label === reportArtifactLabel);
  const latestReportMetadata =
    latestReportArtifact?.metadata && typeof latestReportArtifact.metadata === "object"
      ? (latestReportArtifact.metadata as { score?: unknown; reportVersion?: unknown })
      : null;
  if (latestReportMetadata?.score === score && latestReportMetadata.reportVersion === reportVersion) {
    return { skipped: "already-sent" };
  }

  const pdf = await buildCandidateReportPdf(attemptId);
  const filename = `${attempt.candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "candidate"}-report.pdf`;
  const recordingArtifacts = attempt.artifacts.filter((artifact) => artifact.kind === "proctoring_recording");
  const recordingAttachments = (
    await Promise.all(recordingArtifacts.map((artifact) => loadRecordingAttachment(artifact)))
  ).filter((attachment): attachment is NonNullable<typeof attachment> => Boolean(attachment));
  const attachments: Array<{ filename: string; content: Buffer; contentType?: string }> = [{ filename, content: pdf }];
  let totalBytes = pdf.byteLength;
  const skippedRecordings: string[] = [];

  for (const recording of recordingAttachments) {
    if (totalBytes + recording.bytes > env.REPORT_EMAIL_MAX_ATTACHMENT_BYTES) {
      skippedRecordings.push(`${recording.filename} (${Math.round(recording.bytes / 1024 / 1024)} MB)`);
      continue;
    }

    attachments.push({
      filename: recording.filename,
      content: recording.content,
      contentType: recording.contentType
    });
    totalBytes += recording.bytes;
  }

  const attachedRecordingCount = attachments.length - 1;
  const recordingText =
    recordingAttachments.length > 0
      ? attachedRecordingCount > 0
        ? ` ${attachedRecordingCount} proctoring recording(s) are attached.`
        : " Proctoring recording artifacts were captured but exceed the email attachment limit."
      : " No proctoring recording artifact was uploaded before evaluation.";
  const skippedText =
    skippedRecordings.length > 0
      ? ` Some recordings exceeded the email attachment limit and remain stored as artifacts: ${skippedRecordings.join(", ")}.`
      : "";
  const rec = recommendation(score);
  const reportUrl = `${env.NEXT_PUBLIC_APP_URL}/admin/attempts/${attemptId}`;
  const candidateName = escapeHtml(attempt.candidate.name);
  const assessmentTitle = escapeHtml(cleanAssessmentTitle(attempt.template.title));
  const attachedRecordings = String(attachedRecordingCount);
  const text = [
    `Proofwork report ready: ${attempt.candidate.name}`,
    "",
    `Candidate: ${attempt.candidate.name} <${attempt.candidate.email}>`,
    `Position: ${attempt.template.roleTitle || "Not specified"}`,
    `Assessment: ${cleanAssessmentTitle(attempt.template.title)}`,
    `Recommendation: ${rec.label}`,
    `Score: ${score === null ? "Pending" : `${score}/100`}`,
    "",
    `The PDF report is attached.${recordingText}${skippedText}`,
    `Open reviewer view: ${reportUrl}`
  ].join("\n");
  const html = emailShell({
    preheader: `${attempt.candidate.name}'s assessment report is ready: ${rec.label}.`,
    eyebrow: "Proofwork report",
    title: `${attempt.candidate.name}'s report is ready.`,
    intro: `The evidence package for <strong style="color:#1a1a1a;">${candidateName}</strong>'s <strong style="color:#1a1a1a;">${assessmentTitle}</strong> attempt is attached as a PDF.`,
    body: `
      ${metadataTable([
        ["Candidate", `${attempt.candidate.name} <${attempt.candidate.email}>`],
        ["Position", attempt.template.roleTitle || "Not specified"],
        ["Assessment", cleanAssessmentTitle(attempt.template.title)],
        ["Recommendation", rec.label],
        ["Score", score === null ? "Pending" : `${score}/100`],
        ["Recordings", attachedRecordings]
      ])}
      ${callout(
        `${escapeHtml(rec.reason)} ${escapeHtml(recordingText.trim())}${skippedText ? ` ${escapeHtml(skippedText.trim())}` : ""}`
      )}
      <div style="margin-top:28px;">${ctaButton("Open reviewer view", reportUrl)}</div>
      <p style="margin:22px 0 0;font-size:12px;line-height:1.55;color:#555555;">The attached PDF includes the candidate profile, section-level scores, timeline, eval results, artifacts, and reviewer-ready decision rationale.</p>
    `,
    footerNote: "Reviewer reports are generated automatically when an assessment is submitted or times out."
  });

  if (!env.RESEND_API_KEY) {
    await logAttemptEvent(attemptId, "report.email_dry_run", `Candidate PDF report dry-run for ${env.CANDIDATE_REPORT_EMAIL_TO}`);
    return { skipped: "missing-resend-key", filename };
  }

  const resend = new Resend(env.RESEND_API_KEY);
  const result = await resend.emails.send({
    from: env.INVITE_EMAIL_FROM,
    to: env.CANDIDATE_REPORT_EMAIL_TO,
    subject: `Proofwork report ready: ${attempt.candidate.name}`,
    text,
    html,
    attachments
  });

  if ("error" in result && result.error) {
    throw new Error(result.error.message);
  }

  await db.artifact.create({
    data: {
      attemptId,
      kind: "reviewer_export",
      label: reportArtifactLabel,
      uri: `email://${env.CANDIDATE_REPORT_EMAIL_TO}/${filename}`,
      metadata: {
        filename,
        recipient: env.CANDIDATE_REPORT_EMAIL_TO,
        score,
        reportVersion,
        resendId: "data" in result ? result.data?.id : undefined,
        attachedRecordings: attachments.length - 1,
        skippedRecordings
      }
    }
  });
  await logAttemptEvent(attemptId, "report.emailed", `Candidate PDF report emailed to ${env.CANDIDATE_REPORT_EMAIL_TO}`);

  return result;
}
