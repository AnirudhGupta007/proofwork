// Multipart-upload bookkeeping for candidate-side chunked proctoring
// uploads. Keeps the route handlers tiny: validate token, find or
// create the ProctoringUpload row, delegate to R2 helpers, append
// to partsCompleted, finalize.
//
// Constraints worth knowing:
// - R2 enforces a 5 MiB minimum on every multipart part EXCEPT the
//   last one. The candidate client buffers MediaRecorder chunks to
//   honor this; the server just bookkeeps.
// - One in-flight upload per (attemptId, kind). If the candidate
//   refreshes their tab we abort and start over rather than try to
//   resume — webm fragment offsets don't survive a MediaRecorder
//   reset cleanly anyway.

import type { Prisma, ProctoringUploadKind } from "@prisma/client";
import { db } from "@/app/lib/db";
import {
  abortR2MultipartUpload,
  completeR2MultipartUpload,
  createR2MultipartUpload,
  isR2Configured
} from "@/app/lib/storage/r2";
import { logAttemptEvent } from "@/app/lib/events";

export type ProctoringPartRecord = {
  partNumber: number;
  etag: string;
  bytes: number;
  uploadedAt: string;
};

function recordingKey(attemptId: string, kind: ProctoringUploadKind, startedAt: Date) {
  return `attempts/${attemptId}/proctoring/${kind}-${startedAt.toISOString().replace(/[:.]/g, "-")}.webm`;
}

function readParts(json: Prisma.JsonValue): ProctoringPartRecord[] {
  if (!Array.isArray(json)) return [];
  const out: ProctoringPartRecord[] = [];
  for (const entry of json) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const partNumber = (entry as Record<string, unknown>).partNumber;
    const etag = (entry as Record<string, unknown>).etag;
    const bytes = (entry as Record<string, unknown>).bytes;
    const uploadedAt = (entry as Record<string, unknown>).uploadedAt;
    if (typeof partNumber !== "number" || typeof etag !== "string") continue;
    out.push({
      partNumber,
      etag,
      bytes: typeof bytes === "number" ? bytes : 0,
      uploadedAt: typeof uploadedAt === "string" ? uploadedAt : new Date(0).toISOString()
    });
  }
  return out;
}

export async function startProctoringUpload(input: {
  attemptId: string;
  kind: ProctoringUploadKind;
  mimeType: string;
}) {
  if (!isR2Configured()) {
    throw new Error("R2 storage is not configured.");
  }

  // If an in-flight upload already exists for this (attempt, kind),
  // abort it on R2 and supersede the row. Common path: candidate
  // refreshed mid-attempt or the previous attempt at this kind
  // failed to finalize.
  const existing = await db.proctoringUpload.findUnique({
    where: { attemptId_kind: { attemptId: input.attemptId, kind: input.kind } }
  });
  if (existing && existing.status === "in_progress") {
    await abortR2MultipartUpload({ key: existing.r2Key, uploadId: existing.r2UploadId }).catch(() => undefined);
  }

  const startedAt = new Date();
  const key = recordingKey(input.attemptId, input.kind, startedAt);
  const created = await createR2MultipartUpload({ key, contentType: input.mimeType });

  const row = await db.proctoringUpload.upsert({
    where: { attemptId_kind: { attemptId: input.attemptId, kind: input.kind } },
    update: {
      r2Bucket: created.bucket,
      r2Key: created.key,
      r2UploadId: created.uploadId,
      mimeType: input.mimeType,
      partsCompleted: [],
      status: "in_progress",
      startedAt,
      completedAt: null,
      artifactId: null
    },
    create: {
      attemptId: input.attemptId,
      kind: input.kind,
      r2Bucket: created.bucket,
      r2Key: created.key,
      r2UploadId: created.uploadId,
      mimeType: input.mimeType,
      partsCompleted: [],
      status: "in_progress",
      startedAt
    }
  });

  await logAttemptEvent(input.attemptId, `proctoring.${input.kind}_upload_started`, `${input.kind} upload session started`, {
    bucket: created.bucket,
    key: created.key,
    uploadId: created.uploadId,
    mimeType: input.mimeType
  });

  return {
    uploadId: created.uploadId,
    key: created.key,
    bucket: created.bucket,
    rowId: row.id
  };
}

