/**
 * **The trace reader, against traces whose answers are known.**
 *
 * `scripts/viewport-trace.ts` decides, from a real phone's trace, whether the
 * mode band's composer is under the keyboard and which arithmetic could fix it —
 * stage 4 of
 * docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md.
 * Nobody on this box can produce that trace, so these are synthetic: each is
 * shaped like a phone doing one specific thing, and the test says which answer
 * that shape must get.
 *
 * **The cases are chosen to be the ones a wrong implementation passes.** Two
 * rounds of GPT Sol review supplied most of them by running counterexamples
 * rather than imagining them, and each is marked with what it caught:
 *
 * - § *chronology* — the version before this took a keyboard-closed frame from
 *   **anywhere** in the trace and measured every moved frame against it. An
 *   open→closed trace therefore reported `SHRANK` and `DEFECT` off a baseline
 *   that came afterwards. Reachable in ordinary use through the probe's `clear`.
 * - § *settled, not sliding* — pooling animation frames with the state the
 *   reader held still in made one transitional frame turn a clean shrink into
 *   `mixed`.
 * - § *the file on disk is not a type* — `ev: "banana"` and a sample with no
 *   `of` were both accepted, and rejected samples were dropped before analysis
 *   so a surviving subset could exit 0 as clean.
 * - § *the keyboard, established rather than assumed* — "the viewport moved" was
 *   taken to mean "a keyboard opened". Browser chrome hiding does the same
 *   thing; the probe records what was focused, and now that has to be an editor.
 * - § *the command itself* — none of the analysis tests touched the CLI, so
 *   turning its inconclusive exit code into `0` was a mutation nothing caught.
 */
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  CHAT,
  NO_COMPOSER,
  PRODUCER,
  additiveCollapses,
  anchorVerdict,
  baseClearance,
  chronology,
  classify,
  parseTrace,
  readSample,
  verdictOf,
  type Sample,
} from "../scripts/viewport-trace.js";

/**
 * A phone at rest: 390×844, a 40px dock, a 34px home-indicator inset, no install
 * hint, a 44px bar. The band runs from the bar to `max(40, 34) + 0 = 40` off the
 * bottom, so it is 844 − 44 − 40 = 760 tall and its composer is the last 60px.
 *
 * `of.focus` defaults to the composer, because every case that is *about* the
 * keyboard needs it and a fixture that omitted it would make the interesting
 * tests pass for the wrong reason.
 */
function sample(over: Partial<Sample> = {}): Sample {
  return {
    t: 0,
    ev: "mark",
    win: [390, 844, 0, 0],
    vv: [390, 844, 0, 0, 1],
    tok: { "--dock-bottom": 40, "--safe-bottom": 34, "--hint-h": 0, "--bar-bottom": 44 },
    rect: {
      band: [0, 44, 390, 760],
      head: [0, 44, 390, 36],
      composer: [0, 744, 390, 60],
      dock: [0, 804, 390, 40],
    },
    of: { focus: "form.chat-composer", composer: "form.chat-composer", body: "div.chat-log" },
    vis: { dock: "on", hint: "gone", band: "on" },
    dm: "standalone",
    bars: "",
    ...over,
  };
}

/** Keyboard up by `n` px, still at scale 1, band unmoved because it is layout-anchored. */
const open = (t: number, n: number, over: Partial<Sample> = {}): Sample =>
  sample({ t, vv: [390, 844 - n, 0, 0, 1], ...over });

const analyse = (samples: readonly Sample[], profile = CHAT) => {
  const readings = samples.map(readSample);
  const chron = chronology(readings);
  const motion = classify(chron);
  return { readings, chron, motion, verdict: verdictOf(chron, motion, profile) };
};

const file = (samples: readonly Sample[]): string =>
  JSON.stringify({ head: { probe: PRODUCER }, samples });

