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

import type { MirrorInput, MirrorRemark, MirrorResult } from "../src/referee-mirror-types.js";
import type { RefereeView } from "../src/web/referee-views.js";
import type { Block, BlockId } from "../src/types.js";
import { ANSWER_OVERFLOWED } from "../src/messages.js";

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
type MirrorApi = import("../src/web/useMirror.js").MirrorApi;

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
async function cardFor(el: Element): Promise<{ head: string; body: string }> {
  el.dispatchEvent(new MouseEvent("mouseenter"));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 400));
  });
  const cards = document.querySelectorAll('[role="tooltip"]');
  expect(cards, "hovering this control opened no card, or more than one").toHaveLength(1);
  const card = cards[0];
  const head = card?.querySelector(".tip-soon-head")?.textContent ?? "";
  const body = (card?.textContent ?? "").slice(head.length);
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
  return { head, body };
}

/** More than the label the reader can already see, which is the whole point. */
const isDetailed = (body: string) => body.length > 80;

const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

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
      root.render(createElement(RefereeViews, { view, onView: () => {} }));
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
      expect(isDetailed(card.body), `${label}'s card is a label, not an explanation`).toBe(true);
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
      expect(isDetailed(card.body), `${label}'s card is a label, not an explanation`).toBe(true);
      expect(preset.hasAttribute("title"), `${label} fell back to a title`).toBe(false);
    }

    const run = host.querySelector(".crit-run");
    expect(run, "the run button is not drawn").not.toBeNull();
    const card = await cardFor(run as Element);
    expect(card.head).toBe("Run this criterion");
    expect(isDetailed(card.body)).toBe(true);
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

  it("puts the trial behind the badge, in a card", { timeout: 20000 }, async () => {
    paint();
    const badge = host.querySelector("[data-trial-tested]");
    expect(badge, "no evidence badge is drawn").not.toBeNull();
    const card = await cardFor(badge as Element);
    expect(card.head).toBe(flat((badge as Element).textContent));
    /* The footnote's own sentence, so the row and the note under the list cannot
       drift: `EVIDENCE_NOTE` is what the card's second paragraph is. */
    expect(card.body.toLowerCase(), "the card does not carry the evidence note").toContain(
      "randomised trial",
    );
  });

  /**
   * **The jump was a `title` attribute until 2026-09-02.** That is precisely the
   * anti-pattern src/web/Tooltip.tsx's docstring argues against — about a
   * second's wait, unstyleable, truncated, and **absent altogether on a touch
   * device**. What this pins is the removal as well as the card, because a
   * `title` creeping back is invisible on a laptop: it still shows something.
   */
  it("explains the jump in a card rather than in a title attribute", { timeout: 20000 }, async () => {
    paint();
    const jump = host.querySelector(".mir-jump");
    expect(jump, "no jump button is drawn").not.toBeNull();
    expect((jump as Element).hasAttribute("title"), "the title attribute is back").toBe(false);
    const card = await cardFor(jump as Element);
    expect(card.head).toBe("Go to this passage");
    expect(isDetailed(card.body)).toBe(true);
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
    expect(isDetailed(card.body)).toBe(true);
  });
});

/* ---------------------------------------------- an action Claims does not have -- */

/**
 * **A failure message may not name a lever the screen does not have.**
 *
 * `ANSWER_OVERFLOWED` said *"Asking for something narrower usually fits"*, flat,
 * and a browser pass hit it in **Claims**, which has no scoping control of any
 * kind — nor has Mirror, and a criterion's words are a saved row rather than a
 * box on that screen. All three land here because `parseHits` in src/search.ts
 * is search's parser and Referee mode's alike.
 *
 * Rule 3 of docs/project/copy.md is *say what to do next, when there is anything
 * to do*, and the fix is to condition the advice rather than delete it: the
 * retry is named first, because it is the lever every caller has and the `retry`
 * kind already draws the button, and the narrowing keeps its clause where there
 * is something to narrow.
 *
 * A value check rather than a source scan, which is the stronger of the two —
 * tests/referee-copy-is-about-the-model.test.ts makes the same call about
 * `ANSWER_UNUSABLE`.
 */
describe("what Referee says when an answer overflowed", () => {
  it("names the lever every screen has, and conditions the one only Search has", () => {
    const message = ANSWER_OVERFLOWED.message.toLowerCase();
    expect(message, "the retry is not offered, and it is the only lever Claims has").toMatch(
      /trying again/,
    );
    expect(
      message,
      "the narrowing advice is unconditional again, and Claims has nothing to narrow",
    ).not.toContain("asking for something narrower usually fits");
    /* If the sentence still mentions narrowing at all, it has to be conditioned
       on the reader having asked something — this is what tells the fix from a
       reword that put the same promise in different words. */
    if (message.includes("narrower")) {
      expect(message, "narrowing is promised without saying when it is available").toMatch(
        /where you|if you|when you/,
      );
    }
    expect(ANSWER_OVERFLOWED.message, "the code a reader quotes has gone").toMatch(
      /\[ai-overflowed\]$/,
    );
  });
});
