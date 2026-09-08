/**
 * What is the process tree under this pane actually DOING?
 *
 * ## The finding this exists for
 *
 * `docs/project/orchestrator-direction.md` § "`idle` is the bug: the vocabulary
 * describes the pane, not the work". Measured on the live fleet 2026-09-08:
 * **4 sessions were running `codex exec` and 0 of them showed as anything but
 * `idle`**, because a GPT review runs inside a Claude session's Bash tool and
 * the pane, for the 15-45 minutes it takes, looks exactly like a pane with
 * nobody at it. In the dashboard agent's words: *"our vocabulary describes the
 * pane, and the thing Greg wants to know is about the work."*
 *
 * The direction doc splits that finding in two, and this file is the half it
 * calls mechanical: *"Subprocess ancestry is in the process table, so the Codex
 * case is mechanically detectable and should be - a status arm, not a model
 * call."* Nothing here reads prose, calls a model, or guesses at intent. The
 * other half - has this agent asked Greg something in sentences - is a
 * judgement and is not attempted here.
 *
 * ## The seam
 *
 * The dashboard reports the pane; the Overseer decides what the work is. So
 * this does NOT add an arm to the dashboard's `SessionState` - that union is
 * consumed by exhaustive switches all over `tools/fleet/`, and it is the
 * dashboard's word for what its own two sources say. This takes the `panePid`
 * the snapshot already carries (`ObservedRow.panePid`) and forms an
 * independent, second opinion. Two vocabularies, deliberately: a row can be
 * honestly `idle` (Claude Code is not generating) and honestly mid-review at
 * the same time, and flattening those into one word is what lost the four
 * sessions.
 *
 * ## Probe and classifier are separate on purpose
 *
 * `classifyPaneWork` is pure over a plain snapshot of the process table, so it
 * can be tested against captures taken off this box
 * (`tests/fixtures/overseer-process-trees/`). The thing that actually runs `ps`
 * lives in `work-probe.ts` and is a thin adapter. Nothing here reaches for the
 * process table, and nothing at module scope does anything.
 *
 * ## The tree you walk is a moment, not a fact
 *
 * **Races are the normal case here, not the edge case.** A process can exit
 * between `ps` writing its row and `ps` writing its child's, so a reading can
 * contain a child whose parent is already gone; a pid can be reused; the whole
 * subtree can vanish a millisecond after the read. Everything downstream must
 * treat a `WorkReading` as *what was true at that instant*, never as *what is
 * true*. Concretely:
 *
 *  - a job disappearing between two readings means the job finished OR the read
 *    was unlucky, and nothing in a single reading can tell those apart;
 *  - `no-child-work` is a statement about one instant, and a review that ran for
 *    forty minutes can still be missed by a reading taken in the gap between two
 *    `codex` invocations;
 *  - `pid` is unique only for as long as the process lives. A `ChildJob.pid`
 *    kept and looked up later may name a stranger. `started` is carried
 *    alongside it so a later stage has something to check that against —
 *    **but it must be compared with a tolerance of at least a second, never for
 *    equality.** `etimes` counts whole seconds, so the same process read at
 *    `S+10.2s` and at `S+11.8s` yields derived starts 600 ms apart; an exact
 *    comparison makes an unchanged process look replaced, which is the same
 *    manufactured event `observation.ts` refuses elsewhere. Distinguishing two
 *    processes that started within a second of each other needs a stable kernel
 *    start identifier, which this does not have.
 *
 * **And nothing here can detect pid REUSE.** If the pane exits between the
 * dashboard's collection and this read and its pid is handed out again, this
 * walks a stranger's tree and answers confidently about it. The fix is not
 * available at this seam: it needs a pane identity stronger than a bare number,
 * or a re-check against tmux at the moment of the read. Recorded rather than
 * papered over.
 */

