/**
 * The record of what was asked for, so a job that never ran can be noticed.
 *
 * `--wait 2h` sleeps inside the job script on the box, and a reboot kills every
 * sleeping job without a word — the session simply is not there any more, which
 * looks exactly like a session that finished. This module is the other half of
 * that: one append-only line per `gjd-remote` command on the laptop, and a
 * verdict function that says which of those launches never became a Claude.
 *
 * > My only worry is that we might schedule a prompt with a long wait period,
 * > and then something happens (e.g. the remote server gets rebooted) and it
 * > gets lost. — Greg, 2026-09-01
 *
 * Pure, and separated from scripts/gjd-remote.ts for the same reason as the
 * rest: that file calls main() at import time, so nothing in it can be tested.
 *
 * THE EVIDENCE IS NOT THE TRANSCRIPT. The obvious way to ask "did Claude ever
 * run?" is to look for `~/.claude/projects/*<uuid>.jsonl` on the box, which is
 * already how `ls` finds a session's title. Measured on 2026-09-01, it does not
 * answer the question: a session started WITHOUT a prompt had no transcript
 * after 45 seconds while its process was running, because the file is written
 * from the first message rather than at startup. With a prompt one appeared
 * within 15 seconds. So a transcript proves Claude ran, and its absence proves
 * nothing at all — which is the wrong way round for detecting a loss. The job
 * script writes its own line instead, at the moment it is about to exec.
 */

import path from "node:path";
import { isRepoValue } from "./gjd-remote-repo.js";

/**
 * Bumped when the shape below changes in a way a reader must know about.
 *
 * STILL 1 AFTER `repo`, `attempt` AND `outcome` ARRIVED, and that is a decision
 * rather than an oversight — GPT Sol (finding 10) asked for the version handling
 * to be settled deliberately instead of leaving readers to shrug at a field they
 * do not know. The rule the number carries is "a reader that does not understand
 * this line would answer WRONGLY from it", and none of the three does that:
 *
 *  - Nothing in `verdict()` reads them, so an older gjd-remote gives exactly the
 *    answers it gives today about every launch line, with or without a repo.
 *  - A line with no `repo` still means what it always meant — the repo was not
 *    recorded — so old lines and new ones can sit in one file.
 *  - A `setup` line is not a launch: `gjd-remote log` selects `cmd === "new-claude"`,
 *    so an older reader ignores it rather than misreading it.
 *
 * Bumping instead would have made every one of Greg's checkouts that is behind
 * count every new line as unreadable, which is loud about nothing. The bump is
 * owed the day a new field changes what an EXISTING field means.
 */
export const LOG_SCHEMA = 1;

/** What became of one setup attempt. `started` is written before the work, the
 *  other two after it, so an attempt that died mid-flight is visible as a
 *  `started` with nothing after it. */
export type SetupOutcome = "started" | "success" | "failed";

const SETUP_OUTCOMES: readonly SetupOutcome[] = ["started", "success", "failed"];

/**
 * An attempt id: lower-case, starts alphanumeric, no dots and no slashes.
 *
 * Bounded and path-shaped on purpose. Sol's design for setup has the box keep a
 * status file per attempt under `~/gjd-remote/`, so this string becomes part of
 * a path on a machine with passwordless sudo. A `..` that reaches the log is a
 * `..` somebody joins onto a directory later.
 */
const ATTEMPT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * One line of the log. `cmd` is the only required discriminator; everything
 * else is present when it was known.
 *
 * THERE IS NO `argv` FIELD AND NO PROMPT FIELD, and that is a design decision
 * rather than an oversight: a prompt is prose that may contain anything, the
 * repo forbids logging article content (docs/project/logging.md), and a
 * redaction step is a thing that can be got wrong later. A field that is never
 * passed in cannot leak.
 *
 * **But this file is not free of the prompt, and saying it was would be a lie.**
 * An unnamed session's name is `slugify(first five words of the prompt)` —
 * `provisionalName()` in scripts/gjd-remote.ts — so `name` carries that
 * fragment, and `promptPath` contains the name again. GPT Sol found this in
 * review, against an earlier version of this comment that claimed the opposite.
 * Two things follow, and neither is "log less": the name is what makes the
 * report readable and it is on screen and in tmux anyway, so it stays; and the
 * file is written 0600 in a 0700 directory, outside the repo and outside
 * Dropbox, because it is not as harmless as it looks.
 *
 * A sha of the prompt was in the first version and is gone. It proves nothing
 * `writeRemote` has not already verified at creation, and against
 * natural-language prompts a 12-hex digest is a confirmation oracle: guess the
 * sentence, hash it, and the log tells you that you guessed right.
 */
