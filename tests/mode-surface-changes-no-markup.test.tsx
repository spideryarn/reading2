// @vitest-environment jsdom
/**
 * **The refactor's whole claim, written down: the band's DOM did not change.**
 *
 * Stage 1 of
 * docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen.md
 * moved Search's and Chat's hand-written `<aside className="mode-band …">` onto
 * a shared `src/web/ModeSurface.tsx`. The stage's stated acceptance is that
 * **nothing about the rendered page may change** — and until this file existed,
 * nothing in the suite could tell the difference between that having happened
 * and not having happened. Every other test about these two panels addresses
 * elements by class from anywhere in the tree (`host.querySelector(".chat-input")`),
 * so a `<div className="band-body">` wrapped around the children would leave the
 * entire suite green while quietly unmatching every child combinator in the
 * stylesheet.
 *
 * ## The expected literals come from the "before" — and they have two provenances
 *
 * Nothing below is derived from `ModeSurface.tsx`, from a snapshot, or from a
 * helper that reads the component. A file that computes its expectations from
 * the implementation agrees with whatever the implementation does, which is
 * precisely the failure this one exists to prevent — the same rule
 * tests/every-mode-draws-its-surface.test.tsx states about `SPENDS` and `DRAWS`.
 * If a band's shape is meant to change, the literal below is what has to be
 * edited, on purpose, by somebody who has looked at the band.
 *
 * But **the two provenances are not equally strong, and an earlier draft of this
 * docstring claimed they were** (GPT Sol F17, 2026-09-06 — it said every literal
 * came from the baseline, which is false):
 *
 * - **Measured.** The child class lists for `SEARCH` and `CHAT` are transcribed
 *   from the companion baseline doc,
 *   docs/plans/260906f-the-active-mode-gets-one-surface-and-one-way-to-fit-the-screen-baseline.md,
 *   captured in real Chrome at commit
 *   `6dacbd2e84ff0fd52df91c5464d0911541260dff`, **before** the migration.
 * - **Read from the pre-migration source.** Every `aria-label` (the baseline
 *   recorded geometry, not accessible names), the `REMEMBER` shape, and the
 *   `SEARCH_VISITOR` and `CHAT_LIST` shapes are transcribed from the panels as
 *   they were at `369699af~1`, the commit before the migration. That is weaker
 *   evidence than a measurement and stronger than reading the code that was just
 *   written — and it is sound for the children specifically, because the
 *   migration changed only the `<aside>` and the header: every child expression
 *   in both panels is character-identical across the diff.
 * - **Rendered from the unmigrated panel.** Every shape in the stage-2 block at
 *   the foot of this file was printed by mounting the panel as it stood at
 *   `8cef3161`, **before that panel was migrated** — the DOM the component
 *   really produced, not a reading of its JSX. That is the strongest of the
 *   three for markup, and it is the only one available for a band nobody
 *   measured in Chrome. (`App.tsx` carried one unrelated stage-4 edit at the
 *   time — the `?probe=1` diagnostic — which adds a sibling inside `.reader`
 *   and touches nothing in `RefereeBand`.)
 *
 * ## Stage 2's step 0: the other eleven bands, captured before they move
 *
 * The stage-2 block records `VisitorBand`, Summary, Glossary, Ideas, Quotes,
 * Timeline, Quiz, Debate, Diagram, Outline and Referee — the eleven the plan's
 * § Stage 2 migrates — in twenty shapes. The order matters more than the
 * count: a literal read off a panel *after* it has been migrated is the
 * implementation agreeing with itself, which is the failure the section above
 * is about. So the capture is a step of its own and it comes first
 * (GPT Sol F21).
 *
 * **What the capture already found, and nothing in the suite could see before.**
 * Five of these bands ship an `<div class="band-head">` with **nothing inside
 * it** — Glossary, Ideas, Quotes and Timeline while their artefact is still
 * coming, and Diagram in its ordinary Sketch state, where the header's one
 * child is a caveat only the projected pictures draw. That is the exact inverse
 * of the defect stage 1 fixed: `ModeSurface` renders **no** header for an
 * absent, null or boolean `head`, so the migration that reads most naturally —
 * `head={glossary && <span/>}` — hands it `null` and **deletes a row the reader
 * has today**. The shape those five need is a fragment that is always present
 * with the conditionals inside it. Debate and Referee are the controls: their
 * headers carry something unconditional and cannot empty out.
 *
 * ## Two harnesses, and why the cheap one is not used for everything
 *
 * Ten of the eleven are mounted **as components**, the way Search and Chat are,
 * because that is what makes `expectShape`'s strongest assertion possible: the
 * band is the panel's entire output, so a wrapper *around* the `<aside>` fails.
 * tests/every-mode-draws-its-surface.test.tsx already mounts `<App/>` with
 * artefact fixtures for every mode and would have saved most of the fixture
 * work — but read through the whole reader, that assertion becomes "the band is
 * somewhere on the page", and Sol's F16 is the finding it exists to keep.
 *
 * Referee is mounted through `<App/>`, and its shape carries a `parent`
 * selector instead, which catches the same wrapper one level up.
 *
 * That was once forced — `RefereeBand` was an unexported function inside
 * `App.tsx` and there was no other way to reach it. Since 2026-09-06 it is
 * `export function RefereeBand` in
 * [`src/web/modes/referee/RefereeMode.tsx`](../src/web/modes/referee/RefereeMode.tsx)
 * and could be mounted directly; the harness is kept because mounting the whole
 * reader is what makes this a check of what a reader sees, not because it is
 * still the only door. That
 * is one harness's worth of cost for one band, and it is why the other ten do
 * not use it.
 *
 * ## What this file does not attempt, and what covers it instead
 *
 * Search has visitor/owner, meaning/words, error, saved, stale and empty shapes;
 * Chat has list, loading, failed, empty, error, live and dictation ones. Pinning
 * all of them as literals here would be a dozen transcriptions of code written
 * an hour ago, which is closer to agreeing with the implementation than to
 * checking it. Two extra shapes are pinned because they change the **band's own
 * children** — a visitor loses `.srch-box`, and Chat's list is a different band
 * body entirely — and the rest are covered by the structural assertions in
 * `expectShape`, which hold for any shape: the band is the panel's whole output,
 * its attribute set is exactly two, and there is no loose text inside it.
 *
 * ## Markup shape only — no geometry, and that is not an omission
 *
 * jsdom has no layout engine: `getBoundingClientRect()` returns zeros, flexbox
 * is not implemented, and a "the children fit the band" assertion here would be
 * green before and after any change, because 0 + 0 + 0 + 0 fits in 0
 * (tests/referee-band-fits.test.ts § What this file cannot do). The baseline's
 * warning about a naive height sum — Chat's children read 761px against a band
 * of 760 because the `sr-only` announcer is out of flow and still counted — is
 * about the **browser** pass, not this one. Nothing here measures anything.
 *
 * What is left is the part a refactor actually breaks, and it is worth more than
 * it looks:
 *
 * - the element is still an `<aside>`, still `.mode-band`, still carrying its
 *   feature hook and its accessible name;
 * - the `class` attribute is compared as an exact string, because a stray space
 *   or a reordered token is a real diff even though `classList` would forgive
 *   it;
 * - the **ordered list of direct element children** is the check that catches a
 *   wrapper, since a wrapper changes `children` to one element while leaving
 *   every `querySelector` in the app satisfied;
 * - Chat is checked in **both** of its shapes, `chat` and `chat remember`,
 *   because `feature` is a space-separated string built by a ternary and a
 *   dropped conditional class is exactly the sort of thing a migration loses in
 *   silence.
 *
 * ## And `ModeSurface` itself, on the one constraint its docstring makes
 *
 * The last describe block skips the panels and mounts the component directly,
 * because "it adds no DOM" has two halves and the panels only exercise one.
 * The other half is the empty cases, and **neither of the two defects it caught
 * had a caller in stage 1** — both were waiting for stage 2 to walk into:
 *
 * - **`head={false}`** — how `cond && <X/>` arrives — satisfied a `head != null`
 *   guard and rendered an *empty* `.band-head`. Invisible on screen, and one
 *   extra slot in front of every band that styles its first child by position.
 * - **A band with no hook class at all** — `PublicChrome`'s visitor band, and
 *   `FeatureBoundary`'s fallback — came out as `class="mode-band undefined"`
 *   from an unguarded template. `classList` and every `querySelector` in the app
 *   forgive that, which is exactly why only an assertion on the attribute
 *   *string* can see it.
 *
 * Both were found by reading rather than by a failing caller, on 2026-09-06, and
 * both are pinned below because the next migration is where they would have
 * landed.
 */
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DebateOwner } from "../src/web/DebatePanel.js";
import type { DiagramAccess } from "../src/web/DiagramPanel.js";
import type { GlossaryAccess, GlossaryOwner } from "../src/web/GlossaryPanel.js";
import type { IdeasOwner } from "../src/web/IdeasPanel.js";
import type { QuotesOwner } from "../src/web/QuotesPanel.js";
import type { TimelineOwner } from "../src/web/TimelinePanel.js";
import type { UseQuiz } from "../src/web/useQuiz.js";
import type { Found } from "../src/web/search-hits.js";
import type { PublicSketch } from "../src/public-types.js";
import type {
  Article,
  Block,
  BlockId,
  ChatThread,
  Debate,
  DebateCounts,
  DebateLosses,
  Glossary,
  Ideas,
  Quiz,
  QuizQuestionId,
  Quotes,
  Timeline,
} from "../src/types.js";

