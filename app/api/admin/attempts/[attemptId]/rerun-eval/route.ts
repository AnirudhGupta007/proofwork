import { NextResponse } from "next/server";
import { inngest } from "@/app/lib/inngest";

export async function POST(request: Request, { params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = await params;
  if (process.env.INNGEST_EVENT_KEY) {
    await inngest.send({
      name: "attempt/evaluate",
      data: { attemptId, reason: "manual-rerun" }
    });
  } else {
    const { evaluateAttemptInline } = await import("@/app/lib/local-jobs");
    await evaluateAttemptInline(attemptId);
  }

  return NextResponse.redirect(new URL(`/admin/attempts/${attemptId}`, request.url), { status: 303 });
}