describe("the arithmetic itself, to the pixel", () => {
  it("computes the band's current bottom clearance the way the stylesheet does", () => {
    /* `calc(max(var(--dock-bottom), var(--safe-bottom)) + var(--hint-h))` */
    expect(baseClearance({ "--dock-bottom": 40, "--safe-bottom": 34, "--hint-h": 0 })).toBe(40);
    expect(baseClearance({ "--dock-bottom": 0, "--safe-bottom": 34, "--hint-h": 12 })).toBe(46);
    expect(baseClearance({ "--dock-bottom": 40, "--safe-bottom": 34, "--hint-h": 12 })).toBe(52);
  });

  it("returns null rather than guessing when a token is missing", () => {
    expect(baseClearance({ "--dock-bottom": 40, "--safe-bottom": 34 })).toBeNull();
    expect(baseClearance({ "--dock-bottom": 40, "--safe-bottom": null, "--hint-h": 0 })).toBeNull();
  });

  it("keeps max() and + apart, which is the whole of Sol's F2", () => {
    const r = readSample(open(400, 336));
    expect(r.bottomInset).toBe(336); // 844 − 508 − 0
    expect(r.baseClearance).toBe(40);
    expect(r.candidateMax).toBe(336); // max(40, 336)
    expect(r.candidatePlus).toBe(376); // 40 + 336 — the same strip reserved twice
  });

  /**
   * **The plan's own worked example is the oracle**, and it is worth pinning
   * rather than restating: § *The fit* says that at a 44px bar and a 40px dock,
   * "a 390px layout viewport with a 120px visible strip leaves 36px of band
   * under the additive form, and below an 84px strip the band collapses to
   * nothing". The first draft of this test asserted that 120px collapsed it, and
   * was wrong by exactly those 36px.
   */
  it("finds the additive form collapsing the band, and agrees with the plan about where", () => {
    expect(additiveCollapses([readSample(open(1, 724))])).toHaveLength(0); // 120px strip ⇒ 36px left
    expect(additiveCollapses([readSample(open(1, 764))])).toHaveLength(1); // 80px strip ⇒ nothing left
    expect(additiveCollapses([readSample(open(1, 144))])).toHaveLength(0); // room to spare
  });
});

describe("chronology", () => {
  /**
   * **Sol's blocker, run rather than imagined.** The trace opens with the
   * keyboard already up and only later shows a closed frame. The old code found
   * that closed frame, called it the baseline, and reported a defect measured
   * against a moment in its own future.
   *
   * It is not a contrived shape: the probe's `clear` button empties the sample
   * list without recording a new `start`, so clearing with the keyboard up and
   * then dismissing it produces exactly this.
   */
  it("refuses a baseline that comes AFTER the frames it would govern", () => {
    const { chron, motion, verdict } = analyse([
      open(0, 336, { ev: "mark" }),
      open(100, 336, { ev: "scroll" }),
      sample({ t: 500, ev: "mark" }), // keyboard closed, and last
    ]);
    expect(chron.cycles).toHaveLength(0);
    expect(chron.orphans).toHaveLength(2);
    expect(motion.motion).toBe("inconclusive");
    expect(verdict.which).toBe("inconclusive");
  });

  it("pairs each baseline with the frames that follow it, across two cycles", () => {
    const { chron } = analyse([
      sample({ t: 0, ev: "mark" }),
      open(100, 336, { ev: "mark" }),
      sample({ t: 200, ev: "resize" }), // keyboard shut again
      open(300, 336, { ev: "mark" }),
    ]);
    expect(chron.cycles).toHaveLength(2);
    expect(chron.cycles[0]?.settled?.sample.t).toBe(100);
    expect(chron.cycles[1]?.settled?.sample.t).toBe(300);
  });

  it("notices the layout viewport changing size mid-trace", () => {
    const { chron } = analyse([
      sample({ t: 0 }),
      sample({ t: 100, win: [844, 390, 0, 0], vv: [844, 390, 0, 0, 1] }), // rotated
    ]);
    expect(chron.resized).toBe(true);
  });

  it("ignores pinched samples, whose numbers are not in the tokens' coordinate space", () => {
    const pinched = sample({ t: 400, vv: [200, 400, 50, 0, 2] });
    expect(readSample(pinched).usable).toBe(false);
    expect(analyse([sample({ t: 0 }), pinched]).motion.motion).toBe("inconclusive");
  });

  /** `SLOP = 0` would make a sub-pixel wobble into a keyboard. Every other fixture moves by whole pixels. */
  it("does not read a sub-pixel wobble as the viewport moving", () => {
    const { chron } = analyse([sample({ t: 0 }), open(100, 0.4)]);
    expect(chron.cycles).toHaveLength(0);
  });
});

