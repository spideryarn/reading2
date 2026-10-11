/**
 * **Referee › Notes**: the reviewer's own notes, sorted major or minor by
 * them, and copied out as the bones of a report in their words only.
 *
 * What may go out, and why it is only the reviewer's words, is
 * src/web/referee-notes.ts; this file draws it. No model is called anywhere
 * here and nothing is suggested: a note is *not sorted yet* until the reviewer
 * presses Major or Minor on it.
 *
 * docs/plans/261011f-referee-outline-your-notes-sorted-major-and-minor.md;
 * docs/project/referee-mode.md § 4. Notes.
 */
import { Check, Copy, TriangleAlert } from "lucide-react";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

import type { Block, BlockId, Comment, Severity } from "../types.js";
import { Button } from "@/components/ui/button";
import { BandWaiting } from "./BandWaiting.js";
import { Excerpt } from "./Excerpt.js";
import { notesOf, notesText, type NoteItem, type RefereeNotes } from "./referee-notes.js";
import { useCopy } from "./useCopy.js";

/**
 * The comment list's state, as the panel needs it — so an empty Notes panel is
 * never drawn over a list that has not arrived, or failed to.
 */
export type NotesComments =
  | { readonly state: "loading" }
  | { readonly state: "failed" }
  | {
      readonly state: "ready";
      readonly comments: readonly Comment[];
      /** Owned by `useComments`, so changing sub-mode cannot forget a write. */
      readonly sorting: ReadonlySet<string>;
    };

const HEADING: Record<"major" | "minor" | "unsorted", string> = {
  major: "Major",
  minor: "Minor",
  unsorted: "Not sorted yet",
};

const COPIED_MS = 1600;

export function RefereeNotesView({
  comments,
  blocks,
  onSort,
  onJump,
}: {
  comments: NotesComments;
  blocks: readonly Block[];
  /** `useComments.sort`: settles once the server has answered, either way. */
  onSort(id: string, severity: Severity | null): Promise<void>;
  onJump(blockId: BlockId): void;
}) {
  if (comments.state === "loading") {
    return <BandWaiting className="ref-notes-note">Loading your notes…</BandWaiting>;
  }
  if (comments.state === "failed") {
    return (
      <p className="ref-notes-note gloss-error">
        Your notes could not be loaded, so there is nothing to sort. Reloading the page tries again.
      </p>
    );
  }
  return (
    <Loaded
      comments={comments.comments}
      sorting={comments.sorting}
      blocks={blocks}
      onSort={onSort}
      onJump={onJump}
    />
  );
}

function Loaded({
  comments,
  sorting,
  blocks,
  onSort,
  onJump,
}: {
  comments: readonly Comment[];
  sorting: ReadonlySet<string>;
  blocks: readonly Block[];
  onSort(id: string, severity: Severity | null): Promise<void>;
  onJump(blockId: BlockId): void;
}) {
  const notes = useMemo(() => notesOf(comments, blocks), [comments, blocks]);
  const listed = notes.major.length + notes.minor.length + notes.unsorted.length;
  const root = useRef<HTMLDivElement>(null);
  const [restoreFocus, setRestoreFocus] = useState<{ id: string; severity: Severity } | null>(null);
  const sort = useCallback(
    (id: string, severity: Severity | null, pressed: Severity) => {
      setRestoreFocus({ id, severity: pressed });
      /* `useComments.sort` catches ordinary request failures. The catch is a
         backstop for an unexpected rejected implementation at this seam: a
         button press must not become an unhandled rejection. */
      void onSort(id, severity).catch(() => {});
    },
    [onSort],
  );
  useEffect(() => {
    if (!restoreFocus || sorting.has(restoreFocus.id)) return;
    /* Moving a note changes its section parent, so React replaces the row and
       the pressed button loses focus. Restore it only when focus fell to the
       document; never steal it after the reader deliberately moved elsewhere. */
    if (document.activeElement === document.body) {
      const buttons = root.current?.querySelectorAll<HTMLButtonElement>("[data-note-id][data-sort]");
      [...(buttons ?? [])]
        .find(
          (button) =>
            button.dataset.noteId === restoreFocus.id &&
            button.dataset.sort === restoreFocus.severity,
        )
        ?.focus();
      setRestoreFocus(null);
      return;
    }
    /* The original button is still here: either the PATCH is about to mark
       itself pending, or it failed without moving the row. Keep the request
       through the former; a later deliberate focus move clears it below. */
    if (
      document.activeElement instanceof HTMLButtonElement &&
      document.activeElement.dataset.noteId === restoreFocus.id &&
      document.activeElement.dataset.sort === restoreFocus.severity
    ) {
      return;
    }
    setRestoreFocus(null);
  }, [restoreFocus, sorting]);

  if (listed === 0) {
    return (
      <div ref={root} className="ref-notes">
        <p className="ref-notes-note">
          No notes with words yet. Select a passage, write what you think of it, and it will be
          here to sort.
        </p>
        <Wordless count={notes.wordless} />
      </div>
    );
  }

  return (
    <div ref={root} className="ref-notes">
      <CopyNotes notes={notes} saving={sorting.size > 0} />
      {/* Not sorted yet first on screen, because that is the work still to do;
          last on the clipboard, after the report's own two headings. */}
      {(["unsorted", "major", "minor"] as const).map((group) =>
        notes[group].length === 0 ? null : (
          <section key={group} className="ref-notes-group" aria-label={HEADING[group]}>
            <h3 className="ref-notes-heading">
              {HEADING[group]} <span className="ref-notes-count">({notes[group].length})</span>
            </h3>
            <ol className="ref-notes-list">
              {notes[group].map((item) => (
                <Row key={item.id} item={item} saving={sorting.has(item.id)} onSort={sort} onJump={onJump} />
              ))}
            </ol>
          </section>
        ),
      )}
      <Wordless count={notes.wordless} />
    </div>
  );
}

