/**
 * The bottom bar, and the drawer that rises out of it.
 *
 * The app's furniture: the things that are about *this article* but are not the
 * article — the questions you have asked, where it came from, what else it can
 * be turned into. Everything here is one click from the reading view and none
 * of it is in the way of it.
 *
 * **The way home is not here any more.** It was the leftmost button until
 * 2026-08-26; it is now the wordmark fixed in the very top-left of the window
 * (HomeLogo.tsx), which is where every site on the web has kept it for twenty
 * years. Greg's call, and it buys the bar a slot back.
 *
 * ## Why the bottom
 *
 * This started as a left-hand sidebar, modelled on the original version's icon
 * rail (docs/project/original-version/reading-view-ui.md). Greg, 2026-08-25:
 *
 * > What's the alternative? I suppose we could put it at the bottom? Would that
 * > be simpler to implement? If so, let's do that for now.
 *
 * It is simpler, and for one reason worth stating plainly: **this view's hard
 * problem is horizontal and the bottom edge is vertical.** layout.ts spends its
 * whole length negotiating width — it shrinks the gist columns, and when that
 * is not enough it starts dropping levels. Anything permanent down the left
 * joins that negotiation: a new `--rail-w` term in five CSS rules, a new
 * constant beside `SPINE_W`, a new interaction with the spine's on/off,
 * and a band of window widths where a column is dropped that used to fit. A bar
 * at the bottom takes height, and height is the axis where nothing is scarce —
 * the page simply scrolls. `fitView` never hears about this file.
 *
 * Full reasoning, and the right-hand edge that was offered and turned down:
 * docs/plans/bottom-bar.md.
 *
 * ## The three things that had to move over
 *
 *  - `.cmt-dialog` sits bottom-right and would have been half under the bar.
 *  - the "there is more over here" fade ran to `bottom: 0`.
 *  - `.tooltip` was at z-index 80, under the drawer — see the note on Z below.
 *
 * ## Three kinds of button, said out loud
 *
 * The bar used to be uniform: every button opened a drawer. It isn't any more.
 * `Tweets` and `Metadata` navigate; `Questions` opens a drawer *on the
 * reading view* and navigates everywhere else; `Hierarchy` / `Summary` /
 * `Glossary` / `Search` / `Chat`
 * choose what the middle of the page **is**. That is three real differences and
 * the markup has to tell the truth about each — a link gets
 * `aria-current="page"`, a drawer trigger gets `aria-expanded`, and the mode
 * switch is a `role="radiogroup"` of `aria-checked` buttons, because exactly one
 * of the three is always true. Using any one of them for another kind announces
 * the wrong thing to a screen reader while looking identical on screen. Hence
 * `DockLink`, `DockTab` and `DockModes` below rather than one component with
 * flags.
 *
 * **The bar looks the same on all three pages and is not the same component
 * twice.** What varies is whether a `drawer` was handed in. Only the reading
 * view has the comments, because only it pays for them: `useComments(slug)`
 * fetches on mount, and a visit to the metadata page should not buy a drawer
 * nobody opened. So off the reading view, Questions is a link back to it with
 * `?panel=questions` — which is also where a question is worth opening, since
 * clicking one scrolls to the passage it is about.
 *
 * The button was `About` and became a link on 2026-08-25, when its drawer panel
 * grew into a page of its own at `/read/<slug>/metadata`. It is labelled
 * `Metadata` now, after the page it opens, rather than after the panel it was.
 * Greg, on what should happen to the panel once the page existed:
 *
 * > We can get rid of the panel, and move all its contents into the new page.
 *
 * So there is no About panel here any more, and the markup it used to render
 * lives in Metadata.tsx. See docs/plans/metadata-page.md.
 *
 * ## The order, which Greg set by hand
 *
 * Left to right: Hierarchy, Summary, Glossary, Search, Chat, Questions, Tweets,
 * Metadata. Greg, 2026-08-26 — *"Rearrange the buttons in the bottom-bar. It
 * should be Hierarchy, Summary, Glossary, Search, Chat, Questions, Thread
 * (renamed to 'Tweets'), Metadata."*
 *
 * It is not arbitrary, and the shape is worth naming so the next button knows
 * where to go: **the five modes come first, then the things that leave the
 * band.** Inside the modes it runs from the article's own words outwards —
 * Hierarchy and Summary are the article restated, Glossary and Search are ways
 * into it, Chat is a conversation about it. Then Questions (yours), Tweets
 * (the article rewritten for somewhere else) and Metadata (the machinery).
 * A new mode goes in MODES_UI; anything else goes after them.
 *
 * `Thread` became `Tweets` in the same breath, matching the page's own name
 * (Tweets.tsx, `/read/<slug>/tweets`) and the route the button already pointed
 * at. The label was the only place the old word survived.
 */
// `ReactKeyboardEvent`, aliased: React's KeyboardEvent and the DOM's are different
// types, and this file uses both — the drawer's Escape listener is on `window`
// and takes the DOM one.
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import {
  BookA,
  Lightbulb,
  ChevronUp,
  Clock,
  Focus,
  LoaderCircle,
  Network,
  Info,
  Layers,
  ListOrdered,
  ListTree,
  MessageSquareText,
  MessagesSquare,
  Search,
  Speech,
  X,
  Quote,
} from "lucide-react";
import type { Comment } from "../types.js";
import { DEFAULT_MODE, type Mode, type Panel } from "./params.js";
import { Link } from "./Link.js";
import { type ArticleView, carriedSearch, readHref } from "./router.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";
import { useSlow } from "./useSlow.js";
import { InstallHint } from "./InstallHint.js";
import { VisitorNotice } from "./PublicChrome.js";
import { COMMENTS_GAP } from "./visitor.js";

