#!/usr/bin/env -S npx tsx
/**
 * **Run one check and write down what happened**, so the Readiness tab has
 * something honest to show.
 *
 *     npx tsx scripts/readiness-run.ts test
 *     npx tsx scripts/tmux-job.ts npx tsx scripts/readiness-run.ts check
 *
 * The second form is the one to use for anything long: `tmux-job.ts` keeps the
 * output and survives the disconnect, and this records the verdict.
 * docs/plans/260909b-readiness-tab-latest-tests-and-typecheck-on-dev-with-24h-graphs.md.
 *
 * ## Why this is a separate script rather than a flag on tmux-job.ts
 *
 * `tmux-job.ts` takes an argv and forks a subshell, and its entire correctness
 * argument is that it does nothing but redirect — the log is opened before the
 * command runs and the command's stdout goes straight into it. Teaching it to
 * tee and parse would put a parser inside the one file that must not have one.
 * And not every check goes through tmux: a typecheck is run directly a dozen
 * times a night. This composes with it instead of competing.
 *
 * ## THE PENDING RECORD, WHICH IS THE WHOLE POINT OF THE ORDERING
 *
 * The record is written **before** the child is spawned and replaced afterwards.
 * A wrapper that only records at the end can spot a signal-killed child but
 * cannot record its own death — and its own death is a *box* failure, the
 * loudest thing this tab could have to say:
 *
 * > dev's previous run passed → a new run starts → the wrapper is selected by
 * > the OOM killer before append → the store contains no evidence of the
 * > attempt → the dashboard continues displaying the old pass as the latest
 * > readiness result.
 * >
 * > — GPT Sol, 2026-09-09
 *
 * ## The exit contract, and why each clause is here
 *
 *  - a child killed by a signal exits **128 + signal**, never 0. `tmux-job.ts`
 *    writes our `$?` into the log as `EXIT=`, and the backfill reads 129..159 as
 *    *killed*, so passing a signal through as 0 would launder an OOM kill into
 *    a passing suite one layer up.
 *  - **failing to record is failing.** Disk full, directory unwritable: this
 *    exits non-zero and says so even when the check itself passed. Otherwise
 *    the suite passes, nothing is written, and the dashboard goes on showing
 *    yesterday's green — a silent success inside the tool built to catch them.
 */
import { spawn } from "node:child_process";
import { hostname } from "node:os";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { footerRequired, joinEnds, parseBanner, parseOutput, scopeOf, type Banner } from "../tools/fleet/readiness-parse.js";
import { openReadinessStore, readinessDirFromEnv } from "../tools/fleet/readiness-store.js";
import { stampTree } from "../tools/fleet/readiness-git.js";
import {
  CHECK_KINDS,
  SCRIPT_FOR_KIND,
  outcomeFromExit,
  type CheckKind,
  type FinishedRecord,
  type StartedRecord,
} from "../tools/fleet/readiness.js";

/** How much of the child's output we keep for the parsers. The rest is passed through and forgotten. */
const HEAD_BYTES = 8 * 1024;
const TAIL_BYTES = 64 * 1024;

/** Exit status for "the check may well have been fine, but we could not write it down". */
export const EXIT_NOT_RECORDED = 70;

const RUNNABLE = CHECK_KINDS.filter((k) => k !== "other");

const HELP = [
  "readiness-run — run one check and record the result for the Readiness tab",
  "",
  `  npx tsx scripts/readiness-run.ts <${RUNNABLE.join("|")}>`,
  "",
  "  npx tsx scripts/tmux-job.ts npx tsx scripts/readiness-run.ts test",
  "",
  "Runs the npm script of that name, passes its output straight through, and",
  "writes one record to ~/.fleet-readiness/runs/. Exits with the check's own",
  `status — or ${EXIT_NOT_RECORDED} if the check ran but could not be recorded.`,
].join("\n");

