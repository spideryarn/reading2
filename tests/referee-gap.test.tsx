// @vitest-environment jsdom
/**
 * **The gap between the referee's judgement and the model's, on screen** —
 * Stage 3 of docs/plans/260901i-the-referee-places-the-passage-themselves.md.
 *
 * Stages 1 and 2 built a placement a referee could make and a database that
 * kept it, and nothing anywhere read it back. This file is the check that the
 * reading-back happens, and it is deliberately the shape the two stages before
 * it did not have: not "the write left the building" but "the two judgements
 * are both on the screen, in the referee's order, and no third number was
 * invented between them."
 *
 * ## Two valences, never one
 *
 * `valenceGap` (src/referee-criteria.ts) says it at length: *"they are never
 * averaged, reconciled or shown as one number … averaging them, or letting one
 * overwrite the other, deletes exactly the thing worth looking at."* That is a
 * property of a DOM subtree, so it is asserted as one — every digit inside the
 * gap line is collected and compared against the two numbers that went in.
 * An average, a difference or a rounded midpoint all fail it, and none of them
 * would fail a test that only looked for the strings it expected to find.
 *
 * That assertion is over the *row* rather than over the gap line, and the
 * difference is the point: the line was the wrong boundary, because the
 * disagreement sentence sits one element outside it and is exactly where
 * somebody would put a distance.
 *
 * ## What is *not* here, on purpose
 *
 * The independence tripwire — *no model valence inside the referee's own
 * instrument* — lives in tests/referee-anchoring.test.tsx, which mounts this
 * band and the placement dialog together, because that is the arrangement the
 * claim is about and neither file alone can see it. This stage is the first
 * time the model's number and the referee's are drawn together, so that
 * tripwire is the one that had to stay green through it; it is not copied here,
 * because a second copy of an assertion is a second thing to keep in step.
 *
 * Harness: tests/referee-criteria-panel.test.tsx's, which mounts the real
 * `CriteriaBand` over a stubbed `apiFetch` inside a `NuqsAdapter` because
 * `CriteriaView` and `CriterionResult` are not exported. Driving the band is
 * the stronger version anyway — a component handed its props by hand cannot see
 * the wiring that should have supplied them.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RefereePoles } from "../src/referee-criteria.js";
import type { SavedCriterion } from "../src/saved-criteria.js";
import type { Block, BlockId, Comment } from "../src/types.js";

/** One reply, decided by the test that is running. */
let answer: (url: string, init: RequestInit) => Promise<Response>;

/**
 * `apiFetch` and `fetchOk`, and both are needed: `fetchOk` calls `apiFetch`
 * through the module's own binding, so replacing only the export would leave
 * every DELETE and PATCH in `useCriteria` going to the real one.
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

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`. */
const FOUND = "spya-k3m9qt" as BlockId;
const MISSED = "spya-m4p7rs" as BlockId;
const SLUG = "a-paper";
const CRIT = "spya-crt2aa";
const OTHER_CRIT = "spya-crt2bb";

/**
 * The plan's own example poles, so the assertions read as the plan's own
 * sentence: *"You: leans underpowered · −50 — Model: counts against —
 * underpowered — −64"*. Neither pole is the word "good" or "bad", and the two
 * are far enough apart that a swap could not be mistaken for a wording change.
 */
const POLES: RefereePoles = { against: "underpowered", favour: "well powered" };

const BLOCKS: Block[] = [
  {
    id: FOUND,
    tag: "p",
    kind: "text",
    text: "Thirty-one participants in each arm, with no unexposed comparison group.",
    words: 11,
    html: "<p>Thirty-one participants in each arm, with no unexposed comparison group.</p>",
    gistable: true,
  },
  {
    id: MISSED,
    tag: "p",
    kind: "text",
    text: "The effect held in a post-hoc subgroup of eleven.",
    words: 9,
    html: "<p>The effect held in a post-hoc subgroup of eleven.</p>",
    gistable: true,
  },
];

