/**
 * The durable half of `gjd-remote setup` — the status file, the job that writes
 * it, and the verdict read back off it.
 *
 * Pure functions and a bash string: no ssh, no spawning, nothing that needs a
 * box. Split out of scripts/gjd-remote.ts for the same reason
 * scripts/gjd-remote-provision.ts and scripts/gjd-remote-run.ts are — that file
 * calls `main()` at import time, so nothing in it can be unit-tested at all.
 *
 * ## Why setup is a durable transaction rather than an ssh command
 *
 * `npm ci` plus Docker pulls outlive a foreground ssh from a laptop that goes
 * to sleep. So setup runs as a tool-owned tmux job on the box, under a
 * box-side `flock`, and **the verdict is the status file, never the exit code
 * and never the stream** — the same rule scripts/gjd-remote-provision.ts holds
 * for provisioning, and for the same reason: a stream that was cut and a run
 * that finished look identical from the laptop.
 *
 * The second half of that rule is the one that matters here, and it is GPT
 * Sol's blocker 2 (docs/plans/260902h-…-review-sol.md): **readiness is the
 * status file, never the checkout's presence.** A setup that failed leaves a
 * perfectly good-looking directory at the final path, and the next `new-claude`
 * would resolve it as `found` and start a session in a tree that was never set
 * up. Only `success`, for the CURRENT config, is readiness.
 *
 * ## The attempt id, and the config hash
 *
 * Two separate questions, and folding them together loses one:
 *
 *  - **attempt** — "is this file about the run I am watching?" A file naming
 *    another attempt tells you nothing about yours, however healthy it looks.
 *  - **configSha256** — "was it set up the way the repo asks for now?" A repo
 *    that changed its `setup =` line since the last success is not ready; it is
 *    `config-changed`, which means run setup again.
 *
 * See docs/plans/260902h-gjd-remote-works-from-whichever-repo-you-are-in.md and
 * docs/reusable/silent-success.md.
 */
import { createHash, randomUUID } from "node:crypto";
import { SETUP_SCRIPT } from "./gjd-remote-config.js";
import { REPO_UNKNOWN, isRepoValue } from "./gjd-remote-repo.js";

/**
 * A fresh attempt id, minted on the LAPTOP before the job is uploaded.
 *
 * On the laptop because the id has to be known by the side that later reads the
 * status file: an id the box invented would have to travel back over the stream
 * whose truncation is the whole thing we are defending against.
 */
export function newSetupAttempt(): string {
  return randomUUID();
}

/** What an attempt id may look like — checked wherever one is joined onto a
 *  path, because an id is a file name here and `..` is a legal-looking one. */
const ATTEMPT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// ------------------------------------------------------------------- paths

/** Under the box-side work directory (`~/gjd-remote`): where status files and
 *  logs live. */
export const SETUP_SUBDIR = "setup";
/** Under the box-side work directory: where the per-slug lock files live. */
export const LOCKS_SUBDIR = "locks";

/**
 * The PATH the setup command itself is given.
 *
 * Explicit, and short, because the job runs under `env -i` (see
 * `setupJobScript`). These four are where the box actually puts things:
 * node and npm come from NodeSource's apt package, whose npm prefix is `/usr`,
 * so `node`, `npm`, `claude` and `codex` are all in `/usr/bin`;
 * `/usr/local/bin` and `/usr/local/sbin` are where infra/hetzner/provision.sh
 * installs its own scripts. There is no `nvm` on this box — node is apt's — so
 * `env -i` costs nothing that a login shell would have supplied.
 */
export const SETUP_PATH = "/usr/local/bin:/usr/bin:/bin:/usr/local/sbin";

/**
 * What the job exits with when it could not even begin.
 *
 * These are about the JOB, not about setup: a failed setup exits through the
 * status file with outcome `failed`, and the pane's own exit code by then is
 * the login shell's. Only these three end the pane before anything is written,
 * and each says so on stderr in the same breath.
 */
export const SETUP_EXIT = {
  /** Another setup for this slug holds the lock. EX_TEMPFAIL: try later. */
  locked: 75,
  /** `flock` is not on the box, so the lock cannot be taken. EX_CONFIG. */
  noFlock: 78,
  /** The directory could not be entered, or the status file could not be
   *  written. */
  unusable: 1,
} as const;

/**
 * A slug as a file name: `spideryarn/reading2` → `spideryarn--reading2`.
 *
 * The slash has to go, and `--` rather than `-` because `a/b` and `a-b` are
 * both legal slugs and would otherwise land on the same status file — two
 * repos sharing one readiness record, which is a wrong answer rather than a
 * missing one. `unknown` is refused: a session started against an arbitrary
 * `--dir` belongs to no repo, and there is nothing to set up.
 */
export function setupSlugFile(slug: string): string {
  if (slug === REPO_UNKNOWN) {
    throw new Error(`setupSlugFile: '${REPO_UNKNOWN}' is not a repo — there is nothing to set up`);
  }
  if (!isRepoValue(slug)) throw new Error(`setupSlugFile: '${slug}' is not an owner/name slug`);
  return slug.replaceAll("/", "--");
}

/** Where a repo's setup verdict lives on the box, given the work directory
 *  (`~/gjd-remote`). Readable without knowing which attempt wrote it — that is
 *  what `setupVerdict` is for. */
export function setupStatusPath(work: string, slug: string): string {
  return `${work}/${SETUP_SUBDIR}/${setupSlugFile(slug)}.json`;
}

/** Everything on the box one attempt touches. `tmpPath` is deliberately beside
 *  `statusPath`, because `mv` is only atomic within one filesystem. */
export function setupPaths(o: { work: string; slug: string; attempt: string }): {
  setupDir: string;
  locksDir: string;
  statusPath: string;
  tmpPath: string;
  lockPath: string;
  logPath: string;
} {
  const file = setupSlugFile(o.slug);
  if (!ATTEMPT.test(o.attempt)) throw new Error(`setupPaths: '${o.attempt}' is not an attempt id`);
  const setupDir = `${o.work}/${SETUP_SUBDIR}`;
  const statusPath = `${setupDir}/${file}.json`;
  return {
    setupDir,
    locksDir: `${o.work}/${LOCKS_SUBDIR}`,
    statusPath,
    tmpPath: `${statusPath}.${o.attempt}.part`,
    lockPath: `${o.work}/${LOCKS_SUBDIR}/setup-${file}.lock`,
    logPath: `${setupDir}/${file}-${o.attempt}.log`,
  };
}

