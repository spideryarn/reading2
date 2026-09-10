/**
 * ONE PASS OVER THE FLEET: read every pane, decide what needs Greg, rank it.
 *
 * This is the impure one. `turn-tail.ts` cuts the material out of a pane,
 * `attention-classify.ts` asks the model the one question, `attention.ts` groups
 * and ranks, and this walks the sessions and holds the budget. Every side effect
 * is injected — `capture`, `classify`, `now` — so the whole pass is testable
 * against captured panes with no tmux and no gateway.
 *
 * ## Two paths, because they are two different risks
 *
 *  - **A dialog is OBSERVED.** The harness drew it, `parsePane` enumerated its
 *    options, and answering means picking one of them. Nothing is inferred.
 *  - **A prose question is INFERRED.** We read the tail of an ended turn and
 *    decided it was a question, and we may be wrong. Answering means free text at
 *    a pane whose input box may already hold half a sentence somebody else wrote
 *    — measured on this box on 2026-09-08: a send CONCATENATES with the box's
 *    contents, and a real send produced one turn neither half of which anybody
 *    wrote, reported as a success.
 *
 * They stay apart all the way through, in `AttentionEvidence`, and this file is
 * where they are kept apart.
 *
 * ## The one population deliberately NOT in the list
 *
 * **A permission dialog is not a queue item for Greg**, and that is the direction
 * doc's call rather than a shortcut: on this box a permission prompt is nearly
 * always a LAUNCH DEFECT, since auto mode should have handled it, and the harness
 * says so in the prompt itself (*"Tip: auto mode handles these prompts for you"*).
 * The action is to fix how that session was started, pointed at a different
 * person entirely — so putting it in front of Greg at 11pm asks him to do
 * somebody else's job in the one place he is least able to.
 *
 * It is **counted and reported** rather than silently dropped
 * (`PassBreakdown.permissionDialogs`). A rising count is a launcher regression,
 * and the last one cost 34.9 agent-hours in three days before anybody noticed.
 *
 * `grantsPermission` decides it, so the conservative default is structural: a
 * dialog we could not positively identify as a conversation is treated exactly
 * as a permission one.
 *
 * ## What a pass costs, and why the pane read is not the expensive part
 *
 * `tmux capture-pane` is about a millisecond, so reading thirty panes is ~30ms —
 * not the ~12 seconds of grepping thirty-five transcripts that
 * docs/project/overseer-direction.md § Two tenses is emphatic about not
 * doing twice. The model calls are the cost, and they are bounded by `maxCalls`
 * and made once per DISTINCT tail rather than once per session.
 */
import type {
  AttentionAnswerability,
  AttentionJudgementStopped,
  AttentionList,
  AttentionProposal,
  ProposalAuthor,
  ProposalReach,
  ProposalRecipient,
  UsageVerdict,
} from "../fleet/wire.js";
import { grantsPermission, parsePane, type PaneQuestion } from "../fleet/pane.js";
import {
  addSpend,
  ATTENTION_CLASSIFIER_MODEL,
  canonicalVerdict,
  CLASSIFIER_PROMPT_VERSION,
  isCacheable,
  NO_SPEND,
  PROPOSAL_PROMPT_VERSION,
  planClassifications,
  type CachedVerdict,
  type ClassifierSpend,
  type ClassifierVerdict,
  type TailToClassify,
} from "./attention-classify.js";
import { EMPTY_ATTENTION_MEMORY, type AttentionMemory } from "./attention-memory.js";
import { buildAttentionList, rememberWaits, type AttentionObservation } from "./attention.js";
import type { ClassifyOutcome } from "./model-budget.js";
import { readTurnTail } from "./turn-tail.js";

/** A session to look at. `paneId` is the address; a session without one cannot be read. */
export type SessionToScan = { sessionId: string; sessionName: string; paneId: string | null };

/**
 * What the pass saw, counted.
 *
 * **This is the positive control, and it is finer-grained than `sessionsScanned`
 * on purpose.** An empty inbox is only good news if something looked, and
 * `sessionsScanned` alone cannot tell twenty quiet sessions from twenty
 * unreadable ones. Every session lands in exactly one of these buckets and they
 * sum to `scanned`, which is asserted in the same run that produces the list.
 */
