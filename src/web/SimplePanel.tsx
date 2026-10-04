/**
 * **Simple** — Summary's plain-words sub-mode: a few short paragraphs in
 * everyday words saying what the piece is about, why it matters and its key
 * ideas, each followed by the passages it rests on.
 * docs/plans/260930i-simple-summaries-eli15-sub-mode.md,
 * docs/project/summaries.md § Simple — a plain-words orientation.
 *
 * Drawn inside the Summary band, below the one row of controls
 * (SummaryMode.tsx § `SummaryControls`), so there is no `ModeSurface` here —
 * this is the body. Two levels, `brief` and `fuller`, one artefact: the panel
 * draws whichever the row has chosen. (A middle level, `simple`, was drawn
 * until 2026-10-03 and written until 2026-10-04; a row from before still
 * carries it and nothing here reads it.)
 *
 * Two things keep it an orientation rather than a replacement for reading,
 * and the file must go on doing both:
 *
 * - **every paragraph is a door** — its ids are drawn with the same `BlockRef`
 *   chips the gists use, hover shows the passage, a click goes there;
 * - **the model's words are drawn as text**, never parsed — model output is
 *   not HTML (security.md). Bold and bullets are two fields beside the text
 *   (`key` and `list`, plan 261004b), and the elements for them are made here:
 *   no markdown, no `dangerouslySetInnerHTML`.
 *
 * **What it is lives on the pills, not under the paragraphs.** There was a foot
 * here — *"Written by AI in plain words to help you get your bearings…"* —
 * until Greg, 2026-09-30 (SPIDERYARN-READING2-7B): *"we don't want these mode
 * descriptions - they waste space."* Each pill's card says it now, and
 * docs/project/mode.md has the rule.
 */
import { Fragment, type ReactNode } from "react";
import { MessageSquare, TriangleAlert, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  type BlockId,
  type SimpleLevel,
  type SimpleParagraph,
  type SimpleSentence,
  paragraphShape,
} from "../types.js";
import type { PublicSimpleSummary } from "../public-types.js";
import type { UseSimple } from "./useSimple.js";
import { BlockRef } from "./BlockRef.js";
import { JobProgress } from "./JobProgress.js";
import { ReadError } from "./ReadError.js";
import { RewriteWaiting } from "./RewriteWaiting.js";
import { TipNote, Tooltip, TooltipGroup } from "./Tooltip.js";
import { useRenderCount } from "./perf.js";

/** A visitor on a public article whose owner never asked for one. */
export const SIMPLE_NONE_VISITOR = "Nobody has made a plain-words version of this piece yet.";

/** The ask button's name and its card: one sentence, the same in both. */
export const SIMPLE_ASK_CHAT = "Ask about this paragraph in chat";

/** The owner's empty state, before the press has started anything. */
export const SIMPLE_NONE_OWNER = "Nobody has asked for a plain-words version of this piece yet.";

/**
 * **Who is reading, and the paragraphs they get — one prop.** The owner's arm
 * is the whole `useSimple` read with its job and verbs; the visitor's is the
 * stored paragraphs off the public payload, or `null` for none, and nothing
 * else — no read state, no job, no verb, so a visitor's view has nothing to
 * press that could ask the model. `owner?: never` for `FaqAccess`'s reason.
 */
export type SimpleAccess =
  | { kind: "owner"; owner: UseSimple }
  | { kind: "visitor"; simple: PublicSimpleSummary | null; owner?: never };