/**
 * The hash that says "set up the way this repo asks for TODAY", from the two
 * command STRINGS alone.
 *
 * **Superseded by `setupFingerprint` in scripts/gjd-remote-flow.ts**, which is
 * what the status file's `configSha256` should carry — GPT Sol's Stage 3
 * finding 2. Hashing the commands cannot see a changed `.gjd-remote/setup`
 * behind the constant command `./.gjd-remote/setup`, nor a changed
 * `package.json` body behind the constant `npm ci && npm run setup`; so a repo
 * whose setup script was rewritten under it kept its old success. It is kept
 * here until the last caller moves over, and its `v: 1` canonical form is why
 * the replacement's is `v: 2`.
 */
export function setupConfigSha256(command: string, check: string | undefined): string {
  const canonical = JSON.stringify({ v: 1, setup: command, check: check ?? null });
  return createHash("sha256").update(canonical, "utf8").digest("hex");
}

// ------------------------------------------------------------ the status file

/** What the job is telling us about itself. `started` is a live attempt, or an
 *  attempt whose pane died without getting to write anything else — the two are
 *  told apart by asking tmux, not by reading this. */
export type SetupOutcome = "started" | "success" | "failed";

/** Whether the repo's read-only `check` ran, and what it said. `none` is not a
 *  pass: it means the repo defined no check, or setup failed before one could
 *  run. */
export type CheckOutcome = "success" | "failed" | "none";

/**
 * A failure of the JOB's own machinery, as opposed to a failure of the repo's
 * setup command.
 *
 * `log` means `tee` could not write the log file, so the record of what
 * happened is incomplete. That is not a success even when the command exited 0:
 * `success` has to mean somebody can go and read what was done, and here nobody
 * can. Kept separate from `exitCode` because they answer different questions,
 * and folding them together is exactly what `pipefail` did.
 *
 * `config-changed` means the job, standing in the checkout and holding the
 * lock, found the files it was about to run no longer matching the fingerprint
 * the laptop asked for — see `fingerprintCheck` in `setupJobScript`. Nothing
 * ran. It is a `failed` outcome rather than nothing at all because a job that
 * refuses silently is a job whose pane vanishes with no verdict in it.
 */
export type ToolFailure = "log" | "config-changed";

export type SetupStatus = {
  v: 1;
  slug: string;
  /** The checkout on the box that was set up. */
  dir: string;
  /** Minted on the laptop, one per `gjd-remote setup`. */
  attempt: string;
  /** `setupConfigSha256` of the commands this attempt ran. */
  configSha256: string;
  /** The setup command text. Repo code, not a secret — it is shown in the
   *  prompt before it runs, and recorded here so a later reader can see what
   *  "success" was a success at. */
  command: string;
  startedAt: string;
  finishedAt?: string;
  outcome: SetupOutcome;
  exitCode?: number;
  checkOutcome?: CheckOutcome;
  /** Set when the job's own machinery failed. Never present on a `success`. */
  toolFailure?: ToolFailure;
  /**
   * The inode of the checkout's `.git`, as the box saw it while setting up.
   *
   * The one thing a re-clone at the same path cannot reproduce, and therefore
   * the only field that can tell "this tree was set up" from "a tree that used
   * to be here was set up". Absent when the directory is not a git checkout,
   * and absent from every status written before this field existed.
   *
   * **A status with no inode is not evidence about a checkout that has one.**
   * `wrongCheckout` refuses it rather than skipping the comparison, so an old
   * status file means one more `gjd-remote setup` — which is the cheap half of
   * that trade.
   */
  checkoutInode?: string;
  /** `git rev-parse --show-toplevel` with symlinks resolved, when the box could
   *  read one. `dir` is what was asked for; this is what was found. */
  checkoutRoot?: string;
};

const OUTCOMES: readonly SetupOutcome[] = ["started", "success", "failed"];
const CHECK_OUTCOMES: readonly CheckOutcome[] = ["success", "failed", "none"];
const TOOL_FAILURES: readonly ToolFailure[] = ["log", "config-changed"];

const REQUIRED_STRINGS = ["slug", "dir", "attempt", "configSha256", "command", "startedAt"] as const;
const KNOWN_KEYS = new Set<string>([
  "v",
  ...REQUIRED_STRINGS,
  "outcome",
  "finishedAt",
  "exitCode",
  "checkOutcome",
  "toolFailure",
  "checkoutInode",
  "checkoutRoot",
]);

type ParseResult = { ok: true; status: SetupStatus } | { ok: false; why: string };

const no = (why: string): ParseResult => ({ ok: false, why });

/** A JSON value as a string with something in it, or nothing. Whitespace is not
 *  something: a `dir` of three spaces is a field that was not filled in. */
function nonEmpty(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() !== "" ? v : undefined;
}

/** One of a fixed set of string literals, or nothing — the narrowing that stops
 *  an unrecognised outcome being carried as if it meant something. */
function oneOf<T extends string>(allowed: readonly T[], v: unknown): T | undefined {
  return allowed.find((a) => a === v);
}

/**
 * The status file's text, or the reason it is not one.
 *
 * FAILS CLOSED, every clause, and the reason it is worth this much code is
 * that the caller acts on the answer: `ok` means a session may start in that
 * tree. Each of these is a way of reading a success that did not happen —
 *
 *  - **Not JSON at all, or truncated.** `mv` makes the whole file appear at
 *    once, so a half-written file means something else wrote it; either way it
 *    is not evidence.
 *  - **A `v` this reader was not written against.** A newer gjd-remote may mean
 *    something different by `success`. Unknown keys are refused for the same
 *    reason: within v1 the shape is fixed, and a field this reader drops is a
 *    field it is silently disagreeing with.
 *  - **A finished outcome without its exit code, check outcome or finish
 *    time.** Absent fields default to nothing, and nothing reads as fine.
 *  - **A `success` that contradicts itself** — a non-zero exit code, or a check
 *    that failed. Two fields disagreeing is not a status to pick the friendlier
 *    half of.
 */
