/**
 * The reader's own pad beside every paragraph — see docs/plans/prose-gutter-icons.md
 * for how it began and docs/plans/260904b-gutter-help-button-and-detached-streaming-chat.md
 * for why it is now two columns wide.
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
 * **A 2 × 2 pad rather than a column**, since 2026-09-04:
 *
 *     permalink   every block, on hover     |  chat   on hover; always with chats
 *     comment mark  only when commented     |  (empty — the "?" goes here)
 *
 * It was a single column of three ~15px slots until Greg asked for targets a
 * finger can hit: *"they're quite hard to click on on an iPad."* WCAG 2.5.8 asks
 * for 24 × 24, and four of those stacked come to ~100px against a 39px one-line
 * paragraph row — so the arrangement had to change, not just the size. The cost
 * is 1.6rem of horizontal padding and a taller short row; the arithmetic is in
 * styles.css § the gutter, and the call is Greg's, in
 * docs/plans/260904b-gutter-help-button-and-detached-streaming-chat.md.
 *
 * **The fourth cell is empty on purpose.** The "?" that fills it is stage 2 of
 * that plan; the geometry lands and is measured before anything is added to it.
 *
 * **A visitor's gutter is the permalink and nothing else** — one element in the
 * top-left cell, not four with three of them blank, because none of these is a
 * placeholder. Their rows keep the article's old height, too: the stylesheet
 * floors a row at two slots only where the second row can be drawn. The chat
 * button is absent rather than dead: opening a conversation
 * costs a model call, which is not theirs to spend, so `onChatAbout` is
 * optional and the button exists only where the callback does. The bookmark
 * never draws for them either, for a different reason — the marks in it are the
 * reader's own, and a visitor has none. The callback *is* the capability, the
 * way `onRenamed` is on Masthead.tsx — one fact rather than a boolean beside a
 * handler that can disagree with it. It used to render for everybody and the
 * press was swallowed in App, which is a button that can only fail. GPT Sol's
 * review of the built code caught this paragraph claiming two.
 * docs/plans/260902j-public-read-only-access-audit-and-improvements.md § C1.
 *
 * **Every position is fixed, and as of 2026-09-04 that is finally true without
 * a caveat.** The permalink, and the chat button wherever there is one, are
 * rendered on every block whether or not they are visible, so *hovering* has
 * never moved anything. But under the flex column this replaced, adding or
 * deleting a comment moved the chat button between the second slot and the
 * third — an honest caveat GPT Sol made this file admit on 2026-08-31, and one
 * the pad simply deletes: each slot names its own `grid-area`, so the one
 * conditional child has a cell nothing else can fall into.
 *
 * **This is also where the chat button finally arrives in the gutter.** Until
 * today `.block-chat` had no `position` at all, so it was an in-flow box
 * sitting above the first line of prose at the prose's own left edge — 21px of
 * height on every block in the article, and a stylesheet full of comments
 * describing a layout it did not produce. Measured, not read:
 * docs/postmortems/block-chat-was-never-in-the-gutter.md.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Bookmark, Check, Link2, MessageSquare, TriangleAlert } from "lucide-react";
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

  const first = comments?.[0];

  return (
    <div className="blk-gutter">
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

      {/* The reader's mark on this paragraph, and it is *state*, so it is
          visible whether or not you are on the row.

          A `Bookmark` rather than the flag or speech bubble Greg offered,
          because comments.md is explicit that a comment *is* a bookmark — the
          words and the AI answer are both optional — and because a second
          message-square in the cell diagonally under the chat button would read
          as a second chat. Its colour is `--highlight`, which is exactly what `mark.cmt`
          uses in the prose, so the gutter and the passage read as one thing. */}
      {first && (
        <button
          type="button"
          className="blk-cmt"
          onClick={(e) => {
            e.stopPropagation();
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

      {/* Top-right of the pad, and only for a reader who can use it — see the
          header. Everything else about it is unchanged: same class, same count,
          same reveal rules; the stylesheet moved it, not this file.

          **Rendered after the bookmark and drawn above it**, which is only not a
          contradiction because the pad places every slot by `grid-area` rather
          than by source order. Keeping the order is what keeps the tab order
          reading down the article's own logic — address, then mark, then
          conversation — and it is the reason those rules are written against the
          classes instead of `:nth-child`. */}
      {onChatAbout && (
        <button
          type="button"
          className={`block-chat${chatCount ? " has" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
            onChatAbout(id);
          }}
          title={
            chatCount
              ? `Chat about this paragraph (${chatCount} already)`
              : "Chat about this paragraph"
          }
          aria-label="Chat about this paragraph"
        >
          <MessageSquare size={12} aria-hidden="true" />
          {/* Every conversation anchored to this block, selections included —
              counting only the whole-block ones would make the number disagree
              with the marks sitting beside it. */}
          {!!chatCount && <span className="block-chat-n">{chatCount}</span>}
        </button>
      )}
    </div>
  );
}
