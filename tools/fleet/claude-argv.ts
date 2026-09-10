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
 *    has appeared, any later dash-led token is `unreadable`, naming the token.
 *
 * The same command line, two fidelities, two different **correct** answers — which is precisely what
 * a tagged input is for, and what a single `string` API could never have expressed.
 *
 * **"Unconsumed" is load-bearing.** A bare word a flag ate as its value is not a positional:
 * `--permission-mode auto --print` must stay readable, and that is the shape our own launcher emits
 * on nearly every process on the box. Only a bare word that nothing claimed arms the rule.
 *
 * **AND THE SEPARATOR IS A DASH-LED TOKEN LIKE ANY OTHER.** This used to exempt a bare `--`, on the
 * argument that stopping there was safe under both readings — *if the prompt really is one element,
 * nothing after it was a flag anyway; if the words really are separate arguments, the `--` is a real
 * separator*. The first half is false, and GPT Sol's ARGV-P1-01 (round 2 of Stage B) is the
 * counter-example: a prompt being one element does not make it the LAST element. Measured —
 *
 *     ["claude","--session-id",A,"Please explain -- carefully","--print"]
 *       faithful  -> session, headless=TRUE      the CLI really does parse that --print
 *       flattened -> session, headless=FALSE     WRONG, and it grants prose steering
 *
 * — because the scan stopped at the `--` inside the prompt and never reached the flag after it. `--`
 * is a word people type in prose. So the rule is ONE condition, not two: on a flattened line, once
 * an unconsumed positional has appeared, **every** dash-led token — the separator included — is
 * `unreadable`. Before a positional a `--` is still a real separator, which is where both of this
 * repo's launchers put it (`gjd-remote.ts`'s `new-claude`, `run-claude.ts`'s `buildClaudeArgs`), so
 * the refusal costs nothing on real traffic: 6 live `claude` processes on 2026-09-08, none of them
 * changed by it.
 *
 * **The narrower rule, named and not taken.** The two readings of an ambiguous `--` differ only when
 * a dash-led token follows it — with nothing dash-led after, everything remaining is a positional
 * under both readings and the answer is the same either way. So "refuse only when something dash-led
 * follows" would be exactly the disagreement, and it would keep
 * `--name my session -- go and do the thing` readable. Not taken: it is a second condition and a
 * lookahead, buying back one shape that no producer here can emit (a session name cannot contain a
 * space — see `--name` in the table below), and this rule already refuses more than it strictly must
 * on the dash-led case for the same reason. One condition over every dash-led token is the rule that
 * can be read off the code.
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
 * ══ `--resume <uuid>`: THE ONE OPTIONAL-VALUE SHAPE, AND WHY IT IS DECIDABLE ══
 *
 * `-r, --resume [value]` takes an OPTIONAL value, and this header used to say that no such flag could
 * be read: `--resume foo` might be "resume foo" or "resume, then the prompt foo". A resumed session is
 * what forced the question. `claude` refuses `--resume` together with `--session-id` (unless
 * `--fork-session`, which mints an id nothing could match), so a resumed process names its
 * conversation ONLY after `--resume`, and a reader that refused it left every resumed session
 * `claimed-only` for ever. Plan 260910f's spike answered it for the CLI, against `claude` 2.1.267 on
 * 2026-09-10:
 *
 *     claude -p --resume <uuid> "Reply…"
 *       -> resumed <uuid>, appended to <uuid>.jsonl, and took "Reply…" as the prompt
 *
 * — so the token right after `--resume` is its value, and the next word is not. What stays
 * undecidable is what the CLI DOES with a value that is not an id: its help calls the value "a session
 * ID, or … optional search term" for the interactive picker, so `--resume foo` opens a picker on no
 * conversation anybody can name. A lowercase uuid is an id; nothing else is. So the rule is exactly
 * one shape, on faithful argv only, in `readResume`:
 *
 *  - `--resume` followed by a lowercase uuid AS THE NEXT ELEMENT names that conversation, and it is
 *    reported in `sessionIds`, because it states the same fact `--session-id` does — which
 *    conversation this process writes. A real resumed process, captured 2026-09-10 in the shape
 *    `gjd-remote --resume-conversation` emits (tests/fixtures/claude-argv/):
 *    `claude --resume <uuid> --permission-mode auto --model haiku -- <prompt>`.
 *  - A bare `--resume` — at the end of the line, or before a dash-led token, `--` included — is the
 *    picker, and `unreadable`. A non-uuid value, uppercase included, is `unreadable`. `--resume=<uuid>`
 *    and `-r` are `unreadable`, because nothing here produces them (the table's entry criterion).
 *  - **`--resume` beside `--session-id` is `unreadable`**, in either order, equal ids included (GPT
 *    Sol's G22, 2026-09-10). The CLI refuses the pair outright — measured: "Error: --session-id can
 *    only be used with --continue or --resume if --fork-session is also specified" — so the process
 *    enters no conversation at all. That is a fact about `claude`, not a caller's duplicate policy,
 *    which is why the reader decides it: reported as `[A, A]`, `steer.ts`'s set of distinct ids
 *    collapsed it to one and answered "yes" for a process that never started a conversation.
 *
 * **ON A `ps`-FLATTENED LINE, `--resume` IN ANY FORM IS `unreadable`** — exactly as it was before
 * Stage 3a (GPT Sol's G21, 2026-09-10). Flattening erases argument boundaries, and for this flag the
 * boundary is the whole question: `--resume "<uuid> --permission-mode auto -- Reply…"`, ONE picker
 * search term, prints byte-for-byte the same `ps` line as the real capture above, which is five
 * elements. No rule over the flattened text can tell them apart — not "a dash-led token follows the
 * id", which is what this arm used to require, because a dash-led token can be the inside of a
 * search term. Other one-value flags accept that residual (a value with a space in it) because a
 * malformed `--session-id` makes the CLI refuse to start, while a malformed `--resume` value is a live
 * picker on a conversation nobody named.
 *
 * The cost: `tools/overseer/harness.ts` reads every claude off `ps`, so a resumed pane's execution
 * identity is `claimed-only`, never a verified conversation. **Verifying a resumed pane needs a
 * faithful `/proc/<pid>/cmdline` read of the harness process**, bracketed like the start-time read in
 * `execution-identity.ts` — a named follow-up for plan 260910f's Stage 3b, not built here. The one
 * caller that presses Enter, `steer.ts`'s `isClaudeForSession`, takes faithful argv only, so the
 * faithful arm above is its whole reading.
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
  /** A session: interactive, or headless under `--print`. `sessionIds` is EVERY conversation id
   *  named before the boundary, in order — each `--session-id` value, or the `--resume <uuid>` of a
   *  faithful argv (never both: see the header) — so a caller can apply its own duplicate policy. */
  | { kind: "session"; headless: boolean; sessionIds: readonly string[] }
  /** We could not read it: an unknown flag, a flag missing its value, a variadic flag whose values
   *  have no terminator, a dash-led token that a `ps` flattening left indistinguishable from
   *  prose, any `--resume` off `ps`, or `--resume` beside `--session-id`, which the CLI refuses.
   *  Grants nothing and delivers nothing — fail-closed and fail-loud. */
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
 * value is OPTIONAL — `--cloud [description]`, `-r` (the short `--resume`), `-w, --worktree [name]`,
 * `-d, --debug [filter]`, `--from-pr [value]`, `--remote-control [name]`, `--teleport [session]`,
 * `--prompt-suggestions [value]`. An optional value cannot be read from a row: whether the next word
 * is the value, and what the CLI does with it, is a fact about each flag that nothing here has
 * measured. None of these is produced here. **`--resume` is the one that is**, and it got what this
 * paragraph always said it would need — a rule of its own, not a row: `readResume`, and the header.
 */
const FLAGS: ReadonlyMap<string, Arity> = new Map<string, Arity>([
  // gjd-remote new-claude
  ["--session-id", "one"],
  ["--permission-mode", "one"],
  // A display name somebody typed. `new-claude` emits it shell-quoted (`--name ${shq(name)}`), and
  // that is defence in depth on the way to a shell rather than evidence that it holds spaces — a
  // name CANNOT hold one: `gjd-remote.ts:2462` and `tools/fleet/routes-new.ts:376` both refuse
  // anything but `^[a-z0-9][a-z0-9-]{0,40}$`. (This comment used to read the quoting as the proof of
  // the opposite.) ONE value either way: that is what the CLI takes, and on a flattened line any
  // extra words are positionals like any other prose.
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
 * The scan below is four rules — the fidelity-dependent refusal, separator, positional, flag — and
 * this is the last of them extracted so the loop stays readable as those four.
 */
type FlagStep =
  | { step: "refuse"; why: string }
  /** A flag that prints and exits: the whole process is a command. */
  | { step: "command"; name: string }
  /** `selector` is the conversation this flag names, and WHICH flag named it — kept because the two
   *  selectors together are a refusal whatever their values (the header's G22). */
  | { step: "flag"; next: number; headless: boolean; selector: Selector | undefined };

/** A conversation id, and which of the two flags that can name one named it. */
type Selector = { flag: "--session-id" | "--resume"; id: string };

/**
 * A conversation id as `claude` mints them: a lowercase uuid, and nothing looser. Uppercase is
 * refused rather than folded: nothing here has measured whether the CLI would resume the same
 * conversation from it, and refusing costs a grey row, never a message in the wrong pane.
 */
const CONVERSATION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `--resume <uuid>`: the one optional-value flag with a rule of its own. The header says why a uuid
 * right after it is decidable and every other shape of `--resume` is not.
 *
 * **FIDELITY REACHES IN HERE, and only here among the flags.** On faithful argv the element after
 * `--resume` is exactly its value. On a `ps`-flattened line nothing says where the value ends, so
 * every `--resume` there is refused, first and whatever follows it (G21).
 */
function readResume(args: {
  token: string;
  inline: string | undefined;
  rest: readonly string[];
  at: number;
  fidelity: ClaudeCommandLine["fidelity"];
}): FlagStep {
  const { token, inline, rest, at, fidelity } = args;
  if (fidelity === "ps-flattened") {
    return {
      step: "refuse",
      why:
        `\`${token}\` on a command line read from \`ps\`, which has erased the argument boundaries: a` +
        ` resume id followed by more words prints exactly like one picker search term that begins` +
        ` with that id, so which conversation it opens cannot be read`,
    };
  }
  if (inline !== undefined) {
    return {
      step: "refuse",
      why: `\`${token}\` is not a shape this repo produces: only \`--resume <uuid>\`, as two elements, is read`,
    };
  }
  const value = rest[at + 1];
  if (value === undefined || value.startsWith("-")) {
    return {
      step: "refuse",
      why:
        `a bare \`--resume\` (followed by ${value === undefined ? "the end of the command line" : `\`${value}\``})` +
        ` opens the interactive picker, so it names no conversation`,
    };
  }
  if (!CONVERSATION_ID.test(value)) {
    return {
      step: "refuse",
      why:
        `\`--resume\` is followed by \`${value}\`, which is not a conversation id; the CLI takes anything` +
        ` else as a picker search term, so which conversation it opens cannot be read`,
    };
  }
  return { step: "flag", next: at + 2, headless: false, selector: { flag: "--resume", id: value } };
}

/**
 * Read one dash-led token and whatever belongs to it.
 *
 * **THE FLATTENED-AMBIGUITY RULE IS NOT HERE**, and moving it out was ARGV-P1-01's fix. It used to
 * be the first thing this function did, which meant it could only ever see the tokens that reached
 * it — and a bare `--` never did, because the scan broke on the separator before calling this. So
 * the one token that most needed the rule was the one exempt from it. It now lives in the scan, over
 * every dash-led token, which is also one condition instead of two.
 *
 * `fidelity` is passed through for `--resume` alone — see `readResume`.
 */
function readFlagToken(args: {
  token: string;
  rest: readonly string[];
  at: number;
  hasSeparator: boolean;
  fidelity: ClaudeCommandLine["fidelity"];
}): FlagStep {
  const { token, rest, at, hasSeparator, fidelity } = args;

  // `--name=value` and `--name value` are both real spellings and the CLI takes either.
  const eq = token.indexOf("=");
  const name = eq === -1 ? token : token.slice(0, eq);
  const inline = eq === -1 ? undefined : token.slice(eq + 1);

  // Before the table, because `--resume` is deliberately not in it: its rule is not an arity.
  if (name === "--resume") return readResume({ token, inline, rest, at, fidelity });

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
    selector:
      name === "--session-id" && scanned.value !== undefined
        ? { flag: "--session-id", id: scanned.value }
        : undefined,
  };
}

/**
 * Record the conversation one flag named — or, when the second KIND of selector flag arrives, the
 * refusal (the header's G22). Either order, and whatever the two ids are: equal ids are the dangerous
 * case, because a caller's set of distinct ids would collapse `[A, A]` to one conversation that the
 * CLI never started.
 */
function recordSelector(
  selector: Selector | undefined,
  flags: Set<Selector["flag"]>,
  ids: string[],
): ClaudeReading | undefined {
  if (selector === undefined) return undefined;
  flags.add(selector.flag);
  if (flags.size > 1) {
    return {
      kind: "unreadable",
      why:
        "`--resume` and `--session-id` are both given, which `claude` refuses without" +
        " `--fork-session`, so this process enters no conversation that can be named",
    };
  }
  ids.push(selector.id);
  return undefined;
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
  // Which selector flags have named a conversation. Both together is a line the CLI refuses (G22).
  const selectorFlags = new Set<Selector["flag"]>();
  let headless = false;
  // Has a bare word appeared that no flag claimed? On the faithful arm that is only the prompt or a
  // command word, and it changes nothing. On the flattened arm it is the moment we stop being able
  // to tell a flag from a word of prose — see the header.
  let sawPositional = false;

  let i = 0;
  while (i < rest.length) {
    const token = rest[i];
    if (token === undefined) break;

    // ONE RULE, OVER EVERY DASH-LED TOKEN INCLUDING THE SEPARATOR, and it runs before the separator
    // is honoured because `--` is the token it was missing. On a `ps`-flattened line, once a bare
    // word nothing claimed has appeared, this token is either an option or a word of the prompt and
    // the command line no longer says which. See the module header for the measured grant.
    if (token.startsWith("-") && sawPositional && line.fidelity === "ps-flattened") {
      return {
        kind: "unreadable",
        why:
          `\`${token}\` follows a bare word on a command line read from \`ps\` (which has already` +
          ` lost the quoting), so whether it belongs to the option region or is a word of the` +
          ` prompt cannot be read`,
      };
    }

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

    const step = readFlagToken({ token, rest, at: i, hasSeparator, fidelity: line.fidelity });
    if (step.step === "refuse") return { kind: "unreadable", why: step.why };
    if (step.step === "command") return { kind: "subcommand", name: step.name };
    i = step.next;
    if (step.headless) headless = true;
    const refused = recordSelector(step.selector, selectorFlags, sessionIds);
    if (refused !== undefined) return refused;
  }

  return { kind: "session", headless, sessionIds };
}
