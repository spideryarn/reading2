// @vitest-environment jsdom
/**
 * **A gesture that never happened must not be reportable as a fast one.**
 *
 * `scripts/measure-annotation.ts` produces numbers somebody acts on, and its
 * worst failure is not a wrong number — it is a *flattering* one. On
 * 2026-09-06 its `comment-open` gesture grabbed the `mark[data-comment]`
 * element **before** clicking `.cmt-close`. Closing a comment genuinely rewrites
 * that block's HTML, because the open flag lives in the mark itself, so the
 * close detached the very node the timed `mouseup` was then dispatched at. A
 * dispatch at a detached node is a successful call that does nothing: no
 * listener, no render, no error. Six repetitions came back
 *
 *     attributable ms   25.6   0   22.4   0   35.3   0
 *
 * on **both** arms of an A/B, and were nearly read as a property of the code.
 *
 * These cases cover the fix and, more importantly, the class. Three levels,
 * each able to fail without the others:
 *
 * 1. **The judgment is pure**, so it can be checked here at all. Each gesture
 *    declares an `Effect` — a probe read either side of the timed region and a
 *    predicate over the two readings — and `effectVerdict` decides in
 *    TypeScript rather than inside an `evaluate` string that only a browser can
 *    reach.
 * 2. **The vector keeps its shape.** `classify` puts failures and suspect
 *    zeroes outside every median while leaving them in the report, because
 *    silently filtering them is the same failure wearing a hat
 *    (docs/reusable/silent-success.md).
 * 3. **The printed page is checked**, because all of the above could be right
 *    while the output a human reads still looked like six clean samples.
 * 4. **The in-page expression is run for real**, in jsdom, against a fixture
 *    that reproduces the trap: opening and closing replaces the mark node, so
 *    a reference held across it is detached. One case proves the fixture
 *    detaches — without it, the case that matters would pass over a page where
 *    nothing could ever have gone wrong.
 *
 * **Both halves were seen red before they were believed** (silent-success.md:
 * "it passed" and "it never ran" are the same observation). Putting the grab
 * back before the close fails *re-queries after the close* on
 * `mark[data-comment] is detached from the document`; taking the `isConnected`
 * guard away as well fails it on `expected '0' to be '1'` — the declared effect
 * — and independently fails *guards every dispatch site*.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  type Attempt,
  type Cost,
  classify,
  effectVerdict,
  GESTURES,
  report,
  type Sample,
  suspectReason,
} from "../scripts/measure-annotation.js";

const tally = (ms: number) => ({ n: 1, ms, maxMs: ms });

/** A cost snapshot whose only interesting figure is what `attributable` sums. */
function costOf(attributableMs: number): Cost {
  return {
    mode: "counts",
    renderedText: tally(0),
    resolveMark: tally(0),
    annotateHtml: tally(0),
    addZoomHandles: tally(0),
    marksByBlock: tally(attributableMs),
    proseHtml: tally(0),
  };
}

function sampleOf(rep: number, ms: number, attributableMs: number, renders = 4): Sample {
  return { rep, ms, cost: costOf(attributableMs), before: "0", after: "1", renders };
}

const WORK = { work: true, render: true } as const;
const CONTROL = { work: false, render: false } as const;

describe("each gesture declares what must become true", () => {
  it("has all five gestures — every loop below is vacuous over an empty table", () => {
    expect(Object.keys(GESTURES).sort()).toEqual([
      "comment-close",
      "comment-open",
      "glossary",
      "hover",
      "keystroke",
    ]);
  });

  it("confirms a comment that opened, and refuses one that did not", () => {
    const effect = GESTURES["comment-open"]?.effect ?? null;
    expect(effect).not.toBeNull();
    expect(effectVerdict(effect, "0", "1")).toBeNull();
    const why = effectVerdict(effect, "0", "0");
    expect(why).toContain("did not occur");
    /* The message has to name the requirement and both readings, or a wrong
       guess about the DOM reads as a mystery rather than as a wrong guess. */
    expect(why).toContain("data-cmt-open");
    expect(why).toContain('before "0", after "0"');
  });

  it("refuses a close that had nothing open, which is the flattering direction", () => {
    const effect = GESTURES["comment-close"]?.effect ?? null;
    expect(effectVerdict(effect, "1", "0")).toBeNull();
    expect(effectVerdict(effect, "0", "0")).toContain("did not occur");
    expect(effectVerdict(effect, "0", "1")).toContain("did not occur");
  });

  it("requires the pressed glossary term to move, not merely to exist", () => {
    const effect = GESTURES.glossary?.effect ?? null;
    expect(effectVerdict(effect, '["alpha"]', '["beta"]')).toBeNull();
    /* A count would not notice this: pressing a second term deselects the
       first, so one mark goes out as one comes on. */
    expect(effectVerdict(effect, '["alpha"]', '["alpha"]')).toContain("did not occur");
  });

  it("requires the find box to get longer", () => {
    const effect = GESTURES.keystroke?.effect ?? null;
    expect(effectVerdict(effect, "3", "4")).toBeNull();
    expect(effectVerdict(effect, "3", "3")).toContain("did not occur");
    /* -1 is "the box has gone", and no comparison may read that as growth. */
    expect(effectVerdict(effect, "3", "-1")).toContain("did not occur");
  });

  it("says out loud that hover declares nothing, rather than passing it as confirmed", () => {
    const hover = GESTURES.hover;
    expect(hover?.effect).toBeNull();
    /* Which is exactly why it may not be asked for work: an unverifiable
       gesture whose zero was also treated as suspicious would cry wolf. */
    expect(hover?.expects.work).toBe(false);
  });

  it("gives every gesture that must do work something to prove it did", () => {
    for (const [key, g] of Object.entries(GESTURES)) {
      if (g.expects.work) expect(g.effect, `${key} expects work but declares no effect`).not.toBeNull();
    }
  });
});

