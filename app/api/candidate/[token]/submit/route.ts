import { NextResponse } from "next/server";
import { z } from "zod";
import { submitAssessment } from "@/app/lib/attempt-actions";

const submitSchema = z.object({
  finalNotes: z.string().max(4000).default("")
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const input = submitSchema.parse(await request.json());
    const attempt = await submitAssessment(token, input.finalNotes);
    return NextResponse.json({ attempt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to submit assessment";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
