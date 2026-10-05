// @vitest-environment jsdom
/**
 * **A reader's own highlights, as rows in the Quotes band — and who and when on
 * every row.** Greg, 2026-10-03 (spya-ma5h9b):
 *
 * > highlights show up alongside quotes. They should obviously have a different
 * > color if it's from me, and they should have a tooltip. Actually, quotes
 * > should as well, maybe saying when it was applied and whether it's AI
 * > generated or human highlights.
 *
 * docs/plans/261003h-your-highlights-as-rows-in-quotes-and-who-and-when-on-every-row.md.
 * The ordering is tests/quote-band-rows.test.ts; this file is the mounted
 * panel, and what it pins is each place a reader's row could quietly become a
 * quote: counted by the bar, hidden by it, selected by `?quote=`, walked by the
 * stepper, or handed to a visitor.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { useQueryState } from "nuqs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { QuotesAccess, QuotesOwner } from "../src/web/QuotesPanel.js";
import type { BlockId, Comment, Quote, Quotes } from "../src/types.js";
import { readerRowComments } from "../src/web/quote-band-rows.js";
import { exactly } from "../src/web/relative-time.js";
import { noteParam, quoteParam } from "../src/web/params.js";
import { jumpToComment } from "../src/web/comment-jump.js";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/* src/web/lib/api.ts reaches supabase at module scope — the stub
   tests/mode-surface-changes-no-markup.test.tsx installs. */
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

const { QuotesPanel, barNote } = await import("../src/web/QuotesPanel.js");

const noop = () => {};

const A = "spya-aaaaaa" as BlockId;
const B = "spya-bbbbbb" as BlockId;
const BLOCKS = [{ id: A }, { id: B }];

const MONDAY = "2026-09-28T09:10:00.000Z";
const TUESDAY = "2026-09-29T14:02:00.000Z";
const SAVED = "2026-10-03T14:02:00.000Z";

/** High enough to clear the default bar, stamped with its own time. */
const STRONG: Quote = {
  id: "spya-qqqq22",
  blockId: A,
  text: "Entropy is not disorder; it is the number of ways.",
  reason: "The definition everything after it leans on.",
  importance: 0.9,
  addedAt: MONDAY,
};
/** Below the default bar, and stored before `addedAt` existed. */
const WEAK: Quote = {
  id: "spya-qqqq33",
  blockId: B,
  text: "The second law, read this way, says only that.",
  importance: 0.1,
};

const HL_PLAIN = "spya-hgha22";
const HL_NOTED = "spya-hgha33";

const COMMENTS: Comment[] = [
  { id: HL_PLAIN, blockId: A, quote: "the variance of the estimator falls", start: 40, colour: "yellow", createdAt: SAVED, status: "none" },
  { id: HL_NOTED, blockId: B, quote: "which is why the bound is tight", start: 12, colour: "pink", body: "is it, though?", createdAt: SAVED, status: "none" },
  /* Neither of these is a row: no colour, and a Referee placement. */
  { id: "spya-hgha44", blockId: B, quote: "an uncoloured note", start: 1, body: "hm", createdAt: SAVED, status: "none" },
  { id: "spya-hgha55", blockId: B, quote: "a referee's placement", start: 2, colour: "blue", criterionId: "c1", createdAt: SAVED, status: "none" },
];

function list(over: Partial<Quotes> = {}): Quotes {
  return {
    version: "quotes/6",
    generator: "m",
    slug: "writes",
    sourceHash: "h",
    profileHash: null,
    quotes: [STRONG, WEAK],
    discarded: { unfound: 0, otherVoice: 0, wrongLength: 0, overlapping: 0, overCap: 0, malformed: 0 },
    generatedAt: TUESDAY,
    elapsedMs: 1,
    passes: 1,
    lastAdded: 2,
    ...over,
  };
}