/* The profile hook fetches on mount and none of this is about the profile —
   the same stub tests/remember-panel.test.tsx uses to mount `ChatPanel`. */
vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));

/* ------------------------------------------------- the reader, for Referee --

   Referee's band is the one this file cannot mount as a component, so the last
   test mounts `<App/>` around it. Everything from here to `enableHistorySync`
   is that mount's cost, and it is the whole of the argument for not using this
   harness for the other ten: the same shape, read through the reader, would
   trade a precise assertion for four hundred lines of fixture.

   The mocks are file-wide, as `vi.mock` always is. The twelve tests that
   predate them were run against them and are unaffected — neither `SearchPanel`
   nor `ChatPanel` reads a session. */

const OWNER = { id: "owner-1", email: "owner@example.com" };

vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: OWNER, loading: false }),
}));

const authListeners: ((event: string, session: unknown) => void)[] = [];

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: (fn: (event: string, session: unknown) => void) => {
        authListeners.push(fn);
        return { data: { subscription: { unsubscribe() {} } } };
      },
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

/* The browser APIs the reading view uses that jsdom does not have — the same
   set tests/every-mode-draws-its-surface.test.tsx installs. */
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  }),
});
Object.defineProperty(window, "scrollTo", { writable: true, value: () => {} });
if (!(globalThis as { CSS?: unknown }).CSS) {
  (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
}

/**
 * **Every import of the client is dynamic, and that is not a style choice.**
 *
 * `src/web/lib/api.ts` calls `supabase.auth.onAuthStateChange` at module scope,
 * so the mock factory above runs during the *first* import of anything that
 * reaches it. A static `import { SearchPanel }` is hoisted above every `const`
 * in this file, so `authListeners` was still in its temporal dead zone when the
 * mock tried to push to it — a `ReferenceError` before a single test ran.
 * Dynamic imports run in file order instead, after the constants they use.
 */
const { ChatPanel } = await import("../src/web/ChatPanel.js");
const { App } = await import("../src/web/App.js");
const { ModeSurface } = await import("../src/web/ModeSurface.js");
const { SearchPanel } = await import("../src/web/SearchPanel.js");
const { DebatePanel } = await import("../src/web/DebatePanel.js");
const { DiagramPanel } = await import("../src/web/DiagramPanel.js");
const { GlossaryPanel } = await import("../src/web/GlossaryPanel.js");
const { IdeasPanel } = await import("../src/web/IdeasPanel.js");
const { OutlinePanel } = await import("../src/web/OutlinePanel.js");
const { VisitorBand } = await import("../src/web/PublicChrome.js");
const { QuizPanel } = await import("../src/web/QuizPanel.js");
const { QuotesPanel } = await import("../src/web/QuotesPanel.js");
const { SummaryPanel } = await import("../src/web/SummaryPanel.js");
const { TimelinePanel } = await import("../src/web/TimelinePanel.js");
const { assignSlots } = await import("../src/web/hit-colours.js");
const { buildGeometry, buildSummaryTree } = await import("../src/web/tree.js");

let host: HTMLDivElement;
let root: Root;

enableHistorySync();

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  /* Outline installs two `ResizeObserver`s and Diagram one. A no-op stands in:
     the first synchronous `measure()` is what puts `data-outline-rung` on the
     band, and nothing here depends on a later callback. */
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(serve(String(input), init?.method ?? "GET")),
  );
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

/** The one band on screen — found as an `<aside>`, not as a `.mode-band`, so a
 *  surface that had stopped being a landmark would fail here rather than pass
 *  by having kept its class. */
function band(): HTMLElement {
  const found = host.querySelector("aside");
  if (!found) throw new Error("no <aside> rendered — the band is missing entirely");
  return found;
}

/**
 * A signature for every direct element child, in order: `tag.class[attrs]`.
 *
 * **Not just the class**, which is what this recorded until GPT Sol's F20 on
 * 2026-09-06. Three changes slipped through a class-only comparison, and all
 * three are things a refactor does: `<form class="chat-composer">` becoming a
 * `<div>` (different default styling, and it stops submitting), an attribute
 * appearing on a child, and — with the header — the row's contents changing
 * while `.band-head` stayed put.
 *
 * Attribute *names* rather than values: a value is state (`aria-expanded`
 * flips as the reader clicks), while a name appearing or vanishing is
 * structure. `class` is dropped from the list because it is already the middle
 * of the signature.
 */
function signature(el: Element): string {
  const cls = el.getAttribute("class");
  const attrs = [...el.attributes]
    .map((a) => a.name)
    .filter((n) => n !== "class")
    .sort();
  return `${el.tagName.toLowerCase()}${cls ? `.${cls.split(/\s+/).join(".")}` : ""}${
    attrs.length ? `[${attrs.join(",")}]` : ""
  }`;
}

/** The signature of every direct element child, in order. Elements only: text
 *  and comment nodes are not what a stylesheet's child combinator matches —
 *  loose text is checked separately, because it is a different failure. */
function childSignatures(el: Element): string[] {
  return [...el.children].map(signature);
}

/**
 * Every expectation in one shape, so each band's facts are read together.
 *
 * Provenance is **per field, not per shape** — see the two-provenance section at
 * the top of this file rather than assuming any one source. (An earlier version
 * of this comment said "all four values are transcribed from the baseline",
 * which was the same overclaim the preamble had already been corrected for.
 * GPT Sol F24, 2026-09-06.)
 *
 * `head` records whether a `.band-head` is present, which is a fact about the
 * band and not a restatement of `children[0]`: Search has none, and an
 * accidentally-added empty one would be invisible to a check that only counted.
 */
interface BandShape {
  readonly className: string;
  readonly label: string;
  readonly head: boolean;
  /** Direct element children as `tag.class[attrs]`, in order — see `signature`. */
  readonly children: readonly string[];
  /**
   * The band's own attribute names, sorted, when they are not just the two every
   * band has.
   *
   * Stage 2 needs this: `OutlinePanel` legitimately carries `data-outline-rung`
   * on the band, so a helper that hardcoded exactly `class` and `aria-label`
   * would have had to be rewritten the moment Outline migrated — or, worse,
   * relaxed for everyone. Shape-specific instead. GPT Sol F21, 2026-09-06.
   */
  readonly attrs?: readonly string[];
  /**
   * The header row's own direct children, where the band has a header.
   *
   * `head` is the only slot `ModeSurface` wraps, so it is the only place a
   * migration can quietly drop a control: `.band-head` would still be there,
   * still be a direct child, and still be the first element in `children`.
   * Sol F20.
   */
  readonly headChildren?: readonly string[];
  /**
   * A selector the band's parent must match — **only for a band read through
   * the whole reader**, where "the band is the panel's entire output" is not a
   * thing that can be said.
   *
   * It is not a weakening for its own sake. The assertion it replaces exists to
   * catch a wrapper appearing *around* the `<aside>`, and a wrapper would sit
   * between the band and `.reader` and fail this just as loudly. Absent — which
   * is every shape but Referee's — the stricter whole-output check runs
   * instead.
   */
  readonly parent?: string;
}

