/**
 * **Make, and then remove, a live specimen for rule 1 — a Claude session that
 * did NOT come up in auto mode.**
 *
 *     npx tsx scripts/overseer-launch-mode-specimen.ts start
 *     npx tsx scripts/overseer-launch-mode-specimen.ts stop
 *
 * Rule 1 (`launch-mode`, `tools/overseer/rules.ts`) is a **regression alarm**:
 * the launcher fix landed at 12:20 on 2026-09-08 and every agent row has read
 * `auto` since, so there is no live condition for it to fire against and *"it
 * did not fire"* is consistent with both a working rule and a rule that can
 * never fire. The only honest demonstration is a specimen made deliberately —
 * and this is the file that makes one, so the next person testing rule 1
 * inherits the guards below rather than the lessons behind them.
 *
 * ## Why this cannot be `gjd-remote new-claude`
 *
 * That command always passes `--permission-mode auto`, on purpose and for good
 * reasons (`scripts/gjd-remote.ts`, at the `claude` line). The whole point of a
 * specimen is the launch WITHOUT it, so the session has to be built by hand —
 * which is exactly where the hazard below lives.
 *
 * ## THE GUARD, AND WHY IT IS CODE RATHER THAN A HABIT
 *
 * On 2026-09-08 a specimen made by hand carried `GJD_REPO=spideryarn2`, which is
 * neither an `owner/name` slug nor the sanctioned literal `unknown`. `parseMeta`
 * in `gjd-remote-tmux.ts` fails the **entire listing** on one malformed row
 * rather than dropping that row — deliberately, because a partial session list
 * gets read as permission by every caller. So from 21:37:12Z to 21:47:19Z
 * `gjd-remote ls` printed nothing, the fleet dashboard's collector failed with
 * the same sentence, and `overseer status` said *"Overseer unknown — the
 * dashboard's last collection failed"*. **Fourteen healthy sessions were
 * invisible to every reader of the fleet for ten minutes**, because of one
 * session created to test the rule that watches the fleet.
 *
 * A rule whose specimens are anomalous sessions will go on producing anomalous
 * sessions — that is what a specimen IS — and the fleet's readers are strict by
 * design, so this recurs every time anybody tests this rule. Hence: **`start`
 * runs `gjd-remote ls` after creating the session and kills the specimen if it
 * does not exit 0**, printing what it said. The guard is a property of the
 * specimen-maker, not of an agent's attention.
 *
 * `parseMeta`'s fail-whole behaviour is not the bug and is not being changed;
 * it is a reasoned choice, and this file is where its cost is paid.
 *
 * ## `GJD_REPO=unknown`, deliberately
 *
 * Both `unknown` and `spideryarn/reading2` are accepted. `unknown` is the
 * honest one: a specimen is not doing that repo's work, it exists to be an
 * anomaly, and labelling it with a repo would put it in that repo's listings and
 * counts. `REPO_UNKNOWN` is imported rather than typed, so the sanctioned value
 * cannot drift from the one the reader accepts.
 *
 * ## What it costs while it stands
 *
 * One idle `claude` process with no prompt — no tokens are spent, because
 * nothing is ever sent to it — and one tmux session. **Do not leave it
 * running**: it appears on the fleet dashboard as a real drifted session, which
 * is the point, and after the demonstration it is litter that reads as a live
 * defect.
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { REPO_UNKNOWN } from "./gjd-remote-repo.js";
import { META, METADATA_VERSION } from "./gjd-remote-tmux.js";

/** One fixed name, so a specimen left behind by a crashed run is found and reused rather than duplicated. */
export const SPECIMEN_SESSION = "overseer-launch-mode-specimen";

/**
 * The mode to launch in.
 *
 * `default` rather than an absence: measured on 2026-09-08, `claude` with no
 * `--permission-mode` at all came up in **auto** mode in this checkout, so
 * "just leave the flag off" does not make a specimen — it makes a healthy
 * session and a demonstration that proves nothing. The status bar reads
 * `⏸ manual mode on`, which is the string `readPaneMode` recognises as
 * `not-auto`.
 */
const SPECIMEN_MODE = "default";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * **THE `=` IS NOT DECORATION.** A bare `-t name` resolves by exact name and
 * then **by prefix**, so with the real specimen absent and a stray
 * `overseer-launch-mode-specimen-old` on the box, `has-session` answers yes and
 * `kill-session` kills the stranger. This repo has already been bitten by it
 * (`tests/gjd-remote-tmux.test.ts` § the prefix case) and GPT Sol found it here
 * again. `=name` is tmux's exact-match form.
 */
const EXACT = `=${SPECIMEN_SESSION}`;

function tmux(args: readonly string[]): string {
  return execFileSync("tmux", [...args], { encoding: "utf8", timeout: 20_000 });
}

/**
 * Whether the specimen — that one, not something whose name starts the same way
 * — is running.
 *
 * **Only exit status 1 means absent.** `catch { return false }` swallowed every
 * other way `has-session` can fail: no tmux server, no permission, a timeout.
 * Reading any of those as "no session" makes `start` create a second specimen
 * or `stop` claim it cleaned up when it did not — a refusal reported as a
 * reassurance, which is the shape this whole area keeps writing up.
 */
