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
import {
  cloneElement,
  useCallback,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from "react";
import {
  Archive,
  ArchiveRestore,
  Check,
  CircleDashed,
  Copy,
  Ellipsis,
  ExternalLink,
  FileText,
  Globe,
  MessageCircle,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { DropdownMenu } from "radix-ui";
import { SHARING_BADGE, SHARING_ON } from "../messages.js";
import type { LibraryEntry } from "../types.js";
import { isWebUrl } from "../urls.js";
import { IconButton } from "./IconButton.js";
import { Link } from "./Link.js";
import { exactly } from "./relative-time.js";
import { readHref } from "./router.js";
import { TitleEditor } from "./TitleEditor.js";
import { ControlTip, Tooltip, TooltipGroup } from "./Tooltip.js";
import type { useShelf } from "./useShelf.js";
import { fetchOk } from "./lib/api.js";

/* `archivedAt` read directly rather than through shelf-narrow.ts's `isArchived`:
   this file is shared with the lazy /admin and /design routes, and importing
   shelf-narrow would put it (and library-hits.ts behind it) into the reader's
   startup bytes — tests/eager-client-graph.test.ts § SHARED_WITH_READER. */
const isArchived = (entry: { archivedAt?: string | null }) => !!entry.archivedAt;

export type Shelf = ReturnType<typeof useShelf>;

/* ------------------------------------------------------------- shared ----- */

/**
 * **This one is out in the world** — the owner's marker, on the owner's shelf.
 *
 * Drawn by both renderers, from here, because the shelf has two of them and a
 * marker added to one of them looks finished from wherever the reviewer
 * happened to be standing. One component is also one hover sentence and one
 * accessible name.
 *
 * `Globe` rather than `Lock`, matching the owner's own sharing card exactly —
 * src/web/AccessSharing.tsx draws a globe when shared and a lock when not — and
 * deliberately *unlike* `ViewOnlyChip` in src/web/PublicChrome.tsx, whose lock
 * is the visitor's side of this same fact and means the other thing: *you may
 * not change this*, where this means *anyone with the link can read this*. Two
 * sentences, two components; collapsing them would put the visitor's sentence
 * on the owner's shelf.
 *
 * **There is no private twin.** The shelf is almost all private, so a chip on
 * every card is decoration rather than information — and it would cost this one
 * the only thing it has, which is standing out. Greg's decision, along with a
 * badge rather than a filter until there is volume:
 * docs/plans/260902j-public-read-only-access-audit-and-improvements.md § Cluster E.
 *
 * Visible text as well as the hover, for the reason `ViewOnlyChip`'s file gives
 * at length: a `title` is unreachable by touch and by keyboard.
 */
export function SharedBadge({
  /**
   * `false` in the table, where the same sentence is in the title's row card
   * instead and the rows carry no `title` attributes at all (library-columns.tsx
   * § `rowCardFacts`, plan 260928a). The cards view has no row card, so it keeps
   * the `title` — `IconButton`'s `titled`, the same switch for the same reason.
   */
  titled = true,
}: { titled?: boolean } = {}) {
  return (
    <span
      className="tw:inline-flex tw:items-center tw:gap-1 tw:rounded tw:border tw:border-highlight/40 tw:px-1.5 tw:py-0.5 tw:text-highlight"
      title={titled ? SHARING_ON : undefined}
    >
      <Globe size={11} />
      {SHARING_BADGE}
    </span>
  );
}

/**
 * **This one is archived, and on screen only because Archived is on** — plan
 * 260929a, Greg's report 4V. Since then the archived articles join the shelf's
 * one list rather than a second list at its foot, so each needs saying.
 *
 * Drawn by both renderers from here, for `SharedBadge`'s reason. Visible text,
 * not a colour or an icon alone. `data-archived-mark` is what a test finds.
 */
export function ArchivedMark() {
  return (
    <span
      data-archived-mark=""
      className="tw:inline-flex tw:items-center tw:gap-1 tw:rounded tw:border tw:border-border tw:px-1.5 tw:py-0.5 tw:text-muted-foreground"
    >
      <Archive size={11} aria-hidden="true" />
      Archived
    </span>
  );
}

/** The marker's words — Greg's: *"indicate in the UI that it hasn't been AI-processed yet"*. */
export const NOT_PROCESSED_MARK = "Not AI-processed yet";

/**
 * **A paper with only its title, authors and abstract read** (plan 261001m) —
 * on the card, in the table and on the paper's own page. Drawn from here, for
 * `SharedBadge`'s reason, in `ArchivedMark`'s shape. `data-not-processed-mark`
 * is what a test finds.
 */
export function NotProcessedBadge() {
  return (
    <span
      data-not-processed-mark=""
      className="tw:inline-flex tw:items-center tw:gap-1 tw:rounded tw:border tw:border-border tw:px-1.5 tw:py-0.5 tw:text-muted-foreground"
    >
      <CircleDashed size={11} aria-hidden="true" />
      {NOT_PROCESSED_MARK}
    </span>
  );
}

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
 * That is the "best of all worlds" Greg asked for: the cards view keeps the
 * blurb visible and names the current sort in each card, while the table puts
 * comparable values in columns and offers its blurb from the title's row card.
 */
export function ShelfCard({
  entry,
  shelf,
  note,
  archivedShown = false,
  readThis,
}: {
  entry: LibraryEntry;
  shelf: Shelf;
  /**
   * ***Read this* for a paper not read through yet**, drawn by the caller
   * (`ReadThisButton`, ReadThis.tsx). A slot rather than an import because this
   * file is shared with the lazy /admin and /design routes, and the button
   * brings the job engine and the add page's mode list behind it —
   * tests/eager-client-graph.test.ts § SHARED_WITH_READER.
   */
  readThis?: ReactNode;
  /**
   * What the meta line says — the sorted column's own account of this article.
   * Chosen by the page from `CARD_NOTES` rather than worked out here, so the
   * card cannot disagree with the chips about what it is sorted by.
   */
  note: string;
  /**
   * `?archived=1`: whether archived articles are on the shelf too, which
   * changes what Archive's card promises (`TIPS.archiveShown`).
   */
  archivedShown?: boolean;
}) {
  /* Shared with the table through the shelf hook rather than kept here: the
     table splits one article across two cells, and two cells cannot share a
     `useState`. See useShelf.ts § renaming. */
  const editing = shelf.renaming === entry.slug;

  // Only the facts this article actually has. A filtered join beats a chain of
  // `&&`s that can leave a stranded separator — same reasoning as Masthead.
  /* **A paper not read through yet** (plan 261001m) has no blocks, so no
     length and no blocks to count; what it has is a title, its authors and an
     abstract, and the one button that reads the rest. */
  const minimal = entry.processing === "minimal";
  const facts = (
    minimal
      ? [entry.byline, entry.siteName]
      : [entry.byline, entry.siteName, `~${entry.minutes} min`, `${entry.blocks} blocks`]
  ).filter(Boolean) as string[];

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
          <h2 className="tw:m-0 tw:min-w-0 tw:flex-1 tw:break-words tw:font-prose tw:text-xl tw:leading-snug">
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
          <Actions
            entry={entry}
            shelf={shelf}
            onEdit={() => shelf.beginRename(entry.slug)}
            archivedShown={archivedShown}
          />
        )}
      </div>

      <p className="tw:mt-1.5 tw:mb-0 tw:flex tw:flex-wrap tw:items-center tw:gap-x-2 tw:gap-y-1 tw:text-xs tw:text-muted-foreground">
        {facts.map((f, i) => (
          <span key={f} className="tw:min-w-0 tw:max-w-full tw:break-words">
            {i > 0 && <span className="tw:mr-2 tw:opacity-50">·</span>}
            {f}
          </span>
        ))}
        {/* First of the chips: it is the one that says why this card is here
            at all when the reader's shelf, by default, would not show it. */}
        {isArchived(entry) && <ArchivedMark />}
        {minimal && <NotProcessedBadge />}
        {/* Ahead of the fixture chip: of the two, this is the one that says
            something about who else can see the article. */}
        {entry.visibility === "public" && <SharedBadge />}
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

      {/* The abstract behind a disclosure — it is the paper's own words, and a
          shelf of forty open abstracts would be a wall — then *Read this*.
          `relative` so both sit above the card's stretched link. */}
      {minimal && (
        <div className="tw:relative tw:mt-3 tw:flex tw:flex-col tw:gap-3">
          {entry.abstract && (
            <details className="tw:text-xs tw:text-muted-foreground">
              <summary className="tw:cursor-pointer tw:select-none">Abstract</summary>
              <p className="tw:mt-2 tw:mb-0 tw:break-words tw:font-prose tw:text-[0.95rem] tw:leading-relaxed tw:text-ink-faint">
                {entry.abstract}
              </p>
            </details>
          )}
          {readThis}
        </div>
      )}

      {/* **Wraps, and the note keeps its `ml-auto` when it does.** The row is
          three things of unpredictable width — a word count, a question count,
          and a note that is whatever the current sort makes it ("opened 3 weeks
          ago", "added 26 Aug 2026") — and in a narrow window the last of them
          is the one that gets squeezed. `gap-y-1` so a wrapped second line does
          not touch the gist above it. */}
      <p className="tw:mt-3 tw:mb-0 tw:flex tw:flex-wrap tw:items-center tw:gap-x-4 tw:gap-y-1 tw:text-xs tw:text-muted-foreground">
        {!minimal && (
          <span className="tw:inline-flex tw:items-center tw:gap-1.5">
            <FileText size={13} />
            {entry.words.toLocaleString()} words
          </span>
        )}
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
 * docs/plans/260826e-postgres-storage-implementation.md lands.
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
 * **What each button's card says.**
 *
 * Here rather than inline in the row below, because four of the five have a
 * second version — the sentence for when the action cannot be performed — and a
 * row with nine `ControlTip`s written into it stops being readable as a row.
 *
 * `ControlTip`'s rule holds throughout (Tooltip.tsx): `what` is what pressing
 * the button would have told you, and `how` is what it would not — what it
 * costs, where the answer comes from, or what the control does *not* promise.
 * A `how` that restates its `what` is the failure mode, and
 * tests/shelf-action-tooltips.test.tsx checks the two against each other.
 *
 * **Every claim here is a claim about the code, and the first draft got four of
 * them wrong** — GPT Sol's review, 2026-09-05. Each was the kind that reads
 * fluently and cannot be caught by a restatement test: "the whole pipeline"
 * where `DEFAULT_INGEST_STEPS` is five steps of eleven; "your notes come
 * through" where block-ids.md is explicit that a rewritten passage can lose its
 * target; "nobody else can open this" on an article the reader has already
 * shared; and *"it was uploaded"* inferred from a missing URL, which is exactly
 * the inference Metadata.tsx refuses to make in a comment of its own. If you
 * edit a sentence here, check it against the thing it describes.
 */
const TIPS = {
  edit: {
    head: "Edit title",
    what: "Rename the article. The shelf, the reading view and the browser tab all follow.",
    how: "Yours alone, and reversible: the title the extractor found is kept underneath, and saving an empty box restores it.",
  },
  /**
   * **Five steps, not eleven** — `DEFAULT_INGEST_STEPS` in src/pipeline.ts is
   * `fetch`, `extract`, `blocks`, `structure`, `assets`. The arc, the glossary,
   * the quotes, the timeline and the rest are not rebuilt, and saying "the
   * whole pipeline" promised a reader something this button does not do.
   */
  rerun: {
    head: "Re-fetch and rebuild",
    what: "Fetches the page again and reads it afresh: the text is re-extracted, the blocks and the structure are rebuilt, and the article's images are re-hosted.",
    how: "A few minutes, and it spends model calls. What you have written stays where the text did — notes are keyed to block ids, which are minted once and kept, so only a passage the page itself has rewritten can lose its marker.",
  },
  /**
   * **Rebuild, when there is nothing to fetch** — Greg, 2026-09-30, feedback
   * 6B: *"It *could* rebuild them though, and so I feel like that button
   * should still be active - it should just skip the refetching (and perhaps
   * indicate that in the tooltip)."*
   *
   * History, because the button has been three things. On 2026-08-27 it was
   * deleted where there was no address, because it queued a job whose first
   * step failed with "No source URL" every time; on 2026-09-05 it came back
   * drawn and unavailable, so the row was the same width on every card. Now it
   * works: the job forces `extract` rather than `fetch`, so the copy we already
   * hold is processed again and nothing is fetched (`rerun` below).
   *
   * **One card for both absences** — no address, and an address stage 1 will
   * not follow. They send the same request and do the same thing, so the
   * distinction lives on Open the original, where it changes what happens
   * (GPT Sol's plan review). **And it still does not say why there is no
   * address**: "you uploaded this" is a claim assembled from a gap in our own
   * files — the same refusal as Metadata.tsx § `uploaded`.
   *
   * "Processed again", not "read afresh": for a PDF, unchanged transcription
   * chunks come back from their checkpoints (src/pdf-read.ts), so not every
   * model call is bought again. GPT Sol, the same review.
   */
  rebuild: {
    head: "Rebuild",
    what: "There is no web address to fetch this article from, so nothing is fetched: the copy we already hold is processed again — the text is re-extracted, the blocks and the structure are rebuilt, and the article's images are re-hosted.",
    how: "A few minutes, and it may spend model calls. What you have written stays where the text did — notes are keyed to block ids, which are minted once and kept, so only a passage the new extraction rewrites can lose its marker.",
  },
  /**
   * **Nothing to fetch and no source the pipeline can safely reuse.** That is
   * either no stored reference (`raw_source_kind` null, which src/db/schema.ts
   * calls a real answer) or no completed `fetch` receipt beside it. Forcing
   * `extract` in either state makes `fetch` run and fail with "No source URL":
   * the dead button of 2026-08-27 once more. GPT Sol's plan and code reviews,
   * 2026-09-30.
   */
  rebuildUnavailable: {
    head: "Rebuild",
    what: "There is no web address to fetch this article from, and no stored source can be safely reused instead.",
    how: "Everything already built from it is unaffected and stays on the shelf. The article's own metadata page shows what we do know about where it came from.",
  },
  open: {
    head: "Open the original",
    what: "Leaves Spideryarn for the publisher's own page, in a new tab, at whatever it says today.",
    how: "The link carries no referrer, so the site is never told which of your articles pointed at it.",
  },
  openNoUrl: {
    head: "Open the original",
    what: "We have no record of an address for this article.",
    how: "That is a gap in what we stored rather than a judgement about the article — its metadata page lists what we do have.",
  },
  /**
   * The other absence, and a rarer one: `final_url` is validated on the way in
   * by the fetcher, but *imported* metadata is written into the row as given,
   * so a `javascript:` or `data:` value is reachable. src/urls.ts § `isWebUrl`,
   * docs/project/security.md.
   */
  openNotWeb: {
    head: "Open the original",
    what: "The address recorded for this article is not a web page.",
    how: "Only http and https are opened, and no link is drawn for anything else — a scheme we have not vetted is a click whose destination we cannot vouch for.",
  },
  copy: {
    head: "Copy link",
    what: "Copies this article's address on Spideryarn — the reading view, not the publisher's page.",
    how: "Copying changes nothing about who can read it: a private article still opens for you alone, whoever you send the link to.",
  },
  /**
   * The public half of the same button. The shelf is the one place a reader
   * sees every article at once, so it is the one place the two can be told
   * apart — `visibility` is on the entry for exactly that reason (src/types.ts).
   */
  copyShared: {
    head: "Copy link",
    what: "Copies this article's address on Spideryarn — the reading view, not the publisher's page.",
    how: "You have shared this one, so anybody you send it to can read it. Stop sharing from its metadata page and the same link goes back to opening for you alone.",
  },
  archive: {
    head: "Archive",
    what: "Takes the article off the shelf, and offers an Undo for nine seconds afterwards.",
    how: "Nothing is destroyed and the link still opens — it is the listing it leaves, including the public one if you have shared it. The card goes when the server has agreed, not before, so a failed archive cannot leave you looking at a shelf it is missing from.",
  },
  /**
   * **Archive while Include archived is on**, when the card does not leave: the
   * archived articles are on the shelf too, so the promise above — *takes the
   * article off the shelf*, *the card goes* — would be false as the reader
   * watched it (plan 260929a, Sol R4). What changes is the mark and the button.
   */
  archiveShown: {
    head: "Archive",
    what: "Moves the article to the archive, and offers an Undo for nine seconds afterwards.",
    how: "While Include archived is on, the card stays where it is, marked Archived, with Put back in place of this button; turn Include archived off and it is gone from the shelf. Nothing is destroyed and the link still opens — it is the listing it leaves, including the public one if you have shared it.",
  },
  restore: {
    head: "Put back",
    what: "Puts this archived article back on the shelf.",
    how: "The card stays where it is and loses its Archived mark, and it stays on the shelf when Include archived is turned off. The same un-archive as the Undo after archiving, and as Put back on the article's own page.",
  },
} as const;

/**
 * **What the five actions do, written once for both presentations.**
 *
 * Since 2026-09-15 there are two: the hover-revealed row of icons below, and,
 * wherever there is a finger, a "⋯" that opens the same five as a menu of words
 * (`ShelfActionsMenu`). Two presentations over two copies of the handlers is
 * two places for "what does Copy do" to drift apart — the reasoning this file's
 * header gives for sharing the row between the card and the table, one level
 * down. So both call this, and the choice between them is only ever about how
 * the five are drawn. docs/plans/260915b-shelf-actions-reachable-on-touch.md.
 */
function useShelfActions(entry: LibraryEntry, shelf: Shelf, onEdit: () => void) {
  const [copied, setCopied] = useState(false);
  const [rerunning, setRerunning] = useState(false);

  const copy = useCallback(() => {
    const url = new URL(readHref(entry.slug), window.location.origin).toString();
    /* **There may be no clipboard object at all**, and this was the one copy
       button in the app that did not say so. `navigator.clipboard` is undefined
       outside a secure context, so on anything but https or localhost this threw
       a `TypeError` out of a React event handler — past the `.catch` below,
       which only ever sees a *rejected promise* — and the reader got a button
       that did nothing and no message.

       A statement rather than `navigator.clipboard?.writeText(…)`, because the
       optional chain evaluates to `undefined` and then `.then` throws on it:
       the same trap, moved one line down. BlockGutter.tsx and
       AccessSharing.tsx already guard it this way and say so; this one was the
       odd one out, found on 2026-09-05 when a new touch test pressed Copy and
       vitest reported the uncaught `TypeError`. */
    if (!navigator.clipboard) {
      shelf.report("Couldn't copy the link: this browser won't give the page a clipboard here.");
      return;
    }
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
     so there is nothing to render here beyond the button going quiet.

     **`force: ["extract"]` where there is no web address to fetch** (feedback
     6B, 2026-09-30). `fetch` is then not forced, finds the `raw` manifest it
     wrote on the way in, and skips; everything from `extract` on runs again
     over the copy we hold. The same job `enqueueReset` queues (src/jobs.ts),
     without the reset plan. docs/plans/260930d-shelf-rebuild-for-articles-with-no-fetchable-address.md. */
  /* **Whether there is something to re-fetch** — which since 2026-09-30
     decides what the button does rather than whether it works (`rerun` below).
     An uploaded PDF has no address, and neither has an article old enough to
     predate our recording one; forcing `fetch` for either queued a job whose
     first step failed with "No source URL", every time. Keyed on the URL rather
     than on "is it an upload", because that is the actual precondition and it
     covers both cases. GPT Sol, 2026-08-27.

     **And `isWebUrl` on top of it, since 2026-08-31.** A shelf row's `url` is
     the same `final_url` the reading view's controls bar and the metadata page
     check, and for the same reason: the fetcher validates one on the way in,
     but *imported* metadata is written straight into the row, so a
     `javascript:` or `data:` value is reachable and the anchor below would be
     an active URL sink. src/urls.ts, docs/project/security.md.

     **One test, not two, and that is the correction.** Until GPT Sol's review
     on 2026-09-05 the re-fetch was keyed on `entry.url` alone, on the reasoning
     that a non-web address is still an address. It is not an address *stage 1
     will follow* — src/fetch.ts refuses anything but http(s) — so a
     `javascript:` article got a live button over a job that was accepted and
     then failed at its first step. That is exactly the dead button the
     2026-08-27 fix was about, reached by the other door, and the lesson is that
     "can we fetch it" and "can we link to it" were never two questions. */
  const hasWebUrl = Boolean(entry.url) && isWebUrl(entry.url ?? "");
  /* **And whether `fetch` will really skip.** With no web address the rebuild
     is safe only when the current revision has both a stored-source reference
     and a completed `fetch` run. `stepIsDone` / `hasArtefacts` require both;
     `sourceReusable` is that exact answer from the shelf query. `=== true`
     fails closed if an older server somehow omits the new field. A raw
     reference alone is not enough. GPT Sol's plan review and code review. */
  const canRerun = hasWebUrl || entry.sourceReusable === true;
  const rerun = useCallback(async () => {
    if (!canRerun) return;
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
        body: JSON.stringify({ slug: entry.slug, force: [hasWebUrl ? "fetch" : "extract"] }),
      });
    } catch (e) {
      shelf.report(`Couldn't queue a rebuild: ${(e as Error).message}`);
    } finally {
      setRerunning(false);
    }
  }, [entry.slug, hasWebUrl, canRerun, shelf]);

  const archive = useCallback(() => void shelf.archive(entry.slug), [entry.slug, shelf]);
  /* The other half, for a card that is on the shelf because Archived is on
     (plan 260929a). The same PATCH as Undo, through `shelf.restore`. */
  const restore = useCallback(() => void shelf.restore(entry.slug), [entry.slug, shelf]);

  return { copied, rerunning, hasWebUrl, canRerun, copy, rerun, archive, restore, edit: onEdit };
}