export function parseSetupStatus(text: string): ParseResult {
  if (text.trim() === "") return no("the status file is empty — nothing has written a verdict to it");

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    return no(`the status file is not JSON (${why})`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return no("the status file is not a JSON object");
  }
  const o = raw as Record<string, unknown>;

  if (!("v" in o)) return no("the status file has no 'v' — it was written before this format existed");
  if (o.v !== 1) return no(`the status file says v=${JSON.stringify(o.v)}, and this gjd-remote only understands v=1`);

  const unknown = Object.keys(o).filter((k) => !KNOWN_KEYS.has(k));
  if (unknown.length) {
    return no(`the status file has ${unknown.length === 1 ? "a field" : "fields"} I do not understand: ${unknown.map((k) => `'${k}'`).join(", ")}`);
  }

  const fields = requiredStrings(o);
  if (typeof fields === "string") return no(fields);
  const { slug, dir, attempt, configSha256, command, startedAt } = fields;

  if (!isRepoValue(slug) || slug === REPO_UNKNOWN) {
    return no(`the status file's slug '${slug}' is not an owner/name repo`);
  }
  if (!/^[0-9a-f]{64}$/.test(configSha256)) {
    return no("the status file's configSha256 is not a sha256");
  }

  const settled = oneOf(OUTCOMES, o.outcome);
  if (settled === undefined) {
    return no(
      `the status file's outcome is ${JSON.stringify(o.outcome)}, and only ${OUTCOMES.map((x) => `'${x}'`).join(", ")} mean anything`,
    );
  }

  const identity = parseIdentity(o);
  if (typeof identity === "string") return no(identity);

  const common: CommonStatus = { v: 1, slug, dir, attempt, configSha256, command, startedAt, ...identity };

  if (settled === "started") {
    // A live attempt carries none of the finishing fields. One that does was
    // written by something that stopped halfway through a thought.
    for (const key of ["finishedAt", "exitCode", "checkOutcome", "toolFailure"] as const) {
      if (key in o) return no(`the status file says it is still running but also has a '${key}'`);
    }
    return { ok: true, status: { ...common, outcome: "started" } };
  }
  return parseFinished(o, settled, common);
}

/** The fields every status carries, whatever it went on to say. */
type CommonStatus = Omit<SetupStatus, "outcome" | "finishedAt" | "exitCode" | "checkOutcome" | "toolFailure">;

/** Which checkout the status is about, or the sentence saying the file cannot
 *  be trusted about it. Both fields are optional — absent means "the box could
 *  not tell", which the verdict reads as no comparison. Present and malformed
 *  is a refusal: a field that is there and wrong is worse than one that is
 *  missing, because something will compare it. */
function parseIdentity(o: Record<string, unknown>): Pick<SetupStatus, "checkoutInode" | "checkoutRoot"> | string {
  const got: { checkoutInode?: string; checkoutRoot?: string } = {};
  if ("checkoutInode" in o) {
    const v = nonEmpty(o.checkoutInode);
    if (v === undefined || !/^[0-9]+$/.test(v)) {
      return `the status file's checkoutInode is ${JSON.stringify(o.checkoutInode)}, which is not an inode number`;
    }
    got.checkoutInode = v;
  }
  if ("checkoutRoot" in o) {
    const v = nonEmpty(o.checkoutRoot);
    if (v === undefined || !v.startsWith("/")) {
      return `the status file's checkoutRoot is ${JSON.stringify(o.checkoutRoot)}, which is not an absolute path`;
    }
    got.checkoutRoot = v;
  }
  return got;
}

/**
 * The six strings every status must have, or the sentence naming the first one
 * that is missing.
 *
 * Field by field, and each refusal names its own field. A missing one has to be
 * a refusal rather than an empty string: `dir: ""` would read as "set up at the
 * root of the box" rather than as "we do not know".
 */
function requiredStrings(o: Record<string, unknown>): Omit<CommonStatus, "v"> | string {
  const got: Partial<Record<(typeof REQUIRED_STRINGS)[number], string>> = {};
  for (const key of REQUIRED_STRINGS) {
    const v = nonEmpty(o[key]);
    if (v === undefined) return `the status file has no usable '${key}'`;
    got[key] = v;
  }
  const { slug, dir, attempt, configSha256, command, startedAt } = got;
  if (
    slug === undefined ||
    dir === undefined ||
    attempt === undefined ||
    configSha256 === undefined ||
    command === undefined ||
    startedAt === undefined
  ) {
    // Unreachable: the loop above returned for every one of them. Written out
    // rather than cast, so that adding a seventh name to REQUIRED_STRINGS
    // without adding it here is a compile error and not a silent hole.
    return "the status file is missing a field this reader knows about but did not check";
  }
  return { slug, dir, attempt, configSha256, command, startedAt };
}

/** The half of `parseSetupStatus` that only a finished attempt reaches: the
 *  three fields it must have, and the two ways it can contradict itself. */
function parseFinished(
  o: Record<string, unknown>,
  settled: "success" | "failed",
  common: CommonStatus,
): ParseResult {
  const finishedAt = nonEmpty(o.finishedAt);
  if (finishedAt === undefined) return no(`the status file says '${settled}' but has no finishedAt`);

  const exitCode = o.exitCode;
  if (typeof exitCode !== "number" || !Number.isInteger(exitCode) || exitCode < 0 || exitCode > 255) {
    return no(`the status file says '${settled}' but its exitCode is ${JSON.stringify(exitCode)}`);
  }
  const check = oneOf(CHECK_OUTCOMES, o.checkOutcome);
  if (check === undefined) {
    return no(`the status file says '${settled}' but its checkOutcome is ${JSON.stringify(o.checkOutcome)}`);
  }

  let toolFailure: ToolFailure | undefined;
  if ("toolFailure" in o) {
    toolFailure = oneOf(TOOL_FAILURES, o.toolFailure);
    if (toolFailure === undefined) {
      return no(`the status file says '${settled}' but its toolFailure is ${JSON.stringify(o.toolFailure)}`);
    }
  }

  if (settled === "success" && exitCode !== 0) {
    return no(`the status file claims success and an exit code of ${exitCode}, which cannot both be true`);
  }
  if (settled === "success" && check === "failed") {
    return no("the status file claims success and a failed check, which cannot both be true");
  }
  if (settled === "success" && toolFailure !== undefined) {
    // The job forces `failed` when its own machinery broke, so a file saying
    // both was not written by the job — and 'success' with no readable log is
    // the friendlier half of a contradiction, which is never the half to take.
    return no(`the status file claims success and a '${toolFailure}' tool failure, which cannot both be true`);
  }

  const done = { ...common, finishedAt, outcome: settled, exitCode, checkOutcome: check };
  return { ok: true, status: toolFailure === undefined ? done : { ...done, toolFailure } };
}

