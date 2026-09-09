#!/usr/bin/env -S npx tsx
/**
 * **The Overseer: run it, and look at what it has seen.**
 *
 *     npx tsx scripts/overseer.ts run                 # the daemon
 *     npx tsx scripts/overseer.ts status              # is it alive, and what does it know
 *     npx tsx scripts/overseer.ts events --limit 40   # what the fleet did
 *     npx tsx scripts/overseer.ts notes  --limit 20   # what the Overseer's own day was like
 *
 * Direction: docs/project/overseer-direction.md. Stage S4 of
 * docs/plans/260908b-overseer-store-and-clock.md.
 *
 * **`status` is not a nicety on top of the daemon; it is the half that makes
 * the daemon worth having.** Greg's NOW goal is *"staying up-to-date on
 * progress automatically"*, and a daemon recording events with nothing to read
 * them fails that while every stage passes. The dashboard owns the page and
 * this stage does not build one, so the honest simplest version is a command.
 *
 * **Every read here is lock-free**, deliberately: `readCheckpoint` was built
 * that way so a reader cannot disturb the writer, and the event log and the
 * note log are read the same way — open, read, close. Running this against a
 * live daemon costs it nothing and can block nothing.
 *
 * `console.log` rather than src/log.ts: this is a CLI, and that is the rule —
 * docs/project/logging.md.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { Command, InvalidArgumentError } from "commander";

import { renderRootHelp } from "../tools/overseer/cli-help.js";
import { addMine, cliStatePath, readCliState, removeMine, updateCliState, whyNotASessionName } from "../tools/overseer/cli-state.js";

import { attentionRunner, DEFAULT_MAX_CALLS, runAttentionCommand } from "../tools/overseer/attention-cli.js";
import {
  runOverseer,
  USAGE_INTERVAL_MS,
  type DaemonOptions,
} from "../tools/overseer/daemon.js";
import { gjdRemoteDispatch, jobsEnabled, JOBS_ENABLED_VAR } from "../tools/overseer/dispatch.js";
import { describeRuleJobs, ruleJobs } from "../tools/overseer/rule-jobs.js";
import { RULES_ENABLED_VAR, ruleWork, rulesEnabled } from "../tools/overseer/rule-work.js";
import type { ProposingRuleWork } from "../tools/overseer/rule-protocol.js";
import { describeStandingJobs, standingJobs } from "../tools/overseer/standing-jobs.js";
/* THE DASHBOARD'S GROUPING AND THE DASHBOARD'S CLOCKS, imported rather than
   restated. `tools/overseer/` already depends on `tools/fleet/` — that is the
   allowed direction of the seam — and two renderings of one measurement is how
   a page and a terminal come to disagree about how many things happened. */
import { groupUsageIncidents } from "../tools/fleet/usage-feed.js";
import { makeUsageRetention } from "../tools/fleet/usage-history-wiring.js";
import { reconcileArming } from "../tools/overseer/arming.js";
import type { Arming, AuthorisedJob } from "../tools/overseer/jobs.js";
import { eligibilityOf, type JobEligibility } from "../tools/overseer/scheduler.js";
import { LAUNCH_SEPARATION_MS } from "../tools/overseer/schedules.js";
import { describeNote, readNotes } from "../tools/overseer/notes.js";
import {
  EVENTS_FILE,
  RECONCILE_FILE,
  describeRefusal,
  storeRoot,
} from "../tools/overseer/store.js";
import { collectUsage, type UsageReport } from "../tools/overseer/usage.js";
import { fetchLastLines } from "../tools/overseer/cli-messages.js";
import { tickLines } from "../tools/overseer/cli-tick.js";
import {
  describeEvent,
  inboxLines,
  readEventTail,
  readOverseerClaim,
  requireAbsoluteRoot,
  statusLines,
  when,
} from "../tools/overseer/status-cli.js";

// Compatibility for callers that imported these before the rendering moved.
// The implementation lives only in status-cli, so tick and status cannot drift.
export { inboxLines, readOverseerClaim };

/** Where the daemon looks for the dashboard unless told otherwise. */
export const DEFAULT_FLEET_URL = "http://127.0.0.1:8787";

/**
 * The checkout this script is part of.
 *
 * **From this file's own location, not from `process.cwd()`.** The systemd unit
 * sets `WorkingDirectory`, and a person running this by hand from anywhere else
 * would otherwise fingerprint whatever documents happened to be under their cwd
 * — which is a different job with the same name.
 */
export function repoRoot(): string {
  return join(fileURLToPath(new URL(".", import.meta.url)), "..");
}

/**
 * The positive scan control and cache detail for the dedicated usage command.
 * `ScanCoverage` is what stops an empty scan reading as a clear account.
 * (docs/reusable/silent-success.md). Likewise an expired cached window prints
 * its `why`, never a percentage: there is no percentage on that arm to print.
 */
