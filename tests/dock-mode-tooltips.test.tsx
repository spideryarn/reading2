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
 * three `act` blocks to close — are lifted from tests/shelf-action-tooltips.test.tsx,
 * which lifted them from tests/referee-tooltips.test.tsx, which measured them.
 * The third `act` block is this file's own addition and `cardFor` says why.
 * docs/project/tooltips.md § Three things about testing a card in jsdom.
 *
 * ## And the three buttons in the bar that are *not* modes
 *
 * Comments, Tweets and Metadata took cards on 2026-09-07 too, and their block
 * is at the foot of this file. They are here rather than in a file of their own
 * for the reason the components sit beside each other in `Dock.tsx`: the claim
 * being made is about *the bar*, and a reader checking whether every button in
 * it explains itself should not have to know there are two files. The harness
 * above is the same harness, which is the other half of it — a fourth copy of
 * these hover mechanics is not worth a tidier filename.
 *
 * **The name stayed narrow deliberately.** Five places point at this file and
 * several of them — src/mode-catalog.ts, docs/project/new-mode.md — are telling
 * the author of a *fifteenth mode* where their test is. `dock-mode-tooltips` is
 * the right name for them, and renaming it would make those pointers vaguer to
 * make this paragraph unnecessary.
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
import { EXPERIMENTAL_ON, EXPERIMENTAL_SIGNED_OUT } from "./helpers/experimental-fixtures.js";

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
  /* **Three waits, and not one long one.** Closing is timers in series with a
     render between them, and inside a single `act` the queued update is not
     applied until the block exits — so a single long block leaves the card in
     the DOM however long it waits. The first two get it shut.

     **The third is the group's cleanup**, and it is why this file can hover the
     same button twice. `TooltipGroup` is `FloatingDelayGroup`, which waits its
     `timeoutMs` — 400ms in the bar — after a close before it clears the current
     group member, and that timer only starts at the close *render*. With two
     300ms waits it is still pending when the next `mouseenter` arrives: the
     reopen is instant (the group is in its instant phase) and the stale timer's
     close lands in the same `act`, so the card opens and shuts inside one block
     and the assertion reads zero.

     That failure says *"hovering this control opened no card"*, which reads as
     the tooltip having been lost and sends you to `Dock.tsx`. It was diagnosed
     as *the element only opens once per mount* on 2026-09-07 and remounted
     around — wrong: `useHover` keeps no one-shot state, and the same element
     reopens three times running once the group timer is allowed to finish
     (GPT Sol, and measured both ways).
     docs/project/tooltips.md § Three things about testing a card in jsdom. */
  for (const _ of [0, 1, 2]) {
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

/* ------------------------------------- and the three that are not modes ---- */

/**
 * **Comments, Tweets and Metadata**, which sit in the same bar and were the last
 * three buttons in it wearing a `title` attribute — the OS box, which waits a
 * second, cannot be styled, and does not exist on a touch device at all.
 *
 * A closed set of three, written out rather than derived, because unlike
 * `MODES` there is no table to walk and no fourth arriving. If one does, this
 * list is where it is noticed.
 *
 * Two of them are one button each. **Comments is two** — a `DockTab` opening
 * the drawer on the reading view, a `DockLink` back to it everywhere else — and
 * that pair is what matters most here: the drawer's visitor notice was retired
 * on 2026-09-04 and this button went on saying half of it, because nothing
 * compared the two. `NOT_A_MODE` is one copy for both arms now, and these tests
 * read it back through the rendered card rather than by importing it, so what
 * is asserted is what a reader is shown.
 */
const NOT_MODES = ["Comments", "Tweets", "Metadata"] as const;

/** The bar's button with this accessible name, in whichever arm is rendered. */
function barControl(label: string): HTMLElement {
  const hit = [...host.querySelectorAll<HTMLElement>(".dock .dock-btn")].filter(
    (el) => el.getAttribute("aria-label") === label,
  );
  expect(hit, `no single bar button named ${label}`).toHaveLength(1);
  return hit[0] as HTMLElement;
}

/**
 * The reading view **with a drawer**, which is the arm where Comments is a
 * `DockTab` rather than a link. `reading()` above deliberately mounts without
 * one, because the modes do not care; this button is the only thing in the bar
 * that changes component when the drawer appears.
 */
function withDrawer(drawer: Record<string, unknown> = {}): void {
  reading({
    drawer: {
      comments: [],
      loaded: true,
      loadFailed: false,
      panel: null,
      onPanel: () => {},
      onOpenComment: () => {},
      ...drawer,
    },
  });
}

describe("the three buttons in the bar that are not modes", () => {
  it("each open a card of two paragraphs, headed with their own name", async () => {
    withDrawer();
    for (const label of NOT_MODES) {
      const { head, paras } = await cardFor(barControl(label));
      expect(head, `${label}'s card is headed with somebody else's name`).toBe(label);
      expect(paras.length, `${label}'s card is not two paragraphs`).toBe(2);
      for (const p of paras) expect(p, `${label} has an empty paragraph`).not.toBe("");
    }
  });

  /**
   * The check that makes the card worth its 300ms. It catches a copy and not a
   * paraphrase — `restates` above says why that is still worth having — and
   * this is where the temptation is strongest: all three of these had a single
   * sentence for a fortnight, and the cheapest way to grow a second paragraph
   * is to say the first one again.
   */
  it("do not say the first paragraph twice, or the button's own word back", async () => {
    withDrawer();
    for (const label of NOT_MODES) {
      const { paras } = await cardFor(barControl(label));
      const [what, how] = paras as [string, string];
      expect(restates(what, how), `${label}: the second paragraph is the first again`).toBe(false);
      expect(restates(label, what), `${label}: the first paragraph is the label again`).toBe(false);
    }
  });

  /**
   * The same product decision the modes are under: the command bar marks a
   * generating row with the word `generates` and no number, so a `$` here would
   * be that decision reversed by accident. Tweets is the one that would attract
   * a price, being the only button of the three that can start a paid run.
   */
  it("carry no currency-symbol figure", async () => {
    withDrawer();
    for (const label of NOT_MODES) {
      const { paras } = await cardFor(barControl(label));
      expect(paras.join(" "), `${label} names a price`).not.toMatch(/[$£€]\s*\d/);
    }
  });

  it("carry no `title` attribute, in either arm of the bar", () => {
    for (const render of [withDrawer, loose]) {
      render();
      const titled = NOT_MODES.map(barControl).filter((el) => el.hasAttribute("title"));
      expect(titled.map((el) => el.getAttribute("aria-label"))).toEqual([]);
    }
  });

  /**
   * **The arm that drifts.** Off the reading view all three are `DockLink`s, and
   * Comments changes shape entirely: there is no drawer to open, so the button
   * goes back to the article with it already open. The card has to say so —
   * exactly as the loose mode links say *back in the article itself* — and
   * everything else in it must be the same words.
   */
  it("give Comments the same card off the reading view, plus where the press lands", async () => {
    withDrawer();
    const onReadingView = await cardFor(barControl("Comments"));
    loose();
    const offIt = await cardFor(barControl("Comments"));

    expect(offIt.head).toBe("Comments");
    expect(offIt.paras.length, "the loose Comments card is not two paragraphs").toBe(2);
    expect(offIt.paras[0]).toContain(onReadingView.paras[0]);
    expect(offIt.paras[0]).toContain("back in the article they are about");
    expect(offIt.paras[1], "the second paragraph differs between the arms").toBe(
      onReadingView.paras[1],
    );
  });
});

describe("Comments, read by somebody who did not add the article", () => {
  /**
   * **A visitor may open every one of the owner's marks and may add none**, and
   * that is the one thing about this button they could not have guessed. It
   * goes in `state`, above the description, for the reason a mode's does: the
   * line explaining why a button behaves unlike its neighbours is the first
   * thing wanted and the last thing reached.
   *
   * **Not `readersOwnWork("Comments")`**, which is what this button said half
   * of until 2026-09-07. That sentence ended *a shared link carries the piece,
   * never anybody's notes about it*, and it stopped being true on 2026-09-04
   * when a shared link started carrying them (260904c § Stage 3). The drawer
   * dropped the notice that day and the button kept it. The function was
   * deleted on 2026-09-08 with the `readers-own` variant that called it, so
   * there is no longer a wrong sentence for this one to be chosen over — which
   * is why the note stays: it is the only place the choice is recorded.
   *
   * So this asserts the *shape*, and one clause of the claim, and deliberately
   * not the sentence — pinning the wording is how the old one survived a
   * rewrite of everything around it.
   */
  it("says whose they are first, above what a comment is", async () => {
    withDrawer({ visitor: true });
    const { head, paras } = await cardFor(barControl("Comments"));
    expect(head).toBe("Comments");
    expect(paras.length, "the visitor's card is not three paragraphs").toBe(3);
    expect(paras[0], "the visitor's sentence is not first").toMatch(/whoever added this article/i);

    /* And under it, the two the owner gets — unchanged, and in the same order.
       Read from a second render rather than written out, so this compares what
       two readers are shown rather than comparing one of them with a copy of
       its own words. Hovering the same button twice is fine now that `cardFor`
       waits out the group's cleanup timer; it was not before, and the note
       there says why. */
    withDrawer();
    const owner = await cardFor(barControl("Comments"));
    expect(paras.slice(1)).toEqual(owner.paras);
  });

  /**
   * **And in the drawerless arm, which is the one that drifted.** Off the
   * reading view the button is a `DockLink` and its footing comes from a
   * different prop — `isVisitor` rather than `own` — so the two are separate
   * wiring to the same string, and a regression deleting one of them is
   * invisible to the other's test. That is not hypothetical: this arm is
   * exactly where *"Your comments…"* survived the 2026-08-28 correction of the
   * drawer heading, and where the retired *belong to whoever added this
   * article* notice survived 2026-09-04.
   *
   * GPT Sol found the gap in the first draft of these tests, which covered the
   * `DockTab` arm only.
   */
  it("says it in the drawerless arm too, where the footing comes from another prop", async () => {
    loose({ visitor: true });
    const { paras } = await cardFor(barControl("Comments"));
    expect(paras.length, "the loose visitor's card is not three paragraphs").toBe(3);
    expect(paras[0], "the visitor's sentence is not first").toMatch(/whoever added this article/i);
    expect(paras[1], "the loose arm has lost where the press lands").toContain(
      "back in the article they are about",
    );
  });
});

/* ------------------------- the last two buttons to carry an OS box --------- */

/**
 * **The wordmark and the command button**, which took cards on 2026-09-08 —
 * the two the stage before this one deliberately left alone, because neither
 * goes through `DockLink` and neither was one of the three Greg named.
 *
 * They are the ends of the row rather than a pair: `DockHome` is the first
 * thing in the bar and `DockCommands` the button after the modes. What they
 * share is only what put them last — a `title` attribute, and no card.
 *
 * `barControl` cannot find the wordmark: it is a `.logo.dock-home`, not a
 * `.dock-btn`, because § the bar's fit ladder and the logo animations both key
 * on that class (design-logo.md § Two mount points). So it gets its own finder
 * rather than a widened one, which would have quietly started matching the
 * Feedback trigger too.
 */
function homeControl(): HTMLElement {
  const hit = host.querySelectorAll<HTMLElement>(".dock .dock-home");
  expect(hit, "no single wordmark in the bar").toHaveLength(1);
  return hit[0] as HTMLElement;
}

describe("the wordmark and the command button", () => {
  it("each open a card of two paragraphs, headed with their own name", async () => {
    reading();
    for (const [el, name] of [
      [homeControl(), "Spideryarn"],
      [barControl("Commands"), "Commands"],
    ] as const) {
      const { head, paras } = await cardFor(el);
      expect(head, `${name}'s card is headed with somebody else's name`).toBe(name);
      expect(paras.length, `${name}'s card is not two paragraphs`).toBe(2);
      for (const p of paras) expect(p, `${name} has an empty paragraph`).not.toBe("");
    }
  });

  it("do not say the first paragraph twice, or the button's own word back", async () => {
    reading();
    for (const [el, name] of [
      [homeControl(), "Spideryarn"],
      [barControl("Commands"), "Commands"],
    ] as const) {
      const { paras } = await cardFor(el);
      const [what, how] = paras as [string, string];
      expect(restates(what, how), `${name}: the second paragraph is the first again`).toBe(false);
      expect(restates(name, what), `${name}: the first paragraph is the label again`).toBe(false);
    }
  });

  /**
   * The `title` these two carried until 2026-09-08, asserted gone — the
   * wordmark in both arms of the bar, the command button in the only one it
   * appears in. Same reason as the three above: a `title` beside a card is a
   * race, not a fallback.
   */
  it("carry no `title` attribute", () => {
    reading();
    expect(homeControl().hasAttribute("title"), "the OS box is back on the wordmark").toBe(false);
    expect(barControl("Commands").hasAttribute("title"), "the OS box is back on Commands").toBe(
      false,
    );
    loose();
    expect(homeControl().hasAttribute("title"), "the OS box is back off the reading view").toBe(
      false,
    );
  });

  /**
   * **The one clause in this file pinned to its wording**, and it is pinned
   * because a decision made elsewhere depends on it existing here.
   * `DockCommands` § The glyph is `Command` argues that the label should say
   * what the button opens rather than how else to open it — which leaves this
   * card as the only surface in the app that can teach the chord. On the phone
   * this button was built for, the `title` it replaced never showed at all.
   *
   * **Both complete forms**, which the first draft did not do: it asserted the
   * character `⌘` alone, which passes on a card saying *press ⌘* with the `K`
   * gone and says nothing at all about the half a reader without a Mac needs.
   * GPT Sol, 2026-09-08 — and a fair hit on a test whose whole point is that
   * this is the only surface carrying the chord.
   */
  it("teaches both halves of the keyboard chord, which the label deliberately does not", async () => {
    reading();
    const { paras } = await cardFor(barControl("Commands"));
    const card = paras.join(" ");
    expect(card, "the card has lost the Mac chord").toContain("⌘K");
    expect(card, "the card has lost the chord for everybody else").toContain("Ctrl-K");
  });

  /**
   * **A stranger has no shelf**, which is the same shape as the Comments bug
   * stage 2 found the day before: a sentence true for the owner, read out to a
   * visitor, on a button the visitor can see. Signed out, `/` is the landing
   * page (App.tsx § the signed-out routes).
   *
   * **The card stays two paragraphs and changes the first**, rather than
   * gaining a `state` above it — Tooltip.tsx § `ControlTip` has the two
   * reasons, and this is where a regression back to three would show. So the
   * count is asserted as well as the words: a `state` reappearing here would
   * put a denial over the thing denied and no assertion about content alone
   * would notice.
   *
   * Clauses, never the sentence: pinning the wording is how the last one
   * survived a rewrite of everything around it.
   */
  it("sends a signed-out reader to the front page, in the paragraph the owner reads", async () => {
    reading({ experimental: EXPERIMENTAL_SIGNED_OUT });
    const { paras } = await cardFor(homeControl());
    expect(paras.length, "the signed-out wordmark card is not two paragraphs").toBe(2);
    expect(paras[0], "it does not say where the press actually lands").toMatch(/front page/i);
    expect(paras[0], "it still promises a library to a reader who has none").not.toMatch(
      /your library/i,
    );
  });

  /**
   * **The frame before the store knows**, which is the one that would have
   * shipped a false sentence to the owner rather than the visitor.
   *
   * `experimental-store.ts` opens on `{loaded: false, signedIn: false}` and only
   * writes `loaded: true` when its auth callback lands, so a bare `signedIn`
   * read here says *signed out* about a reader who is not — the frame
   * tests/dock-corner-controls.test.tsx already documents from the other side.
   * The bar asks `loaded && !signedIn` instead, and *unknown* falls to the
   * owner's sentence.
   *
   * Built inline rather than added to the fixtures, for the reason their own
   * header gives about `broken()`: a near-identical object in a shared list is
   * what goes stale one field at a time. GPT Sol, 2026-09-08.
   */
  it("does not call a reader signed out before the store has found out", async () => {
    reading({ experimental: { ...EXPERIMENTAL_SIGNED_OUT, loaded: false } });
    const { paras } = await cardFor(homeControl());
    expect(paras[0], "an unknown reader is told they have no library").toMatch(/your library/i);
  });

  /** And the owner is told none of it, because for them none of it is true. */
  it("sends a signed-in reader to their library, and says nothing about signing in", async () => {
    reading();
    const { paras } = await cardFor(homeControl());
    expect(paras.length, "the signed-in wordmark card is not two paragraphs").toBe(2);
    expect(paras[0], "the owner is no longer sent to their library").toMatch(/your library/i);
    expect(paras.join(" "), "the owner is told about signing in").not.toMatch(/signed out|sign in/i);
  });
});