export type PassBreakdown = {
  scanned: number;
  /** No `paneId`: the register knows the session and not where it is drawn. */
  noPane: number;
  /** `tmux capture-pane` failed — the pane went away between listing and reading. */
  captureFailed: number;
  /** A conversation dialog: observed evidence, and an item. */
  conversationDialogs: number;
  /** A permission-class dialog: counted, and deliberately NOT an item. See the header. */
  permissionDialogs: number;
  /** Mid-turn. Nothing has ended, so nothing can have been asked. */
  midTurn: number;
  /** Not a Claude Code pane at rest: a shell, a Codex TUI, an empty pane. */
  noInputBox: number;
  /** A Claude Code pane we could not make sense of. The arm that must stay visible. */
  unreadable: number;
  /** An ended turn whose tail we read. */
  endedTurns: number;
  /** Of those, how many the classifier called a question. */
  questionsFound: number;
  /** Of those, how many the classifier could not answer about. */
  verdictsUnreadable: number;
  /** Distinct tails the budget would not stretch to this pass. */
  overBudget: number;
  /** Distinct tails answered from the memory rather than from the gateway. */
  fromCache: number;
  /**
   * Distinct tails whose remembered verdict came from another prompt version
   * (plan 260910f D3). They place their cards all the same, and are re-read
   * ahead of fresh tails; not a failure, and not in `sessionsUnreadable` —
   * unless the pass TRIED the re-read and got no usable answer (refused or
   * failed), which makes that session unjudged this pass (GPT Sol's F12).
   */
  stale: number;
  /** Distinct tails the day budget or a cooldown did not let us ask about. Each is also unjudged. */
  budgetRefused: number;
};

export type AttentionPassOptions = {
  sessions: readonly SessionToScan[];
  /** Injected so the pass can be run against captured panes. Throwing means the pane went away. */
  capture: (paneId: string) => string;
  /**
   * One tail, one answer — or `notCalled` when the day budget refused
   * (model-budget.ts). In production this is `paidClassifier`, and nothing else
   * reaches the transport.
   */
  classify: (tail: string) => Promise<ClassifyOutcome>;
  memory?: AttentionMemory;
  /** The hard ceiling on model calls in one pass. Enforced, not promised. */
  maxCalls: number;
  /**
   * The prompt version `classify` asks under, which is half of the cache key
   * (D3). Absent means today's single prompt. Stage 2's proposal-aware prompt
   * passes its own version here, and must: a verdict filed under the wrong
   * version would be answered from memory by the wrong prompt.
   */
  promptVersion?: number;
  /**
   * The checkpoint's stored usage verdict — `null` when it holds none — which
   * is all `reach` knows about whether Fable could take a question now (plan
   * 260910f D14). A PLAIN INPUT, read by the caller, so the pass stays free of
   * the store; and projected into every card on every pass, never cached, so a
   * limit that lifts reaches the next card at no cost.
   */
  usage?: UsageVerdict | null;
  now: () => Date;
};

export type AttentionPassResult = {
  list: AttentionList;
  memory: AttentionMemory;
  breakdown: PassBreakdown;
  spend: ClassifierSpend;
};

/** What a pane turned out to be, before the model is asked anything. */
type Material =
  | { kind: "dialog"; session: SessionToScan; question: Extract<PaneQuestion, { kind: "question" }>; fingerprint: string; text: string }
  | { kind: "prose"; session: SessionToScan; fingerprint: string; tail: string };

