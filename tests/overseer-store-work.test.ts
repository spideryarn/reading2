/**
 * One process-table measurement, in and out of `~/.overseer/current.json`.
 *
 * This mirrors the attention field's persistence tests because the store makes
 * the same proportionality decision for both: malformed enrichment is cheap to
 * regenerate, so it degrades without taking the register down with it. It must
 * never degrade to an empty scan, which would turn unreadable evidence into the
 * most reassuring possible answer.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import type { OverseerWork } from "../tools/fleet/wire.js";
import {
  CHECKPOINT_FILE,
  describeRefusal,
  openStore,
  readCheckpoint,
  type OverseerStore,
} from "../tools/overseer/store.js";

const opened: OverseerStore[] = [];
const roots: string[] = [];

afterEach(() => {
  for (const store of opened.splice(0)) store.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "overseer-work-store-"));
  roots.push(root);
  return root;
}

function mustOpen(root: string, now?: () => Date): OverseerStore {
  const result = openStore({ root, ...(now === undefined ? {} : { now }) });
  if (!result.ok) throw new Error(`expected to open the store, got: ${describeRefusal(result.refusal)}`);
  opened.push(result.store);
  return result.store;
}

const SCAN: OverseerWork = {
  kind: "scan",
  scannedAt: "2026-09-09T10:00:30.000Z",
  sourceCollectedAt: "2026-09-09T10:00:00.000Z",
  panes: [
    {
      key: "$1 claims:one",
      work: { kind: "cannot-tell", cause: "pane-not-in-table", why: "pid 12 had exited" },
    },
    {
      key: "$2 none",
      work: {
        kind: "work",
        inspected: 8,
        paneCommand: "bash pane.sh",
        paneStartedAt: "2026-09-09T08:00:00.000Z",
        jobs: [
          {
            recogniser: "codex-exec",
            label: "GPT review",
            startedAt: "2026-09-09T10:00:26.000Z",
            ranForMs: 4_000,
            pid: 318,
            depth: 8,
            command: "codex exec",
          },
        ],
      },
    },
  ],
};

function corruptWork(root: string, work: unknown): OverseerWork {
  const path = join(root, CHECKPOINT_FILE);
  const raw = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  raw.work = work;
  writeFileSync(path, JSON.stringify(raw, null, 2));
  const read = readCheckpoint(root);
  if (read.kind !== "checkpoint") throw new Error("malformed work must not take down the checkpoint");
  return read.checkpoint.work;
}

describe("the work reading on the checkpoint", () => {
  test("a cold store says nobody has looked, not that nothing is running", () => {
    const store = mustOpen(tempRoot());
    const written = store.checkpoint({ lastGoodSnapshotAt: null, tick: true });
    if (!written.ok) throw new Error("unreachable");
    expect(written.checkpoint.work.kind).toBe("not-yet-run");
    if (written.checkpoint.work.kind !== "not-yet-run") return;
    expect(written.checkpoint.work.why).toContain("nothing has looked");
  });

  test("a scan round-trips with its per-pane cannot-tell and work arms", () => {
    const root = tempRoot();
    const store = mustOpen(root);
    store.checkpoint({ lastGoodSnapshotAt: SCAN.sourceCollectedAt, tick: true, work: SCAN });
    const read = readCheckpoint(root);
    if (read.kind !== "checkpoint") throw new Error("expected a checkpoint");
    expect(read.checkpoint.work).toEqual(SCAN);
  });

  test("probe-failed round-trips both clocks and the probe's reason", () => {
    const root = tempRoot();
    const store = mustOpen(root);
    const failure: OverseerWork = {
      kind: "probe-failed",
      why: "ps exited 1: /proc was unavailable",
      attemptedAt: "2026-09-09T10:02:30.000Z",
      sourceCollectedAt: "2026-09-09T10:02:00.000Z",
    };
    store.checkpoint({ lastGoodSnapshotAt: failure.sourceCollectedAt, tick: true, work: failure });
    const read = readCheckpoint(root);
    if (read.kind !== "checkpoint") throw new Error("expected a checkpoint");
    expect(read.checkpoint.work).toEqual(failure);
  });

  test("an update omitting work keeps the last measurement with its clock unchanged", () => {
    const store = mustOpen(tempRoot(), () => new Date("2026-09-09T11:00:00.000Z"));
    store.checkpoint({ lastGoodSnapshotAt: SCAN.sourceCollectedAt, tick: true, work: SCAN });
    const later = store.checkpoint({ lastGoodSnapshotAt: "2026-09-09T10:01:00.000Z", tick: true });
    if (!later.ok) throw new Error("unreachable");
    expect(later.checkpoint.work).toEqual(SCAN);
    if (later.checkpoint.work.kind !== "scan") return;
    expect(later.checkpoint.work.scannedAt).toBe("2026-09-09T10:00:30.000Z");
  });

  test("a restart does not republish a measurement nobody took after restart", () => {
    const root = tempRoot();
    const first = mustOpen(root);
    first.checkpoint({ lastGoodSnapshotAt: SCAN.sourceCollectedAt, tick: true, work: SCAN });
    first.close();
    const second = mustOpen(root);
    const written = second.checkpoint({ lastGoodSnapshotAt: SCAN.sourceCollectedAt, tick: true });
    if (!written.ok) throw new Error("unreachable");
    expect(written.checkpoint.work.kind).toBe("not-yet-run");
  });
});

describe("malformed stored work degrades and never becomes an empty scan", () => {
  test.each([
    ["not an object", "broken"],
    ["a scan with a bad scannedAt", { ...SCAN, scannedAt: "today" }],
    ["a scan with no sourceCollectedAt", { kind: "scan", scannedAt: SCAN.scannedAt, panes: [] }],
    [
      "a pane with an unknown work kind",
      { ...SCAN, panes: [{ key: "$1 none", work: { kind: "mystery", why: "unknown" } }] },
    ],
    [
      "a work arm with no jobs",
      {
        ...SCAN,
        panes: [
          {
            key: "$1 none",
            work: { kind: "work", jobs: [], inspected: 1, paneCommand: "bash", paneStartedAt: null },
          },
        ],
      },
    ],
    [
      "a job with a fractional pid",
      {
        ...SCAN,
        panes: [
          {
            key: "$1 none",
            work: {
              kind: "work",
              inspected: 1,
              paneCommand: "bash",
              paneStartedAt: null,
              jobs: [{ recogniser: "codex-exec", label: "GPT review", startedAt: null, ranForMs: null, pid: 3.5, depth: 1, command: "codex exec" }],
            },
          },
        ],
      },
    ],
    [
      "a job with a negative duration",
      {
        ...SCAN,
        panes: [
          {
            key: "$1 none",
            work: {
              kind: "work",
              inspected: 1,
              paneCommand: "bash",
              paneStartedAt: null,
              jobs: [{ recogniser: "codex-exec", label: "GPT review", startedAt: null, ranForMs: -1, pid: 3, depth: 1, command: "codex exec" }],
            },
          },
        ],
      },
    ],
  ])("refuses %s", (_name, malformed) => {
    const root = tempRoot();
    const store = mustOpen(root);
    store.checkpoint({ lastGoodSnapshotAt: SCAN.sourceCollectedAt, tick: true, work: SCAN });
    const work = corruptWork(root, malformed);
    expect(work.kind).toBe("not-yet-run");
    if (work.kind !== "not-yet-run") return;
    expect(work.why).toContain("stored work reading was unusable");
    expect(work).not.toHaveProperty("panes");
  });
});
