# Proofwork sandbox runtime — Daytona snapshot for assessment devboxes.
#
# Two layers of pre-baking on top of daytonaio/sandbox:0.5.0-slim:
#
# A. Toolchain (cheap, generic across all templates)
#    - Node.js 22 + npm
#    - opencode-ai CLI + ws + @xterm/xterm + @xterm/addon-fit at
#      /opt/opencode-bin/node_modules (symlinked to ~/.opencode-bin at
#      runtime by the cold-path setup script)
#    - TypeScript (tsc) + ts-node global
#    - Python 3 + pip + numpy/pandas/matplotlib
#    - Go toolchain (Debian apt)
#
# B. Per-template baseline (task-template/ + npm install + baseline git)
#    Lives at /home/daytona/task. After this bake, warm-pool sandboxes
#    spawn directly from this snapshot with the dir ready to go — no
#    runtime mkdir / upload / install / git init / commit needed. Warm
#    becomes ~1-second sandbox-create. Attach handles only per-attempt
#    work (env file overwrite, opencode.json, commit hook with the
#    attemptId, dev server + opencode start).
#
# If a future template needs different starter files, build a second
# image (a matrix entry in build-sandbox-export.yml) and route via
# WORKSPACE_DAYTONA_SNAPSHOT (per env, per pool).

FROM daytonaio/sandbox:0.5.0-slim@sha256:6ae0248dfa2a624ad6e43afd07a6cf03a387f635ced7978497473eedd7b89a66

ARG IMAGE_VERSION=dev
LABEL org.opencontainers.image.title="proofwork-runtime"
LABEL org.opencontainers.image.description="Daytona snapshot with Node22 + opencode + TS + Python + Go + baked task-template/ for Proofwork assessments"
LABEL org.opencontainers.image.source="https://github.com/AnirudhGupta007/proofwork"
LABEL org.opencontainers.image.version="${IMAGE_VERSION}"

USER root

# Ensure the daytona user (UID 1000) exists. daytonaio/sandbox:0.5.0-slim
# doesn't seed /etc/passwd with the name, so subsequent `chown
# daytona:daytona` + `USER daytona` steps fail with "user daytona is
# not a uid and does not exist". Creating it up-front fixes both.
RUN id daytona >/dev/null 2>&1 || ( \
      groupadd -g 1000 daytona && \
      useradd -u 1000 -g 1000 -m -s /bin/bash daytona \
    )

# ── A. Toolchain ────────────────────────────────────────────────────
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      build-essential \
      python3 \
      python3-pip \
      python3-venv \
 && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
 && apt-get install -y --no-install-recommends nodejs \
 && rm -rf /var/lib/apt/lists/* \
 && node --version \
 && npm --version

RUN npm install -g --no-audit --no-fund typescript@5 ts-node@10

RUN mkdir -p /opt/opencode-bin \
 && cd /opt/opencode-bin \
 && npm init -y >/dev/null \
 && npm install --no-audit --no-fund \
      opencode-ai \
      ws \
      node-pty \
      @xterm/xterm \
      @xterm/addon-fit \
 && chown -R daytona:daytona /opt/opencode-bin

# Prebaked terminal server. Placed in the SAME directory as its
# node_modules so the ESM `import { WebSocketServer } from "ws"`
# resolves without symlink traversal — the cold node startup drops
# from ~80-130s to ~5s on a freshly-spawned Daytona sandbox.
COPY --chown=daytona:daytona docker/sandbox/files/proofwork-terminal-server.mjs /opt/opencode-bin/proofwork-terminal-server.mjs

RUN pip3 install --no-cache-dir --break-system-packages \
      'numpy>=1.26,<3' \
      'pandas>=2.2,<3' \
      'matplotlib>=3.8,<4'

RUN apt-get update \
 && apt-get install -y --no-install-recommends golang-go \
 && rm -rf /var/lib/apt/lists/*

ENV PATH=/opt/opencode-bin/node_modules/.bin:${PATH}
ENV GOPATH=/home/daytona/go

# ── B. Per-template baseline ────────────────────────────────────────
#
# task-template/ is the starter code proofwork uses for placeholder-
# repo assessments (the only kind today). Copying it here at build
# time means a warm-pool sandbox spawned from this snapshot has the
# directory ready: no mkdir/upload/install/init/commit needed at
# runtime.
#
# Build context for this Dockerfile is the full proofwork repo root
# (see build-sandbox-export.yml: context_sub_path="" for the proofwork
# matrix entry), so the COPY path is relative to the repo root.

COPY --chown=daytona:daytona task-template/ /home/daytona/task/

# .gitignore must be in place BEFORE the baseline commit so the
# excluded paths (.env*, node_modules/, .next/, .opencode/, etc.)
# don't end up tracked.
RUN cd /home/daytona/task \
 && printf '%s\n' '.env*' 'node_modules/' '.next/' '.opencode/' '.platform-hidden/' > .gitignore \
 && chown daytona:daytona .gitignore

# npm install for the task-template's deps. For the current template
# (clawchat-assessment, zero deps) this is essentially a no-op, but
# the layer is here so a future template with deps gets them baked.
# --omit=optional + --no-audit + --no-fund keep the layer slim.
USER daytona
WORKDIR /home/daytona/task
RUN test -f package.json && npm install --no-audit --no-fund --omit=optional || true

# git init + baseline commit so candidate commits during the assessment
# get diff'd against a known baseline. Author identity matches the
# cold-path's previous baseline_commit step.
RUN git init -b main \
 && git config user.email platform@example.com \
 && git config user.name 'Proofwork Platform' \
 && git add . \
 && git commit -m 'initial task baseline' --quiet

# Smoke test — fail the build if any pre-bake is broken.
USER root
RUN node --version \
 && npm --version \
 && tsc --version \
 && python3 --version \
 && go version \
 && /opt/opencode-bin/node_modules/.bin/opencode --version || true \
 && test -d /home/daytona/task/.git \
 && test -f /home/daytona/task/package.json

USER daytona
WORKDIR /home/daytona
