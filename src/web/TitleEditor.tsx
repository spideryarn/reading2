/**
 * Renaming an article, wherever the reader is looking at it.
 *
 * Greg, 2026-08-27:
 *
 * > I think we have a button to edit the title of an article in the Home page.
 * > Can we add a similar button to the article page itself, and/or its Metadata.
 *
 * We did, and now there are three: the shelf card and the dense table row
 * (ShelfEntry.tsx, library-columns.tsx), the reading view's masthead
 * (Masthead.tsx), and the metadata page's own heading (Metadata.tsx). Three
 * places is exactly why this file exists rather than a fourth copy of an
 * `<input>` and a `PATCH`: a rename is one act with three edge cases —
 * cancelled, cleared, unchanged — and each copy is a chance to get one of them
 * wrong in a way nobody notices, because all three look identical when the
 * happy path works.
 *
 * `TitleEditor` moved here from ShelfEntry.tsx on 2026-08-27 for that reason,
 * and lost its `entry: LibraryEntry` prop on the way: the reading view has no
 * shelf entry and never fetches one, so the editor now takes the two things it
 * actually reads — the current title, and whether it is the reader's own.
 *
 * See docs/project/library.md § What you can do to a card.
 */
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Pencil, TriangleAlert } from "lucide-react";
import type { LibraryEntry } from "../types.js";
import { IconButton } from "./IconButton.js";
import { apiFetch, readJson } from "./lib/api.js";

/**
 * Rename in place.
 *
 * `onDone(undefined)` means cancelled, `onDone(null)` means "clear it and go
 * back to the extractor's title", and a string means that title. Three
 * outcomes, three values, rather than a boolean and a string that can disagree.
 */
export function TitleEditor({
  title,
  overridden,
  onDone,
  className,
}: {
  /** What the reader is looking at now — the shelf's override if there is one. */
  title: string;
  /**
   * Whether `title` is the reader's own rather than the extractor's.
   *
   * `undefined` means *we do not know*, which is the honest answer in the
   * reading view: the masthead has the article payload and no shelf entry, and
   * a payload deliberately does not carry the superseded title (src/api.ts §
   * `titleFor`). The hint below then says the thing that is true either way
   * rather than naming a title that might be the reader's own.
   */
  overridden?: boolean | undefined;
  onDone: (title: string | null | undefined) => void;
  /** How the input is typeset — each caller sets it in its own face and size. */
  className?: string | undefined;
}) {
  const [value, setValue] = useState(title);
  const ref = useRef<HTMLInputElement>(null);
  /* The hint below is not decoration: it is the only place that says an empty
     field restores the extracted title, and an unlabelled line under an input
     is read by a screen reader either much later or not at all. GPT Sol,
     2026-08-27. */
  const hintId = useId();

  // Focus and select, so the common case — replacing the site's title wholesale
  // — is one keystroke rather than a drag.
  useEffect(() => ref.current?.select(), []);

  return (
    <form
      // Above the stretched link, or every click in the input would follow it.
      className="tw:relative tw:min-w-0 tw:flex-1"
      onSubmit={(e) => {
        e.preventDefault();
        const next = value.trim();
        // Unchanged is a cancel, not a write. Otherwise pressing Enter on an
        // untouched field would mark the extractor's own title as "renamed by
        // you", which is a lie the tooltip would then repeat.
        if (next === title) return onDone(undefined);
        onDone(next === "" ? null : next);
      }}
    >
      <input
        ref={ref}
        value={value}
        aria-label="Title"
        /* Enter submits the form above, which saves the rename. The hint below
           says so in words for a reader with a keyboard; this says it on the
           key for a reader with a thumb. */
        enterKeyHint="done"
        aria-describedby={hintId}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone(undefined);
        }}
        // Blur commits rather than cancels: clicking away from a field you have
        // typed into and losing the typing is the more annoying of the two.
        onBlur={(e) => e.currentTarget.form?.requestSubmit()}
        className={`tw:w-full tw:rounded tw:border tw:border-highlight tw:bg-background tw:px-2 tw:py-1 tw:text-foreground tw:outline-none ${
          className ?? "tw:font-prose tw:text-xl tw:leading-snug"
        }`}
      />
      <span id={hintId} className="tw:mt-1 tw:block tw:font-sans tw:text-xs tw:text-muted-foreground">
        Enter to save · Escape to cancel ·{" "}
        {/* Named only when it IS the extractor's title. Once the reader has
            renamed the article, `title` is their own — so naming it here
            offered to "restore" the very title they were looking at, which is
            not what clearing the field does. Nothing here carries the
            superseded title (`LibraryEntry` ships a `titleOverridden` flag
            rather than both strings, so nothing puts a string on the wire that
            nothing renders), and saying less is better than saying something
            false. Found in a browser pass, 2026-08-26. `undefined` — the
            reading view, which has no way to know — takes the same branch, for
            the same reason: it is true in both cases. */}
        {overridden === false ? (
          <>empty to restore “{title}”</>
        ) : (
          <>empty to restore the extracted title</>
        )}
      </span>
    </form>
  );
}

