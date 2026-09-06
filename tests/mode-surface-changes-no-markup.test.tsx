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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ModeSurface } from "../src/web/ModeSurface.js";
import { SearchPanel } from "../src/web/SearchPanel.js";
import { assignSlots } from "../src/web/hit-colours.js";
import type { Found } from "../src/web/search-hits.js";
import type { ChatThread } from "../src/types.js";

/* The profile hook fetches on mount and none of this is about the profile —
   the same stub tests/remember-panel.test.tsx uses to mount `ChatPanel`. */
vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));

const { ChatPanel } = await import("../src/web/ChatPanel.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
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
function expectShape(shape: BandShape): void {
  const el = band();

  expect(el.tagName).toBe("ASIDE");
  expect(el.getAttribute("class")).toBe(shape.className);
  expect(el.getAttribute("aria-label")).toBe(shape.label);

  /* **The band is the whole of what the panel renders**, so a wrapper *around*
     the `<aside>` — or anything beside it — fails here. Without this, `band()`
     finds the aside wherever it is and every other assertion passes happily
     underneath an added `<div>` that has broken `.reader > .mode-band`.

     `childNodes`, not `children`: a bare string rendered next to the band is a
     text node, and `children` cannot see one. Sol F20. */
  expect([...host.childNodes], "the panel renders the band and nothing else").toEqual([el]);

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
