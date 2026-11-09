import { NextResponse } from "next/server";
import { z } from "zod";
import { startAssessment } from "@/app/lib/attempt-actions";

const startSchema = z.object({
  proctoringPreflight: z
    .object({
      camera: z.boolean().optional(),
      screen: z.boolean().optional(),
      recording: z.boolean().optional()
    })
    .optional()
});

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const input = startSchema.parse(await request.json().catch(() => ({})));
    const attempt = await startAssessment(token, input.proctoringPreflight);
    return NextResponse.json({ attempt });
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to start assessment";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
