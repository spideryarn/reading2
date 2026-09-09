/**
 * **What a command line means — the question nothing used to ask.**
 *
 * Until 2026-09-09 `scripts/overseer.ts` parsed its own argv with `indexOf` and
 * `argv.includes`, and no test touched any of it: every test in
 * `overseer-cli.test.ts` imports a rendering function and hands it a checkpoint.
 * So a misspelled flag was a silent no-op, a `--limit nope` was `NaN`, and the
 * hand-written HELP text could name a flag the code did not read. All three are
 * the same failure — docs/reusable/silent-success.md — and all three are what
 * these tests are for.
 *
 * `parseArgv` opens no store, reads no environment and starts no daemon, which
 * is why this file can ask about `run` without one existing.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

import { buildProgram, help, parseArgv, positiveNumber, runReconcileJobs } from "../scripts/overseer.js";
import { RECONCILE_FILE } from "../tools/overseer/store.js";
import { usageRows } from "../tools/overseer/cli-help.js";
import { DEFAULT_MAX_CALLS } from "../tools/overseer/attention-cli.js";

describe("the shape of a command line", () => {
  test("no argument at all is `status`, which is what the Overseer types most", () => {
    expect(parseArgv([])).toEqual({ kind: "run", parsed: { command: "status" } });
  });

  test("--help, -h and help are all the help, and none of them is an error", () => {
    for (const word of ["--help", "-h", "help"]) {
      // `text: null` means "print the root briefing" — the prose help, not
      // Commander's reference page. A subcommand's `--help` carries its own text.
      expect(parseArgv([word]), word).toEqual({ kind: "help", text: null });
    }
  });

  test("an unknown command is refused rather than silently doing nothing", () => {
    const out = parseArgv(["tik"]);
    expect(out.kind).toBe("error");
    if (out.kind === "error") expect(out.why).toContain("tik");
  });

  test("a MISSPELLED FLAG is refused — it used to be a silent no-op", () => {
    // `--max-transcipts 3` was accepted by `indexOf("--max-transcripts")`
    // finding nothing, so the bound was never applied and nothing said so.
    const out = parseArgv(["usage", "--max-transcipts", "3"]);
    expect(out.kind).toBe("error");
    if (out.kind === "error") expect(out.why).toContain("max-transcipts");
  });
});

describe("numbers that are not numbers", () => {
  test("--limit nope is refused, not NaN", () => {
    const out = parseArgv(["events", "--limit", "nope"]);
    expect(out.kind).toBe("error");
    if (out.kind === "error") expect(out.why).toContain("--limit");
  });

  test("--limit 0 and a negative are refused: a bound that selects nothing is not a bound", () => {
    expect(parseArgv(["events", "--limit", "0"]).kind).toBe("error");
    expect(parseArgv(["notes", "--limit", "-4"]).kind).toBe("error");
  });

  test("--max-transcripts 0.5 is refused, because it is a COUNT", () => {
    // It passed the positive check once and then `slice(0, 0.5)` selected zero
    // transcripts: a flag reading "at most half a file", behaving as "nothing".
    const out = parseArgv(["usage", "--max-transcripts", "0.5"]);
    expect(out.kind).toBe("error");
    if (out.kind === "error") expect(out.why).toContain("whole number");
  });

  test("--since-hours stays fractional, because half an hour is a sensible window", () => {
    expect(parseArgv(["usage", "--since-hours", "0.5"])).toEqual({
      kind: "run",
      parsed: { command: "usage", json: false, sinceHours: 0.5 },
    });
  });

  test("the coercer refuses an empty string, which Number() calls 0", () => {
    expect(() => positiveNumber("--limit")("")).toThrow();
    expect(() => positiveNumber("--limit")("  ")).toThrow();
  });
});

describe("defaults and absence", () => {
  test("events and notes default to 40", () => {
    expect(parseArgv(["events"])).toEqual({ kind: "run", parsed: { command: "events", limit: 40 } });
    expect(parseArgv(["notes"])).toEqual({ kind: "run", parsed: { command: "notes", limit: 40 } });
  });

  test("an absent --since-hours is ABSENT, not undefined", () => {
    // `exactOptionalPropertyTypes` tells those apart, and `collectUsage` reads
    // the difference: absent means take the module's own default, and a present
    // `undefined` would narrow a scan `absenceGap` then refuses to call
    // conclusive.
    const out = parseArgv(["usage"]);
    expect(out.kind).toBe("run");
    if (out.kind === "run") {
      expect(Object.hasOwn(out.parsed, "sinceHours")).toBe(false);
      expect(Object.hasOwn(out.parsed, "maxTranscripts")).toBe(false);
    }
  });

  test("attention defaults to read-only, dry off, and the module's own call bound", () => {
    expect(parseArgv(["attention"])).toEqual({
      kind: "run",
      parsed: {
        command: "attention",
        maxCalls: DEFAULT_MAX_CALLS,
        dry: false,
        json: false,
        // READ-ONLY BY DEFAULT: the daemon holds the store's lock and this
        // command does not honour it, so two writers is the default nobody wants.
        write: false,
        out: null,
        panes: null,
        captureTo: null,
      },
    });
  });

  test("run defaults both passes ON, and --no-attention / --no-usage turn them off", () => {
    expect(parseArgv(["run"])).toEqual({ kind: "run", parsed: { command: "run", attention: true, usage: true } });
    const off = parseArgv(["run", "--no-attention", "--no-usage"]);
    expect(off).toEqual({ kind: "run", parsed: { command: "run", attention: false, usage: false } });
  });

  test("run --tick-ms and --url arrive as themselves", () => {
    expect(parseArgv(["run", "--url", "http://127.0.0.1:9999", "--tick-ms", "5000"])).toEqual({
      kind: "run",
      parsed: { command: "run", attention: true, usage: true, url: "http://127.0.0.1:9999", tickMs: 5000 },
    });
  });
});

describe("reconcile-jobs guards the reason twice", () => {
  test("an absent --why is refused by the parser", () => {
    const out = parseArgv(["reconcile-jobs"]);
    expect(out.kind).toBe("error");
    if (out.kind === "error") expect(out.why).toContain("--why");
  });

  test("a --why that is present and blank still parses — the emptiness check is the command's", () => {
    // Said out loud because it is the seam: `requiredOption` cannot refuse a
    // value it was given, so `runReconcileJobs` refuses `"   "` itself. A test
    // that asserted the parser caught it would be testing the wrong half — and
    // for a while this was the ONLY test near the blank reason, so deleting the
    // real check left the suite green. GPT Sol's P1. The check itself is tested
    // below, through the function that performs it.
    expect(parseArgv(["reconcile-jobs", "--why", "   "])).toEqual({
      kind: "run",
      parsed: { command: "reconcile-jobs", why: "   " },
    });
  });

  test("A BLANK REASON IS REFUSED AND WRITES NOTHING", () => {
    // MUTATION: delete the `why.trim() === ""` guard in `runReconcileJobs`; this
    // goes red on both the exit code and the absent file. Before this test,
    // deleting it cleared the scheduler hold with a blank audit reason and every
    // check stayed green.
    const root = mkdtempSync(join(tmpdir(), "overseer-reconcile-test-"));
    try {
      const errors: string[] = [];
      const realErr = console.error;
      console.error = (...a: unknown[]) => errors.push(a.map(String).join(" "));
      let code: number;
      try {
        code = runReconcileJobs(root, "   ");
      } finally {
        console.error = realErr;
      }
      expect(code).toBe(1);
      expect(existsSync(join(root, RECONCILE_FILE))).toBe(false);
      // The four lines of operational guidance, not Commander's generic refusal.
      expect(errors.join("\n")).toContain("gjd-remote ls");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("a real reason writes the file, so the refusal above is not just a broken command", () => {
    // The positive control. Without it, a `runReconcileJobs` that returned 1 for
    // everything would pass the test above.
    const root = mkdtempSync(join(tmpdir(), "overseer-reconcile-test-"));
    try {
      const realLog = console.log;
      console.log = () => {};
      let code: number;
      try {
        code = runReconcileJobs(root, "checked the log and gjd-remote ls; no job ran");
      } finally {
        console.log = realLog;
      }
      expect(code).toBe(0);
      expect(existsSync(join(root, RECONCILE_FILE))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("help is a request, not a failure", () => {
  test("a SUBCOMMAND's --help is help with its own text, and exits 0", () => {
    // It used to be an unknown option: `.helpOption(false)` on the root is
    // inherited at creation, so every subcommand lost its help and `usage
    // --help` exited 1 with empty stdout. GPT Sol's P1.
    //
    // MUTATION: remove the `restoreHelp` walk in `buildProgram` and this reddens.
    for (const line of [["usage", "--help"], ["status", "--help"], ["mine", "--help"], ["mine", "add", "--help"]]) {
      const out = parseArgv(line);
      expect(out.kind, line.join(" ")).toBe("help");
      if (out.kind === "help") {
        expect(out.text, line.join(" ")).not.toBeNull();
        expect(out.text ?? "").toContain("Usage: overseer");
      }
    }
  });

  test("the ROOT's help is our briefing, not Commander's reference page", () => {
    const out = parseArgv(["--help"]);
    expect(out).toEqual({ kind: "help", text: null });
  });

  test("a subcommand's help names that subcommand's own flags", () => {
    const out = parseArgv(["usage", "--help"]);
    if (out.kind === "help") {
      expect(out.text ?? "").toContain("--max-transcripts");
      expect(out.text ?? "").not.toContain("--tick-ms");
    }
  });
});

describe("mine — one noun, three verbs", () => {
  test("bare `mine` lists, so there is no second spelling of the same question", () => {
    expect(parseArgv(["mine"])).toEqual({ kind: "run", parsed: { command: "mine", action: "list" } });
    expect(parseArgv(["mine", "list"])).toEqual({ kind: "run", parsed: { command: "mine", action: "list" } });
  });

  test("add and rm take exactly one name", () => {
    expect(parseArgv(["mine", "add", "some-agent"])).toEqual({
      kind: "run",
      parsed: { command: "mine", action: "add", name: "some-agent" },
    });
    expect(parseArgv(["mine", "rm", "some-agent"])).toEqual({
      kind: "run",
      parsed: { command: "mine", action: "rm", name: "some-agent" },
    });
    expect(parseArgv(["mine", "add"]).kind).toBe("error");
  });

  test("an unknown verb is refused rather than treated as a name", () => {
    expect(parseArgv(["mine", "delete", "some-agent"]).kind).toBe("error");
  });
});

describe("parsing writes nothing to the real streams", () => {
  test("a refusal comes back as a value and is not printed", () => {
    // It WAS printed, by every subcommand, because a subcommand copies its
    // parent's output configuration when it is created and `parseArgv` applied
    // one afterwards. Nothing failed; the words simply appeared in the test
    // runner's output beside the passing assertions.
    const written: string[] = [];
    const out = { write: process.stdout.write, error: process.stderr.write };
    process.stdout.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    process.stderr.write = ((chunk: string) => {
      written.push(String(chunk));
      return true;
    }) as typeof process.stderr.write;
    try {
      parseArgv(["usage", "--max-transcipts", "3"]);
      parseArgv(["events", "--limit", "nope"]);
      parseArgv(["reconcile-jobs"]);
      parseArgv(["tik"]);
    } finally {
      process.stdout.write = out.write;
      process.stderr.write = out.error;
    }
    expect(written.join("")).toBe("");
  });
});

describe("the help cannot drift from the parser", () => {
  test("every registered command appears in the help's usage rows", () => {
    const program = buildProgram();
    const text = help();
    for (const command of program.commands) {
      expect(text).toContain(` ${command.name()}`);
    }
  });

  test("every registered option appears in the row for its own command", () => {
    // This is the whole reason the rows are generated. A flag added to a
    // command and not to the help was the drift; now there is no second place
    // for it to be missing from.
    const program = buildProgram();
    const rows = usageRows(program, "overseer");
    for (const command of program.commands) {
      const row = rows.find((r) => r.startsWith(`  overseer ${command.name()}`));
      expect(row, `no usage row for ${command.name()}`).toBeDefined();
      for (const option of command.options) {
        expect(row).toContain(option.flags);
      }
    }
  });

  test("A GROUP WITH A DEFAULT CHILD advertises the spelling that actually works", () => {
    // `mine` runs `mine list`, and the parser test above proves bare `mine`
    // works — but the generated rows listed only `mine list`, so the help was
    // missing a supported spelling in the file whose whole claim is that it
    // cannot be. GPT Sol's P1, and a direct correction to this plan's own
    // "mine is not runnable".
    //
    // MUTATION: drop the `_defaultCommandName` branch in `usageRows`; this reddens.
    const rows = usageRows(buildProgram(), "overseer");
    expect(rows).toContain("  overseer mine [list]");
    expect(rows).not.toContain("  overseer mine list");
    expect(rows).toContain("  overseer mine add <name>");
  });

  test("a mandatory option is printed bare and an optional one in brackets", () => {
    const rows = usageRows(buildProgram(), "overseer");
    const reconcile = rows.find((r) => r.startsWith("  overseer reconcile-jobs"));
    expect(reconcile).toContain("--why <what you checked>");
    expect(reconcile).not.toContain("[--why");
    const events = rows.find((r) => r.startsWith("  overseer events"));
    expect(events).toContain("[--limit <n>]");
  });

  test("the prose the parser cannot generate is still in there", () => {
    const text = help();
    expect(text).toContain("OVERSEER_STORE_DIR");
    expect(text).toContain("THE SCHEDULER IS OFF");
  });
});
