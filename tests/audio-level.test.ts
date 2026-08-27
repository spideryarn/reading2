/**
 * **The number behind the moving bars.**
 *
 * A level meter is the [silent-success](../docs/reusable/silent-success.md)
 * pattern waiting to happen: bars that wobble prettily while reading a constant
 * look exactly like bars that are reading a microphone, and the whole point of
 * this feature is to be believed. So the arithmetic between the samples and the
 * bar height lives in a pure module and is checked here, rather than being four
 * lines inside a `requestAnimationFrame` where nothing can see it.
 *
 * What is being pinned:
 *
 * 1. **The mapping is monotonic and spans the range.** A meter that saturates at
 *    conversational volume tells you nothing about whether you are audible, and
 *    one that never leaves the bottom third looks broken while working.
 * 2. **Ordinary speech lands in the visible middle.** This is the one that stops
 *    the meter being useless while being technically correct.
 * 3. **The smoothing rises instantly and falls gently.** A meter that lags the
 *    voice on the way up feels disconnected from the person talking into it.
 * 4. **Nothing here is a fault diagnosis.** `ACTIVITY_LEVEL` exists to decide
 *    whether to say a neutral "no sound detected yet"; an earlier draft crossed
 *    a threshold like this with a four-second timer and accused the reader's
 *    hardware of being broken. GPT Sol's review, 2026-08-27, item 6.
 */
import { describe, expect, it } from "vitest";
import {
  ACTIVITY_LEVEL,
  levelFromDb,
  levelFromRms,
  rmsFromTimeDomain,
  smoothLevel,
} from "../src/web/audio-level.js";

/** What `getFloatTimeDomainData` writes when the device delivers nothing. */
function silence(n = 2048): Float32Array {
  return new Float32Array(n);
}

/** A sine at a given amplitude in 0..1 — what a tone into a live mic looks like. */
function tone(amplitude: number, n = 2048): Float32Array {
  const buf = new Float32Array(n);
  for (let i = 0; i < n; i++) buf[i] = Math.sin((i / n) * Math.PI * 2 * 8) * amplitude;
  return buf;
}

describe("rmsFromTimeDomain", () => {
  it("reads digital silence as zero", () => {
    expect(rmsFromTimeDomain(silence())).toBe(0);
  });

  it("reads a full-scale sine as about 1/√2", () => {
    // The RMS of a sine is its amplitude over root two. If this drifts, the dB
    // mapping below is measuring something else and the bars are decorative.
    expect(rmsFromTimeDomain(tone(1))).toBeCloseTo(Math.SQRT1_2, 2);
  });

  it("rises with amplitude", () => {
    expect(rmsFromTimeDomain(tone(0.02))).toBeLessThan(rmsFromTimeDomain(tone(0.4)));
    expect(rmsFromTimeDomain(tone(0.02))).toBeGreaterThan(0);
  });

  it("does not care which side of zero the wave is on", () => {
    // Squaring is what makes the sign irrelevant. A mean-without-squaring bug
    // reads any symmetrical waveform — i.e. all of them — as silence.
    expect(rmsFromTimeDomain(new Float32Array([0.5, 0.5]))).toBeCloseTo(
      rmsFromTimeDomain(new Float32Array([-0.5, -0.5])),
      6,
    );
    expect(rmsFromTimeDomain(new Float32Array([0.5, -0.5]))).toBeCloseTo(0.5, 6);
  });

  it("survives an empty buffer rather than returning NaN", () => {
    expect(rmsFromTimeDomain(new Float32Array(0))).toBe(0);
  });
});