export async function runAttentionPass(options: AttentionPassOptions): Promise<AttentionPassResult> {
  const memory = options.memory ?? EMPTY_ATTENTION_MEMORY;
  const nowIso = options.now().toISOString();
  const breakdown: PassBreakdown = {
    scanned: options.sessions.length,
    noPane: 0,
    captureFailed: 0,
    conversationDialogs: 0,
    permissionDialogs: 0,
    midTurn: 0,
    noInputBox: 0,
    unreadable: 0,
    endedTurns: 0,
    questionsFound: 0,
    verdictsUnreadable: 0,
    overBudget: 0,
    fromCache: 0,
    stale: 0,
    budgetRefused: 0,
  };
  const promptVersion = options.promptVersion ?? CLASSIFIER_PROMPT_VERSION;

  const material: Material[] = [];
  for (const session of options.sessions) {
    if (session.paneId === null) {
      breakdown.noPane += 1;
      continue;
    }
    let capture: string;
    try {
      capture = options.capture(session.paneId);
    } catch {
      breakdown.captureFailed += 1;
      continue;
    }

    const question = parsePane(capture);
    if (question.kind === "question") {
      if (grantsPermission(question.gate)) {
        breakdown.permissionDialogs += 1;
        continue;
      }
      breakdown.conversationDialogs += 1;
      const text = dialogText(question);
      material.push({ kind: "dialog", session, question, fingerprint: dialogFingerprint(question), text });
      continue;
    }

    const tail = readTurnTail(capture);
    switch (tail.kind) {
      case "mid-turn":
        breakdown.midTurn += 1;
        break;
      case "no-input-box":
        breakdown.noInputBox += 1;
        break;
      case "unreadable":
        breakdown.unreadable += 1;
        break;
      case "ended":
        breakdown.endedTurns += 1;
        material.push({ kind: "prose", session, fingerprint: tail.fingerprint, tail: tail.tail });
        break;
    }
  }

  const tails: TailToClassify[] = material.map((m) => ({
    sessionId: m.session.sessionId,
    fingerprint: m.fingerprint,
    tail: m.kind === "dialog" ? m.text : m.tail,
  }));
  const plan = planClassifications({ tails, cache: memory.verdicts, maxCalls: options.maxCalls, promptVersion });
  breakdown.fromCache = plan.cached.length;
  breakdown.stale = plan.stale.length;
  breakdown.overBudget = plan.overBudget.length;

  const verdicts = new Map<string, CachedVerdict>();
  for (const hit of plan.cached) verdicts.set(hit.fingerprint, hit.verdict);
  // STALE IS NOT ABSENT — plan 260910f D3. A verdict from another prompt version
  // is still true about its text, so it places its card exactly as it did before
  // versions existed. If its re-read below succeeds it is replaced; if the
  // re-read fails, or the budget refuses it, it stands. Treating it as absent
  // would make every question vanish into "at least N" on the pass that changed
  // the prompt.
  //
  // BUT A STANDING VERDICT IS NOT A JUDGEMENT MADE THIS PASS — GPT Sol's F12.
  // A tail we asked about and got no usable answer for is unjudged, stale
  // verdict or not; otherwise a stale `no-question` whose re-read was refused
  // publishes "nothing needs you". So "judged" is `judgedNow`, never
  // `verdicts.has`, for everything in `toCall`. A stale verdict the per-pass
  // budget did not reach was never tried, and stays uncounted, as above.
  for (const hit of plan.stale) verdicts.set(hit.fingerprint, hit.verdict);
  const judgedNow = new Set<string>();
  let spend: ClassifierSpend = NO_SPEND;
  // Every tail we did not get a usable answer about, with the reason. This is
  // what stops a failed pass drawing as a calm one — GPT Sol's finding 1.
  const unclassified: string[] = plan.overBudget.map(
    (t) => `${t.fingerprint}: the budget of ${options.maxCalls} call(s) did not reach it`,
  );
  // THE DAY BUDGET'S ANSWER (D4–D6). The first datable refusal is what makes
  // this pass `limited`; any refusal stops the asking, because the next reserve
  // would say the same and each ask costs a lock round-trip for nothing.
  let stopped: AttentionJudgementStopped | null = null;
  let refusedBecause: string | null = null;
  // Why a tail the pass TRIED to (re-)read got no usable answer this pass. Only
  // a stale verdict still has a card for this to explain, and it says why that
  // card's proposal is `not-reached` rather than drawn (plan 260910f D3).
  const notReread = new Map<string, string>();
  for (const tail of plan.toCall) {
    if (refusedBecause === null) {
      const outcome = await options.classify(tail.tail);
      if (!("notCalled" in outcome)) {
        spend = addSpend(spend, outcome.spend);
        if (isCacheable(outcome.verdict)) {
          verdicts.set(tail.fingerprint, {
            fingerprint: tail.fingerprint,
            classifiedAt: nowIso,
            promptVersion,
            // Rebuilt from known fields: whatever else the object carried —
            // a `by`, say — is not remembered (D9).
            verdict: canonicalVerdict(outcome.verdict),
          });
          judgedNow.add(tail.fingerprint);
          continue;
        }
        // NOT CACHED, and that is the half that made finding 1 lethal rather than
        // transient. A 429 filed under the tail's fingerprint would be answered
        // from memory on every later pass, costing nothing and repeating the same
        // wrong silence for as long as the agent said nothing new.
        //
        // **A failure is a reason to look again, never a fact to remember.** The
        // general form, which is why this is not tidiness: *a wrong answer that is
        // cheap to repeat outlives the condition that caused it.* The 429 lasted a
        // second; the memory of it would have lasted until that agent spoke again,
        // and the cost of re-asking was the only thing that could have ended it.
        breakdown.verdictsUnreadable += 1;
        // Unjudged even when a stale verdict still places its card (F12).
        unclassified.push(`${tail.fingerprint}: ${outcome.verdict.why}`);
        notReread.set(tail.fingerprint, `its re-read failed: ${outcome.verdict.why}`);
        continue;
      }
      const refusal = outcome.notCalled;
      refusedBecause = refusal.kind === "stopped" ? refusal.stopped.why : refusal.why;
      if (refusal.kind === "stopped") stopped = refusal.stopped;
    }
    breakdown.budgetRefused += 1;
    unclassified.push(`${tail.fingerprint}: not asked — ${refusedBecause}`);
    notReread.set(tail.fingerprint, `not re-read — ${refusedBecause}`);
  }

  // SESSIONS, NOT FINGERPRINTS — GPT Sol's second round. Two sessions that ended
  // their turns identically share one tail and one call, which is the whole
  // saving; but if that one call fails, TWO sessions went unjudged and the number
  // Greg reads is about sessions. `overBudget` is fresh tails only, so none of
  // them has a verdict; `toCall` is judged by `judgedNow` (F12, above).
  const unclassifiedFingerprints = new Set([
    ...plan.overBudget.map((t) => t.fingerprint),
    ...plan.toCall.filter((t) => !judgedNow.has(t.fingerprint)).map((t) => t.fingerprint),
  ]);
  const unclassifiedSessions = material.filter((m) => unclassifiedFingerprints.has(m.fingerprint)).length;

  const observations: AttentionObservation[] = [];
  for (const m of material) {
    const cached = verdicts.get(m.fingerprint);
    const verdict = cached?.verdict;

    if (m.kind === "dialog") {
      // A DRAWN DIALOG IS AN ITEM WHATEVER THE MODEL SAYS. The harness drew it;
      // that is observed, and no verdict about the prose can unobserve it. The
      // model is asked only so a dialog can be RANKED alongside prose questions
      // by consequence — and when it cannot answer, the dialog falls to `other`
      // rather than out of the list.
      observations.push({
        sessionId: m.session.sessionId,
        sessionName: m.session.sessionName,
        kind: verdict?.kind === "question" ? verdict.attentionKind : "other",
        evidence: { kind: "dialog", question: m.question.prompt, options: m.question.options.map((o) => o.label) },
        answerability: verdict?.kind === "question" ? verdict.answerability : unknownAnswerability(verdict),
        topic: verdict?.kind === "question" ? verdict.topic : m.question.prompt,
        // Observed, not inferred: answered in the detail pane, never routed.
        proposal: { kind: "not-applicable" },
      });
      continue;
    }

    if (cached === undefined || cached.verdict.kind !== "question") continue;
    const question = cached.verdict;
    breakdown.questionsFound += 1;
    observations.push({
      sessionId: m.session.sessionId,
      sessionName: m.session.sessionName,
      kind: question.attentionKind,
      evidence: { kind: "prose", excerpt: m.tail, why: question.why },
      answerability: question.answerability,
      topic: question.topic,
      proposal: proposalFor({
        cached,
        promptVersion,
        usage: options.usage ?? null,
        notReread: notReread.get(m.fingerprint),
      }),
    });
  }

  const waits = rememberWaits(memory.waits, observations, nowIso);
  const list = buildAttentionList({
    observations,
    waits,
    sessionsScanned: breakdown.scanned,
    sessionsRead: sessionsRead(breakdown),
    unclassified,
    sessionsUnreadable: sessionsWeCouldNotJudge(breakdown, unclassifiedSessions),
    scannedAt: nowIso,
    stopped,
  });
  return { list, memory: { waits, verdicts, epoch: memory.epoch }, breakdown, spend };
}

