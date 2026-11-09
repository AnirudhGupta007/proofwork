import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/app/lib/admin-context";
import { db } from "@/app/lib/db";
import { scoringWeightsSchema } from "../../rubric-schema";

const rubricPatchSchema = z.object({ scoringWeights: scoringWeightsSchema });

function zodMessage(err: z.ZodError) {
  return err.issues.map((issue) => (issue.path.length ? `${issue.path.join(".")}: ${issue.message}` : issue.message)).join("; ");
}

export async function PATCH(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  try {
    const { templateId } = await params;
    const { organization } = await getAdminContext();
    const input = rubricPatchSchema.parse(await request.json());

    const template = await db.assessmentTemplate.findFirst({
      where: { id: templateId, organizationId: organization.id },
      select: { id: true }
    });
    if (!template) {
      return NextResponse.json({ error: "Assessment template not found." }, { status: 404 });
    }

    const updated = await db.assessmentTemplate.update({
      where: { id: template.id },
      data: { scoringWeights: input.scoringWeights ?? Prisma.DbNull },
      select: { id: true, scoringWeights: true }
    });

    return NextResponse.json({ template: updated });
  } catch (err) {
    const message =
      err instanceof z.ZodError ? zodMessage(err) : err instanceof Error ? err.message : "Unable to save scoring rubric";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
