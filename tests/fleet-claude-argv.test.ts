/**
 * Reading a `claude` command line — tools/fleet/claude-argv.ts.
 *
 * THREE KINDS OF CASE, and all three are load-bearing:
 *
 *  1. **Real captures.** Shapes taken off `/proc/<pid>/cmdline` on the box on 2026-09-08, six live
 *     `claude` processes. **Redacted**: every prompt is `<prompt>` and every session id is a fixed
 *     fake uuid, because a real prompt is another agent's brief and has no business in this repo.
 *     What survives redaction is the SHAPE, which is the part under test.
 *  2. **Constructed adversarial cases.** The captures alone would be green on every bug in
 *     docs/plans/260908h-…md — none of them is headless, none uses the `=` spelling, none carries a
 *     second `--session-id`, and none has a prompt that mentions a flag. A suite made only of real
 *     traffic is a seed corpus, not a drift detector.
 *  3. **A fidelity pair.** The same command line read as faithful argv and as a `ps` blob, once
 *     where the two agree and once where they cannot.
 *
 * The suite was checked by mutation rather than by re-reading it: five mutants — walk through the
 * bare `--`, skip an unknown flag instead of refusing, match `--session-id` by prefix, drop the
 * subcommand check, ignore `-p` — plus a sixth for the variadic separator rule. All six were caught;
 * the count of failing tests for each is in the plan's Stage A report.
 */
import { describe, expect, it } from "vitest";

import {
  fromProcCmdline,
  fromPsArgs,
  readClaudeCommandLine,
  type ClaudeReading,
} from "../tools/fleet/claude-argv.js";

/** Fixed fakes. Never a real session id — see the header. */
const ID_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
const ID_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";

/** The faithful arm, which is what every case here is unless it says otherwise. */
const read = (argv: readonly string[]): ClaudeReading =>
  readClaudeCommandLine({ fidelity: "argv", argv });

const readFlat = (args: string): ClaudeReading => readClaudeCommandLine(fromPsArgs(args));

describe("real captures, redacted", () => {
  /**
   * The six live processes, reduced to their four distinct shapes. Note what is NOT here: no
   * `--print`, no `=` spelling, no second id, no subcommand. That absence is the reason the next
   * describe block exists.
   */
  const CAPTURES: readonly { what: string; argv: readonly string[] }[] = [
    { what: "interactive, no prompt", argv: ["claude", "--session-id", ID_A] },
    {
      what: "interactive with a permission mode",
      argv: ["claude", "--session-id", ID_A, "--permission-mode", "auto"],
    },
    {
      what: "prompted behind a separator (what new-claude emits today)",
      argv: ["claude", "--session-id", ID_A, "--permission-mode", "auto", "--", "<prompt>"],
    },
    {
      what: "prompted with no separator (an older launch on the box right now)",
      argv: ["claude", "--session-id", ID_A, "<prompt>"],
    },
  ];

  for (const capture of CAPTURES) {
    it(`reads ${capture.what} as one session id`, () => {
      expect(read(capture.argv)).toEqual({ kind: "session", headless: false, sessionIds: [ID_A] });
    });
  }

  it("reads a NUL-separated /proc blob, trailing NUL and all", () => {
    // Exactly what readFileSync('/proc/<pid>/cmdline') hands back: every element NUL-TERMINATED,
    // so the string ends with one.
    const raw = `claude\0--session-id\0${ID_A}\0--permission-mode\0auto\0`;
    const line = fromProcCmdline(raw);
    expect(line).toEqual({
      fidelity: "argv",
      argv: ["claude", "--session-id", ID_A, "--permission-mode", "auto"],
    });
    expect(readClaudeCommandLine(line)).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_A],
    });
  });

  it("keeps an interior empty argv element, which is a real element", () => {
    // Dropping it would shift everything after it by one, which is how `--name "" --print` would
    // become `--name --print` and lose the headless flag.
    expect(fromProcCmdline(`claude\0--name\0\0--print\0`).argv).toEqual([
      "claude",
      "--name",
      "",
      "--print",
    ]);
  });

  it("reads the shape run-claude actually builds", () => {
    // scripts/run-claude.ts buildClaudeArgs, `read` access, abbreviated only where the values are
    // long. Headless, and carrying no session id at all — it takes the id back out of the event
    // stream instead. A caller that confused this with an interactive pane would type at a process
    // that stopped reading its terminal at startup.
    expect(
      read([
        "claude",
        "--print",
        "--model",
        "claude-opus-5",
        "--effort",
        "high",
        "--output-format",
        "stream-json",
        "--verbose",
        "--permission-prompts",
        "none",
        "--tools",
        "Read,Grep,Glob",
        "--restricted",
        "--strict-mcp-config",
        "--",
        "<prompt>",
      ]),
    ).toEqual({ kind: "session", headless: true, sessionIds: [] });
  });
});

