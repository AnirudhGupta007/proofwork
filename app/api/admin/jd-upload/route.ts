import { NextResponse } from "next/server";
import { generateAssessmentIdeasFromJd } from "@/app/lib/assessment-generator";
import { saveGeneratedAssessmentIdeas } from "@/app/lib/assessment-idea-store";
import { getAdminContext } from "@/app/lib/admin-context";

export const runtime = "nodejs";

async function extractText(file: File) {
  const buffer = Buffer.from(await file.arrayBuffer());
  const type = file.type;
  const name = file.name.toLowerCase();

  if (type === "application/pdf" || name.endsWith(".pdf")) {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: buffer });
    const parsed = await parser.getText();
    await parser.destroy();
    return parsed.text;
  }

  if (
    type === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    name.endsWith(".docx")
  ) {
    const mammoth = await import("mammoth");
    const parsed = await mammoth.extractRawText({ buffer });
    return parsed.value;
  }

  if (type.startsWith("text/") || name.endsWith(".txt") || name.endsWith(".md")) {
    return buffer.toString("utf8");
  }

  throw new Error("Upload a PDF, DOCX, TXT, or Markdown JD.");
}

export async function POST(request: Request) {
  try {
    const { organization } = await getAdminContext();
    const formData = await request.formData();
    const file = formData.get("file");
    const roleTitle = String(formData.get("roleTitle") ?? "Software Development Engineer");
    const level = String(formData.get("level") ?? "Mid");

    if (!(file instanceof File)) throw new Error("JD file is required.");
    if (file.size > 5 * 1024 * 1024) throw new Error("JD file must be smaller than 5MB.");

    const text = (await extractText(file)).replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text.length < 30) throw new Error("Could not extract enough text from this JD.");

    const input = { roleTitle, level, jobDescription: text };
    const ideas = generateAssessmentIdeasFromJd(input);
    const savedIdeas = await saveGeneratedAssessmentIdeas({
      organizationId: organization.id,
      input,
      generated: { source: "fallback", assessmentPrompt: "", ideas }
    });
    return NextResponse.json({ fileName: file.name, text, ideas: savedIdeas.length > 0 ? savedIdeas : ideas, savedIdeas });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unable to upload JD";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
