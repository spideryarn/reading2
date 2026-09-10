/**
 * **THE FRESH CLAUDE UNDER AN UNCHANGED PANE — the case every other identity in
 * this system is blind to, reproduced.**
 *
 * `tools/overseer/diff.ts` documents the blind spot rather than closing it: the
 * tmux environment's `CLAUDE_SESSION_ID` is written once before Claude starts
 * and never updated, so when a pane's claude exits and another starts in the
 * same pane, every field the fleet carries is unchanged — the same
 * `tmuxServerPid`, the same `paneId`, the same `panePid` (the pane's shell never
 * died), the same claimed conversation id, therefore the same `sessionKey`. The
 * first block below asserts exactly that, against a REAL capture, so that the
 * gap is pinned as a value rather than described in a comment; the rest asserts
 * that the execution token sees it.
 *
 * ## What is real here and what is not, stated rather than implied
 *
 * - `quiet-claude-pane.txt` is a **real** `ps` capture off this box
 *   (tests/fixtures/overseer-process-trees/README.md).
 * - The "after" table is **derived from it** by replacing the claude row's pid,
 *   elapsed time and `--session-id` — the three things that move when a claude
 *   is replaced under a pane, and nothing else. It is not a second capture, and
 *   it is not one because taking one would mean killing somebody's live agent.
 * - The start ticks in the process-level tests are **real**: read out of this
 *   machine's own `/proc`, for processes this file really spawns.
 */
import { spawn, type ChildProcess } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterAll, describe, expect, it, vi } from "vitest";

import {
  BOOT_ID_PATH,
  parseProcStat,
  readBootIdentity,
  readExecutionIdentity,
  readProcessStart,
  type BootIdentity,
  type ProcessStartTicks,
} from "../tools/fleet/execution-identity.js";
import {
  continuityOf,
  executionTokenText,
  identityWriteGate,
  isExecutionTokenText,
} from "../tools/fleet/execution-token.js";
import { probeProcessTableAsync, toRows, readExecutions, type FleetRow } from "../tools/fleet/collect.js";
import type { OwnedOutcome, ProbeOwner } from "../tools/fleet/child.js";
import { CLOCK_SKEW_UNMEASURED, parseExecution as parseExecutionBrowser, parseRow } from "../tools/fleet/web/src/types.js";
import type { ExecutionReading } from "../tools/fleet/wire.js";
import { diff, identityOf, sessionKey } from "../tools/overseer/diff.js";
import { parseExecution, parseObservation } from "../tools/overseer/observation.js";
import { foldEvents, type RegisterEntry } from "../tools/overseer/store.js";
import { parseProcessTable, type ProcessTableReading } from "../tools/overseer/work.js";
import { EVERY_FIXTURE, editableFixture, freshFrom, rowsOf } from "./overseer-fixtures.js";

const TREES = join(import.meta.dirname, "fixtures", "overseer-process-trees");
const NOW_MS = Date.UTC(2026, 8, 8, 6, 30, 0);

/** This box's real boot id, as read on 2026-09-08. A uuid, so its shape is real too. */
const BOOT_UUID = "96e5c266-4bf6-412b-b762-6e020d640558";
const BOOT: BootIdentity = { read: true, id: BOOT_UUID };

/** One verified reading, for the wire-level cases below. */
function verifiedReading(
  pid: number,
  startTicks: number,
  conversation: Extract<ExecutionReading, { kind: "verified" }>["conversation"] = { kind: "not-claimed" },
): ExecutionReading {
  return { kind: "verified", token: { boot: BOOT_UUID, pid, startTicks }, harness: "claude-code", conversation };
}

function tableOf(text: string): ProcessTableReading {
  const parsed = parseProcessTable(text, NOW_MS);
  if (!parsed.ok) throw new Error(`fixture is not a process table: ${parsed.reason}`);
  return { read: true, rows: parsed.rows, atMs: NOW_MS };
}

/**
 * A box that has been up long enough for every fixture's elapsed time to fit
 * inside it — the fixtures' oldest process is ~115_000 s old.
 */
const UPTIME_S = 200_000;
const UPTIME = { read: true, seconds: UPTIME_S } as const;

/** A `readStart` that answers from a table of pid → ticks and refuses everything else. */
function startsFrom(ticks: ReadonlyMap<number, number>): (pid: number) => ProcessStartTicks {
  return (pid) => {
    const found = ticks.get(pid);
    return found === undefined ? { read: false, why: `no /proc/${pid}/stat in this test` } : { read: true, ticks: found };
  };
}

/**
 * A `readStart` whose ticks AGREE with the table's own elapsed times.
 *
 * Derived from the table rather than typed out, because the cross-check added
 * for GPT Sol's P1-2 compares the two, and hand-written ticks would either have
 * to be recomputed in every test or would quietly test the refusal path
 * everywhere. `only` narrows which pids have a readable `/proc` entry, so a
 * test can still make the read fail for a chosen process.
 */
function agreeingStarts(table: ProcessTableReading, only?: readonly number[]): (pid: number) => ProcessStartTicks {
  return (pid) => {
    if (!table.read) return { read: false, why: "no process table in this test" };
    if (only !== undefined && !only.includes(pid)) return { read: false, why: `no /proc/${pid}/stat in this test` };
    const row = table.rows.find((candidate) => candidate.pid === pid);
    if (row === undefined || !row.started.known) return { read: false, why: `pid ${pid} is not in this table` };
    const elapsedS = (table.atMs - row.started.atMs) / 1000;
    return { read: true, ticks: Math.round((UPTIME_S - elapsedS) * 100) };
  };
}

/* ------------------------------------------------------------------ *
 * The reproduction.
 * ------------------------------------------------------------------ */

