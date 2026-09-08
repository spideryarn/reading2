/**
 * One reader for a `claude` process's command line — and a loud refusal for the ones it cannot read.
 *
 * Three functions in this repo used to parse a `claude` command line to answer three different
 * questions, and each one's rule was another one's bug: one stopped the option region at the first
 * bare word, one at a bare `--`, one never stopped at all. See
 * docs/plans/260908h-one-shared-reader-for-a-claude-command-line.md for the measurements and the
 * three disagreements. This module is the shared grammar. It is a **leaf**: no imports, not even
 * node builtins, so anything may depend on it.
 *
 * WHAT IT DOES NOT DO, and this is the design rather than an omission:
 *
 *  - **It does not model `claude`'s CLI.** That CLI is not ours; Anthropic adds flags to it without
 *    telling us. A reader that models a grammar it does not own is wrong the day the grammar moves,
 *    and wrong quietly. So this recognises the narrow set of shapes THIS REPO produces —
 *    `scripts/gjd-remote.ts`'s `new-claude` and `scripts/run-claude.ts`'s `buildClaudeArgs` — and
 *    returns `unreadable` for everything else, naming what it could not read.
 *  - **It does not decide anything.** It returns a *reading*; the caller keeps its policy. Whether
 *    two identical session ids are acceptable, whether headless forbids steering — those are facts
 *    about what the caller is about to do, not facts about `claude`. From the plan: "One shared
 *    reading that is wrong is worse than two, because it looks authoritative and nobody re-derives
 *    it."
 *
 * THE UNKNOWN-FLAG RULE IS THE POINT. An unknown flag makes the whole reading `unreadable`, because
 * we cannot know its arity, and guessing wrong is not a symmetric mistake. Guess that `--foo` takes
 * a value and it swallows the `--print` that made the run headless — a process that stopped reading
 * its terminal at startup, reported as a steerable interactive session, with prose then typed into
 * it. Guess that it takes none and its value becomes a bare word, which on a `ps`-flattened line is
 * the thing that makes everything after it unreadable. This is deliberately the OPPOSITE of the
 * general-parser fallback (`yargs-parser` skips an unknown flag and the next bare word after it).
 * That policy is right for a parser that must produce an answer; it is wrong here, where refusing
 * is a legitimate answer and a wrong grant is not.
 *
 * ══ WHERE THE OPTION REGION ENDS: AT A BARE `--`, AND NOWHERE ELSE ══
 *
 * **CLAUDE PERMUTES.** Options are read wherever they appear, until a `--`. Measured 2026-09-08
 * against `claude` 2.1.263 on this box, because the rule that used to be here was a claim about
 * somebody else's tool that nobody had ever run:
 *
 *     claude ordinary-prompt --session-id not-a-uuid --print
 *       -> Error: Invalid session ID. Must be a valid UUID.     a flag read AFTER a positional
 *     claude some-prompt-here --version
 *       -> 2.1.263 (Claude Code), exit 0                        the same
 *     claude say-only-OK --print --model definitely-not-a-real-model
 *       -> unrecognized_model, query_source:"sdk", exit 1       --print AND --model, after one
 *
 * So "the option region ends at the first bare word" — which this module and `harness.ts` both
 * asserted, and which was itself written as a bug fix — is not a rule about Claude at all. Under it
 * a later `--print` was silently never seen, and `["claude","","--print"]` read as a steerable
 * interactive session: the exact false grant the old comment claimed to prevent, reintroduced by the
 * fix for a different input. Round 2 of Stage A (GPT Sol's ARGV-01) replaced it with the rule the
 * CLI actually has.
 *
 * ══ A POSITIONAL COSTS NOTHING ON `argv` AND EVERYTHING ON `ps-flattened` ══
 *
 * This is where the fidelity tag stops being a nicety and becomes the thing that decides the case.
 * Take one process, `claude --session-id <uuid> "Please add a --print flag"`:
 *
 *  - On **faithful argv** the prompt is ONE element, so its `--print` is *inside* an argument and is
 *    not a flag. Fully decidable, and the reading is **not headless**. Scanning continues past
 *    positionals, and a dash-led token after one is a flag like any other.
 *  - On **`ps`-flattened** that same process is byte-identical to `["claude",…,"Please","add","a",
 *    "--print","flag"]`, which **is** headless. Not decidable. So once an **unconsumed positional**
 *    has appeared, any later dash-led token before a `--` is `unreadable`, naming the token.
 *
 * The same command line, two fidelities, two different **correct** answers — which is precisely what
 * a tagged input is for, and what a single `string` API could never have expressed.
 *
 * **"Unconsumed" is load-bearing.** A bare word a flag ate as its value is not a positional:
 * `--permission-mode auto --print` must stay readable, and that is the shape our own launcher emits
 * on nearly every process on the box. Only a bare word that nothing claimed arms the rule.
 *
 * A bare `--` after a positional still ends the option region, and stopping there is safe under both
 * readings of a flattened line: if the prompt really is one element, nothing after it was a flag
 * anyway; if the words really are separate arguments, the `--` is a real separator. Nothing is lost
 * by stopping either way.
 *
 * ══ A FLAG CAN BE A COMMAND ══
 *
 * `--version`/`-v` print and exit — measured, even in front of a `--session-id` value so malformed
 * that the same line with `--print` errors on it. They are in `TERMINAL_FLAGS` and read as
 * `subcommand`, because that arm already means exactly what a caller needs to know here: *a command,
 * not a session; nothing may be typed at it*. All three consumers map `subcommand` to "not a
 * harness" / "no match" today, so this needed no new arm and no change over there — and a fifth arm
 * would have bought a distinction that no caller makes. The cost is that `subcommand.name` carries a
 * flag spelling in this one case, which the arm's own doc says.
 *
 * ══ MEASURED AGAINST `claude` 2.1.263, 2026-09-08 ══
 *
 * Live box: 5 `claude` processes, all `claude --session-id <uuid> [--permission-mode auto]
 * [<prompt>]`, all reading as `session` with one id on both arms. None carries `--name`; every one
 * has a trailing-NUL run of exactly 1.
 *
 * KNOWN LIMITATION — a prompt whose first word is a subcommand name is read as a subcommand.
 * How the CLI itself resolves command-versus-prompt is not fully known here, and the measurements
 * on 2026-09-08 did not settle it: `claude mcp` and `claude --session-id <uuid> mcp` both printed
 * the mcp usage, so a preceding option does not stop a dispatch; `claude logs <bad-id>` errored
 * instantly, but the same line behind `--session-id <uuid>` or `--permission-mode auto` produced
 * nothing for twenty seconds, and I could not explain that. What decides the design is that the
 * direction is fail-closed either way: `subcommand` grants nothing, so the cost of being wrong is a
 * pane nobody can steer, never a message typed at a process that is not listening. `help` is
 * deliberately NOT in the list — `claude help me fix this` was measured to ANSWER the prompt, so it
 * is not dispatched as a command, and a prompt beginning "help" is a thing people type.
 *
 * KNOWN LIMITATION — **the two tables fail in opposite directions, and only one of them fails
 * loudly** (Sol's ARGV-07). A flag Anthropic adds tomorrow lands in `unreadable`: loud, and safe. A
 * *subcommand* Anthropic adds tomorrow is just a bare word — it reads as a positional, the line
 * reads as a `session`, and a caller may then grant prose steering on a process that is a command.
 * That asymmetry is the wrong way round, and **no hermetic test can see it**: this suite must not
 * shell out to `claude`, and the drift is a fact about an installed binary rather than about this
 * code. It is also partly irreducible — a new subcommand `foo` is indistinguishable from a prompt
 * beginning with the word "foo", which is why `help` is already excluded by hand. The honest
 * mitigation is a **maintenance check that is allowed to touch the real binary**: diff
 * `claude --help`'s `Commands:` and `Options:` sections against `SUBCOMMANDS` and `FLAGS`, run when
 * the CLI updates or in the weekly sweep, never from the unit suite. It is proposed in the plan and
 * is NOT built; until it is, this paragraph and the version stamp above are the whole defence.
 */