describe("which way the keyboard moved the viewport", () => {
  it("calls a plain shrink a shrink, and lets a bottom rule address it", () => {
    const { motion, verdict } = analyse([sample({ t: 0, ev: "mark" }), open(400, 336)]);
    expect(motion.motion).toBe("shrank");
    expect(motion.bottomRuleSuffices).toBe(true);
    /* The composer at y 744–804 is 236px below a strip that ends at 508. */
    expect(verdict.which).toBe("defect");
  });

  it("calls a pan a pan, and refuses a bottom rule for it", () => {
    const { motion } = analyse([
      sample({ t: 0, ev: "mark" }),
      sample({ t: 400, ev: "mark", vv: [390, 644, 200, 0, 1] }),
    ]);
    expect(motion.motion).toBe("panned");
    expect(motion.bottomRuleSuffices).toBe(false);
  });

  /**
   * **The case a maximum-comparing implementation gets wrong.** The inset is the
   * larger number, so "largest inset beats largest offsetTop" says *shrank,
   * bottom rule is right* — and the head is clipped 56px off the top, which no
   * `bottom:` value reaches.
   */
  it("refuses a bottom-only rule whenever a SETTLED head is clipped above", () => {
    const clipped = sample({
      t: 400,
      ev: "mark",
      vv: [390, 544, 100, 0, 1],
      rect: {
        band: [0, 44, 390, 760],
        head: [0, 44, 390, 36], // top at 44, strip starts at 100 ⇒ 56px hidden above
        composer: [0, 600, 390, 60],
      },
    });
    const { motion } = analyse([sample({ t: 0, ev: "mark" }), clipped]);
    expect(motion.bottomRuleSuffices).toBe(false);
    expect(motion.why).toContain("clipped ABOVE");
  });
});

describe("settled, not sliding", () => {
  /**
   * The keyboard slides for a few hundred milliseconds and both terms move
   * during it. Pooling those frames with the marked one made an entire trace
   * `mixed` — describing "something happened at some point" rather than the
   * state whose CSS is being chosen.
   */
  it("decides on the marked frame and reports the animation beside it", () => {
    const sliding = sample({ t: 200, ev: "scroll", vv: [390, 700, 60, 0, 1] });
    const { motion } = analyse([sample({ t: 0, ev: "mark" }), sliding, open(400, 336)]);
    expect(motion.motion).toBe("shrank");
    expect(motion.bottomRuleSuffices).toBe(true);
  });

  it("reports a head clipped only while sliding, without letting it decide", () => {
    const slidingClipped = sample({
      t: 200,
      ev: "scroll",
      vv: [390, 600, 120, 0, 1],
      rect: { band: [0, 44, 390, 760], head: [0, 44, 390, 36], composer: [0, 600, 390, 60] },
    });
    const { motion } = analyse([sample({ t: 0, ev: "mark" }), slidingClipped, open(400, 336)]);
    expect(motion.transientClipping).toBe(true);
    /* Still a shrink, and a bottom rule still addresses the settled state. */
    expect(motion.bottomRuleSuffices).toBe(true);
  });

  /**
   * The three rotation/layout events added by 260912b are observations, not
   * evidence that the visual viewport is in motion. Before they existed,
   * `ev !== "mark"` happened to mean the visual viewport's `resize`/`scroll`;
   * accepting the new names must not make that old shorthand lie.
   */
  it("does not call rotation or layout samples keyboard-sliding frames", () => {
    for (const ev of ["orientationchange", "window-resize", "laid-out"] as const) {
      const observed = sample({
        t: 200,
        ev,
        vv: [390, 600, 120, 0, 1],
        rect: {
          band: [0, 44, 390, 760],
          head: [0, 44, 390, 36],
          composer: [0, 600, 390, 60],
        },
      });
      const { motion } = analyse([sample({ t: 0, ev: "mark" }), observed, open(400, 336)]);
      expect(motion.transientClipping, ev).toBe(false);
    }
  });

  it("is inconclusive when the viewport moved but nobody marked the settled state", () => {
    const { verdict } = analyse([sample({ t: 0, ev: "mark" }), open(400, 336, { ev: "scroll" })]);
    expect(verdict.which).toBe("inconclusive");
    expect(verdict.why).toContain("mark");
  });
});

