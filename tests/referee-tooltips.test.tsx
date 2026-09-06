// @vitest-environment jsdom
/**
 * **Every control in Referee mode explains itself, and in a card rather than a
 * `title`.**
 *
 * Greg, 2026-09-02: *"The new Referee mode is very confusing. Add lots of
 * explanatory tooltips to buttons etc."* Before stage 2 of
 * docs/plans/260902f-make-referee-mode-understandable.md the mode had **zero**
 * `Tooltip`/`ControlTip` uses: four sub-mode chips that are one word each, a
 * coloured square with no glyph, a large numeral that reads like a severity
 * score, and a `<select>` that silently throws a judgement away.
 *
 * ## What this file pins, and what it deliberately does not
 *
 * **Not the wording.** It is copy, it will be edited, and a test that spelled it
 * out would be a second copy to keep in step — the same call
 * tests/diagram-panel-hover.test.tsx makes about the diagram band's cards, and
 * this file borrows its `cardFor` shape wholesale.
 *
 * What has to hold is structural: that each control has a card, that the card is
 * *that* control's, that it says more than the label already does, and that a
 * `title` attribute has not crept back in — which is the regression that is
 * invisible on a laptop, because a `title` still shows *something*.
 *
 * **The exception is four labels**, which are pinned as literals, because for
 * those the wording *is* the fix. A tooltip is not read by anybody in a hurry,
 * which is what a referee is (src/web/MirrorPanel.tsx says so about itself), so
 * where the words on the control were themselves misleading the card is not the
 * answer and the label had to change. Pinning them as literals rather than
 * reading the constants is the point: a copy test that read `KIND_LABEL` would
 * pass over any wording at all, including the wording it was written to remove.
 *
 * ## How a card is opened here
 *
 * A native `mouseenter` on the trigger, and then the open delay waited out for
 * real. `useHover` binds that listener to the reference node rather than going
 * through React, so a bubbling `mouseover` never reaches it
 * (tests/tooltip-on-link.test.tsx § `hoverTheLink`). Hover rather than focus,
 * unlike the diagram band's tests, because three of the triggers here are not
 * focusable at all — a `<span>` inside a button, a heading, a list — and a focus
 * route that worked for the buttons would quietly test nothing on those.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Claim } from "../src/referee-claims.js";
import type { MirrorInput, MirrorRemark, MirrorResult } from "../src/referee-mirror-types.js";
import type { RefereeView } from "../src/web/referee-views.js";
import type { Block, BlockId } from "../src/types.js";

/** One reply, decided by the test that is running — tests/referee-criteria-panel.test.tsx. */
let answer: (url: string, init: RequestInit) => Promise<Response>;

/**
 * `apiFetch` and `fetchOk`, both, for the reason
 * tests/referee-criteria-panel.test.tsx gives: `fetchOk` calls `apiFetch`
 * through the module's own binding, so replacing only the export would leave
 * `useCriteria`'s writes reaching for a real Supabase session.
 */
vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const apiFetch = (url: string, init: RequestInit = {}) => answer(url, init);
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init: RequestInit = {}) => {
      const r = await apiFetch(url, init);
      if (!r.ok) throw await real.failure(r);
      return r;
    },
  };
});

