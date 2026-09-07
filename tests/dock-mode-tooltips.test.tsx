// @vitest-environment jsdom
/**
 * **Every mode in the bottom bar explains itself, in both arms of the bar.**
 *
 * Greg, 2026-09-07: *"Make sure all the modes in the bottom-bar have rich
 * tooltips, and update new-mode.md."*
 *
 * The buttons already opened a card; what the card said was one sentence, and
 * that sentence was the mode's `description` — the same words the command bar
 * draws inline beside the name. So the hover cost a reader 300ms to be told
 * what the label had told them. `MODE_CATALOG[mode].how` is the half they could
 * not have guessed, and this file is what stops a fifteenth mode arriving with
 * a card that is a label wearing a panel.
 * docs/plans/260907b-rich-tooltips-on-the-dock-modes.md.
 *
 * ## What this pins, and what it deliberately does not
 *
 * **Not the wording**, for the reason tests/referee-tooltips.test.tsx gives at
 * length: it is copy, it will be edited, and a test spelling it out is a second
 * copy to keep in step. What has to hold is structural.
 *
 *  - **Every mode, in both arms.** The segment on the reading view and the
 *    fourteen loose links on the metadata and tweets pages are two different
 *    components, and the loose one is the one that had a `title` attribute for
 *    a fortnight without anybody noticing.
 *  - **Two paragraphs, and the second is not the first again.** `restates`
 *    below catches a copy and cannot catch a paraphrase — its value is that it
 *    makes the cheapest way to fill a second paragraph fail.
 *  - **No `title` attribute on a mode.** The regression that is invisible on a
 *    laptop, because a `title` still shows *something*.
 *  - **The visitor's sentence is in the card**, above the description rather
 *    than under it — the reason a mode a visitor cannot have is drawn dimmed is
 *    the first thing they want and the last thing they would reach.
 *
 * The hover mechanics — a native `mouseenter` to open, both leave events and
 * two `act` blocks to close — are lifted from tests/shelf-action-tooltips.test.tsx,
 * which lifted them from tests/referee-tooltips.test.tsx, which measured them.
 * docs/project/tooltips.md § Two things about testing a card in jsdom.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { MODE_CATALOG } from "../src/mode-catalog.js";
import { MODES, type Mode } from "../src/modes.js";
import { MODE_LABEL } from "../src/title-text.js";
import type { PublicArtefacts } from "../src/types.js";
import { Dock } from "../src/web/Dock.js";
import { markedModes } from "../src/web/visitor.js";
import { EXPERIMENTAL_ON } from "./helpers/experimental-fixtures.js";

/* ---------------------------------------------------------------- harness -- */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", "/read/a-piece");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/**
 * The bar on the reading view — the `role="radio"` segment. The switch is on in
 * every render here, because the point of this file is *every* mode and four of
 * them are behind it. Which four is not this file's business:
 * tests/dock-experimental-modes.test.tsx owns that.
 */
function reading(props: Record<string, unknown> = {}): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: the two arms of the bar differ by which props are present, the same cast tests/dock-experimental-modes.test.tsx makes
      createElement(Dock as any, {
        slug: "a-piece",
        view: "article",
        mode: "plain",
        onMode: () => {},
        experimental: EXPERIMENTAL_ON,
        ...props,
      }),
    );
  });
}

/** The bar off the reading view: fourteen loose links rather than a segment. */
function loose(props: Record<string, unknown> = {}): void {
  history.replaceState(null, "", "/read/a-piece/metadata");
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: as above
      createElement(Dock as any, {
        slug: "a-piece",
        view: "metadata",
        experimental: EXPERIMENTAL_ON,
        ...props,
      }),
    );
  });
}

/** Every control that is one of the modes, in either arm. */
function modeControls(): HTMLElement[] {
  return [...host.querySelectorAll<HTMLElement>('.dock-modes [role="radio"], a.dock-mode')];
}

/** The one whose accessible name is this mode's label. */
function controlFor(mode: Mode): HTMLElement {
  const hit = modeControls().filter((el) => el.getAttribute("aria-label") === MODE_LABEL[mode]);
  expect(hit, `no single control for ${mode}`).toHaveLength(1);
  return hit[0] as HTMLElement;
}

const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/**
 * **Open one card and read it**, then shut it again.
 *
 * Exactly one card must be open: the panel is portalled to the end of `<body>`
 * rather than into `host`, so a neighbour's card left up would be read here as
 * this control's — which is precisely how a check like this passes with the
 * card attached to the wrong button.
 */
