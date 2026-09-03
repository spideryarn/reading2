// @vitest-environment jsdom
/**
 * **Five of the thirteen modes are only drawn for a reader who asked for them.**
 *
 * Quotes, Timeline, Referee, Diagram and Remember are behind the
 * experimental-features switch since 2026-09-03
 * (docs/project/experimental-features.md,
 * docs/plans/260903c-gate-unpolished-modes-behind-experimental-features.md).
 * Greg, looking at a shared article while signed out:
 *
 * > When a non-logged-in user reads a Public-readable article, I thin it should
 * > default to treating them as "Experimental Features" = false.
 *
 * **The counts here are eight and thirteen, not seven and twelve.** Structure —
 * the merge of Hierarchy and Outline — has not landed, so both of those are
 * today's default-visible stand-ins for it. Seven/twelve is the shape *after*
 * that merge and must not be written down before it.
 *
 * ## The two rules, and the second is the one that is easy to lose
 *
 * 1. The non-experimental rows are always drawn.
 * 2. **Plus whatever mode the URL names**, experimental or not. That is not
 *    politeness: the mode segment is a `role="radiogroup"` and exactly one
 *    button must be checked, so `?mode=timeline` with the switch off and no
 *    Timeline button leaves a radiogroup asserting one-of-these with none of
 *    them on. It applies to the loose-link arm on the metadata and tweets pages
 *    too — those carry `?mode=` in their URL, so the way back to the mode the
 *    reader came from stays in the bar.
 *
 * The last describe is the matrix GPT Sol asked for (finding 10): `marked` and
 * the switch are two separate mechanisms deciding how a mode is drawn, and the
 * thing that must hold across every combination of them is that the segment is
 * never empty and exactly one radio is checked.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MODES, type Mode } from "../src/modes.js";
import { MODE_LABEL } from "../src/title-text.js";
import type { PublicArtefacts } from "../src/types.js";
import { Dock, fitSignature, visibleModes } from "../src/web/Dock.js";
import { markedModes } from "../src/web/visitor.js";
import { EXPERIMENTAL_OFF, EXPERIMENTAL_ON } from "./helpers/experimental-fixtures.js";

/** The five, by name, so a sixth cannot be added without this file saying so. */
const BEHIND_THE_SWITCH: readonly Mode[] = ["quotes", "timeline", "referee", "diagram", "remember"];

/** Everything else — eight of them, until Structure replaces two with one. */
const ALWAYS: readonly Mode[] = MODES.filter((m) => !BEHIND_THE_SWITCH.includes(m));

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  history.replaceState(null, "", "/read/a-piece");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** The bar on the reading view: one segment, one of them checked. */
function reading(props: Record<string, unknown>): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: the two arms differ by which props are present, which is half of what this file is about
      createElement(Dock as any, {
        slug: "a-piece",
        view: "article",
        mode: "plain",
        onMode: () => {},
        experimental: EXPERIMENTAL_OFF,
        ...props,
      }),
    );
  });
}

/** The bar off the reading view: thirteen loose links, or eight of them. */
function loose(search: string, props: Record<string, unknown> = {}): void {
  history.replaceState(null, "", `/read/a-piece/metadata${search}`);
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: as above
      createElement(Dock as any, {
        slug: "a-piece",
        view: "metadata",
        experimental: EXPERIMENTAL_OFF,
        ...props,
      }),
    );
  });
}

/** The mode buttons of the segment, by the mode each one is for. */
function radioModes(): string[] {
  return [...host.querySelectorAll<HTMLElement>('.dock-modes [role="radio"]')].map(
    (b) => b.getAttribute("aria-label") ?? "",
  );
}

/** The loose mode links, by the word on each. */
function linkModes(): string[] {
  return [...host.querySelectorAll<HTMLElement>(".dock-mode")].map(
    (a) => a.getAttribute("aria-label") ?? a.textContent ?? "",
  );
}

/** Which radios say they are on. Exactly one, always. */
function checked(): string[] {
  return [...host.querySelectorAll<HTMLElement>('.dock-modes [aria-checked="true"]')].map(
    (b) => b.getAttribute("aria-label") ?? "",
  );
}

const labels = (modes: readonly Mode[]) => modes.map((m) => MODE_LABEL[m]).sort();

describe("how many buttons the bar draws", () => {
  it("eight, with the switch off", () => {
    reading({ experimental: EXPERIMENTAL_OFF });
    expect(radioModes()).toHaveLength(8);
    expect([...radioModes()].sort()).toEqual(labels(ALWAYS));
  });

  it("thirteen, with the switch on", () => {
    reading({ experimental: EXPERIMENTAL_ON });
    expect(radioModes()).toHaveLength(13);
    expect([...radioModes()].sort()).toEqual(labels(MODES));
  });

  /**
   * The signed-out reader Greg was looking at. Their answer is `off` because we
   * decided it, not because a 401 was caught as a load failure — the store is
   * where that reasoning lives; this is the half of it that shows on screen.
   */
  it("eight for a signed-out visitor, who is off by decision", () => {
    reading({ experimental: EXPERIMENTAL_OFF, visitor: true, marked: markedModes(NOTHING_SHARED) });
    expect(radioModes()).toHaveLength(8);
    expect(radioModes()).not.toContain(MODE_LABEL.timeline);
  });
});

