/**
 * Why a session is not doing anything — tools/fleet/pause.ts.
 *
 * ## THE FIXTURES ARE REAL, AND THE CRON ONE IS THE WHOLE STORY IN ONE FILE
 *
 * `tests/fixtures/fleet-pause/real-cron-created-deleted-recreated.jsonl` is
 * twelve records cut verbatim out of session `968beaba`'s live transcript on
 * 2026-09-08 — every record in that file that carries a `Cron*` `tool_use` or
 * its result, in transcript order, and nothing else (the ~900 records between
 * them are ordinary work). The agent created two wake-ups at 08:43, deleted
 * both at 08:48, and created two more at 08:49. So one real capture exercises
 * dedupe, cancellation, and the pending case at once, and a `CronDelete` that
 * matched nothing would be visible as four pending crons instead of two.
 *
 * `sessions-store-real/` is three files copied verbatim out of
 * `~/.claude/sessions/` at 13:46 the same day: one `shell`, one `busy`, one
 * `idle`. `shell` is the value `claude agents --json` normalises away to
 * `busy`, which is the whole reason source 2 exists.
 *
 * Everything else is declared-fabricated, per this project's rule that an edge
 * case which cannot be provoked live still needs a fixture rather than a skip.
 * **No live rate-limited session existed to capture** (the plan doc says so and
 * quota was deliberately not burned to make one), so every rate-limit case here
 * is built from the injected reading rather than from a capture.
 *
 * ## WHAT THIS FILE IS MOSTLY ABOUT
 *
 * `choosePause` — the JOIN. The parts of this module are easy and the join is
 * where the postmortem says the failures live, so most of the tests below hand
 * it three already-read readings and check one value comes out. The rule under
 * test more than any other: **one source failing while the other two are clean
 * is `cannot-tell`, never `none`.**
 *
 * ## THE TIMEZONE ASSERTIONS ARE WRITTEN TO SURVIVE A DIFFERENT BOX
 *
 * Cron expressions are local wall-clock time — proved, not assumed: session
 * `968beaba` set `36 12 08 09 *` and the wake-up prompt lands in its transcript
 * at `2026-09-08T11:36:00.565Z`, which is 12:36 in Europe/London. So the
 * expected instants below are built with the local `Date` constructor rather
 * than written as UTC literals, and the wall-clock assertions read the local
 * hour back. Both are exact on this box and correct on any other.
 */
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  type CronScan,
  type PauseInputs,
  type RateLimitReading,
  type ShellState,
  type StoreIndex,
  OVERDUE_GRACE_MS,
  causeOfTailFailure,
  choosePause,
  nextCronFire,
  parseSessionStoreFiles,
  readPause,
  readShellState,
  scanCronRecords,
} from "../tools/fleet/pause.js";
import type { TranscriptRecord } from "../tools/fleet/transcript.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/fleet-pause");

function records(name: string): TranscriptRecord[] {
  return readFileSync(path.join(FIXTURES, name), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as TranscriptRecord);
}

function storeFiles(dir: string): { name: string; text: string }[] {
  const full = path.join(FIXTURES, dir);
  return readdirSync(full).map((name) => ({ name, text: readFileSync(path.join(full, name), "utf8") }));
}

/** Local wall-clock to an instant, the same arithmetic `nextCronFire` does. */
function localIso(y: number, month1: number, day: number, hour: number, minute: number): string {
  return new Date(y, month1 - 1, day, hour, minute, 0, 0).toISOString();
}

// ---------------------------------------------------------------------------
// Source 1: finding the crons
// ---------------------------------------------------------------------------