/**
 * When the kernel says a process started, or a positive statement that we could
 * not tell.
 *
 * NOT `number | null`. A null start time silently becomes "started at the epoch"
 * or "running for 56 years" in whatever computes a duration from it, and the
 * whole point of this module is a reading that cannot be mistaken for a
 * measurement it did not take.
 *
 * **`atMs` IS ACCURATE TO ABOUT A SECOND, NOT TO A MILLISECOND**, and the type
 * cannot say so. It is derived from `ps`'s `etimes`, which counts whole seconds,
 * so the same process read twice yields two starts up to a second apart. Fine
 * for "this review has been running 41 minutes"; useless for ordering two
 * processes, and never to be compared for equality — see the module comment.
 */
export type ProcessStart = { known: true; atMs: number } | { known: false };

/**
 * One row of the process table, at one instant.
 *
 * `command` is argv joined with single spaces, exactly as `ps args` prints it.
 * **Quoting is already lost by the time we see it**, so an argument containing a
 * space is indistinguishable from two arguments - which is why the recognisers
 * below match a basename and a leading subcommand rather than trying to
 * reconstruct argv.
 */
export type ProcessRow = {
  pid: number;
  ppid: number;
  command: string;
  started: ProcessStart;
};

/**
 * A process table, or a sentence saying why there isn't one.
 *
 * The failure arm carries prose because the caller has to write something in a
 * log about WHY it has no reading, and "could not tell" with no cause is the
 * shape this whole area exists to refuse.
 */
export type ProcessTableReading =
  | { read: true; rows: readonly ProcessRow[]; atMs: number }
  | { read: false; why: string };

/** A parse that either produced rows or says what it choked on. */
export type ParseProcessTableResult =
  | { ok: true; rows: readonly ProcessRow[] }
  | { ok: false; reason: string };

/**
 * The named kinds of long-running child work.
 *
 * A CLOSED UNION AND A `Record` OVER IT, not an array of objects, for the same
 * reason `observation.ts` keys its membership checks off the union: adding an id
 * without adding its recogniser stops the build. The direction doc's horizon is
 * explicitly several harnesses - "multiple model-families/harnesses, starting
 * with Claude Code and Claude agents (NOW) and then OpenAI Codex/GPT (SOON)" -
 * so this table is meant to grow. It is a table and not a plugin system; a new
 * entry is a few lines of data and a fixture.
 */
export type WorkRecogniserId = "codex-exec" | "claude-headless" | "vitest";

export type WorkRecogniser = {
  id: WorkRecogniserId;
  /** What to say on a page, in the reader's terms rather than the process's. */
  label: string;
  /** Matched against the BASENAME of the executable, after peeling one launcher. */
  executable: RegExp;
  /** Matched against everything after the executable, joined with single spaces. */
  args: RegExp;
  /** Why a person would call this work - and, where it matters, what it is not. */
  note: string;
};

/**
 * Why no reading could be taken.
 *
 * **Each of these is a different sentence, and none of them is "nothing is
 * running".** That distinction is the entire robustness bar for this area
 * (direction doc § "A higher bar for robustness here than elsewhere"): a
 * monitoring tool that reports an absence it never measured has told you
 * nothing, in a way that looks like good news.
 */
export type WorkUnknownCause =
  /** The snapshot carried no pane pid, so there is no tree to walk. */
  | "no-pane-pid"
  /** The probe failed. `why` carries what it said. */
  | "process-table-unreadable"
  /**
   * The pane pid is not in the table. Either the pane died between the
   * dashboard's collection and this read - the ordinary case, since the two are
   * separate reads seconds apart, and the fixtures' README records that sessions
   * appear and disappear on most collections - or the pid was reused. Either
   * way there is no tree, and "nothing running" here would be a claim about a
   * process that does not exist.
   */
  | "pane-not-in-table"
  /**
   * The table is not an ancestry: a pid appears twice, or the walk came back
   * round to a process it had already visited.
   *
   * `parseProcessTable` refuses a duplicate pid, so a reading straight off the
   * probe can never carry one - but a `ProcessTableReading` is an ordinary
   * value that a store replay or a merge of two readings can also produce, and
   * this arm is what stops that becoming a confident answer. **A cycle rendered
   * as `no-child-work` is an ambiguous reading rendered as an absence**, which
   * is the one thing this module exists not to do; the walk used to terminate
   * quietly and say the pane was quiet, and a cross-family review caught it.
   */
  | "malformed-process-table";

