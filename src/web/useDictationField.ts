/**
 * **Dictation, wired to a text box.** The three lines a box needs.
 *
 * [`useDictation`](./useDictation.ts) owns the microphone and knows nothing
 * about text. This owns the text and knows nothing about microphones. A box
 * adopts dictation like so:
 *
 * ```tsx
 * const transcribe = useReaderTranscriber();
 * const dictate = useDictationField({
 *   value, onChange, box,
 *   context: { kind: "article", slug },
 *   transcribe,
 * })
 * <textarea ref={box} readOnly={dictate.readOnly} … />
 * <DictationStrip {...dictate.strip} />
 * ```
 *
 * `transcribe` is the seam that lets the fleet dashboard reuse this file rather
 * than copy it; the product's answer is always `useReaderTranscriber` from
 * [dictation-upload.ts](./dictation-upload.ts). [transcriber.ts](./transcriber.ts)
 * says why it is a parameter.
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
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { DictationKeeper, Transcriber } from "./transcriber.js";
import { type UseDictation, useDictation } from "./useDictation.js";

/**
 * **How soon after Stop a second press still counts as a double press.** The
 * usual system double-click interval is 500 ms; the rest is for a finger.
 */
export const DOUBLE_PRESS_MS = 600;

export interface UseDictationField {
  dictation: UseDictation;
  /** True while the transcript is on its way. Put it on the box. */
  readOnly: boolean;
  /**
   * **A dictation is in progress: do not send, and disable what would.**
   * `readOnly || dictation.armed` — the microphone is on, or it has just gone
   * off and the transcript is on its way. The two are different moments and
   * never both true, and a box that sends has to refuse in both: guard
   * `readOnly` alone and Enter mid-sentence sends the rough live guesses, or on
   * Safari and Firefox nothing that was said at all (docs/project/dictation.md
   * § Adding it to another box).
   *
   * Use this rather than writing the pair out: the guard that names only one
   * half is the bug this file's docs record twice. Not for the box itself — that
   * takes `readOnly`, so the reader can still type while the microphone is on.
   * tests/dictation-field-busy.test.tsx.
   */
  busy: boolean;
  /**
   * Start or stop dictating. **Use this rather than `dictation.toggle`**: it
   * notes where the caret was first, and pressing the button is the moment the
   * box loses the focus.
   */
  toggle(): void;
  /**
   * **The second press of a double press on Stop**: the box's `onDone` runs
   * once the transcript is in the box. Hand it to `DictationButton`. **Present
   * only while a second press would count** — a box with an `onDone`, for
   * {@link DOUBLE_PRESS_MS} after the Stop press, and not once taken — so the
   * button is live exactly as long as pressing it does something.
   * docs/project/dictation.md § A double press on Stop also sends.
   */
  again?: () => void;
  /**
   * **The box's own done action, pressed while the microphone is involved** —
   * Send while still talking, or while the words are on their way. Stops the
   * microphone if it is on, and runs `onDone` once the transcript is in the
   * box, under exactly the rules of a double press on Stop: only if real words
   * landed, and only for the same `doneKey`. Does nothing on an idle box or one
   * with no `onDone`. Before this, a box's done action refused silently while
   * `busy`, and on an iPad that read as a dead Send button (reports
   * spya-t9qu3v, spya-exhqqr; plan 261010f).
   */
  finishThenDone(): void;
  /** A double press was taken: the box will send when the words arrive. */
  sendingAfter: boolean;
  /**
   * **This box takes a double press on Stop at all** (it was given an
   * `onDone`), so the button's card can say so before the reader needs it.
   * `again` cannot: it exists only in the moment after Stop. Hand it to
   * `DictationButton` as `doubleStop`.
   */
  doubleStop: boolean;
}

