/**
 * The usage-history store: append-only jsonl at `~/.overseer/usage.jsonl`.
 *
 * Mirrors `tools/fleet/health-history.ts` — but GPT Sol's round-2 review made
 * two deliberate divergences, and both are tested here rather than inherited:
 *
 *  - **No independent writer lock** (G4). The Overseer's own daemon lock already
 *    guarantees one writer, and a second election could pick a different winner.
 *  - **No in-process `status()` for the route** (G3). The writer is the daemon
 *    and the reader is the dashboard, in different processes, so recorder health
 *    is derived from the records rather than carried from the writer's memory.
 *
 * Specification: docs/plans/260909b-usage-limits-tab-fleet-dashboard-24h-history.md
 */
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync, writeSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  LIVE_FILE,
  MAX_FILE_BYTES,
  MIN_PASS_INTERVAL_MS,
  PREV_FILE,
  openUsageHistoryForRead,
  openUsageHistoryForWrite,
  worstCaseRetainedHours,
} from "../tools/fleet/usage-history.js";
import { MAX_LINE_BYTES, SUMMARY_SCHEMA, type UsageHistoryLine } from "../tools/fleet/usage-history-record.js";

const opened: { close(): void }[] = [];
afterEach(() => {
  while (opened.length > 0) opened.pop()?.close();
});

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "usage-history-"));
}

/** The daemon lock is held. The writer refuses to open otherwise — see G4. */
const HELD = () => true;

function openWriter(dir: string, over: Record<string, unknown> = {}) {
  const w = openUsageHistoryForWrite(dir, { daemonLockHeld: HELD, ...over });
  opened.push(w);
  return w;
}

function line(over: Partial<UsageHistoryLine> = {}, atMs = Date.parse("2026-09-09T00:00:00.000Z")): UsageHistoryLine {
  return {
    lineSchema: 1,
    summarySchema: SUMMARY_SCHEMA,
    recordedAt: new Date(atMs).toISOString(),
    nextDueMs: MIN_PASS_INTERVAL_MS,
    pass: {
      kind: "pass",
      collectedAt: new Date(atMs).toISOString(),
      accountUuid: "eddd4c75",
      cache: {
        kind: "attributed",
        accountUuid: "eddd4c75",
        fetchedAt: new Date(atMs).toISOString(),
        windows: [
          {
            kind: "value",
            window: "five_hour",
            utilizationPercent: 40,
            resetsAt: "2026-09-09T02:49:59.754Z",
            resetsAtMs: 1788922199754,
          },
        ],
      },
      scan: { conclusive: true, why: null, incidents: [] },
      publication: { decision: "take-fresh", why: "this scan finished" },
    },
    ...over,
  };
}