interface Props {
  /**
   * The slug from the *path*, not `article.meta.slug`.
   *
   * They differ for the committed fixture, whose meta.json names the full
   * article it is an excerpt of — so building a link out of the meta slug would
   * send you to a different article, and one that exists, so nothing would look
   * broken. See src/api.ts § FIXTURE_SLUG.
   */
  slug: string;
  /** Which of the article's pages this bar is sitting on. */
  view: ArticleView;
  /**
   * Which mode owns the middle band, and how to change it — the reading view
   * only. See params.ts § modeParam and docs/plans/chat-mode.md.
   *
   * Optional for the same reason `drawer` is: the metadata and thread pages
   * have no middle band to put a mode in, so their Chat button is a link back
   * to the reading view rather than a switch that would have nothing to switch.
   */
  mode?: Mode;
  onMode?(next: Mode): void;
  /**
   * The drawer, on the one page that has one.
   *
   * **Absent everywhere else, and that is the point.** `useComments(slug)`
   * fetches on mount, so a Dock that always took comments would charge a visit
   * to the metadata page a request for a drawer nobody opened. Without this,
   * the Questions button becomes a link back to the reading view with
   * `?panel=questions` — same button, same place, and the questions open where
   * they are useful, which is beside the prose they are about.
   *
   * One object rather than four optional props, so the four cannot be passed
   * apart: they are meaningless individually.
   */
  /**
   * Mode buttons drawn dimmed, because this reader will meet a boundary in
   * them — a visitor on somebody's shared document. Empty for the owner.
   *
   * **They stay pressable, and that is the design rather than an oversight.**
   * The reason a mode is marked must not live only in a hover tooltip: NN/G's
   * rule is that a tooltip may never be the only carrier of information a
   * person needs, and a hover tooltip is unreachable by touch and by keyboard.
   * So pressing a marked mode opens its band and the band carries the sentence
   * in visible text — see `VisitorBand` in PublicChrome.tsx. The dimming and
   * the tooltip line below are the supplement, never the message.
   * docs/research/public-access-how-others-do-it.md § 2.
   */
  marked?: ReadonlyMap<Mode, string> | undefined;
  /**
   * Whether this reader has an account — read **only** by the visitor drawer's
   * call to action. reader-capability.ts § signedIn.
   */
  signedIn?: boolean | undefined;
  /**
   * **Whether this article is theirs**, which is a different question from
   * `signedIn` and the one every other piece of chrome keys on.
   *
   * Needed separately from `drawer` because the drawer's *shape* is not a
   * reliable proxy for footing: the metadata and tweets pages mount the bar
   * without one, and they exist for both readers. Inferring from its absence is
   * what left two of the three visitor pages saying "Your comments".
   */
  visitor?: boolean | undefined;
  drawer?: {
    /** Comments in reading order — App already sorts them, see comment-nav.ts. */
    comments: Comment[];
    /**
     * Has the comments fetch come back, and did it work? `CommentsApi`.
     *
     * Only the empty state needs these, and it needs both: an empty list is
     * what this panel holds *before* the request lands, *after* it came back
     * with nothing, and *after* it failed — and only the middle one of those is
     * "nothing asked yet".
     * docs/project/web-client.md § Empty is not the same as not asked yet.
     */
    loaded: boolean;
    loadFailed: boolean;
    /** Which panel is open, or null for a shut drawer. From `?panel=`. */
    panel: Panel | null;
    onPanel(next: Panel | null): void;
    /** Open a question's dialog and bring its passage into view. */
    onOpenComment(id: string): void;
    /** Never set on this arm — see the visitor arm below. */
    visitor?: false;
  } | {
    /**
     * The drawer a **visitor** gets: it opens, and what is in it is the
     * sentence about whose comments these would be.
     *
     * A separate member of the union rather than five optional fields, so
     * there is no `comments: []` for a later edit to read and no `loaded`
     * for it to test. The five that are missing are missing because there is
     * nothing to fetch — `useComments` is not mounted anywhere on a shared
     * document. docs/plans/public-read-only-access.md.
     *
     * The alternative was passing no drawer at all, which degrades the
     * Comments button to a link back to the page it is already on. A control
     * that does nothing is exactly what marking-rather-than-hiding exists to
     * avoid.
     */
    visitor: true;
    panel: Panel | null;
    onPanel(next: Panel | null): void;
  };
}

