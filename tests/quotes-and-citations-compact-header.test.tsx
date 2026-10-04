// @vitest-environment jsdom
/**
 * **The top of the Quotes and Citations bands, folded into the order row** —
 * the move tests/glossary-compact-header.test.tsx pins for Glossary, made twice
 * more. Greg, 2026-09-10 (`spya-gcdwps`): *"I can't use the Quotes or Glossary
 * modes very well on landscape iPhone because all the stuff at the top of their
 * columns takes up the vertical real estate"*; and 2026-09-30 (`spya-nca765`),
 * of Citations: the count *"maybe there's a more space-efficient way to say"*,
 * and the footer explanation *"could be inside an information icon tooltip"*.
 * docs/plans/261001l-compact-quotes-and-citations-band-tops-and-click-a-diagram-to-enlarge.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BlockId, Citations, CitedWork, Quote, Quotes } from "../src/types.js";
import type { QuoteRank, CiteOrder } from "../src/web/params.js";
import type { QuotesOwner } from "../src/web/QuotesPanel.js";
import type { UseCitations } from "../src/web/useCitations.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* src/web/lib/api.ts reaches supabase at module scope — the stub
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

const { QuotesPanel } = await import("../src/web/QuotesPanel.js");
const { CitationsPanel, CAPPED_NOTE, INFLUENCE_NOTE } = await import("../src/web/CitationsPanel.js");

const noop = () => {};
const BLOCK = "spya-k3m9qt" as BlockId;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const head = () => host.querySelector(".band-head");
const tip = () => document.querySelector('[role="tooltip"], [role="dialog"]')?.textContent ?? null;

/** Open the band's (i), read its card, and close it again. */
async function quotesAbout(): Promise<string> {
  const button = host.querySelector<HTMLButtonElement>(".mode-band > .band-about");
  if (!button) throw new Error("the band has no (i)");
  await act(async () => button.click());
  const text = tip() ?? "";
  await act(async () => button.click());
  return text;
}

/* ----------------------------------------------------------------- Quotes -- */

function quote(i: number, importance: number, striking: number): Quote {
  return { id: `spya-q${String(i).padStart(4, "0")}`, blockId: BLOCK, text: `Line ${i} of the piece.`, importance, striking };
}

function quotes(list: Quote[], profileHash: string | null = null): Quotes {
  return {
    version: "quotes/6",
    generator: "m",
    slug: "writes",
    sourceHash: "h",
    profileHash,
    quotes: list,
    discarded: { unfound: 0, otherVoice: 0, wrongLength: 0, overlapping: 0, overCap: 0, malformed: 0 },
    generatedAt: "2026-09-11T00:00:00.000Z",
    elapsedMs: 1,
    passes: 1,
    lastAdded: list.length,
  };
}

function quotesOwner(q: Quotes, profiled = false): QuotesOwner {
  return {
    status: "ready",
    quotes: q,
    stale: false,
    outdated: false,
    profiled,
    profileChanged: false,
    slug: "writes",
    error: null,
    retryRead: async () => {},
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    ensure: async () => {},
    regenerate: async () => {},
    cancel: noop,
  };
}

async function mountQuotes(o: QuotesOwner, rank: QuoteRank): Promise<void> {
  await act(async () =>
    root.render(
      createElement(QuotesPanel, {
        access: { kind: "owner", owner: o, quotes: o.quotes },
        quoteId: null,
        onQuote: noop,
        rank,
        onRank: noop,
        bar: null,
        onBar: noop,
        onJump: noop,
        steps: [],
      }),
    ),
  );
}

const THREE = [quote(1, 0.9, 0.2), quote(2, 0.5, 0.8), quote(3, 0.2, 0.3)];

