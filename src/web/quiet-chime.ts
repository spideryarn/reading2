/**
 * **The sound that goes with "No sound detected yet".**
 *
 * Greg, 2026-10-01, feedback report SPIDERYARN-READING2-7Z: *"Warn me (both
 * visually, and perhaps with a subtle auditory warning too) while recording if
 * it looks like this is a problem."* The visual half is the strip
 * ([DictationStrip.tsx](./DictationStrip.tsx)); this is the other half. Plan
 * docs/plans/261001k-dictation-silent-mic-warning-and-a-message-that-goes.md.
 *
 * ## Once per dictation, not once per stretch of quiet
 *
 * The chime can be heard by the microphone it is warning about — through the
 * speakers, or a loopback input. That sound ends the quiet, and ten seconds
 * later the quiet comes back; a rule that chimed on every arrival of quiet would
 * then chime every ten seconds for as long as the microphone was on. GPT Sol's
 * plan review, F3. The visual warning has no such loop, so it follows `quiet`
 * exactly.
 *
 * ## The page's own `AudioContext`, not a new one
 *
 * `useDictation` owns one context, created and resumed inside the press that
 * started the dictation. Safari limits contexts per page, and one made ten
 * seconds after the gesture may start suspended and play nothing. The meter
 * already reads from the shared one, and `quiet` can only become true while it
 * is running — so the chime borrows it. GPT Sol's plan review, F4.
 *
 * It is a nicety layered on the visual, not the warning itself: anything that
 * goes wrong here goes wrong silently.
 */
import { useEffect, useRef } from "react";
import { CAP_WARNING_MS } from "./mic-recording.js";

type Note = { hz: number; at: number };
/** Two soft notes, falling: a "hm?", not an alarm. */
const QUIET_NOTES: readonly Note[] = [
  { hz: 660, at: 0 },
  { hz: 523, at: 0.16 },
];
/** Two notes, rising: "a minute left". Told apart from the quiet chime by direction. */
const LAST_MINUTE_NOTES: readonly Note[] = [
  { hz: 523, at: 0 },
  { hz: 784, at: 0.16 },
];
/** Three notes, falling: "that was the end". */
const CAPPED_NOTES: readonly Note[] = [
  { hz: 784, at: 0 },
  { hz: 660, at: 0.16 },
  { hz: 523, at: 0.32 },
];
const NOTE_S = 0.14;
/** Peak gain. Quiet on purpose: it should be noticed by somebody listening for it, not jump anybody. */
const PEAK = 0.04;
/**
 * The two cap chimes are a little louder than the quiet one. They are for
 * somebody talking, who has to hear them over their own voice, and each plays
 * once, so there is no loop for the extra to feed.
 */
const CAP_PEAK = 0.09;
/** How late the last-minute chime may be and still mean what it says. */
const LATE_MS = 5000;

export function playQuietChime(ctx: AudioContext): void {
  play(ctx, QUIET_NOTES, PEAK);
}

/**
 * **The sound of a dictation being stopped at its cap.** Called by
 * `useDictation` at the moment it stops, with the sentence that says why.
 * Greg, spya-n8cuqq: *"if you're ever going to cut me off like that, you
 * should give me some kind of feedback of some kind."* Plan 261007b.
 */
export function playCappedChime(ctx: AudioContext): void {
  play(ctx, CAPPED_NOTES, CAP_PEAK);
}

/**
 * **Chime once when a dictation has a minute left** — `CAP_WARNING_MS` before
 * `endsAt`, the moment the strip starts counting down.
 *
 * A timer rather than a reading of the clock on each draw, because nothing
 * redraws the hook once a second. Once per `endsAt`: a dictation that is
 * stopped first clears the timer, and a new one arms its own.
 *
 * @param endsAt when the tape's ceiling will stop this dictation, or null
 * when nothing is recording.
 */
export function useLastMinuteChime(endsAt: number | null, ctx: AudioContext | null): void {
  useEffect(() => {
    if (endsAt === null || !ctx) return;
    const wait = endsAt - CAP_WARNING_MS - Date.now();
    /* Already inside the last minute when this mounted: the moment has gone,
       and a late chime would not mean "a minute left". */
    if (wait < 0) return;
    const timer = window.setTimeout(() => {
      /* A timer in a throttled tab, or on a laptop that slept, fires late. A
         chime that arrives with most of the minute gone, or after the cap,
         would say "a minute left" when there is not. GPT Sol's plan review of
         261007b, P5. */
      if (Date.now() - (endsAt - CAP_WARNING_MS) > LATE_MS) return;
      play(ctx, LAST_MINUTE_NOTES, CAP_PEAK);
    }, wait);
    return () => window.clearTimeout(timer);
  }, [endsAt, ctx]);
}

function play(ctx: AudioContext, notes: readonly Note[], peak: number): void {
  try {
    const t0 = ctx.currentTime;
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(n.hz, t0 + n.at);
      /* A ramp in and out rather than a step: a sine switched on at full gain
         clicks, and a click is the opposite of subtle. */
      gain.gain.setValueAtTime(0, t0 + n.at);
      gain.gain.linearRampToValueAtTime(peak, t0 + n.at + 0.02);
      gain.gain.linearRampToValueAtTime(0, t0 + n.at + NOTE_S);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(t0 + n.at);
      osc.stop(t0 + n.at + NOTE_S + 0.02);
    }
  } catch {
    /* A closed context, or one that refuses: the visual warning stands alone. */
  }
}

/**
 * Chime the first time `quiet` is true in the dictation named by `session`.
 *
 * @param session anything that names one dictation — `useDictation` passes
 * `startedAt` — or null when none is running, which never chimes.
 */
export function useQuietChime(quiet: boolean, session: number | null, ctx: AudioContext | null): void {
  const chimedFor = useRef<number | null>(null);
  useEffect(() => {
    if (!quiet || session === null || !ctx) return;
    if (chimedFor.current === session) return;
    chimedFor.current = session;
    playQuietChime(ctx);
  }, [quiet, session, ctx]);
}
