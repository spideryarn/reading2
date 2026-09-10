/**
 * The box-health history store — tools/fleet/health-history.ts.
 *
 * **WHAT THIS FILE IS REALLY DEFENDING.** A 24h chart exists to answer one
 * question — *was there a problem while I was not looking* — and there are four
 * different things a point in time can be, three of which a careless store
 * flattens into one:
 *
 *  1. a reading with a number in it;
 *  2. a reading whose command failed, carrying the collector's own `why`;
 *  3. a turn on which the collector itself threw;
 *  4. **no sample at all** — nothing was written, so the cause is unknown.
 *
 * (3) and (4) are the pair that matters most and the pair most easily merged:
 * *"the box was up and health collection has been broken for six hours"* and
 * *"the box was down for six hours"* are opposite operational facts. So most of
 * what is asserted below is that a distinction SURVIVED a round trip, rather
 * than that a number came back.
 *
 * Every test writes into its own temp directory and none of them touch
 * `~/.fleet-health/` — see `withStore`.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { HealthReport } from "../tools/fleet/health.js";
import {
  MAX_FILE_BYTES,
  MAX_LINE_BYTES,
  MAX_WHY_CHARS,
  WORK_EVERY_MS,
  openHealthHistory,
  parseSampleLine,
  sampleLine,
  type HealthHistory,
  type HealthSample,
} from "../tools/fleet/health-history.js";
import { MAX_STORED_WORK_BYTES } from "../tools/fleet/work-groups.js";
import type { StoredWork, StoredWorkGroup, StoredWorkTurn } from "../tools/fleet/wire.js";

const dirs: string[] = [];
const open: HealthHistory[] = [];

type TestHistory = Omit<HealthHistory, "append"> & {
  append(
    turn: Parameters<HealthHistory["append"]>[0],
    stamp: Parameters<HealthHistory["append"]>[1],
    workTurn?: StoredWorkTurn,
  ): boolean;
};

afterEach(() => {
  /* CLOSE BEFORE REMOVING. Each store holds a writer lock for the life of the
     process, so a suite that opened several and released none would eventually
     be locked out by itself — which is not a hypothetical, it is what a torn-line
     test found the first time the lock landed, and the symptom was an append
     that silently did nothing. */
  for (const store of open.splice(0)) store.close();
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/**
 * A store whose write fails PART WAY THROUGH — the one failure a permission bit
 * cannot produce, and the only one that poisons the writer.
 *
 * Injected rather than simulated, the same way `read` takes a `readFile`: this
 * arm is unreachable from outside on a healthy filesystem, and it is the arm
 * whose consequence (a torn record welded to a valid one, unrepairable after
 * the next append) is the worst in the file.
 */
function testHistory(store: HealthHistory): TestHistory {
  return {
    ...store,
    append: (turn, stamp, workTurn = NOT_DUE) => store.append(turn, stamp, workTurn),
  };
}

function withPartialWriter(): TestHistory {
  const dir = mkdtempSync(join(tmpdir(), "fleet-health-history-partial-"));
  dirs.push(dir);
  const opened = openHealthHistory(dir, {
    writeLine: () => {
      throw new Error("wrote 40 of 812 remaining bytes");
    },
  });
  if (opened.kind !== "open") throw new Error(`store would not open: ${opened.why}`);
  open.push(opened.store);
  return testHistory(opened.store);
}

function withStore(): { dir: string; store: TestHistory } {
  const dir = mkdtempSync(join(tmpdir(), "fleet-health-history-"));
  dirs.push(dir);
  const opened = openHealthHistory(dir);
  if (opened.kind !== "open") throw new Error(`store would not open: ${opened.why}`);
  open.push(opened.store);
  return { dir, store: testHistory(opened.store) };
}

/** A report with one value reading and one that could not be taken. */
function report(overrides: Partial<HealthReport> = {}): HealthReport {
  return {
    load: { kind: "value", load1: 20.5, load5: 18, load15: 15, cores: 16, ratio1: 20.5 / 16 },
    memory: { kind: "value", totalBytes: 32_000_000_000, availableBytes: 8_000_000_000, availableFraction: 0.25 },
    swap: { kind: "value", totalBytes: 34_000_000_000, usedBytes: 17_000_000_000, usedFraction: 0.5, areas: 2 },
    disk: { kind: "value", totalKiB: 100, usedKiB: 50, availableKiB: 50, usePercent: 50 },
    swapActivity: { kind: "unknown", why: "vmstat failed: spawn vmstat ENOENT" },
    attribution: { kind: "value", groups: [{ kind: "vitest", procs: 24, rssKiB: 8_518_356 }] },
    verdict: { level: "strained", reasons: ["load average 20.5 is over 2x the 16 cores"] },
    collectedAt: "2026-09-08T12:00:00.000Z",
    tookMs: 158,
    ...overrides,
  };
}

const NOT_DUE: StoredWorkTurn = { kind: "not-due" };

function due(result: StoredWork): StoredWorkTurn {
  return { kind: "due", result };
}