const { CriteriaBand } = await import("../src/web/CriteriaPanel.js");
const { MirrorView } = await import("../src/web/MirrorPanel.js");
const { RefereeViews } = await import("../src/web/App.js");
const { ClaimsView } = await import("../src/web/ClaimsPanel.js");
const { CandidatesPanel } = await import("../src/web/CandidatesPanel.js");
const { PlaceOnCriterion } = await import("../src/web/PlaceOnCriterion.js");
type MirrorApi = import("../src/web/useMirror.js").MirrorApi;
type ClaimsApi = import("../src/web/useClaims.js").ClaimsApi;

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`. docs/project/block-ids.md. */
const BLOCK = "spya-k3m9qt" as BlockId;
const OTHER = "spya-p7w2dn";
const SLUG = "a-paper";

const BLOCKS: Block[] = [
  {
    id: BLOCK,
    tag: "p",
    kind: "text",
    text: "Thirty-one participants in each arm, with no unexposed comparison group.",
    words: 11,
    html: "<p>Thirty-one participants in each arm, with no unexposed comparison group.</p>",
    gistable: true,
  },
];

/* ------------------------------------------------------------- the harness -- */

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  answer = () => Promise.resolve(json({ criteria: [] }));
  history.replaceState(null, "", `/read/${SLUG}`);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Let the fetch chains settle — tests/referee-criteria-panel.test.tsx § `flush`. */
async function flush(times = 4): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

/**
 * **Open one card and read it**, then shut it again.
 *
 * Two things here are load-bearing and both come from
 * tests/diagram-panel-hover.test.tsx, where they were found the hard way:
 *
 *  - **The card is portalled to the end of `<body>`**, not into `host`, so it is
 *    looked for in the document — and a neighbour's card left open would be read
 *    as this control's, which is exactly how a check like this passes with a
 *    card attached to the wrong thing. **Exactly one** card must be open, and
 *    the caller then checks its head against the control it hovered.
 *  - **The pointer is taken off again and the close waited out**, rather than
 *    the node being removed: the card is React's, and tearing it out from under
 *    React takes the next render down with it.
 *
 * 400ms to open — the grouped delay is 300 — and two waits of 300 to close, for
 * the reason written where the close is dispatched. Shortening either trades a
 * slow test for a flaky one.
 */
async function cardFor(el: Element): Promise<Card> {
  el.dispatchEvent(new MouseEvent("mouseenter"));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
  const cards = document.querySelectorAll('[role="tooltip"]');
  expect(cards, "hovering this control opened no card, or more than one").toHaveLength(1);
  const card = cards[0];
  const head = card?.querySelector(".tip-soon-head")?.textContent ?? "";
  const body = (card?.textContent ?? "").slice(head.length);
  /* **The two paragraphs separately, not one blob**, because `ControlTip`'s rule
     is about the relationship between them: the first is what a press would have
     told you and the second is what it would not. A check that reads them
     concatenated cannot see the failure that rule exists to prevent. */
  const paras = [...(card?.querySelectorAll("p") ?? [])].map((n) => flat(n.textContent));
  const what = paras[0] ?? "";
  const how = paras[1] ?? "";
  /* **Opening and closing do not take the same event, and that is measured
     rather than guessed.** A native `mouseleave` on the trigger leaves the card
     up: what closes it is React's synthetic `onMouseLeave`, which React
     synthesises from a *bubbling* `mouseout` whose `relatedTarget` is outside
     the trigger. Measured against a bare `Tooltip` rather than reasoned about:
     with `mouseleave` alone the card was still up half a second later. Both are
     sent, so this does not depend on which of the two routes closes it. */
  el.dispatchEvent(new MouseEvent("mouseleave"));
  el.dispatchEvent(new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }));
  /* **Two waits, not one long one, and this is the second measured thing.**
     Closing is two timers in series with a React render between them: the close
     delay sets `open` to false, and only the *render* that follows schedules the
     transition's unmount. Inside a single `act` the queued state update is not
     applied until the block exits, so the second timer has not been scheduled
     yet and the card is still in the DOM however long that block waits. One
     500ms wait failed here; two 300ms waits pass. */
  for (const _ of [0, 1]) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 300));
    });
  }
  expect(
    document.querySelectorAll('[role="tooltip"]'),
    "the card did not close, so the next one read here would be this one",
  ).toHaveLength(0);
  return { head, body, what, how };
}

interface Card {
  /** The `.tip-soon-head` — in every card in this mode, the control's own name. */
  head: string;
  /** Both paragraphs, concatenated, for the checks that are about the whole. */
  body: string;
  /** The first paragraph: what a press would have told you. */
  what: string;
  /** The second: what it would not — `ControlTip`'s whole rule. */
  how: string;
}

const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/* ---------------------------------------------- does a card earn its hover -- */

/**
 * **The generic check was `body.length > 80`, and long repetition passed it.**
 * That is the failure a cross-family review found in four real cards on
 * 2026-09-02: a first paragraph paraphrasing the label the reader is looking at,
 * and a second repeating the visible footnote below the list. A card that says
 * what is already on screen is worse than no card, because it costs a hover to
 * find that out.
 *
 * So the length floor stays — a two-word "explanation" is still a failure — and
 * three restatement checks join it, which is what `earnsItsHover` is.
 *
 * **This catches copying, not paraphrase**, and the limit is worth writing down
 * rather than leaving for somebody to discover: *"Draws this claim's passages in
 * the article"* under a label reading *Mark these passages in the paper* shares
 * one content word in three and would pass here. Nothing mechanical reads for
 * meaning. What this file does about that is cover the cards at all — before
 * this stage Claims, Candidates and `PlaceOnCriterion` were never imported here,
 * so deleting any of their cards left the suite green.
 */
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
 * **Is one of these two the other one again?**
 *
 * Two tests. The first fires on a real copy: the shorter passage's content words
 * appearing in order inside the longer one, however much padding is wrapped
 * round them. The second is the looser one — most of the shorter's vocabulary
 * reused — and it is calibrated at 0.6 against a card this stage deleted:
 * *"A randomised trial tested feedback of this shape"* under the label *A kind
 * tested in a trial* scores 0.67 and is caught.
 *
 * Two guards, and both were put in because they fired on honest copy:
 *
 * - **Under three content words, nothing counts as a restatement.** A head like
 *   *Try again* or *For / against* reduces to one or two words, and every honest
 *   sentence about that control contains them.
 *
 *   **This floor let one real restatement through**, and a cross-family review
 *   found it by reading rather than by running anything: Mirror's jump card said
 *   *"Scrolls the paper to the passage this remark is about"* under the head *Go
 *   to this passage*, which reduces to the single content word *passage*
 *   (`go` and `to` and `this` are all stopwords). Lowering the floor was tried
 *   and **measured** before being rejected, 2026-09-02:
 *
 *   | floor | the old Mirror card | honest copy under *Try again* / *For / against* |
 *   |---|---|---|
 *   | 3 (today) | passes | passes |
 *   | 2 | **still** passes — its head is one word, not two | *Try again* now fails |
 *   | 1 | caught | both fail, **and so does the honest rewrite** that replaced it |
 *
 *   So there is no floor that catches this and keeps the honest cards: at 2 it
 *   is not caught at all, and at 1 the check fires on any card that uses the one
 *   noun its control is named after, which every truthful sentence about a
 *   *passage* button does. The card is asserted by hand instead — § the jump —
 *   which is what the review adjudicated: keep this as a copying floor and spend
 *   explicit assertions on the cards that matter.
 * - **The two have to be comparable in length.** A four-line paragraph that
 *   happens to use two of a three-word label's words is not saying the label
 *   again — Claims' *"Marks are off until you ask for them…"* under *Mark these
 *   passages in the paper* scores 0.67 on vocabulary alone and is plainly not a
 *   restatement. Restating means saying the same amount as well as the same
 *   words, so the shorter has to be at least two fifths of the longer.
 */
function restates(a: string, b: string): boolean {
  const [wa, wb] = [words(a), words(b)];
  const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa];
  const uniq = new Set(shorter);
  if (uniq.size < 3) return false;
  if (longer.join(" ").includes(shorter.join(" "))) return true;
  if (longer.length === 0 || shorter.length / longer.length < 0.4) return false;
  const inLonger = new Set(longer);
  let shared = 0;
  for (const w of uniq) if (inLonger.has(w)) shared++;
  return shared / uniq.size > 0.6;
}

/** Why this card does not earn its hover, or `null` if it does. */
function earnsItsHover(card: Card): string | null {
  if (card.what === "") return "the card has no first paragraph";
  if (card.how === "") return "the card has no second paragraph, which is ControlTip's whole rule";
  if (card.body.length <= 80) return "the card is a label, not an explanation";
  if (restates(card.how, card.what)) return "the second paragraph is the first one again";
  if (restates(card.how, card.head)) return "the second paragraph is the label again";
  if (restates(card.what, card.head)) return "the first paragraph is the label again";
  return null;
}

/** The assertion, so every call site reads the same and reports the same. */
function expectEarnsItsHover(card: Card, control: string): void {
  expect(earnsItsHover(card), `${control}'s card does not earn its hover`).toBeNull();
}

