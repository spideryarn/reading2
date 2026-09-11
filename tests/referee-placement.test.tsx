// @vitest-environment jsdom
/**
 * **The referee placing a passage themselves** — Stage 2 of
 * docs/plans/260901i-the-referee-places-the-passage-themselves.md.
 *
 * The mode's whole argument is that a referee who only ever *reads* the model's
 * valence has surrendered the judgement the mode exists to protect. So there
 * are two independent judgements, and this file is about the one a person
 * makes: the five-position instrument in `AnnotateDialog` and `CommentDialog`,
 * and what actually goes over the wire when it is pressed.
 *
 * ## Why these assert request bodies rather than callbacks
 *
 * A negative number reaching the server intact is the one thing this feature
 * exists for. `SearchHit.confidence` is a 0–100 match strength whose validator
 * clamps negatives to zero, so a placement routed through anything
 * confidence-shaped arrives as `0` — *"counts neither way"* — with nothing
 * erroring anywhere and the referee shown the opposite of what they said
 * (src/types.ts § `Comment.valence`). A test that checks "onSave was called"
 * cannot see that happen. So the harness below wires the real `useComments`
 * hook to the real dialog, exactly as `App.tsx` does, and reads the JSON that
 * left the building.
 *
 * ## The tripwire at the bottom
 *
 * The plan settled one genuinely open question — *where does the referee place
 * a passage* — against the obvious answer of a control beside each model
 * result, because *"a control that renders the model's judgement while
 * soliciting the referee's is not measuring the referee's judgement, it is
 * measuring their willingness to copy a number."* That is a property of a DOM
 * subtree, so it is checked as one: the criteria this fixture serves carry loud
 * model valences, and none of them may appear anywhere inside the placement
 * section. In the style of tests/referee-copy-is-about-the-model.test.ts, but
 * rendered rather than scanned — a source scan could not tell a number that is
 * fetched from one that is typed.
 *
 * Harness copied from tests/use-comments-load-state.test.ts: React's own `act`
 * and `createRoot`, no testing library, a stubbed `apiFetch`.
 */
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { SavedCriterion } from "../src/saved-criteria.js";
import type { Comment } from "../src/types.js";

/**
 * `apiFetch` and `fetchOk`, and both are needed.
 *
 * `fetchOk` calls `apiFetch` through the module's own binding, so replacing
 * only the export leaves every write in `useComments` going to the real one —
 * which reaches for a Supabase session before it makes a request. `readJson`
 * and `failure` are deliberately the real ones: they are the code that decides
 * whether a reply is an answer or a failure, and stubbing them would leave the
 * hook under test being driven by the stub.
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

const { AnnotateDialog } = await import("../src/web/AnnotateDialog.js");
const { CommentDialog } = await import("../src/web/CommentDialog.js");
const { useComments } = await import("../src/web/useComments.js");
const { PLACEMENT_STEPS, placementLabel } = await import("../src/web/PlaceOnCriterion.js");

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`, so a plausible-looking
   `spya-aaa111` is not one of ours. docs/project/block-ids.md § the alphabet. */
const BLOCK = "spya-k3m9qt";
const SLUG = "a-paper";

const POLES = { against: "underpowered", favour: "well powered" };

/**
 * **The five positions, written out by hand in `POLES`' own words.**
 *
 * A second copy of a production table, on purpose, and the one place in this
 * file where that is right. `PLACEMENT_STEPS` is exported and the obvious thing
 * is to loop over it — which this file did, and it meant every case took both
 * its click and its expected number from the table it was checking, so changing
 * the production −50 to −40 moved the assertion with it and the suite stayed
 * green. An expectation the code under test can edit is not an expectation.
 *
 * So the numbers below are asserted against nothing but this file, and
 * *"draws exactly the five positions written out below"* is what stops a sixth
 * position slipping past a table that has never heard of it. Both properties,
 * and they were never in conflict. GPT Sol, reviewing the built code,
 * 2026-09-01.
 */
