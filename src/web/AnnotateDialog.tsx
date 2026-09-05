/**
 * The box a selection opens — see docs/plans/260828a-comments-and-bookmarks.md.
 *
 * Select a sentence and this appears over the article: the words you chose, a
 * place to say something about them, and a tick-box if you also want the model
 * to answer. **Saving is free.** Nothing is bought unless the box is ticked.
 *
 * ## What it replaced, twice
 *
 * Until 2026-08-26, letting go of the mouse spent a model call on the spot and
 * streamed an explanation into a panel. Then a selection opened an *ask box* —
 * still free until you pressed Ask, but the only thing you could do with a
 * passage was ask about it. Greg, 2026-08-27:
 *
 * > someone might want to simply add bookmarks or comments to the text, without
 * > wanting an AI response … you can select some text, and that bookmarks it.
 * > You can optionally add a comment. And you can request (when you do so)
 * > whether you want an AI response (in which case it kicks off a Chat).
 *
 * So the free thing is the default and the paid thing is a tick-box.
 *
 * ## Three details that are decisions, not styling
 *
 * **A checkbox rather than a second button.** Two buttons that both save, one
 * of which also costs money, are two things a reader has to read carefully
 * every time. The checkbox makes the paid outcome something you opt into, and
 * the primary button renames itself so it always says what pressing it costs.
 * GPT Sol's review argued for this over the two buttons this plan first had.
 *
 * **Enter inserts a newline.** The old box sent on Enter, and rebinding that to
 * "save for free" would have been financially safe and still a trap: the same
 * keystroke in the same-looking box quietly doing a different thing. A comment
 * is also the first text in this app somebody might want two paragraphs of. So
 * it is a `textarea`, Enter is a newline, and ⌘/Ctrl+Enter presses the visible
 * primary button — the same chord `useDictationField` already commits on.
 *
 * **An empty box is a bookmark, not an error.** Saving with nothing written is
 * the whole "just mark this passage" case, so the button is never disabled.
 * With the tick-box on and nothing written, chat is asked to explain the
 * passage — which is what the old ask box did with an empty composer.
 *
 * ## And a fourth, since 2026-09-01: it is where a referee places a passage
 *
 * In Referee mode the box grows a *"Place on a criterion"* section
 * (PlaceOnCriterion.tsx, which carries the argument for why it is here and not
 * beside the model's own valence in `CriteriaPanel`). It changes nothing about
 * the three decisions above: placing is optional, saving with no placement is
 * the ordinary case, and it stays one press.
 *
 * ## And a fifth, since 2026-09-05: a selection is not always a comment
 *
 * Opening this box takes the focus and the selection with it, so a reader who
 * only wanted the sentence on their clipboard had to re-select it in here.
 * `CopyQuote`, at the foot of this file, is the one press that replaces that,
 * and carries the reasoning.
 */
import { useEffect, useRef, useState } from "react";
import { ClipboardCheck, Copy, MessageSquarePlus, TriangleAlert, X } from "lucide-react";

import type { ChatAnchor } from "../types.js";
import { mintId } from "../ids.js";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { type Mark, NO_MARK, PlaceOnCriterion } from "./PlaceOnCriterion.js";
import { parseRoute } from "./router.js";
import { useDictationField } from "./useDictationField.js";
import { useEscapeToClose } from "./useEscapeToClose.js";
import { keyboardInsetStyle, useVisualViewport } from "./useVisualViewport.js";

interface Props {
  /** The passage, and the block it sits in. Always a selection, never a bare block. */
  anchor: Extract<ChatAnchor, { quote: string }>;
  /**
   * **Referee mode is open**, so this passage can be placed on a criterion.
   *
   * A prop rather than something read from the address, because the mode lives
   * in `App`'s state and this box has no business parsing it. False everywhere
   * else, and then nothing here fetches a criterion — the hook that does is
   * inside the section, so an ordinary reader's selection makes no request.
   */
  placing: boolean;
  /**
   * Save it. `ask` is the tick-box: the caller stores the comment either way,
   * and opens a conversation as well when it is true.
   *
   * `id` is this draft's, minted once — see the note on `draftId` below.
   *
   * `mark` is the referee's placement, `NO_MARK` when they made none — which is
   * the ordinary case and the one this dialog is mostly used for.
   */
  onSave(id: string, body: string, ask: boolean, mark: Mark): void;
  onCancel(): void;
}

