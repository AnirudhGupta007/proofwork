import { mkdir, readFile, stat, writeFile } from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";
import { db } from "@/app/lib/db";
import { env } from "@/app/lib/env";
import { logAttemptEvent } from "@/app/lib/events";
import { getR2ObjectBuffer, headR2Object, isR2Configured, parseR2Uri, putR2Object } from "@/app/lib/storage/r2";

const safeName = /[^a-z0-9._-]+/gi;

function extensionForMime(mimeType: string) {
  if (mimeType.includes("mp4")) return "mp4";
  if (mimeType.includes("ogg")) return "ogv";
  return "webm";
}

function storageRoot() {
  return path.resolve(process.cwd(), env.PROCTORING_STORAGE_DIR);
}

function recordingKey(attemptId: string, kind: "camera" | "screen", filename: string) {
  return `attempts/${attemptId}/proctoring/${filename}`.replace(/^\//, "");
}

export async function persistProctoringRecording(input: {
  attemptId: string;
  kind: "camera" | "screen";
  file: File;
}) {
  const arrayBuffer = await input.file.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);
  const mimeType = input.file.type || "video/webm";
  const extension = extensionForMime(mimeType);
  const filename = `${input.kind}-${Date.now()}.${extension}`.replace(safeName, "-");

  // Prefer R2; fall back to local FS in environments without R2 creds
  // (local dev shell). Either way an Artifact row is created with a
  // URI that loadRecordingAttachment / the download route understand.
  if (isR2Configured()) {
    const key = recordingKey(input.attemptId, input.kind, filename);
    const result = await putR2Object({
      key,
      body: buffer,
      contentType: mimeType,
      contentLength: buffer.byteLength
    });

    const artifact = await db.artifact.create({
      data: {
        attemptId: input.attemptId,
        kind: "proctoring_recording",
        label: input.kind === "camera" ? "Camera recording" : "Screen recording",
        uri: result.uri,
        metadata: {
          storage: "r2",
          bucket: result.bucket,
          key: result.key,
          filename,
          bytes: result.bytes,
          mimeType,
          originalName: input.file.name
        } satisfies Prisma.InputJsonObject
      }
    });

    await logAttemptEvent(input.attemptId, `proctoring.${input.kind}_recording_uploaded`, `${input.kind} recording uploaded`, {
      storage: "r2",
      bucket: result.bucket,
      key: result.key,
      bytes: result.bytes,
      mimeType
    });

    return artifact;
  }

  const directory = path.join(storageRoot(), input.attemptId);
  const absolutePath = path.join(directory, filename);

  await mkdir(directory, { recursive: true });
  await writeFile(absolutePath, buffer);

  const artifact = await db.artifact.create({
    data: {
      attemptId: input.attemptId,
      kind: "proctoring_recording",
      label: input.kind === "camera" ? "Camera recording" : "Screen recording",
      uri: `file://${absolutePath}`,
      metadata: {
        storage: "fs",
        filename,
        path: absolutePath,
        bytes: buffer.byteLength,
        mimeType,
        originalName: input.file.name
      } satisfies Prisma.InputJsonObject
    }
  });

  await logAttemptEvent(input.attemptId, `proctoring.${input.kind}_recording_uploaded`, `${input.kind} recording uploaded`, {
    storage: "fs",
    filename,
    bytes: buffer.byteLength,
    mimeType
  });

  return artifact;
}

export async function loadRecordingAttachment(artifact: {
  label: string;
  uri: string;
  metadata: Prisma.JsonValue;
}) {
  const metadata = artifact.metadata && typeof artifact.metadata === "object" && !Array.isArray(artifact.metadata)
    ? artifact.metadata
    : {};

  if (artifact.uri.startsWith("r2://")) {
    const parsed = parseR2Uri(artifact.uri);
    if (!parsed) return null;

    const filename = typeof metadata.filename === "string" ? metadata.filename : path.basename(parsed.key);
    const contentType = typeof metadata.mimeType === "string" ? metadata.mimeType : "video/webm";

    try {
      const head = await headR2Object(parsed.key);
      const buffer = await getR2ObjectBuffer(parsed.key);
      return {
        filename,
        contentType: head.contentType ?? contentType,
        bytes: head.bytes ?? buffer.byteLength,
        content: buffer
      };
    } catch {
      return null;
    }
  }

  const filePath = typeof metadata.path === "string" ? metadata.path : artifact.uri.startsWith("file://") ? artifact.uri.slice(7) : null;
  if (!filePath) return null;

  const stats = await stat(filePath).catch(() => null);
  if (!stats?.isFile()) return null;

  const filename = typeof metadata.filename === "string" ? metadata.filename : path.basename(filePath);
  const contentType = typeof metadata.mimeType === "string" ? metadata.mimeType : "video/webm";

  return {
    filename,
    contentType,
    bytes: stats.size,
    content: await readFile(filePath)
  };
}
