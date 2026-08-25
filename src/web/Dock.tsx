/**
 * The bottom bar, and the drawer that rises out of it.
 *
 * The app's furniture: the things that are about *this article* but are not the
 * article — the questions you have asked, where it came from, the way home —
 * plus the app finally naming itself. Everything here is one click from the
 * reading view and none of it is in the way of it.
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
 * constant beside `SPINE_FULL`, a new interaction with the spine's three modes,
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
 * `Home`, `Metadata` and `Thread` navigate; `Questions` opens a drawer *on the
 * reading view* and navigates everywhere else; `Chat` and `Glossary` change what
 * the middle of the page **is**. That is three real differences and the markup has to tell
 * the truth about each — a link gets `aria-current="page"`, a drawer trigger
 * gets `aria-expanded`, a mode switch gets `aria-pressed`, and using any one of
 * them for another kind announces the wrong thing to a screen reader while
 * looking identical on screen. Hence `DockLink`, `DockTab` and `DockMode` below
 * rather than one component with two flags.
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
 */
import { useEffect, type ReactNode } from "react";
import {
  BookA,
  ChevronUp,
  Highlighter,
  Home,
  Info,
  Layers,
  ListOrdered,
  MessageSquareText,
  MessagesSquare,
  Search,
  Timer,
  X,
} from "lucide-react";
import type { Comment } from "../types.js";
import type { Mode, Panel } from "./params.js";
import { Link } from "./Link.js";
import { type ArticleView, carriedSearch, LIBRARY_HREF, readHref } from "./router.js";
import { Tooltip, TooltipGroup } from "./Tooltip.js";

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
  drawer?: {
    /** Comments in reading order — App already sorts them, see comment-nav.ts. */
    comments: Comment[];
    /** Which panel is open, or null for a shut drawer. From `?panel=`. */
    panel: Panel | null;
    onPanel(next: Panel | null): void;
    /** Open a question's dialog and bring its passage into view. */
    onOpenComment(id: string): void;
  };
}

/**
 * The ideas we have not built, kept where their shape is visible.
 *
 * Greg, 2026-08-25: *"Also see docs/project/original-version/overview.md for
 * ideas - for now, add extra ideas as placeholders with rich tooltips."*
 *
 * Every one of these was built once already, over in the original version, and
 * every tooltip says the one thing that project learned the hard way — because
 * that is the part worth carrying and the code is not. They are dimmed and they
 * do nothing when clicked.
 *
 * This is not a backlog. The standing rule from
 * docs/project/original-version/overview.md is *a library to consult, not a
 * backlog to import*.
 *
 * **Both of the features this list used to say we would never build are now
 * buttons in this bar**, and that is worth reading before adding a third
 * refusal here. Tweet threads were "simply not what this is", written a few
 * hours before Greg asked for them. Chat was the stronger objection — its own
 * docs single it out as the one to be most suspicious of, and it sits closest
 * to our anti-goals (vision.md). Neither objection was waved away; both are
 * answered at length, in
 * docs/plans/tweet-thread-page.md#say-the-awkward-thing-first and in
 * docs/plans/chat-mode.md#say-the-awkward-thing-first. The chat that was built
 * is not the one that was refused: every claim it makes carries a block id and
 * the article stays on screen beside it.
 */
const SOON: { key: string; label: string; icon: typeof Layers; blurb: string; learned: string }[] = [
  {
    key: "summaries",
    label: "Summaries",
    icon: Layers,
    blurb: "The whole piece at whichever length you want it, from a sentence to a page.",
    learned:
      "Built once already, and all nine lengths came out of a single model call rather than nine — the ladder was cheaper than it looked.",
  },
  {
    key: "highlights",
    label: "Highlights",
    icon: Highlighter,
    blurb: "Mark the passages that match something you asked for, rather than a keyword.",
    learned:
      "Overlapping highlights need the CSS Custom Highlight API; a library that wraps matches in tags cannot nest them.",
  },
  {
    key: "search",
    label: "Search",
    icon: Search,
    blurb: "Find a passage by what it says, not only by the words it uses.",
    learned:
      "Text search and meaning-based search answer different questions and their version ran both, side by side.",
  },
  {
    key: "reading-time",
    label: "Reading time",
    icon: Timer,
    blurb: "How long this will take you, and how hard it is going to be.",
    learned:
      "They dropped the standard readability formulas for a model's judgement, then adjusted the estimate by how confident it was.",
  },
];

