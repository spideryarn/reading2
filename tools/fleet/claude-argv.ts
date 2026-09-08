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
 * we cannot know its arity, and guessing wrong is not a symmetric mistake: guess that `--foo` takes
 * no value and its value becomes the "first bare word", ending the option region early, so a later
 * `--print` is never seen and a headless run is reported as a steerable interactive session —
 * prose typed into a terminal that will never read it. This is deliberately the OPPOSITE of the
 * general-parser fallback (`yargs-parser` skips an unknown flag and the next bare word after it).
 * That policy is right for a parser that must produce an answer; it is wrong here, where refusing
 * is a legitimate answer and a wrong grant is not.
 *
 * WHERE THE OPTION REGION ENDS: at a bare `--`, or at the first bare word, whichever comes first.
 * These looked like two competing rules and are one. On faithful argv the prompt is a single
 * element, so with no `--` the prompt IS the first bare word and the rules coincide; with a `--` it
 * comes first, which is what the CLI itself does.
 *
 * ONE RULE IS FIDELITY-DEPENDENT, and it is written down here rather than left to be discovered,
 * because the trap in this area is a rule that is true on one arm and quietly assumed on the other.
 * **`--name` takes exactly one value on a faithful argv and an unknowable number on a `ps`-flattened
 * one**: its value is text a person chose, `new-claude` emits it shell-quoted for that very reason,
 * and flattening turns the spaces inside it into the spaces between arguments. Everything else in
 * the table has the same arity on both arms. See `Arity`'s `one-free-text` and the three endings in
 * `consumeFlag`.
 *
 * MEASURED 2026-09-08 against `claude --help` (2.1.263) and against the live box: six `claude`
 * processes, all of them `claude --session-id <uuid> [--permission-mode auto] [-- <prompt>]`, all
 * read as `session` with one id.
 *
 * KNOWN LIMITATION: a prompt whose first word is a subcommand name is read as a subcommand.
 * How the CLI itself resolves command-versus-prompt is not fully known here, and the measurements
 * on 2026-09-08 did not settle it: `claude mcp` and `claude --session-id <uuid> mcp` both printed
 * the mcp usage, so a preceding option does not stop a dispatch; `claude logs <bad-id>` errored
 * instantly, but the same line behind `--session-id <uuid>` or `--permission-mode auto` produced
 * nothing for twenty seconds, and I could not explain that. What decides the design is that the
 * direction is fail-closed either way: `subcommand` grants nothing, so the cost of being wrong is a
 * pane nobody can steer, never a message typed at a process that is not listening. `help` is
 * deliberately NOT in the list — `claude help me fix this` was measured to ANSWER the prompt, so it
 * is not dispatched as a command, and a prompt beginning "help" is a thing people type.
 */

/**
 * A `claude` command line, tagged with how faithfully it survived the trip here.
 *
 * The tag is a type rather than a comment because naming a boundary function "lossy" does not stop
 * anyone calling it. A caller whose verdict presses Enter in a live pane can accept only the `argv`
 * arm, and the compiler will name anyone who tries to hand it the other one.
 */
export type ClaudeCommandLine =
  /** `/proc/<pid>/cmdline`, NUL-split: exactly the argv the kernel holds, quoting intact. */
  | { fidelity: "argv"; argv: readonly string[] }
  /** `ps args`, split on whitespace: argv joined with single spaces long before we saw it, so a
   *  quoted prompt is already several elements and there is no way back. */
  | { fidelity: "ps-flattened"; argv: readonly string[] };

/** What one `claude` command line says, or why it says nothing we can use. */
export type ClaudeReading =
  /** argv[0]'s basename is not `claude`, or there is no argv[0]. */
  | { kind: "not-claude"; why: string }
  /** `claude agents`, `claude auth status --json` — a command, not a session, and nothing may be
   *  typed at it. */
  | { kind: "subcommand"; name: string }
  /** A session: interactive, or headless under `--print`. `sessionIds` is EVERY `--session-id`
   *  found before the boundary, in order, so a caller can apply its own duplicate policy. */
  | { kind: "session"; headless: boolean; sessionIds: readonly string[] }
  /** We could not read it: an unknown flag, a flag missing its value, a variadic flag whose values
   *  have no terminator. Grants nothing and delivers nothing — fail-closed and fail-loud. */
  | { kind: "unreadable"; why: string };