type ShelfActions = ReturnType<typeof useShelfActions>;

/**
 * The row of buttons.
 *
 * **`opacity`, never `display: none`.** A hidden element is not focusable, so
 * hiding the row until hover would delete it outright for anyone navigating by
 * keyboard — and every check anybody ran with a mouse would look fine.
 * `focus-within` brings it back for exactly that reason.
 *
 * **Five buttons, always five.** Two of them used to be drawn only for an
 * article with a usable source URL, which is right about the action and wrong
 * about the row: the icons moved between cards, and a reader had no way to find
 * out that a button existed, let alone why theirs was missing. So the
 * precondition still decides whether the button *works*, and the card says
 * which of the two absences this is. docs/project/library.md § When a button
 * cannot do its job.
 *
 * **One `TooltipGroup` around the lot**, the DiagramPanel.tsx idiom: once one
 * card is open the neighbours open instantly, so reading along five icons is a
 * scrub rather than five 240ms waits. `keepSide` with it, for the reason
 * Tooltip.tsx § `keepSide` gives about rows specifically — without it a card
 * too wide to centre is thrown onto the cross axis and lands on top of the very
 * buttons the reader is about to hover. **In the table the group is the
 * table's**, not this row's — `inTooltipGroup` below, plan 260928a.
 *
 * **And on a pen, the first tap reads a control and the second presses it** —
 * `pressCapture` below. docs/project/touch.md § Reveal, then commit.
 *
 * **Where there is a finger, none of this is drawn.** Since 2026-09-15 the row
 * is `display: none` wherever `any-pointer: coarse` matches, and
 * `ShelfActionsMenu` — a "⋯" opening the same five as a menu of words — is
 * drawn in its place; everywhere else, the reverse. Both are always rendered
 * and the stylesheet shows exactly one, so the switch lives here, in the one
 * component the card and the table's `RowActions` both render, and both views
 * get it. That `display: none` does not break the keyboard rule above: on those
 * devices the "⋯" is the focusable control. Why a finger gets words rather than
 * glyphs: docs/plans/260915b-shelf-actions-reachable-on-touch.md.
 */