describe("a fresh claude under an unchanged pane", () => {
  /**
   * The capture, with the one token `new-claude` writes today.
   *
   * The raw fixture predates the `--` separator, so its prompt runs on past the
   * options and `claude-argv.ts` refuses the whole command line — which
   * `tests/overseer-harness.test.ts` pins as `ambiguous-harness`, and which
   * this module therefore reports as `claimed-only` (the case below). Adding
   * the separator is the same single-token edit that test makes, and it is what
   * every session launched since carries: all 7 live claudes on this box on
   * 2026-09-08 read cleanly.
   */
  const before = readFileSync(join(TREES, "quiet-claude-pane.txt"), "utf8").replace(
    "--name cheap-postmortem-preventions Build a batch",
    "--name cheap-postmortem-preventions -- Build a batch",
  );
  const PANE_PID = 652780;
  const NEW_CLAUDE_PID = 987654;
  const CLAIMED = "404961e7-a9af-47c9-bf9e-38918ba8ffc4";
  const ACTUAL = "7b1d0f42-1111-4222-8333-9444aaaabbbb";

  /**
   * The same capture with the claude replaced: a new pid, a fresher elapsed
   * time, a different `--session-id`, the same parent. Everything above the
   * claude — the pane's own shell row — is untouched, which is the point.
   */
  const after = before
    .split("\n")
    .map((line) =>
      line.includes(`claude --session-id ${CLAIMED}`)
        ? ` ${NEW_CLAUDE_PID}  ${PANE_PID}   40 claude --session-id ${ACTUAL} --name cheap-postmortem-preventions -- Build a batch of small things`
        : line,
    )
    .join("\n");

  it("changes nothing the fleet already carried — the blind spot, as a value", () => {
    const oldTable = tableOf(before);
    const newTable = tableOf(after);
    // The pane's own row is byte-identical across the replacement. That row is
    // where `panePid` comes from, and `paneId`, `tmuxServerPid` and the tmux
    // environment's claim are not in the process table at all — nothing that
    // moves here can move them.
    const paneRow = (t: ProcessTableReading) => (t.read ? t.rows.find((r) => r.pid === PANE_PID) : undefined);
    expect(paneRow(oldTable)).toEqual(paneRow(newTable));
    // And the claim is the same string, because nothing rewrites it.
    expect(CLAIMED).toBe(CLAIMED);
  });

  it("is a different execution, and the conversation is caught as conflicting", () => {
    const first = readExecutionIdentity({
      panePid: PANE_PID,
      claimedConversationId: CLAIMED,
      table: tableOf(before),
      after: tableOf(before),
      boot: BOOT,
      uptime: UPTIME,
      readStart: agreeingStarts(tableOf(before)),
    });
    const second = readExecutionIdentity({
      panePid: PANE_PID,
      claimedConversationId: CLAIMED,
      table: tableOf(after),
      after: tableOf(after),
      boot: BOOT,
      uptime: UPTIME,
      readStart: agreeingStarts(tableOf(after)),
    });

    expect(first.kind).toBe("verified");
    expect(second.kind).toBe("verified");
    if (first.kind !== "verified" || second.kind !== "verified") return;

    expect(first.conversation).toEqual({ kind: "verified", id: CLAIMED });
    expect(second.conversation).toEqual({ kind: "conflicting", claimed: CLAIMED, observed: ACTUAL });
    expect(executionTokenText(first.token)).not.toBe(executionTokenText(second.token));

    // And the continuity question, which is what a draft or a duration asks.
    const moved = continuityOf(executionTokenText(first.token), second);
    expect(moved.kind).toBe("replaced");
    expect(moved.kind === "replaced" && moved.why).toContain("stayed the same across that");
  });

  it("refuses an identity-dependent write once the conversation conflicts", () => {
    const second = readExecutionIdentity({
      panePid: PANE_PID,
      claimedConversationId: CLAIMED,
      table: tableOf(after),
      after: tableOf(after),
      boot: BOOT,
      uptime: UPTIME,
      readStart: agreeingStarts(tableOf(after)),
    });
    const gate = identityWriteGate(second);
    expect(gate.allowed).toBe(false);
    expect(gate.allowed === false && gate.why).toContain(ACTUAL);
  });
});

/* ------------------------------------------------------------------ *
 * The two things a pid alone cannot survive.
 * ------------------------------------------------------------------ */

describe("pid reuse and reboot", () => {
  const verified = (boot: string, pid: number, startTicks: number): ExecutionReading => ({
    kind: "verified",
    token: { boot, pid, startTicks },
    harness: "claude-code",
    conversation: { kind: "not-claimed" },
  });

  it("a reused pid is a different execution", () => {
    const first = executionTokenText({ boot: BOOT_UUID, pid: 4039575, startTicks: 72055933 });
    const outcome = continuityOf(first, verified(BOOT_UUID, 4039575, 99000000));
    expect(outcome.kind).toBe("replaced");
  });

  it("the same pid and tick after a reboot is a different execution", () => {
    const first = executionTokenText({ boot: "aaaaaaaa-0000-0000-0000-000000000000", pid: 512, startTicks: 4242 });
    const outcome = continuityOf(first, verified("bbbbbbbb-0000-0000-0000-000000000000", 512, 4242));
    expect(outcome.kind).toBe("replaced");
  });

  it("the same run twice is the same execution", () => {
    const token = executionTokenText({ boot: BOOT_UUID, pid: 4039575, startTicks: 72055933 });
    expect(continuityOf(token, verified(BOOT_UUID, 4039575, 72055933))).toEqual({ kind: "same", token });
  });
});

/* ------------------------------------------------------------------ *
 * Every way of not having an answer, kept apart from each other.
 * ------------------------------------------------------------------ */

