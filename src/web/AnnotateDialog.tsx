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
 */
import { useEffect, useRef, useState } from "react";
import { MessageSquarePlus, X } from "lucide-react";

import type { ChatAnchor } from "../types.js";
import { mintId } from "../ids.js";
import { DictationButton, DictationStrip } from "./DictationStrip.js";
import { type Mark, NO_MARK, PlaceOnCriterion } from "./PlaceOnCriterion.js";
import { parseRoute } from "./router.js";
import { useDictationField } from "./useDictationField.js";
import { useEscapeToClose } from "./useEscapeToClose.js";

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

  const save = () => {
    /* **Not while a transcription is still on its way.** `readOnly` stops
       typing and not the keyboard chord, so without this the reader's rough
       first-pass words get stored a moment before the good ones land. The same
       guard, for the same reason, as the follow-up box in `CommentDialog`. */
    if (dictate.readOnly) return;
    if (sending.current) return;
    sending.current = true;
    onSave(draftId.current, body.trim(), ask, mark);
  };

  return (
    <aside className="annotate-dialog" role="dialog" aria-label="Comment on this passage">
      <header>
        <span className="annotate-label">
          <MessageSquarePlus size={12} aria-hidden="true" />
          Comment
        </span>
        <button
          type="button"
          className="annotate-close"
          onClick={onCancel}
          title="Close (Esc)"
          aria-label="Close"
        >
          <X size={15} />
        </button>
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
            <button type="submit" className="annotate-save" disabled={dictate.readOnly}>
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
