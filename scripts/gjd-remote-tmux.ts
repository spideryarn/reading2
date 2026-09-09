/**
 * Reading the box's tmux sessions — the pure half of `gjd-remote ls`.
 *
 * Separated from scripts/gjd-remote.ts so it can be tested without a network,
 * the same way scripts/gjd-remote-env.ts is. See tests/gjd-remote-tmux.test.ts
 * for the two bugs that made it worth separating.
 */

import { REPO_UNKNOWN, isRepoValue } from "./gjd-remote-repo.js";
/* THE ONE IMPORT OUT OF `scripts/`, and it is a leaf module with no imports of
   its own — see the re-export below, and `tools/fleet/overseer-claim.ts` for
   why the Overseer's vocabulary has to be reachable from three places at once. */
import {
  OVERSEER_ROLE,
  type OverseerClaim,
  type SessionRole,
  overseerClaim as wireOverseerClaim,
} from "../tools/fleet/overseer-claim.js";

export type Session = {
  /**
   * tmux's own handle for the session — `$0`, `$7`. Immutable: it survives the
   * rename `ls` performs, and it survives a session being renamed by hand.
   *
   * **Every command that acts on a session addresses it by this, not by name.**
   * A name is what a person types and what `ls` prints; it is not an address.
   * Two reasons, both Sol's: a name has a window between being read and being
   * used in which the session can die and another take the name — and `kill`
   * acting on the wrong session is not recoverable — and a name made by hand
   * can be any string tmux accepts, which is far more than `SLUG` allows.
   */
  id: string;
  name: string;
  created: Date;
  attached: boolean;
  windows: number;
  /** Claude Code's own generated title for the conversation, once it has one. */
  title: string;
  /** Whether the name is a placeholder we chose, and so may be replaced. */
  provisional: boolean;
  /**
   * `claude --session-id`, pinned into the tmux environment at launch, or null
   * for a session that has no Claude in it (`new-shell`, or one made by hand).
   *
   * This is the join key to what Claude Code says about itself — see
   * `parseAgents` — and it is the ONLY one that works, because `ls` renames a
   * provisional session to Claude's own title and the name it had at launch is
   * then gone.
   *
   * Not guaranteed to be a uuid: it is whatever is in that session's tmux
   * environment, and `sessionState` is where that is checked. See
   * `parseSessionLine` for why the check is not here.
   */
  claudeId: string | null;
  /** What the box can see running inside this session. See `SessionProc`. */
  proc: SessionProc;
  /** Which repo this session is for, and how much of that we are allowed to
   *  believe. See `SessionMeta`. */
  meta: SessionMeta;
  /**
   * Whether this session is the Overseer — see `SessionRole`.
   *
   * Separate from `meta` because it is set and unset while the session runs,
   * whereas everything in `meta` is pinned at launch and is all-or-nothing.
   */
  role: SessionRole;
};

/**
 * The four variables the launcher pins into a session's tmux environment so
 * `ls` can say WHICH REPO a session is for.
 *
 * They are exported as names rather than spelled again at each end, because a
 * second copy of a variable name is a copy that stops matching the day somebody
 * renames the first — the same reason `ROW_COUNT` is a constant.
 */
export const META = {
  version: "GJD_METADATA_VERSION",
  kind: "GJD_KIND",
  repo: "GJD_REPO",
  dir: "GJD_REMOTE_DIR",
} as const;

/** The only metadata version this reader was written against. */
export const METADATA_VERSION = "1";

/**
 * **WHICH ROLE A SESSION HOLDS** — deliberately NOT a fifth member of `META`.
 *
 * `META` means *the versioned quartet*: four variables pinned at launch, never
 * changed afterwards, and all-or-nothing (`legacy` is all four absent). Callers
 * and tests already read `META` as that set. This one is set and unset while the
 * session runs, on sessions of any vintage, so putting it in there would blur
 * the one thing that type is for — and it does not bump `METADATA_VERSION`,
 * which would fail the whole listing for every session alive on the box. GPT
 * Sol, reviewing the plan for
 * docs/plans/260908j-mark-one-session-as-the-overseer.md.
 *
 * It is read on its own, the way `CLAUDE_SESSION_ID` and `GJD_PROVISIONAL` are.
 */
export const SESSION_ROLE_ENV = "GJD_ROLE";

/**
 * What the role field says when the session's environment could not be read at
 * all — a session that died between `tmux ls` and the lookup, or a server that
 * went away underneath us.
 *
 * `?` and not an empty field, because an empty field is a session that holds no
 * role, and those two must never be the same bytes. It is safe as a sentinel
 * because every other value in that field is base64, which has no `?` in its
 * alphabet. Same shape as `SessionProc`'s own `?`.
 */
export const ROLE_UNREADABLE = "?";

/**
 * **THE OVERSEER'S CLAIM.** The vocabulary is not declared here.
 *
 * The Overseer is one permanent session supervising all the others
 * (docs/project/overseer.md). Until 2026-09-08 the only thing that made a
 * session the Overseer was its own belief that it was, which is a fact no other
 * program could read and two sessions could hold at once. A string in a
 * session's tmux environment is now the claim, and THIS file is what reads it
 * off the box — but the words, and the rule for what a listing of them adds up
 * to, live in [`tools/fleet/overseer-claim.ts`](../tools/fleet/overseer-claim.ts).
 *
 * **Imported rather than restated, and that is deliberate after GPT Sol's P0-2
 * on the plan:** three consumers on two sides of a compilation boundary have to
 * agree about what *one known holder plus one unreadable row* means, and the
 * first draft of that rule was already written two different ways in one
 * afternoon. That module has no imports at all, so it is equally reachable from
 * here, from the dashboard's node side, and from the browser bundle.
 */
export {
  OVERSEER_ROLE,
  type OverseerClaim,
  type SessionRole,
} from "../tools/fleet/overseer-claim.js";

/**
 * What a role value is allowed to look like: a short lower-case token.
 *
 * Narrow on purpose. The value is interpolated into a shell command by
 * `setRoleCommand` and printed into a table, and it arrives from a tmux
 * environment variable, which anybody on the box can set to anything by hand.
 */
const ROLE_TOKEN = /^[a-z][a-z0-9-]{0,31}$/;

/**
 * What was started in the session, as the launcher knew it — not as the process
 * table guesses it.
 *
 * `setup` is here so a setup job does not have to masquerade as a shell (GPT
 * Sol, finding 8). It carries no Claude, so `sessionState` reports it exactly
 * as it reports `new-shell`; the kind is what lets a later version say more.
 */
export type SessionKind = "claude" | "shell" | "setup";

const SESSION_KINDS: readonly SessionKind[] = ["claude", "shell", "setup"];

/**
 * Which repo a session is for, or an admission that it cannot be known.
 *
 * A DISCRIMINATED UNION RATHER THAN THREE OPTIONAL FIELDS, and that is the
 * whole of GPT Sol's finding 8. Every session on the box is rendered by the
 * current listing script, so an empty `GJD_REPO` on its own is ambiguous: it is
 * either a session started before any of this existed, or a new session that
 * lost its metadata on the way. The first is a row to show as `(unknown)`; the
 * second is a listing to refuse. Without the version they are the same bytes.
 *
 * So `legacy` means *all four variables were absent* — nothing else does — and
 * version 1 means all four were present AND valid. A record that is neither is
 * not a degraded row: it fails the whole listing, the way a short row count
 * does, because a caller that is handed a partial list reasons from its
 * absences.
 */
export type SessionMeta =
  | { version: "legacy" }
  | { version: 1; kind: SessionKind; repo: string; dir: string };

/**
 * What is actually running in the session's pane, asked of the process table
 * rather than of anything that reports on itself.
 *
 *  - **claude** — a `claude --session-id <this uuid>` is a child of the pane.
 *    Not "a claude": the uuid is matched, so a neighbouring session's process
 *    cannot answer for this one.
 *  - **wait** — the pane is still running one of our own job scripts (its path
 *    is under `gjd-remote/jobs/`) and that script has a live `sleep` child, with
 *    this many seconds left on it. Both halves are needed. The sleep alone is
 *    not enough: once Claude exits the job `exec`s a login shell, and somebody
 *    typing `sleep 900` into it would otherwise be reported as a scheduled job
 *    that had never started.
 *  - **busy** — neither of those, but SOMETHING is running: a process whose
 *    ancestry reaches one of the panes. This is what tells a shell session
 *    grinding through `npm test` from an abandoned prompt, which `ls` shows and
 *    which is the difference between a session that is safe to kill and one
 *    that is not. Ancestry rather than a direct child, because `npm test` is
 *    several levels deep by the time it matters.
 *  - **none** — none of those. Nothing is running in this session at all.
 *  - **unknown** — the box could not be asked. NOT folded into `none`: they are
 *    the same emptiness, and this whole file exists because that emptiness
 *    keeps getting read as an answer.
 */
export type SessionProc =
  | { kind: "claude" }
  | { kind: "wait"; secondsLeft: number }
  | { kind: "busy" }
  | { kind: "none" }
  | { kind: "unknown" };

/**
 * What Claude Code says about one of its own sessions.
 *
 * `busy | idle | waiting` are the three `claude agents --json` prints today
 * (verified against 2.1.251 on the box, 2026-09-01). A fourth would arrive as
 * `unknown` rather than as a guess — see `sessionState`.
 */
export type AgentStatus = "busy" | "idle" | "waiting";

/**
 * WHY a session's state could not be determined — the contract for MACHINES,
 * where `why` is the contract for PEOPLE.
 *
 * Every one of these is a different fault with a different owner, and the
 * sentences beside them are written for whoever reads the screen: they get
 * reworded, they interpolate the box's own error text, and two calls a minute
 * apart can produce two different sentences about one unchanging situation.
 * That is fine for a person and useless for anything that COMPARES two
 * statuses — a watcher diffing consecutive collections reads a reworded
 * sentence as a state TRANSITION, and its history shows sessions flapping while
 * nothing at all has happened.
 *
 * So these strings are stable identifiers for the CAUSE, never for the wording:
 * change a sentence freely, and change one of these only when the underlying
 * fault genuinely becomes a different fault. Note in particular that
 * `unrecognised-agent-status` deliberately does NOT vary with the status name
 * it found — a box that reports two unfamiliar statuses in turn has one problem,
 * not two. The name is not discarded, though: it is carried beside the cause in
 * `SessionState`'s `reportedStatus`, which is where a consumer that wants the
 * transition rather than the diagnosis should look.
 *
 * The first five are `sessionState`'s, and are all "we could not tell", of
 * which four are the box's doing and one is a hand-set environment variable.
 * `no-status-derived` is the odd one out and is deliberately named so it cannot
 * be mistaken for them: it means OUR OWN BUG (see tools/fleet/collect.ts), a
 * join that cannot fail, and if it ever appears the page is telling you about
 * this code rather than about the machine.
 */
