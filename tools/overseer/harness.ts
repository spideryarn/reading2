/**
 * WHICH HARNESS IS HOLDING THIS PANE, and what may honestly be done to it?
 *
 * ## The principle, written down before this file existed
 *
 * `docs/project/orchestrator-direction.md`: *"One adapter per harness, and
 * honest about what each can do. Claude, Codex and bare shells have genuinely
 * different capabilities; flattening them into one 'message an agent' verb
 * produces a UI that lies."* A session's harness was an assumption everywhere
 * it mattered and a field nowhere. This is the field.
 *
 * ## The harness is not the work, and both are true at once
 *
 * `work.ts` answers *what is this tree DOING* — a paid `codex exec`, a
 * 24-minute suite. This answers *what is HOLDING the terminal*. A `shell` pane
 * running vitest is both, and neither sentence is a better version of the
 * other. The two walk the same process table and share its failure vocabulary
 * (`TreeReadFailure`) for exactly that reason.
 *
 * **A CLAUDE SESSION RUNNING A SOL REVIEW IS ONE SESSION, NOT TWO.** That is
 * the rule the walk below is shaped around: the harness is the SHALLOWEST
 * harness-shaped process under the pane, because the thing nearest the tty is
 * the thing holding it. On this box a dispatched `codex exec` sits at depth 8
 * under a `claude` at depth 1 (measured; see the fixtures' README), so a walk
 * that took the first match it stumbled into, or the deepest, would delete a
 * Claude session from the fleet for the 45 minutes it spent reviewing.
 *
 * ## What this box actually runs — measured twice, and the two disagree
 *
 * **11:58 UTC, 2026-09-08 — 22 panes, 942 rows:** 15 `claude-code`, 7 `shell`,
 * and **no Codex pane of any kind**. Three `codex exec` processes were running
 * and none of them was a pane: one was a Claude session's child at depth 7, and
 * **two were orphans** whose `npm exec` had `ppid 1`, because the Bash-tool
 * shell that launched them had been reaped — two paid `gpt-5.6-sol --effort
 * high` reviews running attributable to no session at all.
 *
 * **12:15 UTC, seventeen minutes later — 26 panes:** 17 `claude-code`, 6
 * `shell`, **one `codex-batch`** (a `tmux-job.ts` running `run-codex.ts`
 * directly) and **two `codex-interactive`** (a bare `codex` TUI under a
 * `bash -l`, twice). All three verified against their raw command lines and
 * captured as fixtures.
 *
 * Nothing was wrong with the first reading. **"There are none" is a reading,
 * not a property** — the same warning `work.ts` gives about a single
 * `WorkReading`, one level up. Anything built on top of this must not treat a
 * kind that is absent today as a kind that cannot occur; the first draft of
 * this file nearly shipped a comment saying an interactive Codex had never
 * existed here, seventeen minutes before two of them did.
 *
 * The orphan finding is a hole in `work.ts` — which only ever walks DOWN from a
 * pane, so a reparented job is invisible to it — rather than in this file. It
 * is written up in the Stage C section of
 * `docs/plans/260908f-…-codex-adapter.md`. Not fixed here.
 *
 * `claude-headless` is the one arm still carried on a capture rather than a
 * live pane. It is kept anyway: without it a `claude --print` pane classifies
 * as `claude-code` and the page offers to type at something that stopped
 * reading its tty after the first prompt, which is the lying UI this file
 * exists to prevent.
 *
 * ## A shell pane with a harness under it is named for the harness
 *
 * `codex-batch-pane` is an `sh -c` whose `codex exec` is five levels down, and
 * it classifies as `codex-batch` rather than `shell`. `shell-pane-running-tests`
 * is an `sh -c` too and classifies as `shell`, because vitest is *work* and not
 * a harness. Both are the same rule.
 *
 * **In v1 that difference is informational only, and this is the place to say
 * so before it stops being true.** Every kind except `claude-code` refuses
 * steering, so a pane labelled `codex-interactive` and a pane labelled `shell`
 * are treated identically: nothing is typed at either. The moment a later stage
 * makes `codex-interactive` steerable, the label starts carrying weight it does
 * not yet have — because a `bash -l` with a `codex` in the foreground is a
 * shell that WILL get its terminal back when the codex exits, and this file
 * reports the instant it read, not the instant a keystroke would land.
 *
 * ## THE GAP IN THE CAPABILITY TABLE, NAMED RATHER THAN DISCOVERED
 *
 * **`HARNESS_CAPABILITIES` is a declaration about how a session was LAUNCHED.
 * It is not a verified fact about which process is reading the tty right now,
 * and it cannot be made into one at this seam.** Measured on all 22 panes on
 * 2026-09-08: the pane's job shell, the `claude` inside it, and everything
 * Claude shells out to all share ONE process group — `tpgid` equalled the
 * pane's own `pgid` on 21 of 22 panes, and **0 of 15 `claude` processes had a
 * process group of their own**. (The 22nd is the positive control: the one
 * interactive `bash -l` pane, where job control does give a foreground child
 * its own group. So the reading works; it is the *non-interactive* job shells
 * that never produce the signal.) There is therefore no kernel-level signal
 * that says which of a pane's processes has the terminal. If a verified Claude
 * session has shelled out to something in the foreground, this file will still
 * say `claude-code` and the capability table will still say prose may be typed
 * at it. `steer.ts` narrows that by reading what is painted on the screen; it
 * does not close it, and nothing here can. Independently measured the same
 * morning by the `fleet-approval-binding` session on three panes.
 *
 * ## Probe and classifier are separate, as in work.ts
 *
 * Pure over an injected `ProcessTableReading`, so every case below runs against
 * a capture taken off this box. Nothing here runs a command, and nothing at
 * module scope does anything.
 */