/**
 * A rolling tail that never grows past its bound.
 *
 * **Not `spawnSync`'s buffered output.** A full `npm run check` prints
 * megabytes, and holding all of it in a wrapper whose job is to observe an
 * out-of-memory-prone box is a way for the measurement to kill the thing it is
 * measuring — or to hit `maxBuffer` and truncate the run itself. GPT Sol's P2.
 */
function makeCapture(): { push(chunk: string): void; head(): string; text(): string } {
  let head = "";
  let tail = "";
  /* **The count is what makes the two ends joinable.** Without it, output
     shorter than the two bounds together is held in BOTH windows and every line
     reaches the parsers twice — which is how a typecheck of four projects
     reported eight on this wrapper's first real run. See `joinEnds`. */
  let total = 0;
  return {
    push(chunk) {
      total += chunk.length;
      if (head.length < HEAD_BYTES) head = (head + chunk).slice(0, HEAD_BYTES);
      tail = (tail + chunk).slice(-TAIL_BYTES);
    },
    head: () => head,
    text: () => joinEnds(head, tail, total),
  };
}

/** The repo root, from this file rather than from `cwd`, which may be anywhere. */
function repoRoot(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
}

/**
 * The script bodies from `package.json`, so `scopeOf` can tell a full run from a
 * narrowed one without a second copy of them living in the source.
 */
