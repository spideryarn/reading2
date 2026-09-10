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
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { fromPsArgs, readClaudeCommandLine } from "../tools/fleet/claude-argv.js";
import {
  COMMAND_KEPT,
  RECOGNISERS,
  classifyPaneWork,
  parseProcessTable,
  recogniseCommand,
  type ProcessTableReading,
  type WorkReading,
} from "../tools/overseer/work.js";
import { probeProcessTable, PS_ARGV, readingFromPs } from "../tools/overseer/work-probe.js";

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
    // VERBATIM from tests/fixtures/overseer-process-trees/headless-claude-under-pane.txt,
    // `--` and prompt included. It was truncated before the `--` until 2026-09-08, and the
    // truncation mattered: `--tools` is variadic, so where its values end is readable only
    // because the separator is there. A shortened copy of a real command line is a
    // constructed case wearing a capture's name.
    const found = recogniseCommand(
      "claude --print --model haiku --effort high --output-format stream-json --verbose" +
        " --permission-prompts none --tools Read,Grep,Glob,Bash --restricted --strict-mcp-config" +
        " -- Reply with the single word: pong",
    );
    expect(found?.id).toBe("claude-headless");
  });

  /**
   * D6 from docs/plans/260908h, and `RECOGNISERS["claude-headless"]`'s own
   * self-declared KNOWN GAP: `claude --model x -p …` was missed, because the
   * test was a regex anchored to the first argument and `--print` was no longer
   * there. `harness.ts` caught it and this did not, so `classifyPaneWork` and
   * `classifyPaneHarness` could disagree about one process in one tick.
   *
   * The flag table is what closes it: `--model` is known to take a value, so
   * the `-p` after it is a flag rather than that flag's value.
   *
   * **THE OTHER DIRECTION IS DELIBERATELY NOT ASSERTED HERE.** The obvious pair
   * would be "a `-p` inside the PROMPT is prose", and on 2026-09-08 that was
   * measured to be FALSE of real `claude` 2.1.263, which reads options after a
   * positional: `claude some-prompt --version` prints the version. Whether a
   * dash-led token following a bare word is a flag is `claude-argv.ts`'s
   * question and it is being re-settled; a test written from the old
   * understanding would be a second vote for it. See the report on Stage B.
   */
  test("a headless claude behind a flag that takes a value is still headless work", () => {
    expect(recogniseCommand("claude --model opus -p do the thing")?.id).toBe("claude-headless");
    expect(recogniseCommand("claude --model opus --print -- do the thing")?.id).toBe("claude-headless");
    // The pair that does not depend on a boundary rule: a `claude` with no
    // headless flag anywhere is not headless work.
    expect(recogniseCommand("claude --model opus --session-id abc -- do the thing")).toBeNull();
  });

  test("the real vitest command line is recognised through its node shim", () => {
    const found = recogniseCommand(
      "node /home/greg/code/spideryarn2/.claude/worktrees/changelog-toc-and-opensource/node_modules/.bin/vitest run --maxWorkers=2",
    );
    expect(found?.id).toBe("vitest");
  });

  test("vitest's --run flag counts as well as its run subcommand (constructed)", () => {
    // Every instance measured on this box used `run`; `--run` is here on a
    // reviewer's word that vitest treats the two as the same thing, so it is
    // pinned rather than left as an untested belief.
    expect(recogniseCommand("node /home/greg/code/x/node_modules/.bin/vitest --run")?.id).toBe("vitest");
    expect(recogniseCommand("node /home/greg/code/x/node_modules/.bin/vitest --run tests/a.test.ts")?.id).toBe("vitest");
  });

  test("the debian nodejs shim is peeled as well as node (constructed)", () => {
    // `/usr/bin/nodejs` exists on this box and `/usr/bin/node` is the one every
    // tool actually uses - it appeared as argv[0] zero times in 40 samples. It
    // is in LAUNCHERS on the strength of the binary existing, so it needs a test
    // saying so; mutation testing found that removing it broke nothing.
    expect(recogniseCommand("/usr/bin/nodejs /home/greg/code/x/node_modules/.bin/vitest run")?.id).toBe("vitest");
  });

  /**
   * TWO COMMAND LINES THAT BOTH MATCH NOTHING, FOR TWO DIFFERENT REASONS, and
   * the difference is worth an assertion because until Stage A round 2 of
   * docs/plans/260908h the second one was *accidentally* safe.
   *
   * The old belief was that `claude` stops reading options at the first bare
   * word, so a prompt saying `--print` was prose. Measured on 2026-09-08
   * against real `claude` 2.1.263, the CLI PERMUTES — `claude some-prompt
   * --version` prints the version — so a `ps`-flattened `claude --session-id
   * abc Please add a --print flag to the CLI` cannot be told apart from a
   * genuinely headless run, and the honest reading is `unreadable`.
   *
   *  - the first line is a `session` that is not headless: no recogniser
   *    matches, and `null` means "this pane is not running batch work";
   *  - the second is `unreadable`: no recogniser matches either, because this
   *    entry asks for `session && headless` and a refusal is neither.
   *
   * `null` both times — but a `null` that comes from a refusal is a different
   * fact about the world, and `classifyPaneHarness` says so out loud (its twin
   * test in `tests/overseer-harness.test.ts` asserts the `ambiguous` pane).
   */
  test("a pane's own interactive claude is not headless work, and an unreadable one is not either", () => {
    const interactive = "claude --session-id 404961e7-a9af-47c9-bf9e-38918ba8ffc4 --name x Build a batch";
    expect(recogniseCommand(interactive)).toBeNull();
    const reading = readClaudeCommandLine(fromPsArgs(interactive));
    expect(reading.kind).toBe("session");
    // The id itself is not asserted here — `tests/fixture-ids.test.ts` counts a bare uuid literal
    // as this file laying claim to a database row, and this uuid belongs to
    // `tests/overseer-harness.test.ts`. What this test is about is the kind of reading anyway.
    expect(reading.kind === "session" ? reading.headless : "not a session").toBe(false);

    expect(recogniseCommand("claude --session-id abc Please add a --print flag to the CLI")).toBeNull();
    expect(
      readClaudeCommandLine(fromPsArgs("claude --session-id abc Please add a --print flag to the CLI")).kind,
    ).toBe("unreadable");
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

  test("the other two documented non-interactive modes are batch jobs too (constructed)", () => {
    // `codex --help` on this box, 2026-09-08: `exec` carries `[aliases: e]`, and
    // `review` is a second non-interactive mode. Both are 15-45 minutes of paid
    // model time during which the pane looks empty, which is the whole finding
    // this module exists for - and `exec` alone missed both. Constructed,
    // because `run-codex.ts` hard-codes `exec` and so nothing has ever captured
    // one; they are here on the CLI's own word.
    expect(recogniseCommand("codex e --model gpt-5.6-sol -- hi")?.id).toBe("codex-exec");
    expect(recogniseCommand("codex review --model gpt-5.6-sol")?.id).toBe("codex-exec");
    // `e`/`review` do not loosen into a prefix match.
    expect(recogniseCommand("codex export")).toBeNull();
    expect(recogniseCommand("codex reviewer")).toBeNull();
  });

  test("a global option before the subcommand does not hide a batch run (constructed)", () => {
    // THIS TEST REPLACES ONE THAT PINNED THE WRONG ANSWER. It asserted
    // `codex --model x review the diff` was NOT a batch run, on the reasoning
    // that the subcommand must lead. But `codex --help` gives
    // `codex [OPTIONS] <COMMAND> [ARGS]` — global options come FIRST — so that
    // is a perfectly ordinary non-interactive review, and the old test locked
    // in a miss of exactly the paid run this module exists to catch. A
    // cross-family review found it.
    expect(recogniseCommand("codex --model x review the diff")?.id).toBe("codex-exec");
    expect(recogniseCommand("codex --model gpt-5.6-sol exec -- hi")?.id).toBe("codex-exec");
    // A boolean flag must not swallow the subcommand after it.
    expect(recogniseCommand("codex --json exec -- hi")?.id).toBe("codex-exec");
  });

  test("what the lost quoting costs, stated rather than hidden (constructed)", () => {
    // `codex 'review this diff'` is an INTERACTIVE codex with one prompt
    // argument, but `ps args` has already flattened the quotes away and it
    // arrives identical to a batch `codex review this diff`. We report batch.
    // Asserted so the wrong answer is a documented cost with a test naming it,
    // rather than a surprise for whoever meets it next.
    expect(recogniseCommand("codex review this diff")?.id).toBe("codex-exec");
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
    // THE CAP IS PINNED TO ITS VALUE, not to itself. Asserting
    // `length === COMMAND_KEPT + 3` passes for any cap at all, which mutation
    // testing showed by changing 400 to 40 and to 4000 with every test still
    // green. 400 is a decision - long enough to keep a `codex exec` line's model
    // and prompt opening, short enough that a 2 kB chrome line does not go into
    // an append-only history - so it is the value that has to be defended.
    expect(COMMAND_KEPT).toBe(400);
    const long = `codex exec ${"x".repeat(1000)}`;
    const parsed = parseProcessTable(`  100     1  9 bash pane\n  200   100  9 ${long}\n`, NOW_MS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reading = classifyPaneWork(100, { read: true, rows: parsed.rows, atMs: NOW_MS });
    expect(reading.kind).toBe("child-work");
    if (reading.kind !== "child-work") return;
    expect(reading.jobs[0].command).toHaveLength(403);
    expect(reading.jobs[0].command.endsWith("...")).toBe(true);
  });

  test("the cap keeps what a reader needs and drops what they do not", () => {
    // The two real command lines the cap has to sit between. A `codex exec` line
    // must survive with its model still legible; the browser's must not arrive
    // whole. Both are taken from the captures rather than invented.
    const codex = raw("codex-review-under-pane")
      .split("\n")
      .find((l) => l.includes("codex exec"));
    expect(codex).toBeDefined();
    expect((codex ?? "").length).toBeLessThan(COMMAND_KEPT);
    const chrome = raw("browser-pane")
      .split("\n")
      .find((l) => l.includes("--type=renderer"));
    expect(chrome).toBeDefined();
    expect((chrome ?? "").length).toBeGreaterThan(COMMAND_KEPT);
  });
});

describe("the pane's own age belongs to the pane, not to the command it is running", () => {
  test("paneStarted is the pane PROCESS's start, and it is not the session's", () => {
    // THE MEASUREMENT THIS FIELD EXISTS FOR. In this real capture the pane is
    // 115341 s old and the `claude` inside it is 75741 s old - a difference of
    // eleven hours, because `gjd-remote resume` puts a fresh conversation in a
    // pane that was already there. So a renderer that dressed `paneCommand` in
    // the pane's age would be labelling one object with evidence about another.
    const parsed = parseProcessTable(raw("quiet-claude-pane"), NOW_MS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const pane = parsed.rows.find((r) => r.pid === PANE["quiet-claude-pane"]);
    const claude = parsed.rows.find((r) => r.pid === 412924);
    expect(pane?.started).toEqual({ known: true, atMs: NOW_MS - 115_341_000 });
    expect(claude?.started).toEqual({ known: true, atMs: NOW_MS - 75_741_000 });

    const reading = classifyPaneWork(PANE["quiet-claude-pane"], readingOf("quiet-claude-pane"));
    expect(reading.kind).toBe("no-child-work");
    if (reading.kind !== "no-child-work") return;
    expect(reading.paneStarted).toEqual({ known: true, atMs: NOW_MS - 115_341_000 });
  });

  test("paneStarted rides on the child-work arm too", () => {
    const reading = classifyPaneWork(PANE["shell-pane-running-tests"], readingOf("shell-pane-running-tests"));
    expect(reading.kind).toBe("child-work");
    if (reading.kind !== "child-work") return;
    // The 'this shell has run one command for N' row the dashboard wants: the
    // pane's own 1282 s, alongside its own command.
    expect(reading.paneStarted).toEqual({ known: true, atMs: NOW_MS - 1_282_000 });
    expect(reading.paneCommand).toMatch(/npx.*vitest.*run/);
  });

  test("a pane whose start could not be read says so rather than looking new (constructed)", () => {
    const parsed = parseProcessTable("  100     1  -1 bash pane\n  200   100  9 codex exec --model x\n", NOW_MS);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const reading = classifyPaneWork(100, { read: true, rows: parsed.rows, atMs: NOW_MS });
    expect(reading.kind).toBe("child-work");
    if (reading.kind !== "child-work") return;
    // NOT `atMs: NOW_MS`, which is what a zero-instead-of-unknown would give and
    // would render as "started just now" on a pane that has been up for days.
    expect(reading.paneStarted).toEqual({ known: false });
  });

  test("cannot-tell carries no pane age, because absent means we could not look", () => {
    for (const reading of [
      classifyPaneWork(null, readingOf("quiet-claude-pane")),
      classifyPaneWork(999_999, readingOf("quiet-claude-pane")),
      classifyPaneWork(100, { read: false, why: "ps died" }),
    ]) {
      expect(reading.kind).toBe("cannot-tell");
      expect(reading).not.toHaveProperty("paneStarted");
      expect(reading).not.toHaveProperty("paneCommand");
    }
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
  test("a duplicate pid reaching the classifier is cannot-tell, not no-child-work (constructed)", () => {
    // `parseProcessTable` refuses this, but a `ProcessTableReading` is an
    // ordinary value that a store replay or a merge of two readings can build.
    // Keeping the second row silently would drop a subtree and then answer
    // confidently about whatever was left.
    const rows = [
      { pid: 100, ppid: 1, command: "bash pane", started: { known: false } as const },
      { pid: 200, ppid: 100, command: "codex exec --model x", started: { known: false } as const },
      { pid: 200, ppid: 100, command: "sh -c something-else", started: { known: false } as const },
    ];
    const reading = classifyPaneWork(100, { read: true, rows, atMs: NOW_MS });
    expect(reading.kind).toBe("cannot-tell");
    if (reading.kind !== "cannot-tell") return;
    expect(reading.cause).toBe("malformed-process-table");
    expect(reading.why).toMatch(/200 appears twice/);
  });

  test("a pane that descends from itself is cannot-tell, not a tidy no-child-work (constructed)", () => {
    // THE ONLY REACHABLE CYCLE IS ONE THE PANE IS IN. Every process has exactly
    // one ppid, so a ring of processes whose parents are all inside the ring can
    // never be entered from outside it - the first version of this test built
    // such a ring off to one side and proved nothing, because the walk never
    // went there. A pane that is its own ancestor is the real case, and the
    // answer has to be that these rows are not an ancestry.
    const rows = [
      { pid: 100, ppid: 200, command: "bash pane", started: { known: false } as const },
      { pid: 200, ppid: 100, command: "sh -c child", started: { known: false } as const },
    ];
    const reading = classifyPaneWork(100, { read: true, rows, atMs: NOW_MS });
    expect(reading.kind).toBe("cannot-tell");
    if (reading.kind !== "cannot-tell") return;
    expect(reading.cause).toBe("malformed-process-table");
    expect(reading.why).toMatch(/came back to pid 100/);
  });

  test("a self-parented pane is malformed rather than quiet (constructed)", () => {
    const table = ["  100     1  900 bash pane", "  100   100  900 bash pane"].join("\n");
    // Same pid twice never gets past the parser.
    expect(parseProcessTable(table, NOW_MS).ok).toBe(false);
    const single = parseProcessTable("  100   100  900 bash pane\n", NOW_MS);
    expect(single.ok).toBe(true);
    if (!single.ok) return;
    const reading = classifyPaneWork(100, { read: true, rows: single.rows, atMs: NOW_MS });
    expect(reading.kind).toBe("cannot-tell");
    if (reading.kind !== "cannot-tell") return;
    expect(reading.cause).toBe("malformed-process-table");
  });

  test("a real deep tree is walked without being called a cycle", () => {
    // The negative half of the two tests above: the genuine eight-deep codex
    // chain must not trip the loop detector.
    const reading = classifyPaneWork(PANE["codex-review-under-pane"], readingOf("codex-review-under-pane"));
    expect(reading.kind).toBe("child-work");
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

  test("a walking reading says when it was taken", () => {
    // Without this, "no child work" read forty minutes ago and "no child work"
    // read a second ago are the same sentence.
    const quiet = classifyPaneWork(PANE["quiet-claude-pane"], readingOf("quiet-claude-pane"));
    expect(quiet.kind === "cannot-tell" ? null : quiet.atMs).toBe(NOW_MS);
    const busy = classifyPaneWork(PANE["codex-review-under-pane"], readingOf("codex-review-under-pane"));
    expect(busy.kind === "cannot-tell" ? null : busy.atMs).toBe(NOW_MS);
  });
});

/**
 * THE POSITIVE CONTROL. Read this before believing a zero.
 *
 * This module's headline number is allowed to be nought — on a quiet fleet no
 * session is mid-review, and `no-child-work` everywhere is the right answer. The
 * trouble is that **a zero produced by a working instrument and a zero produced
 * by a broken one are the same number**, and the second is the more likely of
 * the two after any refactor: a recogniser regex that stops matching, a walk
 * that stops descending, a probe that returns rows nothing is ever found in.
 * Nothing else in this suite would go red for that — every other test here would
 * pass a classifier that had quietly stopped finding anything, because most of
 * them assert an absence.
 *
 * So these three tests exist for one purpose, and it is not coverage: **they are
 * the reason a future zero means "there was none" rather than "we stopped
 * finding any."** They are the only tests here that assert, from real captures
 * of real running work, that the instrument still detects. If you are deleting
 * or weakening one, you are removing the thing that makes the number
 * interpretable — do not, and if a fixture goes stale, re-capture it rather than
 * relax the assertion.
 *
 * The live equivalent, run by hand on 2026-09-08: a `vitest` deliberately
 * started under this session's own pane was caught by 2 of 8 consecutive live
 * probes at depth 5, which is how the zero measured that day was known to be a
 * real zero. That run is gone; these two captures are what remain of it.
 * `probeProcessTable` carries the third control, and it runs on every call —
 * see its `selfPid` check.
 */
describe("POSITIVE CONTROL: the instrument still detects real work", () => {
  test("control 1 - a real paid codex review is still found", () => {
    // tests/fixtures/overseer-process-trees/codex-review-under-pane.txt, taken
    // while a genuine `codex exec` was running under this box's own pane.
    const reading = classifyPaneWork(PANE["codex-review-under-pane"], readingOf("codex-review-under-pane"));
    expect(reading.kind).toBe("child-work");
    if (reading.kind !== "child-work") return;
    expect(reading.jobs.map((j) => j.recogniser)).toEqual(["codex-exec"]);
  });

  test("control 2 - a real test suite under a shell pane is still found", () => {
    // shell-pane-running-tests.txt, 21 minutes into a real `npm test`.
    const reading = classifyPaneWork(PANE["shell-pane-running-tests"], readingOf("shell-pane-running-tests"));
    expect(reading.kind).toBe("child-work");
    if (reading.kind !== "child-work") return;
    expect(reading.jobs.map((j) => j.recogniser)).toEqual(["vitest"]);
  });

  test("control 3 - a real headless claude run is still found", () => {
    // headless-claude-under-pane.txt, during a real `scripts/run-claude.ts`.
    const reading = classifyPaneWork(PANE["headless-claude-under-pane"], readingOf("headless-claude-under-pane"));
    expect(reading.kind).toBe("child-work");
    if (reading.kind !== "child-work") return;
    expect(reading.jobs.map((j) => j.recogniser)).toEqual(["claude-headless"]);
  });

  test("all three recognisers have a control, so none can rot unnoticed", () => {
    // If a recogniser is added without a real capture behind it, this fails and
    // says so - which is the difference between a table that grew and a table
    // that grew evidence.
    const controlled = new Set(
      [
        classifyPaneWork(PANE["codex-review-under-pane"], readingOf("codex-review-under-pane")),
        classifyPaneWork(PANE["shell-pane-running-tests"], readingOf("shell-pane-running-tests")),
        classifyPaneWork(PANE["headless-claude-under-pane"], readingOf("headless-claude-under-pane")),
      ].flatMap((r) => (r.kind === "child-work" ? r.jobs.map((j) => j.recogniser) : [])),
    );
    expect([...controlled].sort()).toEqual(Object.keys(RECOGNISERS).sort());
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
    // NOT merely `not cannot-tell`, which was the first version of this
    // assertion and passed for a walk that inspected nothing at all - a review
    // caught it. Walking from this process's parent must reach this process.
    expect(verdict.kind).not.toBe("cannot-tell");
    if (verdict.kind === "cannot-tell") return;
    expect(verdict.inspected).toBeGreaterThan(0);
    expect(verdict.paneCommand).not.toBe("");
  });

  test("the control is about OUR pid, not merely about some pid (pid 0 is nobody)", () => {
    // Every ppid in a real table is also a pid somewhere - except 0, which is
    // the parent of init and is never a process. So a control that had drifted
    // to matching `ppid` would accept 0 and this refuses it. Mutation testing
    // found that drift; nothing else here could see it.
    const reading = probeProcessTable({ selfPid: 0 });
    expect(reading.read).toBe(false);
    if (reading.read) return;
    expect(reading.why).toMatch(/did not include this process \(pid 0\)/);
  });

  test("a valid table OF SOMEWHERE ELSE is refused, which is what the default is for", () => {
    // The control on the control. A fake `ps` that prints a real, well-formed,
    // 9-row process table - captured off this box, so every line parses - and
    // that contains pid 1 but not us. Everything else in this file passes
    // `selfPid` explicitly, so without this the DEFAULT could quietly become
    // something always present (pid 1, say) and every test would stay green
    // while the control stopped controlling anything. Mutation testing found
    // exactly that. The fake-binary-in-a-tmpdir shape is the one
    // tests/run-codex.test.ts already uses.
    const dir = mkdtempSync(join(tmpdir(), "fake-ps-"));
    try {
      const table = join(dir, "table.txt");
      writeFileSync(table, raw("quiet-claude-pane"));
      const bin = join(dir, "ps");
      writeFileSync(bin, `#!/bin/sh\nexec cat ${table}\n`);
      chmodSync(bin, 0o755);

      // Sanity: the fake is well-formed enough to be believed, so the refusal
      // below is about the control and not about the parsing.
      const believed = probeProcessTable({ bin, selfPid: 652780 });
      expect(believed.read).toBe(true);
      if (believed.read) expect(believed.rows).toHaveLength(9);

      // And with the real default it is refused, because we are not in it.
      const refused = probeProcessTable({ bin });
      expect(refused.read).toBe(false);
      if (refused.read) return;
      expect(refused.why).toMatch(new RegExp(`did not include this process \\(pid ${process.pid}\\)`));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("the extracted reader alone refuses a valid table from somewhere else", () => {
    // This is the authorised extraction's positive control. It deliberately
    // bypasses `probeProcessTable`, so the async caller cannot accidentally
    // receive a parser-only helper that accepts a foreign capture while the
    // old synchronous entry point keeps doing the right thing.
    const stdout = raw("quiet-claude-pane");
    const believed = readingFromPs(stdout, NOW_MS, { bin: "captured ps", selfPid: 652780 });
    expect(believed.read).toBe(true);

    const foreignPid = 2_147_483_646;
    const foreign = readingFromPs(stdout, NOW_MS, { bin: "captured ps", selfPid: foreignPid });
    expect(foreign.read).toBe(false);
    if (foreign.read) return;
    expect(foreign.why).toMatch(new RegExp(`did not include this process \\(pid ${foreignPid}\\)`));
  });

  test("the probe's own per-run control: a table without this process is refused", () => {
    // The cheap positive control that travels with every call. If `ps` returns
    // rows that do not include the caller, the reading is not of this machine -
    // and a reading of somewhere else, full of processes nothing will ever be
    // found under, is the exact shape of an instrument that has quietly stopped
    // working while still answering. Costs one pass over the rows and no spawn.
    const reading = probeProcessTable({ selfPid: 2_147_483_646 });
    expect(reading.read).toBe(false);
    if (reading.read) return;
    expect(reading.why).toMatch(/did not include this process/);
  });

  test("output that exits 0 but is not a process table is a failure", () => {
    // `echo` takes ps's own argv and prints it back: status 0, one line, and not
    // a pid/ppid/etimes/args row. The conversion from a parse failure into a
    // read failure had no direct cover until a review pointed at it.
    const reading = probeProcessTable({ bin: "echo" });
    expect(reading.read).toBe(false);
    if (reading.read) return;
    expect(reading.why).toMatch(/was not a process table/);
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