// ---------------------------------------------------------------- the verdict

/**
 * Is this repo set up, and if not, what should the person do about it.
 *
 * `remedy` is the command to type, or null when there is nothing to fix. Only
 * `success` is readiness: the CLI refuses a session on every other arm.
 */
export type SetupVerdict =
  | { kind: "never-run"; why: string; remedy: string }
  | {
      kind: "wrong-checkout";
      why: string;
      remedy: string;
      /** Which of the three bindings disagreed. */
      field: "slug" | "dir" | "inode";
      /** What the status file says, and what the caller asked about. */
      found: string;
      wanted: string;
    }
  | { kind: "stale-attempt"; why: string; remedy: string; found: string }
  | { kind: "in-progress"; why: string; remedy: string; attempt: string; startedAt: string }
  | { kind: "config-changed"; why: string; remedy: string }
  | { kind: "success"; why: string; remedy: null }
  | { kind: "failed"; why: string; remedy: string; exitCode: number; checkFailed: boolean };

/**
 * What we are asking the file to be evidence of.
 *
 * `attempt` is `string | null` rather than optional on purpose: the two callers
 * mean genuinely different questions and neither should be the default. `gjd-remote
 * setup` has just launched attempt X and wants to know about X — a file from
 * any other attempt is stale. `new-claude` is asking "is this repo ready?" and
 * does not care which run made it so, so it passes `null`. An optional field
 * would let the first caller forget, and forgetting means reading a previous
 * run's success as this one's.
 *
 * `slug` and `dir` are here because attempt and config hash between them never
 * say WHICH TREE the success was about — GPT Sol's finding 7. The status file
 * is per-slug and lives on the box, so one written for another directory, or
 * for a checkout that has since been deleted and cloned again at the same path,
 * would otherwise read as a success for a tree nothing has ever set up.
 */
export type SetupExpectation = {
  attempt: string | null;
  configSha256: string;
  /** The repo being asked about. */
  slug: string;
  /** The checkout on the box being asked about. */
  dir: string;
  /**
   * The `.git` inode of that checkout, if the caller looked it up on the box.
   *
   * Optional because not every caller can cheaply look — `gjd-remote doctor`
   * on a box that cannot `stat`, say. When the CALLER has none there is no
   * comparison to make and none is made; when the caller has one and the
   * STATUS has none, the status is refused as unbound (Sol's Stage 3 finding
   * 3), because it is a verdict about no particular tree.
   */
  checkoutInode?: string;
};

const RUN_SETUP = "gjd-remote setup   # set this repo up on the box";

/**
 * Is the status file about the checkout we are asking about at all, and if not,
 * which of the three bindings gave it away.
 *
 * Slug, then directory, then the `.git` inode — widest first, so the sentence
 * the reader gets names the biggest thing that is wrong. The inode is last
 * because it is the subtlest: everything else can match while the tree has been
 * deleted and cloned again, which is a checkout that has never had setup run in
 * it wearing a success.
 *
 * The inode clause has two ways to fire, and the second is the one that was
 * missing: two inodes that disagree, and a status with NO inode being asked
 * about a checkout that has one.
 */
function wrongCheckout(status: SetupStatus, expected: SetupExpectation): SetupVerdict | undefined {
  const mismatch = (field: "slug" | "dir" | "inode", found: string, wanted: string, why: string): SetupVerdict => ({
    kind: "wrong-checkout",
    field,
    found,
    wanted,
    why,
    remedy: RUN_SETUP,
  });

  if (status.slug !== expected.slug) {
    return mismatch(
      "slug",
      status.slug,
      expected.slug,
      `the setup status on the box is about ${status.slug}, not ${expected.slug} — whatever it proved, it did not prove this repo`,
    );
  }
  if (status.dir !== expected.dir) {
    return mismatch(
      "dir",
      status.dir,
      expected.dir,
      `the setup status on the box is about the checkout at ${status.dir}, not ${expected.dir} — nothing has set this one up`,
    );
  }
  const found = status.checkoutInode;
  const wanted = expected.checkoutInode;
  if (wanted === undefined) {
    // The caller could not look. Refusing here would mean a box where `ls -di`
    // fails could never start a session at all, and we would be refusing on our
    // own blindness rather than on evidence.
    return undefined;
  }
  if (found === undefined) {
    // GPT Sol's Stage 3 finding 3, and it USED TO FAIL OPEN: the comparison ran
    // only when both sides had an inode, so a verdict carrying none — one
    // written before the field existed, one restored from a backup, or the one
    // a `stuck` archive leaves sitting there after a re-clone — applied to
    // whatever checkout is at that path now. There IS a checkout in front of us
    // and this verdict is not about it; it is not about anything.
    return mismatch(
      "inode",
      "(none)",
      wanted,
      `the setup status for ${expected.dir} is not bound to any checkout — it records no .git inode, ` +
        `and the tree there now (.git ${wanted}) may not be the one it was about`,
    );
  }
  if (found !== wanted) {
    return mismatch(
      "inode",
      found,
      wanted,
      `the checkout at ${expected.dir} has been re-cloned since that setup ran (its .git was ${found}, and is now ${wanted}) — ` +
        "the tree that success was about no longer exists",
    );
  }
  return undefined;
}

/**
 * The whole decision, in order, and the order is the design.
 *
 * `wrong-checkout` comes first of all, because every later clause is a
 * statement about the tree the file names, and they are only worth making once
 * that is the tree in front of us.
 *
 * `stale-attempt` comes next because it is the most specific thing that can be
 * said about the run: a file about another run tells you nothing about yours,
 * and "it is about run Y" beats every observation you could make about run Y's
 * contents.
 *
 * `in-progress` comes before `config-changed` because it is the more actionable
 * sentence. A run holding the lock right now will refuse a second one anyway,
 * so telling somebody to re-run setup would send them into exit 75; telling
 * them a run is under way, and where its log is, lets them wait or look.
 */
