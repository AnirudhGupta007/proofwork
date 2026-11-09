// K8s liveness/readiness/startup probe target. Cheap by design — does NOT
// touch Postgres, Clerk, or any provider. Probing `/` would render the
// page tree (Clerk + Inngest providers + middleware) for the same boolean
// answer, costing CPU on every probe interval.
//
// Side effect: the FIRST probe per pod kicks the warm-pool reap+refill
// (fire-and-forget). Subsequent probes are pure 200s. We piggyback on
// the probe instead of using a top-level instrumentation.ts because
// pool → daytona-provider pulls in `fs/promises`, which webpack chokes
// on when bundling instrumentation for the edge runtime.

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

let poolKickStarted = false;

function kickPoolOnce(): void {
  if (poolKickStarted) return;
  poolKickStarted = true;

  // Dynamic import inside an explicitly-nodejs route — webpack
  // creates a node-only chunk, no edge bundling concerns.
  import("@/app/lib/workspaces/pool")
    .then(({ reapPool, refillPool }) =>
      reapPool()
        .catch(() => undefined)
        .then(() => refillPool().catch(() => undefined))
    )
    .catch(() => undefined);
}

export function GET(): Response {
  kickPoolOnce();
  return new Response(JSON.stringify({ status: "ok" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