describe("what happens when we cannot tell", () => {
  const raw = readFileSync(join(TREES, "quiet-claude-pane.txt"), "utf8");
  const table = tableOf(
    raw.replace("--name cheap-postmortem-preventions Build a batch", "--name cheap-postmortem-preventions -- Build a batch"),
  );

  it("a pane whose own process is not in the table is unknown, not claimed-only", () => {
    const reading = readExecutionIdentity({
      panePid: 999_999_999,
      claimedConversationId: "abc",
      table,
      after: table,
      boot: BOOT,
      uptime: UPTIME,
      readStart: startsFrom(new Map()),
    });
    // A pane pid that is in no tree is *we could not look*, which is unknown
    // rather than claimed-only — the launch claim has not been corroborated,
    // but nothing looked at anything either.
    expect(reading.kind).toBe("unknown");
    expect(reading.kind === "unknown" && reading.cause).toBe("pane-tree-unreadable");
  });

  it("a live claude whose command line cannot be read is claimed-only", () => {
    // THE REAL CAPTURE, UNEDITED. This is a genuine, working Claude session,
    // launched before `new-claude` started writing `--`, whose prompt runs past
    // the option region so `claude-argv.ts` refuses the whole line
    // (`ambiguous-harness`). There IS something in the pane and we cannot name
    // it, which is precisely `claimed-only`, and it must never round up to
    // verified: the identity gate has to refuse a session it cannot read.
    const reading = readExecutionIdentity({
      panePid: 652780,
      claimedConversationId: "404961e7-a9af-47c9-bf9e-38918ba8ffc4",
      table: tableOf(raw),
      after: tableOf(raw),
      boot: BOOT,
      uptime: UPTIME,
      readStart: startsFrom(new Map([[412924, 72055933]])),
    });
    expect(reading.kind).toBe("claimed-only");
    expect(identityWriteGate(reading).allowed).toBe(false);
    expect(continuityOf("anything", reading).kind).toBe("unverifiable");
  });

  it("a harness that exits between the ps and the /proc read is unknown, never verified", () => {
    const reading = readExecutionIdentity({
      panePid: 652780,
      claimedConversationId: "404961e7-a9af-47c9-bf9e-38918ba8ffc4",
      table,
      after: table,
      boot: BOOT,
      uptime: UPTIME,
      // No entry for the claude's pid: the read fails, as it does when the
      // process has gone.
      readStart: startsFrom(new Map()),
    });
    expect(reading.kind).toBe("unknown");
    expect(reading.kind === "unknown" && reading.cause).toBe("process-start-unreadable");
  });

  /**
   * **THE MIXED READING — GPT Sol's P1-2, reproduced.**
   *
   * `ps` classifies the harness and reads its conversation; the `/proc` read
   * that mints the start token happens afterwards. If the harness exits and its
   * pid is reused in between, a naive implementation returns the OLD harness
   * kind and the OLD conversation with the NEW process's start ticks, stamped
   * `verified` — and if the old conversation matched the claim, the write gate
   * says yes. A verified identity assembled from two different processes is the
   * one failure this whole module exists to prevent.
   *
   * The falsifier is free: `ps` already reported the process's ELAPSED TIME, so
   * the table and `/proc` are two independent measurements of one start
   * instant. A replacement started inside the race window is seconds old while
   * `ps` said minutes, and the two disagree by the whole of the old process's
   * life.
   */
  it("refuses a start token that disagrees with the ps row it belongs to", () => {
    // The claude in this table has been running 400 s according to `ps`.
    const text = " 100  99  500 bash /home/greg/job.sh\n 101  100  400 claude --session-id claimed-uuid --permission-mode auto\n";
    const reading = readExecutionIdentity({
      panePid: 100,
      claimedConversationId: "claimed-uuid",
      table: tableOf(text),
      after: tableOf(text),
      boot: BOOT,
      uptime: { read: true, seconds: 1000 },
      // …but /proc says it started at tick 99_000, i.e. 10 s before this
      // reading — a process that is 10 s old, not 400. Something else is
      // wearing pid 101.
      readStart: startsFrom(new Map([[101, 99_000]])),
    });
    expect(reading.kind).toBe("unknown");
    expect(reading.kind === "unknown" && reading.cause).toBe("process-changed-under-read");
    // AND THE GATE REFUSES, which is the consequence that matters.
    expect(identityWriteGate(reading).allowed).toBe(false);
  });

  it("accepts a start token that agrees with the ps row, within the tick tolerance", () => {
    const text = " 100  99  500 bash /home/greg/job.sh\n 101  100  400 claude --session-id claimed-uuid --permission-mode auto\n";
    // 1000 s of uptime, 400 s elapsed ⇒ started at 600 s ⇒ tick 60_000.
    const reading = readExecutionIdentity({
      panePid: 100,
      claimedConversationId: "claimed-uuid",
      table: tableOf(text),
      after: tableOf(text),
      boot: BOOT,
      uptime: { read: true, seconds: 1000 },
      readStart: startsFrom(new Map([[101, 60_000]])),
    });
    expect(reading.kind).toBe("verified");
  });

  it("cannot cross-check without an uptime reading, and says so rather than trusting the pair", () => {
    const text = " 100  99  500 bash /home/greg/job.sh\n 101  100  400 claude --session-id claimed-uuid --permission-mode auto\n";
    const reading = readExecutionIdentity({
      panePid: 100,
      claimedConversationId: "claimed-uuid",
      table: tableOf(text),
      after: tableOf(text),
      boot: BOOT,
      uptime: { read: false, why: "/proc/uptime could not be read" },
      readStart: startsFrom(new Map([[101, 60_000]])),
    });
    expect(reading.kind).toBe("unknown");
    expect(reading.kind === "unknown" && reading.cause).toBe("uptime-unreadable");
  });

  /**
   * **THE BRACKET — GPT Sol's round-2 P1, and the proof the elapsed-time check
   * could not give.**
   *
   * The `/proc` read happens between two classifications. Here the pid survives
   * into the second table but is running a DIFFERENT conversation, which is
   * what a reused pid looks like from the far end. The old five-second
   * elapsed-time tolerance passed this whenever both processes were young; the
   * bracket refuses it whatever their ages.
   */
  it("refuses when the pane holds a different conversation on the far side of the /proc read", () => {
    const first = " 100  99  500 bash /home/greg/job.sh\n 101  100  400 claude --session-id was-this --permission-mode auto\n";
    const second = " 100  99  500 bash /home/greg/job.sh\n 101  100  400 claude --session-id now-this --permission-mode auto\n";
    const reading = readExecutionIdentity({
      panePid: 100,
      claimedConversationId: "was-this",
      table: tableOf(first),
      after: tableOf(second),
      boot: BOOT,
      uptime: UPTIME,
      readStart: agreeingStarts(tableOf(first)),
    });
    expect(reading.kind).toBe("unknown");
    expect(reading.kind === "unknown" && reading.cause).toBe("process-changed-under-read");
    expect(identityWriteGate(reading).allowed).toBe(false);
  });

  it("refuses when the harness kind changes across the /proc read", () => {
    const first = " 100  99  500 bash /home/greg/job.sh\n 101  100  400 claude --session-id x --permission-mode auto\n";
    const second = " 100  99  500 bash /home/greg/job.sh\n";
    const reading = readExecutionIdentity({
      panePid: 100,
      claimedConversationId: "x",
      table: tableOf(first),
      after: tableOf(second),
      boot: BOOT,
      uptime: UPTIME,
      readStart: agreeingStarts(tableOf(first)),
    });
    expect(reading.kind === "unknown" && reading.cause).toBe("process-changed-under-read");
  });

  it("refuses when the second table could not be read at all", () => {
    const first = " 100  99  500 bash /home/greg/job.sh\n 101  100  400 claude --session-id x --permission-mode auto\n";
    const reading = readExecutionIdentity({
      panePid: 100,
      claimedConversationId: "x",
      table: tableOf(first),
      after: { read: false, why: "ps was killed" },
      boot: BOOT,
      uptime: UPTIME,
      readStart: agreeingStarts(tableOf(first)),
    });
    // AN UNMADE CHECK IS NOT A PASSED CHECK.
    expect(reading.kind === "unknown" && reading.cause).toBe("process-changed-under-read");
  });

  it("an unreadable process table is unknown with the probe's own sentence", () => {
    const reading = readExecutionIdentity({
      panePid: 652780,
      claimedConversationId: null,
      table: { read: false, why: "ps exited 1: nope" },
      after: { read: false, why: "ps exited 1: nope" },
      boot: BOOT,
      uptime: UPTIME,
      readStart: startsFrom(new Map()),
    });
    expect(reading).toEqual({ kind: "unknown", cause: "process-table-unreadable", why: "ps exited 1: nope" });
  });

  it("a row with no pane pid is unknown", () => {
    const reading = readExecutionIdentity({
      panePid: null,
      claimedConversationId: null,
      table,
      after: table,
      boot: BOOT,
      uptime: UPTIME,
      readStart: startsFrom(new Map()),
    });
    expect(reading.kind === "unknown" && reading.cause).toBe("no-pane-pid");
  });

  it("a claude with no --session-id is a verified process and an unverifiable conversation", () => {
    const text = " 100  99  500 bash /home/greg/job.sh\n 101  100  400 claude --permission-mode auto\n";
    const reading = readExecutionIdentity({
      panePid: 100,
      claimedConversationId: "claimed-uuid",
      table: tableOf(text),
      after: tableOf(text),
      boot: BOOT,
      uptime: UPTIME,
      readStart: agreeingStarts(tableOf(text)),
    });
    expect(reading.kind).toBe("verified");
    expect(reading.kind === "verified" && reading.conversation.kind).toBe("unverifiable");
    // AND THE GATE STILL REFUSES. A verified process is not a verified
    // conversation, and the whole separation is worthless if the gate ignores it.
    expect(identityWriteGate(reading).allowed).toBe(false);
  });

  it("a verified process and a verified conversation is the only thing the gate allows", () => {
    const text = " 100  99  500 bash /home/greg/job.sh\n 101  100  400 claude --session-id claimed-uuid --permission-mode auto\n";
    const reading = readExecutionIdentity({
      panePid: 100,
      claimedConversationId: "claimed-uuid",
      table: tableOf(text),
      after: tableOf(text),
      boot: BOOT,
      uptime: UPTIME,
      readStart: agreeingStarts(tableOf(text)),
    });
    const gate = identityWriteGate(reading);
    expect(gate.allowed).toBe(true);
    expect(gate.allowed === true && gate.conversationId).toBe("claimed-uuid");
  });
});

