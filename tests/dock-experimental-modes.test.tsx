// @vitest-environment jsdom
/**
 * **Some modes are only drawn for a reader who asked for them**, and which ones
 * is `BEHIND_THE_SWITCH` below. Its membership has moved several times since
 * 2026-09-03, and the reason for each is in
 * docs/project/experimental-features.md, which owns that argument
 * (docs/plans/260903c-gate-unpolished-modes-behind-experimental-features.md is
 * where it started).
 * Greg, looking at a shared article while signed out:
 *
 * > When a non-logged-in user reads a Public-readable article, I thin it should
 * > default to treating them as "Experimental Features" = false.
 *
 * **Diagram came back out on 2026-09-04 and went back in on 2026-09-29.** On
 * the 4th the gate went one level down rather than away — the mode in
 * everybody's bar and four of its five pictures behind the switch, a reader
 * having reported that only the Sketch was good enough to show everyone
 * (SPIDERYARN-READING2-13). On the 29th Greg put the whole mode behind it
 * (SPIDERYARN-READING2-4R). The chip gate stays, so a switched-on reader still
 * sees all five; tests/diagram-kind-gating.test.tsx is that end, and both ends
 * draw by one rule, src/web/experimental-visibility.ts.
 *
 * **This file names members and never counts.** It used to say nine and
 * fourteen in its assertions, its test names and this docblock, so promoting
 * Quotes on 2026-09-06 meant editing eight numbers that no longer added up —
 * and a count cannot tell you *which* mode escaped. Everything below compares
 * identities against `BEHIND_THE_SWITCH`, the one literal list; the day
 * Structure merges Hierarchy and Outline, nothing here needs a number changed.
 * GPT Sol asked for this, weighing it against deriving the list from the table
 * the flags actually live in — `MODES_UI` until 2026-09-07, `MODE_CATALOG`
 * (src/mode-catalog.ts) since: either way that would assert the bar draws what
 * the table says, which is `visibleModes`' own definition, and the canary would
 * be gone.
 *
 * ## The two rules, and the second is the one that is easy to lose
 *
 * 1. The non-experimental rows are always drawn.
 * 2. **Plus whatever mode the URL names**, experimental or not. That is not
 *    politeness: the mode segment is a `role="radiogroup"` and exactly one
 *    button must be checked, so `?mode=timeline` with the switch off and no
 *    Timeline button leaves a radiogroup asserting one-of-these with none of
 *    them on. It applies to the links arm on the metadata page
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
import { type BandMode, MODES, type Mode } from "../src/modes.js";
import { MODE_LABEL } from "../src/title-text.js";
import type { PublicArtefacts } from "../src/types.js";
import { Dock, fitSignature, visibleModes } from "../src/web/Dock.js";
import { markedModes } from "../src/web/visitor.js";
import {
  EXPERIMENTAL_OFF,
  EXPERIMENTAL_ON,
  EXPERIMENTAL_SIGNED_OUT,
} from "./helpers/experimental-fixtures.js";

/**
 * **The independent copy of the policy**, by name, so that moving a mode in or
 * out of the switch cannot be done by editing the flag alone — somebody has to
 * say so here too. That second edit is the whole point and is not duplication
 * to be tidied away: derive this from `MODE_CATALOG` (src/mode-catalog.ts, and
 * `MODES_UI` before 2026-09-07) and the test asserts the bar draws what the
 * table says, which is what `visibleModes` means.
 */
