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

/** Two soft notes, falling: a "hm?", not an alarm. */
const NOTES = [
  { hz: 660, at: 0 },
  { hz: 523, at: 0.16 },
] as const;
const NOTE_S = 0.14;
/** Peak gain. Quiet on purpose: it should be noticed by somebody listening for it, not jump anybody. */
const PEAK = 0.04;

export function playQuietChime(ctx: AudioContext): void {
  try {
    const t0 = ctx.currentTime;
    for (const n of NOTES) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(n.hz, t0 + n.at);
      /* A ramp in and out rather than a step: a sine switched on at full gain
         clicks, and a click is the opposite of subtle. */
      gain.gain.setValueAtTime(0, t0 + n.at);
      gain.gain.linearRampToValueAtTime(PEAK, t0 + n.at + 0.02);
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