export function setupVerdict(status: SetupStatus | undefined, expected: SetupExpectation): SetupVerdict {
  if (status === undefined) {
    return {
      kind: "never-run",
      why: "this repo has no setup status on the box — nothing has ever set it up",
      remedy: RUN_SETUP,
    };
  }

  const elsewhere = wrongCheckout(status, expected);
  if (elsewhere !== undefined) return elsewhere;

  if (expected.attempt !== null && status.attempt !== expected.attempt) {
    return {
      kind: "stale-attempt",
      found: status.attempt,
      why:
        `the setup status on the box is from attempt ${status.attempt}, not ${expected.attempt} — ` +
        "this run never got as far as writing one",
      remedy: RUN_SETUP,
    };
  }

  if (status.outcome === "started") {
    return {
      kind: "in-progress",
      attempt: status.attempt,
      startedAt: status.startedAt,
      why: `a setup attempt (${status.attempt}) started at ${status.startedAt} and has not finished`,
      // Not "wait": a job whose pane was killed leaves `started` for ever, and
      // only tmux can tell the two apart. That question belongs to the CLI.
      remedy: "gjd-remote ls   # is that setup session still running?",
    };
  }

  if (status.configSha256 !== expected.configSha256) {
    return {
      kind: "config-changed",
      why:
        `the last setup was for a different .gjd-remote config (${status.configSha256.slice(0, 12)}…, ` +
        `now ${expected.configSha256.slice(0, 12)}…) — whatever it proved, it did not prove this one`,
      remedy: RUN_SETUP,
    };
  }

  if (status.outcome === "failed") {
    const checkFailed = status.checkOutcome === "failed";
    const exitCode = status.exitCode ?? 0;
    // The log failure is said first when there was one, because "exit 0 and
    // failed" is otherwise a sentence nobody can act on.
    const why =
      status.toolFailure === "config-changed"
        ? `setup attempt ${status.attempt} refused to run: the repo's setup files on the box had changed since this run was ` +
          "asked for, so what would have run is not what was agreed"
        : status.toolFailure === "log"
          ? `setup ran on attempt ${status.attempt} (exit ${exitCode}) but its log could not be written, so there is no record of what it did`
          : checkFailed
          ? `setup ran on attempt ${status.attempt} but the repo's check failed`
          : `setup failed on attempt ${status.attempt}, exit ${exitCode}`;
    return { kind: "failed", exitCode, checkFailed, why, remedy: RUN_SETUP };
  }
  if (status.outcome === "success") {
    return {
      kind: "success",
      why: `set up on attempt ${status.attempt}, finished ${status.finishedAt ?? "(unrecorded)"}`,
      remedy: null,
    };
  }
  const never: never = status.outcome;
  throw new Error(`setupVerdict: unhandled outcome ${String(never)}`);
}

/** The verdict as the CLI prints it: what happened, then what to type. */
export function describeVerdict(v: SetupVerdict): string {
  return v.remedy === null ? v.why : `${v.why}\n  ${v.remedy}`;
}

// ------------------------------------------------------------- the job script

/**
 * Single-quote for the box's shell. A third copy of the one in
 * scripts/gjd-remote.ts, which cannot export it because that file runs `main()`
 * on import — the same reason scripts/gjd-remote-repo.ts has its own.
 */
