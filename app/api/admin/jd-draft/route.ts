import { NextResponse } from "next/server";
import { z } from "zod";
import { getAdminContext } from "@/app/lib/admin-context";
import { draftJdFromRoleTitle } from "@/app/lib/jd-draft-generator";

const draftSchema = z.object({
  roleTitle: z.string().min(2),
  level: z.string().min(2).default("Mid")
});

export async function POST(request: Request) {
  try {
    await getAdminContext();
    const input = draftSchema.parse(await request.json());
    const draft = await draftJdFromRoleTitle(input);
    return NextResponse.json(draft);
  } catch (err) {
    const message =
      err instanceof z.ZodError
        ? err.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ")
        : err instanceof Error
          ? err.message
          : "Unable to draft JD";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
