/**
 * `overseer attention` — read every live pane and say what needs Greg.
 *
 * The command half of Stage A. It is here rather than in scripts/overseer.ts so
 * that file gains one case and one call: it is the Overseer's CLI, owned by
 * another session's stage, and a hundred lines of mine in the middle of it is a
 * merge conflict waiting for both of us.
 *
 * ## What it prints, and why the counts are not decoration
 *
 * The list first, then the breakdown. **The breakdown is the positive control.**
 * `sessionsScanned` alone cannot tell twenty quiet sessions from twenty
 * unreadable ones — zero items out of zero scanned is a broken probe, and so, in
 * a way the count cannot show, is zero items out of twenty scanned and twenty
 * unparsed. So every session lands in exactly one bucket, the buckets are
 * printed, and `breakdownBalances` is asserted in the same run that produced the
 * list (docs/reusable/silent-success.md).
 *
 * `--dry` makes no model calls at all: it reads the panes, prints the breakdown,
 * and shows how many DISTINCT tails a real pass would have paid for. It is the
 * cheap way to see whether the pane reading works, and the honest way to say
 * what a pass costs before spending it.
 *
 * `console.log` rather than src/log.ts: this is a CLI, and that is the rule —
 * docs/project/logging.md.
 */
import { writeFileSync } from "node:fs";

import type { AttentionList, AttentionProposal, UsageVerdict } from "../fleet/wire.js";
import {
  ATTENTION_CLASSIFIER_MODEL,
  CLASSIFIER_PROMPT_VERSION,
  NO_SPEND,
  PROPOSAL_PROMPT_VERSION,
  planClassifications,
  describeCost,
  type ClassifierOptions,
  type ClassifierSpend,
  type PromptVersion,
} from "./attention-classify.js";
import { readCheckpoint } from "./store.js";
import {
  EMPTY_ATTENTION_MEMORY,
  memoryForEpoch,
  readAttentionMemory,
  writeAttentionMemory,
} from "./attention-memory.js";
import {
  breakdownBalances,
  runAttentionPass,
  sessionsRead,
  type PassBreakdown,
} from "./attention-pass.js";
import {
  captureFleet,
  capturePane,
  listSessions,
  readCapturedFleet,
  tmuxServerGeneration,
} from "./attention-probe.js";
import { policyGaps } from "./attention.js";
import { describeBudget, modelBudget, paidClassifier } from "./model-budget.js";

/**
 * How many model calls one pass may make.
 *
 * Astra's A30 is *thirty-six sessions must not trigger thirty-six model reviews
 * a minute*, and the cache is what actually holds that: at steady state almost
 * every session's tail is unchanged and costs nothing. This ceiling is the
 * second line of defence, for the pass after a fleet-wide restart when every
 * tail is new at once. Twelve is a little under half a full fleet, which means
 * such a pass catches up over two or three ticks rather than in one expensive
 * one — and the ones it did not reach come back as `overBudget` rather than as
 * silence.
 */
export const DEFAULT_MAX_CALLS = 12;

export type AttentionCommandOptions = {
  root: string;
  maxCalls: number;
  dry: boolean;
  json: boolean;
  write: boolean;
  /** Where to put the machine-readable result, for an evaluation to compare against. */
  out: string | null;
  /**
   * Read the panes from here instead of from tmux, and if `captureTo` is set,
   * write them there first.
   *
   * A fleet of thirty agents changes underneath you, so an evaluation that
   * captured twice would be comparing two different fleets and every
   * disagreement would be ambiguous. One capture, two readers.
   */
  panes: string | null;
  captureTo: string | null;
};

/**
 * The gateway key, or `null` when none is set. **The one reader of it under
 * tools/overseer/** — the hand run, the daemon's runner and the evaluation
 * (scripts/attention-eval.ts) all come through here, so the spend scan in
 * tests/no-undeclared-spend.test.ts still sees exactly one file naming the
 * credential rather than one per caller.
 *
 * FROM THE ENVIRONMENT, AND DELIBERATELY NOT FROM `.env.local`. `loadEnvLocal`
 * lives in src/env.ts and the Overseer must not depend on anything under src/
 * (docs/project/overseer-direction.md § Principles) — and a second reader
 * of the same file would be worse than none, because src/env.ts lets the FILE
 * beat the shell, while a daemon's key comes from its unit file and the shell
 * must win. Two precedence rules over one filename is how you get a process
 * talking to the wrong account and reporting success.
 */
