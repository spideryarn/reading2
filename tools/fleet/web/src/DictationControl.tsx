/**
 * **The microphone button beside a message box, in this page's own language.**
 *
 * Press it, talk, press it again, and the words are in the box.
 *
 * ## Why this is not `src/web/DictationStrip.tsx`
 *
 * Everything *behind* the button is the product's, reused rather than copied:
 * `useDictationField` for the caret and the closed box, `useDictation` for the
 * four phases and the one owned track, `mic-lock` for the page's single
 * microphone, `useAudioLevel` for the meter. That is ~3,200 lines this file does
 * not contain.
 *
 * The **chrome** is ours, and that is a decision rather than an oversight.
 * `DictationStrip.tsx` renders against hand-written class names — `prof-mic-note`,
 * `prof-listening`, `prof-interim` — from a stylesheet this page does not load,
 * so importing it would typecheck, build, and render an unstyled button. On top
 * of that the product is dark unconditionally and this page follows the device
 * between light and dark, so the strip would be the wrong colours even once the
 * CSS was copied. Reuse the machinery, write the chrome.
 *
 * ## The meter reads the track that is being recorded
 *
 * Never a second capture. `useDictation` owns one `MediaStreamTrack` and hands
 * the same one to the recorder and to the analyser, because WebKit supports one
 * microphone source at a time and a second `getUserMedia` can kill the first or
 * silently reroute it.
 *
 * **A quiet meter is an observation, not a claim that the microphone is
 * broken** — live-conversation.md's sentence, and it is why `quiet` below says
 * "we are not hearing much" rather than "your microphone is not working".
 *
 * ## Everything says which of three things went wrong
 *
 * On a phone, *the microphone gave us nothing*, *the upload failed* and *the
 * model refused* all look like "the button does nothing". Every failure here
 * arrives as a sentence with a bracketed code in it, from `dictation-errors.ts`
 * (the recogniser), `useDictation` (the capture) or the server. None of them is
 * swallowed.
 */
import { useEffect, useRef, type MutableRefObject, type ReactNode } from "react";

import type { UseDictation } from "../../../../src/web/useDictation.js";
import { useDictationField } from "../../../../src/web/useDictationField.js";
import { sendForTranscription, type FleetDictationContext } from "./dictation-client.js";
import { Button, cx } from "./ui";

export type { FleetDictationContext };

/**
 * Wire a text box to the microphone.
 *
 * Returns what a box needs and nothing more: put `readOnly` on the box, `ref` on
 * the box, and `<DictationControl>` next to the send button.
 *
 * **Guard your submit on `armed` as well as `readOnly`.** They are not the same
 * thing and the second is the one everybody forgets: `readOnly` is the two
 * seconds *after* the press to stop, `armed` is the microphone actually being
 * on. Guard only the first and Enter mid-sentence sends the rough live guesses,
 * or on Safari and Firefox sends nothing that was said at all. GPT Sol found
 * exactly that in the product's Feedback dialog. `sendBlocked` below is both,
 * so a caller has one thing to use.
 */
export function useFleetDictation({
  value,
  onChange,
  box,
  context,
}: {
  value: string;
  onChange(next: string): void;
  box: React.RefObject<HTMLTextAreaElement | null>;
  context: FleetDictationContext;
}): {
  dictation: UseDictation;
  toggle(): void;
  readOnly: boolean;
  /** True while a press of Send would send the wrong words, or none. */
  sendBlocked: boolean;
} {
  const field = useDictationField<FleetDictationContext>({
    value,
    onChange,
    box,
    context,
    transcribe: sendForTranscription,
  });
  return {
    dictation: field.dictation,
    toggle: field.toggle,
    readOnly: field.readOnly,
    sendBlocked: field.readOnly || field.dictation.armed,
  };
}

/**
 * Five bars driven from a ref in a `requestAnimationFrame`, never from render.
 *
 * A level that went through React state would re-render the whole panel thirty
 * times a second while somebody talked. The number is written to a CSS variable
 * and the bars scale off it, so a frame costs one style write.
 *
 * Rounded to two places and skipped when unchanged, so a silent room does not
 * invalidate style thirty times a second for no reason.
 */
function Level({ level, detected }: { level: MutableRefObject<number>; detected: boolean }): ReactNode {
  const root = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    let frame = 0;
    let last = -1;
    const tick = (): void => {
      frame = requestAnimationFrame(tick);
      const rounded = Math.round(Math.min(1, Math.max(0, level.current)) * 100) / 100;
      if (rounded === last) return;
      last = rounded;
      el.style.setProperty("--level", String(rounded));
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [level]);

  /* Centre-weighted, because a row of identical bars rising together reads as
     one fat bar; weighting the middle taller makes it read as a waveform, which
     is a shape people already know. `aria-hidden` because it is a picture of a
     number the strip beside it says in words. */
  return (
    <span
      ref={root}
      aria-hidden="true"
      className="tw:inline-flex tw:h-4 tw:items-center tw:gap-[2px]"
      style={{ ["--level" as string]: 0 }}
    >
      {[0.45, 0.75, 1, 0.75, 0.45].map((w, i) => (
        <i
          // biome-ignore lint/suspicious/noArrayIndexKey: five fixed bars, never reordered
          key={i}
          className={cx(
            "tw:w-[3px] tw:rounded-full tw:bg-work",
            /* The binary flag is coarse — 0 or 1 — so it gets a transition and
               the measured RMS does not. Both are real observations of real
               audio; neither is ever invented. */
            detected && "tw:transition-[height] tw:duration-150",
          )}
          style={{
            height: `calc(3px + (var(--level) * ${w} * 13px))`,
          }}
        />
      ))}
    </span>
  );
}

