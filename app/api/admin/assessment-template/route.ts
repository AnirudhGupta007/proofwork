import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { generateAssessmentFromJd } from "@/app/lib/assessment-generator";
import { getAdminContext } from "@/app/lib/admin-context";
import { preflightAssessmentWorkspace } from "@/app/lib/assessment-preflight";
import { db } from "@/app/lib/db";
import { getWorkspaceProvider } from "@/app/lib/workspaces/provider";

const templateSchema = z.object({
  roleTitle: z.string().min(2),
  level: z.string().min(2).default("Mid"),
  jobDescription: z.string().min(30),
  durationMin: z.number().int().min(45).max(360).default(120),
  proctoringEnabled: z.boolean().default(false),
  repoSource: z.enum(["generated", "github"]).default("generated"),
  repoUrl: z.string().optional(),
  projectBrief: z.string().optional(),
  existingProjectBrief: z.string().optional(),
  assessmentIdea: z.string().optional(),
  assessmentIdeaDetails: z
    .object({
      id: z.string().min(2),
      title: z.string().min(4),
      summary: z.string().min(10),
      durationMin: z.number().int().min(45).max(360),
      evaluationFocus: z.array(z.string()).min(1),
      deliverables: z.array(z.string()).min(1)
    })
    .optional(),
  assessmentPrompt: z.string().optional(),
  assessmentMode: z.enum(["solo", "live_guided"]).default("solo")
});

function zodMessage(err: z.ZodError) {
  return err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}

function errorMessage(err: unknown) {
  return err instanceof Error ? err.message : String(err);
}