describe("the option region ends at `--` or the first bare word", () => {
  it("stops at a bare `--`, so a prompt that says `--session-id` is not a second id", () => {
    // The literal form of the bug: `claude --session-id B -- --session-id A` is a prompt whose
    // text is `--session-id A`.
    expect(read(["claude", "--session-id", ID_B, "--", "--session-id", ID_A])).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_B],
    });
  });

  it("stops at the first bare word, so a flattened prompt mentioning flags is still prose", () => {
    // `ps` has already destroyed the quoting, so the prompt arrives as seven words. The boundary at
    // `Please` is the only thing between us and reading `--print` out of somebody's sentence.
    const reading = readFlat(`claude --session-id ${ID_A} Please add a --print flag and --session-id ${ID_B}`);
    expect(reading).toEqual({ kind: "session", headless: false, sessionIds: [ID_A] });
  });

  it("does not read a flag that lives after the separator", () => {
    expect(read(["claude", "--session-id", ID_A, "--", "--print"])).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_A],
    });
  });
});

describe("subcommands are not sessions", () => {
  it("reads `claude agents`", () => {
    expect(read(["claude", "agents"])).toEqual({ kind: "subcommand", name: "agents" });
  });

  it("reads `claude mcp`", () => {
    expect(read(["claude", "mcp"])).toEqual({ kind: "subcommand", name: "mcp" });
  });

  it("reads `claude auth status --json`, which run-claude really runs", () => {
    expect(read(["claude", "auth", "status", "--json"])).toEqual({
      kind: "subcommand",
      name: "auth",
    });
  });

  it("reads a subcommand that follows a global flag", () => {
    // Measured 2026-09-08: `claude --session-id <uuid> mcp` prints the mcp usage, exactly as
    // `claude mcp` does, so a preceding option does not stop the dispatch. See the module header
    // for the one combination that behaved differently and was not explained.
    expect(read(["claude", "--session-id", ID_A, "mcp"])).toEqual({
      kind: "subcommand",
      name: "mcp",
    });
  });

  it("does not treat `help` as a subcommand", () => {
    // Measured: `claude help me fix this` runs "help me fix this" as a PROMPT. A prompt beginning
    // "help" is a thing people type, so `help` is deliberately out of the list.
    expect(read(["claude", "--session-id", ID_A, "help me fix this"])).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_A],
    });
  });
});

describe("headless", () => {
  it("sees `--print`", () => {
    expect(read(["claude", "--print", "--session-id", ID_A])).toEqual({
      kind: "session",
      headless: true,
      sessionIds: [ID_A],
    });
  });

  it("sees `-p` after a flag that takes a value — work.ts's self-declared KNOWN GAP", () => {
    // `classifyPaneWork` anchored its headless test to the FIRST argument and said so in a comment:
    // `claude --model x -p …` was missed. The flag table is what closes it — `--model` takes one
    // value, so `-p` is still inside the option region.
    expect(read(["claude", "--model", "opus", "-p", "--", "<prompt>"])).toEqual({
      kind: "session",
      headless: true,
      sessionIds: [],
    });
  });

  it("does not see `--print` in a prompt behind a separator", () => {
    expect(read(["claude", "--session-id", ID_A, "--", "--print", "please"])).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_A],
    });
  });
});

describe("every --session-id before the boundary is reported, and the caller decides", () => {
  it("accepts the inline `=` spelling", () => {
    expect(read(["claude", `--session-id=${ID_A}`])).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_A],
    });
  });

  it("reports the same id twice as two occurrences, not one", () => {
    // D2. This module does not collapse them: `harness.ts` wants to accept identical ids and
    // `steer.ts` wants to refuse any repeat, and both are true statements about this parse.
    expect(read(["claude", "--session-id", ID_A, "--session-id", ID_A])).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_A, ID_A],
    });
  });

  it("reports two different ids", () => {
    expect(read(["claude", "--session-id", ID_A, "--session-id", ID_B])).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_A, ID_B],
    });
  });

  it("reports all three when two agree and one differs", () => {
    // `recogniseClaude` compared only the FIRST TWO, so `A A B` was accepted as `A` — Sol's P2-2.
    // Every occurrence is returned, so the caller's set-over-all-of-them can be right.
    expect(read(["claude", "--session-id", ID_A, "--session-id", ID_A, "--session-id", ID_B])).toEqual(
      { kind: "session", headless: false, sessionIds: [ID_A, ID_A, ID_B] },
    );
  });

  it("is unreadable when `--session-id` has no value at all", () => {
    const reading = read(["claude", "--session-id"]);
    expect(reading.kind).toBe("unreadable");
    expect(reading.kind === "unreadable" && reading.why).toContain("--session-id");
  });

  it("is unreadable when the token after `--session-id` is a flag", () => {
    expect(read(["claude", "--session-id", "--print"]).kind).toBe("unreadable");
  });

  it("is unreadable when the inline value is empty", () => {
    expect(read(["claude", "--session-id="]).kind).toBe("unreadable");
  });

  it("does not match `--session-id` by prefix", () => {
    // `--session-idle` is not `--session-id`, and a reader that matched by prefix would read
    // `idle` as somebody's session. Exactly, or not at all.
    const reading = read(["claude", "--session-idle", "30"]);
    expect(reading.kind).toBe("unreadable");
    expect(reading.kind === "unreadable" && reading.why).toContain("--session-idle");
  });
});