/** One recognised piece of work found beneath a pane. */
export type ChildJob = {
  recogniser: WorkRecogniserId;
  label: string;
  pid: number;
  /**
   * Hops below the pane pid; 1 is a direct child of the pane process.
   *
   * Kept because the measured depth was the surprise: on this box a `codex exec`
   * dispatched by an agent sits at **depth 8** (pane -> claude -> the Bash
   * tool's bash -> timeout -> npm exec -> sh -c -> the tsx shim -> node ->
   * codex), so anything that only looked a couple of levels down would have
   * found none of the four sessions the finding is about.
   */
  depth: number;
  /** Truncated. See `COMMAND_KEPT`. */
  command: string;
  started: ProcessStart;
};

/**
 * What the tree under one pane is doing, at one instant.
 *
 * Three arms and no fourth: **could not tell**, **looked and found no
 * recognised work**, **found some**. `no-child-work` carries the inspected
 * count so the difference between "a bare pane" and "a pane with twenty-five
 * processes under it, none of them recognised" survives into the history - the
 * second is how a missing recogniser will announce itself.
 */
export type WorkReading =
  | { kind: "cannot-tell"; cause: WorkUnknownCause; why: string }
  | {
      kind: "no-child-work";
      inspected: number;
      paneCommand: string;
      /**
       * When the PANE PROCESS itself started — the age of the thing
       * `paneCommand` names, and of nothing else.
       *
       * It is here so that a renderer showing "this shell has run one command
       * for six hours" can say six hours **about the command**, without reaching
       * for a duration that describes a different object. The dashboard's
       * `startedAt` is the tmux session's, and the two come apart routinely
       * rather than rarely: in one capture in this repo's fixtures the pane is
       * 115341 s old and the `claude` inside it is 75741 s old, because
       * `gjd-remote resume` drops a fresh conversation into a pane that was
       * already there.
       *
       * Accurate to about a second — see `ProcessStart`. Absent on
       * `cannot-tell` for the same reason `paneCommand` is: there, no pane was
       * found, and an age of zero would read as "just started".
       */
      paneStarted: ProcessStart;
      /**
       * When the table this was decided from was read.
       *
       * Carried on both walking arms so a `WorkReading` stored on its own can
       * still say how old it is. Without it, "no child work" read forty minutes
       * ago and "no child work" read a second ago are the same sentence, and the
       * first is not an answer.
       */
      atMs: number;
    }
  | {
      kind: "child-work";
      /** Non-empty by construction: `child-work` with no jobs cannot be written. */
      jobs: readonly [ChildJob, ...ChildJob[]];
      /**
       * Processes the walk actually looked at. NOT the size of the subtree: the
       * walk stops at a recognised job, so everything below one is unexamined
       * and uncounted. Named for what it measures rather than for what it is
       * nearly.
       */
      inspected: number;
      paneCommand: string;
      /** When the pane process itself started. See the arm above. */
      paneStarted: ProcessStart;
      /** When the table this was decided from was read. See the arm above. */
      atMs: number;
    };

/**
 * How much of a command line is kept.
 *
 * A headless chrome command line is over 2 kB and a `codex exec` one carries the
 * whole prompt; these end up in an append-only history, so they are trimmed at
 * the point of capture rather than at the point of rendering. Note what that
 * prompt is: the agent's own task text, which is Greg's - no reader's article
 * prose can reach here.
 */
export const COMMAND_KEPT = 400;

function truncate(command: string): string {
  return command.length <= COMMAND_KEPT ? command : `${command.slice(0, COMMAND_KEPT)}...`;
}

/**
 * Interpreters we look THROUGH to find the real executable.
 *
 * `node /path/node_modules/.bin/vitest run` is vitest running, not node running,
 * and every JS tool on this box arrives wearing that shim. So one hop is peeled
 * - but only one, and only for node.
 *
 * **Shells are deliberately absent, and that is half of the fake-codex
 * decision.** There is a test harness on this box whose command line is
 * `bash /tmp/fake-codex-qAz9Um/codex ...`; peeling `bash` the way we peel `node`
 * would put a unit-test fixture one `exec` away from being reported as a paid
 * GPT review. A shell running a script is the shell's work, not the work of
 * whatever the script is called, and an installed tool is not reached through an
 * explicit interpreter. `isThrowawayPath` is the other, independent guard.
 */