export type LogRecord = {
  /** Schema version. */
  v: number;
  /** ISO 8601 with the laptop's offset — the offset matters, see remote-box.md. */
  t: string;
  /** The same instant in epoch milliseconds, so arithmetic needs no parsing. */
  ms: number;
  /** The subcommand, e.g. `new-claude`. */
  cmd: string;
  /** tmux session name at launch. `ls` may rename it later; the uuid will not change. */
  name?: string;
  /** `claude --session-id`, the one identifier that survives the rename. */
  id?: string;
  /** Working directory on the box. */
  dir?: string;
  /** `--wait`, in seconds, and when it was due to start. */
  waitSeconds?: number;
  waitUntilMs?: number;
  /** The box this went to, as resolved at the time. See buildFactsScript. */
  host?: string;
  /** About the prompt, never its text. */
  promptBytes?: number;
  promptPath?: string;
  /**
   * `owner/name` for the repo this was for, lower-cased, or `unknown` for a
   * session started against an arbitrary directory.
   *
   * NOT DERIVABLE FROM `dir`, which is why it is here: this repo is `reading2`
   * on the laptop and `spideryarn2` on the box, and a second checkout of one
   * repo would have a third path. Validated on the way in and on the way out
   * against the same rule the tmux listing uses — `isRepoValue` — so the two
   * records of "which repo" cannot drift apart.
   */
  repo?: string;
  /** The setup attempt this line is about. `cmd: "setup"` only. */
  attempt?: string;
  /** What became of it. `cmd: "setup"` only. */
  outcome?: SetupOutcome;
};

/**
 * A ceiling on the line, and an honest account of what that does and does not buy.
 *
 * The first version of this comment said a line under PIPE_BUF appends
 * atomically. **That is a guarantee about pipes, not about files**, and this
 * repo has already been told so once: see the header of
 * src/store/ai-calls-fs.ts, where GPT Sol made the same correction on
 * 2026-08-28 and the code changed rather than the comment. Node documents that
 * `appendFileSync` opens with `a` — `O_APPEND`, so every write lands at the
 * end and no two writers overwrite each other — but nothing promises that one
 * call is one `write(2)` on every filesystem.
 *
 * So the ceiling is a defence in depth rather than a proof: a small record,
 * encoded once, written once, and flushed. What actually protects the reader is
 * that it validates every line and counts the ones it cannot read, which is the
 * same conclusion ai-calls-fs.ts reached.
 */
export const MAX_LINE_BYTES = 4096;

/** Long enough to identify, short enough that no path can bloat a line. */
const MAX_FIELD = 300;

/** Trim a path or name to something that cannot make a line unatomic. */
const clip = (s: string) => (s.length <= MAX_FIELD ? s : `${s.slice(0, MAX_FIELD - 1)}…`);

/**
 * Where the log lives, and why it is NOT in the repo.
 *
 * Greg asked for "a gjd-remote log (git-ignored)", which reads as a folder in
 * the checkout. Two things argue against it, and both are about this repo
 * specifically:
 *
 *  - **Worktrees are arriving.** A repo-relative log splits the record across N
 *    checkouts at exactly the moment you need one list of everything that was
 *    scheduled. The log is about the BOX, which is one machine, not about a
 *    checkout.
 *  - **The repo is inside Dropbox.** An append-only file written on every
 *    command would be synced on every command.
 *
 * So it goes in the XDG state directory, which is the standard place for
 * "state a program keeps between runs that is not configuration", and
 * `GJD_REMOTE_LOG_DIR` overrides it — which is also how the tests point it at a
 * temporary directory rather than at Greg's own log.
 */
export function logDir(env: NodeJS.ProcessEnv, home: string): string {
  const override = env.GJD_REMOTE_LOG_DIR?.trim();
  if (override) return override;
  const state = env.XDG_STATE_HOME?.trim();
  return path.join(state && path.isAbsolute(state) ? state : path.join(home, ".local", "state"), "gjd-remote");
}

/** One file, not one per day. Rotation is a scheme for losing records, and a
 *  line per command is a few hundred kilobytes a year. */
export const LOG_FILE = "gjd-remote.ndjson";