export async function POST(request: Request) {
  try {
    const input = templateSchema.parse(await request.json());
    if (input.repoSource === "github") {
      try {
        const parsed = new URL(input.repoUrl ?? "");
        if (!["github.com", "www.github.com"].includes(parsed.hostname)) {
          throw new Error("Use a GitHub repository URL or switch back to generated repo.");
        }
      } catch {
        throw new Error("Enter a valid GitHub repository URL or switch back to generated repo.");
      }
    }

    const { organization } = await getAdminContext();
    const generated = generateAssessmentFromJd(input);
    const generatedEvaluationPlan = generated.evaluationPlan as {
      focus?: string[];
      requiredEvidence?: string[];
      assessmentMode?: string;
      [key: string]: unknown;
    };
    const preflight = await preflightAssessmentWorkspace({
      title: generated.title,
      roleTitle: generated.roleTitle,
      level: generated.level,
      instructions: generated.instructions,
      taskBrief: generated.taskBrief,
      evaluationFocus: generatedEvaluationPlan.focus ?? [],
      requiredEvidence: generatedEvaluationPlan.requiredEvidence ?? [],
      assessmentMode: generatedEvaluationPlan.assessmentMode
    });

    if (!preflight.passed) {
      throw new Error(`Generated assessment did not pass workspace preflight: ${preflight.stderr || preflight.stdout}`);
    }

    let template = await db.$transaction(async (tx) => {
      await tx.assessmentTemplate.updateMany({
        where: { organizationId: organization.id, isActive: true },
        data: { isActive: false }
      });

      return tx.assessmentTemplate.create({
        data: {
          organizationId: organization.id,
          title: generated.title,
          roleTitle: generated.roleTitle,
          level: generated.level,
          durationMin: generated.durationMin,
          repoUrl: generated.repoUrl,
          instructions: generated.instructions,
          generatedFromJd: generated.generatedFromJd,
          taskBrief: generated.taskBrief,
          evaluationPlan: { ...generatedEvaluationPlan, preflight } as Prisma.InputJsonValue,
          proctoringConfig: generated.proctoringConfig as Prisma.InputJsonValue,
          rubric: generated.rubric as Prisma.InputJsonValue,
          isActive: true
        }
      });
    });

    const reviewStartedAt = new Date().toISOString();
    try {
      const reviewWorkspace = await getWorkspaceProvider().provisionWorkspace({
        attemptId: `template-${template.id}`,
        candidateName: "Assessment reviewer",
        repoUrl: generated.repoUrl,
        durationMin: Math.max(75, Math.min(generated.durationMin, 150)),
        assessment: {
          title: generated.title,
          roleTitle: generated.roleTitle,
          level: generated.level,
          instructions: generated.instructions,
          taskBrief: generated.taskBrief,
          evaluationFocus: generatedEvaluationPlan.focus ?? [],
          requiredEvidence: generatedEvaluationPlan.requiredEvidence ?? [],
          assessmentMode: generatedEvaluationPlan.assessmentMode
        }
      });

      const nextEvaluationPlan = {
        ...generatedEvaluationPlan,
        preflight,
        reviewWorkspace: {
          status: "ready",
          provider: reviewWorkspace.provider,
          externalId: reviewWorkspace.externalId,
          startedAt: reviewStartedAt,
          readyAt: new Date().toISOString(),
          expiresAt: reviewWorkspace.expiresAt.toISOString(),
          appPreviewUrl: reviewWorkspace.metadata?.appPreviewUrl,
          terminalUrl: reviewWorkspace.metadata?.terminalUrl ?? reviewWorkspace.accessUrl,
          opencodeWebUrl: reviewWorkspace.metadata?.opencodeWebUrl,
          provisioningTimings: reviewWorkspace.metadata?.provisioningTimings
        }
      };

      template = await db.assessmentTemplate.update({
        where: { id: template.id },
        data: { evaluationPlan: nextEvaluationPlan as Prisma.InputJsonValue }
      });
    } catch (err) {
      const nextEvaluationPlan = {
        ...generatedEvaluationPlan,
        preflight,
        reviewWorkspace: {
          status: "failed",
          provider: "daytona",
          startedAt: reviewStartedAt,
          failedAt: new Date().toISOString(),
          error: errorMessage(err)
        }
      };

      template = await db.assessmentTemplate.update({
        where: { id: template.id },
        data: { evaluationPlan: nextEvaluationPlan as Prisma.InputJsonValue }
      });
    }

    return NextResponse.json({ template });
  } catch (err) {
    const message = err instanceof z.ZodError ? zodMessage(err) : err instanceof Error ? err.message : "Unable to generate assessment";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

const patchTemplateSchema = z.object({
  templateId: z.string().min(2),
  // Optional partial updates. When present, applied to the template
  // without changing activation. When absent, the request is treated
  // as the legacy "activate this template" call.
  durationMin: z.number().int().min(45).max(360).optional()
});

export async function PATCH(request: Request) {
  try {
    const input = patchTemplateSchema.parse(await request.json());
    const { organization } = await getAdminContext();
    const template = await db.assessmentTemplate.findFirst({
      where: { id: input.templateId, organizationId: organization.id }
    });
    if (!template) throw new Error("Assessment template not found.");

    const fieldUpdates: Prisma.AssessmentTemplateUpdateInput = {};
    if (typeof input.durationMin === "number") {
      fieldUpdates.durationMin = input.durationMin;
    }
    const hasFieldUpdates = Object.keys(fieldUpdates).length > 0;

    if (hasFieldUpdates) {
      const updated = await db.assessmentTemplate.update({
        where: { id: template.id },
        data: fieldUpdates
      });
      return NextResponse.json({ template: updated });
    }

    await db.$transaction([
      db.assessmentTemplate.updateMany({
        where: { organizationId: organization.id, isActive: true },
        data: { isActive: false }
      }),
      db.assessmentTemplate.update({
        where: { id: template.id },
        data: { isActive: true }
      })
    ]);

    return NextResponse.json({ template: { ...template, isActive: true } });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? zodMessage(err)
        : err instanceof Error
          ? err.message
          : "Unable to activate assessment template";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