describe("appending", () => {
  it("writes one line per pass and reads it back oldest-first", () => {
    const dir = tempDir();
    const w = openWriter(dir);
    const t0 = Date.parse("2026-09-09T00:00:00.000Z");
    w.append(line({}, t0));
    w.append(line({}, t0 + MIN_PASS_INTERVAL_MS));

    const read = openUsageHistoryForRead(dir).read({ sinceMs: 0 });
    expect(read.kind).toBe("read");
    if (read.kind !== "read") return;
    expect(read.samples).toHaveLength(2);
    expect(read.samples[0]).toMatchObject({ kind: "sample", sourceAtMs: t0 });
    expect(read.samples[1]).toMatchObject({ sourceAtMs: t0 + MIN_PASS_INTERVAL_MS });
  });

  it("keeps the cache observation on a keep-stored pass", () => {
    /* THE failure this design exists to avoid. `chooseUsage` declining to
       publish a report says nothing about that pass's CACHE reading, which is
       independent of the transcript scan. An earlier draft dropped it. */
    const dir = tempDir();
    const w = openWriter(dir);
    const l = line();
    if (l.pass.kind !== "pass") throw new Error("fixture");
    l.pass.publication = { decision: "keep-stored", why: "the fresh scan was incomplete" };
    l.pass.scan = { conclusive: false, why: "40 of 1,835 transcripts opened", incidents: [] };
    w.append(l);

    const read = openUsageHistoryForRead(dir).read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error("unreadable");
    const first = read.samples[0];
    if (first?.kind !== "sample" || first.line.pass.kind !== "pass") throw new Error("shape");
    expect(first.line.pass.cache.kind).toBe("attributed");
    expect(first.line.pass.publication.decision).toBe("keep-stored");
    expect(first.line.pass.scan.conclusive).toBe(false);
  });

  it("records a collector failure, which carries no collectedAt", () => {
    const dir = tempDir();
    const w = openWriter(dir);
    const at = "2026-09-09T00:05:00.000Z";
    w.append(line({ pass: { kind: "collector-failed", at, why: "ENOENT" } }));
    const read = openUsageHistoryForRead(dir).read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error("unreadable");
    expect(read.samples[0]).toMatchObject({ kind: "sample", sourceAtMs: Date.parse(at) });
  });

  it("turns an over-ceiling record into a positional OMISSION marker, never a silent drop", () => {
    const dir = tempDir();
    const w = openWriter(dir);
    const t0 = Date.parse("2026-09-09T00:00:00.000Z");
    w.append(line({}, t0));
    const huge = line({}, t0 + 1);
    if (huge.pass.kind !== "pass") throw new Error("fixture");
    huge.pass.scan = {
      conclusive: true,
      why: null,
      incidents: Array.from({ length: 5_000 }, (_, i) => ({
        id: `w${i}`,
        window: "five_hour",
        resetsAt: "2026-09-09T02:49:59.754Z",
        firstHitAt: null,
        lastHitAt: null,
        rejections: 1,
        unidentifiedRejections: 0,
        conversations: 1,
      })),
    };
    w.append(huge);
    w.append(line({}, t0 + 2));

    const read = openUsageHistoryForRead(dir).read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error("unreadable");
    expect(read.samples).toHaveLength(3);
    expect(read.samples[1]).toMatchObject({ kind: "omitted" });
  });
});

describe("the two divergences from the health precedent", () => {
  it("takes NO lock — not on write, not on read (G4)", () => {
    /* An independent election could pick a different winner from the Overseer's
       own daemon lock: A takes the history lock, B takes the daemon lock, A
       exits because it cannot be the daemon, and B runs with a permanently
       read-only handle. Nothing is written until someone restarts it, and G3
       then prevents the dashboard from explaining why. */
    const dir = tempDir();
    openWriter(dir).append(line());
    openUsageHistoryForRead(dir).read({ sinceMs: 0 });
    expect(readdirSync(dir).filter((f) => f.includes("lock"))).toEqual([]);
  });

  it("REFUSES to open for writing unless the daemon lock is already held (G4)", () => {
    const dir = tempDir();
    expect(() => openUsageHistoryForWrite(dir, { daemonLockHeld: () => false })).toThrow(/daemon lock/i);
  });

  it("lets two readers coexist, and a reader work while a writer is open", () => {
    const dir = tempDir();
    const w = openWriter(dir);
    w.append(line());
    expect(openUsageHistoryForRead(dir).read({ sinceMs: 0 }).kind).toBe("read");
    expect(openUsageHistoryForRead(dir).read({ sinceMs: 0 }).kind).toBe("read");
    w.append(line({}, Date.parse("2026-09-09T00:05:00.000Z")));
    const read = openUsageHistoryForRead(dir).read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error("unreadable");
    expect(read.samples).toHaveLength(2);
  });
});