async function cardFor(el: Element): Promise<{ head: string; paras: string[] }> {
  el.dispatchEvent(new MouseEvent("mouseenter"));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
  const cards = document.querySelectorAll('[role="tooltip"]');
  expect(cards, "hovering this control opened no card, or more than one").toHaveLength(1);
  const card = cards[0];
  const head = flat(card?.querySelector(".tip-soon-head")?.textContent);
  const paras = [...(card?.querySelectorAll("p") ?? [])].map((n) => flat(n.textContent));

  /* Both leave events, because opening and closing do not take the same one: a
     native `mouseleave` alone leaves the card up, and what closes it is React's
     synthetic `onMouseLeave`, synthesised from a *bubbling* `mouseout`. */
  el.dispatchEvent(new MouseEvent("mouseleave"));
  el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
  /* Two waits and not one long one: closing is two timers in series with a
     render between them, and inside a single `act` the queued update is not
     applied until the block exits. */
  for (const _ of [0, 1]) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
  }
  expect(
    document.querySelectorAll('[role="tooltip"]'),
    "the card did not close, so the next one read here would be this one",
  ).toHaveLength(0);
  return { head, paras };
}

/* ------------------------------------------- does a card earn its hover ---- */

const STOPWORDS = new Set(
  (
    "a an and are as at be been but by can cannot did do does for from get gets go goes had has " +
    "have how i if in into is it its just may more most no not of off on once one only or other " +
    "our out over same so some than that the their them then there these they this those to under " +
    "until up was what when where which while who will with would you your yours"
  ).split(" "),
);

/** The content words of a sentence, in order, with the grammar thrown away. */
function words(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w !== "" && !STOPWORDS.has(w));
}

/**
 * **Is one of these two the other one again?** The shorter's content words
 * appearing in order inside the longer, which fires on a real copy-paste.
 *
 * As in tests/referee-tooltips.test.tsx and tests/shelf-action-tooltips.test.tsx,
 * this catches copying and not paraphrase — nothing mechanical reads for
 * meaning. Written down here rather than left to be discovered, because the
 * cards it guards are the ones a fifteenth mode's author will copy.
 */
function restates(a: string, b: string): boolean {
  const [short, long] =
    words(a).length <= words(b).length ? [words(a), words(b)] : [words(b), words(a)];
  if (short.length === 0) return true;
  let i = 0;
  for (const w of long) if (w === short[i]) i++;
  return i === short.length;
}

/* ------------------------------------------------------------------ tests -- */

describe("the catalog's two sentences per mode", () => {
  /**
   * Read off the table rather than out of a rendered card, so that a mode
   * behind a gate this file does not model is still covered. `Record<Mode, …>`
   * already proves the field exists; what it cannot say is that somebody wrote
   * something in it.
   */
  it("are both there, and neither is empty", () => {
    for (const mode of MODES) {
      const { description, how } = MODE_CATALOG[mode];
      expect(flat(description), `${mode} has no description`).not.toBe("");
      expect(flat(how), `${mode} has no how`).not.toBe("");
    }
  });

  it("do not restate each other", () => {
    for (const mode of MODES) {
      const { description, how } = MODE_CATALOG[mode];
      expect(restates(description, how), `${mode}: the second paragraph is the first again`).toBe(
        false,
      );
    }
  });

  /**
   * **The label check belongs on the first paragraph and not on the second**,
   * which is measured rather than assumed: run against `how` it fails on
   * Summary, whose card says *"a shorter summary of the same thing is a
   * different level of the tree"* — a true and useful sentence that happens to
   * contain the mode's one-word name. A single-word label has one content word,
   * so `restates` degrades there to *does this mention the mode*, which is
   * often exactly what the sentence should do.
   *
   * On the first paragraph it means something: a description that is the button's
   * word again is a card telling the reader what they just read off the button.
   */
  it("do not open by saying the button's own word back", () => {
    for (const mode of MODES) {
      expect(
        restates(MODE_LABEL[mode], MODE_CATALOG[mode].description),
        `${mode}: the first paragraph is the label again`,
      ).toBe(false);
    }
  });

  /**
   * **No figure, and this is a product decision rather than a style rule.** The
   * command bar marks a generating row with the single word `generates` and no
   * number, because a bar with a price on it would be *more* disclosed than the
   * button beside it — docs/project/reading-view-overview.md § The command bar.
   * A tooltip on that same button is the same surface, so a `$` arriving in one
   * of these is a decision being reversed by accident.
   *
   * **Named for what it actually checks**, which is a currency symbol next to a
   * number. It does not catch "twenty pence" or "about 20 dollars", and no
   * regex will; GPT Sol pointed out that the honest name is the narrow one,
   * because a test called *carries no price* invites the next author to trust
   * it with the whole rule. It is a tripwire on the one form somebody would
   * paste in from `diagram.md`, and the rule itself lives in
   * src/mode-catalog.ts § `how`.
   */
  it("carries no currency-symbol figure, which is the form a price gets pasted in", () => {
    for (const mode of MODES) {
      expect(MODE_CATALOG[mode].how, `${mode} names a price`).not.toMatch(/[$£€]\s*\d/);
    }
  });
});