function owner(quotes: Quotes | null, over: Partial<QuotesOwner> = {}): QuotesOwner {
  return {
    status: quotes ? "ready" : "none",
    quotes,
    stale: false,
    outdated: false,
    profiled: false,
    profileChanged: false,
    slug: "writes",
    error: null,
    retryRead: async () => {},
    job: null,
    loaded: true,
    failed: null,
    stalled: false,
    starting: false,
    ensure: async () => {},
    regenerate: async () => {},
    cancel: noop,
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  /* jsdom has no `CSS.escape`, which `jumpToComment` reaches through `whereIsBlock`. */
  (globalThis as { CSS?: unknown }).CSS = { escape: (s: string) => s };
  window.history.replaceState(null, "", "/read/writes");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

type Rank = "document" | "prioritised" | "importance" | "striking";

async function mount(opts: {
  quotes?: Quotes | null;
  rank?: Rank;
  comments?: Comment[];
  quoteId?: string | null;
  steps?: readonly Quote[];
  onQuote?(id: string | null): void;
  onOpen?(id: string): void;
  access?: QuotesAccess;
}): Promise<void> {
  const quotes = opts.quotes === undefined ? list() : opts.quotes;
  const access: QuotesAccess = opts.access ?? {
    kind: "owner",
    owner: owner(quotes),
    quotes,
    yours: {
      rows: readerRowComments(opts.comments ?? COMMENTS),
      blocks: BLOCKS,
      onOpen: opts.onOpen ?? noop,
    },
  };
  await act(async () =>
    root.render(
      createElement(QuotesPanel, {
        access,
        quoteId: opts.quoteId ?? null,
        onQuote: opts.onQuote ?? noop,
        rank: opts.rank ?? "document",
        onRank: noop,
        bar: null,
        onBar: noop,
        onJump: noop,
        steps: opts.steps ?? [],
      }),
    ),
  );
}

const rows = () => [...host.querySelectorAll<HTMLElement>(".quotes-list li.quotes-row")];
const yours = () => [...host.querySelectorAll<HTMLElement>("li.quotes-row-yours")];
const words = (row: HTMLElement) => row.querySelector("blockquote")?.textContent ?? "";

/** Press a row's ⓘ and read the card it opens. */
async function card(row: HTMLElement): Promise<HTMLElement> {
  const button = row.querySelector<HTMLButtonElement>("button.quotes-why");
  expect(button).not.toBeNull();
  await act(async () => button?.click());
  const tip = document.querySelector<HTMLElement>(".tooltip");
  expect(tip).not.toBeNull();
  return tip!;
}

describe("a reader's rows", () => {
  it("are drawn among the model's, in their colour, and say they are yours", async () => {
    await mount({});
    /* By block, the reader's first inside one — quote-band-rows.ts. */
    expect(rows().map(words)).toEqual([
      "the variance of the estimator falls",
      STRONG.text,
      "which is why the bound is tight",
      WEAK.text,
    ]);
    expect(yours().map((row) => row.dataset.colour)).toEqual(["yellow", "pink"]);
    for (const row of yours()) {
      expect(row.querySelector(".quotes-yours")?.textContent).toBe("yours");
      expect(row.querySelector("blockquote.quotes-text")).not.toBeNull();
    }
  });

  it("carry nothing that belongs to a quote: no quote-row id, no scores, never selected", async () => {
    /* Even with a `?quote=` that happens to be a highlight's own id. */
    await mount({ rank: "importance", quoteId: HL_PLAIN });
    for (const row of yours()) {
      expect(row.hasAttribute("data-quote-row")).toBe(false);
      expect(row.classList.contains("on")).toBe(false);
      expect(row.querySelector(".quotes-scores, .score-bar")).toBeNull();
      expect(row.querySelector("button.quotes-quote")?.hasAttribute("aria-pressed")).toBe(false);
    }
    /* The model's rows still carry theirs. */
    expect(host.querySelectorAll("li[data-quote-row]")).toHaveLength(2);
  });

  it("mark the one that has a note, keyed from its body", async () => {
    await mount({});
    const [plain, noted] = yours();
    expect(plain?.querySelector(".quotes-yours-noted")).toBeNull();
    expect(noted?.querySelector(".quotes-yours-noted")).not.toBeNull();
  });

  it("come first as a group when the list is ranked by a score", async () => {
    await mount({ rank: "importance" });
    expect(rows().map((row) => row.classList.contains("quotes-row-yours"))).toEqual([true, true, false, false]);
  });
});

describe("the bar", () => {
  it("never hides a reader's row, and counts only the model's — with the reader's beside it", async () => {
    await mount({ rank: "prioritised" });
    /* WEAK (0.1) is under the default bar; both highlights are still here. */
    expect(rows().map(words)).toEqual([
      "the variance of the estimator falls",
      STRONG.text,
      "which is why the bound is tight",
    ]);
    expect(host.querySelector(".quotes-bar-value")?.textContent).toContain("1 of 2 + 2 yours");
    /* The foot line is the model's list's, word for word what it was. */
    expect(host.querySelector(".quotes-bar-note")?.textContent).toBe(barNote(1, 2));
    expect(host.querySelector<HTMLInputElement>("#quotes-bar")?.getAttribute("aria-valuetext")).toContain("showing 1 of 2 quotes");
  });

  it("says nothing about yours when there are none", async () => {
    await mount({ rank: "prioritised", comments: [] });
    expect(host.querySelector(".quotes-bar-value")?.textContent).toContain("1 of 2");
    expect(host.querySelector(".quotes-bar-value")?.textContent).not.toContain("yours");
  });
});

describe("who and when, on every row", () => {
  it("gives every row the ⓘ, with or without a reason", async () => {
    await mount({});
    expect(rows()).toHaveLength(4);
    for (const row of rows()) expect(row.querySelector("button.quotes-why")).not.toBeNull();
  });

  it("says the AI chose a quote, and when — under the model's reason", async () => {
    await mount({});
    const tip = await card(rows()[1]!);
    expect(tip.textContent).toContain(STRONG.reason);
    expect(tip.querySelector(".quotes-prov")?.textContent).toBe(`Chosen by the AI · ${exactly(MONDAY)}`);
  });

  it("says on or before the list's time for a quote stored without its own", async () => {
    await mount({});
    const tip = await card(rows()[3]!);
    expect(tip.querySelector(".quotes-prov")?.textContent).toBe(
      `Chosen by the AI · on or before ${exactly(TUESDAY)}`,
    );
  });

  it("says a reader's row is their highlight and when it was saved, with their note above", async () => {
    await mount({});
    const tip = await card(yours()[1]!);
    expect(tip.querySelector(".quotes-yours-note")?.textContent).toBe("is it, though?");
    expect(tip.querySelector(".quotes-prov")?.textContent).toBe(`Your highlight · saved ${exactly(SAVED)}`);
    /* The reader's card is not the model's: it must not take the model's face. */
    expect(tip.classList.contains("quotes-why-card")).toBe(false);
  });
});

describe("before there is a quote list", () => {
  it("shows the reader's rows anyway, above the offer to choose the quotes", async () => {
    await mount({ quotes: null });
    expect(yours().map(words)).toEqual([
      "the variance of the estimator falls",
      "which is why the bound is tight",
    ]);
    expect(host.querySelector(".quotes-empty")?.textContent).toContain("Choose the quotes");
    const list = host.querySelector(".quotes-list")!;
    const empty = host.querySelector(".quotes-empty")!;
    expect(list.compareDocumentPosition(empty) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("draws no list at all with neither", async () => {
    await mount({ quotes: null, comments: [] });
    expect(host.querySelector(".quotes-list")).toBeNull();
  });
});

describe("a visitor", () => {
  it("cannot be given a reader's rows: the type refuses, and the panel would not read them", async () => {
    const smuggled = { rows: readerRowComments(COMMENTS), blocks: BLOCKS, onOpen: noop };
    // @ts-expect-error — `yours` exists on the owner arm only (GPT Sol, 261003h Q6).
    const visitor: QuotesAccess = { kind: "visitor", quotes: list(), yours: smuggled };
    await mount({ access: visitor });
    expect(yours()).toHaveLength(0);
    expect(rows()).toHaveLength(2);
  });

  it("still gets who and when on the model's rows", async () => {
    await mount({ access: { kind: "visitor", quotes: { quotes: [WEAK], generatedAt: TUESDAY } } });
    const tip = await card(rows()[0]!);
    expect(tip.querySelector(".quotes-prov")?.textContent).toBe(
      `Chosen by the AI · on or before ${exactly(TUESDAY)}`,
    );
  });

  it("is wired from the owner capability in Reader, never from the merged comments", () => {
    /* `comments` in Reader.tsx is the visitor's own list on a shared link; the
       band's rows must come from `owner.comments` and go to the owner's band
       only. A source assertion, because the mistake typechecks. */
    const reader = readFileSync(resolve(process.cwd(), "src/web/reader/Reader.tsx"), "utf8");
    expect(reader).toMatch(/const ownerComments = owner\?\.comments\.comments;/);
    expect(reader).toMatch(/readerRowComments\(ownerComments\)/);
    expect(reader.match(/readerRowComments\(/g)).toHaveLength(1);
    expect(reader).toMatch(/jumpToComment\(ownerComments \?\? \[\], id, setNote, bandJump\)/);
    const visitorBand = reader.slice(reader.indexOf("<VisitorQuotesBand"));
    expect(visitorBand.slice(0, visitorBand.indexOf("/>"))).not.toMatch(/yours|highlights/i);
  });
});

describe("pressing a reader's row", () => {
  it("clears the quote selection and opens the comment, in that order, and selects no quote", async () => {
    const calls: string[] = [];
    await mount({
      quoteId: STRONG.id,
      onQuote: (id) => calls.push(`quote:${id}`),
      onOpen: (id) => calls.push(`open:${id}`),
    });
    await act(async () => yours()[1]?.querySelector<HTMLButtonElement>("button.quotes-quote")?.click());
    expect(calls).toEqual(["quote:null", `open:${HL_NOTED}`]);
  });

  it("leaves ?note=<its id> in the address and no ?quote=", async () => {
    /* `Reader` in miniature: the two real parameters, the real `jumpToComment`. */
    window.history.replaceState(null, "", `/read/writes?quote=${STRONG.id}`);
    const jumped: string[] = [];
    function Harness() {
      const [quoteId, setQuoteId] = useQueryState("quote", quoteParam);
      const [, setNote] = useQueryState("note", noteParam);
      const mine = readerRowComments(COMMENTS);
      return createElement(QuotesPanel, {
        access: {
          kind: "owner",
          owner: owner(list()),
          quotes: list(),
          yours: {
            rows: mine,
            blocks: BLOCKS,
            onOpen: (id: string) => jumpToComment(COMMENTS, id, setNote, (blockId) => jumped.push(blockId)),
          },
        },
        quoteId,
        onQuote: (id: string | null) => void setQuoteId(id),
        rank: "document",
        onRank: noop,
        bar: null,
        onBar: noop,
        onJump: noop,
        steps: [],
      });
    }
    await act(async () => root.render(createElement(NuqsAdapter, null, createElement(Harness))));
    expect(host.querySelector(`li[data-quote-row="${STRONG.id}"]`)?.classList.contains("on")).toBe(true);

    await act(async () => {
      yours()[0]?.querySelector<HTMLButtonElement>("button.quotes-quote")?.click();
      await new Promise((r) => setTimeout(r, 120));
    });
    const params = new URLSearchParams(window.location.search);
    expect(params.get("note")).toBe(HL_PLAIN);
    expect(params.has("quote")).toBe(false);
    expect(host.querySelector("li.quotes-row.on")).toBeNull();
  });
});

describe("the stepper", () => {
  it("still walks the model's quotes only", async () => {
    const picked: (string | null)[] = [];
    await mount({ steps: [STRONG, WEAK], quoteId: STRONG.id, onQuote: (id) => picked.push(id) });
    expect(host.querySelector(".quotes-step-at")?.textContent).toBe("1 of 2");
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Next quote"]')?.click());
    expect(picked).toEqual([WEAK.id]);
  });
});

describe("the band's (i)", () => {
  it("counts the model's quotes as before, with the reader's beside them", async () => {
    await mount({});
    const about = host.querySelector<HTMLButtonElement>(".band-about, [aria-label^='About']");
    expect(about).not.toBeNull();
    await act(async () => about?.click());
    expect(document.body.textContent).toContain("2 quotes + 2 yours.");
  });
});
