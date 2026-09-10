/**
 * WHAT NEEDS GREG, RANKED — the deciding half of the attention inbox.
 *
 * The Overseer decides what needs him and why; the dashboard renders it and
 * collects the tap. The seam is `AttentionList` in `tools/fleet/wire.ts`, which
 * both sides import, and this file is everything on our side of it that is pure:
 * grouping, ranking, and the durations. The pane reading is `turn-tail.ts` and
 * the model pass is `attention-classify.ts`.
 *
 * ## What this is not
 *
 * Fable, 2026-09-08, rejecting the framing before answering it, and it is the
 * most useful thing anyone has said about this system:
 *
 * > A blocked agent is the cheapest thing on the box. It burns no quota, no CPU,
 * > no reviewer time; its only cost is wall-clock and a worktree … The agent
 * > that costs real money is the one that is working, confidently, on the wrong
 * > thing … It never asks. It never appears on a "needs you" list.
 *
 * So this is the small, boring half. It gets built because it is where the taps
 * go, and it gets built honestly rather than impressively. **The misdirection
 * half is not here and must not creep in.**
 *
 * ## The four decisions the shape carries, and what enforces each
 *
 *  1. **The evidence union is load-bearing.** A `dialog` is observed — the
 *     harness drew it, the options are enumerated, answering picks one. A
 *     `prose` item is inferred — we read a turn's tail and decided. Those are
 *     different RISKS, not different confidences. Enforced here by
 *     `attentionQuestionKey`, which folds the evidence kind into the key so two
 *     items that read alike can never collapse into one card, and at the type
 *     level in tests/overseer-attention.test.ts.
 *  2. **There is no confidence field, anywhere.** Ranking by self-reported
 *     confidence promotes exactly the confident mistakes you most want caught
 *     (Fable and Astra's A18, independently). `ATTENTION_KIND_ORDER` ranks by
 *     consequence and reversibility instead.
 *  3. **`waitingSince` is first-seen, not last-seen.** The pane can say a dialog
 *     is open; it cannot say for how long. That is what `rememberWaits` is, and
 *     it is why an observation with no remembered wait is DROPPED rather than
 *     dated now.
 *  4. **The producer sorts.** Kind first, age only as a tie-breaker: *"the agent
 *     that has waited longest is the one for whom ten more minutes matters
 *     least"*. `compareItems` is total, so the order is a function of the data
 *     rather than of the order the fleet happened to be scanned in — Astra's
 *     rule is *"do not reorder or replace a card's options while his finger is
 *     approaching them"*, and a sort that depended on scan order would move a
 *     card for no reason at all.
 */
import { createHash } from "node:crypto";

import type {
  AttentionAnswerability,
  AttentionEvidence,
  AttentionItem,
  AttentionJudgementStopped,
  AttentionKind,
  AttentionList,
  AttentionProposal,
} from "../fleet/wire.js";

/**
 * Consequence and reversibility, most consequential first.
 *
 * NOT urgency and NOT confidence. `irreversible` is a deploy, a production
 * write, spending money, a push to `main`, removing a worktree with uncommitted
 * work — the things § Push almost nothing lists, and the things whose cost is
 * not recovered by waiting. `product` is a decision about what we are building,
 * where Greg's answer is often a fifth option nobody offered. `technical` is a
 * decision with a right answer somebody else could find. `other` is everything
 * we could not place, and it is last because an unplaced question is more likely
 * to be a misread than a crisis.
 */
export const ATTENTION_KIND_ORDER: readonly AttentionKind[] = [
  "irreversible",
  "product",
  "technical",
  "other",
];

/**
 * One session's answer to *does this need Greg*, before durations and duplicates.
 *
 * `topic` is the odd one out and it is deliberately NOT published. It is a short
 * canonical phrase for what is being asked — the thing two sessions hitting the
 * same wall have in common — and it exists only so `attentionQuestionKey` can
 * group them. It is not in `AttentionItem` because putting it there would be a
 * `question: string` field by another name, reachable from both arms of the
 * evidence union, which is decision one undone in a single line.
 */