describe("scanCronRecords", () => {
  it("reads all four real CronCreates and cancels exactly the two the agent deleted", () => {
    const scan = scanCronRecords(records("real-cron-created-deleted-recreated.jsonl"));
    expect(scan.entries).toHaveLength(4);
    const cancelled = scan.entries.filter((e) => e.cancelled).map((e) => e.cronJobId);
    const pending = scan.entries.filter((e) => !e.cancelled).map((e) => e.cronJobId);
    expect(cancelled.sort()).toEqual(["149958f8", "a2792b5d"]);
    expect(pending.sort()).toEqual(["4f70bb71", "7b4db54e"]);
  });

  it("matches a CronDelete by the cron JOB id from the result, not by the tool_use id", () => {
    // THE CORRECTION TO THE RESEARCH. The plan doc says "dedupe on `tool_use.id`
    // and honour a later `CronDelete`", which reads as though the delete names
    // the tool_use. It does not: `CronCreate` returns `{"id":"a2792b5d",…}` in
    // `toolUseResult`, and the delete's input is `{"id":"a2792b5d"}` — an
    // 8-hex-char job id that appears NOWHERE on the tool_use. An implementation
    // that matched on `tool_use.id` would cancel nothing, ever, and would look
    // exactly like one that worked.
    const scan = scanCronRecords(records("real-cron-created-deleted-recreated.jsonl"));
    const first = scan.entries.find((e) => e.toolUseId === "toolu_01Rn8337aHQMW2fwTkkknjpQ");
    expect(first?.cronJobId).toBe("a2792b5d");
    expect(first?.toolUseId).not.toBe(first?.cronJobId);
    expect(first?.cancelled).toBe(true);
  });

  it("prefers the result's humanSchedule and reads the creating record's timestamp", () => {
    const scan = scanCronRecords(records("real-cron-created-deleted-recreated.jsonl"));
    const live = scan.entries.find((e) => e.cronJobId === "7b4db54e");
    expect(live?.expression).toBe("36 12 08 09 *");
    expect(live?.recurring).toBe(false);
    expect(live?.createdAt).toBe("2026-09-08T08:49:01.031Z");
  });

  it("reports the newest record's timestamp as the session's last sign of life", () => {
    const scan = scanCronRecords(records("real-cron-created-deleted-recreated.jsonl"));
    expect(scan.lastRecordAt).toBe("2026-09-08T08:49:09.551Z");
  });

  it("dedupes on tool_use.id, so a record seen twice is one cron", () => {
    const all = records("real-cron-created-deleted-recreated.jsonl");
    const scanOnce = scanCronRecords(all);
    const scanTwice = scanCronRecords([...all, ...all]);
    expect(scanTwice.entries).toHaveLength(scanOnce.entries.length);
  });

  it("keeps a create whose result was above the window pending, with no job id", () => {
    // The window ends at EOF and a result follows its call by milliseconds, so a
    // create with no result in hand was still in flight when we read — and a
    // call still in flight cannot yet have been cancelled.
    const only = records("real-cron-created-deleted-recreated.jsonl").filter((r) => {
      const msg = r["message"] as { content?: unknown } | undefined;
      const content = msg?.content;
      return (
        Array.isArray(content) &&
        content.some((b) => (b as Record<string, unknown>)["name"] === "CronCreate")
      );
    });
    const scan = scanCronRecords(only);
    expect(scan.entries).toHaveLength(4);
    expect(scan.entries.every((e) => e.cronJobId === null)).toBe(true);
    expect(scan.entries.every((e) => !e.cancelled)).toBe(true);
  });

  it("does not let a CronDelete that came BEFORE a create cancel it", () => {
    const all = records("real-cron-created-deleted-recreated.jsonl");
    // Real records, re-ordered: both deletes first, then the creates they name.
    const isDelete = (r: TranscriptRecord) => JSON.stringify(r).includes('"CronDelete"');
    const reordered = [...all.filter(isDelete), ...all.filter((r) => !isDelete(r))];
    const scan = scanCronRecords(reordered);
    expect(scan.entries.filter((e) => e.cancelled)).toHaveLength(0);
  });

  it("ignores a subagent's cron", () => {
    const all = records("real-cron-created-deleted-recreated.jsonl").map((r) => ({ ...r, isSidechain: true }));
    expect(scanCronRecords(all).entries).toHaveLength(0);
  });

  it("returns nothing rather than throwing on records with no message or no content", () => {
    const junk: TranscriptRecord[] = [
      { type: "summary", summary: "x" },
      { type: "user", message: { content: "just text" }, timestamp: "2026-09-08T00:00:00.000Z" },
      { type: "assistant", message: { content: [{ type: "text", text: "hi" }] } },
      {},
    ];
    const scan = scanCronRecords(junk);
    expect(scan.entries).toHaveLength(0);
    expect(scan.lastRecordAt).toBe("2026-09-08T00:00:00.000Z");
  });
});

// ---------------------------------------------------------------------------
// Source 1: reading a time out of one
// ---------------------------------------------------------------------------

describe("nextCronFire", () => {
  it("resolves the real expression to the minute it really fired", () => {
    // `36 12 08 09 *` was set at 08:49:01Z and the wake-up prompt lands in the
    // transcript at 2026-09-08T11:36:00.565Z — 12:36 local. This is the one
    // assertion in the file checked against an observed outcome rather than
    // against the code's own arithmetic.
    const fire = nextCronFire("36 12 08 09 *", false, "2026-09-08T08:49:01.031Z");
    expect(fire).toEqual({ kind: "at", at: localIso(2026, 9, 8, 12, 36) });
    const at = new Date((fire as { at: string }).at);
    expect([at.getHours(), at.getMinutes(), at.getDate(), at.getMonth() + 1]).toEqual([12, 36, 8, 9]);
  });

  it("resolves forward from the record's own timestamp, not from now", () => {
    // Same expression, set a year earlier: the answer must be 2025's 8 September,
    // because the expression carries no year and inventing one is the bug the
    // plan doc names.
    const fire = nextCronFire("36 12 08 09 *", false, "2025-09-08T08:49:01.031Z");
    expect(fire).toEqual({ kind: "at", at: localIso(2025, 9, 8, 12, 36) });
  });

  it("rolls into the next year when the date has already passed", () => {
    const fire = nextCronFire("30 9 15 1 *", false, "2026-09-08T08:49:01.031Z");
    expect(fire).toEqual({ kind: "at", at: localIso(2027, 1, 15, 9, 30) });
  });

  it("fires later the same day when the time is still ahead", () => {
    const fire = nextCronFire("59 23 * * *", false, "2026-09-08T08:49:01.031Z");
    expect(fire).toEqual({ kind: "at", at: localIso(2026, 9, 8, 23, 59) });
  });

  it("rolls to tomorrow when a wildcard-date time has already gone by today", () => {
    // 08:49Z is 09:49 local, so 09:00 local today is behind us.
    const fire = nextCronFire("0 9 * * *", false, "2026-09-08T08:49:01.031Z");
    expect(fire).toEqual({ kind: "at", at: localIso(2026, 9, 9, 9, 0) });
  });

  it("refuses a step expression rather than guessing at one of its times", () => {
    // "every 5 minutes" has no single next time worth showing beside a pill
    // that says "back in 23m", and a wrong one goes in the loud colour.
    expect(nextCronFire("*/5 * * * *", false, "2026-09-08T08:49:01.031Z").kind).toBe("unreadable");
    expect(nextCronFire("0 */2 * * *", false, "2026-09-08T08:49:01.031Z").kind).toBe("unreadable");
  });

  it("refuses a recurring wake-up, which has no single time it comes back at", () => {
    const fire = nextCronFire("36 12 08 09 *", true, "2026-09-08T08:49:01.031Z");
    expect(fire.kind).toBe("unreadable");
  });

  it("refuses a day-of-week restriction, a range, a list and a bad field count", () => {
    const anchor = "2026-09-08T08:49:01.031Z";
    for (const expr of ["30 9 * * 1", "30 9-11 * * *", "30 9,10 * * *", "30 9 * *", "30 9 * * * *"]) {
      expect(nextCronFire(expr, false, anchor).kind, expr).toBe("unreadable");
    }
  });

  it("refuses an out-of-range field rather than letting Date roll it over", () => {
    // `new Date(2026, 8, 8, 12, 70)` is a perfectly good 13:10 — which is why
    // the range check is in the parser and not left to the constructor.
    expect(nextCronFire("70 12 * * *", false, "2026-09-08T08:49:01.031Z").kind).toBe("unreadable");
    expect(nextCronFire("30 25 * * *", false, "2026-09-08T08:49:01.031Z").kind).toBe("unreadable");
    expect(nextCronFire("30 9 32 * *", false, "2026-09-08T08:49:01.031Z").kind).toBe("unreadable");
    expect(nextCronFire("30 9 * 13 *", false, "2026-09-08T08:49:01.031Z").kind).toBe("unreadable");
  });

  it("refuses when there is no expression or no anchor to resolve it against", () => {
    expect(nextCronFire(null, false, "2026-09-08T08:49:01.031Z").kind).toBe("unreadable");
    expect(nextCronFire("36 12 08 09 *", false, null).kind).toBe("unreadable");
    expect(nextCronFire("36 12 08 09 *", false, "not a date").kind).toBe("unreadable");
  });

  it("refuses a date that never comes rather than looping", () => {
    // 30 February. Two years of candidates and none matches.
    expect(nextCronFire("0 9 30 2 *", false, "2026-09-08T08:49:01.031Z").kind).toBe("unreadable");
  });
});

