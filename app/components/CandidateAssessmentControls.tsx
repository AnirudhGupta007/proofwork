"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  MonitorUp,
  Play,
  RefreshCw,
  Send,
  ShieldAlert,
  SquareTerminal,
  Video
} from "lucide-react";
import { formatTimer } from "@/app/lib/domain/time";

type Attempt = {
  id: string;
  status: string;
  dueAt: string | Date | null;
  finalNotes?: string | null;
  workspace?: {
    accessUrl: string | null;
    opencodeUser: string | null;
    opencodePass: string | null;
    metadata?: {
      appPreviewUrl?: string;
      terminalUrl?: string;
      opencodeWebUrl?: string | null;
      opencodePrimarySurface?: string;
      terminalService?: string;
      provisioningTimings?: Array<{ label: string; durationMs: number; exitCode?: number }>;
      [key: string]: unknown;
    } | null;
  } | null;
};

type ProctoringConfig = {
  enabled?: boolean;
  cameraRequired?: boolean;
  screenShareRequired?: boolean;
  recordVideo?: boolean;
  recordScreen?: boolean;
};

type ProctoringDeviceStatus = "not_checked" | "active" | "blocked" | "disconnected" | "stopped";
type ProctoringRecordingStatus = "not_started" | "recording" | "stopped" | "unsupported";
// R2 multipart minimum part size; preceding parts must be >= 5 MiB,
// final part may be any size. Keep just above the protocol minimum
// so we don't hold many minutes of video in memory.
const PROCTORING_MIN_PART_BYTES = 5 * 1024 * 1024 + 1024;

type RecorderUploadMode = "pending" | "chunked" | "legacy" | "disabled";

type RecorderItem = {
  kind: "camera" | "screen";
  recorder: MediaRecorder;
  startedAt: number;
  mode: RecorderUploadMode;
  // Chunked-mode bookkeeping
  uploadId: string | null;
  key: string | null;
  nextPartNumber: number;
  pendingBuffer: Blob[];
  pendingBytes: number;
  inflightParts: Set<number>;
  partCompletions: Array<Promise<unknown>>;
  // Legacy-mode buffer (only used when init failed or R2 disabled)
  legacyChunks: Blob[];
};

function withBasicAuth(url: string | null, username: string | null | undefined, password: string | null | undefined) {
  if (!url || !username || !password) return url;

  try {
    const parsed = new URL(url);
    parsed.username = username;
    parsed.password = password;
    return parsed.toString();
  } catch {
    return url;
  }
}

function isDaytonaPreviewUrl(url: string | null | undefined) {
  if (!url) return false;
  try {
    return new URL(url).hostname.includes("daytonaproxy");
  } catch {
    return false;
  }
}

function statusLabel(status: string) {
  return status.replaceAll("_", " ");
}

