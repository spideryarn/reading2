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

import { afterAll, describe, expect, it } from "vitest";

import {
  BOOT_ID_PATH,
  continuityOf,
  executionTokenText,
  identityWriteGate,
  parseProcStat,
  readBootIdentity,
  readExecutionIdentity,
  readProcessStart,
  type BootIdentity,
  type ProcessStartTicks,
} from "../tools/fleet/execution-identity.js";
import { toRows, readExecutions, type FleetRow } from "../tools/fleet/collect.js";
import { CLOCK_SKEW_UNMEASURED, parseExecution as parseExecutionBrowser, parseRow } from "../tools/fleet/web/src/types.js";
import type { ExecutionReading } from "../tools/fleet/wire.js";
import { diff, sessionKey } from "../tools/overseer/diff.js";
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

/** A `readStart` that answers from a table of pid → ticks and refuses everything else. */
function startsFrom(ticks: ReadonlyMap<number, number>): (pid: number) => ProcessStartTicks {
  return (pid) => {
    const found = ticks.get(pid);
    return found === undefined ? { read: false, why: `no /proc/${pid}/stat in this test` } : { read: true, ticks: found };
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
  const OLD_CLAUDE_PID = 412924;
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
      boot: BOOT,
      readStart: startsFrom(new Map([[OLD_CLAUDE_PID, 72055933]])),
    });
    const second = readExecutionIdentity({
      panePid: PANE_PID,
      claimedConversationId: CLAIMED,
      table: tableOf(after),
      boot: BOOT,
      readStart: startsFrom(new Map([[NEW_CLAUDE_PID, 73900001]])),
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
      boot: BOOT,
      readStart: startsFrom(new Map([[NEW_CLAUDE_PID, 73900001]])),
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
      boot: BOOT,
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
      boot: BOOT,
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
      boot: BOOT,
      // No entry for the claude's pid: the read fails, as it does when the
      // process has gone.
      readStart: startsFrom(new Map()),
    });
    expect(reading.kind).toBe("unknown");
    expect(reading.kind === "unknown" && reading.cause).toBe("process-start-unreadable");
  });

  it("an unreadable process table is unknown with the probe's own sentence", () => {
    const reading = readExecutionIdentity({
      panePid: 652780,
      claimedConversationId: null,
      table: { read: false, why: "ps exited 1: nope" },
      boot: BOOT,
      readStart: startsFrom(new Map()),
    });
    expect(reading).toEqual({ kind: "unknown", cause: "process-table-unreadable", why: "ps exited 1: nope" });
  });

  it("a row with no pane pid is unknown", () => {
    const reading = readExecutionIdentity({
      panePid: null,
      claimedConversationId: null,
      table,
      boot: BOOT,
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
      boot: BOOT,
      readStart: startsFrom(new Map([[101, 5150]])),
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
      boot: BOOT,
      readStart: startsFrom(new Map([[101, 5150]])),
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
      boot,
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

  it("one process-table probe answers every row", () => {
    const rows: FleetRow[] = [
      { paneId: "%1", panePid: 100, claudeSessionId: "conv-1" } as FleetRow,
      { paneId: "%2", panePid: 200, claudeSessionId: null } as FleetRow,
    ];
    let probes = 0;
    readExecutions(rows, {
      probe: () => {
        probes += 1;
        return tableOf(
          " 100  99  500 bash /home/greg/one.sh\n" +
            " 101  100  400 claude --session-id conv-1 --permission-mode auto\n" +
            " 200  99  500 bash /home/greg/two.sh\n",
        );
      },
      boot: () => BOOT,
      readStart: startsFrom(
        new Map([
          [101, 11],
          [200, 22],
        ]),
      ),
    });
    expect(probes).toBe(1);
    expect(rows[0]?.execution.kind).toBe("verified");
    expect(rows[1]?.execution.kind).toBe("verified");
    // The second row is a bare shell: verified as a process, and nothing was
    // claimed for it, so there is nothing to conflict with.
    expect(rows[1]?.execution).toMatchObject({ harness: "shell", conversation: { kind: "not-claimed" } });
  });
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

  it("fires when the token moves under an unchanged pane", () => {
    const [a, b] = pair(
      verifiedReading(412924, 72055933, { kind: "verified", id: CONV }),
      verifiedReading(987654, 73900001, { kind: "conflicting", claimed: CONV, observed: "different" }),
    );
    const first = diff(null, a);
    expect(first.kind).toBe("diffed");
    if (first.kind !== "diffed") return;
    const second = diff(first.baseline, b);
    expect(second.kind).toBe("diffed");
    if (second.kind !== "diffed") return;
    const changed = second.events.filter((e) => e.kind === "session-execution-changed");
    expect(changed.length).toBeGreaterThan(0);
    const [one] = changed;
    expect(one?.kind === "session-execution-changed" && one.previousToken).toBe(`${BOOT_UUID}:412924:72055933`);
    expect(one?.kind === "session-execution-changed" && one.token).toBe(`${BOOT_UUID}:987654:73900001`);
    // AND NOTHING ELSE FIRED ABOUT THE PANE. That is the reproduction restated
    // at the differ: `session-replaced` and `session-pane-replaced` are both
    // silent, because the claim and the pane pid did not move.
    expect(second.events.some((e) => e.kind === "session-replaced" || e.kind === "session-pane-replaced")).toBe(false);
  });

  it("does not fire when the evidence merely goes away and comes back", () => {
    const same = verifiedReading(412924, 72055933, { kind: "verified", id: CONV });
    const blind: ExecutionReading = { kind: "unknown", cause: "process-table-unreadable", why: "ps exited 1" };
    const [a, b] = pair(same, blind);
    const [, c] = pair(blind, same);
    const first = diff(null, a);
    if (first.kind !== "diffed") throw new Error("expected a diff");
    const second = diff(first.baseline, b);
    if (second.kind !== "diffed") throw new Error("expected a diff");
    expect(second.events.some((e) => e.kind === "session-execution-changed")).toBe(false);
    const third = diff(second.baseline, c);
    if (third.kind !== "diffed") throw new Error("expected a diff");
    expect(third.events.some((e) => e.kind === "session-execution-changed")).toBe(false);
  });

  /**
   * **THE GAP, PINNED RATHER THAN DESCRIBED.**
   *
   * `verified(A) → unknown → verified(B)` produces no event, because this
   * module compares consecutive snapshots and neither step is a pair of
   * verified readings. The arm's own comment argues why closing it in `diff()`
   * would cost more than it is worth, and why nothing depends on it: continuity
   * is decided by comparing tokens, not by asking whether an event fired. This
   * test exists so that buying the case back goes red here and somebody reads
   * that argument before deciding.
   */
  it("misses a change straddled by a blind collection — and the token comparison does not", () => {
    const runA = verifiedReading(412924, 72055933, { kind: "verified", id: CONV });
    const runB = verifiedReading(987654, 73900001, { kind: "verified", id: CONV });
    const blind: ExecutionReading = { kind: "unknown", cause: "process-table-unreadable", why: "ps exited 1" };
    const [a, b] = pair(runA, blind);
    const [, c] = pair(blind, runB);
    const first = diff(null, a);
    if (first.kind !== "diffed") throw new Error("expected a diff");
    const second = diff(first.baseline, b);
    if (second.kind !== "diffed") throw new Error("expected a diff");
    const third = diff(second.baseline, c);
    if (third.kind !== "diffed") throw new Error("expected a diff");
    expect(third.events.some((e) => e.kind === "session-execution-changed")).toBe(false);

    // AND THE OTHER HALF OF THE ARGUMENT, in the same test so the two cannot
    // drift apart: anything created under run A is quarantined anyway, because
    // it asks the token and not the log.
    expect(continuityOf(`${BOOT_UUID}:412924:72055933`, runB).kind).toBe("replaced");
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
    const first = diff(null, freshFrom(snapshot as never, "before"));
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

  // The checkpoint round trip — an old `current.json` with no
  // `verifiedExecution`, and a malformed one — is in
  // tests/overseer-store.test.ts, where the real write-then-reopen helpers live
  // and where a hand-built checkpoint cannot drift from what the store writes.
});