const LAUNCHERS: ReadonlySet<string> = new Set(["node", "nodejs"]);

/**
 * Where an installed tool never lives.
 *
 * The second half of the fake-codex decision. If a harness ever invokes its fake
 * through a shebang - `/tmp/fake-codex-X/codex exec ...`, argv[0] the fake
 * itself - the launcher rule above would not save us, and this does. A
 * recogniser names a tool installed on the box; a `codex` in a scratch directory
 * that exists for the length of one test is not that tool.
 */
function isThrowawayPath(path: string): boolean {
  return path.startsWith("/tmp/") || path.startsWith("/var/tmp/");
}

function basename(path: string): string {
  const cut = path.lastIndexOf("/");
  return cut === -1 ? path : path.slice(cut + 1);
}

/**
 * The executable a row is really running, and the arguments after it.
 *
 * Null when the row is nothing we will ever recognise - an empty command, or a
 * tool run out of a throwaway directory.
 */
function resolveExecutable(command: string): { name: string; args: string } | null {
  const tokens = command.trim().split(/\s+/).filter((t) => t !== "");
  const head = tokens[0];
  if (head === undefined) return null;

  // Peel at most one launcher, and only when what follows is a path rather than
  // a flag: `/usr/bin/node --require .../preflight.cjs --import ...` is node
  // running a program of its own, and the word after `--require` is not it.
  const next = tokens[1];
  const peel = LAUNCHERS.has(basename(head)) && next !== undefined && !next.startsWith("-");
  const executablePath = peel && next !== undefined ? next : head;
  if (isThrowawayPath(executablePath)) return null;

  return { name: basename(executablePath), args: tokens.slice(peel ? 2 : 1).join(" ") };
}

/**
 * The recognisers, as data.
 *
 * Every one of these was seen running on this box on 2026-09-08 and its command
 * line is in `tests/fixtures/overseer-process-trees/`. Nothing is here on the
 * strength of what a plausible command line probably looks like.
 */
export const RECOGNISERS: Record<WorkRecogniserId, WorkRecogniser> = {
  "codex-exec": {
    id: "codex-exec",
    label: "GPT review or task (codex exec)",
    executable: /^codex$/,
    // The subcommand is required. It is what separates a real run from a
    // command line that merely mentions codex, and it is why the fake harness's
    // `codex -o /tmp/run-codex-gc.txt` could not match even if it were reached.
    args: /^exec(\s|$)/,
    note: "The finding this module exists for: 15-45 minutes of paid review, during which the pane looks empty.",
  },
  "claude-headless": {
    id: "claude-headless",
    label: "Headless Claude (claude --print)",
    executable: /^claude$/,
    // ANCHORED TO THE FIRST ARGUMENT, not searched for anywhere in the line.
    // A pane's own interactive Claude is `claude --session-id <uuid> <the whole
    // prompt>`, and a prompt is free text that can contain the word `--print`.
    // Matching loosely would relabel every interactive session on the box as a
    // batch job. `scripts/run-claude.ts` puts `--print` first (buildClaudeArgs),
    // and so does the `claude -p ...` idiom. KNOWN GAP: `claude --model x -p ...`
    // is missed, and reads as no-child-work rather than as something wrong.
    args: /^(--print|-p)(\s|$)/,
    note: "A subagent dispatched from outside a session (scripts/run-claude.ts), or any `claude -p`.",
  },
  vitest: {
    id: "vitest",
    label: "Test suite (vitest run)",
    executable: /^vitest$/,
    // `run` or `--run`, which vitest treats as the same thing; every instance
    // measured on this box used the subcommand, and `--run` is here on a
    // reviewer's word rather than on a capture. `vitest --watch` is a dev-loop
    // watcher nobody is waiting on, and calling that work would light up every
    // session that left one open. KNOWN GAP: `vitest --coverage --run` is missed,
    // because the flag has to lead for the same reason claude's `--print` does.
    args: /^(run|--run)(\s|$)/,
    note: "The full suite takes ~24 minutes here, long enough for a backgrounded one to read as an empty pane.",
  },
};

