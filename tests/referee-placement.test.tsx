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
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
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
/** Comments the GET serves. Posed per test. */
let stored: Comment[];
/** Whether the writes succeed. Posed per test. */
let writesFail: boolean;

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
  if (writesFail) return Promise.resolve(json({ error: "The server said no." }, 500));
  const target = stored.find((c) => url.includes(c.id)) ?? storedComment({ id: String(body?.["id"]) });
  return Promise.resolve(json({ comment: applyMark(target, body ?? {}) }));
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
  if (!live) return null;
  return createElement(CommentDialog, {
    comment: live,
    placing,
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
    onPlace: (mark) => void comments.place(comment.id, mark),
    error: comments.error,
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i = 0; i < 8; i += 1) await Promise.resolve();
  });
}

async function show(element: ReturnType<typeof createElement>): Promise<void> {
  await act(async () => {
    root.render(element);
  });
  await settle();
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

  /* Derived from the exported table rather than written out, so a sixth
     position cannot be added without this test seeing it — and so the labels
     the test presses are the labels the instrument draws, not a second copy. */
  for (const step of PLACEMENT_STEPS) {
    it(`sends ${step.valence} for "${placementLabel(step, POLES)}"`, async () => {
      await show(createElement(AnnotateHarness, { placing: true }));
      pick(DIVERGING.id);
      press(placementLabel(step, POLES));
      save();
      await settle();

      expect(lastWrite().body).toMatchObject({
        criterionId: DIVERGING.id,
        valence: step.valence,
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