function usageLines(report: UsageReport): string[] {
  const out: string[] = [];
  const a = report.account;
  out.push(
    a.kind === "value"
      ? `account   ${a.email ?? "?"}  ${a.subscriptionType ?? "?"}  tier ${a.rateLimitTier ?? "?"}  uuid ${a.accountUuid ?? "?"}`
      : a.kind === "logged-out"
        ? `account   NOT LOGGED IN (projects dir ${a.projectsDirectory ?? "?"})`
        : `account   could not tell: ${a.why}`,
  );
  out.push(`verdict   ${report.verdict.level.toUpperCase()}`);
  for (const reason of report.verdict.reasons) out.push(`          ${reason}`);

  if (report.cache.kind === "unknown") {
    out.push(`cache     could not tell: ${report.cache.why}`);
  } else {
    // THE INSTANT, IN UTC, NEXT TO THE AGE. "73 min ago" is only true at the
    // moment it is printed, and these lines get pasted into messages and plan
    // docs hours later — the wave's own rule, after four hand-typed timestamps
    // went wrong in one day. `fetchedAtMs` is a field all the way from
    // `~/.claude.json`, so the absolute form costs nothing and cannot drift.
    out.push(
      `cache     fetched ${whenEpoch(report.cache.fetchedAtMs)} (${Math.round(report.cache.ageMs / 60_000)} min before this reading), account ${report.cache.accountUuid ?? "?"}`,
    );
    for (const w of report.cache.windows) {
      if (w.kind === "value") out.push(`          ${w.window}: ${w.utilizationPercent}% used, resets ${when(w.resetsAt)}`);
      else if (w.kind === "expired") out.push(`          ${w.window}: EXPIRED — ${w.why}`);
      else out.push(`          ${w.window}: unknown — ${w.why}`);
    }
  }

  const c = report.rateLimits.coverage;
  out.push(
    `scanned   ${c.transcriptsOpened}/${c.transcriptsSelected} of ${c.transcriptsFound} transcripts, ${c.linesScanned} lines, ${c.candidateLines} candidates, ${c.tookMs}ms` +
      `${c.transcriptsUnreadable > 0 ? `, ${c.transcriptsUnreadable} unreadable` : ""}` +
      `${c.malformedCandidates > 0 ? `, ${c.malformedCandidates} MALFORMED` : ""}` +
      `${c.truncatedByLimit ? ", TRUNCATED by --max-transcripts" : ""}`,
  );
  switch (report.rateLimits.kind) {
    case "hits": {
      // **ONE WINDOW, ONE INCIDENT** — the same grouping the dashboard draws,
      // out of the same function, because two renderings of one measurement is
      // how the two ends come to disagree about how many things happened. The
      // old form printed one line per rejection and truncated at ten, which on
      // the 27 rejections measured on 2026-09-08 was seventeen invisible lines
      // all repeating one reset instant.
      const incidents = groupUsageIncidents(report.rateLimits.hits);
      for (const incident of incidents) {
        const sessions = incident.conversations.length;
        out.push(
          `429       ${incident.window}  resets ${when(incident.resetsAt)}  ` +
            `${sessions} ${sessions === 1 ? "conversation" : "conversations"}, ${incident.rejections} rejected` +
            `${incident.unidentifiedRejections > 0 ? ` (${incident.unidentifiedRejections} unattributed)` : ""}`,
        );
        if (incident.firstHitAt !== null) {
          out.push(`          first ${when(incident.firstHitAt)}${incident.lastHitAt === null ? "" : `, last ${when(incident.lastHitAt)}`}`);
        }
      }
      break;
    }
    case "none":
      out.push("429       none in the scanned window — believable only against the `scanned` line above");
      break;
    case "unknown":
      out.push(`429       could not tell: ${report.rateLimits.why}`);
      break;
    default: {
      const never: never = report.rateLimits;
      throw new Error(String(never));
    }
  }
  out.push(`took      ${report.tookMs}ms, at ${when(report.collectedAt)}`);
  return out;
}

/**
 * The same, from an epoch millisecond that came out of `~/.claude.json`.
 *
 * **`when(new Date(ms).toISOString())` IS NOT THIS, and the difference took
 * down `overseer status`.** The argument is evaluated first, so a `fetchedAtMs`
 * of `1e100` — finite, and the producer's parsers only check finiteness —
 * throws `RangeError: Invalid time value` before `when` can contain anything.
 * Reproduced by GPT Sol in round two, 2026-09-09: `overseer usage` exited 1
 * while `overseer usage --json` happily printed the malformed value.
 *
 * The range is ECMAScript's own ±8.64e15. Out of it, the number is printed as
 * the raw thing it is rather than as a time, which is the honest rendering of a
 * field nobody can turn into an instant.
 */
function whenEpoch(ms: number): string {
  if (!Number.isFinite(ms) || Math.abs(ms) > 8.64e15) return `${ms} (not an instant this tool can read)`;
  return when(new Date(ms).toISOString());
}

/** How the usage rows name this script, and what a person types. */
const INVOCATION = "npx tsx scripts/overseer.ts";

/**
 * The paragraphs the parser cannot generate.
 *
 * Everything here is a thing Commander does not know: what a command costs, who
 * decides whether it is armed, and which of two similar-looking switches is the
 * one that spends money. The usage rows between them come out of the registered
 * commands — `tools/overseer/cli-help.ts` says why the two halves are split.
 */
const HELP_PROSE_AFTER: readonly string[] = [
  `The store is $OVERSEER_STORE_DIR, or ~/.overseer. The dashboard is ${DEFAULT_FLEET_URL} unless --url says otherwise.`,
  [
    "`attention` reads every live pane and says what needs Greg. --dry makes no model calls and no",
    "paid pass. It does NOT write the store's memory unless you pass --write: the daemon holds the",
    "lock and this command does not honour it, so two writers is the default you do not want.",
  ].join("\n"),
  [
    `THE SCHEDULER IS OFF unless ${JOBS_ENABLED_VAR}=1. Armed, it dispatches the standing jobs in`,
    "docs/project/overseer.md as real Claude sessions on this box, so turning it on is Greg's",
    "decision and not a side effect of starting the daemon. `status` says which it is.",
  ].join("\n"),
  [
    `${RULES_ENABLED_VAR}=1 is the OTHER arming: the deterministic rules and nothing else. A daemon`,
    "started that way is handed no session dispatcher at all, so it cannot start a Claude session and",
    "cannot spend anything. It is the switch to use to watch a rule fire.",
  ].join("\n"),
];

