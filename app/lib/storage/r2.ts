// Cloudflare R2 client. R2 speaks the S3 API, so we use the AWS SDK
// pointed at the per-account R2 endpoint with the path-style
// addressing R2 requires. Configuration is all-or-nothing: if any
// R2_* env is unset the module reports notConfigured and callers
// fall back to their non-R2 path (typically local FS for dev).

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
  CompleteMultipartUploadCommand,
  AbortMultipartUploadCommand,
  type CompletedPart
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Readable } from "node:stream";
import { env } from "@/app/lib/env";

let cachedClient: S3Client | null = null;

function readConfig() {
  if (!env.ARTIFACT_BUCKET || !env.R2_ENDPOINT || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
    return null;
  }
  return {
    bucket: env.ARTIFACT_BUCKET,
    endpoint: env.R2_ENDPOINT,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    signedUrlTtl: env.R2_SIGNED_URL_TTL_SECONDS
  };
}

export function isR2Configured() {
  return readConfig() !== null;
}

function getClient() {
  const config = readConfig();
  if (!config) {
    throw new Error("R2 storage is not configured (set ARTIFACT_BUCKET + R2_* env vars).");
  }
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: config.endpoint,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey
      },
      forcePathStyle: true
    });
  }
  return { client: cachedClient, bucket: config.bucket, signedUrlTtl: config.signedUrlTtl };
}

export type R2PutInput = {
  key: string;
  body: Buffer | Uint8Array | Readable;
  contentType: string;
  contentLength?: number;
};

export type R2PutResult = {
  uri: string;
  bucket: string;
  key: string;
  bytes: number;
  contentType: string;
};

// Streams the payload through the multipart Upload helper so files
// over the 5 MB single-PUT threshold get chunked transparently
// without buffering the whole body in Node memory. Returns an
// r2://bucket/key URI suitable for Artifact.uri.
export async function putR2Object(input: R2PutInput): Promise<R2PutResult> {
  const { client, bucket } = getClient();

  let body: Buffer | Uint8Array | Readable = input.body;
  let bytes = input.contentLength ?? 0;
  if (Buffer.isBuffer(input.body)) {
    bytes = input.body.byteLength;
  } else if (input.body instanceof Uint8Array) {
    bytes = input.body.byteLength;
    body = Buffer.from(input.body);
  }

  const upload = new Upload({
    client,
    params: {
      Bucket: bucket,
      Key: input.key,
      Body: body,
      ContentType: input.contentType,
      ContentLength: bytes || undefined
    },
    queueSize: 4,
    partSize: 8 * 1024 * 1024,
    leavePartsOnError: false
  });

  await upload.done();

  return {
    uri: `r2://${bucket}/${input.key}`,
    bucket,
    key: input.key,
    bytes,
    contentType: input.contentType
  };
}

// 302-redirect target for browser playback. TTL is short by design;
// the reviewer page re-fetches the artifact metadata when it needs
// a fresh URL.
export async function signR2GetUrl(key: string, ttlSeconds?: number): Promise<string> {
  const { client, bucket, signedUrlTtl } = getClient();
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: bucket, Key: key }),
    { expiresIn: ttlSeconds ?? signedUrlTtl }
  );
}

// Server-side fetch when the consumer needs the actual bytes
// (candidate report PDF embedding, etc.) rather than a browser URL.
export async function getR2ObjectStream(key: string) {
  const { client, bucket } = getClient();
  const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  if (!response.Body) {
    throw new Error(`R2 object missing body: ${key}`);
  }
  return {
    contentType: response.ContentType ?? "application/octet-stream",
    contentLength: response.ContentLength ?? null,
    body: response.Body as Readable
  };
}

export async function getR2ObjectBuffer(key: string): Promise<Buffer> {
  const { body } = await getR2ObjectStream(key);
  const chunks: Buffer[] = [];
  for await (const chunk of body) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function headR2Object(key: string) {
  const { client, bucket } = getClient();
  const response = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
  return {
    bytes: response.ContentLength ?? null,
    contentType: response.ContentType ?? null,
    lastModified: response.LastModified ?? null
  };
}

const R2_URI_PATTERN = /^r2:\/\/([^/]+)\/(.+)$/;

export function parseR2Uri(uri: string) {
  const match = R2_URI_PATTERN.exec(uri);
  if (!match) return null;
  return { bucket: match[1], key: match[2] };
}

// ── Multipart upload helpers ──────────────────────────────────────
//
// Used by the candidate-side proctoring recorder to stream camera +
// screen video to R2 in 5+ MiB chunks while the assessment is in
// progress, instead of one giant end-of-session POST. The browser
// PUTs each part directly to R2 via a per-part presigned URL — the
// proofwork pod only signs URLs and bookkeeps part etags.

export type R2MultipartCreateResult = {
  bucket: string;
  key: string;
  uploadId: string;
  contentType: string;
};

export async function createR2MultipartUpload(input: {
  key: string;
  contentType: string;
}): Promise<R2MultipartCreateResult> {
  const { client, bucket } = getClient();
  const response = await client.send(
    new CreateMultipartUploadCommand({
      Bucket: bucket,
      Key: input.key,
      ContentType: input.contentType
    })
  );
  if (!response.UploadId) {
    throw new Error(`R2 CreateMultipartUpload returned no UploadId for key ${input.key}`);
  }
  return {
    bucket,
    key: input.key,
    uploadId: response.UploadId,
    contentType: input.contentType
  };
}

// Presigns a single UploadPart PUT. The browser sends the chunk body
// directly to this URL; the response's ETag header is what we record
// against the part number for the eventual CompleteMultipartUpload.
export async function signR2UploadPartUrl(input: {
  key: string;
  uploadId: string;
  partNumber: number;
  ttlSeconds?: number;
}): Promise<string> {
  const { client, bucket, signedUrlTtl } = getClient();
  return getSignedUrl(
    client,
    new UploadPartCommand({
      Bucket: bucket,
      Key: input.key,
      UploadId: input.uploadId,
      PartNumber: input.partNumber
    }),
    { expiresIn: input.ttlSeconds ?? Math.min(signedUrlTtl, 300) }
  );
}

export async function completeR2MultipartUpload(input: {
  key: string;
  uploadId: string;
  parts: Array<{ partNumber: number; etag: string }>;
}): Promise<{ uri: string; bucket: string; key: string }> {
  const { client, bucket } = getClient();
  const ordered = [...input.parts].sort((a, b) => a.partNumber - b.partNumber);
  const completedParts: CompletedPart[] = ordered.map((part) => ({
    PartNumber: part.partNumber,
    ETag: part.etag
  }));
  await client.send(
    new CompleteMultipartUploadCommand({
      Bucket: bucket,
      Key: input.key,
      UploadId: input.uploadId,
      MultipartUpload: { Parts: completedParts }
    })
  );
  return { uri: `r2://${bucket}/${input.key}`, bucket, key: input.key };
}

export async function abortR2MultipartUpload(input: {
  key: string;
  uploadId: string;
}): Promise<void> {
  const { client, bucket } = getClient();
  await client.send(
    new AbortMultipartUploadCommand({
      Bucket: bucket,
      Key: input.key,
      UploadId: input.uploadId
    })
  );
}