// ---------------------------------------------------------------------------
// Source 2: the session store
// ---------------------------------------------------------------------------

describe("parseSessionStoreFiles / readShellState", () => {
  const index = () => parseSessionStoreFiles(storeFiles("sessions-store-real"));

  it("indexes the three real store files by conversation uuid", () => {
    const i = index();
    expect(i.parsed).toBe(3);
    expect(i.unparseable).toBe(0);
    expect([...i.bySessionId.keys()].sort()).toEqual([
      "913bc3ec-f5b3-4f25-903c-b7270474386d",
      "9e1264ae-d4e2-47db-b38d-80f8b51ed4b6",
      "b2cfaf57-fda7-4ae9-a5f7-4a962ccd110e",
    ]);
  });

  it("reads the shell dwell time the CLI throws away", () => {
    // 1471795.json: status "shell", statusUpdatedAt 1788870512689. `claude
    // agents --json` reports this session as `busy` and reports no dwell at all.
    const state = readShellState(index(), "913bc3ec-f5b3-4f25-903c-b7270474386d", 1788870512689 + 372_000);
    expect(state).toEqual({ kind: "in-a-shell-call", sinceMs: 372_000 });
  });

  it("says a busy and an idle session are positively NOT in a shell call", () => {
    const i = index();
    expect(readShellState(i, "b2cfaf57-fda7-4ae9-a5f7-4a962ccd110e", Date.now()).kind).toBe("not-in-a-shell-call");
    expect(readShellState(i, "9e1264ae-d4e2-47db-b38d-80f8b51ed4b6", Date.now()).kind).toBe("not-in-a-shell-call");
  });

  it("treats a MISSING record as could-not-look, not as absence of the state", () => {
    // The rule from the brief, and the one that decides whether this source can
    // ever contribute to `none`. `~/.claude/sessions/<pid>.json` is undocumented
    // and private; a Claude Code upgrade that moved it would otherwise turn every
    // row silently calm.
/* THESE UUIDS ARE THIS FILE'S ALONE, and the odd-looking prefix is the point.
   They were `00000000-…` and `11111111-…`, which `tests/fixture-ids.test.ts`
   caught as collisions with `db-schema.test.ts` and `migration-snapshots.test.ts`.
   Vitest runs files in parallel against one database, so whichever tears down
   first deletes the other's fixture and every test in the OTHER file fails —
   green alone, red in the suite, and the failure lands on the innocent file.

   Nothing here inserts anything: `pause.ts` reads files and touches no database,
   so these are conversation ids in an in-memory index rather than rows. That
   makes `NOT_A_ROW` in that guard the textbook fix — but declaring it would be
   asserting that nothing in `db-schema.test.ts` or `migration-snapshots.test.ts`
   inserts them either, which is a claim about two files this one does not own.
   A distinct id makes no claim about anybody. */
    const state = readShellState(index(), "f1ee7a05-0000-4000-8000-000000000001", Date.now());
    expect(state.kind).toBe("unreadable");
  });

  it("treats a session with no conversation id as could-not-look", () => {
    expect(readShellState(index(), null, Date.now()).kind).toBe("unreadable");
    expect(readShellState(index(), "", Date.now()).kind).toBe("unreadable");
  });

  it("counts a file that is not JSON, or JSON of the wrong shape, without losing the others", () => {
    const i = parseSessionStoreFiles([
      ...storeFiles("sessions-store-real"),
      { name: "broken.json", text: "{not json" },
      { name: "empty.json", text: "" },
      { name: "array.json", text: "[1,2,3]" },
      { name: "no-status.json", text: JSON.stringify({ sessionId: "x", pid: 1 }) },
    ]);
    expect(i.parsed).toBe(3);
    expect(i.unparseable).toBe(4);
  });

  it("refuses to guess a dwell time when the shape shifted under us", () => {
    const i = parseSessionStoreFiles([
      { name: "1.json", text: JSON.stringify({ sessionId: "s1", status: "shell", statusUpdatedAt: "recently" }) },
    ]);
    const state = readShellState(i, "s1", Date.now());
    expect(state.kind).toBe("unreadable");
  });

  it("reads a status value it has never seen as not-shell rather than failing", () => {
    const i = parseSessionStoreFiles([
      { name: "1.json", text: JSON.stringify({ sessionId: "s1", status: "hibernating", statusUpdatedAt: 1 }) },
    ]);
    expect(readShellState(i, "s1", Date.now()).kind).toBe("not-in-a-shell-call");
  });

  it("takes the newest record when two files claim one conversation", () => {
    const i = parseSessionStoreFiles([
      { name: "old.json", text: JSON.stringify({ sessionId: "s1", status: "idle", updatedAt: 1000 }) },
      { name: "new.json", text: JSON.stringify({ sessionId: "s1", status: "shell", statusUpdatedAt: 500, updatedAt: 2000 }) },
    ]);
    expect(readShellState(i, "s1", 1500).kind).toBe("in-a-shell-call");
  });

  it("clamps a dwell time computed against a clock a moment ahead of ours", () => {
    const i = parseSessionStoreFiles([
      { name: "1.json", text: JSON.stringify({ sessionId: "s1", status: "shell", statusUpdatedAt: 2000 }) },
    ]);
    expect(readShellState(i, "s1", 1000)).toEqual({ kind: "in-a-shell-call", sinceMs: 0 });
  });
});

