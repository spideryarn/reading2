/**
 * The reader's own column beside every paragraph — see docs/plans/prose-gutter-icons.md
 * for how it began, docs/plans/260904b-gutter-help-button-and-detached-streaming-chat.md
 * for why it is two columns wide, and
 * docs/plans/260905b-gutter-back-to-a-vertical-line-and-a-help-prompt-that-admits-nearby-blocks.md
 * for why only one of them is the line.
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
 * **A line of three, with the reader's mark beside it** — since 2026-09-05:
 *
 *     comment mark  only when commented  |  permalink   every block, on hover
 *                                        |  chat        on hover; always with chats
 *                                        |  "?"         on hover
 *
 * **The three in the right-hand column are the three Greg counts**, and their
 * being in a line is the ask. It was a single column of three ~15px slots until
 * 2026-09-04, when Greg asked for targets a finger can hit — *"they're quite
 * hard to click on on an iPad"* — and since WCAG 2.5.8 wants 24 × 24 and four
 * of those stacked come to ~100px against a 39px one-line paragraph row, the
 * arrangement was changed instead of the height: a 2 × 2 pad. Greg looked at it
 * the next day:
 *
 * > They are no longer in a vertical line. The three are arranged in an
 * > L-shape.
 *
 * So the line came back and **the height is paid after all** — a floored row
 * goes 63.1px → 87.1px, and this one stretches two-line paragraphs as well as
 * one-line ones, which the pad did not. That is the trade, and it is Greg's, made by asking
 * for the targets and then for the line: styles.css § the gutter has the table,
 * and docs/plans/260905b-gutter-back-to-a-vertical-line-and-a-help-prompt-that-admits-nearby-blocks.md
 * has the options that were weighed against it.
 *
 * **The bookmark is beside the line rather than in it**, which is what keeps
 * the floor at three slots instead of four, and what stops the mark drifting
 * 48px below the words it marks on a short row. It is also the honest shape: it
 * is *state*, and the other three are affordances, so standing it at a
 * different x says so. Fable's arbitration, 2026-09-05.
 *
 * **The "?" is the foot of the line, and one press of it spends.** It mints a
 * draft carrying `help: true`, and `ChatDialog` sends that on mount — no
 * composer, no confirmation — which is why its copy names the AI rather than
 * promising an explanation. (This paragraph said it "spends nothing" for a day
 * after stage 3 landed and made it send; GPT Sol caught it, 2026-09-05.) It is
 * the second door into the same conversation on purpose: the chat button is
 * free text about this paragraph, and this one is *"I don't understand this"*,
 * which Greg asked for as one press. Fable argued for one door rather than two and
 * lost on Greg's call — the argument is in the plan § Rejected, because
 * anybody looking at four icons will have it again.
 *
 * **A visitor's gutter is the permalink and nothing else** — one element at the
 * head of the line, not four with three of them blank, because none of these is
 * a placeholder. Their rows keep the article's old height, too: the stylesheet
 * floors a row at three slots only where the rows below the first can be drawn.
 * The chat button is absent rather than dead: opening a conversation costs a
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
 * **Every position is fixed, and since 2026-09-04 that is true without a
 * caveat.** The permalink, and the chat button and "?" wherever there are any,
 * are rendered on every block whether or not they are visible, so *hovering*
 * has never moved anything. But under the original flex column, adding or
 * deleting a comment moved the chat button between the second slot and the
 * third — an honest caveat GPT Sol made this file admit on 2026-08-31, and one
 * the grid deletes: each slot names its own `grid-area`, so the one conditional
 * child has a cell nothing else can fall into. **Nor does it change the row's
 * height any more**, which the pad could not manage: the bookmark's cell is in
 * the first row, so a comment costs nothing at all.
 *
 * **This is also where the chat button finally arrives in the gutter.** Until
 * today `.block-chat` had no `position` at all, so it was an in-flow box
 * sitting above the first line of prose at the prose's own left edge — 21px of
 * height on every block in the article, and a stylesheet full of comments
 * describing a layout it did not produce. Measured, not read:
 * docs/postmortems/block-chat-was-never-in-the-gutter.md.
 */
import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { Bookmark, Check, CircleHelp, Link2, MessageSquare, TriangleAlert } from "lucide-react";
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
          message-square a slot away from the chat button would read as a second
          chat. Its colour is `--highlight`, which is exactly what `mark.cmt`
          uses in the prose, so the gutter and the passage read as one thing.

          **It stands in the column of its own, level with the permalink**, and
          both halves of that are load-bearing — it is the reader's mark rather
          than a button, and a mark that is not beside its own words is not a
          mark. Under the line it would sit 48px below them on a short row, and
          cost that row 24px of height for the privilege. § the gutter. */}
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

      {/* The middle of the line, and only for a reader who can use it — see the
          header. Everything else about it is unchanged: same class, same count,
          same reveal rules; the stylesheet moved it, not this file.

          **Rendered after the bookmark and drawn beside rather than below it**,
          which is only not a contradiction because the grid places every slot by
          `grid-area` rather than by source order. Keeping the order is what
          keeps the tab order reading down the article's own logic — address,
          then mark, then conversation — and it is the reason those rules are
          written against the classes instead of `:nth-child`. */}
      {onChatAbout && (
        <button
          type="button"
          className={`block-chat${chatCount ? " has" : ""}`}
          onClick={(e) => {
            e.stopPropagation();
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

      {/* The foot of the line, under the chat button — which is where Greg
          asked for it, *"underneath the comment one"*, and where it has ended up
          after a day as the fourth cell of a pad.

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
            onHelp(id);
          }}
          title="Ask the AI for help with this paragraph"
          aria-label="Ask the AI for help"
        >
          <CircleHelp size={12} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