export function Actions({
  entry,
  shelf,
  onEdit,
  inTooltipGroup = false,
  archivedShown = false,
}: {
  entry: LibraryEntry;
  shelf: Shelf;
  onEdit: () => void;
  /** `?archived=1` — which of Archive's two cards is true. */
  archivedShown?: boolean;
  /**
   * **A `TooltipGroup` is already above this row — join it, do not start one.**
   *
   * True in the table, whose whole body is one group (Library.tsx) so that the
   * titles' row cards scrub like the rail. Two nested groups each keep their own
   * current member, so the group that closes every other card when one opens
   * cannot see across the boundary: a title's card held open by focus and an
   * action's card opened by the pointer would both be up at once (GPT Sol, plan
   * 260928a review, P-3; tests/shelf-table-row-card.test.tsx). The cards view
   * has no group above it, so it keeps this row's own — same delays either way,
   * because the table's group uses these.
   */
  inTooltipGroup?: boolean;
}) {
  const actions = useShelfActions(entry, shelf, onEdit);
  const { copied, rerunning, hasWebUrl, canRerun, copy, rerun } = actions;

  /**
   * Which control's card is open, and whether a finger opened it.
   *
   * **One piece of state for five controlled tooltips, which is the shape that
   * took the spine's hover cards away for a day.** Once a tooltip is
   * controlled, every route Floating UI has to `onOpenChange(false)` becomes a
   * route into this value — `useDelayGroup` closes every *other* member the
   * instant one opens, and `useHover`'s close timer fires 90ms behind the
   * pointer without asking who is open by then. So the close is guarded by
   * identity in `ActionTip`, and that guard is the whole reason this is safe:
   * docs/postmortems/260828g-spine-hover-cards.md, whose last paragraph names
   * this exact situation as the one to watch for.
   *
   * `byTouch` decides only whether the card says "tap again" — a mouse reader
   * is already being told everything by hovering.
   */
  const [armed, setArmed] = useState<{ id: ActionKey; byTouch: boolean } | null>(null);

  /**
   * **The whole touch gesture, in one handler on the row.**
   *
   * Capture phase, so it runs *before* the control's own click and can cancel
   * the press outright — which is what makes one handler enough for five
   * controls that are not alike. Two of them can be an `IconButton` that
   * swallows its own click (IconButton.tsx § `disabled`), and one of them is an
   * `<a>` whose default is to navigate; a per-control design would need a hole
   * punched in the first and a `preventDefault` threaded through the second.
   * Here the button goes on refusing its own click and the anchor never sees
   * the event at all.
   *
   * **`pointerType`, not a media query.** `(hover: none)` describes the UA's
   * *primary* pointer, so a touchscreen laptop would jump on the first tap and
   * a tablet with a mouse plugged in would need two clicks — both hybrids, both
   * common, both wrong. This is a fact about *this press*. That is
   * `bandPress`'s own second version (Spine.tsx), on GPT Sol's correction of
   * 2026-08-27; optional-chained the same way, because a synthetic click — a
   * test, an extension — carries no pointer, and the safe reading of "no
   * pointer" is "not a finger", which presses.
   *
   * A mouse therefore takes the `commit` branch every time and the event passes
   * through untouched, so nothing about pointer behaviour changes.
   *
   * **On an iPad this never ran, which is one reason a finger now gets the menu
   * instead.** On iOS 18.2 and later a finger's *click* reports `pointerType`
   * `mouse` — WebKit bug 282988, filed 2024-11, fixed, reopened, still open —
   * while the same tap's `pointerdown` says `touch`. Reading the click, this took
   * every tap on an iPad for a mouse's and committed it blind. Since 2026-09-15 a
   * device with a finger is not drawn this row at all (`ShelfActionsMenu`, whose
   * trigger decides at `pointerdown` for exactly this reason), and the gesture
   * remains for a pen on a machine with no touchscreen, where `any-pointer` is
   * `fine`. Its behaviour is left as it was.
   * docs/plans/260915b-shelf-actions-reachable-on-touch.md § Diagnosis.
   */
  const pressCapture = useCallback(
    (e: ReactMouseEvent<HTMLDivElement>) => {
      const id = actionAt(e.target);
      if (!id) return;
      /* **`pen` as well as `touch`**, because docs/project/touch.md § An Apple
         Pencil counts as a finger says so: iPadOS reports a Pencil as `pen`, it
         cannot hover any more than a finger can, and `swipe.ts` already accepts
         both. Taking only `touch` would have left a Pencil committing blind on
         the one row where the card is the point — and Floating UI treats `pen`
         as mouse-like, so its own hover would not have opened the card either.
         GPT Sol, 2026-09-05. */
      const finger =
        (e.nativeEvent as PointerEvent).pointerType === "touch" ||
        (e.nativeEvent as PointerEvent).pointerType === "pen";
      /* `armed?.id !== id` rather than `armed === null`, so a finger moving
         along the row re-reveals rather than firing at whatever it lands on —
         the row can be read by walking it. Spine.tsx § `bandPress`. */
      if (finger && armed?.id !== id) {
        e.preventDefault();
        e.stopPropagation();
        setArmed({ id, byTouch: true });
        return;
      }
      /* Committing. **Only a card a finger revealed is taken down**, and that
         distinction is the difference between this changing nothing for a mouse
         and it changing something: an unconditional clear closes a
         *hover-opened* card the moment you click Copy, and leaves it closed
         while the pointer is still sitting on the button — `useHover` has
         already fired its `mouseenter` and will not fire another. Before these
         tooltips were controlled, `useDismiss`'s `referencePress: false` meant
         pressing a trigger never closed its own card, and that is worth
         preserving. A finger's card, by contrast, has done its job the moment
         the press it was explaining goes through. GPT Sol, 2026-09-05. */
      setArmed((prev) => (prev?.byTouch ? null : prev));
    },
    [armed],
  );

  return (
    <>
    {/* `opacity`, never `display: none` — a hidden element is not focusable, so
       hiding the row until hover would delete it outright for anyone navigating
       by keyboard, and every check done with a mouse would look fine.
       `hover-none:opacity-100` is the other half: on a touch screen there is no
       hover, so without it these buttons stayed invisible AND hit-testable —
       controls you cannot see but can press by accident. Caught by a
       cross-family review, 2026-08-26.

       **Where there is a finger, `display: none` after all — since
       2026-09-15.** `hover: none` asks about the *primary* pointer and a finger
       is not always it: Chrome on a touchscreen laptop answers `hover: hover`,
       and the row stayed invisible to the finger tapping it. The question is
       "is there a finger", which is `any-pointer` — so stage 1 of the plan
       below revealed the row to one with `any-pointer-coarse:opacity-100`.
       Stage 2, the same day, replaced that with `any-pointer-coarse:hidden`,
       because visible was not enough: five unlabelled glyphs did not say what
       they were, and on Greg's iPad they read as decoration. `ShelfActionsMenu`
       stands in there, and it is the focusable control, so the keyboard
       argument above still holds. (An iPad needs no `any-` to be caught —
       WebKit pins its primary pointer to touch whatever is attached.)
       tests/shelf-actions-visible-to-a-finger-in-chrome.test.tsx,
       docs/plans/260915b-shelf-actions-reachable-on-touch.md. */}
    <div
      className="tw:relative tw:flex tw:shrink-0 tw:items-center tw:gap-0.5 tw:opacity-0 tw:transition-opacity tw:group-hover:opacity-100 tw:group-focus-within:opacity-100 tw:hover-none:opacity-100 tw:any-pointer-coarse:hidden"
      onClickCapture={pressCapture}
    >
      <RowGroup joined={inTooltipGroup}>
        <ActionTip id="edit" armed={armed} onArm={setArmed} tip={TIPS.edit} commits>
          <IconButton label="Edit title" titled={false} onClick={onEdit}>
            <Pencil size={14} />
          </IconButton>
        </ActionTip>

{/* **Not on a paper that has not been read through** (plan 261001m):
            there is nothing built to rebuild, the server refuses it
            (`[np-read]`), and *Read this* on the card is the action. */}
        {entry.processing !== "minimal" && (
                  <ActionTip
            id="rerun"
            armed={armed}
            onArm={setArmed}
            tip={hasWebUrl ? TIPS.rerun : canRerun ? TIPS.rebuild : TIPS.rebuildUnavailable}
            commits={canRerun && !rerunning}
          >
            {/* **The name says what the button will do** — re-fetch, rebuild
                without fetching, or nothing and why. A screen reader gets no
                card, so the parenthesis is the only place the reason reaches
                it. GPT Sol, 2026-09-05; feedback 6B, 2026-09-30. */}
            <IconButton
              label={rerunLabel(hasWebUrl, canRerun, rerunning)}
              titled={false}
              onClick={() => void rerun()}
              disabled={!canRerun || rerunning}
            >
              <RefreshCw size={14} className={rerunning ? "cmt-spinner" : undefined} />
            </IconButton>
          </ActionTip>
        )}

        <ActionTip
          id="open"
          armed={armed}
          onArm={setArmed}
          tip={hasWebUrl ? TIPS.open : entry.url ? TIPS.openNotWeb : TIPS.openNoUrl}
          commits={hasWebUrl}
        >
          {hasWebUrl ? (
            <a
              href={entry.url}
              target="_blank"
              // noreferrer as well as noopener: the target should not be told which
              // of the reader's articles linked to it.
              rel="noopener noreferrer"
              aria-label={openLabel(entry, true)}
              /* An `<a>` wearing the button's clothes, so the row does not have a
                 gap in it where the one link sits. Kept in step with `IconButton`
                 by hand — a shared helper would have to take an element
                 type, which is more machinery than five utilities are worth. */
              className="tw:inline-flex tw:size-7 tw:items-center tw:justify-center tw:rounded-md tw:text-muted-foreground tw:no-underline tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground"
            >
              <ExternalLink size={14} />
            </a>
          ) : (
            /* **A `<button>` and not a dead `<a>`**, which is the whole point of
               the `isWebUrl` gate: there must be no anchor whose `href` is a
               value we would not follow, disabled or otherwise. This one has no
               `href` to disable. */
            <IconButton
              label={openLabel(entry, false)}
              titled={false}
              disabled
            >
              <ExternalLink size={14} />
            </IconButton>
          )}
        </ActionTip>

        {/* **Two cards, because the sentence is false for one of them.** The
            first version told every reader the link opened for nobody but them,
            over a shelf that knows perfectly well which articles are shared —
            `visibility` is on the entry precisely so the shelf can tell.
            GPT Sol, 2026-09-05. */}
        <ActionTip
          id="copy"
          armed={armed}
          onArm={setArmed}
          tip={entry.visibility === "public" ? TIPS.copyShared : TIPS.copy}
          commits
        >
          <IconButton
            label={copied ? "Copied" : "Copy link"}
            titled={false}
            onClick={copy}
          >
            {copied ? <Check size={14} className="tw:text-highlight" /> : <Copy size={14} />}
          </IconButton>
        </ActionTip>

        {/* **"Archive", and a box rather than a bin.** It said "Delete" with a
            `Trash2` in it until 2026-09-04, over a handler that has always been
            `shelf.archive` — and a reader filed a report asking for the archive
            feature this already was, because nothing on screen said it was
            reversible. The label, the icon and the red are all the same claim, so
            all three moved: `destructive` is gone too, because red is this app's
            word for *this cannot be undone* and undoing it is the whole design
            (docs/project/library.md § Archive, and Undo is the confirmation).
            The card now says the same thing in a sentence. */}
        {/* **Put back in Archive's place on an archived card** — which is on
            the shelf only while Archived is on (plan 260929a, Sol R4). One
            slot, so the row is five buttons either way. "Put back" because the
            metadata page already calls this act that: one act, one name. The
            internal key stays `restore`, after `shelf.restore`, which it calls;
            nothing visible is drawn from it. */}
        {isArchived(entry) ? (
          <ActionTip id="restore" armed={armed} onArm={setArmed} tip={TIPS.restore} commits>
            <IconButton label="Put back" titled={false} onClick={actions.restore}>
              <ArchiveRestore size={14} />
            </IconButton>
          </ActionTip>
        ) : (
          <ActionTip
            id="archive"
            armed={armed}
            onArm={setArmed}
            tip={archivedShown ? TIPS.archiveShown : TIPS.archive}
            commits
          >
            <IconButton
              label="Archive"
              titled={false}
              onClick={actions.archive}
            >
              <Archive size={14} />
            </IconButton>
          </ActionTip>
        )}
      </RowGroup>
    </div>
    <ShelfActionsMenu entry={entry} actions={actions} />
    </>
  );
}

