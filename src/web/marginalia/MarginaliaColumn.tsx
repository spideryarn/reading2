/**
 * **Marginalia's column** — the notes right of the prose, and the head
 * pinned at the top of it.
 *
 * The column is not one element. Each block's notes are drawn **inside that
 * block's own cell** (`TableView`'s `margin` prop), absolutely positioned just
 * past its right edge, so they scroll with the page and sit level with their
 * block with no measurement at all. `useMarginLayout` measures only to stop two
 * notes overlapping. The head is `position: fixed` at the top of the column.
 *
 * Nothing here knows which mode it is in, so the day the column can stand
 * beside a left band (Greg's "ideally yes", SPIDERYARN-READING2-7K) it is a
 * layout change and a URL parameter rather than a rewrite.
 * docs/plans/261001d-annotations-mode-marginalia-in-a-right-hand-column.md.
 */
import {
  Component,
  type ErrorInfo,
  Fragment,
  type ReactNode,
  useEffect,
  useId,
  useLayoutEffect,
  useState,
} from "react";
import { ChevronRight, X } from "lucide-react";
import { TOAST_MS, useGoesByItself } from "../Toast.js";
import type { CitedWork, Faq, Ideas, TimelineEvent } from "../../types.js";
import { useDebateRead } from "../useDebate.js";
import { useStepFinished } from "../useStepJob.js";
import { useFaqRead } from "../useFaq.js";
import { byLineOf } from "../CitationsPanel.js";
import { rowWork } from "../DebatePanel.js";
import { nameOfThrown, recordLog } from "../log-buffer.js";
import { captureClientFailure } from "../monitoring.js";
import { useRenderCount } from "../perf.js";
import { ControlTip, Tooltip } from "../Tooltip.js";
import { useIdeasRead } from "../useIdeas.js";
import { useTimelineRead } from "../useTimeline.js";
import { datingWords } from "../TimelinePanel.js";
import {
  DRAWN_RELATIONS,
  type DrawnRelation,
  type HeadStep,
  type MarginClaim,
  type MarginEntry,
  type MarginaliaNote,
  layoutNotes,
} from "./notes.js";
import { type RelationsByBlock, useRelations } from "../useRelations.js";
import { MARK_KIND_LABEL } from "../comment-nav.js";
import { ARC_ORIGIN, IDEA_ORIGIN, MARG_TIPS, type MargTipKey, PATH_ORIGIN, RELATION_TIPS } from "./tips.js";
import { type Voice, voiceClass, withVoice } from "../voice.js";
import { ownLabel, plainWords } from "../lib/own-label.js";

/** The gap the collision pass keeps between two notes, in px. */
export const NOTE_GAP_PX = 8;

/* An idea's provenance and a Debate row's relation (`RELATION_WORD`, below)
   come off the wire, so these tables are read through `ownLabel`
   (lib/own-label.ts). A value from a newer server is stamped as its own word,
   and the sentence explaining it is left out of the card: this copy cannot
   say what it means. A bare lookup of `__proto__` threw, and the slot's
   boundary then dropped every note beside that block. */
const PROVENANCE_WORD = { assumed: "assumes", introduced: "introduces" } as const;
const PROVENANCE_TIP = {
  assumed: "The piece takes this for granted rather than arguing for it.",
  introduced: "The piece puts this forward and argues for it.",
} as const;

/**
 * **One block's notes, inside a boundary of their own.** The notes are drawn in
 * the table's cells, outside the mode's boundary around its head, so a throw in
 * one would otherwise take the whole article with it. This one draws nothing
 * instead and reports once: the reader loses a note, not the prose. GPT Sol,
 * F3 on the plan.
 */
export function MarginNotesSlot({
  notes,
  viewer,
  onOpenAsked,
}: {
  notes: readonly MarginaliaNote[];
  /** Whose comments these are, for their card: the reader's own, or the owner's to a visitor. */
  viewer: "owner" | "visitor";
  /** Open a question's conversation — the Comments drawer's own press. Owner only. */
  onOpenAsked?: ((id: string) => void) | undefined;
}) {
  return (
    <NoteBoundary>
      <MarginNotes notes={notes} viewer={viewer} onOpenAsked={onOpenAsked} />
    </NoteBoundary>
  );
}

