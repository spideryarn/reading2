/**
 * **Is anything actually reaching the microphone?**
 *
 * Measures a live audio track sixty times a second and writes the answer
 * somewhere React will never see it. The arithmetic is in
 * [`audio-level.ts`](./audio-level.ts); this file is the plumbing and the
 * lifecycle, which is where all the traps are.
 *
 * Why it exists is docs/plans/260827f-microphone-level-meter.md: pressing the
 * microphone produced, for the first several seconds, no observable change
 * anywhere the reader was looking. This is the instrument that separates the
 * states they could not otherwise tell apart — *not open yet*, *working, the
 * recogniser is thinking*, and *nothing coming in*.
 *
 * ## It is handed a track; it does not go and get one
 *
 * This is the important structural decision and it came out of GPT Sol's review
 * (2026-08-27, items 1, 2 and 4). The obvious design — this hook opens its own
 * `getUserMedia` alongside the recogniser — is **not safe**: WebKit supports one
 * microphone source at a time, and a second capture can kill the first or
 * silently switch the routing, so on an iPad the meter could animate from one
 * microphone while recognition received another, or stop recognition dead.
 *
 * So [`useDictation`](./useDictation.ts) owns the track, hands the *same* one to
 * the recogniser and to this hook, and there is only ever one capture. That
 * also makes the meter honest in a way a second stream could never be: it is
 * showing the exact audio being transcribed, not a second opinion about the
 * room.
 *
 * ## The four things that go wrong
 *
 * 1. **The level must not go through React state.** Sixty renders a second of a
 *    page this size to move five bars is absurd. The number lives in a ref and
 *    the DOM is written directly; `quiet` and `measuring` are state because they
 *    change a handful of times per session.
 * 2. **A suspended context repeats its last buffer.** `AnalyserNode` on a
 *    suspended `AudioContext` keeps returning the same samples, which reads as a
 *    perfectly flat microphone — the exact thing this feature exists to
 *    distinguish. So nothing is assessed unless the context is `running` and
 *    the track is live and unmuted.
 * 3. **`requestAnimationFrame` does not run in a hidden document.** The
 *    activity clock therefore sees one enormous gap when the reader comes back,
 *    and would report a perfectly good microphone as quiet. Both a
 *    `visibilitychange` listener and a frame-gap guard reset it.
 * 4. **Teardown must not leave the analyser attached.** The context is shared
 *    and long-lived (see `useDictation`), so a node left connected across a
 *    stop/start cycle is a leak that accumulates for as long as the page is
 *    open.
 */
import { type MutableRefObject, useEffect, useRef, useState } from "react";
import { ACTIVITY_LEVEL, levelFromRms, rmsFromTimeDomain, smoothLevel } from "./audio-level.js";

/**
 * How long with no activity before the neutral line appears, in ms.
 *
 * Ten seconds rather than the four an earlier draft had. A reader presses the
 * button, thinks, and then speaks; four seconds accuses them of a broken
 * microphone while they compose a sentence. GPT Sol's review, item 6.
 */
const QUIET_AFTER_MS = 10_000;
/** A frame gap longer than this means the document was hidden, not that the room was quiet. */
const STALL_MS = 1000;

export interface AudioLevel {
  /**
   * 0..1, updated every animation frame. **A ref, not state** — read it from a
   * rAF loop and write it to the DOM. Reading it during render gets whatever it
   * was at that instant, which is not wrong so much as meaningless.
   */
  level: MutableRefObject<number>;
  /** We are genuinely reading samples from a running context and a live track. */
  measuring: boolean;
  /**
   * Measuring, and nothing above {@link ACTIVITY_LEVEL} for {@link QUIET_AFTER_MS}.
   *
   * An observation, **not a diagnosis**. Nothing built on this may tell the
   * reader their microphone is broken; see the note on `ACTIVITY_LEVEL`.
   */
  quiet: boolean;
}

/**
 * @param track the live microphone track, or `null` when not listening.
 * @param ctx a running `AudioContext`, created and resumed inside the click
 * that started this — see `useDictation`. `null` if Web Audio is unavailable.
 */