const EXPECTED_POSITIONS = [
  { words: "clearly underpowered", valence: -100 },
  { words: "leans underpowered", valence: -50 },
  { words: "counts neither way", valence: 0 },
  { words: "leans well powered", valence: 50 },
  { words: "clearly well powered", valence: 100 },
] as const;

/**
 * **Loud model numbers**, none of which is one of the five the instrument
 * writes. If the panel ever starts echoing the model's judgement into the place
 * the referee makes theirs, these are what the tripwire sees.
 */
const MODEL_VALENCES = [-87, 93];

const DIVERGING: SavedCriterion = {
  id: "spya-crt2aa",
  criterion: "Is the study adequately powered?",
  config: { kind: "diverging", poles: POLES, scale: "rg" },
  createdAt: "2026-09-01T09:00:00.000Z",
  status: "done",
  results: [
    {
      kind: "diverging",
      blockId: BLOCK,
      quote: "thirty-one participants in each arm",
      confidence: 80,
      reasoning: "the sample size",
      valence: MODEL_VALENCES[0] as number,
    },
    {
      kind: "diverging",
      blockId: BLOCK,
      quote: "a pre-registered power analysis",
      confidence: 70,
      reasoning: "the analysis",
      valence: MODEL_VALENCES[1] as number,
    },
  ],
};

/**
 * **A second criterion with two ends, whose ends say something else entirely.**
 *
 * It exists so that changing the criterion of a placement can be tested at all.
 * The poles are deliberately unrelated to `POLES`: a −50 that means *leans
 * underpowered* on one criterion means *leans the statistics are wrong* on this
 * one, and the whole point of the five positions is that the number only ever
 * means what its criterion's two words say.
 */
const OTHER_POLES = { against: "the statistics are wrong", favour: "the statistics are sound" };

const DIVERGING_TOO: SavedCriterion = {
  id: "spya-crt2dd",
  criterion: "Are the statistics right?",
  config: { kind: "diverging", poles: OTHER_POLES, scale: "rg" },
  createdAt: "2026-09-01T09:03:00.000Z",
  status: "done",
  results: [],
};

/** A criterion with no two ends. `markProblem` refuses a placement on it. */
const SINGLE: SavedCriterion = {
  id: "spya-crt2bb",
  criterion: "Where does the paper describe its randomisation?",
  config: { kind: "single" },
  createdAt: "2026-09-01T09:01:00.000Z",
  status: "done",
  results: [],
};

/** Nor does this one. */
const LITERATURE: SavedCriterion = {
  id: "spya-crt2cc",
  criterion: "Has this been replicated?",
  config: { kind: "literature" },
  createdAt: "2026-09-01T09:02:00.000Z",
  status: "done",
  results: [],
};

const ANCHOR = {
  blockId: BLOCK,
  quote: "thirty-one participants in each arm",
  start: 0,
} as const;

function storedComment(over: Partial<Comment> = {}): Comment {
  return {
    id: "spya-cmt2aa",
    blockId: BLOCK,
    quote: ANCHOR.quote,
    start: 0,
    createdAt: "2026-09-01T10:00:00.000Z",
    status: "none",
    body: "the arms are too small for this",
    ...over,
  };
}

/* ------------------------------------------------------------ the network -- */

interface Sent {
  url: string;
  method: string;
  body: unknown;
}

let sent: Sent[];
/** Criteria the GET serves. Posed per test. */
let served: SavedCriterion[];
/**
 * **The comments the fake server holds**, which the writes below change.
 *
 * It is the article's rows rather than a fixture the GET reads once: the races
 * further down turn on the difference between what the server ended up with and
 * what the browser ended up showing, and a server that never changed could not
 * tell them apart.
 */
let stored: Comment[];
/** Whether the writes succeed. Posed per test. */
let writesFail: boolean;

/**
 * One write the client has sent and not yet been answered for.
 *
 * Two moments, not one, because the whole of the bug is that they are two.
 * `process` is the server running the write — the row changes, and the answer
 * it will send is composed out of what it holds *then*. `deliver` is that
 * answer reaching the browser. A test that can order those separately can stage
 * both of the reorderings a network does: two requests arriving in the wrong
 * order, and two answers crossing on the way back.
 */