export function AnnotateDialog({ anchor, placing, onSave, onCancel }: Props) {
  const [body, setBody] = useState("");
  const [ask, setAsk] = useState(false);
  /* The placement, as a draft. Nothing is stored until Save, so unlike
     `CommentDialog`'s — which is controlled by the stored comment because a
     failed write must not look like a successful one — this one is local:
     there is nothing on a server yet for it to disagree with. */
  const [mark, setMark] = useState<Mark>(NO_MARK);
  const box = useRef<HTMLTextAreaElement>(null);

  /**
   * The id this Save will use, minted **once per passage**.
   *
   * It is the idempotency key the server matches on, and that only works if a
   * second attempt at the *same* Save carries the *same* id. Minting one per
   * click would mean a reader whose first Save succeeded on the server but
   * whose response was lost would press Save again and store a second comment
   * on the same words — with the server's same-id rule having nothing to match.
   * GPT Sol, reviewing the built code, 2026-08-28.
   *
   * Re-minted when the passage changes, because that is a different comment.
   */
  const draftId = useRef(mintId());
  /**
   * A Save already on its way.
   *
   * A synchronous latch rather than a disabled button: `disabled` only takes
   * effect on the next render, and two clicks inside one frame both get through
   * it. The id above makes a duplicate harmless on the server; this stops it
   * being sent at all.
   */
  const sending = useRef(false);

  /* The other box in this app with an article in scope, so transcription gets
     the glossary as its vocabulary — the reader is writing about a passage they
     have just read, and the words in it are the words they are about to say.
     The slug comes from the address rather than a prop, for the reason
     `CommentDialog` gives: this only ever exists over an article, and the
     address is what says which one. */
  const route = parseRoute(location.pathname);
  const dictate = useDictationField({
    value: body,
    onChange: setBody,
    box,
    context: route.kind === "read" ? { kind: "article", slug: route.slug } : { kind: "profile" },
  });

  /* One box per passage. Carrying half-typed words from one selection to the
     next is the bug `CommentDialog` already fixed once — the reader writes
     about a passage they are no longer looking at. */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the anchor is the trigger
  useEffect(() => {
    setBody("");
    setAsk(false);
    /* The placement goes with the words, and for the same reason: a placement
       carried from one selection to the next is a judgement about a passage the
       referee is no longer looking at. */
    setMark(NO_MARK);
    draftId.current = mintId();
    sending.current = false;
  }, [anchor.blockId, anchor.start, anchor.quote]);

  useEffect(() => {
    box.current?.focus();
  }, []);

  useEscapeToClose(onCancel);

  /* Mounted means on screen: the selection opens this and closing it unmounts. */
  const visible = useVisualViewport(true);

  const save = () => {
    /* **Not while the microphone is involved, and that is two states.**
       `readOnly` stops typing and not the keyboard chord, so without it the
       reader's rough first-pass words get stored a moment before the good ones
       land — and `armed`, the microphone still recording, is the one everybody
       forgets: ⌘+Enter mid-sentence saves Chrome's live guesses, or on Safari
       and Firefox saves nothing that was said at all. The same pair, for the
       same reason, as the follow-up box in `CommentDialog`.
       docs/project/dictation.md § Adding it to a box. */
    if (dictate.readOnly || dictate.dictation.armed) return;
    if (sending.current) return;
    sending.current = true;
    onSave(draftId.current, body.trim(), ask, mark);
  };

  return (
    <aside
      className="annotate-dialog"
      /* Up out of the keyboard's way, exactly as its two neighbours in the same
         corner are — and this box exists to be typed into.
         useVisualViewport.ts. */
      style={keyboardInsetStyle(visible)}
      role="dialog"
      aria-label="Comment on this passage"
    >
      <header>
        <span className="annotate-label">
          <MessageSquarePlus size={12} aria-hidden="true" />
          Comment
        </span>
        <span className="annotate-head-actions">
          {/* **Keyed on the passage, and that key is the whole fix for a false
              success.** `App` keeps one `AnnotateDialog` mounted and swaps its
              `anchor` — which is why the body, the tick-box and the placement
              all need the reset effect above. A tick left over from passage A
              is worse than those, because it is a claim about the clipboard:
              copy A, select B inside 1.6s, and an unkeyed button sits there
              saying "copied" over B's words with A still on the clipboard. The
              key remounts it, so the state and the in-flight write both go with
              the passage they belonged to. GPT Sol's review of the built code,
              2026-09-05. */}
          <CopyQuote
            key={`${anchor.blockId}:${anchor.start}:${anchor.quote}`}
            text={anchor.quote}
          />
          <button
            type="button"
            className="annotate-close"
            onClick={onCancel}
            title="Close (Esc)"
            aria-label="Close"
          >
            <X size={15} />
          </button>
        </span>
      </header>

      <div className="annotate-body">
        {/* The reader's own selection, quoted back — without it the box is a
            question about words you can no longer see once the page scrolls. */}
        <blockquote className="annotate-quote">{anchor.quote}</blockquote>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <textarea
            ref={box}
            value={body}
            readOnly={dictate.readOnly}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => {
              /* Escape closes the panel from a window listener, which would eat
                 half-written words without warning. Stopped here so the first
                 Escape clears the box and the second closes the panel — the
                 same two-stage escape the follow-up box has. */
              if (e.key === "Escape" && body) {
                e.stopPropagation();
                setBody("");
                return;
              }
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                save();
              }
            }}
            placeholder="Add a comment, or just save to bookmark it…"
            aria-label="Your comment on this passage"
            rows={3}
          />

          {/* Above the tick-box rather than below it, because the tick-box is
              the paid/free decision and belongs next to the button whose label
              it changes. Referee mode only, and `route` is what says which
              article — the same read `useDictationField` above is already
              making, for the reason this file's header gives. */}
          {placing && route.kind === "read" && (
            <PlaceOnCriterion slug={route.slug} value={mark} onChange={setMark} />
          )}

          <label className="annotate-ask">
            <input
              type="checkbox"
              checked={ask}
              onChange={(e) => setAsk(e.target.checked)}
            />
            <span>Also ask the AI about it</span>
          </label>

          <div className="annotate-actions">
            {dictate.dictation.supported && (
              <DictationButton dictation={dictate.dictation} toggle={dictate.toggle} />
            )}
            <button type="button" className="linky" onClick={onCancel}>
              Cancel
            </button>
            {/* Never disabled: saving nothing is a bookmark, which is the point.
                The label is the price — GPT Sol's review, on why a reader should
                not have to remember which of two buttons costs money. */}
            <button
              type="submit"
              className="annotate-save"
              /* Both microphone states, matching the guard in `save` — a lit
                 button over a handler that returns is a press that does
                 nothing and says nothing. */
              disabled={dictate.readOnly || dictate.dictation.armed}
            >
              {ask ? "Save & ask AI" : "Save comment"}
            </button>
          </div>
          <DictationStrip dictation={dictate.dictation} />
        </form>

        {/* Said out loud, because the two behaviours this box has replaced both
            spent a model call and a reader who learned that needs telling it
            has stopped. */}
        <p className="annotate-hint">
          {ask ? "Saving this will start a conversation." : "Nothing is asked unless you tick the box."}
        </p>
      </div>
    </aside>
  );
}

