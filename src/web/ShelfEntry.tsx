/**
 * One article on the shelf: the card, the buttons, and the tooltip — the parts
 * both views share.
 *
 * These lived inside Library.tsx until 2026-08-26, when the dense table arrived
 * and needed the same five buttons, the same rename-in-place and the same
 * details tooltip. Two copies of a row of buttons is two places for a `title`
 * and an `aria-label` to drift apart, and the second copy is always the one
 * nobody checks with a keyboard.
 *
 * See docs/project/library.md § What you can do to a card.
 */
import { useCallback, useState } from "react";
import {
  Check,
  Copy,
  ExternalLink,
  FileText,
  MessageCircle,
  Pencil,
  RefreshCw,
  Trash2,
} from "lucide-react";
import type { LibraryEntry } from "../types.js";
import { IconButton } from "./IconButton.js";
import { Link } from "./Link.js";
import { exactly } from "./relative-time.js";
import { readHref } from "./router.js";
import { TitleEditor } from "./TitleEditor.js";
import { Tooltip } from "./Tooltip.js";
import type { useShelf } from "./useShelf.js";
import { fetchOk } from "./lib/api.js";

export type Shelf = ReturnType<typeof useShelf>;

/* -------------------------------------------------------------- card ------ */

/**
 * The card, and the one thing about it that is new.
 *
 * **The meta line says the thing the shelf is sorted by.** A card sorted by
 * something it does not show is a list in an order the reader cannot check —
 * "why is this one at the top?" has to be answerable from the card. So sorting
 * by Last opened turns the date on the right into "opened 25 Aug", and sorting
 * by Comments turns it into "3 comments". Sorting by Added or Length changes
 * nothing, because the card already carries both.
 *
 * That is the "best of all worlds" Greg asked for, and it is the half a dense
 * table cannot give you: the table shows every column and no blurb; the card
 * shows the blurb and whichever column you are currently thinking about.
 */
export function ShelfCard({
  entry,
  shelf,
  note,
}: {
  entry: LibraryEntry;
  shelf: Shelf;
  /**
   * What the meta line says — the sorted column's own account of this article.
   * Chosen by the page from `CARD_NOTES` rather than worked out here, so the
   * card cannot disagree with the chips about what it is sorted by.
   */
  note: string;
}) {
  /* Shared with the table through the shelf hook rather than kept here: the
     table splits one article across two cells, and two cells cannot share a
     `useState`. See useShelf.ts § renaming. */
  const editing = shelf.renaming === entry.slug;

  // Only the facts this article actually has. A filtered join beats a chain of
  // `&&`s that can leave a stranded separator — same reasoning as Masthead.
  const facts = [
    entry.byline,
    entry.siteName,
    `~${entry.minutes} min`,
    `${entry.blocks} blocks`,
  ].filter(Boolean) as string[];

  return (
    <article className="tw:group tw:relative tw:rounded-lg tw:border tw:border-border tw:bg-card tw:p-5 tw:transition-colors tw:hover:border-highlight/60 tw:focus-within:border-highlight">
      <div className="tw:flex tw:items-start tw:gap-3">
        {editing ? (
          <TitleEditor
            title={entry.title}
            /* `Boolean`, because the flag is optional on the wire: it is set
               only when there IS an override, so `undefined` here means "the
               extractor's title" and not "we do not know". The reading view is
               the one that genuinely does not know — TitleEditor.tsx. */
            overridden={Boolean(entry.titleOverridden)}
            onDone={(title) => {
              // `undefined` means "escaped" — nothing to save, and saying so
              // here rather than in the editor keeps the cancel path from
              // writing the unchanged title back to the server.
              if (title === undefined) shelf.cancelRename();
              else void shelf.rename(entry.slug, title);
            }}
          />
        ) : (
          <h2 className="tw:m-0 tw:min-w-0 tw:flex-1 tw:font-prose tw:text-xl tw:leading-snug">
            {/* The stretched link: a real `<a href>` whose ::after covers the
                card, so the whole card is a click target and ⌘-click still
                opens a tab. Everything interactive after this needs `relative`
                to sit above it. */}
            <Link
              href={readHref(entry.slug)}
              className="tw:text-foreground tw:no-underline tw:after:absolute tw:after:inset-0 tw:after:content-['']"
            >
              {entry.title}
            </Link>
          </h2>
        )}

        {!editing && (
          <Actions entry={entry} shelf={shelf} onEdit={() => shelf.beginRename(entry.slug)} />
        )}
      </div>

      <p className="tw:mt-1.5 tw:mb-0 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1 tw:text-xs tw:text-muted-foreground">
        {facts.map((f, i) => (
          <span key={f}>
            {i > 0 && <span className="tw:mr-2 tw:opacity-50">·</span>}
            {f}
          </span>
        ))}
        {entry.fixture && (
          <span
            className="tw:rounded tw:border tw:border-border tw:px-1.5 tw:py-0.5"
            title="The committed placeholder fixture, not real pipeline output — see example/README.md"
          >
            fixture
          </span>
        )}
      </p>

      {/* The whole piece in one sentence. Serif, because it is the article
          talking rather than the app — the same distinction the reading view
          makes between prose and chrome. */}
      {entry.gist && (
        <p className="tw:mt-3 tw:mb-0 tw:font-prose tw:text-[0.95rem] tw:leading-relaxed tw:text-ink-faint">
          {entry.gist}
        </p>
      )}

      {/* **Wraps, and the note keeps its `ml-auto` when it does.** The row is
          three things of unpredictable width — a word count, a question count,
          and a note that is whatever the current sort makes it ("opened 3 weeks
          ago", "added 26 Aug 2026") — and in a narrow window the last of them
          is the one that gets squeezed. `gap-y-1` so a wrapped second line does
          not touch the gist above it. */}
      <p className="tw:mt-3 tw:mb-0 tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-1 tw:text-xs tw:text-muted-foreground">
        <span className="tw:inline-flex tw:items-center tw:gap-1.5">
          <FileText size={13} />
          {entry.words.toLocaleString()} words
        </span>
        {entry.comments > 0 && (
          <span
            className="tw:inline-flex tw:items-center tw:gap-1.5 tw:text-highlight"
            title={`${entry.comments} question${entry.comments === 1 ? "" : "s"} asked about this article`}
          >
            <MessageCircle size={13} />
            {entry.comments}
          </span>
        )}
        <Tooltip content={<Details entry={entry} />} placement="top">
          {/* The date line is the trigger, because it is the field a reader is
              already looking at when they wonder "when did I add this, and have
              I read it?" — the tooltip answers the rest of that question.

              A real `<button>` rather than a `<span tabIndex={0}>`, which is
              what this was: a span in the tab order is focusable without being
              announced as anything, so a screen reader lands on a date and is
              told nothing is there. The button carries the name. `relative` so
              it sits above the stretched link and can be hovered at all.

              **The accessible name starts with the visible text.** This button
              says "26 Aug 2026" or "3 comments" depending on the sort, and an
              `aria-label` of "Details of …" would replace that entirely — so
              somebody driving the page by voice cannot say what they can see,
              and WCAG 2.5.3 Label in Name is failed. Caught by a cross-family
              review, 2026-08-26; the comment here already said the label had to
              track the text, and the code did not. */}
          <button
            type="button"
            aria-label={`${note} — details of ${entry.title}`}
            className="tw:relative tw:ml-auto tw:cursor-help tw:border-b tw:border-dotted tw:border-border tw:bg-transparent tw:p-0 tw:text-xs tw:text-muted-foreground tw:outline-none tw:focus-visible:text-highlight"
          >
            {note}
          </button>
        </Tooltip>
      </p>
    </article>
  );
}