export function Dock({ slug, view, mode, onMode, drawer }: Props) {
  const panel = drawer?.panel ?? null;
  const open = panel !== null;
  const pending = drawer?.comments.filter((c) => c.status === "pending").length ?? 0;

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
        <div className="dock-drawer" role="dialog" aria-modal="true" aria-label={TITLES[panel]}>
          <div className="dock-drawer-head">
            {/* The app names itself here and nowhere else. Deliberate: the
                drawer is shut while you read, so the brand is present without
                ever sitting beside the article's own title. The class names are
                the original app's, so its fifteen CSS-only logo animations can
                be dropped in as one file later — see
                docs/project/original-version/design-system.md. */}
            <span className="logo">
              <img className="logo-image" src="/spideryarn-logo.png" alt="" width={18} height={18} />
              <span className="logo-text">
                {"Spideryarn".split("").map((ch, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: fixed string, rebuilt whole
                  <span className="logo-letter" key={i}>
                    {ch}
                  </span>
                ))}
              </span>
            </span>
            <h2>{TITLES[panel]}</h2>
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
            <Questions comments={drawer.comments} onOpen={drawer.onOpenComment} />
          </div>
        </div>
      )}

      <div className="dock">
        <Link href={LIBRARY_HREF} className="dock-btn" title="Back to the library">
          <Home size={15} />
          <span>Home</span>
        </Link>

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
            label="Questions"
            title="The questions you have asked about this article"
          >
            {drawer.comments.length > 0 && (
              <span className={`dock-count${pending ? " pending" : ""}`}>
                {drawer.comments.length}
              </span>
            )}
          </DockTab>
        ) : (
          <DockLink
            href={readHref(slug, withPanel(search, "questions"), "article")}
            current={false}
            icon={MessageSquareText}
            label="Questions"
            title="Your questions, back in the article they are about"
          />
        )}

        {/* A link, not a drawer trigger — the details are a page now. It still
            sits between Questions and the placeholders, because where a button
            is is part of how people find it again. */}
        <DockLink
          href={readHref(slug, search, "metadata")}
          current={view === "metadata"}
          icon={Info}
          label="Metadata"
          title="Where this article came from, what shape it is, and what the pipeline wrote"
        />

        {/* A built button among the built ones, not a dimmed idea. The thread
            is written on demand and costs a model call, but that is a button on
            the page rather than a reason to hide the page. */}
        <DockLink
          href={readHref(slug, search, "tweets")}
          current={view === "tweets"}
          icon={ListOrdered}
          label="Thread"
          title="The article as a numbered thread of short posts"
        />

        {/* The third kind of button in this bar, and the one that made the
            comment at the top of this file need a third paragraph: it neither
            navigates nor opens a drawer, it changes what the middle of the page
            *is*. On the pages that have no middle it degrades to a link, the
            same way Questions does. See DockMode below for why `aria-pressed`
            rather than `aria-expanded`. */}
        {mode !== undefined && onMode ? (
          <DockMode
            on={mode === "chat"}
            onToggle={() => onMode(mode === "chat" ? "toc" : "chat")}
            icon={MessagesSquare}
            label="Chat"
            title="Ask about this article — answers point back at the paragraphs they came from"
          />
        ) : (
          <DockLink
            href={readHref(slug, withMode(search, "chat"), "article")}
            current={false}
            icon={MessagesSquare}
            label="Chat"
            title="Ask about this article, back in the article itself"
          />
        )}

        {/* The second mode button, and the one that turned "the third kind of
            button" from a special case into a kind. It was a dimmed idea in
            `SOON` until 2026-08-25; it is a built button now, and the entry it
            replaced has gone rather than being left beside it.

            Greg, 2026-08-25: *"Use a button in the bottom-bar to activate it."*
            and *"When active, it should replace the middle sections of the UI
            (i.e. right of the spine, left of the doc)."* — which is precisely
            what a mode is, so it needed no new machinery here at all. See
            docs/project/glossary.md. */}
        {mode !== undefined && onMode ? (
          <DockMode
            on={mode === "glossary"}
            onToggle={() => onMode(mode === "glossary" ? "toc" : "glossary")}
            icon={BookA}
            label="Glossary"
            title="The terms this piece uses in a non-obvious way, defined from the piece itself"
          />
        ) : (
          <DockLink
            href={readHref(slug, withMode(search, "glossary"), "article")}
            current={false}
            icon={BookA}
            label="Glossary"
            title="The terms this piece uses, back in the article itself"
          />
        )}

        <span className="dock-gap" />

        {/* Not yet built. Tooltips rather than labels, because the point of
            these is what they would be, and that does not fit on a button. */}
        <TooltipGroup delay={{ open: 300, close: 120 }} timeoutMs={400}>
          {SOON.map((idea) => (
            <Tooltip
              key={idea.key}
              placement="top"
              className="tip-soon"
              content={
                <>
                  <div className="tip-soon-head">
                    {idea.label} <span className="tip-soon-flag">not built yet</span>
                  </div>
                  <p>{idea.blurb}</p>
                  <p className="tip-soon-learned">{idea.learned}</p>
                </>
              }
            >
              <button type="button" className="dock-btn soon" aria-disabled="true">
                <idea.icon size={15} />
                <span>{idea.label}</span>
              </button>
            </Tooltip>
          ))}
        </TooltipGroup>
      </div>
    </>
  );
}