/**
 * How many values a flag takes, as `claude --help` declares it — plus the one distinction the help
 * page cannot make.
 *
 * `variadic` is `<things...>`: it consumes bare words until the next dash-led token. That is
 * commander's documented behaviour, not a guess — but see the `--` rule in `consumeFlag` for why we
 * still refuse it on a command line with no separator.
 *
 * `one-free-text` IS `one` in the CLI, and is one element in a faithful argv. **It is not one token
 * on the `ps-flattened` arm**, because its value is text a person chose and may contain spaces, and
 * `ps` has already turned every space into the same thing. `--name my session --print` flattens to
 * five tokens; reading it as one-value takes `my`, calls `session` the first bare word, ends the
 * option region there and NEVER SEES `--print` — a headless run reported as a steerable interactive
 * session, which is the false grant this module exists to prevent. So the arity of this kind of
 * flag genuinely depends on the fidelity of the input, which is the whole reason the input carries
 * its fidelity as a type. The rule and what it costs are in `consumeFlag`.
 */
type Arity = "none" | "one" | "one-free-text" | "variadic";

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
  // The ONLY free-text value in this table: a display name somebody typed, and `new-claude` emits
  // it shell-quoted (`--name ${shq(name)}`) precisely because it may contain spaces. Every other
  // one-value flag here takes a uuid, a number, or a word from a fixed set.
  ["--name", "one-free-text"],
  ["-n", "one-free-text"],
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
 * The kernel writes each argv element followed by a NUL, so the string ends with one and usually
 * splits into a trailing empty. Trailing empties are dropped; INTERIOR ones are kept, because an
 * empty string is a real argv element — `claude --name "" …` is a command line somebody can
 * produce, and silently deleting it would shift every element after it.
 */