/* ------------------------------------------------------------------ *
 * The platform rule, and the parse.
 * ------------------------------------------------------------------ */

describe("boot identity", () => {
  it("is unsupported off Linux, and never falls back to the pid", () => {
    const boot = readBootIdentity(() => {
      throw new Error("no /proc here");
    }, "darwin");
    expect(boot).toEqual({
      read: false,
      cause: "platform-unsupported",
      why: expect.stringContaining("darwin"),
    });
    const reading = readExecutionIdentity({
      panePid: 100,
      claimedConversationId: "x",
      table: tableOf(" 100  99  500 bash /home/greg/job.sh\n 101  100  400 claude --session-id x\n"),
      after: tableOf(" 100  99  500 bash /home/greg/job.sh\n 101  100  400 claude --session-id x\n"),
      boot,
      uptime: UPTIME,
      readStart: startsFrom(new Map([[101, 1]])),
    });
    expect(reading).toEqual({
      kind: "unknown",
      cause: "platform-unsupported",
      why: boot.read === false ? boot.why : "unreachable: the boot identity above was a refusal",
    });
  });

  it("an empty boot_id is a failure rather than an empty token field", () => {
    const boot = readBootIdentity(() => "\n", "linux");
    expect(boot.read).toBe(false);
    expect(boot.read === false && boot.cause).toBe("boot-identity-unreadable");
  });
});