/** What almost every band carries, and what `attrs` overrides. */
const PLAIN_ATTRS = ["aria-label", "class"] as const;

/** Search, baseline § "Search mode" — four children, no `.band-head`. */
const SEARCH: BandShape = {
  className: "mode-band srch",
  label: "Search this article",
  head: false,
  children: ["div.srch-box", "div.srch-sort", "p.srch-legend", "ul.srch-hits"],
};

/** Chat with a conversation open, baseline § "Chat mode". */
const CHAT: BandShape = {
  className: "mode-band chat",
  label: "Chat about this article",
  head: true,
  children: ["div.band-head", "div.chat-scroll", "p.sr-only[aria-live]", "form.chat-composer"],
  /* The title, `ArmedDelete` in its unarmed state, and the "All conversations"
     close. `subMode` renders nothing for this fixture. The header is the one
     part of the band the migration restructured — it went from inline JSX to a
     fragment passed as `head` — so it is the one part where "the DOM did not
     change" is a claim rather than a restatement of the diff. */
  headChildren: ["h2", "button.chat-icon.danger[title,type]", "button.chat-icon[title,type]"],
};

/**
 * Remember is the same band wearing one more class and a different name.
 *
 * Not measured separately in Chrome — the baseline captured Chat — but the two
 * strings are `ChatPanel`'s own conditionals, and they are the thing a migration
 * onto a `feature: string` prop drops. Kept as literals here for the same reason
 * as the rest.
 */
const REMEMBER: BandShape = {
  className: "mode-band chat remember",
  label: "Remember what you took from this article",
  head: true,
  children: ["div.band-head", "div.chat-scroll", "p.sr-only[aria-live]", "form.chat-composer"],
  /* The title, `ArmedDelete` in its unarmed state, and the "All conversations"
     close. `subMode` renders nothing for this fixture. The header is the one
     part of the band the migration restructured — it went from inline JSX to a
     fragment passed as `head` — so it is the one part where "the DOM did not
     change" is a claim rather than a restatement of the diff. */
  headChildren: ["h2", "button.chat-icon.danger[title,type]", "button.chat-icon[title,type]"],
};

/**
 * Search as a visitor on a shared link, with nothing saved yet — **one child,
 * and the absent one is the point.**
 *
 * `own` is null, so `Box` is not rendered at all: "**absent for a visitor, not
 * disabled**", the panel's own words. So where an owner in this same state has
 * `.srch-box` above the empty note, a visitor has the note alone. That is the
 * whole visible difference between the two, and it is a difference in the band's
 * direct children — which is what this file is for.
 *
 * The matcher is `meaning` because it is the only reachable visitor state:
 * `useSearchMode` pins a visitor there, since the words matcher's input lives in
 * the composer a visitor does not get.
 *
 * Both classes are in the panel at `369699af~1` — `.srch-box` at its line 472,
 * `.srch-empty` at 652 — so neither is something the migration introduced. Read
 * from that source; not measured in Chrome.
 */
const SEARCH_VISITOR: BandShape = {
  className: "mode-band srch",
  label: "Search this article",
  head: false,
  children: ["div.srch-empty"],
};

/**
 * Chat with no conversation open — a different band body, not a variation on
 * one.
 *
 * `open` is null, so the transcript, the announcer and the conversation's own
 * composer are all replaced by `<ol className="chat-threads">` and the list's
 * own composer — three children where the open shape has four, and only one
 * class in common. `.chat-threads` is at line 750 of the panel at `369699af~1`,
 * so it predates the migration. Read from that source; not measured in Chrome.
 */
const CHAT_LIST: BandShape = {
  className: "mode-band chat",
  label: "Chat about this article",
  head: true,
  children: ["div.band-head", "ol.chat-threads", "form.chat-composer"],
  /* No `ArmedDelete` with nothing open — the header's third slot is the
     new-conversation button instead, and the delete is simply absent. */
  headChildren: ["h2", "button.chat-icon[title,type]"],
};

/**
 * The whole comparison, run against one mounted band.
 *
 * `getAttribute("class")` rather than `classList`, deliberately: the exact
 * string is the check. `mode-band  srch` and `srch mode-band` both satisfy a
 * token comparison and both are diffs somebody should have to look at.
 */
function expectShape(shape: BandShape, found: HTMLElement = band()): void {
  const el = found;

  expect(el.tagName).toBe("ASIDE");
  expect(el.getAttribute("class")).toBe(shape.className);
  expect(el.getAttribute("aria-label")).toBe(shape.label);

  /* **The band is the whole of what the panel renders**, so a wrapper *around*
     the `<aside>` — or anything beside it — fails here. Without this, `band()`
     finds the aside wherever it is and every other assertion passes happily
     underneath an added `<div>` that has broken `.reader > .mode-band`.

     `childNodes`, not `children`: a bare string rendered next to the band is a
     text node, and `children` cannot see one. Sol F20.

     A shape read through the whole reader cannot say that, and says where the
     band sits instead — see `BandShape.parent`. */
  if (shape.parent === undefined) {
    expect([...host.childNodes], "the panel renders the band and nothing else").toEqual([el]);
  } else {
    expect(
      el.parentElement?.matches(shape.parent),
      `the band sits directly in ${shape.parent}, with nothing wrapping it`,
    ).toBe(true);
  }

  /* **The complete attribute set**, not just the two we name. `style` is the
     one that matters: Search's band fits with zero slack, so a
     `style={{ padding: "1px" }}` added here would be absorbed by `.srch-hits`
     and show up nowhere else. An assertion on `class` and `aria-label` alone
     cannot see a third attribute arriving. */
  expect([...el.attributes].map((a) => a.name).sort()).toEqual([...(shape.attrs ?? PLAIN_ATTRS)]);

  expect(childSignatures(el)).toEqual([...shape.children]);

  /* **No stray text.** `.children` skips text nodes, and `.mode-band` is a flex
     container — so a bare string between two elements becomes an anonymous flex
     item with real height, invisible to every assertion above it. Whitespace-only
     text is what JSX indentation leaves behind and is not a box. */
  const text = [...el.childNodes].filter((n) => n.nodeType === 3 && (n.textContent ?? "").trim() !== "");
  expect(text, "loose text directly inside the band").toEqual([]);

  /* Searched over the whole subtree, not just the direct children, because
     there is exactly one `.band-head` in a band and both ways of getting that
     wrong matter: a header pushed inside a new wrapper (found, wrong parent)
     and a second one rendered somewhere below (found twice). */
  const heads = el.querySelectorAll(".band-head");
  if (shape.head) {
    expect(heads, "the header row").toHaveLength(1);
    expect(heads[0]?.parentElement, "the header row is a direct child of the band").toBe(el);
  } else {
    expect(heads, "a header row this band never had").toHaveLength(0);
  }

  /* **And the header's own contents**, which `.band-head` being present says
     nothing about. `head` is the one slot this component actually wraps, so it
     is the one place a migration can drop a control and leave every assertion
     above green — Chat's header carries an `<h2>`, a sub-mode control and either
     an `ArmedDelete` or a new-conversation button, and losing the middle one
     changes nothing else in this file. One level deep is enough: below that is
     the panel's business, not the surface's. Sol F20. */
  if (shape.headChildren) {
    const head = el.querySelector(":scope > .band-head");
    expect(head && childSignatures(head), "the header row's own children").toEqual([...shape.headChildren]);
  }
}

/* ------------------------------------------------------------------ Search */

/**
 * One literal hit, which is all it takes to reach the populated branch.
 *
 * The words matcher, because it is the shape the baseline was captured in and
 * because it needs no saved searches: `Saved` and the confidence slider are both
 * scoped to `meaning`, so this is the four-child band and nothing else.
 */
const HIT: Found = {
  key: "spya-k3m9qt:0",
  blockId: "spya-k3m9qt",
  runId: null,
  slot: null,
  index: 0,
  start: 0,
  end: 11,
  confidence: null,
  valence: null,
  reasoning: null,
  short: "phrenology",
  long: "…the utility of phrenology…",
  at: 0.3,
  whole: false,
  /* Not a quote. See `Found.quoteTier`. */
  quoteTier: null,
};

