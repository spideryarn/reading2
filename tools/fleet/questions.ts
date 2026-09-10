/**
 * The Questions view is a composition of two observations, not a third
 * question detector.
 *
 * The collector's pane reading owns dialogs; the Overseer's ranked inbox owns
 * prose. Trying to reconcile the two by prompt or fingerprint was the defect
 * this seam was introduced to remove: the inbox id is a model-produced topic
 * hash, not dialog identity, and even the producer's private cache fingerprint
 * is weaker than the send-time comparison. No identity join occurs here.
 *
 * This module is pure. In particular `now` is an input rather than a hidden
 * `Date.now()`, so a stale empty list can be arranged in a unit test instead of
 * being a timing-dependent claim no test has watched fail.
 */
import type { FleetRow } from "./collect.js";
import {
  CHECKPOINT_STALE_MS,
  FLEET_STALE_CADENCES,
  SCAN_STALE_MS,
} from "./question-freshness.js";
import type {
  AttentionFeed,
  AttentionItem,
  QuestionGap,
  QuestionItem,
  QuestionTarget,
  QuestionsView,
} from "./wire.js";

export type ComposeQuestionsInput = {
  rows: readonly FleetRow[];
  attentionFeed: AttentionFeed;
  collectionError: string | null;
  collectedAt: string | null;
  refreshMs: number;
  now: number;
};

/**
 * Compose references and completeness from one fleet snapshot and one inbox
 * projection. Never mutates either source and performs no I/O.
 */
export function composeQuestions(input: ComposeQuestionsInput): QuestionsView {
  const rowsById = new Map(input.rows.map((row) => [row.id, row]));
  const items: QuestionItem[] = [];
  const gaps: QuestionGap[] = [];

  observeFleet(input, items, gaps);
  const attentionObserved = observeAttention(input.attentionFeed, rowsById, items, gaps, input.now);

  if (gaps.length === 0) return { kind: "complete", items };
  const nonEmptyGaps = gaps as [QuestionGap, ...QuestionGap[]];

  /* `not-observed` means neither source supplied a usable observation, not
     merely that the composed list happened to be empty. A failed source may
     still have told us why it failed; retaining those arms is what prevents
     this outer state from becoming one more undifferentiated blank. */
  if (input.collectedAt === null && !attentionObserved && items.length === 0) {
    return { kind: "not-observed", gaps: nonEmptyGaps };
  }
  return { kind: "partial", items, gaps: nonEmptyGaps };
}

/** The pane snapshot's cards and every reason its negative claim is incomplete. */
function observeFleet(input: ComposeQuestionsInput, items: QuestionItem[], gaps: QuestionGap[]): void {
  if (input.collectedAt === null) {
    gaps.push({ kind: "collection-not-observed" });
  } else if (isStale(input.collectedAt, input.now, input.refreshMs * FLEET_STALE_CADENCES)) {
    gaps.push({ kind: "fleet-snapshot-stale", collectedAt: input.collectedAt });
  }

  if (input.collectionError !== null) gaps.push({ kind: "collection-failed", why: input.collectionError });

  for (const row of input.rows) {
    /* `readPanes` leaves exactly this state after a capture or parser failure.
       A parsed `{kind:"none"}` is different: the pane reader positively saw
       no dialog, so it must not turn normal status drift into a permanent gap. */
    if (row.status.kind === "needs-you" && row.question === null) {
      gaps.push({ kind: "row-question-unreadable", rowId: row.id });
      continue;
    }
    if (row.question?.kind !== "question" || row.question.gate.kind !== "conversation") continue;

    const target = targetFor(row.id, row.name, row);
    items.push(
      target.kind === "addressable"
        ? { kind: "dialog", rowId: row.id, target }
        : { kind: "dialog-unaddressable", rowId: row.id, target },
    );
  }
}

/**
 * The inbox contributes prose cards and positive controls, never dialog cards.
 * Returns whether a complete list — even an empty one — was actually observed.
 */
function observeAttention(
  feed: AttentionFeed,
  rowsById: ReadonlyMap<string, FleetRow>,
  items: QuestionItem[],
  gaps: QuestionGap[],
  now: number,
): boolean {
  switch (feed.kind) {
    case "not-asked":
      gaps.push({ kind: "attention-not-asked" });
      return false;
    case "checkpoint-absent":
      gaps.push({ kind: "checkpoint-absent" });
      return false;
    case "checkpoint-unreadable":
      gaps.push({ kind: "checkpoint-unreadable", why: feed.why });
      return false;
    case "published": {
      if (isStale(feed.coordinatorWrittenAt, now, CHECKPOINT_STALE_MS)) {
        gaps.push({ kind: "checkpoint-stale", coordinatorWrittenAt: feed.coordinatorWrittenAt });
      }
      if (isStale(feed.list.scannedAt, now, SCAN_STALE_MS)) {
        gaps.push({ kind: "attention-scan-stale", scannedAt: feed.list.scannedAt });
      }

      switch (feed.list.kind) {
        case "unknown":
          gaps.push({ kind: "attention-list-unknown", why: feed.list.why });
          return false;
        case "list":
        case "limited": {
          /* A `limited` list composes exactly as a `list` does — its items are
             real — and adds one gap naming the stop, because a judge that was
             refused cannot support "nothing else is waiting". Plan 260910f D6. */
          if (feed.list.kind === "limited") {
            gaps.push({ kind: "attention-judgement-stopped", why: feed.list.stopped.why, until: feed.list.stopped.until });
          }
          if (feed.list.sessionsScanned === 0) gaps.push({ kind: "attention-no-sessions-scanned" });
          if (feed.list.sessionsUnreadable > 0) {
            gaps.push({ kind: "attention-sessions-unreadable", count: feed.list.sessionsUnreadable });
          }
          for (const item of feed.list.items) composeAttentionItem(item, rowsById, items);
          /* A LIST IS NOT AN OBSERVATION UNTIL SOMETHING IN IT WAS READ. Zero
             scanned is the broken probe `AttentionList` names in its own
             comment, and all-unreadable is a walk that judged nothing — neither
             is evidence about the fleet, so neither may help the caller decide
             it observed enough to be `partial` rather than `not-observed`. The
             real producer normally turns both into `unknown`, but both
             checkpoint parsers accept such a list, so this is checked here
             rather than assumed upstream. Sol's P2, 2026-09-09. */
          return feed.list.sessionsScanned > feed.list.sessionsUnreadable;
        }
        default: {
          const never: never = feed.list;
          void never;
          return false;
        }
      }
    }
    default: {
      const never: never = feed;
      void never;
      return false;
    }
  }
}

