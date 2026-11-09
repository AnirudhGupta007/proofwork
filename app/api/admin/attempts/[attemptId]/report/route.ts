import { notFound } from "next/navigation";
import { getAdminContext } from "@/app/lib/admin-context";
import { db } from "@/app/lib/db";
import { buildCandidateReportPdf } from "@/app/lib/reports/candidate-report";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  const { organization } = await getAdminContext();
  const attempt = await db.attempt.findFirst({
    where: { id: attemptId, organizationId: organization.id },
    include: { candidate: true }
  });

  if (!attempt) notFound();

  const pdf = await buildCandidateReportPdf(attempt.id);
  const filename = `${attempt.candidate.name.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "candidate"}-report.pdf`;

  return new Response(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Cache-Control": "no-store"
    }
  });
}