/**
 * Does this command line match a recogniser?
 *
 * Takes a string rather than a row so it can be pointed at anything - the
 * probe's diagnostics, a `ps` line pasted into a test.
 */
export function recogniseCommand(command: string): WorkRecogniser | null {
  const resolved = resolveExecutable(command);
  if (resolved === null) return null;
  for (const recogniser of Object.values(RECOGNISERS)) {
    if (recogniser.executable.test(resolved.name) && recogniser.args.test(resolved.args)) return recogniser;
  }
  return null;
}

/**
 * `ps -eo pid=,ppid=,etimes=,args=` output, or a sentence saying why it is not.
 *
 * `etimes` (whole seconds of elapsed time) rather than `lstart`, for two
 * reasons: it is a single integer column where `lstart` is five
 * locale-dependent space-separated words that make column splitting a guess,
 * and it needs no timezone. It is converted to a start time here against
 * `nowMs`, so everything downstream compares absolute instants. **The
 * conversion is only as good as the second `etimes` rounds to** - ample for
 * "how long has this review been running", useless for ordering two processes
 * started in the same second.
 *
 * A DUPLICATE PID FAILS THE WHOLE TABLE, the way a duplicate handle fails a
 * whole snapshot in `observation.ts`: the child map is built by pid, so the
 * second row would silently replace the first and a subtree would go missing
 * with nothing to show for it.
 */
export function parseProcessTable(text: string, nowMs: number): ParseProcessTableResult {
  const rows: ProcessRow[] = [];
  const seen = new Set<number>();
  for (const [index, line] of text.split("\n").entries()) {
    if (line.trim() === "") continue;
    const match = /^\s*(\d+)\s+(\d+)\s+(-?\d+)\s+(.*)$/.exec(line);
    if (match === null) return { ok: false, reason: `line ${index + 1} is not a pid/ppid/etimes/args row` };
    const [, pidText, ppidText, etimesText, command] = match;
    // Impossible given the regex matched; narrowed rather than cast, because
    // `noUncheckedIndexedAccess` is on and a cast here would be the one place
    // this file stopped being checked.
    if (pidText === undefined || ppidText === undefined || etimesText === undefined || command === undefined) {
      return { ok: false, reason: `line ${index + 1} matched but yielded no fields` };
    }
    const pid = Number(pidText);
    const ppid = Number(ppidText);
    const etimes = Number(etimesText);
    if (seen.has(pid)) return { ok: false, reason: `pid ${pid} appears twice, so this is not one process table` };
    seen.add(pid);
    rows.push({
      pid,
      ppid,
      command,
      // A negative elapsed time is a clock that moved, not a process from the
      // future. Refusing to convert it is cheaper than a duration that renders
      // as "-3h".
      started: etimes >= 0 ? { known: true, atMs: nowMs - etimes * 1000 } : { known: false },
    });
  }
  return { ok: true, rows };
}

/**
 * What the tree under `panePid` is doing, according to one reading of the
 * process table.
 *
 * Pure: the reading is injected, so this can be run against a capture. Both
 * arguments can say "no", and both of those are `cannot-tell` arms rather than
 * an empty answer.
 *
 * ## The walk
 *
 * Depth-first from the pane, children visited in pid order so the output is
 * deterministic across two readings of the same tree. **A match is not
 * descended into**: a `claude --print` that itself spawns `codex exec` is one
 * job - the one the pane is waiting on - and reporting both would double-count
 * a single wait. A `visited` set makes a table with a cycle in it terminate
 * rather than hang; the kernel cannot produce one, a stored or synthesised
 * table can. It is seeded with the pane, which is also what makes a
 * `ppid === pid` row harmless.
 */
