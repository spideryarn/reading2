/**
 * **Dictation, wired to a text box.** The three lines a box needs.
 *
 * [`useDictation`](./useDictation.ts) owns the microphone and knows nothing
 * about text. This owns the text and knows nothing about microphones. A box
 * adopts dictation like so:
 *
 * ```tsx
 * const dictate = useDictationField({ value, onChange, box, context: { kind: "article", slug } })
 * <textarea ref={box} readOnly={dictate.readOnly} … />
 * <DictationStrip {...dictate.strip} />
 * ```
 *
 * ## One span, and that is the whole idea
 *
 * A dictation puts words in one place and later replaces them with better
 * words. So this keeps a range — `[from, to)` — of what the current dictation
 * has contributed. Live phrases extend it; the transcript replaces it.
 *
 * The reason that is worth a named concept is what it deletes. On Chromium the
 * span holds the recogniser's guesses and the transcript overwrites them; on
 * Safari and Firefox the span is **empty and sits at the caret**, and the
 * transcript "replaces" nothing at all — which is an insertion. Two situations
 * that look entirely different from the reader's side are one line of code, and
 * there is no branch to get wrong.
 *
 * ## The box is closed while the words are on their way
 *
 * Greg, 2026-08-27, on the two seconds between stopping and the good transcript
 * arriving:
 *
 * > Perhaps replace/disable the text box with a loading spinner? And/or just
 * > add the audio input at the cursor?
 *
 * Both, and together they delete a problem rather than manage it. The plan
 * before this note carried a rule for what to do when the reader edited the
 * live text during those two seconds — whether to replace anyway, whether to
 * offer the better version, how to tell an edit from a re-render. With the box
 * closed there is no such thing as an edit during the gap and the rule is not
 * needed.
 *
 * **`readOnly`, not `disabled`.** `disabled` takes the box out of the tab
 * order, drops the selection, and greys it out as though it were broken;
 * `readOnly` refuses typing and leaves everything else alone.
 *
 * It does **not**, by itself, keep the focus — an earlier draft of this comment
 * said it did, and GPT Sol's review was right that clicking a separate button
 * has already blurred the box before `readOnly` is ever applied. So `toggle`
 * puts the focus and the caret back explicitly. And `readOnly` stops *typing*
 * and nothing else: it does not stop a controlled re-render from elsewhere, and
 * it does not stop Enter submitting a form. Those are guarded where they live —
 * see the content check on `span`, and `readOnly` on the send button in the
 * chat composer.
 */
import { type RefObject, useCallback, useRef } from "react";
import {
  type DictationContext,
  type UseDictation,
  useDictation,
} from "./useDictation.js";

export interface UseDictationField {
  dictation: UseDictation;
  /** True while the transcript is on its way. Put it on the box. */
  readOnly: boolean;
  /**
   * Start or stop dictating. **Use this rather than `dictation.toggle`**: it
   * notes where the caret was first, and pressing the button is the moment the
   * box loses the focus.
   */
  toggle(): void;
}