/** The root help, rows and all. A function because the rows come from the program. */
export function help(): string {
  return renderRootHelp({
    program: buildProgram(),
    prefix: INVOCATION,
    title: "overseer — the fleet's history, and the daemon that records it",
    after: HELP_PROSE_AFTER,
  });
}

/**
 * **What the daemon will be given as a scheduler, and whether it is armed.**
 *
 * A function rather than four lines inside `case "run"` for one reason: GPT
 * Sol's C1 was that the shipped CLI passed no `jobs` at all, and a decision made
 * inline inside a command that starts a daemon is a decision no test can ask
 * about. This one can be, and `tests/overseer-standing-jobs.test.ts` does.
 *
 * **OFF UNLESS SOMEBODY SAID SO OUT LOUD.** Arming it starts real Claude
 * sessions on a shared box, which is Greg's decision and must not be a side
 * effect of merging a branch — the same spirit as `FLEET_ACT_ENABLED`, and the
 * same shape: exactly `"1"`.
 *
 * The definitions are built either way, so a disarmed daemon can still say WHAT
 * it would have run and whether any of it has drifted from its pin. "Off" and
 * "on with nothing to do" are different states and this returns different
 * sentences for them.
 */
/**
 * **Which of the three armings this daemon is under.**
 *
 * `rules-only` is GPT Sol's SP-4. There was one global switch; arming it
 * supplied both standing jobs, and both were immediately due — so *"watch each
 * rule fire for real"* could not be done without starting paid model sessions
 * under a gate 4 the plan admits is unbuilt.
 *
 * **The separation is a capability, not a filter.** Under `rules-only` the
 * daemon is handed no `SpawnJob` at all, so nothing in that process can create
 * a Claude session however due a job is; and `ruleJobs()` returns
 * `AuthorisedRuleJob[]`, a type a session job cannot inhabit. A filter that a
 * future job could fall through is what this deliberately is not.
 */
export type SchedulerArming = "off" | "rules-only" | "all";

export function schedulerWiring(env: NodeJS.ProcessEnv, armedAt: Arming): {
  /** True for either arming. Kept because the status page and the start note both ask the yes/no question. */
  armed: boolean;
  arming: SchedulerArming;
  detail: string;
  problems: readonly string[];
  /**
   * **WHETHER EACH LOADED JOB COULD ACTUALLY RUN**, under the capabilities this
   * wiring would hand the daemon.
   *
   * GPT Sol's S8-7. The word this function used to hand its callers came from
   * `jobsEnabled(env)` and nothing else, so `ARMED` was a restatement of an
   * environment variable rather than a claim about the box. This is the fact the
   * activation command exits non-zero on, and the fact the daemon's checkpoint
   * headline is now made of.
   */
  eligibility: readonly JobEligibility[];
  /** What the definitions WOULD be under a full arming — so a disarmed daemon can still say what it is not running. */
  definitions: readonly AuthorisedJob[];
  /**
   * **What `runOverseer` is actually given**, ready to spread — and `undefined`
   * when disarmed, because an absent `jobs` is what makes the daemon build no
   * scheduler timer at all. Returning the fragment rather than a boolean is what
   * lets a test ask the question C1 was about: *does the shipped CLI hand the
   * daemon anything to run?*
   */
  jobs: DaemonOptions["jobs"] | undefined;
} {
  const root = repoRoot();
  const standing = standingJobs(root);
  const rules = ruleJobs(root);
  const arming: SchedulerArming = jobsEnabled(env) ? "all" : rulesEnabled(env) ? "rules-only" : "off";
  const sessionDetail = describeStandingJobs({ armed: arming === "all", enableVar: JOBS_ENABLED_VAR, jobs: standing });
  const ruleDetail = describeRuleJobs({ armed: arming !== "off", enableVar: RULES_ENABLED_VAR, jobs: rules });
  const problems = [...standing.problems, ...rules.problems];
  const definitions = [...standing.jobs, ...rules.jobs];
  const work = (): ProposingRuleWork => ruleWork({ baseUrl: fleetUrl(env), selfPid: process.pid });
  // WHAT THIS PROCESS WOULD HOLD, matching the `jobs` fragment below exactly. A
  // second reading of the same decision would be the drift GPT Sol's S8-7 is
  // about, one level in, so both come from `arming`.
  const held = { session: arming === "all", rules: arming !== "off" };
  const eligibility = arming === "off" ? [] : eligibilityOf(arming === "all" ? definitions : rules.jobs, held);
  return {
    armed: arming !== "off",
    arming,
    eligibility,
    detail:
      arming === "rules-only"
        ? // THE ONE SENTENCE THAT MATTERS MOST HERE. A reader must not have to
          // infer from an absent job list that no session can start; it is a
          // property of what this process was handed, so it is said out loud.
          `deterministic rules only (${RULES_ENABLED_VAR}=1): ${ruleDetail}. ` +
          `NO SESSION DISPATCHER WAS BUILT, so no job in this daemon can start a Claude session — ${sessionDetail}`
        : `${sessionDetail}; rules: ${ruleDetail}`,
    problems,
    definitions,
    jobs:
      arming === "all"
        ? {
            definitions,
            spawn: gjdRemoteDispatch({ repoRoot: root }),
            rules: work(),
            arming: armedAt,
            launchSeparationMs: LAUNCH_SEPARATION_MS,
          }
        : arming === "rules-only"
          ? // NO `spawn` KEY AT ALL. Not `spawn: undefined`, not a spawner that
            // refuses: the capability is absent from the process.
            //
            // The spacing gate is still passed and is still inert here, because
            // it only ever gates session work and this process can start none.
            { definitions: rules.jobs, rules: work(), arming: armedAt, launchSeparationMs: LAUNCH_SEPARATION_MS }
          : undefined,
  };
}