function shq(s: string): string {
  return `'${s.replaceAll("'", `'\\''`)}'`;
}

export type SetupJobOptions = {
  slug: string;
  /** The checkout on the box. */
  dir: string;
  attempt: string;
  /** The repo's setup command, from .gjd-remote/config.toml or a convention. */
  command: string;
  /** The repo's read-only check, if it defined one. */
  check?: string;
  configSha256: string;
  /** The box user's home, for the setup command's environment. */
  home: string;
  /** The box user's name, likewise. */
  user: string;
  statusPath: string;
  tmpPath: string;
  lockPath: string;
  logPath: string;
  setupDir: string;
  locksDir: string;
  /**
   * What the job becomes once the verdict is written. Defaults to `exec bash
   * -l`, which is what keeps the tmux pane readable after the work.
   *
   * A SEAM FOR THE TEST, and it earns its place: the lock is released by
   * closing fd 9, and proving that means keeping the pane's process alive after
   * the work while a second `flock -n` tries the file. `exec bash -l` under a
   * closed stdin exits immediately, which passes the test for the wrong reason.
   * Nothing outside tests/gjd-remote-setup.test.ts passes it.
   */
  afterwards?: string;
  /**
   * What the laptop believes the repo's setup FILES say, re-derived by the job
   * inside the lock before anything runs — GPT Sol's Stage 3 finding 2.
   *
   * The laptop reads the config, shows a person what would run, waits for them
   * to answer, and then starts a job that runs it. Between the reading and the
   * running, the checkout is a directory anything on the box can write to: a
   * `git pull` in another pane rewrites `.gjd-remote/setup`, and the job runs
   * bytes nobody agreed to. The fingerprint the status file carries would then
   * name a specification the run never had.
   *
   * So the job recomputes both file facts standing in the checkout, holding the
   * lock, and refuses if they have moved. Both are `null` for "there is none",
   * which is a state the check must distinguish from "there is one and I could
   * not read it".
   *
   * **Optional only until scripts/gjd-remote.ts's `startSetup` passes it.**
   * A job built without it emits no check, which is the behaviour this exists
   * to remove — see the plan's Stage 3 notes.
   */
  expectFiles?: {
    /** sha256 of `.gjd-remote/setup`, or null when the file is not there. */
    scriptSha256: string | null;
    /** `package.json`'s `scripts.setup`, trimmed, or null when there is none. */
    packageSetup: string | null;
  };
};

/** The default for `afterwards`, named so the test can say what it is
 *  replacing. */
export const SETUP_AFTERWARDS = "exec bash -l";

/**
 * A command that cannot travel in a generated script.
 *
 * All three are already refused by scripts/gjd-remote-config.ts, and they are
 * checked again here because THIS is the place where being wrong stops being a
 * bad string and becomes shell syntax, or terminal escape sequences in a pane —
 * the job echoes the command it is about to run. A guard that only exists in
 * the parser protects only the callers that came through the parser, and
 * `--repo` outside a local checkout is already a path that does not.
 *
 * Exported because scripts/gjd-remote-flow.ts embeds commands in generated
 * shell for the same reasons: `sessionAdmissionScript` runs the caller's `tmux
 * new-session` line, and the clone transaction has a test hook. A second copy
 * of a guard is a copy that gets one clause fixed.
 */
export function requireOneLineCommand(where: string, what: string, command: string): void {
  if (command.trim() === "") throw new Error(`${where}: the ${what} command is empty`);
  if (/[\r\n]/.test(command)) {
    throw new Error(`${where}: the ${what} command must be one line`);
  }
  // Everything in C0 except TAB, plus DEL. ESC is the one that matters: this
  // string is printed to the pane, and a command carrying escape sequences
  // could repaint what the reader thinks happened. Never echo the value back.
  //
  // A loop rather than a character class, because a regex holding literal
  // control characters is a regex nobody can read in a diff — and biome's
  // noControlCharactersInRegex says the same thing.
  for (let i = 0; i < command.length; i++) {
    const code = command.charCodeAt(i);
    if ((code >= 0x20 && code !== 0x7f) || code === 0x09) continue;
    throw new Error(
      `${where}: the ${what} command has a control character (0x${code.toString(16).padStart(2, "0")}) at offset ${i}`,
    );
  }
}

/**
 * The bash the box runs, as one tmux pane.
 *
 * Started with
 * `tmux new-session -d -s <name> -e GJD_METADATA_VERSION=1 -e GJD_KIND=setup
 * -e GJD_REPO=<slug> -e GJD_REMOTE_DIR=<dir> 'bash <jobPath>'`, so `gjd-remote
 * ls` shows it as a setup job rather than as a shell (see `META` and
 * `SessionKind` in scripts/gjd-remote-tmux.ts).
 *
 * The order is the whole of it, and each step is here because skipping it
 * produces a confident wrong answer:
 *
 *  1. **`flock -n`, before anything else is touched.** Two setups for one repo
 *     racing on `npm ci` is how a half-installed tree gets a `success`. `-n`
 *     rather than a wait: a second person should be told, not queued behind a
 *     twenty-minute install. The lock is taken on fd 9 and held for the whole
 *     script, so it is released by the kernel when the pane dies — a lock that
 *     needs an `rm` to release is one a crash keeps for ever.
 *  2. **`flock` itself is required to exist**, with its own exit code. Without
 *     this the missing-flock case would come out as `flock: command not
 *     found` ⇒ non-zero ⇒ "another setup holds the lock", which is a true-
 *     sounding sentence about a box that has no lock at all.
 *  3. **`cd`, not `test -d`.** A directory with no execute bit passes `test -d`
 *     and refuses every attempt to enter it. This is `cdGuard`'s rule in
 *     scripts/gjd-remote.ts, and setup has more reason to hold it: running a
 *     repo's setup command in the wrong tree is worse than starting a shell
 *     there.
 *  4. **The setup files, re-derived under the lock**, and compared to what the
 *     laptop was told they were when it asked. A `git pull` between the config
 *     read and the job starting would otherwise run bytes nobody agreed to, and
 *     record a fingerprint naming a specification the run never had. Mismatch
 *     ⇒ a `failed` status with `toolFailure: "config-changed"`, and nothing is
 *     run. See `SetupJobOptions.expectFiles`.
 *  5. **The `started` status, written before the command runs**, so a job that
 *     is killed mid-`npm ci` leaves `started` rather than nothing. `never-run`
 *     and "it was running when the box rebooted" must not look the same.
 *  6. **The command, under `env -i`, with no stdin and no fd 9.** No profile is
 *     sourced and nothing of tmux's environment leaks in, so what runs on the
 *     box is what the config asked for and not what happened to be exported.
 *     `</dev/null` because a setup that stops to ask a question in a pane
 *     nobody is watching is a setup that hangs for ever. `9>&-` because the
 *     lock is an open file description and a child holding a copy of it can
 *     release it for everybody — see `run_step`.
 *  7. **Both halves of the pipeline's status, read separately.** Not
 *     `pipefail`, which reports the rightmost failure: when the command fails
 *     and `tee` fails too, the status file would record `tee`'s exit code as
 *     the repo's. The command's code is the exit code; a broken log is
 *     `toolFailure: "log"` and forces `failed`. Near neighbour of
 *     docs/postmortems/260831f-the-match-that-still-failed.md.
 *  8. **The final status, atomically**: written to a temp file beside it and
 *     renamed, so a reader never sees half of one.
 *  9. **fd 9 closed, THEN `exec bash -l`**, so the pane survives for reading,
 *     exactly as `cmdNewClaude`'s job does, and the lock does not survive with
 *     it. Note that this makes the pane's eventual exit code the login shell's
 *     — which is why the verdict is the file.
 *
 * Every path out of here either writes a status or says on stderr that it did
 * not and why. The three that write none exit before the `started` status
 * exists, and each has its own code in `SETUP_EXIT`; the fingerprint refusal in
 * step 4 writes a terminal `failed` status and then exits `unusable`, because a
 * job that refuses in silence is a pane that vanishes with no verdict in it.
 */
/**
 * The bash that re-derives the repo's setup files inside the lock and refuses
 * if they have moved — see `SetupJobOptions.expectFiles`.
 *
 * Written as one block rather than inline so the whole of the refusal is in one
 * place: it writes a terminal status and exits, and the two must not drift
 * apart. It runs after `cd "$dir"` and after the lock, which is the only
 * position where both facts are true — we are in the tree, and nothing else may
 * be changing it.
 *
 * `bad` is deliberately reachable three ways: a file that appeared, a file that
 * vanished, and a `package.json` that no longer parses. All three mean "not
 * what was agreed", and none of them may read as agreement.
 */
function fingerprintCheckBlock(expect: { scriptSha256: string | null; packageSetup: string | null }): string {
  // No single quotes in it, so shq wraps it without a thicket of escapes. The
  // same probe scripts/gjd-remote-flow.ts's boxConfigScript uses, so the two
  // sides cannot disagree about what "the setup script body" means.
  const pkgProbe =
    `const s=JSON.parse(require("fs").readFileSync("package.json","utf8")).scripts;` +
    `const v=s&&typeof s.setup==="string"?s.setup.trim():"";` +
    `console.log(v?"yes "+Buffer.from(v,"utf8").toString("base64"):"no")`;
  return [
    `# THE FILES, RE-READ UNDER THE LOCK — see SetupJobOptions.expectFiles.`,
    `want_sha=${shq(expect.scriptSha256 ?? "-")}`,
    `want_pkg=${shq(expect.packageSetup === null ? "no" : `yes ${Buffer.from(expect.packageSetup, "utf8").toString("base64")}`)}`,
    `got_sha=-`,
    `if [ -f ${shq(SETUP_SCRIPT)} ]; then`,
    `  if command -v sha256sum >/dev/null 2>&1; then got_sha=$(sha256sum ${shq(SETUP_SCRIPT)} | cut -d" " -f1)`,
    `  elif command -v shasum >/dev/null 2>&1; then got_sha=$(shasum -a 256 ${shq(SETUP_SCRIPT)} | cut -d" " -f1)`,
    `  else got_sha=unreadable; fi`,
    `  [ -n "$got_sha" ] || got_sha=unreadable`,
    `fi`,
    `got_pkg=no`,
    `if [ -f package.json ]; then`,
    `  got_pkg=$(node -e ${shq(pkgProbe)} 2>/dev/null) || got_pkg=bad`,
    `  [ -n "$got_pkg" ] || got_pkg=bad`,
    `fi`,
    `if [ "$got_sha" != "$want_sha" ] || [ "$got_pkg" != "$want_pkg" ]; then`,
    `  printf 'gjd-remote setup: the setup files in %s are not the ones this run was asked for — nothing was run\\n' "$dir" >&2`,
    `  fin=$(date -u +%Y-%m-%dT%H:%M:%SZ)`,
    `  write_status "$(printf '"outcome":"failed","exitCode":0,"checkOutcome":"none","finishedAt":"%s","toolFailure":"config-changed"' "$fin")" || exit ${SETUP_EXIT.unusable}`,
    `  exit ${SETUP_EXIT.unusable}`,
    `fi`,
  ].join("\n");
}