export const logPath = (env: NodeJS.ProcessEnv, home: string) => path.join(logDir(env, home), LOG_FILE);

/**
 * Build the line. One JSON object, one `\n`, no pretty-printing.
 *
 * Undefined fields are dropped rather than written as null, so a reader can
 * tell "there was no wait" from "the wait was recorded as nothing".
 */
export function formatLine(rec: LogRecord): string {
  // THROWN, NOT CLIPPED. The three fields below are identity rather than
  // description: something will group by them later, and this file is
  // append-only, so there is no pass afterwards in which a malformed value gets
  // fixed. A caller that cannot say which repo it is launching for should pass
  // nothing, which reads as "not recorded", rather than something that reads as
  // a repo and is not one.
  if (rec.repo !== undefined && !isRepoValue(rec.repo)) {
    throw new Error(`log: repo '${rec.repo}' is not an owner/name slug (nor 'unknown')`);
  }
  if (rec.attempt !== undefined && !ATTEMPT_ID.test(rec.attempt)) {
    throw new Error(`log: attempt '${rec.attempt}' is not an attempt id`);
  }
  if (rec.outcome !== undefined && !SETUP_OUTCOMES.includes(rec.outcome)) {
    throw new Error(`log: outcome '${rec.outcome}' is not one of ${SETUP_OUTCOMES.join(", ")}`);
  }
  // The discriminator this type cannot express: `cmd` is a free string, so the
  // rule that these two belong to a setup line is checked here instead. An
  // outcome on a launch line is a record two readers would disagree about.
  if ((rec.attempt !== undefined || rec.outcome !== undefined) && rec.cmd !== "setup") {
    throw new Error(`log: attempt and outcome belong to a setup line, not to '${rec.cmd}'`);
  }
  const clipped: LogRecord = {
    ...rec,
    ...(rec.name === undefined ? {} : { name: clip(rec.name) }),
    ...(rec.dir === undefined ? {} : { dir: clip(rec.dir) }),
    ...(rec.promptPath === undefined ? {} : { promptPath: clip(rec.promptPath) }),
  };
  const line = `${JSON.stringify(clipped)}\n`;
  const size = Buffer.byteLength(line, "utf8");
  if (size > MAX_LINE_BYTES) {
    // Unreachable with the caps above, and it throws rather than writing
    // because a line that the kernel may split is a line that can corrupt the
    // record next to it — a failure that is invisible until somebody reads the
    // file months later.
    throw new Error(`log line is ${size} bytes, over the ${MAX_LINE_BYTES} that append atomically`);
  }
  return line;
}

/**
 * FAILS CLOSED, in the same way parseSessionLine does.
 *
 * A line that is not the shape this reader was written against is `null`, and
 * the caller counts it. Guessing at a half-written or newer-schema line is how
 * a listing quietly gets shorter, and a short list of "jobs that ran" reads as
 * "these ones were lost".
 */
export function parseLine(line: string): LogRecord | null {
  const text = line.trim();
  if (!text.startsWith("{")) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  // A version this reader was not written against is unreadable, not
  // best-effort. A newer gjd-remote could add a field that changes what an old
  // one MEANS, and a reader that shrugs at the version would answer confidently
  // from a record it does not understand.
  if (typeof o.v !== "number" || !Number.isInteger(o.v) || o.v < 1 || o.v > LOG_SCHEMA) return null;
  if (typeof o.t !== "string" || o.t === "") return null;
  if (typeof o.ms !== "number" || !Number.isFinite(o.ms) || o.ms <= 0) return null;
  if (typeof o.cmd !== "string" || o.cmd === "") return null;

  const str = (k: string): string | undefined => (typeof o[k] === "string" && o[k] !== "" ? (o[k] as string) : undefined);
  const num = (k: string): number | undefined =>
    typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : undefined;

  const identity = readIdentity(o);
  if (identity === null) return null;

  return {
    v: o.v,
    t: o.t,
    ms: o.ms,
    cmd: o.cmd,
    ...identity,
    ...(str("name") === undefined ? {} : { name: str("name") as string }),
    ...(str("id") === undefined ? {} : { id: str("id") as string }),
    ...(str("dir") === undefined ? {} : { dir: str("dir") as string }),
    ...(num("waitSeconds") === undefined ? {} : { waitSeconds: num("waitSeconds") as number }),
    ...(num("waitUntilMs") === undefined ? {} : { waitUntilMs: num("waitUntilMs") as number }),
    ...(num("promptBytes") === undefined ? {} : { promptBytes: num("promptBytes") as number }),
    ...(str("host") === undefined ? {} : { host: str("host") as string }),
    ...(str("promptPath") === undefined ? {} : { promptPath: str("promptPath") as string }),
  };
}