/**
 * **NO `gaps` PARAMETER, and its absence is the fix rather than tidying.** This
 * function raised exactly one gap and the review deleted it; keeping the
 * parameter would leave the door open for the same mistake to be walked back in
 * without anybody deciding to. A prose item is composed or it is drawn as
 * unaddressable — neither is an incomplete observation.
 */
function composeAttentionItem(
  item: AttentionItem,
  rowsById: ReadonlyMap<string, FleetRow>,
  items: QuestionItem[],
): void {
  /* AN INBOX DIALOG THE PANE NO LONGER SHOWS IS DISCARDED IN SILENCE, AND THAT
     IS THE CORRECTION THAT MATTERS MOST IN THIS FILE.

     It first raised an `attention-dialog-not-in-rows` gap, on the reasoning that
     a disagreement between the two observers is news. It is not: the inbox
     scans every ~2 minutes and the collector every ~73 seconds, so **a dialog
     answered in between disagrees with the inbox as a matter of ordinary
     operation**. Emitting a gap there put a caveat on the page and downgraded
     `complete` to `partial` for about two minutes per answered dialog — across
     a fleet, most of the time. That is A17, healthy operation spending its life
     alarming, which is exactly what the gap vocabulary exists to avoid.

     Every case is already covered, or is not a fact:

      - the pane reading is readable and recent and shows no dialog → the pane
        is the authority and it says the dialog is gone. Silence.
      - collection was absent, failed or is stale, or this row's question could
        not be read → `observeFleet` has already said so, with a better name.
      - the session has no row at all → either it ended, or the rows are
        incomplete, and the second is one of the gaps above.

     The ONE thing that would be worth saying is *the inbox observed this dialog
     AFTER the pane did*, which is genuine missing data rather than lag. **It
     cannot be computed from the clocks we have**: `collectedAt` is stamped when
     the whole collection finishes and `scannedAt` near the start of the
     attention pass, so their order does not settle which observation of THIS
     pane came first. Saying it would need a per-pane observation instant, which
     nothing publishes. Naming the uncertainty is honest; inventing the gap was
     not. GPT Sol's P1, 2026-09-09. */
  if (item.evidence.kind === "dialog") return;

  const target = targetFor(item.sessionId, item.sessionName, rowsById.get(item.sessionId));
  const duplicates = item.duplicates.map((duplicate) =>
    targetFor(duplicate.sessionId, duplicate.sessionName, rowsById.get(duplicate.sessionId)),
  );
  const common = {
    itemId: item.id,
    excerpt: item.evidence.excerpt,
    why: item.evidence.why,
    waitingSince: item.waitingSince,
    attentionKind: item.kind,
    duplicates,
  } as const;

  /* Addressability changes only which observational arm is drawn. Neither arm
     carries pane/conversation handles, an execution identity, or an action — a
     prose address can select SessionDetail and cannot authorise a write. */
  items.push(
    target.kind === "addressable"
      ? { kind: "prose", target, ...common }
      : { kind: "prose-unaddressable", target, ...common },
  );
}

function targetFor(sessionId: string, sessionName: string, row: FleetRow | undefined): QuestionTarget {
  if (row === undefined) {
    return { kind: "unaddressable", sessionId, sessionName, why: "no fleet row was observed for this session" };
  }
  if (row.paneId === null) {
    return { kind: "unaddressable", sessionId, sessionName, why: "the fleet row has no pane address" };
  }
  if (row.claudeSessionId === null) {
    return { kind: "unaddressable", sessionId, sessionName, why: "the fleet row has no conversation id" };
  }
  return { kind: "addressable", sessionId, sessionName };
}

/**
 * A future or unreadable instant is not fresh. Treating it as age zero is the
 * quiet direction: a broken clock would preserve `complete` indefinitely.
 *
 * **An unusable DEADLINE fails the same way**, and it is not hypothetical: the
 * fleet deadline is `refreshMs * FLEET_STALE_CADENCES`, and a `refreshMs` that
 * is not a finite positive number makes it `NaN`, against which every
 * comparison is false — so an arbitrarily old snapshot would read as fresh and
 * hold `complete` open. Sol's P2, 2026-09-09.
 */
function isStale(iso: string, now: number, deadlineMs: number): boolean {
  if (!Number.isFinite(deadlineMs) || deadlineMs <= 0) return true;
  const at = Date.parse(iso);
  return !Number.isFinite(at) || at > now || now - at > deadlineMs;
}