export function useDictationField<C>({
  value,
  onChange,
  onCommit,
  onDone,
  doneKey,
  box,
  context,
  transcribe,
  keep,
}: {
  value: string;
  onChange(next: string): void;
  /** Blur, Cmd/Ctrl+Enter, or the end of a dictation. Optional. */
  onCommit?(): void;
  /**
   * **The box's own done action** — Send, Answer, Save — exactly as its button
   * calls it, with all its own refusals. Given one, a double press on Stop runs
   * it once the transcript has arrived (Greg, spya-rp8676). It is called from
   * an effect, on the render after the dictation ended, so it sees the box
   * with the words in it and `busy` false.
   */
  onDone?(): void;
  /**
   * **What the box is about, if that can change under it** — the comment's id,
   * the quiz question's. A double press is a wish to send *this* one; if the
   * key has moved by the time the words arrive, nothing is sent. The comment
   * dialog and the quiz panel reuse one mounted box across comments and
   * questions (GPT Sol's plan review of 261005a, F1).
   */
  doneKey?: string | undefined;
  box: RefObject<HTMLTextAreaElement | HTMLInputElement | null>;
  /**
   * Where this dictation is going, passed through to {@link transcribe}
   * untouched. Generic because this file is shared with the fleet dashboard,
   * whose context names a session rather than an article — see
   * [transcriber.ts](./transcriber.ts).
   */
  context: C;
  /** How a recording becomes words. The product passes `useReaderTranscriber()`'s bound sender. */
  transcribe: Transcriber<C>;
  /**
   * Where a copy is kept until the words are in the box, so a closed tab does
   * not lose a dictation. The product passes `keepDictation(<this box's name>)`;
   * see [dictation-keep.ts](./dictation-keep.ts).
   */
  keep?: DictationKeeper<C>;
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

  /**
   * **A double press on Stop**, in three small facts. `againOpen` is that Stop
   * was pressed less than {@link DOUBLE_PRESS_MS} ago; `wantSend` is that a
   * second press followed in that time, and what the box was about then;
   * `delivered` is that this ending put a real transcript in the box. Only all
   * three send — so a failed upload, an empty transcript, a transcript refused
   * because the box changed, and a later Try again all send nothing.
   */
  const [againOpen, setAgainOpen] = useState(false);
  const againTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeAgain = useCallback(() => {
    if (againTimer.current !== null) clearTimeout(againTimer.current);
    againTimer.current = null;
    setAgainOpen(false);
  }, []);
  useEffect(() => closeAgain, [closeAgain]);
  const wantSend = useRef<{ key: string | undefined } | null>(null);
  const delivered = useRef(false);
  /**
   * **When Stop was last pressed, and what the ending after it delivered.**
   * A fast ending — words back inside {@link DOUBLE_PRESS_MS} — reaches idle
   * while a second press is still on its way, and that press used to land on
   * an idle button and start the microphone again: quietly, with Send then
   * refusing because the microphone was on. So a second press in the window
   * still means "send" once the ending is over, if words landed for the same
   * `doneKey`; otherwise it is an ordinary press. Plan 261010f, item 2.
   */
  const stoppedAt = useRef<number | null>(null);
  const endedWith = useRef<{ key: string | undefined } | null>(null);
  const [sendingAfter, setSendingAfter] = useState(false);
  const key = useRef(doneKey);
  key.current = doneKey;
  const previousKey = useRef(doneKey);
  useEffect(() => {
    if (previousKey.current === doneKey) return;
    previousKey.current = doneKey;
    /* A reused box now means something else. Withdraw both an offered second
       press and one already accepted immediately, rather than merely refusing
       it at the eventual ending: the new target must not accept the old
       target's Stop, and the strip must not keep promising a send that cannot
       happen. This also makes Feedback's shut render final even if it is
       opened again before the transcript returns. */
    wantSend.current = null;
    delivered.current = false;
    endedWith.current = null;
    setSendingAfter(false);
    closeAgain();
  }, [doneKey, closeAgain]);
  /* **The send is an effect, not a call.** Every box's send closes over its
     render's value and refuses while `busy`; called from `onEnd` it would see
     the value from before the transcript, and refuse without a word. The bump
     below is in the same tick as the hook's own return to idle, so the next
     render has both, and `done` is that render's `onDone`. */
  const [sendTick, setSendTick] = useState(0);
  const done = useRef(onDone);
  done.current = onDone;
  const sentTick = useRef(0);
  const sendKey = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (sendTick === sentTick.current) return;
    sentTick.current = sendTick;
    /* The action is deferred so it sees the landed transcript and idle phase.
       That also gives a reused box one last chance to change targets: a parent
       can move to the next question in the same React batch as `onEnd`, after
       the check below but before this effect. Never call that target's latest
       `onDone` for words spoken to the previous one. */
    if (sendKey.current !== key.current) return;
    done.current?.();
  }, [sendTick]);

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
    onTranscript: (text) => {
      const landed = put(text, true);
      if (landed) delivered.current = true;
      return landed;
    },
    onEnd: () => {
      /* Read and cleared here, at every ending, so a wish to send never
         outlives the ending it was made for. */
      const wish = wantSend.current;
      const send = wish !== null && delivered.current && wish.key === key.current;
      /* For a second press that arrives after this ending: see `stoppedAt`. A
         wish already taken here has been honoured, so there is nothing left
         for a later press to send. */
      endedWith.current = delivered.current && !send ? { key: key.current } : null;
      wantSend.current = null;
      delivered.current = false;
      setSendingAfter(false);
      closeAgain();
      if (send) {
        sendKey.current = wish.key;
        setSendTick((n) => n + 1);
      }
      /* If the hook immediately restarts on a newly chosen device, it does so
         without another field-button press. Continue after the words this
         session kept, rather than reusing the caret from its original press and
         inserting the restarted session in front of them. A failed session
         with no live words has no span, so its retry still keeps the original
         insertion point. */
      if (span.current) pressedAt.current = span.current.to;
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
    transcribe,
    ...(keep && { keep }),
  });

  const toggle = useCallback(() => {
    /* **A press at or past the cap was aimed at a Stop the cap has already
       pressed.** This render still says `armed`, so without this the press
       would open the double-press window, and a second one would send a
       dictation nobody asked to send. The hook ignores the press too
       (`CAP_PRESS_GRACE_MS`); this is the half that keeps the field's own
       state out of it. GPT Sol's code review of 261007b, C1. */
    if (dictation.armed && dictation.endsAt !== null && Date.now() >= dictation.endsAt) return;
    if (dictation.armed) {
      /* The Stop press: a second one counts from now, for a moment. */
      closeAgain();
      setAgainOpen(true);
      againTimer.current = setTimeout(closeAgain, DOUBLE_PRESS_MS);
      stoppedAt.current = Date.now();
      endedWith.current = null;
    }
    if (!dictation.armed && done.current && stoppedAt.current !== null) {
      const soon = Date.now() - stoppedAt.current < DOUBLE_PRESS_MS;
      const ended = endedWith.current;
      if (soon && !dictation.transcribing && ended !== null && ended.key === key.current) {
        /* The second press of a double press, after a fast ending: send. */
        stoppedAt.current = null;
        endedWith.current = null;
        sendKey.current = ended.key;
        setSendTick((n) => n + 1);
        return;
      }
    }
    if (!dictation.armed) {
      /* A moved offer may be the only copy of the reader's words. The hook
         refuses that start; keep the ended dictation's caret/value proof and
         focus until a new start is actually accepted. */
      if (dictation.toggle() === false) return;
      wantSend.current = null;
      delivered.current = false;
      closeAgain();
      /* A press during the previous session's transcription supersedes that
         session. Its rough Chromium words stay in the box, but they are now
         ordinary text: the new session's authoritative transcript must replace
         only what the new session contributes. The stale session never reaches
         `onEnd`, so this boundary has to be made at the press itself. */
      span.current = null;
      pressedAt.current = box.current?.selectionStart ?? null;
      /* A new press: there is no ended dictation to be stale relative to. */
      valueAtEnd.current = null;
    } else dictation.toggle();
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
  }, [box, dictation, closeAgain]);

  /* Derived, not stored. The box is closed exactly while the hook says a
     transcript is on its way — one source, so there is no state to leave locked
     when a dictation ends in a way nobody anticipated. */
  const readOnly = dictation.transcribing;
  const again = useCallback(() => {
    closeAgain();
    wantSend.current = { key: key.current };
    setSendingAfter(true);
  }, [closeAgain]);

  const finishThenDone = useCallback(() => {
    if (!done.current) return;
    if (!dictation.armed && !dictation.transcribing) return;
    /* **The wish before the stop**, because a stop can end the session in the
       same turn (Safari has no live recogniser to wait for), and an `onEnd`
       that ran first would find no wish and the words would land unsent. */
    closeAgain();
    wantSend.current = { key: key.current };
    setSendingAfter(true);
    /* Stop it, unless the cap already has: a press there must never reach the
       hook's start branch (`toggle` above, and the hook's own grace). */
    const capped = dictation.endsAt !== null && Date.now() >= dictation.endsAt;
    if (dictation.armed && !capped) dictation.toggle();
  }, [dictation, closeAgain]);

  /* **A wish never crosses into another session.** Every session begins in
     `opening`, including the one the hook starts by itself when the reader
     picks another microphone, which ends the old session without an `onEnd`
     to clear the wish. GPT Sol's plan review of 261010f, F6. */
  const phase = dictation.phase;
  useEffect(() => {
    if (phase !== "opening") return;
    wantSend.current = null;
    setSendingAfter(false);
  }, [phase]);
  return {
    dictation,
    readOnly,
    busy: readOnly || dictation.armed,
    toggle,
    ...(onDone && againOpen && readOnly ? { again } : {}),
    finishThenDone,
    sendingAfter,
    doubleStop: onDone !== undefined,
  };
}