// ---------------------------------------------------------------------------
// The join. Most of the value in this file is below this line.
// ---------------------------------------------------------------------------

const NOW = new Date("2026-09-08T14:00:00.000Z").getTime();

/** A transcript reading with one pending cron at `at`, and nothing since `lastRecordAt`. */
function transcriptWithCron(expression: string, createdAt: string, lastRecordAt = createdAt): PauseInputs["transcript"] {
  const scan: CronScan = {
    entries: [
      {
        toolUseId: "toolu_test",
        cronJobId: "abcd1234",
        expression,
        recurring: false,
        createdAt,
        cancelled: false,
      },
    ],
    lastRecordAt,
  };
  return { kind: "read", scan, reachedStartOfFile: true };
}

/** A transcript reading that found nothing and read the whole file. */
const CLEAN_TRANSCRIPT: PauseInputs["transcript"] = {
  kind: "read",
  scan: { entries: [], lastRecordAt: "2026-09-08T13:00:00.000Z" },
  reachedStartOfFile: true,
};
const CLEAN_SHELL: ShellState = { kind: "not-in-a-shell-call" };
const CLEAN_RATE: RateLimitReading = { kind: "not-limited" };

describe("choosePause — precedence", () => {
  it("puts a positively known rate limit above a pending cron", () => {
    const pause = choosePause({
      transcript: transcriptWithCron("36 12 08 09 *", "2026-09-08T08:49:01.031Z"),
      shell: { kind: "in-a-shell-call", sinceMs: 5_000 },
      rateLimit: { kind: "limited", window: "five_hour", resetsAt: "2026-09-08T15:30:00.000Z" },
      nowMs: NOW,
    });
    expect(pause.kind).toBe("rate-limited");
  });

  it("puts a pending cron above a shell call", () => {
    const pause = choosePause({
      transcript: transcriptWithCron("36 12 08 09 *", "2026-09-08T08:49:01.031Z"),
      shell: { kind: "in-a-shell-call", sinceMs: 5_000 },
      rateLimit: CLEAN_RATE,
      nowMs: NOW,
    });
    expect(pause).toEqual({
      kind: "scheduled-wakeup",
      at: localIso(2026, 9, 8, 12, 36),
      overdue: true,
      source: "cron",
    });
  });

  it("puts a shell call above a cannot-tell, even when a source failed", () => {
    const pause = choosePause({
      transcript: { kind: "failed", cause: "no-transcript", why: "no transcript file" },
      shell: { kind: "in-a-shell-call", sinceMs: 372_000 },
      rateLimit: CLEAN_RATE,
      nowMs: NOW,
    });
    expect(pause).toEqual({ kind: "in-a-shell-call", sinceMs: 372_000 });
  });

  it("reaches `none` only when all three sources were consulted successfully", () => {
    const pause = choosePause({
      transcript: CLEAN_TRANSCRIPT,
      shell: CLEAN_SHELL,
      rateLimit: CLEAN_RATE,
      nowMs: NOW,
    });
    expect(pause).toEqual({ kind: "none" });
  });
});

