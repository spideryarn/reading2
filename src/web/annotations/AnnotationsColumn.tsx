/**
 * **Annotations mode's column** — the notes right of the prose, and the head
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
import { Component, type ErrorInfo, type ReactNode, useEffect, useLayoutEffect, useState } from "react";
import type { Ideas } from "../../types.js";
import { nameOfThrown, recordLog } from "../log-buffer.js";
import { captureClientFailure } from "../monitoring.js";
import { useRenderCount } from "../perf.js";
import { Tooltip } from "../Tooltip.js";
import { useIdeasRead } from "../useIdeas.js";
import { type AnnotationNote, layoutNotes } from "./notes.js";

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
export function MarginNotesSlot({ notes }: { notes: readonly AnnotationNote[] }) {
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
    captureClientFailure(error, { boundary: "feature", feature: "Annotations" });
    recordLog({ kind: "client-error", source: "boundary", name: nameOfThrown(error) });
  }

  override render(): ReactNode {
    return this.state.broken ? null : this.props.children;
  }
}

/** One block's notes. `user-select: none` in marginalia.css, so a copy of the
    prose never carries them. */
function MarginNotes({ notes }: { notes: readonly AnnotationNote[] }) {
  useRenderCount("MarginNotes");
  return (
    <div className="marg-note" data-marg-note="">
      {notes.map((note) =>
        note.kind === "question" ? (
          <p key={`q${note.depth}`} className="marg-question" data-depth={note.depth}>
            {note.text}
          </p>
        ) : (
          <IdeaStamp key={`i${note.ideaId}`} note={note} />
        ),
      )}
    </div>
  );
}

/**
 * **An idea's stamp: a real button**, so it can be reached by keyboard, opened
 * by a tap where there is nothing to hover with, and pressed without the cell's
 * own click handler selecting the row (TableView excludes buttons). The card
 * is controlled for that reason — Tooltip.tsx § OpenState.
 */
function IdeaStamp({ note }: { note: Extract<AnnotationNote, { kind: "idea" }> }) {
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
export function AnnotationsHead({
  room,
  path,
  arc,
}: {
  room: boolean;
  path: readonly string[];
  arc: string | null;
}) {
  useRenderCount("AnnotationsHead");
  if (!room) {
    return (
      <aside className="marg-narrow" aria-label="Annotations">
        <p>The notes need a wider window — they sit to the right of the text.</p>
      </aside>
    );
  }
  if (path.length === 0 && arc === null) return null;
  /* **Orientation, not a summary**: the path on one line and the arc cut at
     three, the whole of both in a card on hover, focus or tap. A head that
     grew to the arc's full six or seven lines dominated the margin it is meant
     to sit quietly at the top of (GPT Astra's design pass, 2026-10-01). */
  return (
    <aside className="marg-head" aria-label="Where you are">
      {path.length > 0 && <p className="marg-path">{path.join(" › ")}</p>}
      {arc !== null && <ArcLine arc={arc} />}
    </aside>
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

/**
 * **The owner's ideas, read and never made.** A component of its own so the
 * read happens only while Annotations is open — `useIdeasRead`, not `useIdeas`,
 * which would arm the auto-run and could spend. A stale list (the article moved
 * under it) is not drawn: its blocks may not be these. Owner only: a visitor's
 * ideas are in their payload.
 */
export function OwnerIdeasFeed({
  slug,
  onIdeas,
}: {
  slug: string;
  onIdeas(ideas: Ideas["ideas"] | null): void;
}) {
  const read = useIdeasRead(slug);
  const usable = read.status === "ready" && !read.stale ? (read.ideas?.ideas ?? null) : null;
  useEffect(() => {
    onIdeas(usable);
  }, [usable, onIdeas]);
  useEffect(() => () => onIdeas(null), [onIdeas]);
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