/**
 * The three fields that say WHICH REPO and WHICH ATTEMPT, or null if any of
 * them is not what it claims to be.
 *
 * A FIELD DROPPED IS A CLAIM MADE, which is why these are not read the way
 * `waitSeconds` is. Dropping a malformed `waitSeconds` keeps a record that
 * still says a launch happened, and that is true. Dropping a malformed `repo`
 * produces a record that reads as a launch from before repos were recorded —
 * a different statement, and a false one. So the line is unreadable instead,
 * where `parseLog` counts it out loud.
 *
 * The last clause is the discriminator `LogRecord` cannot express: `cmd` is a
 * free string, so "these two belong to a setup line" is checked rather than
 * typed, at both seams.
 */
function readIdentity(o: Record<string, unknown>): Pick<LogRecord, "repo" | "attempt" | "outcome"> | null {
  const repo = typeof o.repo === "string" && isRepoValue(o.repo) ? o.repo : undefined;
  if (o.repo !== undefined && repo === undefined) return null;
  const attempt = typeof o.attempt === "string" && ATTEMPT_ID.test(o.attempt) ? o.attempt : undefined;
  if (o.attempt !== undefined && attempt === undefined) return null;
  const outcome = SETUP_OUTCOMES.find((x) => x === o.outcome);
  if (o.outcome !== undefined && outcome === undefined) return null;
  if ((attempt !== undefined || outcome !== undefined) && o.cmd !== "setup") return null;
  return {
    ...(repo === undefined ? {} : { repo }),
    ...(attempt === undefined ? {} : { attempt }),
    ...(outcome === undefined ? {} : { outcome }),
  };
}

/** Every record in the file, and a count of the lines that were not records. */
export function parseLog(text: string): { records: LogRecord[]; unreadable: number } {
  const records: LogRecord[] = [];
  let unreadable = 0;
  for (const line of text.split("\n")) {
    if (line.trim() === "") continue;
    const rec = parseLine(line);
    if (rec) records.push(rec);
    else unreadable++;
  }
  return { records, unreadable };
}

/**
 * What the box knows about a launch: which session ids are alive in tmux right
 * now, and which ones ever reached the line that starts Claude.
 */
export type BoxFacts = {
  live: Set<string>;
  started: Set<string>;
};

export type Verdict = "waiting" | "running" | "ran" | "killed" | "lost" | "unknown";

/**
 * Did this launch ever become a Claude?
 *
 * The order of these clauses is the whole of it, and each one exists because
 * two states would otherwise be told apart wrongly:
 *
 *  - **started** is decided by the box's own line, written by the job script
 *    immediately before it execs `claude`. Not by the transcript (see the
 *    header), and not by the session still existing.
 *  - **killed** is decided by a `kill` of the same session UUID in this log. A
 *    job Greg called off and a job a reboot ate are both "never ran", and only
 *    the log can tell them apart. Without this, every deliberate `kill` would
 *    be reported as a loss and the report would be ignored within a week.
 *
 *    BY UUID, NOT BY NAME. The first version matched names, and GPT Sol found
 *    what that misses: `gjd-remote ls` RENAMES a provisional session to Claude's
 *    own title, so `kill` records the new name while the launch recorded the old
 *    one, they never match, and every killed session that had lived long enough
 *    to be renamed would be reported as lost. Names are also reusable; a uuid is
 *    minted once per session and survives the rename by design.
 *  - **lost** requires the deadline to have PASSED. Before it, a session that
 *    is not in tmux is still lost, but saying so needs the same clause, so both
 *    go through `started === false`.
 *  - **unknown** is a real answer, not a fallback: a live session past its
 *    deadline with no start line means the marker did not get written, and
 *    calling that "ran" would hide exactly the bug this file exists to catch.
 */
export function verdict(
  rec: LogRecord,
  facts: BoxFacts,
  opts: { now: number; killed: ReadonlySet<string> },
): Verdict {
  if (rec.id === undefined) return "unknown";
  const started = facts.started.has(rec.id);
  const live = facts.live.has(rec.id);
  const due = rec.waitUntilMs ?? rec.ms;

  if (started) return live ? "running" : "ran";
  if (live) return opts.now < due ? "waiting" : "unknown";
  if (opts.killed.has(rec.id)) return "killed";
  return "lost";
}

