import { NextResponse } from "next/server";
import { z } from "zod";
import { generateAssessmentIdeas } from "@/app/lib/assessment-generator-llm";
import { saveGeneratedAssessmentIdeas, toSavedAssessmentIdeaView } from "@/app/lib/assessment-idea-store";
import { getAdminContext } from "@/app/lib/admin-context";
import { db } from "@/app/lib/db";

const ideaSchema = z.object({
  roleTitle: z.string().min(2),
  level: z.string().min(2).default("Mid"),
  jobDescription: z.string().min(30),
  durationMin: z.number().int().min(45).max(360).optional(),
  proctoringEnabled: z.boolean().optional(),
  repoSource: z.enum(["generated", "github"]).default("generated"),
  repoUrl: z.string().optional(),
  projectBrief: z.string().optional(),
  existingProjectBrief: z.string().optional(),
  assessmentPrompt: z.string().optional(),
  assessmentMode: z.enum(["solo", "live_guided"]).default("solo")
});

export async function GET() {
  try {
    const { organization } = await getAdminContext();
    const ideas = await db.savedAssessmentIdea.findMany({
      where: { organizationId: organization.id },
      orderBy: { createdAt: "desc" },
      take: 30
    });

    return NextResponse.json({ ideas: ideas.map(toSavedAssessmentIdeaView) });
  } catch (err) {
    console.error("Unable to load saved assessment ideas", err);
    return NextResponse.json({ error: "Unable to load saved assessment ideas. Please refresh and try again." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const { organization } = await getAdminContext();
    const input = ideaSchema.parse(await request.json());
    const generated = await generateAssessmentIdeas(input);
    const savedIdeas = await saveGeneratedAssessmentIdeas({ organizationId: organization.id, input, generated });
    return NextResponse.json({ ...generated, ideas: savedIdeas.length > 0 ? savedIdeas : generated.ideas, savedIdeas });
  } catch (err) {
    if (err instanceof z.ZodError) {
      const message = err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error("Unable to generate assessment ideas", err);
    return NextResponse.json(
      { error: "Unable to save assessment ideas. Please refresh and try again." },
      { status: 500 }
    );
  }
}
