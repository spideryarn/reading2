/**
 * Everything presently waiting for Greg, without becoming a third observer.
 * Dialog text comes from the live row that owns the raw object an answer must
 * return. Prose stays observational because its address does not identify the
 * execution which wrote the excerpt.
 */
import { useCallback, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { QuestionCard } from "./SessionParts";
import { SteerReceipt } from "./SteerReceipt";
import { httpSteerApi, sentTarget, type SentTarget, type SteerApi, type SteerOutcome } from "./steer-client";
import type {
  AnsweringReading,
  AttentionKind,
  FleetRow,
  QuestionGap,
  QuestionItem,
  QuestionTarget,
  QuestionsView,
} from "./types";
import { Card, Mono, Pill, cx } from "./ui";
import { formatDuration, type Tone } from "./view";

type DialogItem = Extract<QuestionItem, { kind: "dialog" }>;
type UnaddressableDialogItem = Extract<QuestionItem, { kind: "dialog-unaddressable" }>;
type ProseItem = Extract<QuestionItem, { kind: "prose" | "prose-unaddressable" }>;

function executionKey(row: FleetRow | undefined): string {
  if (row?.execution.kind !== "verified") return "unverified";
  const { boot, pid, startTicks } = row.execution.token;
  return JSON.stringify({ boot, pid, startTicks });
}

function itemKey(item: QuestionItem, row: FleetRow | undefined): string {
  switch (item.kind) {
    case "dialog":
    case "dialog-unaddressable":
      return `${item.kind}:${item.rowId}:${executionKey(row)}`;
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
function AnswerableDialog({ item, row, question, answeringEnabled, steer }: {
  item: DialogItem;
  row: FleetRow;
  question: NonNullable<FleetRow["question"]>;
  answeringEnabled: AnsweringReading;
  steer: SteerApi;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ result: SteerOutcome; target: SentTarget } | null>(null);
  const [stickyRefusal, setStickyRefusal] = useState<string | null>(null);

  /* A confirmed send and an uncertain or partial delivery all require a fresh
     observation before another tap. Only a non-sticky refusal which positively
     says nothing was sent may remain answerable on the same row. */
  const repeatUnsafe = outcome !== null && (outcome.result.ok || outcome.result.delivery.kind !== "none");
  const canAnswer =
    answeringEnabled.kind === "enabled" &&
    stickyRefusal === null &&
    !repeatUnsafe &&
    question.gate.kind === "conversation" &&
    row.paneId !== null &&
    row.claudeSessionId !== null &&
    item.target.sessionId === row.id &&
    item.target.sessionName === row.name;

  const onAnswer = useCallback((index: number) => {
    if (!canAnswer) return;
    setBusy(true);
    /* Snapshotted before the await: a collection can replace `row` while the
       request is in flight, and the receipt is about the row that was tapped. */
    const target = sentTarget(row);
    void steer.answer(row, index).then((result) => {
      setOutcome({ result, target });
      if (!result.ok && (result.code === "answering-disabled" || result.code === "grants-permission")) {
        setStickyRefusal(result.why);
      }
      setBusy(false);
    });
  }, [canAnswer, row, steer]);

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
      <p className="tw:mt-2 tw:break-words tw:whitespace-pre-wrap">{item.excerpt}</p>
      <p className="tw:mt-2 tw:text-[13px] tw:text-ink-soft">{item.why}</p>
      <DuplicateList duplicates={item.duplicates} />
      {item.kind === "prose" ? (
        <p className="tw:mt-2 tw:text-[12px] tw:text-ink-faint">
          Answering is one tap away in Sessions because this address cannot yet be proved to belong to the asker.
        </p>
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

function QuestionItems({ items, rows, answeringEnabled, onSelect, steer, now }: {
  items: readonly QuestionItem[];
  rows: readonly FleetRow[];
  answeringEnabled: AnsweringReading;
  onSelect: (sessionId: string) => void;
  steer: SteerApi;
  now: number;
}): ReactNode {
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  return (
    <div className="tw:mt-3">
      {items.map((item) => {
        const row = rowsById.get(
          item.kind === "dialog" || item.kind === "dialog-unaddressable" ? item.rowId : item.target.sessionId,
        );
        const key = itemKey(item, row);
        switch (item.kind) {
          case "dialog":
            return row === undefined || row.question === null
              ? <DialogStub key={key} item={item} />
              : <AnswerableDialog key={key} item={item} row={row} question={row.question} answeringEnabled={answeringEnabled} steer={steer} />;
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

export function QuestionsPanel({ view, rows, answeringEnabled, onSelect, steer = httpSteerApi, now }: {
  /** Already time-adjusted by the caller; null means no payload has arrived. */
  view: QuestionsView | null;
  rows: readonly FleetRow[];
  answeringEnabled: AnsweringReading;
  onSelect: (sessionId: string) => void;
  /** The action seam. Tests inject it; the browser gets the real typed client. */
  steer?: SteerApi;
  now: number;
}): ReactNode {
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
            <QuestionItems items={view.items} rows={rows} answeringEnabled={answeringEnabled} onSelect={onSelect} steer={steer} now={now} />
          </>
        );
        break;
      case "complete":
        body = view.items.length === 0 ? (
          <p className="tw:mt-3 tw:px-1 tw:text-[13px] tw:text-ink-soft">Nothing needs you.</p>
        ) : (
          <QuestionItems items={view.items} rows={rows} answeringEnabled={answeringEnabled} onSelect={onSelect} steer={steer} now={now} />
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
      {view === null ? null : <AnsweringNotice reading={answeringEnabled} />}
      {body}
    </section>
  );
}
