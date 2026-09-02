// @vitest-environment jsdom
/**
 * **What the referee can see at the moment they place a passage** — the
 * anchoring half of docs/plans/260901i-the-referee-places-the-passage-themselves.md,
 * checked over the panel and the instrument mounted *together*.
 *
 * ## Why this file exists, and what it replaces
 *
 * The plan settled one genuinely open question — *where does the referee place a
 * passage* — against a control beside each model result, because *"a control
 * that renders the model's judgement while soliciting the referee's is not
 * measuring the referee's judgement, it is measuring their willingness to copy a
 * number."*
 *
 * The check written for that at the bottom of tests/referee-placement.test.tsx
 * mounts `AnnotateDialog` **alone**. It is not quite nothing — the model's
 * results are in the data `useCriteria` fetches there, so a `PlaceOnCriterion`
 * that started printing `chosen.results[0].valence` would still trip it — but it
 * cannot speak to the claim in its own name. In the real reader the criteria
 * panel is mounted at the same time, a few hundred pixels away, printing every
 * number the dialog is careful not to. GPT Sol, reviewing the built code on
 * 2026-09-01. So this file mounts both, over one stubbed network, and asserts
 * what a referee can actually see while the instrument is in front of them.
 *
 * ## What it can prove, and what it cannot
 *
 * **It proves the instrument itself stays clean.** The panel beside it really
 * does print −87 and +93 — asserted first, so the fixture is live in the
 * strongest sense available: those numbers are on the screen, not merely in a
 * fetch reply — and the placement section prints no number at all. Every way of
 * leaking the model's judgement into the instrument that the old test could
 * catch, this one catches too, plus the ones it could not: a shared container, a
 * picker option that grew the criterion's answer, a summary line above the five
 * positions.
 *
 * **It cannot prove the judgement is independent, because it is not.** Both
 * halves are on one screen. A referee may read the model's −87 in the panel,
 * select the same passage, and place it; nothing records whether they did. There
 * is no sealed-envelope state and no stored first placement, so *"independent"*
 * currently means *"typed into a control that does not itself show the model's
 * number"* — a real and much weaker property. That is a gap in the product, not
 * something a test can close, and it is Greg's decision to make. **This file
 * asserts the weaker property and says so, rather than carrying a name that
 * claims the stronger one.** A test whose name overclaims is what put this file
 * here.
 *
 * The last test in the file pins the gap itself, so it is visible in an
 * executable place rather than only in this comment.
 *
 * Harness: the two above it — tests/referee-placement.test.tsx's stubbed
 * `apiFetch` over the real `useComments`, and tests/referee-gap.test.tsx's
 * `NuqsAdapter` for the band, which owns a URL parameter.
 */
import { act, createElement, Fragment } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SavedCriterion } from "../src/saved-criteria.js";
import type { Block, BlockId, Comment } from "../src/types.js";

let answer: (url: string, init: RequestInit) => Promise<Response>;

/**
 * `apiFetch` and `fetchOk` both, for tests/referee-placement.test.tsx's reason:
 * `fetchOk` calls `apiFetch` through the module's own binding, so replacing only
 * the export leaves every write reaching for a real Supabase session.
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
const { AnnotateDialog } = await import("../src/web/AnnotateDialog.js");
const { CommentDialog } = await import("../src/web/CommentDialog.js");
const { useComments } = await import("../src/web/useComments.js");

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`. */
const BLOCK = "spya-k3m9qt" as BlockId;
const SLUG = "a-paper";
const CRIT = "spya-crt2aa";

const POLES = { against: "underpowered", favour: "well powered" };

/**
 * **Loud, and deliberately not digit-shaped like anything else on screen.**
 * Neither is one of the five the instrument writes, neither is the referee's
 * −50, and neither is a rank. If any of them turns up inside the placement
 * section it came from the model.
 */
const MODEL_VALENCES = [-87, 93];

/** Everything else the model said, none of which belongs in the instrument. */
const MODEL_QUOTE = "thirty-one participants in each arm";
const MODEL_REASONING = "the sample size is small for the comparison drawn";

const DIVERGING: SavedCriterion = {
  id: CRIT,
  /* No digits anywhere in the criterion or its poles: the assertions below say
     the instrument prints *no number at all*, which is only a statement about
     the model's numbers if the referee's own words carry none. */
  criterion: "Is the study adequately powered for the comparisons it draws?",
  config: { kind: "diverging", poles: POLES, scale: "rg" },
  createdAt: "2026-09-01T09:00:00.000Z",
  status: "done",
  results: [
    {
      kind: "diverging",
      blockId: BLOCK,
      quote: MODEL_QUOTE,
      confidence: 80,
      reasoning: MODEL_REASONING,
      valence: MODEL_VALENCES[0] as number,
    },
    {
      kind: "diverging",
      blockId: "spya-m4p7rs" as BlockId,
      quote: "a pre-registered power analysis",
      confidence: 70,
      reasoning: "the analysis was planned",
      valence: MODEL_VALENCES[1] as number,
    },
  ],
};

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

