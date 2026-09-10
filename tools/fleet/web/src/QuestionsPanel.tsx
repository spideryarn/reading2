/**
 * Everything presently waiting for Greg, without becoming a third observer.
 * Dialog text comes from the live row that owns the raw object an answer must
 * return. Prose stays observational because its address does not identify the
 * execution which wrote the excerpt.
 */
import { useCallback, useEffect, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { QuestionCard } from "./SessionParts";
import { SteerReceipt } from "./SteerReceipt";
import { httpQueueApi, type QueueApi, type QueueView } from "./queue-client";
import { httpSteerApi, sentTarget, type SentTarget, type SteerApi, type SteerOutcome } from "./steer-client";
import {
  isLocallyAnswerableDialog,
  questionSafetyKey,
  type AnsweringReading,
  type AttentionKind,
  type FleetRow,
  type QuestionGap,
  type QuestionItem,
  type QuestionTarget,
  type QuestionsView,
} from "./types";
import { Card, Mono, Pill, cx } from "./ui";
import { formatDuration, type Tone } from "./view";

type DialogItem = Extract<QuestionItem, { kind: "dialog" }>;
type UnaddressableDialogItem = Extract<QuestionItem, { kind: "dialog-unaddressable" }>;
type ProseItem = Extract<QuestionItem, { kind: "prose" | "prose-unaddressable" }>;

/** The row/item facts that would let a dialog card offer option buttons. */
function hasAnswerableTarget(item: DialogItem, row: FleetRow | undefined): row is FleetRow {
  return (
    row !== undefined &&
    isLocallyAnswerableDialog(row) &&
    row.paneId !== null &&
    row.claudeSessionId !== null &&
    item.target.sessionId === row.id &&
    item.target.sessionName === row.name
  );
}

function executionKey(row: FleetRow | undefined): string {
  if (row?.execution.kind !== "verified") return "unverified";
  const { boot, pid, startTicks } = row.execution.token;
  return JSON.stringify({ boot, pid, startTicks });
}

function itemKey(item: QuestionItem, row: FleetRow | undefined): string {
  switch (item.kind) {
    case "dialog":
    case "dialog-unaddressable":
      /* This is the stale-answer safety use of `sameQuestion`'s fields, not
         semantic grouping. The plan withdrew that grouping explicitly in
         § What round three changed, 3; remounting here only asks whether the
         question on screen is still the one that owns this local receipt. */
      return JSON.stringify([item.kind, item.rowId, executionKey(row), questionSafetyKey(row?.rawQuestion)]);
    case "prose":
    case "prose-unaddressable":
      return `${item.kind}:${item.itemId}:${executionKey(row)}`;
    default: {
      const never: never = item;
      return JSON.stringify(never);
    }
  }
}

/** One failed observer, in that observer's voice. No arm may fall through. */
function GapSentence({ gap }: { gap: QuestionGap }): ReactNode {
  switch (gap.kind) {
    case "attention-not-asked":
      return <>The dashboard server did not ask the attention observer for a reading.</>;
    case "checkpoint-absent":
      return <>The attention observer found no Overseer checkpoint to read.</>;
    case "checkpoint-unreadable":
      return <>The attention observer could not read the Overseer checkpoint: {gap.why}.</>;
    case "attention-list-unknown":
      return <>The Overseer attention pass could not judge what was waiting: {gap.why}.</>;
    case "attention-sessions-unreadable":
      return <>The attention observer could not judge one or more sessions it inspected.</>;
    case "attention-no-sessions-scanned":
      return <>The attention observer's scan did not inspect any sessions.</>;
    case "collection-not-observed":
      return <>The fleet collector has not completed a snapshot.</>;
    case "collection-failed":
      return <>The fleet collector's latest attempt failed: {gap.why}.</>;
    case "row-question-unreadable":
      return <>The fleet collector saw <Mono>{gap.rowId}</Mono> waiting, but could not read its dialog.</>;
    case "fleet-snapshot-stale":
      return <>The fleet collector says its fleet snapshot is stale; its last usable reading was {gap.collectedAt}.</>;
    case "checkpoint-stale":
      return <>The attention observer's checkpoint is stale; it was written at {gap.coordinatorWrittenAt}.</>;
    case "attention-scan-stale":
      return <>The attention observer's scan is stale; it was taken at {gap.scannedAt}.</>;
    case "questions-not-reported":
      return <>This dashboard server did not report a Questions view.</>;
    case "questions-unreadable":
      return <>This browser could not read the Questions view: {gap.why}.</>;
    case "attention-unreadable":
      return <>This browser could not read the attention observation: {gap.why}.</>;
    case "rows-unreadable":
      return <>This browser could not read one or more fleet rows in this payload.</>;
    case "dialog-reference-unresolved":
      return <>This browser could not resolve the dialog row <Mono>{gap.rowId}</Mono>: {gap.why}.</>;
    case "attention-reference-unresolved":
      return <>This browser could not resolve the prose observation <Mono>{gap.itemId}</Mono>: {gap.why}.</>;
    case "dialog-source-inconsistent":
      return <>This browser found contradictory dialog data for <Mono>{gap.rowId}</Mono>: {gap.why}.</>;
    case "eligible-observation-omitted":
      switch (gap.observation.kind) {
        case "dialog":
          return <>This browser found a live dialog on <Mono>{gap.observation.rowId}</Mono> that was missing from the reported Questions items.</>;
        case "prose":
          return <>This browser found prose observation <Mono>{gap.observation.itemId}</Mono> that was missing from the reported Questions items.</>;
        default: {
          const never: never = gap.observation;
          return JSON.stringify(never);
        }
      }
    default: {
      const never: never = gap;
      return JSON.stringify(never);
    }
  }
}

function Gaps({ gaps }: { gaps: readonly [QuestionGap, ...QuestionGap[]] }): ReactNode {
  return (
    <div className="tw:mt-3 tw:space-y-1 tw:rounded-lg tw:border tw:border-unknown/40 tw:bg-unknown-wash tw:p-3 tw:text-[13px] tw:text-unknown-ink">
      {gaps.map((gap, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: gaps carry no id and no state; a new payload replaces this observational list whole.
        <p key={`${gap.kind}:${index}`}><GapSentence gap={gap} /></p>
      ))}
    </div>
  );
}

/** A server-wide capability is stated once, rather than repeated on every card. */
function AnsweringNotice({ reading }: { reading: AnsweringReading }): ReactNode {
  switch (reading.kind) {
    case "enabled":
      return null;
    case "disabled":
      return (
        <p className="tw:mt-3 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px] tw:text-alarm-ink">
          This server has declared an answering hold. A tap would come back 503 and nothing would reach the session, so option buttons are withheld.
        </p>
      );
    case "not-reported":
      return (
        <p className="tw:mt-3 tw:rounded-lg tw:border tw:border-unknown/40 tw:bg-unknown-wash tw:p-3 tw:text-[13px] tw:text-unknown-ink">
          This server did not report whether answering works. No hold has been declared, but option buttons are withheld because an older server may still have the hold switched on.
        </p>
      );
    case "unreadable":
      return (
        <p className="tw:mt-3 tw:rounded-lg tw:border tw:border-unknown/40 tw:bg-unknown-wash tw:p-3 tw:text-[13px] tw:text-unknown-ink">
          This server's answering report was unreadable: {reading.why}. Whether answering works could not be established. No hold has been declared, but option buttons are withheld because the hold may still be switched on.
        </p>
      );
    default: {
      const never: never = reading;
      return JSON.stringify(never);
    }
  }
}

function DialogStub({ item }: { item: DialogItem | UnaddressableDialogItem }): ReactNode {
  return (
    <Card className="tw:mb-3 tw:border-l-4 tw:border-l-unknown tw:p-3">
      <h3 className="tw:font-medium tw:break-words">{item.target.sessionName}</h3>
      <p className="tw:mt-2 tw:text-[13px] tw:text-unknown-ink">
        A dialog was observed on this session, but its row could not be read on this side.
      </p>
      {item.kind === "dialog-unaddressable" ? (
        <p className="tw:mt-1 tw:text-[13px] tw:text-ink-soft">It was not addressable: {item.target.why}.</p>
      ) : null}
    </Card>
  );
}

/** State lives here so a changed execution token makes React discard it. */
function AnswerableDialog({ item, row, question, answeringEnabled, answeringRefusal, onAnsweringRefused, steer }: {
  item: DialogItem;
  row: FleetRow;
  question: NonNullable<FleetRow["question"]>;
  answeringEnabled: AnsweringReading;
  answeringRefusal: string | null;
  onAnsweringRefused: (why: string) => void;
  steer: SteerApi;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ result: SteerOutcome; target: SentTarget } | null>(null);
  /* **Only the dialog-scoped refusal is held here.** `grants-permission` is a
     fact about this dialog, so it dies with this card's key. `answering-disabled`
     is a fact about the whole server and goes to `App`'s one latch, which the
     Session detail reads as well — a second latch here was F16. */
  const [stickyRefusal, setStickyRefusal] = useState<string | null>(null);

  /* A confirmed send and an uncertain or partial delivery all require a fresh
     observation before another tap. Only a non-sticky refusal which positively
     says nothing was sent may remain answerable on the same row. */
  const repeatUnsafe = outcome !== null && (outcome.result.ok || outcome.result.delivery.kind !== "none");
  const canAnswer =
    answeringEnabled.kind === "enabled" &&
    answeringRefusal === null &&
    stickyRefusal === null &&
    !repeatUnsafe &&
    hasAnswerableTarget(item, row);

  const onAnswer = useCallback((index: number) => {
    if (!canAnswer) return;
    setBusy(true);
    /* Snapshotted before the await: a collection can replace `row` while the
       request is in flight, and the receipt is about the row that was tapped. */
    const target = sentTarget(row);
    void steer.answer(row, index).then((result) => {
      setOutcome({ result, target });
      if (!result.ok && result.code === "answering-disabled") onAnsweringRefused(result.why);
      if (!result.ok && result.code === "grants-permission") setStickyRefusal(result.why);
      setBusy(false);
    });
  }, [canAnswer, row, steer, onAnsweringRefused]);

  return (
    <Card className="tw:mb-3 tw:p-3">
      <h3 className="tw:font-medium tw:break-words">{row.name}</h3>
      <QuestionCard question={question} sessionName={row.name} onAnswer={canAnswer ? onAnswer : null} busy={busy} />
      {outcome === null ? null : <SteerReceipt outcome={outcome.result} target={outcome.target} />}
    </Card>
  );
}

function ReadOnlyDialog({ item, row }: { item: UnaddressableDialogItem; row: FleetRow }): ReactNode {
  if (row.question === null) return <DialogStub item={item} />;
  return (
    <Card className="tw:mb-3 tw:p-3">
      <h3 className="tw:font-medium tw:break-words">{row.name}</h3>
      <QuestionCard question={row.question} sessionName={row.name} onAnswer={null} />
      <p className="tw:mt-2 tw:text-[13px] tw:text-alarm-ink">This dialog cannot be answered here: {item.target.why}.</p>
    </Card>
  );
}

const ATTENTION_LABELS: Record<AttentionKind, { label: string; tone: Tone }> = {
  irreversible: { label: "Irreversible", tone: "alarm" },
  product: { label: "Product", tone: "needs" },
  technical: { label: "Technical", tone: "work" },
  other: { label: "Other", tone: "idle" },
};

function waitAge(waitingSince: string, now: number): string {
  const since = Date.parse(waitingSince);
  if (!Number.isFinite(since) || since > now) return "waiting, since when is unreadable";
  return `waiting ${formatDuration(now - since)}`;
}

function DuplicateList({ duplicates }: { duplicates: readonly QuestionTarget[] }): ReactNode {
  if (duplicates.length === 0) return null;
  return (
    <div className="tw:mt-2 tw:text-[12px] tw:text-ink-soft">
      <p className="tw:font-medium">Also waiting</p>
      <ul className="tw:mt-1 tw:list-disc tw:pl-5">
        {duplicates.map((target) => (
          <li key={target.sessionId}>
            {target.sessionName}{target.kind === "unaddressable" ? ` — ${target.why}` : ""}
          </li>
        ))}
      </ul>
    </div>
  );
}

function ProseContents({ item, now }: { item: ProseItem; now: number }): ReactNode {
  const ranking = ATTENTION_LABELS[item.attentionKind];
  return (
    <Card className={cx("tw:mb-3 tw:border-l-4 tw:p-3", item.attentionKind === "irreversible" ? "tw:border-l-alarm" : "tw:border-l-needs")}>
      <div className="tw:flex tw:flex-wrap tw:items-center tw:gap-2">
        <Pill tone={ranking.tone}>{ranking.label}</Pill>
        <span className="tw:ml-auto tw:text-[12px] tw:text-ink-faint">{waitAge(item.waitingSince, now)}</span>
      </div>
      <h3 className="tw:mt-2 tw:font-medium tw:break-words">{item.target.sessionName}</h3>
      {/* **THE `why` LEADS AND THE EXCERPT IS CLAMPED, AND BOTH HALVES ARE
          AttentionPanel.tsx's FINDING RATHER THAN A PREFERENCE.** That file
          built this the other way round first, and live data on 2026-09-08
          settled it: two real prose excerpts were 1,116 and 1,736 characters —
          17 and 21 lines — so "one card is 21 lines tall on a 390px phone and
          the second item is off the bottom of the screen". Reproduced here at
          390 × 844 on 2026-09-09 before this was changed: one card filled the
          whole viewport and was cut off mid-sentence.

          That is fatal on THIS tab specifically, because the third question it
          exists to answer is *which one first?* — and nobody can rank six
          waiting things when the first is taller than the screen.

          The `why` is one human-written sentence and is what a person acts on;
          the excerpt is what they check the inference against, which changes
          what you would believe rather than what you would do in the next ten
          seconds. So the sentence is never truncated and the evidence is.

          **CLAMPED RATHER THAN PUT BEHIND A `<details>`, which is where this
          tab differs from that one.** AttentionPanel's disclosure needed a CSS
          lift (`.attention-evidence`) because its card is a stretched link and
          the overlay painted above the summary, leaving it unreachable by tap —
          measured, in Chrome, on the box. This card is a whole-card tap target
          for the same reason, so a disclosure inside it would inherit exactly
          that trap. The full text is already one tap away in Sessions, which is
          where this card sends you, so v1 clamps and does not re-solve it. */}
      <p className="tw:mt-2 tw:text-[13px] tw:text-ink">{item.why}</p>
      <p className="tw:mt-2 tw:line-clamp-3 tw:break-words tw:whitespace-pre-wrap tw:text-[13px] tw:text-ink-soft">
        {item.excerpt}
      </p>
      {/* **THE TWO CAVEATS THAT USED TO BE HERE ARE NOW STATED ONCE, ABOVE THE
          LIST**, and moving them is this plan's own rule applied to itself.
          § No badge, in either direction: "a caveat on every card is read as
          noise within a day. That is A17." It says that about
          `sessionsUnreadable`; the first build of this card broke it twice over,
          with a by-position note and a one-tap-away note on every prose card —
          about as much small print as content, and identical on all of them.
          Both facts are true of the whole prose class rather than of any card,
          which is exactly what makes one statement the honest place for them.
          Seen at 390 x 844 on 2026-09-09; `ProseCaveat` is where they went. */}
      <DuplicateList duplicates={item.duplicates} />
      {item.kind === "prose" ? (
        /* An affordance rather than a sentence: what this card DOES is the one
           thing a reader cannot guess from looking at it, and the reason it is
           not answerable here is a fact about every prose card, stated once
           above. Not a `<button>` — the whole card is already the tap target,
           and a button inside it would be a control inside a control. */
        <p className="tw:mt-2 tw:text-[12px] tw:font-medium tw:text-needs-ink">Open in Sessions →</p>
      ) : (
        <p className="tw:mt-2 tw:text-[13px] tw:text-alarm-ink">This observation has no usable session address: {item.target.why}.</p>
      )}
    </Card>
  );
}

function SelectableProse({ item, now, onSelect }: {
  item: Extract<QuestionItem, { kind: "prose" }>;
  now: number;
  onSelect: (id: string) => void;
}): ReactNode {
  const activate = (): void => onSelect(item.target.sessionId);
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    activate();
  };
  return (
    // biome-ignore lint/a11y/useSemanticElements: a semantic button would violate the read-only prose-card contract; keyboard activation is supplied explicitly.
    <div
      data-question-kind="prose"
      role="button"
      tabIndex={0}
      className="tw:cursor-pointer tw:rounded-xl tw:focus-visible:outline-2 tw:focus-visible:outline-focus"
      onClick={activate}
      onKeyDown={onKeyDown}
    >
      <ProseContents item={item} now={now} />
    </div>
  );
}