describe("the keyboard, established rather than assumed", () => {
  /** Browser chrome hiding moves the same numbers. The probe records what was focused. */
  it("will not call a viewport movement a keyboard when nothing is focused", () => {
    const { verdict } = analyse([
      sample({ t: 0, ev: "mark", of: { focus: null } }),
      open(400, 336, { of: { focus: null } }),
    ]);
    expect(verdict.which).toBe("inconclusive");
    expect(verdict.why).toContain("not an editor");
  });

  it("will not accept a focused link as evidence of a keyboard", () => {
    const { verdict } = analyse([
      sample({ t: 0, ev: "mark" }),
      open(400, 336, { of: { focus: "a.cited-link" } }),
    ]);
    expect(verdict.which).toBe("inconclusive");
  });

  it("accepts a textarea, an input or a form", () => {
    for (const focus of ["textarea.fb-body", "input.srch-q", "form.chat-composer"]) {
      const { verdict } = analyse([sample({ t: 0, ev: "mark" }), open(400, 336, { of: { focus } })]);
      expect(verdict.which).toBe("defect"); // the composer really is hidden here
    }
  });

  it("does not ask for an editor under a profile that does not need one", () => {
    const noComposer = (over: Partial<Sample>) =>
      sample({
        ...over,
        of: { focus: null },
        rect: { band: [0, 44, 390, 760], head: [0, 44, 390, 36] },
      });
    const { verdict } = analyse(
      [noComposer({ t: 0, ev: "mark" }), noComposer({ t: 400, ev: "mark", vv: [390, 700, 0, 0, 1] })],
      NO_COMPOSER,
    );
    expect(verdict.which).toBe("clean");
  });
});

describe("a trace that cannot answer must not answer", () => {
  it("calls a Chromium-shaped trace inconclusive rather than clean", () => {
    /* `interactive-widget=resizes-content` shrank the LAYOUT viewport too, so
       innerHeight fell with it and the visual viewport never moved relative to
       the page. Nothing is hidden — and that says nothing whatever about iOS. */
    const { verdict } = analyse([
      sample({ t: 0, ev: "mark" }),
      sample({
        t: 400,
        ev: "mark",
        win: [390, 508, 0, 0],
        vv: [390, 508, 0, 0, 1],
        rect: { band: [0, 44, 390, 424], head: [0, 44, 390, 36], composer: [0, 408, 390, 60] },
      }),
    ]);
    expect(verdict.which).toBe("inconclusive");
    expect(verdict.why).toContain("keyboard did not open");
  });

  /** A missing rectangle is not a rectangle at zero. */
  it("is inconclusive when the SETTLED frame has no composer, even if an earlier one did", () => {
    const { verdict } = analyse([
      sample({ t: 0, ev: "mark" }), // this one HAS a composer
      open(400, 336, { rect: { band: [0, 44, 390, 760], head: [0, 44, 390, 36] } }),
    ]);
    expect(verdict.which).toBe("inconclusive");
    expect(verdict.why).toContain("composer");
  });

  it("earns `clean` only with a real settled keyboard-open frame and nothing hidden", () => {
    const { verdict } = analyse([
      sample({ t: 0, ev: "mark" }),
      sample({
        t: 400,
        ev: "mark",
        vv: [390, 784, 0, 0, 1],
        rect: { band: [0, 44, 390, 700], head: [0, 44, 390, 36], composer: [0, 684, 390, 60] },
      }),
    ]);
    expect(verdict.which).toBe("clean");
  });

  /** The subset problem: analysing the survivors and exiting 0 is not an answer. */
  it("is inconclusive when ANY sample failed validation, however good the rest are", () => {
    const readings = [sample({ t: 0, ev: "mark" }), open(400, 336)].map(readSample);
    const chron = chronology(readings);
    const motion = classify(chron);
    const withRejects = verdictOf(chron, motion, CHAT, [{ index: 7, why: "vv was short" }]);
    expect(withRejects.which).toBe("inconclusive");
    expect(withRejects.why).toContain("may be the one that mattered");
    /* And without them the same trace is decidable, so the rejection is what did it. */
    expect(verdictOf(chron, motion, CHAT, []).which).toBe("defect");
  });
});