/** A criterion with two ends and whatever model results the test wants. */
function criterion(
  results: { blockId: BlockId; valence: number }[],
  over: Partial<SavedCriterion> = {},
): SavedCriterion {
  return {
    id: CRIT,
    criterion: "Is the study adequately powered for the comparisons it draws?",
    config: { kind: "diverging", poles: POLES, scale: "rg" },
    createdAt: "2026-09-01T09:00:00.000Z",
    status: "done",
    results: results.map((r, i) => ({
      kind: "diverging" as const,
      blockId: r.blockId,
      /* Lettered rather than numbered, and that is load-bearing: "invents no
         third number anywhere on the row" collects every digit-run in the row
         and compares the set against the numbers that went in, so a quote
         carrying a `0` would be a fourth number the assertion had to allow —
         and every number it allows is a number a bug may hide behind. */
      quote: `model passage ${String.fromCharCode(97 + i)}`,
      confidence: 80,
      reasoning: "why it bears on the criterion",
      valence: r.valence,
    })),
    ...over,
  };
}

/** One of the referee's own comments, placed or not. */
function comment(over: Partial<Comment> & { blockId: BlockId }): Comment {
  return {
    id: `spya-cmt${over.blockId.slice(-3)}`,
    quote: "the referee's own words about this passage",
    start: 0,
    createdAt: "2026-09-01T10:00:00.000Z",
    status: "none",
    ...over,
  };
}

/* ------------------------------------------------------------ the harness -- */

let host: HTMLDivElement;
let root: Root;

function mount(comments: Comment[]): void {
  act(() => {
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(CriteriaBand, {
          slug: SLUG,
          blocks: BLOCKS,
          comments,
          onJump: () => {},
          onFound: () => {},
          /* This file is about the two judgements on a row, never about the
             prose, so no passage is open and nothing here opens one. */
          openKey: null,
          onOpenKey: () => {},
        }),
      ),
    );
  });
}

/** Load one criterion off the GET, with the referee's comments beside it. */
async function paint(
  results: { blockId: BlockId; valence: number }[],
  comments: Comment[],
  over: Partial<SavedCriterion> = {},
): Promise<void> {
  answer = () =>
    Promise.resolve(json({ criteria: [criterion(results, over)], sourceHash: "h" }));
  mount(comments);
  await flush();
}

/** tests/use-search.test.ts § `flush` — the stream reader adds microtask hops. */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sse(frames: { event: string; data: unknown }[]): Uint8Array {
  return new TextEncoder().encode(
    frames.map((f) => `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`).join(""),
  );
}

/** A stream this test holds open and feeds a frame at a time. */
function heldStream() {
  let ctrl: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  return {
    response: new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    push(frames: { event: string; data: unknown }[]) {
      ctrl?.enqueue(sse(frames));
    },
    end() {
      ctrl?.close();
    },
  };
}

const flat = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

function gapLines(): HTMLElement[] {
  return [...host.querySelectorAll(".crit-gap")] as HTMLElement[];
}

function misses(): HTMLElement[] {
  return [...host.querySelectorAll(".crit-miss")] as HTMLElement[];
}

/**
 * The third home for a placement: a paragraph the model *did* answer on, where
 * block-level matching cannot say which passage is which. Its own class, not
 * `.crit-miss` with a modifier, so a placement that lands in the wrong list
 * cannot pass an assertion written about the right one.
 */
function unpaired(): HTMLElement[] {
  return [...host.querySelectorAll(".crit-unpaired-one")] as HTMLElement[];
}

function rows(): HTMLElement[] {
  return [...host.querySelectorAll(".crit-result")] as HTMLElement[];
}

/** How many times a sentence appears in the whole panel. */
function occurrences(needle: string): number {
  return flat(host.textContent).split(needle).length - 1;
}