describe("openHealthHistory", () => {
  it("refuses a relative directory, because two processes would resolve it differently", () => {
    const opened = openHealthHistory("./fleet-health");
    expect(opened.kind).toBe("refused");
    if (opened.kind !== "refused") return;
    expect(opened.why).toMatch(/absolute/i);
  });
});

describe("a sample survives the round trip with its arms intact", () => {
  it("parses a line written before work tracking without inventing a work turn", () => {
    const legacyLine =
      '{"schema":1,"at":"2026-09-08T11:59:00.000Z","nextDueMs":73000,"kind":"collector-failed","why":"legacy collector failure"}\n';
    const expected = {
      schema: 1,
      at: "2026-09-08T11:59:00.000Z",
      nextDueMs: 73_000,
      kind: "collector-failed",
      why: "legacy collector failure",
    };

    expect(parseSampleLine(legacyLine)).toEqual(expected);
    expect(parseSampleLine(legacyLine)).not.toHaveProperty("workTurn");
  });

  it("keeps an empty successful work scan as a real answer", () => {
    const { store } = withStore();
    const workTurn = due({
      kind: "scan",
      scannedAt: "2026-09-08T11:59:58.000Z",
      groups: [],
      groupsDropped: 0,
      panes: { work: 0, none: 4, cannotTell: 0 },
    });
    store.append(
      { kind: "reading", report: report() },
      { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 },
      workTurn,
    );

    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.samples[0]?.workTurn).toEqual(workTurn);
  });

  it("keeps every unavailable work arm and its own clock intact", () => {
    const { store } = withStore();
    const turns: StoredWorkTurn[] = [
      due({ kind: "not-yet-run", asOf: "2026-09-08T12:00:01.000Z", why: "the daemon has not scanned yet" }),
      due({
        kind: "probe-failed",
        attemptedAt: "2026-09-08T12:04:50.000Z",
        sourceCollectedAt: "2026-09-08T12:04:40.000Z",
        why: "ps failed",
      }),
      due({
        kind: "checkpoint-unavailable",
        checkedAt: "2026-09-08T12:10:01.000Z",
        why: "checkpoint could not be read",
      }),
    ];

    for (const [index, workTurn] of turns.entries()) {
      store.append(
        { kind: "reading", report: report() },
        { at: new Date(Date.parse("2026-09-08T12:00:00.000Z") + index * WORK_EVERY_MS).toISOString(), nextDueMs: 73_000 },
        workTurn,
      );
    }

    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.samples.map((sample) => sample.workTurn)).toEqual(turns);
  });

  it("records due work even when health collection itself failed", () => {
    const { store } = withStore();
    const workTurn = due({
      kind: "scan",
      scannedAt: "2026-09-08T12:14:59.000Z",
      groups: [],
      groupsDropped: 0,
      panes: { work: 0, none: 0, cannotTell: 0 },
    });
    store.append(
      { kind: "collector-failed", why: "collectHealth threw" },
      { at: "2026-09-08T12:15:00.000Z", nextDueMs: 313_000 },
      workTurn,
    );

    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.samples[0]).toMatchObject({ kind: "collector-failed", workTurn });
  });

  it("keeps an unknown reading as unknown, carrying the collector's own words", () => {
    const { store } = withStore();
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 });

    const read = store.read({ sinceMs: 0 });
    expect(read.kind).toBe("read");
    if (read.kind !== "read") return;
    expect(read.samples).toHaveLength(1);
    const sample = read.samples[0];
    if (sample?.kind !== "reading") throw new Error("expected a reading sample");

    /* THE POINT OF THE TEST. A store that wrote `swapActivity: null`, or 0,
       would pass a shape check and lose the difference between "nothing was
       moving" and "vmstat is not installed". */
    expect(sample.report.swapActivity).toEqual({
      kind: "unknown",
      why: "vmstat failed: spawn vmstat ENOENT",
    });
    expect(sample.report.load).toMatchObject({ kind: "value", load1: 20.5 });
  });

  it("keeps a collector failure as its own arm, not as an all-unknown reading", () => {
    const { store } = withStore();
    store.append(
      { kind: "collector-failed", why: "collectHealth threw: out of memory" },
      { at: "2026-09-08T12:01:13.000Z", nextDueMs: 73_000 },
    );

    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    const sample = read.samples[0];
    expect(sample?.kind).toBe("collector-failed");
    if (sample?.kind !== "collector-failed") return;
    expect(sample.why).toBe("collectHealth threw: out of memory");
  });

  it("records what the writer expected next, so a reader is told rather than left to guess", () => {
    const { store } = withStore();
    /* The loop backs off 5x after a failed collection. A reader comparing
       intervals against one assumed cadence would draw that backoff as an
       outage; the writer knows which it was, so it says. */
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 313_000 });
    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.samples[0]?.nextDueMs).toBe(313_000);
  });
});