describe("the mode segment on the reading view", () => {
  it("gives every mode a card of its own, with both paragraphs in it", async () => {
    reading();
    for (const mode of MODES) {
      const { head, paras } = await cardFor(controlFor(mode));
      expect(head, `${mode}'s card is headed with somebody else's name`).toBe(MODE_LABEL[mode]);
      expect(paras.length, `${mode}'s card is not two paragraphs`).toBe(2);
      expect(paras[0]).toBe(flat(MODE_CATALOG[mode].description));
      expect(paras[1]).toBe(flat(MODE_CATALOG[mode].how));
    }
  });

  it("carries no `title` attribute — the OS box would win the race with our card", () => {
    reading();
    const titled = modeControls().filter((el) => el.hasAttribute("title"));
    expect(titled.map((el) => el.getAttribute("aria-label"))).toEqual([]);
  });

  /**
   * The card is the trigger's *description* (`useRole` wires `aria-describedby`),
   * never its name, so every button needs a name of its own — the visible label
   * is `display: none` on the narrow rungs of the fit ladder, and an accessible
   * name computed from the text would go with it.
   */
  it("names every button, so a screen reader gets what the pointer gets", () => {
    reading();
    for (const el of modeControls()) expect(flat(el.getAttribute("aria-label"))).not.toBe("");
  });
});

describe("the loose mode links, off the reading view", () => {
  /**
   * **The arm that was left behind.** These carried a `title` attribute until
   * 2026-09-07 while the segment had a card, so the same fourteen modes
   * explained themselves one way on the reading view and another on the
   * metadata page.
   */
  it("give every mode the same card the segment does", async () => {
    loose();
    for (const mode of MODES) {
      const { head, paras } = await cardFor(controlFor(mode));
      expect(head, `${mode}'s card is headed with somebody else's name`).toBe(MODE_LABEL[mode]);
      expect(paras.length, `${mode}'s card is not two paragraphs`).toBe(2);
      /* The one difference between the arms, and the only one there should be:
         pressing this leaves the page you are on. */
      expect(paras[0]).toContain(flat(MODE_CATALOG[mode].description));
      expect(paras[0]).toContain("back in the article itself");
      expect(paras[1]).toBe(flat(MODE_CATALOG[mode].how));
    }
  });

  it("carries no `title` attribute either", () => {
    loose();
    const titled = modeControls().filter((el) => el.hasAttribute("title"));
    expect(titled.map((el) => el.getAttribute("aria-label"))).toEqual([]);
  });
});

describe("a mode a visitor cannot have", () => {
  /**
   * **The visitor's sentence goes above the description, not under it.** It was
   * a third paragraph while the card had two, and with `how` it would be the
   * third of three — burying the one line that says why the button is drawn
   * dimmed under two paragraphs about a mode they cannot open.
   *
   * `markedModes` is the real producer rather than a literal map, so the day it
   * stops marking a mode this test stops claiming it does.
   */
  it("says so first, before what the mode is", async () => {
    /* Nothing generated and nothing shared: every artefact-backed mode is a gap
       for this visitor, which is the state the sentence exists for.

       **Written out rather than cast from `{}`.** The empty object typechecks
       nowhere — `PublicArtefacts` is seven required booleans — and the cast that
       would have made it compile is exactly the thing that stops an eighth
       artefact from turning this test red the day it is added. */
    const available: PublicArtefacts = {
      arc: false,
      tweets: false,
      glossary: false,
      ideas: false,
      quotes: false,
      timeline: false,
      sketch: false,
    };
    const marked = markedModes(available);
    const gapped = [...marked.keys()];
    expect(gapped.length, "no mode is marked, so this test asserts nothing").toBeGreaterThan(0);

    reading({ marked });
    for (const mode of gapped) {
      const { paras } = await cardFor(controlFor(mode));
      expect(paras.length, `${mode}'s card is not three paragraphs`).toBe(3);
      expect(paras[0], `${mode}: the visitor's sentence is not first`).toBe(
        flat(marked.get(mode) ?? ""),
      );
      expect(paras[1]).toBe(flat(MODE_CATALOG[mode].description));
      expect(paras[2]).toBe(flat(MODE_CATALOG[mode].how));
    }
  });
});