async function mountSearch(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(SearchPanel, {
        access: {
          kind: "owner" as const,
          loaded: true,
          loadFailed: false,
          error: null,
          onAsk: () => {},
          onRetry: () => {},
          onRecolour: () => {},
          onDelete: () => {},
        },
        matcher: "words" as const,
        onMatcher: () => {},
        find: "phrenology",
        onFind: () => {},
        runs: [],
        active: [],
        slots: assignSlots([]),
        onToggle: () => {},
        onSolo: () => {},
        onToggleAll: () => {},
        found: [HIT],
        all: [HIT],
        order: "document" as const,
        onOrder: () => {},
        gate: 0,
        gateMoved: false,
        onGate: () => {},
        openKey: null,
        onOpen: () => {},
      }),
    );
  });
}

/**
 * The same panel with `access.kind === "visitor"`, which is a one-field union
 * rather than an owner with the callbacks nulled out.
 *
 * `meaning` rather than `words`: `useSearchMode` pins a visitor to the meaning
 * matcher upstream, so a visitor in words mode is not a state this panel can be
 * in and pinning its markup would be pinning a fiction.
 */
async function mountSearchVisitor(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(SearchPanel, {
        access: { kind: "visitor" as const },
        matcher: "meaning" as const,
        onMatcher: () => {},
        find: null,
        onFind: () => {},
        runs: [],
        active: [],
        slots: assignSlots([]),
        onToggle: () => {},
        onSolo: () => {},
        onToggleAll: () => {},
        found: [HIT],
        all: [HIT],
        order: "document" as const,
        onOrder: () => {},
        gate: 0,
        gateMoved: false,
        onGate: () => {},
        openKey: null,
        onOpen: () => {},
      }),
    );
  });
}

/* -------------------------------------------------------------------- Chat */

const AT = "2026-09-06T00:00:00.000Z";

function thread(kind: "chat" | "remember"): ChatThread {
  return {
    id: "spya-k3m9qt",
    title: "About block dfqq59",
    createdAt: AT,
    updatedAt: AT,
    kind,
    messages: [
      { id: "spya-usr2aa", role: "user", text: "What is this about?", createdAt: AT, status: "done" },
      { id: "spya-ans2aa", role: "assistant", text: "An answer.", createdAt: AT, status: "done" },
    ],
  };
}

/**
 * Chat with the conversation **open**, which is the shape the baseline records.
 *
 * `threadId` set to the thread's own id is what puts `.chat-scroll` and
 * `.chat-composer` on screen; left null, the band draws the thread list instead
 * and this file would be checking a different band.
 */
async function mountChat(kind: "chat" | "remember"): Promise<void> {
  const open = thread(kind);
  await act(async () => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind,
        stance: "balanced" as const,
        onStance: () => {},
        loaded: true,
        loadFailed: false,
        threads: [open],
        threadId: open.id,
        onThread: () => {},
        onSend: () => {},
        onNew: () => {},
        onSendNew: () => {},
        onDiscard: () => {},
        onRename: () => {},
        onDelete: () => {},
        onRetry: () => {},
        onEdit: () => {},
        onStop: () => {},
        onJump: () => {},
        recovering: new Set<string>(),
        blocks: new Map<string, string>(),
        focusNonce: 0,
        error: null,
      }),
    );
  });
}

/**
 * Chat with the conversation **closed** — `threadId: null`, so the panel draws
 * `ThreadList` and the list's own composer instead of a transcript.
 *
 * `loaded: true` matters: the list's composer is behind it, and without it the
 * band would be one child shorter for a reason that has nothing to do with this
 * file.
 */
async function mountChatList(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(ChatPanel, {
        slug: "a-piece",
        kind: "chat" as const,
        stance: "balanced" as const,
        onStance: () => {},
        loaded: true,
        loadFailed: false,
        threads: [thread("chat")],
        threadId: null,
        onThread: () => {},
        onSend: () => {},
        onNew: () => {},
        onSendNew: () => {},
        onDiscard: () => {},
        onRename: () => {},
        onDelete: () => {},
        onRetry: () => {},
        onEdit: () => {},
        onStop: () => {},
        onJump: () => {},
        recovering: new Set<string>(),
        blocks: new Map<string, string>(),
        focusNonce: 0,
        error: null,
      }),
    );
  });
}

describe("the migrated bands render the DOM the baseline recorded", () => {
  it("draws Search's band exactly as Chrome saw it before the migration", async () => {
    await mountSearch();
    expectShape(SEARCH);
  });

  it("draws Chat's open conversation exactly as Chrome saw it before the migration", async () => {
    await mountChat("chat");
    expectShape(CHAT);
  });

  it("keeps Remember's extra class and its own name", async () => {
    /* The conditional half of `feature`. A migration that passed `"chat"`
       unconditionally would leave every Remember rule in the stylesheet
       matching nothing, and every test above would still be green. */
    await mountChat("remember");
    expectShape(REMEMBER);
  });

  it("draws Search's band for a visitor, without the box an owner gets", async () => {
    await mountSearchVisitor();
    expectShape(SEARCH_VISITOR);
  });

  it("draws Chat's thread list, which is a different band body", async () => {
    await mountChatList();
    expectShape(CHAT_LIST);
  });
});

/* --------------------------------------------------- ModeSurface, directly */

async function mountSurface(props: {
  head?: ReactNode;
  foot?: ReactNode;
  feature?: string | undefined;
  children: ReactNode;
}): Promise<void> {
  await act(async () => {
    root.render(
      createElement(ModeSurface, {
        label: "A band",
        feature: "made-up",
        ...props,
      }),
    );
  });
}

describe("ModeSurface adds no DOM of its own", () => {
  it("puts head, children and foot side by side, with nothing wrapping any of them", async () => {
    await mountSurface({
      head: createElement("h2", null, "A title"),
      children: [
        createElement("div", { key: "a", className: "first" }),
        createElement("div", { key: "b", className: "second" }),
      ],
      foot: createElement("div", { className: "a-foot" }),
    });

    /* The header row is the surface's one piece of markup; everything else is
       passed through untouched and in order. A `.band-body` or a `.band-foot`
       between the band and any of these is the regression. */
    expect(childSignatures(band())).toEqual(["div.band-head", "div.first", "div.second", "div.a-foot"]);
    expect(band().querySelector(".band-head")?.firstElementChild?.tagName).toBe("H2");
  });

  it("renders no .band-head at all when there is no head", async () => {
    /* Not "an empty one is fine". Several bands style their first child by
       position, so an empty `.band-head` would shift every one of them down a
       slot — and being empty, it would be invisible on screen while doing it. */
    await mountSurface({ children: createElement("div", { className: "only" }) });

    expect(band().querySelector(".band-head")).toBeNull();
    expect(childSignatures(band())).toEqual(["div.only"]);
  });

  /**
   * `head={cond ? <X/> : null}` and `head={cond && <X/>}` are how a panel with a
   * conditional header gets written, and they hand this component `null` and
   * **`false`** respectively — never `undefined`. Both must mean "no header".
   *
   * `false` is the case that was actually broken: the guard read `head != null`,
   * which `false` satisfies, so the surface rendered an empty `.band-head`.
   * Nothing on screen, one extra slot in front of every band that styles its
   * first child by position — and no caller in stage 1 passes a conditional
   * head, so it would have surfaced in stage 2 as a mode with its body shifted
   * down for no visible reason. Found by reading, 2026-09-06.
   *
   * `true` is here because the fix for `false` was **also** too narrow, and the
   * comment above it claimed to cover "all four of React's nothing values" while
   * covering three. React renders `true` as nothing as well. The guard is now
   * `typeof head !== "boolean"`, which is a fact about React rather than a list
   * of the cases somebody thought of. GPT Sol F15, 2026-09-06.
   */
  for (const [name, value] of [
    ["null", null],
    ["false", false],
    ["true", true],
  ] as const) {
    it(`treats a ${name} head the same as an absent one`, async () => {
      await mountSurface({ head: value, children: createElement("div", { className: "only" }) });

      expect(band().querySelector(".band-head")).toBeNull();
      expect(childSignatures(band())).toEqual(["div.only"]);
    });
  }

  /**
   * The two bands with no hook class at all — `PublicChrome`'s visitor band and
   * `FeatureBoundary`'s fallback — are a bare `<aside className="mode-band">`.
   *
   * A plain `` `mode-band ${feature}` `` yields `"mode-band "` for those, with a
   * trailing space. `classList` forgives it and so does every `querySelector` in
   * the app, which is exactly why it would have survived to stage 2 and landed
   * as a one-character diff in the one band this component has to be able to
   * absorb. Asserted on the attribute string, because that is the only check
   * that can see it.
   */
  for (const [name, value] of [
    ["omitted", undefined],
    ["an empty string", ""],
  ] as const) {
    it(`writes a bare "mode-band" when feature is ${name}`, async () => {
      await mountSurface({ feature: value, children: createElement("div", { className: "only" }) });

      expect(band().getAttribute("class")).toBe("mode-band");
    });
  }
});