describe("the file on disk is not a type", () => {
  it("refuses something that is not JSON", () => {
    expect(parseTrace("{not json").fatal).toContain("not JSON");
  });

  it("refuses a file that is not from this probe", () => {
    expect(parseTrace(`{"head":{},"samples":[]}`).fatal).toContain("head.probe");
    expect(parseTrace(`{"samples":[]}`).fatal).toContain("head.probe");
  });

  it("refuses a trace with no samples", () => {
    expect(parseTrace(file([])).fatal).toContain("empty");
  });

  it("refuses an event it does not recognise", () => {
    const banana = JSON.stringify({ ...sample(), ev: "banana" });
    const p = parseTrace(`{"head":{"probe":${JSON.stringify(PRODUCER)}},"samples":[${banana}]}`);
    expect(p.fatal).toContain("every sample");
    expect(p.rejected[0]?.why).toContain("banana");
  });

  it("refuses a sample with no `of`, because that is the keyboard evidence", () => {
    const noOf = JSON.stringify({ ...sample(), of: undefined });
    const p = parseTrace(
      `{"head":{"probe":${JSON.stringify(PRODUCER)}},"samples":[${JSON.stringify(sample())},${noOf}]}`,
    );
    expect(p.rejected).toHaveLength(1);
    expect(p.rejected[0]?.why).toContain("of is not an object");
  });

  it("names each malformed sample with its index rather than dropping it quietly", () => {
    const good = JSON.stringify(sample());
    const shortVv = JSON.stringify({ ...sample(), vv: [390, 844, 0, 0] });
    const nanWin = JSON.stringify({ ...sample(), win: [390, null, 0, 0] });
    const p = parseTrace(
      `{"head":{"probe":${JSON.stringify(PRODUCER)}},"samples":[${good},${shortVv},${nanWin}]}`,
    );
    expect(p.samples).toHaveLength(1);
    expect(p.rejected.map((r) => r.index)).toEqual([1, 2]);
  });

  it("refuses a trace whose samples are out of time order", () => {
    expect(parseTrace(file([sample({ t: 500 }), sample({ t: 100 })])).fatal).toContain(
      "not in time order",
    );
  });

  it("accepts a real sample round-tripped through JSON", () => {
    const p = parseTrace(file([sample()]));
    expect(p.fatal).toBeNull();
    expect(p.rejected).toHaveLength(0);
    expect(p.samples[0]?.win[1]).toBe(844);
  });

  /* Since 2026-09-12 the probe records the window's events and the reader
     re-laying-out, so a trace taken across a rotation carries three more names.
     A reader that rejected them would refuse the very trace 260912b asks Greg
     to take. */
  it("reads a trace that caught a rotation", () => {
    const evs = ["start", "orientationchange", "window-resize", "laid-out"] as const;
    const p = parseTrace(file(evs.map((ev, i) => sample({ t: i * 10, ev }))));
    expect(p.fatal).toBeNull();
    expect(p.rejected).toHaveLength(0);
    expect(p.samples.map((s) => s.ev)).toEqual([...evs]);
  });
});

