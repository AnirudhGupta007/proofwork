import { readFile, stat } from "fs/promises";
import path from "path";
import { notFound } from "next/navigation";
import { NextResponse } from "next/server";
import { getAdminContext } from "@/app/lib/admin-context";
import { db } from "@/app/lib/db";
import { isR2Configured, parseR2Uri, signR2GetUrl } from "@/app/lib/storage/r2";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ artifactId: string }> }) {
  const { artifactId } = await params;
  const { organization } = await getAdminContext();
  const artifact = await db.artifact.findFirst({
    where: {
      id: artifactId,
      attempt: { organizationId: organization.id }
    }
  });

  if (!artifact) notFound();

  // R2-backed artifacts: 302 to a short-lived presigned URL. The
  // browser <video> tag follows the redirect and streams the bytes
  // directly from R2 — Node never touches the payload.
  // NB: we use NextResponse.redirect rather than next/navigation's
  // redirect() because the latter is typed against the app's known
  // routes and rejects external/dynamic URLs.
  if (artifact.uri.startsWith("r2://")) {
    if (!isR2Configured()) notFound();
    const parsed = parseR2Uri(artifact.uri);
    if (!parsed) notFound();
    const url = await signR2GetUrl(parsed.key).catch(() => null);
    if (!url) notFound();
    return NextResponse.redirect(url, 302);
  }

  const metadata = artifact.metadata && typeof artifact.metadata === "object" && !Array.isArray(artifact.metadata) ? artifact.metadata : {};
  const filePath = typeof metadata.path === "string" ? metadata.path : artifact.uri.startsWith("file://") ? artifact.uri.slice(7) : null;
  if (!filePath) notFound();

  const stats = await stat(filePath).catch(() => null);
  if (!stats?.isFile()) notFound();

  const content = await readFile(filePath);
  const filename = typeof metadata.filename === "string" ? metadata.filename : path.basename(filePath);
  const contentType = typeof metadata.mimeType === "string" ? metadata.mimeType : "application/octet-stream";

  return new Response(new Uint8Array(content), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(content.byteLength),
      "Content-Disposition": `inline; filename="${filename.replaceAll('"', "")}"`,
      "Cache-Control": "private, no-store"
    }
  });
}