/* ----------------------------------------------------- the sub-mode chips -- */

/**
 * The four chips at the top of the mode, which were the only radiogroup in the
 * app carrying nothing at all — four one-word labels over four sub-modes that do
 * unrelated things, one of which spends money and one of which is never given
 * the paper.
 *
 * `RefereeViews` rather than `RefereeBand`, for tests/arrows-belong-to-the-article.test.tsx's
 * reason: the band owns `?referee=` and this component is a pure function of two
 * props.
 */
describe("the four sub-mode chips say what their sub-mode is", () => {
  function paint(view: RefereeView = "criteria"): void {
    act(() => {
      root.render(createElement(RefereeViews, { slug: "a-piece", view, onView: () => {} }));
    });
  }

  it("puts a card on every chip, and each card is that chip's", { timeout: 20000 }, async () => {
    paint();
    const chips = [...host.querySelectorAll('.ref-views [role="radio"]')];
    expect(chips.length, "the chip row is not drawn").toBe(4);

    /* Collected, so the last assertion can prove the four are four different
       cards. One shared card wired onto all of them would satisfy every
       per-chip check below — the head would be wrong, but only if the head is
       read from the chip, which is why it is. */
    const bodies: string[] = [];
    for (const chip of chips) {
      const label = flat(chip.textContent);
      const card = await cardFor(chip);
      expect(card.head, `the open card is not ${label}'s`).toBe(label);
      expectEarnsItsHover(card, label);
      expect(chip.hasAttribute("title"), `${label} fell back to a title attribute`).toBe(false);
      bodies.push(card.body);
    }
    expect(new Set(bodies).size, "two chips are showing the same card").toBe(4);
  });
});