const BEHIND_THE_SWITCH: readonly Mode[] = [
  "timeline",
  "referee",
  /* Remember was here from 2026-09-03 until 2026-10-05, when Greg asked for
     Recall, Quiz and Tutorial in the mainstream features (spya-cnqcjf). Its
     Explore chip stays behind the switch, one level down:
     tests/remember-header-cards.test.tsx § "Explore is behind the switch". */
  "debate",
  /* 2026-09-11: a new mode on an unmeasured prompt —
     docs/project/experimental-features.md. */
  "citations",
  /* 2026-09-16: a new mode on an unmeasured prompt —
     docs/project/experimental-features.md. */
  "faq",
  /* Skim was here for most of 2026-09-28, a new mode on an unmeasured
     prompt; Greg took it out the same day ("take Trajectory and Quotes modes
     out of Experimental features") — docs/project/experimental-features.md. */
  /* Hierarchy was here from 2026-09-12 (SPIDERYARN-READING2-35) until it
     retired into Structure on 2026-09-29 (SPIDERYARN-READING2-4B) —
     docs/plans/260929d-remove-hierarchy-mode-and-heading-numbers.md. */
  /* Structure was here from 2026-09-07 to 2026-09-10, hidden while Greg
     compared it with Hierarchy and Outline. It came out when it took Outline's
     list as its narrow face and Outline left the bar: Outline was on every
     reader's bar, so keeping Structure hidden would have taken the list away
     from everybody without the switch.
     docs/plans/260910g-structure-mode-subsumes-outline.md. */
  /* 2026-09-29, at Greg's request (SPIDERYARN-READING2-4R): *"Move all of
     Diagram mode into the 'Experimental features'. It's just not good enough
     yet."* The whole mode this time, not only four of its pictures.
     docs/project/experimental-features.md. */
  "diagram",
  /* 2026-10-01: a first experiment with a column right of the prose, which
     Greg asked to "play with" (SPIDERYARN-READING2-7K) —
     docs/project/experimental-features.md. */
  "marginalia",
];

/**
 * What the bar should draw with the switch off: everything not behind it, plus
 * the mode the reader is in. The second half is rule 2 above, and stating it
 * here rather than in each test is what lets every assertion below be an
 * identity rather than a count.
 */
function expectedWhenOff(current?: Mode): readonly Mode[] {
  return MODES.filter((m) => !BEHIND_THE_SWITCH.includes(m) || m === current);
}

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

/** The bar off the reading view: framed links for the visible modes. */
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

/** The mode buttons of the segment, by the mode each one is for — the radios
    and, since 2026-10-01, Marginalia's toggle after them (261001i). */
function radioModes(): string[] {
  return [...host.querySelectorAll<HTMLElement>('.dock-modes [role="radio"], .dock-modes [aria-pressed]')].map(
    (b) => b.getAttribute("aria-label") ?? "",
  );
}

/** The mode links (the metadata page), by the word on each. */
function linkModes(): string[] {
  return [...host.querySelectorAll<HTMLElement>(".dock-modes a.dock-btn")].map(
    (a) => a.getAttribute("aria-label") ?? a.textContent ?? "",
  );
}

/** Which of those links carry the visitor's visible unavailable mark. */
function markedLinkModes(): string[] {
  return [...host.querySelectorAll<HTMLElement>(".dock-modes a.dock-btn")]
    .filter((a) => a.classList.contains("tw:opacity-55"))
    .map((a) => a.getAttribute("aria-label") ?? a.textContent ?? "");
}

/** Which radios say they are on. Exactly one, always. */
function checked(): string[] {
  return [...host.querySelectorAll<HTMLElement>('.dock-modes [aria-checked="true"]')].map(
    (b) => b.getAttribute("aria-label") ?? "",
  );
}

const labels = (modes: readonly Mode[]) => modes.map((m) => MODE_LABEL[m]).sort();

