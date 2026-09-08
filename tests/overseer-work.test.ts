/**
 * The Overseer's second opinion about a pane: what is the process tree under it
 * actually doing?
 *
 * Every tree here was captured off this box on 2026-09-08 while the thing under
 * test was genuinely running - the `codex exec` fixture was taken during a real
 * (paid, tiny) review, and the `claude --print` one during a real headless run.
 * See tests/fixtures/overseer-process-trees/README.md for what was trimmed and,
 * more importantly, for what these files therefore cannot test.
 *
 * WHERE A CASE IS CONSTRUCTED IT SAYS SO IN ITS NAME, and it is built by editing
 * one field of a captured file rather than by inventing a table.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import {
  COMMAND_KEPT,
  RECOGNISERS,
  classifyPaneWork,
  parseProcessTable,
  recogniseCommand,
  type ProcessTableReading,
  type WorkReading,
} from "../tools/overseer/work.js";
import { probeProcessTable, PS_ARGV } from "../tools/overseer/work-probe.js";

const TREES = join(import.meta.dirname, "fixtures", "overseer-process-trees");

/** The instant every fixture is read "at", so start times are deterministic. */
const NOW_MS = Date.UTC(2026, 8, 8, 12, 0, 0);

function raw(name: string): string {
  return readFileSync(join(TREES, `${name}.txt`), "utf8");
}

function readingOf(name: string): ProcessTableReading {
  const parsed = parseProcessTable(raw(name), NOW_MS);
  if (!parsed.ok) throw new Error(`fixture ${name} did not parse: ${parsed.reason}`);
  return { read: true, rows: parsed.rows, atMs: NOW_MS };
}

/** The pane pid each captured tree is rooted at - the first pid in the file. */
const PANE = {
  "codex-review-under-pane": 3184904,
  "headless-claude-under-pane": 3184904,
  "quiet-claude-pane": 652780,
  "browser-pane": 430640,
  "shell-pane-running-tests": 1234211,
} as const;

describe("parsing a real ps capture", () => {
  test("every captured tree parses, with no unreadable lines", () => {
    for (const name of Object.keys(PANE)) {
      const parsed = parseProcessTable(raw(name), NOW_MS);
      expect(parsed.ok ? null : parsed.reason).toBeNull();
      if (!parsed.ok) continue;
      expect(parsed.rows.length).toBeGreaterThan(0);
      for (const row of parsed.rows) {
        expect(Number.isInteger(row.pid)).toBe(true);
        expect(row.command).not.toBe("");
      }
    }
  });

  test("etimes becomes an absolute start time", () => {
    // `1370771 1370684 4 codex exec ...` - four seconds old when captured.
    const parsed = parseProcessTable(raw("codex-review-under-pane"), NOW_MS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const codex = parsed.rows.find((r) => r.pid === 1370771);
    expect(codex?.started).toEqual({ known: true, atMs: NOW_MS - 4_000 });
  });

  test("a negative elapsed time is unknown, not a process from the future (constructed)", () => {
    const parsed = parseProcessTable("  100     1  -5 codex exec --model x\n", NOW_MS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows[0]?.started).toEqual({ known: false });
  });

  test("a line that is not a ps row fails the whole table (constructed)", () => {
    const good = raw("quiet-claude-pane");
    const parsed = parseProcessTable(`${good}ps: cannot open /proc\n`, NOW_MS);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/is not a pid\/ppid\/etimes\/args row/);
  });

  test("a repeated pid fails the whole table (constructed)", () => {
    const good = raw("quiet-claude-pane");
    const parsed = parseProcessTable(`${good} 652780  132280  1 bash impostor\n`, NOW_MS);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.reason).toMatch(/652780 appears twice/);
  });

  test("blank lines are skipped rather than failing", () => {
    const parsed = parseProcessTable("\n  100     1  5 bash x\n\n", NOW_MS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.rows).toHaveLength(1);
  });
});