/**
 * ## The dimmed placeholders are gone, and where the last one went
 *
 * This file used to end with a `SOON` list — ideas built once in the original
 * version, kept as dimmed buttons with a tooltip saying the one thing that
 * project learned the hard way. Greg, 2026-08-25: *"Also see
 * docs/project/original-version/overview.md for ideas - for now, add extra
 * ideas as placeholders with rich tooltips."* The "for now" ran out. Search
 * and Highlights became the Search mode; the last one standing was **Reading
 * time**, and Greg, 2026-08-26:
 *
 * > And get rid of "Reading time" - that should be part of "Metadata".
 *
 * It already was: the metadata page has read time as one of its six stat cards
 * (Metadata.tsx § At a glance), with a tooltip that says it is words ÷ 230 and
 * a flat rate. So the bar was offering a button for something a page already
 * answered. The one thing the placeholder carried that the page did not — that
 * the original version dropped the readability formulas for a model's
 * judgement, then scaled the estimate by how confident the model was — is now
 * written into that card's tooltip, which is where somebody wondering about
 * the number will actually meet it.
 *
 * The convention is not dead: Metadata.tsx keeps its own `SOON` list in the
 * same shape, for things *that page* should say and cannot yet. What died here
 * is the idea that the bar is a good place to advertise unbuilt features — a
 * bar is for pressing.
 *
 * **Both of the features that list used to say we would never build are now
 * buttons in this bar**, and that is worth reading before writing a third
 * refusal anywhere. Tweet threads were "simply not what this is", written a
 * few hours before Greg asked for them. Chat was the stronger objection — its
 * own docs single it out as the one to be most suspicious of, and it sits
 * closest to our anti-goals (vision.md). Neither objection was waved away;
 * both are answered at length, in
 * docs/plans/tweet-thread-page.md#say-the-awkward-thing-first and in
 * docs/plans/chat-mode.md#say-the-awkward-thing-first. The chat that was built
 * is not the one that was refused: every claim it makes carries a block id and
 * the article stays on screen beside it.
 */

/**
 * Everything the middle band can be, in the order they sit in the bar.
 *
 * A table rather than hand-written buttons, because a radiogroup's keyboard
 * behaviour has to walk them: "the next mode" is only meaningful if there is a
 * list to be next in. Adding another is a row here — which is exactly what
 * Search and then Summary cost (docs/project/summaries.md).
 *
 * The order is deliberate and is not alphabetical: **contents first, because it
 * is the default** and the one you come back to. Left-to-right in the bar is
 * also the order the arrow keys travel, so the resting state being leftmost
 * means every other mode is reached by going right from the resting state.
 *
 * The other four were reordered by hand on 2026-08-26 — Summary, Glossary,
 * Search, Chat — and the reasoning is in the file header under "The order".
 * Short version: it runs from the article restated, through the ways into it,
 * to the conversation about it, and Chat is last because it is the one furthest
 * from the article's own words.
 */
const MODES_UI: { mode: Mode; icon: typeof Info; label: string; blurb: string }[] = [
  {
    mode: "hierarchy",
    icon: ListTree,
    label: "Hierarchy",
    blurb: "The article's own shape, one column per level of detail",
  },
  /* Straight after Hierarchy, because it answers the same question — what shape
     is this piece, and where am I in it — with one nested list instead of
     columns you read across. Greg set this order by hand and it runs from the
     article's own words outwards, so the two structural views belong together
     at the near end. docs/plans/outline-mode.md. */
  {
    mode: "outline",
    icon: Focus,
    label: "Outline",
    blurb:
      "The whole document in one list, with more detail on the part you are reading and less on the rest",
  },
  {
    mode: "summary",
    icon: Layers,
    label: "Summary",
    blurb:
      "The article, its parts and its sections, a sentence on each — as deep into the piece as you ask",
  },
  {
    mode: "glossary",
    icon: BookA,
    label: "Glossary",
    blurb: "The terms this piece uses in a non-obvious way, defined from the piece itself",
  },
  /* Straight after Glossary, because the order runs outwards from the article's
     own words and these two are the same kind of thing pointed at different
     units: a term is a word you look up, an idea is a proposition you hold.
     Greg set this order by hand, so a new mode goes where it belongs in his
     reasoning rather than on the end. */
  {
    mode: "ideas",
    icon: Lightbulb,
    label: "Ideas",
    blurb: "The propositions this piece needs you to hold — the ones it assumes, and the ones it adds",
  },
  /* Next again, and it belongs at this end of the order for the same reason
     Ideas does: the bar runs outwards from the article's own words, and this is
     the mode that is *closest* to them — every row is a sentence out of the
     piece rather than something a model wrote about it. Greg set this order by
     hand, so a new mode goes where it belongs in his reasoning rather than on
     the end. docs/project/quotes.md. */
  {
    mode: "quotes",
    icon: Quote,
    label: "Quotes",
    blurb: "The lines worth keeping — the piece's own sentences, chosen and checked against it",
  },
  /* **After Ideas and before Search**, which is Greg's placement (2026-08-31)
     and the reason it lands *here* rather than immediately after the Ideas row:
     Quotes arrived between the two the same day, and "after Ideas" is a
     position in the reasoning — with Glossary and Ideas, as a third "here is one
     dimension of this piece pulled out" — rather than an array index. It is
     further from the article's own words than either of those, and further than
     Quotes, so it goes at the far end of that group.
     docs/plans/timeline-mode.md § 3. */
  {
    mode: "timeline",
    icon: Clock,
    label: "Timeline",
    blurb: "When the piece says these things happened, in order — and how sure it actually is",
  },
  /* Search was **two** dimmed placeholders in the `SOON` list this file used to
     carry — `Search` and `Highlights`, side by side — and is one mode now. That
     is the design rather than a tidy-up: highlighting is what search *does to
     the page*, not a separate thing to press. Greg's call; see
     docs/project/search.md.

     The `Highlights` placeholder's note has not been lost. It said overlapping
     highlights need the CSS Custom Highlight API because a library that wraps
     matches in tags cannot nest them — which turned out to be about a wall we
     had already gone round, and the account of that is now at the top of
     annotate.ts where somebody adding a fifth kind of mark will meet it. */
  {
    mode: "search",
    icon: Search,
    label: "Search",
    blurb: "Find a passage by the words it uses, or by what it says",
  },
  /* Diagram sits between the ways *into* the article and the conversation about
     it, next to Summary rather than next to Chat, because it is the same move
     Summary makes — the article restated — with a picture instead of prose. */
  {
    mode: "diagram",
    icon: Network,
    label: "Diagram",
    blurb: "The article's shape as a picture: as an outline, as a graph, or as paragraphs placed by meaning",
  },
  {
    mode: "chat",
    icon: MessagesSquare,
    label: "Chat",
    blurb: "Ask about this article — answers point back at the paragraphs they came from",
  },
  /* Last, and one step further out than Chat, which is the end of the ordering
     this list has followed since Greg set it by hand: it runs from the article
     restated, through the ways into it, to the conversation about it. Review is
     the only mode whose content comes from the READER — it cannot be used at
     all until they have read the piece — so it belongs past the point where the
     article's own words run out. docs/plans/review-mode.md. */
  {
    mode: "review",
    icon: Speech,
    label: "Review",
    blurb: "Say what you took from this, and find out where it holds up",
  },
];