/**
 * The row's own `TooltipGroup`, unless it has `joined` one above it —
 * `Actions` § `inTooltipGroup` says why that matters.
 */
function RowGroup({ joined, children }: { joined: boolean; children: ReactNode }) {
  return joined ? (
    children
  ) : (
    <TooltipGroup delay={{ open: 240, close: 90 }} timeoutMs={400}>
      {children}
    </TooltipGroup>
  );
}

/**
 * The re-fetch button's accessible name, which has to carry what the card
 * carries — a screen reader is given the card as a *description* and may not
 * reach it at all, so why this one rebuilds without fetching belongs in the
 * name as well (feedback 6B, 2026-09-30: it used to say why it was
 * unavailable).
 *
 * **And the menu's visible words**, since 2026-09-15: `ShelfActionsMenu` draws
 * this string as its item's text, so the word a finger reads and the name a
 * screen reader hears on the row are one string and cannot drift.
 */
function rerunLabel(hasWebUrl: boolean, canRerun: boolean, rerunning: boolean): string {
  if (rerunning) return "Queueing…";
  if (hasWebUrl) return "Re-fetch and rebuild";
  return canRerun
    ? "Rebuild from the stored copy (nothing to fetch)"
    : "Rebuild (no web address and no reusable stored copy)";
}

