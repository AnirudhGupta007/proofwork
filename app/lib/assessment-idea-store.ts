import type { Prisma } from "@prisma/client";
import type { AssessmentGenerationInput, AssessmentIdea } from "@/app/lib/assessment-generator";
import { db } from "@/app/lib/db";

export type SavedAssessmentIdeaView = AssessmentIdea & {
  savedIdeaId: string;
  source?: string;
  repoSource?: string;
  repoUrl?: string | null;
  createdAt?: string;
};

type GeneratedIdeasPayload = {
  source: "llm" | "fallback";
  reason?: string;
  assessmentPrompt?: string;
  ideas: AssessmentIdea[];
};

export function toSavedAssessmentIdeaView(idea: {
  id: string;
  ideaKey: string;
  title: string;
  summary: string;
  durationMin: number;
  evaluationFocus: Prisma.JsonValue;
  deliverables: Prisma.JsonValue;
  repoSource?: string | null;
  repoUrl?: string | null;
  source: string;
  createdAt: Date;
}): SavedAssessmentIdeaView {
  return {
    savedIdeaId: idea.id,
    id: idea.ideaKey,
    title: idea.title,
    summary: idea.summary,
    durationMin: idea.durationMin,
    evaluationFocus: Array.isArray(idea.evaluationFocus) ? idea.evaluationFocus.map(String) : [],
    deliverables: Array.isArray(idea.deliverables) ? idea.deliverables.map(String) : [],
    repoSource: idea.repoSource ?? inferRepoSourceFromIdea(idea.summary),
    repoUrl: idea.repoUrl,
    source: idea.source,
    createdAt: idea.createdAt.toISOString()
  };
}

function inferRepoSourceFromIdea(summary: string) {
  const normalized = summary.toLowerCase();
  if (normalized.includes("linked repo") || normalized.includes("existing repo") || normalized.includes("existing codebase")) return "github";
  return "generated";
}

export async function saveGeneratedAssessmentIdeas({
  organizationId,
  input,
  generated
}: {
  organizationId: string;
  input: AssessmentGenerationInput;
  generated: GeneratedIdeasPayload;
}) {
  if (generated.ideas.length === 0) return [];

  const saved = await db.$transaction(
    generated.ideas.map((idea) =>
      db.savedAssessmentIdea.create({
        data: {
          organizationId,
          ideaKey: idea.id,
          title: idea.title,
          summary: idea.summary,
          durationMin: idea.durationMin,
          evaluationFocus: idea.evaluationFocus as Prisma.InputJsonValue,
          deliverables: idea.deliverables as Prisma.InputJsonValue,
          roleTitle: input.roleTitle,
          level: input.level,
          jobDescription: input.jobDescription,
          assessmentPrompt: generated.assessmentPrompt ?? input.assessmentPrompt,
          assessmentMode: input.assessmentMode ?? "solo",
          repoSource: input.repoSource ?? "generated",
          repoUrl: input.repoUrl,
          projectBrief: input.projectBrief,
          existingProjectBrief: input.existingProjectBrief,
          source: generated.source,
          sourceReason: generated.reason
        }
      })
    )
  );

  return saved.map(toSavedAssessmentIdeaView);
}