/* ---------------------------------------------------------------- Criteria -- */

describe("the criteria form explains its controls before they are pressed", () => {
  function paint(): void {
    act(() => {
      root.render(
        createElement(
          NuqsAdapter,
          null,
          createElement(CriteriaBand, {
            slug: SLUG,
            blocks: BLOCKS,
            comments: [],
            onJump: () => {},
            onFound: () => {},
            openKey: null,
            onOpenKey: () => {},
          }),
        ),
      );
    });
  }

  const kindChips = () => [...host.querySelectorAll(".crit-kind-btn")];

  /**
   * **The chips a referee has not pressed are the ones with nothing to read.**
   * `KIND_NOTE` is printed under the row, but only ever for the kind that is
   * *selected* — so before this stage two of the three kinds explained
   * themselves nowhere, and choosing between them meant pressing each and
   * reading what changed.
   *
   * The expectation is taken from the panel's own visible paragraph rather than
   * typed out here, which is deliberate and is not the same as reading the
   * constant: what it pins is that the sentence on the card and the sentence
   * under the row are **one string**. Replace `what={KIND_NOTE[k]}` with a
   * freshly written sentence — the failure this is aimed at, since a second copy
   * of a sentence is a second place for it to go stale — and this reddens.
   */
  it("puts each kind's own note on that kind's chip", { timeout: 20000 }, async () => {
    paint();
    await flush();
    const chips = kindChips();
    expect(chips.length, "the kind chips are not drawn").toBe(3);

    for (const chip of chips) {
      const label = flat(chip.textContent);
      /* Select it, so the visible note below the row is this kind's. */
      act(() => {
        (chip as HTMLElement).click();
      });
      const note = flat(host.querySelector(".crit-kind-note")?.textContent);
      expect(note.length, `${label} prints no note when it is selected`).toBeGreaterThan(40);

      const card = await cardFor(chip);
      expect(card.head, `the open card is not ${label}'s`).toBe(label);
      expect(flat(card.body).startsWith(note), `${label}'s card is not showing KIND_NOTE`).toBe(
        true,
      );
      /* And the card says something the row does not: the second paragraph is
         the cost or the refusal, which is `ControlTip`'s whole rule. */
      expect(
        flat(card.body).length,
        `${label}'s card adds nothing to the note already on screen`,
      ).toBeGreaterThan(note.length + 40);
    }
  });

  /**
   * **The card on *Try again* was never rendered by this file**, because every
   * test above paints an empty band and *Try again* only exists on a criterion
   * that failed. A cross-family review found its first paragraph saying the
   * `aria-label` back — *"Runs this criterion over the paper a second time"*
   * under a button named *Run this criterion again* — and nothing here could
   * have known.
   */
  it("explains what trying again costs, on the row that failed", { timeout: 20000 }, async () => {
    answer = () =>
      Promise.resolve(
        json({
          criteria: [
            {
              id: "spya-crt2aa",
              criterion: "Are the controls adequate for the comparisons being drawn?",
              config: { kind: "single" },
              createdAt: "2026-09-01T09:00:00.000Z",
              status: "error",
              error: "The AI service sent back something this app could not read at all.",
              results: [],
            },
          ],
        }),
      );
    paint();
    await flush();
    const retry = host.querySelector(".crit-retry");
    expect(retry, "the failed row draws no Try again").not.toBeNull();
    const card = await cardFor(retry as Element);
    expect(card.head).toBe("Try again");
    expectEarnsItsHover(card, "Try again");
    /* The cost is the whole reason the card is there: a retry is the same call
       as the first one, not a cheap resume. */
    expect(card.how.toLowerCase(), "the card no longer says what a retry costs").toMatch(
      /full price|model call/,
    );
  });

  /**
   * **"Two ends" → "For / against", 2026-09-02.** Ours was not a referee's
   * vocabulary: it named the shape of the data rather than the question, and it
   * said nothing about what the two fields that appear underneath are for. The
   * literal is spelled out here for the reason this file's header gives — a
   * check that read `KIND_LABEL` would pass over the wording it exists to
   * remove.
   */
  it("calls the two-ended kind For / against, in the referee's words", async () => {
    paint();
    await flush();
    const labels = kindChips().map((c) => flat(c.textContent));
    expect(labels).toContain("For / against");
    expect(labels, "the old wording is back").not.toContain("Two ends");
  });

  /**
   * The preset chips **overwrite the whole form** — the text, the kind and both
   * poles — and nothing on screen says so, which is a real loss for a referee
   * halfway through writing their own criterion. And *Run this criterion* is a
   * model call over the whole paper, which is the other thing a label of four
   * words cannot carry.
   */
  it("puts a card on every preset and on the run button", { timeout: 20000 }, async () => {
    paint();
    await flush();
    const presets = [...host.querySelectorAll(".crit-preset")];
    expect(presets.length, "the presets are not drawn").toBeGreaterThan(3);

    for (const preset of presets.slice(0, 2)) {
      const label = flat(preset.textContent);
      const card = await cardFor(preset);
      expect(card.head, `the open card is not ${label}'s`).toBe(label);
      expectEarnsItsHover(card, label);
      expect(preset.hasAttribute("title"), `${label} fell back to a title`).toBe(false);
    }

    const run = host.querySelector(".crit-run");
    expect(run, "the run button is not drawn").not.toBeNull();
    const card = await cardFor(run as Element);
    expect(card.head).toBe("Run this criterion");
    expectEarnsItsHover(card, "Run this criterion");
  });
});