/**
 * "Open the original"'s name, in its three versions — `rerunLabel`'s twin, for
 * the same two readers: the row's accessible name, and the menu's visible text.
 * Lifted out of the row's JSX on 2026-09-15 when the menu needed the same words.
 */
function openLabel(entry: LibraryEntry, hasWebUrl: boolean): string {
  if (hasWebUrl) return "Open the original page";
  return entry.url
    ? "Open the original page (the recorded address is not a web page)"
    : "Open the original page (no address recorded)";
}

/**
 * One menu item's look: finger-sized, and quiet until it is the one in focus.
 *
 * `min-h-10` — 40px, the house number for a thumb
 * (docs/project/narrow-windows.md § What a control owes a finger); the row's
 * icons were 28px. `data-highlighted` and `data-disabled` are the attributes
 * Radix writes, so the item needs no state of its own to know either.
 */
const ITEM =
  "tw:flex tw:min-h-10 tw:cursor-default tw:select-none tw:items-center tw:gap-2.5 tw:rounded-[3px] tw:px-2.5 tw:py-1.5 tw:text-sm tw:leading-snug tw:text-foreground tw:no-underline tw:outline-none tw:data-highlighted:bg-highlight/10 tw:data-disabled:text-muted-foreground";

/**
 * **The five as a menu of words, behind one "⋯"** — what a device with a finger
 * is drawn instead of the row. docs/plans/260915b-shelf-actions-reachable-on-touch.md.
 *
 * Greg, 2026-09-12, on an iPad: *"there didn't seem to be a way to access them
 * … add a drop-down button to display them"*. The row was there; five grey
 * glyphs with no words did not say they were the options he was looking for. A
 * list of words does, and that is also why nothing here reveals before it acts:
 * the label *is* the explanation, and Archive's Undo strip is the confirmation
 * it has always had.
 *
 * **Radix `DropdownMenu`**, from the `radix-ui` package the shelf already takes
 * `RadioGroup` from, for the parts that are easy to get wrong by hand: dismissal
 * by Escape and by a tap outside, focus into the list and back, arrow keys, a
 * portal so the list is not under the card's stretched link, and flipping at
 * the screen's edge.
 *
 * **An unavailable item is drawn, disabled, with its reason in its words** —
 * `rerunLabel` and `openLabel`, the strings the row's buttons are named with.
 * And "Open the original" is an `<a>` only for a web address: there must be no
 * anchor whose `href` is a value we would not follow (library.md § When a
 * button cannot do its job). A real anchor, through `asChild`, so ⌘-click and
 * "copy link address" survive on a touchscreen laptop, where a mouse meets this
 * menu too. GPT Sol, 2026-09-15.
 */
