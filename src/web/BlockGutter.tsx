/**
 * The reader's own column beside every paragraph — see docs/plans/prose-gutter-icons.md
 * for how it began and
 * docs/plans/260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md for
 * why it is one column that truncates.
 *
 * Greg, 2026-08-31: *"a very narrow vertical gutter alongside the text …
 * instead of showing the block-id, show a permalink icon (with tooltip showing
 * the block-id) … then add a small flag or comment icon next to any blocks that
 * have a Comment."*
 *
 * One governing rule, or a gutter becomes a dashboard: **it is the reader's
 * column — your marks on this text, and the address of it.** Nothing
 * machine-generated goes here. Search hits already have the bar down the other
 * edge of this cell, glossary terms are underlined in place, and a footnote's
 * marker is the superscript; each of those is the right form for what it says,
 * and an icon would be a worse duplicate.
 *
 * And one grammar, which is what keeps it quiet: **at rest the gutter shows
 * *state*, on hover it shows *affordances*.** On an article you have never
 * marked it is empty all the way down until the pointer lands on a row.
 *
 * **One column, as long as the paragraph has room for** — since 2026-09-05:
 *
 *     mark        only when you have made a note on this paragraph
 *     permalink   every block, on hover
 *     chat        on hover; always where there are conversations
 *     "?"         on hover
 *     "…"         only when the row has no room for the rest of them
 *
 * **How many of those are drawn is decided by the row, not by this file.** A
 * one-line paragraph has room for one 24px target beside it, a two-line one for
 * two, a three-line one for three; the gutter is a size container and a
 * `@container` query draws the first however-many fit, with the last slot
 * becoming the "…" whenever something is left over. styles.css § the gutter has
 * the table and the arithmetic.
 *
 * **Source order is the priority order** — that is why the mark is first in
 * this file and why moving any of these elements is a layout change rather than
 * a tab-order change. It is the opposite of the arrangement it replaced, where
 * `grid-area` named every cell precisely so the markup and the drawing could
 * differ.
 *
 * **This is the third arrangement in three days and the first that costs the
 * article nothing.** It was a single column of three ~15px slots until
 * 2026-09-04, when Greg asked for targets a finger can hit — *"they're quite
 * hard to click on on an iPad"* — and since WCAG 2.5.8 wants 24 × 24 and four
 * of those stacked come to ~100px against a 39px one-line paragraph row,
 * something had to give. First the arrangement did (a 2 × 2 pad), and Greg
 * looked at it the next day:
 *
 * > They are no longer in a vertical line. The three are arranged in an
 * > L-shape.
 *
 * Then the article's rhythm did (a line of three, and a row floored at 87.1px),
 * and he looked at that:
 *
 * > for short paragraphs we simply show a `...` button that reveals them all?
 * > That would be simpler and more consistent as a UI for the user.
 *
 * Which is this, and it is the one that gives the height back: a one-line
 * paragraph is 39.1px again. docs/plans/260905c-gutter-shows-as-many-icons-as-the-row-has-room-for.md
 * has the options weighed against it, and 260905b the two it replaces.
 *
 * **The mark leads the column**, because it is *state* and the rest are
 * affordances: a note must not be the thing that falls off a short paragraph.
 * Greg's call, asked directly, 2026-09-05. The price is the guarantee the pad
 * bought — adding a note now pushes chat and the "?" down a slot — and it is
 * spent knowingly.
 *
 * **The "?" is the first to be folded away, and one press of it spends.** It
 * mints a draft carrying `help: true`, and `ChatDialog` sends that on mount —
 * no composer, no confirmation — which is why its copy names the AI rather than
 * promising an explanation. (This paragraph said it "spends nothing" for a day
 * after stage 3 landed and made it send; GPT Sol caught it, 2026-09-05.) That
 * it goes first is not an accident either: a press that costs money is the one
 * worth a press in front of it. It is the second door into the same
 * conversation on purpose: the chat button is free text about this paragraph,
 * and this one is *"I don't understand this"*, which Greg asked for as one
 * press. Fable argued for one door rather than two and lost on Greg's call — the
 * argument is in the plan § Rejected, because anybody looking at four icons
 * will have it again.
 *
 * **A visitor's gutter is the permalink and nothing else** — one element at the
 * head of the column, not four with three of them blank, because none of these
 * is a placeholder, and no "…", because there is nothing behind it. The chat
 * button is absent rather than dead: opening a conversation costs a
 * model call, which is not theirs to spend, so `onChatAbout` is optional and the
 * button exists only where the callback does. The bookmark
 * never draws for them either, for a different reason — the marks in it are the
 * reader's own, and a visitor has none. The "?" is gated on the same callback
 * pattern as the chat button and for the same reason. The callback *is* the capability, the
 * way `onRenamed` is on Masthead.tsx — one fact rather than a boolean beside a
 * handler that can disagree with it. It used to render for everybody and the
 * press was swallowed in App, which is a button that can only fail. GPT Sol's
 * review of the built code caught this paragraph claiming two.
 * docs/plans/260902j-public-read-only-access-audit-and-improvements.md § C1.
 *
 * **Positions are fixed against the pointer and not against a note, and that
 * is a change.** The permalink, the chat button and the "?" are rendered on
 * every block whether or not they are visible, so *hovering* has never moved
 * anything and still does not. What did become fixed on 2026-09-04 and is fixed
 * no longer is the other axis: `grid-area` gave the one conditional child — the
 * bookmark — a cell of its own, so adding a note moved nothing. Auto-placement
 * is back because a column that truncates needs "the first k that fit" to mean
 * something, and the mark leads, so **a note pushes chat and the "?" down one
 * slot** and can push the last of them behind the "…". That was the caveat GPT
 * Sol made this file admit on 2026-08-31, retired for a day, and now chosen.
 * **It costs the row no height either way**, which is the part that used to
 * matter most: no row has a floor to raise.
 *
 * **This is also where the chat button finally arrives in the gutter.** Until
 * today `.block-chat` had no `position` at all, so it was an in-flow box
 * sitting above the first line of prose at the prose's own left edge — 21px of
 * height on every block in the article, and a stylesheet full of comments
 * describing a layout it did not produce. Measured, not read:
 * docs/postmortems/block-chat-was-never-in-the-gutter.md.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import {
  Bookmark,
  Check,
  CircleHelp,
  Ellipsis,
  Link2,
  MessageSquare,
  TriangleAlert,
} from "lucide-react";
import type { BlockId, Comment } from "../types.js";
import { blockHref, blockPermalink, shortBlockId } from "./BlockRef.js";

/** How the last copy went. `idle` is also "the reader has moved on". */
type CopyState = "idle" | "copied" | "failed";