function Wordless({ count }: { count: number }) {
  if (count === 0) return null;
  return (
    <p className="ref-notes-note">
      {count === 1
        ? "1 mark without a note of yours is left out."
        : `${count} marks without a note of yours are left out.`}
    </p>
  );
}

function Row({
  item,
  saving,
  onSort,
  onJump,
}: {
  item: NoteItem;
  saving: boolean;
  onSort(id: string, severity: Severity | null, pressed: Severity): void;
  onJump(blockId: BlockId): void;
}) {
  const wordsId = useId();
  /* Pressing the lit one again takes the sort away: there is no third button
     for "neither", and *not sorted yet* is where every note starts. */
  const press = (s: Severity) => onSort(item.id, item.severity === s ? null : s, s);
  return (
    <li className="ref-notes-row" aria-busy={saving}>
      {/* No jump to a paragraph that has gone: there is nowhere to land, and on
          a narrow window the press would still step the band aside (GPT Sol,
          plan review F8). The words say where it was instead. */}
      {item.passage.kind === "gone" ? (
        <p className="ref-notes-gone">On a paragraph no longer in this version of the article</p>
      ) : (
        <button type="button" className="ref-notes-jump" onClick={() => onJump(item.blockId)}>
          <span className="ref-notes-passage">
            {item.passage.kind === "paragraph" && (
              <span className="ref-notes-prefix">Whole paragraph — </span>
            )}
            <span className="ref-notes-source">
              <Excerpt blockId={item.blockId} words={item.passage.text} />
            </span>
          </span>
        </button>
      )}
      <p id={wordsId} className="ref-notes-words">{item.words}</p>
      {/* biome-ignore lint/a11y/useSemanticElements: two toggle buttons, not a
          form — `OrderGroup`'s reasoning. */}
      <div className="gloss-sort-group ref-notes-sort" role="group" aria-labelledby={wordsId}>
        {(["major", "minor"] as const).map((s) => (
          <button
            key={s}
            type="button"
            className={`gloss-sort-btn${item.severity === s ? " on" : ""}`}
            aria-pressed={item.severity === s}
            data-note-id={item.id}
            data-sort={s}
            onClick={() => press(s)}
          >
            {HEADING[s]}
          </button>
        ))}
      </div>
    </li>
  );
}

/**
 * **Copy notes**, and it says truthfully how the copy went (`useCopy`). The
 * text is built at the press, from the notes on screen, so what is copied is
 * what the reviewer is looking at — and the button waits while a sort is still
 * being saved, so what is on screen is what is stored.
 */
function CopyNotes({ notes, saving }: { notes: RefereeNotes; saving: boolean }) {
  const { state, copy } = useCopy({ copiedMs: COPIED_MS, failedMs: COPIED_MS });
  return (
    <div className="ref-notes-copy">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={saving}
        onClick={() => copy(notesText(notes))}
      >
        {state === "copied" ? (
          <Check aria-hidden="true" />
        ) : state === "failed" ? (
          <TriangleAlert aria-hidden="true" />
        ) : (
          <Copy aria-hidden="true" />
        )}
        Copy notes
      </Button>
      <span
        aria-live="polite"
        aria-atomic="true"
        className={state === "failed" ? "gloss-error" : "ref-notes-said"}
      >
        {saving
          ? "Saving your sort…"
          : state === "copied"
            ? "Copied: Summary, Major, Minor and anything not sorted yet, in your words."
            : state === "failed"
              ? "Your browser would not allow the copy."
              : ""}
      </span>
    </div>
  );
}