export function Dock({ slug, view, mode, onMode, marked, signedIn, visitor, drawer }: Props) {
  const panel = drawer?.panel ?? null;
  const open = panel !== null;
  /* Narrowed once, so the four reads below are the compiler checking one fact
     rather than four independent tests that could drift apart. */
  const own = drawer && drawer.visitor !== true ? drawer : null;
  /* Either signal says visitor: the prop, or a drawer that declared itself one.
     Two spellings of one fact, and the older one is kept because the reading
     view already passes it that way. */
  const isVisitor = visitor === true || drawer?.visitor === true;
  const pending = own?.comments.filter((c) => c.status === "pending").length ?? 0;

  /**
   * The view state the bar's links carry across, so leaving the article to look
   * at its metadata and coming back returns you to the paragraph you left.
   *
   * Read from `location` at render rather than from `useQueryState`. nuqs
   * writes the URL itself, so `location.search` is always the current one and a
   * subscription here would only be a second copy of it. What makes that safe
   * is that this bar re-renders whenever its page does, and the page is already
   * subscribed to every parameter in the string. If the bar is ever rendered
   * somewhere that is not, this needs to become a real subscription.
   *
   * `?panel=` is dropped on the way — see `carriedSearch` in router.ts.
   */
  const search = carriedSearch(location.search);

  /**
   * Escape closes the drawer, and the drawer wins.
   *
   * CommentDialog also listens for Escape on `window`, and both would otherwise
   * fire on one press — closing a dialog the reader could not even see under
   * the dim. Capture phase runs before any bubble-phase listener, so listening
   * here is what makes "the drawer wins" a fact rather than a question of which
   * component mounted first.
   *
   * `stopImmediatePropagation`, not `stopPropagation`. The two are identical
   * for a real key press, which targets an element and therefore has a
   * propagation path to cut. They differ when the event's target IS `window`:
   * there is no path, both listeners are on the same node, and plain
   * `stopPropagation` stops nothing — the dialog closes underneath the dim
   * anyway. Nothing in the app dispatches such an event today, and that is
   * exactly the sort of thing that stays true until it doesn't.
   */
  const onPanel = drawer?.onPanel;
  useEffect(() => {
    if (!open || !onPanel) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      onPanel(null);
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true });
  }, [open, onPanel]);

  return (
    <>
      {/* The dim. A button rather than a div so closing by clicking away is
          reachable from the keyboard too, and so screen readers are told there
          is something to press rather than being handed a decorative box. */}
      {open && drawer && (
        <button
          type="button"
          className="dock-scrim"
          aria-label="Close panel"
          onClick={() => drawer.onPanel(null)}
        />
      )}

      {panel !== null && drawer && (
        <div
          className="dock-drawer"
          role="dialog"
          aria-modal="true"
          aria-label={own ? TITLES[panel].own : TITLES[panel].visitor}
        >
          <div className="dock-drawer-head">
            {/* The wordmark used to sit here, and the note beside it said the
                app named itself *here and nowhere else* — true at the time, and
                the reason was that the drawer is shut while you read, so the
                brand was present without ever sitting beside the article's own
                title. That sentence stopped being true on 2026-08-26, when the
                logo took the top-left corner of the window (HomeLogo.tsx). Two
                wordmarks on screen at once is one too many, and the one in the
                corner is the one that is always there, so this one went. */}
            <h2>{own ? TITLES[panel].own : TITLES[panel].visitor}</h2>
            <button
              type="button"
              className="dock-close"
              onClick={() => drawer.onPanel(null)}
              title="Close (Esc)"
              aria-label="Close"
            >
              <X size={14} />
            </button>
          </div>
          {/* One panel, so no branch. There were two until the About panel
              became a page; if a second ever comes back, this is where it
              branches. */}
          <div className="dock-drawer-body">
            {own ? (
              <Questions
                comments={own.comments}
                loaded={own.loaded}
                loadFailed={own.loadFailed}
                onOpen={own.onOpenComment}
              />
            ) : (
              <VisitorNotice gap={COMMENTS_GAP} signedIn={signedIn ?? false} />
            )}
          </div>
        </div>
      )}

      {/* Above the bar rather than in it: it is a sentence, and the bar is eleven
          icons. Renders nothing at all except on an uninstalled iOS device that
          has not dismissed it — install-hint.ts. */}
      <InstallHint />

      <div className="dock">
        {/* **The modes, as one control, and first in the bar.** Chat and
            Glossary used to be two independent toggles beside each other, with
            `toc` unrepresented — you left a mode by pressing the one you were
            in. That worked and it lied about the shape of the thing: the middle
            band is always in exactly one state, and only some of them had
            buttons.

            Greg, 2026-08-25: *"Yes, make them a radio group, but as buttons,
            with nice icons and tooltips."*

            Giving `toc` a button of its own is what makes the radiogroup
            honest, and it is the trigger the previous note in this file named —
            not the arrival of a third mode, but the third mode being *visible*.
            See DockModes below. Off the reading view there is no band to switch,
            so the same five degrade to links back to it. */}
        {mode !== undefined && onMode ? (
          <DockModes mode={mode} onMode={onMode} marked={marked} />
        ) : (
          MODES_UI.map((m) => (
            <DockLink
              key={m.mode}
              href={readHref(slug, withMode(search, m.mode), "article")}
              current={false}
              icon={m.icon}
              label={m.label}
              className={marked?.has(m.mode) ? MARKED : ""}
              title={`${m.blurb} — back in the article itself`}
            />
          ))
        )}

        {/* Two shapes of the same button. On the reading view it opens the
            drawer in place. Everywhere else it goes back to the reading view
            with the drawer already open — which is where a question is useful
            anyway, since clicking one scrolls to the passage it is about, and
            these pages have no passages. No count off the reading view: this
            page did not fetch the comments, and a number would have to be
            guessed or paid for. */}
        {drawer ? (
          <DockTab
            panel="questions"
            current={panel}
            onPanel={drawer.onPanel}
            icon={MessageSquareText}
            label="Comments"
            className={own ? "" : MARKED}
            title={
              own
                ? "The passages you have marked on this article"
                : "Comments belong to whoever added this article"
            }
          >
            {/* No count for a visitor — there is nothing to count, and a `0`
                would read as "you have none" rather than "these are not
                yours". */}
            {own && own.comments.length > 0 && (
              <span className={`dock-count${pending ? " pending" : ""}`}>
                {own.comments.length}
              </span>
            )}
          </DockTab>
        ) : (
          <DockLink
            href={readHref(slug, withPanel(search, "questions"), "article")}
            current={false}
            icon={MessageSquareText}
            label="Comments"
            /* **Whose, and the visitor pages reach this arm too.**
               `PublicMetadataPage` and `VisitorPage` mount the bar with no
               drawer, which lands here — so two of the three visitor pages went
               on calling somebody else's comments *"Your comments"* after the
               reading view had been corrected. The heading inside the drawer
               was fixed and the link that leads to it was not. GPT Sol, second
               pass, 2026-08-28.

               `signedIn` is not the question; ownership is. A drawer-less bar
               belongs to the owner on the metadata and tweets pages of *their*
               article, and to a visitor on the public stand-ins. */
            title={
              isVisitor
                ? "Comments on this article, back in the article they are about"
                : "Your comments, back in the article they are about"
            }
          />
        )}

        {/* Labelled `Thread` until 2026-08-26, and `Tweets` now — after its own
            page and its own route, which is the same rule that renamed `About`
            to `Metadata`. The thread is written on demand and costs a model
            call, but that is a button on the page rather than a reason to hide
            the page. */}
        <DockLink
          href={readHref(slug, search, "tweets")}
          current={view === "tweets"}
          icon={ListOrdered}
          label="Tweets"
          title="The article as a numbered thread of short posts"
        />

        {/* A link, not a drawer trigger — the details are a page now. Last in
            the bar, which is the right end for it: it is the machinery behind
            the article rather than a way of reading it. */}
        <DockLink
          href={readHref(slug, search, "metadata")}
          current={view === "metadata"}
          icon={Info}
          label="Metadata"
          title="Where this article came from, what shape it is, and what the pipeline wrote"
        />
      </div>
    </>
  );
}

