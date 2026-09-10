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
 * The suite was checked by mutation rather than by re-reading it, twice. Round 1: eight mutants,
 * none surviving. Round 2 added seven more for the rules that changed when the boundary rule was
 * corrected — stop at the first positional again, drop the flattened ambiguity rule, apply it on
 * both arms, arm it on a flag's consumed value, drop the terminal-flag check, run it before the
 * arity check, accept an empty separate value, pop the whole trailing-NUL run. The table of every
 * mutant and how many tests each one turned red is in the plan's Stage A report; the point of
 * writing it down is that a mutant with a LOW kill count marks a rule held by one assertion.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

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
    // EXACTLY ONE trailing empty is dropped — the one the terminating NUL leaves — and no more.
    // `claude --name ""` really does end in two NULs, and a reader that pops the whole run deletes
    // a real final element while claiming to hand back faithful argv (Sol ARGV-06).
    expect(fromProcCmdline("claude\0--name\0\0").argv).toEqual(["claude", "--name", ""]);
    // The rule that was here before dropped the run instead, on the theory that a process which
    // has rewritten its own argv (setproctitle) leaves padding. No such process exists on the box:
    // census 2026-09-08, 5 live `claude` processes, every one with a trailing-empty run of exactly
    // 1. And a trailing empty is harmless downstream now — it is a positional, and positionals no
    // longer end the option region.
    expect(fromProcCmdline("claude\0\0\0").argv).toEqual(["claude", "", ""]);
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