/** Printed last by the remote script, and only if everything before it worked. */
export const FACTS_SENTINEL = "GJDLOGOK";

/**
 * Ask the box both questions in one round trip.
 *
 * The SENTINEL is not optional, for the reason spelled out in
 * scripts/gjd-remote-tmux.ts: a `tmux ls` piped into a loop exits 0 with no
 * output when tmux is missing or broken, and that is byte-for-byte what a box
 * with no sessions looks like. Here the stakes are higher than a short listing
 * — an empty answer would make every scheduled job look LOST, and a report that
 * cries wolf is a report nobody reads.
 *
 * `starts` is read with `cat` and a fallback, because a box that has never run
 * a job has no file, and "no file" is a legitimate empty rather than a failure.
 */
export function buildFactsScript(remoteWork: string): string {
  return `
    command -v tmux >/dev/null 2>&1 || { echo 'GJDERR tmux is not on this box'; exit 3; }
    ids=$(tmux ls -F '#{session_id}' 2>&1) || case "$ids" in
      *'no server running'*|*'No such file or directory'*) ids='' ;;
      *) echo "GJDERR tmux ls failed: $ids"; exit 3 ;;
    esac
    printf '%s' "$ids" | while IFS= read -r sid; do
      [ -n "$sid" ] || continue
      v=$(tmux show-environment -t "$sid" CLAUDE_SESSION_ID 2>/dev/null | cut -d= -f2-)
      [ -n "$v" ] && printf 'live %s\\n' "$v"
    done
    cat -- ${remoteWork}/log/starts.ndjson 2>/dev/null | while IFS= read -r line; do
      case "$line" in *'"id":"'*) printf 'started %s\\n' "\${line#*\\"id\\":\\"}" ;; esac
    done
    echo ${FACTS_SENTINEL}`;
}

/** A uuid as `claude --session-id` mints them, and nothing else. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Read the reply, or say why it cannot be trusted.
 *
 * Ids are validated rather than taken: `started` lines are cut out of a JSON
 * line with shell parameter expansion, so a malformed line yields a fragment,
 * and a fragment silently added to this set would mark some other job as having
 * run — the one failure this whole feature must not have.
 */
export function parseFacts(out: string): { facts: BoxFacts; failure: string | null } {
  const lines = out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  const empty = { live: new Set<string>(), started: new Set<string>() };

  const err = lines.find((l) => l.startsWith("GJDERR"));
  if (err) return { facts: empty, failure: err.slice("GJDERR".length).trim() };
  if (!lines.includes(FACTS_SENTINEL)) {
    return { facts: empty, failure: "the box did not finish answering (no completion marker)" };
  }

  const facts: BoxFacts = { live: new Set(), started: new Set() };
  for (const line of lines) {
    const [kind, ...rest] = line.split(" ");
    const id = (rest[0] ?? "").replace(/".*$/, "").trim();
    if (!UUID.test(id)) continue;
    if (kind === "live") facts.live.add(id);
    else if (kind === "started") facts.started.add(id);
  }
  return { facts, failure: null };
}

/**
 * The line the JOB writes on the box, one instant before it execs Claude.
 *
 * Single-quoted JSON built in shell, and both values are already constrained —
 * the name has passed SLUG and the id is a generated uuid — so there is nothing
 * here that could carry a quote into the file. `>>` opens O_APPEND, and the
 * line is far under 4KB, so two jobs starting at once cannot interleave.
 *
 * It is written for EVERY session, not only for the ones that waited: the same
 * evidence for everything is worth more than a special case, and it is one
 * line.
 */
export function startMarkerCommand(remoteWork: string, id: string, name: string): string {
  if (!UUID.test(id)) throw new Error(`startMarkerCommand: '${id}' is not a session uuid`);
  if (!/^[a-z0-9-]{1,41}$/.test(name)) throw new Error(`startMarkerCommand: '${name}' is not a session name`);
  return (
    `mkdir -p ${remoteWork}/log && ` +
    `printf '{"t":"%s","id":"${id}","name":"${name}"}\\n' "$(date -Is 2>/dev/null || date)" ` +
    `>> ${remoteWork}/log/starts.ndjson || true`
  );
}