/**
 * How many sessions produced a usable reading.
 *
 * A session counts as READ when we could say what state its pane was in — a
 * dialog of either sort, a turn still running, a turn that ended, or a pane that
 * is positively not Claude Code. It does NOT count when we could not reach the
 * pane at all or could not make sense of a Claude Code one, which is the case
 * that would otherwise draw a broken probe as a calm fleet.
 */
export function sessionsRead(b: PassBreakdown): number {
  return b.conversationDialogs + b.permissionDialogs + b.midTurn + b.noInputBox + b.endedTurns;
}

/**
 * Sessions we TRIED to judge and could not, which is the number the page shows.
 *
 * **Deliberate skips are excluded and that is the whole design of it.** A
 * mid-turn agent is not waiting on anybody and skipping it is right rather than
 * incomplete; so is a Codex pane, a shell, and a permission dialog. If those
 * landed here the number would be non-zero on almost every pass, the page would
 * carry a permanent caveat, and Greg would learn to read past it — A17 again,
 * healthy operation spending most of its time alarming, which would be worse
 * than not having the field.
 *
 * What IS a failure: a Claude Code pane that would not parse, a pane that went
 * away mid-read, and a tail that got no usable verdict (a 429, a timeout, an
 * answer in a vocabulary we do not know, or one the budget did not reach).
 */
