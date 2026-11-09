import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/app/lib/db";
import { getAdminContext } from "@/app/lib/admin-context";

const scorecardSchema = z.object({
  requirements: z.number().int().min(0).max(5),
  testAndEvalQuality: z.number().int().min(0).max(5),
  debuggingDiscipline: z.number().int().min(0).max(5),
  codeQuality: z.number().int().min(0).max(5),
  aiCollaboration: z.number().int().min(0).max(5),
  productionReadiness: z.number().int().min(0).max(5),
  communication: z.number().int().min(0).max(5),
  reviewerNotes: z.string().nullable().optional(),
  reviewerOverrideScore: z.number().int().min(0).max(100).nullable().optional()
});

export async function PUT(request: Request, { params }: { params: Promise<{ attemptId: string }> }) {
  try {
    const { attemptId } = await params;
    const { admin, organization } = await getAdminContext();
    const input = scorecardSchema.parse(await request.json());
    const attempt = await db.attempt.findFirst({
      where: { id: attemptId, organizationId: organization.id },
      select: { id: true }
    });

    if (!attempt) {
      return NextResponse.json({ error: "Attempt not found" }, { status: 404 });
    }

    const scorecard = await db.scorecard.update({
      where: { attemptId },
      data: {
        ...input,
        reviewerOverrideScore: input.reviewerOverrideScore ?? null,
        reviewedBy: admin.email,
        reviewedAt: new Date()
      }
    });

    return NextResponse.json({ scorecard });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to save scorecard";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
