import { rehydrateArtifactTexts } from "@/app/lib/artifacts";
import { buildComparisonRows, type ComparisonRow } from "@/app/lib/comparison";
import { db } from "@/app/lib/db";
import { hasCustomRubric } from "@/app/lib/domain/rubric";

const TEST_ARTIFACT_LABELS = ["Test output", "Hidden test output"];

export type TemplateComparison = {
  template: { id: string; title: string; roleTitle: string | null; level: string; hasCustomWeights: boolean };
  rows: ComparisonRow[];
};

/** Org-scoped load of a template and its attempts as comparison rows. Null when not in the org. */
export async function loadTemplateComparison(organizationId: string, templateId: string): Promise<TemplateComparison | null> {
  const template = await db.assessmentTemplate.findFirst({
    where: { id: templateId, organizationId },
    select: { id: true, title: true, roleTitle: true, level: true, scoringWeights: true }
  });
  if (!template) return null;

  const attempts = await db.attempt.findMany({
    where: { templateId: template.id, organizationId },
    include: {
      candidate: { select: { name: true, email: true } },
      scorecard: true,
      artifacts: {
        where: { OR: [{ kind: "test_output" }, { label: { in: TEST_ARTIFACT_LABELS } }] },
        select: { id: true, kind: true, label: true, uri: true, metadata: true, createdAt: true },
        orderBy: { createdAt: "desc" }
      },
      evalRuns: {
        select: { visibleTests: true, hiddenTests: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 1
      }
    },
    orderBy: { createdAt: "asc" }
  });

  // R2-backed artifacts keep stdout out of metadata; pull it back so
  // test counts can be parsed. Only the (small) test-output artifacts.
  await rehydrateArtifactTexts(attempts.flatMap((attempt) => attempt.artifacts));

  return {
    template: {
      id: template.id,
      title: template.title,
      roleTitle: template.roleTitle,
      level: template.level,
      hasCustomWeights: hasCustomRubric(template.scoringWeights)
    },
    rows: buildComparisonRows(attempts, template.scoringWeights)
  };
}