function sessionExists(): boolean {
  try {
    // `stdio: "pipe"` because tmux writes "can't find session: …" to stderr on
    // the ordinary absent case, and that sentence read as an error in a script
    // whose whole job is to be trusted about whether it broke something.
    execFileSync("tmux", ["has-session", "-t", EXACT], { encoding: "utf8", timeout: 20_000, stdio: "pipe" });
    return true;
  } catch (cause) {
    if ((cause as { status?: number }).status === 1) return false;
    throw new Error(`tmux could not say whether ${SPECIMEN_SESSION} exists: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
}

function stop(): number {
  if (!sessionExists()) {
    console.log(`no ${SPECIMEN_SESSION} session is running.`);
    return 0;
  }
  tmux(["kill-session", "-t", EXACT]);
  console.log(`killed ${SPECIMEN_SESSION}.`);
  return 0;
}

/** What `gjd-remote ls` said. Injected, so the verdict below is testable without a fleet to break. */
export type Listing = () => string;

const realListing: Listing = () =>
  execFileSync("npx", ["tsx", join(repoRoot, "scripts", "gjd-remote.ts"), "ls"], { encoding: "utf8", timeout: 120_000, cwd: repoRoot });

/**
 * **THE GUARD.** Ask the fleet's own strictest reader whether it can still read
 * the box, and refuse to hand over a specimen that has blinded it.
 *
 * `gjd-remote ls` is the right oracle rather than a re-implementation of
 * `parseMeta`, because what matters is whether the READER accepts the session —
 * and a second copy of the validation here would be a second thing to keep in
 * step with the first.
 *
 * **A listing that succeeds without the specimen in it is refused too**, and
 * that is the half worth arguing about. It is not proof the specimen is fine; it
 * is proof this check could not have seen a problem with it, and reporting that
 * as green is the shape of every silent success this project keeps writing up.
 *
 * The runner is a parameter so `tests/overseer-rules.test.ts` can exercise both
 * refusals. The only way to exercise them for real is to blind the fleet again,
 * which is exactly what this exists to stop.
 */
export function listingVerdict(listing: Listing = realListing): { ok: true } | { ok: false; why: string } {
  let out: string;
  try {
    out = listing();
  } catch (cause) {
    const error = cause as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, why: `${error.stderr ?? ""}${error.stdout ?? ""}${error.message ?? String(cause)}`.trim() };
  }
  // AN EXACT ROW, NOT A SUBSTRING. `ls` prints the name first on each row, and
  // `includes` was satisfied by `overseer-launch-mode-specimen-old` — the same
  // prefix hazard as the tmux target, one layer out.
  const named = out.split("\n").some((line) => line.trim().split(/\s+/)[0] === SPECIMEN_SESSION);
  if (!named) {
    return { ok: false, why: `the listing succeeded but has no row for ${SPECIMEN_SESSION}, so it cannot say whether the session is readable` };
  }
  return { ok: true };
}

function start(): number {
  if (sessionExists()) {
    console.log(`${SPECIMEN_SESSION} is already running. \`stop\` it first, or use it.`);
    return 1;
  }
  const sessionId = randomUUID();
  // THE METADATA QUARTET, ALL FOUR OF IT. Three of four is a row `parseMeta`
  // refuses, which is the whole incident this file exists because of.
  tmux([
    "new-session",
    "-d",
    "-s",
    SPECIMEN_SESSION,
    "-e",
    `CLAUDE_SESSION_ID=${sessionId}`,
    "-e",
    `${META.version}=${METADATA_VERSION}`,
    "-e",
    `${META.kind}=claude`,
    "-e",
    `${META.repo}=${REPO_UNKNOWN}`,
    "-e",
    `${META.dir}=${repoRoot}`,
    // The trailing shell is `new-claude`'s own idiom: the session outlives the
    // Claude in it, so a specimen that dies is still visibly a specimen rather
    // than a session that vanished.
    `claude --session-id ${sessionId} --permission-mode ${SPECIMEN_MODE} --name ${SPECIMEN_SESSION}; exec bash -l`,
  ]);

  const healthy = listingVerdict();
  if (!healthy.ok) {
    // FAIL CLOSED, and take the specimen with us. A malformed session left
    // standing costs every reader of the fleet, not just this run.
    tmux(["kill-session", "-t", EXACT]);
    console.error(`the fleet listing could not read the box with this specimen on it, so it has been killed:\n${healthy.why}`);
    return 1;
  }

  console.log(`${SPECIMEN_SESSION} is running (claude --permission-mode ${SPECIMEN_MODE}), and \`gjd-remote ls\` can still read the box.`);
  console.log("Its pane should read `⏸ manual mode on` within ~15s; the collector needs a cycle (~1 min) before /api/state shows it.");
  console.log(`KILL IT WHEN YOU ARE DONE: npx tsx scripts/overseer-launch-mode-specimen.ts stop`);
  return 0;
}

function main(argv: readonly string[]): number {
  const command = argv[2];
  switch (command) {
    case "start":
      return start();
    case "stop":
      return stop();
    default:
      console.error("usage: npx tsx scripts/overseer-launch-mode-specimen.ts start|stop");
      return 2;
  }
}

// ONLY WHEN THIS FILE IS THE ENTRY POINT. A test importing `listingVerdict`
// must not start a Claude session as a side effect of the import.
if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main(process.argv);
}