/** Long enough to read a tick, short enough not to look like a mode. */
const SETTLE_MS = 1500;

interface Props {
  id: BlockId;
  /**
   * This page's address with `at` dropped — `"/read/x?cols=0,2"`.
   *
   * Passed rather than read from the address bar because `TableView` is
   * memoised and this is rendered once per block inside it — BlockRef.tsx §
   * `blockHref` has the argument. `blockPermalink` below is deliberately *not*
   * given it: that one runs in a click handler, where the address bar is
   * current by definition.
   */
  linkBase: string;
  /**
   * Every comment on this block, in reading order, or absent for none.
   *
   * **From `commentsByBlock`, which groups on `blockId` alone** — never from
   * the resolved marks. A comment whose quoted words were edited away resolves
   * to nothing and draws no underline in the prose, and the gutter is then the
   * only place it exists. See comment-nav.ts.
   */
  comments?: readonly Comment[] | undefined;
  /** Conversations anchored anywhere in this block, whole-block or selection. */
  chatCount: number;
  onOpenComment(id: string): void;
  /**
   * Open a conversation about this whole block — **and its absence is what
   * says the reader may not.**
   *
   * Optional because a visitor has no way to pay for a model call, and the
   * button is drawn only when this is here. See the header: the callback is the
   * capability, so there is no second flag to fall out of step with it.
   *
   * `| undefined` spelled out, and it is not noise: `exactOptionalPropertyTypes`
   * is on (docs/project/typechecking.md), so the shorthand `onChatAbout?(…)`
   * means *absent*, and a caller choosing between a handler and `undefined` —
   * which is exactly how App decides — would not typecheck. `comments` above
   * carries the same annotation for the same reason.
   */
  onChatAbout?: ((id: BlockId) => void) | undefined;
  /**
   * The reader pressed "?" on this paragraph — *"I don't get this"* in one
   * press, and **its absence is what says the reader may not.**
   *
   * Optional and `| undefined` for exactly the reasons `onChatAbout` above
   * gives, and it is the same capability: a reader who cannot buy a model call
   * gets neither door. A separate callback rather than a second argument to
   * that one, because the two intents diverge in stage 3 of
   * docs/plans/260904b-gutter-help-button-and-detached-streaming-chat.md —
   * this one sends, and the chat button will still be waiting for the reader's
   * own words. Today they do the same thing, which is why the copy on the
   * button below is careful not to claim otherwise.
   */
  onHelp?: ((id: BlockId) => void) | undefined;
  /**
   * Go to this block without a page load, writing `?at=` as it goes — App's
   * own jump, the one every gist cell and arrow key uses.
   *
   * The gutter needs it for the one path where this element has to behave like
   * the link it says it is: **keyboard activation**. A bare `<a href>` left to
   * the browser would **reload the reading view**, which re-fetches the article
   * to arrive at the paragraph already on screen; there is no global anchor
   * interception in this app (router.ts), so nothing else would stop it.
   *
   * **Two paths until 2026-08-31, and this sentence outlived the second one.**
   * A failed copy used to jump as well, on the reasoning that `preventDefault`
   * has already run so the cancelled navigation has to be performed by hand.
   * GPT Sol's counter-example killed it — a rejection can arrive seconds later,
   * after the reader has moved on, and a scroll out of nowhere is worse than no
   * scroll — and `onCopy` below has said so at length ever since while this
   * comment went on promising the opposite. Found by Sol again in the stage 1
   * review, 2026-09-04, which is a fair comment on how long a false sentence
   * survives three feet from the code that contradicts it.
   */
  onJump(id: BlockId): void;
  /**
   * Say something into the table's one live region.
   *
   * The tick is invisible to a screen reader, so without this a copy is a
   * button that does nothing perceivable — silent success with the sign
   * pointing the other way.
   */
  announce(said: string): void;
}

