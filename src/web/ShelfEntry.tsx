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
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type ReactElement,
  type SetStateAction,
} from "react";
import {
  Archive,
  Check,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  MessageCircle,
  Pencil,
  RefreshCw,
} from "lucide-react";
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
export function SharedBadge() {
  return (
    <span
      className="tw:inline-flex tw:items-center tw:gap-1 tw:rounded tw:border tw:border-highlight/40 tw:px-1.5 tw:py-0.5 tw:text-highlight"
      title={SHARING_ON}
    >
      <Globe size={11} />
      {SHARING_BADGE}
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
   * `fetch`, `extract`, `blocks`, `hierarchy`, `assets`. The arc, the glossary,
   * the quotes, the timeline and the rest are not rebuilt, and saying "the
   * whole pipeline" promised a reader something this button does not do.
   */
  rerun: {
    head: "Re-fetch and rebuild",
    what: "Fetches the page again and reads it afresh: the text is re-extracted, the blocks and the hierarchy are rebuilt, and the article's images are re-hosted.",
    how: "A few minutes, and it spends model calls. What you have written stays where the text did — notes are keyed to block ids, which are minted once and kept, so only a passage the page itself has rewritten can lose its marker.",
  },
  /**
   * **The button that used not to be drawn at all.**
   *
   * It queued a job whose first step failed with "No source URL", every time,
   * having looked exactly like a button that ought to work — so on 2026-08-27
   * it was deleted where there was nothing to fetch. That fixed the dead
   * button and left a row that is five wide on one card and three on the next,
   * which is what Greg noticed on 2026-09-05: *"sometimes I see them,
   * sometimes I don't"*. Drawn and unavailable is the answer to both.
   *
   * **It does not say why there is no address.** "You uploaded this" is a claim
   * assembled from a gap in our own files, and an ordinary web article can be
   * published with no `requested_url` and no `final_url` at all — the same
   * reasoning, and the same refusal, as Metadata.tsx § `uploaded`.
   */
  rerunNoUrl: {
    head: "Re-fetch and rebuild",
    what: "We have no record of an address for this article, so there is nothing to fetch again.",
    how: "Everything already built from it is unaffected and stays on the shelf. The article's own metadata page shows what we do know about where it came from.",
  },
  /**
   * **And the same gate as the link**, since GPT Sol's review on 2026-09-05.
   * The first version keyed the re-fetch on `entry.url` alone, so a
   * `javascript:` or `mailto:` address got a live button — and stage 1 refuses
   * anything but http(s) (src/fetch.ts), so it queued a job that always failed.
   * That is precisely the dead button the 2026-08-27 fix was about, reached by
   * the other door.
   */
  rerunNotWeb: {
    head: "Re-fetch and rebuild",
    what: "The address recorded for this article is not one we can fetch.",
    how: "Only http and https are followed. The job would be accepted and then fail at its first step, so the button does not offer it.",
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
} as const;

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
 * buttons the reader is about to hover.
 *
 * **And on a finger, the first tap reads a control and the second presses it**
 * — `pressCapture` below. docs/project/touch.md § Reveal, then commit.
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

  /* **Only where there is something to re-fetch.** An uploaded PDF has no
     address, and neither has an article old enough to predate our recording
     one — so this button queued a job whose first step failed with "No source
     URL", every time. Keyed on the URL rather than on "is it an upload",
     because that is the actual precondition and it covers both cases. GPT Sol,
     2026-08-27.

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

  return (
    /* `opacity`, never `display: none` — a hidden element is not focusable, so
       hiding the row until hover would delete it outright for anyone navigating
       by keyboard, and every check done with a mouse would look fine.
       `hover-none:opacity-100` is the other half: on a touch screen there is no
       hover, so without it these buttons stayed invisible AND hit-testable —
       controls you cannot see but can press by accident. Caught by a
       cross-family review, 2026-08-26. */
    <div
      className="tw:relative tw:flex tw:shrink-0 tw:items-center tw:gap-0.5 tw:opacity-0 tw:transition-opacity tw:group-hover:opacity-100 tw:group-focus-within:opacity-100 tw:hover-none:opacity-100"
      onClickCapture={pressCapture}
    >
      <TooltipGroup delay={{ open: 240, close: 90 }} timeoutMs={400}>
        <ActionTip id="edit" armed={armed} onArm={setArmed} tip={TIPS.edit} commits>
          <IconButton label="Edit title" titled={false} onClick={onEdit}>
            <Pencil size={14} />
          </IconButton>
        </ActionTip>

        <ActionTip
          id="rerun"
          armed={armed}
          onArm={setArmed}
          tip={hasWebUrl ? TIPS.rerun : entry.url ? TIPS.rerunNotWeb : TIPS.rerunNoUrl}
          commits={hasWebUrl && !rerunning}
        >
          {/* **The name says which of the two absences this is**, and not merely
              that there is one. A screen reader gets no card, so the parenthesis
              is the only place the reason reaches it — and a name reading "no
              address" over an article that has one, of a scheme we will not
              follow, contradicts the card beside it. GPT Sol, 2026-09-05. */}
          <IconButton
            label={rerunLabel(entry, hasWebUrl, rerunning)}
            titled={false}
            onClick={() => void rerun()}
            disabled={!hasWebUrl || rerunning}
          >
            <RefreshCw size={14} className={rerunning ? "cmt-spinner" : undefined} />
          </IconButton>
        </ActionTip>

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
              aria-label="Open the original page"
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
              label={
                entry.url
                  ? "Open the original page (the recorded address is not a web page)"
                  : "Open the original page (no address recorded)"
              }
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
        <ActionTip id="archive" armed={armed} onArm={setArmed} tip={TIPS.archive} commits>
          <IconButton
            label="Archive"
            titled={false}
            onClick={() => void shelf.archive(entry.slug)}
          >
            <Archive size={14} />
          </IconButton>
        </ActionTip>
      </TooltipGroup>
    </div>
  );
}

/**
 * The re-fetch button's accessible name, which has to carry what the card
 * carries — a screen reader is given the card as a *description* and may not
 * reach it at all, so the reason an unavailable control is unavailable belongs
 * in the name as well.
 */
function rerunLabel(entry: LibraryEntry, hasWebUrl: boolean, rerunning: boolean): string {
  if (hasWebUrl) return rerunning ? "Queueing…" : "Re-fetch and rebuild";
  return entry.url
    ? "Re-fetch and rebuild (the recorded address cannot be fetched)"
    : "Re-fetch and rebuild (no address recorded)";
}

/**
 * The five controls, named. `ActionTip` puts one on its trigger as
 * `data-action`, and `actionAt` reads it back.
 *
 * The union is **derived from the list** rather than written beside it, so the
 * two cannot drift — a name added to one is added to both or neither.
 */
const KEYS = ["edit", "rerun", "open", "copy", "archive"] as const;
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