export type SessionUnknownCause =
  /** `CLAUDE_SESSION_ID` was set by hand to something that is not a session id, so it joins to nothing. */
  | "not-a-session-id"
  /** `claude agents --json` could not be run or could not be trusted, so nothing about any Claude row is known. */
  | "agents-unavailable"
  /** Claude Code reported a status this version has no arm for. Never the name of that status — that rides in `reportedStatus`. */
  | "unrecognised-agent-status"
  /** The process table says a Claude is alive, the agents list does not mention it, and neither is discarded. */
  | "running-but-unlisted"
  /** The process probe itself did not run, so "nothing is running" was never established. */
  | "process-probe-unavailable"
  /** Not the box's fault: a status pass that should have covered this session did not. Our bug, on the page. */
  | "no-status-derived"
  /**
   * Nobody observed anything: a CLIENT asserted this status in a request body.
   *
   * This is named for the fault in the same sense as the six above, because the
   * fault here is **the absence of an observation**. A status arriving in a
   * request is not a reading — it is "this is what the page was showing when
   * the person tapped" — so a parser must stamp this rather than keep whatever
   * cause the client sent. Keeping one would launder a browser's string into a
   * field whose entire purpose is to say what the BOX saw, and the page could
   * no longer tell an asserted fault from an observed one. Same class of error
   * as inventing a `collectedAt` for a collection that never ran.
   *
   * The client's own sentence survives in `why`, which is what a refusal
   * renders, so nothing a person reads is lost.
   */
  | "client-declared";

/**
 * The state a person actually wants off `gjd-remote ls`: is this one finished,
 * is it thinking, is it stuck on a question only they can answer, or has it not
 * started yet.
 *
 * `unknown` carries its reason because the alternative — showing a blank, or
 * quietly picking the most likely of the others — is the failure this repo
 * keeps writing comments about. A state nobody can determine must look
 * different from a state that was determined.
 */
export type SessionState =
  | { kind: "needs-you" }
  | { kind: "working" }
  | { kind: "idle" }
  | { kind: "waiting"; secondsLeft: number }
  | { kind: "no-claude" }
  /**
   * No Claude in it at all — a `new-shell`, or a session somebody made by hand
   * with `tmux new-session`.
   *
   * `busy` is whether anything is running in it: `true` for a shell part way
   * through `npm test`, `false` for one sitting at a prompt, `null` when the
   * box could not be asked. **`false` is "at rest now", not "finished"** — the
   * probe is one snapshot, and a shell nobody has typed into yet looks exactly
   * like one whose work is over. It is here so `ls` can say which sessions are
   * doing something, not so anything can decide which to kill.
   */
  | { kind: "shell"; busy: boolean | null }
  /**
   * Nobody could say. `why` is the sentence a person reads; `cause` is the
   * identifier anything comparing two statuses must use instead of it — the
   * distinction is `SessionUnknownCause`'s doc comment, and it is the whole
   * reason the field exists.
   *
   * `cause` is REQUIRED on purpose. An optional one is a field every new
   * construction site is free to forget, and a forgotten cause is exactly the
   * silent collapse this union is built to prevent.
   */
  | {
      kind: "unknown";
      why: string;
      cause: SessionUnknownCause;
      /**
       * The status token Claude Code actually printed, when the fault was that
       * we had no arm for it. Set at exactly one construction site
       * (`unrecognised-agent-status`) and absent everywhere else.
       *
       * IT LOOKS LIKE IT CONTRADICTS THE RULE ABOVE, AND IT DOES NOT. The rule
       * — a field anything diffs must not carry what varies for reasons the
       * consumer does not care about — was aimed at OUR WORDING: `why` is
       * rewritten by us and interpolates the box's error text, so two sentences
       * a minute apart can describe one unchanging situation. This is the
       * BOX'S OBSERVATION, and it changes only when the box says something
       * different. `cause` stays the stable diagnostic category ("we have one
       * unrecognised-status problem"); this records what was seen.
       *
       * WITHOUT IT A REAL TRANSITION IS LOST. A future Claude Code reports
       * `compacting` and then `waiting-for-input`: both collapse to the same
       * cause, so a watcher keyed on `cause` alone sees one unchanging session
       * while the source moved twice. GPT Sol's S1-1, resolved in the Overseer's
       * S2 because that is where the transition key is defined —
       * docs/plans/260908b-overseer-store-and-clock.md.
       *
       * Optional so that every other construction site — here and in
       * tools/fleet — stays untouched: a required field would be a sixth thing
       * for each of them to get wrong about a fault it never observed.
       */
      reportedStatus?: string;
    };

/**
 * The fields tmux itself knows, in the order the parser expects.
 *
 * `#{session_id}` leads, and it is the field doing the real work: it is tmux's
 * own handle (`$0`, `$3`), digits after a dollar and nothing else, so the shell
 * can split it off the front of a record with no risk of a session NAME
 * containing the separator and shifting every later field. It is also immutable
 * across the rename `ls` performs.
 *
 * There is deliberately NO `#{pane_pid}` here, and there used to be. It
 * resolves to the active pane of the session's CURRENT window, so a Claude in a
 * second window or a split was invisible — and an invisible Claude that is also
 * absent from `claude agents --json` reads as a session with no Claude in it.
 * `tmux list-panes -a` gives every pane of every session in one command, which
 * is both correct and no more round trips.
 *
 * These are handed to `tmux ls -F`, which takes NO target and fills every field
 * for every session in one command. The first version asked for them per
 * session with `tmux display -p -t "=$name"` instead — and `display` takes a
 * target *pane*, where the `=` exact-match prefix is only recognised on the
 * session part if a colon follows. Without the colon tmux 3.4 printed `||`,
 * three empty fields, and exited 0. Nothing looked wrong: `ls` just quietly
 * showed every session as attached and aged 56 years.
 *
 * `tmux ls -F` is not merely the fixed version of that, it is the version where
 * the mistake is unavailable — there is no target to get wrong, and it costs
 * one tmux invocation instead of one per session.
 */
export const SESSION_FIELDS =
  "#{session_id}|#{session_created}|#{session_attached}|#{session_windows}|#{session_name}";

/** Printed last, and only if everything before it worked. See buildSessionScript. */
export const SESSION_SENTINEL = "GJDOK";

/**
 * The two ways the script can answer "what does Claude Code say about itself?".
 *
 * There are two words rather than one-and-silence on purpose: silence is what a
 * box with no sessions gives, and it is also what a broken `claude` gives, and
 * telling those apart is the difference between "nothing is running" and "every
 * row on this screen is a guess".
 */
export const AGENTS_OK = "GJDAGENTS";
export const AGENTS_FAIL = "GJDAGENTSFAIL";

/**
 * How many session rows tmux gave the script, printed before any of them.
 *
 * This is here because of a bug that had been in `ls` since it was written and
 * that nothing caught: `rows=$(tmux ls …)` strips the trailing newline, the
 * loop was fed `printf '%s' "$rows"`, and `read` returns false on an
 * unterminated final line — so its body never ran for the LAST session. Ten
 * sessions on the box, nine on screen, in alphabetical order, for weeks. Found
 * by GPT Sol on 2026-09-01 and reproduced immediately; see
 * docs/postmortems/260901b-the-session-that-was-never-listed.md.
 *
 * The `printf` is fixed. The count is here so that the whole CLASS of it — any
 * future way of losing a row between tmux and the parse — is a loud failure
 * instead of a shorter list, because a short list is indistinguishable from a
 * correct one and every caller reads absence as permission.
 */
export const ROW_COUNT = "GJDROWS";