describe("the Quotes band's top", () => {
  it("has no head row while the rank row is drawn, and no 'order' word in front of it", async () => {
    await mountQuotes(quotesOwner(quotes(THREE)), "document");
    expect(host.querySelector(".quotes-rank"), "no rank row to fold into").not.toBeNull();
    expect(head()).toBeNull();
    expect(host.querySelector(".quotes-rank")?.textContent).not.toMatch(/^order/);
  });

  /* The count went to the band's (i) on 2026-10-01 — Greg (spya-ucu35y):
     *"how many X (of y)"* in the (i); plan 261001m. */
  it("says the count in the band's (i), not on the rank row; prioritised keeps its n of m", async () => {
    await mountQuotes(quotesOwner(quotes(THREE)), "document");
    expect(host.querySelector(".quotes-rank")?.textContent).not.toContain("3 quotes");
    expect(await quotesAbout()).toContain("3 quotes.");

    /* In prioritised the bar row already says "n of 3". */
    await mountQuotes(quotesOwner(quotes(THREE)), "prioritised");
    expect(host.textContent).not.toContain("3 quotes");
    expect(host.querySelector(".quotes-bar-value")?.textContent).toContain("of 3");
  });

  /* At the rank row's end from 2026-10-01; in the band's corner beside the (i)
     since 2026-10-02, as in every mode (plan 261002e). */
  it("carries the profile badge as an icon in the band's corner, outside the group", async () => {
    await mountQuotes(quotesOwner(quotes(THREE, "p"), true), "prioritised");
    const badge = host.querySelector(".mode-band > .prof-badge");
    expect(badge, "no profile badge in the band's corner").not.toBeNull();
    expect(host.querySelector(".quotes-rank .prof-badge")).toBeNull();
    expect(host.querySelector('[role="group"] .prof-badge')).toBeNull();
    expect(badge?.textContent?.trim()).toBe("");
  });

  it("keeps the head row when there is no rank row, with the count in the (i)", async () => {
    await mountQuotes(quotesOwner(quotes([quote(1, 0.9, 0.2)])), "document");
    expect(host.querySelector(".quotes-rank")).toBeNull();
    expect(head()).not.toBeNull();
    expect(head()?.textContent).not.toContain("1 quote");
    expect(await quotesAbout()).toContain("One quote.");
  });

  it("puts the discarded sentence and who chose them in the (i), not above the list", async () => {
    const q: Quotes = {
      ...quotes(THREE),
      discarded: { unfound: 2, otherVoice: 0, wrongLength: 0, overlapping: 0, overCap: 0, malformed: 0 },
    };
    await mountQuotes(quotesOwner(q), "document");
    expect(host.textContent).not.toContain("dropped");
    const card = await quotesAbout();
    expect(card).toContain("2 suggestions were dropped because the words are not in the article.");
    expect(card).toMatch(/Written by /);
  });
});

/* -------------------------------------------------------------- Citations -- */

function work(id: string, title: string, relevance: number, influence: number): CitedWork {
  return {
    id,
    title,
    key: `work:${title}`,
    why: "What the piece uses it for.",
    mentions: [],
    citedAt: [BLOCK],
    firstCited: BLOCK,
    citedInBody: true,
    url: "https://doi.org/10.1000/xyz",
    linkFrom: "doi",
    relevance,
    influence,
  };
}

const WORKS = [
  work("spya-a2b3c4", "Central", 0.8, 0.8),
  work("spya-d5e6f7", "Famous", 0.3, 0.9),
  work("spya-g8h9j2", "Passing", 0.2, 0.2),
];

function citations(list: CitedWork[], capped = false): Citations {
  return {
    version: "test",
    generator: "test",
    slug: "a-piece",
    sourceHash: "hash",
    citations: list,
    capped,
    generatedAt: "2026-09-11T09:00:00.000Z",
    elapsedMs: 1,
  };
}

function citeOwner(c: Citations): UseCitations {
  return {
    status: "ready",
    citations: c,
    stale: false,
    outdated: false,
    slug: "a-piece",
    error: null,
    retryRead: async () => {},
    job: null,
    failed: null,
    stalled: false,
    starting: false,
    automatic: false,
    ensure: async () => {},
    regenerate: async () => {},
    cancel: noop,
    findNote: null,
    investigating: null,
    investigateStage: null,
    investigateDraft: null,
    investigateFailed: null,
    investigate: async () => {},
  };
}