describe("an unknown flag is refused, loudly, by name", () => {
  it("refuses a flag Anthropic has not shipped yet", () => {
    const reading = read(["claude", "--session-id", ID_A, "--future-flag", "x", "--print"]);
    expect(reading.kind).toBe("unreadable");
    expect(reading.kind === "unreadable" && reading.why).toContain("--future-flag");
  });

  it("refuses rather than skipping, because skipping is what grants prose steering", () => {
    // The yargs-parser policy — skip the flag and the next bare word — would return
    // {session, headless:false, ids:[A]} here, and the truth is a headless run. That reading is the
    // one that puts a message in a terminal nobody is reading.
    const reading = read(["claude", "--session-id", ID_A, "--future-flag", "--print"]);
    expect(reading.kind).toBe("unreadable");
  });

  it("refuses a value given to a flag that takes none", () => {
    expect(read(["claude", "--print=true"]).kind).toBe("unreadable");
  });

  it("refuses a flag whose value is optional in the CLI", () => {
    // `-r, --resume [value]` cannot be read from argv alone: `--resume foo` is either "resume foo"
    // or "resume, then the prompt foo". Deliberately absent from the table.
    const reading = read(["claude", "--resume", "foo"]);
    expect(reading.kind).toBe("unreadable");
    expect(reading.kind === "unreadable" && reading.why).toContain("--resume");
  });
});

describe("variadic flags", () => {
  it("reads a variadic flag when a `--` bounds it, and still sees the --print after it", () => {
    // The case that killed the first design: one-value-per-flag eats `one`, stops at `two`, never
    // sees `--print`, and reports a steerable interactive session on a headless run.
    expect(
      read(["claude", "--session-id", ID_A, "--add-dir", "one", "two", "--print", "--", "<prompt>"]),
    ).toEqual({ kind: "session", headless: true, sessionIds: [ID_A] });
  });

  it("refuses a variadic flag with no separator, because its values and the prompt are one run", () => {
    const reading = read(["claude", "--session-id", ID_A, "--add-dir", "one", "two", "<prompt>"]);
    expect(reading.kind).toBe("unreadable");
    expect(reading.kind === "unreadable" && reading.why).toContain("--add-dir");
  });

  it("refuses rather than reading a session id out of the words a variadic flag ran into", () => {
    // The consequence, not the shape. A variadic flag with nothing to stop it walks out of the
    // option region and into the prompt, and the next thing that looks like a flag is read as one:
    // this line would otherwise report a session belonging to somebody the prompt merely NAMES,
    // which is a message delivered to the wrong agent.
    const reading = readFlat(`claude --add-dir /tmp/a tell --session-id ${ID_B} to stop`);
    const idsItWouldHaveHandedOver = reading.kind === "session" ? reading.sessionIds : [];
    expect(idsItWouldHaveHandedOver).not.toContain(ID_B);
    expect(reading.kind).toBe("unreadable");
  });

  it("refuses a variadic flag with no values", () => {
    expect(read(["claude", "--add-dir", "--print", "--", "<prompt>"]).kind).toBe("unreadable");
  });

  it("accepts a variadic flag's inline spelling without needing a separator", () => {
    expect(read(["claude", "--add-dir=/tmp/x", "--session-id", ID_A])).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_A],
    });
  });
});