/* ------------------------------------------------------------------ Mirror -- */

function comment(id: string, over: Partial<MirrorInput["comments"][number]> = {}) {
  return {
    id,
    blockId: BLOCK as string,
    quote: "the controls were matched",
    body: "This is weak.",
    passage: "In the second study the controls were matched on age alone.",
    ...over,
  };
}

const REMARKS: MirrorRemark[] = [
  {
    kind: "specificity",
    trialTested: true,
    commentId: "spya-cmt2aa",
    blockId: BLOCK,
    note: "An author cannot tell from this which part of the design you mean.",
  },
  {
    kind: "coverage",
    trialTested: false,
    criterion: "Are the controls adequate?",
    note: "None of your comments so far takes this criterion up.",
  },
];

function mirrorApi(): MirrorApi {
  const result: MirrorResult = {
    remarks: REMARKS,
    input: {
      comments: [comment("spya-cmt2aa"), comment("spya-cmt2bb", { blockId: OTHER })],
      placements: [],
      skippedBookmarks: 0,
      badValence: 0,
      skippedOrphans: 0,
      skippedTagged: 0,
      truncated: 0,
      clippedBodies: 0,
      clippedCriteria: 0,
      criteriaOmitted: 0,
    },
    coverage: { asked: true, criteriaOmitted: 0 },
    placementsOmitted: 0,
    model: "a-model",
  };
  return { status: "done", writing: false, result, error: null, ask: () => {} };
}