/**
 * A `claude` command line, tagged with how faithfully it survived the trip here.
 *
 * The tag is a type rather than a comment because naming a boundary function "lossy" does not stop
 * anyone calling it. A caller whose verdict presses Enter in a live pane can accept only the `argv`
 * arm, and the compiler will name anyone who tries to hand it the other one.
 */
export type ClaudeCommandLine = FaithfulCommandLine | FlattenedCommandLine;

/**
 * THE TWO ARMS ARE NAMED, and that is what makes the tag do anything.
 *
 * **This is GPT Sol's ARGV-05, fixed here rather than reported.** `fromProcCmdline` returned the
 * whole union and both arms were anonymous, so a caller that wanted to accept only the faithful one
 * had nothing it could ask for and nothing the compiler could refuse — the tag was a label after
 * all, which is the one thing the doc above says it must not be. Each arm is now its own exported
 * type and each constructor returns the arm it actually builds. `steer.ts`'s `isClaudeForSession`
 * takes `FaithfulCommandLine`, and handing it a `fromPsArgs` result is a compile error — checked by
 * making that error happen, not by assuming it would.
 *
 * **WHAT THAT GUARANTEE IS AND IS NOT.** These are structural types, so what they stop is the
 * *accidental* misuse — passing `fromPsArgs(...)`, or a variable that came from `ps`, to something
 * that must not have it. That is the mistake which actually happens. They do not stop a deliberate
 * `{ fidelity: "argv", argv }` written over a flattened array; only a nominal type would (a branded
 * field, or a class with a private member), and that costs every construction site a factory call
 * and every test a helper. Judged not worth it: the caller in danger here is one who has not noticed
 * the distinction, and that caller does not hand-write the tag.
 */