interface InFlight {
  process(): void;
  deliver(): void;
}

/**
 * Where writes park, when a test has asked them to. `null` means answer at
 * once, which is what every test that is not about ordering wants.
 */
let held: InFlight[] | null = null;

/** From here on, writes wait to be landed by hand. */
function holdWrites(): void {
  held = [];
}

/** The comment as the hook holds it — what every other panel in the app draws from. */
let latest: Comment | undefined;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * A stand-in for the two routes, **which applies the placement it is given**
 * rather than echoing a fixture back.
 *
 * That is load-bearing rather than tidy. The dialog is controlled by the stored
 * comment, so a fake server that ignored the request would make every change
 * look like a failure and every failure look like a change — the two states
 * this file exists to keep apart. `tidyMark` on the real route does the same
 * thing: absent stays absent, `null` clears.
 */
function applyMark(comment: Comment, body: Record<string, unknown>): Comment {
  const { criterionId: _wasId, valence: _wasValence, ...rest } = comment;
  const criterionId = body["criterionId"];
  const valence = body["valence"];
  return {
    ...rest,
    ...(typeof criterionId === "string" ? { criterionId } : {}),
    ...(typeof valence === "number" ? { valence } : {}),
  };
}

/** The reader's own words, changed by `PATCH /api/comments/:slug/:id`. */
function applyBody(comment: Comment, body: Record<string, unknown>): Comment {
  const { body: _wasBody, ...rest } = comment;
  const next = body["body"];
  return { ...rest, ...(typeof next === "string" ? { body: next } : {}) };
}

/**
 * **The server running one write**: the row changes, and the answer is composed
 * out of the row as it stands *now*.
 *
 * That last part is the whole of the second race. The real routes answer with
 * the entire comment, so an answer is a snapshot of every field at the moment
 * the write ran — and an old snapshot arriving late puts back every field a
 * newer write has since changed. `patchBody` and `patchMark` touch disjoint
 * columns, so nothing is lost on disk; it is the browser that ends up
 * disagreeing with Postgres.
 */
function process(url: string, body: Record<string, unknown> | undefined): Response {
  if (writesFail) return json({ error: "The server said no." }, 500);
  const target = stored.find((c) => url.includes(c.id));
  // A POST: the comment is in the body rather than the path.
  if (!target) {
    return json({ comment: applyMark(storedComment({ id: String(body?.["id"]) }), body ?? {}) });
  }
  const next = url.endsWith("/mark") ? applyMark(target, body ?? {}) : applyBody(target, body ?? {});
  stored = stored.map((c) => (c.id === next.id ? next : c));
  return json({ comment: next });
}

function answer(url: string, init: RequestInit): Promise<Response> {
  const method = init.method ?? "GET";
  const body = typeof init.body === "string"
    ? (JSON.parse(init.body) as Record<string, unknown>)
    : undefined;
  sent.push({ url, method, body });
  if (url.startsWith("/api/referee/criteria/")) {
    return Promise.resolve(json({ criteria: served, sourceHash: "abc" }));
  }
  if (method === "GET") return Promise.resolve(json({ comments: stored }));
  if (!held) return Promise.resolve(process(url, body));

  /* Parked. Nothing has reached the server yet — `process` runs when the test
     says it does, which is what lets a test decide the order the writes land
     in as well as the order their answers come back. */
  let deliverWith!: (r: Response) => void;
  const parked = new Promise<Response>((resolve) => {
    deliverWith = resolve;
  });
  let composed: Response | null = null;
  held.push({
    process: () => {
      composed = process(url, body);
    },
    deliver: () => {
      deliverWith(composed ?? process(url, body));
    },
  });
  return parked;
}

/** The one write we care about, whatever else the hook did on the way. */
function lastWrite(): Sent {
  const writes = sent.filter((s) => s.method !== "GET");
  const last = writes[writes.length - 1];
  if (!last) throw new Error(`no write was sent; saw ${JSON.stringify(sent.map((s) => s.url))}`);
  return last;
}

/* -------------------------------------------------------------- rendering -- */

let container: HTMLDivElement;
let root: Root;

