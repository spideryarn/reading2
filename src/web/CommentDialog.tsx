/**
 * The explanation panel — see docs/project/comments.md.
 *
 * A floating dialog rather than a fourth column, decided by Greg on 2026-08-25:
 *
 * > Perhaps we shouldn't add it as a column of its own … Perhaps for now let's
 * > have them show up as a dialog box to avoid screwing up the existing UI,
 * > until we come up with a better plan.
 *
 * A real column would have to enter layout.ts's shrink-then-drop arithmetic,
 * take `pin-right` off the prose, and thread through the rowSpan geometry in
 * TableView. A dialog touches none of that, which is the whole point of it being
 * the first move rather than the last one.
 *
 * It shows **one** comment, which is why it carries prev/next: several questions
 * can be in flight at once, and the panel is how you get back to the ones you
 * are not looking at. Reading order, not ask order — see comment-nav.ts.
 */
import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Globe, LoaderCircle, X } from "lucide-react";
import { PROVIDER_UNREADABLE, worthRetrying } from "../messages.js";
import type { ClientComment } from "./useComments.js";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { type Mark, PlaceOnCriterion } from "./PlaceOnCriterion.js";
import { Tooltip } from "./Tooltip.js";
import { parseRoute } from "./router.js";
import { sendForTranscription } from "./dictation-upload.js";
import { useDictationField } from "./useDictationField.js";
import { useEscapeToClose } from "./useEscapeToClose.js";
import { keyboardInsetStyle, useVisualViewport } from "./useVisualViewport.js";

/**
 * **What this reader may do with the comment they are looking at.**
 *
 * The owner's arm carries eight verbs and two facts about work in flight; the
 * visitor's carries nothing at all, because since 2026-09-04 a shared link
 * carries the owner's comments and reading them is the whole of what a stranger
 * may do. docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3.
 *
 * **A union rather than a `readOnly` boolean beside the verbs**, which is the
 * idiom this codebase already uses at every owner/visitor seam
 * (`QuotesAccess`, `GlossaryAccess`, `DiagramAccess`, `ReaderCapability`). The
 * difference is not style: with a boolean, `onDelete` is still in scope on a
 * visitor's render and one `&&` dropped in a later edit deletes a stranger's
 * way into somebody else's data. Here there is no `onDelete` to reach for.
 *
 * `pending` and `error` are on the owner's arm for the same reason the drawer's
 * `loaded` is: both are facts about a request, and a visitor made none.
 */
export type CommentAccess =
  | {
      kind: "owner";
      /** How many *other* comments are still waiting on the model. */
      pending: number;
      onDelete(): void;
      onRetry(): void;
      /** Ask again and search properly — for an answer the reader has judged thin. */
      onDeepen(): void;
      /**
       * The reader typed a follow-up.
       *
       * Opens a conversation rather than growing a transcript in here — Greg's
       * call, see chat-handoff.ts.
       */
      onDiscuss(question: string): void;
      /** Save the reader's own words, or `null` to clear them back to a bookmark. */
      onEdit(body: string | null): void;
      /** Offered only when the conversation is really there — App.tsx says why. */
      onOpenThread?: (() => void) | undefined;
      /** **Referee mode is open**, so a placement can be seen and changed. */
      placing: boolean;
      /** Change this comment's placement, or clear it with both fields `null`. */
      onPlace(next: Mark): void;
      /** The comments transport's own error line, if there is one. */
      error: string | null;
    }
  | { kind: "visitor" };

interface Props {
  comment: ClientComment;
  access: CommentAccess;
  /** 1-based position in reading order, and how many there are. */
  position: number;
  total: number;
  /** Null at the ends — the arrows stop rather than wrap (comment-nav.ts). */
  onPrev(): void;
  onNext(): void;
  hasPrev: boolean;
  hasNext: boolean;
  onClose(): void;
  /**
   * The reader typed a follow-up.
   *
   * Opens a conversation rather than growing a transcript in here — Greg's
   * call, see chat-handoff.ts. Since 2026-08-26 that conversation is the
   * floating panel rather than chat mode, and it carries this comment's anchor,
   * so the passage keeps its mark and the new chat is tied to the same words.
   */
}