export function fromProcCmdline(raw: string): ClaudeCommandLine {
  const argv = raw.split("\0");
  while (argv.length > 0 && argv[argv.length - 1] === "") argv.pop();
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
export function fromPsArgs(args: string): ClaudeCommandLine {
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
 * A free-text value on a line `ps` has already flattened.
 *
 * Its words and the words after it are the same kind of token, so where the value ends is a
 * question about its CONTENT — which is exactly what flattening threw away. See the `Arity` doc for
 * what reading it as a single token does instead.
 *
 * TWO ENDINGS ARE SAFE AND ONE IS NOT:
 *  - the run of bare words reaches the END of the command line: nothing follows, so nothing can be
 *    misread as a flag. `claude --session-id <uuid> --permission-mode auto --name my session` is a
 *    shape `new-claude` produces — a named session with no prompt — and it stays readable.
 *  - the run stops at a dash-led token and there IS a `--` ahead: the launcher bounded the prompt
 *    itself, so scanning on cannot walk into prose.
 *  - the run stops at a dash-led token with NO `--` ahead: that is the boundary between a name and
 *    free prose, and which side the token is on cannot be read. Refuse. It costs a refusal on a
 *    `ps` read of `--name my session --print`, and it buys never reading `--session-id <somebody
 *    else's uuid>` out of the sentence that follows a name.
 */
function consumeFlattenedFreeText(args: {
  name: string;
  inline: string | undefined;
  rest: readonly string[];
  after: number;
  hasSeparator: boolean;
}): FlagScan {
  const { name, inline, rest, after, hasSeparator } = args;
  const end = endOfBareRun(rest, after);
  const taken = (inline === undefined ? 0 : 1) + (end - after);
  if (taken === 0) {
    return {
      ok: false,
      why: `\`${name}\` expects a value and the next token is a flag or the end of the command line`,
    };
  }
  if (end < rest.length && !hasSeparator) {
    return {
      ok: false,
      why:
        `\`${name}\` takes free text that may contain spaces, this command line was read from` +
        ` \`ps\` (which has already lost the quoting), and there is no \`--\` separator — so` +
        ` whether \`${rest[end]}\` is a flag or part of the name cannot be read`,
    };
  }
  // The value is not returned: it may be several tokens here, and nothing needs it. Only
  // `--session-id` has its value read, and that one is a uuid.
  return { ok: true, next: end, value: undefined };
}

/**
 * Consume one flag and whatever belongs to it, starting at `after` (the index just past the flag
 * token itself).
 *
 * Split out of the scan so the scan reads as the four rules it is — basename, boundary, subcommand,
 * flag — rather than as one long walk.
 */
function consumeFlag(args: {
  token: string;
  name: string;
  inline: string | undefined;
  arity: Arity;
  rest: readonly string[];
  after: number;
  hasSeparator: boolean;
  fidelity: ClaudeCommandLine["fidelity"];
}): FlagScan {
  const { token, name, inline, arity, rest, hasSeparator, fidelity } = args;
  const i = args.after;

  if (arity === "none") {
    if (inline !== undefined) {
      return { ok: false, why: `\`${name}\` takes no value, but this command line spells it \`${token}\`` };
    }
    return { ok: true, next: i, value: undefined };
  }

  if (arity === "one-free-text" && fidelity === "ps-flattened" && inline !== "") {
    return consumeFlattenedFreeText({ name, inline, rest, after: i, hasSeparator });
  }

  if (inline !== undefined) {
    // `--session-id=` — the flag is there and the value is not. Refuse rather than record "".
    if (inline === "") return { ok: false, why: `\`${name}\` was given an empty value (\`${token}\`)` };
    return { ok: true, next: i, value: inline };
  }

  // `one-free-text` reaches here only on the faithful arm, where the value is one element and the
  // distinction does not apply.
  if (arity === "one" || arity === "one-free-text") {
    const next = rest[i];
    if (next === undefined || next === "--" || next.startsWith("-")) {
      return {
        ok: false,
        why: `\`${name}\` expects a value and the next token is ${next === undefined ? "the end of the command line" : `\`${next}\``}`,
      };
    }
    return { ok: true, next: i + 1, value: next };
  }

  // Variadic. Bounded only by the next dash-led token, so on a command line with no `--` its values
  // and the prompt are the same run of words. Refuse rather than eat prose.
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

/** Read a command line. See the module header; the rules live there. */
export function readClaudeCommandLine(line: ClaudeCommandLine): ClaudeReading {
  const argv = line.argv;
  const refusal = refuseNonClaude(argv[0]);
  if (refusal !== undefined) return refusal;

  const rest = argv.slice(1);
  // Is there an explicit end-of-options separator anywhere ahead? Only consulted for variadic
  // flags: without one, "consume bare words until the next dash-led token" runs straight into the
  // prompt, and on a `ps`-flattened line a prompt that says `--session-id <other uuid>` would then
  // be read as an option. With one, the values are bounded by the separator and there is nothing
  // to guess. `rest.includes` is enough because anything before the scan position was already
  // consumed as a flag or a value.
  const hasSeparator = rest.includes("--");

  const sessionIds: string[] = [];
  let headless = false;

  let i = 0;
  while (i < rest.length) {
    const token = rest[i];
    if (token === undefined) break;

    // End of options, by the CLI's own rule: everything after is positional.
    if (token === "--") break;

    if (!token.startsWith("-")) {
      // The first bare word. Either the command, or the prompt — and after it nothing is read as a
      // flag, which is what stops a prompt that MENTIONS `--print` from being read as headless.
      if (SUBCOMMANDS.has(token)) return { kind: "subcommand", name: token };
      break;
    }

    // `--name=value` and `--name value` are both real spellings and the CLI takes either.
    const eq = token.indexOf("=");
    const name = eq === -1 ? token : token.slice(0, eq);
    const inline = eq === -1 ? undefined : token.slice(eq + 1);

    const arity = FLAGS.get(name);
    if (arity === undefined) {
      return {
        kind: "unreadable",
        why:
          `\`${name}\` is not one of the flags this repo produces, so how many values it takes is` +
          ` unknown, and guessing wrong would move where the option region ends`,
      };
    }

    const scanned = consumeFlag({
      token,
      name,
      inline,
      arity,
      rest,
      after: i + 1,
      hasSeparator,
      fidelity: line.fidelity,
    });
    if (!scanned.ok) return { kind: "unreadable", why: scanned.why };
    i = scanned.next;
    const value = scanned.value;

    if (name === "--print" || name === "-p") headless = true;
    // Only from the option region, and only as an exact token. A `--session-id` after the boundary
    // is prose that says `--session-id`, which is not the same thing at all.
    if (name === "--session-id" && value !== undefined) sessionIds.push(value);
  }

  return { kind: "session", headless, sessionIds };
}