/* --------------------------------------------------------------- hook ----- */

export interface ArticleRename {
  /** Whether the editor is open. */
  editing: boolean;
  /** Open it. */
  begin: () => void;
  /** What to hand `TitleEditor`'s `onDone`. */
  done: (title: string | null | undefined) => void;
  /** Whether the title on screen is the reader's own, once we have been told. */
  overridden: boolean | undefined;
  /** The last write that failed, for the caller to render beside the heading. */
  error: string | null;
}

/**
 * The rename, for the two pages that have one article rather than a shelf.
 *
 * The shelf does not use this: it renames through `useShelf`, which has to put
 * the returned entry back into the list it is holding, and that is a different
 * job from this one. What is shared between them is the editor above and the
 * shape of the request — `PATCH /api/library/:slug { title }`, the same route,
 * with the same three outcomes.
 *
 * **The new title comes back from the server, not from the input.** Sending
 * `null` clears the override, and what the reader should then see is whatever
 * the extractor last found — a string this page does not have. So `onRenamed`
 * is called with `entry.title`, which is the store's answer to "what is this
 * article called now" (src/api.ts § `titleFor`). Echoing the typed value would
 * be right for a rename and blank for a clear.
 *
 * **A failed write leaves the heading alone and says so.** No optimistic
 * update: a heading that changes and then silently is not saved is the version
 * of this that costs somebody their title.
 */