export function CommentDialog({
  comment,
  access,
  position,
  total,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
  onClose,
}: Props) {
  /* Narrowed once, so every guard below is the compiler checking one fact —
     the same move `Dock` makes with `own` and `TimelinePanel` with its owner
     half. A visitor reaches none of the verbs because there are none to
     reach. */
  const own = access.kind === "owner" ? access : null;
  const [followUp, setFollowUp] = useState("");
  const followUpBox = useRef<HTMLInputElement>(null);
  /* The other box in this app with an article in scope, and therefore the other
     one whose transcription gets the glossary as its vocabulary — the reader is
     asking about a passage they have just read, and the words in it are the
     words they are about to say. docs/plans/260827x-dictation-two-pass.md.

     **The slug comes from the address rather than from a prop**, which is one
     fewer thing for `App.tsx` to thread through and is exactly as true: this
     dialog only ever exists over an article, and the address is what says which
     one. `parseRoute` is the same function the router uses, so there is no
     second parser to disagree with it. Read on every render because it is a
     string comparison, and because a reader who navigates while the dialog is
     open should not have a stale slug in the next request. */
  const route = parseRoute(location.pathname);
  const dictate = useDictationField({
    value: followUp,
    onChange: setFollowUp,
    box: followUpBox,
    context: route.kind === "read" ? { kind: "article", slug: route.slug } : { kind: "profile" },
    transcribe: sendForTranscription,
  });

  /* On screen for as long as it is mounted — this dialog has no shut state of
     its own, its parent simply stops rendering it — so the viewport listeners
     live exactly as long as the component does. */
  const visible = useVisualViewport(true);

  /**
   * Is text arriving right now?
   *
   * `pending` alone cannot say: it is also the state of a question that has not
   * started, and of an answer being replaced by a deeper search — which still
   * has the *old* text on screen. So the cursor and the greying key off this,
   * and the answer's own identity is what distinguishes them.
   */
  const stale = comment.replacing === true;
  const streaming = comment.status === "pending" && Boolean(comment.answer) && !stale;

  /* One box per comment. Stepping to the next comment with a half-typed
     question used to carry it across, so the reader asked about a passage they
     were no longer looking at. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the id is the trigger; the effect reads nothing
  useEffect(() => {
    setFollowUp("");
  }, [comment.id]);

  useEscapeToClose(onClose);

  /**
   * ## The dialog takes focus, and gives it back
   *
   * The same modeless-dialog lifecycle the Comments drawer has (Dock.tsx § the
   * drawer takes focus, and gives it back), and it is here because of the one
   * path that ties the two together: pressing a row in the drawer closes the
   * drawer **and** opens this dialog in the same interaction, so the drawer's
   * cleanup puts focus back on the Comments tab while this is arriving. Without
   * this effect the reader ends up holding the tab — the dialog they just chose
   * has no focus at all, and since it sits before the bar in DOM order the next
   * Tab carries on *past* it. GPT Sol, F19 on the Stage 2 review, 2026-09-06;
   * tests/opening-a-comment-moves-focus-into-its-dialog.test.tsx.
   *
   * **It works because React flushes a commit's passive cleanups before its
   * passive setups.** The drawer hands focus back first, so what this records
   * as the opener is the stable Comments button rather than a row that is on
   * its way out of the DOM — and `isConnected` covers the rest, where the
   * control that opened the dialog (a gutter chip, a row in a drawer) has gone
   * by the time it closes.
   *
   * **The close button is the target**: it is stable across comment changes and
   * is the reader's explicit way out. Not the *first* thing in the tab order —
   * Previous and Next precede it in the header whenever there is more than one
   * comment — which the note here claimed until GPT Sol went and looked (F27 on
   * the second Stage 2 review).
   *
   * **And deliberately no trap.** The prose behind is fully live: the panel
   * dodges out of the way while you drag out a new selection (below), and
   * asking about several passages at once is the point. A trap would fight all
   * of that. There is no `aria-modal` here either, for the same reason.
   *
   * **The opener may be gone by the time the dialog is.** Deleting the last
   * comment takes the gutter mark that opened it away in the same commit as the
   * dialog and the focused Delete button, so `isConnected` is false and there
   * is nothing to go back to — and focus lands on `<body>`, which loses the
   * reader their place. The Comments button is the meaningful fallback after a
   * deletion, and it naturally does nothing when the whole article and its dock
   * are unmounting together. GPT Sol, F24. **Not a regression**: before this
   * effect existed nothing moved focus at all, so `<body>` is where the reader
   * already ended up — doing focus properly is what made the gap worth closing.
   */
  const closeRef = useRef<HTMLButtonElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const opener = document.activeElement;
    openerRef.current = opener instanceof HTMLElement ? opener : null;
    closeRef.current?.focus();
    return () => {
      const back = openerRef.current;
      openerRef.current = null;
      if (back?.isConnected) {
        back.focus();
        return;
      }
      document.querySelector<HTMLButtonElement>('.dock button[aria-label="Comments"]')?.focus();
    };
  }, []);

  /**
   * ## And again when the drawer swaps the comment underneath it
   *
   * `App` renders this dialog **without a `key`**, so choosing another comment
   * in the Comments drawer changes the `comment` prop on a component that stays
   * mounted: the mount effect above does not re-run, focus stays wherever the
   * drawer's own cleanup put it (the Comments button), and `openerRef` goes on
   * describing how comment *A* was opened — so closing *B* could restore a
   * gutter mark that has nothing to do with it. GPT Sol, F23;
   * tests/opening-a-comment-moves-focus-into-its-dialog.test.tsx.
   *
   * **Not a regression either**, for the same reason as the fallback above: the
   * reader was left holding the bar before any of this existed.
   *
   * **It bails out when focus is already inside**, which is what keeps it clear
   * of the paths that change the comment from *within* the dialog — prev/next,
   * and deleting to a neighbour. Those already hold focus on a control in here,
   * and the opener they should return to is the one the mount recorded.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the id is the trigger; the refs are stable
  useEffect(() => {
    const active = document.activeElement;
    if (dialogRef.current?.contains(active)) return;
    if (active instanceof HTMLElement && active !== document.body) {
      openerRef.current = active;
    }
    closeRef.current?.focus();
  }, [comment.id]);

  /**
   * Get out of the way while the reader is dragging out a new selection.
   *
   * The panel is pinned bottom-right, over the prose column — which is exactly
   * where the next sentence they want to ask about probably is. Since asking
   * several questions at once is the point (Greg, 2026-08-25: "kick off multiple
   * selection-searches at the same time"), the panel covering the text is a real
   * obstruction rather than a cosmetic one.
   *
   * Only for a drag that *starts* in the prose, so pressing one of the dialog's
   * own buttons doesn't make it vanish under the reader's finger.
   */
  const [dodging, setDodging] = useState(false);
  useEffect(() => {
    const down = (e: PointerEvent) => {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("td.text .prose")) setDodging(true);
    };
    const up = () => setDodging(false);
    window.addEventListener("pointerdown", down);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerdown", down);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, []);

  return (
    <aside
      /* How the comment-change effect above asks "is focus already in here?" */
      ref={dialogRef}
      /* `busy` holds the box at a constant height while an answer is arriving.
         Two separate things used to move the ✕ under the reader's finger — the
         box is pinned by its BOTTOM edge so it grew upward with every paragraph,
         and the whole box scrolled so the header then left out of the top — and
         fixing either alone leaves it moving. This is the first half; the
         `.cmt-body` wrapper below is the second. Greg, 2026-08-26: "the cross in
         the top-right keeps moving as the text streams in."

         Not a permanently constant height, which would put a two-line
         explanation in a 34rem box. The relax-to-fit happens when the answer
         settles, by which time the reader is no longer aiming at a button. */
      className={`cmt-dialog${dodging ? " dodging" : ""}${
        comment.status === "pending" ? " busy" : ""
      }`}
      /* **Up out of the keyboard's way.** This box is pinned to the bottom of
         the *layout* viewport, which on iOS is where the keyboard is — so with
         the follow-up field focused the whole panel can be behind the keys.
         `--kb-inset` is how much of the layout viewport is hidden, and
         styles.css adds it to both `bottom` and `max-height`. `undefined`
         wherever there is no `visualViewport`, and then the stylesheet's `0px`
         fallbacks leave the geometry alone. useVisualViewport.ts. */
      style={keyboardInsetStyle(visible)}
      role="dialog"
      /* **Not always an explanation any more.** A comment with no answer is the
         reader's own mark on the passage, and calling that "Explanation" to a
         screen reader would announce the model's voice over theirs. The three
         cases in one expression, because the visible label below must say the
         same thing. */
      aria-label={comment.status === "none" ? (comment.body ? "Comment" : "Bookmark") : "Explanation"}
    >
      <header>
        <span className="cmt-dialog-label">
          {comment.status === "none" ? (comment.body ? "Comment" : "Bookmark") : "Explanation"}
        </span>
        {/* Only worth the room once there is somewhere to go. */}
        {total > 1 && (
          <span className="cmt-nav">
            <button type="button" onClick={onPrev} disabled={!hasPrev} title="Previous comment, up the article" aria-label="Previous comment">
              <ChevronLeft size={15} />
            </button>
            <span className="cmt-count" aria-live="polite">
              {position} / {total}
            </span>
            <button type="button" onClick={onNext} disabled={!hasNext} title="Next comment, down the article" aria-label="Next comment">
              <ChevronRight size={15} />
            </button>
          </span>
        )}
        <button
          type="button"
          className="cmt-close"
          /* Where focus lands when the dialog opens — § the dialog takes focus,
             and gives it back. */
          ref={closeRef}
          onClick={onClose}
          title="Close (Esc)"
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </header>

      <div className="cmt-body">
      {/* The reader's own selection, quoted back. Without it the panel is an
          answer to a question you can no longer see, once the page has scrolled
          or you have stepped to a comment somewhere else entirely. */}
      <blockquote className="cmt-quote">{comment.quote}</blockquote>

      {/* **The reader's own words, above the model's.** Whose panel this is
          shows in the order: what they wrote comes first, and an explanation —
          which only a comment made before 2026-08-28 has — sits underneath it.
          Editable in place, because a note you cannot change is a note you stop
          making. */}
      {/* **A visitor gets the words and not the textarea.** Not a disabled
          `CommentBody`: that component is a click-to-edit surface, and one that
          silently refuses the click is worse than a paragraph. There is no
          `onSave` to hand it on this arm anyway.
          docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3. */}
      {own ? (
        <CommentBody
          key={comment.id}
          body={comment.body ?? ""}
          onSave={own.onEdit}
        />
      ) : (
        comment.body && <p className="cmt-body">{comment.body}</p>
      )}

      {/* **The referee's own placement, and the instrument to change it.**
          Offered on a comment with no criterion too, because a reading note
          becoming a review comment is an ordinary thing to want and the only
          difference between the two is this field
          (docs/project/comments.md § the referee's own placement).

          **Controlled by the stored comment**, never by state of its own. That
          is what makes a failed PATCH show the old placement rather than the
          new one — `useComments.place` writes nothing to the list until the
          server has answered, and a component holding its own copy would paint
          the new value over the top and call a failure a success. */}
      {own?.placing && route.kind === "read" && (
        <PlaceOnCriterion
          slug={route.slug}
          showCurrent
          value={{
            criterionId: comment.criterionId ?? null,
            valence: comment.valence ?? null,
          }}
          onChange={own.onPlace}
        />
      )}

      {/* Said out loud rather than swallowed. Every write this dialog makes —
          the note, the placement — reports its failure through one string on
          the hook, and until this line existed a PATCH that 500d left the
          reader looking at a panel that had simply not changed. That is the
          shape docs/reusable/silent-success.md is about. */}
      {own?.error && <p className="cmt-write-error">{own.error}</p>}

      {own?.onOpenThread && (
        <button type="button" className="linky cmt-open-thread" onClick={own.onOpenThread}>
          Open the conversation this started
        </button>
      )}

      {/* The spinner is only for the wait before any words. Once text is
          arriving the answer below says everything this line would, and two
          things saying it reads as a stall. `streaming` is the state a
          non-streamed version of this panel had no name for. */}
      {comment.status === "pending" && !streaming && (
        <div className="cmt-loading">
          <LoaderCircle className="cmt-spinner" size={13} />
          <span>
            {comment.answer
              ? "Searching the web, and rewriting this…"
              : "Reading the article, and searching if it needs to…"}
          </span>
        </div>
      )}

      {comment.status === "error" && (
        <div className="cmt-error">
          <p>
            {/* copy.md's avoid-list names "Something went wrong" by name, for
                saying nothing. It can only appear if a comment reached `error`
                status with no message stored, which nothing does today — but a
                fallback nobody expects to see is exactly where a rule stops
                being followed, and this one sat five lines from the button the
                whole retry change was about. */}
            {comment.error ?? PROVIDER_UNREADABLE.message}
            {/* Said out loud, because otherwise the answer below looks like the
                one that just failed. A reader who pressed "search the web" and
                got their old answer back with a red line above it deserves to
                be told which is which. */}
            {comment.answer ? " The answer below is the one you already had." : ""}
          </p>
          {/* Not offered when the message itself says another go cannot work —
              out of credit, no key, a request the service will refuse again.
              copy.md calls telling somebody to retry into a wall "the expensive
              mistake", and a button is a more emphatic way of saying it than a
              sentence. src/messages.ts § worthRetrying; an error this app did
              not write still gets the button. */}
          {own && worthRetrying(comment.error) && (
            <button type="button" className="linky" onClick={own.onRetry}>
              Try again
            </button>
          )}
        </div>
      )}

      {/* Rendered whatever the status, because there are now four states that
          can have text in them and only one of them is `done`: an answer
          arriving a few words at a time, an answer being replaced by a deeper
          search, a half answer kept from a stream that broke, and the finished
          thing. Keying on `done` was right when the only way to have text was
          to have all of it. */}
      {comment.answer && (
        <div className={`cmt-answer${stale ? " stale" : ""}`} aria-busy={streaming}>
          {paragraphs(comment.answer).map((p, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rebuilt whole on each answer, no child state
            <p key={i}>{p}</p>
          ))}
          {streaming && <span className="cmt-cursor" aria-hidden="true" />}
        </div>
      )}

      {comment.citations && comment.citations.length > 0 && (
        <div className="cmt-sources">
          <div className="cmt-sources-label">Sources</div>
          <ol>
            {comment.citations.map((c) => (
              <li key={c.url}>
                <a href={c.url} target="_blank" rel="noreferrer noopener">
                  {c.title ?? hostOf(c.url)}
                </a>
                <span className="cmt-host">{hostOf(c.url)}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      </div>

      {/* Outside `.cmt-body`, so it is pinned rather than scrolling away with a
          long answer. It used to scroll with it, deliberately — but that was
          when the whole panel scrolled and the footer was the only fixed thing.
          Now that the transcript is the only part that moves, a composer that
          slid off the bottom would be the same complaint as the moving ✕. */}
      {/* **No composer for a visitor, and absent rather than disabled** — the
          same rule the chat panel's deferral records. A greyed-out box that
          says "ask a follow-up" is an invitation to press it, and the press
          would spend the owner's money on a model call. There is no `onDiscuss`
          on this arm to call.
          docs/plans/260904c-more-modes-on-a-shared-link.md § Stage 3. */}
      {own && comment.status !== "pending" && (
        <form
          className="cmt-followup"
          onSubmit={(e) => {
            e.preventDefault();
            /* Not while a transcript is on its way: `readOnly` stops typing and
               not Enter, and sending here would hand chat the rough guess a
               moment before the good words landed. GPT Sol's plan review. */
            /* **And not while the microphone is still on.** `readOnly` is the
               two seconds after the reader presses stop; `armed` is the
               microphone actually recording, and Enter arrives from a soft
               keyboard as readily as from a hard one. dictation.md § Adding it
               to a box calls this the guard everybody forgets. */
            if (dictate.readOnly || dictate.dictation.armed) return;
            const q = followUp.trim();
            if (!q) return;
            setFollowUp("");
            own.onDiscuss(q);
          }}
        >
          <input
            type="text"
            ref={followUpBox}
            /* Enter submits this form, which puts the question into chat. `send`
               rather than `done` because what it does is post a message. */
            enterKeyHint="send"
            value={followUp}
            readOnly={dictate.readOnly}
            onChange={(e) => setFollowUp(e.target.value)}
            /* Escape closes the dialog from a window listener, which would eat
               a half-typed question without warning. Stopped here so the first
               Escape clears the box and the second closes the panel. */
            onKeyDown={(e) => {
              if (e.key === "Escape" && followUp) {
                e.stopPropagation();
                setFollowUp("");
              }
            }}
            placeholder="Ask a follow-up…"
            aria-label="Ask a follow-up question about this passage"
          />
          {dictate.dictation.supported && (
            <DictationButton dictation={dictate.dictation} toggle={dictate.toggle} />
          )}
          <button
            type="submit"
            className="linky"
            /* **`armed` as well as `readOnly`**, or the button stays lit over a
               submit handler that returns without doing anything — the guard
               above is correct and silent, which is the worse half of the two.
               GPT Sol, 2026-09-04. */
            disabled={dictate.readOnly || dictate.dictation.armed || !followUp.trim()}
          >
            Ask in chat
          </button>
          <DictationStrip dictation={dictate.dictation} />
        </form>
      )}

      <footer>
        {comment.status === "done" && <SearchBadge comment={comment} />}
        {/* Not "Try again", which is what the error state offers and means
            something else. This is the reader saying the answer was thin, and
            the model is told exactly that. Hidden while one is running, because
            two overlapping re-asks race to write the same row.

            **And hidden on a FREE comment**, which `!== "pending"` alone let
            through. `status: "none"` is every bookmark and every note written
            without ticking "Also ask the AI" — and `beginAnswer` in
            src/comments.ts refuses exactly that with a 409, *"was never a
            question, so there is nothing to answer"*. So a reader who wrote
            "what is the evidence for this?" as a plain comment was offered a
            button saying **Search the web** and told, on pressing it, that they
            had never asked anything. The refusal is right; the button was the
            bug. Found while diagnosing report 1X, 2026-09-05;
            tests/comment-dialog-search-the-web.test.tsx renders all four
            statuses so that narrowing this too far goes red as well. */}
        {own && comment.status !== "pending" && comment.status !== "none" && (
          <Tooltip
            content={
              <>
                <strong>Search the web properly.</strong> Replaces this answer with one that goes
                and looks, rather than answering from what the model already knew.
              </>
            }
          >
            <button type="button" className="linky cmt-deepen" onClick={own.onDeepen}>
              Search the web
            </button>
          </Tooltip>
        )}
        {/* Said here rather than in the panel body, because the whole point of
            firing several at once is that you go on reading while they run. */}
        {own && own.pending > 0 && (
          <span className="cmt-inflight">
            <LoaderCircle className="cmt-spinner" size={10} />
            {own.pending} still working
          </span>
        )}
        {own && (
          <button type="button" className="linky cmt-delete" onClick={own.onDelete}>
            Delete
          </button>
        )}
      </footer>
    </aside>
  );
}

/**
 * Whether the model went to the web, as a globe you can hover.
 *
 * Greg, 2026-08-25: "indicate (with an icon + hover-tooltip or similar) in the
 * dialog box whether or not a web search was used."
 *
 * Two states, and the *absence* of a search is as much a fact as its presence —
 * the model chooses per question (comments.md#decision-web-research), so a
 * silent icon would leave the reader unable to tell "checked and it was fine"
 * from "never looked". So the un-searched globe is drawn too, struck through and
 * dimmed, rather than omitted — Lucide's `GlobeOff` (see docs/project/icons.md).
 */
function SearchBadge({ comment }: { comment: ClientComment }) {
  const searched = (comment.searches ?? 0) > 0;
  const sources = comment.citations?.length ?? 0;
  return (
    <Tooltip
      placement="top"
      className="tip-search"
      content={
        searched ? (
          <>
            <strong>Checked the web.</strong> The model ran{" "}
            {comment.searches === 1 ? "one search" : `${comment.searches} searches`}
            {sources > 0 && ` and cited ${sources === 1 ? "one source" : `${sources} sources`}`},
            listed above.
          </>
        ) : (
          <>
            <strong>No web search.</strong> Answered from the article alone — the model judged it
            already knew enough. It decides per question, so this is a choice, not a setting.
          </>
        )
      }
    >
      {/* tabIndex is what makes the tooltip reachable without a mouse: Tooltip.tsx
          opens on focus (useFocus), so this is the keyboard path to the
          explanation. The rule is right in general — a focusable non-interactive
          element is usually a dead stop for a keyboard user — but here removing it
          would take accessibility away rather than add it. */}
      <span
        className={`cmt-search ${searched ? "on" : "off"}`}
        // biome-ignore lint/a11y/noNoninteractiveTabindex: focus opens the tooltip
        tabIndex={0}
        role="img"
        aria-label={
          searched
            ? `Checked the web: ${comment.searches} search${comment.searches === 1 ? "" : "es"}`
            : "No web search — answered from the article alone"
        }
      >
        <Globe size={13} aria-hidden="true">
          {/* Lucide's own `GlobeOff` is the wrong tool at this size: it draws the
              globe as arc fragments knocked out around the slash, and below
              ~16px those fragments turn to mush. One whole globe and one clean
              diagonal survives being small. The diagonal has to run past the
              circle at both ends — stopped short it reads as another line *of*
              the globe rather than a line through it. `aria-hidden` is passed
              by hand because Lucide stops adding it the moment an icon has
              children — docs/project/icons.md. */}
          {!searched && <path d="M2.5 21.5 21.5 2.5" key="struck" />}
        </Globe>
        {searched && <span className="cmt-search-n">{comment.searches}</span>}
      </span>
    </Tooltip>
  );
}

/**
 * Blank-line-separated paragraphs, rendered as text.
 *
 * Text, not HTML: this is model output landing next to the author's prose, and
 * the one thing vision.md § Principles will not have is generated content that
 * can dress itself up as the article. React escapes it for us; there is no
 * `dangerouslySetInnerHTML` on this path and there should never be one.
 */
function paragraphs(answer: string): string[] {
  return answer
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s*\n\s*/g, " ").trim())
    .filter(Boolean);
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

/**
 * The reader's own words on a comment, editable in place.
 *
 * ## Why it commits on blur rather than with a Save button
 *
 * A button is one more thing to hit, and the failure it protects against —
 * losing what you typed — is the one this actually causes: a reader who edits a
 * note and then presses the ✕ or steps to the next comment loses the edit,
 * because the button was never pressed. Blur fires for all three of those, so
 * committing there is what keeps the words. ⌘/Ctrl+Enter commits too, for the
 * reader who wants to say "done" with the keyboard.
 *
 * **Keyed on the comment id by the caller**, so stepping between comments
 * remounts this and cannot carry one reader's half-edited note onto another
 * passage — the same bug the follow-up box below fixed once already.
 *
 * The empty string is sent as `null`: a cleared box is a comment becoming a
 * bare bookmark again, and `""` is not a value the store may hold.
 */
function CommentBody({ body, onSave }: { body: string; onSave(next: string | null): void }) {
  const [draft, setDraft] = useState(body);
  /* What is actually stored, so a commit that changes nothing sends nothing. A
     PATCH per blur would rewrite `updatedAt` every time the reader clicked
     through a comment, and "edited just now" on a note they only looked at is a
     small lie the panel would then have to tell. */
  const saved = useRef(body);

  const commit = () => {
    const next = draft.trim();
    if (next === saved.current) return;
    saved.current = next;
    onSave(next === "" ? null : next);
  };

  return (
    <textarea
      className="cmt-note"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          commit();
          return;
        }
        /* Escape closes the dialog from a window listener, which would throw
           away an uncommitted edit without warning. The first Escape puts the
           stored words back; the second closes the panel. */
        if (e.key === "Escape" && draft !== saved.current) {
          e.stopPropagation();
          setDraft(saved.current);
        }
      }}
      placeholder="Add a comment…"
      aria-label="Your comment on this passage"
      rows={2}
    />
  );
}
