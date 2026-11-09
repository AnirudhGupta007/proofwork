// Warm-pool maintenance. POST to refill any below-depth templates +
// reap stale/draining entries. No-op when WORKSPACE_POOL_ENABLED=false.
// Intended for an external cron + a one-shot kick from app startup.
//
// Auth: requires a shared bearer matching env.CRON_SECRET. Skipped
// when env isn't set (dev convenience). Add a Bearer once a scheduler
// is wired up in prod.

import { env } from "@/app/lib/env";
import { reapPool, refillPool } from "@/app/lib/workspaces/pool";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const header = request.headers.get("authorization") ?? "";
    if (header !== `Bearer ${cronSecret}`) {
      return new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      });
    }
  }

  if (!env.WORKSPACE_POOL_ENABLED) {
    return new Response(JSON.stringify({ enabled: false }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  }

  await reapPool().catch(() => undefined);
  await refillPool().catch(() => undefined);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