describe("choosePause — one shut window is never a `none`", () => {
  // THE RULE THIS MODULE EXISTS FOR. Each of these has two clean sources and one
  // that could not be consulted, and every one of them must be `cannot-tell`
  // carrying THAT source's cause.

  it("cannot-tell when only the transcript failed", () => {
    const pause = choosePause({
      transcript: { kind: "failed", cause: "transcript-unreadable", why: "could not read the transcript: EACCES" },
      shell: CLEAN_SHELL,
      rateLimit: CLEAN_RATE,
      nowMs: NOW,
    });
    expect(pause).toMatchObject({ kind: "cannot-tell", cause: "transcript-unreadable" });
  });

  it("cannot-tell when only the session store failed", () => {
    const pause = choosePause({
      transcript: CLEAN_TRANSCRIPT,
      shell: { kind: "unreadable", why: "no record for this conversation in ~/.claude/sessions" },
      rateLimit: CLEAN_RATE,
      nowMs: NOW,
    });
    expect(pause).toMatchObject({ kind: "cannot-tell", cause: "session-store-unreadable" });
  });

  it("cannot-tell when only the rate-limit reading is missing", () => {
    // Today's ordinary case: nothing publishes a usage reading yet, so a session
    // with a clean transcript and a clean store is still not provably idle.
    const pause = choosePause({
      transcript: CLEAN_TRANSCRIPT,
      shell: CLEAN_SHELL,
      rateLimit: undefined,
      nowMs: NOW,
    });
    expect(pause).toMatchObject({ kind: "cannot-tell", cause: "rate-limits-not-collected" });
  });

  it("cannot-tell with `tail-window-exhausted` when the read stopped short of the file's start", () => {
    // Having read 32KB and found no cron is NOT the same fact as having read the
    // whole file and found none — the only difference between these two calls.
    const short: PauseInputs["transcript"] = { ...CLEAN_TRANSCRIPT, reachedStartOfFile: false };
    expect(
      choosePause({ transcript: short, shell: CLEAN_SHELL, rateLimit: CLEAN_RATE, nowMs: NOW }),
    ).toMatchObject({ kind: "cannot-tell", cause: "tail-window-exhausted" });
    expect(
      choosePause({ transcript: CLEAN_TRANSCRIPT, shell: CLEAN_SHELL, rateLimit: CLEAN_RATE, nowMs: NOW }),
    ).toEqual({ kind: "none" });
  });

  it("cannot-tell when a wake-up was found and its time could not be read", () => {
    // Something IS pending, so this is emphatically not `none` — but there is no
    // time to show and `overdue` must not be inferred. See
    // SCHEDULE_UNREADABLE_CAUSE in pause.ts: `PauseUnknownCause` has no name for
    // this state, and `transcript-unreadable` is standing in for one.
    const pause = choosePause({
      transcript: transcriptWithCron("*/30 * * * *", "2026-09-08T08:49:01.031Z"),
      shell: CLEAN_SHELL,
      rateLimit: CLEAN_RATE,
      nowMs: NOW,
    });
    expect(pause.kind).toBe("cannot-tell");
    expect(pause.kind === "cannot-tell" && pause.why).toContain("a wake-up is scheduled");
  });

  it("names every failed source in `why`, and takes the cause from the first", () => {
    const pause = choosePause({
      transcript: { kind: "failed", cause: "no-transcript", why: "there is no transcript file" },
      shell: { kind: "unreadable", why: "the session store could not be listed" },
      rateLimit: undefined,
      nowMs: NOW,
    });
    expect(pause).toMatchObject({ kind: "cannot-tell", cause: "no-transcript" });
    const why = pause.kind === "cannot-tell" ? pause.why : "";
    expect(why).toContain("there is no transcript file");
    expect(why).toContain("the session store could not be listed");
    expect(why).toContain("rate-limit reading");
  });

  it("covers every declared cause somewhere reachable", () => {
    // A positive control on the union: each name below is produced by real code
    // above, so adding a seventh arm to PauseUnknownCause fails this until it
    // has a producer.
    const produced = new Set([
      (
        choosePause({
          transcript: { kind: "failed", cause: "no-conversation-id", why: "no id" },
          shell: CLEAN_SHELL,
          rateLimit: CLEAN_RATE,
          nowMs: NOW,
        }) as { cause: string }
      ).cause,
      causeOfTailFailure({ kind: "not-found", reason: "no-transcript-file", why: "x" }).cause,
      causeOfTailFailure({ kind: "unreadable", why: "x" }).cause,
      causeOfTailFailure({ kind: "not-found", reason: "malformed-claude-session-id", why: "x" }).cause,
      (
        choosePause({
          transcript: { ...CLEAN_TRANSCRIPT, reachedStartOfFile: false },
          shell: CLEAN_SHELL,
          rateLimit: CLEAN_RATE,
          nowMs: NOW,
        }) as { cause: string }
      ).cause,
      (
        choosePause({ transcript: CLEAN_TRANSCRIPT, shell: { kind: "unreadable", why: "x" }, rateLimit: CLEAN_RATE, nowMs: NOW }) as {
          cause: string;
        }
      ).cause,
      (choosePause({ transcript: CLEAN_TRANSCRIPT, shell: CLEAN_SHELL, rateLimit: undefined, nowMs: NOW }) as { cause: string })
        .cause,
    ]);
    expect([...produced].sort()).toEqual([
      "no-conversation-id",
      "no-transcript",
      "rate-limits-not-collected",
      "session-store-unreadable",
      "tail-window-exhausted",
      "transcript-unreadable",
    ]);
  });
});