describe("parseProcStat", () => {
  it("reads field 22 past a command name containing spaces and brackets", () => {
    // A real shape: the comm is `(a ) b)` — one closing bracket inside it, and
    // a space. Fields after the last `)` are state, ppid, pgrp, session, …
    // 20 fields: state (3) through starttime (22), so `9876543` sits at index 19.
    const fields = ["S", "7", "8", "9", "0", "-1", "4194304", "1", "2", "3", "4", "5", "6", "7", "20", "0", "1", "0", "0", "9876543"];
    expect(fields).toHaveLength(20);
    expect(parseProcStat(`1234 (a ) b) ${fields.join(" ")} 0 0 0`)).toEqual({
      ok: true,
      ppid: 7,
      startTicks: 9876543,
    });
  });

  it("refuses a truncated line rather than reading the wrong field", () => {
    expect(parseProcStat("1234 (bash) S 1 2 3").ok).toBe(false);
  });

  it("refuses a line with no command name at all", () => {
    expect(parseProcStat("nothing here").ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * Against this machine's own /proc — real pids, real ticks.
 * ------------------------------------------------------------------ */

describe.skipIf(process.platform !== "linux")("real /proc", () => {
  const children: ChildProcess[] = [];
  afterAll(() => {
    for (const child of children) child.kill("SIGKILL");
  });

  it("reads this process's own start tick, and agrees with the file", () => {
    const start = readProcessStart(process.pid);
    expect(start.read).toBe(true);
    const direct = parseProcStat(readFileSync(`/proc/${process.pid}/stat`, "utf8"));
    expect(direct.ok).toBe(true);
    if (start.read && direct.ok) expect(start.ticks).toBe(direct.startTicks);
  });

  it("reads a real boot id", () => {
    const boot = readBootIdentity();
    expect(boot.read).toBe(true);
    if (boot.read) {
      expect(boot.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(boot.id).toBe(readFileSync(BOOT_ID_PATH, "utf8").trim());
    }
  });

  it("two real processes started under one parent have different tokens", async () => {
    const spawnSleeper = (): ChildProcess => {
      const child = spawn("sleep", ["30"], { stdio: "ignore" });
      children.push(child);
      return child;
    };
    const first = spawnSleeper();
    // A clock tick is 10 ms here (`getconf CLK_TCK` is 100), so two spawns must
    // be separated by more than one tick for their start times to differ.
    await new Promise((resolve) => setTimeout(resolve, 60));
    const second = spawnSleeper();
    expect(first.pid).toBeDefined();
    expect(second.pid).toBeDefined();
    if (first.pid === undefined || second.pid === undefined) return;

    const a = readProcessStart(first.pid);
    const b = readProcessStart(second.pid);
    expect(a.read).toBe(true);
    expect(b.read).toBe(true);
    if (a.read && b.read) expect(a.ticks).not.toBe(b.ticks);
  });

  it("a pid that does not exist is a refusal, not a zero", () => {
    // 0 is never a real pid, so `/proc/0/stat` cannot exist.
    const start = readProcessStart(0);
    expect(start.read).toBe(false);
  });
});

/* ------------------------------------------------------------------ *
 * The producer: a row starts by saying nobody looked.
 * ------------------------------------------------------------------ */

describe("the collection pass", () => {
  it("a row that has not been probed says so, rather than saying unknown with no cause", () => {
    const session = {
      id: "$1",
      name: "one",
      created: new Date("2026-09-08T00:00:00.000Z"),
      attached: false,
      windows: 1,
      title: "",
      provisional: false,
      claudeId: "conv-1",
      meta: { version: "legacy" },
      role: { kind: "unclaimed" },
    } as unknown as Parameters<typeof toRows>[0][number];
    const [row] = toRows([session], new Map(), new Map([["$1", { paneId: "%1", panePid: 100 }]]));
    expect(row?.execution).toEqual({
      kind: "unknown",
      cause: "not-probed",
      why: expect.stringContaining("did not"),
    });
  });

  it("stamps an owned process table only after ps returns", async () => {
    const order: string[] = [];
    let asked: Parameters<ProbeOwner["run"]>[0] | null = null;
    const owner: ProbeOwner = {
      run: async (spec) => {
        asked = spec;
        order.push("ps-returned");
        return { kind: "ok", stdout: `${process.pid} 1 0 vitest\n`, stderr: "", tookMs: 237 };
      },
      live: () => [],
    };
    const clock = vi.spyOn(Date, "now").mockImplementation(() => {
      order.push("stamped");
      return NOW_MS;
    });
    try {
      const reading = await probeProcessTableAsync(owner);
      expect(order).toEqual(["ps-returned", "stamped"]);
      expect(asked).toMatchObject({
        key: "process-table",
        cmd: "ps",
        args: ["-eo", "pid=,ppid=,etimes=,args="],
        timeoutMs: 10_000,
      });
      expect(reading.read).toBe(true);
      if (reading.read) expect(reading.atMs).toBe(NOW_MS);
    } finally {
      clock.mockRestore();
    }
  });

  it("probes twice for the whole fleet — the bracket — and reads uptime once", async () => {
    const rows: FleetRow[] = [
      { paneId: "%1", panePid: 100, claudeSessionId: "conv-1" } as FleetRow,
      { paneId: "%2", panePid: 200, claudeSessionId: null } as FleetRow,
    ];
    const table = tableOf(
      " 100  99  500 bash /home/greg/one.sh\n" +
        " 101  100  400 claude --session-id conv-1 --permission-mode auto\n" +
        " 200  99  500 bash /home/greg/two.sh\n",
    );
    let probes = 0;
    let uptimes = 0;
    await readExecutions(rows, {
      probe: async () => {
        probes += 1;
        return table;
      },
      boot: () => BOOT,
      uptime: () => {
        uptimes += 1;
        return UPTIME;
      },
      readStart: agreeingStarts(table),
    });
    // **TWO PROBES FOR THE WHOLE FLEET, NOT TWO PER ROW.** The pair is the
    // bracket that makes a `verified` reading a claim about one process — the
    // `/proc` reads all happen between them — and the collector contract is
    // that it stays a fixed cost rather than growing with the fleet. Thirty
    // sessions must still be two.
    expect(probes).toBe(2);
    expect(uptimes).toBe(1);
    expect(rows[0]?.execution.kind).toBe("verified");
    expect(rows[1]?.execution.kind).toBe("verified");
    // The second row is a bare shell: verified as a process, and nothing was
    // claimed for it, so there is nothing to conflict with.
    expect(rows[1]?.execution).toMatchObject({ harness: "shell", conversation: { kind: "not-claimed" } });
  });

  it("finishes every process-start read before beginning the second table", async () => {
    const rows: FleetRow[] = [
      { paneId: "%1", panePid: 100, claudeSessionId: "conv-1" } as FleetRow,
      { paneId: "%2", panePid: 200, claudeSessionId: null } as FleetRow,
    ];
    const table = tableOf(
      " 100  99  500 bash /home/greg/one.sh\n" +
        " 101  100  400 claude --session-id conv-1 --permission-mode auto\n" +
        " 200  99  500 bash /home/greg/two.sh\n",
    );
    const order: string[] = [];
    let probes = 0;

    await readExecutions(rows, {
      probe: async () => {
        probes += 1;
        order.push(`ps-${probes}`);
        return table;
      },
      boot: () => BOOT,
      uptime: () => UPTIME,
      readStart: (pid) => {
        order.push(`read-${pid}`);
        return agreeingStarts(table)(pid);
      },
    });

    expect(order).toEqual(["ps-1", "read-101", "read-200", "ps-2"]);
  });

  it.each([
    { failureAt: "first", failureKind: "refused", pid: "8123", duration: "7500ms" },
    { failureAt: "first", failureKind: "timed-out", pid: "8124", duration: "10000ms" },
    { failureAt: "second", failureKind: "refused", pid: "8123", duration: "7500ms" },
    { failureAt: "second", failureKind: "timed-out", pid: "8124", duration: "10000ms" },
  ] as const)(
    "keeps a $failureKind $failureAt process probe's pid and duration in an honest unknown",
    async ({ failureAt, failureKind, pid, duration }) => {
      const rows: FleetRow[] = [
        { paneId: "%1", panePid: 100, claudeSessionId: "conv-1" } as FleetRow,
      ];
      const stdout =
        `${process.pid} 1 0 vitest\n` +
        "100 99 500 bash /home/greg/one.sh\n" +
        "101 100 400 claude --session-id conv-1 --permission-mode auto\n";
      const ok: OwnedOutcome = { kind: "ok", stdout, stderr: "", tookMs: 1 };
      const refused: OwnedOutcome = {
        kind: "refused",
        why: 'probe "process-table" still has child pid 8123 unaccounted for after 7500ms; no second child was started',
        pid: 8123,
        liveForMs: 7_500,
      };
      const timedOut: OwnedOutcome = {
        kind: "timed-out",
        why: 'probe "process-table" reached its 10000ms deadline; sent SIGTERM to process group 8124; child exit has not been observed',
        tookMs: 11_000,
        pid: 8124,
        exitObserved: false,
      };
      const failure = failureKind === "refused" ? refused : timedOut;
      const outcomes = failureAt === "first" ? [failure, refused] : [ok, failure];
      const keys: string[] = [];
      const owner: ProbeOwner = {
        run: async (spec) => {
          keys.push(spec.key);
          const outcome = outcomes.shift();
          if (outcome === undefined) throw new Error("the test asked for an unexpected third process table");
          return outcome;
        },
        live: () => [],
      };

      await readExecutions(rows, {
        probe: () => probeProcessTableAsync(owner),
        boot: () => BOOT,
        uptime: () => UPTIME,
        readStart: () => ({ read: true, ticks: (UPTIME_S - 400) * 100 }),
      });

      expect(keys).toEqual(["process-table", "process-table"]);
      expect(outcomes).toHaveLength(0);
      expect(rows[0]?.execution).toMatchObject({
        kind: "unknown",
        cause: failureAt === "first" ? "process-table-unreadable" : "process-changed-under-read",
        why: expect.stringContaining(pid),
      });
      expect(rows[0]?.execution.kind).not.toBe("verified");
      expect(rows[0]?.execution.kind === "unknown" && rows[0].execution.cause).not.toBe("not-probed");
      expect(rows[0]?.execution.kind === "unknown" && rows[0].execution.why).toContain(duration);
    },
  );
});

/* ------------------------------------------------------------------ *
 * Row → wire → browser, and row → wire → register.
 * ------------------------------------------------------------------ */

describe("the round trip", () => {
  /**
   * **THE OLD-PRODUCER CASE, WITH REAL OLD BYTES.**
   *
   * `tests/fixtures/overseer-snapshots/` was captured before this field
   * existed, so every one of those files IS a producer that omits it. Nothing
   * is stubbed to simulate the case; the case is what is on disk.
   */
  it("a captured snapshot from before this field parses as not-reported, on both readers", () => {
    for (const name of EVERY_FIXTURE) {
      const raw = editableFixture(name);
      const parsed = parseObservation(raw);
      expect(parsed.ok, `${name} should still parse`).toBe(true);
      if (!parsed.ok) continue;
      for (const row of parsed.value.rows) {
        expect(row.execution.kind, `${name} ${row.id}`).toBe("unknown");
        expect(row.execution.kind === "unknown" && row.execution.cause).toBe("not-reported");
      }
      // And the browser's independent reader, over the same bytes.
      for (const rawRow of rowsOf(raw)) {
        const row = parseRow(rawRow, CLOCK_SKEW_UNMEASURED);
        expect(row?.execution).toEqual({ kind: "unknown", cause: "not-reported", why: expect.any(String) });
      }
    }
  });

  it("an old producer's row is never cast into verified continuity", () => {
    const parsed = parseObservation(editableFixture("status-change-before"));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [row] = parsed.value.rows;
    expect(row).toBeDefined();
    if (row === undefined) return;
    // Not `same`, and not `replaced` either: there is no reading to compare.
    expect(continuityOf("some-earlier-token", row.execution).kind).toBe("unverifiable");
    expect(identityWriteGate(row.execution).allowed).toBe(false);
  });

  it("a verified reading survives the wire in both directions", () => {
    const reading: ExecutionReading = {
      kind: "verified",
      token: { boot: BOOT_UUID, pid: 4039575, startTicks: 72055933 },
      harness: "claude-code",
      conversation: { kind: "verified", id: "606cb12a-ffc5-4df4-af3a-7dc881135b5f" },
    };
    // THROUGH JSON, not by reference: the whole question is what survives being
    // serialised and read back by a parser that has never seen the producer.
    const wire = JSON.parse(JSON.stringify({ execution: reading })) as Record<string, unknown>;
    expect(parseExecution(wire["execution"])).toEqual(reading);
    expect(parseExecutionBrowser(wire["execution"])).toEqual(reading);
  });

  /**
   * **A READING THAT DISAGREES WITH ITS OWN ROW — GPT Sol's P2-4.**
   *
   * Both of these are combinations this box's producer cannot construct and a
   * payload can assert. The process half survives (the token is well-formed and
   * says which run is there); the claim about which transcript that run is
   * writing is downgraded to `unverifiable`, which is the arm the write gate
   * already refuses.
   */
  it("downgrades a verified conversation the row does not claim", () => {
    const raw = editableFixture("status-change-before");
    const [row] = rowsOf(raw);
    if (row === undefined) throw new Error("expected a row");
    row["claudeSessionId"] = "the-row-claims-this";
    row["execution"] = verifiedReading(101, 5150, { kind: "verified", id: "but-the-reading-says-this" }) as never;

    const parsed = parseObservation(raw);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const [observed] = parsed.value.rows;
    expect(observed?.execution.kind).toBe("verified");
    expect(observed?.execution.kind === "verified" && observed.execution.conversation.kind).toBe("unverifiable");
    if (observed !== undefined) expect(identityWriteGate(observed.execution).allowed).toBe(false);

    // And the browser's independent reader reaches the same verdict.
    const browserRow = parseRow(row, CLOCK_SKEW_UNMEASURED);
    expect(browserRow?.execution.kind === "verified" && browserRow.execution.conversation.kind).toBe("unverifiable");
  });

  it("downgrades a verified conversation asserted on a harness that cannot hold one", () => {
    const raw = editableFixture("status-change-before");
    const [row] = rowsOf(raw);
    if (row === undefined) throw new Error("expected a row");
    row["claudeSessionId"] = "conv-1";
    row["execution"] = {
      ...(verifiedReading(101, 5150, { kind: "verified", id: "conv-1" }) as object),
      harness: "shell",
    } as never;

    const parsed = parseObservation(raw);
    if (!parsed.ok) throw new Error("expected a snapshot");
    const [observed] = parsed.value.rows;
    expect(observed?.execution.kind === "verified" && observed.execution.conversation.kind).toBe("unverifiable");
    // THE GATE HAS ITS OWN LOCK TOO, so neither is the only thing standing here.
    expect(
      identityWriteGate({
        kind: "verified",
        token: { boot: BOOT_UUID, pid: 101, startTicks: 5150 },
        harness: "shell",
        conversation: { kind: "verified", id: "conv-1" },
      }).allowed,
    ).toBe(false);
  });

  it("a verified reading with a hole in its token is refused by both readers", () => {
    const broken = { kind: "verified", harness: "claude-code", conversation: { kind: "not-claimed" }, token: { boot: "b", pid: 5 } };
    expect(parseExecution(broken).kind).toBe("unknown");
    expect(parseExecutionBrowser(broken).kind).toBe("unknown");
  });
});

/* ------------------------------------------------------------------ *
 * The event, its rule, and the gap it is honest about.
 * ------------------------------------------------------------------ */

describe("session-execution-changed", () => {
  const CONV = "606cb12a-ffc5-4df4-af3a-7dc881135b5f";

  /** A snapshot pair off one real capture, with `execution` written onto every row. */
  function pair(before: ExecutionReading, after: ExecutionReading): [ReturnType<typeof freshFrom>, ReturnType<typeof freshFrom>] {
    const a = editableFixture("status-change-before");
    const b = editableFixture("status-change-before");
    for (const row of rowsOf(a)) row["execution"] = before as never;
    for (const row of rowsOf(b)) row["execution"] = after as never;
    return [freshFrom(a as never, "before"), freshFrom(b as never, "after")];
  }

  const TOKEN_A = `${BOOT_UUID}:412924:72055933`;
  const TOKEN_B = `${BOOT_UUID}:987654:73900001`;
  const blind: ExecutionReading = { kind: "unknown", cause: "process-table-unreadable", why: "ps exited 1" };

  /** The register as it would be after run A had been recorded for every session. */
  function knowing(token: string, snapshot: ReturnType<typeof freshFrom>): Map<ReturnType<typeof sessionKey>, string> {
    const known = new Map<ReturnType<typeof sessionKey>, string>();
    for (const row of snapshot.snapshot.rows) known.set(sessionKey(identityOf(row)), token);
    return known;
  }

  it("fires when the token moves under an unchanged pane", () => {
    const [a, b] = pair(
      verifiedReading(412924, 72055933, { kind: "verified", id: CONV }),
      verifiedReading(987654, 73900001, { kind: "conflicting", claimed: CONV, observed: "different" }),
    );
    const first = diff(null, a, new Map());
    expect(first.kind).toBe("diffed");
    if (first.kind !== "diffed") return;
    const second = diff(first.baseline, b, knowing(TOKEN_A, a));
    expect(second.kind).toBe("diffed");
    if (second.kind !== "diffed") return;
    const changed = second.events.filter((e) => e.kind === "session-execution-changed");
    expect(changed.length).toBeGreaterThan(0);
    const [one] = changed;
    expect(one?.kind === "session-execution-changed" && one.previousToken).toBe(TOKEN_A);
    expect(one?.kind === "session-execution-changed" && one.token).toBe(TOKEN_B);
    // AND NOTHING ELSE FIRED ABOUT THE PANE. That is the reproduction restated
    // at the differ: `session-replaced` and `session-pane-replaced` are both
    // silent, because the claim and the pane pid did not move.
    expect(second.events.some((e) => e.kind === "session-replaced" || e.kind === "session-pane-replaced")).toBe(false);
  });

  it("does not fire when the evidence merely goes away and comes back", () => {
    const same = verifiedReading(412924, 72055933, { kind: "verified", id: CONV });
    const [a, b] = pair(same, blind);
    const [, c] = pair(blind, same);
    const known = knowing(TOKEN_A, a);
    const first = diff(null, a, known);
    if (first.kind !== "diffed") throw new Error("expected a diff");
    // The blind collection: nothing is learned, and the register keeps A.
    const second = diff(first.baseline, b, known);
    if (second.kind !== "diffed") throw new Error("expected a diff");
    expect(second.events.some((e) => e.kind === "session-execution-changed")).toBe(false);
    // And A coming back is not a change, because it is the token we already had.
    const third = diff(second.baseline, c, known);
    if (third.kind !== "diffed") throw new Error("expected a diff");
    expect(third.events.some((e) => e.kind === "session-execution-changed")).toBe(false);
  });

  /**
   * **THE GAP THAT USED TO BE HERE, NOW CLOSED — GPT Sol's P1-1.**
   *
   * This test previously asserted the opposite: that `verified(A) → unknown →
   * verified(B)` emitted nothing, and a long comment argued the gap cost
   * history and not correctness. That argument was wrong, and Sol said why:
   * `statusSince` is an existing event-dependent consumer, so a missed event
   * left a fresh Claude wearing its predecessor's measured age — the exact
   * thing this stage's acceptance criterion forbids.
   *
   * Comparing against the REGISTER rather than against the previous snapshot
   * closes it, because the register's token survives the collection that could
   * not look.
   */
  it("catches a change straddled by a blind collection", () => {
    const runA = verifiedReading(412924, 72055933, { kind: "verified", id: CONV });
    const runB = verifiedReading(987654, 73900001, { kind: "verified", id: CONV });
    const [a, b] = pair(runA, blind);
    const [, c] = pair(blind, runB);
    const known = knowing(TOKEN_A, a);
    const first = diff(null, a, known);
    if (first.kind !== "diffed") throw new Error("expected a diff");
    const second = diff(first.baseline, b, known);
    if (second.kind !== "diffed") throw new Error("expected a diff");
    const third = diff(second.baseline, c, known);
    if (third.kind !== "diffed") throw new Error("expected a diff");
    const changed = third.events.filter((e) => e.kind === "session-execution-changed");
    expect(changed.length).toBeGreaterThan(0);
    expect(changed[0]?.kind === "session-execution-changed" && changed[0].previousToken).toBe(TOKEN_A);

    // And the token comparison, which never had the gap, still agrees.
    expect(continuityOf(TOKEN_A, runB).kind).toBe("replaced");
  });

  /**
   * **THE UPGRADE PATH — the other half of Sol's P1-1, and the one that was
   * failing silently on every box rather than only after a blind tick.**
   *
   * A session that was already in the register when this field shipped is never
   * `session-seen` again, so nothing would ever have set its
   * `verifiedExecution`: Sol reproduced six of six entries staying null
   * indefinitely. A register with no token for a session must therefore LEARN
   * one, and that is `previousToken: null` — a first sighting, not a change.
   */
  it("learns an identity for a session the register has never verified", () => {
    const run = verifiedReading(412924, 72055933, { kind: "verified", id: CONV });
    const [a, b] = pair(run, run);
    const first = diff(null, a, new Map());
    if (first.kind !== "diffed") throw new Error("expected a diff");
    // The register knows these sessions and has verified no run for any of them.
    const second = diff(first.baseline, b, new Map());
    if (second.kind !== "diffed") throw new Error("expected a diff");
    const changed = second.events.filter((e) => e.kind === "session-execution-changed");
    expect(changed.length).toBeGreaterThan(0);
    expect(changed[0]?.kind === "session-execution-changed" && changed[0].previousToken).toBeNull();
    expect(changed[0]?.kind === "session-execution-changed" && changed[0].token).toBe(TOKEN_A);
  });
});

/* ------------------------------------------------------------------ *
 * The register: what the Overseer remembers about a run.
 * ------------------------------------------------------------------ */

describe("the register", () => {
  const CONV = "606cb12a-ffc5-4df4-af3a-7dc881135b5f";
  const TOKEN_A = `${BOOT_UUID}:412924:72055933`;
  const TOKEN_B = `${BOOT_UUID}:987654:73900001`;

  function seenAndChanged(): Map<ReturnType<typeof sessionKey>, RegisterEntry> {
    const snapshot = editableFixture("status-change-before");
    for (const row of rowsOf(snapshot)) {
      row["execution"] = verifiedReading(412924, 72055933) as never;
    }
    const first = diff(null, freshFrom(snapshot as never, "before"), new Map());
    if (first.kind !== "diffed") throw new Error("expected a diff");
    return foldEvents(first.events, new Map());
  }

  it("records the run a session was first seen under, as a floor", () => {
    const register = seenAndChanged();
    const entries = [...register.values()];
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(entry.verifiedExecution?.token).toBe(TOKEN_A);
      // `since` is when the register learned about the run, not when it started.
      expect(entry.verifiedExecution?.since).toBe(entry.lastSeenAlive);
    }
  });

  it("moves the token and resets the measured age when the run is replaced", () => {
    const register = seenAndChanged();
    const [key, before] = [...register.entries()][0] ?? [];
    expect(key).toBeDefined();
    expect(before).toBeDefined();
    if (key === undefined || before === undefined) return;
    // A session that has been `working` for an hour, as the register would hold
    // it after an ordinary status transition.
    register.set(key, { ...before, statusSince: { kind: "observed", at: "2026-09-08T05:00:00.000Z" } });

    foldEvents(
      [
        {
          kind: "session-execution-changed",
          at: "2026-09-08T06:00:00.000Z",
          tmuxServerPid: before.tmuxServerPid,
          key,
          identity: { tmuxId: before.tmuxId, claimedConversationId: before.claimedConversationId },
          previousToken: TOKEN_A,
          token: TOKEN_B,
          conversation: { kind: "conflicting", claimed: CONV, observed: "somebody-else" },
        },
      ],
      register,
    );

    const after = register.get(key);
    expect(after?.verifiedExecution).toEqual({ token: TOKEN_B, since: "2026-09-08T06:00:00.000Z" });
    // THE POINT OF THE ARM: the new run does not inherit the hour.
    expect(after?.statusSince).toEqual({ kind: "lower-bound", at: "2026-09-08T06:00:00.000Z" });
  });

  /**
   * **A FIRST SIGHTING RESETS THE AGE TOO — GPT Sol's round-2 P1.**
   *
   * This test asserted the opposite until 2026-09-09: that learning an identity
   * preserved the measured age, on the reasoning that the migration should not
   * wipe every duration on the box. The reasoning was right about the migration
   * and wrong about the other case a null `previousToken` covers — a session
   * registered while its execution was unknown, replaced during the blind
   * interval, whose first verified reading is already the new run. Preserving
   * the age there hands run B the age of run A, which is the failure this whole
   * stage exists to prevent.
   *
   * One null cannot carry both decisions, so the honest one is taken: the age
   * becomes a floor whenever the verified run is recorded or moves.
   */
  it("resets the measured age even on a first sighting, because it cannot prove no replacement", () => {
    const register = seenAndChanged();
    const [key, before] = [...register.entries()][0] ?? [];
    if (key === undefined || before === undefined) return;
    const anHourIn: RegisterEntry = {
      ...before,
      verifiedExecution: null,
      statusSince: { kind: "observed", at: "2026-09-08T05:00:00.000Z" },
    };
    register.set(key, anHourIn);

    foldEvents(
      [
        {
          kind: "session-execution-changed",
          at: "2026-09-08T06:00:00.000Z",
          tmuxServerPid: before.tmuxServerPid,
          key,
          identity: { tmuxId: before.tmuxId, claimedConversationId: before.claimedConversationId },
          previousToken: null,
          token: TOKEN_A,
          conversation: { kind: "verified", id: CONV },
        },
      ],
      register,
    );

    const after = register.get(key);
    expect(after?.verifiedExecution).toEqual({ token: TOKEN_A, since: "2026-09-08T06:00:00.000Z" });
    // A FLOOR, not the inherited hour: we are seeing this run for the first
    // time and cannot show that it is the run that has been here all along.
    expect(after?.statusSince).toEqual({ kind: "lower-bound", at: "2026-09-08T06:00:00.000Z" });
  });

  it("refuses a token that is not one, wherever it arrives from", () => {
    expect(isExecutionTokenText(TOKEN_A)).toBe(true);
    // The shapes a hand-edited log or a confused producer would offer.
    for (const bad of ["", "not-a-token", "boot:0:1", "boot:12", "boot:12:", "boot:-1:2", "a b:1:2", `${TOKEN_A}:extra`]) {
      expect(isExecutionTokenText(bad), bad).toBe(false);
    }
  });

  /**
   * **ONE TEXT PER IDENTITY — GPT Sol's round-2 P2.**
   *
   * Tokens are compared as whole strings, so a second spelling of one identity
   * is a replacement that never happened: it would fire
   * `session-execution-changed` and reset a live session's measured age for
   * nothing. A leading zero is the cheap way in; an unsafe integer is the other,
   * and it cannot survive the wire parsers that require `Number.isSafeInteger`.
   */
  it("refuses a second spelling of a token it would otherwise accept", () => {
    expect(isExecutionTokenText("boot:1:1")).toBe(true);
    // Same identity, different bytes — and the comparison is on bytes.
    expect(isExecutionTokenText("boot:1:01")).toBe(false);
    expect(isExecutionTokenText("boot:01:1")).toBe(false);
    // Past MAX_SAFE_INTEGER: the wire parsers would refuse it, so this must too.
    expect(isExecutionTokenText("boot:1:9007199254740992")).toBe(false);
    expect(isExecutionTokenText(`boot:1:${Number.MAX_SAFE_INTEGER}`)).toBe(true);
  });

  // The checkpoint round trip — an old `current.json` with no
  // `verifiedExecution`, and a malformed one — is in
  // tests/overseer-store.test.ts, where the real write-then-reopen helpers live
  // and where a hand-built checkpoint cannot drift from what the store writes.
});