describe("recognising a command line", () => {
  test("the real codex exec command line is recognised", () => {
    const found = recogniseCommand(
      "codex exec --model gpt-5.6-sol -c model_reasoning_effort=low -c approval_policy=never --cd /home/greg/code",
    );
    expect(found?.id).toBe("codex-exec");
  });

  test("the real headless claude command line is recognised", () => {
    const found = recogniseCommand(
      "claude --print --model haiku --effort high --output-format stream-json --verbose --tools Read,Grep",
    );
    expect(found?.id).toBe("claude-headless");
  });

  test("the real vitest command line is recognised through its node shim", () => {
    const found = recogniseCommand(
      "node /home/greg/code/spideryarn2/.claude/worktrees/changelog-toc-and-opensource/node_modules/.bin/vitest run --maxWorkers=2",
    );
    expect(found?.id).toBe("vitest");
  });

  test("a pane's own interactive claude is not headless work, even when the prompt says --print", () => {
    // The whole prompt is argv on this box, so a session asked about `--print`
    // wears the word. Anchoring to the FIRST argument is what stops that.
    expect(recogniseCommand("claude --session-id 404961e7-a9af-47c9-bf9e-38918ba8ffc4 --name x Build a batch")).toBeNull();
    expect(recogniseCommand("claude --session-id abc Please add a --print flag to the CLI")).toBeNull();
  });

  test("node running a program of its own is not peeled into that program's flags", () => {
    // The tsx preflight line sits directly above `codex exec` in the real tree
    // and must not be mistaken for it.
    expect(
      recogniseCommand(
        "/usr/bin/node --require /home/greg/code/x/node_modules/tsx/dist/preflight.cjs --import file:///x scripts/run-codex.ts --model gpt-5.6-sol",
      ),
    ).toBeNull();
  });

  test("the run-codex wrapper is not itself a codex run", () => {
    // Five processes in the real chain carry the words `run-codex.ts`; exactly
    // one carries `codex exec`. Matching the wrapper would count one review five
    // times.
    expect(recogniseCommand("timeout 240 npx tsx scripts/run-codex.ts --model gpt-5.6-sol --prompt hi")).toBeNull();
    expect(recogniseCommand("npm exec tsx scripts/run-codex.ts --model gpt-5.6-sol")).toBeNull();
    expect(recogniseCommand("sh -c 'tsx' scripts/run-codex.ts --model gpt-5.6-sol")).toBeNull();
  });

  test("the fake-codex test harness on this box is not a review", () => {
    // Real line, captured: it has been running since 2026-09-01 and is a
    // leftover from tests/run-codex.test.ts, not work.
    expect(recogniseCommand("bash /tmp/fake-codex-qAz9Um/codex -o /tmp/run-codex-gc.txt")).toBeNull();
    // And it stays out even if the harness one day passes the subcommand, or
    // invokes the fake through a shebang. Constructed, both of them.
    expect(recogniseCommand("bash /tmp/fake-codex-qAz9Um/codex exec --model gpt-5.6-sol")).toBeNull();
    expect(recogniseCommand("/tmp/fake-codex-qAz9Um/codex exec --model gpt-5.6-sol")).toBeNull();
  });

  test("a shell running a script that happens to be named codex is not codex (constructed)", () => {
    // The launcher rule on its own, with the throwaway-path guard taken out of
    // the picture. Mutation testing found that adding `bash` to LAUNCHERS
    // changed nothing any test could see, because every real example also lived
    // under /tmp. The two guards are meant to be independent; this pins the
    // first one.
    expect(recogniseCommand("bash /home/greg/bin/codex exec --model gpt-5.6-sol")).toBeNull();
    expect(recogniseCommand("sh /usr/local/share/codex exec --model gpt-5.6-sol")).toBeNull();
  });

  test("codex without the exec subcommand is not a batch job (constructed)", () => {
    // `codex` on its own is the interactive TUI, which would be a session in its
    // own right rather than work under a pane, and `codex --version` is nothing
    // at all. Requiring the subcommand is what separates them.
    expect(recogniseCommand("codex")).toBeNull();
    expect(recogniseCommand("codex --version")).toBeNull();
    expect(recogniseCommand("codex login")).toBeNull();
  });

  test("a watch-mode vitest is not a job anybody is waiting on (constructed)", () => {
    expect(recogniseCommand("node /home/greg/code/x/node_modules/.bin/vitest --watch")).toBeNull();
  });

  test("an empty or whitespace command line recognises nothing", () => {
    expect(recogniseCommand("")).toBeNull();
    expect(recogniseCommand("   ")).toBeNull();
  });

  test("every recogniser id is its own key, so the table cannot drift", () => {
    for (const [id, recogniser] of Object.entries(RECOGNISERS)) expect(recogniser.id).toBe(id);
  });
});