describe("the window", () => {
  it("returns only samples at or after `sinceMs`, oldest first", () => {
    const { store } = withStore();
    const base = Date.parse("2026-09-08T12:00:00.000Z");
    for (let i = 0; i < 5; i++) {
      store.append(
        { kind: "reading", report: report() },
        { at: new Date(base + i * 60_000).toISOString(), nextDueMs: 73_000 },
      );
    }

    const read = store.read({ sinceMs: base + 2 * 60_000 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.samples).toHaveLength(3);
    expect(read.samples[0]?.at).toBe(new Date(base + 2 * 60_000).toISOString());
    expect(read.samples[2]?.at).toBe(new Date(base + 4 * 60_000).toISOString());
  });

  it("reports the earliest sample it holds even when that is outside the window", () => {
    /* WITHOUT THIS THE PAGE CANNOT TELL ITS TWO SILENCES APART. A window whose
       first hour has no samples is either "the box was down" or "we had not
       started looking yet", and only the store knows which. */
    const { store } = withStore();
    const base = Date.parse("2026-09-08T12:00:00.000Z");
    store.append({ kind: "reading", report: report() }, { at: new Date(base).toISOString(), nextDueMs: 73_000 });
    store.append(
      { kind: "reading", report: report() },
      { at: new Date(base + 3_600_000).toISOString(), nextDueMs: 73_000 },
    );

    const read = store.read({ sinceMs: base + 1_800_000 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.samples).toHaveLength(1);
    expect(read.earliestAt).toBe(new Date(base).toISOString());
  });

  it("does not return a work summary after its sample has expired from the requested window", () => {
    const { store } = withStore();
    const base = Date.parse("2026-09-08T12:00:00.000Z");
    store.append(
      { kind: "reading", report: report() },
      { at: new Date(base).toISOString(), nextDueMs: 73_000 },
      due({
        kind: "scan",
        scannedAt: new Date(base - 1_000).toISOString(),
        groups: [],
        groupsDropped: 0,
        panes: { work: 0, none: 1, cannotTell: 0 },
      }),
    );
    store.append(
      { kind: "reading", report: report() },
      { at: new Date(base + WORK_EVERY_MS).toISOString(), nextDueMs: 73_000 },
      NOT_DUE,
    );

    const read = store.read({ sinceMs: base + WORK_EVERY_MS });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.samples).toHaveLength(1);
    expect(read.samples[0]?.workTurn).toEqual(NOT_DUE);
    expect(read.samples.some((sample) => sample.workTurn?.kind === "due")).toBe(false);
  });
});

describe("rotation", () => {
  it("keeps the previous file, so the window is still covered the instant after a rotation", () => {
    /* THE INVARIANT THE CAP EXISTS FOR. Right after a rotation the live file
       holds one line. If the reader looked only there, a 24h chart would go
       blank at a moment nothing was wrong — and blank reads as "the box was
       down", which is the one thing this feature must never say by accident. */
    const { dir, store } = withStore();
    const base = Date.parse("2026-09-08T12:00:00.000Z");

    /* Fill past the cap. `sampleLine` is exported so the test can size its own
       fixture against the real serialiser rather than a guess about it. */
    const lineBytes = sampleLine({
      schema: 1,
      at: new Date(base).toISOString(),
      nextDueMs: 73_000,
      kind: "reading",
      report: report(),
    }).length;
    const needed = Math.ceil(MAX_FILE_BYTES / lineBytes) + 2;
    for (let i = 0; i < needed; i++) {
      store.append(
        { kind: "reading", report: report() },
        { at: new Date(base + i * 1000).toISOString(), nextDueMs: 73_000 },
      );
    }

    expect(statSync(join(dir, "health.prev.jsonl")).size).toBeGreaterThan(0);
    expect(statSync(join(dir, "health.jsonl")).size).toBeLessThan(MAX_FILE_BYTES);

    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    /* The oldest sample is still readable: the rotation moved it, it did not
       drop it. */
    expect(read.samples[0]?.at).toBe(new Date(base).toISOString());
    expect(read.samples).toHaveLength(needed);
  });

  it("never lets the store exceed two files' worth of bytes", () => {
    const { dir, store } = withStore();
    const base = Date.parse("2026-09-08T12:00:00.000Z");
    const lineBytes = sampleLine({
      schema: 1,
      at: new Date(base).toISOString(),
      nextDueMs: 73_000,
      kind: "reading",
      report: report(),
    }).length;
    for (let i = 0; i < Math.ceil((MAX_FILE_BYTES * 2.5) / lineBytes); i++) {
      store.append(
        { kind: "reading", report: report() },
        { at: new Date(base + i * 1000).toISOString(), nextDueMs: 73_000 },
      );
    }
    const total =
      statSync(join(dir, "health.jsonl")).size + statSync(join(dir, "health.prev.jsonl")).size;
    expect(total).toBeLessThanOrEqual(MAX_FILE_BYTES * 2);
  });
});

describe("damage", () => {
  it("repairs a torn last line at open, before anything appends after it", () => {
    /* jsonl.ts's rule, and the reason it is a rule: the next append would weld a
       valid record onto the corrupt bytes, and one append later the malformed
       record is no longer last — so forgiving it on READ cannot recover. */
    const { dir, store } = withStore();
    const path = join(dir, "health.jsonl");
    writeFileSync(
      path,
      `${sampleLine({ schema: 1, at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000, kind: "reading", report: report() })}{"schema":1,"at":"2026-09-08T12:01`,
    );

    /* A REOPEN IS WHAT A RESTART IS, and a restart releases the lock. Without
       this the second store is locked out by the first — by this very process —
       and its append does nothing while looking exactly like a repair that did
       not work. */
    store.close();
    const reopened = openHealthHistory(dir);
    if (reopened.kind !== "open") throw new Error("store would not reopen");
    open.push(reopened.store);
    expect(reopened.repaired.torn).toBe(true);

    reopened.store.append(
      { kind: "reading", report: report() },
      { at: "2026-09-08T12:02:00.000Z", nextDueMs: 73_000 },
      NOT_DUE,
    );
    const read = reopened.store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.samples.map((s) => s.at)).toEqual([
      "2026-09-08T12:00:00.000Z",
      "2026-09-08T12:02:00.000Z",
    ]);
    expect(read.unreadableLines).toBe(0);
  });

  it("counts an unreadable line in the middle rather than dropping it silently or refusing the window", () => {
    /* A DELIBERATE DEPARTURE from tools/overseer/store.ts, which refuses to fold
       across a hole. There is no fold here: a lost line is a missing sample,
       which this panel already draws honestly as a break. Refusing the whole
       window over one torn byte would blank a chart that is mostly fine, and a
       blank chart reads as "the box was down". So it is counted, and the count
       reaches the page. */
    const { dir, store } = withStore();
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 });
    appendFileSync(join(dir, "health.jsonl"), "{not json at all\n");
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:02:00.000Z", nextDueMs: 73_000 });

    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.samples).toHaveLength(2);
    expect(read.unreadableLines).toBe(1);
  });

  it("counts a line that is JSON but not a sample", () => {
    const { dir, store } = withStore();
    appendFileSync(join(dir, "health.jsonl"), `${JSON.stringify({ schema: 1, at: "nonsense", kind: "reading" })}\n`);
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:02:00.000Z", nextDueMs: 73_000 });

    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.samples).toHaveLength(1);
    expect(read.unreadableLines).toBe(1);
  });

  it("says it could not read rather than returning an empty history", () => {
    /* An empty array and "I could not open the file" are opposite claims, and
       the second one drawn as the first is a 24h chart confidently reporting a
       day of nothing. */
    const { store } = withStore();
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 });
    /* The file EXISTS and reading it fails — permissions, a bad block, a full
       inode cache. A missing file is a different thing and is legitimately
       empty, which is why this test has to leave the file in place to reach the
       arm it is about. (It reached the wrong one on the first run, and that is
       the whole reason the distinction is now written down here.) */
    const read = store.read({ sinceMs: 0, readFile: () => { throw new Error("EIO"); } });
    expect(read.kind).toBe("unreadable");
    if (read.kind !== "unreadable") return;
    expect(read.why).toMatch(/EIO/);
  });

  it("a store that has never been written is empty, and says so with no earliest", () => {
    const { store } = withStore();
    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.samples).toEqual([]);
    expect(read.earliestAt).toBeNull();
    expect(read.unreadableLines).toBe(0);
  });
});

