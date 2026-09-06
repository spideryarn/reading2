// @vitest-environment jsdom
/**
 * **Five of the fourteen modes are only drawn for a reader who asked for them.**
 *
 * Quotes, Timeline, Referee and Remember are behind the
 * experimental-features switch since 2026-09-03
 * (docs/project/experimental-features.md,
 * docs/plans/260903c-gate-unpolished-modes-behind-experimental-features.md),
 * and Debate joined them on 2026-09-05.
 * Greg, looking at a shared article while signed out:
 *
 * > When a non-logged-in user reads a Public-readable article, I thin it should
 * > default to treating them as "Experimental Features" = false.
 *
 * **Diagram came back out on 2026-09-04**, and the gate went one level down
 * rather than away: the mode is in everybody's bar and four of its five
 * pictures are behind the switch instead, a reader having reported that only
 * the Sketch is good enough to show everyone (SPIDERYARN-READING2-13). The chip
 * row's end of that is tests/diagram-kind-gating.test.tsx; both ends draw by one
 * rule, src/web/experimental-visibility.ts.
 *
 * **The counts here are nine and fourteen, not eight and thirteen.** Structure —
 * the merge of Hierarchy and Outline — has not landed, so both of those are
 * today's default-visible stand-ins for it. Eight/thirteen is the shape *after*
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
import {
  EXPERIMENTAL_OFF,
  EXPERIMENTAL_ON,
  EXPERIMENTAL_SIGNED_OUT,
} from "./helpers/experimental-fixtures.js";

/** The five, by name, so a sixth cannot be added without this file saying so. */
const BEHIND_THE_SWITCH: readonly Mode[] = ["quotes", "timeline", "referee", "remember", "debate"];

/** Everything else — nine of them, until Structure replaces two with one. */
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

/** The bar off the reading view: fourteen loose links, or nine of them. */
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
  it("nine, with the switch off", () => {
    reading({ experimental: EXPERIMENTAL_OFF });
    expect(radioModes()).toHaveLength(9);
    expect([...radioModes()].sort()).toEqual(labels(ALWAYS));
  });

  it("fourteen, with the switch on", () => {
    reading({ experimental: EXPERIMENTAL_ON });
    expect(radioModes()).toHaveLength(14);
    expect([...radioModes()].sort()).toEqual(labels(MODES));
  });

  /**
   * The signed-out reader Greg was looking at, **as far as this file can see
   * them**: the bar is handed the answer, so what is checked here is that being
   * told *signed out, off* draws nine buttons.
   *
   * It does not exercise a session, and the name used to imply it did (GPT Sol,
   * reviewing stage 2). That a signed-out session produces this answer *because
   * we decided it* rather than because a 401 was caught as a load failure is
   * tests/experimental-store.test.tsx's, and that the reading view asks for
   * nothing on their behalf is tests/public-network-trace.test.tsx's.
   */
  it("nine when the bar is told the reader is signed out and off", () => {
    reading({
      experimental: EXPERIMENTAL_SIGNED_OUT,
      visitor: true,
      marked: markedModes(NOTHING_SHARED),
    });
    expect(radioModes()).toHaveLength(9);
    expect(radioModes()).not.toContain(MODE_LABEL.timeline);
  });
});

describe("the mode the bar is in is drawn whatever the switch says", () => {
  /**
   * **The reading view takes the mode as a prop, so that is what this passes.**
   * It was named for `?mode=timeline` and passed `mode: "timeline"` — the same
   * fact one step further along, since `App.tsx` is what turns the parameter
   * into the prop (params.ts § modeParam). GPT Sol, reviewing stage 2: the name
   * claimed a state the test does not enter.
   *
   * The URL half is real and is tested where it happens — the loose-link arm
   * below reads `?mode=` itself, because off the reading view there is no prop.
   */
  it("a reading view in Timeline draws it, checked, with the switch off", () => {
    reading({ mode: "timeline", experimental: EXPERIMENTAL_OFF });
    expect(radioModes()).toContain(MODE_LABEL.timeline);
    expect(radioModes()).toHaveLength(10);
    expect(checked()).toEqual([MODE_LABEL.timeline]);
  });

  it("every one of the four, and never more than one radio checked", () => {
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
    expect(linkModes()).toHaveLength(10);
    expect(linkModes()).toContain(MODE_LABEL.quotes);
    expect(linkModes()).not.toContain(MODE_LABEL.timeline);
  });

  it("the metadata page with no mode in its URL draws the nine", () => {
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
 * retaining the current mode keeps the count unmoved while `?mode=quotes`
 * becomes `?mode=remember`, and those two words are not the same width — so a
 * signature counting buttons would leave the bar overflowing, or its labels
 * dropped with room to spare, until the next resize.
 */
describe("the fit signature", () => {
  const noop = () => {};
  /* The sixth argument is the bar's own switch, and `null` is "not drawn". What
     it contributes has its own file — tests/dock-experimental-switch.test.tsx §
     the fit signature — because it is about the toggle, not about the modes. */
  const sig = (on: boolean, current: Mode) =>
    fitSignature(visibleModes(on, current), current, noop, undefined, null, null);

  it("changes when the visible identities change at a constant count", () => {
    expect(visibleModes(false, "quotes")).toHaveLength(visibleModes(false, "remember").length);
    expect(sig(false, "quotes")).not.toBe(sig(false, "remember"));
  });

  it("changes when the switch does", () => {
    expect(sig(false, "plain")).not.toBe(sig(true, "plain"));
  });

  it("is the same string for the same bar", () => {
    expect(sig(false, "plain")).toBe(sig(false, "plain"));
  });
});

const NOTHING_SHARED: PublicArtefacts = {
  arc: false,
  tweets: false,
  glossary: false,
  ideas: false,
  quotes: false,
  timeline: false,
  sketch: false,
};
const EVERYTHING_SHARED: PublicArtefacts = {
  arc: true,
  tweets: true,
  glossary: true,
  ideas: true,
  quotes: true,
  timeline: true,
  sketch: true,
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
    { name: "an owner", marked: undefined, visitor: undefined, signedIn: undefined },
    {
      name: "a visitor with nothing shared",
      marked: markedModes(NOTHING_SHARED),
      visitor: true,
      signedIn: undefined,
    },
    {
      name: "a visitor with every artefact shared",
      marked: markedModes(EVERYTHING_SHARED),
      visitor: true,
      signedIn: undefined,
    },
    /* **The signed-in non-owner, which the matrix promised and did not have**
       (GPT Sol, reviewing stage 2). `signedIn` changes no mode's visibility
       today — the switch keys on `experimental.signedIn`, which is a different
       question, and that is the point of including it: the row is here so that
       the day the two are confused, this is where it shows. */
    {
      name: "a signed-in visitor on somebody else's article",
      marked: markedModes(EVERYTHING_SHARED),
      visitor: true,
      signedIn: true,
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
            signedIn: reader.signedIn,
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
            signedIn: reader.signedIn,
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