export function useDictationField({
  value,
  onChange,
  onCommit,
  box,
  context,
}: {
  value: string;
  onChange(next: string): void;
  /** Blur, Cmd/Ctrl+Enter, or the end of a dictation. Optional. */
  onCommit?(): void;
  box: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  context: DictationContext;
}): UseDictationField {
  /**
   * The value as of *now*, rather than as of the last render.
   *
   * Two confirmed phrases can arrive between renders — the recogniser does not
   * wait for React — and reading `value` fresh each time meant the second
   * overwrote the first.
   */
  const live = useRef(value);
  live.current = value;

  /**
   * What this dictation has put in, as `[from, to)` — and **the text we put
   * there**, so that a replacement can check it is still replacing its own
   * words.
   *
   * The box is `readOnly` for the whole of the gap, so in the ordinary run of
   * things this check never fires. GPT Sol's plan review (item 3) is why it is
   * here anyway: `readOnly` stops *typing*, and nothing else. A pending profile
   * save can land its older response into the same controlled value; changing
   * the comment being looked at clears the follow-up box through React state.
   * Both would leave our offsets pointing at somebody else's characters, and
   * splicing there would corrupt text nobody dictated.
   *
   * So the offsets are a plan and this is the proof. If the proof fails the
   * transcript is dropped and the box is left alone, which is the safe way
   * round to be wrong: the reader keeps the rough words rather than losing
   * whatever replaced them.
   */
  const span = useRef<{ from: number; to: number; text: string } | null>(null);
  /**
   * Where the words go, captured at the press.
   *
   * Read here rather than lazily inside `put`, because pressing the button
   * moves the focus out of the box. `selectionStart` does survive a blur, but
   * relying on that leaves the insertion point at the mercy of whatever else
   * touches the selection in between, and this costs one number.
   */
  const pressedAt = useRef<number | null>(null);
  /**
   * The value of the box when the dictation ended, so that a **retry** arriving
   * later can prove `pressedAt` still points where it used to.
   *
   * The `span` proof cannot cover this: `span` is null by the time a retry's
   * transcript lands, because the dictation it belonged to is over. So a reader
   * who edits the box while reading the failure — which is exactly when they
   * would — moves every offset under a number nobody re-checked, and the
   * transcript is spliced into the middle of a word. GPT Sol's code review, R1.
   *
   * When the proof fails the offset is abandoned rather than the transcript:
   * the words go in at the caret. Wrong place, right words, and the reader can
   * see where it went — which is the safe way round to be wrong.
   */
  const valueAtEnd = useRef<string | null>(null);


  const commit = useRef(onCommit);
  commit.current = onCommit;
  const change = useRef(onChange);
  change.current = onChange;

  /**
   * Put `text` where the dictation's words go, and remember where that was.
   *
   * @param replaceSpan replace everything this dictation has contributed so
   * far, rather than adding to it. That is the transcript's arrival; a live
   * phrase adds.
   */
  const put = useCallback(
    (text: string, replaceSpan: boolean) => {
      const el = box.current;
      const current = live.current;
      const held = span.current;

      /* Somebody else moved the text under us. See the note on `span`. */
      if (held && current.slice(held.from, held.to) !== held.text) return false;

      /* No span: either the very first phrase of a dictation, or a retry's
         transcript arriving after one ended. `stale` is only ever true in the
         second case — see `valueAtEnd`. */
      const stale = valueAtEnd.current !== null && valueAtEnd.current !== current;
      const remembered = stale ? null : pressedAt.current;
      const at = held
        ? replaceSpan
          ? held.from
          : held.to
        : (remembered ?? el?.selectionStart ?? current.length);
      const until = held && replaceSpan ? held.to : at;

      /* A space between phrases, unless we are at the very start or there is
         already whitespace there. The recogniser hands back "the evidence" with
         no leading space, and three phrases in a row would otherwise read
         "the evidencenot the historyplease". */
      const needsSpace = at > 0 && !/\s$/.test(current.slice(0, at)) && !/^\s/.test(text);
      const insert = `${needsSpace ? " " : ""}${text}`;
      const next = current.slice(0, at) + insert + current.slice(until);

      const from = held?.from ?? at;
      const caret = at + insert.length;
      live.current = next;
      span.current = { from, to: caret, text: next.slice(from, caret) };
      change.current(next);

      requestAnimationFrame(() => {
        /* Only if the box still has the focus. Moving the selection in an
           element the reader has since clicked away from would yank the caret
           back to a box they had left. */
        if (el && document.activeElement === el) el.setSelectionRange(caret, caret);
      });
      return true;
    },
    [box],
  );

  const dictation = useDictation({
    onText: (text) => put(text, false),
    /* **Replaces, never appends.** On Chromium the span holds the recogniser's
       guesses and this is the correction; on Safari and Firefox the span is
       empty and this is the insertion. One line either way. */
    onTranscript: (text) => put(text, true),
    onEnd: () => {
      span.current = null;
      valueAtEnd.current = live.current;
      /* **`pressedAt` is deliberately kept**, where the span is not.
         They answer different questions and only one of them has gone stale: the
         span is *what this dictation put in the box*, which is now committed and
         must never be spliced over again; `pressedAt` is *where the reader's
         caret was when they pressed*, which is still where a retry's words
         belong. Pressing the microphone again overwrites it, and nothing else
         reads it, so keeping it costs nothing.

         Cleared, this meant a retry inserted wherever the caret happened to be
         — which after a failure is wherever the reader clicked while reading
         the error. GPT Sol's plan review, F4. */
      commit.current?.();
    },
    context,
  });

  const toggle = useCallback(() => {
    if (!dictation.armed) {
      pressedAt.current = box.current?.selectionStart ?? null;
      /* A new press: there is no ended dictation to be stale relative to. */
      valueAtEnd.current = null;
    }
    dictation.toggle();
    /* **Put the focus back where the words are going.** The header used to
       claim that `readOnly` "keeps focus"; GPT Sol pointed out that this is
       only true relative to `disabled` — clicking a separate button has already
       blurred the box, so there was no focus left for `readOnly` to keep. The
       caret is restored along with it, because it was read a line above. */
    requestAnimationFrame(() => {
      const el = box.current;
      if (!el) return;
      el.focus({ preventScroll: true });
      const at = pressedAt.current;
      if (at !== null) el.setSelectionRange(at, at);
    });
  }, [box, dictation]);

  /* Derived, not stored. The box is closed exactly while the hook says a
     transcript is on its way — one source, so there is no state to leave locked
     when a dictation ends in a way nobody anticipated. */
  return { dictation, readOnly: dictation.transcribing, toggle };
}