describe("the option region ends at a bare `--` and nowhere else", () => {
  // ROUND 2, Sol's ARGV-01. Measured against `claude` 2.1.263 on this box: `claude
  // ordinary-prompt --session-id not-a-uuid --print` fails the UUID check, `claude some-prompt
  // --version` prints the version, `claude say-only-OK --print --model nonsense` reaches the model
  // lookup. Claude permutes; a positional does not end the option region. The rule this suite used
  // to assert was a rule about nothing.

  it("reads a flag that comes after a positional, on faithful argv", () => {
    // The measurement, in one case. `ordinary-prompt` is the prompt; `--print` is still a flag.
    expect(read(["claude", "ordinary-prompt", "--print"])).toEqual({
      kind: "session",
      headless: true,
      sessionIds: [],
    });
  });

  it("reads a `--session-id` that comes after a positional, on faithful argv", () => {
    expect(read(["claude", "a whole prompt in one element", "--session-id", ID_A])).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_A],
    });
  });

  it("does not let an empty argv element end the option region", () => {
    // `["claude","","--print"]` — an empty element is a bare word, so the old rule stopped dead on
    // it and reported an interactive session for a headless run. Sol's own case.
    expect(read(["claude", "", "--print"])).toEqual({
      kind: "session",
      headless: true,
      sessionIds: [],
    });
  });

  it("keeps a flag inside a faithful prompt as prose, because the prompt is ONE element", () => {
    // The fidelity tag earning its keep, half one. This process is NOT headless: the kernel says
    // the prompt is a single argv element, so its `--print` is text.
    expect(read(["claude", "--session-id", ID_A, "Please add a --print flag"])).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_A],
    });
  });

  it("refuses the same command line flattened, because there it IS headless", () => {
    // Half two. `ps` cannot tell that process from `claude … Please add a --print flag` as six
    // arguments, and THAT one is headless. Two fidelities, two different correct answers.
    const reading = readFlat(`claude --session-id ${ID_A} Please add a --print flag`);
    expect(reading.kind).toBe("unreadable");
    expect(reading.kind === "unreadable" && reading.why).toContain("--print");
  });

  it("refuses a flattened prompt that mentions `--session-id`, rather than reporting a second id", () => {
    const reading = readFlat(
      `claude --session-id ${ID_A} Please add a --print flag and --session-id ${ID_B}`,
    );
    const idsItWouldHaveHandedOver = reading.kind === "session" ? reading.sessionIds : [];
    expect(idsItWouldHaveHandedOver).not.toContain(ID_B);
    expect(reading.kind).toBe("unreadable");
  });

  it("refuses a flattened bare `--` that follows a prompt word, because it may BE a prompt word", () => {
    // GPT Sol's ARGV-P1-01, round 2 of Stage B, and it is the same bug as the two above wearing
    // the one token the module used to treat as unambiguous. `--` is a word people write in prose
    // — an em dash typed by somebody whose keyboard does not have one — and on this arm nothing
    // says whether it is the separator or that word.
    //
    // The consequence is the exact grant this whole plan started from: the reading stops at the
    // `--`, never sees the `--print` after it, and hands back a steerable interactive session for a
    // process that stopped reading its terminal at startup. The faithful half of the pair is the
    // proof that the flattened answer is WRONG rather than merely cautious: the kernel says the
    // prompt is one element, so the `--print` really is a flag and the run really is headless.
    const argv = ["claude", "--session-id", ID_A, "Please explain -- carefully", "--print"];
    expect(read(argv)).toEqual({ kind: "session", headless: true, sessionIds: [ID_A] });

    const reading = readFlat(argv.join(" "));
    // Named as the answer it must not give, not just as the one it must: this is what the grant
    // looked like, and it is what `steer.ts` and `harness.ts` would have acted on.
    expect(reading).not.toEqual({ kind: "session", headless: false, sessionIds: [ID_A] });
    expect(reading.kind).toBe("unreadable");
    expect(reading.kind === "unreadable" && reading.why).toContain("--");
  });

  it("still reads a bare `--` BEFORE any positional, which is where every launcher puts it", () => {
    // What keeps the refusal above affordable, and it was measured rather than assumed:
    // `gjd-remote.ts`'s `new-claude` (~2565) and `run-claude.ts`'s `buildClaudeArgs` (~326) both
    // emit the separator after the last flag and before the prompt, so `sawPositional` is false
    // when the scan reaches it. Census on this box, 2026-09-08: 6 live `claude` processes, one of
    // them carrying a `--`, and NONE of them changes its reading under the new rule.
    const argv = ["claude", "--session-id", ID_A, "--name", "a-name", "--", "please explain -- carefully"];
    const expected = { kind: "session", headless: false, sessionIds: [ID_A] };
    expect(read(argv)).toEqual(expected);
    expect(readFlat(argv.join(" "))).toEqual(expected);
  });

  it("still reads the launcher's own shape, which is why the refusal is affordable", () => {
    // `claude --session-id A --permission-mode auto -- <prompt>` is what `new-claude` emits, and
    // the `--` means no prompt is ever scanned. This must stay readable on BOTH arms.
    const argv = ["claude", "--session-id", ID_A, "--permission-mode", "auto", "--", "<prompt>"];
    const expected = { kind: "session", headless: false, sessionIds: [ID_A] };
    expect(read(argv)).toEqual(expected);
    expect(readFlat(argv.join(" "))).toEqual(expected);
  });

  it("does not arm the flattened refusal on a bare word a flag consumed as its value", () => {
    // `auto` is `--permission-mode`'s value, not a positional. If consumed values armed the
    // ambiguity rule, the ordinary launcher shape would refuse — which is the whole cost of
    // getting this distinction wrong.
    expect(readFlat(`claude --permission-mode auto --print --session-id ${ID_A}`)).toEqual({
      kind: "session",
      headless: true,
      sessionIds: [ID_A],
    });
  });

  it("stops at a bare `--`, so a prompt that says `--session-id` is not a second id", () => {
    // The literal form of the bug: `claude --session-id B -- --session-id A` is a prompt whose
    // text is `--session-id A`.
    expect(read(["claude", "--session-id", ID_B, "--", "--session-id", ID_A])).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_B],
    });
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

  it("only the FIRST positional can be a command word", () => {
    // A flattened prompt is a run of positionals, and one of its later words may be a subcommand
    // name — `stop` is, and "tell me to stop" is a thing somebody writes. Checking every bare word
    // would make that prompt a `subcommand` and the pane unaddressable. Commander dispatches on the
    // first operand, and so do we.
    expect(readFlat(`claude --session-id ${ID_A} tell me to stop`)).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_A],
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

describe("a flag that prints and exits is not a session either", () => {
  // Sol's ARGV-02. `--version` was in the flag table with arity `none`, and only `--print` affected
  // the classification, so `claude --version --session-id A` came back as a steerable session
  // carrying A. Measured on 2.1.263: it prints `2.1.263 (Claude Code)` and exits 0 — even in front
  // of a `--session-id` value so malformed that the same line with `--print` errors on it. So the
  // version flag short-circuits everything, and the reading has to say so.

  it("reads `claude --version` as a subcommand, not a session", () => {
    expect(read(["claude", "--version"])).toEqual({ kind: "subcommand", name: "--version" });
  });

  it("reads `claude --version --session-id <uuid>`, which is the shape that lied", () => {
    // The box health check emits `claude --version`. Nothing may be typed at it.
    expect(read(["claude", "--version", "--session-id", ID_A])).toEqual({
      kind: "subcommand",
      name: "--version",
    });
  });

  it("reads `-v` the same way", () => {
    expect(read(["claude", "-v"])).toEqual({ kind: "subcommand", name: "-v" });
  });

  it("sees a `--version` that follows a positional on faithful argv", () => {
    // Measured: `claude some-prompt-here --version` prints the version. Permutation again.
    expect(read(["claude", "some-prompt-here", "--version"])).toEqual({
      kind: "subcommand",
      name: "--version",
    });
  });

  it("does not see a `--version` behind the separator", () => {
    expect(read(["claude", "--session-id", ID_A, "--", "--version"])).toEqual({
      kind: "session",
      headless: false,
      sessionIds: [ID_A],
    });
  });

  it("refuses `--version=x`, because it takes no value", () => {
    expect(read(["claude", "--version=x"]).kind).toBe("unreadable");
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
    // D2, AND THE COMMENT HERE USED TO STATE THE OLD POLICY: it said `steer.ts` "wants to refuse
    // any repeat", which stopped being true when Stage B landed — `isClaudeForSession` takes a SET
    // over every occurrence, so `A A` is one conversation and is accepted, exactly as `harness.ts`
    // accepts it. Both callers now apply the same rule and neither wants the raw count.
    //
    // What the occurrence LIST is still for is `A A B`: a set of one is the accept, and a caller
    // handed a collapsed value could not tell that case from `A`. That is the whole reason this
    // module reports occurrences and decides nothing.
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

  it("is unreadable when the SEPARATE value is empty, exactly as the inline one is", () => {
    // Sol's ARGV-04. `["claude","--session-id","","--print"]` returned `sessionIds: [""]`, and an
    // empty id is not an id — Stage C's awk refuses it, and the two spellings of the same mistake
    // must not disagree. `steer.ts` would then have compared "" against a real pane's id.
    const reading = read(["claude", "--session-id", "", "--print"]);
    expect(reading.kind).toBe("unreadable");
    expect(reading.kind === "unreadable" && reading.why).toContain("--session-id");
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

  it("refuses a flag whose value is optional in the CLI, and `--resume` with anything but a uuid", () => {
    // `--resume` has a rule of its own since 2026-09-10 (the block below), and it reads exactly one
    // shape: a uuid right after it. `--resume foo` is a picker search term, not a conversation.
    const reading = read(["claude", "--resume", "foo"]);
    expect(reading.kind).toBe("unreadable");
    expect(reading.kind === "unreadable" && reading.why).toContain("--resume");
    // and the other optional-value flags are still simply absent from the table
    expect(read(["claude", "--worktree", "foo"]).kind).toBe("unreadable");
  });
});

/**
 * `--resume <uuid>` — THE ONE OPTIONAL-VALUE SHAPE THIS REPO PRODUCES (plan 260910f, Stage 3a).
 *
 * The first two cases are a REAL capture, not redacted: `/proc/<pid>/cmdline` of a resumed
 * interactive claude, taken on 2026-09-10 in the shape `gjd-remote --resume-conversation` emits, and
 * the `ps` line of the same process. The id is the spike's own scratch conversation and the prompt
 * the spike's own, so neither is anybody's brief; they live in tests/fixtures/claude-argv/ so the id
 * is never a literal in two test files. Every refusal after them is paired with an acceptance, so a
 * reader that has stopped saying yes to anything cannot pass.
 */
describe("`--resume <uuid>` names the conversation, and nothing else about `--resume` does", () => {
  const CAPTURE = JSON.parse(
    readFileSync(join(import.meta.dirname, "fixtures", "claude-argv", "resumed-claude.json"), "utf8"),
  ) as { conversationId: string; argv: string[]; ps: { line: string } };
  /** The ps line's args column: everything after pid, ppid and etimes. */
  const psArgs = CAPTURE.ps.line.trim().split(/\s+/).slice(3).join(" ");
  const resumed = (id: string): ClaudeReading => ({ kind: "session", headless: false, sessionIds: [id] });
  const noConversation: ClaudeReading = { kind: "session", headless: false, sessionIds: [] };

  it("reads the real capture as a session for the resumed conversation", () => {
    expect(read(CAPTURE.argv)).toEqual(resumed(CAPTURE.conversationId));
    // and through the kernel's own encoding, trailing NUL and all
    expect(readClaudeCommandLine(fromProcCmdline(`${CAPTURE.argv.join("\0")}\0`))).toEqual(
      resumed(CAPTURE.conversationId),
    );
  });

  /**
   * GPT Sol's G21 (2026-09-10): the same process off `ps` is UNREADABLE, because a picker search
   * that is ONE argument prints exactly the same line. Both halves are asserted — the collision, and
   * the refusals on each side of it — so the refusal cannot pass by the collision quietly going away.
   */
  it("does not read the same process off `ps`: a one-argument picker search prints the same line", () => {
    const picker = [
      "claude",
      "--resume",
      `${CAPTURE.conversationId} --permission-mode auto --model haiku -- Reply with exactly: OK4`,
    ];
    // The collision: two different argvs, one `ps` line.
    expect(picker.join(" ")).toBe(psArgs);
    expect(CAPTURE.argv.join(" ")).toBe(psArgs);
    // Faithful, the picker is one non-uuid value: refused, while the real capture reads (above).
    const faithfulPicker = read(picker);
    expect(faithfulPicker.kind).toBe("unreadable");
    expect(faithfulPicker.kind === "unreadable" && faithfulPicker.why).toContain("not a conversation id");
    // Flattened, the two cannot be told apart, so neither is read.
    const flat = readFlat(psArgs);
    expect(flat.kind).toBe("unreadable");
    expect(flat.kind === "unreadable" && flat.why).toContain("argument boundaries");
  });

  it("a bare `--resume` opens the picker, so it names no conversation", () => {
    for (const argv of [
      ["claude", "--resume"],
      ["claude", "--resume", "--permission-mode", "auto"],
      ["claude", "--resume", "--", ID_A],
    ]) {
      const reading = read(argv);
      expect(reading.kind, argv.join(" ")).toBe("unreadable");
      expect(reading.kind === "unreadable" && reading.why).toContain("picker");
    }
    expect(read(["claude", "--resume", ID_A, "--permission-mode", "auto"])).toEqual(resumed(ID_A));
  });

  it("a value that is not exactly a lowercase uuid is not a conversation", () => {
    for (const value of ["foo", ID_A.toUpperCase(), `${ID_A}9`, ID_A.slice(0, 8), "", ` ${ID_A}`, `${ID_A} carry on`]) {
      const reading = read(["claude", "--resume", value]);
      expect(reading.kind, JSON.stringify(value)).toBe("unreadable");
      expect(reading.kind === "unreadable" && reading.why).toContain("--resume");
    }
    expect(read(["claude", "--resume", ID_A])).toEqual(resumed(ID_A));
  });

  it("only the long spelling, as two elements, is read", () => {
    expect(read(["claude", `--resume=${ID_A}`]).kind).toBe("unreadable");
    expect(read(["claude", "-r", ID_A]).kind).toBe("unreadable");
    expect(read(["claude", `--resume ${ID_A}`]).kind).toBe("unreadable");
  });

  it("a uuid anywhere but right after `--resume` is not the conversation", () => {
    expect(read(["claude", "--permission-mode", "auto", ID_A])).toEqual(noConversation);
    expect(read(["claude", "--model", "haiku", ID_A])).toEqual(noConversation);
    expect(read(["claude", "--name", "fleet", ID_A])).toEqual(noConversation);
    expect(read(["claude", "--", ID_A])).toEqual(noConversation);
    expect(read(["claude", "--", "--resume", ID_A])).toEqual(noConversation);
    expect(read(["claude", "--print", ID_A])).toEqual({ kind: "session", headless: true, sessionIds: [] });
  });

  it("refuses a resume beside any --session-id, in either order, equal ids included; and a fork", () => {
    // GPT Sol's G22: `claude` refuses the two selectors together unless `--fork-session` ("Error:
    // --session-id can only be used with --continue or --resume if --fork-session is also
    // specified"), so the process enters no conversation at all — not A, and not "two conversations".
    for (const argv of [
      ["claude", "--resume", ID_A, "--session-id", ID_A],
      ["claude", "--session-id", ID_A, "--resume", ID_A],
      ["claude", `--session-id=${ID_A}`, "--resume", ID_A],
      ["claude", "--resume", ID_A, "--session-id", ID_B],
      ["claude", "--session-id", ID_B, "--resume", ID_A],
    ]) {
      const reading = read(argv);
      expect(reading.kind, argv.join(" ")).toBe("unreadable");
      expect(reading.kind === "unreadable" && reading.why, argv.join(" ")).toContain("--fork-session");
    }
    // and its pair: each selector alone still names its conversation
    expect(read(["claude", "--session-id", ID_A])).toEqual(resumed(ID_A));
    expect(read(["claude", "--resume", ID_A])).toEqual(resumed(ID_A));
    // `--fork-session` mints a new id nothing could match, and it is no flag this repo produces.
    expect(read(["claude", "--resume", ID_A, "--fork-session"]).kind).toBe("unreadable");
    // headless resume is still headless, which is what the spike ran
    expect(read(["claude", "-p", "--resume", ID_A, "Reply"])).toEqual({
      kind: "session",
      headless: true,
      sessionIds: [ID_A],
    });
  });

  it("reads a resume after a prompt on faithful argv, because claude permutes, and not off `ps`", () => {
    expect(read(["claude", "<prompt>", "--resume", ID_A])).toEqual(resumed(ID_A));
    expect(readFlat(`claude <prompt> --resume ${ID_A}`).kind).toBe("unreadable");
  });

  it("the fidelity pair: the id is read on argv and `--resume` in any form is refused off `ps`", () => {
    // Faithful: the prompt is its own element, so the id is exactly the element after `--resume`.
    const argv = ["claude", "--resume", ID_A, "carry on please"];
    expect(read(argv)).toEqual(resumed(ID_A));
    // Flattened: refused whatever follows the id — a bare word, a dash-led token, or nothing —
    // because flattening erased the boundaries that say where the value ends (G21). A dash-led token
    // after the id is no better evidence than a bare word: it can be the inside of a search term.
    for (const line of [
      argv.join(" "),
      `claude --resume ${ID_A} --permission-mode auto -- carry on please`,
      `claude --resume ${ID_A}`,
      "claude --resume",
    ]) {
      const flat = readFlat(line);
      expect(flat.kind, line).toBe("unreadable");
      expect(flat.kind === "unreadable" && flat.why, line).toContain("--resume");
    }
    // and its pair, so the flattened refusal is about `--resume` and not a blanket one
    expect(readFlat(`claude --session-id ${ID_A} --permission-mode auto -- carry on please`)).toEqual(resumed(ID_A));
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

describe("`--name` takes exactly one token, and a flattened multi-word name spills into positionals", () => {
  // `scripts/gjd-remote.ts` emits `--name ${shq(name)}` BEFORE the `--`, shell-quoted because the
  // name may contain spaces. On the faithful arm that is one element. On the flattened arm the
  // quoting is gone — and the CLI, measured, takes ONE token: `claude --name my mcp` and
  // `claude --name=my mcp` both print the `mcp` usage. So the extra words are positionals, and the
  // general positional rule (above) is what refuses the dangerous continuations. Round 2 deleted
  // the `one-free-text` arity that used to consume the whole run; see the module header.

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

  it("refuses a multi-word name even when a `--` follows it — ARGV-P1-01 reaches this one too", () => {
    // THIS TEST ASSERTED THE OPPOSITE UNTIL ROUND 2 OF STAGE B, and the change is deliberate: the
    // `--` after a positional is now ambiguous like any other dash-led token, so this line is
    // `unreadable` rather than a session.
    //
    // The rule refuses slightly more than it strictly has to. On THIS line the two readings agree
    // (nothing dash-led follows the `--`, so everything after it is prose either way), and a
    // narrower rule — refuse only when a dash-led token appears after the ambiguous `--` — would
    // have kept it readable. Rejected: it is a second condition and a lookahead, to buy back a
    // shape neither producer can make. **A session name cannot contain a space**:
    // `gjd-remote.ts:2462` and `tools/fleet/routes-new.ts:376` both die unless the name matches
    // `^[a-z0-9][a-z0-9-]{0,40}$`, so `--name` is one token from every launcher we have, and the
    // positional this depends on never exists.
    const reading = readFlat(`claude --session-id ${ID_A} --name my session -- go and do the thing`);
    expect(reading.kind).toBe("unreadable");
    expect(reading.kind === "unreadable" && reading.why).toContain("--");
  });

  it("refuses rather than reporting an interactive session when --print follows a flattened name", () => {
    // THE CASE THAT MATTERS, and note what it is NOT any more: reading `--name` as one token no
    // longer ends the option region, so this is not "we never see the --print". It is that
    // `session` may be the second word of a name or the first word of a prompt, and `--print` is a
    // flag in one reading and prose in the other. Whatever else we do, we must not return a
    // steerable interactive session here.
    const reading = readFlat(`claude --session-id ${ID_A} --name my session --print`);
    expect(reading).not.toEqual({ kind: "session", headless: false, sessionIds: [ID_A] });
    expect(reading.kind).toBe("unreadable");
    expect(reading.kind === "unreadable" && reading.why).toContain("--print");
  });

  it("does not swallow a subcommand after an inline name", () => {
    // Sol's ARGV-03, half one. `--name=my` bounds its own value, so `mcp` is a positional — and
    // measured, `claude --name=my mcp` really does print the mcp usage. The reader consumed it
    // anyway and called the process a session.
    expect(readFlat("claude --name=my mcp")).toEqual({ kind: "subcommand", name: "mcp" });
    expect(read(["claude", "--name=my", "mcp"])).toEqual({ kind: "subcommand", name: "mcp" });
  });

  it("does not swallow a subcommand after a separate name", () => {
    // Half two, and the same measurement: `claude --name my mcp` prints the mcp usage. One token
    // is what the CLI takes, so one token is what we take.
    expect(readFlat("claude --name my mcp")).toEqual({ kind: "subcommand", name: "mcp" });
  });

  it("does not let a trailing separator rescue a swallowed subcommand", () => {
    // Sol's third form: `claude --name my mcp -- --help` still dispatches `mcp`, so the presence
    // of a `--` says nothing about what came before it. The plan's three-endings analysis said
    // otherwise and was wrong.
    expect(readFlat("claude --name my mcp -- --help")).toEqual({ kind: "subcommand", name: "mcp" });
  });

  it("refuses an empty name, on both spellings", () => {
    expect(read(["claude", "--name", "", "--print"]).kind).toBe("unreadable");
    expect(read(["claude", "--name="]).kind).toBe("unreadable");
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