export function readGatewayKey(): string | null {
  const key = process.env["OPENROUTER_API_KEY"];
  return key === undefined || key === "" ? null : key;
}

/**
 * Whether the proposal-aware prompt is on — `OVERSEER_PROPOSALS=1` in this
 * process's environment, the daemon's unit file or a hand run's shell (plan
 * 260910f D7). **The one reader of it**, for the reason `readGatewayKey` is the
 * one reader of the key: a second place deciding it could decide differently,
 * and then a version-2 answer would be filed under version 1.
 *
 * Exactly `"1"`, never merely set: `OVERSEER_PROPOSALS=0` must not turn on the
 * one change here that costs a cold re-read of the fleet.
 */
export function proposalsEnabled(): boolean {
  return process.env["OVERSEER_PROPOSALS"] === "1";
}

/** The prompt version a composition runs under. One function, so the classifier and the pass cannot be told two different things. */
export function promptVersionFor(proposals: boolean): PromptVersion {
  return proposals ? PROPOSAL_PROMPT_VERSION : CLASSIFIER_PROMPT_VERSION;
}

/**
 * The usage verdict the Overseer's checkpoint holds, or `null` when it holds
 * none — the only thing `reach` knows about whether Fable could take a question
 * (D14). Read from the file like any other reader of the checkpoint; the pass
 * takes it as a plain input and stays free of the store.
 */
export function storedUsageVerdict(root: string): UsageVerdict | null {
  const read = readCheckpoint(root);
  if (read.kind !== "checkpoint") return null;
  const usage = read.checkpoint.usage;
  return usage.kind === "report" ? usage.report.verdict : null;
}

/**
 * The edges of both compositions — the fleet, the gateway, the key and the
 * switch — so that tests/overseer-attention-cli.test.ts can drive the daemon's
 * runner and the hand run AS COMPOSED, with no tmux and no network. What that
 * test pins is that each passes its prompt version to both the classifier and
 * the pass; the unit tests of the pass cannot see a caller forget to.
 */
export type AttentionSeams = {
  apiKey: () => string | null;
  proposals: () => boolean;
  listSessions: typeof listSessions;
  capture: typeof capturePane;
  tmuxGeneration: typeof tmuxServerGeneration;
  /** The gateway transport. Absent means the real `fetch`. */
  fetchImpl?: typeof fetch;
};

export const LIVE_SEAMS: AttentionSeams = {
  apiKey: readGatewayKey,
  proposals: proposalsEnabled,
  listSessions,
  capture: capturePane,
  tmuxGeneration: tmuxServerGeneration,
};