describe("rotation, and the 24-hour invariant", () => {
  it("derives worst-case retention from the real constants, and it exceeds 24 hours", () => {
    /* GPT Sol F7 and its round-2 refinement. The original plan copied health's
       8 MiB cap while sizing it against a REAL 6.8 KB record — but the store's
       contract is stated against the MAXIMUM LEGAL record, and 288 passes/day at
       64 KiB is 18 MiB/day, so 8 MiB could rotate in under eleven hours and
       leave `prev` holding less than half the day it promised.

       This assertion derives the hours rather than comparing two constants, and
       the behavioural test below covers what arithmetic cannot. */
    const perDay = (24 * 60 * 60 * 1000) / MIN_PASS_INTERVAL_MS;
    expect(perDay).toBe(288);
    expect(worstCaseRetainedHours()).toBeGreaterThanOrEqual(24);
    expect(MAX_FILE_BYTES).toBeGreaterThanOrEqual(perDay * MAX_LINE_BYTES);
  });

  it("returns samples OLDEST FIRST across a rotation, which is the type's promise", () => {
    /* Found by mutation, not by writing tests. The rotation test below counted
       samples and never looked at their order, so swapping the two files in the
       read loop — `[live, prev]` instead of `[prev, live]` — passed everything.
       A renderer that walks the array left to right would then draw the newer
       half first and the older half after it: a sawtooth, from a store that had
       recorded the truth perfectly.

       "Oldest first" is written in `UsageHistoryRead.samples`' own doc comment,
       and until now nothing checked it. */
    const dir = tempDir();
    const w = openWriter(dir, { maxFileBytes: 0, maxLinesPerFileForTest: 3 });
    const t0 = Date.parse("2026-09-09T00:00:00.000Z");
    for (let i = 0; i < 7; i += 1) w.append(line({}, t0 + i * MIN_PASS_INTERVAL_MS));

    const read = openUsageHistoryForRead(dir).read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error("unreadable");
    expect(read.rotated).toBe(true);
    const times = read.samples.flatMap((s) => (s.kind === "unsupported" ? [] : [s.sourceAtMs]));
    expect(times.length).toBeGreaterThan(3);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    /* And the read really did span BOTH files, so the ordering is exercised
       rather than trivially true within one of them. */
    expect(read.files).toBe(2);
  });

  it("keeps at least a full window across MORE THAN TWO rotations, read before and after each", () => {
    /* The half a constant cannot prove: that reads actually span live and prev,
       and that the moment immediately after a rotation — when `live` holds one
       line — still answers for the whole window. Injected caps so the test is
       fast; the arithmetic above covers the real ones. */
    const dir = tempDir();
    const perFile = 10;
    const w = openWriter(dir, { maxFileBytes: 0, maxLinesPerFileForTest: perFile });
    const t0 = Date.parse("2026-09-09T00:00:00.000Z");
    const window = perFile * MIN_PASS_INTERVAL_MS; // one file's worth

    let rotations = 0;
    for (let i = 0; i < perFile * 4; i += 1) {
      w.append(line({}, t0 + i * MIN_PASS_INTERVAL_MS));
      const nowMs = t0 + i * MIN_PASS_INTERVAL_MS;
      const read = openUsageHistoryForRead(dir).read({ sinceMs: nowMs - window });
      if (read.kind !== "read") throw new Error("unreadable");
      if (read.rotated) rotations += 1;
      /* Every sample inside the window is still retrievable, at every point in
         the cycle — including the append right after a rotation. */
      const expected = Math.min(i + 1, perFile + 1);
      expect(read.samples.length).toBeGreaterThanOrEqual(Math.min(expected, perFile));
    }
    expect(rotations).toBeGreaterThan(0);
    expect(existsSync(join(dir, PREV_FILE))).toBe(true);
  });
});