/**
 * `AnnotateDialog` wired to the real hook, the way `App.tsx` wires it.
 *
 * The point of going through `useComments` rather than reading `onSave`'s
 * arguments is in the header: the field this feature exists for is one careless
 * hop from arriving as `0`, and only the request body can show that it did not.
 */
function AnnotateHarness({ placing }: { placing: boolean }) {
  const comments = useComments(SLUG);
  return createElement(AnnotateDialog, {
    anchor: ANCHOR,
    placing,
    /* The hook's own flag, as `Reader` passes it — Save waits for the list. */
    loaded: comments.loaded,
    onCancel: () => {},
    onSave: (id: string, body: string, _ask: boolean, mark) => {
      void comments.create({
        id,
        blockId: ANCHOR.blockId,
        quote: ANCHOR.quote,
        start: ANCHOR.start,
        ...(body ? { body } : {}),
        mark,
      });
    },
  });
}

/**
 * `CommentDialog` wired the same way, so `place` is the real one.
 *
 * The comment comes off the hook's own list — loaded from `stored` — rather
 * than from the fixture. A dialog fed the fixture would look right whatever the
 * hook did, which is the whole thing the failure case below is trying to see.
 */
function CommentHarness({ placing, comment }: { placing: boolean; comment: Comment }) {
  const comments = useComments(SLUG);
  const live = comments.comments.find((c) => c.id === comment.id);
  /* Reported out so a test can read the hook's own copy of the row. The dialog
     shows the placement, but the reader's words live in a `<textarea>` with a
     draft of its own — so a body the hook has quietly reverted is invisible on
     screen and visible everywhere else in the app, which is the half of the
     interleaving race that has to be asserted rather than looked at. */
  useEffect(() => {
    latest = live;
  }, [live]);
  if (!live) return null;
  return createElement(CommentDialog, {
    comment: live,
    position: 1,
    total: 1,
    hasPrev: false,
    hasNext: false,
    onPrev: () => {},
    onNext: () => {},
    onClose: () => {},
    /* The eight verbs moved onto an `access` union on 2026-09-04, so that a
       visitor's dialog can carry none of them rather than carrying disabled
       ones. src/web/CommentDialog.tsx § CommentAccess. */
    access: {
      kind: "owner" as const,
      placing,
      pending: 0,
      onDelete: () => {},
      onRetry: () => {},
      onDeepen: () => {},
      onDiscuss: () => {},
      onEdit: (body: string | null) => void comments.edit(comment.id, body),
      onPlace: (mark: { criterionId: string | null; valence: number | null }) =>
        void comments.place(comment.id, mark),
      error: comments.error,
    },
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

/**
 * **Inside a `NuqsAdapter`**, because `PlaceOnCriterion` reads `?refscale=`.
 *
 * Since 2026-09-02 the whole of Referee mode is drawn with one diverging ramp
 * rather than one per criterion, and this section paints the current placement
 * *and* all five instrument positions — so it has to take the mode's, or a
 * criterion stored as `br` under the default `rg` would show the referee two
 * opposite palettes in one session. The parameter is read here rather than
 * threaded in, because the two dialogs this section lives in are nowhere near
 * `RefereeBand`; the cost is this wrapper, which is the same one
 * tests/referee-gap.test.tsx and tests/referee-criteria-panel.test.tsx already
 * need for the band.
 */
async function show(element: ReturnType<typeof createElement>): Promise<void> {
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, element));
  });
  await settle();
}

/**
 * Land everything the client has in flight, in rounds.
 *
 * Rounds, rather than one pass, because a queue sends its next write only once
 * the last one has been answered — so a test that emptied the tray once would
 * stop while the second half of what it asked for was still to come, and read
 * the intermediate state as the final one.
 */
async function landInRounds(round: (batch: InFlight[]) => void): Promise<void> {
  // A queued write is dispatched a microtask after the click, so let the clicks
  // turn into requests before deciding there are none.
  await settle();
  if (!held) throw new Error("nothing is being held; call holdWrites() before the clicks");
  for (let i = 0; i < 8; i += 1) {
    const batch = held;
    held = [];
    if (batch.length === 0) return;
    await act(async () => {
      round(batch);
    });
    await settle();
  }
  throw new Error("the client was still writing after eight rounds");
}