/** Where the dashboard is, for a rule that needs to ask it something. One reading, so the daemon and its rules cannot disagree about the address. */
function fleetUrl(env: NodeJS.ProcessEnv): string {
  return env["OVERSEER_FLEET_URL"] ?? DEFAULT_FLEET_URL;
}

/**
 * A positive finite number, or a refusal Commander turns into a usage error.
 *
 * **The refusal is the whole point of the function.** `Number("nope")` is `NaN`,
 * `Number("")` is `0` and `Number(undefined)` is `NaN` — all of which used to
 * sail through `Number(flag(argv, …) ?? default)` and silently disable the bound
 * they were meant to set (GPT Sol's finding 10 on the earlier hand-rolled
 * parser). A flag that quietly does the opposite of what it says is worse than
 * no flag.
 *
 * `integer` is separate because some of these are COUNTS. `--max-transcripts
 * 0.5` passed the positive check and then `slice(0, 0.5)` selected zero
 * transcripts: a flag that reads as "scan at most half a file" and behaves as
 * "scan nothing". `--since-hours` stays fractional on purpose; half an hour is
 * a sensible window.
 */
export function positiveNumber(name: string, opts: { integer?: boolean } = {}): (raw: string) => number {
  return (raw: string): number => {
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(value) || value <= 0) {
      throw new InvalidArgumentError(`${name} must be a positive number, got ${JSON.stringify(raw)}`);
    }
    if (opts.integer === true && !Number.isInteger(value)) {
      throw new InvalidArgumentError(`${name} counts whole things, so it must be a whole number, got ${JSON.stringify(raw)}`);
    }
    return value;
  };
}

/**
 * **What the command line MEANT**, separated from doing it.
 *
 * A discriminated union rather than the `argv` array the bodies below used to
 * re-scan for themselves. Two things fall out of that, and the second is why it
 * is worth a type:
 *
 * - **A test can ask what a command line parses to** without a store, a
 *   dashboard or a daemon. There was no such test before, because there was
 *   nothing to ask.
 * - **A flag that is not read cannot be spelled.** `--max-transcipts` used to
 *   be a silent no-op; now it is an unknown option and Commander says so.
 *
 * Absent is absent: the optional fields here are genuinely missing rather than
 * `undefined`, because `exactOptionalPropertyTypes` tells those apart and the
 * daemon's options object depends on the difference.
 */
export type Parsed =
  | { command: "status" }
  | { command: "tick" }
  | { command: "last"; session: string; turns: number }
  | { command: "events"; limit: number }
  | { command: "notes"; limit: number }
  | {
      command: "attention";
      maxCalls: number;
      dry: boolean;
      json: boolean;
      write: boolean;
      out: string | null;
      panes: string | null;
      captureTo: string | null;
    }
  | { command: "usage"; json: boolean; sinceHours?: number; maxTranscripts?: number }
  | { command: "reconcile-jobs"; why: string }
  | { command: "run"; attention: boolean; usage: boolean; url?: string; tickMs?: number }
  | { command: "mine"; action: "list" }
  | { command: "mine"; action: "add" | "rm"; name: string };

/**
 * The grammar, and nothing else — no store is opened and no environment is read
 * while this is built, so `help()` can build one purely to print its rows.
 *
 * Every action does one thing: hand its parsed shape to `sink`. The work is in
 * `runParsed`. Commander is the parser here and not the program.
 */
