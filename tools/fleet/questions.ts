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
import type {
  AttentionFeed,
  AttentionItem,
  QuestionGap,
  QuestionItem,
  QuestionTarget,
  QuestionsView,
} from "./wire.js";

/** The same generous deadlines the existing masthead and attention card use. */
const FLEET_STALE_CADENCES = 2.5;
const CHECKPOINT_STALE_MS = 5 * 60_000;
const SCAN_STALE_MS = 6 * 60_000;

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
          if (feed.list.sessionsScanned === 0) gaps.push({ kind: "attention-no-sessions-scanned" });
          if (feed.list.sessionsUnreadable > 0) {
            gaps.push({ kind: "attention-sessions-unreadable", count: feed.list.sessionsUnreadable });
          }
          for (const item of feed.list.items) composeAttentionItem(item, rowsById, items, gaps);
          return true;
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

function composeAttentionItem(
  item: AttentionItem,
  rowsById: ReadonlyMap<string, FleetRow>,
  items: QuestionItem[],
  gaps: QuestionGap[],
): void {
  if (item.evidence.kind === "dialog") {
    /* The inbox dialog is deliberately not a fallback card: doing that would
       let a slower observer overrule the pane authority. Its only unique news
       is a disagreement, which must prevent a false complete-empty answer. */
    for (const member of [item, ...item.duplicates]) {
      const row = rowsById.get(member.sessionId);
      if (row?.question?.kind !== "question" || row.question.gate.kind !== "conversation") {
        gaps.push({ kind: "attention-dialog-not-in-rows", itemId: item.id, sessionId: member.sessionId });
      }
    }
    return;
  }

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
 */
function isStale(iso: string, now: number, deadlineMs: number): boolean {
  const at = Date.parse(iso);
  return !Number.isFinite(at) || at > now || now - at > deadlineMs;
}