describe("classifying a real pane", () => {
  test("the codex review is found, eight levels down", () => {
    const reading = classifyPaneWork(PANE["codex-review-under-pane"], readingOf("codex-review-under-pane"));
    expect(reading.kind).toBe("child-work");
    if (reading.kind !== "child-work") return;
    expect(reading.jobs).toHaveLength(1);
    const [job] = reading.jobs;
    expect(job.recogniser).toBe("codex-exec");
    expect(job.pid).toBe(1370771);
    // The measurement the whole design turns on. A shallower walk finds nothing.
    expect(job.depth).toBe(8);
    expect(job.started).toEqual({ known: true, atMs: NOW_MS - 4_000 });
  });

  test("the headless claude run is found, also eight levels down", () => {
    const reading = classifyPaneWork(PANE["headless-claude-under-pane"], readingOf("headless-claude-under-pane"));
    expect(reading.kind).toBe("child-work");
    if (reading.kind !== "child-work") return;
    expect(reading.jobs.map((j) => j.recogniser)).toEqual(["claude-headless"]);
    expect(reading.jobs[0].depth).toBe(8);
  });

  test("a quiet pane is no-child-work, and says how much it looked at", () => {
    const reading = classifyPaneWork(PANE["quiet-claude-pane"], readingOf("quiet-claude-pane"));
    expect(reading.kind).toBe("no-child-work");
    if (reading.kind !== "no-child-work") return;
    // Eight descendants: the session's claude plus the two MCP servers' chains.
    expect(reading.inspected).toBe(8);
    expect(reading.paneCommand).toMatch(/gjd-remote\/jobs/);
  });

  test("a pane with a whole headless chrome under it is still no-child-work", () => {
    // Twenty processes, none of them a job Greg is waiting on. This is the case
    // that would tempt a "busy tree means busy agent" heuristic, and the reason
    // there isn't one.
    const reading = classifyPaneWork(PANE["browser-pane"], readingOf("browser-pane"));
    expect(reading.kind).toBe("no-child-work");
    if (reading.kind !== "no-child-work") return;
    expect(reading.inspected).toBe(20);
  });

  test("a shell pane running the suite under tmux-job is recognised", () => {
    const reading = classifyPaneWork(PANE["shell-pane-running-tests"], readingOf("shell-pane-running-tests"));
    expect(reading.kind).toBe("child-work");
    if (reading.kind !== "child-work") return;
    expect(reading.jobs.map((j) => j.recogniser)).toEqual(["vitest"]);
    expect(reading.jobs[0].depth).toBe(3);
  });

  test("the walk stops at a match, so one wait is counted once", () => {
    // vitest forks workers; the real capture has one below it. Counting the
    // subtree of a job would turn one suite into several.
    const reading = classifyPaneWork(PANE["shell-pane-running-tests"], readingOf("shell-pane-running-tests"));
    expect(reading.kind).toBe("child-work");
    if (reading.kind !== "child-work") return;
    expect(reading.inspected).toBe(3);
  });

  test("jobs come out in a deterministic order (constructed)", () => {
    const table = [
      "  100     1  900 bash /home/greg/gjd-remote/jobs/x.sh",
      "  300   100  100 codex exec --model b",
      "  200   100  200 codex exec --model a",
    ].join("\n");
    const parsed = parseProcessTable(table, NOW_MS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reading = classifyPaneWork(100, { read: true, rows: parsed.rows, atMs: NOW_MS });
    expect(reading.kind).toBe("child-work");
    if (reading.kind !== "child-work") return;
    expect(reading.jobs.map((j) => j.pid)).toEqual([200, 300]);
  });

  test("a command line longer than the cap is truncated (constructed)", () => {
    const long = `codex exec ${"x".repeat(COMMAND_KEPT * 2)}`;
    const parsed = parseProcessTable(`  100     1  9 bash pane\n  200   100  9 ${long}\n`, NOW_MS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reading = classifyPaneWork(100, { read: true, rows: parsed.rows, atMs: NOW_MS });
    expect(reading.kind).toBe("child-work");
    if (reading.kind !== "child-work") return;
    expect(reading.jobs[0].command.length).toBe(COMMAND_KEPT + 3);
  });
});

describe("a reading that could not be taken never renders as a reading", () => {
  test("a null pane pid says so, and names the cause", () => {
    const reading = classifyPaneWork(null, readingOf("codex-review-under-pane"));
    expect(reading).toEqual({
      kind: "cannot-tell",
      cause: "no-pane-pid",
      why: expect.stringContaining("no pane pid"),
    });
  });

  test("a failed probe carries the probe's own words", () => {
    const reading = classifyPaneWork(3184904, { read: false, why: "ps exited 1: /proc not mounted" });
    expect(reading.kind).toBe("cannot-tell");
    if (reading.kind !== "cannot-tell") return;
    expect(reading.cause).toBe("process-table-unreadable");
    expect(reading.why).toContain("/proc not mounted");
  });

  test("a pane that has gone is cannot-tell, NOT no-child-work", () => {
    // The dangerous confusion, and the reason there are three arms. The pane
    // died between the dashboard's collection and this read, which the snapshot
    // fixtures' README records as the ordinary case.
    const reading = classifyPaneWork(999_999, readingOf("quiet-claude-pane"));
    expect(reading.kind).toBe("cannot-tell");
    if (reading.kind !== "cannot-tell") return;
    expect(reading.cause).toBe("pane-not-in-table");
    expect(reading.why).toMatch(/999999 is not in a process table of 9 rows/);
  });

  test("no arm of the union can claim nothing is running without having looked", () => {
    const arms: WorkReading["kind"][] = [];
    for (const reading of [
      classifyPaneWork(null, readingOf("quiet-claude-pane")),
      classifyPaneWork(999_999, readingOf("quiet-claude-pane")),
      classifyPaneWork(PANE["quiet-claude-pane"], readingOf("quiet-claude-pane")),
      classifyPaneWork(PANE["codex-review-under-pane"], readingOf("codex-review-under-pane")),
    ]) {
      arms.push(reading.kind);
      // Only the two arms that actually walked a tree carry an inspected count.
      if (reading.kind === "cannot-tell") expect(reading).not.toHaveProperty("inspected");
      else expect(typeof reading.inspected).toBe("number");
    }
    expect(arms).toEqual(["cannot-tell", "cannot-tell", "no-child-work", "child-work"]);
  });
});

describe("the tree is a moment, and a moment can be malformed", () => {
  test("a cycle REACHABLE FROM THE PANE terminates instead of hanging (constructed)", () => {
    // The first version of this test put the cycle off to one side, where the
    // walk never went - so removing the `visited` set broke nothing any test
    // could see. The cycle has to be inside the pane's own subtree to bite.
    const table = [
      "  100     1  900 bash /home/greg/gjd-remote/jobs/x.sh",
      "  200   100  800 claude --session-id abc",
      "  300   200  700 sh -c loop",
      "  400   300  700 sh -c loop",
      // 300's parent is 400 as well as 400's being 300: a table that came out of
      // a store rather than out of a kernel.
      "  350   400  700 sh -c loop-back",
      "  360   350  700 sh -c loop-back",
    ].join("\n");
    const parsed = parseProcessTable(table, NOW_MS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const rows = [...parsed.rows, { pid: 400, ppid: 360, command: "sh -c loop", started: { known: false } as const }];
    // 400 now appears under two parents, which is the shape a merged or replayed
    // table takes. The walk must visit each pid once and return.
    const reading = classifyPaneWork(100, { read: true, rows, atMs: NOW_MS });
    expect(reading.kind).toBe("no-child-work");
    if (reading.kind !== "no-child-work") return;
    expect(reading.inspected).toBe(5);
  });

  test("a self-parented pane is not its own descendant (constructed)", () => {
    const table = ["  100     1  900 bash pane", "  100   100  900 bash pane"].join("\n");
    // Same pid twice is refused before the walk ever sees it.
    expect(parseProcessTable(table, NOW_MS).ok).toBe(false);
    const single = parseProcessTable("  100   100  900 bash pane\n", NOW_MS);
    expect(single.ok).toBe(true);
    if (!single.ok) return;
    const reading = classifyPaneWork(100, { read: true, rows: single.rows, atMs: NOW_MS });
    expect(reading.kind).toBe("no-child-work");
    if (reading.kind !== "no-child-work") return;
    expect(reading.inspected).toBe(0);
  });

  test("an orphaned child whose parent is gone is not attributed to a pane", () => {
    // The real fake-codex rows: reparented to init on 2026-09-01 and still
    // there. Nothing under a pane owns them.
    const parsed = parseProcessTable(`${raw("quiet-claude-pane")}${raw("orphan-fake-codex")}`, NOW_MS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reading = classifyPaneWork(PANE["quiet-claude-pane"], { read: true, rows: parsed.rows, atMs: NOW_MS });
    expect(reading.kind).toBe("no-child-work");
    if (reading.kind !== "no-child-work") return;
    expect(reading.inspected).toBe(8);
  });

  test("an empty table is cannot-tell for any pane, never no-child-work", () => {
    const reading = classifyPaneWork(3184904, { read: true, rows: [], atMs: NOW_MS });
    expect(reading.kind).toBe("cannot-tell");
    if (reading.kind !== "cannot-tell") return;
    expect(reading.cause).toBe("pane-not-in-table");
  });
});

describe("the probe, against this box's real process table", () => {
  test("it asks ps for exactly the four columns the parser reads", () => {
    expect(PS_ARGV).toEqual(["-eo", "pid=,ppid=,etimes=,args="]);
  });

  test("it reads a table containing this very test process", () => {
    const reading = probeProcessTable();
    expect(reading.read ? null : reading.why).toBeNull();
    if (!reading.read) return;
    expect(reading.rows.length).toBeGreaterThan(10);
    expect(reading.rows.some((r) => r.pid === process.pid)).toBe(true);
    expect(reading.atMs).toBeGreaterThan(Date.UTC(2026, 0, 1));
  });

  test("it classifies its own ancestry rather than nothing at all", () => {
    // An end-to-end check that probe and classifier agree about pid shape: this
    // process is somebody's descendant, so walking from its parent must find it.
    const reading = probeProcessTable();
    expect(reading.read).toBe(true);
    if (!reading.read) return;
    const self = reading.rows.find((r) => r.pid === process.pid);
    expect(self).toBeDefined();
    const verdict = classifyPaneWork(self?.ppid ?? null, reading);
    expect(verdict.kind).not.toBe("cannot-tell");
  });

  test("a probe pointed at a binary that does not exist fails loudly", () => {
    const reading = probeProcessTable({ bin: "definitely-not-ps" });
    expect(reading.read).toBe(false);
    if (reading.read) return;
    expect(reading.why).toMatch(/definitely-not-ps/);
  });

  test("a command that exits 0 and prints nothing is a failure, not an empty box", () => {
    // `/bin/true` is the silent-success shape in one binary: status 0, no
    // output. A live machine always has processes, so zero rows is a broken read
    // and must never become "no session is doing anything".
    const reading = probeProcessTable({ bin: "true" });
    expect(reading.read).toBe(false);
    if (reading.read) return;
    expect(reading.why).toMatch(/exited 0 but listed no processes/);
  });

  test("a non-zero exit is reported with its status", () => {
    const reading = probeProcessTable({ bin: "false" });
    expect(reading.read).toBe(false);
    if (reading.read) return;
    expect(reading.why).toMatch(/exited 1/);
  });
});