export function setupJobScript(o: SetupJobOptions): string {
  const guard = (what: string, command: string) => requireOneLineCommand("setupJobScript", what, command);
  guard("setup", o.command);
  if (o.check !== undefined) guard("check", o.check);
  // Tool-owned rather than repo-owned, so this is a guard against our own
  // mistakes rather than against the config — but it lands in the same script.
  if (o.afterwards !== undefined) guard("afterwards", o.afterwards);
  if (!/^[0-9a-f]{64}$/.test(o.configSha256)) {
    throw new Error(`setupJobScript: '${o.configSha256}' is not a sha256`);
  }
  // Throws on a slug that is not one, or on `unknown`. Called for the refusal,
  // not the name — the paths were built from it by `setupPaths` already.
  setupSlugFile(o.slug);
  const slug = o.slug;

  // The fields that do not change during the run, JSON-encoded here rather than
  // in bash: JSON.stringify escapes quotes, backslashes and control characters,
  // and — the part that matters for embedding — never emits a raw newline. So
  // this is one line, and shq can carry it.
  const base = [
    `"v":1`,
    `"slug":${JSON.stringify(slug)}`,
    `"dir":${JSON.stringify(o.dir)}`,
    `"attempt":${JSON.stringify(o.attempt)}`,
    `"configSha256":${JSON.stringify(o.configSha256)}`,
    `"command":${JSON.stringify(o.command)}`,
  ].join(",");

  const fingerprintCheck = o.expectFiles === undefined ? "" : fingerprintCheckBlock(o.expectFiles);

  // `env -i` is safe on this box because node is apt's, from NodeSource, and
  // there is no nvm to lose — see SETUP_PATH.
  //
  // Two things here are load-bearing, and both are GPT Sol's findings:
  //
  //  - **`9>&-` on BOTH halves of the pipeline** (finding 6). The lock lives on
  //    the open file description, so ANY process holding a copy of fd 9 can
  //    release it for everybody. The repo's setup command is a child of this
  //    shell and inherited it; one `flock -u 9` in a repo's setup script — or a
  //    `tee` that outlives the run — and a second `gjd-remote setup` runs `npm
  //    ci` in the same tree at the same time, which is the half-installed
  //    checkout the lock exists to prevent. The supervising shell keeps its
  //    own fd 9, so the lock is still held for the whole job.
  //  - **`PIPESTATUS` rather than `set -o pipefail`** (finding 8). pipefail
  //    reports the RIGHTMOST non-zero status, so a run where the command exits
  //    3 and `tee` also fails is recorded as exit 1 — tee's. Two different
  //    failures, and only one of them is the repo's. Read separately, the
  //    command's code goes in the status file and a broken log becomes
  //    `toolFailure: "log"`.
  //
  // A function rather than a subshell, because PIPESTATUS is only readable in
  // the shell that ran the pipeline.
  const runStep = [
    `run_step() {`,
    `  env -i HOME=${shq(o.home)} PATH=${shq(SETUP_PATH)} USER=${shq(o.user)} LANG=C.UTF-8 TERM=dumb \\`,
    `    bash -c "$1" </dev/null 2>&1 9>&- | tee -a "$log" 9>&-`,
    `  step_status=("\${PIPESTATUS[@]}")`,
    `  step_code=\${step_status[0]}`,
    `  if [ "\${step_status[1]}" -ne 0 ]; then log_failed=1; fi`,
    `  return "$step_code"`,
    `}`,
  ].join("\n");

  // Every `tee` gets `9>&-` for the same reason run_step's does: a tee left
  // running with a copy of fd 9 holds the lock past the work.
  const checkBlock =
    o.check === undefined
      ? [
          `# The repo defined no check, so 'none' it stays. Not a pass: see CheckOutcome.`,
          `printf 'gjd-remote setup: this repo defines no check command\\n' | tee -a "$log" 9>&-`,
        ].join("\n")
      : [
          `if [ "$code" -eq 0 ]; then`,
          `  printf '\\ngjd-remote setup: checking with %s\\n' ${shq(o.check)} | tee -a "$log" 9>&-`,
          `  if run_step ${shq(o.check)}; then chk=success; else chk=failed; fi`,
          `else`,
          `  printf '\\ngjd-remote setup: setup failed, so the check was not run\\n' | tee -a "$log" 9>&-`,
          `fi`,
        ].join("\n");

  return `#!/usr/bin/env bash
# gjd-remote setup job for ${slug}, attempt ${o.attempt}.
# Generated by scripts/gjd-remote-setup.ts — edits here are overwritten.
#
# The verdict of this job is ${o.statusPath}, not this script's exit code:
# the last line replaces this process with a login shell so the pane can be
# read, and that shell's status is what the pane finally exits with.
set -u
export PATH=${shq(SETUP_PATH)}:"\${PATH:-}"
export LANG=C.UTF-8

status=${shq(o.statusPath)}
tmp=${shq(o.tmpPath)}
lock=${shq(o.lockPath)}
log=${shq(o.logPath)}
dir=${shq(o.dir)}

mkdir -p ${shq(o.setupDir)} ${shq(o.locksDir)} || {
  printf 'gjd-remote setup: no status written because I could not create %s and %s\\n' \\
    ${shq(o.setupDir)} ${shq(o.locksDir)} >&2
  exit ${SETUP_EXIT.unusable}
}

# Step 2 in the header: told apart from a held lock, on purpose.
command -v flock >/dev/null 2>&1 || {
  printf 'gjd-remote setup: no status written because flock is not on this box — refusing to set up %s unlocked\\n' \\
    ${shq(slug)} >&2
  exit ${SETUP_EXIT.noFlock}
}

# ':' rather than 'exec 9>' first, because a failing redirection on 'exec' ends
# a non-interactive shell before the '||' can say anything.
: >>"$lock" || {
  printf 'gjd-remote setup: no status written because I could not open the lock file %s\\n' "$lock" >&2
  exit ${SETUP_EXIT.unusable}
}
exec 9>>"$lock"
flock -n 9 || {
  printf 'gjd-remote setup: no status written because another setup for %s already holds %s\\n' \\
    ${shq(slug)} "$lock" >&2
  exit ${SETUP_EXIT.locked}
}

cd "$dir" || {
  printf 'gjd-remote setup: no status written because I cannot enter %s on the box — refusing to set %s up somewhere else\\n' \\
    "$dir" ${shq(slug)} >&2
  exit ${SETUP_EXIT.unusable}
}

base=${shq(base)}
started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
log_failed=0

# WHICH CHECKOUT THIS IS, not just where it was — GPT Sol's finding 7. A tree
# deleted and cloned again at the same path matches on slug, on dir and on the
# config hash, while never having had setup run in it. The '.git' inode is the
# one thing the re-clone cannot reproduce, and it is read here, standing in the
# tree being set up.
#
# Both fields are best-effort: a directory that is not a git checkout has no
# identity to record, and the reader treats a missing one as "no comparison"
# rather than as a mismatch. What it must never do is record a wrong one.
checkout_inode=
checkout_root=
if [ -e .git ]; then
  if stat --version >/dev/null 2>&1; then
    checkout_inode=$(stat -c %i .git 2>/dev/null || true)  # GNU coreutils, the box
  else
    checkout_inode=$(stat -f %i .git 2>/dev/null || true)  # BSD stat, a Mac
  fi
fi
if command -v git >/dev/null 2>&1; then
  top=$(git rev-parse --show-toplevel 2>/dev/null || true)
  if [ -n "$top" ]; then checkout_root=$(cd "$top" 2>/dev/null && pwd -P || true); fi
fi
# The JSON is built by printf, so a value that could end the string early is
# DROPPED rather than escaped: an inode that is not digits, or a path outside a
# conservative allowlist (which loses one with a space in it, and that is the
# right way round). Losing the field costs a comparison; getting it wrong costs
# a status file nothing can parse.
case "$checkout_inode" in "" | *[!0-9]*) checkout_inode= ;; esac
case "$checkout_root" in "" | *[!A-Za-z0-9/._-]*) checkout_root= ;; esac
ident=
if [ -n "$checkout_inode" ]; then ident=$ident$(printf ',"checkoutInode":"%s"' "$checkout_inode"); fi
if [ -n "$checkout_root" ]; then ident=$ident$(printf ',"checkoutRoot":"%s"' "$checkout_root"); fi

# Temp file then rename, both under ${o.setupDir}, so a reader never sees half a
# status — and so a crash between the two leaves the previous verdict intact
# rather than a truncated one.
write_status() {
  if printf '{%s%s,"startedAt":"%s",%s}\\n' "$base" "$ident" "$started" "$1" > "$tmp" && mv -f "$tmp" "$status"; then
    return 0
  fi
  rm -f "$tmp" 2>/dev/null
  printf 'gjd-remote setup: no status written because %s could not be written\\n' "$status" >&2
  return 1
}

${fingerprintCheck}
write_status '"outcome":"started"' || exit ${SETUP_EXIT.unusable}

${runStep}

printf 'gjd-remote setup: %s in %s (attempt %s)\\n' ${shq(slug)} "$dir" ${shq(o.attempt)} | tee -a "$log" 9>&-
printf 'gjd-remote setup: running %s\\n' ${shq(o.command)} | tee -a "$log" 9>&-

chk=none
run_step ${shq(o.command)}
code=$?

${checkBlock}

# A run whose log went nowhere is failed whatever the command said: 'success'
# means somebody can go and read what happened, and here nobody can.
tool=
if [ "$log_failed" -ne 0 ]; then
  tool=',"toolFailure":"log"'
  printf 'gjd-remote setup: the log %s could not be written — recording this attempt as failed\\n' "$log" >&2
fi

if [ "$code" -eq 0 ] && [ "$chk" != failed ] && [ "$log_failed" -eq 0 ]; then outcome=success; else outcome=failed; fi
fin=$(date -u +%Y-%m-%dT%H:%M:%SZ)
write_status "$(printf '"outcome":"%s","exitCode":%d,"checkOutcome":"%s","finishedAt":"%s"%s' \\
  "$outcome" "$code" "$chk" "$fin" "$tool")"

printf '\\ngjd-remote setup: %s — %s exited %s, check %s\\n' \\
  "$outcome" ${shq(slug)} "$code" "$chk"
printf 'gjd-remote setup: the verdict is %s; the log is %s\\n' "$status" "$log"
printf -- '--- setup finished; shell follows, session stays alive ---\\n'

# THE LOCK'S LIFETIME IS THE WORK, NOT THE PANE, and this one line is the whole
# of it. Without the close, the shell below inherits fd 9 and the kernel holds
# the lock for as long as somebody has the session open — so a second
# 'gjd-remote setup' for this repo hit exit ${SETUP_EXIT.locked} half a second in, inside a pane
# that then vanished, which reached the laptop as "the job did not survive
# starting". Found against the box on 2026-09-02; tests/gjd-remote-setup.test.ts
# holds the pane alive and takes the lock from outside to keep it fixed.
exec 9>&-
${o.afterwards ?? SETUP_AFTERWARDS}
`;
}