/* ================================================================ stage 2 ==

   The eleven bands stage 2 migrated, as they stood before it. Every literal
   below was recorded at commit e4952ecb, while all eleven were still
   hand-written asides — see the provenance section at the top of this file. */

/**
 * **The article every panel below is given** — two paragraphs under a heading,
 * and a two-node tree, which is the smallest shape that gives Outline a row to
 * draw and Summary a child to fold.
 */
const PARAGRAPH =
  "The instrument was built before anybody could say what it would measure, and the theory followed it.";
const SECOND = "A later chapter revisits the same episode from the other side.";
const QUOTE_LINE = "before anybody could say what it would measure";
const SLUG = "a-piece";

const BLOCKS: Block[] = [
  {
    id: "spya-aaaaaa" as BlockId,
    tag: "h1",
    kind: "heading",
    level: 1,
    text: "A piece",
    words: 2,
    html: "<h1>A piece</h1>",
    gistable: false,
  },
  {
    id: "spya-bbbbbb" as BlockId,
    tag: "p",
    kind: "text",
    text: PARAGRAPH,
    words: 17,
    html: `<p>${PARAGRAPH}</p>`,
    gistable: true,
  },
  {
    id: "spya-cccccc" as BlockId,
    tag: "p",
    kind: "text",
    text: SECOND,
    words: 11,
    html: `<p>${SECOND}</p>`,
    gistable: true,
  },
];

const TREE: Article["tree"] = {
  version: "test",
  generator: "test",
  slug: SLUG,
  rootId: "n0",
  nodes: {
    n0: {
      id: "n0",
      depth: 0,
      parent: null,
      children: ["n1"],
      range: ["spya-aaaaaa" as BlockId, "spya-cccccc" as BlockId],
      title: "A piece",
      gist: "The piece says the instruments came first.",
    },
    n1: {
      id: "n1",
      depth: 1,
      parent: "n0",
      children: [],
      range: ["spya-bbbbbb" as BlockId, "spya-cccccc" as BlockId],
      title: "The instrument came first",
      gist: "Where the argument finally lands.",
    },
  },
};

const GEOMETRY = buildGeometry(TREE, BLOCKS);
const ROOT = buildSummaryTree(TREE, BLOCKS, GEOMETRY.leafDepth);

const GLOSSARY: Glossary = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  entries: [
    {
      id: "spya-term23",
      name: "Kolmogorov depth",
      kind: "concept",
      aliases: [],
      senseHere: "How much work it took to build the thing.",
      blocks: ["spya-bbbbbb" as BlockId],
    },
  ],
  passes: 1,
  generatedAt: "2026-09-01T09:00:00.000Z",
  elapsedMs: 1,
};

const IDEAS: Ideas = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  ideas: [
    {
      id: "spya-kdea34",
      name: "Instruments outrun explanation",
      provenance: "assumed",
      statement: "You cannot theorise about what you have no way to measure.",
      occurrences: [
        {
          blockId: "spya-bbbbbb" as BlockId,
          quote: "The instrument was built",
          reasoning: "It rests on it.",
        },
      ],
    },
  ],
  generatedAt: "2026-09-01T09:00:00.000Z",
  elapsedMs: 1,
};

const QUOTES: Quotes = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  quotes: [
    {
      id: "spya-qte234",
      blockId: "spya-bbbbbb" as BlockId,
      text: QUOTE_LINE,
      start: PARAGRAPH.indexOf(QUOTE_LINE),
      reason: "It is the sentence the whole chapter turns on.",
      /* **0–1, not 0–100.** These were 90 and 80, which `score()` in
         src/quotes.ts refuses outright — the fixture is hand-built and so
         bypasses `place`, and nothing downstream read the numbers, so it sat
         here looking plausible. It is read now: `quoteTier` drives how heavily
         the passage is outlined in the prose, and 90 would have made this
         fixture claim a priority no real quote can have. */
      importance: 0.9,
      striking: 0.8,
    },
  ],
  discarded: { unfound: 0, otherVoice: 0, wrongLength: 0, overlapping: 0, overCap: 0, malformed: 0 },
  generatedAt: "2026-09-01T09:00:00.000Z",
  elapsedMs: 1,
};

/**
 * **Three events, and the number is load-bearing.**
 *
 * Under `A_CHRONOLOGY` (3) the panel adds a `<p class="gloss-quiet tl-thin">`
 * saying the piece has barely a chronology — a fourth direct child that a
 * one-event fixture would have pinned as if it were the ordinary body. Three is
 * the populated shape a reader with a real article sees.
 */
const TIMELINE: Timeline = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  events: [1, 2, 3].map((n) => ({
    id: `spya-evt23${n}`,
    label: `The Vienna calibration, part ${n}`,
    dating: { kind: "words" as const, phrase: "before the theory" },
    order: n,
    modality: "happened" as const,
    occurrences: [
      { blockId: "spya-bbbbbb" as BlockId, quote: "The instrument was built", start: 0 },
    ],
  })),
  orderConflicts: 0,
  generatedAt: "2026-09-01T09:00:00.000Z",
  elapsedMs: 1,
};

const NO_LOSSES: DebateLosses = {
  uncited: 0,
  selfSource: 0,
  unverifiedSource: 0,
  directnessUnverified: 0,
  sourceIsCopy: 0,
  claimNotInBlock: 0,
  unknownBlockId: 0,
  malformed: 0,
};
const COUNTS: DebateCounts = {
  returnedSources: 1,
  reportedRows: 1,
  keptRows: 1,
  omittedOverCap: 0,
  lost: NO_LOSSES,
  webSearches: 1,
};

const DEBATE: Debate = {
  version: "test",
  generator: "test",
  slug: SLUG,
  sourceHash: "hash",
  searchedAt: "2026-09-01T09:00:00.000Z",
  direct: {
    rows: [
      {
        id: "spya-dbt234",
        url: "https://example.org/leiden",
        title: "The Leiden replication",
        sourceQuote: "We could not reproduce the calibration.",
        relation: "disputes",
        lean: "leans-against",
        applies: "A replication in Leiden reached the opposite reading.",
        articleReferenceQuote: "The instrument was built",
        identifies: [{ kind: "named", by: "title", witness: "The instrument was built" }],
      },
    ],
    counts: COUNTS,
  },
  claims: { rows: [], counts: { ...COUNTS, returnedSources: 0, reportedRows: 0, keptRows: 0 } },
  elapsedMs: 1,
};

const QUIZ: Quiz = {
  version: "test",
  generator: "test",
  slug: SLUG,
  batchId: "spya-btc234",
  sourceHash: "hash",
  questions: [
    {
      id: "spya-qst234" as QuizQuestionId,
      question: "What came first, the instrument or the theory?",
      referenceAnswer: "The instrument, and the theory followed it.",
      evidence: [
        { blockId: "spya-bbbbbb" as BlockId, quote: "The instrument was built", start: 0 },
      ],
      band: "easy",
      value: 3,
    },
  ],
  dropped: {
    unknownIds: 0,
    unquoted: 0,
    truncated: 0,
    overCap: 0,
    malformed: 0,
    duplicate: 0,
    unanchored: 0,
  },
  generatedAt: "2026-09-01T09:00:00.000Z",
  elapsedMs: 1,
};

/** One node, so the sketch paints something rather than its empty state. */
const SKETCH: PublicSketch = {
  title: "One instrument, one claim",
  caption: "The measurement is doing the arguing.",
  scenes: [
    {
      id: "s0",
      title: "Overview",
      height: 200,
      items: [
        {
          kind: "node",
          id: "n1",
          shape: "box",
          x: 10,
          y: 10,
          w: 140,
          h: 40,
          text: "The calibrated rig",
          size: "md",
          block: "spya-bbbbbb" as BlockId,
        },
      ],
    },
  ],
};

