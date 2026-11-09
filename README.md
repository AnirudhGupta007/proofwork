# Proofwork

Proofwork is an AI-native hiring assessment platform. It replaces trivia-heavy live coding loops with evidence-rich work trials: employers generate role-specific assessments, invite candidates by email, candidates work in a hosted devbox with OpenCode CLI and an app preview, and reviewers receive a scored report with code evidence, tests, logs, proctoring artifacts, and human override.

## What It Does

- Employer onboarding with Clerk authentication and company profile setup.
- Assessment generation from a role/JD, pasted JD text, uploaded JD files, or a project brief.
- Saved assessment templates so teams can reuse generated tasks across applicants.
- Support for generated starter projects and GitHub-backed existing-codebase assessments.
- Invite-only candidate links with per-invite proctoring controls.
- Daytona workspace provisioning with a real repo clone/starter repo, dependency install, app server, OpenCode CLI terminal, and OpenCode Web fallback.
- Candidate surface with task brief, definition of done, timer, terminal-first coding environment, browser preview, proctoring checks, and submission.
- Preview restart action when the app server dies during agent/test loops.
- Automated evaluation flow that collects diffs, tests, commit logs, OpenCode evidence, proctoring recordings, and report artifacts.
- GPT-powered assessment idea generation and scoring/report generation.
- PDF candidate reports emailed via Resend.
- Admin dashboard for invitations, attempts, reports, billing, interviewers, templates, and reviewer scorecards.
- Human-in-the-loop interview panel support with interviewer availability, candidate slot booking, calendar email, interview feedback, and transcript/event evidence.
- Razorpay checkout scaffolding for assessment-credit purchases.

## Stack

- Next.js App Router
- TypeScript
- Prisma + PostgreSQL
- Clerk for employer auth
- Resend for emails
- Daytona for managed candidate workspaces
- OpenCode CLI/Web for AI-assisted candidate coding
- DeepSeek as the fast candidate coding model by default
- GPT-5.5 configured for assessment generation and final evaluation/reporting
- PDFKit for candidate reports
- Razorpay payment integration

## Repository Layout

```text
app/
  admin/                  Employer dashboard pages
  api/                    Admin, candidate, billing, proctoring, and interview APIs
  assessment/[token]/     Candidate assessment page
  components/             Shared UI and workflow components
  lib/                    Domain logic, providers, evals, reports, email, billing
  onboarding/             Employer onboarding
  sign-in, sign-up/       Clerk auth screens
prisma/
  schema.prisma           Core data model
scripts/
  e2e and utility scripts for assessment/testing flows
task-template/
  Generated starter repo template uploaded into candidate workspaces
tests/
  Node test suite for domain and generation logic
```

## Local Setup

Install dependencies:

```bash
npm install
```

Create your environment file:

```bash
cp .env.example .env
```

Start local Postgres:

```bash
docker compose up -d postgres
```

Sync the Prisma schema:

```bash
npm run db:push
```

Run the app:

```bash
npm run dev -- --port 3001
```

Open:

```text
http://localhost:3001
```

## Environment Variables

The app validates server-side environment in `app/lib/env.ts`. For local development, use `.env.example` as the starting point.

Required for a real end-to-end workspace flow:

```env
DATABASE_URL=
NEXT_PUBLIC_APP_URL=
DAYTONA_API_KEY=
DAYTONA_ORGANIZATION_ID=
DEEPSEEK_API_KEY=
OPENAI_API_KEY=
RESEND_API_KEY=
INVITE_EMAIL_FROM=
```

Auth:

```env
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=
CLERK_SECRET_KEY=
```

OpenCode/model configuration:

```env
OPENCODE_MODEL_PROVIDER=deepseek
OPENCODE_MODEL_NAME=deepseek-chat
OPENCODE_SMALL_MODEL_NAME=deepseek-chat
OPENCODE_TERMINAL_PORT=7681
OPENCODE_WEB_PORT=4096
OPENCODE_WEB_FALLBACK_ENABLED=true
OPENCODE_REQUIRE_PASSWORD=false
ASSESSMENT_GENERATOR_MODEL=gpt-5.5
EVALUATION_MODEL=gpt-5.5
```

Optional integrations:

```env
GITHUB_APP_SLUG=
RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=
RAZORPAY_WEBHOOK_SECRET=
CANDIDATE_REPORT_EMAIL_TO=
PROCTORING_STORAGE_DIR=
REPORT_EMAIL_MAX_ATTACHMENT_BYTES=
```

Never commit `.env`; it is ignored.

## Development Workflow

Use the fake workspace provider for quick UI work when Daytona is not needed:

```bash
WORKSPACE_PROVIDER=fake npm run dev -- --port 3001
```

Use Daytona for real candidate workspace testing:

```bash
npm run dev -- --port 3001
```

Then create an assessment, send an invite, open the candidate link, and start the assessment.

## Verification

Run unit/domain tests:

```bash
npm test
```

Run TypeScript checks:

```bash
npx tsc --noEmit
```

Run a production build:

```bash
npm run build
```

## Candidate Workspace Flow

1. Employer sends an invite.
2. Candidate opens the magic link.
3. If proctoring is required, camera, screen share, and recording must be active before the timed work begins.
4. Daytona provisions a devbox.
5. The task repo is prepared with `README.md`, `TASK.md`, `EVALS.md`, model credentials, OpenCode config, and a baseline commit.
6. OpenCode CLI runs in a first-party browser terminal.
7. The app preview runs on port `3000` and is exposed through a signed Daytona URL.
8. Candidates work in commits; commit hooks capture checkpoint evidence.
9. On submit or timeout, artifacts are collected and evaluated.

## Assessment Design Notes

Proofwork is designed to test modern product-engineering work:

- Understanding ambiguous product/user context.
- Planning and deciding what not to build.
- Using AI agents with judgment instead of blind one-shot prompting.
- Shipping a scoped implementation.
- Adding meaningful tests/evals.
- Debugging and verifying the result.
- Communicating tradeoffs, risks, and next iteration.

The platform intentionally avoids DSA-style puzzle evaluation as the primary signal.

## Reports

Candidate reports include:

- Candidate, email, position, and assessment metadata.
- Overall score and hire recommendation.
- Rubric breakdown.
- Requirements/test/eval evidence.
- Commit and prompt-quality signals.
- Proctoring events and recordings when captured.
- Reviewer override support.

Reports are generated as PDFs and can be emailed through Resend.

## GitHub-Backed Assessments

The UI includes a GitHub connection path for private repos. Production private-repo support expects a GitHub App:

1. Create/install a GitHub App on selected repositories.
2. Set `GITHUB_APP_SLUG`.
3. Store installation access securely.
4. Clone a fresh copy per candidate workspace.

Generated starter repos work without GitHub and are uploaded from `task-template/`.

## Payments

Billing is modeled as assessment credits. The app includes Razorpay order/verification/webhook routes and a billing UI. Configure Razorpay environment variables before testing real payments.

## Safety

- `.env`, build output, local reports, storage, and temporary files are ignored.
- Candidate workspaces receive scoped model credentials through generated `.env.local`.
- Hidden eval materials should stay outside the candidate-visible repo.
- OpenCode Web is fallback only; the CLI terminal is the primary coding surface.