describe("the in-page expressions", () => {
  /** Every element a gesture dispatches at has been checked for `isConnected`.
   *  Optional calls (`?.click()`) are setup, not the measured dispatch, and are
   *  deliberately not counted. */
  it("guards every dispatch site against a detached node", () => {
    for (const [key, g] of Object.entries(GESTURES)) {
      const code = g.expression(0);
      const dispatches = code.match(/(?<!\?)\.(?:dispatchEvent\(|click\(\))/g) ?? [];
      const guards = code.match(/\.isConnected/g) ?? [];
      expect(dispatches.length, `${key} dispatches nothing`).toBeGreaterThan(0);
      expect(guards.length, `${key} has an unguarded dispatch`).toBeGreaterThanOrEqual(
        dispatches.length,
      );
    }
  });

  it("compiles — a SyntaxError in a browser string is invisible until a run", () => {
    for (const [key, g] of Object.entries(GESTURES)) {
      expect(() => new Function(`return ${g.expression(1)};`), key).not.toThrow();
    }
  });
});

describe("a confirmed sample that still cannot be quoted", () => {
  it("calls an exact zero suspect on a gesture that has to re-annotate blocks", () => {
    expect(suspectReason(WORK, sampleOf(1, 210, 0))).toContain("exactly 0.00 ms");
  });

  it("calls a gesture that rendered nothing suspect, by a different route", () => {
    expect(suspectReason(WORK, { cost: costOf(12), renders: 0 })).toContain("no React render");
  });

  it("leaves a control's zero alone, because a control's zero is the result", () => {
    expect(suspectReason(CONTROL, sampleOf(1, 13, 0, 0))).toBeNull();
  });
});

describe("classify keeps the shape of the vector that started this", () => {
  /** The observed run: real, nothing, real, nothing, real, nothing. */
  const alternating = (zeroes: (rep: number) => Attempt): Attempt[] => [
    sampleOf(1, 232, 25.6),
    zeroes(2),
    sampleOf(3, 241, 22.4),
    zeroes(4),
    sampleOf(5, 238, 35.3),
    zeroes(6),
  ];

  it("names the repetitions that did not happen, and quotes neither them nor the warm-up", () => {
    const c = classify(
      alternating((rep) => ({ rep, error: "the declared effect did not occur — a mark[data-cmt-open] appears" })),
      1,
      WORK,
    );
    expect(c.failures.map((f) => f.rep)).toEqual([2, 4, 6]);
    expect([...c.warmups]).toEqual([1]);
    expect(c.warmed.map((s) => s.rep)).toEqual([3, 5]);
    /* The point of the whole exercise: no zero reaches a median. */
    expect(c.warmed.map((s) => s.cost.marksByBlock.ms)).toEqual([22.4, 35.3]);
  });

  it("still keeps an exact zero out of the summary if the effect check ever passed one", () => {
    const c = classify(alternating((rep) => sampleOf(rep, 0.4, 0)), 1, WORK);
    expect(c.failures).toEqual([]);
    expect([...c.suspect.keys()]).toEqual([2, 4, 6]);
    expect(c.warmed.map((s) => s.rep)).toEqual([3, 5]);
  });

  it("counts warm-ups among the confirmed samples, not by repetition number", () => {
    const c = classify(
      [
        { rep: 1, error: "nothing matched mark[data-comment]" },
        sampleOf(2, 232, 25.6),
        sampleOf(3, 241, 22.4),
      ],
      1,
      WORK,
    );
    /* Repetition 2 is the first sample the page actually took, so it is the
       cold one — charging the warm-up to repetition 1 would have promoted it
       into the summary. */
    expect([...c.warmups]).toEqual([2]);
    expect(c.warmed.map((s) => s.rep)).toEqual([3]);
  });

  it("has nothing to quote when every repetition failed", () => {
    const c = classify([{ rep: 1, error: "threw: boom" }], 1, WORK);
    expect(c.samples).toEqual([]);
    expect(c.warmed).toEqual([]);
  });
});

/**
 * What a reader actually sees, which is the only thing that protects the
 * number. Everything above could be right while the page of output still read
 * as five clean samples.
 */
describe("the printed report", () => {
  const say = (run: Parameters<typeof report>[0], warmup = 1): { out: string; gripe: string | null } => {
    const lines: string[] = [];
    const spy = vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => {
      lines.push(a.join(" "));
    });
    const gripe = report(run, warmup);
    spy.mockRestore();
    return { out: lines.join("\n"), gripe };
  };

  it("gives a repetition that did not happen its own column, and names it underneath", () => {
    const { out, gripe } = say({
      key: "comment-open",
      label: "open a comment",
      declared: "a mark[data-cmt-open] appears",
      expects: WORK,
      attempts: [
        sampleOf(1, 232, 25.6),
        { rep: 2, error: "the declared effect did not occur — a mark[data-cmt-open] appears" },
        sampleOf(3, 241, 22.4),
        { rep: 4, error: "the declared effect did not occur — a mark[data-cmt-open] appears" },
        sampleOf(5, 238, 35.3),
        { rep: 6, error: "the declared effect did not occur — a mark[data-cmt-open] appears" },
      ],
    });
    /* Six columns, three of them FAILED — the shape of the run survives, which
       a vector of the three survivors would have destroyed. */
    expect(out.match(/FAILED/g) ?? []).toHaveLength(9); // three columns × three rows
    expect(out).toContain("rep 2: the declared effect did not occur");
    expect(out).toContain("requires: a mark[data-cmt-open] appears");
    /* And the quotable count says two of six rather than implying six. */
    expect(out).toContain("quotable (2 of 6)");
    expect(gripe).toContain("3 did not happen");
  });

  it("marks a suspect zero, keeps it out of the median, and complains", () => {
    const { out, gripe } = say({
      key: "glossary",
      label: "press a glossary term",
      declared: "the set of mark[data-term-open] terms moves",
      expects: WORK,
      attempts: [sampleOf(1, 280, 30), sampleOf(2, 285, 29), sampleOf(3, 0.4, 0)],
    });
    expect(out).toContain("0.00!");
    expect(out).toContain("rep 3 is SUSPECT");
    /* One quotable sample, and its median is the real one rather than 14.5. */
    expect(out).toContain("quotable (1 of 3)");
    expect(out).toMatch(/attributable \[counts\] 29\.00\/29\.00\/29\.00/);
    expect(gripe).toContain("1 suspect");
  });

  it("says a gesture that declares nothing cannot prove it happened", () => {
    const { out } = say({
      key: "hover",
      label: "hover across two rows",
      declared: null,
      expects: CONTROL,
      attempts: [sampleOf(1, 13, 0, 1), sampleOf(2, 14, 0, 1)],
    });
    expect(out).toContain("NOTHING DECLARED");
    expect(out).toContain("renders");
  });

  it("reports nothing at all when nothing survived", () => {
    const { out, gripe } = say({
      key: "comment-close",
      label: "close a comment",
      declared: "the mark[data-cmt-open] goes away",
      expects: WORK,
      attempts: [
        { rep: 1, error: "nothing matched .cmt-close" },
        { rep: 2, error: "nothing matched .cmt-close" },
      ],
    });
    expect(out).toContain("NOTHING QUOTABLE");
    expect(out).not.toMatch(/min\/med\/max/);
    expect(gripe).toContain("nothing quotable");
  });
});