/* ------------------------------------------------- the reader, for Referee --

   The whole reading view, served the article above and one saved criterion.
   Only Referee needs it. */

const OWNED: Article = {
  blocks: BLOCKS,
  tree: TREE,
  assets: undefined,
  navLabelStatus: "ready",
  meta: { slug: SLUG, title: "A piece", url: "https://example.com/a" },
};

const CRITERIA = [
  {
    id: "spya-crt234",
    criterion: "every claim that rests on a single study",
    config: { kind: "single" },
    createdAt: "2026-09-02T09:00:00.000Z",
    status: "done",
    results: [],
  },
];

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

/**
 * **Every request any of these mounts makes.**
 *
 * Most panels below are handed their artefact as a prop and ask for nothing;
 * the two that do fetch are Diagram, whose owner arm loads its own sketch, and
 * the reader. Anything unrecognised gets an empty object, which is enough for
 * the hooks that only want a shape.
 */
function serve(url: string, method: string): Response {
  if (method !== "GET") return new Response(null, { status: 204 });
  if (url === `/api/article/${SLUG}`) return json(OWNED);
  if (url === "/api/reader") return json({ experimentalSince: "2026-01-01T00:00:00.000Z" });
  if (url === "/api/jobs") return json({ jobs: [] });
  if (url.startsWith("/api/comments/")) return json({ comments: [] });
  if (url.startsWith("/api/referee/criteria/"))
    return json({ criteria: CRITERIA, sourceHash: "hash" });
  if (url.startsWith("/api/sketch/"))
    return json({ sketch: SKETCH, stale: false, outdated: false, profileChanged: false });
  return json({});
}

async function settle(turns = 6): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/** The whole app at the owner's article, exactly as `main.tsx` mounts it. */
async function mountReader(search: string): Promise<void> {
  history.replaceState(null, "", `/read/${SLUG}${search}`);
  await act(async () => {
    root.render(createElement(NuqsAdapter, null, createElement(App, null)));
  });
  await act(async () => {
    for (const fn of [...authListeners]) fn("SIGNED_IN", { user: OWNER });
  });
  await settle();
}

/**
 * The mode band, in a page that has a second `<aside>` — the spine.
 *
 * Found positionally rather than by `.mode-band`, for the reason `band()` gives:
 * a band that had stopped being a landmark should fail here rather than pass by
 * having kept its class. The spine is asserted by name so that "two asides"
 * cannot be satisfied by two bands.
 */
function refereeBand(): HTMLElement {
  const asides = [...host.querySelectorAll("aside")];
  expect(asides.map((a) => a.getAttribute("class")?.split(" ")[0]), "the reader's asides").toEqual([
    "spine",
    "mode-band",
  ]);
  return asides[1] as HTMLElement;
}

/* ------------------------------------------------------------ the owners --

   Each panel's owner arm is the hook's whole return value, so these builders
   fill it in with the quiet state — nothing running, nothing failed, no
   profile — and take the artefact as their one argument. `null` is the state
   before the artefact has arrived, which is where five of the six empty
   `.band-head` rows below come from. */

function glossaryOwner(glossary: Glossary | null): GlossaryOwner {
  return {
    status: glossary ? "ready" : "loading",
    glossary,
    stale: false,
    outdated: false,
    profiled: false,
    profileChanged: false,
    hasProfile: false,
    slug: SLUG,
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    find: async () => {},
    more: async () => {},
    cancel: () => {},
    look: async () => {},
    looking: null,
    lookFailed: null,
    ask: async () => {},
    asking: false,
    askDraft: null,
    asked: null,
    askFailed: null,
    clearAsked: () => {},
  };
}

function ideasOwner(ideas: Ideas | null): IdeasOwner {
  return {
    status: ideas ? "ready" : "loading",
    ideas,
    stale: false,
    outdated: false,
    profiled: false,
    profileChanged: false,
    hasProfile: false,
    slug: SLUG,
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    ensure: async () => {},
    regenerate: async () => {},
    cancel: () => {},
  };
}

function quotesOwner(quotes: Quotes | null): QuotesOwner {
  return {
    status: quotes ? "ready" : "loading",
    quotes,
    stale: false,
    outdated: false,
    profiled: false,
    profileChanged: false,
    hasProfile: false,
    slug: SLUG,
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    ensure: async () => {},
    regenerate: async () => {},
    cancel: () => {},
  };
}

function timelineOwner(timeline: Timeline | null): TimelineOwner {
  return {
    status: timeline ? "ready" : "loading",
    timeline,
    stale: false,
    outdated: false,
    slug: SLUG,
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    ensure: async () => {},
    regenerate: async () => {},
    cancel: () => {},
  };
}

function debateOwner(debate: Debate | null): DebateOwner {
  return {
    status: debate ? "ready" : "loading",
    debate,
    stale: false,
    outdated: false,
    slug: SLUG,
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    ensure: async () => {},
    regenerate: async () => {},
    cancel: () => {},
  };
}

function quizOwner(quiz: Quiz | null): UseQuiz {
  return {
    status: quiz ? "ready" : "none",
    quiz,
    stale: false,
    outdated: false,
    slug: SLUG,
    error: null,
    job: null,
    failed: null,
    starting: false,
    stalled: false,
    attempt: null,
    answered: new Set<QuizQuestionId>(),
    ensure: async () => {},
    write: async () => {},
    cancel: () => {},
    mark: async () => {},
    clearAttempt: () => {},
  };
}

const noop = () => {};

/* ------------------------------------------------------------ the mounts --

   One function per shape, so the fixture that produces a shape sits next to the
   shape and nobody has to guess which state a literal was read in. */

function mountVisitor(): ReactNode {
  return createElement(VisitorBand, {
    gap: { kind: "owners-only", feature: "the glossary" },
    signedIn: false,
  });
}

function mountSummary(): ReactNode {
  return createElement(SummaryPanel, {
    root: ROOT,
    deep: 1,
    onDeep: noop,
    atRow: 0,
    onJump: noop,
  });
}

function mountGlossary(access: GlossaryAccess): ReactNode {
  return createElement(GlossaryPanel, {
    access,
    termId: null,
    onTerm: noop,
    sort: "prioritised",
    onSort: noop,
    gate: null,
    onGate: noop,
    onJump: noop,
    ...(access.kind === "owner" ? { onAskChat: noop } : {}),
  });
}

function mountIdeas(ideas: Ideas | null): ReactNode {
  return createElement(IdeasPanel, {
    access: { kind: "owner", owner: ideasOwner(ideas), ideas },
    ideaId: null,
    onIdea: noop,
    found: [],
    openKey: null,
    onOpenKey: noop,
    onJump: noop,
  });
}

function mountQuotes(quotes: Quotes | null): ReactNode {
  return createElement(QuotesPanel, {
    access: { kind: "owner", owner: quotesOwner(quotes), quotes },
    quoteId: null,
    onQuote: noop,
    rank: "document",
    onRank: noop,
    bar: null,
    onBar: noop,
    onJump: noop,
  });
}

function mountTimeline(timeline: Timeline | null): ReactNode {
  return createElement(TimelinePanel, {
    access: { kind: "owner", owner: timelineOwner(timeline) },
    eventId: null,
    onEvent: noop,
    found: [],
    openKey: null,
    onOpenKey: noop,
    onJump: noop,
  });
}

function mountDebate(debate: Debate | null): ReactNode {
  return createElement(DebatePanel, {
    access: { kind: "owner", owner: debateOwner(debate) },
    onJump: noop,
    level: null,
    onLevel: noop,
  });
}

/**
 * Quiz, always with a `subMode` control.
 *
 * `RememberBand` (src/web/modes/conversation/ConversationModes.tsx) passes
 * one on every render, so a Quiz band with an
 * empty header is not a state a reader can reach — but the prop is optional, so
 * one *is* a state a refactor can create by accident. **`QUIZ_NO_SUBMODE` is
 * what guards that**; this helper pins the production shape.
 *
 * An earlier version of this comment pointed at `treats a true head the same as
 * an absent one` instead. That test is about `ModeSurface`'s guard in isolation
 * and says nothing about Quiz, so the case was in fact unguarded until GPT Sol's
 * F25 on 2026-09-07.
 */