const ANCHOR = { blockId: BLOCK, quote: MODEL_QUOTE, start: 0 } as const;

function storedComment(over: Partial<Comment> = {}): Comment {
  return {
    id: "spya-cmt2aa",
    blockId: BLOCK,
    quote: MODEL_QUOTE,
    start: 0,
    createdAt: "2026-09-01T10:00:00.000Z",
    status: "none",
    body: "the arms are too small for this",
    ...over,
  };
}

/* ------------------------------------------------------------ the network -- */

let stored: Comment[];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/* ------------------------------------------------------------- the screen -- */

let host: HTMLDivElement;
let root: Root;

/**
 * **The reader, in miniature: the panel and the dialog at once.**
 *
 * This is the whole point of the file. `App.tsx` mounts `CriteriaBand` in the
 * band and `AnnotateDialog` over the prose at the same time, so a test that
 * mounts either alone cannot say anything about what the other one is showing.
 */
function BothHarness({ dialog }: { dialog: "annotate" | "comment" }) {
  const comments = useComments(SLUG);
  const live = comments.comments[0];
  return createElement(
    NuqsAdapter,
    null,
    createElement(Fragment, null, [
      createElement(CriteriaBand, {
        key: "band",
        slug: SLUG,
        blocks: BLOCKS,
        comments: comments.comments,
        onJump: () => {},
        onFound: () => {},
        /* Nothing here presses a result row, so no passage is ever the open
           one. The prop pair exists because pressing a row now rings its exact
           phrase in the prose — App.tsx holds the key. */
        openKey: null,
        onOpenKey: () => {},
      }),
      dialog === "annotate"
        ? createElement(AnnotateDialog, {
            key: "dialog",
            anchor: ANCHOR,
            placing: true,
            onCancel: () => {},
            onSave: () => {},
          })
        : live
          ? createElement(CommentDialog, {
              key: "dialog",
              comment: live,
              placing: true,
              position: 1,
              total: 1,
              pending: 0,
              hasPrev: false,
              hasNext: false,
              onPrev: () => {},
              onNext: () => {},
              onClose: () => {},
              onDelete: () => {},
              onRetry: () => {},
              onDeepen: () => {},
              onDiscuss: () => {},
              onEdit: () => {},
              onPlace: () => {},
              error: comments.error,
            })
          : null,
    ]),
  );
}