export function classifyPaneWork(panePid: number | null, reading: ProcessTableReading): WorkReading {
  if (panePid === null) {
    return { kind: "cannot-tell", cause: "no-pane-pid", why: "the snapshot carried no pane pid for this session" };
  }
  if (!reading.read) {
    return { kind: "cannot-tell", cause: "process-table-unreadable", why: reading.why };
  }

  // The index is rebuilt per call rather than shared across the fleet's rows.
  // ONE `ps` SERVES EVERY SESSION - the caller reads the table once and passes
  // the same reading in 33 times - and the rebuild is ~1 ms of map-building
  // against 1000 rows, against a tick budget the direction doc measures in
  // seconds. Left simple on purpose; if it ever shows up in a profile, the fix
  // is an `indexProcessTable(reading)` the caller hoists, not a cache in here.
  const byPid = new Map<number, ProcessRow>();
  const children = new Map<number, ProcessRow[]>();
  for (const row of reading.rows) {
    // THE INVARIANT IS RE-CHECKED HERE, not merely assumed from the parser. A
    // `ProcessTableReading` is an ordinary value: a store replay or a merge of
    // two readings can hand this function a table `parseProcessTable` would have
    // refused, and silently keeping the second row would drop a whole subtree.
    if (byPid.has(row.pid)) {
      return {
        kind: "cannot-tell",
        cause: "malformed-process-table",
        why: `pid ${row.pid} appears twice, so these rows are not one process table`,
      };
    }
    byPid.set(row.pid, row);
    // NO SELF-PARENT GUARD HERE, deliberately. A `ppid === pid` row does put
    // itself in its own children list, but the only way the walk could reach it
    // is if it were the pane, and the pane is already in `visited` before the
    // walk starts. A guard was written here first and mutation testing showed no
    // test could ever fail for its absence, because nothing can: it was
    // unreachable. Dead defensive code that cannot be covered is worse than
    // none, so the `visited` set below is the whole of the answer.
    const siblings = children.get(row.ppid);
    if (siblings === undefined) children.set(row.ppid, [row]);
    else siblings.push(row);
  }

  const pane = byPid.get(panePid);
  if (pane === undefined) {
    return {
      kind: "cannot-tell",
      cause: "pane-not-in-table",
      why: `pid ${panePid} is not in a process table of ${reading.rows.length} rows; the pane exited, or its pid was reused`,
    };
  }

  const jobs: ChildJob[] = [];
  const visited = new Set<number>([panePid]);
  let inspected = 0;
  // Set when the walk meets a process it has already visited. That cannot happen
  // in a real ancestry, so it is not a shape to route around: it means these
  // rows are not one tree, and the answer has to be that we could not tell
  // rather than a tidy `no-child-work`.
  let revisited: number | null = null;

  const walk = (pid: number, depth: number): void => {
    const kids = children.get(pid);
    if (kids === undefined) return;
    for (const kid of [...kids].sort((a, b) => a.pid - b.pid)) {
      if (visited.has(kid.pid)) {
        revisited = kid.pid;
        continue;
      }
      visited.add(kid.pid);
      inspected += 1;
      const recogniser = recogniseCommand(kid.command);
      if (recogniser !== null) {
        jobs.push({
          recogniser: recogniser.id,
          label: recogniser.label,
          pid: kid.pid,
          depth,
          command: truncate(kid.command),
          started: kid.started,
        });
        // Stop here: everything below a recognised job belongs to that job.
        continue;
      }
      walk(kid.pid, depth + 1);
    }
  };
  walk(panePid, 1);

  if (revisited !== null) {
    return {
      kind: "cannot-tell",
      cause: "malformed-process-table",
      why: `walking from pid ${panePid} came back to pid ${String(revisited)}, so these rows are not an ancestry`,
    };
  }

  const paneCommand = truncate(pane.command);
  // The PANE ROW's own start, taken from the same row `paneCommand` came from.
  // Deliberately not the tmux session's `startedAt`, and deliberately not the
  // first child's: a pane outlives the conversations put into it.
  const paneStarted = pane.started;
  const atMs = reading.atMs;
  const [first, ...rest] = jobs;
  if (first === undefined) return { kind: "no-child-work", inspected, paneCommand, paneStarted, atMs };
  return { kind: "child-work", jobs: [first, ...rest], inspected, paneCommand, paneStarted, atMs };
}
