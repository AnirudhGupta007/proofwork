import { z } from "zod";

const serverEnvSchema = z.object({
  NEXT_PUBLIC_APP_URL: z.string().url().default("http://localhost:3000"),
  ASSESSMENT_TASK_REPO_URL: z.string().url().optional(),
  INVITE_EMAIL_FROM: z.string().default("Proofwork <noreply@example.com>"),
  CANDIDATE_REPORT_EMAIL_TO: z.string().email().default("reports@example.com"),
  // Local FS fallback for proctoring recordings used when R2_* env is
  // unset (local dev without R2 creds). In dev/stage/prod the pod's
  // Env-provided ARTIFACT_BUCKET + R2_* take over and recordings
  // stream to Cloudflare R2 instead — see app/lib/storage/r2.ts.
  PROCTORING_STORAGE_DIR: z.string().default("storage/proctoring"),
  // Cloudflare R2 (S3-compatible) — per-env bucket (proofwork-dev,
  // proofwork-prod) in a single R2 account. All fields
  // optional so a local dev shell without R2 vars still boots; the
  // r2 client treats them as a single all-or-nothing group.
  ARTIFACT_BUCKET: z.string().optional(),
  R2_ACCOUNT_ID: z.string().optional(),
  R2_ENDPOINT: z.string().url().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_SIGNED_URL_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REPORT_EMAIL_MAX_ATTACHMENT_BYTES: z.coerce.number().int().positive().default(35_000_000),
  RESEND_API_KEY: z.string().optional(),
  RAZORPAY_KEY_ID: z.string().optional(),
  RAZORPAY_KEY_SECRET: z.string().optional(),
  RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
  DAYTONA_API_KEY: z.string().optional(),
  DAYTONA_ORGANIZATION_ID: z.string().optional(),
  OPENCODE_MODEL_PROVIDER: z.string().default("deepseek"),
  OPENCODE_MODEL_NAME: z.string().default("deepseek-chat"),
  OPENCODE_SMALL_MODEL_NAME: z.string().optional(),
  OPENCODE_TERMINAL_PORT: z.coerce.number().int().positive().default(7681),
  OPENCODE_WEB_PORT: z.coerce.number().int().positive().default(4096),
  OPENCODE_WEB_FALLBACK_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  ASSESSMENT_GENERATOR_MODEL: z.string().default("gpt-5.5"),
  OPENCODE_PROVIDER_TIMEOUT_MS: z.coerce.number().int().positive().default(180_000),
  OPENCODE_PROVIDER_CHUNK_TIMEOUT_MS: z.coerce.number().int().positive().default(45_000),
  // Override the Daytona sandbox base image. Empty (default) uses the
  // upstream daytonaio/sandbox image. Set to registry.example.com/
  // proofwork/runtime:<tag> to use the proofwork pre-baked image
  // (Node22 + opencode + tsc + Python + Go ready on disk) so the
  // warm-pool can skip ~60-90s of npm install per cold start.
  WORKSPACE_SANDBOX_IMAGE: z.string().default(""),
  // Daytona snapshot NAME (preferred over WORKSPACE_SANDBOX_IMAGE when
  // both are set). The build-sandbox-export.yml workflow re-registers
  // the 'proofwork-runtime' snapshot after every successful image
  // push; setting this to that name lets Daytona spawn sandboxes from
  // its pre-pulled snapshot rather than pulling the OCI image fresh
  // each time. Big win for cold-sandbox latency.
  WORKSPACE_DAYTONA_SNAPSHOT: z.string().default(""),
  EVALUATION_MODEL: z.string().default("gpt-5.5"),
  OPENCODE_REQUIRE_PASSWORD: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  OPENCODE_SERVER_USERNAME: z.string().default("opencode"),
  OPENCODE_SERVER_PASSWORD: z.string().optional(),
  // Warm-pool of pre-provisioned Daytona sandboxes per assessment
  // template. Off by default; enable per env when the pool service is
  // healthy. See app/lib/workspaces/pool.ts.
  WORKSPACE_POOL_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  WORKSPACE_POOL_SIZE_PER_TEMPLATE: z.coerce.number().int().min(0).max(20).default(2),
  WORKSPACE_POOL_TTL_HOURS: z.coerce.number().int().positive().default(24),
  OPENAI_API_KEY: z.string().optional(),
  DEEPSEEK_API_KEY: z.string().optional(),
  GITHUB_APP_SLUG: z.string().optional(),
  // Clerk keys are read via this centralized schema (Zod parses process.env
  // as a whole object) so Next.js's compile-time replacement of `process.env.NAME`
  // accesses doesn't fire — values become runtime-discoverable, matching how
  // genui treats env access. Pass the publishable key to <ClerkProvider> as an
  // explicit prop so the client bundle gets it via SSR hydration, not a baked
  // build-time inline.
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: z.string().optional(),
  CLERK_SECRET_KEY: z.string().optional()
});

export const env = serverEnvSchema.parse(process.env);