describe("the anchor premise, checked rather than cited", () => {
  it("confirms a band pinned to the layout viewport", () => {
    /* band.y + band.height = 44 + 760 = 804 = innerHeight 844 − clearance 40 */
    expect(anchorVerdict([readSample(sample()), readSample(open(400, 336))])).toMatchObject({
      known: true,
      holds: true,
    });
  });

  it("reports a band that is NOT where a layout-anchored band would be", () => {
    const drifted = sample({ rect: { band: [0, 44, 390, 600], head: [0, 44, 390, 36] } });
    expect(anchorVerdict([readSample(drifted)])).toMatchObject({ known: true, holds: false });
  });

  it("says it cannot check when the band or the tokens are missing", () => {
    expect(anchorVerdict([readSample(sample({ rect: {} }))])).toEqual({ known: false });
  });
});

describe("occlusion is computed here, not read from the probe's `vis`", () => {
  /**
   * `ViewportProbe` computes `vis` against `window.innerHeight` — the layout
   * viewport — so a dock behind the keyboard is `on` by its test. The probe is
   * already deployed and does not need changing, because it records the dock's
   * rectangle and this can do the comparison properly.
   */
  it("calls a dock behind the keyboard not-occluding, though the probe says `on`", () => {
    const keyboardUp = open(400, 336);
    expect(keyboardUp.vis["dock"]).toBe("on");
    /* The dock sits at y 804–844; the visible strip ends at 508. */
    expect(readSample(keyboardUp).occludes["dock"]).toBe(false);
  });

  it("calls a dock inside the visible strip occluding", () => {
    expect(readSample(sample()).occludes["dock"]).toBe(true);
  });
});

/**
 * ## § the command itself
 *
 * **The exit codes are a contract and nothing above touches them.** Sol asked
 * for a third mutation that should be caught and was not, and this was it:
 * changing the CLI's inconclusive return from `3` to `0` left all the analysis
 * tests green, because none of them runs the command. Writing these also turned
 * up a real mismatch — a missing file rejected `main()` and exited **1** while
 * the documented contract said **2**.
 */
describe("the command itself", () => {
  const run = promisify(execFile);
  const CLI = new URL("../scripts/read-viewport-trace.ts", import.meta.url).pathname;

  async function exitCodeFor(contents: string | null, args: readonly string[] = []): Promise<number> {
    const dir = await mkdtemp(join(tmpdir(), "vptrace-"));
    const path = join(dir, "trace.json");
    if (contents !== null) await writeFile(path, contents, "utf8");
    try {
      await run(process.execPath, ["--import", "tsx", CLI, path, ...args]);
      return 0;
    } catch (e) {
      return (e as { code?: number }).code ?? -1;
    }
  }

  it("exits 0 on a trace that answered — defect", async () => {
    expect(await exitCodeFor(file([sample({ t: 0, ev: "mark" }), open(400, 336)]))).toBe(0);
  }, 30000);

  it("exits 3 on inconclusive, which is not a softer clean", async () => {
    /* Keyboard never opened. */
    expect(await exitCodeFor(file([sample({ t: 0, ev: "mark" }), sample({ t: 400 })]))).toBe(3);
  }, 30000);

  it("exits 2 on a file that is not JSON", async () => {
    expect(await exitCodeFor("{not json")).toBe(2);
  }, 30000);

  it("exits 2 on a file that is not from this probe", async () => {
    expect(await exitCodeFor(`{"head":{},"samples":[]}`)).toBe(2);
  }, 30000);

  it("exits 2 when the file is not there at all", async () => {
    expect(await exitCodeFor(null)).toBe(2);
  }, 30000);

  it("exits 2 for a profile it does not have", async () => {
    expect(await exitCodeFor(file([sample()]), ["--profile=nonesuch"])).toBe(2);
  }, 30000);
});