/**
 * The remote script: list the sessions, then for each one add the variables we
 * pinned into its tmux environment at launch, its name, and the latest title
 * Claude has given the conversation.
 *
 * SEVEN `show-environment` CALLS PER SESSION: the two oldest, the repo metadata
 * (`META`'s four), and one DUMP of the session environment for the Overseer
 * claim. They are round trips to the local tmux server per row — a few
 * milliseconds each, against the ~1.85s the whole script takes on a box with a
 * dozen sessions.
 *
 * The six are separate BY-NAME calls rather than one dump because a variable
 * read by name cannot be mis-attributed to the wrong row by a parse. **The
 * seventh is a dump precisely because it needs what by-name cannot give**:
 * `show-environment -t X VAR` exits 1 both for a variable that is not set and
 * for a session that is not there, so a by-name read of the claim cannot tell
 * *this session holds no role* from *this session could not be asked*. The dump
 * exits 0 iff the session is still there, which separates them. It is still one
 * session's own environment, so nothing can be mis-attributed across rows.
 *
 * `pane_current_path` would have cost nothing at all and is not an option: a
 * shell that has `cd`'d elsewhere, or a session started with `--dir ~`, would be
 * attributed to whatever repo is under the cursor.
 *
 * A variable tmux has never been given prints nothing here, and that is what
 * every session started before this existed looks like — see `SessionMeta`,
 * where the four empties become `legacy` and anything in between fails.
 *
 * TWO THINGS HERE ARE LOAD-BEARING.
 *
 * The SENTINEL. `tmux ls | while read` exits 0 with no output when tmux is
 * missing, broken, or unreachable — verified on the box by running it with tmux
 * off the PATH — which is byte-for-byte what a box with no sessions looks like.
 * Every command draws a conclusion from that emptiness: `ls` says "no
 * sessions", `new` decides the name is free, `resume` says there is nothing to
 * attach to. So the script ends by printing GJDOK, and a reply without it is a
 * failure rather than an empty box. tmux's own "no server running" is the one
 * genuine empty case and is translated, not passed on.
 *
 * BASE64 for the name and the title. They are the only free text in the record
 * — one chosen by whoever made the session, one written by Claude — and a `|`
 * in either would shift every field after it. Encoding them means the wire
 * format has no free text in it at all, so there is no input that can make the
 * parse quietly wrong. `base64 -w0` is GNU, which the Ubuntu box has.
 *
 * The name is pulled off the tmux line with parameter expansion rather than a
 * second `tmux display` call, and it is LAST in the format for that reason:
 * `\${rest#*|}` takes everything after the numeric fields, so a name that
 * itself contains a `|` survives whole instead of shifting the record. Going
 * back to `display -p -t` for it would reintroduce the target-pane trap this
 * whole module exists because of.
 *
 * ## The two questions `ls` asks on top of that
 *
 * **What Claude Code says about itself.** `claude agents --json` prints one
 * record per live session — `sessionId`, `pid`, `cwd`, `status` — and status is
 * `busy`, `idle` or `waiting`, where `waiting` means a permission prompt is on
 * screen with nobody answering it. One call for the whole box, about a second,
 * no TTY needed. It joins to us by `sessionId`, which is the uuid we already
 * pin into the tmux environment at launch.
 *
 * **This is deliberately not screen-scraping.** Reading the state off the pane
 * with `capture-pane` and matching Claude's spinner glyphs works today and was
 * the first version of this: the panes really do say `✽ Herding… (2m 32s …)`
 * while working and `✻ Sautéed for 1h 13m · done 10:29 AM` when finished. It
 * was thrown away on the research, not on taste. `cmux`, which orchestrates
 * terminal agents for a living, records terminal-UI scraping as its single
 * largest source of bugs — 46-odd detection issues, every one of them arriving
 * the day Claude changed how it draws a spinner. `claude agents --json` is
 * first-party, is documented as being "for scripting", and cannot drift with
 * the rendering. Hooks (`PermissionRequest`, `Stop`) are more precise still and
 * are what the tmux-dashboard projects use, but they have to be configured
 * before a session starts, so they cannot answer for the eleven sessions
 * already running on the box — which is the whole job of `ls`.
 *
 * The PATH is widened first, the way the job script in cmdNewClaude widens its
 * own and for the same reason: a non-interactive ssh sources neither `.bashrc`
 * nor `.bash_profile`, so it gets a stock PATH. Two things about how:
 *
 *  - It ADDS rather than replaces. `claude` installed under nvm or
 *    `~/.local/bin` is only findable through the inherited PATH, and losing it
 *    to a tidier one would turn every row on a working box into `unknown`.
 *  - The standard directories go on the END, so the inherited PATH still wins.
 *    That is the right way round on the merits — a `claude` the box's own
 *    environment resolves to is the one its sessions are running — and it is
 *    also what makes tests/gjd-remote-tmux.test.ts able to run this script
 *    against stub binaries, which is how the dropped-row bug is now held shut.
 *
 * FAILS CLOSED, and this one is worth being careful about: if the agents call
 * comes back empty because `claude` is missing, too old for `--json`, or simply
 * broken, then every session looks like one with no Claude in it — a confident,
 * plausible, wrong answer on every row, which is this file's recurring bug. So
 * the script says `AGENTS <base64>` when it worked and `AGENTSFAIL <why>` when
 * it did not, and the two are told apart rather than inferred from emptiness.
 * The JSON is base64'd for the same reason the name and title are: it is the
 * only free text in the record, and it is full of separators.
 *
 * **What is actually running in each session** comes from ONE checked snapshot
 * of the whole process table, plus `tmux list-panes -a` for every pane in every
 * session, and the two are joined per session in awk. Three things about that
 * shape, and each is a bug the first version had:
 *
 *  - **Every pane, not `#{pane_pid}`.** That field is the active pane of the
 *    session's CURRENT window, so a Claude in a second window or a split was
 *    simply not seen — and a session that is not seen and not in the agents
 *    list reads as one with no Claude in it.
 *  - **The pane itself counts, not only its children.** `new-claude` wraps
 *    Claude in a job script, so on this box `claude` is always the pane's child
 *    — but `tmux new-window 'claude …'` makes it the pane process, whose parent
 *    is the tmux server. Found by building exactly that session while testing
 *    the fix above: the probe said `none` about a session with a live Claude in
 *    it, which is the failure this probe exists to prevent, one level up.
 *  - **The snapshot's exit status is checked, once.** The first version ran
 *    `ps --ppid <pid>` per session and threw the status away, and `ps` exits 1
 *    for "no children" — the ordinary case — so a `ps` that failed for any
 *    other reason was indistinguishable from a pane with nothing under it. GPT
 *    Sol ran the generated script with a `ps` returning 2 and got `none`.
 *  - **`wait` needs the sleep AND its parent.** The sleep's parent must be one
 *    of our own job scripts (`/gjd-remote/jobs/`). Once Claude exits the job
 *    `exec`s a login shell, and somebody typing `sleep 900` into it would
 *    otherwise be reported as a scheduled job that had never started.
 *  - **`busy` walks the ancestry, not one generation.** A direct-child test
 *    happens to catch `npm test`, because npm itself is the shell's child — and
 *    happens to miss the `node` doing the work if the shell ever `exec`s
 *    through something. The walk is bounded (32 hops, and it stops at a pid the
 *    snapshot does not carry) because a process table read a line at a time can
 *    contain a cycle that a straight `while` would never leave.
 *  - **The pane process itself counts when it is not a shell.** The walk skips
 *    pane processes, so `tmux new-session -d -s x 'npm test'` — where the work
 *    IS the pane — reported `none`, and `ls` called a session running the suite
 *    idle. GPT Sol reproduced it. The test is on the command rather than on
 *    having children, and it errs towards `busy`: an unrecognised shell is
 *    called busy, which is the harmless direction. Calling live work `idle` is
 *    the direction somebody kills a running suite over.
 *
 * The remaining wait comes from the sleep itself — its argument minus its
 * elapsed seconds. The alternative was to read the deadline out of this
 * laptop's own log, where `--wait` already records `waitUntilMs`. The sleep
 * wins because it is the clock the wait is actually measured against, and
 * because it answers for a session launched from another machine, which the log
 * cannot.
 */
