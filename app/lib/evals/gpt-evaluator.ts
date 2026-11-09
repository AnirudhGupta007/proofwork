import { z } from "zod";
import { aggregateScore, normalizeScores, type ScoreDimensions } from "@/app/lib/domain/score";
import { applyScoreCaps } from "@/app/lib/evals/scorer";
import { env } from "@/app/lib/env";

type EvidenceArtifact = {
  kind: string;
  label: string;
  uri?: string;
  metadata?: unknown;
};

type EvaluationInput = {
  attemptId: string;
  candidate?: { name?: string | null; email?: string | null };
  assessment: {
    title: string;
    roleTitle?: string | null;
    level: string;
    taskBrief?: string | null;
    instructions?: string | null;
    evaluationPlan?: unknown;
  };
  artifacts: EvidenceArtifact[];
  events: Array<{ type: string; message: string; metadata?: unknown; createdAt?: Date | string }>;
  signals: Parameters<typeof applyScoreCaps>[1];
  heuristicScores: ScoreDimensions;
};

const evaluatorSchema = z.object({
  scores: z.object({
    requirements: z.number().int().min(0).max(5),
    testAndEvalQuality: z.number().int().min(0).max(5),
    debuggingDiscipline: z.number().int().min(0).max(5),
    codeQuality: z.number().int().min(0).max(5),
    aiCollaboration: z.number().int().min(0).max(5),
    productionReadiness: z.number().int().min(0).max(5),
    communication: z.number().int().min(0).max(5)
  }),
  summary: z.string().min(40).max(1400),
  decisionRationale: z.string().min(40).max(1400),
  strengths: z.array(z.string()).max(8).default([]),
  concerns: z.array(z.string()).max(8).default([]),
  evidenceCitations: z.array(z.string()).max(10).default([]),
  recommendation: z.enum(["hire", "lean_hire", "lean_no_hire", "no_hire"])
});

const evaluatorJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["scores", "summary", "decisionRationale", "strengths", "concerns", "evidenceCitations", "recommendation"],
  properties: {
    scores: {
      type: "object",
      additionalProperties: false,
      required: [
        "requirements",
        "testAndEvalQuality",
        "debuggingDiscipline",
        "codeQuality",
        "aiCollaboration",
        "productionReadiness",
        "communication"
      ],
      properties: {
        requirements: { type: "integer", minimum: 0, maximum: 5 },
        testAndEvalQuality: { type: "integer", minimum: 0, maximum: 5 },
        debuggingDiscipline: { type: "integer", minimum: 0, maximum: 5 },
        codeQuality: { type: "integer", minimum: 0, maximum: 5 },
        aiCollaboration: { type: "integer", minimum: 0, maximum: 5 },
        productionReadiness: { type: "integer", minimum: 0, maximum: 5 },
        communication: { type: "integer", minimum: 0, maximum: 5 }
      }
    },
    summary: { type: "string" },
    decisionRationale: { type: "string" },
    strengths: { type: "array", items: { type: "string" } },
    concerns: { type: "array", items: { type: "string" } },
    evidenceCitations: { type: "array", items: { type: "string" } },
    recommendation: { type: "string", enum: ["hire", "lean_hire", "lean_no_hire", "no_hire"] }
  }
} as const;

function artifactOutput(artifact: EvidenceArtifact) {
  if (!artifact.metadata || typeof artifact.metadata !== "object") return "";
  const record = artifact.metadata as { stdout?: unknown; stderr?: unknown; content?: unknown; exitCode?: unknown };
  return String(record.stdout ?? record.stderr ?? record.content ?? "");
}

function redact(value: string) {
  return value
    .replace(/sk-(?:proj-)?[A-Za-z0-9_-]{12,}/g, "[REDACTED_API_KEY]")
    .replace(/dtn_[A-Za-z0-9_-]{12,}/g, "[REDACTED_DAYTONA_KEY]")
    .replace(/re_[A-Za-z0-9_-]{12,}/g, "[REDACTED_RESEND_KEY]")
    .replace(/pk_(?:test|live)_[A-Za-z0-9_-]{12,}/g, "[REDACTED_PUBLIC_KEY]");
}

