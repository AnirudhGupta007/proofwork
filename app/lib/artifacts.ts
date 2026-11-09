// Artifact text storage + retrieval. Bridges the two persistence
// shapes that coexist after PR 3 lands:
//
// - New (r2://):   uri = r2://<bucket>/attempts/<attemptId>/artifacts/<slug>.txt
//                  metadata holds summary fields only — exitCode, bytes,
//                  storage, content-type, plus any structured fields
//                  (qualityScore, promptCount, etc.). stdout/stderr/
//                  content payload bytes live in R2.
// - Legacy (inline://): full stdout/stderr/content in metadata, no R2 object.
//
// All downstream readers (candidate report PDF, reviewer page,
// rescore script) go through getArtifactText() so neither side has
// to special-case the storage location.

import { createHash } from "node:crypto";
import { getR2ObjectBuffer, isR2Configured, parseR2Uri, putR2Object } from "@/app/lib/storage/r2";

const ARTIFACT_BUCKET_PREFIX_PATTERN = /[^a-z0-9._-]+/gi;

function slugifyLabel(label: string) {
  return label.toLowerCase().replace(ARTIFACT_BUCKET_PREFIX_PATTERN, "-").replace(/^-+|-+$/g, "") || "artifact";
}

export function artifactStorageKey(input: { attemptId: string; label: string }) {
  return `attempts/${input.attemptId}/artifacts/${slugifyLabel(input.label)}-${Date.now()}.txt`;
}

// Extracts the user-facing text payload from a metadata object —
// either the legacy `stdout`/`stderr`/`content` field, or null when
// the artifact stores its text in R2 instead (caller should use
// getArtifactText for that path).
export function inlineArtifactText(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const record = metadata as { stdout?: unknown; stderr?: unknown; content?: unknown };
  const stdout = typeof record.stdout === "string" ? record.stdout : "";
  const stderr = typeof record.stderr === "string" ? record.stderr : "";
  const content = typeof record.content === "string" ? record.content : "";
  const combined = stdout || stderr || content;
  return combined && combined.length > 0 ? combined : null;
}

// Drops the bulky stdout/stderr/content fields from an artifact's
// metadata, preserving structured fields like exitCode, qualityScore,
// etc. Used right before persisting an Artifact row whose text
// payload has already been streamed to R2.
export function slimArtifactMetadata(metadata: unknown): Record<string, unknown> {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return {};
  const { stdout: _stdout, stderr: _stderr, content: _content, ...rest } = metadata as Record<string, unknown>;
  return rest;
}

type ArtifactLike = {
  uri: string;
  metadata: unknown;
};

// On-demand text fetch. Returns "" when the artifact has no text
// payload at all (e.g. proctoring_recording) so callers don't have
// to null-check before string ops.
export async function getArtifactText(artifact: ArtifactLike): Promise<string> {
  if (artifact.uri?.startsWith("r2://")) {
    const parsed = parseR2Uri(artifact.uri);
    if (!parsed) return "";
    if (!isR2Configured()) return "";
    try {
      const buffer = await getR2ObjectBuffer(parsed.key);
      return buffer.toString("utf8");
    } catch {
      return "";
    }
  }
  return inlineArtifactText(artifact.metadata) ?? "";
}

// Bulk variant for pages that render N artifacts at once (reviewer
// page, candidate report PDF). Parallelizes R2 GETs and returns a
// Map keyed by artifact id (or any stable key the caller provides).
export async function getArtifactTextMap<T extends ArtifactLike & { id: string }>(
  artifacts: T[]
): Promise<Map<string, string>> {
  const entries = await Promise.all(
    artifacts.map(async (artifact) => [artifact.id, await getArtifactText(artifact)] as const)
  );
  return new Map(entries);
}

// In-place rehydration for code paths that consume artifacts via the
// legacy `metadata.stdout` field. After this call, every R2-backed
// artifact in the input list has its text payload injected back into
// `metadata.stdout` so downstream readers don't have to be made
// async. Mutates the input array in-place. Safe to call on a mixed
// list of inline:// and r2:// artifacts; legacy entries are
// untouched.
export async function rehydrateArtifactTexts<T extends ArtifactLike & { metadata: unknown }>(
  artifacts: T[]
): Promise<void> {
  const r2Artifacts = artifacts.filter((artifact) => artifact.uri?.startsWith("r2://"));
  if (r2Artifacts.length === 0) return;

  const texts = await Promise.all(r2Artifacts.map((artifact) => getArtifactText(artifact)));
  r2Artifacts.forEach((artifact, idx) => {
    const baseline = artifact.metadata && typeof artifact.metadata === "object" && !Array.isArray(artifact.metadata)
      ? (artifact.metadata as Record<string, unknown>)
      : {};
    (artifact as { metadata: unknown }).metadata = { ...baseline, stdout: texts[idx] };
  });
}

export type StoredArtifactPayload = {
  kind: string;
  label: string;
  uri: string;
  metadata: Record<string, unknown>;
};

// Takes the artifact list produced by collectArtifacts (plus any
// locally generated artifacts) and ensures every text payload lives
// in R2 before persistence. Returns the rewritten list ready for
// db.artifact.createMany. Falls through unchanged when R2 isn't
// configured — local dev keeps the inline:// path.
export async function persistArtifactPayloadsToR2<
  T extends { kind: string; label: string; uri: string; metadata?: Record<string, unknown> | unknown }
>(input: { attemptId: string; artifacts: T[] }): Promise<StoredArtifactPayload[]> {
  if (!isR2Configured()) {
    return input.artifacts.map((artifact) => ({
      kind: artifact.kind,
      label: artifact.label,
      uri: artifact.uri,
      metadata: (artifact.metadata as Record<string, unknown>) ?? {}
    }));
  }

  const out: StoredArtifactPayload[] = [];
  for (const artifact of input.artifacts) {
    const text = inlineArtifactText(artifact.metadata);

    if (!text) {
      // Artifact has no text payload (proctoring_recording rows go
      // through their own R2 path) — pass through unchanged.
      out.push({
        kind: artifact.kind,
        label: artifact.label,
        uri: artifact.uri,
        metadata: (artifact.metadata as Record<string, unknown>) ?? {}
      });
      continue;
    }

    const key = artifactStorageKey({ attemptId: input.attemptId, label: artifact.label });
    const body = Buffer.from(text, "utf8");
    let upload;
    try {
      upload = await putR2Object({
        key,
        body,
        contentType: "text/plain; charset=utf-8",
        contentLength: body.byteLength
      });
    } catch (err) {
      // R2 failure shouldn't drop the artifact entirely. Persist
      // inline so the reviewer at least sees the text — we'll catch
      // the dropped R2 upload via the surrounding log line.
      console.error(`Artifact R2 upload failed for ${artifact.label}, falling back to inline`, err);
      out.push({
        kind: artifact.kind,
        label: artifact.label,
        uri: artifact.uri,
        metadata: (artifact.metadata as Record<string, unknown>) ?? {}
      });
      continue;
    }

    const slimmed = slimArtifactMetadata(artifact.metadata);
    out.push({
      kind: artifact.kind,
      label: artifact.label,
      uri: upload.uri,
      metadata: {
        ...slimmed,
        storage: "r2",
        bucket: upload.bucket,
        key: upload.key,
        bytes: upload.bytes,
        contentType: upload.contentType,
        sha256: createHash("sha256").update(body).digest("hex")
      }
    });
  }

  return out;
}