export async function getActiveProctoringUpload(input: {
  attemptId: string;
  kind: ProctoringUploadKind;
}) {
  const row = await db.proctoringUpload.findUnique({
    where: { attemptId_kind: { attemptId: input.attemptId, kind: input.kind } }
  });
  if (!row) return null;
  if (row.status !== "in_progress") return null;
  return row;
}

export async function recordCompletedPart(input: {
  attemptId: string;
  kind: ProctoringUploadKind;
  partNumber: number;
  etag: string;
  bytes: number;
}) {
  const row = await getActiveProctoringUpload({ attemptId: input.attemptId, kind: input.kind });
  if (!row) {
    throw new Error("No active proctoring upload for this attempt/kind.");
  }

  // Normalize etag — S3 returns it quoted. Store quoted form because
  // CompleteMultipartUpload expects the same value back.
  const etag = input.etag.startsWith('"') ? input.etag : `"${input.etag.replace(/^W\//, "")}"`;

  const existing = readParts(row.partsCompleted).filter((part) => part.partNumber !== input.partNumber);
  existing.push({
    partNumber: input.partNumber,
    etag,
    bytes: input.bytes,
    uploadedAt: new Date().toISOString()
  });

  await db.proctoringUpload.update({
    where: { id: row.id },
    data: { partsCompleted: existing as unknown as Prisma.InputJsonValue }
  });
}

export async function finalizeProctoringUpload(input: {
  attemptId: string;
  kind: ProctoringUploadKind;
}) {
  const row = await getActiveProctoringUpload({ attemptId: input.attemptId, kind: input.kind });
  if (!row) {
    throw new Error("No active proctoring upload for this attempt/kind.");
  }

  const parts = readParts(row.partsCompleted);
  if (parts.length === 0) {
    // Nothing was uploaded — abort on R2 and mark row aborted.
    await abortR2MultipartUpload({ key: row.r2Key, uploadId: row.r2UploadId }).catch(() => undefined);
    await db.proctoringUpload.update({
      where: { id: row.id },
      data: { status: "aborted", completedAt: new Date() }
    });
    await logAttemptEvent(input.attemptId, `proctoring.${input.kind}_upload_aborted`, `${input.kind} upload aborted (no parts)`, {
      bucket: row.r2Bucket,
      key: row.r2Key
    });
    return null;
  }

  const result = await completeR2MultipartUpload({
    key: row.r2Key,
    uploadId: row.r2UploadId,
    parts: parts.map((part) => ({ partNumber: part.partNumber, etag: part.etag }))
  });

  const totalBytes = parts.reduce((sum, part) => sum + part.bytes, 0);

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
        bytes: totalBytes,
        mimeType: row.mimeType,
        parts: parts.length,
        startedAt: row.startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        uploadMode: "multipart-chunked"
      } satisfies Prisma.InputJsonObject
    }
  });

  await db.proctoringUpload.update({
    where: { id: row.id },
    data: { status: "complete", completedAt: new Date(), artifactId: artifact.id }
  });

  await logAttemptEvent(input.attemptId, `proctoring.${input.kind}_recording_uploaded`, `${input.kind} recording uploaded`, {
    storage: "r2",
    bucket: result.bucket,
    key: result.key,
    bytes: totalBytes,
    parts: parts.length,
    uploadMode: "multipart-chunked"
  });

  return artifact;
}

export async function abortProctoringUpload(input: {
  attemptId: string;
  kind: ProctoringUploadKind;
}) {
  const row = await getActiveProctoringUpload({ attemptId: input.attemptId, kind: input.kind });
  if (!row) return;
  await abortR2MultipartUpload({ key: row.r2Key, uploadId: row.r2UploadId }).catch(() => undefined);
  await db.proctoringUpload.update({
    where: { id: row.id },
    data: { status: "aborted", completedAt: new Date() }
  });
  await logAttemptEvent(input.attemptId, `proctoring.${input.kind}_upload_aborted`, `${input.kind} upload aborted`, {
    bucket: row.r2Bucket,
    key: row.r2Key
  });
}