describe("choosePause — overdue", () => {
  it("is true when the time is past, the grace has elapsed, and nothing has run since", () => {
    const pause = choosePause({
      transcript: transcriptWithCron("36 12 08 09 *", "2026-09-08T08:49:01.031Z"),
      shell: CLEAN_SHELL,
      rateLimit: CLEAN_RATE,
      nowMs: NOW,
    });
    expect(pause).toMatchObject({ kind: "scheduled-wakeup", overdue: true });
  });

  it("is false when a record exists after the fire time — the wake-up fired", () => {
    // The real 12:36 wake-up landed at 11:36:00.565Z. A session that took a turn
    // after its own cron is working, not late, and this is the only thing that
    // tells the two apart.
    const pause = choosePause({
      transcript: transcriptWithCron("36 12 08 09 *", "2026-09-08T08:49:01.031Z", "2026-09-08T11:40:00.000Z"),
      shell: CLEAN_SHELL,
      rateLimit: CLEAN_RATE,
      nowMs: NOW,
    });
    expect(pause).toMatchObject({ kind: "scheduled-wakeup", overdue: false });
  });

  it("is false inside the grace period, because crons fire late on a loaded box", () => {
    const at = new Date(localIso(2026, 9, 8, 12, 36)).getTime();
    const justAfter = at + OVERDUE_GRACE_MS - 1_000;
    const pause = choosePause({
      transcript: transcriptWithCron("36 12 08 09 *", "2026-09-08T08:49:01.031Z"),
      shell: CLEAN_SHELL,
      rateLimit: CLEAN_RATE,
      nowMs: justAfter,
    });
    expect(pause).toMatchObject({ kind: "scheduled-wakeup", overdue: false });
  });

  it("is false for a wake-up still in the future", () => {
    const pause = choosePause({
      transcript: transcriptWithCron("59 23 * * *", "2026-09-08T08:49:01.031Z"),
      shell: CLEAN_SHELL,
      rateLimit: CLEAN_RATE,
      nowMs: NOW,
    });
    expect(pause).toMatchObject({ kind: "scheduled-wakeup", overdue: false });
  });

  it("is false when we could not read whether the session went on — the row we cannot vouch for must not shout", () => {
    const scan: CronScan = {
      entries: [
        { toolUseId: "t", cronJobId: "c", expression: "36 12 08 09 *", recurring: false, createdAt: "2026-09-08T08:49:01.031Z", cancelled: false },
      ],
      // No record carried a timestamp: we cannot say nothing has run since.
      lastRecordAt: null,
    };
    const pause = choosePause({
      transcript: { kind: "read", scan, reachedStartOfFile: true },
      shell: CLEAN_SHELL,
      rateLimit: CLEAN_RATE,
      nowMs: NOW,
    });
    expect(pause).toMatchObject({ kind: "scheduled-wakeup", overdue: false });
  });

  it("takes the EARLIEST pending wake-up when an agent armed two", () => {
    // The real pattern: agents arm a wake-up and a backstop thirteen minutes
    // later. The board must show the first, because that is when it comes back.
    const scan: CronScan = {
      entries: [
        { toolUseId: "t2", cronJobId: "c2", expression: "49 12 08 09 *", recurring: false, createdAt: "2026-09-08T08:49:07.339Z", cancelled: false },
        { toolUseId: "t1", cronJobId: "c1", expression: "36 12 08 09 *", recurring: false, createdAt: "2026-09-08T08:49:01.031Z", cancelled: false },
      ],
      lastRecordAt: "2026-09-08T08:49:09.551Z",
    };
    const pause = choosePause({
      transcript: { kind: "read", scan, reachedStartOfFile: true },
      shell: CLEAN_SHELL,
      rateLimit: CLEAN_RATE,
      nowMs: NOW,
    });
    expect(pause).toMatchObject({ kind: "scheduled-wakeup", at: localIso(2026, 9, 8, 12, 36) });
  });

  it("ignores a cancelled wake-up entirely", () => {
    const scan: CronScan = {
      entries: [
        { toolUseId: "t", cronJobId: "c", expression: "36 12 08 09 *", recurring: false, createdAt: "2026-09-08T08:43:00.537Z", cancelled: true },
      ],
      lastRecordAt: "2026-09-08T08:48:48.999Z",
    };
    const pause = choosePause({
      transcript: { kind: "read", scan, reachedStartOfFile: true },
      shell: CLEAN_SHELL,
      rateLimit: CLEAN_RATE,
      nowMs: NOW,
    });
    expect(pause).toEqual({ kind: "none" });
  });
});

describe("choosePause — the rate-limited arm", () => {
  // No live rate-limited session has been captured on this box, so these are
  // built from the injected reading. The numbers are the ones measured from a
  // real transcript on 2026-09-08: a limit hit at 06:02 with resetsAt 06:30, and
  // the next turn a person typing "Continue" at 08:21 — 111 minutes.
  const RESETS = "2026-09-08T05:30:00.000Z";

  it("is overdue once the reset has passed and nothing has run since", () => {
    const pause = choosePause({
      transcript: { kind: "read", scan: { entries: [], lastRecordAt: "2026-09-08T05:02:00.000Z" }, reachedStartOfFile: true },
      shell: CLEAN_SHELL,
      rateLimit: { kind: "limited", window: "five_hour", resetsAt: RESETS },
      nowMs: new Date("2026-09-08T07:21:00.000Z").getTime(),
    });
    expect(pause).toEqual({ kind: "rate-limited", window: "five_hour", resetsAt: RESETS, overdue: true });
  });

  it("is not overdue once the session has taken a turn after the reset", () => {
    const pause = choosePause({
      transcript: { kind: "read", scan: { entries: [], lastRecordAt: "2026-09-08T06:00:00.000Z" }, reachedStartOfFile: true },
      shell: CLEAN_SHELL,
      rateLimit: { kind: "limited", window: "five_hour", resetsAt: RESETS },
      nowMs: new Date("2026-09-08T07:21:00.000Z").getTime(),
    });
    expect(pause).toMatchObject({ kind: "rate-limited", overdue: false });
  });

  it("is not overdue when the transcript could not be read past the reset", () => {
    const pause = choosePause({
      transcript: { kind: "failed", cause: "transcript-unreadable", why: "EACCES" },
      shell: CLEAN_SHELL,
      rateLimit: { kind: "limited", window: "five_hour", resetsAt: RESETS },
      nowMs: new Date("2026-09-08T07:21:00.000Z").getTime(),
    });
    expect(pause).toMatchObject({ kind: "rate-limited", overdue: false });
  });

  it("keeps an unrecognised window name verbatim rather than narrowing it away", () => {
    const pause = choosePause({
      transcript: CLEAN_TRANSCRIPT,
      shell: CLEAN_SHELL,
      rateLimit: { kind: "limited", window: "opus_4_5_rotating_thing", resetsAt: RESETS },
      nowMs: NOW,
    });
    expect(pause).toMatchObject({ window: "opus_4_5_rotating_thing" });
  });

  it("does not set overdue from a resetsAt that did not parse", () => {
    const pause = choosePause({
      transcript: CLEAN_TRANSCRIPT,
      shell: CLEAN_SHELL,
      rateLimit: { kind: "limited", window: "five_hour", resetsAt: "soon" },
      nowMs: NOW,
    });
    expect(pause).toMatchObject({ kind: "rate-limited", overdue: false });
  });
});