import type { Capability, HarnessCapabilities, HarnessKind } from "../fleet/wire.js";
import {
  indexProcessTable,
  parseCodexInvocation,
  resolveExecutable,
  truncate,
  type CodexInvocation,
  type ProcessRow,
  type ProcessTableReading,
  type TreeReadFailure,
} from "./work.js";

export type { Capability, HarnessCapabilities, HarnessKind };

/**
 * Why we cannot name the harness.
 *
 * The first four are `work.ts`'s, imported rather than restated — the ways a
 * walk fails to start are a property of the tree, not of the question being
 * asked of it. The last two are this file's own, and both are cases where the
 * walk succeeded and the answer is still "we could not tell", which is a
 * different sentence from "there is nothing there".
 */
export type HarnessUnknownCause =
  | TreeReadFailure
  /**
   * The walk found no harness anywhere under the pane, and the pane's own
   * process is not a shell either. Something is in there; we have no name for
   * it. **NOT `shell`** — `shell` is a positive identification that carries a
   * specific danger (typed text gets executed), and handing that label to
   * everything unrecognised would make the dangerous case unfindable.
   */
  | "unrecognised-pane-process"
  /**
   * We found something harness-shaped and could not read it: a `claude` whose
   * invocation matches none we know, or two different harnesses at the same
   * depth with nothing to choose between them.
   *
   * This is the arm that keeps `claude --model x -p …` honest. `work.ts` lists
   * that invocation as a KNOWN GAP and lets it read as no-child-work, which is
   * merely a miss. Here a miss would be worse than a miss: `claude-code`
   * DECLARES that prose may be typed at it, so guessing would put a "send" on a
   * headless run. Refusing to guess costs a grey row; guessing costs a message
   * delivered into a void.
   */
  | "ambiguous-harness";