class NoteBoundary extends Component<{ children: ReactNode }, { broken: boolean }> {
  override state = { broken: false };

  static getDerivedStateFromError(): { broken: boolean } {
    return { broken: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    /* As FeatureBoundary: no component stack and no message leave the
       machine — the feature's name, and the error's own name for the ring
       buffer. */
    void info;
    captureClientFailure(error, { boundary: "feature", feature: "Marginalia" });
    recordLog({ kind: "client-error", source: "boundary", name: nameOfThrown(error) });
  }

  override render(): ReactNode {
    return this.state.broken ? null : this.props.children;
  }
}

/**
 * **What a question note is, on hover** — its rule is a bare line beside some
 * blocks and nothing else said so. Greg, 2026-10-01 (SPIDERYARN-READING2-84):
 * *"What are they for? They should ideally have tooltips to explain
 * themselves."* The house card since 261002g (tips.ts). **A button with a card
 * of its own**, like the idea stamp, rather than the delegated card the shut
 * lines use: a question has nothing to press, so the card is the only thing a
 * keyboard or a finger could reach, and the delegated card answers neither
 * (GPT Sol, plan review). One per part, so the instance each costs is a few.
 * Depth 0 is the article's own question (notes.ts).
 */
function QuestionNote({ depth, text }: { depth: number; text: string }) {
  const [open, setOpen] = useState(false);
  const tip = MARG_TIPS[depth === 0 ? "question-article" : "question-part"];
  return (
    <Tooltip
      placement="bottom"
      keepSide
      open={open}
      onOpenChange={setOpen}
      content={<ControlTip head={tip.head} what={tip.what} how={tip.how} />}
    >
      <button
        type="button"
        className="marg-question"
        data-depth={depth}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {text}
      </button>
    </Tooltip>
  );
}

/**
 * **How this paragraph bears on the one before it** — *so*, *but*, *vs*
 * (plan 261003f). A word, never a symbol: a symbol that needs a tooltip has
 * already failed (docs/research/260828c-decorated-mode-ideas.md). **A button
 * with a card of its own**, as the question is and for its reason: there is
 * nothing to press, so the card is the only thing a keyboard or a finger
 * could reach. Ours to draw (small caps), but the judgement is the model's,
 * so it is in the AI's face (fonts.md).
 */
function RelationWord({ relation }: { relation: DrawnRelation }) {
  const [open, setOpen] = useState(false);
  const tip = RELATION_TIPS[relation];
  return (
    <Tooltip
      placement="bottom"
      keepSide
      open={open}
      onOpenChange={setOpen}
      content={<ControlTip head={tip.head} what={tip.what} how={tip.how} />}
    >
      <button
        type="button"
        className={withVoice("marg-relation", "ai")}
        data-relation={relation}
        aria-expanded={open}
        aria-label={`${tip.head}: ${tip.what}`}
        onClick={() => setOpen((was) => !was)}
      >
        {DRAWN_RELATIONS[relation]}
      </button>
    </Tooltip>
  );
}

/** One block's notes. `user-select: none` in marginalia.css, so a copy of the
    prose never carries them. */
function MarginNotes({
  notes,
  viewer,
  onOpenAsked,
}: {
  notes: readonly MarginaliaNote[];
  viewer: "owner" | "visitor";
  onOpenAsked?: ((id: string) => void) | undefined;
}) {
  useRenderCount("MarginNotes");
  return (
    <div className="marg-note" data-marg-note="">
      {notes.map((note) => {
        switch (note.kind) {
          case "relation":
            return <RelationWord key="relation" relation={note.relation} />;
          case "question":
            return <QuestionNote key={`q${note.depth}`} depth={note.depth} text={note.text} />;
          case "idea":
            return <IdeaStamp key={`i${note.ideaId}`} note={note} />;
          case "faq":
            return <FaqNote key="faq" items={note.items} />;
          case "timeline":
            return <TimelineNote key="timeline" items={note.items} />;
          case "debate":
            return <DebateNote key="debate" items={note.items} />;
          case "citation":
            return <CitationNote key="citation" items={note.items} />;
          case "comment":
            return <CommentNote key="comment" items={note.items} viewer={viewer} onOpenAsked={onOpenAsked} />;
          default: {
            const never: never = note;
            return never;
          }
        }
      })}
    </div>
  );
}

/**
 * **One shut line, opened in place** — report 82: *"Rather than showing the
 * full item, maybe show them default-collapsed."* A disclosure rather than a
 * hover card, so it is collapsed in the ordinary sense and its open half can
 * hold a link. The button and the panel are siblings, so nothing interactive
 * sits inside the button (GPT Sol, F5 on the plan); TableView leaves a press on
 * a button or a link alone, so neither selects the row. Opening grows the
 * note, and `useMarginLayout`'s ResizeObserver pushes the notes below down.
 * docs/plans/261002b-marginalia-shows-faq-citations-debate-and-comments-shut-by-default.md.
 */
function ShutNote({
  kind,
  stamp,
  stampVoice,
  tip,
  line,
  lineVoice,
  children,
  lineOnly = false,
}: {
  kind: string;
  stamp: string;
  /** Whose words the stamp is, when it is not ours — a Timeline date in the
      article's own phrase. */
  stampVoice?: Voice | undefined;
  /** What this kind of line is and where it came from, on hover — every mark
      explains itself. A key into tips.ts; the delegated card draws it. */
  tip: MargTipKey;
  line: string;
  /** Whose words `line` is: the one item's, or ours for a count (fonts.md). */
  lineVoice: Voice;
  /** The open half; null when there is nothing more to show than the line. */
  children: ReactNode | null;
  /** **The line is the whole of it, and may be cut**: a press only lets it
      wrap. A button with no panel, so there is no empty box to hide and
      nothing for `aria-controls` or `aria-expanded` to describe. Assistive
      technology already receives the full, unclipped line; this state is
      visual only. A lone comment that is only its words (report spya-a0wpv4,
      plan 261006i). `children` is not read. */
  lineOnly?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const label = (
    <span className="marg-shut-label">
      <span className={stampVoice ? withVoice("marg-stamp", stampVoice) : "marg-stamp"}>{stamp}</span>{" "}
      <span className={withVoice("marg-shut-line", lineVoice)}>{line}</span>
    </span>
  );
  if (lineOnly) {
    return (
      <div className="marg-shut" data-kind={kind} data-open={open ? "" : undefined}>
        <button
          type="button"
          className="marg-shut-button"
          data-marg-tip={tip}
          onClick={() => setOpen((was) => !was)}
        >
          <ChevronRight className="marg-chevron" size={12} aria-hidden="true" />
          {label}
        </button>
      </div>
    );
  }
  if (children === null) {
    return (
      <p className="marg-shut" data-kind={kind} data-marg-tip={tip}>
        {label}
      </p>
    );
  }
  return (
    <div className="marg-shut" data-kind={kind} data-open={open ? "" : undefined}>
      <button
        type="button"
        className="marg-shut-button"
        data-marg-tip={tip}
        aria-expanded={open}
        aria-controls={panel}
        onClick={() => setOpen((was) => !was)}
      >
        <ChevronRight className="marg-chevron" size={12} aria-hidden="true" />
        {label}
      </button>
      <div id={panel} className="marg-open" hidden={!open}>
        {open ? children : null}
      </div>
    </div>
  );
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function FaqNote({ items }: { items: Extract<MarginaliaNote, { kind: "faq" }>["items"] }) {
  const only = items.length === 1 ? items[0] : undefined;
  return (
    <ShutNote
      kind="faq"
      stamp="FAQ"
      tip="faq"
      line={only ? only.question.question : plural(items.length, "question", "questions")}
      lineVoice={only ? "ai" : "ui"}
    >
      {items.map(({ question, quote, morePassages }) => (
        <div key={question.id} className="marg-open-item">
          {!only && <p className={withVoice("marg-open-head", "ai")}>{question.question}</p>}
          {/* Our words, then the article's. */}
          <p className="marg-open-quote">
            Answered here: “<span className="marg-faq-quote">{quote}</span>”
          </p>
          {morePassages > 0 && (
            <p className="marg-open-by">+{plural(morePassages, "more passage", "more passages")}</p>
          )}
        </div>
      ))}
    </ShutNote>
  );
}

/**
 * **When the piece says these things happened** — Timeline's dated events,
 * beside the passage that first mentions them (plan 261003f). The date always
 * carries its year: the band says a shared year once in its head, and the
 * margin has no head to say it in. `words` is the article's own phrase, so
 * the author's face; a computed date is ours, and the label is the model's.
 */
function TimelineNote({ items }: { items: Extract<MarginaliaNote, { kind: "timeline" }>["items"] }) {
  const only = items.length === 1 ? items[0] : undefined;
  const when = (event: TimelineEvent) => {
    const words = datingWords(event.dating, true).text;
    // The margin has no header to explain the assumption.
    return event.dating.kind === "dated" && event.dating.when.yearFrom === "piece"
      ? `${words} (year assumed)` : words;
  };
  /* The tone, not the kind: a year-less date is drawn as the article's own words too. */
  const whenVoice = (event: TimelineEvent): Voice =>
    datingWords(event.dating, true).tone === "words" ? "author" : "ui";
  return (
    <ShutNote
      kind="timeline"
      stamp={only ? when(only.event) : "When"}
      stampVoice={only ? whenVoice(only.event) : undefined}
      tip="timeline"
      line={only ? only.event.label : plural(items.length, "event", "events")}
      lineVoice={only ? "ai" : "ui"}
    >
      {items.map(({ event, quote }) => (
        <div key={event.id} className="marg-open-item">
          {!only && (
            <p className="marg-open-head">
              <span className={withVoice("marg-stamp", whenVoice(event))}>{when(event)}</span>{" "}
              <span className={voiceClass("ai")}>{event.label}</span>
            </p>
          )}
          {/* Our words, then the article's. */}
          <p className="marg-open-quote">
            Mentioned here: “<span className={voiceClass("author")}>{quote}</span>”
          </p>
        </div>
      ))}
    </ShutNote>
  );
}

/** The relation in the reader's words. `unclear` is not a failure, only unsaid. */
const RELATION_WORD: Record<MarginClaim["relation"], string> = {
  disputes: "disputes",
  qualifies: "qualifies",
  extends: "extends",
  corroborates: "agrees",
  unclear: "discusses",
};
const relationWord = (relation: string): string => ownLabel(RELATION_WORD, relation) ?? plainWords(relation);

/** A page's headline is its own, unless the model read one off it (`titleIsAI`,
    as the band's `dbt-title-ai`); a page's own words are third party, so ours. */
const headlineVoice = (row: MarginClaim): Voice => (rowWork(row).titleIsAI ? "ai" : "ui");

function DebateNote({ items }: { items: readonly MarginClaim[] }) {
  const only = items.length === 1 ? items[0] : undefined;
  return (
    <ShutNote
      kind="debate"
      stamp={only ? relationWord(only.relation) : "Debate"}
      tip="debate"
      line={only ? rowWork(only).headline : plural(items.length, "page on the web", "pages on the web")}
      lineVoice={only ? headlineVoice(only) : "ui"}
    >
      {items.map((row) => (
        <div key={row.id} className="marg-open-item">
          <p className="marg-open-head">
            {!only && <span className="marg-stamp">{relationWord(row.relation)}</span>}{" "}
            <a href={row.url} target="_blank" rel="noreferrer noopener" className={voiceClass(headlineVoice(row))}>
              {rowWork(row).headline}
            </a>
          </p>
          <p className="marg-open-quote">“{row.sourceQuote}”</p>
          {row.applies && <p className="marg-debate-applies">{row.applies}</p>}
        </div>
      ))}
    </ShutNote>
  );
}

function CitationNote({ items }: { items: readonly CitedWork[] }) {
  const only = items.length === 1 ? items[0] : undefined;
  return (
    <ShutNote
      kind="citation"
      stamp="Cites"
      tip="citation"
      line={only ? only.title : plural(items.length, "work", "works")}
      lineVoice="ui"
    >
      {items.map((work) => {
        const by = byLineOf(work);
        return (
          /* The article's own words about the work and nothing of ours: the
             by-line and its reference entry, never the model's `why` (Greg,
             spya-zmdb7y, plan 261003j). A lone work with neither repeats its
             title, so the note never opens to nothing. */
          <div key={work.id} className="marg-open-item">
            {(!only || (!by && !work.entry)) && <p className="marg-open-head">{work.title}</p>}
            {by && <p className="marg-open-by">{by}</p>}
            {work.entry && <p className="marg-cite-entry">{work.entry}</p>}
          </div>
        );
      })}
    </ShutNote>
  );
}

/**
 * The reader's comments and the questions they asked here, **each stamped with
 * its kind** — Greg, SPIDERYARN-READING2-9H: a comment that didn't want an AI
 * reply, one that did, or a question. One shut line however many there are; a
 * mixed line counts the two apart. Bare bookmarks never reach here: notes.ts
 * leaves them to the gutter's mark. Plan 261002j.
 */
function CommentNote({
  items,
  viewer,
  onOpenAsked,
}: {
  items: readonly MarginEntry[];
  viewer: "owner" | "visitor";
  onOpenAsked?: ((id: string) => void) | undefined;
}) {
  const only = items.length === 1 ? items[0] : undefined;
  const questions = items.filter((e) => e.as === "question").length;
  const comments = items.length - questions;
  const count = [
    comments > 0 ? plural(comments, "comment", "comments") : null,
    questions > 0 ? plural(questions, "question", "questions") : null,
  ]
    .filter(Boolean)
    .join(" · ");
  /* **A lone comment's words are its line**, and the line un-truncates when
     it opens (marginalia.css), so the open half must not print them again:
     report spya-a0wpv4, the comment's half of the class spya-f6dpj5 named for
     a question. What is left decides the shape. An answer: a panel holding
     it. Only words: no panel, and the press just lets the line wrap. Neither
     (a wordless *Ask AI*): nothing to open, so plain text. Plan 261006i. */
  const lone = only && only.as !== "question" ? only.comment : undefined;
  const loneShape = lone === undefined || lone.answer ? "panel" : lone.body ? "line" : "text";
  return (
    <ShutNote
      kind="comment"
      stamp={only ? MARK_KIND_LABEL[only.as] : "Yours"}
      tip={viewer === "owner" ? "comment-own" : "comment-owner"}
      line={only ? entryLine(only) : count}
      lineVoice={only ? entryVoice(only) : "ui"}
      lineOnly={loneShape === "line"}
    >
      {loneShape === "text" ? null : items.map((e) =>
        e.as === "question" ? (
          <div key={`q:${e.asked.id}`} className="marg-open-item">
            {/* **Only among several**, as a comment's head is: that is how
                they are told apart. A lone question's shut line is this same
                stamp and line, and it un-truncates when it opens
                (marginalia.css), so the head said it twice — report
                spya-f6dpj5, plan 261004k § 7. */}
            {!only && (
              <p className="marg-open-head">
                <span className="marg-stamp">{MARK_KIND_LABEL.question}</span>{" "}
                {e.asked.quote !== undefined ? (
                  <span className={voiceClass("author")}>“{e.asked.quote}”</span>
                ) : (
                  "About this paragraph"
                )}
              </p>
            )}
            {onOpenAsked && (
              <button type="button" className="linky marg-open-asked" onClick={() => onOpenAsked(e.asked.id)}>
                Open the conversation
              </button>
            )}
          </div>
        ) : (
          <div key={e.comment.id} className="marg-open-item">
            {!only && (
              <p className="marg-open-head">
                <span className="marg-stamp">{MARK_KIND_LABEL[e.as]}</span>
              </p>
            )}
            {!only && e.comment.body && <p className="marg-cmt-body">{e.comment.body}</p>}
            {e.comment.answer && <p className="marg-open-answer">{e.comment.answer}</p>}
          </div>
        ),
      )}
    </ShutNote>
  );
}

/** The shut line for one entry: the reader's words, or what it is about. */
function entryLine(e: MarginEntry): string {
  if (e.as === "question") return e.asked.quote ?? "About this paragraph";
  return e.comment.body ?? (e.comment.answer ? "AI answer" : "Asked the AI about this passage");
}

/** Whose words `entryLine` is (fonts.md): a question's passage is the
    article's, a comment's body the reader's, and our stand-ins are ours.
    SPIDERYARN-READING2-9A, plan 261003b. */
function entryVoice(e: MarginEntry): Voice {
  if (e.as === "question") return e.asked.quote !== undefined ? "author" : "ui";
  return e.comment.body ? "reader" : "ui";
}

/**
 * **An idea's stamp: a real button**, so it can be reached by keyboard, opened
 * by a tap where there is nothing to hover with, and pressed without the cell's
 * own click handler selecting the row (TableView excludes buttons). The card
 * is controlled for that reason — Tooltip.tsx § OpenState.
 */
function IdeaStamp({ note }: { note: Extract<MarginaliaNote, { kind: "idea" }> }) {
  const [open, setOpen] = useState(false);
  const provenanceTip = ownLabel(PROVENANCE_TIP, note.provenance);
  return (
    <Tooltip
      placement="bottom"
      keepSide
      open={open}
      onOpenChange={setOpen}
      content={
        <>
          <div className="tip-soon-head marg-idea-tipname">{note.name}</div>
          <p className="marg-idea-statement">{note.statement}</p>
          {provenanceTip !== undefined && <p className="tip-soon-how">{provenanceTip}</p>}
          <p className="tip-soon-how">{IDEA_ORIGIN}</p>
        </>
      }
    >
      <button
        type="button"
        className="marg-idea"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="marg-stamp">
          {ownLabel(PROVENANCE_WORD, note.provenance) ?? plainWords(note.provenance)}
        </span>{" "}
        <span className="marg-idea-name">{note.name}</span>
      </button>
    </Tooltip>
  );
}

/**
 * **The head**: where you are and, when the arc has been written, where the
 * argument has got to. On a window with no room for the column it says so
 * instead, at the foot of the window rather than over the article's opening
 * lines — a mode that silently drew nothing would look broken, and a sentence
 * about why is an empty state, not a description.
 */
export function MarginaliaHead({
  room,
  beside = false,
  path,
  arc,
}: {
  room: boolean;
  /** A band is open on the left. With no room for both, the band wins, and
   *  the line says the other way to get the notes back: close the panel.
   *  docs/plans/261001i-annotations-column-beside-a-band-mode.md. */
  beside?: boolean;
  path: readonly HeadStep[];
  arc: string | null;
}) {
  useRenderCount("MarginaliaHead");
  if (!room) return <NarrowLine beside={beside} />;
  if (path.length === 0 && arc === null) return null;
  /* **Orientation, not a summary**: the arc cut at four (261002g), the whole of it in a
     card on hover, focus or tap. A head that grew to the arc's full six or
     seven lines dominated the margin it is meant to sit quietly at the top of
     (GPT Astra's design pass, 2026-10-01).

     **The path is not forced onto one line**: each title has a line of its own
     and may wrap to two. It was one line with an ellipsis, and in a 200–288px
     column the part's title left the section a word or two — Greg, 7M: *"the
     text is truncated too much"*. The whole title is in the app's hover card,
     not a native `title` that a finger cannot reach. 261001k. */
  return (
    <aside className="marg-head" aria-label="Where you are">
      {path.length > 0 && (
        <p className="marg-path">
          {path.map(({ title, voice }, depth) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the path is a fixed ancestry, part then section; position is its identity.
            <Fragment key={depth}>
              {/* Outside the line-clamped box: it remains one spoken path even
                  when the visible title is cut after its second line. */}
              {depth > 0 && <span className="sr-only"> › </span>}
              <PathStep title={title} voice={voice} depth={depth} />
            </Fragment>
          ))}
        </p>
      )}
      {arc !== null && <ArcLine arc={arc} />}
    </aside>
  );
}

/**
 * **The line that says there is no room for the notes.** It goes by itself
 * after a few seconds, or at once on its ×, because it sits over the foot of
 * the article — Greg, spya-u264yb: *"there's no way to dismiss it, and it
 * doesn't fade after a few seconds."*
 *
 * **Nothing is remembered.** "Gone" is this component's own state, so the line
 * shows again each time it is mounted afresh: Marginalia switched off and on,
 * the room found and lost again, or a covering band closed in a window still
 * too narrow for the notes alone. That keeps its job — a mode that silently
 * drew nothing would look broken.
 *
 * **Gone is a class, not an unmount**, for two reasons. The stylesheet hides
 * the small-screen banner while this element exists
 * (styles/narrow-window.css § `:has(.mode-band, .marg-narrow)`), and removing
 * it would drop that banner into the top of the article mid-read. And the
 * sentence is only made invisible, not hidden, when the clock runs out, so a
 * screen reader still finds why there are no notes, as it did before this
 * could fade. An explicit Dismiss does hide it from the accessibility tree:
 * that control must do what its name says.
 * docs/plans/261006i-marginalia-narrow-notice-fades-and-can-be-dismissed.md
 */
function NarrowLine({ beside }: { beside: boolean }) {
  const [gone, setGone] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const reading = useGoesByItself(TOAST_MS, () => setGone(true));
  return (
    <aside
      className={`marg-narrow${gone ? " is-gone" : ""}`}
      aria-label="Marginalia"
      aria-hidden={dismissed || undefined}
      {...reading}
    >
      <p>
        {beside
          ? "The notes need a wider window — press Marginalia again to swap them in for the panel."
          : "The notes need a wider window — they sit to the right of the text."}
      </p>
      <button
        type="button"
        className="marg-narrow-close close-x"
        aria-label="Dismiss"
        onClick={(event) => {
          /* Do not leave focus inside the subtree we are about to hide from
             assistive technology. The visual close already loses focus when
             visibility:hidden applies. */
          event.currentTarget.blur();
          setDismissed(true);
          setGone(true);
        }}
      >
        <X aria-hidden="true" />
      </button>
    </aside>
  );
}

/** A clamped title whose complete text is reachable by hover, focus and tap. */
/** One title, in its voice — the author's heading kept, or the model's (fonts.md) — here and in its card. */
function PathStep({ title, voice, depth }: { title: string; voice: Voice; depth: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      placement="bottom"
      keepSide
      open={open}
      onOpenChange={setOpen}
      content={
        <>
          <p className={voiceClass(voice)}>{title}</p>
          <p className="tip-soon-how">{PATH_ORIGIN[voice]}</p>
        </>
      }
    >
      <button
        type="button"
        className={withVoice("marg-path-step", voice)}
        data-depth={depth}
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {title}
      </button>
    </Tooltip>
  );
}

function ArcLine({ arc }: { arc: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      placement="bottom"
      keepSide
      open={open}
      onOpenChange={setOpen}
      content={
        <>
          <p className="marg-arc-full">{arc}</p>
          <p className="tip-soon-how">{ARC_ORIGIN}</p>
        </>
      }
    >
      <button
        type="button"
        className="marg-arc"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        {arc}
      </button>
    </Tooltip>
  );
}

/** What the owner's feed hands the Reader: each list, or null for none. */
export type MarginFeed = {
  ideas: Ideas["ideas"] | null;
  faq: Faq["questions"] | null;
  timeline: readonly TimelineEvent[] | null;
  claims: readonly MarginClaim[] | null;
  relations: RelationsByBlock;
};

export const NO_OWNER_FEED: MarginFeed = { ideas: null, faq: null, timeline: null, claims: null, relations: null };

/**
 * **The owner's ideas, FAQ, Timeline and Debate, read and never made** — and
 * the relation words, which are made here. A component of
 * its own so the reads happen only while Marginalia is open — the read halves
 * (`useIdeasRead`, `useFaqRead`, `useTimelineRead`, `useDebateRead`), never the full hooks, which
 * arm the automatic run and could spend (Debate is the dearest step in the
 * app). A stale list (the article moved under it) is not drawn: its blocks may
 * not be these. Owner only: a visitor's lists are in their payload. Citations
 * and comments are not read here — the Reader holds both in every mode.
 */
export function OwnerMarginFeed({
  slug,
  shown,
  awaitingStructure = false,
  onFeed,
}: {
  slug: string;
  /** The column is on screen: switched on *and* the window has room for the notes. */
  shown: boolean;
  /**
   * The article is still showing the outline it opened with. The relations
   * step comes after `structure`, so the server would refuse it; the column
   * waits and asks when the real tree is in, as the arc does (useArc.ts).
   * docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md.
   */
  awaitingStructure?: boolean;
  onFeed(feed: MarginFeed): void;
}) {
  const ideasRead = useIdeasRead(slug);
  const faqRead = useFaqRead(slug);
  const timelineRead = useTimelineRead(slug);
  const debateRead = useDebateRead(slug);
  /* **The one thing here that can spend**: the relation words are Marginalia's
     own, and this mount is what asks for them where none is stored — once per
     article per page load, whatever opened the column, and only while the
     notes are on screen (useRelations.ts). */
  const relations = useRelations(slug, shown && !awaitingStructure);
  /* **A list made while the margin is open reaches it** — FAQ run in the left
     band appears here without reopening the margin. The band refreshes its own
     read when its job finishes; this hears the same completion for the margin's
     reads, quietly, so mounting still costs nothing. Plan 261002d. */
  useStepFinished(slug, "ideas", ideasRead.refresh);
  useStepFinished(slug, "faq", faqRead.refresh);
  useStepFinished(slug, "timeline", timelineRead.refresh);
  useStepFinished(slug, "debate", debateRead.refresh);
  const ideas = ideasRead.status === "ready" && !ideasRead.stale ? (ideasRead.ideas?.ideas ?? null) : null;
  const faq = faqRead.status === "ready" && !faqRead.stale ? (faqRead.faq?.questions ?? null) : null;
  const timeline =
    timelineRead.status === "ready" && !timelineRead.stale ? (timelineRead.timeline?.events ?? null) : null;
  const claims =
    debateRead.status === "ready" && !debateRead.stale ? (debateRead.debate?.claims.rows ?? null) : null;
  useEffect(() => {
    onFeed({ ideas, faq, timeline, claims, relations });
  }, [ideas, faq, timeline, claims, relations, onFeed]);
  useEffect(() => () => onFeed(NO_OWNER_FEED), [onFeed]);
  return null;
}

/**
 * **Keep the notes from overlapping.** Reads every note's wanted top and
 * height, then writes a `translate` to those that have to move — all reads,
 * then all writes.
 *
 * **Idempotent by construction**: the wanted top is the note's *row*, which no
 * translate moves, and the translate written is absolute rather than added to
 * the last one. Running it twice over the same page writes the same values.
 *
 * Re-runs, through one animation frame, when the table changes size (zoom,
 * images, maths), when any note changes size (fonts arriving, a longer
 * question), once the fonts are ready, and whenever `key` changes (the notes
 * themselves). Notes are absolutely positioned and translate is not layout, so
 * nothing written here can resize what is observed and loop it.
 */
export function useMarginLayout(active: boolean, key: unknown): void {
  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is a re-run trigger — the effect reads the notes only through the DOM it just rendered.
  useLayoutEffect(() => {
    if (!active) return;
    const table = document.querySelector<HTMLElement>("table.zoom");
    if (!table) return;
    const notes = [...table.querySelectorAll<HTMLElement>("[data-marg-note]")];
    let frame = 0;
    const run = () => {
      frame = 0;
      const desired: number[] = [];
      const heights: number[] = [];
      for (const note of notes) {
        const row = note.closest("tr");
        desired.push(row ? row.getBoundingClientRect().top : 0);
        heights.push(note.offsetHeight);
      }
      const tops = layoutNotes(desired, heights, NOTE_GAP_PX);
      for (const [i, note] of notes.entries()) {
        const shift = Math.round((tops[i] ?? 0) - (desired[i] ?? 0));
        const value = shift > 0 ? `0 ${shift}px` : "";
        if (note.style.translate !== value) note.style.translate = value;
      }
    };
    const schedule = () => {
      if (frame === 0) frame = requestAnimationFrame(run);
    };
    run();
    const observer = new ResizeObserver(schedule);
    observer.observe(table);
    for (const note of notes) observer.observe(note);
    let live = true;
    void document.fonts?.ready.then(() => {
      if (live) schedule();
    });
    return () => {
      live = false;
      observer.disconnect();
      if (frame !== 0) cancelAnimationFrame(frame);
    };
  }, [active, key]);
}