const TITLES: Record<Panel, string> = {
  questions: "Your questions",
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
function withMode(search: string, mode: Mode): string {
  const params = new URLSearchParams(search);
  params.set("mode", mode);
  return params.toString();
}

/**
 * A bar button that switches what the middle of the page is.
 *
 * `aria-pressed`, and the choice is worth a sentence because the file's other
 * two buttons both make a different one. A drawer trigger says `aria-expanded`
 * because something rises out of the bar; a link says `aria-current` because it
 * takes you somewhere. This does neither: it is a two-state control that stays
 * where it is, which is exactly what `aria-pressed` describes.
 *
 * **The third mode arrived on 2026-08-25 and this stayed a toggle.** The
 * paragraph that used to be here said a radiogroup was the answer once there
 * were three of them, so the reversal is worth stating rather than quietly
 * dropping: the count was the wrong trigger.
 *
 * A radiogroup announces "one of these several", and the bar does not show
 * several. It shows **two of three** — Chat and Glossary — because `toc` is the
 * default and has no button; you leave a mode by pressing the one you are in.
 * So a radiogroup here would name two options and hide the third, which is a
 * worse lie than `aria-pressed`: "Glossary, not pressed" is true, whereas a
 * two-option radiogroup asserts that the middle band is one of two things when
 * it is currently neither.
 *
 * The real trigger is therefore **a Table of contents button in the bar**, not
 * a third mode. Add one and all three become peers, "one of these several"
 * becomes true, and this should become `role="radiogroup"` with roving
 * tabindex and arrow-key traversal on the same day.
 */
function DockMode({
  on,
  onToggle,
  icon: Icon,
  label,
  title,
}: {
  on: boolean;
  onToggle(): void;
  icon: typeof Home;
  label: string;
  title: string;
}) {
  return (
    <button
      type="button"
      className={`dock-btn${on ? " on" : ""}`}
      aria-pressed={on}
      title={title}
      onClick={onToggle}
    >
      <Icon size={15} />
      <span>{label}</span>
    </button>
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
}: {
  href: string;
  current: boolean;
  icon: typeof Home;
  label: string;
  title: string;
}) {
  return (
    <Link
      href={href}
      className={`dock-btn${current ? " on" : ""}`}
      aria-current={current ? "page" : undefined}
      title={title}
    >
      <Icon size={15} />
      <span>{label}</span>
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
  children,
}: {
  panel: Panel;
  current: Panel | null;
  onPanel(next: Panel | null): void;
  icon: typeof Home;
  label: string;
  title: string;
  children?: ReactNode;
}) {
  const on = current === panel;
  return (
    <button
      type="button"
      className={`dock-btn${on ? " on" : ""}`}
      // This button opens a drawer, so `aria-expanded` is the honest
      // relationship — not `aria-pressed`, which would say these are toggles in
      // a set, and not a tab role, which would promise arrow-key traversal we
      // deliberately do not implement (the arrows belong to the article — see
      // keynav.ts). The bar's *other* buttons navigate, and say so differently:
      // DockLink above.
      aria-expanded={on}
      title={title}
      onClick={() => onPanel(on ? null : panel)}
    >
      <Icon size={15} />
      <span>{label}</span>
      {children}
      <ChevronUp className={`dock-chev${on ? " open" : ""}`} size={12} />
    </button>
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
function Questions({ comments, onOpen }: { comments: Comment[]; onOpen(id: string): void }) {
  if (comments.length === 0) {
    return (
      <p className="dock-empty">
        Nothing asked yet. Select a sentence in the article and the model will explain it.
      </p>
    );
  }
  return (
    <ol className="dock-questions">
      {comments.map((c) => (
        <li key={c.id}>
          <button type="button" className="dock-question" onClick={() => onOpen(c.id)}>
            <span className="dock-question-quote">{c.quote}</span>
            <span className={`dock-question-state ${c.status}`}>
              {c.status === "pending"
                ? "thinking…"
                : c.status === "error"
                  ? "failed"
                  : firstLine(c.answer)}
            </span>
          </button>
        </li>
      ))}
    </ol>
  );
}

/**
 * The opening of an answer, for the list — enough to recognise which question
 * this was, not enough to read instead of opening it.
 *
 * Cut on a word boundary rather than mid-syllable, and only when there is
 * something to cut: a short answer is shown whole rather than given an ellipsis
 * it has not earned.
 */
function firstLine(answer: string | undefined): string {
  const text = (answer ?? "").replace(/\s+/g, " ").trim();
  if (text.length <= 120) return text;
  const cut = text.slice(0, 120);
  return `${cut.slice(0, cut.lastIndexOf(" "))}…`;
}