/* ------------------------------------------------------------ tooltip ----- */

/** `opened 6 times, last on 25 Aug` — or nothing at all, if it never has been. */
function opensLine(entry: LibraryEntry): string {
  if (entry.opens === 0) return "not yet";
  const last = exactly(entry.lastOpenedAt);
  const times = entry.opens === 1 ? "once" : `${entry.opens} times`;
  return last ? `${times}, last ${last}` : times;
}

/**
 * Everything we know about the article that the card has no room for.
 *
 * **What it deliberately does not say, and why.** Chat threads and saved
 * searches are per-article reader state that has *not* moved to Postgres —
 * src/chat.ts and src/searches.ts write files in both modes, and the
 * `chat_threads` / `search_runs` tables exist but nothing touches them. A count
 * that reads 7 on the filesystem and 0 in Postgres is worse than no count,
 * because it looks like an answer. They go in when step 10 of
 * docs/plans/postgres-storage-implementation.md lands.
 */
export function Details({ entry }: { entry: LibraryEntry }) {
  const built = [
    entry.has.arc && "arc",
    entry.has.tweets && "thread",
    entry.has.glossary && "glossary",
  ].filter(Boolean) as string[];

  const rows: [string, string][] = [
    ["Added", exactly(entry.addedAt) ?? "unknown"],
    ["Opened", opensLine(entry)],
    ["Marked", entry.comments === 1 ? "1 comment" : `${entry.comments} comments`],
    ["Built", built.length ? built.join(" · ") : "nothing beyond the tree"],
    [
      "Size",
      `${entry.words.toLocaleString()} words · ${entry.blocks} blocks · ${entry.parts} parts · ${entry.sections} sections`,
    ],
  ];
  if (entry.siteName) rows.splice(1, 0, ["From", entry.siteName]);
  if (entry.titleOverridden) rows.push(["Title", "renamed by you"]);

  return (
    <dl className="tw:m-0 tw:grid tw:grid-cols-[auto_1fr] tw:gap-x-3 tw:gap-y-1 tw:text-xs">
      {rows.map(([label, value]) => (
        <div key={label} className="tw:contents">
          <dt className="tw:text-muted-foreground">{label}</dt>
          <dd className="tw:m-0 tw:text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ------------------------------------------------------------ actions ----- */

/**
 * The row of buttons.
 *
 * **`opacity`, never `display: none`.** A hidden element is not focusable, so
 * hiding the row until hover would delete it outright for anyone navigating by
 * keyboard — and every check anybody ran with a mouse would look fine.
 * `focus-within` brings it back for exactly that reason.
 */
export function Actions({
  entry,
  shelf,
  onEdit,
}: {
  entry: LibraryEntry;
  shelf: Shelf;
  onEdit: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [rerunning, setRerunning] = useState(false);

  const copy = useCallback(() => {
    const url = new URL(readHref(entry.slug), window.location.origin).toString();
    /* Caught, because `writeText` rejects for real reasons — a page without
       focus, a browser that refuses the permission — and an unhandled rejection
       here left the reader looking at a button that had simply done nothing. */
    void navigator.clipboard
      .writeText(url)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch((e: Error) => shelf.report(`Couldn't copy the link: ${e.message}`));
  }, [entry.slug, shelf]);

  /* Re-running is `POST /api/jobs { slug, steps, force }` — the route that
     already exists, and the same one the add box uses. `force: ["fetch"]` is
     what makes it a refresh rather than a resume: without it the queue skips
     every step whose artefact is already on disk, which is every step.
     `useJobs` picks the job up from the queue and the progress list shows it,
     so there is nothing to render here beyond the button going quiet. */
  const rerun = useCallback(async () => {
    setRerunning(true);
    try {
      /* `fetchOk`, so the check cannot be dropped. The first version ignored the
         response entirely, so a refused job — a bad slug, a queue that would not
         take it, a 501 — left the button spinning briefly and then looking as
         though it had worked. That is the silent success this repo keeps writing
         up, and lib/api.ts § `fetchOk` is where it stopped being possible to
         write it again by forgetting a line. */
      await fetchOk("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: entry.slug, force: ["fetch"] }),
      });
    } catch (e) {
      shelf.report(`Couldn't queue a rebuild: ${(e as Error).message}`);
    } finally {
      setRerunning(false);
    }
  }, [entry.slug, shelf]);

  return (
    /* `opacity`, never `display: none` — a hidden element is not focusable, so
       hiding the row until hover would delete it outright for anyone navigating
       by keyboard, and every check done with a mouse would look fine.
       `hover-none:opacity-100` is the other half: on a touch screen there is no
       hover, so without it these buttons stayed invisible AND hit-testable —
       controls you cannot see but can press by accident. Caught by a
       cross-family review, 2026-08-26. */
    <div className="tw:relative tw:flex tw:shrink-0 tw:items-center tw:gap-0.5 tw:opacity-0 tw:transition-opacity tw:group-hover:opacity-100 tw:group-focus-within:opacity-100 tw:hover-none:opacity-100">
      <IconButton label="Edit title" onClick={onEdit}>
        <Pencil size={14} />
      </IconButton>
      {/* **Only where there is something to re-fetch.** An uploaded PDF has no
          address, and neither has an article old enough to predate our
          recording one — so this button queued a job whose first step failed
          with "No source URL", every time, having looked exactly like a button
          that ought to work. Keyed on the URL rather than on "is it an upload",
          because that is the actual precondition and it covers both cases.
          Re-running the *later* stages is still meaningful and is still
          reachable from the metadata page; only the re-fetch is impossible.
          GPT Sol, 2026-08-27. */}
      {entry.url && (
        <IconButton
          label={rerunning ? "Queueing…" : "Re-fetch and rebuild"}
          onClick={() => void rerun()}
          disabled={rerunning}
        >
          <RefreshCw size={14} className={rerunning ? "cmt-spinner" : undefined} />
        </IconButton>
      )}
      {entry.url && (
        <a
          href={entry.url}
          target="_blank"
          // noreferrer as well as noopener: the target should not be told which
          // of the reader's articles linked to it.
          rel="noopener noreferrer"
          title="Open the original page"
          aria-label="Open the original page"
          /* An `<a>` wearing the button's clothes, so the row does not have a
             gap in it where the one link sits. Kept in step with `IconButton`
             below by hand — a shared helper would have to take an element
             type, which is more machinery than five utilities are worth. */
          className="tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded-md tw:text-muted-foreground tw:no-underline tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground"
        >
          <ExternalLink size={14} />
        </a>
      )}
      <IconButton label={copied ? "Copied" : "Copy link"} onClick={copy}>
        {copied ? <Check size={14} className="tw:text-highlight" /> : <Copy size={14} />}
      </IconButton>
      <IconButton label="Delete" onClick={() => void shelf.archive(entry.slug)} destructive>
        <Trash2 size={14} />
      </IconButton>
    </div>
  );
}