export function CandidateAssessmentControls({
  token,
  initialAttempt,
  proctoringConfig,
  durationMin
}: {
  token: string;
  initialAttempt?: Attempt | null;
  proctoringConfig?: ProctoringConfig | null;
  durationMin: number;
}) {
  const [attempt, setAttempt] = useState<Attempt | null>(initialAttempt ?? null);
  const [notes, setNotes] = useState(initialAttempt?.finalNotes ?? "");
  const [busy, setBusy] = useState(false);
  const [previewRestarting, setPreviewRestarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWebFallback, setShowWebFallback] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [provisioningStartedAt, setProvisioningStartedAt] = useState<number | null>(null);
  const [copiedCredential, setCopiedCredential] = useState<"username" | "password" | null>(null);
  const [proctoringStatus, setProctoringStatus] = useState({
    camera: "not_checked" as ProctoringDeviceStatus,
    screen: "not_checked" as ProctoringDeviceStatus,
    cameraRecording: "not_started" as ProctoringRecordingStatus,
    screenRecording: "not_started" as ProctoringRecordingStatus
  });
  const notesRef = useRef<HTMLTextAreaElement | null>(null);
  const proctoringStreamsRef = useRef<MediaStream[]>([]);
  const mediaRecordersRef = useRef<RecorderItem[]>([]);
  const recordingUploadRef = useRef(false);
  const cameraPreviewRef = useRef<HTMLVideoElement | null>(null);

  const refreshAttempt = useCallback(async () => {
    const response = await fetch(`/api/candidate/${token}/attempt`);
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? "Unable to refresh assessment.");
    setAttempt(payload.attempt);
    if (payload.attempt?.finalNotes && ["submitted", "timed_out", "evaluating", "reviewed"].includes(payload.attempt.status)) {
      setNotes(payload.attempt.finalNotes);
    }
  }, [token]);

  const msRemaining = useMemo(() => {
    if (!attempt?.dueAt) return 0;
    return Math.max(0, new Date(attempt.dueAt).getTime() - now);
  }, [attempt?.dueAt, now]);
  const assessmentWindowMs = Math.max(1, durationMin) * 60_000;

  const isLocked = Boolean(attempt && ["submitted", "timed_out", "evaluating", "reviewed"].includes(attempt.status));
  const isPastDeadline = Boolean(attempt?.dueAt && msRemaining <= 0);
  const shouldPoll =
    Boolean(attempt) &&
    (["workspace_provisioning", "failed", "submitted", "timed_out", "evaluating"].includes(attempt?.status ?? "") ||
      (attempt?.status === "in_progress" && isPastDeadline));
  const isCliWorkspace = attempt?.workspace?.metadata?.opencodePrimarySurface === "cli";
  const legacyOpenCodeUrl = !isLocked && !isCliWorkspace ? attempt?.workspace?.accessUrl ?? null : null;
  const terminalUrl = !isLocked && isCliWorkspace ? attempt?.workspace?.metadata?.terminalUrl ?? attempt?.workspace?.accessUrl ?? null : null;
  const terminalUsername = !isLocked ? attempt?.workspace?.opencodeUser ?? null : null;
  const terminalPassword = !isLocked ? attempt?.workspace?.opencodePass ?? null : null;
  const opencodeWebUrl = !isLocked ? attempt?.workspace?.metadata?.opencodeWebUrl ?? legacyOpenCodeUrl : null;
  const authenticatedWebFallbackUrl = withBasicAuth(opencodeWebUrl, terminalUsername, terminalPassword);
  const appPreviewUrl = !isLocked ? attempt?.workspace?.metadata?.appPreviewUrl ?? null : null;
  const hasDaytonaPreviewGate = isDaytonaPreviewUrl(terminalUrl) || isDaytonaPreviewUrl(appPreviewUrl);
  const workspaceReadyUrl = terminalUrl ?? opencodeWebUrl;
  const statusClass = attempt?.status === "reviewed" ? "green" : attempt?.status === "timed_out" || attempt?.status === "failed" ? "red" : "amber";
  const isProvisioning = attempt?.status === "workspace_provisioning" || (busy && !attempt);
  const provisioningElapsedSeconds = provisioningStartedAt ? Math.max(0, Math.floor((now - provisioningStartedAt) / 1000)) : 0;
  const provisioningSteps = [
    ["Creating secure Daytona devbox", provisioningElapsedSeconds >= 0],
    ["Cloning the task repo", provisioningElapsedSeconds >= 8],
    ["Installing dependencies", provisioningElapsedSeconds >= 18],
    ["Starting terminal-first OpenCode CLI", provisioningElapsedSeconds >= 28],
    ["Starting app preview and web fallback", provisioningElapsedSeconds >= 36]
  ] as const;
  const requiresCamera = Boolean(proctoringConfig?.enabled && proctoringConfig.cameraRequired);
  const requiresScreen = Boolean(proctoringConfig?.enabled && proctoringConfig.screenShareRequired);
  const proctoringReady =
    (!requiresCamera || proctoringStatus.camera === "active") &&
    (!requiresScreen || proctoringStatus.screen === "active") &&
    (!proctoringConfig?.recordVideo || proctoringStatus.cameraRecording === "recording") &&
    (!proctoringConfig?.recordScreen || proctoringStatus.screenRecording === "recording");
  const assessmentRunning = Boolean(attempt && ["workspace_provisioning", "in_progress"].includes(attempt.status));
  const proctoringInterrupted = Boolean(assessmentRunning && !isLocked && proctoringConfig?.enabled && !proctoringReady);
  const missingProctoringItems = [
    requiresCamera && proctoringStatus.camera !== "active" ? "camera" : null,
    requiresScreen && proctoringStatus.screen !== "active" ? "screen sharing" : null,
    proctoringConfig?.recordVideo && proctoringStatus.cameraRecording !== "recording" ? "camera recording" : null,
    proctoringConfig?.recordScreen && proctoringStatus.screenRecording !== "recording" ? "screen recording" : null
  ].filter((item): item is string => Boolean(item));

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (attempt?.status === "workspace_provisioning" && !provisioningStartedAt) {
      setProvisioningStartedAt(Date.now());
    }
    if (attempt?.status === "in_progress" || isLocked) {
      setProvisioningStartedAt(null);
    }
  }, [attempt?.status, isLocked, provisioningStartedAt]);

  useEffect(() => {
    if (!shouldPoll) return;
    const timer = window.setInterval(() => {
      refreshAttempt().catch((err) => setError(err instanceof Error ? err.message : "Unable to refresh assessment."));
    }, 3000);
    return () => window.clearInterval(timer);
  }, [shouldPoll, refreshAttempt, attempt?.status, isPastDeadline]);

  useEffect(() => {
    if (!attempt) return;
    refreshAttempt().catch(() => undefined);
  }, [refreshAttempt]);

  useEffect(() => {
    if (!attempt) return;
    const heartbeat = window.setInterval(() => {
      fetch(`/api/candidate/${token}/heartbeat`, { method: "POST" }).catch(() => undefined);
    }, 30_000);
    return () => window.clearInterval(heartbeat);
  }, [attempt, token]);

  useEffect(() => {
    if (!attempt || !isPastDeadline || isLocked) return;
    void stopAndUploadRecordings();
  }, [attempt, isPastDeadline, isLocked]);

  useEffect(() => {
    const flushRecorderData = () => {
      for (const item of mediaRecordersRef.current) {
        if (item.recorder.state === "recording") item.recorder.requestData();
      }
    };

    document.addEventListener("visibilitychange", flushRecorderData);
    window.addEventListener("pagehide", flushRecorderData);
    return () => {
      document.removeEventListener("visibilitychange", flushRecorderData);
      window.removeEventListener("pagehide", flushRecorderData);
    };
  }, []);

  useEffect(() => {
    return () => {
      for (const stream of proctoringStreamsRef.current) {
        for (const track of stream.getTracks()) track.stop();
      }
    };
  }, []);

  async function recordProctoringEvent(eventType: string, details?: Record<string, unknown>) {
    await fetch(`/api/candidate/${token}/proctoring`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ eventType, details })
    }).catch(() => undefined);
  }

  async function initChunkedUpload(item: RecorderItem, mimeType: string): Promise<boolean> {
    void recordProctoringEvent(`${item.kind}_init_attempt`, { mimeType });
    let response: Response;
    try {
      response = await fetch(`/api/candidate/${token}/proctoring/recording/init`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: item.kind, mimeType })
      });
    } catch (err) {
      void recordProctoringEvent(`${item.kind}_init_failed`, {
        reason: "fetch_threw",
        message: err instanceof Error ? err.message : String(err)
      });
      return false;
    }

    if (!response.ok) {
      let bodyExcerpt: string | null = null;
      try {
        bodyExcerpt = (await response.text()).slice(0, 200);
      } catch {}
      void recordProctoringEvent(`${item.kind}_init_failed`, {
        reason: "non_ok_response",
        status: response.status,
        statusText: response.statusText,
        bodyExcerpt
      });
      return false;
    }

    let payload: { uploadId?: string; key?: string; bucket?: string } | null = null;
    try {
      payload = await response.json();
    } catch (err) {
      void recordProctoringEvent(`${item.kind}_init_failed`, {
        reason: "json_parse_failed",
        message: err instanceof Error ? err.message : String(err)
      });
      return false;
    }

    if (!payload?.uploadId || !payload?.key) {
      void recordProctoringEvent(`${item.kind}_init_failed`, {
        reason: "malformed_response",
        hasUploadId: Boolean(payload?.uploadId),
        hasKey: Boolean(payload?.key)
      });
      return false;
    }

    item.uploadId = payload.uploadId;
    item.key = payload.key;
    item.mode = "chunked";
    void recordProctoringEvent(`${item.kind}_init_ok`, {
      uploadId: payload.uploadId,
      key: payload.key,
      bucket: payload.bucket ?? null
    });
    return true;
  }

  async function uploadOnePart(item: RecorderItem, blob: Blob, partNumber: number, attempt = 0): Promise<void> {
    try {
      const signResponse = await fetch(`/api/candidate/${token}/proctoring/recording/part`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: item.kind, partNumber })
      });
      if (!signResponse.ok) throw new Error(`part sign failed: ${signResponse.status}`);
      const signPayload = await signResponse.json();
      if (!signPayload?.url) throw new Error("part sign missing url");

      const putResponse = await fetch(signPayload.url, { method: "PUT", body: blob });
      if (!putResponse.ok) throw new Error(`R2 PUT failed: ${putResponse.status}`);
      // R2 returns the ETag header on UploadPart; CORS ExposeHeaders
      // must include ETag for the browser to see it.
      const etag = putResponse.headers.get("ETag") ?? putResponse.headers.get("etag");
      if (!etag) throw new Error("R2 PUT response missing ETag header (check bucket CORS)");

      await fetch(`/api/candidate/${token}/proctoring/recording/part-complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: item.kind, partNumber, etag, bytes: blob.size })
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (attempt < 4) {
        void recordProctoringEvent(`${item.kind}_part_retry`, {
          partNumber,
          attempt,
          bytes: blob.size,
          reason
        });
        const backoffMs = Math.min(8000, 500 * Math.pow(2, attempt));
        await new Promise((resolve) => setTimeout(resolve, backoffMs));
        return uploadOnePart(item, blob, partNumber, attempt + 1);
      }
      // Surrender after 5 tries; the part will be missing from the
      // final video. Surfaced via the server-side partsCompleted log
      // and an explicit telemetry event so it shows in EventLog.
      void recordProctoringEvent(`${item.kind}_part_exhausted`, {
        partNumber,
        attempts: attempt + 1,
        bytes: blob.size,
        reason
      });
      console.error(`Proctoring part upload failed for ${item.kind}#${partNumber}`, err);
    }
  }

  function flushBufferedPart(item: RecorderItem, force: boolean) {
    if (item.mode !== "chunked") return;
    if (item.pendingBytes === 0) return;
    if (!force && item.pendingBytes < PROCTORING_MIN_PART_BYTES) return;

    const partNumber = item.nextPartNumber;
    item.nextPartNumber += 1;
    const partBlob = new Blob(item.pendingBuffer, { type: item.recorder.mimeType || "video/webm" });
    item.pendingBuffer = [];
    item.pendingBytes = 0;
    item.inflightParts.add(partNumber);

    const work = uploadOnePart(item, partBlob, partNumber).finally(() => {
      item.inflightParts.delete(partNumber);
    });
    item.partCompletions.push(work);
  }

  function startRecording(kind: "camera" | "screen", stream: MediaStream) {
    const recordingKey = kind === "camera" ? "cameraRecording" : "screenRecording";
    if (typeof MediaRecorder === "undefined") {
      setProctoringStatus((current) => ({ ...current, [recordingKey]: "unsupported" }));
      return;
    }
    if (mediaRecordersRef.current.some((item) => item.kind === kind && item.recorder.state === "recording")) return;

    const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp8") ? "video/webm;codecs=vp8" : "video/webm";
    const recorder = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: kind === "screen" ? 180_000 : 90_000
    });

    const item: RecorderItem = {
      kind,
      recorder,
      startedAt: Date.now(),
      mode: "pending",
      uploadId: null,
      key: null,
      nextPartNumber: 1,
      pendingBuffer: [],
      pendingBytes: 0,
      inflightParts: new Set(),
      partCompletions: [],
      legacyChunks: []
    };

    recorder.addEventListener("dataavailable", (event) => {
      if (event.data.size === 0) return;
      if (item.mode === "chunked") {
        item.pendingBuffer.push(event.data);
        item.pendingBytes += event.data.size;
        flushBufferedPart(item, false);
        return;
      }
      // Either pending init (will be reclassified once initChunkedUpload
      // resolves) or fell back to legacy. Either way, hold the chunk
      // in memory for end-of-session upload.
      item.legacyChunks.push(event.data);
    });
    recorder.addEventListener("start", () => {
      setProctoringStatus((current) => ({ ...current, [recordingKey]: "recording" }));
    });
    recorder.addEventListener("stop", () => {
      setProctoringStatus((current) => ({ ...current, [recordingKey]: "stopped" }));
    });
    recorder.start(10_000);
    mediaRecordersRef.current.push(item);

    // Kick off the upload init in parallel. If it succeeds we promote
    // any chunks already buffered into the chunked pipeline; if it
    // fails we leave the recorder in legacy mode.
    void initChunkedUpload(item, mimeType).then((ok) => {
      if (!ok) {
        item.mode = "legacy";
        return;
      }
      // Promote any chunks captured during init into the chunked
      // pipeline so they're not lost.
      for (const chunk of item.legacyChunks) {
        item.pendingBuffer.push(chunk);
        item.pendingBytes += chunk.size;
      }
      item.legacyChunks = [];
      flushBufferedPart(item, false);
    });
  }

  async function stopAndUploadRecordings() {
    if (!attempt || recordingUploadRef.current || mediaRecordersRef.current.length === 0) return;
    recordingUploadRef.current = true;

    // Stop every recorder and wait for the final dataavailable event
    // so the tail of the stream lands in our buffers.
    await Promise.all(
      mediaRecordersRef.current.map(
        (item) =>
          new Promise<void>((resolve) => {
            if (item.recorder.state === "inactive") {
              resolve();
              return;
            }
            item.recorder.addEventListener("stop", () => resolve(), { once: true });
            try {
              item.recorder.requestData();
            } catch {}
            item.recorder.stop();
          })
      )
    );

    let chunkedFinalized = 0;
    let legacyUploaded = 0;

    for (const item of mediaRecordersRef.current) {
      if (item.mode === "chunked") {
        // Flush whatever's left as the final (size-unconstrained) part,
        // wait for every inflight + retry to settle, then finalize.
        flushBufferedPart(item, true);
        await Promise.allSettled(item.partCompletions);
        const partsAttempted = item.nextPartNumber - 1;
        let completeStatus: number | null = null;
        let completeError: string | null = null;
        try {
          const completeResponse = await fetch(`/api/candidate/${token}/proctoring/recording/complete`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ kind: item.kind })
          });
          completeStatus = completeResponse.status;
          if (completeResponse.ok) chunkedFinalized += 1;
        } catch (err) {
          completeError = err instanceof Error ? err.message : String(err);
        }
        void recordProctoringEvent(`${item.kind}_finalize`, {
          mode: "chunked",
          partsAttempted,
          completeStatus,
          completeError
        });
        continue;
      }

      // Legacy / fallback: single end-of-session POST to the original
      // route. Keeps local-dev (no R2 creds) and any browser that
      // failed init working.
      if (item.legacyChunks.length === 0) {
        void recordProctoringEvent(`${item.kind}_finalize`, {
          mode: item.mode,
          partsAttempted: 0,
          legacyBytes: 0,
          note: "no chunks captured"
        });
        continue;
      }
      const blob = new Blob(item.legacyChunks, { type: item.recorder.mimeType || "video/webm" });
      let legacyStatus: number | null = null;
      let legacyError: string | null = null;
      if (blob.size > 0) {
        const form = new FormData();
        form.set("kind", item.kind);
        form.set("file", blob, `${item.kind}-attempt-recording.webm`);
        try {
          const response = await fetch(`/api/candidate/${token}/proctoring/recording`, { method: "POST", body: form });
          legacyStatus = response.status;
          if (response.ok) legacyUploaded += 1;
        } catch (err) {
          legacyError = err instanceof Error ? err.message : String(err);
        }
      }
      void recordProctoringEvent(`${item.kind}_finalize`, {
        mode: item.mode,
        legacyBytes: blob.size,
        legacyStatus,
        legacyError
      });
    }

    await recordProctoringEvent("recordings_uploaded", {
      chunked: chunkedFinalized,
      legacy: legacyUploaded
    });
  }

  async function startCameraCheck() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 480 }, height: { ideal: 270 }, frameRate: { ideal: 10, max: 12 } },
        audio: false
      });
      proctoringStreamsRef.current.push(stream);
      startRecording("camera", stream);
      setProctoringStatus((current) => ({ ...current, camera: "active" }));
      if (cameraPreviewRef.current) {
        cameraPreviewRef.current.srcObject = stream;
        await cameraPreviewRef.current.play().catch(() => undefined);
      }
      for (const track of stream.getVideoTracks()) {
        track.addEventListener("ended", () => {
          setProctoringStatus((current) => ({ ...current, camera: "disconnected" }));
          void recordProctoringEvent("camera_disconnected");
        });
      }
      await recordProctoringEvent("camera_active", { tracks: stream.getVideoTracks().length });
    } catch (err) {
      setProctoringStatus((current) => ({ ...current, camera: "blocked" }));
      await recordProctoringEvent("camera_blocked", { message: err instanceof Error ? err.message : "Camera unavailable" });
      setError("Camera check was blocked or unavailable.");
    }
  }

  async function startScreenCheck() {
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 5, max: 8 } },
        audio: false
      });
      proctoringStreamsRef.current.push(stream);
      startRecording("screen", stream);
      setProctoringStatus((current) => ({ ...current, screen: "active" }));
      await recordProctoringEvent("screen_share_active", { tracks: stream.getVideoTracks().length });
      for (const track of stream.getVideoTracks()) {
        track.addEventListener("ended", () => {
          setProctoringStatus((current) => ({ ...current, screen: "stopped" }));
          void recordProctoringEvent("screen_share_stopped");
        });
      }
    } catch (err) {
      setProctoringStatus((current) => ({ ...current, screen: "blocked" }));
      await recordProctoringEvent("screen_share_blocked", { message: err instanceof Error ? err.message : "Screen sharing unavailable" });
      setError("Screen-share check was blocked or unavailable.");
    }
  }

  async function start() {
    if (!proctoringReady) {
      setError("Turn on camera and screen sharing before starting the timed assessment.");
      return;
    }
    setBusy(true);
    setError(null);
    setProvisioningStartedAt(Date.now());
    try {
      const response = await fetch(`/api/candidate/${token}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          proctoringPreflight: {
            camera: proctoringStatus.camera === "active",
            screen: proctoringStatus.screen === "active",
            recording: proctoringStatus.cameraRecording === "recording" && proctoringStatus.screenRecording === "recording"
          }
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to start the workspace.");
      setAttempt(payload.attempt);
      await recordProctoringEvent("camera_active", { preflight: true });
      await recordProctoringEvent("screen_share_active", { preflight: true });
      await recordProctoringEvent("preflight_passed", {
        camera: proctoringStatus.camera,
        screen: proctoringStatus.screen,
        cameraRecording: proctoringStatus.cameraRecording,
        screenRecording: proctoringStatus.screenRecording
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to start the workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function copyCredential(kind: "username" | "password", value: string) {
    await navigator.clipboard.writeText(value).catch(() => undefined);
    setCopiedCredential(kind);
    window.setTimeout(() => setCopiedCredential(null), 1400);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    const finalNotes = notesRef.current?.value ?? notes;
    try {
      await stopAndUploadRecordings();
      const response = await fetch(`/api/candidate/${token}/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalNotes })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to submit the assessment.");
      setAttempt(payload.attempt);
      setNotes(payload.attempt?.finalNotes ?? finalNotes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to submit the assessment.");
    } finally {
      setBusy(false);
    }
  }

  async function restartPreview() {
    setPreviewRestarting(true);
    setError(null);
    try {
      const response = await fetch(`/api/candidate/${token}/preview/restart`, { method: "POST" });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "Unable to restart preview.");
      await refreshAttempt();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to restart preview.");
    } finally {
      setPreviewRestarting(false);
    }
  }

  return (
    <>
      {isProvisioning ? (
        <div className="provisioning-backdrop" role="dialog" aria-live="polite" aria-label="Workspace provisioning progress">
          <div className="provisioning-dialog">
            <div className="provisioning-dialog-icon">
              <Loader2 size={28} />
            </div>
            <div>
              <p className="eyebrow">Starting workspace</p>
              <h2>Your real devbox is being prepared</h2>
              <p className="muted">
                Daytona is creating the sandbox, installing the repo, and launching OpenCode. This usually takes about a minute.
              </p>
            </div>
            <ol className="provisioning-steps">
              {provisioningSteps.map(([label, active]) => (
                <li className={active ? "active" : ""} key={label}>
                  {active ? <CheckCircle2 size={16} /> : <span className="step-dot" />}
                  <span>{label}</span>
                </li>
              ))}
            </ol>
            <div className="provisioning-dialog-footer">
              <span className="muted">{provisioningElapsedSeconds}s elapsed</span>
              <button className="button secondary" onClick={() => refreshAttempt().catch(() => undefined)} type="button">
                <RefreshCw size={16} />
                Check status
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {proctoringInterrupted ? (
        <div className="proctoring-blocker" role="alert" aria-live="assertive">
          <div>
            <p className="eyebrow">Proctoring interrupted</p>
            <h2>{missingProctoringItems.length === 1 ? `Reconnect ${missingProctoringItems[0]}` : "Reconnect proctoring"}</h2>
            <p className="muted">
              Missing: {missingProctoringItems.join(", ")}. The assessment should continue only while camera, screen share, and recording
              are active.
            </p>
          </div>
          <div className="proctoring-blocker-actions">
            {requiresCamera || proctoringConfig?.recordVideo ? (
              <button className="button secondary" disabled={proctoringStatus.camera === "active"} onClick={startCameraCheck} type="button">
                <Camera size={16} />
                Reconnect camera
              </button>
            ) : null}
            {requiresScreen || proctoringConfig?.recordScreen ? (
              <button className="button secondary" disabled={proctoringStatus.screen === "active"} onClick={startScreenCheck} type="button">
                <MonitorUp size={16} />
                Reconnect screen
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
      {proctoringConfig?.enabled && !isLocked ? (
        <div className={`camera-preview ${proctoringStatus.camera === "active" ? "active" : "inactive"}`} aria-label="Candidate camera preview">
          <video ref={cameraPreviewRef} autoPlay muted playsInline />
          <span>{proctoringStatus.camera === "active" ? "Camera live" : "Camera required"}</span>
        </div>
      ) : null}
      <div className="assessment-layout">
        <section className="grid">
          <div className={workspaceReadyUrl ? "workspace-ready-panel" : "workspace-panel"}>
          {!attempt ? (
            <div>
              <p className="eyebrow">Ready when you are</p>
              <h1>Start the coding environment</h1>
              <p className="muted">The timer starts when the devbox is ready. You will get the repo, model access, tests, and task instructions.</p>
              {proctoringConfig?.enabled ? (
                <p className="muted">Camera, screen sharing, and recording must be active before the timed assessment can start.</p>
              ) : null}
              <button className="button" onClick={start} disabled={busy || !proctoringReady} type="button">
                <Play size={16} />
                {busy ? "Starting" : "Start assessment"}
              </button>
              {!proctoringReady ? <p className="error-text">Complete camera and screen checks first.</p> : null}
              {error ? <p className="error-text">{error}</p> : null}
            </div>
          ) : isLocked ? (
            <div>
              <p className="eyebrow">{attempt.status === "timed_out" ? "Time expired" : "Locked"}</p>
              <h1>{attempt.status === "reviewed" ? "Assessment reviewed" : "Assessment submitted"}</h1>
              <p className="muted">
                The coding workspace is closed for this attempt. Reviewers will use the captured diff, tests, logs, and notes.
              </p>
            </div>
          ) : workspaceReadyUrl ? (
            <>
              <div className="preview-warning-callout">
                {terminalUrl ? <SquareTerminal size={18} /> : <ShieldAlert size={18} />}
                <div>
                  <strong>{terminalUrl ? "Terminal-first workspace is live" : "Workspace is live"}</strong>
                  <span>
                    {terminalUrl
                      ? `OpenCode CLI is the primary coding surface. The browser preview stays beside it, and OpenCode Web is available only as fallback.${
                          hasDaytonaPreviewGate ? " If Daytona shows a Preview URL Warning, click I Understand, Continue once inside each frame." : ""
                        }`
                      : "This older attempt is using the OpenCode Web surface. New workspaces launch the faster CLI terminal by default."}
                  </span>
                </div>
              </div>
              <div className="workspace-split">
                <section className="embedded-tool">
                  <div className="embedded-tool-header">
                    <div>
                      <p className="eyebrow">Terminal</p>
                      <h2>{terminalUrl ? "OpenCode CLI" : "OpenCode Web"}</h2>
                    </div>
                    <span className="status green">{terminalUrl ? "primary" : "legacy"}</span>
                  </div>
                  {terminalUrl ? (
                    <>
                      <div className="terminal-guidance">
                        <div>
                          <strong>Work here first.</strong>
                          <span>Use this terminal like Claude Code, Codex, or OpenCode CLI. Commit meaningful checkpoints; evals run after each commit.</span>
                        </div>
                        {appPreviewUrl ? (
                          <a className="button secondary compact-button" href={appPreviewUrl} target="_blank" rel="noreferrer">
                            <ExternalLink size={14} />
                            Open app preview
                          </a>
                        ) : null}
                      </div>
                      <iframe
                        allow="clipboard-read; clipboard-write"
                        className="tool-frame terminal-frame"
                        loading="eager"
                        referrerPolicy="no-referrer"
                        src={terminalUrl}
                        title="OpenCode CLI terminal"
                      />
                    </>
                  ) : (
                    <iframe
                      allow="clipboard-read; clipboard-write"
                      className="tool-frame"
                      loading="eager"
                      referrerPolicy="no-referrer"
                      src={authenticatedWebFallbackUrl ?? opencodeWebUrl ?? ""}
                      title="OpenCode Web"
                    />
                  )}
                  {terminalUrl && opencodeWebUrl ? (
                    <div className="fallback-panel">
                      <button className="button secondary" onClick={() => setShowWebFallback((current) => !current)} type="button">
                        <ShieldAlert size={16} />
                        {showWebFallback ? "Hide OpenCode Web fallback" : "Show OpenCode Web fallback"}
                      </button>
                      <span className="muted">Use only if the CLI terminal is unavailable.</span>
                    </div>
                  ) : null}
                  {terminalUrl && showWebFallback && opencodeWebUrl ? (
                    <div className="web-fallback">
                      {terminalUsername && terminalPassword ? (
                    <div className="workspace-auth-strip">
                      <KeyRound size={18} />
                      <div>
                            <strong>OpenCode Web sign-in</strong>
                        <span>If a browser sign-in dialog appears, use these credentials.</span>
                      </div>
                      <button className="credential-chip" onClick={() => copyCredential("username", terminalUsername)} type="button">
                        <span>User</span>
                        <strong>{terminalUsername}</strong>
                        <Copy size={14} />
                      </button>
                      <button className="credential-chip" onClick={() => copyCredential("password", terminalPassword)} type="button">
                        <span>Password</span>
                        <strong>{copiedCredential === "password" ? "Copied" : terminalPassword}</strong>
                        <Copy size={14} />
                      </button>
                    </div>
                      ) : null}
                      <iframe
                        allow="clipboard-read; clipboard-write"
                        className="tool-frame fallback-frame"
                        loading="lazy"
                        referrerPolicy="no-referrer"
                        src={authenticatedWebFallbackUrl ?? opencodeWebUrl}
                        title="OpenCode Web fallback"
                      />
                    </div>
                  ) : null}
                </section>
                <section className="embedded-tool">
                  <div className="embedded-tool-header">
                    <div>
                      <p className="eyebrow">Browser</p>
                      <h2>App preview</h2>
                    </div>
                    <div className="preview-header-actions">
                      <span className="status amber">{appPreviewUrl ? "live" : "waiting"}</span>
                      {appPreviewUrl ? (
                        <button className="button secondary compact-button" disabled={previewRestarting} onClick={restartPreview} type="button">
                          <RefreshCw size={14} />
                          {previewRestarting ? "Restarting" : "Restart preview"}
                        </button>
                      ) : null}
                      {appPreviewUrl ? (
                        <a className="button secondary compact-button" href={appPreviewUrl} target="_blank" rel="noreferrer">
                          <ExternalLink size={14} />
                          Open full tab
                        </a>
                      ) : null}
                    </div>
                  </div>
                  {appPreviewUrl ? (
                    <div className="preview-guidance">
                      <strong>Test your work here.</strong>
                      <span>Use this Daytona app URL to review the running server. `localhost:3000` only works inside the devbox terminal.</span>
                    </div>
                  ) : null}
                  {appPreviewUrl ? (
                    <iframe
                      className="tool-frame"
                      loading="eager"
                      referrerPolicy="no-referrer"
                      src={appPreviewUrl}
                      title="Application preview"
                    />
                  ) : (
                    <div className="preview-empty">Run the app from the terminal to use the preview.</div>
                  )}
                </section>
              </div>
            </>
          ) : attempt.status === "failed" ? (
            <div className="workspace-failed-state">
              <p className="eyebrow">Workspace failed</p>
              <h1>We could not start this devbox</h1>
              <p className="muted">
                This is usually a provisioning or task repo issue, not candidate work. Retry will create a fresh Daytona devbox and keep the timer paused
                until it is ready.
              </p>
              <button className="button" onClick={start} disabled={busy || !proctoringReady} type="button">
                <RefreshCw size={16} />
                {busy ? "Retrying" : "Retry workspace"}
              </button>
              {!proctoringReady ? <p className="error-text">Reconnect camera and screen sharing before retrying.</p> : null}
              {error ? <p className="error-text">{error}</p> : null}
            </div>
          ) : (
            <div>
              <p className="eyebrow">Provisioning</p>
              <h1>Your devbox is coming online</h1>
              <p className="muted">This page will update automatically when OpenCode and the app preview are ready.</p>
            </div>
          )}
        </div>
        {attempt ? (
          <div className="card grid">
            <h2>Submit work</h2>
            <textarea
              ref={notesRef}
              className="textarea"
              value={notes}
              disabled={Boolean(isLocked)}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Optional: tell the reviewer what changed and what you verified."
            />
            <button className="button" disabled={busy || Boolean(isLocked) || isPastDeadline || proctoringInterrupted} onClick={submit} type="button">
              <Send size={16} />
              {isLocked ? "Assessment locked" : isPastDeadline ? "Time expired" : proctoringInterrupted ? "Reconnect proctoring" : "Submit assessment"}
            </button>
            {error ? <p className="error-text">{error}</p> : null}
          </div>
        ) : null}
      </section>
      <aside className="grid">
        <div className="card">
          <p className="eyebrow">Time remaining</p>
          <div className="timer">{isLocked ? "Locked" : attempt?.dueAt ? formatTimer(msRemaining) : formatTimer(assessmentWindowMs)}</div>
          <p className="muted">Submissions lock after the assessment window closes.</p>
        </div>
        <div className="card">
          <p className="eyebrow">What matters</p>
          <h2>Role signal</h2>
          <p className="muted">Plan the work, build useful evidence, improve test/eval confidence, and use the AI agent with judgment.</p>
        </div>
        {proctoringConfig?.enabled ? (
          <div className="card">
            <p className="eyebrow">Proctoring</p>
            <h2>Camera and screen</h2>
            <p className="muted">
              Start camera and screen sharing before the timer begins. The session is recorded and uploaded with the final reviewer packet.
            </p>
            {isLocked ? (
              <p className="status green">events captured</p>
            ) : (
              <div className="proctoring-actions">
                <button className="button secondary" disabled={proctoringStatus.camera === "active"} onClick={startCameraCheck} type="button">
                  <Camera size={16} />
                  Camera
                </button>
                <span
                  className={`status ${
                    proctoringStatus.camera === "active"
                      ? "green"
                      : proctoringStatus.camera === "blocked" || proctoringStatus.camera === "disconnected"
                        ? "red"
                        : "amber"
                  }`}
                >
                  {statusLabel(proctoringStatus.camera)}
                </span>
                <button className="button secondary" disabled={proctoringStatus.screen === "active"} onClick={startScreenCheck} type="button">
                  <MonitorUp size={16} />
                  Screen
                </button>
                <span
                  className={`status ${
                    proctoringStatus.screen === "active" ? "green" : proctoringStatus.screen === "blocked" || proctoringStatus.screen === "stopped" ? "red" : "amber"
                  }`}
                >
                  {statusLabel(proctoringStatus.screen)}
                </span>
                <div className="proctoring-recording-status">
                  <Video size={16} />
                  <span
                    className={`status ${
                      proctoringStatus.cameraRecording === "recording"
                        ? "green"
                        : proctoringStatus.cameraRecording === "unsupported"
                          ? "red"
                          : "amber"
                    }`}
                  >
                    Camera: {statusLabel(proctoringStatus.cameraRecording)}
                  </span>
                  <span
                    className={`status ${
                      proctoringStatus.screenRecording === "recording"
                        ? "green"
                        : proctoringStatus.screenRecording === "unsupported"
                          ? "red"
                          : "amber"
                    }`}
                  >
                    Screen: {statusLabel(proctoringStatus.screenRecording)}
                  </span>
                </div>
              </div>
            )}
          </div>
        ) : null}
        <div className="card">
          <p className="eyebrow">Status</p>
          <span className={`status ${statusClass}`}>{attempt?.status ?? "not_started"}</span>
        </div>
      </aside>
      </div>
    </>
  );
}