async function show(dialog: "annotate" | "comment"): Promise<void> {
  await act(async () => {
    root.render(createElement(BothHarness, { dialog }));
  });
  /* The band's stream reader and the comments GET both add microtask hops —
     tests/referee-gap.test.tsx § `flush`. */
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** The criteria panel — the half of the screen that is allowed to show numbers. */
function panel(): string {
  return flat(host.querySelector(".crit")?.textContent);
}

/** The referee's own instrument, wherever it is mounted. */
function place(): HTMLElement {
  const section = host.querySelector<HTMLElement>(".place");
  if (!section) throw new Error("the placement section is not on screen");
  return section;
}

/** Choose a criterion in the picker, as a referee would. */
function pick(value: string): void {
  const select = place().querySelector<HTMLSelectElement>("select");
  if (!select) throw new Error("there is no criterion picker on screen");
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, "", `/read/${SLUG}`);
  stored = [];
  answer = (url) => {
    if (url.startsWith("/api/referee/criteria/")) {
      return Promise.resolve(json({ criteria: [DIVERGING], sourceHash: "abc" }));
    }
    return Promise.resolve(json({ comments: stored }));
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

/* --------------------------------------------------------------- the fixture -- */

describe("the model's numbers really are on the screen", () => {
  /**
   * **First, because everything else in this file is a "not".**
   *
   * A `not.toContain` over a fixture that never renders passes for the wrong
   * reason and goes on passing forever — the shape
   * docs/reusable/silent-success.md is about, and precisely how the test this
   * file replaces came to be theatre. So the panel is made to say the numbers
   * out loud before anything asks where they are not.
   */
  it("the panel prints both of the model's valences while the instrument is open", async () => {
    await show("annotate");

    const shown = panel();
    expect(shown, "the panel printed no model valence, so every 'not' below is vacuous").toContain(
      "−87",
    );
    expect(shown).toContain("+93");
    expect(shown).toContain(MODEL_QUOTE);
    expect(host.querySelector(".place"), "the instrument is not on screen beside it").not.toBeNull();
  });
});

/* ------------------------------------------- the instrument, while it is used -- */

describe("what the referee's own instrument shows them", () => {
  it("prints no number at all, before or after a criterion is chosen", async () => {
    await show("annotate");

    /* Before: the picker and the heading. After: the five positions in the
       criterion's own pole words. Neither has anything to count. */
    expect(flat(place().textContent).match(/\d/g)).toBeNull();
    pick(CRIT);
    expect(flat(place().textContent).match(/\d/g)).toBeNull();
  });

  it("carries none of the model's answer with it", async () => {
    await show("annotate");
    pick(CRIT);

    const text = flat(place().textContent);
    for (const valence of MODEL_VALENCES) {
      expect(text, `the model's ${valence} reached the referee's own instrument`).not.toContain(
        String(Math.abs(valence)),
      );
    }
    expect(text).not.toContain(MODEL_REASONING);
    expect(text).not.toContain("counts against");
    expect(text).not.toContain("counts for");
    /* The model's quote is also the passage the referee selected, so it is not
       evidence either way and is deliberately not asserted here. What is
       asserted is that the model's *second* passage — one the referee never
       selected — is nowhere in the instrument. */
    expect(text).not.toContain("pre-registered power analysis");
  });

  it("offers criteria by their own words and poles, and says nothing of their answers", async () => {
    await show("annotate");

    const options = [...place().querySelectorAll("option")].map((o) => flat(o.textContent));
    const forCriterion = options.find((o) => o.includes("adequately powered"));
    expect(forCriterion, "the criterion is not offered at all").toBeTruthy();
    expect(forCriterion).toContain(POLES.against);
    expect(forCriterion).toContain(POLES.favour);
    /* Not "how many passages it found", not "done", not a valence. A picker
       that ranked or annotated the criteria by what the model said about them
       would put the model's judgement inside the instrument by another door. */
    expect(forCriterion?.match(/\d/g)).toBeNull();
    expect(forCriterion).not.toContain("passage");
  });
});

/* ------------------------------------------------------------- the edit path -- */

describe("editing a placement that already exists", () => {
  /**
   * `CommentDialog` is the other door onto the same instrument, and it is the
   * one where a number is legitimately on screen — the referee's own, shown
   * because v1 keeps no history and an overwrite must not be silent. So the
   * assertion here is not "no digits" but "exactly one number, and it is
   * theirs".
   */
  it("shows the referee their own placement and none of the model's", async () => {
    stored = [storedComment({ criterionId: CRIT, valence: -50 })];
    await show("comment");

    const text = flat(place().textContent);
    expect(text, "the referee's own placement is not shown before they overwrite it").toContain(
      "−50",
    );
    expect([...new Set(text.match(/\d+/g) ?? [])]).toEqual(["50"]);
    expect(text).toContain("leans underpowered");
    expect(text).not.toContain(MODEL_REASONING);
  });

  it("keeps the model's numbers out of the dialog entirely, not merely out of the section", async () => {
    stored = [storedComment({ criterionId: CRIT, valence: -50 })];
    await show("comment");

    /* Wider than `.place`: the dialog is one surface, and a model valence
       printed in its header or beside the reader's own words would be the same
       anchoring problem one element out. */
    const dialog = flat(host.querySelector(".cmt-dialog")?.textContent);
    expect(dialog, "the dialog did not render").not.toBe("");
    for (const valence of MODEL_VALENCES) {
      expect(dialog).not.toContain(String(Math.abs(valence)));
    }
  });
});

/* ------------------------------------------------ what none of this can prove -- */

describe("the part that is not guarded, written down where it runs", () => {
  /**
   * **This test asserts a weakness on purpose.**
   *
   * The two judgements are on one screen at one time. Nothing sequences them,
   * nothing hides the model's until the referee has committed theirs, and
   * nothing records which came first — so a placement made after reading the
   * panel is stored identically to one made before, and the panel then prints
   * them side by side as two independent judgements.
   *
   * Sol's *"if I could make only one change"*: a sealed-envelope state, or stop
   * calling later placements independent. That is a product decision and it is
   * Greg's. Until it is made, this is the true description of the feature, and
   * it is here rather than only in a comment so that whoever builds the
   * envelope meets it: **when this goes red, the fix is to delete it and write
   * the test for the behaviour that replaced it** — not to relax it.
   */
  it("the model's judgement is readable at the same moment the referee makes theirs", async () => {
    await show("annotate");
    pick(CRIT);

    expect(panel()).toContain("−87");
    expect(host.querySelector(".place-scale"), "the five positions are not on screen").not.toBeNull();
  });
});