/**
 * The two things that are true of every prose card, said once for the class.
 *
 * Drawn only when a prose item is actually on screen, for the reason it was
 * lifted off the cards at all: a caveat with nothing to caveat is the noise
 * this panel's gap vocabulary exists to avoid. A dialog-only list never sees it.
 */
function ProseCaveat(): ReactNode {
  return (
    <p className="tw:mt-3 tw:px-1 tw:text-[12px] tw:text-ink-faint">
      A handover is inferred from the tail of a session's screen, and the excerpt is taken by position
      rather than by search — so it may not be the part its sentence is about. Answering one is a tap
      away in Sessions rather than here, because the address cannot yet be proved to belong to the
      agent that asked.
    </p>
  );
}

function QuestionItems({ items, rows, answeringEnabled, answeringRefusal, onAnsweringRefused, onSelect, steer, now }: {
  items: readonly QuestionItem[];
  rows: readonly FleetRow[];
  answeringEnabled: AnsweringReading;
  answeringRefusal: string | null;
  onAnsweringRefused: (why: string) => void;
  onSelect: (sessionId: string) => void;
  steer: SteerApi;
  now: number;
}): ReactNode {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const anyProse = items.some((item) => item.kind === "prose" || item.kind === "prose-unaddressable");
  return (
    <div className="tw:mt-3">
      {anyProse ? <ProseCaveat /> : null}
      {items.map((item) => {
        const row = rowsById.get(
          item.kind === "dialog" || item.kind === "dialog-unaddressable" ? item.rowId : item.target.sessionId,
        );
        const key = itemKey(item, row);
        switch (item.kind) {
          case "dialog":
            return row === undefined || row.question === null
              ? <DialogStub key={key} item={item} />
              : (
                <AnswerableDialog
                  key={key}
                  item={item}
                  row={row}
                  question={row.question}
                  answeringEnabled={answeringEnabled}
                  answeringRefusal={answeringRefusal}
                  onAnsweringRefused={onAnsweringRefused}
                  steer={steer}
                />
              );
          case "dialog-unaddressable":
            return row === undefined || row.question === null
              ? <DialogStub key={key} item={item} />
              : <ReadOnlyDialog key={key} item={item} row={row} />;
          case "prose":
            return <SelectableProse key={key} item={item} now={now} onSelect={onSelect} />;
          case "prose-unaddressable":
            return <div key={key} data-question-kind="prose-unaddressable"><ProseContents item={item} now={now} /></div>;
          default: {
            const never: never = item;
            return JSON.stringify(never);
          }
        }
      })}
    </div>
  );
}