describe("Mirror's rows say what they mean by evidence, and where they go", () => {
  function paint(): void {
    act(() => {
      root.render(createElement(MirrorView, { api: mirrorApi(), onJump: () => {} }));
    });
  }

  /**
   * **"Tested in a trial" → "A kind tested in a trial", 2026-09-02**, and the
   * negative with it. Beside one remark the old wording read as a claim that
   * *this remark* had been checked and had held, which it never meant: what the
   * ICLR 2025 trial tested is the **category**, and whether any one remark is
   * right is untested and untestable. The noun moves into the label because a
   * badge is read and a footnote under the list is not.
   *
   * Literals, for this file's stated reason. `tests/referee-mirror-panel.test.tsx`
   * checks the *distinction* — three say tested, two say not tested — with
   * substrings, and would stay green through this regression, because both old
   * labels contain both substrings.
   */
  it("says a kind was tested, not that this remark was", () => {
    paint();
    const badges = [...host.querySelectorAll("[data-trial-tested]")].map((b) =>
      flat(b.textContent),
    );
    expect(badges).toContain("A kind tested in a trial");
    expect(badges).toContain("A kind not tested in a trial");
    expect(badges, "the old wording is back").not.toContain("Tested in a trial");
    expect(badges, "the old wording is back").not.toContain("Not tested in a trial");
  });

  /**
   * **The badge's card was deleted on 2026-09-02, and this is the check that it
   * stays deleted.**
   *
   * It had two paragraphs. The first restated the badge — *"A randomised trial
   * tested feedback of this shape"* under a label reading *A kind tested in a
   * trial* — and the second was `EVIDENCE_NOTE`, which this panel prints in full,
   * visibly, under this very list. A cross-family review called it a third copy
   * that only a mouse can reach, and it was right.
   *
   * So what is asserted is the pair: **no card on the badge, and the note
   * visible**. Either half alone is the wrong answer — put the card back and it
   * is a duplicate again; delete the footnote and two words on a row are all the
   * referee gets. Not a `title` either, which is the other way an explanation
   * hides.
   */
  it("explains the badge in visible words under the list, not in a card", async () => {
    paint();
    const badge = host.querySelector("[data-trial-tested]");
    expect(badge, "no evidence badge is drawn").not.toBeNull();
    expect((badge as Element).hasAttribute("title"), "the badge grew a title attribute").toBe(false);

    /* Hovering it must open nothing at all. The card, if it came back, would be
       portalled to `<body>` rather than into `host`, so it is looked for in the
       document — tests/diagram-panel-hover.test.tsx. */
    (badge as Element).dispatchEvent(new MouseEvent("mouseenter"));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 400));
    });
    expect(
      document.querySelectorAll('[role="tooltip"]'),
      "the badge opened a card, which is the duplicate that was removed",
    ).toHaveLength(0);

    const note = flat(host.querySelector(".mir-evidence-note")?.textContent);
    expect(note, "the visible evidence note has gone, and nothing replaced it").toContain(
      "randomised trial",
    );
    expect(note, "the note no longer says the trial is about the kind, not the remark").toContain(
      "not about how likely any one remark is to be right",
    );
  });

  /**
   * **The jump was a `title` attribute until 2026-09-02.** That is precisely the
   * anti-pattern src/web/Tooltip.tsx's docstring argues against — about a
   * second's wait, unstyleable, truncated, and **absent altogether on a touch
   * device**. What this pins is the removal as well as the card, because a
   * `title` creeping back is invisible on a laptop: it still shows something.
   *
   * **And its first paragraph is asserted by hand**, which the generic check
   * cannot do here. Until 2026-09-02 that paragraph was *"Scrolls the paper to
   * the passage this remark is about"* under the head *Go to this passage* —
   * the heading again, in the one card a review picked out as worth an explicit
   * assertion. `restates` skips it because the head reduces to a single content
   * word (*passage*), and § `restates` says what was measured about lowering
   * that floor and why it is not lowered. So the fact the card now carries is
   * pinned instead: **provenance** — the passage is where the referee anchored
   * their own comment, not something Mirror picked out of a paper it is never
   * given.
   */
  it("explains the jump in a card rather than in a title attribute", { timeout: 20000 }, async () => {
    paint();
    const jump = host.querySelector(".mir-jump");
    expect(jump, "no jump button is drawn").not.toBeNull();
    expect((jump as Element).hasAttribute("title"), "the title attribute is back").toBe(false);
    const card = await cardFor(jump as Element);
    expect(card.head).toBe("Go to this passage");
    expectEarnsItsHover(card, "the jump");

    const what = card.what.toLowerCase();
    expect(
      what,
      "the first paragraph no longer says the passage is where the referee's own comment sits",
    ).toMatch(/(you anchored|your (own )?comment)/);
    expect(
      what,
      "the first paragraph no longer says Mirror did not choose the passage",
    ).toMatch(/never the passage|not the passage|did not (choose|pick)/);
    /* The restatement it replaced, refused by name. A rewrite that says the
       provenance and then adds the heading back would pass both checks above. */
    expect(what, "the card has gone back to restating its own heading").not.toMatch(
      /scrolls the paper/,
    );
  });

  /**
   * **The one row in the mode that is not a door into the prose.** Rule 2 says
   * every row is, so the coverage row reads as broken: the referee presses it,
   * nothing happens, and nothing says why. A missing control cannot carry a
   * card, so the card sits on the words standing in its place.
   */
  it("says why the coverage row has nowhere to send you", { timeout: 20000 }, async () => {
    paint();
    const row = host.querySelector('[data-kind="coverage"]');
    expect(row, "no coverage row is drawn").not.toBeNull();
    expect(
      (row as Element).querySelector(".mir-jump"),
      "the coverage row has grown a jump, which it must not have",
    ).toBeNull();
    const criterion = (row as Element).querySelector(".mir-criterion");
    expect(criterion, "the coverage row prints no criterion").not.toBeNull();
    const card = await cardFor(criterion as Element);
    expectEarnsItsHover(card, "the coverage row");
  });
});