export type AttentionObservation = {
  sessionId: string;
  sessionName: string;
  kind: AttentionKind;
  evidence: AttentionEvidence;
  answerability: AttentionAnswerability;
  /** Canonical, for grouping. Producer-internal; never crosses the wire. */
  topic: string;
  /**
   * Who the model proposes holds the answer, or why there is no proposal
   * (plan 260910f Stage 2). Worked out by the pass; carried onto the item from
   * the group's PRIMARY observation, the one whose tail the card quotes.
   */
  proposal: AttentionProposal;
};

/**
 * The identity of a QUESTION — which is the unit, because *"at 11pm nobody cares
 * which of 36 asked"*.
 *
 * **The evidence kind is part of the key, and that is the point.** Two sessions
 * asking the same thing collapse into one card only when answering them means
 * the same act. A drawn dialog and a sentence that reads identically are
 * answered by different mechanisms with different capabilities, so they are two
 * questions here however alike they look on a screen.
 *
 * Normalised on whitespace and case so a wrapped line or a capital does not mint
 * a second card, and no further: stemming or synonym-matching would start
 * merging questions that are not the same question, and a wrong merge shows Greg
 * one card and applies his answer to somebody else's problem.
 */
export function attentionQuestionKey(o: Pick<AttentionObservation, "evidence" | "topic">): string {
  const normalised = o.topic.toLowerCase().replace(/\s+/g, " ").trim();
  return createHash("sha256")
    // JSON rather than a delimiter character: a hand-picked one either can appear
    // in a topic (and lets two different questions hash the same) or is an
    // invisible byte in the source, and this file has already been bitten by the
    // second of those.
    .update(JSON.stringify([o.evidence.kind, normalised]), "utf8")
    .digest("hex")
    .slice(0, 16);
}

/**
 * How long each session has been asking each thing.
 *
 * A `Map` from `"<sessionId> <questionKey>"` to the ISO instant we FIRST saw it.
 * Per session AND per question, rather than per question alone, because two
 * sessions that hit the same wall hit it at different times and each carries its
 * own `waitingSince` into `duplicates`.
 *
 * Kept by the Overseer rather than derived from a pane, because a pane cannot
 * say how long anything has been true. It is the same fact `RegisterEntry`
 * carries about a status, one level down, and it is why
 * docs/project/overseer-direction.md § The order of work says attention
 * triage *arrives* first but cannot be *built* first.
 */
export type AttentionWaits = ReadonlyMap<string, string>;

/** The key into `AttentionWaits`. One function, so a reader and a writer cannot spell it differently. */
export function waitKey(sessionId: string, questionKey: string): string {
  return `${sessionId} ${questionKey}`;
}

/**
 * Fold this pass's observations into the memory of when each was first seen.
 *
 * **A question that stopped being asked is FORGOTTEN, not kept.** If the same
 * question comes back an hour later, that is a new wait: the agent went on to do
 * something else and came back, and reporting *"waiting since 09:00"* over a
 * gap would tell Greg he had ignored something for four hours when he had
 * ignored it for four minutes. The same reasoning as `StatusSince` in store.ts,
 * where a bare timestamp once printed four sessions as `13m` because it was
 * measuring the daemon's uptime rather than theirs.
 *
 * The cost of forgetting, named: a question that flickers — because a pane
 * redrew, or a tail scrolled — resets its own clock and reads as newer than it
 * is. That direction is the safe one. The other direction, inventing a duration
 * over a gap, is the one that made a triage surface lie.
 */
export function rememberWaits(
  previous: AttentionWaits,
  observations: readonly AttentionObservation[],
  nowIso: string,
): AttentionWaits {
  const next = new Map<string, string>();
  for (const o of observations) {
    const key = waitKey(o.sessionId, attentionQuestionKey(o));
    next.set(key, previous.get(key) ?? nowIso);
  }
  return next;
}

