/**
 * **How loud is it, right now.** The arithmetic behind the moving bars, kept
 * out of the animation frame so it can be looked at.
 *
 * A level meter is a machine for being believed: bars that wobble prettily
 * while reading nothing look exactly like bars reading a microphone, and the
 * entire reason this feature exists is that the reader cannot otherwise tell
 * whether anything is getting in (docs/plans/microphone-level-meter.md). That
 * is [silent-success](../../docs/reusable/silent-success.md) with a picture on
 * it, so the arithmetic that matters lives here with tests round it rather than
 * inside a `requestAnimationFrame` callback where nothing can see it.
 *
 * ## Float samples, not bytes
 *
 * `AnalyserNode` offers `getByteTimeDomainData` and `getFloatTimeDomainData`.
 * We take the float one. The byte form quantises to `floor(128 × (1 + sample))`
 * — about 1/128 of full scale per step — which is roughly −42 dBFS of
 * resolution at the bottom of the range, and the bottom of the range is the
 * entire question here. Distinguishing *a quiet room* from *a dead device* in
 * units that coarse means reading a number that is mostly rounding.
 * GPT Sol's review, 2026-08-27, item 7. The float array costs nothing extra.
 *
 * ## Time domain, not frequency
 *
 * The question is *how loud*, not *what pitch*, and the honest answer to
 * how-loud is the RMS of the waveform. A spectrum would make a prettier
 * animation and would be a picture of something nobody asked about.
 *
 * ## Why decibels
 *
 * This is the part that is not obvious and is the difference between a useful
 * meter and a decorative one. Ordinary speech into a laptop microphone sits
 * around an RMS of **0.03** — about −30 dBFS. Mapped linearly to a bar height
 * that is **3% of the bar**, which to the eye is indistinguishable from
 * silence. The meter would be numerically correct and would tell the reader
 * their microphone is dead while they talked into it.
 *
 * Hearing is roughly logarithmic, so the mapping is too: a decibel window from
 * {@link FLOOR_DB} to {@link CEIL_DB} stretched over the full bar. Speech lands
 * in the middle, a raised voice reaches the top, and a quiet room still
 * flickers visibly off the bottom — which is how somebody sitting still knows
 * we are listening at all.
 */

/**
 * Below this the bar is empty.
 *
 * **−70 and not −60, and that was measured rather than chosen.** The first
 * version used −60 on the reasoning that it is "quieter than any room with a
 * person in it". Then the meter was watched in a real one: Chrome, a quiet
 * study, 2026-08-27 — room tone came in at an RMS of 0.0003–0.0027, which is
 * −70 to −51 dBFS. A −60 floor put the ordinary state of a real room *at or
 * below zero*, so the bars sat perfectly flat while the microphone worked
 * perfectly, which is the exact failure this whole feature exists to prevent.
 *
 * The number that matters is not "how quiet is silence" — it is how quiet a
 * working microphone in an empty room is, and that is a good deal quieter than
 * it sounds like it should be.
 */
const FLOOR_DB = -70;
/** At or above this the bar is full. −12 dBFS is a raised voice close to the mic. */
const CEIL_DB = -12;

/**
 * The level below which nothing is happening, for the purpose of the neutral
 * "no sound detected yet" line.
 *
 * **This is an activity threshold and not a fault diagnosis, and the difference
 * is the whole design.** An earlier draft of this feature crossed a similar
 * number with a four-second timer and told the reader *"No sound reaching the
 * microphone. Check your input device."* GPT Sol's review killed it (item 6)
 * and was right to: somebody presses the button, thinks for five seconds, then
 * speaks. Heavy noise gating on a headset can also deliver exact silence until
 * the first syllable. Both produce the accusation, and a reader who is told
 * their hardware is broken goes and changes settings that were fine.
 *
 * So nothing here ever says the microphone failed. Only `audio-capture`, a
 * dead track, or a refused `getUserMedia` earns that sentence, and all three
 * are facts rather than inferences. This threshold earns one neutral
 * observation, later, and it does not accuse anybody of anything.
 *
 * −55 dBFS as a level. Deliberately at the quiet end of the measured room-tone
 * range (−70 to −51 dBFS in the study this was built in) rather than in the
 * middle of it: the threshold's only job is to decide whether to say something
 * mild, and every doubt should resolve as *say nothing*.
 */
export const ACTIVITY_LEVEL = levelFromDb(-55);

/**
 * Root mean square of a float time-domain buffer, as a fraction of full scale.
 *
 * @returns 0 for silence, ~0.707 for a full-scale sine. Always finite; an empty
 * buffer is 0 rather than `NaN`.
 */
export function rmsFromTimeDomain(buf: Float32Array): number {
  if (buf.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < buf.length; i++) {
    const d = buf[i] as number;
    sum += d * d;
  }
  const rms = Math.sqrt(sum / buf.length);
  return Number.isFinite(rms) ? rms : 0;
}

/** dBFS to a bar height in 0..1. Split out so {@link ACTIVITY_LEVEL} can be stated in decibels. */
export function levelFromDb(db: number): number {
  const level = (db - FLOOR_DB) / (CEIL_DB - FLOOR_DB);
  return Math.min(1, Math.max(0, level));
}

/**
 * An RMS turned into a bar height in 0..1.
 *
 * Clamped at both ends and total over its input: a `NaN` from somewhere reads
 * as silence rather than propagating into a CSS custom property, where it would
 * make every bar vanish and look precisely like a broken microphone.
 */
export function levelFromRms(rms: number): number {
  if (!Number.isFinite(rms) || rms <= 0) return 0;
  return levelFromDb(20 * Math.log10(Math.min(rms, 1)));
}

/**
 * How long the meter takes to fall most of the way, in milliseconds.
 *
 * Only the falling half is smoothed. Rising is instant, which is what makes the
 * meter feel connected to the reader: the moment they speak, it jumps.
 */
const RELEASE_MS = 130;

/**
 * One step of the meter's smoothing: **fast up, slow down**.
 *
 * A meter that tracks the waveform exactly reads as a flicker rather than as a
 * level; one smoothed in both directions lags the voice and feels broken.
 * Falling gently is what stops it strobing between syllables.
 *
 * **The decay is per millisecond, not per frame**, and that is not pedantry: a
 * fixed fraction per frame decays twice as fast on a 120Hz iPad as on a 60Hz
 * laptop, so the meter would have a different personality on the device this
 * app frets most about — and it would be a difference nobody could see in code
 * review, because the code contains no clue that a frame is a unit of time.
 * GPT Sol's code review, 2026-08-27, item 9.
 *
 * @param dtMs milliseconds since the previous step.
 */
export function smoothLevel(previous: number, target: number, dtMs = 16): number {
  if (!Number.isFinite(previous)) return target;
  if (target >= previous) return target;
  const dt = Number.isFinite(dtMs) && dtMs > 0 ? Math.min(dtMs, 250) : 16;
  /* Exponential decay towards the target: the fraction of the remaining gap
     closed in `dt`, framed so that any frame rate covers the same ground in the
     same wall-clock time. */
  const k = 1 - Math.exp(-dt / RELEASE_MS);
  return previous + (target - previous) * k;
}