function click(el: Element): void {
  act(() => {
    (el as HTMLElement).click();
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  answer = () => Promise.resolve(json({ criteria: [] }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

/* ------------------------------------------------------ both judgements -- */

describe("a passage both the referee and the model placed", () => {
  const placed = comment({ blockId: FOUND, criterionId: CRIT, valence: -50 });

  it("prints the referee's placement first and the model's second, both in words", async () => {
    await paint([{ blockId: FOUND, valence: -64 }], [placed]);

    const line = gapLines()[0];
    expect(line, "the row carries no referee line at all").toBeTruthy();
    const text = flat(line?.textContent);

    /* The whole sentence, in the plan's own order. Asserted as one string
       rather than as parts, because the order is the design: the referee's
       judgement is read before the model's, so the model's is not what they
       are reacting to. */
    expect(text).toContain("You: leans underpowered · −50");
    expect(text).toContain("Model: counts against — underpowered — −64");
    expect(text.indexOf("You:")).toBeLessThan(text.indexOf("Model:"));
  });

  it("invents no third number between them", async () => {
    await paint([{ blockId: FOUND, valence: -64 }], [placed]);

    const text = flat(gapLines()[0]?.textContent);
    /* Every digit-run in the line, in order. −57 (the mean), 14 (`valenceGap`)
       and 114 (the sum) all fail this, and so does any rounding of them —
       which a test that only looked for the two strings it expected would
       have passed. */
    expect(text.match(/\d+/g)).toEqual(["50", "64"]);
  });

  it("invents no third number anywhere on the row, including where they disagree", async () => {
    /* **The line is the wrong place to draw the boundary**, which is what the
       one above did and all it did. GPT Sol's mutation on 2026-09-01: put
       `Gap: {Math.abs(referee − model)}` in the *disagreement* paragraph — the
       obvious place somebody would put it, one element outside `.crit-gap` —
       and the assertion above stays green while the panel prints the single
       number the whole feature refuses.

       So this one takes the whole result row, and it needs the two judgements
       to point opposite ways, because the paragraph the mutation lands in is
       only drawn then.

       Distinct digit-runs rather than a list, because the row says the model's
       number three times over — once for the screen, once for a screen reader,
       once inside the gap line — and none of those repetitions is a new claim.
       A new *value* is. The three allowed here are the rank the model gave the
       passage, the referee's number and the model's; 114 (the distance), 7
       (the mean) and any rounding of either is a fourth. */
    await paint(
      [{ blockId: FOUND, valence: -64 }],
      [comment({ blockId: FOUND, criterionId: CRIT, valence: 50 })],
    );

    const row = rows()[0];
    expect(row, "there is no result row to look at").toBeTruthy();
    const text = flat(row?.textContent);
    expect(text, "the disagreement sentence is not on the row").toContain(
      "You and the model disagree here.",
    );
    expect([...new Set(text.match(/\d+/g) ?? [])].sort()).toEqual(["1", "50", "64"]);
  });

  it("says they disagree when the two point opposite ways", async () => {
    await paint(
      [{ blockId: FOUND, valence: -64 }],
      [comment({ blockId: FOUND, criterionId: CRIT, valence: 50 })],
    );

    expect(flat(host.textContent)).toContain("You and the model disagree here.");
  });

  it("says nothing of the sort when both point the same way", async () => {
    await paint([{ blockId: FOUND, valence: -64 }], [placed]);

    expect(flat(host.textContent)).not.toContain("disagree");
  });

  it("ignores a comment placed on a different criterion", async () => {
    await paint(
      [{ blockId: FOUND, valence: -64 }],
      [comment({ blockId: FOUND, criterionId: OTHER_CRIT, valence: 100 })],
    );

    expect(gapLines()).toHaveLength(0);
    expect(misses()).toHaveLength(0);
    expect(flat(host.textContent)).not.toContain("+100");
  });

  it("ignores an ordinary reading note on the same passage", async () => {
    /* A comment with no `criterionId` is a reading note, not a review comment —
       docs/project/comments.md § the referee's own placement. It is on the same
       block as the model's result, so a match on `blockId` alone would pull it
       in here and label the reader's bookmark as a judgement they never made.

       Two of them, and the second is the one that makes this test able to fail.
       A bare bookmark is excluded by either half of `placementsOn`'s filter, so
       on its own it proves neither half is there. The second carries a valence
       and no criterion — a state `comments_valence_needs_criterion` forbids in
       the database, and one this panel must still reject on its own, because
       "the database would have stopped it" is an assumption shared with the
       code and this repo has been bitten by exactly that. */
    await paint(
      [{ blockId: FOUND, valence: -64 }],
      [
        comment({ id: "spya-cmtaa2", blockId: FOUND }),
        comment({ id: "spya-cmtaa3", blockId: FOUND, valence: -100 }),
      ],
    );

    expect(gapLines()).toHaveLength(0);
    expect(misses()).toHaveLength(0);
    expect(flat(host.textContent)).not.toContain("−100");
  });
});

/* ------------------------------- more than one passage in one paragraph -- */

/**
 * **What block-level matching cannot decide, and must not pretend it can.**
 *
 * Matching is on `criterionId` + `blockId`, so a paragraph holding two model
 * results, or two of the referee's placements, has no answer to *which goes
 * with which*. Until 2026-09-01 the panel answered anyway: the first placement
 * on a block was handed to **every** model result on it, and every other
 * placement on that block fell under *"Yours, that the model did not turn up"*.
 * GPT Sol's finding 4 — one judgement drawn twice as though the referee had
 * made two, and a placement the model **did** answer on labelled a miss in
 * words.
 *
 * The old tests could not see either, because every fixture in this file had at
 * most one result and one placement per block. These are the fixtures that
 * distinguish the two behaviours, and the literal headings are written out here
 * rather than imported, so a heading that changes meaning has to be changed in
 * two places by somebody who reads both.
 */
describe("a paragraph the model answered on more than once", () => {
  it("draws the referee's judgement beside neither result rather than beside both", async () => {
    await paint(
      [
        { blockId: FOUND, valence: -64 },
        { blockId: FOUND, valence: -20 },
      ],
      [comment({ blockId: FOUND, criterionId: CRIT, valence: -50 })],
    );

    expect(rows(), "the model's two passages are both still listed").toHaveLength(2);
    /* Not "one gap line" — there is no way to tell which of the model's two
       passages the referee placed, so a line beside either one is a claim
       about the referee that nobody made. */
    expect(gapLines(), "one placement was drawn as though it matched a passage").toHaveLength(0);
    expect(
      occurrences("You: leans underpowered · −50"),
      "the referee's one judgement appears more than once",
    ).toBe(1);
  });

  it("says the model was here, rather than calling the placement a miss", async () => {
    await paint(
      [
        { blockId: FOUND, valence: -64 },
        { blockId: FOUND, valence: -20 },
      ],
      [comment({ blockId: FOUND, criterionId: CRIT, valence: -50 })],
    );

    expect(unpaired()).toHaveLength(1);
    expect(misses(), "an unmatched placement is not the same thing as a missed one").toHaveLength(0);
    const text = flat(host.textContent);
    expect(text).toContain("Yours, in a paragraph the model also answered on");
    expect(text, "the model turned this paragraph up; the heading says it did not").not.toContain(
      "did not turn up",
    );
  });

  it("does the same when the referee placed one paragraph twice", async () => {
    await paint(
      [{ blockId: FOUND, valence: -64 }],
      [
        comment({ id: "spya-cmtaa2", blockId: FOUND, criterionId: CRIT, valence: -50 }),
        comment({ id: "spya-cmtaa3", blockId: FOUND, criterionId: CRIT, valence: 100 }),
      ],
    );

    expect(gapLines(), "one of two placements was picked to stand for both").toHaveLength(0);
    expect(unpaired()).toHaveLength(2);
    expect(misses()).toHaveLength(0);
    const text = flat(host.textContent);
    expect(text).toContain("You: leans underpowered · −50");
    expect(text).toContain("You: clearly well powered · +100");
    expect(text).not.toContain("did not turn up");
  });

  it("keeps every placement on screen exactly once, wherever it belongs", async () => {
    /* One paragraph the model answered twice, one it answered once, one it
       never reached. Every placement has exactly one home, and no placement
       has two — which is the property the old code broke in both directions at
       once. */
    await paint(
      [
        { blockId: FOUND, valence: -64 },
        { blockId: FOUND, valence: -20 },
      ],
      [
        comment({ id: "spya-cmtaa2", blockId: FOUND, criterionId: CRIT, valence: -50 }),
        comment({ id: "spya-cmtaa3", blockId: MISSED, criterionId: CRIT, valence: 100 }),
      ],
    );

    expect(unpaired()).toHaveLength(1);
    expect(misses()).toHaveLength(1);
    expect(gapLines()).toHaveLength(0);
    expect(occurrences("You: leans underpowered · −50")).toBe(1);
    expect(occurrences("You: clearly well powered · +100")).toBe(1);
    const text = flat(host.textContent);
    expect(text).toContain("Yours, in a paragraph the model also answered on");
    expect(text).toContain("Yours, that the model did not turn up");
  });

  it("still pairs the paragraphs that hold one of each", async () => {
    /* The ambiguity is per paragraph, not per criterion: a row with one messy
       block must not lose the referee's line on a clean one. */
    await paint(
      [
        { blockId: FOUND, valence: -64 },
        { blockId: MISSED, valence: 30 },
        { blockId: MISSED, valence: 10 },
      ],
      [
        comment({ id: "spya-cmtaa2", blockId: FOUND, criterionId: CRIT, valence: -50 }),
        comment({ id: "spya-cmtaa3", blockId: MISSED, criterionId: CRIT, valence: 100 }),
      ],
    );

    expect(gapLines(), "the unambiguous paragraph lost its referee line").toHaveLength(1);
    expect(flat(gapLines()[0]?.textContent)).toContain("You: leans underpowered · −50");
    expect(unpaired()).toHaveLength(1);
    expect(misses()).toHaveLength(0);
  });
});

/* ------------------------------------------- what the model did not turn up -- */

describe("the referee's placements the model never returned", () => {
  it("lists them apart from the model's rows, and not among them", async () => {
    await paint(
      [{ blockId: FOUND, valence: -64 }],
      [comment({ blockId: MISSED, criterionId: CRIT, valence: -100 })],
    );

    expect(rows(), "the model's own result list grew a row it did not produce").toHaveLength(1);
    expect(misses()).toHaveLength(1);
    const miss = flat(misses()[0]?.textContent);
    expect(miss).toContain("clearly underpowered");
    expect(miss).toContain("−100");
    /* No model number anywhere in it — there is no model judgement here, which
       is the entire point of the sub-list. */
    expect(miss).not.toContain("64");
    expect(flat(host.textContent)).toContain("Yours, that the model did not turn up");
  });

  it("gives each one a jump into the passage, as the model's rows have", async () => {
    const jumped: BlockId[] = [];
    answer = () =>
      Promise.resolve(json({ criteria: [criterion([{ blockId: FOUND, valence: -64 }])] }));
    act(() => {
      root.render(
        createElement(
          NuqsAdapter,
          null,
          createElement(CriteriaBand, {
            slug: SLUG,
            blocks: BLOCKS,
            comments: [comment({ blockId: MISSED, criterionId: CRIT, valence: -100 })],
            onJump: (id: BlockId) => jumped.push(id),
            onFound: () => {},
            openKey: null,
            onOpenKey: () => {},
          }),
        ),
      );
    });
    await flush();

    const jump = misses()[0]?.querySelector("button");
    expect(jump, "a miss with no way into the prose is a dead end").toBeTruthy();
    if (jump) click(jump);
    expect(jumped).toEqual([MISSED]);
  });

  it("does not call them misses while the model has not answered", async () => {
    /* The referee may place passages before ever asking the model — the
       anchoring-friendly order, and it must not read as the model having
       looked and found nothing. */
    await paint([], [comment({ blockId: MISSED, criterionId: CRIT, valence: -100 })], {
      status: "pending",
    });

    expect(misses()).toHaveLength(1);
    const text = flat(host.textContent);
    expect(text).not.toContain("did not turn up");
    expect(text).toContain("Yours, and the model has not answered this criterion yet");
  });
});

/* ------------------------------------------------------------ across a run -- */

describe("the referee's own line is drawn from their comments, not from the run", () => {
  it("survives the row being replaced by a fresh answer", async () => {
    const placed = comment({ blockId: FOUND, criterionId: CRIT, valence: -50 });
    const held = heldStream();

    answer = (_url, init) =>
      Promise.resolve(
        init.method === "POST"
          ? held.response
          : json({ criteria: [criterion([], { status: "error", error: "The model timed out." })] }),
      );
    mount([placed]);
    await flush();

    // Nothing run yet: the placement is the referee's alone.
    expect(gapLines()).toHaveLength(0);
    expect(misses()).toHaveLength(1);

    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again");
    expect(retry, "an errored row offers no way to run it again").toBeTruthy();
    if (retry) click(retry);
    await flush();

    held.push([{ event: "begin", data: criterion([], { status: "pending" }) }]);
    await flush();
    expect(gapLines(), "a running criterion is not an answer").toHaveLength(0);
    expect(misses()).toHaveLength(1);

    held.push([
      {
        event: "result",
        data: {
          result: {
            kind: "diverging",
            blockId: FOUND,
            quote: "model passage 0",
            confidence: 80,
            reasoning: "why it bears on the criterion",
            valence: -64,
          },
        },
      },
    ]);
    await flush();
    expect(gapLines(), "the streamed result did not meet the referee's placement").toHaveLength(1);

    /* `put(done)` replaces the row wholesale — the authoritative pass is
       allowed to differ from what streamed. A referee's line held in row state
       would go with it, and the screen would quietly lose the judgement they
       made. */
    held.push([{ event: "done", data: criterion([{ blockId: FOUND, valence: -64 }]) }]);
    held.end();
    await flush();

    const text = flat(gapLines()[0]?.textContent);
    expect(text).toContain("You: leans underpowered · −50");
    expect(text).toContain("Model: counts against — underpowered — −64");
    expect(misses(), "the placement is answered now and is no longer the model's miss").toHaveLength(
      0,
    );
  });
});