function mountQuiz(quiz: Quiz | null): ReactNode {
  return createElement(QuizPanel, {
    owner: quizOwner(quiz),
    subMode: createElement("div", { className: "rmb-sub" }),
    blocks: new Map<string, string>([["spya-bbbbbb", PARAGRAPH]]),
    onJump: noop,
  });
}

function mountDiagram(access: DiagramAccess): ReactNode {
  return createElement(DiagramPanel, {
    access,
    experimental: false,
    slug: SLUG,
    root: ROOT,
    kind: "sketch",
    onKind: noop,
    atRow: 0,
    onJump: noop,
    blocks: BLOCKS,
    axis: "spread",
    onAxis: noop,
    hue: "section",
    onHue: noop,
  });
}

function mountOutline(): ReactNode {
  return createElement(OutlinePanel, {
    root: ROOT,
    supplementOf: GEOMETRY.supplementOf,
    arcByRow: null,
    focusRow: 0,
    proseBeside: true,
    paragraphLabels: true,
    onJump: noop,
  });
}

/** Render, then let the panels that fetch on mount settle. */
async function paint(node: ReactNode): Promise<void> {
  await act(async () => {
    root.render(node);
  });
  await act(async () => {
    await new Promise((go) => setTimeout(go, 0));
  });
}

/* ------------------------------------------------------------ the shapes --

   Every literal below was printed by rendering the panel as it stands at
   8cef3161, before any stage-2 edit. See the provenance section at the top. */

const VISITOR: BandShape = {
  className: "mode-band",
  label: "Not available on a shared link",
  head: false,
  /* **The one band with no hook class**, and the one whose only child is a
     Tailwind utility box rather than a named region — so there is no class here
     a stylesheet could be keeping alive, and the whole of it is this string.
     `signedIn` changes what is *inside* that box and not the band's own
     children, so there is one shape rather than two. */
  children: [
    "div.tw:flex.tw:flex-1.tw:flex-col.tw:justify-center.tw:gap-3.tw:px-4.tw:py-6.tw:text-sm.tw:text-ink-faint",
  ],
};

/* Summary is one of the three bands with no header at all, and `root: null`
   draws the same two children with a sentence inside the scroller — so the
   empty tree is not a second shape. */
const SUMMARY: BandShape = {
  className: "mode-band summ",
  label: "Summary",
  head: false,
  children: ["div.summ-controls", "div.summ-scroll"],
};

const GLOSSARY_SHAPE: BandShape = {
  className: "mode-band gloss",
  label: "Glossary",
  head: true,
  children: ["div.band-head", "div.gloss-ask", "div.gloss-list", "div.gloss-foot"],
  /* `WrittenForYou` is in this row too and renders nothing for an owner who has
     not run with a profile, which is this fixture. The count is the row. */
  headChildren: ["span.gloss-count"],
};

/**
 * **Glossary before the glossary has arrived — and the header is EMPTY.**
 *
 * Both of the header's children are gated on `glossary` being non-null
 * (`GlossaryPanel.tsx` — the `.gloss-count` span and `WrittenForYou`), so what
 * ships today in this state is `<div class="band-head"></div>` with nothing in
 * it. That is the exact inverse of the defect stage 1 fixed: `ModeSurface`
 * deliberately renders **no** header for an absent, null or boolean `head`, so
 * the migration that reads naturally — `head={glossary && <span/>}` — hands it
 * `null` and **deletes a row the reader has today**.
 *
 * Nothing in the suite could see that before this literal existed. The shape
 * stage 2 has to write is a fragment that is always present, with the
 * conditionals inside it.
 */
const GLOSSARY_LOADING: BandShape = {
  className: "mode-band gloss",
  label: "Glossary",
  head: true,
  children: ["div.band-head", "div.gloss-ask", "p.gloss-quiet"],
  headChildren: [],
};

/**
 * The same band on a shared link: no ask-chat box and no run row, because both
 * are the owner's. Two children where an owner has four, which is a difference
 * in the band's own children and therefore worth its own literal.
 */
const GLOSSARY_VISITOR: BandShape = {
  className: "mode-band gloss",
  label: "Glossary",
  head: true,
  children: ["div.band-head", "div.gloss-list"],
  headChildren: ["span.gloss-count"],
};

const IDEAS_SHAPE: BandShape = {
  className: "mode-band gloss ideas",
  label: "Ideas",
  head: true,
  children: ["div.band-head", "div.ideas-scroll", "div.ideas-again"],
  headChildren: ["span.gloss-count"],
};

/** Empty header, for the same reason as Glossary's — both children are gated on
 *  `ideas`. And the body drops from three children to two. */
const IDEAS_LOADING: BandShape = {
  className: "mode-band gloss ideas",
  label: "Ideas",
  head: true,
  children: ["div.band-head", "p.gloss-quiet"],
  headChildren: [],
};

const QUOTES_SHAPE: BandShape = {
  className: "mode-band quotes",
  label: "Quotes",
  head: true,
  children: ["div.band-head", "div.quotes-list", "div.quotes-foot"],
  headChildren: ["span.quotes-count"],
};

/** Empty header again. */
const QUOTES_LOADING: BandShape = {
  className: "mode-band quotes",
  label: "Quotes",
  head: true,
  children: ["div.band-head", "p.quotes-quiet"],
  headChildren: [],
};

const TIMELINE_SHAPE: BandShape = {
  className: "mode-band gloss timeline",
  label: "Timeline",
  head: true,
  children: ["div.band-head", "div.tl-scroll", "div.tl-again"],
  headChildren: ["span.gloss-count"],
};

/** Empty header again — the count is Timeline's only header child. */
const TIMELINE_LOADING: BandShape = {
  className: "mode-band gloss timeline",
  label: "Timeline",
  head: true,
  children: ["div.band-head", "p.gloss-quiet"],
  headChildren: [],
};

/**
 * Debate, and its header is the one that **cannot** come out empty: the globe
 * and the `<h2>` are unconditional, and only the count is gated.
 *
 * The icon's signature is long because `lucide-react` writes its presentation
 * attributes onto the `<svg>`. Recorded rather than trimmed — an icon that
 * stopped being `aria-hidden` is exactly the sort of change this file is for.
 *
 * `.dbt-bar` is the identification threshold, and it sits **above the scroller
 * and outside it**, where every other threshold in this app sits. It is drawn
 * only when group one has rows, which is why `DEBATE_LOADING` below has no
 * trace of it — a slider over an empty group is a control that cannot change
 * anything. See `NameBar` in `src/web/DebatePanel.tsx`.
 */
const DEBATE_SHAPE: BandShape = {
  className: "mode-band gloss dbt",
  label: "Debate",
  head: true,
  children: [
    "div.band-head",
    "p.dbt-frame",
    "div.dbt-bar",
    "div.dbt-scroll",
    "div.dbt-again",
  ],
  headChildren: [
    "svg.lucide.lucide-globe.band-head-icon[aria-hidden,fill,height,stroke,stroke-linecap,stroke-linejoin,stroke-width,viewBox,width,xmlns]",
    "h2",
    "span.gloss-count",
  ],
};

/** The same header minus its count — not empty, which is what makes Debate the
 *  control for the five bands whose headers do empty out. */
const DEBATE_LOADING: BandShape = {
  className: "mode-band gloss dbt",
  label: "Debate",
  head: true,
  children: ["div.band-head", "p.gloss-quiet"],
  headChildren: [
    "svg.lucide.lucide-globe.band-head-icon[aria-hidden,fill,height,stroke,stroke-linecap,stroke-linejoin,stroke-width,viewBox,width,xmlns]",
    "h2",
  ],
};

const QUIZ_SHAPE: BandShape = {
  className: "mode-band gloss quiz",
  label: "Quiz",
  head: true,
  children: ["div.band-head", "div.quiz-one", "div.quiz-rewrite"],
  headChildren: ["div.rmb-sub"],
};