/** `/proc/<pid>/cmdline`, NUL-split: exactly the argv the kernel holds, quoting intact. */
export type FaithfulCommandLine = { fidelity: "argv"; argv: readonly string[] };

/** `ps args`, split on whitespace: argv joined with single spaces long before we saw it, so a
 *  quoted prompt is already several elements and there is no way back. */
export type FlattenedCommandLine = { fidelity: "ps-flattened"; argv: readonly string[] };

/** What one `claude` command line says, or why it says nothing we can use. */
export type ClaudeReading =
  /** argv[0]'s basename is not `claude`, or there is no argv[0]. */
  | { kind: "not-claude"; why: string }
  /** `claude agents`, `claude auth status --json`, **and `claude --version`** — a command, not a
   *  session, and nothing may be typed at it. `name` is the subcommand word, or the spelling of the
   *  terminal flag for the flags that print and exit; see the header. */
  | { kind: "subcommand"; name: string }
  /** A session: interactive, or headless under `--print`. `sessionIds` is EVERY `--session-id`
   *  found before the boundary, in order, so a caller can apply its own duplicate policy. */
  | { kind: "session"; headless: boolean; sessionIds: readonly string[] }
  /** We could not read it: an unknown flag, a flag missing its value, a variadic flag whose values
   *  have no terminator, or a dash-led token that a `ps` flattening left indistinguishable from
   *  prose. Grants nothing and delivers nothing — fail-closed and fail-loud. */
  | { kind: "unreadable"; why: string };

/**
 * How many values a flag takes, as `claude --help` declares it.
 *
 * `variadic` is `<things...>`: it consumes bare words until the next dash-led token. That is
 * commander's documented behaviour, not a guess — but see the `--` rule in `consumeFlag` for why we
 * still refuse it on a command line with no separator.
 *
 * **There used to be a fourth, `one-free-text`, for `--name`, and round 2 deleted it.** It existed
 * because a multi-word name on a flattened line looked like a flag of unknowable arity, and the
 * damage it did was ending the option region early. The boundary rule above removes that damage: a
 * positional ends nothing now, so `--name` can take exactly one token — which is what the CLI itself
 * takes, measured (`claude --name my mcp` and `claude --name=my mcp` both dispatch `mcp`) — and the
 * leftover words of a flattened name are simply positionals, handled by the one ambiguity rule
 * everything else already uses. The special case also had a bug the general rule cannot have:
 * consuming that run swallowed a subcommand, and the inline `--name=my` swallowed one even though it
 * had already bounded its own value (Sol's ARGV-03). One rule fewer, and one bug class fewer.
 */
type Arity = "none" | "one" | "variadic";

