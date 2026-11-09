# Proofwork app image.
#
# Build layout:
#   base   — shared system deps (alpine + libc6-compat + openssl).
#            Reused by every later stage so apt/apk runs once per cache.
#   deps   — npm ci with ONLY package*.json (max cache reuse — every
#            source-only change skips this layer).
#   builder — `npm run build` (Next standalone output) + `prisma generate`.
#            Output: .next/standalone, .next/static, public/.
#   runner  — slim runtime: COPY ONLY the standalone bundle. No tsc,
#            no eslint, no dev deps. Drops the image from ~494 MB to
#            ~150 MB.
#
# Why standalone (output: "standalone" in next.config.ts):
#   The previous Dockerfile did `COPY --from=builder /app ./` which
#   pulled the entire builder filesystem incl. full node_modules.
#   Standalone traces only what the running server imports + bundles
#   a minimal node_modules. Faster pulls on Kaniko + smaller pod cold
#   start. Also lets us run via `node server.js` instead of
#   `npm run start` (one less process layer).

FROM node:22-alpine@sha256:968df39aedcea65eeb078fb336ed7191baf48f972b4479711397108be0966920 AS base
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app

# ── deps: cache the heaviest layer behind package-files-only ────────
FROM base AS deps
COPY package.json package-lock.json ./
# `--prefer-offline` reuses Kaniko's cache when present; `--no-audit`
# + `--no-fund` skip the network round-trips Next builds don't need.
RUN npm ci --prefer-offline --no-audit --no-fund

# ── builder: prisma generate + next build ──────────────────────────
FROM base AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
# Prisma schema first so `prisma generate` only re-runs on schema
# changes, not on every code edit.
COPY prisma ./prisma
RUN npx prisma generate
# Now the rest of the source. .dockerignore drops .git/.next/node_modules
# /storage so this stays cheap.
COPY . .
RUN npm run build

# ── runner: minimal standalone server ───────────────────────────────
FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

RUN addgroup -S nodejs && adduser -S nextjs -G nodejs

# Standalone bundle: server.js + traced minimal node_modules.
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# Static assets aren't part of standalone — they're served by Next's
# server but ship as separate folders. (proofwork has no public/
# directory today, so we don't COPY it. Add a COPY line here if a
# public/ ever lands in the repo.)
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static
# The chart's migrateJob runs `npx prisma db push --skip-generate`
# against the same image at PreSync. Standalone tracing only includes
# what server.js imports (@prisma/client) — not the prisma CLI nor
# its transitive deps like `effect` that @prisma/config pulls in.
# Tried per-package COPY (prisma + @prisma + .bin/prisma) but the
# CLI failed at runtime with `Cannot find module 'effect'`.
# Cleanest: install prisma globally in the runner. ~80 MB cost
# but covers the full transitive tree the CLI needs.
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
RUN npm install -g --no-audit --no-fund prisma@^6.5.0

USER nextjs
EXPOSE 3000

# server.js is Next's standalone entry. No npm/no extra fork — drops
# ~100 ms of cold start vs `npm run start`.
CMD ["node", "server.js"]