export function buildSessionScript(opts: { agents: boolean } = { agents: false }): string {
  // Only `ls` shows states, and `claude agents --json` costs about 0.65s of
  // process startup — median of five, 1.20s against 1.85s for the whole script,
  // measured on the box on 2026-09-01. Every other caller — `new-claude`
  // checking a name is free, `resume`, `kill` — wants the list and nothing else,
  // and must neither pay for it nor be able to hang on it. GPT Sol found this:
  // an earlier version ran it unconditionally while its own comment claimed
  // only `ls` did.
  const agentsBlock = opts.agents
    ? `
    if ! command -v claude >/dev/null 2>&1; then
      echo '${AGENTS_FAIL} claude is not on the PATH a non-interactive ssh gets'
    elif agents=$(claude agents --json 2>/dev/null) && [ -n "$agents" ]; then
      printf '${AGENTS_OK} %s\\n' "$(printf '%s' "$agents" | base64 -w0)"
    else
      echo '${AGENTS_FAIL} claude agents --json printed nothing (too old for it?)'
    fi`
    : "";

  return `
    PATH="$PATH:/usr/local/bin:/usr/bin:/bin"
    command -v tmux >/dev/null 2>&1 || { echo 'GJDERR tmux is not on this box'; exit 3; }
    snap=$(ps -eo pid=,ppid=,etimes=,args= 2>/dev/null) && [ -n "$snap" ] || snap=
    panes=$(tmux list-panes -a -F '#{session_id} #{pane_pid}' 2>/dev/null) || panes=
    rows=$(tmux ls -F '${SESSION_FIELDS}' 2>&1) || case "$rows" in
      *'no server running'*|*'No such file or directory'*) rows='' ;;
      *) echo "GJDERR tmux ls failed: $rows"; exit 3 ;;
    esac${agentsBlock}
    if [ -z "$rows" ]; then n=0; else n=$(printf '%s\\n' "$rows" | wc -l); fi
    printf '${ROW_COUNT} %s\\n' "$n"
    printf '%s\\n' "$rows" | while IFS= read -r row; do
      [ -n "$row" ] || continue
      sid=\${row%%|*};    rest=\${row#*|}
      created=\${rest%%|*}; rest=\${rest#*|}
      attached=\${rest%%|*}; rest=\${rest#*|}
      windows=\${rest%%|*}
      name=\${rest#*|}
      id=$(tmux show-environment -t "$sid" CLAUDE_SESSION_ID 2>/dev/null | cut -d= -f2-)
      prov=$(tmux show-environment -t "$sid" GJD_PROVISIONAL 2>/dev/null | cut -d= -f2-)
      case "$prov" in 0|1) ;; *) prov=1 ;; esac
      mver=$(tmux show-environment -t "$sid" ${META.version} 2>/dev/null | cut -d= -f2-)
      mkind=$(tmux show-environment -t "$sid" ${META.kind} 2>/dev/null | cut -d= -f2-)
      mrepo=$(tmux show-environment -t "$sid" ${META.repo} 2>/dev/null | cut -d= -f2-)
      mdir=$(tmux show-environment -t "$sid" ${META.dir} 2>/dev/null | cut -d= -f2-)
      # THE ROLE IS THE ONE FIELD THAT DISTINGUISHES *ABSENT* FROM *UNASKABLE*,
      # and it takes two tmux calls to do it. GPT Sol's P0-1, twice.
      #
      # \`show-environment -t X VAR\` exits 1 both when the variable is not set and
      # when the session has gone, so its status alone cannot tell "this session
      # holds no claim" from "this session could not be asked" — and the first is
      # a fact while the second is an absence. So a failed read asks
      # \`has-session\`, AFTERWARDS rather than before: a session that died between
      # the two makes has-session fail too, which is the answer we want. That is
      # a second round trip for every session that holds no role, which is nearly
      # all of them — a few milliseconds against the ~1.85s the script takes.
      #
      # THE OUTPUT SHAPE IS VALIDATED, not just the status. A value containing a
      # newline prints as several lines that look exactly like several variables
      # — verified on a disposable socket — so anything but exactly one line
      # beginning \`VAR=\` is a role we could not read. An earlier version read the
      # whole session environment and grepped it, which was worse twice over: it
      # accepted \`overseer\\njunk\` as a claim, and another variable whose value
      # contained a \`GJD_ROLE=\` line could answer for this one.
      if renv=$(tmux show-environment -t "$sid" ${SESSION_ROLE_ENV} 2>/dev/null); then
        rval=\${renv#${SESSION_ROLE_ENV}=}
        if [ "$(printf '%s' "$renv" | grep -c '')" -eq 1 ] && [ "$rval" != "$renv" ]; then
          mrole=$(printf '%s' "$rval" | base64 -w0)
        else
          mrole='${ROLE_UNREADABLE}'
        fi
      elif tmux has-session -t "$sid" 2>/dev/null; then
        mrole=''
      else
        mrole='${ROLE_UNREADABLE}'
      fi
      mine=$(printf '%s\\n' "$panes" | awk -v s="$sid" '$1==s { print $2 }')
      if [ -z "$snap" ] || [ -z "$mine" ]; then
        proc='?'
      else
        proc=$(printf '%s\\n' "$snap" | awk -v panes="$mine" -v id="$id" '
          # IS THIS PROCESS THE CLAUDE FOR THIS CONVERSATION?
          #
          # This RECOGNISES A LAUNCHER-OWNED SHAPE. It does not reconstruct
          # argv, and it cannot: ps has already flattened the command line into
          # one string and destroyed the quoting, so a prompt containing a space
          # is indistinguishable from two arguments. What makes it work anyway is
          # that the shapes are ours -- scripts/gjd-remote.ts writes almost all
          # of them, and it emits a bare -- before every prompt.
          #
          # A HAND-CRAFTED argv CAN DEFEAT IT, and two ways are known. An empty
          # argv element -- ["claude","--session-id","",<uuid>] -- prints with a
          # doubled space, and the caller above rebuilds $4..$NF field by field,
          # so the empty element is gone before this function is called. And an
          # option value that CONTAINS an option -- ["claude","--name",
          # "innocent --session-id <uuid>"] -- prints identically to three real
          # arguments. Neither is reachable from any launcher here; both need
          # somebody to exec claude by hand with an argv built to fool this.
          # What that buys them is A MISLABELLED ROW in gjd-remote ls, not a
          # delivered keystroke: nothing steers on this verdict. Steering reads
          # faithful /proc argv through tools/fleet/steer.ts, which is a
          # different reader on a different input for that reason.
          #
          # And word one is a CLAIM, not an identity. cp $(which bash)
          # /tmp/claude and the copy passes this test; argv[0] is whatever the
          # execing process said it was. The basename check is here to stop a
          # grep answering for a claude, not to authenticate anything.
          #
          # The authority on the grammar is
          # docs/plans/260908h-one-shared-reader-for-a-claude-command-line.md.
          # The two TypeScript readers of the same grammar are recogniseClaude
          # (tools/overseer/harness.ts) and isClaudeForSession
          # (tools/fleet/steer.ts). This is the third, and it was a bare
          # index() substring search until 2026-09-08 -- precisely the test
          # steer.ts had already deleted as GPT Sol finding F3. Three ways that
          # was wrong, and they do not all fail in the same direction:
          #
          #  - No argv[0] check, so grep -r --session-id <uuid> logs/ answered
          #    yes, and so did a DIFFERENT conversation whose launch prompt
          #    quotes this uuid -- and the launcher does put whole prompts into
          #    argv, so that shape is real here. False positive: noise.
          #  - It needed a literal space, so --session-id=<uuid> never matched
          #    at all. False negative, and that is the expensive direction: a
          #    live agent reads as an empty pane. No process on the box used
          #    that spelling when this was written, so this half is durability
          #    rather than a fire.
          #  - It walked straight past a bare --, after which everything is
          #    positional by definition.
          #
          # Duplicates: accept only when EVERY occurrence before the boundary
          # is the same non-empty id. Two of the same id converge on one value
          # whichever end the CLI keeps; two that differ mean the answer
          # depends on a parser we do not own, so refuse rather than guess.
          # "Every occurrence" is every one the scan REACHES -- see the
          # bare-word rule below, which can end the scan before a later one.
          #
          # Missing values are refused in the same breath. The EMPTY inline
          # value earns its line: without it, --session-id= followed by a real
          # --session-id would leave the real one as the first non-empty value
          # and be accepted; a test holds that. The dash-leading value in the
          # SEPARATE spelling is held by a test too -- a session id set by hand
          # to -x, which sessionState already has an arm for, tells the guard
          # from its absence. An earlier version of this comment called it an
          # equivalent mutant that no command line could distinguish. THAT WAS
          # WRONG: it only holds while every id is a uuid, and CLAUDE_SESSION_ID
          # is an environment variable a person sets.
          #
          # The two spellings deliberately disagree about a dash-leading value,
          # and they agree with tools/fleet/claude-argv.ts in doing so:
          # --session-id=-x is ONE token and says the value is -x, while
          # --session-id -x cannot say whether -x is the value or the next flag,
          # so the shared reader calls that unreadable and this one refuses.
          # Agreeing with the other readers is worth more than the two spellings
          # agreeing with each other.
          #
          # STRING COMPARISON, EXPLICITLY, and this is a property of awk rather
          # than of the grammar. == compares two values NUMERICALLY when both
          # look like numbers, and both -v and split() produce exactly that kind
          # of value, so "01" and "1" were the same session id -- in gawk and in
          # mawk alike. Concatenating "" forces the string comparison the ids
          # need. Every id comparison below is written that way on purpose.
          #
          # WHERE THE OPTION REGION ENDS. At a bare --, or at the first bare
          # word ONCE AN ID HAS BEEN SEEN. The asymmetry is the point, and it is
          # what this function has instead of a table of which flags take
          # values:
          #  - BEFORE an id, a bare word may be the value of a flag this does
          #    not recognise (--permission-mode auto --session-id A), so the
          #    scan walks on. Stopping there would lose the id, which is the
          #    expensive direction.
          #  - AFTER one, everything our launcher puts before the prompt is
          #    already behind us, so a bare word is the prompt. Stopping there
          #    is what reads claude --session-id A Please compare
          #    --session-id B correctly, and that shape is real: a prompt typed
          #    by hand carries no --.
          # Two things it does NOT fix, both accepting rather than refusing. A
          # prompt that quotes the uuid of this pane, in a claude carrying no id
          # of its own, is still read as belonging to this session -- nothing
          # has been seen yet, so the scan is still walking. And a second,
          # differing id behind the value of an unknown flag is never reached,
          # so the all-must-agree rule does not fire on it. The alternative --
          # an arity table mirroring claude-argv.ts -- would fix both and was
          # rejected: a second copy of a table that must track a CLI we do not
          # own, in a language that cannot import it, to sharpen a labelling
          # probe whose worst outcome is a mislabelled row. Skipping what it
          # does not recognise is the one advantage this reader has over the
          # typed ones; an arity it guessed would be the thing that failed
          # quietly.
          function claudeForSession(a, want,   n, w, i, tok, val, bp, m, seen) {
            if (want == "") return 0
            n = split(a, w, " ")
            if (n < 1) return 0
            m = split(w[1], bp, "/")
            if (bp[m] != "claude") return 0
            seen = ""
            for (i = 2; i <= n; i++) {
              tok = w[i]
              if (tok == "--") break
              if (tok == "--session-id") {
                val = (i < n) ? w[i + 1] : ""
                i++
                if (val ~ /^-/) return 0
              } else if (index(tok, "--session-id=") == 1) {
                val = substr(tok, length("--session-id=") + 1)
              } else if (seen != "" && tok !~ /^-/) {
                break
              } else continue
              if (val == "") return 0
              if (seen == "") seen = val
              else if ((seen "") != (val "")) return 0
            }
            return ((seen "") == (want ""))
          }
          BEGIN { n=split(panes, p, "\\n"); for (i=1; i<=n; i++) if (p[i] != "") pane[p[i]]=1 }
          { a=$4; for (i=5; i<=NF; i++) a = a " " $i; A[$1]=a; E[$1]=$3; P[$1]=$2 }
          END {
            for (q in P) if ((pane[q] || pane[P[q]]) && claudeForSession(A[q], id)) { print "claude"; exit }
            for (q in P) if (pane[P[q]] && index(A[P[q]], "/gjd-remote/jobs/")) {
              split(A[q], w, " ")
              if (w[1] == "sleep" && w[2] ~ /^[0-9]+$/) { r = w[2] - E[q]; if (r > 0) { print "wait:" r; exit } }
            }
            for (q in P) if (pane[q]) {
              split(A[q], w, " "); c = w[1]
              sub(/^-/, "", c)
              nn = split(c, pp, "/"); c = pp[nn]
              if (c != "sh" && c != "bash" && c != "zsh" && c != "ksh" && c != "dash" &&
                  c != "ash" && c != "csh" && c != "tcsh" && c != "fish") { print "busy"; exit }
            }
            for (q in P) {
              if (pane[q]) continue
              d = P[q]
              for (k = 0; k < 32 && d != "" && d != "0" && d != "1"; k++) {
                if (pane[d]) { print "busy"; exit }
                if (!(d in P)) break
                d = P[d]
              }
            }
            print "none"
          }')
        case "$proc" in claude|none|busy|wait:[1-9]*) ;; *) proc='?' ;; esac
      fi
      # TWO KINDS OF TITLE RECORD, AND READING ONLY ONE OF THEM HID MOST OF THEM.
      # Claude Code writes an aiTitle record when it generates a title itself,
      # and a customTitle record when a person or a launcher chose one. Until
      # 2026-09-09 this read aiTitle alone, so every session launched by
      # gjd-remote with a name -- which is most of the fleet -- displayed as
      # untitled for its whole life. Measured on the box that morning: of 8 live
      # Claude sessions, 3 had an aiTitle and 8 had one or the other. Nothing in
      # this repo writes either record; the harness does.
      #
      # A CHOSEN TITLE WINS OUTRIGHT, AND "MOST RECENT" WOULD BE WRONG. The
      # harness emits the two AS A PAIR, customTitle first and aiTitle
      # immediately after, and it goes on doing so every time it re-titles -- so
      # the last record of either kind is always the generated one, and a rule
      # that took it would discard the chosen name every time. Census over every
      # transcript under ~/.claude/projects on 2026-09-09: 70 files carry a
      # customTitle, 3 of those also carry an aiTitle, and in all 3 the last
      # title record is the aiTitle. One of the 3 is the Overseer's own session,
      # where Greg had set "Overseer" and the page kept showing "Overseer and
      # fleet improvement roadmap".
      #
      # ONE READ OF THE FILE, because this grep is the dominant cost of a whole
      # collection -- gjd-remote ls takes 10-12s almost entirely here, over
      # multi-MB transcripts. The matches are then filtered twice, which is free
      # because there are a few dozen of them.
      #
      # WHAT THIS DOES NOT FIX, so nobody re-reports it as a bug: renaming a
      # TMUX SESSION writes nothing to the transcript. The tmux name is a
      # separate fact, carried on Session.name, and the page decides how to
      # show it.
      #
      # cut -f4 reads the value under either key: splitting on the quote gives
      # ["", key, ":", value], whichever key it was.
      #
      # NO BACKTICKS IN THIS COMMENT. The whole script is a TypeScript template
      # literal, so one would end it and the file would not parse.
      title=""
      if [ -n "$id" ]; then
        f=$(ls -1 "$HOME"/.claude/projects/*/"$id".jsonl 2>/dev/null | head -1)
        if [ -n "$f" ]; then
          titles=$(grep -oE '"(aiTitle|customTitle)":"[^"]*"' "$f" 2>/dev/null)
          title=$(printf '%s\n' "$titles" | grep '"customTitle"' | tail -1 | cut -d'"' -f4)
          [ -z "$title" ] && title=$(printf '%s\n' "$titles" | tail -1 | cut -d'"' -f4)
        fi
      fi
      printf '%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\\n' "$sid" "$created" "$attached" "$windows" "$prov" \\
        "$id" "$proc" "$(printf '%s' "$name" | base64 -w0)" "$(printf '%s' "$title" | base64 -w0)" \\
        "$mver" "$mkind" "$mrepo" "$(printf '%s' "$mdir" | base64 -w0)" "$mrole"
    done
    echo ${SESSION_SENTINEL}`;
}