/**
 * The flags this repo produces, and nothing else.
 *
 * Every entry is here because a producer in this repo emits it — that is the entry criterion, and
 * it is what keeps the table honest. Adding a flag "for completeness" means guessing its arity from
 * a help page we do not control.
 *
 *  - `--session-id`, `--permission-mode`, `--name`: `scripts/gjd-remote.ts` `new-claude` (~2561).
 *  - `--print` … `--max-budget-usd`: `scripts/run-claude.ts` `buildClaudeArgs` (~305).
 *  - `--version`: `scripts/gjd-remote.ts`'s box health check (~4335).
 *
 * The short spellings (`-p`, `-n`, `-v`) are here even though the producers write the long ones,
 * because a person at a terminal types the short one and getting an alias's arity wrong is the same
 * bug as getting the flag's wrong. Their arities come from the same `claude --help` line.
 *
 * **ARITY IS NOT THE ONLY THING A ROW HAS TO GET RIGHT.** `--version` sat here with arity `none`,
 * which is correct, and the reading was still wrong — because a flag that prints and exits is not
 * part of a session at all. The entry criterion admitted the row and nothing asked what it MEANT.
 * See `TERMINAL_FLAGS`.
 *
 * DELIBERATELY ABSENT, so they land in `unreadable` rather than being guessed: every flag whose
 * value is OPTIONAL — `--cloud [description]`, `-r, --resume [value]`, `-w, --worktree [name]`,
 * `-d, --debug [filter]`, `--from-pr [value]`, `--remote-control [name]`, `--teleport [session]`,
 * `--prompt-suggestions [value]`. An optional value cannot be read from argv alone: `--resume foo`
 * is either "resume foo" or "resume, then the prompt foo", and nothing in the command line says
 * which. None of them is produced here. If one ever is, it needs a rule of its own, not a row.
 */
const FLAGS: ReadonlyMap<string, Arity> = new Map<string, Arity>([
  // gjd-remote new-claude
  ["--session-id", "one"],
  ["--permission-mode", "one"],
  // A display name somebody typed, and `new-claude` emits it shell-quoted (`--name ${shq(name)}`)
  // precisely because it may contain spaces. ONE value all the same: that is what the CLI takes, and
  // on a flattened line the extra words become positionals like any other prose.
  ["--name", "one"],
  ["-n", "one"],
  // run-claude buildClaudeArgs
  ["--print", "none"],
  ["-p", "none"],
  ["--model", "one"],
  ["--effort", "one"],
  ["--output-format", "one"],
  ["--verbose", "none"],
  ["--permission-prompts", "one"],
  // `<tools...>` in the help, even though buildClaudeArgs deliberately passes ONE comma-joined
  // value. The table records what the CLI accepts, because the CLI is what parses it.
  ["--tools", "variadic"],
  ["--restricted", "none"],
  ["--allowed-tools", "variadic"],
  ["--allowedTools", "variadic"],
  ["--strict-mcp-config", "none"],
  ["--add-dir", "variadic"],
  ["--max-budget-usd", "one"],
  // box health check
  ["--version", "none"],
  ["-v", "none"],
]);

/**
 * Flags that make the whole process a one-shot: it prints something and exits, and never becomes a
 * session at all.
 *
 * Measured on 2.1.263: `claude --version --session-id not-a-uuid` prints `2.1.263 (Claude Code)` and
 * exits 0, while `claude ordinary-prompt --session-id not-a-uuid --print` fails the UUID check. So
 * the version flag short-circuits even the validation, wherever it appears before a `--`.
 *
 * They read as `subcommand` — the header says why that arm rather than a fifth one.
 */
const TERMINAL_FLAGS: ReadonlySet<string> = new Set(["--version", "-v"]);

/**
 * The `Commands:` section of `claude --help`, aliases included, and nothing more.
 *
 * `help` is left out on purpose — see the header's KNOWN LIMITATION. Commander offers an implicit
 * `help` command, but `claude help me fix this` was measured to run as a prompt, and a prompt
 * beginning "help" is a shape a person really types.
 */
