/**
 * **The daemon's `reports` option: called on its own interval, with the store's
 * register, and a throw is a note rather than a dead daemon.**
 *
 * The drain itself is `tests/overseer-reports.test.ts`. This is the join: a drain
 * that is green on its own and never called by the daemon is the class
 * `tests/overseer-daemon-usage-pass.test.ts` exists for.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vitest";

import { runOverseer } from "../tools/overseer/daemon.js";
import { readNotes } from "../tools/overseer/notes.js";
import type { SourceMessage } from "../tools/overseer/source.js";
import type { ReportDrainOutcome } from "../tools/overseer/reports.js";
import type { SessionRegister } from "../tools/overseer/store.js";
import { rawFixture } from "./overseer-fixtures.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-daemon-reports-"));
  roots.push(root);
  return root;
}

const QUIET: ReportDrainOutcome = {
  recorded: 0,
  duplicates: 0,
  refused: 0,
  pending: 0,
  deferred: 0,
  skippedEntries: 0,
  replayed: 0,
  debrisRemoved: 0,
  probes: 0,
  bytesRead: 0,
  stoppedBy: null,
  notes: [],
};

async function runWithDrain(drain: (register: SessionRegister) => ReportDrainOutcome, forMs = 300): Promise<string> {
  const root = tempRoot();
  const controller = new AbortController();
  setTimeout(() => controller.abort(), forMs).unref?.();
  const outcome = await runOverseer({
    root,
    baseUrl: "http://127.0.0.1:1",
    signal: controller.signal,
    // Standing just after the fixture's capture, so its snapshot is fresh.
    now: () => new Date("2026-09-08T02:48:40.000Z"),
    tickMs: 20,
    log: () => {},
    source: async function* (): AsyncGenerator<SourceMessage> {
      yield { kind: "payload", via: "sse", atMs: 0, json: rawFixture("session-new-before") };
      await new Promise<void>((resolve) => controller.signal.addEventListener("abort", () => resolve()));
    },
    reports: { intervalMs: 25, drain },
  });
  expect(outcome.kind).toBe("stopped");
  return root;
}

test("the drain is called on its interval with the store's live register", async () => {
  const seen: SessionRegister[] = [];
  await runWithDrain((register) => {
    seen.push(register);
    return QUIET;
  });
  expect(seen.length).toBeGreaterThan(2);
  // One live map, the store's own — not a copy per call.
  expect(new Set(seen).size).toBe(1);
  // It holds the fixture's sessions, which only the store's register would.
  expect(seen.at(-1)?.size).toBeGreaterThan(0);
});

test("a throwing drain becomes a note and the daemon keeps running", async () => {
  let calls = 0;
  const root = await runWithDrain(() => {
    calls += 1;
    if (calls === 1) throw new Error("the inbox is on fire");
    return QUIET;
  });
  expect(calls).toBeGreaterThan(1);
  const read = readNotes(root);
  if (read.kind === "unreadable") throw new Error(read.cause);
  const degraded = read.notes.find((note) => note.kind === "condition-degraded" && note.condition === "reports");
  expect(degraded?.kind === "condition-degraded" ? degraded.why : "").toMatch(/on fire/);
  expect(read.notes.some((note) => note.kind === "condition-restored" && note.condition === "reports")).toBe(true);
});