describe("levelFromRms", () => {
  it("is 0 at silence and 1 at full scale", () => {
    expect(levelFromRms(0)).toBe(0);
    expect(levelFromRms(1)).toBe(1);
  });

  it("never leaves 0..1, whatever it is handed", () => {
    for (const rms of [-1, 0, 1e-12, 0.001, 0.5, 1, 4, Number.NaN, Number.POSITIVE_INFINITY]) {
      const level = levelFromRms(rms);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });

  it("climbs monotonically", () => {
    let last = -1;
    for (let rms = 0; rms <= 1; rms += 0.005) {
      const level = levelFromRms(rms);
      expect(level).toBeGreaterThanOrEqual(last);
      last = level;
    }
  });

  it("puts ordinary speech in the visible middle, not pinned at either end", () => {
    /* Speech into a laptop mic sits near −30 dBFS. A *linear* map would put it
       at about 3% of the bar — numerically correct, and it would tell the
       reader their microphone is dead while they talked into it. */
    const speech = levelFromRms(0.03);
    expect(speech).toBeGreaterThan(0.3);
    expect(speech).toBeLessThan(0.9);
    expect(speech).toBeGreaterThan(0.03 * 8); // decisively better than linear
  });

  it("keeps room tone visibly off the floor", () => {
    // Somebody sitting quietly still gets a flicker, which is how they know we
    // are listening at all.
    expect(levelFromRms(0.004)).toBeGreaterThan(0.05);
  });

  it("agrees with levelFromDb", () => {
    expect(levelFromRms(0.03)).toBeCloseTo(levelFromDb(20 * Math.log10(0.03)), 10);
  });
});

describe("ACTIVITY_LEVEL", () => {
  it("sits between digital silence and a quiet room", () => {
    expect(levelFromRms(rmsFromTimeDomain(silence()))).toBeLessThan(ACTIVITY_LEVEL);
    // A room at roughly −48 dBFS is somebody breathing, and must count as activity.
    expect(levelFromRms(rmsFromTimeDomain(tone(0.006)))).toBeGreaterThan(ACTIVITY_LEVEL);
  });

  it("is low enough that ordinary speech clears it by a mile", () => {
    expect(levelFromRms(0.03)).toBeGreaterThan(ACTIVITY_LEVEL * 2);
  });
});

describe("smoothLevel", () => {
  it("jumps straight to a louder reading", () => {
    // Attack is instant: the instant the reader speaks, the bars move. Anything
    // slower reads as a meter that is not connected to them.
    expect(smoothLevel(0.1, 0.9)).toBe(0.9);
    expect(smoothLevel(0, 1)).toBe(1);
  });

  it("eases down rather than dropping out between syllables", () => {
    const next = smoothLevel(1, 0);
    expect(next).toBeLessThan(1);
    expect(next).toBeGreaterThan(0.5);
  });

  it("converges on the target rather than undershooting past it", () => {
    let v = 1;
    for (let i = 0; i < 500; i++) v = smoothLevel(v, 0);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(0.001);
  });

  it("falls at the same rate on a 120Hz screen as on a 60Hz one", () => {
    /* The decay is per millisecond, not per frame. A fixed fraction per frame
       would decay twice as fast on a 120Hz iPad — a different personality on
       the device this app frets most about, and invisible in code review
       because nothing in the code says a frame is a unit of time.
       GPT Sol's code review, 2026-08-27, item 9. */
    let at60 = 1;
    for (let i = 0; i < 30; i++) at60 = smoothLevel(at60, 0, 16.7);
    let at120 = 1;
    for (let i = 0; i < 60; i++) at120 = smoothLevel(at120, 0, 8.35);
    expect(at120).toBeCloseTo(at60, 3);
  });

  it("eases rather than snapping when a frame arrives very late", () => {
    /* A tab coming back delivers one enormous gap. The step is clamped, so the
       meter falls a long way in that frame and then keeps falling normally —
       rather than teleporting to zero, which on the reader's screen is a flash
       rather than a level. */
    const afterAMinuteAway = smoothLevel(1, 0, 60_000);
    expect(afterAMinuteAway).toBeGreaterThan(0);
    expect(afterAMinuteAway).toBeLessThan(0.3);
    // A garbage delta must not produce a garbage level either.
    expect(smoothLevel(1, 0, Number.NaN)).toBeLessThan(1);
    expect(smoothLevel(1, 0, Number.NaN)).toBeGreaterThan(0);
    expect(smoothLevel(1, 0, -5)).toBeLessThan(1);
  });

  it("recovers from a NaN rather than poisoning every later frame", () => {
    // A NaN written into a CSS custom property makes every bar vanish, which
    // looks exactly like the broken microphone this feature exists to rule out.
    expect(smoothLevel(Number.NaN, 0.5)).toBe(0.5);
  });
});