const SUBCOMMANDS: ReadonlySet<string> = new Set([
  "agents",
  "attach",
  "auth",
  "auto-mode",
  "doctor",
  "gateway",
  "import",
  "install",
  "kill",
  "logs",
  "mcp",
  "plugin",
  "plugins",
  "project",
  "respawn",
  "rm",
  "setup-token",
  "stop",
  "ultrareview",
  "update",
  "upgrade",
]);

/**
 * A `/proc/<pid>/cmdline` read, which is the faithful one.
 *
 * The kernel writes each argv element followed by a NUL, so the string ends with one and splits into
 * exactly one trailing empty. **Exactly one is dropped.** Popping the whole run would delete a real
 * final element — `claude --name ""` genuinely ends in two NULs — out of a function whose entire
 * contract is that it hands back faithful argv (Sol's ARGV-06). Interior empties are kept for the
 * same reason: an empty string is a real argv element, and deleting one shifts every element after
 * it.
 *
 * The rule before this popped the whole run, on the theory that a process which has rewritten its
 * own argv (setproctitle) leaves padding NULs. Census, 2026-09-08: 5 live `claude` processes, every
 * one with a trailing-empty run of exactly 1. And a stray trailing empty is harmless downstream now
 * — it reads as a positional, and positionals no longer end the option region.
 */
export function fromProcCmdline(raw: string): FaithfulCommandLine {
  const argv = raw.split("\0");
  if (argv.length > 0 && argv[argv.length - 1] === "") argv.pop();
  return { fidelity: "argv", argv };
}

/**
 * A `ps -o args=` blob, which is NOT faithful and cannot be made so.
 *
 * `ps` joins argv with single spaces and keeps no record of which spaces were inside an element.
 * So `claude --session-id A -- "please add a --print flag"` and
 * `claude --session-id A -- please add a --print flag` arrive here identical, and the prompt is
 * seven elements rather than one. Nothing downstream can undo that; the `ps-flattened` tag exists
 * so a caller that must not be fooled by prose can refuse this arm at compile time.
 */
export function fromPsArgs(args: string): FlattenedCommandLine {
  return { fidelity: "ps-flattened", argv: args.split(/\s+/).filter((t) => t !== "") };
}

/**
 * What one flag and its values consumed, or why they could not be read.
 *
 * `value` is the one value a `one`-arity flag took (or an inline `=` value). Nothing else needs it:
 * `--session-id` is the only flag whose value we keep, and the alternative — handing the caller a
 * bag of every flag's values — is a general-purpose parser, which is exactly what the header says
 * this must not become.
 */
type FlagScan = { ok: true; next: number; value: string | undefined } | { ok: false; why: string };

/** Where a run of bare words starting at `from` ends: the first dash-led token, or end of argv. */
function endOfBareRun(rest: readonly string[], from: number): number {
  let i = from;
  while (i < rest.length) {
    const next = rest[i];
    if (next === undefined || next.startsWith("-")) break;
    i += 1;
  }
  return i;
}

/**
 * Consume one flag and whatever belongs to it, starting at `after` (the index just past the flag
 * token itself).
 *
 * Split out of the scan so the scan reads as the rules it is — basename, separator, positional,
 * flag — rather than as one long walk. **Fidelity does not reach in here any more**: the one rule
 * that depended on it is now the positional rule in the scan itself, which is a better place for it,
 * because it is a fact about bare words rather than about any particular flag.
 */
