/**
 * The arithmetic of "where you have spent time reading" — src/web/reading-time.ts.
 * docs/plans/260916c-show-where-you-have-spent-time-reading-in-the-spine-and-gutter.md.
 */
import { describe, expect, it } from "vitest";
import {
  expectedSeconds,
  firstOnScreen,
  gutterCss,
  READ_REACH_FROM,
  READ_REACH_FULL,
  type ReadLevel,
  readLevel,
  readReach,
  shareVisible,
  spentWords,
} from "../src/web/reading-time.js";

describe("expectedSeconds", () => {
  it("is words at 230 a minute, in seconds — not minutes", () => {
    /* The plan's first formula was `words / 230`, which is minutes: a
       300-word paragraph would have looked read after 1.3 seconds. */
    expect(expectedSeconds(300)).toBeCloseTo((300 * 60) / 230, 6);
    expect(expectedSeconds(230)).toBe(60);
  });

  it("never falls under one second, for a heading or a figure", () => {
    expect(expectedSeconds(0)).toBe(1);
    expect(expectedSeconds(2)).toBe(1);
    expect(expectedSeconds(-5)).toBe(1);
  });
});

describe("readLevel", () => {
  /* Each level's elapsed threshold doubles — progressively delayed brightness
     (Greg, 2026-10-01, spya-d940uu). 300 words take 78.26 s. */
  const cases: [number, number, ReadLevel][] = [
    [0, 300, 0],
    [-1, 300, 0],
    [Number.NaN, 300, 0],
    [8, 300, 0], // 0.10 — a glance draws nothing
    [27, 300, 0], // 0.345
    [28, 300, 1], // 0.358
    [54, 300, 1], // 0.690
    [55, 300, 2], // 0.703 — the quiz's "read", where it always was
    [109, 300, 2], // 1.393
    [110, 300, 3], // 1.406
    [219, 300, 3], // 2.798
    [220, 300, 4], // 2.811
    [10_000, 300, 4],
    [0.5, 0, 1], // a figure: half a second of its one
    [1, 0, 2],
    [3, 0, 4],
    [21, 230, 1], // exactly 0.35
    [42, 230, 2], // exactly 0.70
    [84, 230, 3], // exactly 1.40
    [168, 230, 4], // exactly 2.80
  ];
  it.each(cases)("%s seconds on %s words is level %s", (seconds, words, level) => {
    expect(readLevel(seconds, words)).toBe(level);
  });
});

/**
 * `readReach` — how far across the rail a block's reading time reaches, in
 * sixteenths. docs/plans/261004j-spine-reading-chart-fainter-and-rarely-full.md.
 */
describe("readReach", () => {
  /** The representable doubles either side of `x`. */
  const f64 = new Float64Array(1);
  const u64 = new BigUint64Array(f64.buffer);
  const below = (x: number) => {
    f64[0] = x;
    u64[0] = u64[0]! - 1n;
    return f64[0]!;
  };
  const above = (x: number) => {
    f64[0] = x;
    u64[0] = u64[0]! + 1n;
    return f64[0]!;
  };

  it("draws nothing for nothing, a glance, or a number that is not one", () => {
    for (const s of [0, -1, Number.NaN, 0.1, 0.349]) expect(readReach(s, 0)).toBe(0);
  });

  /* Zero words is one expected second, so seconds *is* the ratio. */
  it("starts a quarter of the way across at the glance threshold, where the gutter's line starts", () => {
    expect(readReach(below(READ_REACH_FROM), 0)).toBe(0);
    expect(readReach(READ_REACH_FROM, 0)).toBe(4);
    expect(readReach(above(READ_REACH_FROM), 0)).toBe(4);
  });

  it("fills the rail only at 128 times the glance threshold — about 45 times the reading time", () => {
    expect(READ_REACH_FULL).toBe(READ_REACH_FROM * 128);
    expect(readReach(below(READ_REACH_FULL), 0)).toBe(15);
    expect(readReach(READ_REACH_FULL, 0)).toBe(16);
    expect(readReach(above(READ_REACH_FULL), 0)).toBe(16);
    expect(readReach(1e9, 0)).toBe(16);
  });

  it("is rarely full: what filled the rail until 2026-10-04 is now a little over a third of it", () => {
    /* Greg: "make it a bit logarithmic so it's rarer that the reading-time
       fills up completely all the way to the right". 2.8 of the reading time
       was full width; on his own reading 43% of the drawn passages reached it. */
    expect(readReach(1, 0)).toBe(6);
    expect(readReach(2.8, 0)).toBe(9);
    expect(readReach(10, 0)).toBe(12);
    expect(readReach(40, 0)).toBe(15);
  });

  it("holds the same scale against a real word count", () => {
    /* 230 words take 60 s: drawn from 21 s, full at 2688 s. */
    expect(readReach(below(21), 230)).toBe(0);
    expect(readReach(21, 230)).toBe(4);
    expect(readReach(60, 230)).toBe(6);
    expect(readReach(2687, 230)).toBe(15);
    expect(readReach(2688, 230)).toBe(16);
  });

  it("steps through every sixteenth, each the same share of a doubling", () => {
    /* Twelve steps over seven doublings, probed mid-step so the test is about
       the steps and not about how a power rounds. */
    for (let k = 0; k < 12; k++) {
      expect(readReach(READ_REACH_FROM * 2 ** ((7 * (k + 0.5)) / 12), 0), `step ${k}`).toBe(4 + k);
    }
  });

  it("never goes back as time passes, and draws exactly when the gutter's line does", () => {
    for (const words of [0, 1, 7, 230, 300, 1234]) {
      let last = 0;
      for (let i = 0; i <= 6000; i++) {
        const seconds = (i / 100) * expectedSeconds(words);
        const reach = readReach(seconds, words);
        if (!Number.isInteger(reach) || !(reach === 0 || (reach >= 4 && reach <= 16)) || reach < last) {
          throw new Error(`${seconds} s on ${words} words: reach ${reach} after ${last}`);
        }
        /* The two scales share only their start (the plan § What it gives up). */
        expect(reach > 0).toBe(readLevel(seconds, words) > 0);
        last = reach;
      }
      expect(last).toBe(16);
      /* The doubles either side of the start: a bare logarithm could disagree with `readLevel` there. */
      let lo = READ_REACH_FROM * expectedSeconds(words);
      let hi = lo;
      for (let n = 0; n < 50; n++) {
        expect(readReach(lo, words) > 0).toBe(readLevel(lo, words) > 0);
        expect(readReach(hi, words) > 0).toBe(readLevel(hi, words) > 0);
        lo = below(lo);
        hi = above(hi);
      }
    }
  });
});

