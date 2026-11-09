import { NextResponse } from "next/server";
import { getCurrentAttempt } from "@/app/lib/attempt-actions";

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await params;
    const attempt = await getCurrentAttempt(token);
    return NextResponse.json({ attempt });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to load assessment";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