function consumeFlag(args: {
  token: string;
  name: string;
  inline: string | undefined;
  arity: Arity;
  rest: readonly string[];
  after: number;
  hasSeparator: boolean;
}): FlagScan {
  const { token, name, inline, arity, rest, hasSeparator } = args;
  const i = args.after;

  if (arity === "none") {
    if (inline !== undefined) {
      return { ok: false, why: `\`${name}\` takes no value, but this command line spells it \`${token}\`` };
    }
    return { ok: true, next: i, value: undefined };
  }

  // THE INLINE SPELLING TAKES A DASH-LED VALUE AND THE SEPARATE ONE REFUSES IT. That looks like an
  // oversight and is not — do not "fix" it into agreement, which is what an F3 instruction to Stage C
  // asked for on 2026-09-08 before the implementer checked and refused. The two spellings carry
  // different amounts of information:
  //
  //   --session-id=-x   the value is GLUED to the flag. `-x` is the value, whatever it looks like.
  //                     Nothing is ambiguous, so nothing needs refusing.
  //   --session-id -x   the next token is either the value or the next flag, and the command line
  //                     does not say which. Undecidable, so refuse (below).
  //
  // One rule — *never guess where you cannot decide* — applied to two genuinely different inputs.
  // Making them "agree" would mean either refusing a decidable value or accepting an undecidable
  // one, and it would put this module back into disagreement with the awk probe in
  // `scripts/gjd-remote-tmux.ts`, which draws the same line for the same reason. The one thing both
  // spellings DO agree on is the empty value, because an empty id is not an id either way.
  if (inline !== undefined) {
    // `--session-id=` — the flag is there and the value is not. Refuse rather than record "".
    if (inline === "") return { ok: false, why: `\`${name}\` was given an empty value (\`${token}\`)` };
    return { ok: true, next: i, value: inline };
  }

  if (arity === "one") {
    const next = rest[i];
    // The refusing half of the asymmetry documented above: a dash-led NEXT TOKEN could be this
    // flag's value or the flag after it, and nothing in the command line decides it.
    if (next === undefined || next === "--" || next.startsWith("-")) {
      return {
        ok: false,
        why: `\`${name}\` expects a value and the next token is ${next === undefined ? "the end of the command line" : `\`${next}\``}`,
      };
    }
    // THE SAME REFUSAL AS THE INLINE FORM, and it has to be: `--session-id ""` and `--session-id=`
    // are two spellings of one mistake, and only the second was caught — so an empty string went out
    // as somebody's session id, for `steer.ts` to compare against a live pane's (Sol's ARGV-04).
    // Stage C's awk refuses the empty value too, and the two must not disagree.
    if (next === "") return { ok: false, why: `\`${name}\` was given an empty value` };
    return { ok: true, next: i + 1, value: next };
  }

  // Variadic, and `hasSeparator` exists for this rule alone. Bounded only by the next dash-led
  // token, so on a command line with no `--` its values and the prompt are the same run of words.
  // Refuse rather than eat prose.
  if (!hasSeparator) {
    return {
      ok: false,
      why:
        `\`${name}\` takes an unbounded list of values and this command line has no \`--\`` +
        ` separator, so where its values end and the prompt begins cannot be read`,
    };
  }
  const end = endOfBareRun(rest, i);
  if (end === i) return { ok: false, why: `\`${name}\` expects at least one value and got none` };
  return { ok: true, next: end, value: undefined };
}

/**
 * Is argv[0] a `claude` at all? The refusal if not, and `undefined` if it is.
 *
 * Basename, and EXACTLY `claude`. Not a substring test and not a prefix: `claude-wrapper` and
 * `grep --session-id <uuid> logs/` are both things this repo has on its box, and the substring
 * version of this check was the defect that made a `grep` look like a Claude.
 */
function refuseNonClaude(argv0: string | undefined): ClaudeReading | undefined {
  if (argv0 === undefined) return { kind: "not-claude", why: "an empty command line" };
  const base = argv0.split("/").pop() ?? "";
  if (base === "claude") return undefined;
  return {
    kind: "not-claude",
    why: `argv[0] is \`${argv0}\`, whose basename \`${base}\` is not \`claude\``,
  };
}

/**
 * What one dash-led token turned out to be.
 *
 * The scan below is four rules — separator, positional, flag, and the fidelity-dependent refusal —
 * and this is the third and fourth extracted so the loop stays readable as those four.
 */
type FlagStep =
  | { step: "refuse"; why: string }
  /** A flag that prints and exits: the whole process is a command. */
  | { step: "command"; name: string }
  | { step: "flag"; next: number; headless: boolean; sessionId: string | undefined };

/**
 * Read one dash-led token and whatever belongs to it.
 *
 * `sawPositional` and `fidelity` are here for one rule, the one the module header calls the point of
 * the fidelity tag: on a `ps`-flattened line, a dash-led token after an unclaimed bare word cannot be
 * told from a word of the prompt.
 */