/* ================================================================== *
 * What GPT Sol's review of the plan added, 2026-09-08. Each of these is
 * a way the page could have drawn a confident, plausible, wrong picture.
 * ================================================================== */

describe("the writer's own condition", () => {
  it("reports a healthy writer without inventing a claim about the box", () => {
    const { store } = withStore();
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 });
    const status = store.status();
    expect(status.failure).toBeNull();
    expect(status.poisoned).toBe(false);
    expect(status.lockedOutBy).toBeNull();
    expect(status.lastSuccessAt).toBe("2026-09-08T12:00:00.000Z");
  });

  it("records a failure that wrote NOTHING without poisoning, and resumes when it clears", () => {
    /* **THE NARROWING A BROWSER PASS FORCED.** A throw from `openSync` — a
       read-only file, a missing directory — happened before a byte could be
       written, so the file is intact and a later attempt is free to succeed. The
       first version poisoned on exactly this and then refused to resume when the
       permission bit was put back: a self-inflicted hole in the record, on top
       of a problem that had been fixed. */
    const { dir, store } = withStore();
    const live = join(dir, "health.jsonl");
    rmSync(live, { force: true });
    mkdirSync(live); // a directory where the file should be: `openSync(…, "a")` refuses

    expect(() =>
      store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 }),
    ).toThrow();
    expect(store.status().poisoned).toBe(false);
    /* The REAL cause, in the tool's own words — not this store's boilerplate. */
    expect(store.status().failure).toMatch(/EISDIR|illegal operation|directory/i);

    rmSync(live, { recursive: true, force: true });
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:01:13.000Z", nextDueMs: 73_000 });
    expect(store.status().failure).toBeNull();
    expect(store.status().lastSuccessAt).toBe("2026-09-08T12:01:13.000Z");
  });

  it("keeps the ORIGINAL reason while it is refusing, rather than overwriting it with the refusal", () => {
    /* Found by making the file read-only on a running server and reading the
       payload: the second attempt replaced "EACCES" with "an earlier write may
       have left a partial record", so the page described a permissions problem
       as a corruption problem. `poisoned` says we are refusing; `failure` says
       why we are in trouble. Two facts, two fields. */
    const failing = withPartialWriter();
    expect(() =>
      failing.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 }),
    ).toThrow();
    expect(failing.status().poisoned).toBe(true);
    const original = failing.status().failure;
    expect(original).toMatch(/wrote/i);

    failing.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:02:00.000Z", nextDueMs: 73_000 });
    expect(failing.status().poisoned).toBe(true);
    expect(failing.status().failure).toBe(original);
    /* And nothing was written by the refused attempt. */
    expect(failing.status().lastSuccessAt).toBeNull();
  });

  it("a locked-out opener REPAIRS NOTHING, so it cannot damage the owner's file", () => {
    /* **THE ONE THAT DESTROYED DATA.** `truncateToLastLine` is a write, and it
       ran before the lock was claimed — so a second process, one that would go
       on to be correctly refused and correctly report itself read-only, had
       already cut the owner's live file back. GPT Sol measured 105 bytes to 100.
       If the owner were mid-write, that is damage to an active record, done by a
       process that never believed it was writing at all. */
    const { dir, store } = withStore();
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 });

    /* A torn tail, of the kind a repair would cut off. */
    const live = join(dir, "health.jsonl");
    appendFileSync(live, '{"schema":1,"at":"2026-09-08T12:01');
    const before = statSync(live).size;

    const second = openHealthHistory(dir);
    if (second.kind !== "open") throw new Error("the second store should open read-only, not refuse");
    open.push(second.store);

    expect(second.store.status().lockedOutBy).not.toBeNull();
    expect(second.repaired.torn).toBe(false);
    /* NOT ONE BYTE. The torn tail is the owner's to repair at its own next
       start; until then a reader simply sees a line it cannot parse, which this
       store already reports as a positional hole. */
    expect(statSync(live).size).toBe(before);
  });

  it("stops writing when the lock stops being ours, rather than writing beside the winner", () => {
    /* `takeLock` at startup is not a claim that survives the process: the
       stale-lock race lock.ts names can leave two claimants, and without a
       per-write check the loser appends beside the winner for ever, producing a
       history with two sample densities and no way to tell. */
    const { dir, store } = withStore();
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 });

    /* Somebody else takes the lock out from under us. */
    rmSync(join(dir, "writer.lock"), { force: true });
    writeFileSync(
      join(dir, "writer.lock"),
      `${JSON.stringify({ pid: process.pid, instanceId: "somebody-else", hostname: "box", startedAt: "2026-09-08T12:00:30.000Z" })}\n`,
    );

    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:01:13.000Z", nextDueMs: 73_000 });
    expect(store.status().lockedOutBy).toMatch(/no longer this process/);

    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.samples).toHaveLength(1);
  });

  it("keeps reading but stops writing when another process holds the lock", () => {
    /* **Degrade, never refuse.** A dashboard that would not start because a
       lock file was held would be unavailable exactly when somebody is trying
       to find out what went wrong. */
    const { dir, store } = withStore();
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 });

    /* A second store in the same directory: the first one still holds the lock. */
    const second = openHealthHistory(dir);
    if (second.kind !== "open") throw new Error("the second store should still OPEN — it just must not write");
    open.push(second.store);

    expect(second.store.status().lockedOutBy).not.toBeNull();
    second.store.append(
      { kind: "reading", report: report() },
      { at: "2026-09-08T12:01:13.000Z", nextDueMs: 73_000 },
      NOT_DUE,
    );

    const read = second.store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    /* It read the first store's sample, and added none of its own. */
    expect(read.samples).toHaveLength(1);
    expect(second.store.status().failure).not.toBeNull();
  });
});