/**
 * **The writes reach the server in the opposite order to the clicks.**
 *
 * Two independent requests may always do this — different connections, and
 * nothing in HTTP promises the one you sent first is the one that runs first —
 * and when they do, the *earlier* click is what ends up in Postgres and on
 * screen. A per-comment queue removes the possibility rather than narrowing it:
 * with one write out at a time there is no order left to get wrong, and this
 * helper then lands them one at a time in the order they were sent.
 */
async function landNewestFirst(): Promise<void> {
  await landInRounds((batch) => {
    for (const write of [...batch].reverse()) {
      write.process();
      write.deliver();
    }
  });
}

/**
 * **The writes run in the order they were sent, and the answers cross on the
 * way back.**
 *
 * The other reordering, and the one that needs no server-side disagreement at
 * all: both writes land correctly on disjoint columns, and the older answer —
 * a snapshot of the whole comment as it stood before the newer write ran —
 * arrives last and puts the field it does not own back to what it was.
 */
async function landAnswersInReverse(): Promise<void> {
  await landInRounds((batch) => {
    for (const write of batch) write.process();
    for (const write of [...batch].reverse()) write.deliver();
  });
}

/**
 * Type into the note box and leave it, which is how an edit commits.
 *
 * The native value setter, because React overrides the property on a controlled
 * `<textarea>` and a plain assignment leaves its own state behind; and
 * `focusout` rather than `blur`, because React delegates `onBlur` to the
 * bubbling event and a non-bubbling `blur` never reaches the root listener
 * (tests/sketch-zoom-and-peek.test.tsx says the same about `focusin`).
 */