/**
 * Ask the box how many keys tmux binds — the remote half of `doctor`'s `tmux`
 * check. Two numbers, because they can disagree and the disagreement is the
 * interesting state.
 *
 * `conf` is what a FRESH tmux server makes of `~/.tmux.conf`, on a throwaway
 * socket. `live` is what the server actually holding the sessions is doing
 * right now. They come apart because **a tmux server reads its config once, at
 * start**, and this one outlives provisioning by weeks: re-provisioning a live
 * box rewrites the file and changes nothing about the keyboard until somebody
 * runs `source-file`. That is a silent success — every visible check passes and
 * Ctrl-B is still eaten — so it gets its own number rather than an assumption.
 *
 * `live=none` rather than `live=0` when no server is running, and that is the
 * whole reason this is not one `grep -c`. `tmux list-keys` with no server prints
 * its complaint to stderr and nothing to stdout, so `grep -c` says 0 — which is
 * exactly the answer a perfectly configured box gives. The good state and the
 * "there was nothing to ask" state would be the same byte. Same shape as the
 * sentinel in buildSessionScript, for the same reason.
 *
 * The socket carries the shell's pid so two `doctor` runs cannot kill each
 * other's probe server halfway through counting.
 */
export function buildBindingsScript(): string {
  return `
    command -v tmux >/dev/null 2>&1 || { echo 'GJDERR tmux is not on this box'; exit 3; }
    if tmux ls >/dev/null 2>&1; then
      live=$(tmux list-keys 2>/dev/null | grep -c bind-key || true)
    else
      live=none
    fi
    sock=gjddoctor$$
    tmux -L "$sock" kill-server 2>/dev/null || true
    tmux -f "$HOME/.tmux.conf" -L "$sock" new-session -d 'sleep 10' >/dev/null 2>&1 || {
      echo 'GJDERR ~/.tmux.conf would not start a tmux server'; exit 3; }
    conf=$(tmux -L "$sock" list-keys 2>/dev/null | grep -c bind-key || true)
    tmux -L "$sock" kill-server 2>/dev/null || true
    printf 'live=%s conf=%s\\n' "$live" "$conf"
    echo ${SESSION_SENTINEL}`;
}

/**
 * The two numbers into a verdict, or an explanation of why there isn't one.
 *
 * FAILS CLOSED. Anything that is not the exact record this asked for is a
 * failure, not a pass — an unparsed reply and a clean box otherwise look alike,
 * which is the bug this whole module keeps being written around.
 */
export function bindingsVerdict(out: string): { ok: boolean; why: string } {
  const lines = out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const errLine = lines.find((l) => l.startsWith("GJDERR"));
  if (errLine) return { ok: false, why: errLine.slice("GJDERR".length).trim() };
  if (!lines.includes(SESSION_SENTINEL)) {
    return { ok: false, why: "the box did not finish counting its key bindings, so the answer may be short" };
  }

  const m = lines.map((l) => /^live=(none|0|[1-9]\d*) conf=(0|[1-9]\d*)$/.exec(l)).find(Boolean);
  if (!m) return { ok: false, why: "could not read the binding counts out of the reply" };
  const live = m[1]!;
  const conf = Number(m[2]!);

  // The file first: it is what every future tmux server on this box will read,
  // so it being wrong outlasts any one server.
  if (conf !== 0) {
    return { ok: false, why: `~/.tmux.conf binds ${conf} keys — re-provision, or see infra/hetzner/provision.sh` };
  }
  if (live !== "none" && Number(live) !== 0) {
    return {
      ok: false,
      // Not "re-provision": provisioning rewrites the file, which is already
      // right. Only source-file reaches a server that is already running.
      why: `the running tmux server still binds ${live} keys — tmux source-file ~/.tmux.conf`,
    };
  }
  return { ok: true, why: live === "none" ? "nothing bound (no server running)" : "nothing bound, file and server agree" };
}

/** base64 back to text, or null if it is not valid base64 of valid UTF-8. */
function decode(b64: string): string | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return null;
  const buf = Buffer.from(b64, "base64");
  // Buffer.from ignores what it cannot read rather than throwing, so the only
  // way to know it read the whole thing is to encode it again and compare.
  if (buf.toString("base64").replace(/=+$/, "") !== b64.replace(/=+$/, "")) return null;
  return buf.toString("utf8");
}

/**
 * What one line of the reply turned out to be.
 *
 * THREE OUTCOMES, NOT TWO, because the two failures are answered differently.
 * `why: null` is "this is not the record this function was written against" —
 * junk, a truncation, a field tmux left empty — and it goes into `unreadable`,
 * which the caller reports with the raw line. `why: string` is a record that
 * read perfectly and said something wrong, and it fails the whole listing with
 * a sentence naming the session and the variable.
 */
export type ParsedSessionLine = { ok: true; session: Session } | { ok: false; why: string | null };

/** Shared, because there are ten of them and they say nothing but "no". */
const NOT_A_RECORD: ParsedSessionLine = { ok: false, why: null };

/**
 * One line into a Session, or a refusal that says how badly.
 *
 * STRICT, and every clause here is a bug that reached the box. The first
 * version coerced whatever arrived: `Number("")` is 0, so a missing timestamp
 * became 1970; `"" !== "0"` is true, so a missing flag became "attached". A
 * whole fleet of sessions read as attached and 56 years old and nobody noticed,
 * because both columns looked like plausible output.
 *
 * The second version was strict about the fields tmux fills in and still
 * accepted a FOUR-field line, and any junk in the provisional slot silently
 * became `false` — which decides whether `ls` may rename a session out from
 * under its owner. GPT Sol found both. So: the field count is exact, and every
 * field must be one of the values it is allowed to be.
 */