function scriptBodies(root: string): Record<string, string> {
  try {
    const pkg: unknown = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    const scripts = (pkg as { scripts?: unknown }).scripts;
    if (typeof scripts !== "object" || scripts === null) return {};
    const out: Record<string, string> = {};
    for (const [name, body] of Object.entries(scripts as Record<string, unknown>)) {
      if (typeof body === "string") out[name] = body;
    }
    return out;
  } catch {
    return {};
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const asked = argv[0];
  if (asked === undefined || asked === "--help" || asked === "-h") {
    console.log(HELP);
    process.exit(asked === undefined ? 1 : 0);
  }
  if (!(RUNNABLE as readonly string[]).includes(asked)) {
    console.error(`readiness-run: '${asked}' is not one of ${RUNNABLE.join(", ")}`);
    process.exit(1);
  }
  const check = asked as Exclude<CheckKind, "other">;
  const script = SCRIPT_FOR_KIND[check];

  const cwd = process.cwd();
  const root = repoRoot();
  const runId = randomBytes(6).toString("hex");
  const startedAt = new Date();
  const startedMono = process.hrtime.bigint();

  const opened = openReadinessStore(readinessDirFromEnv());
  if (opened.kind === "refused") {
    console.error(`readiness-run: not recording — ${opened.why}`);
    process.exit(EXIT_NOT_RECORDED);
  }
  const store = opened.store;

  /* **The first line of our own output, so it lands in the tmux log.** The
     backfill scans those logs and would otherwise reconstruct a second, weaker
     copy of this very run — with no sha — and stamp it a moment later, so the
     duplicate would win on recency. This marker is how it knows to skip. */
  console.log(`readiness-run ${runId} ${check}`);

  const common = {
    schema: 1 as const,
    runId,
    startedAt: startedAt.toISOString(),
    pid: process.pid,
    host: hostname(),
    cwd,
    check: check as CheckKind,
    /* Full by construction — we run the bare script with no extra arguments —
       and **re-derived from npm's banner below anyway**, which is why this
       script does not pass `--silent`. A claim checked against the same
       evidence the backfill uses is worth more than one asserted here, and it
       means the scope parser is exercised by every wrapper run rather than only
       by its own fixtures. The banner also lands in the tmux log, where it is
       the only thing that can tell a targeted run from a full one. */
    scope: "full" as const,
    commandLine: null as string | null,
    treeAtStart: stampTree(cwd),
    source: "wrapper" as const,
  };

  const pending: StartedRecord = { ...common, state: "started" };
  try {
    store.put(pending);
  } catch (err) {
    console.error(
      `readiness-run: could not write the pending record, so this run would be invisible if it died — ${(err as Error).message}`,
    );
    process.exit(EXIT_NOT_RECORDED);
  }

  const capture = makeCapture();
  const child = spawn("npm", ["run", script], {
    cwd: root,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  /* Passed through as well as captured: this process usually sits inside
     `tmux-job.ts`, whose log is the thing a person tails. Swallowing the output
     to parse it would make the wrapper strictly worse than running the check
     directly. */
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (c: string) => {
    capture.push(c);
    process.stdout.write(c);
  });
  child.stderr.on("data", (c: string) => {
    capture.push(c);
    process.stderr.write(c);
  });

  const ended = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) => {
    child.on("error", () => resolve({ code: null, signal: null }));
    child.on("close", (code, signal) => resolve({ code, signal }));
  });

  const finishedAt = new Date();
  const durationMs = Number((process.hrtime.bigint() - startedMono) / 1_000_000n);
  const text = capture.text();
  const { counts, hasFooter } = parseOutput(check, text);

  /**
   * Scope, read back off npm's own banner rather than taken on trust.
   *
   * It should always agree with the `full` we asserted above — we ran the bare
   * script. If it ever does not, the banner wins: it is evidence about what npm
   * actually did, and the assertion is only about what we meant. A disagreement
   * would mean the `test` script had grown arguments of its own, in which case
   * every run is genuinely narrower than the name suggests.
   */
  const banner: Banner | null = parseBanner(capture.head());
  const scope = banner === null ? common.scope : scopeOf(banner, scriptBodies(root));
  const commandLine = banner?.commandLine ?? null;

  let outcome: FinishedRecord["outcome"];
  let why: string | null;
  let exit: number | null;

  if (ended.signal !== null) {
    exit = null;
    outcome = "void";
    why = `the check was killed by ${ended.signal} — it did not finish, whatever its output says`;
  } else if (ended.code === null) {
    exit = null;
    outcome = "void";
    why = "npm could not be started, so the check never ran";
  } else {
    const read = outcomeFromExit(ended.code);
    exit = ended.code;
    outcome = read.outcome;
    why = read.why;
    /* **`EXIT=0` alone is not a pass.** A nested process can die while the
       outer one exits 0; without the check's own terminal footer there is no
       evidence it reached a conclusion. Only ever downgrades. */
    if (outcome === "pass" && footerRequired(check) && !hasFooter) {
      outcome = "void";
      why =
        `it exited 0, but its own summary is not in the output — a ${check} run that never printed its ` +
        "conclusion has not been shown to have reached one";
    }
  }

  const finished: FinishedRecord = {
    ...common,
    scope,
    commandLine,
    state: "finished",
    at: finishedAt.toISOString(),
    durationMs,
    outcome,
    exit,
    counts,
    treeAtEnd: stampTree(cwd),
    logPath: null,
    why,
  };

  try {
    store.put(finished);
    store.sweep(finishedAt.getTime());
  } catch (err) {
    console.error(
      `readiness-run: the check finished ${outcome} but could not be recorded — ${(err as Error).message}`,
    );
    process.exit(EXIT_NOT_RECORDED);
  }

  /* A signal becomes 128+n rather than 0, so the layer above sees a kill. */
  if (ended.signal !== null) {
    const numbers: Partial<Record<string, number>> = { SIGHUP: 1, SIGINT: 2, SIGQUIT: 3, SIGKILL: 9, SIGTERM: 15 };
    process.exit(128 + (numbers[ended.signal] ?? 15));
  }
  process.exit(ended.code ?? EXIT_NOT_RECORDED);
}

function isMain(): boolean {
  const invoked = process.argv[1];
  if (!invoked) return false;
  return path.resolve(invoked) === path.resolve(fileURLToPath(import.meta.url));
}

if (isMain()) {
  void main();
}