function type(words: string): void {
  const box = container.querySelector<HTMLTextAreaElement>("textarea.cmt-note");
  if (!box) throw new Error("there is no note box on screen");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => {
    setter?.call(box, words);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    box.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

/** Every button in the placement section, by its visible words. */
function press(words: string): void {
  const button = [...container.querySelectorAll("button")].find(
    (b) => (b.textContent ?? "").trim() === words,
  );
  if (!button) {
    const seen = [...container.querySelectorAll("button")].map((b) => b.textContent);
    throw new Error(`no button says ${JSON.stringify(words)}; saw ${JSON.stringify(seen)}`);
  }
  act(() => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

/** Choose a criterion in the picker. */
function pick(value: string): void {
  const select = container.querySelector<HTMLSelectElement>(".place select");
  if (!select) throw new Error("there is no criterion picker on screen");
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function save(): void {
  press("Save comment");
}

/** The position the instrument says is chosen, in its own words. */
function checked(): string | null {
  const on = container.querySelector('.place-scale [aria-checked="true"]');
  return on ? (on.textContent ?? "").trim() : null;
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.history.replaceState({}, "", `/read/${SLUG}`);
  sent = [];
  served = [DIVERGING];
  stored = [];
  writesFail = false;
  held = null;
  latest = undefined;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------- the tests -- */

describe("the five positions, and the numbers they write", () => {
  it("sends −100 for the referee's own worst end, with the criterion beside it", async () => {
    await show(createElement(AnnotateHarness, { placing: true }));
    pick(DIVERGING.id);
    press("clearly underpowered");
    save();
    await settle();

    const write = lastWrite();
    expect(write.method).toBe("POST");
    expect(write.body).toMatchObject({
      criterionId: DIVERGING.id,
      valence: -100,
    });
  });

  /**
   * **The membership check, which is the half `EXPECTED_POSITIONS` cannot do.**
   *
   * A literal table can only assert about the positions it knows about, so on
   * its own a sixth position would simply be skipped — added, shipped, and
   * never pressed by anything. This is what makes that impossible: the words
   * the instrument actually draws, in order, against the words written out
   * below. A position added, removed, renamed or reordered reddens here.
   *
   * The two together are the whole of what the brief asked for. Deriving the
   * *numbers* from `PLACEMENT_STEPS` as well — which is what this file did
   * until 2026-09-01 — meant the parameterised cases below took their clicks
   * and their expectations from the same table, so changing the production −50
   * to −40 left every one of them green. GPT Sol found it.
   */
  it("draws exactly the five positions written out below, in that order", () => {
    expect(PLACEMENT_STEPS.map((s) => placementLabel(s, POLES))).toEqual(
      EXPECTED_POSITIONS.map((p) => p.words),
    );
  });

  /* One case per position, pressing a literal label and expecting a literal
     number. Nothing here reads `PLACEMENT_STEPS`, which is the point: the
     production table cannot move the target it is being measured against. */
  for (const position of EXPECTED_POSITIONS) {
    it(`sends ${position.valence} for "${position.words}"`, async () => {
      await show(createElement(AnnotateHarness, { placing: true }));
      pick(DIVERGING.id);
      press(position.words);
      save();
      await settle();

      expect(lastWrite().body).toMatchObject({
        criterionId: DIVERGING.id,
        valence: position.valence,
      });
    });
  }

  it("sends no placement at all when the referee made none", async () => {
    await show(createElement(AnnotateHarness, { placing: true }));
    save();
    await settle();

    const body = lastWrite().body as Record<string, unknown>;
    /* Not `null`, and above all not `0` — a zero here is a fabricated "counts
       neither way", which is a judgement the referee did not make. */
    expect(body).not.toHaveProperty("criterionId");
    expect(body).not.toHaveProperty("valence");
  });
});

describe("which criteria are offered", () => {
  it("offers only the ones with two ends, because the server refuses the rest", async () => {
    served = [SINGLE, DIVERGING, LITERATURE];
    await show(createElement(AnnotateHarness, { placing: true }));

    const options = [...container.querySelectorAll<HTMLOptionElement>(".place option")].map(
      (o) => o.value,
    );
    expect(options).toContain(DIVERGING.id);
    expect(options).not.toContain(SINGLE.id);
    expect(options).not.toContain(LITERATURE.id);
  });

  it("shows the criterion's own words and both poles", async () => {
    await show(createElement(AnnotateHarness, { placing: true }));
    const text = container.querySelector(".place")?.textContent ?? "";
    expect(text).toContain(DIVERGING.criterion);
    expect(text).toContain(POLES.against);
    expect(text).toContain(POLES.favour);
  });
});

describe("outside Referee mode", () => {
  it("does not offer to place anything, and does not go looking for criteria", async () => {
    await show(createElement(AnnotateHarness, { placing: false }));
    expect(container.querySelector(".place")).toBeNull();
    expect(sent.some((s) => s.url.startsWith("/api/referee/criteria/"))).toBe(false);
  });
});

describe("changing and clearing a placement that already exists", () => {
  const placed = storedComment({ criterionId: DIVERGING.id, valence: -50 });

  it("shows what is there now before it changes", async () => {
    stored = [placed];
    await show(createElement(CommentHarness, { placing: true, comment: placed }));
    const text = container.querySelector(".place")?.textContent ?? "";
    expect(text).toContain(placementLabel(PLACEMENT_STEPS[1], POLES));
    expect(text).toContain("−50");
  });

  it("patches both fields when the position changes", async () => {
    stored = [placed];
    await show(createElement(CommentHarness, { placing: true, comment: placed }));
    press("clearly well powered");
    await settle();

    const write = lastWrite();
    expect(write.method).toBe("PATCH");
    expect(write.url).toBe(`/api/comments/${SLUG}/${placed.id}/mark`);
    expect(write.body).toEqual({ criterionId: DIVERGING.id, valence: 100 });
  });

  it("clears with both fields null, which is the whole of what clearing is", async () => {
    stored = [placed];
    await show(createElement(CommentHarness, { placing: true, comment: placed }));
    press("Clear placement");
    await settle();

    const write = lastWrite();
    expect(write.method).toBe("PATCH");
    expect(write.body).toEqual({ criterionId: null, valence: null });
  });

  /**
   * **The number does not travel to the new criterion**, and this is the one
   * that fabricates a judgement if it goes wrong.
   *
   * −50 is not a quantity. It is the second of five positions, and what it
   * *says* is "leans underpowered" — four words that exist only because *Is the
   * study adequately powered?* has those two ends. Carry it onto *Are the
   * statistics right?* and the referee is recorded as having said "leans the
   * statistics are wrong", a sentence they never read, about a criterion they
   * never placed. Nothing errors, the database is happy, and the panel prints
   * it beside the model's as an independent human judgement.
   *
   * So the new criterion arrives with no placement on it, which the route
   * already calls legal — `{ criterionId, valence: null }` is a note answering
   * a criterion without a score — and the five positions come back up blank in
   * the new criterion's own words. GPT Sol, reviewing the built code,
   * 2026-09-01.
   */
  it("clears the number when the criterion changes, rather than carrying it across", async () => {
    served = [DIVERGING, DIVERGING_TOO];
    stored = [placed];
    await show(createElement(CommentHarness, { placing: true, comment: placed }));
    expect(checked()).toBe(placementLabel(PLACEMENT_STEPS[1], POLES));

    pick(DIVERGING_TOO.id);
    await settle();

    const write = lastWrite();
    expect(write.method).toBe("PATCH");
    expect(write.body).toEqual({ criterionId: DIVERGING_TOO.id, valence: null });
    /* And on screen: no position is chosen on the new criterion, so the referee
       is asked rather than told. Read off `aria-checked` rather than the text,
       because all five labels are always drawn. */
    expect(checked()).toBeNull();
  });

  /**
   * The other half of the same rule, and the reason clearing is conditional on
   * the criterion actually being a different one.
   *
   * A browser fires `change` only when the value moves, so this is not a thing
   * a referee can do with a mouse — but "the criterion changed" is a fact about
   * the two values, not about how the event got here, and a version that
   * cleared on every `change` would blank a placement the moment anything
   * re-selected the option that was already chosen.
   */
  it("does not wipe the placement when the picker lands on the criterion it is already on", async () => {
    served = [DIVERGING, DIVERGING_TOO];
    stored = [placed];
    await show(createElement(CommentHarness, { placing: true, comment: placed }));

    pick(DIVERGING.id);
    await settle();

    expect(lastWrite().body).toEqual({ criterionId: DIVERGING.id, valence: -50 });
    expect(checked()).toBe(placementLabel(PLACEMENT_STEPS[1], POLES));
  });

  it("offers to place a plain reading note, so one can become a review comment", async () => {
    const note = storedComment();
    stored = [note];
    await show(createElement(CommentHarness, { placing: true, comment: note }));
    expect(container.querySelector(".place")).not.toBeNull();
    /* Two writes, because the instrument is controlled by the stored comment:
       naming the criterion is itself a change (a note answering a criterion
       without a score is a legal and ordinary state), and the five positions
       only appear once there is a criterion for them to be positions on. */
    pick(DIVERGING.id);
    await settle();
    expect(lastWrite().body).toEqual({ criterionId: DIVERGING.id, valence: null });

    press("leans underpowered");
    await settle();

    expect(lastWrite().body).toEqual({ criterionId: DIVERGING.id, valence: -50 });
  });
});

/**
 * **Two writes on one comment, and the order they land in.**
 *
 * A referee changing their mind twice in a second is ordinary, and so is
 * pressing a position and then tidying the note. Both used to launch their own
 * request the moment they happened, and two requests in the air have no order:
 * the *first* click could be the one stored, and an answer that crossed another
 * on the wire put back a field its own write had never touched.
 *
 * These stage each reordering by hand and assert three things — the server's
 * row, the hook's copy, and the position the instrument draws — because the bug
 * shows in different ones depending on which way round it went, and a test that
 * checked only the screen would call a browser that disagrees with Postgres a
 * pass. GPT Sol found both, reviewing the built code, 2026-09-01.
 */
describe("two writes on one comment", () => {
  const placed = storedComment({ criterionId: DIVERGING.id, valence: -50 });

  it("has only one write out at a time, so there is no order to get wrong", async () => {
    stored = [placed];
    await show(createElement(CommentHarness, { placing: true, comment: placed }));
    holdWrites();

    press("clearly underpowered");
    press("clearly well powered");
    await settle();

    /* The second waited for the first. This is the fix itself rather than a
       symptom of it: the reorderings below are things a network does, and the
       only way to be sure of them is to have nothing to reorder. */
    expect(held).toHaveLength(1);
  });

  it("stores and shows the last click when the two writes reach the server backwards", async () => {
    stored = [placed];
    await show(createElement(CommentHarness, { placing: true, comment: placed }));
    holdWrites();

    press("clearly underpowered");
    press("clearly well powered");
    await landNewestFirst();

    // What the referee last said, in all three places it is written down.
    expect(stored[0]?.valence).toBe(100);
    expect(latest?.valence).toBe(100);
    expect(checked()).toBe("clearly well powered");
  });

  it("does not put the old placement back when a late note answer lands after it", async () => {
    stored = [placed];
    await show(createElement(CommentHarness, { placing: true, comment: placed }));
    holdWrites();

    type("a much better note");
    press("clearly well powered");
    await landAnswersInReverse();

    expect(latest?.body).toBe("a much better note");
    /* The note's answer carries the whole comment, and the mark it carries is
       the one the server held when the note was written — so arriving second it
       is a judgement the referee has already replaced. */
    expect(latest?.valence).toBe(100);
    expect(checked()).toBe("clearly well powered");
  });

  it("does not put the old note back when a late placement answer lands after it", async () => {
    stored = [placed];
    await show(createElement(CommentHarness, { placing: true, comment: placed }));
    holdWrites();

    press("clearly well powered");
    type("a much better note");
    await landAnswersInReverse();

    /* Read off the hook rather than the box: the `<textarea>` keeps a draft of
       its own, so a reverted body is invisible there and visible in the gutter,
       the criteria panel and the next dialog that opens. */
    expect(latest?.body).toBe("a much better note");
    expect(latest?.valence).toBe(100);
  });
});

describe("when the placement does not save", () => {
  it("leaves the old one on screen and says so", async () => {
    const placed = storedComment({ criterionId: DIVERGING.id, valence: -50 });
    stored = [placed];
    await show(createElement(CommentHarness, { placing: true, comment: placed }));

    writesFail = true;
    press("clearly well powered");
    await settle();

    /* The old placement, unchanged. A screen showing the new value after a
       failed write is the exact shape docs/reusable/silent-success.md is
       about: nothing errored, and the referee believes a judgement is stored
       that is not.

       Read off the current line and off which position is checked, not off the
       section's text — all five labels are always drawn, so a text search would
       pass whatever the instrument did. */
    const current = container.querySelector(".place-current")?.textContent ?? "";
    expect(current).toContain(placementLabel(PLACEMENT_STEPS[1], POLES));
    expect(current).toContain("−50");
    expect(checked()).toBe(placementLabel(PLACEMENT_STEPS[1], POLES));
    // And the failure is said out loud somewhere on the dialog.
    expect(container.textContent ?? "").toContain("The server said no.");
  });
});

/**
 * **The tripwire.** See the header: the placement section is where the referee
 * makes their own judgement, and the model's numbers may not be in it.
 *
 * Rendered rather than scanned, because the numbers arrive over the network —
 * a source scan would see no digits at all and pass while the panel printed
 * every one of them.
 */
describe("the model's judgement is nowhere near the referee's instrument", () => {
  it("renders no model valence inside the placement section", async () => {
    await show(createElement(AnnotateHarness, { placing: true }));
    pick(DIVERGING.id);
    const section = container.querySelector(".place");
    expect(section, "the placement section should be on screen").not.toBeNull();
    const text = section?.textContent ?? "";
    for (const valence of MODEL_VALENCES) {
      expect(text, `the model's ${valence} reached the referee's own instrument`).not.toContain(
        String(Math.abs(valence)),
      );
    }
    // Nor the model's quote, its reasoning, or its confidence.
    expect(text).not.toContain("the sample size");
    expect(text).not.toContain("pre-registered power analysis");
  });
});
