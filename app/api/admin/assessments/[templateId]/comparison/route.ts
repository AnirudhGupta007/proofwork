import { NextResponse } from "next/server";
import { loadTemplateComparison } from "@/app/admin/assessments/[templateId]/compare/data";
import { getAdminContext } from "@/app/lib/admin-context";
import { isSortColumn, sortComparisonRows } from "@/app/lib/comparison";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// GET /api/admin/assessments/:templateId/comparison?sort=overall&dir=desc
export async function GET(request: Request, { params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params;
  const { organization } = await getAdminContext();
  const comparison = await loadTemplateComparison(organization.id, templateId);

  if (!comparison) {
    return NextResponse.json({ error: "Assessment not found" }, { status: 404 });
  }

  const url = new URL(request.url);
  const sortParam = url.searchParams.get("sort");
  const column = isSortColumn(sortParam) ? sortParam : "overall";
  const direction = url.searchParams.get("dir") === "asc" ? "asc" : "desc";

  return NextResponse.json(
    {
      template: comparison.template,
      sort: { column, direction },
      rows: sortComparisonRows(comparison.rows, column, direction)
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
