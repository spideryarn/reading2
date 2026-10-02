// @vitest-environment jsdom
/**
 * **The top of the Glossary band, made shorter for a phone** — Greg's two
 * reports of 2026-09-29, `[SPIDERYARN-READING2-4G]` and `-4H`, and
 * docs/plans/260929a-compact-glossary-header-and-kind-icons.md.
 *
 * - no head row while the sort row is drawn; the head row back when there is
 *   no sort row, holding the band's corner; the term count in the band's (i)
 *   since 2026-10-01 (plan 261001m); the profile badge at the sort row's end
 *   until 2026-10-02, and in the band's corner beside the (i) since (plan
 *   261002e);
 * - no "order" word, and no hint line under the Look up box — its "not added
 *   to the list" is in the button's tooltip;
 * - the kind of a term as an icon with a label, and none for `concept`.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GlossaryAccess, GlossaryOwner } from "../src/web/GlossaryPanel.js";
import type { TermSort } from "../src/web/params.js";
import type { BlockId, Glossary, GlossaryEntry, Job } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* src/web/lib/api.ts reaches supabase at module scope — the same stub
   tests/quotes-find-more-panel.test.tsx installs. */
vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "t" } } }),
      refreshSession: async () => ({ data: { session: { access_token: "t" } } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      signOut: async () => ({ error: null }),
    },
  },
  googleSignInAvailable: false,
}));

const { GlossaryPanel } = await import("../src/web/GlossaryPanel.js");

const noop = () => {};

function entry(
  id: string,
  name: string,
  kind: GlossaryEntry["kind"],
  scores: { difficulty?: number; centrality?: number } = {},
): GlossaryEntry {
  return {
    id,
    name,
    kind,
    aliases: [],
    senseHere: `What ${name} means here.`,
    blocks: ["spya-bbbbbb" as BlockId],
    ...scores,
  };
}

function glossary(profileHash: string | null, entries: GlossaryEntry[]): Glossary {
  return {
    version: "test",
    generator: "test",
    slug: "constitution",
    sourceHash: "hash",
    profileHash,
    entries,
    passes: 1,
    generatedAt: "2026-09-01T09:00:00.000Z",
    elapsedMs: 1,
  };
}

/** Scored, so every sort is on offer and the sort row is drawn. */
const SCORED = [
  entry("spya-term31", "The Republic", "work", { difficulty: 0.8, centrality: 0.9 }),
  entry("spya-term32", "Kolmogorov depth", "concept", { difficulty: 0.7, centrality: 0.6 }),
  entry("spya-term33", "Ada Lovelace", "person", { difficulty: 0.5, centrality: 0.4 }),
  entry("spya-term34", "entropy", "term", { difficulty: 0.9, centrality: 0.8 }),
];