export function parseSessionLine(line: string): ParsedSessionLine {
  const parts = line.split("|");
  // Exactly fourteen: id, created, attached, windows, provisional, claude id,
  // wait remaining, name, title, the four metadata fields, and the role. Not "at
  // least fourteen" — a fifteenth field means the record is not the one this
  // function was written against, and guessing which is which is how the last
  // two bugs happened. No free-text field can contribute a separator: the name,
  // the title, the directory and the role all arrive base64-encoded.
  if (parts.length !== 14) return NOT_A_RECORD;
  const [sid, created, attached, windows, prov, claudeId, procField, nameB64, titleB64, mv, mk, mr, mdB64, roleB64] =
    parts as [
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
      string,
    ];

  // tmux's own session handle: a dollar and digits. Nobody is shown it, but it
  // is what every command that acts on a session addresses it BY — see
  // `Session.id` — so if it is not that shape then the record did not come from
  // tmux and nothing may be done with it.
  if (!/^\$\d+$/.test(sid)) return NOT_A_RECORD;

  // A tmux timestamp is seconds since the epoch and is never 0 for a live
  // session. Number("") is 0 and Number(undefined) is NaN — both must fail here
  // rather than downstream, where they become a date.
  // Digits only, checked as a STRING before it is a number: `Number("17e9")`
  // is a perfectly good integer and tmux has never emitted one, so accepting it
  // means accepting something that did not come from tmux.
  if (!bounded(created)) return NOT_A_RECORD;
  const stamp = Number(created);
  // Bounded is not enough on its own: this is multiplied by 1000, and a value
  // that is a safe integer in seconds need not be one in milliseconds. Sol
  // passed 1000000000000000 through the first version and got a Date whose
  // getTime() is NaN, which the AGE column rendered as `NaNd`. The check is on
  // the thing actually constructed.
  if (!Number.isFinite(new Date(stamp * 1000).getTime())) return NOT_A_RECORD;

  if (attached !== "0" && attached !== "1") return NOT_A_RECORD;
  // Junk here used to become `false`, and this flag decides whether `ls` may
  // rename a session out from under whoever named it.
  if (prov !== "0" && prov !== "1") return NOT_A_RECORD;

  if (!bounded(windows)) return NOT_A_RECORD;
  const windowCount = Number(windows);

  // NOT CHECKED FOR BEING A UUID, and that is deliberate. Everything else in
  // this record comes from tmux; this one comes from a tmux environment
  // variable, which anybody can set to anything by hand. Rejecting the line
  // would put it in `unreadable`, and `sessions()` refuses to hand back a list
  // it knows is short — so one mistyped variable on one session would take
  // down `ls`, `new-claude` and `resume` for the whole box. `sessionState`
  // checks the shape instead, where the cost of a bad one is that single row
  // saying `unknown`. (A `|` inside it still fails, on the field count above.)

  const proc = parseProc(procField);
  if (proc === null) return NOT_A_RECORD;

  const name = decode(nameB64);
  const title = decode(titleB64);
  if (name === null || title === null || name === "") return NOT_A_RECORD;

  // The name is decoded first so a refusal can say WHICH session to go and look
  // at. A metadata failure is not "a line we could not read" — the line read
  // perfectly, and what it said was wrong.
  const meta = parseMeta({ version: mv, kind: mk, repo: mr, dirB64: mdB64 }, name);
  if (!meta.ok) return meta;

  // THREE OUTCOMES FOR THE ROLE FIELD, and the middle one is the whole reason
  // the script dumps the environment rather than asking by name:
  //
  //  - the sentinel — the session's environment could not be read at all, so we
  //    do not know whether it holds a claim;
  //  - undecodable bytes — a broken line, the way an undecodable name is: the
  //    script always base64s this field, so anything else did not come from the
  //    script;
  //  - anything else — a value, which `parseRole` judges without ever failing
  //    the listing over a word it does not know.
  let role: SessionRole;
  if (roleB64 === ROLE_UNREADABLE) {
    role = { kind: "cannot-tell", why: "this session's environment could not be read, so its role is unknown" };
  } else {
    const roleValue = decode(roleB64);
    if (roleValue === null) return NOT_A_RECORD;
    role = parseRole(roleValue);
  }

  return {
    ok: true,
    session: {
      name,
      created: new Date(stamp * 1000),
      attached: attached === "1",
      windows: windowCount,
      // A session that has never run Claude legitimately has no title, so an
      // empty one is information rather than damage.
      title: title.trim(),
      id: sid,
      provisional: prov === "1",
      claudeId: claudeId === "" ? null : claudeId,
      proc,
      meta: meta.meta,
      role,
    },
  };
}

/**
 * One role value into a `SessionRole`. **Never fails the listing.**
 *
 * That is the difference between this and `parseMeta` next door, and it is
 * deliberate. A metadata version this reader does not know means the launcher
 * and the reader disagree about the record's shape, so nothing in it can be
 * trusted. A role it does not know means somebody claimed a role — the record is
 * fine, one word in it is new. Refusing the listing over that would take down
 * `ls`, `resume` and `kill` for the whole box, and would do it to whoever is
 * running the older copy of `gjd-remote`, who is exactly the person least able
 * to work out why.
 *
 * The three non-`none` arms all mean *this session is not the Overseer* unless
 * the value is `OVERSEER_ROLE` exactly, so nothing here can mint a claim.
 */
export function parseRole(value: string): SessionRole {
  if (value === "") return { kind: "none" };
  if (value === OVERSEER_ROLE) return { kind: "overseer" };
  if (ROLE_TOKEN.test(value)) return { kind: "other", name: value };
  return {
    kind: "cannot-tell",
    // The value is not quoted back: it is somebody's environment variable and
    // this string is printed into a terminal. Its length is the actionable part.
    why: `${SESSION_ROLE_ENV} is set to something this reader cannot make sense of (${value.length} characters)`,
  };
}

/**
 * The four metadata fields into a `SessionMeta`, or a sentence saying which
 * session and which variable made it impossible.
 *
 * FAILS THE LISTING, NOT THE ROW. Every other refusal in this file drops the
 * line into `unreadable`, which the caller already treats as fatal — but it
 * carries the raw record and no reason, and "GJD_REPO on `newer` is empty" is
 * the difference between a fix and a mystery. So metadata gets a message.
 *
 * The legacy arm is deliberately narrow: all four absent, and nothing else.
 * Half the metadata means the launcher wrote some of it and lost the rest, and
 * a partially-written record displayed as a pre-metadata one is the exact
 * confusion the version was added to prevent.
 */
function parseMeta(
  f: { version: string; kind: string; repo: string; dirB64: string },
  name: string,
): { ok: true; meta: SessionMeta } | { ok: false; why: string } {
  const bad = (why: string) => ({ ok: false as const, why: `session '${name}' ${why}` });

  if (f.version === "") {
    if (f.kind === "" && f.repo === "" && f.dirB64 === "") return { ok: true, meta: { version: "legacy" } };
    return bad(`carries session metadata but no ${META.version}, so it is neither an old session nor a new one`);
  }
  if (f.version !== METADATA_VERSION) {
    return bad(`says ${META.version}=${f.version}, and this gjd-remote only knows version ${METADATA_VERSION}`);
  }

  const kind = SESSION_KINDS.find((k) => k === f.kind);
  if (kind === undefined) return bad(`has ${META.kind}='${f.kind}', which is not one of ${SESSION_KINDS.join(", ")}`);

  if (!isRepoValue(f.repo)) {
    return bad(`has ${META.repo}='${f.repo}', which is neither an owner/name slug nor '${REPO_UNKNOWN}'`);
  }

  const dir = decode(f.dirB64);
  if (dir === null) return bad(`has a ${META.dir} this laptop could not decode`);
  // Absolute, because it is the box's own path and everything downstream joins
  // onto it. A relative one would resolve against whatever the reader's cwd
  // happens to be, which is a different machine.
  if (!dir.startsWith("/") || dir.length > 4096) {
    return bad(`has ${META.dir}='${dir}', which is not an absolute path on the box`);
  }

  return { ok: true, meta: { version: 1, kind, repo: f.repo, dir } };
}

/**
 * What the REPO column shows, and whether it is a real answer.
 *
 * `known: false` is the caller's cue to dim the cell — the same treatment a
 * session with no title gets. Both unknowns render as one word: a session from
 * before the metadata existed, and a session started against an arbitrary
 * `--dir`, cannot be attributed to a repo, and a distinction the reader cannot
 * act on is worth less than one honest word.
 */
export function sessionRepo(s: Session): { text: string; known: boolean } {
  if (s.meta.version === "legacy" || s.meta.repo === REPO_UNKNOWN) return { text: "(unknown)", known: false };
  return { text: s.meta.repo, known: true };
}

/* ------------------------------------------------------------------ *
 * The Overseer's claim.
 * ------------------------------------------------------------------ */

/**
 * Who holds the Overseer claim, across a whole listing.
 *
 * **Defined once, in [`tools/fleet/overseer-claim.ts`](../tools/fleet/overseer-claim.ts)**,
 * so the terminal and the dashboard cannot disagree about what one holder plus
 * one unreadable row means. This is the thin adaptor from `Session` to the rows
 * that module works on.
 */
export function overseerClaim(list: readonly Session[]): OverseerClaim {
  return wireOverseerClaim(list.map((s) => ({ id: s.id, name: s.name, role: s.role })));
}

/**
 * What `claim-overseer` and `release-overseer` should do, decided before
 * anything is written.
 *
 * A separate function from the command that carries it out so the decision can
 * be tested against a listing, and so that the refusal — the whole point of the
 * verb — is not buried in a CLI.
 */
export type RoleChange =
  | { kind: "claim"; id: string; name: string }
  | { kind: "release"; id: string; name: string }
  | { kind: "already-yours" }
  | { kind: "refused"; why: string };

/**
 * **THE CONTRACT IS EVENTUAL DETECTION, NOT MUTUAL EXCLUSION**, and the
 * difference is worth being exact about (GPT Sol's P1-1).
 *
 * The decision is made against a listing read a moment ago and carried out by a
 * second tmux call, so this sequence is reachable and this function does not
 * prevent it: A and B both read no holder; A sets its role; A re-reads and is
 * satisfied; B sets its role; the box is now contested. The re-read after a
 * write is not a lock — it narrows the window and catches the ordinary case, and
 * what actually holds the line is that **every reader reports two holders as a
 * fault rather than picking one**, so a double claim is visible on the next quiet
 * read rather than silently deciding which session the scheduler prods.
 *
 * That is accepted rather than fixed. A real mutex means a lock file with an
 * owner pid and a liveness check — the machinery this whole design exists to
 * avoid — for a verb a person runs about once a week.
 */
export function decideClaim(list: readonly Session[], target: string): RoleChange {
  const found = resolveSession(list, target);
  if (!found.ok) return { kind: "refused", why: found.why };

  const claim = overseerClaim(list);
  switch (claim.kind) {
    case "one":
      return claim.id === found.session.id
        ? { kind: "already-yours" }
        : {
            kind: "refused",
            why:
              `${printableName(claim.name)} already holds the Overseer claim.` +
              `\n  There is no --force. Release it there first: gjd-remote release-overseer ${printableName(claim.name)}` +
              `\n  (or kill that session — the claim dies with it).`,
          };
    case "contested":
      return {
        kind: "refused",
        why:
          `${claim.names.length} sessions already claim to be the Overseer: ${claim.names.join(", ")}` +
          `\n  Release all but one before claiming.`,
      };
    case "cannot-tell":
      // Deliberately not "claim anyway". The unreadable role might be on the
      // target itself, and overwriting a value nobody has looked at is how a
      // claim silently replaces something it did not understand.
      return { kind: "refused", why: `${claim.why}\n  Look at those sessions before claiming.` };
    case "none":
      return { kind: "claim", id: found.session.id, name: found.session.name };
    default: {
      const never: never = claim;
      return never;
    }
  }
}