/**
 * What is in this pane, and the evidence for it.
 *
 * `pid` and `depth` are carried so the answer can be checked rather than
 * believed — depth in particular, because "the codex is at depth 8 and the
 * claude at depth 1" is the whole of the one-session-not-two rule and a
 * reviewer should be able to see it in the value.
 *
 * **`pid` NAMES A PROCESS ONLY FOR AS LONG AS IT LIVES.** Same warning as
 * `ChildJob.pid` in work.ts: a `Harness` is what was true at one instant, pids
 * are reused, and nothing here can detect that.
 */
export type Harness =
  /**
   * An interactive Claude Code session. `claudeSessionId` is null for a bare
   * `claude` with no `--session-id`, which is still interactive and still
   * steerable in principle, but which `steer.ts` cannot safely ADDRESS, because
   * its whole target check is "is a live claude for THIS conversation under
   * this pane". Capability is about the harness; addressability is a separate
   * question and steer.ts already asks it.
   */
  | { kind: "claude-code"; pid: number; depth: number; claudeSessionId: string | null }
  /** `claude --print`: read its prompt once, will never read the tty again. */
  | { kind: "claude-headless"; pid: number; depth: number }
  /** `codex exec` / `codex e` / `codex review`: spawned with no stdin at all. */
  | { kind: "codex-batch"; pid: number; depth: number }
  /** A Codex TUI. Nobody here has ever tried to type at one. */
  | { kind: "codex-interactive"; pid: number; depth: number }
  /**
   * A bare shell has the terminal. `command` is the pane process's own command
   * line, truncated by `parseProcessTable`'s producer, and it is carried
   * because "a shell running the suite" and "a shell doing nothing" are the
   * same kind and very different rows.
   */
  | { kind: "shell"; pid: number; command: string }
  | { kind: "unknown"; cause: HarnessUnknownCause; why: string };

/* ------------------------------------------------------------------ *
 * What each harness can honestly be asked to do.
 * ------------------------------------------------------------------ */

/**
 * The capability table.
 *
 * A `Record` over the closed `HarnessKind`, not an array of objects and not a
 * lookup with a default: **adding an arm to the union without saying what it
 * can do stops the build.** That is the entire mechanism, and it is the reason
 * the kind union is closed in the first place.
 *
 * The type lives in `tools/fleet/wire.ts` and the VALUE lives here, which is
 * not an accident of taste: wire.ts is compiled a second time by the browser's
 * DOM-only project, so it may hold no runtime values and no imports at all. The
 * shape crosses; the table does not. One declaration either way — the failure
 * this repo spent 2026-09-08 on was a contract hand-written on both sides of a
 * boundary with nothing relating the two.
 *
 * **Every `why` here is reader-facing copy.** It is what the dashboard prints
 * beside a disabled button, so it says what is true and what to do instead,
 * rather than naming an internal state.
 */