export function SimplePanel({
  access,
  level,
  onJump,
  onAskChat,
}: {
  access: SimpleAccess;
  /** Which level to draw. The band's control offers Brief and Fuller; Simple is stored and not offered (plan 261003l). */
  level: SimpleLevel;
  onJump(id: BlockId): void;
  /**
   * **Ask about this paragraph in chat** — handed the paragraph's own `text`.
   * `Reader` owns both the mode and the handoff into a fresh conversation
   * (`askAboutSummaryParagraph` in chat-handoff.ts). Absent, no button is
   * drawn; and a visitor gets none whatever is passed, because a visitor has
   * no chat. docs/plans/261004a-ask-about-a-summary-paragraph-in-chat.md.
   */
  onAskChat?: ((paragraphText: string) => void) | undefined;
}) {
  useRenderCount("SimplePanel");
  const owner = access.kind === "owner" ? access.owner : null;
  /* The owner's alone: the visitor's arm must have nothing to press. */
  const askChat = access.kind === "owner" ? onAskChat : undefined;
  const paragraphs =
    access.kind === "owner" ? access.owner.simple?.levels[level] : access.simple?.levels[level];
  /* A visitor's paragraphs arrived with the page, so they are ready by construction. */
  const ready = paragraphs !== undefined && (owner === null || owner.status === "ready");
  /* The button beside paragraphs already there: while a job runs or after one
     failed, and — since the paragraphs are written for the reader — once the
     reader has changed their profile, so *Write it again* picks up the new one
     (the quiz's rule; the badge in the row says why, in its card). */
  const showJob =
    owner !== null &&
    ready &&
    !owner.stale &&
    (owner.job || owner.starting || owner.failed || owner.profileChanged || owner.rewriting);
  /* A rewrite has finished and its paragraphs are not here yet: the forced
     button gives way to a read, never to a second paid run. rewrite-hold.ts. */
  const waiting = owner !== null && owner.rewriting && !owner.job && !owner.starting && !owner.failed;

  /**
   * @param again whether this is the button beside paragraphs already there.
   *   The empty state's button must be `ensure` — the identical, unforced
   *   request the automatic run makes — or it buys a second model call.
   */
  const run = (label: string, again = false) =>
    owner === null ? null : again && waiting && !owner.error ? (
      <RewriteWaiting line="The new summary hasn't loaded yet." onRead={owner.refresh} className="tw:m-0" />
    ) : (
      <JobProgress
        job={owner.job}
        starting={owner.starting}
        failed={owner.failed}
        stalled={owner.stalled}
        onRun={() => (again ? owner.regenerate() : owner.ensure())}
        /* With `error` set the retry is `ReadError`'s, above; the button stays held. */
        runDisabled={again && owner.rewriting}
        onCancel={owner.cancel}
        label={label}
        step="simple"
        icon={<Sprout size={13} />}
        runningLabel="Writing it in plain words…"
      />
    );

  return (
    <div className="summ-scroll simple-scroll">
      {owner?.error && <ReadError error={owner.error} onRetry={owner.retryRead} />}
      {owner?.status === "loading" && <p className="summ-quiet">Looking for the plain-words version…</p>}
      {owner?.status === "none" && (
        <div className="gloss-empty">
          {/* Not while a run is under way: opening Summary starts one since
              2026-10-02 (docs/plans/261002a-summary-generates-on-open.md), and
              "nobody has asked" beside its progress reads as a contradiction. */}
          {!(owner.job || owner.starting) && <p>{SIMPLE_NONE_OWNER}</p>}
          <p className="gloss-hint">
            Brief and Fuller are written together, usually in about half a minute. Written once and kept —
            you will not be asked again unless the article changes.
          </p>
          {run("Write it")}
        </div>
      )}
      {access.kind === "visitor" && access.simple === null && <p className="summ-quiet">{SIMPLE_NONE_VISITOR}</p>}
      {ready && (
        <>
          {/* Stale: the article moved, so a door may open on the wrong room.
              Outdated (an older prompt, same article) is deliberately silent —
              Greg, 2026-09-29, SPIDERYARN-READING2-55. */}
          {owner?.stale ? (
            <div className="gloss-stale">
              <p>
                <TriangleAlert size={13} />
                This describes an older version of the article.
              </p>
              {run("Write it again", true)}
            </div>
          ) : null}
          <TooltipGroup delay={{ open: 350, close: 120 }} timeoutMs={500}>
            <div className="simple-paras">
              {/* Keyed on the words: the list is replaced whole on a re-run and
                  never reordered, and two identical paragraphs would be a
                  write-time bug rather than a state to draw. */}
              {paragraphs.map((p) => (
                <Paragraph key={p.text} paragraph={p} onJump={onJump} onAskChat={askChat} />
              ))}
            </div>
          </TooltipGroup>
          {showJob && <div className="simple-job">{run("Write it again", true)}</div>}
        </>
      )}
    </div>
  );
}