function owner(list: Glossary, over: Partial<GlossaryOwner>): GlossaryOwner {
  return {
    status: "ready",
    glossary: list,
    stale: false,
    outdated: false,
    profiled: list.profileHash != null,
    profileChanged: false,
    slug: "constitution",
    error: null,
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    find: async () => {},
    more: async () => {},
    refresh: async () => {},
    cancel: noop,
    look: async () => false,
    setHidden: async () => {},
    hiding: new Set<string>(),
    looking: null,
    lookFailed: null,
    lookDraft: null,
    lookKept: null,
    ask: async () => {},
    asking: false,
    askDraft: null,
    asked: null,
    askFailed: null,
    askTerm: null,
    clearAsked: noop,
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;

async function mountAccess(
  access: GlossaryAccess,
  sort: TermSort = "prioritised",
): Promise<void> {
  await act(async () => {
    root.render(
      createElement(GlossaryPanel, {
        access,
        termId: null,
        onTerm: noop,
        sort,
        onSort: noop,
        gate: null,
        onGate: noop,
        onJump: noop,
        onAskChat: noop,
      }),
    );
  });
}

async function mount(view: GlossaryOwner, sort: TermSort = "prioritised"): Promise<void> {
  await mountAccess({ kind: "owner", owner: view, glossary: view.glossary }, sort);
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Open the band's (i) and read its card; closes it again so the next read starts shut. */
async function aboutCard(): Promise<string> {
  const button = host.querySelector<HTMLButtonElement>(".mode-band > .band-about");
  if (!button) throw new Error("the band has no (i)");
  await act(async () => button.click());
  const text = document.querySelector('[role="tooltip"], [role="dialog"]')?.textContent ?? "";
  await act(async () => button.click());
  return text;
}

describe("the head row", () => {
  it("keeps exactly one total and owner badge, in the one row each state permits", async () => {
    const legacy = glossary("a-profile", [
      entry("spya-old001", "legacy one", "term"),
      entry("spya-old002", "legacy two", "concept"),
    ]);
    const partial = glossary("a-profile", [
      entry("spya-part01", "partial one", "term", { difficulty: 0.8 }),
      entry("spya-part02", "partial two", "work", { difficulty: 0.5 }),
    ]);
    const empty = glossary("a-profile", []);
    const one = glossary("a-profile", [SCORED[0]!]);
    const many = glossary("a-profile", SCORED);
    const cases: {
      name: string;
      access: GlossaryAccess;
      sort?: TermSort;
      counts: number;
      badges: number;
      head: boolean;
      sortRow: boolean;
      gate: boolean;
    }[] = [
      {
        name: "owner loading",
        access: {
          kind: "owner",
          owner: owner(empty, { status: "loading", glossary: null }),
          glossary: null,
        },
        counts: 0,
        badges: 0,
        head: true,
        sortRow: false,
        gate: false,
      },
      {
        name: "owner ready, no entries",
        access: { kind: "owner", owner: owner(empty, {}), glossary: empty },
        counts: 0,
        badges: 1,
        head: true,
        sortRow: false,
        gate: false,
      },
      {
        name: "owner ready, one entry",
        access: { kind: "owner", owner: owner(one, {}), glossary: one },
        counts: 0,
        badges: 1,
        head: true,
        sortRow: false,
        gate: false,
      },
      {
        name: "legacy list with no useful sort choice",
        access: { kind: "owner", owner: owner(legacy, {}), glossary: legacy },
        counts: 0,
        badges: 1,
        head: true,
        sortRow: false,
        gate: false,
      },
      {
        name: "prioritised URL falling back to document order",
        access: { kind: "owner", owner: owner(partial, {}), glossary: partial },
        counts: 0,
        badges: 1,
        head: false,
        sortRow: true,
        gate: false,
      },
      {
        name: "owner prioritised",
        access: { kind: "owner", owner: owner(many, {}), glossary: many },
        counts: 1,
        badges: 1,
        head: false,
        sortRow: true,
        gate: true,
      },
      {
        name: "owner in another order",
        access: { kind: "owner", owner: owner(many, {}), glossary: many },
        sort: "document",
        counts: 0,
        badges: 1,
        head: false,
        sortRow: true,
        gate: false,
      },
      {
        name: "visitor",
        access: { kind: "visitor", glossary: many },
        counts: 1,
        badges: 0,
        head: false,
        sortRow: true,
        gate: true,
      },
      {
        name: "stale owner",
        access: { kind: "owner", owner: owner(many, { stale: true }), glossary: many },
        counts: 1,
        badges: 1,
        head: false,
        sortRow: true,
        gate: true,
      },
      {
        name: "outdated owner",
        access: { kind: "owner", owner: owner(many, { outdated: true }), glossary: many },
        counts: 1,
        badges: 1,
        head: false,
        sortRow: true,
        gate: true,
      },
    ];

    for (const state of cases) {
      await mountAccess(state.access, state.sort);
      expect(
        host.querySelectorAll(".gloss-count, .gloss-gate-value"),
        `${state.name}: total`,
      ).toHaveLength(state.counts);
      expect(host.querySelectorAll(".prof-badge"), `${state.name}: badge`).toHaveLength(
        state.badges,
      );
      expect(host.querySelector(".band-head") !== null, `${state.name}: head`).toBe(state.head);
      expect(host.querySelector(".gloss-sort") !== null, `${state.name}: sort row`).toBe(
        state.sortRow,
      );
      expect(host.querySelector(".gloss-gate") !== null, `${state.name}: threshold`).toBe(
        state.gate,
      );
    }
  });

  /* The badge was at the sort row's end from 2026-09-29; since 2026-10-02 it is
     in the band's corner beside the (i), as in every mode (plan 261002e,
     spya-hf4svm). */
  it("is gone while the sort row is drawn, and the badge is in the band's corner", async () => {
    await mount(owner(glossary("a-profile", SCORED), {}));
    expect(host.querySelector(".band-head")).toBeNull();
    expect(host.querySelectorAll("button.prof-badge")).toHaveLength(1);
    expect(host.querySelector(".mode-band > button.prof-badge")).not.toBeNull();
    expect(host.querySelector(".gloss-sort .prof-badge")).toBeNull();
    /* Not inside the named group, so it is not announced as an order. */
    expect(host.querySelector('[role="group"] .prof-badge')).toBeNull();
    /* Prioritised says the total on the threshold row, as "n of 4". */
    expect(host.querySelector(".gloss-count")).toBeNull();
    expect(host.querySelector(".gloss-gate-value")?.textContent).toMatch(/of 4$/);
  });

  /* The count went to the band's (i) on 2026-10-01 — Greg (spya-ucu35y):
     *"how many X (of y)"* in the (i); plan 261001m. Prioritised's "n of m"
     beside its slider stays (above). */
  it("says the count in the band's (i), not on the sort row, in an order with no threshold row", async () => {
    await mount(owner(glossary("a-profile", SCORED), {}), "document");
    expect(host.querySelector(".band-head")).toBeNull();
    expect(host.querySelector(".gloss-gate")).toBeNull();
    expect(host.querySelector(".gloss-count")).toBeNull();
    expect(host.querySelector(".mode-band > button.prof-badge")).not.toBeNull();
    expect(await aboutCard()).toContain("4 terms.");
  });

  it("says who wrote the list in the (i), and nothing about it for a visitor", async () => {
    await mount(owner(glossary("a-profile", SCORED), {}));
    expect(await aboutCard()).toMatch(/Written by test \(test\)/);
    await mountAccess({ kind: "visitor", glossary: glossary(null, SCORED) });
    const card = await aboutCard();
    expect(card).toContain("4 terms.");
    expect(card).not.toContain("Written by");
  });

  it("draws the badge as an icon, and its panel says in words what it means", async () => {
    await mount(owner(glossary("a-profile", SCORED), { profileChanged: true }));
    const badge = host.querySelector<HTMLButtonElement>("button.prof-badge");
    expect(badge?.classList.contains("icon-only")).toBe(true);
    expect(badge?.textContent).toBe("");
    expect(badge?.getAttribute("aria-label")).toMatch(/profile you have changed/);
    expect(badge?.querySelector(".lucide-user-round-pen")).not.toBeNull();
    await act(async () => badge?.click());
    expect(document.querySelector(".prof-panel-note")?.textContent).toMatch(
      /before you last changed it/,
    );
  });

  it("leaves the sort row's end empty in prioritised for a list written without a profile", async () => {
    await mount(owner(glossary(null, SCORED), {}));
    expect(host.querySelector(".gloss-sort")).not.toBeNull();
    expect(host.querySelector(".prof-badge")).toBeNull();
  });

  it("comes back, holding the corner, when there is no sort row; the count is in the (i)", async () => {
    await mount(owner(glossary("a-profile", [SCORED[0]!]), {}));
    expect(host.querySelector(".gloss-sort")).toBeNull();
    const head = host.querySelector(".band-head");
    expect(head).not.toBeNull();
    expect(head?.querySelector(".gloss-count")).toBeNull();
    expect(host.querySelector(".mode-band > button.prof-badge")).not.toBeNull();
    expect(await aboutCard()).toContain("One term.");
  });

  it("does not say 'order' in front of the sort buttons, but still names the group", async () => {
    await mount(owner(glossary(null, SCORED), {}));
    const group = host.querySelector('.gloss-sort [role="group"]');
    expect(group?.getAttribute("aria-label")).toBe("Order the terms by");
    expect(group?.textContent).not.toMatch(/^order/);
  });
});

describe("the Look up box", () => {
  it("has no hint line under it, and the button's tooltip says the answer is not added", async () => {
    await mount(owner(glossary(null, SCORED), {}));
    const ask = host.querySelector(".gloss-ask");
    expect(ask?.textContent).not.toMatch(/Not added to the list/);
    const button = ask?.querySelector<HTMLButtonElement>("button[type=submit]");
    expect(button?.title).toMatch(/Not added to the list/);
  });
});

describe("the kind of a term", () => {
  it("is an icon with a label for a work or a person, and nothing for a concept or a term", async () => {
    await mount(owner(glossary(null, SCORED), {}));
    const kindOf = (id: string) =>
      host.querySelector(`[data-term-id="${id}"] .gloss-kind[role="img"]`);
    expect(kindOf("spya-term31")?.getAttribute("aria-label")).toMatch(/^A work — a book, paper/);
    expect(kindOf("spya-term31")?.getAttribute("title")).toBe(kindOf("spya-term31")?.getAttribute("aria-label"));
    expect(kindOf("spya-term31")?.textContent).toBe("");
    expect(kindOf("spya-term33")?.getAttribute("aria-label")).toBe("A person");
    expect(kindOf("spya-term32")).toBeNull();
    expect(kindOf("spya-term34")).toBeNull();
  });
});

/* **An older prompt is not announced** — Greg, 2026-09-29
   (SPIDERYARN-READING2-55): *"perhaps even don't bother showing it."* And with
   no banner, *Find more* must not stand in for it: on an outdated list the run
   it sends replaces the list rather than appending (src/glossary.ts §
   existingFor), so it is hidden, as Quotes hides its own. A job or a failure
   still shows in the foot. docs/plans/260929c-no-notice-when-a-mode-was-made-by-an-older-prompt.md. */
describe("an outdated glossary", () => {
  const RUNNING: Job = {
    id: "job-glossary",
    ownerId: "owner" as Job["ownerId"],
    slug: "constitution",
    status: "running",
    createdAt: "2026-09-29T00:00:00.000Z",
    startedAt: "2026-09-29T00:00:01.000Z",
    steps: [
      {
        name: "glossary",
        label: "Working on glossary",
        status: "running",
        startedAt: "2026-09-29T00:00:01.000Z",
      },
    ],
  };
  const findMore = () =>
    [...host.querySelectorAll("button")].some((b) => /find more/i.test(b.textContent ?? ""));

  it("says nothing about it, and offers no Find more", async () => {
    await mount(owner(glossary(null, SCORED), { outdated: true }));
    expect(host.querySelector(".gloss-stale")).toBeNull();
    expect(host.textContent).not.toContain("different version of the glossary");
    expect(findMore()).toBe(false);
  });

  it("still shows a running job, and a failure, in the foot", async () => {
    await mount(owner(glossary(null, SCORED), { outdated: true, job: RUNNING }));
    expect(host.querySelector(".gloss-foot")?.textContent).toContain("Stop");
    await mount(
      owner(glossary(null, SCORED), {
        outdated: true,
        failed: { message: "The re-run failed visibly.", retryable: false, retry: null },
      }),
    );
    expect(host.querySelector(".gloss-foot")?.textContent).toContain("The re-run failed visibly.");
  });

  it("keeps the stale banner, and a current list keeps Find more", async () => {
    await mount(owner(glossary(null, SCORED), { stale: true }));
    expect(host.querySelector(".gloss-stale")?.textContent).toContain("older version of the article");
    await mount(owner(glossary(null, SCORED), {}));
    expect(findMore()).toBe(true);
  });
});