function ShelfActionsMenu({ entry, actions }: { entry: LibraryEntry; actions: ShelfActions }) {
  const { copied, rerunning, hasWebUrl, canRerun, copy, rerun, archive, restore, edit } = actions;
  const [open, setOpen] = useState(false);

  /**
   * **A finger press and whether the menu was open when it began** — recorded
   * at `pointerdown`, and good for one gesture.
   *
   * Radix's trigger toggles on `pointerdown` for every pointer type, which is
   * right for a mouse and wrong for a finger: a finger that lands on "⋯" at the
   * start of a scroll of the shelf would open the menu, and a tap would draw the
   * list under the finger before it lifts. So a finger's press is taken at the
   * click — which is the browser's own verdict that this was a tap and not a
   * scroll.
   *
   * **Decided at `pointerdown`, never read off the click**, because on iOS 18.2
   * and later a finger's click reports `pointerType` `mouse` (WebKit bug 282988)
   * while its `pointerdown` says `touch`. That bug is what stopped
   * `pressCapture` working on an iPad; this is the shape of the fix.
   *
   * The starting state matters on a second tap. The trigger is outside the
   * portalled menu, so Radix's modal dismissal can close the menu during that
   * `pointerdown`; blindly toggling the latest state at `click` would then open
   * it again. Remembering `wasOpen` makes the click finish the transition the
   * finger began: closed to open, or open to closed.
   *
   * **One gesture's lifetime**, GPT Sol's plan review: cleared by
   * `pointercancel` (the browser took the press for a scroll), consumed by the
   * click that reads it, and ignored by a keyboard's click — `detail === 0` —
   * because Enter and Space have already toggled the menu through Radix's own
   * key handler, and a "finger" left over from an earlier scroll must not toggle
   * it shut again. tests/shelf-actions-menu.test.tsx has a case for each.
   */
  const fingerPress = useRef<{ wasOpen: boolean } | null>(null);

  /**
   * Set when Edit title is chosen, so Radix does not hand focus back to the
   * trigger when the menu closes. On a card the trigger is gone by then — the
   * card draws `TitleEditor` where the actions were — and in the table, where it
   * survives, focus returned to it would be taken from the editor. Either way
   * the editor, which focuses itself, should keep it.
   */
  const editing = useRef(false);

  return (
    /* `relative`, so the trigger sits above the card's stretched title link and
       a tap on it is not a tap on the article. `hidden` unless there is a
       finger — the other half of the switch in `Actions`. */
    <div className="tw:relative tw:hidden tw:shrink-0 tw:any-pointer-coarse:flex">
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger
          /* Required, not decoration: the menu is portalled away from its card,
             Radix names it from this, and it is the only place the article's
             title reaches it. GPT Sol, 2026-09-15. */
          aria-label={`Actions for ${entry.title}`}
          onPointerDown={(e) => {
            const finger = e.pointerType === "touch" || e.pointerType === "pen";
            fingerPress.current = finger ? { wasOpen: open } : null;
            /* `preventDefault` is what makes Radix stand aside: its
               `composeEventHandlers` runs ours first and skips its own toggle
               when the event comes back prevented (@radix-ui/primitive 1.1.7).
               It does not suppress the click that follows — the Pointer Events
               spec keeps the two apart — and that click is where we open. */
            if (finger) e.preventDefault();
          }}
          onPointerCancel={() => {
            fingerPress.current = null;
          }}
          onClick={(e) => {
            const press = fingerPress.current;
            fingerPress.current = null;
            if (press && e.detail !== 0) setOpen(!press.wasOpen);
          }}
          className="tw:relative tw:inline-flex tw:size-10 tw:items-center tw:justify-center tw:rounded-md tw:text-muted-foreground tw:transition-colors tw:hover:bg-highlight/10 tw:hover:text-foreground tw:data-[state=open]:bg-highlight/10 tw:data-[state=open]:text-foreground"
        >
          <Ellipsis size={18} aria-hidden="true" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="end"
            sideOffset={4}
            collisionPadding={10}
            onCloseAutoFocus={(e) => {
              if (!editing.current) return;
              editing.current = false;
              e.preventDefault();
            }}
            /* The tooltip card's surface (styles/tooltip.css § .tooltip) in its
               tokens — raised, opaque, the strong rule, the same shadow —
               because this is the same kind of thing, drawn over the shelf.
               `z-[100]` for the reason `.tooltip-anchor` gives: frontmost,
               drawer included. Radix copies the content's z-index onto the
               wrapper it positions. */
            className="tw:z-[100] tw:min-w-[13rem] tw:max-w-[min(22rem,calc(100vw-1.75rem))] tw:rounded-[5px] tw:border tw:border-rule-strong tw:bg-surface-raised tw:p-1 tw:shadow-[0_1px_2px_rgb(0_0_0/0.5),0_8px_24px_-6px_rgb(0_0_0/0.65)]"
          >
            <DropdownMenu.Item
              className={ITEM}
              onSelect={() => {
                editing.current = true;
                edit();
              }}
            >
              <Pencil size={16} aria-hidden="true" className="tw:shrink-0" />
              <span>Edit title</span>
            </DropdownMenu.Item>

            {/* Not on a paper not read through yet — the row's reason. */}
            {entry.processing !== "minimal" && (
              <DropdownMenu.Item
                className={ITEM}
                disabled={!canRerun || rerunning}
                onSelect={() => void rerun()}
              >
                <RefreshCw
                  size={16}
                  aria-hidden="true"
                  className={`tw:shrink-0${rerunning ? " cmt-spinner" : ""}`}
                />
                <span>{rerunLabel(hasWebUrl, canRerun, rerunning)}</span>
              </DropdownMenu.Item>
            )}

            {hasWebUrl ? (
              <DropdownMenu.Item className={ITEM} asChild>
                {/* noreferrer as well as noopener, as on the row: the site is
                    not told which of the reader's articles pointed at it. */}
                <a href={entry.url} target="_blank" rel="noopener noreferrer">
                  <ExternalLink size={16} aria-hidden="true" className="tw:shrink-0" />
                  <span>{openLabel(entry, true)}</span>
                </a>
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item className={ITEM} disabled>
                <ExternalLink size={16} aria-hidden="true" className="tw:shrink-0" />
                <span>{openLabel(entry, false)}</span>
              </DropdownMenu.Item>
            )}

            {/* **Stays open when chosen**, GPT Sol's plan review: Radix closes
                a menu on select, and the confirmation is this item's own
                "Copied" — a menu that shut at once would take it along. The
                reader dismisses it, as they would any menu. */}
            <DropdownMenu.Item
              className={ITEM}
              onSelect={(e) => {
                e.preventDefault();
                copy();
              }}
            >
              {copied ? (
                <Check size={16} aria-hidden="true" className="tw:shrink-0 tw:text-highlight" />
              ) : (
                <Copy size={16} aria-hidden="true" className="tw:shrink-0" />
              )}
              <span>{copied ? "Copied" : "Copy link"}</span>
            </DropdownMenu.Item>

            {isArchived(entry) ? (
              <DropdownMenu.Item className={ITEM} onSelect={restore}>
                <ArchiveRestore size={16} aria-hidden="true" className="tw:shrink-0" />
                <span>Put back</span>
              </DropdownMenu.Item>
            ) : (
              <DropdownMenu.Item className={ITEM} onSelect={archive}>
                <Archive size={16} aria-hidden="true" className="tw:shrink-0" />
                <span>Archive</span>
              </DropdownMenu.Item>
            )}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}

/**
 * The five controls, named. `ActionTip` puts one on its trigger as
 * `data-action`, and `actionAt` reads it back.
 *
 * The union is **derived from the list** rather than written beside it, so the
 * two cannot drift — a name added to one is added to both or neither.
 */
const KEYS = ["edit", "rerun", "open", "copy", "archive", "restore"] as const;
export type ActionKey = (typeof KEYS)[number];

/**
 * Which control the finger landed on, from wherever inside it the event started
 * — usually the `<svg>`, sometimes its `<path>`.
 *
 * Read off the DOM rather than from React identity because there is one handler
 * for the row rather than one per control (`pressCapture`), and `closest` is
 * what turns a point into a control.
 *
 * **The attribute is written by `ActionTip` from its own typed `id`, never by
 * hand in the JSX**, and that is not tidiness. `actionAt` answering `null` sends
 * `pressCapture` down its early return, which lets the press through — so a
 * mistyped `data-action="cop"` would not fail loudly, it would quietly restore
 * the tap-commits-blind bug for that one control, and every test that did not
 * happen to name it would stay green. Sourcing the attribute from the same value
 * that keys the state makes the class of mistake unwriteable. GPT Sol,
 * 2026-09-05.
 *
 * The `KEYS` check remains, because the DOM hands back a string either way and
 * `pressCapture` compares the result against typed state.
 */
function actionAt(target: EventTarget | null): ActionKey | null {
  if (!(target instanceof Element)) return null;
  const found = target.closest("[data-action]")?.getAttribute("data-action");
  return found && (KEYS as readonly string[]).includes(found) ? (found as ActionKey) : null;
}

/**
 * One card, in the placement the whole row shares.
 *
 * `bottom`, because the row sits at the top right of a card and in a table cell
 * on a dense row — above it is the window edge or the row before, and below it
 * is this article's own body, which is the thing the reader is least surprised
 * to have covered for a moment.
 *
 * **Controlled, and that is the risky part.** The card has to survive a tap and
 * outlive the `mouseleave` a tap synthesises, which needs an owner of "which
 * card is open" outside the tooltip — so `Actions` holds one `armed` for all
 * five. See its docstring, and the postmortem it cites, for what that costs.
 */
function ActionTip({
  id,
  armed,
  onArm,
  tip,
  commits,
  children,
}: {
  id: ActionKey;
  armed: { id: ActionKey; byTouch: boolean } | null;
  onArm: Dispatch<SetStateAction<{ id: ActionKey; byTouch: boolean } | null>>;
  tip: { head: string; what: string; how: string };
  /**
   * Whether a second tap would actually do anything.
   *
   * False for a control drawn unavailable, and then the card says nothing about
   * tapping again — the first tap has already given the reader everything this
   * control has, and inviting a second press that is designed to be refused is
   * worse than silence.
   */
  commits: boolean;
  children: ReactElement<Record<string, unknown>>;
}) {
  return (
    <Tooltip
      placement="bottom"
      keepSide
      className="tip-soon"
      open={armed?.id === id}
      /**
       * **A close only counts from the control that is actually open.**
       *
       * `onOpenChange(false)` is not a statement that this tooltip was open:
       * `useDelayGroup` fires it at every *other* member the moment one opens,
       * and `useHover`'s close timer fires it 90ms after the pointer left,
       * by which time the card it would close may be a neighbour's. Unguarded,
       * with one state behind five triggers, the row's cards would flicker and
       * vanish — which is precisely what happened to the spine's fifty:
       * docs/postmortems/260828g-spine-hover-cards.md, and this is its fix.
       */
      onOpenChange={(v: boolean) =>
        onArm((prev) => (v ? { id, byTouch: false } : prev?.id === id ? null : prev))
      }
      content={
        <ControlTip
          head={tip.head}
          what={tip.what}
          how={tip.how}
          tap={commits && armed?.id === id && armed.byTouch ? "Tap again to do it." : undefined}
        />
      }
    >
      {/* **The trigger is marked here, from the same `id` that keys the state**
          — see `actionAt` for why writing it by hand in the JSX is a bug
          waiting to happen rather than a style. `cloneElement` rather than a
          wrapper element, because the row is a flex line of 28px squares and an
          extra box in it would have to be given a layout of its own; `Tooltip`
          clones this again for its ref and handlers, and props survive both. */}
      {cloneElement(children, { "data-action": id })}
    </Tooltip>
  );
}