export const HARNESS_CAPABILITIES: Record<HarnessKind, HarnessCapabilities> = {
  "claude-code": {
    // The only `can: true` for steering in the whole table, and it is proven:
    // `Down` then `Enter` answered a real trust dialog on 2026-09-07.
    steerWithProse: { can: true },
    answerDialog: { can: true },
    watch: { can: true },
  },
  "claude-headless": {
    steerWithProse: {
      can: false,
      why: "`claude --print` read its prompt once at startup and never reads the terminal again, so a message would sit in the pane unread until the run ended",
    },
    answerDialog: {
      can: false,
      why: "a headless run has no dialog to answer — it was launched with its permissions already decided, and it will not stop to ask",
    },
    watch: { can: true },
  },
  "codex-batch": {
    steerWithProse: {
      can: false,
      // Not a policy. `scripts/subagent-cli.ts` spawns with `stdio[0] = 'ignore'`
      // and its own comment calls that "the load-bearing anti-hang guarantee".
      why: "a Codex batch job is spawned with fd 0 set to 'ignore' — there is no stdin to type at, and that is deliberate: it is what stops a codex run hanging forever waiting for input nobody is there to give",
    },
    answerDialog: {
      can: false,
      why: "a Codex batch job never draws a dialog; it runs with `approval_policy=never` and either finishes or fails",
    },
    watch: { can: true },
  },
  "codex-interactive": {
    steerWithProse: {
      can: false,
      // UNPROVEN, not impossible — and the difference is the whole reason this
      // is a separate arm from `codex-batch`. A future stage could try this; it
      // could never try the one above.
      why: "we have never sent a keystroke to a Codex TUI and have no evidence one would be read as a message, so this is refused as unproven rather than impossible — nobody has tried it here yet",
    },
    answerDialog: {
      can: false,
      why: "we have never recognised a Codex dialog on screen, so there is nothing to match against and no way to tell a correct answer from a wrong one",
    },
    watch: { can: true },
  },
  shell: {
    steerWithProse: {
      can: false,
      why: "a bare shell would EXECUTE the text; `rm` is a word people write in messages",
    },
    answerDialog: {
      can: false,
      why: "there is no dialog here; there is a command line, and an arrow key at a command line is history rather than a choice",
    },
    watch: { can: true },
  },
  unknown: {
    steerWithProse: {
      can: false,
      why: "typing at something you cannot name is how the right text reaches the wrong session",
    },
    answerDialog: {
      can: false,
      why: "typing at something you cannot name is how the right text reaches the wrong session",
    },
    watch: { can: true },
  },
};

/** The capability row for a classified pane. */
export function capabilitiesOf(harness: Harness): HarnessCapabilities {
  return HARNESS_CAPABILITIES[harness.kind];
}

/**
 * One line about a harness, for a log or a hover.
 *
 * AN EXHAUSTIVE SWITCH WITH A `never` DEFAULT, not an `if` chain: a new arm on
 * `Harness` must be given a sentence here or the build stops. An `if` chain
 * with a fallback would have quietly described the new harness as whatever the
 * last branch said.
 */