/**
 * Put the selected passage on the clipboard.
 *
 * **Why this exists.** Selecting prose opens this box, and the box takes the
 * focus — so a reader who was only trying to copy a sentence finds their
 * selection gone and has to re-select the quote in here to get it. Greg,
 * 2026-09-05. One press instead.
 *
 * What is copied is `anchor.quote` — the reader's own words, exactly as the
 * blockquote above shows them, with no id and no attribution bolted on. This is
 * the ordinary "I want that sentence" case; the block's citable address is a
 * different thing and already has its own button in the gutter (BlockGutter).
 *
 * The three states, the statement-not-optional-chain guard and the live region
 * are all `ChatPanel`'s `CopyAnswer`, deliberately: a copy button that silently
 * does nothing is the shape docs/reusable/silent-success.md is about, and
 * `navigator.clipboard` is undefined in every insecure context — which includes
 * reading this app at `http://192.168.1.x:5273` from a phone.
 *
 * **The live region is a sibling of the button, not a child of it, and that is
 * the one place this deliberately departs from `CopyAnswer`.** `button` is one
 * of the ARIA roles whose children are *presentational*, so a live region
 * nested inside one is announced at the screen reader's discretion and several
 * of them drop it — which would leave the failure case silent in the very
 * component written to stop a silent failure. Outside the button it is an
 * ordinary live region with nothing arguing about it. `CopyAnswer` has the same
 * shape and the same doubt; it was left alone here rather than changed
 * underneath a feature it is not part of.
 */