/**
 * Quiz with **no** `subMode`, which is the one shape that pins Quiz's trap.
 *
 * `subMode` is an optional prop and it is Quiz's *only* header child, so
 * `head={subMode}` hands `ModeSurface` `undefined` and the row disappears
 * instead of sitting empty. Every other Quiz shape here supplies one, and
 * `tests/quiz-panel.test.tsx` omits it but never looks at `.band-head` — so
 * before this shape existed, changing Quiz to the conditional form left the
 * whole suite green while deleting a row. That is exactly the regression the
 * fragment was written to prevent, and it was unpinned. GPT Sol F25,
 * 2026-09-07.
 *
 * Not a state a reader reaches — `RememberBand` always passes one — but very
 * much a state the next refactor can create, which is what this file is for.
 */
const QUIZ_NO_SUBMODE: BandShape = {
  className: "mode-band gloss quiz",
  label: "Quiz",
  head: true,
  children: ["div.band-head", "div.quiz-one", "div.quiz-rewrite"],
  headChildren: [],
};

/** No questions written yet: the one question and the rewrite footer are
 *  replaced by a single empty-state box. */
const QUIZ_NONE: BandShape = {
  className: "mode-band gloss quiz",
  label: "Quiz",
  head: true,
  children: ["div.band-head", "div.gloss-empty"],
  headChildren: ["div.rmb-sub"],
};

/**
 * **Diagram's header is empty in the shape a reader normally sees.**
 *
 * Its only child is the scatter's caveat, which renders on the two projected
 * pictures and not on the Sketch — and Sketch is the default and the only
 * picture an unexperimental owner is offered. So this is not an edge state like
 * Glossary's: it is the ordinary one.
 */
const DIAGRAM_SHAPE: BandShape = {
  className: "mode-band diag",
  label: "Diagram",
  head: true,
  children: ["div.band-head", "div.diag-kinds[aria-label,role]", "div.sk"],
  headChildren: [],
};

/** A visitor gets no picker at all — not a hidden one — so the band is two
 *  children rather than three. */
const DIAGRAM_VISITOR: BandShape = {
  className: "mode-band diag",
  label: "Diagram",
  head: true,
  children: ["div.band-head", "div.sk"],
  headChildren: [],
};

/**
 * **The band `ModeSurface`'s attribute passthrough exists for.**
 *
 * `data-outline-rung` is written on the `<aside>` itself, so this is the one
 * shape whose `attrs` is more than two names — and the reason
 * `BandShape.attrs` is per-shape. Its *value* is a measurement and is
 * deliberately not pinned; `signature` and `attrs` both record names.
 *
 * **Two deliberate changes on 2026-09-10**, when this list became Structure
 * mode's narrow face (docs/plans/260910g-structure-mode-subsumes-outline.md):
 * the label is the mode's name, `Structure`, and `data-outline-clamp` joined
 * the rung as the second half of what the fit chose — whether titles had to
 * be cut to one line to fit (OutlinePanel.tsx § `fit`).
 */
const OUTLINE: BandShape = {
  className: "mode-band outln",
  label: "Structure",
  head: false,
  attrs: ["aria-label", "class", "data-outline-clamp", "data-outline-rung"],
  children: [
    "ol.outln-list[aria-activedescendant,aria-label,role,tabindex]",
    "div.outln-measure[aria-hidden]",
  ],
};

/**
 * Referee, which is the one band that is not a component anybody can mount.
 *
 * `RefereeBand` lives in `src/web/modes/referee/RefereeMode.tsx` (it was an
 * unexported function inside `App.tsx` until 2026-09-06), and this shape is
 * still read through the whole reader — see `mountReader` below — with `parent`
 * standing in for the whole-output check the other ten get.
 */
const REFEREE: BandShape = {
  className: "mode-band gloss referee",
  label: "Referee",
  head: true,
  parent: ".reader",
  children: ["div.band-head", "div.ref-brief", "div.ref-views[aria-label,role]", "div.ref-panel"],
  /* The mode's name went in September; the row stays for the "how this works"
     button, which is unconditional — so Referee's header is the second that
     cannot empty out. */
  headChildren: ["button.ref-how-btn[aria-expanded,type]"],
};

describe("the bands stage 2 migrated, as they stood before it", () => {
  it("draws the visitor's band, the one with no hook class", async () => {
    await paint(mountVisitor());
    expectShape(VISITOR);
  });

  it("draws Summary's band, which has no header row at all", async () => {
    await paint(mountSummary());
    expectShape(SUMMARY);
  });

  it("draws Glossary's band with its list, its ask box and its footer", async () => {
    await paint(mountGlossary({ kind: "owner", owner: glossaryOwner(GLOSSARY), glossary: GLOSSARY }));
    expectShape(GLOSSARY_SHAPE);
  });

  it("draws Glossary's band with an EMPTY header while the glossary is still coming", async () => {
    await paint(mountGlossary({ kind: "owner", owner: glossaryOwner(null), glossary: null }));
    expectShape(GLOSSARY_LOADING);
  });

  it("draws Glossary's band for a visitor, without the owner's box or footer", async () => {
    await paint(mountGlossary({ kind: "visitor", glossary: GLOSSARY }));
    expectShape(GLOSSARY_VISITOR);
  });

  it("draws Ideas' band with its scroller and its run-again footer", async () => {
    await paint(mountIdeas(IDEAS));
    expectShape(IDEAS_SHAPE);
  });

  it("draws Ideas' band with an EMPTY header while the ideas are still coming", async () => {
    await paint(mountIdeas(null));
    expectShape(IDEAS_LOADING);
  });

  it("draws Quotes' band with its list and its footer", async () => {
    await paint(mountQuotes(QUOTES));
    expectShape(QUOTES_SHAPE);
  });

  it("draws Quotes' band with an EMPTY header while the quotes are still coming", async () => {
    await paint(mountQuotes(null));
    expectShape(QUOTES_LOADING);
  });

  it("draws Timeline's band with its scroller and its run-again footer", async () => {
    await paint(mountTimeline(TIMELINE));
    expectShape(TIMELINE_SHAPE);
  });

  it("draws Timeline's band with an EMPTY header while the events are still coming", async () => {
    await paint(mountTimeline(null));
    expectShape(TIMELINE_LOADING);
  });

  it("draws Debate's band, whose header cannot come out empty", async () => {
    await paint(mountDebate(DEBATE));
    expectShape(DEBATE_SHAPE);
  });

  it("keeps Debate's icon and title in the header with nothing else to say", async () => {
    await paint(mountDebate(null));
    expectShape(DEBATE_LOADING);
  });

  it("draws Quiz's band with a question and its rewrite footer", async () => {
    await paint(mountQuiz(QUIZ));
    expectShape(QUIZ_SHAPE);
  });

  it("draws Quiz's band with the empty state where the question was", async () => {
    await paint(mountQuiz(null));
    expectShape(QUIZ_NONE);
  });

  it("keeps Quiz's header row even with no sub-mode control to put in it", async () => {
    /* The shape that pins the trap — see `QUIZ_NO_SUBMODE`. Without it, moving
       Quiz to `head={subMode}` deletes the row and nothing anywhere goes red.

       A mount of its own rather than a parameter on `mountQuiz`: a default
       parameter is chosen by `undefined`, so `mountQuiz(QUIZ, undefined)` would
       have handed the panel the default sub-mode and pinned the wrong shape —
       which is what the first attempt at this test did, and what it caught
       about itself. The prop is genuinely absent here. */
    await paint(
      createElement(QuizPanel, {
        owner: quizOwner(QUIZ),
        blocks: new Map<string, string>([["spya-bbbbbb", PARAGRAPH]]),
        onJump: noop,
      }),
    );
    expectShape(QUIZ_NO_SUBMODE);
  });

  it("draws Diagram's band with an empty header, which is its ordinary shape", async () => {
    await paint(mountDiagram({ kind: "owner" }));
    expectShape(DIAGRAM_SHAPE);
  });

  it("draws Diagram's band for a visitor, with no picker at all", async () => {
    await paint(mountDiagram({ kind: "visitor", sketch: SKETCH }));
    expectShape(DIAGRAM_VISITOR);
  });

  it("draws Outline's band, carrying data-outline-rung on the aside itself", async () => {
    await paint(mountOutline());
    expectShape(OUTLINE);
  });

  it("draws Referee's band, through the whole reader", async () => {
    await mountReader("?mode=referee");
    expectShape(REFEREE, refereeBand());
  }, 60_000);
});
