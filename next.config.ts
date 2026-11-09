import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // standalone output bundles only the files Next + traced deps
  // actually need into .next/standalone, plus a minimal node_modules.
  // Runner image COPYs that subset instead of the whole builder /app
  // (which carried full node_modules incl. devDeps, tsc, eslint, etc.)
  // — drops the runner image from ~494 MB to ~150 MB.
  output: "standalone",
  // Next's standalone tracer skips files that are read at runtime
  // via fs.readFileSync (vs static imports). Audited sources that do
  // process.cwd()-relative reads:
  //   - app/layout.tsx:7      → readFileSync('app/globals.css')
  //   - app/lib/assessment-preflight.ts:29 → cp('task-template/...')
  //   - app/lib/workspaces/daytona-provider.ts:* → uploadFiles from
  //                            task-template/ on cold-path provision
  // Explicitly include both so the standalone bundle has them at the
  // same project-root-relative path the source code expects.
  outputFileTracingIncludes: {
    "/**/*": ["./app/globals.css", "./task-template/**/*"]
  },
  serverExternalPackages: ["mammoth", "pdf-parse", "pdfkit"],
  typedRoutes: true
};

export default nextConfig;