/* --------------------------------------------------- Claims, and its two cards -- */

/**
 * **Claims was never imported into this file**, which a cross-family review
 * found on 2026-09-02: deleting either of its cards left the whole suite green.
 * `ClaimsView` is a pure function of its props — tests/referee-claims-panel.test.tsx
 * — so it needs no router and no hook.
 */
describe("Claims says what its two controls do", () => {
  const CLAIM_BLOCK = "spya-anc234" as BlockId;
  const claim: Claim = {
    id: `${CLAIM_BLOCK}:8`,
    blockId: CLAIM_BLOCK,
    quote: "the method halves annotation time",
    start: 8,
    claim: "The method halves annotation time",
    passages: [
      { blockId: BLOCK, quote: "fell by about half", start: 0, reasoning: "the timing" },
    ],
    discarded: 0,
  };

  function paint(claims: Claim[], run: ClaimsApi["run"]): void {
    act(() => {
      root.render(
        createElement(ClaimsView, {
          api: { run, stale: false, loaded: true, loadFailed: false, pull: () => {}, error: null },
          claims,
          slots: new Map(claims.map((c, i) => [c.id, i])),
          showing: [],
          onToggle: () => {},
          onJump: () => {},
        }),
      );
    });
  }

  const DONE: ClaimsApi["run"] = {
    status: "done",
    createdAt: "2026-09-01T00:00:00.000Z",
    claims: [claim],
  };

  /**
   * **The card that said the label back.** Its first paragraph was *"Draws this
   * claim's passages in the article, in this row's colour…"*, on a box labelled
   * *Mark these passages in the paper*. Rewritten so the first line says what
   * the passages **are** — the model's pick, not a verified linkage — which is
   * the thing the label cannot carry and the referee most needs.
   */
  it("puts a card on the tick that says more than the tick does", { timeout: 20000 }, async () => {
    paint([claim], DONE);
    const tick = host.querySelector(".clm-tick");
    expect(tick, "the mark checkbox is not drawn").not.toBeNull();
    const card = await cardFor(tick as Element);
    expect(card.head).toBe(flat((tick as Element).textContent));
    expectEarnsItsHover(card, "Claims' tick");
    /* The refusal is the point of the card: the model asserts linkage, the
       referee decides adequacy. src/web/ClaimsPanel.tsx § the three rules. */
    expect(card.body.toLowerCase(), "the card no longer says whose call it is").toContain("your call");
  });

  /**
   * **The one button on this panel that spends money.** Its label says neither
   * the cost nor what it is going to read, so the card has to.
   */
  it("puts a card on the button that spends money", { timeout: 20000 }, async () => {
    paint([], null);
    const pull = host.querySelector(".clm-run");
    expect(pull, "the pull button is not drawn").not.toBeNull();
    const card = await cardFor(pull as Element);
    expectEarnsItsHover(card, "Claims' pull");
    expect((pull as Element).hasAttribute("title"), "it fell back to a title").toBe(false);
  });
});