describe("which buttons the bar draws", () => {
  it("with the switch off, exactly the modes that are not behind it", () => {
    reading({ experimental: EXPERIMENTAL_OFF });
    expect([...radioModes()].sort()).toEqual(labels(expectedWhenOff()));
  });

  it("with the switch on, every mode there is", () => {
    reading({ experimental: EXPERIMENTAL_ON });
    expect([...radioModes()].sort()).toEqual(labels(MODES));
  });

  /**
   * The signed-out reader Greg was looking at, **as far as this file can see
   * them**: the bar is handed the answer, so what is checked here is that being
   * told *signed out, off* draws the default bar.
   *
   * It does not exercise a session, and the name used to imply it did (GPT Sol,
   * reviewing stage 2). That a signed-out session produces this answer *because
   * we decided it* rather than because a 401 was caught as a load failure is
   * tests/experimental-store.test.tsx's, and that the reading view asks for
   * nothing on their behalf is tests/public-network-trace.test.tsx's.
   */
  it("the default bar when it is told the reader is signed out and off", () => {
    reading({
      experimental: EXPERIMENTAL_SIGNED_OUT,
      visitor: true,
      marked: markedModes(NOTHING_SHARED),
    });
    expect([...radioModes()].sort()).toEqual(labels(expectedWhenOff()));
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
   * The URL half is real and is tested where it happens — the links arm
   * below reads `?mode=` itself, because off the reading view there is no prop.
   */
  it("a reading view in Timeline draws it, checked, with the switch off", () => {
    reading({ mode: "timeline", experimental: EXPERIMENTAL_OFF });
    expect([...radioModes()].sort()).toEqual(labels(expectedWhenOff("timeline")));
    expect(checked()).toEqual([MODE_LABEL.timeline]);
  });

  it("every one of the four, and never more than one radio checked", () => {
    for (const mode of BEHIND_THE_SWITCH) {
      /* Marginalia is a switch, not a band, since 2026-10-01: the next test. */
      if (mode === "marginalia") continue;
      reading({ mode, experimental: EXPERIMENTAL_OFF });
      expect(radioModes(), mode).toContain(MODE_LABEL[mode]);
      expect(checked(), mode).toEqual([MODE_LABEL[mode]]);
    }
  });

  /* **Marginalia's toggle obeys the same rule** (261001i): with its notes on
     it stays drawn with the switch off, pressed, so the one control that turns
     them off cannot vanish — and it is never one of the checked radios. */
  it("Marginalia's toggle stays drawn and pressed while its notes are on", () => {
    reading({ mode: "glossary", margin: true, experimental: EXPERIMENTAL_OFF });
    const toggle = host.querySelector<HTMLElement>('.dock-modes [aria-pressed]');
    expect(toggle?.getAttribute("aria-label")).toBe(MODE_LABEL.marginalia);
    expect(toggle?.getAttribute("aria-pressed")).toBe("true");
    expect(toggle?.closest('[role="radiogroup"]')).toBeNull();
    expect(checked()).toEqual([MODE_LABEL.glossary]);
    reading({ mode: "glossary", margin: false, experimental: EXPERIMENTAL_OFF });
    expect(host.querySelector('.dock-modes [aria-pressed]')).toBeNull();
  });

  /**
   * The links arm, which the plan's first draft missed (GPT Sol, finding
   * 9). `carriedSearch` strips only `?panel=`, so `?mode=` is still in the
   * string the bar builds its links out of — which is how the bar on the
   * metadata page knows which mode the reader came from.
   */
  it("the metadata page retains the mode its URL carries", () => {
    loose("?mode=remember");
    expect([...linkModes()].sort()).toEqual(labels(expectedWhenOff("remember")));
    expect(linkModes()).not.toContain(MODE_LABEL.timeline);
  });

  it("the metadata page with no mode in its URL draws the default bar", () => {
    loose("");
    expect([...linkModes()].sort()).toEqual(labels(expectedWhenOff()));
  });

  /* The old word, `annotations`, and the mode's own word since 261001n,
     `marginalia`: both are the margin switch, never a band
     (`isMarginaliaModeWord`), so a metadata URL carrying either keeps the
     notes on a band link and mints no `mode=` on the toggle's. */
  for (const word of ["annotations", "marginalia"]) {
    it(`the metadata page translates ?mode=${word} before following either axis`, () => {
      loose(`?mode=${word}`);
      const hrefFor = (mode: Mode) => {
        const link = [...host.querySelectorAll<HTMLAnchorElement>(".dock-modes a.dock-btn")].find(
          (a) => a.getAttribute("aria-label") === MODE_LABEL[mode],
        );
        expect(link, `${mode} link`).toBeDefined();
        return new URL((link as HTMLAnchorElement).href).searchParams;
      };

      const glossary = hrefFor("glossary");
      expect(glossary.get("mode")).toBe("glossary");
      expect(glossary.get("margin"), "a band link dropped the notes state").toBe("1");

      const marginalia = hrefFor("marginalia");
      expect(marginalia.get("mode"), "the toggle link minted a mode= for the margin").toBeNull();
      expect(marginalia.get("margin")).toBe("1");
    });
  }

  it("a mode word the URL made up is ignored rather than drawn", () => {
    loose("?mode=nonsense");
    expect([...linkModes()].sort()).toEqual(labels(expectedWhenOff()));
  });
});

/**
 * **The fit key carries the identities, not the count.** GPT Sol, finding 4:
 * retaining the current mode keeps the count unmoved while `?mode=timeline`
 * becomes `?mode=remember`, and those two words are not the same width — so a
 * signature counting buttons would leave the bar overflowing, or its labels
 * dropped with room to spare, until the next resize.
 */
describe("the fit signature", () => {
  const noop = () => {};
  /* The sixth argument is the bar's own switch, and `null` is "not drawn"; the
     seventh is whether the bar draws a Feedback trigger, and `false` is the
     signed-out bar. What each contributes has its own file —
     tests/dock-experimental-switch.test.tsx § the fit signature, and
     tests/dock-corner-controls.test.tsx § the fit signature — because they are
     about those controls, not about the modes. */
  const sig = (on: boolean, current: BandMode) =>
    fitSignature(visibleModes(on, current), current, noop, undefined, null, null, false);

  it("changes when the visible identities change at a constant count", () => {
    expect(visibleModes(false, "timeline")).toHaveLength(visibleModes(false, "referee").length);
    expect(sig(false, "timeline")).not.toBe(sig(false, "referee"));
  });

  /* Marginalia's toggle pressed is `.on`, which gets its label back at rung 2,
     with the same buttons and the same mode (261001i, GPT Sol's plan review). */
  it("changes when Marginalia's notes are turned on, at the same mode", () => {
    const off = fitSignature(visibleModes(true, "glossary"), "glossary", noop, undefined, null, null, false, false);
    const on = fitSignature(visibleModes(true, "glossary", true), "glossary", noop, undefined, null, null, false, true);
    expect(visibleModes(true, "glossary")).toEqual(visibleModes(true, "glossary", true));
    expect(on).not.toBe(off);
  });

  it("changes when the switch does", () => {
    expect(sig(false, "plain")).not.toBe(sig(true, "plain"));
  });

  /**
   * **The same modes drawn, a different one of them on.**
   *
   * The case above is a different *set* at the same size. This is the same set
   * with a different member selected, and it changed the row's width on
   * 2026-09-05 with nothing watching: styles.css § the bar's fit ladder gives
   * the open mode its word back at rung 2, so Plain → Summary draws one more
   * label than it did. Both are ordinary modes, so `visibleModes` returns the
   * identical list for each — which is the point, and why the assertion checks
   * that before checking the signatures differ. GPT Sol, S1, reviewing the
   * built code of docs/plans/260905g-…-into-the-dock.md.
   */
  it("changes when the same modes are drawn and a different one is on", () => {
    expect(visibleModes(false, "plain").map((m) => m.mode)).toEqual(
      visibleModes(false, "summary").map((m) => m.mode),
    );
    expect(sig(false, "plain")).not.toBe(sig(false, "summary"));
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
  skim: false,
  faq: false,
  simpleSummary: false,
  citations: false,
  debate: false,
};
const EVERYTHING_SHARED: PublicArtefacts = {
  arc: true,
  tweets: true,
  glossary: true,
  ideas: true,
  quotes: true,
  timeline: true,
  sketch: true,
  skim: true,
  faq: true,
  simpleSummary: true,
  citations: true,
  debate: true,
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

        it(`the links arm keeps the mode and its visitor marks — ${what}`, () => {
          loose(`?mode=${mode}`, {
            experimental: flip.experimental,
            marked: reader.marked,
            visitor: reader.visitor,
            signedIn: reader.signedIn,
          });
          const drawn = linkModes();
          expect(drawn.length, what).toBeGreaterThan(0);
          expect(drawn, what).toContain(MODE_LABEL[mode]);
          const expectedMarked = reader.marked
            ? labels([...reader.marked.keys()]).filter((label) => drawn.includes(label))
            : [];
          expect(markedLinkModes().sort(), what).toEqual(expectedMarked.sort());
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