export type BuildAttentionInput = {
  readonly observations: readonly AttentionObservation[];
  readonly waits: AttentionWaits;
  /** How many sessions the pass looked at. THE POSITIVE CONTROL. */
  readonly sessionsScanned: number;
  /**
   * How many of those produced a usable reading — a turn we could tell had
   * ended or not, or a dialog we could parse.
   *
   * **This closes the hole `sessionsScanned` alone cannot.** Zero items out of
   * zero scanned is a broken probe and the count says so. Zero items out of
   * twenty scanned and twenty UNREADABLE draws identically to a calm fleet, and
   * that is the same shape of bug: something reporting success while doing
   * nothing (docs/reusable/silent-success.md). So a pass that read nothing
   * returns `unknown` rather than an empty list.
   */
  readonly sessionsRead: number;
  /**
   * One line per tail we did NOT get a usable answer about, with the reason —
   * a gateway 429, a timeout, a verdict in a vocabulary we do not know, a tail
   * the budget did not reach.
   *
   * **This is the difference between a quiet fleet and a broken deciding half**,
   * and nothing else in the pass can tell them apart. GPT Sol's finding 1: one
   * ended turn plus one 429 used to publish `{"kind":"list","items":[],
   * "sessionsScanned":1}` — an empty inbox produced by a classifier that never
   * answered, with `breakdownBalances()` green throughout, because every row DID
   * enter a bucket. The accounting proves the walk happened; it cannot prove the
   * judgement did.
   */
  readonly unclassified: readonly string[];
  /**
   * How many SESSIONS we tried to judge and could not — published, unlike
   * `unclassified`, which is per distinct tail and carries reasons for a log.
   *
   * Deliberate skips are excluded, and that exclusion is the whole design of the
   * field: see `AttentionList.sessionsUnreadable` in wire.ts.
   */
  readonly sessionsUnreadable: number;
  readonly scannedAt: string;
  /**
   * Set when the day budget or a quota cooldown REFUSED a paid call this pass
   * (plan 260910f D4–D6), and the list is then `limited`. Absent or null means
   * the model was never refused — which is not the same as every tail having
   * been judged: the per-pass `maxCalls` catch-up is ordinary operation and
   * stays a `list` with `sessionsUnreadable`.
   */
  readonly stopped?: AttentionJudgementStopped | null;
};

/**
 * Group, rank and publish. The renderer must not re-sort what comes out.
 */
export function buildAttentionList(input: BuildAttentionInput): AttentionList {
  const { observations, waits, sessionsScanned, sessionsRead, unclassified, sessionsUnreadable, scannedAt } = input;

  // A SCAN OF NOTHING IS A BROKEN PROBE, and the wire type says so in as many
  // words. It used to return a list anyway, and the test meant to catch that only
  // asserted the two results DIFFERED — which they did, by the count. A check
  // that answered a weaker question than the one it was named for.
  if (sessionsScanned === 0) {
    return {
      kind: "unknown",
      why: "no sessions were scanned at all, which is a broken probe rather than a calm fleet",
      scannedAt,
    };
  }
  if (sessionsRead === 0) {
    return {
      kind: "unknown",
      why:
        `${sessionsScanned} sessions were scanned and none of them could be read. An empty inbox drawn ` +
        `from that would look exactly like a calm fleet, so this says so instead.`,
      scannedAt,
    };
  }

  const groups = new Map<string, { key: string; members: { o: AttentionObservation; waitingSince: string }[] }>();
  for (const o of observations) {
    const key = attentionQuestionKey(o);
    const waitingSince = waits.get(waitKey(o.sessionId, key));
    // NO WAIT, NO ITEM. Dating this `now` would report a fresh 0s for something
    // that may have been waiting since breakfast, on the surface whose whole job
    // is that number — the `13m` bug in store.ts, one level down.
    if (waitingSince === undefined) continue;
    const group = groups.get(key) ?? { key, members: [] };
    group.members.push({ o, waitingSince });
    groups.set(key, group);
  }

  const items: AttentionItem[] = [];
  for (const group of groups.values()) {
    // The primary is the one that has waited longest, tie-broken by session id
    // so it does not depend on scan order. It changes only when the primary
    // itself disappears — at which point the card was pointing at a dead pane
    // anyway, which is Fable's *"a card should disappear when the session's
    // status changes, not when Send is pressed"*.
    const members = [...group.members].sort(
      (a, b) => a.waitingSince.localeCompare(b.waitingSince) || a.o.sessionId.localeCompare(b.o.sessionId),
    );
    const primary = members[0];
    if (primary === undefined) continue;
    items.push({
      // The id is the QUESTION's, not the session's, so a card keeps its
      // identity when a duplicate arrives or leaves.
      id: group.key,
      sessionId: primary.o.sessionId,
      sessionName: primary.o.sessionName,
      waitingSince: primary.waitingSince,
      kind: primary.o.kind,
      evidence: primary.o.evidence,
      answerability: primary.o.answerability,
      // The PRIMARY's, like the evidence it sits beside: the proposal is about
      // the sentence in this card's tail, and its id is that tail's.
      proposal: primary.o.proposal,
      duplicates: members.slice(1).map((m) => ({
        sessionId: m.o.sessionId,
        sessionName: m.o.sessionName,
        waitingSince: m.waitingSince,
      })),
    });
  }

  items.sort(compareItems);

  // INCOMPLETENESS SUPPRESSES THE CLAIM OF ABSENCE, AND NEVER THE ITEMS.
  //
  // An EMPTY list is the only output that is a claim about what is NOT there —
  // "nothing needs you" — and it must not be made on evidence we did not get. A
  // NON-EMPTY list is a claim about presence, and publishing it while some tail
  // went unread costs Greg a missed item, which is a recall failure: an agent
  // waits, and waiting is the cheapest thing on this box. Blanking the list
  // instead would cost him the items we DID find, for no gain.
  //
  // So the two error modes are traded deliberately rather than symmetrically,
  // and the direction is the one the whole stage argues for elsewhere: presence
  // beats position, and a false silence beats nothing.
  //
  // KEYED ON `sessionsUnreadable`, NOT ON `unclassified` — GPT Sol's second
  // round. `unclassified` is classifier failures only, so a pass with nineteen
  // quiet panes and one pane that would not parse used to publish "nothing needs
  // you" with a caveat under it retracting the claim. A sentence and its
  // retraction in the same block is worse than either.
  //
  // A STOPPED JUDGE IS `limited`, EMPTY OR NOT — plan 260910f D6. It says what
  // `unknown` would and also why, and until when, in fields a reader can act on;
  // and an older reader rejects the kind loudly, which is the point of it being
  // a kind. The two broken-probe cases above stay `unknown`: nothing was read,
  // so there is nothing for the stop to qualify.
  if (input.stopped !== undefined && input.stopped !== null) {
    return { kind: "limited", items, sessionsScanned, sessionsUnreadable, scannedAt, stopped: input.stopped };
  }
  if (items.length === 0 && sessionsUnreadable > 0) {
    const why =
      unclassified.length > 0
        ? `: ${unclassified.slice(0, 3).join("; ")}${unclassified.length > 3 ? ` (and ${unclassified.length - 3} more)` : ""}`
        : "";
    return {
      kind: "unknown",
      why:
        `nothing was found, but ${sessionsUnreadable} session(s) could not be judged at all, so this ` +
        `cannot say the fleet is calm${why}`,
      scannedAt,
    };
  }
  return { kind: "list", items, sessionsScanned, sessionsUnreadable, scannedAt };
}