describe("the mode in the URL is drawn whatever the switch says", () => {
  it("?mode=timeline draws Timeline, checked, with the switch off", () => {
    reading({ mode: "timeline", experimental: EXPERIMENTAL_OFF });
    expect(radioModes()).toContain(MODE_LABEL.timeline);
    expect(radioModes()).toHaveLength(9);
    expect(checked()).toEqual([MODE_LABEL.timeline]);
  });

  it("every one of the five, and never more than one radio checked", () => {
    for (const mode of BEHIND_THE_SWITCH) {
      reading({ mode, experimental: EXPERIMENTAL_OFF });
      expect(radioModes(), mode).toContain(MODE_LABEL[mode]);
      expect(checked(), mode).toEqual([MODE_LABEL[mode]]);
    }
  });

  /**
   * The loose-link arm, which the plan's first draft missed (GPT Sol, finding
   * 9). `carriedSearch` strips only `?panel=`, so `?mode=` is still in the
   * string the bar builds its links out of — which is how the bar on the
   * metadata page knows which mode the reader came from.
   */
  it("the metadata page retains the mode its URL carries", () => {
    loose("?mode=quotes");
    expect(linkModes()).toHaveLength(9);
    expect(linkModes()).toContain(MODE_LABEL.quotes);
    expect(linkModes()).not.toContain(MODE_LABEL.timeline);
  });

  it("the metadata page with no mode in its URL draws the eight", () => {
    loose("");
    expect([...linkModes()].sort()).toEqual(labels(ALWAYS));
  });

  it("a mode word the URL made up is ignored rather than drawn", () => {
    loose("?mode=nonsense");
    expect([...linkModes()].sort()).toEqual(labels(ALWAYS));
  });
});

/**
 * **The fit key carries the identities, not the count.** GPT Sol, finding 4:
 * retaining the current mode keeps the count at nine while `?mode=quotes`
 * becomes `?mode=remember`, and those two words are not the same width — so a
 * signature counting buttons would leave the bar overflowing, or its labels
 * dropped with room to spare, until the next resize.
 */
describe("the fit signature", () => {
  const noop = () => {};

  it("changes when the visible identities change at a constant count", () => {
    const quotes = fitSignature(visibleModes(false, "quotes"), "quotes", noop, undefined, null);
    const remember = fitSignature(
      visibleModes(false, "remember"),
      "remember",
      noop,
      undefined,
      null,
    );
    expect(visibleModes(false, "quotes")).toHaveLength(visibleModes(false, "remember").length);
    expect(quotes).not.toBe(remember);
  });

  it("changes when the switch does", () => {
    expect(fitSignature(visibleModes(false, "plain"), "plain", noop, undefined, null)).not.toBe(
      fitSignature(visibleModes(true, "plain"), "plain", noop, undefined, null),
    );
  });

  it("is the same string for the same bar", () => {
    expect(fitSignature(visibleModes(false, "plain"), "plain", noop, undefined, null)).toBe(
      fitSignature(visibleModes(false, "plain"), "plain", noop, undefined, null),
    );
  });
});

const NOTHING_SHARED: PublicArtefacts = {
  arc: false,
  tweets: false,
  glossary: false,
  ideas: false,
  quotes: false,
};
const EVERYTHING_SHARED: PublicArtefacts = {
  arc: true,
  tweets: true,
  glossary: true,
  ideas: true,
  quotes: true,
};

/**
 * **`marked` and the switch are two mechanisms, and they compose.**
 *
 * One says *this control is not fully available to you* by dimming it; the
 * other says *this control is not finished* by leaving it out. The invariant
 * across every combination is the radiogroup's own promise: never empty, and
 * exactly one checked. A hidden experimental mode simply leaves an unused entry
 * in `marked`, which is correct — `markedModes` is derived from `MODES` and
 * stays total on purpose.
 */
describe("marked × experimental, in both arms", () => {
  const readers = [
    { name: "an owner", marked: undefined, visitor: undefined },
    {
      name: "a visitor with nothing shared",
      marked: markedModes(NOTHING_SHARED),
      visitor: true,
    },
    {
      name: "a visitor with every artefact shared",
      marked: markedModes(EVERYTHING_SHARED),
      visitor: true,
    },
  ];
  const switches = [
    { name: "switch off", experimental: EXPERIMENTAL_OFF },
    { name: "switch on", experimental: EXPERIMENTAL_ON },
  ];
  const currents: Mode[] = ["plain", "quotes", "timeline", "glossary"];

  for (const reader of readers) {
    for (const flip of switches) {
      for (const mode of currents) {
        const what = `${reader.name}, ${flip.name}, in ${mode}`;

        it(`the segment has exactly one checked radio — ${what}`, () => {
          reading({
            mode,
            experimental: flip.experimental,
            marked: reader.marked,
            visitor: reader.visitor,
          });
          expect(radioModes().length, what).toBeGreaterThan(0);
          expect(checked(), what).toEqual([MODE_LABEL[mode]]);
          /* And the mode the reader is in is always pressable, marked or not —
             a dimmed button still opens the band that explains itself. */
          expect(radioModes(), what).toContain(MODE_LABEL[mode]);
        });

        it(`the loose arm keeps the mode it came from — ${what}`, () => {
          loose(`?mode=${mode}`, {
            experimental: flip.experimental,
            marked: reader.marked,
            visitor: reader.visitor,
          });
          expect(linkModes().length, what).toBeGreaterThan(0);
          expect(linkModes(), what).toContain(MODE_LABEL[mode]);
        });
      }
    }
  }
});

/**
 * **The trap Fable named, made loud.** `tests/dock-fit.test.ts` casts
 * `Dock as any`, so a `experimental?.on` inside the bar would mean "show every
 * mode" at a mount site that forgot the prop — silently, and to strangers. A
 * plain read throws instead, which is the whole reason the prop is required.
 */
describe("a mount site that forgets the prop", () => {
  it("throws rather than quietly showing everything", () => {
    expect(() => reading({ experimental: undefined })).toThrow();
  });
});