// ---------------------------------------------------------------------------
// The collector, against files on disk.
// ---------------------------------------------------------------------------

describe("readPause", () => {
  /** A projects dir holding one transcript, and a sessions dir holding one store file. */
  function box(opts: { uuid: string; jsonl: string; store?: Record<string, unknown>[] }): {
    projectsDir: string;
    sessionsDir: string;
  } {
    const root = mkdtempSync(path.join(tmpdir(), "pause-box-"));
    const projectsDir = path.join(root, "projects");
    const sessionsDir = path.join(root, "sessions");
    mkdirSync(path.join(projectsDir, "-home-greg-code-spideryarn2"), { recursive: true });
    mkdirSync(sessionsDir, { recursive: true });
    writeFileSync(path.join(projectsDir, "-home-greg-code-spideryarn2", `${opts.uuid}.jsonl`), opts.jsonl);
    for (const [i, entry] of (opts.store ?? []).entries()) {
      writeFileSync(path.join(sessionsDir, `${1000 + i}.json`), JSON.stringify(entry));
    }
    return { projectsDir, sessionsDir };
  }

  const UUID = "968beaba-352a-489f-a202-5e1c87403920";
  const REAL_CRON_JSONL = readFileSync(path.join(FIXTURES, "real-cron-created-deleted-recreated.jsonl"), "utf8");

  it("finds the real pending wake-up end to end, from a transcript and a store on disk", () => {
    const { projectsDir, sessionsDir } = box({
      uuid: UUID,
      jsonl: REAL_CRON_JSONL,
      store: [{ sessionId: UUID, status: "idle", statusUpdatedAt: 1, updatedAt: 1 }],
    });
    return readPause({
      claudeSessionId: UUID,
      dir: null,
      rateLimit: { kind: "not-limited" },
      projectsDir,
      sessionsDir,
      nowMs: NOW,
      tailBytes: 1024 * 1024,
    }).then((pause) => {
      expect(pause).toEqual({
        kind: "scheduled-wakeup",
        at: localIso(2026, 9, 8, 12, 36),
        overdue: true,
        source: "cron",
      });
    });
  });

  it("reports the shell call when the same session has no pending wake-up", async () => {
    const { projectsDir, sessionsDir } = box({
      uuid: UUID,
      jsonl: `${JSON.stringify({ type: "assistant", timestamp: "2026-09-08T13:00:00.000Z", message: { content: [] } })}\n`,
      store: [{ sessionId: UUID, status: "shell", statusUpdatedAt: NOW - 372_000, updatedAt: NOW }],
    });
    const pause = await readPause({
      claudeSessionId: UUID,
      dir: null,
      rateLimit: { kind: "not-limited" },
      projectsDir,
      sessionsDir,
      nowMs: NOW,
      tailBytes: 1024 * 1024,
    });
    expect(pause).toEqual({ kind: "in-a-shell-call", sinceMs: 372_000 });
  });

  it("says no-conversation-id rather than none when the session has no uuid", async () => {
    const { projectsDir, sessionsDir } = box({ uuid: UUID, jsonl: "", store: [] });
    const pause = await readPause({
      claudeSessionId: null,
      dir: null,
      rateLimit: { kind: "not-limited" },
      projectsDir,
      sessionsDir,
      nowMs: NOW,
    });
    expect(pause).toMatchObject({ kind: "cannot-tell", cause: "no-conversation-id" });
  });

  it("says no-transcript when the conversation has no file", async () => {
    const { projectsDir, sessionsDir } = box({
      uuid: UUID,
      jsonl: "",
      store: [{ sessionId: "f1ee7a05-0000-4000-8000-000000000002", status: "idle", updatedAt: 1 }],
    });
    const pause = await readPause({
      claudeSessionId: "f1ee7a05-0000-4000-8000-000000000002",
      dir: null,
      rateLimit: { kind: "not-limited" },
      projectsDir,
      sessionsDir,
      nowMs: NOW,
    });
    expect(pause).toMatchObject({ kind: "cannot-tell", cause: "no-transcript" });
  });

  it("says session-store-unreadable when the store directory is not there", async () => {
    const { projectsDir } = box({ uuid: UUID, jsonl: REAL_CRON_JSONL });
    const pause = await readPause({
      claudeSessionId: UUID,
      dir: null,
      rateLimit: { kind: "not-limited" },
      projectsDir,
      sessionsDir: path.join(tmpdir(), "pause-no-such-dir-9e1264ae"),
      nowMs: NOW,
      // No cron will be found in this window, so the store's failure is what
      // reaches the answer rather than being outranked.
      tailBytes: 64,
    });
    expect(pause.kind).toBe("cannot-tell");
  });

  it("says tail-window-exhausted rather than none when the budget ran out first", async () => {
    // The real fixture is ~14KB of records with the crons at the TOP, so a small
    // budget reaches neither them nor byte 0.
    const filler = `${JSON.stringify({ type: "assistant", timestamp: "2026-09-08T13:00:00.000Z", message: { content: [{ type: "text", text: "x".repeat(400) }] } })}\n`;
    const { projectsDir, sessionsDir } = box({
      uuid: UUID,
      jsonl: REAL_CRON_JSONL + filler.repeat(40),
      store: [{ sessionId: UUID, status: "idle", statusUpdatedAt: 1, updatedAt: 1 }],
    });
    const pause = await readPause({
      claudeSessionId: UUID,
      dir: null,
      rateLimit: { kind: "not-limited" },
      projectsDir,
      sessionsDir,
      nowMs: NOW,
      tailBytes: 4096,
    });
    expect(pause).toMatchObject({ kind: "cannot-tell", cause: "tail-window-exhausted" });
  });

  it("finds the same crons through the real tail read as through the pure parser", () => {
    // The JOIN, asserted rather than assumed: readPause's collector must hand
    // scanCronRecords the same records the fixture holds. Instance 15 of the
    // postmortem is a fixture that was a claim about a producer nobody checked.
    const { projectsDir, sessionsDir } = box({
      uuid: UUID,
      jsonl: REAL_CRON_JSONL,
      store: [{ sessionId: UUID, status: "idle", statusUpdatedAt: 1, updatedAt: 1 }],
    });
    const direct = scanCronRecords(records("real-cron-created-deleted-recreated.jsonl"));
    return readPause({
      claudeSessionId: UUID,
      dir: null,
      rateLimit: { kind: "not-limited" },
      projectsDir,
      sessionsDir,
      nowMs: NOW,
      tailBytes: 1024 * 1024,
    }).then((pause) => {
      const pending = direct.entries.filter((e) => !e.cancelled);
      expect(pending).toHaveLength(2);
      expect(pause.kind).toBe("scheduled-wakeup");
    });
  });

  it("reads a REAL parked session's wake-up at the real byte depth, and the budget is load-bearing", async () => {
    // `real-parked-tail.jsonl` is the last 41KB of session 968beaba's transcript
    // as it stood at the moment it was parked — verbatim bytes, cut on record
    // boundaries at the point the agent stopped and waited. The crons sit where
    // they really sat: the wake-up 13,128 bytes from EOF and its backstop 8,056.
    //
    // This is the state the whole module exists for, and the live fleet was not
    // in it at 14:05 (every session's cron had already fired and been buried by
    // hours of later work — see the report). So it is replayed rather than
    // observed, at real offsets.
    //
    // 11:36:00.565Z is when the wake-up ACTUALLY fired in that transcript, which
    // is what makes the `at` below an observed value rather than the code's own
    // arithmetic read back.
    const parked = readFileSync(path.join(FIXTURES, "real-parked-tail.jsonl"), "utf8");
    const { projectsDir, sessionsDir } = box({
      uuid: UUID,
      jsonl: parked,
      store: [{ sessionId: UUID, status: "idle", statusUpdatedAt: 1, updatedAt: 1 }],
    });
    const at = (tailBytes: number) =>
      readPause({
        claudeSessionId: UUID,
        dir: null,
        rateLimit: { kind: "not-limited" },
        projectsDir,
        sessionsDir,
        nowMs: NOW,
        tailBytes,
      });

    expect(await at(32 * 1024)).toEqual({
      kind: "scheduled-wakeup",
      at: localIso(2026, 9, 8, 12, 36),
      overdue: true,
      source: "cron",
    });

    // AND THE BUDGET IS NOT DECORATION. At 8KB the read reaches the 12:49
    // BACKSTOP and not the 12:36 wake-up above it, so the board would say the
    // session comes back thirteen minutes later than it does. Every real agent
    // on this box arms a pair like this, so the failure is the common case, not
    // an exotic one — which is why DEFAULT_TAIL_BYTES is four times the gap.
    expect(await at(8 * 1024)).toMatchObject({ at: localIso(2026, 9, 8, 12, 49) });
  });

  it("reads a store index handed in once for the whole fleet", async () => {
    const index: StoreIndex = parseSessionStoreFiles([
      { name: "1.json", text: JSON.stringify({ sessionId: UUID, status: "shell", statusUpdatedAt: NOW - 1_000, updatedAt: NOW }) },
    ]);
    const { projectsDir } = box({
      uuid: UUID,
      jsonl: `${JSON.stringify({ type: "assistant", timestamp: "2026-09-08T13:00:00.000Z", message: { content: [] } })}\n`,
    });
    const pause = await readPause({
      claudeSessionId: UUID,
      dir: null,
      rateLimit: { kind: "not-limited" },
      projectsDir,
      // Deliberately a directory that does not exist: the handed-in index must
      // be used instead of it, so this passing proves no read happened.
      sessionsDir: path.join(tmpdir(), "pause-never-read-4f70bb71"),
      storeIndex: index,
      nowMs: NOW,
      tailBytes: 1024 * 1024,
    });
    expect(pause).toEqual({ kind: "in-a-shell-call", sinceMs: 1_000 });
  });
});