/* ------------------------------------------- Candidates, and the money press -- */

/**
 * **Candidates was never imported here either.** The start card is the one card
 * in the mode attached to a press that reaches a **third party the band's
 * confidentiality notice does not cover**, so it is the last one that should
 * have been untested.
 *
 * What this file checks is the card. What the *words* on the button and the note
 * say is tests/referee-candidates-press.test.tsx's, because that is where the
 * press itself is held.
 */
describe("Candidates explains the press before it is pressed", () => {
  function paint(): void {
    act(() => {
      root.render(
        createElement(CandidatesPanel, {
          thread: null,
          loaded: true,
          loadFailed: false,
          blocks: BLOCKS,
          error: null,
          onAsk: () => {},
          onStop: () => {},
          onStart: () => {},
          onJump: () => {},
        }),
      );
    });
  }

  it("puts a card on the start button", { timeout: 20000 }, async () => {
    paint();
    const start = host.querySelector(".cnd-start-btn");
    expect(start, "the start button is not drawn").not.toBeNull();
    const card = await cardFor(start as Element);
    expect(card.head, "the open card is not the start button's").toBe(
      flat((start as Element).textContent),
    );
    expectEarnsItsHover(card, "Candidates' start");
    /* The two facts that are the whole reason this card exists: the search
       engine is a different third party, and nothing has run yet. */
    const body = card.body.toLowerCase();
    expect(body, "the card no longer names the search engine").toContain("search engine");
    expect(body, "the card no longer says the money has not been spent yet").toContain(
      "until you press it",
    );
  });

  /**
   * **No count in the card, for the reason the button carries.** Web search is
   * offered on every round and the model decides, so it may run zero times; and
   * a tool round is a fresh provider request, so a turn may be several. A card
   * that says "one" is a disclosure that is wrong in both directions.
   */
  it("does not promise a number of calls it cannot know", { timeout: 20000 }, async () => {
    paint();
    const card = await cardFor(host.querySelector(".cnd-start-btn") as Element);
    const body = card.body.toLowerCase();
    expect(body, "the false one-call promise is back").not.toContain("one model call");
    /* And the search is offered as a possibility rather than a certainty, which
       is the other half of what was wrong: it may run zero times. */
    expect(body, "the search is promised rather than allowed for").toMatch(/may run a web search/);
  });
});

/* ------------------------------------------------- PlaceOnCriterion's picker -- */

/**
 * **The highest-value "how" sentence in the mode, and it was untested.**
 * Switching criterion silently discards the position the referee just pressed —
 * the five positions are worded in one criterion's own ends, so the same press
 * means something else under another one — and nothing visible says so.
 *
 * `NuqsAdapter` because this component reads `?refscale=` itself, and the
 * mocked `apiFetch` above answers its `useCriteria` fetch.
 */
describe("placing a comment on a criterion says what switching costs", () => {
  const DIVERGING = {
    id: "spya-crt2aa",
    criterion: "Are the statistical claims supported by the evidence?",
    config: {
      kind: "diverging",
      poles: { against: "unsupported", favour: "well supported" },
      scale: "rg",
    },
    createdAt: "2026-09-01T09:00:00.000Z",
    status: "done",
    results: [],
  };

  it("puts a card on the criterion picker", { timeout: 20000 }, async () => {
    answer = () => Promise.resolve(json({ criteria: [DIVERGING] }));
    act(() => {
      root.render(
        createElement(
          NuqsAdapter,
          null,
          createElement(PlaceOnCriterion, {
            slug: SLUG,
            value: { criterionId: null, valence: null },
            onChange: () => {},
          }),
        ),
      );
    });
    await flush();
    const pick = host.querySelector(".place-pick");
    expect(pick, "the criterion picker is not drawn").not.toBeNull();
    const card = await cardFor(pick as Element);
    expectEarnsItsHover(card, "the criterion picker");
    expect(
      card.how.toLowerCase(),
      "the card no longer says that switching throws the position away",
    ).toContain("clears the position");
  });
});