function QueuePointer({ view, onOpenQueue, sessionsQuiet }: {
  view: QueueView;
  onOpenQueue: () => void;
  sessionsQuiet: boolean;
}): ReactNode {
  let sentence: ReactNode;
  switch (view.kind) {
    case "loading":
      sentence = sessionsQuiet
        ? <>Sessions were observed and found quiet, but queued ideas could not be checked: the queued ideas are still being read.</>
        : <>The queued ideas are still being read.</>;
      break;
    case "queue": {
      const count = view.depth.needsGreg;
      sentence = count === 0 ? (
        <>The queue was read and nothing in it is waiting on you.</>
      ) : (
        <>
          {count} queued {count === 1 ? "idea is" : "ideas are"} waiting on you.{" "}
          <button type="button" className="tw:font-semibold tw:text-accent" onClick={onOpenQueue}>
            Open Queued ideas.
          </button>
        </>
      );
      break;
    }
    case "never-written":
      sentence = sessionsQuiet ? (
        <>Sessions were observed and found quiet, but queued ideas could not be checked: no queue file exists yet. This is ordinary, but it is not an empty queue: {view.why}.</>
      ) : (
        <>No queue file exists yet. This is ordinary, but it is not an empty queue: {view.why}.</>
      );
      break;
    case "unreadable":
      sentence = sessionsQuiet ? (
        <>Sessions were observed and found quiet, but queued ideas could not be checked: the server could not read the queue file: {view.why}.</>
      ) : (
        <>The server could not read the queue file: {view.why}.</>
      );
      break;
    case "no-answer":
      sentence = sessionsQuiet ? (
        <>Sessions were observed and found quiet, but queued ideas could not be checked: this browser never got an answer from the queue: {view.why}.</>
      ) : (
        <>This browser never got an answer from the queue: {view.why}.</>
      );
      break;
    default: {
      const never: never = view;
      sentence = JSON.stringify(never);
    }
  }

  return (
    <aside data-queue-pointer className="tw:mt-4 tw:rounded-lg tw:border tw:border-line tw:p-3 tw:text-[13px] tw:text-ink-soft">
      {sentence}
    </aside>
  );
}

