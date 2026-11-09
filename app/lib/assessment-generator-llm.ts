import { z } from "zod";
import { generateAssessmentIdeasFromJd, type AssessmentGenerationInput, type AssessmentIdea } from "@/app/lib/assessment-generator";
import { env } from "@/app/lib/env";

const llmIdeaSchema = z.object({
  id: z.string().min(2),
  title: z.string().min(4),
  summary: z.string().min(20),
  durationMin: z.number().int().min(45).max(360),
  evaluationFocus: z.array(z.string().min(2)).min(3).max(8),
  deliverables: z.array(z.string().min(2)).min(4).max(10)
});

const llmIdeasResponseSchema = z.object({
  source: z.literal("llm"),
  assessmentPrompt: z.string().min(20),
  ideas: z.array(llmIdeaSchema).min(3).max(5)
});

const assessmentIdeasJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["source", "assessmentPrompt", "ideas"],
  properties: {
    source: { type: "string", enum: ["llm"] },
    assessmentPrompt: { type: "string" },
    ideas: {
      type: "array",
      minItems: 3,
      maxItems: 5,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "title", "summary", "durationMin", "evaluationFocus", "deliverables"],
        properties: {
          id: { type: "string" },
          title: { type: "string" },
          summary: { type: "string" },
          durationMin: { type: "integer" },
          evaluationFocus: { type: "array", minItems: 3, maxItems: 8, items: { type: "string" } },
          deliverables: { type: "array", minItems: 4, maxItems: 10, items: { type: "string" } }
        }
      }
    }
  }
} as const;

function fallback(input: AssessmentGenerationInput, reason?: string) {
  const ideas = generateAssessmentIdeasFromJd(input);
  return {
    source: "fallback" as const,
    reason,
    assessmentPrompt: input.assessmentPrompt ?? "",
    ideas
  };
}

function slug(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 52);
}

const durationPresets = [75, 90, 120, 150] as const;

function closestDurationPreset(durationMin: number) {
  return durationPresets.reduce((closest, option) =>
    Math.abs(option - durationMin) < Math.abs(closest - durationMin) ? option : closest
  );
}

function extractResponseText(response: unknown) {
  if (!response || typeof response !== "object") return "";
  const record = response as { output_text?: unknown; output?: unknown };
  if (typeof record.output_text === "string") return record.output_text;

  if (Array.isArray(record.output)) {
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

  return "";
}

function normalizeIdeas(ideas: AssessmentIdea[]) {
  return ideas.map((idea, index) => ({
    ...idea,
    id: slug(idea.id || idea.title) || `llm-idea-${index + 1}`,
    durationMin: closestDurationPreset(Math.round(idea.durationMin))
  }));
}

export async function generateAssessmentIdeas(input: AssessmentGenerationInput) {
  if (!env.OPENAI_API_KEY) return fallback(input, "OPENAI_API_KEY is not configured.");

  const heuristic = generateAssessmentIdeasFromJd(input);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.ASSESSMENT_GENERATOR_MODEL,
      input: [
        {
          role: "system",
          content: [
            "You design evidence-rich hiring assessments for Proofwork.",
            "Generate bespoke assessments from the JD, not generic coding challenges.",
            "The best assessments simulate the actual job: product judgment, user discovery, agent orchestration, implementation, evals, shipping, communication, and tradeoffs.",
            "Each idea must tell the candidate what concrete product, workflow, repo behavior, or work artifact they are building. Avoid summaries that only describe assessment goals.",
            "Respect the selected project mode. The ideas must look meaningfully different across modes.",
            "If projectMode is new_generated_project: every idea must be a greenfield product/workflow build. Mention the generated starter repo, sample data, UI/API/product surface, and evals. Do not ask the candidate to inspect an existing repo or fix repo-specific bugs.",
            "If projectMode is existing_github_repo: every idea must be an existing-codebase task. Mention the linked repo/codebase, repo navigation, scoped integration, preserving existing architecture, and repo-specific tests/evals. Do not propose a blank-slate app or generic new product build.",
            "Deliverables must be candidate-actionable, for example: 'feedback triage panel with source snippets', 'PLAN.md with rejected scope', or 'eval catching shallow summaries'.",
            "Use one of these durations only: 75, 90, 120, or 150 minutes. Prefer 120 minutes for most solo work and 150 only for deeper senior/codebase work.",
            "Avoid DSA, trivia, generic bug-fix tasks, and vague take-home projects.",
            "Return strict JSON only."
          ].join("\n")
        },
        {
          role: "user",
          content: JSON.stringify(
            {
              roleTitle: input.roleTitle,
              level: input.level,
              durationMin: input.durationMin,
              assessmentMode: input.assessmentMode ?? "solo",
              projectMode: input.repoSource === "github" ? "existing_github_repo" : "new_generated_project",
              projectModeRules:
                input.repoSource === "github"
                  ? [
                      "Generate existing-repo assessment ideas only.",
                      "Candidate must clone/navigate the linked codebase and make a scoped repo-native change.",
                      "Deliverables should include repo map, integration notes, tests/evals in existing style, and verification commands."
                    ]
                  : [
                      "Generate new-project assessment ideas only.",
                      "Candidate receives a generated starter repo and builds a new product/workflow from the brief.",
                      "Deliverables should include product shape, UI/API behavior, sample data use, tests/evals, and launch notes."
                    ],
              repoUrl: input.repoUrl,
              newProjectBrief: input.projectBrief,
              existingProjectBrief: input.existingProjectBrief,
              employerFocus: input.assessmentPrompt,
              jobDescription: input.jobDescription,
              fallbackIdeasForCalibration: heuristic
            },
            null,
            2
          )
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "proofwork_assessment_ideas",
          description: "Custom assessment ideas generated from a role JD.",
          strict: true,
          schema: assessmentIdeasJsonSchema
        }
      }
    })
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => "");
    return fallback(input, `LLM generator failed: ${response.status} ${errorText.slice(0, 240)}`);
  }

  const raw = await response.json();
  const text = extractResponseText(raw);
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return fallback(input, "LLM generator returned non-JSON output.");
  }
  const parsed = llmIdeasResponseSchema.safeParse(json);
  if (!parsed.success) return fallback(input, "LLM generator returned invalid assessment JSON.");

  return {
    source: "llm" as const,
    assessmentPrompt: parsed.data.assessmentPrompt,
    ideas: normalizeIdeas(parsed.data.ideas)
  };
}