describe("the left edge of the window", () => {
  it("returns the sample before the window, so a break already in progress can be seen", () => {
    /* Without it, a window that opens in the middle of a four-hour break has
       its first sample hours from the left edge and no way to say whether that
       emptiness is a break or where the record starts. */
    const { store } = withStore();
    const base = Date.parse("2026-09-08T12:00:00.000Z");
    store.append({ kind: "reading", report: report() }, { at: new Date(base).toISOString(), nextDueMs: 73_000 });
    store.append(
      { kind: "reading", report: report() },
      { at: new Date(base + 4 * 3_600_000).toISOString(), nextDueMs: 73_000 },
    );

    const read = store.read({ sinceMs: base + 3_600_000 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.samples).toHaveLength(1);
    expect(read.predecessor?.at).toBe(new Date(base).toISOString());
  });

  it("has no predecessor when the window starts before everything", () => {
    const { store } = withStore();
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 });
    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.predecessor).toBeNull();
  });
});

describe("where the damage was", () => {
  it("places an unreadable line between its neighbours rather than only counting it", () => {
    /* A count alone lets a renderer draw a line straight across the place the
       record is broken — the same reconnection a break must never get. */
    const { dir, store } = withStore();
    const base = Date.parse("2026-09-08T12:00:00.000Z");
    store.append({ kind: "reading", report: report() }, { at: new Date(base).toISOString(), nextDueMs: 73_000 });
    appendFileSync(join(dir, "health.jsonl"), "{torn\n");
    store.append({ kind: "reading", report: report() }, { at: new Date(base + 73_000).toISOString(), nextDueMs: 73_000 });

    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.holes).toEqual([{ afterAtMs: base, beforeAtMs: base + 73_000 }]);
  });

  it("treats a run of bad lines as one place the record is broken, not several", () => {
    const { dir, store } = withStore();
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 });
    appendFileSync(join(dir, "health.jsonl"), "{torn\n{also torn\n{and again\n");
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:01:13.000Z", nextDueMs: 73_000 });

    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.holes).toHaveLength(1);
    expect(read.unreadableLines).toBe(3);
  });
});