/**
 * What the button is currently saying, and **a fresh object every time it says
 * it**.
 *
 * The identity is load-bearing, which is why this is an object and not the
 * bare union it started as. The revert timer hangs off an effect keyed on this
 * value, and `setState("copied")` when the state is *already* `"copied"` is a
 * no-op React bails out of — so a second successful copy just before the first
 * timer expired inherited the old timer and flashed for whatever was left of
 * it. A new object is never `Object.is`-equal to the last one, so every
 * outcome re-runs the effect and every outcome gets its own full 1.6 seconds.
 */
type Said = { kind: "idle" | "copied" | "failed" };

function CopyQuote({ text }: { text: string }) {
  const [said, setSaid] = useState<Said>({ kind: "idle" });
  /**
   * Which press this is.
   *
   * `writeText` is a promise and two presses can be in flight at once, so
   * without a token the *older* one's outcome lands last and wins: press twice,
   * the second succeeds, the first rejects a moment later, and the button
   * reports failure over a clipboard that holds exactly what was asked for.
   * `BlockGutter` already carries this token; this is the half of the house
   * pattern the first version left out. Found by GPT Sol, 2026-09-05.
   */
  const press = useRef(0);
  /* Cleared on a timer, and the timer is cleaned up: closing the box mid-tick
     would otherwise leave one running over a component that is gone. */
  useEffect(() => {
    if (said.kind === "idle") return;
    const timer = setTimeout(() => setSaid({ kind: "idle" }), 1600);
    return () => clearTimeout(timer);
  }, [said]);
  return (
    <>
      <button
        type="button"
        className="annotate-copy"
        title={
          said.kind === "failed"
            ? "Your browser would not allow the copy — an insecure connection is the usual reason"
            : "Copy the passage"
        }
        /* Fixed, never the outcome. A control whose name changes under the
           reader is a different control as far as anything scripted or spoken
           is concerned; what happened is the status region's job, below. */
        aria-label="Copy the passage"
        onClick={() => {
          const mine = ++press.current;
          const settle = (kind: Said["kind"]) => {
            if (press.current === mine) setSaid({ kind });
          };
          /* A statement rather than `navigator.clipboard?.writeText(…)`: the
             optional chain short-circuits the whole expression, `.catch`
             included, so with no clipboard object nothing throws, nothing
             rejects, and the button reports nothing at all. */
          if (!navigator.clipboard) {
            settle("failed");
            return;
          }
          navigator.clipboard
            .writeText(text)
            .then(() => settle("copied"))
            .catch(() => settle("failed"));
        }}
      >
        {said.kind === "copied" ? (
          <ClipboardCheck size={15} />
        ) : said.kind === "failed" ? (
          /* **Not an X**, which is the glyph on the Close button six pixels to
             the right: a failed copy drew a second X beside the first one, and
             the only thing distinguishing them was a `title` no touch device
             shows. */
          <TriangleAlert size={15} />
        ) : (
          <Copy size={15} />
        )}
      </button>
      {/* Drawn *and* announced. A glyph swapping inside a button is not an
          event, so without this a screen reader cannot tell a copy that worked
          from one the browser refused.

          **Outside the button, and that is the one place this departs from
          `ChatPanel`'s `CopyAnswer`.** `aria-label` on a button hides its
          descendants from assistive technology, and `button` is in any case one
          of the roles whose children are presentational — so a status region
          nested in one is announced at the screen reader's discretion, which
          would leave the failure silent in the very component written to stop a
          silent failure. `CopyAnswer` has the same shape and the same doubt; it
          was left alone rather than changed underneath a feature it is not part
          of.

          `role="status"` rather than a bare `aria-live`, and rendered at every
          state including the empty one: a region has to be in the document
          *before* its text changes, and one that appears already holding its
          message is announced by nobody. */}
      <span className="sr-only" role="status" aria-atomic="true">
        {said.kind === "copied"
          ? "Passage copied."
          : said.kind === "failed"
            ? "Copy refused by the browser."
            : ""}
      </span>
    </>
  );
}