export function useArticleRename(
  slug: string,
  onRenamed: (slug: string, title: string) => void,
): ArticleRename {
  const [editing, setEditing] = useState(false);
  /* Starts unknown and stays unknown until a write answers it — see
     `overridden` on the editor above for why that is a state rather than a
     gap. After a rename the response says which it is, so the hint is exact
     from then on. */
  const [overridden, setOverridden] = useState<boolean | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  /**
   * Which write is the current one.
   *
   * Two renames can be in flight at once — submit, reopen the editor, submit
   * again — and nothing makes the first response arrive before the second. The
   * older answer would then be applied last and the reader would watch their
   * newer title turn back into their older one, with both writes having
   * succeeded. A counter is enough: only the latest request may report.
   */
  const seq = useRef(0);

  const begin = useCallback(() => {
    setError(null);
    setEditing(true);
  }, []);

  const done = useCallback(
    (title: string | null | undefined) => {
      // Closed before the request rather than after it: leaving the input open
      // while the write is in flight invites a second Enter, and the editor has
      // already handed its value over. Same call `useShelf.rename` makes.
      setEditing(false);
      // Cancelled, or Enter on an untouched field. Nothing to write.
      if (title === undefined) return;
      setError(null);
      const mine = ++seq.current;
      apiFetch(`/api/library/${encodeURIComponent(slug)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title }),
      })
        .then((r) => readJson<{ entry: LibraryEntry }>(r))
        .then(({ entry }) => {
          if (seq.current !== mine) return;
          setOverridden(Boolean(entry.titleOverridden));
          /* **The slug goes back with the title.** This resolves after the
             component that owns it may have gone: the reader renames one
             article, navigates, and the answer lands with a page about a
             different article on screen. The caller holds the current address
             and this one does not, so it says which article it is talking
             about rather than assuming it is still the one being looked at.
             GPT Sol, 2026-08-27. */
          onRenamed(slug, entry.title);
        })
        .catch((e: Error) => {
          if (seq.current !== mine) return;
          setError(e.message);
        });
    },
    [slug, onRenamed],
  );

  return { editing, begin, done, overridden, error };
}

/* ------------------------------------------------------------ heading ----- */

/**
 * A heading with a pencil beside it, and the editor in its place once pressed.
 *
 * The masthead and the metadata page each have exactly one title, drawn
 * differently — one of them is a link to the source, and they are set at
 * different sizes — so the heading itself is the caller's, passed as
 * `children`. What is shared is everything that goes wrong: where the pencil
 * hides, what replaces the heading, and what a failed write says.
 *
 * **`opacity`, never `display: none`.** A hidden element is not focusable, so
 * hiding the pencil until hover would delete it outright for anyone navigating
 * by keyboard — and every check anybody ran with a mouse would look fine.
 * `focus-within` and `hover-none` are the two other ways in: the keyboard, and
 * a touch screen, which has no hover to give. Same three rules as the shelf's
 * row of buttons (ShelfEntry.tsx § Actions), for the same reasons.
 */
export function EditableTitle({
  rename,
  title,
  offer = true,
  inputClassName,
  children,
}: {
  rename: ArticleRename;
  /** What the heading is showing — seeded into the input, and compared against. */
  title: string;
  /**
   * Whether to offer the pencil at all.
   *
   * The metadata page withholds it on the fixture, where there is no shelf row
   * under this address and the PATCH would 404 — the same refusal its Delete
   * button makes, and for the same reason: a button whose only outcome is an
   * error is worse than no button, because pressing it is how you find out.
   */
  offer?: boolean | undefined;
  /** How the input is typeset, so it matches the heading it replaces. */
  inputClassName?: string | undefined;
  /** The heading. Give it `tw:min-w-0 tw:flex-1` so a long title wraps rather than shoving the pencil off. */
  children: ReactNode;
}) {
  /**
   * Put focus back on the pencil when the editor closes — but only if it would
   * otherwise land nowhere.
   *
   * The two elements swap: pressing the pencil removes it and mounts the input,
   * and Enter or Escape removes the input. React unmounts the element the
   * reader is standing on, so focus falls to `<body>` and the next Tab starts
   * again from the top of the document. That is the whole bug, and it is
   * invisible to anybody using a mouse.
   *
   * **The `activeElement` test is the part that matters.** This editor commits
   * on blur, so a reader who clicks a link is also closing it — and grabbing
   * focus back then would yank them off whatever they had just clicked. If
   * focus has already gone somewhere real, leave it there; only rescue the case
   * where it went to the body.
   */
  const pencil = useRef<HTMLButtonElement>(null);
  const was = useRef(rename.editing);
  useEffect(() => {
    const closed = was.current && !rename.editing;
    was.current = rename.editing;
    if (!closed) return;
    const at = document.activeElement;
    if (at === null || at === document.body) pencil.current?.focus();
  }, [rename.editing]);

  return (
    <>
      {rename.editing ? (
        <TitleEditor
          title={title}
          overridden={rename.overridden}
          className={inputClassName}
          onDone={rename.done}
        />
      ) : (
        <div className="tw:group tw:flex tw:items-start tw:gap-2">
          {children}
          {offer && (
            <span className="tw:mt-1 tw:shrink-0 tw:opacity-0 tw:transition-opacity tw:group-hover:opacity-100 tw:group-focus-within:opacity-100 tw:hover-none:opacity-100">
              <IconButton ref={pencil} label="Edit title" onClick={rename.begin}>
                <Pencil size={14} />
              </IconButton>
            </span>
          )}
        </div>
      )}
      {/* A failed write leaves the heading showing the old title, which is the
          truth — so this says what went wrong rather than letting a keystroke
          that looked like it worked stand. `alert`, because it arrives after
          the reader has moved on. */}
      {rename.error && (
        <p
          role="alert"
          className="tw:mt-1 tw:mb-0 tw:inline-flex tw:items-center tw:gap-1 tw:font-sans tw:text-xs tw:text-destructive"
        >
          <TriangleAlert size={12} /> Couldn't rename it: {rename.error}
        </p>
      )}
    </>
  );
}