export function sessionsWeCouldNotJudge(b: PassBreakdown, unclassifiedSessions: number): number {
  // `noPane` is in here on GPT Sol's second round, and it belongs: the register
  // knows the session and not where it is drawn, so we WANTED to judge it and had
  // no address. That is a failure to look, not a decision not to.
  return b.unreadable + b.captureFailed + b.noPane + unclassifiedSessions;
}

/** Every session lands in exactly one bucket. Asserted in the same run that produces the list. */
export function breakdownBalances(b: PassBreakdown): boolean {
  return (
    b.noPane + b.captureFailed + b.conversationDialogs + b.permissionDialogs + b.midTurn + b.noInputBox +
      b.unreadable + b.endedTurns ===
    b.scanned
  );
}

/**
 * What a prose card says when proposals are off (D7). It names the variable so
 * anybody reading the payload knows what turns it on, and it is never drawn.
 */
export const PROPOSALS_OFF_WHY =
  "proposals are off: the Overseer asks the plain question unless OVERSEER_PROPOSALS=1 is set in its environment";

/**
 * Who proposed it — THIS CODE, from the constant, never the model's own output
 * (plan 260910f D9). A fresh object each time so no card can mutate another's.
 */
function proposalAuthor(): ProposalAuthor {
  return { kind: "model", model: ATTENTION_CLASSIFIER_MODEL, via: "overseer" };
}

/**
 * Could the proposed holder take it now? Projected on EVERY pass from the
 * usage reading the caller hands in, and never remembered (D14), so a limit
 * that lifts reaches the next card at no cost.
 *
 * **Missing capability is shown, never substituted**: a Fable question whose
 * Fable is limited still names Fable, with `unavailable`. And where nothing is
 * measured it says `not-checked` rather than hoping — the checkpoint carries
 * no Codex reading and nothing reads the Overseer's own capacity.
 */