/**
 * Releasing a session that does not hold the claim is a refusal, never a silent
 * success — it is otherwise indistinguishable from having released it.
 *
 * **It does NOT refuse a contested box, and the postcondition is about the
 * TARGET.** If two sessions both claim the role, releasing one is the repair,
 * and demanding that the box end up with zero holders would refuse the very
 * operation that fixes it — or, worse, call a good release a failure because
 * the other claimant is still there. GPT Sol's P1-2. So `decideClaim` asks about
 * the whole box, because a claim is about being the only one, and this one asks
 * only about the session in front of it.
 */
export function decideRelease(list: readonly Session[], target: string): RoleChange {
  const found = resolveSession(list, target);
  if (!found.ok) return { kind: "refused", why: found.why };
  if (found.session.role.kind !== "overseer") {
    return {
      kind: "refused",
      why: `${printableName(found.session.name)} does not hold the Overseer claim, so there was nothing to release.`,
    };
  }
  return { kind: "release", id: found.session.id, name: found.session.name };
}

/**
 * Did a release actually take? **Asked of the target, and `cannot-tell` is not a
 * yes.**
 *
 * The first version asked `role.kind !== "overseer"`, which a target whose role
 * could not be read satisfies — so the command printed a green success without
 * knowing whether anything had happened. GPT Sol, second review. There are
 * exactly two ways for a release to have worked:
 *
 *  - the session is no longer in the listing, because dying releases the claim;
 *  - it is there and its role is now, positively, `none`.
 *
 * A role we could not read is neither, and `other` is not either — a release
 * that turned the role into some other word did not do what was asked.
 */
export function releaseSucceeded(list: readonly Session[], id: string): boolean {
  const target = list.find((s) => s.id === id);
  return target === undefined || target.role.kind === "none";
}

/**
 * The one tmux command that writes or removes a claim.
 *
 * THE ID IS QUOTED because tmux's own handles look like shell positional
 * parameters: an unquoted `$2514` expands to the empty string, and the command
 * then addresses whatever session tmux considers current — the same trap
 * `gjd-remote`'s kill path has a comment about.
 *
 * Throws rather than returning a refusal on a bad id: every caller gets its id
 * from a parsed listing, so a value that is not tmux's shape is a programming
 * error and not a thing a person did.
 */
export function setRoleCommand(sessionId: string, role: string | null): string {
  if (!TMUX_ID.test(sessionId)) throw new Error(`not a tmux session id: ${sessionId}`);
  if (role === null) return `tmux set-environment -u -t '${sessionId}' ${SESSION_ROLE_ENV}`;
  if (!ROLE_TOKEN.test(role)) throw new Error(`not a role token: ${role}`);
  return `tmux set-environment -t '${sessionId}' ${SESSION_ROLE_ENV} '${role}'`;
}

/**
 * The five shapes the process probe is allowed to have, and nothing else.
 *
 * A token this reader was not written against is a broken record, not a shrug:
 * it decides whether a session is reported as scheduled, running or gone, and
 * quietly rounding an unrecognised one to `none` is how a row would claim
 * "no claude" about a session with a Claude in it.
 */
function parseProc(field: string): SessionProc | null {
  if (field === "claude") return { kind: "claude" };
  if (field === "busy") return { kind: "busy" };
  if (field === "none") return { kind: "none" };
  if (field === "?") return { kind: "unknown" };
  const m = /^wait:([1-9]\d{0,8})$/.exec(field);
  if (!m) return null;
  return { kind: "wait", secondsLeft: Number(m[1]) };
}

/**
 * A digit string tmux is allowed to have printed.
 *
 * Bounded, and that is Sol's point rather than paranoia: `/^[1-9]\d*$/` accepts
 * four hundred digits, `Number` turns that into `Infinity`, and `new
 * Date(Infinity)` is an Invalid Date that `age()` renders as `NaNm`. Nine
 * digits is larger than any pid, window count or epoch second this will see.
 */
const bounded = (v: string) => /^[1-9]\d{0,15}$/.test(v) && Number.isSafeInteger(Number(v));

/** A uuid as `claude --session-id` mints them, and nothing else. */
const SESSION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * `claude agents --json` into a status per session id.
 *
 * The array is Claude Code's, not ours, so every field is checked — and ONE BAD
 * RECORD FAILS THE WHOLE REPLY rather than being skipped. That is Sol's
 * correction to the first version, which skipped them, and it matters because
 * of what schema drift looks like: rename `sessionId` to `session_id` in some
 * later Claude Code and every record is skipped, leaving a perfectly healthy
 * EMPTY MAP — and an empty map means "no Claude is running anywhere", which is
 * a confident wrong answer on every row at once. A short list of statuses is
 * indistinguishable from a correct one, which is the rule the session parse
 * already lives by.
 *
 * A `status` this version has never heard of is kept as the raw string, so
 * `sessionState` can say "I do not know what that means" instead of quietly
 * rounding it to `idle`.
 */
export function parseAgents(json: string): Map<string, string> | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(raw)) return null;
  const out = new Map<string, string>();
  for (const item of raw) {
    if (typeof item !== "object" || item === null) return null;
    const o = item as Record<string, unknown>;
    const id = o.sessionId;
    const status = o.status;
    if (typeof id !== "string" || !SESSION_UUID.test(id)) return null;
    if (typeof status !== "string" || status === "") return null;
    // Claude Code contradicting itself about one session. It has not happened,
    // and if it starts, "last one wins" is a coin flip on a row that decides
    // whether somebody is being waited on.
    if (out.has(id)) return null;
    out.set(id, status);
  }
  return out;
}

/**
 * What is actually going on in this session.
 *
 * TWO SOURCES, AND NEITHER IS TRUSTED ALONE. `claude agents --json` is the only
 * thing that can tell busy from idle from parked-on-a-question, and it is
 * first-party — but **being absent from it does not mean not running**. That is
 * measured, not feared: on 2026-09-01, twice, a session started with `--dir ~`
 * had a live `claude --session-id <uuid>` for at least 35 seconds and `agents
 * --json` matched it zero times, while the same launch inside the repo checkout
 * matched within 25 seconds. So the JSON says *listed*, not *running*
 * (docs/plans/260901a-gjd-remote-wait-duration-and-ssh-command.md). The process
 * table is the second source, and it is what stops an unlisted session being
 * reported as a dead one.
 *
 * THE ORDER IS THE DESIGN, and every clause is a pair of states that would
 * otherwise be told apart wrongly:
 *
 *  - **shell** first, because a session with no Claude in it was never going to
 *    appear in the agents list, and running it through the rest would report
 *    every `new-shell` as a Claude that had exited. It carries `busy` because a
 *    shell is the one state where "is anything happening in there?" is the
 *    whole question, and a bare `shell` said it about a session running the
 *    test suite and about a prompt abandoned fifteen hours earlier alike.
 *  - **a hand-set id** cannot join to anything, and saying so is not the same
 *    as saying there is no Claude here.
 *  - **waiting** before the agents list is consulted, so `--wait` still reports
 *    a countdown on a box where `claude agents` is broken or missing. The
 *    evidence is our own job script still running with a live `sleep` under it;
 *    a Claude cannot be running in the same pane at the same time.
 *  - **unknown** whenever the agents call failed. Without this clause a box
 *    where `claude` is missing shows a screen of confident "no claude" — right
 *    by accident for none of the rows, and indistinguishable from the truth.
 *  - **the three live states** come from Claude Code itself. `waiting` is the
 *    one worth having: it means a permission prompt is on screen and the
 *    session will sit there until somebody answers it. Verified on the box on
 *    2026-09-01 against a session parked on "Do you want to proceed?".
 *  - **a status we do not recognise** is `unknown`, not a guess. A future
 *    Claude Code could add one, and the wrong half of that coin flip is a
 *    session reported as finished while it waits for you.
 *  - **running but not listed** is the measured case above, and it is the
 *    reason this function takes a process probe at all.
 *  - **no-claude** is the last word rather than "exited" because it is the one
 *    that is true in every case that reaches it: Claude exited, or the job
 *    never got that far. `gjd-remote log` is where "did it ever run?" is
 *    answered properly, and it has the evidence for it.
 *  - **a probe we could not run** is its own answer, never folded into
 *    no-claude.
 */
export function sessionState(s: Session, agents: Map<string, string> | null): SessionState {
  if (s.claudeId === null) {
    // `unknown` becomes null rather than false: "nothing is running in it" and
    // "we could not look" are the same emptiness, and this file exists because
    // that emptiness keeps getting read as an answer.
    return { kind: "shell", busy: s.proc.kind === "unknown" ? null : s.proc.kind !== "none" };
  }
  // Somebody set CLAUDE_SESSION_ID by hand to something that is not a session
  // id. It cannot join to anything, so there is nothing to say about this row —
  // but there IS a session, and reporting it as a shell would be a claim rather
  // than an admission.
  if (!SESSION_UUID.test(s.claudeId)) {
    return { kind: "unknown", cause: "not-a-session-id", why: "its CLAUDE_SESSION_ID is not a Claude session id" };
  }

  if (s.proc.kind === "wait") return { kind: "waiting", secondsLeft: s.proc.secondsLeft };

  if (agents === null) {
    return { kind: "unknown", cause: "agents-unavailable", why: "the box could not say what Claude is doing" };
  }

  const status = agents.get(s.claudeId);
  if (status === "waiting") return { kind: "needs-you" };
  if (status === "busy") return { kind: "working" };
  if (status === "idle") return { kind: "idle" };
  // Anything still here is a status Claude Code has and this version has not.
  // Not a guess: the wrong half of that coin flip is a session reported as
  // finished while it sits waiting for somebody.
  if (status !== undefined) {
    return {
      kind: "unknown",
      cause: "unrecognised-agent-status",
      why: `Claude Code calls this '${status}', which this version does not know`,
      // The only site that sets it, and the only one that has anything to set
      // it from. See `reportedStatus` on the union: the cause says which fault
      // this is, the token says what the box saw, and a watcher needs both or
      // it reads two successive unfamiliar statuses as one unchanging session.
      reportedStatus: status,
    };
  }

  if (s.proc.kind === "claude") {
    return { kind: "unknown", cause: "running-but-unlisted", why: "its Claude is running, but Claude Code did not list it" };
  }
  if (s.proc.kind === "unknown") {
    return { kind: "unknown", cause: "process-probe-unavailable", why: "the box could not look at what is running in it" };
  }
  return { kind: "no-claude" };
}