/**
 * **Whether the page is served somewhere a browser will open a microphone.**
 *
 * `window.isSecureContext` rather than sniffing the protocol, because the rule
 * is not "https": `localhost` and `127.0.0.1` are trustworthy by exception, and
 * the ssh forward Greg uses from his laptop lands on exactly those. The browser
 * already knows the answer, so asking it is both shorter and right about cases
 * a hand-written check would get wrong.
 *
 * Guarded for `undefined` because this file is unit-testable outside a browser,
 * and a missing `window` there must not read as "insecure".
 */
function isInsecureContext(): boolean {
  return typeof window !== "undefined" && window.isSecureContext === false;
}

/**
 * What the reader is told, in the order the states actually happen.
 *
 * There is a **measured 1.1-second gap** between pressing the button and the
 * microphone opening, and it used to be invisible — so somebody pressed, said a
 * word into nothing, and concluded the feature was broken. "Opening the
 * microphone…" is that gap made visible.
 */
function statusLine(d: UseDictation): string | null {
  if (d.error !== null) return null; // The error has its own line, louder.
  if (d.transcribing) return "Writing down what you said…";
  if (!d.armed) return null;
  if (d.startedAt === null) return "Opening the microphone…";
  if (!d.liveText) return "Listening. The words arrive when you stop.";
  return "Listening.";
}

export function DictationControl({
  dictation,
  toggle,
  className,
}: {
  dictation: UseDictation;
  toggle(): void;
  className?: string;
}): ReactNode {
  /* **A button that cannot work is worse than no button — and a button that
     silently is not there is worse than both.**

     `supported` means "can open a microphone", not "has Web Speech", so Firefox
     gets a button and a transcript and only the live words are missing. But it
     is also false in the case that actually happens here, and it is not about
     the browser at all: **`navigator.mediaDevices` is `undefined` outside a
     secure context**, and this server is plain HTTP on a tailnet address.
     `127.0.0.1` and `localhost` are trustworthy by exception, so dictation works
     over an ssh forward and does not work on a phone reaching
     `http://100.92.255.119:8787` — which is exactly how Greg reads this page.

     Rendering `null` there would have been the fifth silently-dead feature this
     tool has had in a day: no button, no error, nothing to search for. So the
     reason is said out loud, and the two reasons are told apart, because only
     one of them has a fix and the fix is not in this repo. */
  if (!dictation.supported) {
    return (
      <p className={cx("tw:text-[12px] tw:text-ink-faint", className)}>
        {isInsecureContext()
          ? "No dictation here: browsers only open a microphone on a secure page, and this one is plain HTTP over the tailnet. It works over an ssh forward to localhost, and would work on the phone behind `tailscale serve`."
          : "This browser will not open a microphone, so there is no dictation here. Type instead."}
      </p>
    );
  }

  const status = statusLine(dictation);

  return (
    <div className={cx("tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-2", className)}>
      <Button
        onClick={toggle}
        aria-pressed={dictation.armed}
        /* Disabled through the gap, and ONLY through the gap. A press here could
           only mean "start again", and starting again a moment before the words
           arrive throws away the dictation just given. Never disabled while
           armed — the same button is Stop, and disabling it mid-dictation would
           trap the recording, which GPT Sol caught as a P0 in the product. */
        disabled={dictation.transcribing}
        className={cx(dictation.armed && "tw:border-alarm tw:text-alarm-ink")}
      >
        {dictation.armed ? (
          <>
            <span aria-hidden="true">■</span> Stop
          </>
        ) : (
          <>
            <span aria-hidden="true">🎤</span> {dictation.transcribing ? "Writing…" : "Dictate"}
          </>
        )}
      </Button>

      {dictation.armed && dictation.meter !== "none" ? (
        <Level level={dictation.level} detected={dictation.meter === "detected"} />
      ) : null}

      {status === null ? null : (
        <span className="tw:min-w-0 tw:text-[12px] tw:text-ink-soft" aria-live="polite">
          {status}
        </span>
      )}

      {/* The unconfirmed tail, greyed, never saved. Chromium only — and its
          absence elsewhere is why the status line above says the words arrive at
          the end rather than leaving somebody watching an empty box. */}
      {dictation.armed && dictation.interim !== "" ? (
        <span className="tw:min-w-0 tw:truncate tw:text-[12px] tw:text-ink-faint tw:italic">
          {dictation.interim}
        </span>
      ) : null}

      {/* AN OBSERVATION, NOT A DIAGNOSIS. Nothing here may tell somebody their
          microphone is broken on the strength of a quiet meter — the room may be
          quiet, or they may not have started yet. */}
      {dictation.armed && dictation.quiet ? (
        <span className="tw:text-[12px] tw:text-needs-ink">
          Not hearing much{dictation.deviceLabel === null ? "" : ` from “${dictation.deviceLabel}”`}.
        </span>
      ) : null}

      {dictation.deviceUnavailable ? (
        <span className="tw:text-[12px] tw:text-needs-ink">
          The microphone you picked wasn’t available, so this is a different one.
        </span>
      ) : null}

      {dictation.error === null ? null : (
        <span className="tw:min-w-0 tw:text-[12px] tw:text-alarm-ink">{dictation.error}</span>
      )}

      {/* Offered ONLY when a second attempt could plausibly go the other way —
          `canRetry` is false after a success with an empty transcript, where
          sending the same silence again spends a call to produce the same
          nothing. The audio is already in memory, so this is a second REQUEST,
          not a second recording: no microphone, no permission. */}
      {dictation.canRetry ? (
        <Button onClick={dictation.retry} disabled={dictation.transcribing}>
          Try again
        </Button>
      ) : null}
    </div>
  );
}