export function QuestionsPanel({
  view,
  rows,
  answeringEnabled,
  answeringRefusal,
  onAnsweringRefused,
  onSelect,
  queueApi = httpQueueApi,
  refreshNonce = 0,
  onOpenQueue,
  steer = httpSteerApi,
  now,
}: {
  /** Already time-adjusted by the caller; null means no payload has arrived. */
  view: QuestionsView | null;
  rows: readonly FleetRow[];
  answeringEnabled: AnsweringReading;
  /**
   * An `answering-disabled` refusal the server has already made, latched by
   * `App` — and the way to tell it about a new one. The same latch the Session
   * detail reads, so a refusal in either withholds the buttons in both. App.tsx
   * § `answeringRefusal` owns when it comes off. GPT Sol's F16.
   */
  answeringRefusal: string | null;
  onAnsweringRefused: (why: string) => void;
  onSelect: (sessionId: string) => void;
  /** Read on entry, outside the pushed fleet-state collection loop. */
  queueApi?: QueueApi;
  /** Bumped by the dock's Refresh so this on-demand reading is not left behind. */
  refreshNonce?: number;
  onOpenQueue: () => void;
  /** The action seam. Tests inject it; the browser gets the real typed client. */
  steer?: SteerApi;
  now: number;
}): ReactNode {
  const [queue, setQueue] = useState<QueueView>({ kind: "loading" });

  /* A pushed session payload must not turn this on-demand read into another
     collection-loop request. Only entering the tab or asking the whole page
     to refresh crosses the queue seam. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: refreshNonce is the refresh signal — re-running when it changes is the point.
  useEffect(() => {
    let live = true;
    void queueApi.fetch().then((next) => {
      if (live) setQueue(next);
    });
    return () => {
      live = false;
    };
  }, [queueApi, refreshNonce]);

  const sessionsQuiet = view?.kind === "complete" && view.items.length === 0;
  const hasDialogItem =
    view !== null && view.kind !== "not-observed" && view.items.some((item) => item.kind === "dialog");
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const hasAnswerableDialog =
    view !== null &&
    view.kind !== "not-observed" &&
    view.items.some((item) => item.kind === "dialog" && hasAnswerableTarget(item, rowsById.get(item.rowId)));
  let body: ReactNode;
  if (view === null) {
    body = (
      <p className="tw:mt-3 tw:px-1 tw:text-[13px] tw:text-ink-soft">
        No Questions payload has arrived yet. The page has not observed whether anything needs you.
      </p>
    );
  } else {
    switch (view.kind) {
      case "not-observed":
        body = (
          <>
            <p className="tw:mt-3 tw:px-1 tw:text-[13px] tw:font-medium tw:text-unknown-ink">Questions were not observed.</p>
            <Gaps gaps={view.gaps} />
          </>
        );
        break;
      case "partial":
        body = (
          <>
            <p className="tw:mt-3 tw:px-1 tw:text-[13px] tw:font-medium tw:text-unknown-ink">This list may be incomplete.</p>
            <Gaps gaps={view.gaps} />
            <QuestionItems items={view.items} rows={rows} answeringEnabled={answeringEnabled} answeringRefusal={answeringRefusal} onAnsweringRefused={onAnsweringRefused} onSelect={onSelect} steer={steer} now={now} />
          </>
        );
        break;
      case "complete":
        body = view.items.length === 0 ? (
          queue.kind === "queue" && queue.depth.needsGreg === 0 ? (
            <p className="tw:mt-3 tw:px-1 tw:text-[13px] tw:text-ink-soft">Nothing needs you.</p>
          ) : queue.kind === "queue" ? (
            <p className="tw:mt-3 tw:px-1 tw:text-[13px] tw:text-ink-soft">Sessions were observed and found quiet.</p>
          ) : null
        ) : (
          <QuestionItems items={view.items} rows={rows} answeringEnabled={answeringEnabled} answeringRefusal={answeringRefusal} onAnsweringRefused={onAnsweringRefused} onSelect={onSelect} steer={steer} now={now} />
        );
        break;
      default: {
        const never: never = view;
        body = JSON.stringify(never);
      }
    }
  }

  return (
    <section aria-labelledby="questions-heading">
      <h1 id="questions-heading" className="tw:px-1 tw:text-[18px] tw:font-semibold">Questions</h1>
      <p className="tw:mt-1 tw:px-1 tw:text-[13px] tw:text-ink-soft">Everything currently waiting for your input.</p>
      {/* **NOT DRAWN BEFORE THE FIRST PAYLOAD**, and that is a correctness fix
          rather than tidying. `App.tsx` defaults this prop to
          `ANSWERING_NOT_REPORTED`, which is right — silence must not become
          `false` — but the `not-reported` sentence says *this server did not
          report whether answering works*, and before a payload arrives no
          server has said anything at all. Drawing it there attributes a silence
          to somebody who has not spoken, which is the same fabrication the
          default exists to prevent, one level along. The notice explains why
          cards have no buttons; with no view there are no cards. */}
      {hasDialogItem ? <AnsweringNotice reading={answeringEnabled} /> : null}
      {/* **WITHHELD WITH ITS REASON.** The refusal may have been made in the
          Session detail, where its receipt is; on this tab the buttons would
          otherwise simply be missing, which reads as a bug rather than as the
          server having said no. */}
      {hasAnswerableDialog && answeringRefusal !== null ? (
        <p className="tw:mt-3 tw:rounded-lg tw:border tw:border-alarm/40 tw:bg-alarm-wash tw:p-3 tw:text-[13px] tw:text-alarm-ink">
          The server refused an answer from this page, so option buttons are withheld until a later reading says
          answering is on: {answeringRefusal}
        </p>
      ) : null}
      {body}
      <QueuePointer view={queue} onOpenQueue={onOpenQueue} sessionsQuiet={sessionsQuiet} />
    </section>
  );
}