export async function runAttentionCommand(
  options: AttentionCommandOptions,
  seams: AttentionSeams = LIVE_SEAMS,
): Promise<number> {
  const fleet =
    options.panes !== null
      ? readCapturedFleet(options.panes)
      : options.captureTo !== null
        ? captureFleet(seams.listSessions(), options.captureTo)
        : null;
  const sessions = fleet?.sessions ?? seams.listSessions();
  const capture =
    fleet === null
      ? seams.capture
      : (paneId: string) => {
          const session = fleet.sessions.find((s) => s.paneId === paneId);
          const text = session === undefined ? undefined : fleet.captures.get(session.sessionId);
          // Throwing is what a live capture does when the pane has gone, and the
          // pass counts it the same way. A replay that quietly substituted "" for
          // a capture that failed would report a blank pane, which is a different
          // fact and a more reassuring one.
          if (text === undefined) throw new Error(`no capture for pane ${paneId}`);
          return text;
        };
  const read = options.dry ? { kind: "absent" as const } : readAttentionMemory(options.root);
  if (read.kind === "unusable") {
    // Replaced, not repaired. Everything in it is recoverable by looking again,
    // and the only cost is a few model calls and some waits restarting from now
    // — which under-states a wait rather than inventing one.
    console.log(`the attention memory was unusable and has been replaced: ${read.why}`);
  }
  // The CLI is its own epoch, and it carries the tmux generation for the same
  // reason the daemon's does: a hand run has not been watching continuously, so
  // it must not inherit waits a daemon was timing, and `$1` after a tmux restart
  // is a different session wearing the same handle.
  const memory = memoryForEpoch(
    read.kind === "memory" ? read.memory : EMPTY_ATTENTION_MEMORY,
    `cli-${process.pid}:tmux-${seams.tmuxGeneration() ?? "unknown"}`,
  );

  // From the environment, never `.env.local` — `readGatewayKey` says why.
  const apiKey = seams.apiKey();
  if (!options.dry && apiKey === null) {
    console.error(
      "OPENROUTER_API_KEY is not set, and this reads the environment rather than .env.local — see the\n" +
        "comment at this check for why. Export it first:\n" +
        "  export OPENROUTER_API_KEY=$(grep '^OPENROUTER_API_KEY=' .env.local | cut -d= -f2-)\n" +
        "Or use --dry to read the panes and cost the pass without making a call.",
    );
    return 1;
  }

  // THE SAME DAY BUDGET AS THE DAEMON'S, in the same store root — plan 260910f
  // D4, and the bypass GPT Sol's F1 found. A hand run is not a free run: it
  // reserves and settles against the one ledger, whatever `--write` says,
  // because `--write`/`--no-write` governs the attention MEMORY and nothing
  // else. `--dry` makes no calls, so it only reads the ledger.
  const budget = modelBudget({ root: options.root });
  // ONE VERSION, HANDED TO BOTH HALVES — the classifier asks under it and the
  // pass files the answer under it. tests/overseer-attention-cli.test.ts fails
  // if either is dropped.
  const promptVersion = promptVersionFor(seams.proposals());
  const result = await runAttentionPass({
    sessions,
    capture,
    classify: options.dry
      ? // No model answered, and the verdict is never cached, so `model` is never recorded.
        async () => ({ verdict: { kind: "unreadable", why: "--dry: no model was asked" }, spend: NO_SPEND, model: "none (--dry)" })
      : paidClassifier(budget, classifierOptions(apiKey ?? "", promptVersion, seams)),
    memory,
    maxCalls: options.dry ? 0 : options.maxCalls,
    promptVersion,
    usage: storedUsageVerdict(options.root),
    now: () => new Date(),
  });

  // THE ASSERTION, IN THE SAME RUN THAT PRODUCED THE LIST. A breakdown that does
  // not add up means a session fell through a switch and was silently not looked
  // at, which is precisely the failure an empty inbox cannot show.
  if (!breakdownBalances(result.breakdown)) {
    console.error(`the breakdown does not add up to ${result.breakdown.scanned} scanned:`);
    console.error(JSON.stringify(result.breakdown, null, 2));
    return 1;
  }

  if (options.write && !options.dry) writeAttentionMemory(options.root, result.memory);

  const payload = {
    list: result.list,
    breakdown: result.breakdown,
    spend: result.spend,
    budget: budget.read(),
    model: options.dry ? null : ATTENTION_CLASSIFIER_MODEL,
  };
  if (options.out !== null) writeFileSync(options.out, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  if (options.json) {
    console.log(JSON.stringify(payload, null, 2));
    return 0;
  }

  for (const line of describeList(result.list)) console.log(line);
  console.log("");
  for (const line of describeBreakdown(result.breakdown, options.dry)) console.log(line);
  console.log("");
  console.log(describeSpend(result.spend, options.dry, dryCallsThatWouldBePaidFor(result.breakdown)));
  // The ledger line, right under what this run spent: the day's total against
  // its ceiling, and whether the next call would be refused.
  console.log(describeBudget(budget.read()));
  for (const gap of policyGaps(result.list)) console.log(`\n  policy gap: ${gap}`);
  return 0;
}

/**
 * In `--dry` every distinct fresh tail is unpaid-for, and every stale verdict
 * would be re-read — together, what a real pass would ask for, before `maxCalls`.
 */
function dryCallsThatWouldBePaidFor(b: PassBreakdown): number {
  return b.overBudget + b.stale;
}

export function describeList(list: AttentionList): readonly string[] {
  if (list.kind === "unknown") return [`could not tell what needs you: ${list.why}`];
  // `limited` — the day budget or a quota cooldown refused the model (plan
  // 260910f D6). The items print as a list's do, under this line; an empty one
  // never says "nothing needs you".
  const stopped =
    list.kind === "limited"
      ? [`NOT EVERY SESSION IS BEING JUDGED (${list.stopped.kind}) — ${list.stopped.why}, until ${list.stopped.until}`]
      : [];
  if (list.items.length === 0) {
    if (list.kind === "limited") {
      return [
        `nothing found among the sessions judged, out of ${list.sessionsScanned} scanned at ${list.scannedAt} ` +
          `(${list.sessionsUnreadable} could not be judged)`,
        ...stopped,
      ];
    }
    // Never a blank line. An empty inbox with a count beside it is a calm fleet;
    // an empty inbox alone reads as one whether or not anything looked.
    return [`nothing needs you, out of ${list.sessionsScanned} sessions scanned at ${list.scannedAt}`];
  }
  // AT LEAST N, the same as `overseer status` says. An empty list cannot reach
  // here with anything unjudged — `buildAttentionList` returns `unknown` for that
  // — so the only incomplete case left is a list that found something, and the
  // honest form of it is a floor rather than a figure. Two surfaces reading one
  // field must not phrase it two ways: the one that sounds more certain is the
  // one a person will quote.
  const lines =
    list.sessionsUnreadable === 0 && list.kind === "list"
      ? [`${list.items.length} thing(s) need you, out of ${list.sessionsScanned} sessions scanned:`]
      : [
          ...stopped,
          `AT LEAST ${list.items.length} thing(s) need you, out of ${list.sessionsScanned} sessions scanned ` +
            `(${list.sessionsUnreadable} could not be judged at all, so there may be more):`,
        ];
  for (const item of list.items) {
    const age = describeWait(item.waitingSince, list.scannedAt);
    const phone =
      item.answerability.kind === "phone"
        ? "answerable from a phone"
        : item.answerability.kind === "needs-a-screen"
          ? `needs a screen: ${item.answerability.why}`
          : `not sure a phone will do: ${item.answerability.why}`;
    lines.push("");
    lines.push(`  [${item.kind}] ${item.sessionName}  waiting ${age}  (${item.evidence.kind})`);
    if (item.evidence.kind === "dialog") {
      lines.push(`    ${item.evidence.question}`);
      for (const option of item.evidence.options) lines.push(`      · ${option}`);
    } else {
      lines.push(`    why: ${item.evidence.why}`);
      // The proposal, when there is one — a reading for the hand run and the
      // Stage 3 census, attributed like the card's. `off`, `not-reached` and
      // the rest print nothing, as they draw nothing.
      const proposal: AttentionProposal = item.proposal;
      if (proposal.kind === "proposed") {
        lines.push(
          // "model:" before the identifier, never "by" — GPT Sol's F16, as on the card.
          `    proposed: ${proposal.recipient} (${proposal.reach.kind}) — ${proposal.reason} · model proposal, model: ${proposal.by.model}, nothing sent`,
        );
        lines.push(`    asks: "${proposal.asks}"`);
      } else if (proposal.kind === "unplaced") {
        lines.push(`    no proposal — the model could not tell who holds the answer: ${proposal.why}`);
      }
      for (const line of lastLines(item.evidence.excerpt, 4)) lines.push(`    | ${line}`);
    }
    lines.push(`    ${phone}`);
    if (item.duplicates.length > 0) {
      lines.push(`    also asked by: ${item.duplicates.map((d) => d.sessionName).join(", ")}`);
    }
  }
  return lines;
}

export function describeBreakdown(b: PassBreakdown, dry: boolean): readonly string[] {
  return [
    `scanned ${b.scanned}, read ${sessionsRead(b)}:`,
    `  ${b.endedTurns} ended turns, ${b.midTurn} mid-turn, ${b.conversationDialogs} conversation dialogs`,
    `  ${b.permissionDialogs} permission dialogs (counted, deliberately not queued for Greg — they are launch defects)`,
    `  ${b.noInputBox} not a Claude Code pane, ${b.noPane} with no pane, ${b.captureFailed} capture failed`,
    `  ${b.unreadable} Claude Code panes we could not make sense of${b.unreadable > 0 ? "  ← look at these" : ""}`,
    dry
      ? `  ${b.overBudget} distinct tails a real pass would have paid to classify`
      : `  ${b.questionsFound} questions found, ${b.fromCache} answered from memory, ` +
        `${b.stale} from an older prompt (re-read first), ${b.verdictsUnreadable} verdicts unreadable, ` +
        `${b.budgetRefused} refused by the day budget, ${b.overBudget} left for the next pass`,
  ];
}

export function describeSpend(spend: ClassifierSpend, dry: boolean, wouldHaveCalled: number): string {
  if (dry) return `--dry: no model was asked. A cold pass would have made ${wouldHaveCalled} call(s).`;
  // A pass that made no calls is the STEADY STATE, not a failure, and saying
  // "cost not reported by the gateway" about it would read as a broken probe.
  if (spend.calls === 0) return "0 call(s): every tail was already in memory, so this pass cost nothing.";
  // `describeCost` owns the three cases — see `callCost`, which is where the
  // BYOK trap and its mirror image are argued out.
  return `${spend.calls} call(s), ${spend.promptTokens} prompt + ${spend.completionTokens} completion tokens, ${describeCost(spend)}`;
}

function describeWait(since: string, until: string): string {
  const ms = Date.parse(until) - Date.parse(since);
  if (Number.isNaN(ms)) return "an unknown time";
  const minutes = Math.round(ms / 60_000);
  if (minutes < 90) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h`;
}

function lastLines(text: string, n: number): readonly string[] {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  return lines.slice(-n).map((l) => l.trim().slice(0, 140));
}

/** Exported so an evaluation can plan a pass without running one. */
export { planClassifications };

/**
 * The attention pass as the daemon runs it, or a reason it cannot.
 *
 * Returns `null` when the daemon should not run one at all — no API key — so a
 * daemon with no gateway publishes `attentionNotYetRun` and says nothing has
 * looked, rather than an empty list, which would claim nothing needs Greg.
 *
 * **It reads and writes the store's own memory file**, which is right: the
 * daemon holds the lock on that root and is the only thing that should be
 * writing there. `overseer attention --no-write` exists for the other case — a
 * person poking at a root a daemon owns.
 */
/** The classifier's options for one composition: the key, the version, and the transport if a test replaced it. */
function classifierOptions(apiKey: string, promptVersion: PromptVersion, seams: AttentionSeams): ClassifierOptions {
  return { apiKey, promptVersion, ...(seams.fetchImpl === undefined ? {} : { fetchImpl: seams.fetchImpl }) };
}

export function attentionRunner(
  root: string,
  instance: string,
  seams: AttentionSeams = LIVE_SEAMS,
): (() => Promise<AttentionList>) | null {
  const apiKey = seams.apiKey();
  if (apiKey === null) return null;
  // The day budget, in the root this daemon holds — the same ledger a hand run
  // of `overseer attention` reserves against (plan 260910f D4). Stateless apart
  // from the directory, so one per runner is enough.
  const budget = modelBudget({ root });
  return async () => {
    // THE EPOCH IS THIS RUN **AND** THE TMUX GENERATION — GPT Sol's second round.
    // A per-process epoch is not enough: a daemon can outlive a tmux restart
    // (`Restart=always` is on the daemon, not on tmux), and after one `$1` names
    // a different session. This repo already treats `tmuxServerPid` as the
    // generation, and diff.ts refuses to diff two snapshots that disagree on it
    // because they describe different worlds. A wait carried across that would be
    // a duration measured on somebody else's question.
    const epoch = `${instance}:tmux-${seams.tmuxGeneration() ?? "unknown"}`;
    const read = readAttentionMemory(root);
    // THE EPOCH DROPS THE WAITS AND KEEPS THE VERDICTS — GPT Sol's finding 2.
    // `store.ts` refuses to republish the previous attention list after a
    // restart, and this file used to undo that by persisting the waits, so a
    // question answered during three hours of downtime and asked again came back
    // as "waiting since" a moment nobody observed. A verdict is about a piece of
    // text and survives any gap; a wait is about continuous observation and
    // cannot.
    const memory = memoryForEpoch(read.kind === "memory" ? read.memory : EMPTY_ATTENTION_MEMORY, epoch);
    // ONE VERSION, HANDED TO BOTH HALVES, exactly as the hand run does. Read
    // per pass rather than per runner so both compositions follow one rule;
    // a daemon's environment is fixed at start, so in practice it never moves.
    const promptVersion = promptVersionFor(seams.proposals());
    const result = await runAttentionPass({
      sessions: seams.listSessions(),
      capture: seams.capture,
      classify: paidClassifier(budget, classifierOptions(apiKey, promptVersion, seams)),
      memory,
      maxCalls: DEFAULT_MAX_CALLS,
      promptVersion,
      usage: storedUsageVerdict(root),
      now: () => new Date(),
    });
    // The same assertion the CLI makes, in the same run that produced the list.
    // A breakdown that does not add up means a session fell through a switch and
    // was silently not looked at — the one failure an empty inbox cannot show.
    if (!breakdownBalances(result.breakdown)) {
      return {
        kind: "unknown",
        why: `the pass's own accounting did not add up to ${result.breakdown.scanned} scanned, so it is not to be trusted`,
        scannedAt: new Date().toISOString(),
      };
    }
    writeAttentionMemory(root, result.memory);
    return result.list;
  };
}