export function BlockGutter({
  id,
  linkBase,
  comments,
  chatCount,
  onOpenComment,
  onChatAbout,
  onHelp,
  onJump,
  announce,
}: Props) {
  const [copy, setCopy] = useState<CopyState>("idle");
  /**
   * One timer and one token, and both are about the same thing: a clipboard
   * write is a promise, so its result can arrive after the reader has moved on.
   *
   * GPT Sol found two ways that went wrong, 2026-08-31. Click twice and the
   * *older* write can settle last, replacing the newer tick with its own
   * result; click and navigate away, and the continuation still calls
   * `setCopy` and starts a timer after the cleanup has run. `op` is bumped on
   * every press and checked in every continuation, so a stale one is simply
   * dropped.
   */
  const op = useRef(0);
  const settle = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (settle.current) clearTimeout(settle.current);
    };
  }, []);
  const later = useCallback((state: CopyState, mine: number) => {
    if (!alive.current || mine !== op.current) return;
    setCopy(state);
    if (settle.current) clearTimeout(settle.current);
    settle.current = setTimeout(() => {
      if (alive.current) setCopy("idle");
    }, SETTLE_MS);
  }, []);

  /**
   * Put the whole address on the clipboard.
   *
   * **A pointer click copies; every other way of activating this link
   * navigates.** That is the line GPT Sol drew and it is the right one: the
   * element announces itself as a link, so Enter from the keyboard — and a
   * screen reader's own "activate link" — must do what a link does, or the role
   * and the behaviour disagree for exactly the readers who cannot see which
   * they got.
   *
   * **`pointerType` first, `detail` as the fallback**, and the order matters.
   * `detail === 0` is the classic test and it is *nearly* right: Enter gives 0,
   * a mouse gives 1, and a touch tap gives 1 — which is what puts a phone on the
   * copying side, where it belongs, since a phone has no right-click. But
   * assistive technology that emulates a mouse can produce a `detail` of 1 for
   * something that was never a pointer at all. `pointerType` is empty on those
   * and names the device when there is one, so it answers the question being
   * asked; `detail` covers browsers that do not populate it. Verified with
   * trusted events: a real click arrives `detail: 1`, a real Enter `detail: 0`.
   *
   * "Navigates" means App's own `onJump`, not the browser's default, and the
   * difference is not pedantic: an unprevented anchor click here **reloads the
   * reading view** — this app intercepts no links globally — so Enter on a
   * permalink would re-fetch the whole article to arrive at the paragraph
   * already under the cursor. `onJump` writes the same `?at=` and moves in
   * place, which is what `BlockRef` has always done with a plain click.
   *
   * A keyboard reader is not left without a way to copy: it is a real `<a>`, so
   * the context-menu key offers *copy link address*, which copies the resolved
   * absolute URL. A long press does the same on a phone.
   *
   * **The tick waits for the promise.** `writeText` rejects for real reasons —
   * a document without focus, a permissions policy — and an optimistic tick is
   * a copy that reports success while the clipboard holds what it held before.
   * docs/reusable/silent-success.md.
   *
   * **A failure says so and does nothing else.** It used to jump, on the
   * reasoning that `preventDefault` has already run so the cancelled navigation
   * has to be performed by hand. That was wrong, and Sol's counter-example is
   * the whole argument: the rejection can arrive *seconds later*, after the
   * reader has opened a dialog or moved down the page, and a scroll and a
   * history entry then arrive out of nowhere. A failed copy is a failed copy.
   */
  const onCopy = useCallback(
    (event: MouseEvent<HTMLAnchorElement>) => {
      // Never let the cell's own jump handler see this, whatever happens next.
      // `stopPropagation` leaves the browser's behaviour alone, so ⌘-click
      // still opens its tab.
      event.stopPropagation();
      setOpen(false);
      if (event.defaultPrevented) return;
      /* `MouseEvent` is what React types a click handler with, and a click is
         in fact a `PointerEvent` in every browser that has them — the DOM lib
         just does not know it here. Read through a narrow cast rather than
         widening the handler's type, which would make every other field lie. */
      const from = (event.nativeEvent as Partial<PointerEvent>).pointerType;
      const pointer = from ?? (event.detail > 0 ? "mouse" : "");
      if (!pointer) {
        event.preventDefault();
        onJump(id);
        return;
      }
      if (event.button !== 0) return;
      // Every modified click belongs to the browser: ⌘/ctrl opens a tab, shift
      // a window, alt downloads. Taking those would be taking away the reason
      // this is an <a> at all.
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const said = shortBlockId(id);
      const mine = ++op.current;
      const failed = () => {
        later("failed", mine);
        if (alive.current && mine === op.current) {
          announce(`Couldn't copy the link to ${said}.`);
        }
      };
      /* A statement, not `navigator.clipboard?.writeText(…)`: where there is no
         clipboard object the optional chain evaluates to undefined and `.catch`
         throws on it. ChatPanel.tsx has the long version. */
      if (!navigator.clipboard) {
        failed();
        return;
      }
      navigator.clipboard
        .writeText(blockPermalink(id))
        .then(() => {
          later("copied", mine);
          if (alive.current && mine === op.current) announce(`Copied the link to ${said}.`);
        })
        .catch(failed);
    },
    [id, announce, later, onJump],
  );

  /**
   * Is the column unfolded over the rows below?
   *
   * **The row decides how many of these controls are drawn, and this is the way
   * to the rest of them.** A one-line paragraph has room for exactly one 24px
   * target and a two-line one for two (styles.css § the gutter has the
   * arithmetic), so on a short row the last slot that fits becomes the "..."
   * and pressing it releases the gutter's own height. Greg, 2026-09-05:
   * *"for short paragraphs we simply show a `...` button that reveals them all?
   * That would be simpler and more consistent as a UI for the user."*
   *
   * Local rather than lifted, and that is a deliberate limit: two open at once
   * is possible in principle and cannot happen in practice, because opening one
   * is a press and a press anywhere outside closes the other first.
   */
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement | null>(null);
  /**
   * Where the keyboard goes when the column unfolds, and where it comes back to.
   *
   * **The "…" is the last child, and everything it reveals is above it**, so
   * activating it and doing nothing else would leave the focus at the end of the
   * gutter: a forward Tab walks straight out of the column and the newly drawn
   * controls are reachable only by tabbing *backwards*. GPT Sol's second finding
   * on the built code, 2026-09-05. So opening moves the focus to the head of the
   * column and closing brings it back to the button that did it — which is the
   * ordinary disclosure contract, and the reason this is an effect rather than
   * two lines in the handlers: the elements it wants are not drawn until React
   * has re-rendered.
   *
   * `null` means "this open or close was not the keyboard's doing" — a press
   * outside, or a mouse — and then nothing is moved, because taking the focus
   * from wherever a reader has just clicked is worse than leaving it.
   */
  const goTo = useRef<"head" | "more" | null>(null);
  useEffect(() => {
    const where = goTo.current;
    goTo.current = null;
    if (!where) return;
    const sel = where === "more" ? ".blk-more" : ":scope > *";
    const el = box.current?.querySelector<HTMLElement>(sel);
    /* A control the row has no room for is `display: none`, and focusing it
       would drop the focus on the floor. `getComputedStyle` rather than
       `offsetParent`, because jsdom has no layout and would call every element
       hidden. */
    if (el && getComputedStyle(el).display !== "none") el.focus();
    else box.current?.querySelector<HTMLElement>(":scope > *")?.focus();
  }, [open]);
  /**
   * Escape closes it, and so does a press anywhere else on the page.
   *
   * `pointerdown` rather than `click`, so the panel is gone before the press
   * lands on whatever is under it — the alternative reads as a paragraph that
   * needed two taps. Captured, because a child's `stopPropagation` would
   * otherwise leave it open; the check is "is the target inside this gutter",
   * so the controls in it are unaffected.
   *
   * Listening only while open, because this is one row of an article that can
   * run to several hundred, and a document listener per block would be several
   * hundred listeners for a state nearly all of them are not in.
   */
  useEffect(() => {
    if (!open) return;
    const away = (e: Event) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      goTo.current = "more";
      setOpen(false);
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", key);
    };
  }, [open]);

  const first = comments?.[0];
  /**
   * How many controls this gutter actually renders — 1 to 4, and the stylesheet
   * reads it off the DOM.
   *
   * **The "..." is rendered from this, not from the callbacks**, and that is GPT
   * Sol's fourth finding on the plan, 2026-09-05. `comments`, `onChatAbout` and
   * `onHelp` are independent at this boundary — App gates the two callbacks on
   * `owner` together, but this component may not assume it — so "the reader can
   * chat" was the wrong question. Four combinations went wrong when it was
   * asked: a visitor with a note got a mark and no way to the address under it,
   * and a caller passing one callback and a note had three controls treated as
   * four, hiding one behind a dot on a row with room for it.
   *
   * The right question is the arithmetic one: is there more here than the row
   * can draw? The count answers it for every combination, and the stylesheet
   * needs no `:has()` to guess.
   */
  const controls = 1 + (first ? 1 : 0) + (onChatAbout ? 1 : 0) + (onHelp ? 1 : 0);

  return (
    <div
      className="blk-gutter"
      ref={box}
      data-controls={controls}
      {...(open ? { "data-open": "" } : {})}
    >
      {/* The reader's mark on this paragraph, and it is *state*, so it is
          visible whether or not you are on the row.

          **First in the column, and first in the markup, since 2026-09-05.**
          The two used to disagree on purpose — the pad placed every slot by
          `grid-area`, so this could be drawn top-left while being rendered
          second. There is no pad now: the controls are auto-placed down one
          column, and the stylesheet picks "the first k that fit" with
          `:nth-child`, so **source order is the priority order** and this is at
          the top of it. Greg's call, asked directly, 2026-09-05: promote the
          mark when it exists — a note must not vanish because its paragraph is
          short. The price is that adding one pushes chat and the "?" down a
          slot, which is the guarantee the pad bought and this spends.

          A `Bookmark` rather than the flag or speech bubble Greg offered,
          because comments.md is explicit that a comment *is* a bookmark — the
          words and the AI answer are both optional — and because a second
          message-square a slot away from the chat button would read as a second
          chat. Its colour is `--highlight`, which is exactly what `mark.cmt`
          uses in the prose, so the gutter and the passage read as one thing.

          **It is the head of the column**, which is what a mark has to be: a
          mark that is not beside its own words is not a mark, and the foot of a
          four-slot column is 72px from the first line it is marking. It had a
          column of its own for a day, beside the line rather than in it; that
          went with the second column on 2026-09-05, and being first is what
          replaces it. § the gutter. */}
      {first && (
        <button
          type="button"
          className="blk-cmt"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
            onOpenComment(first.id);
          }}
          title={
            comments && comments.length > 1
              ? `Your notes on this paragraph (${comments.length})`
              : "Your note on this paragraph"
          }
          aria-label={
            comments && comments.length > 1
              ? `Open your notes on this paragraph, ${comments.length} of them`
              : "Open your note on this paragraph"
          }
        >
          <Bookmark size={12} aria-hidden="true" />
          {comments && comments.length > 1 && (
            <span className="blk-n">{comments.length}</span>
          )}
        </button>
      )}

      {/* **A real `<a href>`, and that is not negotiable** — BlockRef.tsx makes
          the argument and it holds here: the status bar says where it goes,
          right-click offers "copy link address", ⌘-click opens the block in a
          new tab. A <button> throws all three away, and the third is the one a
          reader on a phone cannot get any other way.

          What changes is the plain left click: the id used to jump, and jumping
          to the paragraph you are already hovering was close to a no-op. This
          slot is for quoting and linking, which is what the id was for too.
          `BlockRef` still jumps everywhere else — gist ranges, summary entries,
          chat citations — and is untouched. */}
      <a
        className={`blk-permalink${copy === "failed" ? " failed" : ""}`}
        href={blockHref(id, linkBase)}
        /* The tooltip Greg asked for, carrying the full id. `title` rather than
           the Tooltip component on purpose: that is a Floating UI instance per
           trigger, and this is one trigger per block on an article that can run
           to several hundred. It is also what `.block-chat` beside it has
           always used. */
        title={
          copy === "copied"
            ? `Copied — ${id}`
            : copy === "failed"
              ? `Couldn't copy. Use the link's own menu — ${id}`
              : `${id} — click to copy a link to this paragraph`
        }
        /* Names it as the link it is, and carries the full id — which is the
           condition on using `title` for the hint at all, since a native title
           is delayed, is not reliably exposed on keyboard focus, and does not
           exist on touch. */
        aria-label={`Link to this paragraph, ${id}`}
        onClick={onCopy}
      >
        {copy === "copied" ? (
          <Check size={12} aria-hidden="true" />
        ) : copy === "failed" ? (
          <TriangleAlert size={12} aria-hidden="true" />
        ) : (
          <Link2 size={12} aria-hidden="true" />
        )}
      </a>

      {/* Third in the column, and only for a reader who can use it — see the
          header. Everything else about it is unchanged: same class, same count,
          same reveal rules; the stylesheet moved it, not this file.

          **Third in the column because it is third in this file**, which is the
          2026-09-05 change: nothing is placed by `grid-area` any more, so where
          this element sits in the JSX is where it sits on the page and how soon
          it is folded away on a short row. Above the "?" because the "?" spends
          money on a single press and this one only opens a box. */}
      {onChatAbout && (
        <button
          type="button"
          className={`block-chat${chatCount ? " has" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
            onChatAbout(id);
          }}
          /* **The same sentence in both, when there is something to open.**
             It used to say *"Chat about this paragraph (3 already)"* over a
             press that started a fourth — the chip advertised state it would
             not show. Since 2026-09-05 a press opens one of the three
             (App.tsx § `chatAboutBlock`), so the verb is "Open a
             conversation", and *"(3 total)"* says the count is the set rather
             than promising the reader all of it.

             **`title` and `aria-label` are one string here**, unlike the
             permalink and the "?" beside it, and the divergence is what was
             wrong rather than what was right: the accessible name was the bare
             singular, so the count on screen was the one thing a screen reader
             could not hear. Nothing about the count is decoration.

             With no conversation on the block, both are unchanged. */
          title={
            chatCount
              ? `Open a conversation about this paragraph (${chatCount} total)`
              : "Chat about this paragraph"
          }
          aria-label={
            chatCount
              ? `Open a conversation about this paragraph (${chatCount} total)`
              : "Chat about this paragraph"
          }
        >
          <MessageSquare size={12} aria-hidden="true" />
          {/* Every conversation anchored to this block, selections included —
              counting only the whole-block ones would make the number disagree
              with the marks sitting beside it. */}
          {!!chatCount && <span className="block-chat-n">{chatCount}</span>}
        </button>
      )}

      {/* The foot of the column, under the chat button — which is where Greg
          asked for it, *"underneath the comment one"*, and where it has ended up
          after a day as the fourth cell of a pad. Last of the four is also
          first to be folded behind the "…" below, which is the right end of the
          queue for the one control that spends on a single press.

          **What it says is what it does, and as of stage 3 that includes
          spending money.** One press sends — no composer, no confirmation —
          so the label has to say so before the finger lands. "Explain this
          paragraph" would be the button reporting an answer, which is the shape
          of failure docs/reusable/silent-success.md is about; "Ask the AI" says
          who pays and what happens. Through stage 2 it read *"Ask for help with
          this paragraph"*, which promised a question and delivered a composer,
          and an exact-string test pinned it precisely so that this sentence
          could not change behind the behaviour. GPT Sol's condition on stage 2
          being coherent on its own.

          **`title` and `aria-label` diverge here, as they do for the permalink
          above.** The tooltip has room to name the cost; the accessible name is
          read out on focus, in a gutter where four of them go past in a row, so
          it stays to the verb.

          Same `CircleHelp` at `size={12}` as the other three glyphs: stage 1
          grew the hit box to 24px and deliberately left the ink alone, because
          the amount of grey per row is what decides whether the gutter reads as
          quiet. No count beside it — a conversation is a conversation, and the
          chat button next door already carries that number. */}
      {onHelp && (
        <button
          type="button"
          className="blk-help"
          onClick={(e) => {
            e.stopPropagation();
            setOpen(false);
            onHelp(id);
          }}
          title="Ask the AI for help with this paragraph"
          aria-label="Ask the AI for help"
        >
          <CircleHelp size={12} aria-hidden="true" />
        </button>
      )}

      {/* **The last slot that fits, whenever something is left over.**

          A one-line paragraph has room for one 24px target, a two-line one for
          two, a three-line one for three — measured, and the whole arithmetic is
          in styles.css § the gutter. Until today the row was *stretched* to hold
          the column, which cost every short paragraph 24px of the article's
          rhythm; Greg looked at that twice and then named the fix: *"for short
          paragraphs we simply show a `...` button that reveals them all? That
          would be simpler and more consistent as a UI for the user."*
          (2026-09-05.)

          **Which slots are drawn is the stylesheet's job, not this file's**, and
          that is the point of the container query: CSS cannot count a
          paragraph's lines, but it can ask its own box whether the next slot
          fits. So this is rendered on every row a reader owns and hidden by
          `@container` wherever nothing is hidden behind it — the dot appears
          only when it means something.

          **Rendered whenever there is more than one control**, which is not the
          same as "the reader can chat" and the difference is GPT Sol's fourth
          finding: the three props are independent here, so a visitor with a note
          has two controls and needs this, and a visitor with none has one and
          must not have it — a dot that opens a column of one is a button that
          can only disappoint. `controls` above has the whole argument.

          A disclosure rather than a menu — `aria-expanded`, no `role="menu"` —
          because what it opens is these same controls, in the same order, at
          the same addresses in the DOM. There is one copy of the chat button in
          this component and one set of handlers; a second panel would be a
          second place for them to drift apart. */}
      {controls > 1 && (
        <button
          type="button"
          className="blk-more"
          aria-expanded={open}
          onClick={(e) => {
            e.stopPropagation();
            /* Only the keyboard is given the focus; a pointer press leaves it
               where the reader put it. `detail` is 0 for Enter and Space and
               non-zero for a real click — the same test `onCopy` above makes,
               for the same reason. */
            if (e.detail === 0) goTo.current = open ? "more" : "head";
            setOpen((was) => !was);
          }}
          title={open ? "Fewer" : "More for this paragraph"}
          aria-label={open ? "Fewer" : "More for this paragraph"}
        >
          <Ellipsis size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