describe("spentWords", () => {
  const cases: [number, string][] = [
    [0, "under a second"],
    [0.4, "under a second"],
    [Number.NaN, "under a second"],
    [0.5, "under a second"],
    [0.99, "under a second"],
    [1, "1 s"],
    [45.2, "45 s"],
    [59.6, "1 min"],
    [80, "1 min 20 s"],
    [599, "9 min 59 s"],
    [600, "10 min"],
    [869, "14 min"],
    [3599, "1 h"],
    [3900, "1 h 5 min"],
  ];
  it.each(cases)("%s seconds reads %s", (seconds, words) => {
    expect(spentWords(seconds)).toBe(words);
  });
});

describe("firstOnScreen", () => {
  const bottoms = [100, 200, 300, 400, 500];
  const at = (i: number) => bottoms[i] as number;

  it("finds the first row whose bottom is below the top of the view", () => {
    expect(firstOnScreen(bottoms.length, at, 0)).toBe(0);
    expect(firstOnScreen(bottoms.length, at, 100)).toBe(1);
    expect(firstOnScreen(bottoms.length, at, 250)).toBe(2);
  });

  it("answers the count when every row is above the view", () => {
    expect(firstOnScreen(bottoms.length, at, 500)).toBe(5);
    expect(firstOnScreen(0, at, 0)).toBe(0);
  });

  it("reads about log2 n rows, not all of them", () => {
    const n = 2048;
    let reads = 0;
    const idx = firstOnScreen(
      n,
      (i) => {
        reads++;
        return (i + 1) * 50;
      },
      50 * 1500,
    );
    expect(idx).toBe(1500);
    expect(reads).toBeLessThanOrEqual(12);
  });
});

describe("shareVisible", () => {
  it("shares one second between the rows on screen, by visible pixels", () => {
    const shares = shareVisible(
      [
        { id: "spya-aaaaaa", top: -50, bottom: 100 }, // 100px visible
        { id: "spya-bbbbbb", top: 100, bottom: 400 }, // 300px
        { id: "spya-cccccc", top: 400, bottom: 900 }, // 400px of it, to 800
      ],
      0,
      800,
    );
    expect(shares.get("spya-aaaaaa")).toBeCloseTo(0.125, 6);
    expect(shares.get("spya-bbbbbb")).toBeCloseTo(0.375, 6);
    expect(shares.get("spya-cccccc")).toBeCloseTo(0.5, 6);
    expect([...shares.values()].reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9);
  });

  it("gives a row taller than the window the whole second while it fills the screen", () => {
    const shares = shareVisible([{ id: "spya-aaaaaa", top: -2000, bottom: 3000 }], 60, 800);
    expect(shares.get("spya-aaaaaa")).toBe(1);
  });

  it("leaves out rows above, below, or under the sticky bar", () => {
    const shares = shareVisible(
      [
        { id: "spya-aaaaaa", top: 0, bottom: 60 }, // entirely under a 60px bar
        { id: "spya-bbbbbb", top: 60, bottom: 400 },
        { id: "spya-cccccc", top: 800, bottom: 900 },
      ],
      60,
      800,
    );
    expect([...shares.keys()]).toEqual(["spya-bbbbbb"]);
  });

  it("is empty, not a division by zero, when nothing is on screen", () => {
    expect(shareVisible([], 0, 800).size).toBe(0);
    expect(shareVisible([{ id: "spya-aaaaaa", top: 900, bottom: 1000 }], 0, 800).size).toBe(0);
  });
});

describe("gutterCss", () => {
  it("writes one rule per block with a level, in id order", () => {
    const css = gutterCss(
      new Map<string, ReadLevel>([
        ["spya-bbbbbb", 3],
        ["spya-aaaaaa", 1],
        ["spya-cccccc", 0],
      ]),
    );
    expect(css).toBe('tr[data-block="spya-aaaaaa"]{--read:1}\ntr[data-block="spya-bbbbbb"]{--read:3}');
  });

  it("refuses an id that could break out of the selector", () => {
    expect(gutterCss(new Map<string, ReadLevel>([['x"]{}body{display:none', 4]]))).toBe("");
  });
});