/**
 * The drawer's heading, and **it cannot be one string.**
 *
 * A visitor saw *"Your comments"* directly above *"Comments belong to whoever
 * added this article"* — the body correct, the heading backwards, and half a
 * second of doubt planted exactly where the copy is working hardest to
 * reassure. Found by a browser pass, 2026-08-28; no test would have caught it,
 * because both strings were individually right and nothing compared them.
 *
 * `Your` is the word that does not survive: true for the owner, whose drawer
 * this is, and false for everybody else.
 */
const TITLES: Record<Panel, { own: string; visitor: string }> = {
  questions: { own: "Your comments", visitor: "Comments" },
};

/**
 * A carried query string with a drawer panel asked for in it.
 *
 * `carriedSearch` has just stripped `?panel=` — deliberately, because a drawer
 * left open across a navigation is not a place you were. This puts one back
 * when the navigation is *for* the drawer, which is the one case where it is.
 */
function withPanel(search: string, panel: Panel): string {
  return search ? `${search}&panel=${panel}` : `panel=${panel}`;
}

/**
 * A carried query string with a mode asked for in it.
 *
 * The sibling of `withPanel`, and needed for the same reason: `carriedSearch`
 * strips view state that should not follow you across a navigation, and this
 * puts one back when the navigation is *for* it.
 *
 * Unlike `withPanel` it must overwrite rather than append — `?mode=` may
 * already be in the carried string, and `mode=toc&mode=chat` is a URL whose
 * meaning depends on which one the parser happens to read first.
 */