export function buildProgram(sink: (parsed: Parsed) => void = () => {}): Command {
  const program = new Command();
  program
    .name("overseer")
    // **THE ROOT'S help is ours; a SUBCOMMAND's is Commander's.** `help()` is a
    // briefing — what a command costs, who decides whether it is armed — which
    // Commander cannot generate, so the root turns its own off. Subcommands keep
    // theirs, and they must: `helpOption(false)` is inherited at creation, so
    // turning it off here once made `usage --help` an *unknown option* that
    // exited 1 with empty stdout, on every subcommand. GPT Sol's P1 on Stage 1.
    .helpOption(false)
    .addHelpCommand(false)
    .exitOverride();

  program.command("status").description("is the daemon alive, and what does it know").action(() => sink({ command: "status" }));

  program
    .command("tick")
    .description("the Overseer's read-only half-hourly screen")
    .action(() => sink({ command: "tick" }));

  program
    .command("last")
    .argument("<session>", "a session name from the dashboard")
    .description("recent turns from one session")
    .option("--turns <n>", "how many turns to print", positiveNumber("--turns", { integer: true }), 1)
    .action((session: string, opts: { turns: number }) => sink({ command: "last", session, turns: opts.turns }));

  program
    .command("events")
    .description("what the fleet did")
    .option("--limit <n>", "how many to print", positiveNumber("--limit", { integer: true }), 40)
    .action((opts: { limit: number }) => sink({ command: "events", limit: opts.limit }));

  program
    .command("notes")
    .description("what the Overseer's own day was like")
    .option("--limit <n>", "how many to print", positiveNumber("--limit", { integer: true }), 40)
    .action((opts: { limit: number }) => sink({ command: "notes", limit: opts.limit }));

  program
    .command("attention")
    .description("read every live pane and say what needs Greg")
    .option("--max-calls <n>", "bound on paid model calls", positiveNumber("--max-calls", { integer: true }), DEFAULT_MAX_CALLS)
    .option("--dry", "no model calls and no paid pass", false)
    .option("--json", "the list as JSON", false)
    .option("--write", "write the store's memory (the daemon holds its lock; you do not)", false)
    .option("--out <file>", "write the list here")
    .option("--panes <dir>", "read captured panes from here instead of tmux")
    .option("--capture-to <dir>", "capture live panes into here first")
    .action((opts: { maxCalls: number; dry: boolean; json: boolean; write: boolean; out?: string; panes?: string; captureTo?: string }) =>
      sink({
        command: "attention",
        maxCalls: opts.maxCalls,
        dry: opts.dry,
        json: opts.json,
        write: opts.write,
        out: opts.out ?? null,
        panes: opts.panes ?? null,
        captureTo: opts.captureTo ?? null,
      }),
    );

  program
    .command("usage")
    .description("how close the shared account is to a limit")
    .option("--since-hours <n>", "how far back to scan", positiveNumber("--since-hours"))
    .option("--max-transcripts <n>", "how many transcripts to read", positiveNumber("--max-transcripts", { integer: true }))
    .option("--json", "the report as JSON", false)
    .action((opts: { sinceHours?: number; maxTranscripts?: number; json: boolean }) =>
      sink({
        command: "usage",
        json: opts.json,
        ...(opts.sinceHours === undefined ? {} : { sinceHours: opts.sinceHours }),
        ...(opts.maxTranscripts === undefined ? {} : { maxTranscripts: opts.maxTranscripts }),
      }),
    );

  program
    .command("reconcile-jobs")
    .description("clear a held occurrence ledger, once, with a reason")
    // MANDATORY, not defaulted. This clears a hold that exists because nobody
    // can tell whether some job already ran, and the reason goes into the store
    // for whoever later asks why a job ran twice.
    .requiredOption("--why <what you checked>", "what you looked at before deciding")
    .action((opts: { why: string }) => sink({ command: "reconcile-jobs", why: opts.why }));

  // THE LIST THE OTHER SUBCOMMANDS READ. One noun, three verbs, and `mine` with
  // no verb lists — the brief asked for `ls-mine` as well, and two spellings for
  // one noun is the drift this CLI exists to remove.
  const mine = program.command("mine").description("the sessions this Overseer is looking after");
  mine.command("list", { isDefault: true }).description("print them").action(() => sink({ command: "mine", action: "list" }));
  mine
    .command("add")
    .argument("<name>", "a session name")
    .description("start looking after one")
    .action((name: string) => sink({ command: "mine", action: "add", name }));
  mine
    .command("rm")
    .argument("<name>", "a session name")
    .description("stop looking after one")
    .action((name: string) => sink({ command: "mine", action: "rm", name }));

  program
    .command("run")
    .description("the daemon")
    .option("--url <url>", "the dashboard to collect from")
    .option("--tick-ms <n>", "how often to collect", positiveNumber("--tick-ms", { integer: true }))
    // `--no-x` is Commander's negation form: the option is `attention`, default
    // true, and `--no-attention` turns it off. Same switch, same spelling, and
    // now the parser rather than an `argv.includes` knows about it.
    .option("--no-attention", "do not run the paid attention pass")
    .option("--no-usage", "do not scan for usage limits")
    .action((opts: { url?: string; tickMs?: number; attention: boolean; usage: boolean }) =>
      sink({
        command: "run",
        attention: opts.attention,
        usage: opts.usage,
        ...(opts.url === undefined ? {} : { url: opts.url }),
        ...(opts.tickMs === undefined ? {} : { tickMs: opts.tickMs }),
      }),
    );

  // EVERY SUBCOMMAND GETS ITS HELP BACK, and its own `exitOverride`, after the
  // whole tree exists. Both settings are copied from the parent when a child is
  // created, so doing this at the top would reach nothing that had not been
  // built yet — the same creation-time trap as `configureOutput`.
  const restoreHelp = (command: Command): void => {
    for (const child of command.commands) {
      child.helpOption("-h, --help", "what this command takes");
      child.exitOverride();
      restoreHelp(child);
    }
  };
  restoreHelp(program);

  return program;
}

/**
 * A command line in, one of three answers out.
 *
 * `help` is a request, not a failure, and exits 0; `error` is a refusal and
 * exits 1 with the same prose help underneath it, because a person who typed a
 * flag wrong is exactly the person who needs the rows.
 */
export type ParseOutcome =
  | { kind: "run"; parsed: Parsed }
  /** `text` is a subcommand's own generated help; `null` means print the root briefing. */
  | { kind: "help"; text: string | null }
  | { kind: "error"; why: string };