/**
 * The expression, run for real against a page that behaves the way the reading
 * view does: opening or closing a comment **replaces** the mark node.
 */
describe("the comment-open expression, against a page that replaces its nodes", () => {
  interface Perf {
    state: { visible: { renders: number }; hidden: { renders: number } };
    resetAnnotationCost: () => void;
    annotationCost: () => Cost;
  }
  let perf: Perf;
  let cost: Cost;
  let open: boolean;
  let listening: boolean;
  /** One jsdom `document` serves the whole file, so listeners left behind
   *  accumulate and the next test renders twice. Found by this file: the render
   *  count came back 2. */
  let listeners: AbortController;

  /** What TableView does on every change: rebuild the block's HTML, which
   *  detaches whatever was in it. The annotation cost is charged here because
   *  that is where the real memos run. */
  function render(): void {
    perf.state.visible.renders += 1;
    cost.marksByBlock.ms += 5;
    cost.proseHtml.ms += 7;
    const cell = document.querySelector("td.prose");
    if (cell) {
      cell.innerHTML = `<mark data-comment="c1"${open ? ' data-cmt-open=""' : ""}>quoted</mark>`;
    }
    const dialog = document.getElementById("dialog");
    if (dialog) dialog.innerHTML = open ? '<button class="cmt-close">close</button>' : "";
  }

  beforeEach(() => {
    if (typeof globalThis.requestAnimationFrame !== "function") {
      globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) =>
        setTimeout(() => cb(performance.now()), 0) as unknown as number) as typeof requestAnimationFrame;
    }
    /* **Open**, because that is the state each repetition after the first
       starts in: the previous one left a comment open, the gesture's setup
       closes it, and closing is what replaces the mark. A fixture that started
       closed would let the original bug pass — the setup's close would be a
       no-op and nothing would be detached. */
    open = true;
    listening = true;
    cost = costOf(0);
    cost.proseHtml = tally(0);
    perf = {
      state: { visible: { renders: 0 }, hidden: { renders: 0 } },
      resetAnnotationCost: () => {
        cost.marksByBlock = tally(0);
        cost.proseHtml = tally(0);
      },
      annotationCost: () => cost,
    };
    (window as unknown as { __perf: Perf }).__perf = perf;
    document.body.innerHTML =
      '<table><tbody><tr data-block="b1"><td class="prose"></td></tr></tbody></table>' +
      '<div id="dialog"></div>';
    render();
    perf.state.visible.renders = 0;
    /* Delegated, like the app's: the listener outlives the node it fires on. */
    listeners = new AbortController();
    const { signal } = listeners;
    document.addEventListener(
      "mouseup",
      (e) => {
        if (!listening) return;
        if ((e.target as Element).closest?.("mark[data-comment]")) {
          open = true;
          render();
        }
      },
      { signal },
    );
    document.addEventListener(
      "click",
      (e) => {
        if ((e.target as Element).closest?.(".cmt-close")) {
          open = false;
          render();
        }
      },
      { signal },
    );
  });

  afterEach(() => listeners.abort());

  const run = async (): Promise<Record<string, unknown>> => {
    const code = GESTURES["comment-open"]?.expression(0) ?? "";
    const raw = (await new Function(`return ${code};`)()) as string;
    return JSON.parse(raw) as Record<string, unknown>;
  };

  it("reproduces the trap: a mark held across the close is detached", () => {
    /* Without this the cases below prove nothing — they would be tests over a
       page where the original bug could never have happened. */
    const stale = document.querySelector("mark[data-comment]");
    expect(stale).not.toBeNull();
    expect(document.querySelectorAll("mark[data-cmt-open]")).toHaveLength(1);
    document.querySelector<HTMLElement>(".cmt-close")?.click();
    expect(stale?.isConnected).toBe(false);
    /* And the detached node swallows the gesture in silence: this is the whole
       bug, in two lines. Nothing throws, and nothing happens. */
    stale?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    expect(document.querySelectorAll("mark[data-cmt-open]")).toHaveLength(0);
    /* The node that replaced it answers perfectly well. */
    document.querySelector("mark[data-comment]")?.dispatchEvent(
      new MouseEvent("mouseup", { bubbles: true }),
    );
    expect(document.querySelectorAll("mark[data-cmt-open]")).toHaveLength(1);
  });

  it("re-queries after the close, so the timed dispatch lands and is confirmed", async () => {
    const raw = await run();
    expect(raw.error).toBeUndefined();
    expect(raw.before).toBe("0");
    expect(raw.after).toBe("1");
    expect(raw.renders).toBe(1);
    expect(effectVerdict(GESTURES["comment-open"]?.effect ?? null, "0", "1")).toBeNull();
    const cost = raw.cost as Cost;
    expect(cost.marksByBlock.ms + cost.proseHtml.ms).toBe(12);
  });

  it("refuses the sample when the dispatch lands on nothing — twice over", async () => {
    listening = false;
    const raw = await run();
    /* This is exactly what the old script printed as a fast repetition: no
       error, a plausible wall clock, and an attributable of zero. */
    const cost = raw.cost as Cost;
    expect(cost.marksByBlock.ms + cost.proseHtml.ms).toBe(0);
    expect(raw.renders).toBe(0);
    /* Caught by the declared effect… */
    const why = effectVerdict(
      GESTURES["comment-open"]?.effect ?? null,
      raw.before as string,
      raw.after as string,
    );
    expect(why).toContain("did not occur");
    /* …and independently by both backstops, which know nothing about marks. */
    expect(suspectReason(WORK, { cost, renders: raw.renders as number })).not.toBeNull();
  });
});