function readFlagToken(args: {
  token: string;
  rest: readonly string[];
  at: number;
  hasSeparator: boolean;
  sawPositional: boolean;
  fidelity: ClaudeCommandLine["fidelity"];
}): FlagStep {
  const { token, rest, at, hasSeparator, sawPositional, fidelity } = args;

  if (sawPositional && fidelity === "ps-flattened") {
    return {
      step: "refuse",
      why:
        `\`${token}\` follows a bare word on a command line read from \`ps\` (which has already` +
        ` lost the quoting), so whether it is a flag or a word of the prompt cannot be read`,
    };
  }

  // `--name=value` and `--name value` are both real spellings and the CLI takes either.
  const eq = token.indexOf("=");
  const name = eq === -1 ? token : token.slice(0, eq);
  const inline = eq === -1 ? undefined : token.slice(eq + 1);

  const arity = FLAGS.get(name);
  if (arity === undefined) {
    return {
      step: "refuse",
      why:
        `\`${name}\` is not one of the flags this repo produces, so how many values it takes is` +
        ` unknown, and guessing wrong would either swallow the flag after it or leave its own` +
        ` value looking like one`,
    };
  }

  const scanned = consumeFlag({ token, name, inline, arity, rest, after: at + 1, hasSeparator });
  if (!scanned.ok) return { step: "refuse", why: scanned.why };

  // Checked AFTER the arity rules, so `--version=x` is still a refusal rather than a command.
  if (TERMINAL_FLAGS.has(name)) return { step: "command", name };

  return {
    step: "flag",
    next: scanned.next,
    headless: name === "--print" || name === "-p",
    // Only from the option region, and only as an exact token. A `--session-id` after the separator
    // is prose that says `--session-id`, which is not the same thing at all.
    //
    // NO TEST HOLDS THE EXACTNESS OF *THIS* COMPARISON, and the mutation run says so: changing it to
    // `startsWith` survives, because nothing else in `FLAGS` begins with `--session-id`, so the
    // lookup above has already refused `--session-idle` before this line runs. It is an equivalent
    // mutant under today's table and stops being one the day a row like `--session-id-file` is
    // added. The exactness that IS held by a test is the `FLAGS.get(name)` lookup — mutate that to a
    // prefix search and two tests go red. The line stays exact because it states the rule where the
    // rule is read.
    sessionId: name === "--session-id" ? scanned.value : undefined,
  };
}

/** Read a command line. See the module header; the rules live there. */
export function readClaudeCommandLine(line: ClaudeCommandLine): ClaudeReading {
  const argv = line.argv;
  const refusal = refuseNonClaude(argv[0]);
  if (refusal !== undefined) return refusal;

  const rest = argv.slice(1);
  // Is there an explicit end-of-options separator anywhere ahead? Consulted for VARIADIC flags and
  // nothing else: without one, "consume bare words until the next dash-led token" runs straight into
  // the prompt. With one, the values are bounded by the separator and there is nothing to guess.
  // `rest.includes` is enough because anything before the scan position was already consumed as a
  // flag or as a value.
  const hasSeparator = rest.includes("--");

  const sessionIds: string[] = [];
  let headless = false;
  // Has a bare word appeared that no flag claimed? On the faithful arm that is only the prompt or a
  // command word, and it changes nothing. On the flattened arm it is the moment we stop being able
  // to tell a flag from a word of prose — see the header.
  let sawPositional = false;

  let i = 0;
  while (i < rest.length) {
    const token = rest[i];
    if (token === undefined) break;

    // End of options, by the CLI's own rule: everything after is positional.
    if (token === "--") break;

    if (!token.startsWith("-")) {
      // A positional. The FIRST one is the command word if it is one — and only the first, so that a
      // prompt using the word "import" three sentences in is still a prompt.
      if (!sawPositional && SUBCOMMANDS.has(token)) return { kind: "subcommand", name: token };
      sawPositional = true;
      i += 1;
      continue;
    }

    const step = readFlagToken({
      token,
      rest,
      at: i,
      hasSeparator,
      sawPositional,
      fidelity: line.fidelity,
    });
    if (step.step === "refuse") return { kind: "unreadable", why: step.why };
    if (step.step === "command") return { kind: "subcommand", name: step.name };
    i = step.next;
    if (step.headless) headless = true;
    if (step.sessionId !== undefined) sessionIds.push(step.sessionId);
  }

  return { kind: "session", headless, sessionIds };
}