describe("damage", () => {
  it("repairs a torn final line ON OPEN, rather than forgiving it on read", () => {
    /* A process killed mid-write leaves bytes with no newline. The next append
       lands immediately after them, welding a valid record onto a corrupt one —
       and one append later the damage is no longer the last line, so a reader
       that forgives only the final line has lost a good record too. */
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, LIVE_FILE), `${JSON.stringify(line())}\n{"summarySchema":1,"recorded`);
    const w = openWriter(dir);
    w.append(line({}, Date.parse("2026-09-09T00:05:00.000Z")));

    const read = openUsageHistoryForRead(dir).read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error("unreadable");
    expect(read.samples.filter((s) => s.kind === "sample")).toHaveLength(2);
    expect(read.unreadableLines).toBe(0);
  });

  it("counts an unreadable line AND places it, so a chart cannot join across it", () => {
    const dir = tempDir();
    const t0 = Date.parse("2026-09-09T00:00:00.000Z");
    writeFileSync(
      join(dir, LIVE_FILE),
      `${JSON.stringify(line({}, t0))}\n{not json\n${JSON.stringify(line({}, t0 + MIN_PASS_INTERVAL_MS))}\n`,
    );
    const read = openUsageHistoryForRead(dir).read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error("unreadable");
    expect(read.unreadableLines).toBe(1);
    expect(read.holes).toEqual([{ afterAtMs: t0, beforeAtMs: t0 + MIN_PASS_INTERVAL_MS }]);
  });

  it("keeps a future-schema line POSITIONALLY, so the series breaks rather than reconnecting (G7)", () => {
    const dir = tempDir();
    const t0 = Date.parse("2026-09-09T00:00:00.000Z");
    writeFileSync(
      join(dir, LIVE_FILE),
      [
        JSON.stringify(line({}, t0)),
        JSON.stringify({ ...line({}, t0 + 1), summarySchema: SUMMARY_SCHEMA + 1 }),
        JSON.stringify(line({}, t0 + MIN_PASS_INTERVAL_MS)),
        "",
      ].join("\n"),
    );
    const read = openUsageHistoryForRead(dir).read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error("unreadable");
    expect(read.samples).toHaveLength(3);
    expect(read.samples[1]).toMatchObject({ kind: "unsupported", summarySchema: SUMMARY_SCHEMA + 1 });
    expect(read.unsupportedLines).toBe(1);
  });

  it("POISONS after a partial write, and a later success must not imply recovery", () => {
    const dir = tempDir();
    let calls = 0;
    const w = openWriter(dir, {
      writeAllForTest: (fd: number, text: string) => {
        calls += 1;
        if (calls === 2) throw new Error("ENOSPC partway");
        writeSync(fd, text);
      },
    });
    w.append(line());
    expect(() => w.append(line({}, Date.parse("2026-09-09T00:05:00.000Z")))).toThrow();
    expect(w.status().poisoned).toBe(true);
    /* Refuses further appends until a restart — the repair that would fix a torn
       line only runs at open. */
    expect(() => w.append(line({}, Date.parse("2026-09-09T00:10:00.000Z")))).toThrow(/poison/i);
    expect(w.status().poisoned).toBe(true);
  });

  it("reports an unreadable store as a value rather than throwing", () => {
    /* The file has to EXIST for this arm to be reachable — an absent store is a
       different answer (an empty read), and the first version of this test
       passed a directory with nothing in it and so never called the reader at
       all. It went green against a store that could not fail. */
    const dir = tempDir();
    writeFileSync(join(dir, LIVE_FILE), `${JSON.stringify(line())}\n`);
    const read = openUsageHistoryForRead(dir).read({
      sinceMs: 0,
      readFileForTest: () => {
        throw new Error("EACCES");
      },
    });
    expect(read.kind).toBe("unreadable");
    if (read.kind !== "unreadable") return;
    expect(read.why).toMatch(/EACCES/);
  });
});

describe("the store on disk", () => {
  it("creates the directory 0700 and the file 0600, because the record carries account identity", () => {
    const dir = join(tempDir(), "nested");
    openWriter(dir).append(line());
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, LIVE_FILE)).mode & 0o777).toBe(0o600);
  });

  it("is empty-store-safe: a read of a directory that does not exist is a read, not a crash", () => {
    const read = openUsageHistoryForRead(join(tempDir(), "absent")).read({ sinceMs: 0 });
    expect(read.kind).toBe("read");
    if (read.kind !== "read") return;
    expect(read.samples).toEqual([]);
    expect(read.earliestAt).toBeNull();
    expect(read.rotated).toBe(false);
  });

  it("carries the predecessor, so the left edge can be classified", () => {
    const dir = tempDir();
    const w = openWriter(dir);
    const t0 = Date.parse("2026-09-09T00:00:00.000Z");
    w.append(line({}, t0));
    w.append(line({}, t0 + 10 * MIN_PASS_INTERVAL_MS));
    const read = openUsageHistoryForRead(dir).read({ sinceMs: t0 + 5 * MIN_PASS_INTERVAL_MS });
    if (read.kind !== "read") throw new Error("unreadable");
    expect(read.samples).toHaveLength(1);
    expect(read.predecessor).toMatchObject({ sourceAtMs: t0 });
  });

  it("says whether earliestAt is the oldest RETAINED sample or the first ever taken", () => {
    const dir = tempDir();
    const w = openWriter(dir, { maxFileBytes: 0, maxLinesPerFileForTest: 3 });
    const t0 = Date.parse("2026-09-09T00:00:00.000Z");
    for (let i = 0; i < 9; i += 1) w.append(line({}, t0 + i * MIN_PASS_INTERVAL_MS));
    const read = openUsageHistoryForRead(dir).read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error("unreadable");
    expect(read.rotated).toBe(true);
    /* "collecting since 00:00" would be false after a rotation, and the page has
       to be able to tell the difference. */
    expect(read.earliestAt).not.toBe(new Date(t0).toISOString());
  });
});