export function useAudioLevel(
  track: MediaStreamTrack | null,
  ctx: AudioContext | null,
): AudioLevel {
  const level = useRef(0);
  const [measuring, setMeasuring] = useState(false);
  const [quiet, setQuiet] = useState(false);

  useEffect(() => {
    level.current = 0;
    setMeasuring(false);
    setQuiet(false);
    if (!track || !ctx || track.readyState !== "live") return;

    let live = true;
    let frame = 0;
    let source: MediaStreamAudioSourceNode;
    let analyser: AnalyserNode;
    try {
      /* A `MediaStream` wrapping the one track we were given, because
         `createMediaStreamSource` takes a stream and we deliberately do not have
         a second one to hand. Same track, so still one capture. */
      source = ctx.createMediaStreamSource(new MediaStream([track]));
      analyser = ctx.createAnalyser();
    } catch {
      return;
    }
    // 2048 samples is ~46ms at 44.1kHz: long enough that the RMS is a level
    // rather than a single glottal pulse, short enough to feel immediate.
    analyser.fftSize = 2048;
    /* Connected to the analyser and to nothing else. An `AnalyserNode` fills its
       buffers whether or not anything downstream is listening, so there is no
       `connect(ctx.destination)` here — and that absence is deliberate rather
       than forgotten: it would play the reader's own voice back through their
       speakers and into the microphone. */
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);

    let lastFrameAt = performance.now();
    let lastActiveAt = performance.now();
    /* Local mirrors of the two state values. React bails out of a re-render
       when a setter is handed the value it already has, but it still schedules
       a pass to find that out — thirty times a second, for the whole time the
       microphone is on. Comparing here means the setters are called only on an
       actual transition, which is a handful of times per session. */
    let isMeasuring = false;
    let isQuiet = false;
    const measuringIs = (next: boolean) => {
      if (isMeasuring === next) return;
      isMeasuring = next;
      setMeasuring(next);
    };
    const quietIs = (next: boolean) => {
      if (isQuiet === next) return;
      isQuiet = next;
      setQuiet(next);
    };
    /* Rule 3. Coming back to a tab is not evidence about anybody's microphone. */
    const wake = () => {
      lastActiveAt = performance.now();
      lastFrameAt = performance.now();
    };
    document.addEventListener("visibilitychange", wake);

    measuringIs(true);

    const tick = () => {
      if (!live) return;
      frame = requestAnimationFrame(tick);
      const now = performance.now();
      const gap = now - lastFrameAt;
      lastFrameAt = now;

      /* Rule 2. A suspended context hands back its last buffer for ever, and an
         ended or muted track is not evidence of a quiet room either. In all
         three cases we know nothing, so we say nothing and let the level fall
         rather than reporting a flat line as a measurement. */
      const usable = ctx.state === "running" && track.readyState === "live" && !track.muted;
      if (!usable) {
        level.current = smoothLevel(level.current, 0, gap);
        lastActiveAt = now;
        measuringIs(false);
        quietIs(false);
        return;
      }
      measuringIs(true);

      analyser.getFloatTimeDomainData(buf);
      const next = levelFromRms(rmsFromTimeDomain(buf));
      level.current = smoothLevel(level.current, next, gap);

      if (gap > STALL_MS) lastActiveAt = now;
      if (next > ACTIVITY_LEVEL) lastActiveAt = now;
      quietIs(now - lastActiveAt > QUIET_AFTER_MS);
    };
    frame = requestAnimationFrame(tick);

    return () => {
      live = false;
      if (frame) cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", wake);
      /* Rule 4. The context outlives this hook, so both nodes have to come off
         it explicitly or every stop/start cycle leaves one behind. The track is
         emphatically **not** stopped here: it belongs to `useDictation`, and
         stopping somebody else's track is how the recogniser loses its input. */
      try {
        source.disconnect();
        analyser.disconnect();
      } catch {
        /* Already gone — a closed context throws here, and there is nothing to
           do about it and nothing worth telling anybody. */
      }
      level.current = 0;
    };
  }, [track, ctx]);

  return { level, measuring, quiet };
}