export function withMode(search: string, mode: Mode): string {
  const params = new URLSearchParams(search);
  /* **Delete rather than write when it is the default**, since 2026-08-29.
     This used to `set` unconditionally, which meant every navigation through the
     dock stamped `?mode=toc` into a URL a reader could copy and share — so when
     the mode was renamed there really were links in the wild carrying the old
     name, and the first draft of that rename claimed there could not be. They
     survive because an unrecognised mode falls back to the default
     (src/web/params.ts § modeParam), but that is a safety net rather than a
     plan. Omitting the default keeps new URLs canonical and stops the next
     rename inheriting the same problem. GPT Sol, 2026-08-29. */
  if (mode === DEFAULT_MODE) params.delete("mode");
  else params.set("mode", mode);
  return params.toString();
}

/**
 * The mode switch: one button per mode, one control, exactly one of them on.
 *
 * ## Why this is a radiogroup and was not one yesterday
 *
 * It was two independent `aria-pressed` toggles, and a note here argued — at
 * length, and correctly for the time — that a radiogroup would be the *worse*
 * lie: the bar showed Chat and Glossary but not `hierarchy`, so a two-option
 * radiogroup would have asserted that the band was one of two things while it
 * was routinely neither. That note named the trigger for changing it, and the
 * trigger was not a third mode arriving. It was **a Hierarchy button existing**
 * (it was called Contents until 2026-08-29),
 * which is what makes "one of these several" a true sentence.
 *
 * Greg asked for the group on 2026-08-25 and the button came with it, so the
 * condition was met by the same change that needed it.
 *
 * ## What a radiogroup costs, which is the part that is easy to skip
 *
 * `role="radiogroup"` is a promise about the keyboard, not a label. A screen
 * reader tells its user "radio group, five items" and they will then press an
 * arrow key. Three things make that promise good, and all three are load-bearing:
 *
 *  - **Roving tabindex.** The group is ONE tab stop, not three. The selected
 *    button is `tabIndex={0}` and the others are `-1`, so Tab moves past the
 *    whole control the way it moves past a single button.
 *  - **Arrows move and select in one gesture.** Radios activate on focus; there
 *    is no separate "now press Space". Left/Up go back, Right/Down go forward,
 *    Home/End jump to the ends, and all of them wrap.
 *  - **Focus follows the selection**, which is why `refs` exists. Changing the
 *    mode re-renders with a different button at `tabIndex={0}`, and without
 *    moving focus there deliberately, focus would be left on a button that is
 *    now unreachable by Tab — the reader's next arrow press would go nowhere.
 *
 * ## The one collision, and which way it was settled
 *
 * All four arrows are the article's (keynav.ts, listening on `window`): ↑ / ↓
 * step through it and ← / → choose the level they step by. That guard ignores
 * keys typed into an INPUT or TEXTAREA, and a `<button>` is neither — so
 * without `stopPropagation` here, pressing Down inside this group would change
 * the mode *and* scroll the article. **While focus is genuinely inside the
 * group, focus wins**, which is the whole reason the pattern promises the keys.
 *
 * **But a mouse click must not put focus here.** Greg, 2026-08-26, when the
 * button was still called Contents:
 *
 * > if I'd just clicked the bottom-bar "Contents" button, say, then left/right
 * > changed within that radio group, rather than the Contents columns (which
 * > should be the priority for those keys)
 *
 * Clicking a bar button is how you *get to* the hierarchy, so the arrows you
 * press next are meant for it — and the reader has no reason to think
 * the button they let go of is still listening. So a pointer-driven click blurs
 * the button afterwards (`e.detail > 0`, which is 0 for a click synthesised by
 * Enter or Space) and the arrows go back to the article. Tab into the group and
 * everything the role promises is still there: this takes the keys away from
 * nobody who asked for them.
 */
/**
 * Which mode a key press moves to, or `null` if the key is not ours.
 *
 * Pulled out of the component and exported **because it cannot be tested where
 * it was.** The arrow keys are the promise `role="radiogroup"` makes, the
 * wrapping arithmetic is where an off-by-one hides, and the only way to check
 * it in place is to drive a real browser — which is exactly the check that is
 * skipped on the day it matters. Everything here is index arithmetic; none of
 * it needs a DOM. See tests/chat.test.ts.
 *
 * Both axes move the selection, and `Home`/`End` jump to the ends. Wrapping is
 * deliberate: with a handful of items, not wrapping means the reader has to know
 * which end they are at before they know which key to press.
 */