function compact(value: string, max = 2400) {
  const clean = redact(value).replace(/\0/g, "").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, Math.floor(max * 0.7))}\n...[truncated]...\n${clean.slice(-Math.floor(max * 0.3))}`;
}

function evidenceBundle(artifacts: EvidenceArtifact[]) {
  const priority = [
    "Git diff",
    "Commit history",
    "Commit checkpoint evals",
    "Plan evidence",
    "Visible test output",
    "Hidden test output",
    "OpenCode log",
    "Prompt quality analysis",
    "Live interview transcript",
    "Final notes file",
    "File tree"
  ];
  const selected = [
    ...priority
      .map((label) => artifacts.find((artifact) => artifact.label === label || artifact.label.includes(label)))
      .filter((artifact): artifact is EvidenceArtifact => Boolean(artifact)),
    ...artifacts.filter((artifact) => /diff|test|eval|opencode|prompt|plan|notes|tree|screenshot/i.test(`${artifact.kind} ${artifact.label}`))
  ];
  const unique = Array.from(new Map(selected.map((artifact) => [`${artifact.kind}:${artifact.label}`, artifact])).values()).slice(0, 16);

  return unique.map((artifact) => ({
    kind: artifact.kind,
    label: artifact.label,
    uri: artifact.uri,
    excerpt: compact(artifactOutput(artifact), /opencode|prompt/i.test(artifact.label) ? 3200 : 1800),
    metadata:
      artifact.metadata && typeof artifact.metadata === "object"
        ? {
            exitCode: (artifact.metadata as { exitCode?: unknown }).exitCode,
            qualityScore: (artifact.metadata as { qualityScore?: unknown }).qualityScore,
            promptCount: (artifact.metadata as { promptCount?: unknown }).promptCount
          }
        : undefined
  }));
}

function eventBundle(events: EvaluationInput["events"]) {
  return events
    .filter((event) => event.type.startsWith("interview.") || event.type.startsWith("proctoring."))
    .slice(0, 40)
    .map((event) => ({
      type: event.type,
      message: compact(event.message, event.type === "interview.feedback" ? 1800 : 700),
      createdAt: event.createdAt,
      metadata:
        event.metadata && typeof event.metadata === "object"
          ? {
              speaker: (event.metadata as { speaker?: unknown }).speaker,
              kind: (event.metadata as { kind?: unknown }).kind,
              hireRecommendation: (event.metadata as { hireRecommendation?: unknown }).hireRecommendation,
              technicalDepth: (event.metadata as { technicalDepth?: unknown }).technicalDepth,
              productJudgment: (event.metadata as { productJudgment?: unknown }).productJudgment,
              communication: (event.metadata as { communication?: unknown }).communication,
              aiCollaboration: (event.metadata as { aiCollaboration?: unknown }).aiCollaboration
            }
          : undefined
    }));
}

function extractResponseText(response: unknown) {
  if (!response || typeof response !== "object") return "";
  const record = response as { output_text?: unknown; output?: unknown };
  if (typeof record.output_text === "string") return record.output_text;
  if (!Array.isArray(record.output)) return "";
  return record.output
    .flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const content = (item as { content?: unknown }).content;
      if (!Array.isArray(content)) return [];
      return content.map((part) => {
        if (!part || typeof part !== "object") return "";
        const text = (part as { text?: unknown }).text;
        return typeof text === "string" ? text : "";
      });
    })
    .join("");
}

function fallback(input: EvaluationInput, reason: string) {
  const capped = applyScoreCaps(input.heuristicScores, input.signals);
  return {
    source: "heuristic" as const,
    model: null,
    scores: capped.scores,
    summary: `Heuristic evaluator used because GPT-5.5 evaluation was unavailable: ${reason}`,
    decisionRationale: `Score ${aggregateScore(capped.scores)}/100 is based on deterministic evidence checks and guardrails. ${capped.cap.reasons.join(" ")}`,
    strengths: [],
    concerns: capped.cap.reasons,
    evidenceCitations: [],
    recommendation: aggregateScore(capped.scores) >= 78 ? "hire" : aggregateScore(capped.scores) >= 68 ? "lean_hire" : aggregateScore(capped.scores) >= 60 ? "lean_no_hire" : "no_hire",
    cap: capped.cap
  };
}

export async function evaluateAttemptWithGpt(input: EvaluationInput) {
  if (!env.OPENAI_API_KEY) return fallback(input, "OPENAI_API_KEY is not configured.");

  const heuristicCap = applyScoreCaps(input.heuristicScores, input.signals).cap;
  const requestBody = {
    model: env.EVALUATION_MODEL,
    input: [
      {
        role: "system",
        content: [
          "You are Proofwork's senior hiring evaluator.",
          "Review candidate code/work evidence, prompt logs, test output, eval output, commits, final notes, and proctor/interview signals.",
          "Score harshly and evidence-first. Do not reward plausible-looking code without tests, commits, prompt iteration, or hidden eval success.",
          "A one-shot submission should score poorly for debugging discipline, AI collaboration, production readiness, and communication.",
          "If structured interviewer feedback is present, treat it as the primary human review signal for live guided rounds. Your role is to summarize, calibrate against evidence, and flag contradictions or missing evidence, not to overrule the interviewer.",
          "Use the provided hard evidence cap as an upper bound. Scores may be lower than the cap, never higher.",
          "Return strict JSON only."
        ].join("\n")
      },
      {
        role: "user",
        content: JSON.stringify(
          {
            attemptId: input.attemptId,
            candidate: input.candidate,
            assessment: input.assessment,
            deterministicSignals: input.signals,
            heuristicScores: input.heuristicScores,
            heuristicAggregate: aggregateScore(input.heuristicScores),
            hardEvidenceCap: heuristicCap,
            evidence: evidenceBundle(input.artifacts),
            events: eventBundle(input.events)
          },
          null,
          2
        )
      }
    ],
    text: {
      format: {
        type: "json_schema",
        name: "proofwork_gpt55_evaluation",
        description: "Evidence-based candidate evaluation and scorecard.",
        strict: true,
        schema: evaluatorJsonSchema
      }
    }
  };

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    return fallback(input, `OpenAI evaluator failed: ${response.status} ${text.slice(0, 240)}`);
  }

  const raw = await response.json();
  const text = extractResponseText(raw);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fallback(input, "OpenAI evaluator returned non-JSON output.");
  }

  const parsed = evaluatorSchema.safeParse(json);
  if (!parsed.success) return fallback(input, "OpenAI evaluator returned invalid score JSON.");

  const capped = applyScoreCaps(normalizeScores(parsed.data.scores), input.signals);
  return {
    source: "gpt-5.5" as const,
    model: env.EVALUATION_MODEL,
    ...parsed.data,
    scores: capped.scores,
    summary: `${parsed.data.summary}\n\nGPT-5.5 review: ${parsed.data.decisionRationale}`,
    cap: capped.cap
  };
}