describe("`--name` is one value on argv and an unknown number on a ps blob", () => {
  // `scripts/gjd-remote.ts` emits `--name ${shq(name)}` BEFORE the `--`, shell-quoted because the
  // name may contain spaces. On the faithful arm that is one element. On the flattened arm the
  // quoting is already gone, and reading it as one token ends the option region in the middle of
  // somebody's session name.

  it("reads a multi-word name as one value on faithful argv, and still sees the --print after it", () => {
    expect(read(["claude", "--session-id", ID_A, "--name", "my session", "--print"])).toEqual({
      kind: "session",
      headless: true,
      sessionIds: [ID_A],
    });
  });

  it("reads a multi-word name that ends the flattened command line", () => {
    // A named session with no prompt — `new-claude` produces exactly this — so nothing follows the
    // name and nothing can be misread. It must stay readable: refusing here would pay a refusal for
    // a shape we generate routinely.
    expect(readFlat(`claude --session-id ${ID_A} --permission-mode auto --name my session`)).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_A],
    });
  });

  it("reads a multi-word name that the launcher's `--` bounds", () => {
    expect(readFlat(`claude --session-id ${ID_A} --name my session -- go and do the thing`)).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_A],
    });
  });

  it("refuses rather than reporting an interactive session when --print follows a flattened name", () => {
    // THE CASE THAT MATTERS. Reading `--name` as one token here takes `my`, calls `session` the
    // first bare word, stops, and never sees `--print` — a headless run reported as steerable.
    // Whatever else we do, we must not return that.
    const reading = readFlat(`claude --session-id ${ID_A} --name my session --print`);
    expect(reading).not.toEqual({ kind: "session", headless: false, sessionIds: [ID_A] });
    expect(reading.kind).toBe("unreadable");
    expect(reading.kind === "unreadable" && reading.why).toContain("--name");
  });

  it("refuses rather than reading a session id out of the prose after a flattened name", () => {
    const reading = readFlat(`claude --name my session tell --session-id ${ID_B} to stop`);
    const idsItWouldHaveHandedOver = reading.kind === "session" ? reading.sessionIds : [];
    expect(idsItWouldHaveHandedOver).not.toContain(ID_B);
    expect(reading.kind).toBe("unreadable");
  });

  it("reads a single-word name on either arm, which is what the box actually carries", () => {
    const argv = ["claude", "--session-id", ID_A, "--name", "overseer-o1-store", "--", "<prompt>"];
    const expected = { kind: "session", headless: false, sessionIds: [ID_A] };
    expect(readClaudeCommandLine({ fidelity: "argv", argv })).toEqual(expected);
    expect(readFlat(argv.join(" "))).toEqual(expected);
  });
});

describe("argv[0]", () => {
  it("refuses a command line that is not claude at all", () => {
    // The defect this replaces: a substring search called `grep -r --session-id <uuid> logs/` a
    // Claude, and would have sent it a message.
    const reading = read(["grep", "-r", "--session-id", ID_A, "logs/"]);
    expect(reading.kind).toBe("not-claude");
    expect(reading.kind === "not-claude" && reading.why).toContain("grep");
  });

  it("accepts a full path whose basename is claude", () => {
    expect(read(["/home/greg/.local/bin/claude", "--session-id", ID_A])).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_A],
    });
  });

  it("refuses a wrapper whose name merely starts with claude", () => {
    expect(read(["claude-wrapper", "--session-id", ID_A]).kind).toBe("not-claude");
  });

  it("refuses an empty command line", () => {
    expect(read([]).kind).toBe("not-claude");
    expect(readClaudeCommandLine(fromProcCmdline("")).kind).toBe("not-claude");
  });
});

describe("fidelity: the same command line, read two ways", () => {
  it("agrees when the launcher put a `--` in — which is every prompted launch", () => {
    // The unexpected win in the plan: honouring `--` means a reader never scans a prompt at all on
    // the shapes that carry prose, so the `ps` flattening stops mattering for exactly those.
    const argv = ["claude", "--session-id", ID_A, "--permission-mode", "auto", "--", "a prompt with --print in it"];
    const faithful = readClaudeCommandLine({ fidelity: "argv", argv });
    const flattened = readFlat(argv.join(" "));
    expect(faithful).toEqual({ kind: "session", headless: false, sessionIds: [ID_A] });
    expect(flattened).toEqual(faithful);
  });

  it("cannot agree when a dash-leading prompt has no separator", () => {
    // One argv element in the kernel; five words by the time `ps` is done. The faithful read says
    // "I cannot read this" — the whole prompt is one token and no flag has that name. The flattened
    // read believes the prompt's first word. Both refuse steering, and they refuse it for different
    // reasons, which is the point of the tag: only one of them is entitled to an opinion.
    const argv = ["claude", "--session-id", ID_A, "-p please print this"];
    const faithful = readClaudeCommandLine({ fidelity: "argv", argv });
    const flattened = readFlat(argv.join(" "));
    expect(faithful.kind).toBe("unreadable");
    expect(flattened).toEqual({ kind: "session", headless: true, sessionIds: [ID_A] });
  });

  it("fromPsArgs collapses runs of whitespace, which is all it can do", () => {
    expect(fromPsArgs("  claude   --session-id   x  ").argv).toEqual(["claude", "--session-id", "x"]);
  });
});