/**
 * Kind first, then the longest wait, then the id.
 *
 * The third term is not decoration: without it the order of two items that agree
 * on the first two depends on `Array.prototype.sort`'s stability over whatever
 * order the fleet was scanned in, and a card that moves between two payloads for
 * no reason is exactly what Astra's rule forbids.
 */
export function compareItems(a: AttentionItem, b: AttentionItem): number {
  const byKind = ATTENTION_KIND_ORDER.indexOf(a.kind) - ATTENTION_KIND_ORDER.indexOf(b.kind);
  if (byKind !== 0) return byKind;
  const byAge = a.waitingSince.localeCompare(b.waitingSince);
  if (byAge !== 0) return byAge;
  return a.id.localeCompare(b.id);
}

/**
 * A repeated duplicate is the strongest available signal that a POLICY is
 * missing — so say so somewhere a person will see it.
 *
 * Returned as a sentence rather than written to a log, because the place a
 * person will see it is the CLI's own output and the plan doc, and because
 * anything that decided on its own to write a rule down would be the thing
 * § Does the augmentation principle apply? refuses: never hide that a decision
 * was made, or who made it.
 */
export function policyGaps(list: AttentionList): readonly string[] {
  // A `limited` list's duplicates are as real as a `list`'s; only `unknown` has none.
  if (list.kind === "unknown") return [];
  return list.items
    .filter((i) => i.duplicates.length > 0)
    .map(
      (i) =>
        `${i.duplicates.length + 1} sessions are waiting on the same question (${i.sessionName} and ` +
        `${i.duplicates.map((d) => d.sessionName).join(", ")}). Answering it once is a policy, not an answer: ` +
        `a repeated duplicate is the strongest available signal that a rule is missing.`,
    );
}