export function projectReach(recipient: ProposalRecipient, usage: UsageVerdict | null): ProposalReach {
  switch (recipient) {
    case "greg":
    case "self":
      return { kind: "available" };
    case "fable": {
      if (usage?.level === "limited") {
        const detail = usage.reasons[0];
        return {
          kind: "unavailable",
          why: `the last usage pass found this account's Claude limit hit${detail === undefined ? "" : ` (${detail})`}`,
        };
      }
      return {
        kind: "not-checked",
        why:
          usage === null
            ? "the checkpoint holds no usage reading"
            : "only a hit usage limit is checked; nothing checks that Fable can take a question now",
      };
    }
    case "sol":
      return { kind: "not-checked", why: "the checkpoint carries no Codex reading" };
    case "overseer":
      return { kind: "not-checked", why: "nothing checks the Overseer's own capacity yet" };
  }
}

/**
 * The proposal on a prose card, from the verdict that placed it.
 *
 * `off` when this pass is not proposal-aware, whatever the verdict holds — a
 * version-2 verdict left in memory after proposals are turned off is not
 * drawn. `not-reached` when the verdict came from another prompt (stale, D3):
 * it still places the card, and says whether its re-read was refused, failed,
 * or not reached by the per-pass budget.
 */
function proposalFor(input: {
  cached: CachedVerdict;
  promptVersion: number;
  usage: UsageVerdict | null;
  notReread: string | undefined;
}): AttentionProposal {
  const { cached, promptVersion } = input;
  if (promptVersion !== PROPOSAL_PROMPT_VERSION) return { kind: "off", why: PROPOSALS_OFF_WHY };
  if (cached.promptVersion !== promptVersion) {
    return {
      kind: "not-reached",
      why:
        input.notReread === undefined
          ? "this card's verdict came from an earlier prompt and the pass's per-pass budget has not yet reached its re-read"
          : `this card's verdict came from an earlier prompt, and ${input.notReread}`,
    };
  }
  const v = cached.verdict;
  // `parseVerdict` and the memory parser both refuse a version-2 question with
  // no proposal, so this is unreachable — but a card with no proposal is not a
  // card with a default one.
  if (v.kind !== "question" || v.recipient === undefined) {
    return { kind: "not-reached", why: "the verdict carries no proposal" };
  }
  const id = `${cached.fingerprint}:v${promptVersion}`;
  if (v.recipient === "unplaced") return { kind: "unplaced", id, why: v.unplacedWhy, by: proposalAuthor() };
  return {
    kind: "proposed",
    id,
    recipient: v.recipient,
    reason: v.reason,
    asks: v.asks,
    by: proposalAuthor(),
    reach: projectReach(v.recipient, input.usage),
  };
}

function unknownAnswerability(verdict: ClassifierVerdict | undefined): AttentionAnswerability {
  if (verdict === undefined) return { kind: "unknown", why: "the classifier was not run on this dialog" };
  if (verdict.kind === "no-question") return { kind: "unknown", why: "the classifier read the dialog as no question" };
  return { kind: "unknown", why: verdict.why };
}

/** What a dialog says, flattened for the classifier and for the fingerprint. */
function dialogText(q: Extract<PaneQuestion, { kind: "question" }>): string {
  const material = q.material.kind === "read" ? `\n\n${q.material.text}` : "";
  return `${q.prompt}${material}\n\n${q.options.map((o) => `- ${o.label}`).join("\n")}`;
}

/**
 * A dialog's identity.
 *
 * `pane.ts` already mints a `fingerprint` over the MATERIAL — the diff or command
 * being approved — and `sameQuestion` compares those, so it is reused here rather
 * than re-derived. A menu with no material has none, so the prompt and the option
 * labels stand in: two dialogs with the same words and the same options are the
 * same question, which is what duplicate collapse needs.
 */
function dialogFingerprint(q: Extract<PaneQuestion, { kind: "question" }>): string {
  if (q.material.kind === "read") return `dialog:${q.material.fingerprint}`;
  return `dialog:${Buffer.from(`${q.prompt}\n${q.options.map((o) => o.label).join("\n")}`, "utf8")
    .toString("base64url")
    .slice(0, 22)}`;
}