export function parseArgv(argv: readonly string[]): ParseOutcome {
  // NO ARGUMENT MEANS `status`. Kept from the hand-rolled parser: bare
  // `overseer` is the thing the Overseer types most, and Commander's default
  // for an empty line is its own help.
  const words = argv.length === 0 ? ["status"] : [...argv];
  const first = words[0];
  if (first === "--help" || first === "-h" || first === "help") return { kind: "help", text: null };

  let parsed: Parsed | undefined;
  const program = buildProgram((p) => {
    parsed = p;
  });
  // Commander writes to stdout/stderr by default; here every word it produces
  // has to come back as a value, so the caller decides what is an error and
  // what is help.
  //
  // **AND ON EVERY SUBCOMMAND, not only the program.** A subcommand copies its
  // parent's settings *at the moment it is created*, so a `configureOutput`
  // applied afterwards reaches the root and nothing under it — which is how
  // `error: unknown option '--max-transcipts'` went on being printed to the
  // real stderr by a function whose whole job is to return the message instead.
  // Found by a test run's output, not by an assertion, which is why there is now
  // an assertion.
  //
  // **STDOUT AND STDERR ARE CAPTURED SEPARATELY**, because they answer different
  // questions: Commander writes generated help to stdout and refusals to stderr,
  // and merging them made "was this help or an error?" unanswerable. That is why
  // the fallback below is no longer "any captured output beats the exception" —
  // that rule would hand a later thrown message back as help.
  let out = "";
  let err = "";
  const capture = {
    writeOut: (s: string) => {
      out += s;
    },
    writeErr: (s: string) => {
      err += s;
    },
  };
  // RECURSIVE, because `mine add` is two levels down and inherits from `mine`,
  // not from the root.
  const applyCapture = (command: Command): void => {
    command.configureOutput(capture);
    for (const child of command.commands) applyCapture(child);
  };
  applyCapture(program);
  try {
    program.parse(words, { from: "user" });
  } catch (cause) {
    // A `CommanderError` carries its own verdict: `exitCode === 0` with
    // `commander.helpDisplayed` (or `.version`) is a REQUEST that was satisfied,
    // and the help it wrote is on stdout. Anything else is a refusal. Classifying
    // on the exception rather than on which stream had bytes is what stops
    // `usage --help` being reported as a failure.
    const e = cause as { exitCode?: number; code?: string; message?: string };
    if (typeof e.exitCode === "number" && e.exitCode === 0) {
      return { kind: "help", text: out.trimEnd() === "" ? null : out.trimEnd() };
    }
    const thrown = cause instanceof Error ? cause.message : String(cause);
    return { kind: "error", why: err.trim() === "" ? thrown : err.trim() };
  }
  if (parsed === undefined) {
    // Commander parsed something and no action fired — an empty subcommand
    // line. Said as a refusal rather than a silent exit 0.
    return { kind: "error", why: `no command in ${JSON.stringify(words.join(" "))}` };
  }
  return { kind: "run", parsed };
}

async function main(argv: readonly string[]): Promise<number> {
  const outcome = parseArgv(argv);
  if (outcome.kind === "help") {
    console.log(outcome.text ?? help());
    return 0;
  }
  if (outcome.kind === "error") {
    // AN ABSENT `--why` GETS THE SAME FOUR LINES AS A BLANK ONE. Commander's
    // generic "required option '--why' not specified" is true and useless here:
    // the operator's next move — read the log and `gjd-remote ls` before
    // clearing a hold that exists because nobody can tell whether a job already
    // ran — is the same in both cases, and it is the reason the flag exists.
    if (outcome.why.includes("--why")) {
      console.error(WHY_IS_NOT_OPTIONAL);
      return 1;
    }
    console.error(`✗ ${outcome.why}\n\n${help()}`);
    return 1;
  }
  return await runParsed(outcome.parsed);
}

/**
 * The `mine` list: print it, or change it by one name.
 *
 * **Every arm says what it did or what it refused**, including "it was already
 * there". A no-op that prints nothing is indistinguishable from a write that
 * failed, and this list is the input to `closeout` — a name silently missing
 * from it is a worktree nobody removes.
 */
export function runMine(root: string, parsed: Extract<Parsed, { command: "mine" }>): number {
  if (parsed.action === "list") {
    const read = readCliState(root);
    if (read.kind === "unusable") {
      console.error(`✗ ${read.why} — ${cliStatePath(root)}`);
      return 1;
    }
    const mine = read.kind === "absent" ? [] : read.state.mine;
    // NOT an empty print. "Nothing is mine" and "the file is not there yet" are
    // both legitimate and neither is a blank screen.
    if (mine.length === 0) console.log(`no sessions in ${cliStatePath(root)} — nothing is being looked after`);
    for (const name of mine) console.log(name);
    return 0;
  }

  const why = whyNotASessionName(parsed.name);
  if (why !== null) {
    console.error(`✗ ${why}`);
    return 1;
  }
  // THE WHOLE READ-MODIFY-WRITE IS INSIDE THE LOCK. `changed` is decided in
  // there too, so "it was already on the list" is a fact about the state we then
  // wrote — decided outside, it would be a fact about a state somebody else had
  // already replaced.
  let already = false;
  const out = updateCliState(root, (state) => {
    const edit = parsed.action === "add" ? addMine(state, parsed.name) : removeMine(state, parsed.name);
    already = !edit.changed;
    return edit.state;
  });
  if (!out.ok) {
    console.error(`✗ ${out.why}`);
    return 1;
  }
  if (already) {
    console.log(parsed.action === "add" ? `${parsed.name} was already on the list` : `${parsed.name} was not on the list`);
    return 0;
  }
  console.log(`${parsed.action === "add" ? "added" : "removed"} ${parsed.name} — ${out.state.mine.length} session(s) now`);
  return 0;
}

/**
 * The four lines somebody needs before they clear a hold, and the guard.
 *
 * **THE ONE WAY OUT OF A HELD SCHEDULER**, and deliberately a person's act
 * rather than a setting. A start that could not reconstruct the occurrence
 * ledger holds every scheduled job — a cold start is not permission — and
 * carries that forward across restarts, so without this there is no way back
 * except deleting the store. It writes a file the NEXT start consumes and
 * deletes; not an env var, because one left set turns "somebody decided this
 * once" into "the protection is off for ever".
 *
 * **Extracted from `runParsed` so it can be tested.** GPT Sol's P1 on Stage 1
 * was two findings in one place. The first: Commander's `requiredOption` gives
 * a generic *required option not specified*, and the four lines telling the
 * operator to read the log and `gjd-remote ls` first — on the most consequential
 * write this CLI has — had quietly gone. The second, and worse: deleting the
 * blank-reason check left the whole suite green, because the only test near it
 * asserted that a blank reason *parses*. A function with its own tests is what
 * closes that; the wording lives here so both paths print it.
 */