export function nextModeIndex(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  const step = key === "ArrowRight" || key === "ArrowDown" ? 1 : key === "ArrowLeft" || key === "ArrowUp" ? -1 : 0;
  // `+ count` before the modulo: JavaScript's `%` keeps the sign of the left
  // operand, so going left from the first item lands on -1 rather than on the
  // last one — and -1 is a valid-looking array index that reads as `undefined`.
  if (step !== 0) return (index + step + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/**
 * How a marked control is drawn.
 *
 * Desaturated and lower contrast, which is NN/G's own prescription for a
 * control that is not fully available. **Not `aria-disabled`**, and that is not
 * an oversight: the button really does respond to a press — it opens the band
 * that explains itself — so announcing it as disabled would be a lie to exactly
 * the reader who most needs the explanation, and would take it away from them
 * at the same time.
 */
const MARKED = "tw:opacity-55";

function DockModes({
  mode,
  onMode,
  marked,
}: {
  mode: Mode;
  onMode(next: Mode): void;
  marked?: ReadonlyMap<Mode, string> | undefined;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = MODES_UI.findIndex((m) => m.mode === mode);
  // Never -1: an unknown mode cannot reach here (params.ts parses one), but a
  // -1 would put focus on `refs[-1]` and silently break every arrow key.
  const index = current === -1 ? 0 : current;

  const onKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const next = nextModeIndex(e.key, index, MODES_UI.length);
    if (next === null) return;
    const target = MODES_UI[next];
    if (!target) return;
    // Both, and both matter: `preventDefault` stops the arrow scrolling the
    // page, `stopPropagation` stops keynav.ts *also* stepping the article — see
    // the header for why focus wins over the pointer here.
    e.preventDefault();
    e.stopPropagation();
    onMode(target.mode);
    // Focus follows the selection. Without this the reader is left on a button
    // that is about to become `tabIndex={-1}`, so their next arrow press goes
    // nowhere — see the header.
    refs.current[next]?.focus();
  };

  return (
    <div
      className="dock-modes"
      role="radiogroup"
      aria-label="What the middle column shows"
      onKeyDown={onKey}
    >
      <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
        {MODES_UI.map((m, i) => (
          <Tooltip
            key={m.mode}
            placement="top"
            className="tip-soon"
            content={
              <>
                <div className="tip-soon-head">{m.label}</div>
                <p>{m.blurb}</p>
                {/* A supplement, never the message. The sentence that actually
                    explains the boundary is in the band this button opens —
                    see the `marked` prop above for why that distinction is
                    load-bearing rather than fussy. */}
                {/* **The band's own sentence, not a second one saying the same
                    thing.** It was a line of its own here until a browser pass
                    read the pair as copy that had drifted — which it was. The
                    tooltip is a preview of what the press opens now, and there
                    is no second string to keep in step. visitor.ts § markedModes. */}
                {marked?.get(m.mode) && <p>{marked.get(m.mode)}</p>}
              </>
            }
          >
            {/* biome-ignore lint/a11y/useSemanticElements: a radiogroup of <button>s is the documented ARIA pattern — a real <input type="radio"> cannot carry an icon beside a label, and styling one as a bar button means hiding the input and faking every state it already had */}
            <button
              type="button"
              role="radio"
              ref={(el) => {
                refs.current[i] = el;
              }}
              className={`dock-btn${m.mode === mode ? " on" : ""}${marked?.has(m.mode) ? ` ${MARKED}` : ""}`}
              aria-checked={m.mode === mode}
              /* Explicit, because the visible label is `display: none` at
                 narrow widths and an accessible name computed from the text
                 would go with it — leaving a screen reader six radio buttons
                 called nothing at all. */
              aria-label={m.label}
              // The roving tabindex: one tab stop for the whole group.
              tabIndex={m.mode === mode ? 0 : -1}
              onClick={(e) => {
                onMode(m.mode);
                // A real click leaves the keyboard to the article; Enter and
                // Space (detail 0) leave focus where the reader put it. See the
                // header — this is Greg's ← / → complaint, 2026-08-26.
                if (e.detail > 0) e.currentTarget.blur();
              }}
            >
              <m.icon size={15} />
              {/* Classed so the stylesheet can drop it on a narrow window.
                  Every one of these buttons already carries its label in the
                  tooltip above and in its accessible name below, so hiding the
                  text costs the sighted reader a hover and costs a screen
                  reader nothing — which is why the label is the thing that
                  gives way rather than the button. See § the modes segment. */}
              <span className="dock-btn-label">{m.label}</span>
            </button>
          </Tooltip>
        ))}
      </TooltipGroup>
    </div>
  );
}

/**
 * A bar button that goes somewhere.
 *
 * `aria-current="page"` and not `aria-expanded`: this opens no drawer, and
 * saying it does would announce a state that never changes. No chevron either —
 * the `▾` on a drawer trigger promises something will rise out of the bar.
 */
function DockLink({
  href,
  current,
  icon: Icon,
  label,
  title,
  className = "",
}: {
  href: string;
  current: boolean;
  icon: typeof Info;
  label: string;
  title: string;
  /** Extra classes — today, `MARKED` for a mode a visitor cannot have. */
  className?: string | undefined;
}) {
  return (
    <Link
      href={href}
      className={`dock-btn${current ? " on" : ""}${className ? ` ${className}` : ""}`}
      aria-current={current ? "page" : undefined}
      title={title}
      /* Explicit, for the reason DockModes gives: § a narrow window hides the
         visible label, and an accessible name computed from the text would go
         with it. `title` would step in as a fallback, but `title` is the long
         sentence — a screen reader would read the whole blurb where the name
         is wanted. Not hypothetical since 2026-08-27: these three lose their
         labels at 390px too, not just the six modes.

         So `title` is now the hover description and **not** the accessible
         name — this attribute is. Anything below claiming otherwise is stale. */
      aria-label={label}
    >
      <Icon size={15} />
      {/* Same class the modes segment gives its label, so § a narrow window
          can drop all eleven of the bar's labels with one rule rather than with
          one rule and a bare-element selector that would break the moment
          somebody wrapped the text. The name is still announced: the `title`
          above is the accessible name on both of these. */}
      <span className="dock-btn-label">{label}</span>
    </Link>
  );
}

function DockTab({
  panel,
  current,
  onPanel,
  icon: Icon,
  label,
  title,
  className = "",
  children,
}: {
  panel: Panel;
  current: Panel | null;
  onPanel(next: Panel | null): void;
  icon: typeof Info;
  label: string;
  title: string;
  /** Extra classes — today, `MARKED` for the drawer a visitor cannot fill. */
  className?: string | undefined;
  children?: ReactNode;
}) {
  const on = current === panel;
  return (
    <button
      type="button"
      className={`dock-btn${on ? " on" : ""}${className ? ` ${className}` : ""}`}
      // This button opens a drawer, so `aria-expanded` is the honest
      // relationship — not `aria-pressed`, which would say these are toggles in
      // a set, and not a tab role, which would promise arrow-key traversal we
      // deliberately do not implement (the arrows belong to the article — see
      // keynav.ts). The bar's *other* buttons navigate, and say so differently:
      // DockLink above.
      aria-expanded={on}
      title={title}
      // Explicit for the same reason as DockLink above — the visible label is
      // hidden on a narrow window and `title` is a sentence, not a name.
      aria-label={label}
      onClick={() => onPanel(on ? null : panel)}
    >
      <Icon size={15} />
      {/* Same class the modes segment gives its label, so § a narrow window
          can drop all eleven of the bar's labels with one rule rather than with
          one rule and a bare-element selector that would break the moment
          somebody wrapped the text. The name is still announced: the `title`
          above is the accessible name on both of these. */}
      <span className="dock-btn-label">{label}</span>
      {children}
      <ChevronUp className={`dock-chev${on ? " open" : ""}`} size={12} />
    </button>
  );
}

/**
 * The wait before the questions, and nothing at all if the wait is short.
 *
 * Its own component only because `useSlow` is a hook and `Questions` returns
 * early — the same reason `ChatListLoading` is one. `.dock-empty` for the type,
 * so the sentence sits exactly where the one it stands in for would.
 */
function QuestionsLoading() {
  const slow = useSlow(true);
  /* `role="status"` for the same reason the chat panel's has one: the sentence
     arrives 600ms late and would otherwise be announced to nobody. */
  return (
    <p className="dock-empty dock-loading" role="status">
      {slow && (
        <>
          <LoaderCircle className="cmt-spinner" size={13} /> Fetching your comments…
        </>
      )}
    </p>
  );
}

/**
 * Every question asked about this article, in the order you meet them coming
 * down the page.
 *
 * This is the panel that did not exist in any form before. The answers have
 * always been reachable — the dialog carries `‹ 3/7 ›` arrows — but there was
 * no way to *see* what you had asked, which is the thing you want when you come
 * back to a piece a day later. Order comes from comment-nav.ts and therefore
 * from the block index, never from the id string (block-ids.md).
 */
function Questions({
  comments,
  loaded,
  loadFailed,
  onOpen,
}: {
  comments: Comment[];
  loaded: boolean;
  loadFailed: boolean;
  onOpen(id: string): void;
}) {
  /* **"Nothing asked yet" is a claim about the reader, and it takes a fetch
     that came back and worked to earn it.** Three states get here with an empty
     list and only the third one may say it.

     Waiting: the drawer opens on a keypress and the fetch is still out behind
     it on a slow connection, so the first thing the reader saw was a flat
     denial of the questions they had opened this to find. Behind `useSlow`, so
     a fetch that beats 600ms draws nothing at all rather than a spinner that
     flashes and vanishes — useSlow.ts.

     Failed: the first version of this fix set `loaded` on the failure path too
     and fell straight through to the same sentence, which is the identical lie
     one beat later. GPT Sol caught it, 2026-08-27. The transport error itself
     is printed in the reading view's status line, which is *behind this
     drawer's scrim* — so saying nothing here would have left the reader with a
     denial and no way to see the reason. */
  if (comments.length === 0 && !loaded) {
    return <QuestionsLoading />;
  }

  if (comments.length === 0 && loadFailed) {
    return (
      <p className="dock-empty">
        Couldn't load your comments. Reload to try again.
      </p>
    );
  }

  if (comments.length === 0) {
    return (
      <p className="dock-empty">
        Nothing marked yet. Select a sentence in the article to bookmark it, and add a
        comment if you want one.
      </p>
    );
  }
  return (
    <ol className="dock-questions">
      {comments.map((c) => (
        <li key={c.id}>
          <button type="button" className="dock-question" onClick={() => onOpen(c.id)}>
            <span className="dock-question-quote">{c.quote}</span>
            {/* **The reader's own words beat the model's**, which is the whole
                ordering principle of this feature — and the list read as broken
                without it: a comment somebody had written showed only the
                sentence it was about, so scanning the list told you where you
                had stopped but not what you had thought. Found in the browser
                pass, 2026-08-28.

                A bare bookmark has genuinely nothing to preview, and gets no
                line rather than an empty one — the quote is the whole of it. */}
            {previewOf(c) && (
              <span className={`dock-question-state ${c.status}${c.body ? " own" : ""}`}>
                {previewOf(c)}
              </span>
            )}
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * The one line under a row's quote, in the order that says whose list this is.
 *
 * What the reader wrote, then how the model call is going, then what it said,
 * then — for a bare bookmark — nothing at all. The body comes first even on a
 * comment that also has an answer: they made the mark and wrote the note, and
 * the answer is the thing they can open.
 */
function previewOf(c: Comment): string {
  if (c.body) return firstLine(c.body);
  if (c.status === "pending") return "thinking…";
  if (c.status === "error") return "failed";
  return firstLine(c.answer);
}

/**
 * The opening of a line, for the list — enough to recognise which mark this
 * was, not enough to read instead of opening it.
 *
 * Cut on a word boundary rather than mid-syllable, and only when there is
 * something to cut: a short line is shown whole rather than given an ellipsis
 * it has not earned.
 */
function firstLine(answer: string | undefined): string {
  const text = (answer ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= 120) return text;
  const cut = text.slice(0, 120);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}