/**
 * **Which session a typed name means — the ONLY way any command may act on one.**
 *
 * `ls` lists every tmux session on the box, not only the ones this tool made:
 * an agent running `tmux new-session -d -s gateA` to hold a long `npm test` is
 * a row like any other. So the set of names that can appear is the set tmux
 * accepts, which is far wider than `SLUG` — and `SLUG` is a rule about names
 * this tool is willing to MINT, not about names it is willing to ACT ON.
 *
 * Confusing the two is the bug this function exists to kill. Until 2026-09-05
 * `kill` and `resume` tested the typed name against `SLUG`, so `gjd-remote kill
 * gateA` answered with the usage string — which reads like "you forgot the
 * argument" — and left the session running. Every name with a capital letter in
 * it was listed by the tool and untouchable by it.
 *
 * **It returns the session, and callers address it by `.id`.** Resolving to a
 * name and then using the name leaves a window in which the session can die and
 * another take its name, and a `kill` landing on the wrong session is not an
 * error you get to take back. Sol's point, and cheap to honour.
 *
 * One caveat on that id, also Sol's: `$N` is unique within a RUNNING tmux
 * server, not for all time. If the last session on the box ends, the server
 * exits and a new one starts, `$0` comes round again. Every command here reads
 * the list and acts within the same second or two, and the box is never empty,
 * so it is not worth a generation check — but it is worth knowing that the
 * guarantee is server-lifetime rather than absolute.
 */
/** tmux's own session handle: a dollar and digits, and nothing else. */
const TMUX_ID = /^\$\d+$/;

export function resolveSession(
  list: readonly Session[],
  name: string,
): { ok: true; session: Session } | { ok: false; why: string } {
  const found = list.find((s) => s.name === name);
  if (found) return { ok: true, session: found };
  // A tmux id is accepted too, so `resume-all` can address the session it
  // actually saw rather than re-resolving a name in a tab it opens seconds
  // later. NAME FIRST, always: a session really called `$3` is somebody's
  // session and answering with a different one because the string looks like an
  // id would be the exact substitution this function exists to prevent.
  if (TMUX_ID.test(name)) {
    const byId = list.find((s) => s.id === name);
    if (byId) return { ok: true, session: byId };
  }
  // Not a list of all of them: on this box that is two dozen names, and the
  // recovery is `gjd-remote ls`, which is one word and formats them properly.
  // A close match is worth printing because the usual cause is a typo.
  const near = list.find((s) => s.name.toLowerCase() === name.toLowerCase());
  return {
    ok: false,
    why:
      `no live session named ${printableName(name)}` +
      (near ? ` — did you mean ${printableName(near.name)}?` : "") +
      `\n  'gjd-remote ls' lists what is live on the box.`,
  };
}

/**
 * A session name, safe to put in a terminal.
 *
 * Shell quoting is not the whole of it. A tmux session name may contain control
 * characters, and printing one raw hands the reader's terminal an escape
 * sequence off the box — so a name can move the cursor, repaint the table, or
 * hide itself from the row it is on. Sol raised it; it costs one regex.
 *
 * Quoted as well as escaped, because a name may also be empty-looking, have
 * leading spaces, or consist of them.
 */
// Matching control characters is the entire point of this regex.
// biome-ignore lint/suspicious/noControlCharactersInRegex: see above
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g;

/**
 * The escaping alone, with no quotes — for the `ls` table, where a column of
 * quoted names would be noise and the padding has to be the width on screen.
 *
 * **Every place a name is printed needs one of these two.** The first version
 * had only `printableName` and used it in error messages, leaving the table
 * itself — the one thing that prints all two dozen names — writing them raw. A
 * helper that is not called at the site that matters is not a defence. Sol's
 * finding, in review.
 */
export function escapeName(name: string): string {
  return name.replace(CONTROL, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
}

/** The same, quoted — for a name inside a sentence, where its bounds matter. */
export function printableName(name: string): string {
  return `'${escapeName(name)}'`;
}

/**
 * Seconds into something a person reads at a glance: `45s`, `12m`, `3h52m`, `1d4h`.
 *
 * Two units at most, and the small one is dropped once the big one is large
 * enough that nobody cares — `3h52m` is worth the extra characters, `1d4h17m`
 * is not.
 */
export function formatWait(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const mins = Math.floor(s / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return mins % 60 === 0 ? `${hours}h` : `${hours}h${mins % 60}m`;
  const days = Math.floor(hours / 24);
  return hours % 24 === 0 ? `${days}d` : `${days}d${hours % 24}h`;
}

/**
 * The one control line about Claude Code, read into a status map or an excuse.
 *
 * EXACTLY ONE, OR NONE — never two, and never one of each. Two answers to one
 * question is a reply that has been interleaved with something, and picking one
 * of them is picking at random. None is legitimate: `ls` is the only caller
 * that asks, so every other command's reply has no line here at all.
 */
function readAgents(
  lines: string[],
): { agents: Map<string, string> | null; agentsWhy: string | null } | { failure: string } {
  if (lines.length > 1) return { failure: "the box answered twice about what Claude is doing" };
  const line = lines[0];
  if (line === undefined) return { agents: null, agentsWhy: null };
  if (line === AGENTS_FAIL || line.startsWith(`${AGENTS_FAIL} `)) {
    return { agents: null, agentsWhy: line.slice(AGENTS_FAIL.length).trim() || "the box did not say why" };
  }
  const decoded = decode(line.slice(AGENTS_OK.length).trim());
  const parsed = decoded === null ? null : parseAgents(decoded);
  // A reply that says it worked and then cannot be read is a failure, not an
  // empty list. An empty list is a real and common answer — a box with tmux
  // sessions but no Claude in any of them — so the two cannot share a
  // representation.
  if (parsed === null) return { agents: null, agentsWhy: "could not read what the box said about Claude's sessions" };
  return { agents: parsed, agentsWhy: null };
}

/**
 * Every session, or an explanation of why the answer cannot be trusted.
 *
 * FAILS CLOSED twice over, and both matter. Without the sentinel, a tmux that
 * is missing or broken reads as a box with no sessions. Without `unreadable`,
 * one bad line quietly shortens the list — and callers reason about a list from
 * its absences: `cmdNew` decides a name is free when it is taken, `resume` with
 * no name attaches to the wrong "most recent". A short list is
 * indistinguishable from a correct one, so it must not be produced.
 */
export function parseSessions(out: string): {
  sessions: Session[];
  unreadable: string[];
  failure: string | null;
  /** Status by session id, or null when the box could not be asked (or was not). */
  agents: Map<string, string> | null;
  /** Why `agents` is null, for saying so out loud. Null when it is not, and
   *  null when the caller did not ask for it. */
  agentsWhy: string | null;
} {
  const lines = out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  const bad = (failure: string) => ({ sessions: [], unreadable: [], agents: null, agentsWhy: null, failure });

  const errLine = lines.find((l) => l.startsWith("GJDERR"));
  if (errLine) return bad(errLine.slice("GJDERR".length).trim());

  // THE SENTINEL MUST BE THE LAST WORD, not merely present. Sol's point: a
  // reply that signs off and then keeps talking is a reply something else got
  // into, and taking the lines before the signature and ignoring the rest is
  // reading half of a message that has already gone wrong.
  const end = lines.length - 1;
  if (end < 0 || lines[end] !== SESSION_SENTINEL) {
    return bad(
      lines.includes(SESSION_SENTINEL)
        ? "the box printed something after it had finished listing its sessions, so the reply is not the one this asked for"
        : "the box did not finish listing its sessions (no completion marker), so the list may be short",
    );
  }
  const body = lines.slice(0, end);

  // The control lines are pulled out first, because they are not session
  // records and must not be counted as unreadable ones — an unreadable line is
  // fatal to the whole listing, by design.
  // Marker plus a space, or the marker alone — never merely "starts with".
  // `startsWith(AGENTS_FAIL)` accepted `GJDAGENTSFAILURE bogus` and read its
  // reason as "URE bogus", which fails safely and is still not what this says
  // it does. Sol's point.
  const marked = (l: string, m: string) => l === m || l.startsWith(`${m} `);
  const control = body.filter((l) => marked(l, AGENTS_OK) || marked(l, AGENTS_FAIL) || marked(l, ROW_COUNT));

  const counts = control.filter((l) => marked(l, ROW_COUNT));
  if (counts.length !== 1) return bad(`the box gave ${counts.length} row counts, and this needs exactly one`);
  // Built from the constant rather than spelling it again: a second copy of a
  // marker is a copy that stops matching the day somebody renames the first.
  const declared = new RegExp(`^${ROW_COUNT} (0|[1-9]\\d{0,4})$`).exec(counts[0] as string);
  if (!declared) return bad(`could not read the box's row count out of '${counts[0]}'`);

  const said = readAgents(control.filter((l) => !marked(l, ROW_COUNT)));
  if ("failure" in said) return bad(said.failure);
  const { agents, agentsWhy } = said;

  const sessions: Session[] = [];
  const unreadable: string[] = [];
  for (const line of body) {
    if (control.includes(line)) continue;
    const parsed = parseSessionLine(line);
    if (parsed.ok) {
      sessions.push(parsed.session);
      continue;
    }
    // A record whose METADATA is wrong fails the listing here and now, rather
    // than joining the unreadable pile. It is not a line that failed to arrive
    // — it arrived intact and contradicted itself — and the caller can only act
    // on that if it is told which session and which variable. GPT Sol, finding
    // 8: a silently-degraded row would put `(unknown)` against a session whose
    // repo the box knows perfectly well.
    if (parsed.why !== null) return bad(parsed.why);
    unreadable.push(line);
  }

  // The count tmux gave against the count that arrived. This is the guard that
  // would have caught the dropped last row for the whole life of the script —
  // see ROW_COUNT — and it catches the next way of losing one too.
  const seen = sessions.length + unreadable.length;
  if (seen !== Number(declared[1])) {
    return bad(`tmux listed ${declared[1]} session(s) and ${seen} reached this laptop, so the list is not the box's`);
  }

  return { sessions, unreadable, failure: null, agents, agentsWhy };
}