export function describeHarness(harness: Harness): string {
  switch (harness.kind) {
    case "claude-code":
      return harness.claudeSessionId === null
        ? `an interactive Claude Code session (pid ${harness.pid}) with no --session-id, so it cannot be addressed by conversation`
        : `Claude Code, conversation ${harness.claudeSessionId} (pid ${harness.pid})`;
    case "claude-headless":
      return `a headless \`claude --print\` run (pid ${harness.pid}), which is not reading its terminal`;
    case "codex-batch":
      return `a Codex batch job (pid ${harness.pid}) — a paid GPT run with no stdin`;
    case "codex-interactive":
      return `an interactive Codex session (pid ${harness.pid})`;
    case "shell":
      return `a shell (pid ${harness.pid}) running \`${harness.command}\``;
    case "unknown":
      // The `why` IS the description. A row that said only "unknown" would be
      // the absence-reported-as-a-fact this whole area refuses.
      return `not identified: ${harness.why}`;
    default: {
      const never: never = harness;
      throw new Error(`unhandled harness ${JSON.stringify(never)}`);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Recognising one command line.
 * ------------------------------------------------------------------ */

/**
 * Shells, by the basename of argv[0].
 *
 * `-bash` and `-sh` are here because a login shell's argv[0] is its name with a
 * leading dash, which is how `bash -l` in a tmux pane presents itself in some
 * launches. Every pane process on this box is `bash`, `sh` or a `claude`.
 *
 * These are matched ONLY against the pane's own process, never against
 * something found down the tree — see `classifyPaneHarness`. A shell somewhere
 * under a pane is the ordinary furniture of every session on this box (each
 * Bash tool call is one), and treating one as the harness would relabel every
 * working Claude session as a command line.
 */
const SHELLS: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash", "ksh", "fish", "-bash", "-sh"]);

/**
 * `shell` IS A CLAIM ABOUT argv[0]'S BASENAME, NOT ABOUT THE EXECUTABLE.
 *
 * A process is free to call itself `bash` and be something else, and this would
 * believe it. Establishing what a binary actually is needs `/proc/<pid>/exe`,
 * which is a syscall per candidate against a process that may exit underneath
 * the read — not something this seam does. Stated here because `shell` is the
 * arm carrying the sharpest warning in the capability table ("would EXECUTE the
 * text"), and a sharp warning resting on a soft check should say so.
 *
 * The direction of the softness is the safe one: a liar named `bash` gets the
 * most restrictive refusal in the table rather than a grant.
 */

/** What one command line says about the harness, if anything. */
type HarnessMatch =
  | { found: "claude-code"; claudeSessionId: string | null }
  | { found: "claude-headless" }
  | { found: "codex-batch" }
  | { found: "codex-interactive" }
  | { found: "ambiguous"; why: string }
  | null;

/**
 * The Claude invocations we can read, and the refusal for the ones we cannot.
 *
 * ANCHORED TO THE FIRST ARGUMENT throughout, for the reason work.ts gives: a
 * pane's Claude is `claude --session-id <uuid> <the whole prompt>`, the prompt
 * is free text, and an agent's prompt can contain the words `--print` or
 * `--session-id`. Searching the line instead of anchoring to its head would let
 * a task description relabel the session it is describing.
 */
function recogniseClaude(args: string): HarnessMatch {
  const tokens = args.split(/\s+/).filter((t) => t !== "");
  const sessionIds: string[] = [];
  let headless = false;
  let i = 0;

  // WALK THE LEADING OPTION REGION AND STOP AT THE PROMPT. Anchoring on the
  // FIRST argument alone was wrong, and a cross-family review found it:
  // `claude --session-id abc --print do the thing` matched the `--session-id`
  // arm, returned `claude-code`, and the capability table then GRANTED prose
  // steering on a headless run. A false grant is the exact failure this stage
  // exists to prevent, and it was sitting in the recogniser.
  //
  // Stopping at the first bare word is what keeps the opposite mistake away:
  // a prompt is free text, and `claude --session-id abc Please add a --print
  // flag to the CLI` must not be read as headless because its PROMPT says
  // `--print`. The option region ends at `Please`, and nothing after it is
  // read as a flag.
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === undefined || !token.startsWith("-")) break;
    i += 1;

    if (/^(--print|-p)$/.test(token)) {
      headless = true;
      continue;
    }

    // `--session-id=abc` as well as `--session-id abc`. Both are real argv
    // spellings and `steer.ts`'s own reader accepts the first, so refusing it
    // here would put the two readers into disagreement over one command line.
    const inline = /^--session-id=(.+)$/.exec(token);
    if (inline?.[1] !== undefined) {
      sessionIds.push(inline[1]);
      continue;
    }

    if (token === "--session-id") {
      const value = tokens[i];
      if (value !== undefined && !value.startsWith("-")) {
        sessionIds.push(value);
        i += 1;
      }
      continue;
    }

    // Any other option: skip it, and skip its value if the next word is one.
    // Guessing wrong here cannot manufacture a grant — `--print` is matched
    // above before any value-skipping can swallow it.
    const next = tokens[i];
    if (next !== undefined && !next.startsWith("-")) i += 1;
  }

  // `--print` beats everything: it is the one flag that decides whether this
  // process will ever read its terminal again.
  if (headless) return { found: "claude-headless" };

  const [first, second] = sessionIds;
  if (first !== undefined && second !== undefined && first !== second) {
    return {
      found: "ambiguous",
      why: `a \`claude\` carrying two different --session-id values (${first}, ${second}), so which conversation this pane holds cannot be read from its command line`,
    };
  }

  // A bare `claude`, or one with flags and no session id: interactive, and
  // there is simply no conversation id to carry. Still steerable in principle;
  // `steer.ts` is what decides it cannot be ADDRESSED.
  return { found: "claude-code", claudeSessionId: first ?? null };
}

/**
 * A parsed `codex` command line, as a harness answer.
 *
 * `other` returns NULL rather than a harness: `codex login`, `codex mcp-server`
 * and `codex app-server` are a utility, a server and a server. None of them is
 * a session anybody could steer, and the first draft called every one of them
 * an interactive Codex — which would have put a Codex label, and a Codex
 * refusal sentence, on a pane holding a login prompt. Returning null lets the
 * walk carry on past them and the pane fall through to `shell` or `unknown`,
 * which is what it actually is.
 *
 * `unreadable` is deliberately NOT treated as interactive. It is a bare word
 * that is no subcommand this knows: a prompt (so, interactive) or a subcommand
 * from a newer Codex (so, anything). Guessing would be a label with nothing
 * behind it.
 */
function recogniseCodex(invocation: CodexInvocation): HarnessMatch {
  switch (invocation.mode) {
    case "batch":
      return { found: "codex-batch" };
    case "interactive":
      return { found: "codex-interactive" };
    case "other":
      return null;
    case "unreadable":
      return {
        found: "ambiguous",
        why: `a \`codex\` whose first bare word is \`${invocation.firstWord}\`, which is no subcommand this knows — it may be a prompt for an interactive session or a subcommand from a newer Codex, and \`ps\` has already lost the quoting that would say which`,
      };
    default: {
      const never: never = invocation;
      throw new Error(`unhandled codex invocation ${JSON.stringify(never)}`);
    }
  }
}

/**
 * Which harness, if any, this command line is.
 *
 * Reuses `resolveExecutable` from work.ts rather than re-deriving it, so BOTH
 * halves of the fake-codex decision apply here for free: shells are never
 * peeled, and nothing under `/tmp` is an installed tool. That matters more here
 * than it does for work: `bash /tmp/fake-codex-qAz9Um/codex` is a real command
 * line on this box, and a harness classifier that peeled the shell would call a
 * unit-test fixture a Codex session.
 */
export function recogniseHarnessCommand(command: string): HarnessMatch {
  const resolved = resolveExecutable(command);
  if (resolved === null) return null;

  if (resolved.name === "claude") return recogniseClaude(resolved.args);

  if (resolved.name === "codex") return recogniseCodex(parseCodexInvocation(resolved.args));

  return null;
}

/* ------------------------------------------------------------------ *
 * Classifying a pane.
 * ------------------------------------------------------------------ */

/**
 * The only way an `unknown` is built, so the promise the type makes is kept.
 *
 * **`why` IS THE ARM'S ENTIRE VALUE, and it used to be possible for it to be
 * empty.** `process-table-unreadable` passes the probe's own sentence straight
 * through, and a probe that failed with an empty string produced
 * `{ kind: "unknown", cause: "process-table-unreadable", why: "" }` — a refusal
 * that says nothing, rendered as a greyed-out button with no reason beside it,
 * which is precisely the UI this file exists to prevent. A cross-family review
 * found it. Every construction site goes through here now, and a blank is
 * replaced rather than passed on.
 */
function unknown(cause: HarnessUnknownCause, why: string): Harness {
  const said = why.trim();
  return {
    kind: "unknown",
    cause,
    why: said === "" ? `${cause}, and whatever reported it did not say why` : said,
  };
}

/**
 * Is everything reachable from the pane one tree?
 *
 * SEPARATE FROM SELECTION, AND RUN FIRST, because the two ask different
 * questions of the same rows and the selection walk is allowed to stop early.
 * `findShallowestHarness` returns as soon as it has a level with one hit in it,
 * so a cycle in a sibling branch — or below the harness it picked — is never
 * reached. A cross-family review built the case: pane `1` with `ppid 3`, a
 * `claude` at `2` and a `sleep` at `3`, which is the cycle `1 → 3 → 1` and
 * which nonetheless returned a **steerable** `claude-code`. A malformed table
 * answering with a capability grant is the worst shape available here.
 *
 * So structural validation looks at the WHOLE reachable subtree and prunes
 * nothing. Selection may prune below a matched harness; this may not.
 */
function revisitedPid(pane: ProcessRow, children: ReadonlyMap<number, ProcessRow[]>): number | null {
  const visited = new Set<number>([pane.pid]);
  const stack: number[] = [pane.pid];
  while (stack.length > 0) {
    const pid = stack.pop();
    if (pid === undefined) break;
    for (const kid of children.get(pid) ?? []) {
      if (visited.has(kid.pid)) return kid.pid;
      visited.add(kid.pid);
      stack.push(kid.pid);
    }
  }
  return null;
}

/**
 * The shallowest harness at or below `pane`, or null if the tree holds none.
 *
 * BREADTH-FIRST, AND THAT IS THE LOAD-BEARING PART. Level by level from the
 * pane's children outward, so the answer is the harness NEAREST THE TERMINAL
 * rather than whichever branch happened to sort first. With a real `codex exec`
 * at depth 8 under a real `claude` at depth 1, breadth-first and depth-first
 * give opposite answers, and only one of them keeps a reviewing Claude session
 * on the fleet.
 *
 * Returns a `Harness` even for the two ways this can fail, because both are
 * answers about the pane rather than failures to look: a level holding two
 * different harnesses is `ambiguous-harness`, and a walk that comes back on
 * itself is `malformed-process-table`. Null means only "no harness in this
 * tree", which is the caller's cue to look at the pane's own row.
 */
function findShallowestHarness(pane: ProcessRow, children: ReadonlyMap<number, ProcessRow[]>): Harness | null {
  const visited = new Set<number>([pane.pid]);
  let level: readonly ProcessRow[] = [pane];
  let depth = 0;

  while (level.length > 0) {
    depth += 1;
    const next: ProcessRow[] = [];
    const hits: { match: Exclude<HarnessMatch, null>; row: ProcessRow }[] = [];

    for (const parent of level) {
      // Sorted by pid so a table read twice gives the same answer, and so the
      // `hits` list below is stable when it has to be reported.
      for (const kid of [...(children.get(parent.pid) ?? [])].sort((a, b) => a.pid - b.pid)) {
        if (visited.has(kid.pid)) {
          // Not a shape to route around. A real ancestry cannot come back on
          // itself, so these rows are not one tree, and the honest answer is
          // that we could not tell rather than a tidy `shell`.
          return unknown(
            "malformed-process-table",
            `walking from pid ${pane.pid} came back to pid ${kid.pid}, so these rows are not an ancestry`,
          );
        }
        visited.add(kid.pid);
        const match = recogniseHarnessCommand(kid.command);
        // A match is NOT descended into: everything below a harness belongs to
        // that harness. This is what makes the Sol review under a Claude
        // session one session rather than two.
        if (match !== null) hits.push({ match, row: kid });
        else next.push(kid);
      }
    }

    const [first, second] = hits;
    if (first !== undefined && second !== undefined) {
      const names = hits.map((h) => `pid ${h.row.pid} (${h.match.found})`).join(", ");
      return unknown(
        "ambiguous-harness",
        `pane ${pane.pid} has ${hits.length} harnesses at depth ${depth} — ${names} — and nothing in a process table says which of them holds the terminal`,
      );
    }
    if (first !== undefined) return harnessFrom(first.match, first.row, depth);

    level = next;
  }

  return null;
}

function harnessFrom(match: Exclude<HarnessMatch, null>, row: ProcessRow, depth: number): Harness {
  switch (match.found) {
    case "claude-code":
      return { kind: "claude-code", pid: row.pid, depth, claudeSessionId: match.claudeSessionId };
    case "claude-headless":
      return { kind: "claude-headless", pid: row.pid, depth };
    case "codex-batch":
      return { kind: "codex-batch", pid: row.pid, depth };
    case "codex-interactive":
      return { kind: "codex-interactive", pid: row.pid, depth };
    case "ambiguous":
      return unknown("ambiguous-harness", `pid ${row.pid} is ${match.why}`);
    default: {
      const never: never = match;
      throw new Error(`unhandled harness match ${JSON.stringify(never)}`);
    }
  }
}

/**
 * Which harness is holding `panePid`, according to one reading of the process
 * table.
 *
 * ## The order the three questions are asked in
 *
 * 1. **The pane's own process, at depth 0** — a pane can BE its harness, which
 *    is what a hand-typed `codex` or `claude` in a shell looks like.
 * 2. **`findShallowestHarness`**, breadth-first outward. See its comment for
 *    why the order is load-bearing and why a level with two harnesses in it is
 *    `ambiguous-harness` rather than a tie broken by pid.
 * 3. **The pane's own row again, for `shell`** — and only after the whole tree
 *    has failed to produce a harness.
 *
 * The pane's own row decides `shell`, and only after the whole tree has failed
 * to produce a harness. A shell is what is left when nothing else is there —
 * but it is still a positive identification, made against `SHELLS`, so a pane
 * running something genuinely unrecognised comes back `unknown` rather than
 * being quietly called a command line.
 */
export function classifyPaneHarness(panePid: number | null, reading: ProcessTableReading): Harness {
  if (panePid === null) {
    return unknown("no-pane-pid", "the snapshot carried no pane pid for this session");
  }
  if (!reading.read) return unknown("process-table-unreadable", reading.why);

  // `indexProcessTable` rather than fifteen lines of the same map-building:
  // `classifyPaneWork` asks the identical question of the identical rows, and
  // the duplicate-pid invariant belongs in one place or it drifts.
  const index = indexProcessTable(reading.rows);
  if (!index.ok) {
    return unknown(
      "malformed-process-table",
      `pid ${index.duplicatePid} appears twice, so these rows are not one process table`,
    );
  }
  const { byPid, children } = index;

  const pane = byPid.get(panePid);
  if (pane === undefined) {
    return unknown(
      "pane-not-in-table",
      `pid ${panePid} is not in a process table of ${reading.rows.length} rows; the pane exited, or its pid was reused`,
    );
  }

  // STRUCTURE BEFORE CONTENT. Nothing below may answer about a pane whose rows
  // are not an ancestry — including the depth-0 check, which would otherwise
  // return a confident `claude-code` for a self-parented pane without walking
  // anything at all.
  const revisited = revisitedPid(pane, children);
  if (revisited !== null) {
    return unknown(
      "malformed-process-table",
      `walking from pid ${panePid} came back to pid ${revisited}, so these rows are not an ancestry`,
    );
  }

  // Depth 0 is the pane process itself: a pane can be its own harness, which is
  // what a hand-launched `codex` or `claude` in a shell would look like.
  const paneMatch = recogniseHarnessCommand(pane.command);
  if (paneMatch !== null) return harnessFrom(paneMatch, pane, 0);

  const found = findShallowestHarness(pane, children);
  if (found !== null) return found;

  // Nothing anywhere in the tree. Now, and only now, the pane's own process.
  const paneExecutable = resolveExecutable(pane.command);
  if (paneExecutable !== null && SHELLS.has(paneExecutable.name)) {
    // TRUNCATED with work.ts's own truncator, not passed on raw. A pane command
    // can be a `codex exec` carrying an entire review prompt — one capture in
    // this repo's fixtures is a single line of several kilobytes — and this
    // value is destined for an append-only history and a page. The type's
    // comment promised truncation before the code did it; a cross-family review
    // noticed the contract and the behaviour had come apart.
    return { kind: "shell", pid: pane.pid, command: truncate(pane.command) };
  }

  return unknown(
    "unrecognised-pane-process",
    `pane ${panePid} is running \`${pane.command}\`, which is no harness this knows, and is not a shell either`,
  );
}