async function mountCitations(o: UseCitations, order: CiteOrder): Promise<void> {
  await act(async () =>
    root.render(
      createElement(CitationsPanel, {
        access: { kind: "owner", owner: o },
        order,
        onOrder: noop,
        bar: null,
        onBar: noop,
        onJump: noop,
      }),
    ),
  );
}

/* The band's (i), in its corner since 261001m; it was at the order row's end. */
const ABOUT = ".mode-band > .band-about";
/** What the band's (i) says, opened and closed again. */
async function citeCard(): Promise<string> {
  const about = host.querySelector<HTMLButtonElement>(ABOUT);
  expect(about, "no (i) in the band's corner").not.toBeNull();
  await act(async () => about?.click());
  const text = tip() ?? "";
  await act(async () => about?.click());
  return text;
}

describe("the Citations band's top and foot", () => {
  it("has no head row while the order row is drawn, and the count in the (i) rather than on the band", async () => {
    await mountCitations(citeOwner(citations(WORKS)), "prioritised");
    expect(host.querySelector(".gloss-sort"), "no order row to fold into").not.toBeNull();
    expect(head()).toBeNull();
    expect(host.textContent).not.toContain("3 works");

    await mountCitations(citeOwner(citations(WORKS)), "document");
    expect(head()).toBeNull();
    expect(host.textContent).not.toContain("3 works");
    expect(await citeCard()).toContain("3 works cited.");
  });

  it("puts the two notes behind the band's (i), and draws no foot for them", async () => {
    await mountCitations(citeOwner(citations(WORKS, true)), "prioritised");
    expect(host.querySelector(".cite-foot"), "an idle list still has a foot").toBeNull();
    expect(host.textContent).not.toContain(INFLUENCE_NOTE);

    const about = host.querySelector<HTMLButtonElement>(ABOUT);
    expect(about, "no (i) in the band's corner").not.toBeNull();
    await act(async () => about?.click());
    expect(tip()).toContain(INFLUENCE_NOTE);
    expect(tip()).toContain(CAPPED_NOTE);
    await act(async () => about?.click());
  });

  it("says nothing about capping when the model did not cap", async () => {
    await mountCitations(citeOwner(citations(WORKS)), "prioritised");
    const about = host.querySelector<HTMLButtonElement>(ABOUT);
    await act(async () => about?.click());
    expect(tip()).toContain(INFLUENCE_NOTE);
    expect(tip()).not.toContain(CAPPED_NOTE);
    await act(async () => about?.click());
  });

  it("keeps an empty head row, and the count in the band's (i), when there is no order row", async () => {
    await mountCitations(citeOwner(citations([work("spya-a2b3c4", "Only", 0.8, 0.8)])), "prioritised");
    expect(host.querySelector(".gloss-sort")).toBeNull();
    expect(head()).not.toBeNull();
    expect(await citeCard()).toContain("1 work cited.");
  });
});

/* -------------------------------------------------- the other states -------
   GPT Sol's review of the plan, findings 3 and 4: the fold hinges on "is there
   an order row", which a legacy list with several unscored items answers no,
   and on the fragment that keeps the head row while a list loads; and the
   Citations foot, now only a job's status, must still show it wherever it
   showed before — and once. */

