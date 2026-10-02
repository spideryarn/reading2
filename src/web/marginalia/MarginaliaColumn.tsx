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
import { ChevronRight } from "lucide-react";
import type { CitedWork, Faq, Ideas } from "../../types.js";
import { useDebateRead } from "../useDebate.js";
import { useFaqRead } from "../useFaq.js";
import { byLineOf } from "../CitationsPanel.js";
import { rowWork } from "../DebatePanel.js";
import { nameOfThrown, recordLog } from "../log-buffer.js";
import { captureClientFailure } from "../monitoring.js";
import { useRenderCount } from "../perf.js";
import { Tooltip } from "../Tooltip.js";
import { useIdeasRead } from "../useIdeas.js";
import { type MarginClaim, type MarginComment, type MarginaliaNote, layoutNotes } from "./notes.js";

/** The gap the collision pass keeps between two notes, in px. */
export const NOTE_GAP_PX = 8;

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
export function MarginNotesSlot({ notes }: { notes: readonly MarginaliaNote[] }) {
  return (
    <NoteBoundary>
      <MarginNotes notes={notes} />
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
 * themselves."* A native `title`, as the gutter's controls use; nothing on a
 * tap yet. Depth 0 is the article's own question (notes.ts).
 */
const QUESTION_TIP = (depth: number): string =>
  depth === 0
    ? "The question the whole article answers."
    : "The question this part of the article answers. Read on to find the answer.";

/** One block's notes. `user-select: none` in marginalia.css, so a copy of the
    prose never carries them. */
function MarginNotes({ notes }: { notes: readonly MarginaliaNote[] }) {
  useRenderCount("MarginNotes");
  return (
    <div className="marg-note" data-marg-note="">
      {notes.map((note) => {
        switch (note.kind) {
          case "question":
            return (
              <p
                key={`q${note.depth}`}
                className="marg-question"
                data-depth={note.depth}
                title={QUESTION_TIP(note.depth)}
              >
                {note.text}
              </p>
            );
          case "idea":
            return <IdeaStamp key={`i${note.ideaId}`} note={note} />;
          case "faq":
            return <FaqNote key="faq" items={note.items} />;
          case "debate":
            return <DebateNote key="debate" items={note.items} />;
          case "citation":
            return <CitationNote key="citation" items={note.items} />;
          case "comment":
            return <CommentNote key="comment" items={note.items} />;
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
  tip,
  line,
  children,
}: {
  kind: string;
  stamp: string;
  /** What this kind of line is, on hover — every mark explains itself. */
  tip: string;
  line: string;
  /** The open half; null when there is nothing more to show than the line. */
  children: ReactNode | null;
}) {
  const [open, setOpen] = useState(false);
  const panel = useId();
  const label = (
    <span className="marg-shut-label">
      <span className="marg-stamp">{stamp}</span> <span className="marg-shut-line">{line}</span>
    </span>
  );
  if (children === null) {
    return (
      <p className="marg-shut" data-kind={kind} title={tip}>
        {label}
      </p>
    );
  }
  return (
    <div className="marg-shut" data-kind={kind} data-open={open ? "" : undefined}>
      <button
        type="button"
        className="marg-shut-button"
        title={tip}
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
      tip="A question a careful reader might ask, which this passage answers. From FAQ mode."
      line={only ? only.question.question : plural(items.length, "question", "questions")}
    >
      {items.map(({ question, quote, morePassages }) => (
        <div key={question.id} className="marg-open-item">
          {!only && <p className="marg-open-head">{question.question}</p>}
          <p className="marg-open-quote">Answered here: “{quote}”</p>
          {morePassages > 0 && (
            <p className="marg-open-by">+{plural(morePassages, "more passage", "more passages")}</p>
          )}
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

function DebateNote({ items }: { items: readonly MarginClaim[] }) {
  const only = items.length === 1 ? items[0] : undefined;
  return (
    <ShutNote
      kind="debate"
      stamp={only ? RELATION_WORD[only.relation] : "Debate"}
      tip="A page elsewhere on the web that answers a claim made here, and how it bears on it. From Debate mode."
      line={only ? rowWork(only).headline : plural(items.length, "page on the web", "pages on the web")}
    >
      {items.map((row) => (
        <div key={row.id} className="marg-open-item">
          <p className="marg-open-head">
            {!only && <span className="marg-stamp">{RELATION_WORD[row.relation]}</span>}{" "}
            <a href={row.url} target="_blank" rel="noreferrer noopener">
              {rowWork(row).headline}
            </a>
          </p>
          <p className="marg-open-quote">“{row.sourceQuote}”</p>
          {row.applies && <p>{row.applies}</p>}
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
      tip="A work the piece cites here for the first time, and why. From Citations mode."
      line={only ? only.title : plural(items.length, "work", "works")}
    >
      {items.map((work) => {
        const by = byLineOf(work);
        return (
          <div key={work.id} className="marg-open-item">
            {!only && <p className="marg-open-head">{work.title}</p>}
            {by && <p className="marg-open-by">{by}</p>}
            <p>{work.why}</p>
          </div>
        );
      })}
    </ShutNote>
  );
}

/** The reader's comments. Bare bookmarks never reach here: notes.ts leaves
    them to the gutter's mark. */
function CommentNote({ items }: { items: readonly MarginComment[] }) {
  const only = items.length === 1 ? items[0] : undefined;
  return (
    <ShutNote
      kind="comment"
      stamp="Note"
      tip="A comment on this passage. All of them are in the drawer at the foot of the window."
      line={only ? (only.body ?? "AI answer") : plural(items.length, "note", "notes")}
    >
      {items.map((c) => (
        <div key={c.id} className="marg-open-item">
          {c.body && <p>{c.body}</p>}
          {c.answer && <p className="marg-open-answer">{c.answer}</p>}
        </div>
      ))}
    </ShutNote>
  );
}

/**
 * **An idea's stamp: a real button**, so it can be reached by keyboard, opened
 * by a tap where there is nothing to hover with, and pressed without the cell's
 * own click handler selecting the row (TableView excludes buttons). The card
 * is controlled for that reason — Tooltip.tsx § OpenState.
 */
function IdeaStamp({ note }: { note: Extract<MarginaliaNote, { kind: "idea" }> }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      placement="bottom"
      keepSide
      open={open}
      onOpenChange={setOpen}
      content={
        <>
          <div className="tip-soon-head">{note.name}</div>
          <p>{note.statement}</p>
          <p className="tip-soon-how">{PROVENANCE_TIP[note.provenance]}</p>
        </>
      }
    >
      <button
        type="button"
        className="marg-idea"
        aria-expanded={open}
        onClick={() => setOpen((was) => !was)}
      >
        <span className="marg-stamp">{PROVENANCE_WORD[note.provenance]}</span>{" "}
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
  path: readonly string[];
  arc: string | null;
}) {
  useRenderCount("MarginaliaHead");
  if (!room) {
    return (
      <aside className="marg-narrow" aria-label="Marginalia">
        <p>
          {beside
            ? "The notes need a wider window — press Marginalia again to swap them in for the panel."
            : "The notes need a wider window — they sit to the right of the text."}
        </p>
      </aside>
    );
  }
  if (path.length === 0 && arc === null) return null;
  /* **Orientation, not a summary**: the arc cut at three, the whole of it in a
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
          {path.map((title, depth) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the path is a fixed ancestry, part then section; position is its identity.
            <Fragment key={depth}>
              {/* Outside the line-clamped box: it remains one spoken path even
                  when the visible title is cut after its second line. */}
              {depth > 0 && <span className="sr-only"> › </span>}
              <PathStep title={title} depth={depth} />
            </Fragment>
          ))}
        </p>
      )}
      {arc !== null && <ArcLine arc={arc} />}
    </aside>
  );
}

/** A clamped title whose complete text is reachable by hover, focus and tap. */
function PathStep({ title, depth }: { title: string; depth: number }) {
  const [open, setOpen] = useState(false);
  return (
    <Tooltip
      placement="bottom"
      keepSide
      open={open}
      onOpenChange={setOpen}
      content={<p>{title}</p>}
    >
      <button
        type="button"
        className="marg-path-step"
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
      content={<p>{arc}</p>}
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
  claims: readonly MarginClaim[] | null;
};

export const NO_OWNER_FEED: MarginFeed = { ideas: null, faq: null, claims: null };

/**
 * **The owner's ideas, FAQ and Debate, read and never made.** A component of
 * its own so the reads happen only while Marginalia is open — the read halves
 * (`useIdeasRead`, `useFaqRead`, `useDebateRead`), never the full hooks, which
 * arm the automatic run and could spend (Debate is the dearest step in the
 * app). A stale list (the article moved under it) is not drawn: its blocks may
 * not be these. Owner only: a visitor's lists are in their payload. Citations
 * and comments are not read here — the Reader holds both in every mode.
 */
export function OwnerMarginFeed({
  slug,
  onFeed,
}: {
  slug: string;
  onFeed(feed: MarginFeed): void;
}) {
  const ideasRead = useIdeasRead(slug);
  const faqRead = useFaqRead(slug);
  const debateRead = useDebateRead(slug);
  const ideas = ideasRead.status === "ready" && !ideasRead.stale ? (ideasRead.ideas?.ideas ?? null) : null;
  const faq = faqRead.status === "ready" && !faqRead.stale ? (faqRead.faq?.questions ?? null) : null;
  const claims =
    debateRead.status === "ready" && !debateRead.stale ? (debateRead.debate?.claims.rows ?? null) : null;
  useEffect(() => {
    onFeed({ ideas, faq, claims });
  }, [ideas, faq, claims, onFeed]);
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