export function runReconcileJobs(root: string, why: string): number {
  if (why.trim() === "") {
    console.error(WHY_IS_NOT_OPTIONAL);
    return 1;
  }
  const path = join(root, RECONCILE_FILE);
  writeFileSync(path, `${JSON.stringify({ at: new Date().toISOString(), why }, null, 2)}\n`, { mode: 0o600 });
  console.log(
    `wrote ${path}\n` +
      "The NEXT Overseer start consumes it and clears the hold — a daemon already running keeps\n" +
      "holding its jobs until it is restarted (`systemctl restart overseer`).",
  );
  return 0;
}

/** Said the same way whether the flag was absent or blank, because the operator's next move is the same. */
export const WHY_IS_NOT_OPTIONAL =
  '✗ reconcile-jobs needs --why "<what you checked>", and a blank reason is not one.\n' +
  "  This clears a hold that exists because nobody can tell whether some job already ran.\n" +
  "  Look at the log and at `gjd-remote ls` first, and put what you found in the reason —\n" +
  "  it is written into the store and read by whoever asks why a job ran twice.";

async function runParsed(parsed: Parsed): Promise<number> {
  const root = requireAbsoluteRoot(storeRoot());

  switch (parsed.command) {
    case "status":
      console.log(statusLines(root, Date.now(), await readOverseerClaim(fleetUrl(process.env))).join("\n"));
      return 0;
    case "tick":
      console.log((await tickLines({ root, baseUrl: fleetUrl(process.env) })).join("\n"));
      // A degraded screen is still the tick doing its job: it tells the caller
      // what could not be read and leaves the independent sections visible.
      return 0;
    case "last":
      console.log((await fetchLastLines(fleetUrl(process.env), parsed.session, parsed.turns)).join("\n"));
      return 0;
    case "events": {
      const tail = readEventTail(root, parsed.limit);
      // "0 events" and "no store" are not the same sentence, and printing
      // nothing at all would be a third thing that looks like both.
      if (tail.total === 0) console.log(`no events in ${join(root, EVENTS_FILE)}`);
      for (const event of tail.events) console.log(describeEvent(event));
      if (tail.unreadable > 0) console.log(`(${tail.unreadable} unreadable lines)`);
      return 0;
    }
    case "notes": {
      const read = readNotes(root, parsed.limit);
      if (read.notes.length === 0) console.log("the Overseer has written nothing about itself yet");
      for (const note of read.notes) console.log(`${note.at}  ${describeNote(note)}`);
      return 0;
    }
    case "attention":
      return await runAttentionCommand({
        root,
        maxCalls: parsed.maxCalls,
        dry: parsed.dry,
        json: parsed.json,
        // READ-ONLY BY DEFAULT, and `--write` is the opt-in — GPT Sol's second
        // round. The daemon holds the store's lock and this command does not
        // honour it, so a hand run against a live daemon's root was a second
        // writer on `attention.json`: an atomic rename stops a torn file and does
        // nothing about a lost update or a duplicated call. Refusing by default
        // costs a person nothing (the daemon is the producer) and cannot be wrong.
        write: parsed.write,
        out: parsed.out,
        panes: parsed.panes,
        captureTo: parsed.captureTo,
      });
    case "usage": {
      // A command rather than a daemon block for the same reason the header
      // gives for the rest of this file: there is no scheduler here yet, and the
      // honest simplest version of "how close are we to a limit" is something a
      // person or another agent can run and read. It does not touch the store.
      //
      // The nonsense-number arms that used to live here are now `positiveNumber`
      // above, which refuses at parse time — so a bad `--max-transcripts` never
      // reaches this body at all, rather than reaching it as `NaN`.
      const report = await collectUsage({
        ...(parsed.sinceHours === undefined ? {} : { sinceMs: parsed.sinceHours * 3600_000 }),
        ...(parsed.maxTranscripts === undefined ? {} : { maxTranscripts: parsed.maxTranscripts }),
      });
      if (parsed.json) console.log(JSON.stringify(report, null, 2));
      else console.log(usageLines(report).join("\n"));
      return 0;
    }
    case "mine":
      return runMine(root, parsed);
    case "reconcile-jobs":
      return runReconcileJobs(root, parsed.why);
    case "run": {
      const controller = new AbortController();
      // SIGTERM is what systemd sends and SIGINT is what a person sends; both
      // must stop it the same way, so the stopping note is written and the lock
      // is released rather than left for the next start to puzzle over.
      for (const signal of ["SIGINT", "SIGTERM"] as const) {
        process.on(signal, () => {
          console.log(`${signal} — stopping`);
          controller.abort();
        });
      }
      // The attention pass is wired in HERE rather than inside the daemon,
      // because it reads tmux and calls a paid model and daemon.ts does neither.
      // With no key it is absent, and the store then publishes a list that says
      // nothing has looked — which is not the same as an empty one.
      // The epoch is one continuous run of observation, and a restart mints a new
      // one — which is exactly when the persisted WAITS must be dropped, because a
      // first-seen instant cannot span a gap nobody watched. The verdicts survive
      // it; see `memoryForEpoch`.
      const attentionRun = parsed.attention ? attentionRunner(root, `daemon-${randomUUID()}`) : null;
      if (attentionRun === null) {
        console.log(
          parsed.attention
            ? "attention: off — OPENROUTER_API_KEY is not set, so nothing will look at what needs you"
            : "attention: off (--no-attention)",
        );
      }
      // The usage scan is wired in here for the same reason, and it needs NO
      // key: its evidence is `~/.claude.json` and the transcripts on disk, so
      // unlike attention it is available on a box with no OpenRouter credentials
      // at all. `--no-usage` turns it off, and the reason to want that is cost of
      // a different kind: a scan reads ~2.9 GB, so a box already thrashing is one
      // where a person may reasonably want it quiet.
      //
      // `collectUsage` takes the module's own defaults deliberately. The CLI's
      // `--since-hours` and `--max-transcripts` narrow a scan for a person in a
      // hurry, and a narrowed scan is exactly what `absenceGap` refuses to call
      // conclusive — so a daemon that quietly took them would publish `unknown`
      // for ever and look broken.
      const usageOff = !parsed.usage;
      if (usageOff) console.log("usage: off (--no-usage)");

      /*
       * THE USAGE HISTORY, composed HERE because this file is the only one
       * allowed to join the two halves: the store and the mapping are
       * `tools/fleet/`'s, the pass that feeds them is `tools/overseer/`'s, and
       * an import either way would breach the seam that
       * `tests/fleet-attention.test.ts` enforces.
       *
       * Why it opens lazily, and why that is the lock argument rather than a
       * convenience, is in `tools/fleet/usage-history-wiring.ts`'s header.
       */
      const usageRetention = makeUsageRetention(root, {
        nextDueMs: USAGE_INTERVAL_MS,
        log: (line) => console.log(line),
      });

      // THE ARMING INSTANT, RECONCILED BEFORE THE DAEMON STARTS.
      //
      // Here rather than inside `daemon.ts` because it is a decision about this
      // process's environment, which is the CLI's knowledge and not the folder's
      // — and because the daemon takes it as a required option, so there is no
      // path on which it is silently defaulted. `reconcileArming` writes the
      // record on the first armed start and leaves it alone on every one after,
      // which is what stops a restarting service postponing its first run for
      // ever (GPT Sol's S8-6).
      const armedAt = reconcileArming({ storeDir: root, armed: jobsEnabled(process.env) || rulesEnabled(process.env), now: () => new Date() });
      const wiring = schedulerWiring(process.env, armedAt);
      // THE ARMING, not a yes/no. "off", "deterministic rules only" and "armed"
      // are three states and the middle one is the whole of SP-4; printing two
      // of them would put a reader back where they started.
      console.log(`scheduler: ${wiring.arming === "all" ? "ARMED" : wiring.arming === "rules-only" ? "RULES ONLY" : "OFF"} — ${wiring.detail}`);
      if (armedAt.kind === "armed") console.log(`scheduler: armed at ${armedAt.at}; a job that has never run is first eligible its own delay after that`);
      else if (wiring.armed) console.error(`✗ scheduler: ${armedAt.why} — every job that has never run is HELD until this is fixed`);
      for (const problem of wiring.problems) console.error(`✗ ${problem}`);
      for (const one of wiring.eligibility) {
        if (one.kind === "ineligible") console.error(`✗ scheduler: ${one.jobId} cannot run — ${one.why}`);
      }
      const outcome = await runOverseer({
        root,
        baseUrl: parsed.url ?? process.env["OVERSEER_FLEET_URL"] ?? DEFAULT_FLEET_URL,
        signal: controller.signal,
        // Absent rather than undefined: `exactOptionalPropertyTypes` tells those
        // apart, and absent is what "take the default" means.
        ...(parsed.tickMs === undefined ? {} : { tickMs: parsed.tickMs }),
        ...(attentionRun === null ? {} : { attention: { run: attentionRun } }),
        ...(usageOff ? {} : { usage: { run: () => collectUsage(), onPass: usageRetention.onPass } }),
        // ABSENT rather than present-and-empty when disarmed: an absent `jobs`
        // is what makes `daemon.ts` build no scheduler timer at all, and it is
        // also what it reads to decide the checkpoint says OFF.
        // Absent rather than present-and-undefined, which
        // `exactOptionalPropertyTypes` makes different things — and here they
        // genuinely are: absent is what stops `daemon.ts` building a timer.
        ...(wiring.jobs === undefined ? {} : { jobs: wiring.jobs }),
        schedulerDetail: wiring.detail,
      });
      /* The history fd, released when the daemon stops. `runOverseer` has
         already awaited any pass in flight by this point — it does that so a
         shutdown cannot leave two writers on the store — so there is no append
         racing this close. */
      usageRetention.close();
      switch (outcome.kind) {
        case "refused":
          console.error(`✗ ${describeRefusal(outcome.refusal)}`);
          return 1;
        case "lock-lost":
          console.error(`✗ another Overseer took the lock${outcome.holder === null ? "" : ` (pid ${outcome.holder.pid})`} — stopping rather than writing beside it`);
          return 1;
        case "stopped":
          console.log(`stopped: ${outcome.why}`);
          return 0;
        default: {
          const never: never = outcome;
          throw new Error(String(never));
        }
      }
    }
    default: {
      // EXHAUSTIVE, and the compiler says so. The old `default` arm printed
      // "unknown command", which is now Commander's job at parse time — by the
      // time we are here the command is one of the union's members, and a new
      // member that nobody wired up must not compile.
      const never: never = parsed;
      throw new Error(`unhandled command ${JSON.stringify(never)}`);
    }
  }
}

/** Imported by a test, or run. `gjd-remote.ts` calls main at import time and is untestable for it. */
function isMain(): boolean {
  const invoked = process.argv[1];
  return invoked !== undefined && invoked === fileURLToPath(import.meta.url);
}

if (isMain()) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((cause: unknown) => {
      console.error(`✗ ${cause instanceof Error ? cause.message : String(cause)}`);
      process.exitCode = 1;
    });
}