describe("the states the fold depends on", () => {
  it("keeps Quotes' head row, its count in the (i), for several unscored quotes that offer one order", async () => {
    const legacy = [1, 2, 3].map((i) => ({ id: `spya-q000${i}`, blockId: BLOCK, text: `Line ${i}.` }));
    await mountQuotes(quotesOwner(quotes(legacy)), "document");
    expect(host.querySelector(".quotes-rank")).toBeNull();
    expect(head()).not.toBeNull();
    expect(await quotesAbout()).toContain("3 quotes.");
  });

  it("keeps an empty head row while Quotes and Citations load", async () => {
    await mountQuotes({ ...quotesOwner(quotes(THREE)), status: "loading", quotes: null }, "document");
    expect(head()).not.toBeNull();
    await mountCitations({ ...citeOwner(citations(WORKS)), status: "loading", citations: null }, "document");
    expect(head()).not.toBeNull();
  });

  it("keeps Citations' head row, and the count in the band's (i), for several unscored works that offer one order", async () => {
    const legacy = WORKS.map(({ relevance: _r, influence: _i, ...w }) => w);
    await mountCitations(citeOwner(citations(legacy)), "document");
    expect(host.querySelector(".gloss-sort")).toBeNull();
    expect(head()).not.toBeNull();
    expect(await citeCard()).toContain("3 works cited.");
  });

  it("gives a visitor the folded rows: Quotes' count with no badge, Citations' (i)", async () => {
    await act(async () =>
      root.render(
        createElement(QuotesPanel, {
          access: { kind: "visitor", quotes: quotes(THREE) },
          quoteId: null,
          onQuote: noop,
          rank: "document",
          onRank: noop,
          bar: null,
          onBar: noop,
          onJump: noop,
          steps: [],
        }),
      ),
    );
    expect(head()).toBeNull();
    const visitorCard = await quotesAbout();
    expect(visitorCard).toContain("3 quotes.");
    expect(visitorCard).not.toContain("Written by");
    expect(host.querySelector(".prof-badge")).toBeNull();

    await act(async () =>
      root.render(
        createElement(CitationsPanel, {
          access: {
            kind: "visitor",
            /* The public boundary narrows `linkFrom` by excluding the owner's
               private `web` result; this fixture is explicitly a DOI list. */
            citations: {
              citations: WORKS.map((work) => ({
                id: work.id,
                title: work.title,
                why: work.why,
                mentions: work.mentions,
                citedAt: work.citedAt,
                firstCited: work.firstCited,
                citedInBody: work.citedInBody,
                url: work.url ?? "https://doi.org/10.1000/xyz",
                linkFrom: "doi" as const,
                relevance: work.relevance ?? 0,
                influence: work.influence ?? 0,
              })),
              capped: false,
            },
          },
          order: "prioritised",
          onOrder: noop,
          bar: null,
          onBar: noop,
          onJump: noop,
        }),
      ),
    );
    expect(head()).toBeNull();
    expect(host.querySelector(ABOUT)).not.toBeNull();
    expect(host.querySelector(".cite-foot")).toBeNull();
  });

  const RUNNING = {
    id: "job-citations",
    ownerId: "owner",
    slug: "a-piece",
    status: "running",
    createdAt: "2026-09-29T00:00:00.000Z",
    startedAt: "2026-09-29T00:00:01.000Z",
    steps: [{ name: "citations", label: "Finding the citations", status: "running" }],
  } as unknown as NonNullable<UseCitations["job"]>;
  const FAILED = { message: "The citations could not be found.", retryable: false, retry: null };

  for (const [name, over] of [
    ["current", {}],
    ["outdated", { outdated: true }],
  ] as const) {
    it(`shows a ${name} list's running, starting and failed job in the foot, once`, async () => {
      for (const job of [{ job: RUNNING }, { starting: true }, { failed: FAILED }]) {
        await mountCitations({ ...citeOwner(citations(WORKS)), ...over, ...job }, "prioritised");
        expect(host.querySelectorAll(":scope > aside > .cite-foot"), JSON.stringify(Object.keys(job))).toHaveLength(1);
      }
      expect(host.querySelector(".cite-foot")?.textContent).toContain(FAILED.message);
    });
  }

  it("shows a stale list's job in its banner, and not in a foot", async () => {
    await mountCitations({ ...citeOwner(citations(WORKS)), stale: true, job: RUNNING }, "prioritised");
    expect(host.querySelector(".cite-foot")).toBeNull();
    expect(host.querySelector(".gloss-stale")?.textContent).toContain("Stop");
  });
});
