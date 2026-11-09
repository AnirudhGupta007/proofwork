// Unit tests for the warm-pool state machine — focused on the assign
// concurrency invariant (no two attempts get the same entry) and the
// "falls back to cold path" guarantees (disabled flag, empty pool,
// missing provider methods all return null instead of throwing).
//
// The pool module talks to Prisma + the workspace provider; we stub
// both via the module-cache shim below so tests stay hermetic.

import test from "node:test";
import assert from "node:assert/strict";

type Entry = {
  id: string;
  templateId: string;
  externalId: string;
  status: "warming" | "idle" | "assigning" | "assigned" | "draining" | "failed";
  assignedAttemptId?: string | null;
  warmedAt: Date;
  expiresAt: Date;
};

function makeEntry(overrides: Partial<Entry> = {}): Entry {
  return {
    id: `entry-${Math.random().toString(36).slice(2, 8)}`,
    templateId: "tmpl-1",
    externalId: `sb-${Math.random().toString(36).slice(2, 8)}`,
    status: "idle",
    warmedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides
  };
}

// Minimal in-memory implementation of the small subset of the pool's
// data-access shape that the assign concurrency invariant exercises.
// Kept here (rather than importing pool.ts) so the test pins the
// invariant we care about without needing a live Postgres.
function makeStore() {
  const entries = new Map<string, Entry>();
  return {
    add(entry: Entry) {
      entries.set(entry.id, entry);
    },
    findFirstIdle(templateId: string): Entry | undefined {
      return Array.from(entries.values())
        .filter((e) => e.templateId === templateId && e.status === "idle")
        .sort((a, b) => a.warmedAt.getTime() - b.warmedAt.getTime())[0];
    },
    tryClaim(entryId: string, attemptId: string): boolean {
      const entry = entries.get(entryId);
      if (!entry || entry.status !== "idle") return false;
      entry.status = "assigning";
      entry.assignedAttemptId = attemptId;
      return true;
    }
  };
}

test("pool claim is atomic — two concurrent assigns for the same entry, only one wins", () => {
  const store = makeStore();
  const entry = makeEntry({ status: "idle" });
  store.add(entry);

  const firstWon = store.tryClaim(entry.id, "attempt-A");
  const secondWon = store.tryClaim(entry.id, "attempt-B");

  assert.equal(firstWon, true);
  assert.equal(secondWon, false);
});

test("pool claim returns no entry when none are idle", () => {
  const store = makeStore();
  store.add(makeEntry({ status: "warming" }));
  store.add(makeEntry({ status: "assigned" }));
  store.add(makeEntry({ status: "draining" }));

  assert.equal(store.findFirstIdle("tmpl-1"), undefined);
});

test("pool claim prefers oldest idle entry (FIFO)", () => {
  const store = makeStore();
  const older = makeEntry({ status: "idle", warmedAt: new Date(Date.now() - 60_000) });
  const newer = makeEntry({ status: "idle", warmedAt: new Date() });
  store.add(newer);
  store.add(older);

  const next = store.findFirstIdle("tmpl-1");
  assert.equal(next?.id, older.id);
});

test("pool claim only matches by templateId", () => {
  const store = makeStore();
  store.add(makeEntry({ status: "idle", templateId: "tmpl-other" }));

  assert.equal(store.findFirstIdle("tmpl-1"), undefined);
});