describe("what the earliest sample is allowed to claim", () => {
  it("says a rotation has happened, so the page cannot call it the first ever taken", () => {
    /* "Collecting since 09:14" is a claim about when we started looking. After
       a rotation, older samples existed and were discarded, and it would be
       false — so the page says "retained data begins" instead. */
    const { store } = withStore();
    const base = Date.parse("2026-09-08T12:00:00.000Z");
    const lineBytes = sampleLine({
      schema: 1,
      at: new Date(base).toISOString(),
      nextDueMs: 73_000,
      kind: "reading",
      report: report(),
    }).length;
    for (let i = 0; i < Math.ceil(MAX_FILE_BYTES / lineBytes) + 2; i++) {
      store.append(
        { kind: "reading", report: report() },
        { at: new Date(base + i * 1000).toISOString(), nextDueMs: 73_000 },
      );
    }
    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.rotated).toBe(true);
  });

  it("is not rotated on a fresh store", () => {
    const { store } = withStore();
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 });
    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.rotated).toBe(false);
  });
});

describe("bounding a record", () => {
  it("drops an oversized work summary but keeps the health reading and states the loss on disk", () => {
    const { dir, store } = withStore();
    const oversizedWork = due({
      kind: "scan",
      scannedAt: "2026-09-08T12:00:00.000Z",
      groups: [{
        session: "x".repeat(MAX_LINE_BYTES),
        sessionName: null,
        recogniser: "vitest",
        jobs: 1,
        timing: { kind: "unknown" },
      }],
      groupsDropped: 0,
      panes: { work: 1, none: 0, cannotTell: 0 },
    });
    store.append(
      { kind: "reading", report: report() },
      { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 },
      oversizedWork,
    );

    const raw = readFileSync(join(dir, "health.jsonl"), "utf8").trim();
    const stored = JSON.parse(raw) as HealthSample;
    expect(stored.kind).toBe("reading");
    expect(stored.workTurn).toMatchObject({
      kind: "due",
      result: { kind: "checkpoint-unavailable", why: expect.stringMatching(/dropped.*size/i) },
    });
    expect(store.status().failure).toMatch(/dropped.*size/i);
  });

  it("keeps a maximum-work day plus pessimistic ordinary health comfortably inside one rotation", () => {
    const groups = Array.from({ length: 100 }, (_, index) => ({
      session: `session-${index}-${"s".repeat(80)}`,
      /* Named, and long: the rotation budget has to hold a maximum-sized record,
         and a name is one more unbounded-looking string on it. */
      sessionName: `name-${index}-${"n".repeat(60)}`,
      recogniser: `recogniser-${index}-${"r".repeat(40)}`,
      jobs: 99,
      timing: {
        kind: "known" as const,
        oldestStartedAt: "2026-09-10T00:00:00.000Z",
        longestRanForMs: 86_400_000,
      },
    }));
    let maximumWork: StoredWork = {
      kind: "scan",
      scannedAt: "2026-09-10T23:59:59.999Z",
      groups,
      groupsDropped: 0,
      panes: { work: 100, none: 100, cannotTell: 100 },
    };
    while (Buffer.byteLength(JSON.stringify(maximumWork), "utf8") > MAX_STORED_WORK_BYTES) {
      groups.pop();
      maximumWork = { ...maximumWork, groups, groupsDropped: maximumWork.groupsDropped + 1 };
    }
    const workBytes = Buffer.byteLength(JSON.stringify(maximumWork), "utf8");
    /**
     * **THE FIXTURE REALLY IS AT THE MAXIMUM**, asserted without a magic
     * tolerance.
     *
     * This said `> MAX_STORED_WORK_BYTES - 256`, which stopped being true the
     * day a field was added to `StoredWorkGroup`: one group is now about three
     * hundred bytes, so dropping the last one lands further below the cap than
     * 256 and the day's model would quietly have been built from a SMALLER
     * record than the budget allows — a rotation proof about the wrong size.
     *
     * Putting one group back must break the budget. That is the same claim,
     * expressed in the fixture's own units, and it cannot go stale when a field
     * moves.
     */
    expect(workBytes).toBeLessThanOrEqual(MAX_STORED_WORK_BYTES);
    const oneMore = { ...maximumWork, groups: [...groups, groups[0] as StoredWorkGroup] };
    expect(Buffer.byteLength(JSON.stringify(oneMore), "utf8")).toBeGreaterThan(MAX_STORED_WORK_BYTES);

    const pessimisticReport = report({
      load: { kind: "value", load1: 72.5, load5: 61, load15: 44, cores: 16, ratio1: 72.5 / 16 },
      memory: {
        kind: "value",
        totalBytes: 32_000_000_000,
        availableBytes: 1_400_000_000,
        availableFraction: 0.04375,
      },
      swap: {
        kind: "value",
        totalBytes: 34_000_000_000,
        usedBytes: 33_500_000_000,
        usedFraction: 33.5 / 34,
        areas: 2,
      },
      disk: {
        kind: "value",
        totalKiB: 150_000_000,
        usedKiB: 146_000_000,
        availableKiB: 4_000_000,
        usePercent: 97,
      },
      swapActivity: { kind: "value", siKBs: 18_000, soKBs: 9_000, waPercent: 63, activelySwapping: true },
      attribution: {
        kind: "value",
        groups: [
          { kind: "vitest", procs: 38, rssKiB: 8_518_356 },
          { kind: "vite", procs: 12, rssKiB: 2_518_356 },
          { kind: "chrome", procs: 18, rssKiB: 4_518_356 },
          { kind: "node", procs: 20, rssKiB: 6_518_356 },
          { kind: "other", procs: 9, rssKiB: 1_518_356 },
        ],
      },
      verdict: {
        level: "critical",
        reasons: [
          "the one-minute load average is more than four times the available core count",
          "less than five percent of memory remains available after reclaimable cache",
          "more than ninety-eight percent of configured swap is resident",
          "the root filesystem is at the critical disk-use boundary",
          "the sampled CPU interval spent more than half its time waiting for IO",
        ],
      },
      tookMs: 29_874,
    });
    const base = Date.parse("2026-09-10T00:00:00.000Z");
    const sampleCount = 24 * 60;
    let workCount = 0;
    let dayBytes = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const workTurn = index % 5 === 0 ? due(maximumWork) : NOT_DUE;
      if (workTurn.kind === "due") workCount += 1;
      dayBytes += Buffer.byteLength(sampleLine({
        schema: 1,
        at: new Date(base + index * 60_000).toISOString(),
        nextDueMs: 60_000,
        kind: "reading",
        report: pessimisticReport,
        workTurn,
      }), "utf8");
    }

    expect(sampleCount).toBe(1_440);
    expect(workCount).toBe(288);
    expect(dayBytes).toBeLessThan(MAX_FILE_BYTES / 2);
  });

  it("still writes sample-omitted when the health reading itself is oversized", () => {
    const { dir, store } = withStore();
    const huge = report({ verdict: { level: "critical", reasons: ["y".repeat(MAX_LINE_BYTES * 2)] } });
    store.append(
      { kind: "reading", report: huge },
      { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 },
      NOT_DUE,
    );

    const stored = JSON.parse(readFileSync(join(dir, "health.jsonl"), "utf8")) as HealthSample;
    expect(stored.kind).toBe("sample-omitted");
    expect(stored.workTurn).toEqual(NOT_DUE);
  });

  it("keeps bounded due work when the health reading itself is what was omitted", () => {
    const { dir, store } = withStore();
    const work = due({
      kind: "scan",
      scannedAt: "2026-09-08T11:59:59.000Z",
      groups: [],
      groupsDropped: 0,
      panes: { work: 0, none: 2, cannotTell: 0 },
    });
    const huge = report({ verdict: { level: "critical", reasons: ["y".repeat(MAX_LINE_BYTES * 2)] } });

    store.append(
      { kind: "reading", report: huge },
      { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 },
      work,
    );

    const stored = JSON.parse(readFileSync(join(dir, "health.jsonl"), "utf8")) as HealthSample;
    expect(stored.kind).toBe("sample-omitted");
    expect(stored.workTurn).toEqual(work);
  });

  it("rotates before an omission record would cross the file-size ceiling", () => {
    const { dir, store } = withStore();
    const filler = sampleLine({
      schema: 1,
      at: "2026-09-08T11:59:59.000Z",
      nextDueMs: 73_000,
      kind: "collector-failed",
      why: "x",
      workTurn: NOT_DUE,
    });
    const copies = Math.floor(MAX_FILE_BYTES / Buffer.byteLength(filler, "utf8"));
    writeFileSync(join(dir, "health.jsonl"), filler.repeat(copies));
    expect(statSync(join(dir, "health.jsonl")).size).toBeLessThanOrEqual(MAX_FILE_BYTES);

    const huge = report({ verdict: { level: "critical", reasons: ["y".repeat(MAX_LINE_BYTES * 2)] } });
    store.append(
      { kind: "reading", report: huge },
      { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 },
      NOT_DUE,
    );

    expect(statSync(join(dir, "health.jsonl")).size).toBeLessThanOrEqual(MAX_FILE_BYTES);
    expect(statSync(join(dir, "health.prev.jsonl")).size).toBeGreaterThan(0);
  });

  it("refuses a sample whose SERIALISED size blows the per-record limit", () => {
    /* Bounding one `why` was not bounding the record. A type-valid report whose
       READINGS' own `why` strings were long — every parser carries one, and
       `verdict.reasons` is an array of them — wrote a 40,000,420-byte file
       against a claimed 8,388,608-byte cap. The rotation invariant depends on a
       record having a size. GPT Sol's finding 7. */
    const { store } = withStore();
    const huge = report({
      load: { kind: "unknown", why: "x".repeat(200_000) },
      verdict: { level: "unknown", reasons: ["y".repeat(200_000)] },
    });
    store.append({ kind: "reading", report: huge }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 });

    /* Not poisoned — the reading was never written, so the file is intact. */
    expect(store.status().poisoned).toBe(false);
    expect(store.status().failure).toMatch(/per-record limit/);

    /* **AND AN OMISSION GOES ON DISK.** The first version set an in-memory
       failure and returned, which the next success cleared: healthy, oversized
       CRITICAL, healthy, and the two healthy samples are close enough that the
       chart joins them — the one turn the box was in trouble erased, with
       nothing anywhere saying a sample had been dropped. */
    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.samples).toHaveLength(1);
    const sample = read.samples[0];
    if (sample?.kind !== "sample-omitted") throw new Error("expected an omission record");
    expect(sample.why).toMatch(/not kept/);
    /* Small enough that the record of an oversized record is not itself one. */
    expect(sampleLine(sample).length).toBeLessThan(MAX_LINE_BYTES);
  });

  it("an omission survives a later success, so the break cannot close behind it", () => {
    const { store } = withStore();
    const huge = report({ verdict: { level: "critical", reasons: ["y".repeat(200_000)] } });
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 });
    store.append({ kind: "reading", report: huge }, { at: "2026-09-08T12:01:13.000Z", nextDueMs: 73_000 });
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:02:26.000Z", nextDueMs: 73_000 });

    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    expect(read.samples.map((s) => s.kind)).toEqual(["reading", "sample-omitted", "reading"]);
    /* The in-memory failure IS cleared by the later success — that is correct,
       the writer is working again — and the durable record is what remains. */
    expect(store.status().failure).toBeNull();
  });

  it("measures the record in BYTES, not in UTF-16 code units", () => {
    /* `statSync().size` is bytes and `String.length` is code units, so the
       rotation cap was comparing two different things — the same unit mismatch
       health.ts's `totalBytes` rename exists to stop. */
    const { store } = withStore();
    /* Every character here is three bytes. */
    const wide = report({ load: { kind: "unknown", why: "あ".repeat(30_000) } });
    store.append({ kind: "reading", report: wide }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 });
    expect(store.status().failure).toMatch(/per-record limit/);
  });

  it("truncates an unbounded `why`, and says it did", () => {
    /* An unbounded string makes the file's growth rate unbounded, which is the
       assumption the rotation cap depends on. */
    const { store } = withStore();
    store.append({ kind: "collector-failed", why: "x".repeat(50_000) }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 });
    const read = store.read({ sinceMs: 0 });
    if (read.kind !== "read") throw new Error(read.why);
    const sample = read.samples[0];
    if (sample?.kind !== "collector-failed") throw new Error("expected a collector failure");
    expect(sample.why.length).toBeLessThan(MAX_WHY_CHARS + 100);
    expect(sample.why).toMatch(/truncated/);
  });
});

describe("the file on disk", () => {
  it("is one JSON object per line, so it can be read with grep when the page is what is broken", () => {
    const { dir, store } = withStore();
    store.append({ kind: "reading", report: report() }, { at: "2026-09-08T12:00:00.000Z", nextDueMs: 73_000 });
    store.append({ kind: "collector-failed", why: "boom" }, { at: "2026-09-08T12:01:00.000Z", nextDueMs: 73_000 });
    const text = readFileSync(join(dir, "health.jsonl"), "utf8");
    const lines = text.split("\n").filter((l) => l !== "");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      const parsed: unknown = JSON.parse(line);
      expect(parsed).toMatchObject({ schema: 1 });
    }
    expect(text.endsWith("\n")).toBe(true);
  });
});

/** Kept honest: the sample type is the one the store writes. */
const _typeCheck: HealthSample = {
  schema: 1,
  at: "2026-09-08T12:00:00.000Z",
  nextDueMs: 73_000,
  kind: "collector-failed",
  why: "x",
};
void _typeCheck;