/**
 * One paragraph, as text, and then its doors.
 *
 * **A sentence that names its passage is a block link** (plan 261002e, Greg's
 * SPIDERYARN-READING2-8V): `BlockRef` with the sentence as its words, so it gets
 * the one shared card, a press that jumps, and the band's on-screen wash
 * (on-screen.ts § `onScreenLinkCss`) with nothing of its own. `.simple-sentence`
 * makes it read as prose rather than as an id chip. A sentence that names none
 * is plain text. Only `paragraphShape` decides what there is to draw — the same
 * question a visitor's payload was built with — and a paragraph without usable
 * sentences draws exactly as before.
 *
 * **A list is the same sentences, laid out** (plan 261004b, Greg's spya-qzsvx4):
 * the first is the lead-in and each later one a bullet, so a bullet is still
 * one sentence and still the link above. The `<ul>` wears `.simple-text` as
 * well, which is what puts it in the model's face and under the sentence rules.
 *
 * **And, for the owner, a way to ask about it** (plan 261004a, Greg's
 * spya-r9nbkt): a small button at the end of the doors row. It hands over the
 * paragraph's `text` — the whole of it, however it was drawn, and without the
 * bold or the bullets, which are not in `text`. The Thread's per-post Copy is
 * the model for its shape (Tweets.tsx § `CopyButton`); the icon is the prose
 * gutter's chat button's.
 */
function Paragraph({
  paragraph,
  onJump,
  onAskChat,
}: {
  paragraph: SimpleParagraph;
  onJump(id: BlockId): void;
  onAskChat: ((paragraphText: string) => void) | undefined;
}) {
  const shape = paragraphShape(paragraph);
  /* A rewrite can keep the paragraph but change a sentence's passage or
     wording. Remount that link so the shared card dismisses its old anchor;
     position distinguishes repeated sentences. */
  const keyOf = (s: SimpleSentence, i: number) => JSON.stringify([i, s.id, s.text, s.key]);
  const body = (): ReactNode => {
    switch (shape.kind) {
      case "text":
        return <p className="simple-text">{paragraph.text}</p>;
      case "prose":
        return (
          <p className="simple-text">
            {shape.sentences.map((s, i) => (
              <Fragment key={keyOf(s, i)}>
                {i > 0 && " "}
                <Sentence sentence={s} onJump={onJump} />
              </Fragment>
            ))}
          </p>
        );
      case "list":
        return (
          <>
            <p className="simple-text">
              <Sentence key={keyOf(shape.lead, 0)} sentence={shape.lead} onJump={onJump} />
            </p>
            <ul className="simple-list simple-text">
              {shape.items.map((s, i) => (
                <li key={keyOf(s, i + 1)}>
                  <Sentence sentence={s} onJump={onJump} />
                </li>
              ))}
            </ul>
          </>
        );
      default:
        return shape satisfies never;
    }
  };
  return (
    <div className="simple-para">
      {body()}
      <div className="simple-refs">
        {paragraph.ids.map((id) => (
          <BlockRef key={id} id={id} onJump={onJump} />
        ))}
        {onAskChat && (
          <Tooltip placement="top" content={<TipNote>{SIMPLE_ASK_CHAT}</TipNote>}>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="simple-ask tw:pointer-coarse:size-10"
              aria-label={SIMPLE_ASK_CHAT}
              onClick={() => onAskChat(paragraph.text)}
            >
              <MessageSquare size={12} aria-hidden="true" />
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}

/**
 * One sentence: a block link when it names its passage, plain words when it
 * names none. Its `key`, when it has one, is bold at its first occurrence —
 * inside the link, so a bold phrase is as pressable as the words round it.
 * `usableSentences` has already checked the key is in the text; a key that
 * somehow is not draws no bold rather than anything else.
 */
function Sentence({ sentence, onJump }: { sentence: SimpleSentence; onJump(id: BlockId): void }) {
  const { text, id, key } = sentence;
  const at = key === undefined ? -1 : text.indexOf(key);
  const words =
    key === undefined || at < 0 ? (
      text
    ) : (
      <>
        {text.slice(0, at)}
        <strong>{key}</strong>
        {text.slice(at + key.length)}
      </>
    );
  return id === null ? (
    <span>{words}</span>
  ) : (
    <BlockRef id={id} onJump={onJump} className="simple-sentence">
      {words}
    </BlockRef>
  );
}
