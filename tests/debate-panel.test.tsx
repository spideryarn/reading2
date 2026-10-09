// @vitest-environment jsdom
/**
 * **The Debate band, and the nine things about it that can be got wrong
 * quietly.**
 *
 * This mode's whole design is a set of refusals, and a refusal is invisible on
 * a screenshot: a panel showing four rows looks identical whether it refused
 * six or refused none. So almost everything worth testing here is a *sentence*
 * that has to be present, absent, or different from its neighbour.
 *
 *  1. **The three empty states are three different sentences.** Collapsing them
 *     is the silent-success failure this mode exists to obey
 *     (docs/reusable/silent-success.md). *The search found nothing to look at*,
 *     *the search found pages we could not verify* and *the search failed* are
 *     three different facts about the world, and a reader who is told the first
 *     when the second is true has been told something false.
 *  2. **No score, anywhere.** Greg asked for a positive/negative icon and a
 *     red/green scheme *"but without a score"*. A percentage, a bar or a number
 *     hands the reader a verdict on a piece they are in the middle of reading.
 *  3. **`neither` and `cannot-tell` are drawn as calmly as the rest.** A model that
 *     cannot tell whether a page agrees should say so and be believed — the
 *     rule docs/project/timeline.md applies to an undated row.
 *  4. **`relation`, `lean` and `applies` are grouped under "AI
 *     interpretation", and the quotation is not.** They are the model's reading
 *     of a stranger's page; the quotation is characters we located in that
 *     page's own extract. A row that draws them alike is claiming the first is
 *     as checkable as the second.
 *  5. **The foot lines fire on the counts the artefact stores.** `reportedRows`
 *     against `keptRows`, and `returnedSources` against the count of *distinct
 *     row URLs* — the second is the one a model can walk past with every other
 *     counter reading clean (Sol's F13).
 *  6. **The excerpt is a slice of a stranger's page and is rendered as text.**
 *  7. **`searchedAt` is displayed provenance, not staleness**, and the two say
 *     different things on screen.
 *  8. **Every row saying what it is** — the chip on a row about the piece is
 *     its *strongest* signal rather than its first, and each foot line names
 *     which search it counts.
 *  9. **Two sub-modes, one per search** — since 2026-10-03 (plan 261003o).
 *     Reception draws no claim row and Claims no reception row; each segment's
 *     count is its own list; a page that only *names* the piece is on screen
 *     under a heading that says so, never hidden and never unheaded; and the
 *     empty states of 1 are kept per sub-mode, for owner and visitor.
 *
 * Each has a positive control beside it, because a test that has never been
 * able to fail is not evidence.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  BlockId,
  ClaimDebateRow,
  Debate,
  DebateBears,
  DebateCounts,
  DebateLean,
  DebateLosses,
  DebateSynthesis,
  Citer,
  CitersResult,
  DirectDebateRow,
} from "../src/types.js";
import type { DebateOrder } from "../src/web/debate-order.js";
import type { DebateView } from "../src/web/params.js";
import type { UseDebate } from "../src/web/useDebate.js";
import type { PublicDebate, PublicDebateClaimList } from "../src/public-types.js";
import type { UseDebateClaims } from "../src/web/useDebateClaims.js";
import { claimListOf, checksOwner, claimListOwner } from "./helpers/debate-claims-owner.js";
import { pendingActivation, resetActivations } from "../src/web/activation.js";
import { enclosing, readerCssNoComments } from "./helpers/stylesheets.js";
import {
  CITERS_ABOUT,
  CITERS_HEADING,
  CITERS_LOADING,
  CITERS_NONE,
  CITERS_NOT_INDEXED,
  CITERS_NO_DOI,
  CITERS_TOO_LARGE,
  CITERS_UNAVAILABLE,
  CITERS_UNCONFIRMED,
  CITERS_UNREAD,
  DEBATE_CLAIMS_EARLIER,
  DEBATE_CLAIMS_NONE,
  DEBATE_CLAIMS_NONE_SHARED,
  DEBATE_CLAIMS_LIST_AI,
  DEBATE_CLAIMS_LIST_EMPTY,
  DEBATE_CLAIMS_LIST_NONE,
  DEBATE_CLAIMS_LIST_NONE_SHARED,
  DEBATE_CLAIMS_LIST_RUN,
  DEBATE_CLAIMS_LIST_STALE,
  DEBATE_CLAIMS_LIST_AGAIN,
  DEBATE_CLAIMS_NOT_SEARCHED_SHARED,
  DEBATE_EXTRACTS_ONLY,
  DEBATE_TITLE_ONLY,
  DEBATE_UNDATED,
  DEBATE_RESPONSES_NONE,
  DEBATE_RESPONSES_NONE_SHARED,
  debateClaimsUnverified,
  debateResponsesUnverified,
  debateWithheldOnSharedLink,
} from "../src/messages.js";

const {
  DebatePanel,
  LEAN_APPEARANCE,
  headCount,
  identificationEvidence,
  keptNote,
  sourcesNote,
} = await import("../src/web/DebatePanel.js");

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`, so a plausible-looking
   `spya-aaa111` is not one of ours. docs/project/block-ids.md § the alphabet. */
const KNOWN = "spya-k3m9qt" as BlockId;

function losses(over: Partial<DebateLosses> = {}): DebateLosses {
  return {
    uncited: 0,
    selfSource: 0,
    unverifiedSource: 0,
    directnessUnverified: 0,
    sourceIsCopy: 0,
    claimNotInBlock: 0,
    unknownBlockId: 0,
    malformed: 0,
    ...over,
  };
}

function counts(over: Partial<DebateCounts> = {}): DebateCounts {
  return {
    returnedSources: 2,
    reportedRows: 1,
    keptRows: 1,
    omittedOverCap: 0,
    lost: losses(),
    webSearches: 3,
    ...over,
  };
}

function direct(over: Partial<DirectDebateRow> = {}): DirectDebateRow {
  return {
    id: "spya-d2w4rt",
    url: "https://example.org/a-reply",
    title: "A reply to the piece",
    sourceQuote: "the argument here does not survive its own third section",
    articleReferenceQuote: "Notes on my sourdough starter, week 3",
    relation: "disputes",
    lean: "leans-against",
    applies: "It says the piece's third section contradicts its second.",
    /* The evidence that this page is about this piece. A row that earned none
       could not be in this group at all. */
    identifies: [
      { kind: "named", by: "title", witness: "Notes on my sourdough starter, week 3" },
    ],
    ...over,
  };
}

function claim(over: Partial<ClaimDebateRow> = {}): ClaimDebateRow {
  return {
    id: "spya-c7w2dn",
    url: "https://another.example.net/on-starters",
    title: "On starters",
    sourceQuote: "warmer water is what a day-three starter wants",
    relation: "qualifies",
    lean: "neither",
    applies: "It agrees with the claim but only above 22°C.",
    claimQuote: "a starter needs cool water",
    blockId: KNOWN,
    ...over,
  };
}

function artefact(over: Partial<Debate> = {}): Debate {
  return {
    version: "debate/1",
    generator: "a-model",
    slug: "a-piece",
    sourceHash: "hash",
    searchedAt: "2026-09-05T10:00:00.000Z",
    direct: { rows: [direct()], counts: counts() },
    claims: { rows: [claim()], counts: counts() },
    elapsedMs: 1,
    ...over,
  };
}

function owner(over: Partial<UseDebate> = {}): UseDebate {
  return {
    status: "ready",
    debate: artefact(),
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
    cancel: () => {},
    rewriting: false,
    refresh: async () => {},
    ...over,
  };
}

let host: HTMLDivElement;
let root: Root;
const jumped: BlockId[] = [];

/** Every sub-mode segment pressed, in order — and the handoff button's press. */
const viewed: DebateView[] = [];
/** Every order button pressed, in order. */
const ordered: DebateOrder[] = [];
/** Every stop the relevance bar was dragged to — `null` is its reset. */
const relevanced: (DebateBears | null)[] = [];
const threaded: (string | null)[] = [];
/** Every press of *Cited by*'s Try again. */
const retried: string[] = [];
const NO_DOI: CitersResult = { kind: "no-doi" };
/** The owner has chat, and nothing here presses it (tests/debate-claim-chat.test.tsx does). */
const NO_CLAIM_CHATS = { summaries: [], onCheck: () => {}, onLens: () => {}, onOpen: () => {} };

/** The article's own title, which the panel is handed for the Scholar link. */
const ARTICLE_TITLE = "Notes on my sourdough starter, week 3";

/**
 * **Reception unless a test says Claims** — `?debate=`'s own default, so a test
 * that passes nothing is what a reader who has touched nothing sees.
 */
function paint(
  o: UseDebate,
  view: DebateView = "reception",
  order: DebateOrder = "prioritised",
  blockOrder: ReadonlyMap<BlockId, number> = new Map(),
  extra: {
    relevance?: DebateBears | null;
    articleYear?: number | null;
    thread?: string | null;
    articleTitle?: string | null;
    /** What `useCiters` answered. An article with no DOI unless a test says otherwise. */
    citers?: CitersResult | null;
    /** Claims' list hook. Nobody has pressed Claims unless a test says otherwise. */
    claimList?: UseDebateClaims;
  } = {},
) {
  const result = "citers" in extra ? (extra.citers ?? null) : NO_DOI;
  act(() => {
    root.render(
      createElement(DebatePanel, {
        access: {
          kind: "owner",
          owner: o,
          claimList: extra.claimList ?? claimListOwner(), checks: checksOwner(),
          citers: { result, retry: () => retried.push("retry") },
          claimChats: NO_CLAIM_CHATS,
        },
        onJump: (id: BlockId) => jumped.push(id),
        view,
        onView: (next: DebateView) => viewed.push(next),
        order,
        onOrder: (next: DebateOrder) => ordered.push(next),
        blockOrder,
        relevance: extra.relevance ?? null,
        onRelevance: (next: DebateBears | null) => relevanced.push(next),
        articleYear: extra.articleYear ?? null,
        thread: extra.thread ?? null,
        onThread: (next: string | null) => threaded.push(next),
        articleTitle: "articleTitle" in extra ? (extra.articleTitle ?? null) : ARTICLE_TITLE,
      }),
    );
  });
}

/** The same panel as a visitor gets it. */
function paintShared(
  debate: PublicDebate | null,
  view: DebateView = "reception",
  order: DebateOrder = "prioritised",
  extra: { relevance?: DebateBears | null; thread?: string | null; claimList?: PublicDebateClaimList | null } = {},
) {
  act(() => {
    root.render(
      createElement(DebatePanel, {
        access: { kind: "visitor", debate, claimList: extra.claimList ?? null },
        onJump: (id: BlockId) => jumped.push(id),
        view,
        onView: (next: DebateView) => viewed.push(next),
        order,
        onOrder: (next: DebateOrder) => ordered.push(next),
        blockOrder: new Map(),
        relevance: extra.relevance ?? null,
        onRelevance: (next: DebateBears | null) => relevanced.push(next),
        articleYear: null,
        thread: extra.thread ?? null,
        onThread: () => {},
        articleTitle: ARTICLE_TITLE,
      }),
    );
  });
}

/** A visitor's debate, as the public payload sends it. */
function shared(over: Partial<PublicDebate> = {}): PublicDebate {
  return {
    searchedAt: "2026-09-05T10:00:00.000Z",
    direct: { rows: [direct()], sourceNotPublishable: 0 },
    claims: { rows: [claim()], sourceNotPublishable: 0 },
    ...over,
  } as unknown as PublicDebate;
}

/** The two segments of the sub-mode control, as a reader reads them. */
const segments = () => [...host.querySelectorAll(".dbt-views [role='radio']")].map((b) => b.textContent ?? "");
/** The titles of the rows on screen, in document order. */
const rowTitles = () => [...host.querySelectorAll(".dbt-item a.dbt-title")].map((a) => a.textContent ?? "");
/** The button that hands a reader with no reception over to Claims, or null. */
const handoff = () =>
  [...host.querySelectorAll<HTMLButtonElement>("button.dbt-handoff")].find(Boolean) ?? null;
const EMPTY = { returnedSources: 0, reportedRows: 0, keptRows: 0 } as const;

/** Press a button, the way a mouse does. */
function press(el: Element | null | undefined) {
  act(() => {
    el?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
  });
}

const text = () => host.textContent ?? "";

/* **What the band's (i) says** — the count, the foot lines, the extracts-only
   sentence and when it was searched moved there on 2026-10-01 (spya-ucu35y,
   plan 261001m). Opens it, reads the card, and closes it again. */
function card(): string {
  const info = host.querySelector(".mode-band > .band-about");
  press(info);
  const said = document.querySelector('[role="tooltip"], [role="dialog"]')?.textContent ?? "";
  press(info);
  return said;
}

beforeEach(() => {
  resetActivations();
  jumped.length = 0;
  viewed.length = 0;
  ordered.length = 0;
  relevanced.length = 0;
  threaded.length = 0;
  retried.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/**
 * **Two sub-modes, one per search** — plan 261003o. Until 2026-10-03 the panel
 * drew both searches' rows in one list under four controls, and Greg read one
 * claim's two sources as the whole of the debate. Reception is the search about
 * the piece; Claims is the search about what it claims.
 */
describe("Reception and Claims, each drawing its own search", () => {
  it("offers the two as one choice, Reception first and chosen, each with its count", () => {
    paint(
      owner({
        debate: artefact({
          claims: {
            rows: [claim(), claim({ id: "spya-c7w2d3", url: "https://third.example/x" })],
            counts: counts({ reportedRows: 2, keptRows: 2 }),
          },
        }),
      }),
    );
    const group = host.querySelector(".dbt-views");
    expect(group?.getAttribute("role")).toBe("radiogroup");
    expect(segments()).toEqual(["Reception1", "Claims2"]);
    const [reception, claims] = [...(group?.querySelectorAll("[role='radio']") ?? [])];
    expect(reception?.getAttribute("aria-checked")).toBe("true");
    expect(claims?.getAttribute("aria-checked")).toBe("false");
    /* mode.md bans a description line under a control: what each one is goes
       in its card and the band's (i). */
    expect(card()).toContain("What others have written about this piece itself");
    expect(card()).toContain("The claims it rests on that someone outside could argue with");
  });

  it("hands a press back as the sub-mode's word, and nothing for the one already open", () => {
    paint(owner());
    const [reception, claims] = [...host.querySelectorAll(".dbt-views [role='radio']")];
    press(reception);
    expect(viewed).toEqual([]);
    press(claims);
    expect(viewed).toEqual(["claims"]);
  });

  it("arms only an owner's Reception segment press", () => {
    paint(owner(), "reception");
    press(host.querySelector('[aria-label="Reception, 1 source"]'));
    expect(pendingActivation("a-piece", "debate")).not.toBeNull();

    resetActivations();
    paint(owner(), "claims");
    press(host.querySelector('[aria-label="Reception, 1 source"]'));
    expect(pendingActivation("a-piece", "debate")).not.toBeNull();

    resetActivations();
    paint(owner(), "reception");
    press(host.querySelector('[aria-label="Claims, 1 source"]'));
    expect(pendingActivation("a-piece", "debate")).toBeNull();

    paintShared(shared(), "claims");
    press(host.querySelector('[aria-label="Reception, 1 source"]'));
    expect(pendingActivation("a-piece", "debate")).toBeNull();
  });

  /* Since stage 2 of plan 261008i Claims is the list of the article's claims,
     and its card says how that list is made: no search. */
  it("does not tell a reader that Claims came from a second search", () => {
    paint(owner({ debate: artefact({ claims: { pass: "not-run", rows: [] } }) }));
    const claims = host.querySelector<HTMLElement>('[aria-label="Claims, 0 sources"]');
    act(() => claims?.focus());
    const tip = document.querySelector('[role="tooltip"], [role="dialog"]')?.textContent ?? "";
    expect(tip).toContain("Listed by one model call over the article, with no web search");
    expect(tip).not.toContain("Found by a second search");
  });

  it("shows no claim rows in Reception and no reception rows in Claims", () => {
    paint(owner());
    expect(rowTitles()).toEqual(["A reply to the piece"]);
    paint(owner(), "claims");
    expect(rowTitles()).toEqual(["On starters"]);
    expect(host.querySelector(".dbt-views [aria-checked='true']")?.textContent).toBe("Claims1");
  });

  /* Each segment's count is its list — the rows on screen there — whichever of
     the two is open. A count that disagrees with the list under it is this
     feature's worst failure (threshold.ts). */
  it("keeps each segment's count equal to the rows its list draws", () => {
    const debate = artefact({
      direct: { rows: [direct(), direct({ id: "spya-d2w4r3", url: "https://second.example/r" })], counts: counts() },
      claims: {
        rows: [
          claim3({ id: "spya-c7w2d2", bears: "loosely" }),
          claim3({ id: "spya-c7w2d3", bears: "directly" }),
          claim3({ id: "spya-c7w2d4", bears: "partly" }),
        ],
        counts: counts(),
      },
    });
    for (const view of ["reception", "claims"] as const) {
      paint(owner({ debate }), view, "prioritised", new Map(), { relevance: "partly" });
      expect(segments(), view).toEqual(["Reception2", "Claims2"]);
      expect(host.querySelectorAll(".dbt-item"), view).toHaveLength(2);
    }
  });

  it("gives a visitor the same two, with the same counts", () => {
    paintShared(shared());
    expect(segments()).toEqual(["Reception1", "Claims1"]);
    expect(rowTitles()).toEqual(["A reply to the piece"]);
    paintShared(shared(), "claims");
    expect(rowTitles()).toEqual(["On starters"]);
  });
});

/**
 * **The bug this change fixes**
 * (docs/postmortems/261003h-debate-default-bar-hides-the-citing-papers-the-search-was-changed-to-find.md).
 * The identification slider defaulted to *quotes it*, which hid a page that
 * only *names* the piece — and a citing paper names it and almost never quotes
 * it. On *Attention is not Explanation* the one reception row kept, the
 * published reply, was hidden in both runs. The slider is gone; a title-only
 * row is on screen, under a heading that says what it is.
 */
describe("a page that only names this piece", () => {
  const quoted = (over: Partial<DirectDebateRow> = {}) =>
    direct({
      id: "spya-d2w4r7",
      url: "https://quoting.example/reply",
      title: "A reply that quotes it",
      identifies: [
        { kind: "quoted", quote: "a starter needs cool water", blockId: KNOWN, coverage: 0.04, density: 0.13 },
      ],
      ...over,
    });
  const titleOnlyHead = () => host.querySelector("section.dbt-title-only > h3")?.textContent;

  it("is on screen when the reader has touched nothing, under the title-only heading", () => {
    paint(owner());
    expect(host.querySelectorAll(".dbt-item")).toHaveLength(1);
    expect(text()).toContain("Names this piece");
    expect(DEBATE_TITLE_ONLY).toBe("Names this piece by its title only");
    expect(titleOnlyHead()).toBe(DEBATE_TITLE_ONLY);
    expect(host.querySelectorAll("section.dbt-title-only .dbt-item")).toHaveLength(1);
    expect(text()).not.toContain("hidden by this threshold");
  });

  /* The decoy that set the old default (260906b): a page about a different
     document with the same title, and no stronger row beside it. As the first
     row of a plain list it reads as reception; under its heading it is flagged. */
  it("is never drawn above or without that heading, even when it is the only row", () => {
    paint(owner());
    const items = [...host.querySelectorAll(".dbt-item")];
    expect(items).toHaveLength(1);
    for (const item of items) expect(item.closest("section.dbt-title-only")).not.toBeNull();
    const scroll = host.querySelector(".dbt-scroll");
    const head = scroll?.querySelector("section.dbt-title-only > h3");
    expect(head).not.toBeNull();
    expect(
      (head as Element).compareDocumentPosition(items[0] as Element) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("follows the rows that link or quote the piece, whatever order the search found them in", () => {
    paint(
      owner({
        debate: artefact({
          direct: { rows: [direct(), quoted()], counts: counts({ reportedRows: 2, keptRows: 2 }) },
        }),
      }),
    );
    expect(rowTitles()).toEqual(["A reply that quotes it", "A reply to the piece"]);
    const [first, second] = [...host.querySelectorAll(".dbt-item")];
    expect(first?.closest("section.dbt-title-only")).toBeNull();
    expect(second?.closest("section.dbt-title-only")).not.toBeNull();
    expect(host.querySelectorAll(".dbt-mark-quoted")).toHaveLength(1);
    expect(host.querySelectorAll(".dbt-mark-named")).toHaveLength(1);
  });

  it("draws no title-only heading when every row links or quotes the piece", () => {
    paint(owner({ debate: artefact({ direct: { rows: [quoted()], counts: counts() } }) }));
    expect(host.querySelector("section.dbt-title-only")).toBeNull();
    expect(text()).not.toContain(DEBATE_TITLE_ONLY);
    expect(host.querySelectorAll(".dbt-item")).toHaveLength(1);
  });

  it("has no identification slider any more, in either sub-mode", () => {
    for (const view of ["reception", "claims"] as const) {
      paint(owner(), view);
      expect(document.getElementById("dbt-bar"), view).toBeNull();
      expect(host.querySelector(".dbt-name"), view).toBeNull();
    }
  });

  /* The class, not the instance (the postmortem's first countermeasure): with
     nothing touched, no default may hide a stored row, whatever it carries. */
  it("shows every stored row of each sub-mode when the reader has touched nothing", () => {
    const debate = artefact({
      direct: { rows: [direct(), quoted()], counts: counts({ reportedRows: 2, keptRows: 2 }) },
      claims: {
        rows: [
          claim3({ id: "spya-c7w2d2", url: "https://loose.example/x", bears: "loosely" }),
          claim3({ id: "spya-c7w2d3", url: "https://direct.example/x", bears: "directly" }),
          claim({ id: "spya-c7w2d4", url: "https://unjudged.example/x" }),
        ],
        counts: counts({ reportedRows: 3, keptRows: 3 }),
      },
    });
    paint(owner({ debate }));
    expect(host.querySelectorAll(".dbt-item")).toHaveLength(2);
    paint(owner({ debate }), "claims");
    expect(host.querySelectorAll(".dbt-item")).toHaveLength(3);
  });

  it("gives a visitor the same heading, from the `identifies` their rows carry", () => {
    paintShared(shared({ direct: { rows: [direct(), quoted()], sourceNotPublishable: 0 } } as Partial<PublicDebate>));
    expect(rowTitles()).toEqual(["A reply that quotes it", "A reply to the piece"]);
    expect(titleOnlyHead()).toBe(DEBATE_TITLE_ONLY);
  });

  it("counts every row on screen in the head count, title-only ones included", () => {
    paint(owner());
    expect(card()).toContain("1 excerpt on screen.");
  });

  it("says kept, and counts the pages behind both groups", () => {
    /* `keptNote` is arithmetic about the run; `sourcesNote` counts the pages
       behind the rows shown, and a title-only row is shown. */
    paint(
      owner({
        debate: artefact({
          direct: {
            rows: [direct(), quoted()],
            counts: counts({ returnedSources: 5, reportedRows: 3, keptRows: 2 }),
          },
        }),
      }),
    );
    const foot = card();
    expect(foot).toContain("2 were kept");
    expect(foot).not.toContain("are shown");
    expect(foot).toContain("returned evidence from 5 pages; 2 contribute to the rows shown");
  });
});

describe("the empty states are different sentences, in each sub-mode", () => {
  /* The positive control for the whole section: if two of these ever become one
     string, every assertion below still passes and this one does not. */
  it("has distinguishable sentences to say in the first place", () => {
    const all = [
      DEBATE_RESPONSES_NONE,
      debateResponsesUnverified(4),
      DEBATE_CLAIMS_NONE,
      debateClaimsUnverified(4),
      DEBATE_RESPONSES_NONE_SHARED,
      DEBATE_CLAIMS_NONE_SHARED,
    ];
    expect(new Set(all).size).toBe(all.length);
    /* Never *"No one has written about it"* — we cannot see the query, so what
       we have is evidence of a bounded search rather than a claim about the
       web. */
    for (const s of all) expect(s.toLowerCase()).not.toContain("no one has");
  });

  it("says the search found nothing to look at, when it returned no pages", () => {
    paint(owner({ debate: artefact({ direct: { rows: [], counts: counts(EMPTY) } }) }));
    expect(text()).toContain(DEBATE_RESPONSES_NONE);
    expect(text()).not.toContain(debateResponsesUnverified(0));
    expect(host.querySelector(".dbt-item")).toBeNull();
  });

  /* The middle row of the plan's table, and the one an implementation collapses
     first: candidates came back and not one of them could be checked. */
  it("says the excerpts were not enough, when it returned pages and kept nothing", () => {
    paint(
      owner({
        debate: artefact({
          direct: {
            rows: [],
            counts: counts({
              returnedSources: 6,
              reportedRows: 3,
              keptRows: 0,
              lost: losses({ unverifiedSource: 3 }),
            }),
          },
        }),
      }),
    );
    /* The count in it is `returnedSources` and it is real: told "6 pages", a
       reader can weigh how thin the answer is. */
    expect(text()).toContain(debateResponsesUnverified(6));
    expect(text()).not.toContain(DEBATE_RESPONSES_NONE);
  });

  /* The third state is the ordinary job failure, and the thing that must be
     true of it is that it says neither of the other two: a failed pass is not
     evidence about the web at all. */
  it("says neither when the step failed, and shows the failure instead", () => {
    paint(
      owner({
        status: "none",
        debate: null,
        failed: {
          message: "The search did not run.",
          retryable: false,
          retry: null,
          kind: "step",
        } as UseDebate["failed"],
      }),
    );
    expect(text()).toContain("The search did not run.");
    expect(text()).not.toContain(DEBATE_RESPONSES_NONE);
    expect(text()).not.toContain(debateResponsesUnverified(6));
  });

  /* **A fourth state, and it is not one of the three**: nobody has ever run it.
     That is not a result at all, and saying either search sentence over it
     would be reporting a search that never happened. What it must do instead is
     name the price before the button, and say what the two searches are. */
  /* **One search since `debate/7`** (2026-10-08, plan 261008i): the words
     before the button say what the press now buys, Reception only. */
  it("says nothing about any search when nobody has run one, and what the one search is", () => {
    paint(owner({ status: "none", debate: null }));
    expect(text()).not.toContain(DEBATE_RESPONSES_NONE);
    expect(text()).not.toContain(debateResponsesUnverified(6));
    expect(text()).not.toContain(DEBATE_CLAIMS_NONE);
    expect(host.querySelector(".gloss-hint")?.textContent).toBe(
      "One search of the open web, for what others have written about this piece. It takes about " +
        "a minute and costs real money. Many pieces have no reception at all. Searched once and kept.",
    );
    /* The sub-mode control is drawn before any search is (plan 261008i, F9):
       Claims has a list of its own to reach. Reception is the one chosen. */
    expect(host.querySelector(".dbt-views [aria-checked='true']")?.textContent).toBe("Reception0");
    expect(
      [...host.querySelectorAll("button")].some((b) =>
        (b.textContent ?? "").includes("Search the web"),
      ),
      "a button to start it",
    ).toBe(true);
  });

  /* The two searches do not share a sentence, and since 2026-10-03 they do not
     share a screen: each sub-mode says its own search's, and only its own. */
  it("uses the claims search's own sentences in Claims, not the reception search's", () => {
    const debate = artefact({ claims: { rows: [], counts: counts(EMPTY) } });
    paint(owner({ debate }), "claims");
    expect(text()).toContain(DEBATE_CLAIMS_NONE);
    expect(text()).not.toContain(DEBATE_RESPONSES_NONE);
    /* …and Reception, which kept a row, says nothing about the other search. */
    paint(owner({ debate }));
    expect(text()).not.toContain(DEBATE_CLAIMS_NONE);
    expect(host.querySelector(".dbt-empty")).toBeNull();
  });

  /* **No claims search ran, so none found nothing** — a debate searched at
     `debate/7` or later stores `claims: {pass: "not-run"}` (plan 261008i, F4).
     The empty-search sentences are about a search, and none happened. */
  it("says the claims search did not run, never that it found nothing, on a debate searched since debate/7", () => {
    const debate = artefact({
      direct: { rows: [], counts: counts(EMPTY) },
      claims: { pass: "not-run", rows: [] },
    });
    paint(owner({ debate }), "claims");
    /* Since stage 2 Claims draws the list's own state instead of a sentence
       about a search: here, nobody has listed the claims. */
    expect(host.querySelector(".dbt-empty")).toBeNull();
    expect(text()).toContain(DEBATE_CLAIMS_LIST_NONE);
    expect(text()).not.toContain(DEBATE_CLAIMS_NONE);
    expect(text()).not.toContain(debateClaimsUnverified(0));
    expect(text()).not.toContain(DEBATE_CLAIMS_EARLIER);
    /* The (i): said once, and none of the claims search's own counts. */
    const said = card();
    expect(said).toContain(DEBATE_CLAIMS_NOT_SEARCHED_SHARED);
    expect(said).not.toContain("The search for answers to what it claims");
    /* Reception, which kept nothing, offers no way to a Claims with nothing in it. */
    paint(owner({ debate }));
    expect(host.querySelector(".dbt-empty")?.textContent).toBe(DEBATE_RESPONSES_NONE);
    expect(handoff()).toBeNull();
  });

  it("tells a visitor no list was made, rather than that a claims search kept nothing", () => {
    paintShared(shared({ claims: { pass: "not-run", rows: [] } }), "claims");
    expect(host.querySelector(".dbt-empty")).toBeNull();
    expect(text()).toContain(DEBATE_CLAIMS_LIST_NONE_SHARED);
    expect(text()).not.toContain(DEBATE_CLAIMS_NONE_SHARED);
  });

  /* **A debate stored before `debate/7` is read as searched**: no marker, so
     its empty group is a search that found nothing, said as before; and its
     rows are drawn as before, under a heading that says whose choice they were. */
  it("reads a debate with no marker as searched, and heads its claim rows as the earlier search's", () => {
    const empty = artefact({ claims: { rows: [], counts: counts(EMPTY) } });
    paint(owner({ debate: empty }), "claims");
    expect(host.querySelector(".dbt-empty")?.textContent).toBe(DEBATE_CLAIMS_NONE);
    expect(text()).not.toContain(DEBATE_CLAIMS_EARLIER);

    paint(owner(), "claims");
    expect(host.querySelector(".dbt-group-head")?.textContent).toBe(DEBATE_CLAIMS_EARLIER);
    expect(rowTitles().length).toBeGreaterThan(0);
    expect(card()).not.toContain(DEBATE_CLAIMS_NOT_SEARCHED_SHARED);
    /* Reception draws no such heading. */
    paint(owner());
    expect(text()).not.toContain(DEBATE_CLAIMS_EARLIER);
  });

  it("says each search's own sentence when neither kept anything", () => {
    const debate = artefact({
      direct: { rows: [], counts: counts(EMPTY) },
      claims: { rows: [], counts: counts({ returnedSources: 5, reportedRows: 2, keptRows: 0 }) },
    });
    paint(owner({ debate }));
    expect(host.querySelector(".dbt-empty")?.textContent).toBe(DEBATE_RESPONSES_NONE);
    paint(owner({ debate }), "claims");
    expect(host.querySelector(".dbt-empty")?.textContent).toBe(debateClaimsUnverified(5));
  });

  it("says nothing at all when both searches kept something", () => {
    for (const view of ["reception", "claims"] as const) {
      paint(owner(), view);
      expect(host.querySelector(".dbt-empty"), view).toBeNull();
    }
  });

  /* **The hand-over**, which replaced *"What follows takes up what it
     argues"*: with nothing in Reception and something in Claims, the reader is
     told so and offered the way there. Greg's paper is this case. */
  it("offers the way to Claims when Reception kept nothing and Claims has rows, and it switches", () => {
    paint(owner({ debate: artefact({ direct: { rows: [], counts: counts(EMPTY) } }) }));
    expect(handoff()?.textContent).toBe("See the 1 source on what it claims");
    press(handoff());
    expect(viewed).toEqual(["claims"]);
    /* The retired lead sentence is gone. */
    expect(text()).not.toContain("What follows takes up what it argues.");
  });

  it("counts the sources in the hand-over", () => {
    paint(
      owner({
        debate: artefact({
          direct: { rows: [], counts: counts(EMPTY) },
          claims: {
            rows: [claim(), claim({ id: "spya-c7w2d3" }), claim({ id: "spya-c7w2d4" })],
            counts: counts(),
          },
        }),
      }),
    );
    expect(handoff()?.textContent).toBe("See the 3 sources on what it claims");
  });

  it("clears Claims narrowing on hand-over so every advertised source can be seen", () => {
    const debate = artefact({
      direct: { rows: [], counts: counts(EMPTY) },
      claims: {
        rows: [claim({ bears: "partly" }), claim({ id: "spya-c7w2d3", bears: "loosely" })],
        counts: counts({ reportedRows: 2, keptRows: 2 }),
      },
      synthesis: {
        kind: "made",
        themes: [],
        key: [{ rowId: "spya-c7w2dn", role: "origin", why: "Where it comes from." }],
      },
    });
    paint(owner({ debate }), "reception", "prioritised", new Map(), { relevance: "directly", thread: "key" });
    expect(segments()).toEqual(["Reception0", "Claims0"]);
    expect(handoff()?.textContent).toBe("See the 2 sources on what it claims");
    press(handoff());
    expect(relevanced).toEqual([null]);
    expect(threaded).toEqual([null]);
    expect(viewed).toEqual(["claims"]);
    paint(owner({ debate }), "claims");
    expect(rowTitles()).toHaveLength(2);
  });

  it("offers no hand-over when Claims has nothing either, or when Reception has a row, or in Claims", () => {
    const none = { rows: [], counts: counts(EMPTY) };
    paint(owner({ debate: artefact({ direct: none, claims: none }) }));
    expect(handoff()).toBeNull();
    paint(owner());
    expect(handoff()).toBeNull();
    paint(owner({ debate: artefact({ direct: none }) }), "claims");
    expect(handoff()).toBeNull();
  });

  /* **A visitor's three**, per sub-mode: the search kept nothing (one sentence
     true of both owner cases, because the count does not cross), rows withheld
     at the public boundary (the search *did* keep something, so saying it kept
     nothing would be false), and rows. */
  it("tells a visitor the search kept nothing, in each sub-mode's own words", () => {
    const debate = shared({
      direct: { rows: [], sourceNotPublishable: 0 },
      claims: { rows: [], sourceNotPublishable: 0 },
    } as Partial<PublicDebate>);
    paintShared(debate);
    expect(host.querySelector(".dbt-empty")?.textContent).toBe(DEBATE_RESPONSES_NONE_SHARED);
    expect(handoff()).toBeNull();
    paintShared(debate, "claims");
    expect(host.querySelector(".dbt-empty")?.textContent).toBe(DEBATE_CLAIMS_NONE_SHARED);
  });

  it("tells a visitor rows were withheld, never that the search kept nothing", () => {
    const debate = shared({
      direct: { rows: [], sourceNotPublishable: 2 },
      claims: { rows: [], sourceNotPublishable: 1 },
    } as Partial<PublicDebate>);
    paintShared(debate);
    expect(host.querySelector(".dbt-empty")?.textContent).toBe(
      debateWithheldOnSharedLink("The search for replies to this piece", 2),
    );
    expect(text()).not.toContain(DEBATE_RESPONSES_NONE_SHARED);
    paintShared(debate, "claims");
    expect(host.querySelector(".dbt-empty")?.textContent).toBe(
      debateWithheldOnSharedLink("The search for answers to what it claims", 1),
    );
    expect(text()).not.toContain(DEBATE_CLAIMS_NONE_SHARED);
  });

  it("offers a visitor the same hand-over", () => {
    paintShared(shared({ direct: { rows: [], sourceNotPublishable: 0 } } as Partial<PublicDebate>));
    expect(host.querySelector(".dbt-empty")?.textContent).toBe(DEBATE_RESPONSES_NONE_SHARED);
    expect(handoff()?.textContent).toBe("See the 1 source on what it claims");
    press(handoff());
    expect(viewed).toEqual(["claims"]);
  });
});

/**
 * **Who cites it** — plan 261003o, step 2. A complete list of citers needs a
 * citation index we do not have; until then Reception ends with one outside
 * link, a *search* by title and never a guessed address (261003f's rule).
 */
describe("the Scholar link under Reception", () => {
  const link = () => host.querySelector<HTMLAnchorElement>("a.dbt-scholar");

  it("searches Google Scholar for the article's title, with no referrer and no opener", () => {
    paint(owner());
    /* The owner's is the foot of *Cited by* since 2026-10-04 (plan 261004h). */
    expect(link()?.textContent).toContain("Also: search Google Scholar");
    const url = new URL(link()?.href ?? "");
    expect(url.origin + url.pathname).toBe("https://scholar.google.com/scholar");
    expect(url.searchParams.get("q")).toBe(`"${ARTICLE_TITLE}"`);
    expect(link()?.target).toBe("_blank");
    expect(link()?.rel.split(" ").sort()).toEqual(["noopener", "noreferrer"]);
  });

  it("is there when Reception kept nothing, which is when it is most use", () => {
    paint(owner({ debate: artefact({ direct: { rows: [], counts: counts(EMPTY) } }) }));
    expect(link()).not.toBeNull();
  });

  it("is not drawn without a title to search for, or in Claims", () => {
    paint(owner(), "reception", "prioritised", new Map(), { articleTitle: null });
    expect(link()).toBeNull();
    paint(owner(), "reception", "prioritised", new Map(), { articleTitle: "  " });
    expect(link()).toBeNull();
    paint(owner(), "claims");
    expect(link()).toBeNull();
  });

  it("is a visitor's too, in the words it had, and only once a search is stored", () => {
    paintShared(shared());
    expect(link()?.href).toContain("scholar.google.com");
    expect(link()?.textContent).toContain("Who cites it: search Google Scholar");
  });
});

/**
 * **Cited by** — plan 261004h. The papers that cite the piece, from OpenAlex,
 * for the owner, whenever Reception is on screen: before the paid search has
 * run too, and without starting it. Every outcome has its own sentence, and
 * the Scholar link stays under all of them.
 */
describe("Cited by, under Reception", () => {
  const section = () => host.querySelector("section.dbt-citers");
  const said = () => section()?.textContent ?? "";
  const titles = () => [...host.querySelectorAll(".dbt-citer-title")].map((a) => a.textContent ?? "");
  const scholar = () => host.querySelector<HTMLAnchorElement>("section.dbt-citers a.dbt-scholar");
  const tryAgain = () =>
    [...(section()?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Try again") ?? null;
  const showAll = () =>
    [...(section()?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.startsWith("Show all")) ?? null;
  const withCiters = (citers: CitersResult | null, o: UseDebate = owner(), view: DebateView = "reception") =>
    paint(o, view, "prioritised", new Map(), { citers });

  function citer(n: number, over: Partial<Citer> = {}): Citer {
    return {
      openalexId: `W${7000 + n}`,
      doi: `10.1000/citer.${n}`,
      title: `Citing paper ${n}`,
      authors: ["Ada Lovelace"],
      authorCount: 1,
      year: 2025,
      venue: "A Journal",
      kind: "article",
      citedByCount: 50 - n,
      ...over,
    };
  }
  const list = (n: number) => Array.from({ length: n }, (_, i) => citer(i));
  function found(n: number, over: Partial<Extract<CitersResult, { kind: "found" }>> = {}): CitersResult {
    return {
      kind: "found",
      count: n,
      returned: n,
      dropped: 0,
      capped: false,
      citers: list(n),
      fetchedAt: "2026-10-04T09:30:00.000Z",
      ...over,
    };
  }

  it("has its own plain sentence for every outcome that is not a list", () => {
    const sentences: [CitersResult, string][] = [
      [{ kind: "no-doi" }, CITERS_NO_DOI],
      [{ kind: "not-indexed" }, CITERS_NOT_INDEXED],
      [{ kind: "unconfirmed" }, CITERS_UNCONFIRMED],
      [{ kind: "unavailable" }, CITERS_UNAVAILABLE],
      [{ kind: "too-large" }, CITERS_TOO_LARGE],
      [found(0), CITERS_NONE],
    ];
    expect(new Set(sentences.map(([, s]) => s)).size).toBe(sentences.length);
    for (const [result, sentence] of sentences) {
      withCiters(result);
      expect(said(), result.kind).toContain(sentence);
      expect(titles(), result.kind).toEqual([]);
      /* The Scholar link stays, under every one of them. */
      expect(scholar()?.href, result.kind).toContain("scholar.google.com");
      for (const [, other] of sentences) if (other !== sentence) expect(said(), result.kind).not.toContain(other);
    }
    /* The sentence for a DOI we could not confirm does not accuse it of being another work's. */
    expect(CITERS_UNCONFIRMED).not.toMatch(/belongs|different|another/);
  });

  it("offers Try again only when trying again could help", () => {
    withCiters({ kind: "unavailable" });
    press(tryAgain());
    expect(retried).toEqual(["retry"]);
    for (const kind of ["no-doi", "not-indexed", "unconfirmed", "too-large"] as const) {
      withCiters({ kind });
      expect(tryAgain(), kind).toBeNull();
    }
  });

  it("says it is looking while the list is on its way, and lists nothing yet", () => {
    withCiters(null);
    expect(said()).toContain(CITERS_LOADING);
    expect(section()?.querySelector("[role='status']")).not.toBeNull();
    expect(titles()).toEqual([]);
  });

  it("lists the papers with OpenAlex's count and its date, and says we have not read them", () => {
    withCiters(found(3, { citers: [citer(0, { kind: "review", citedByCount: 34, authors: ["Michael G. Levin"], venue: "BioEssays", year: 2024 }), citer(1, { citedByCount: 1 }), citer(2)] }));
    expect(said()).toContain("3 papers cite this piece, by OpenAlex's count on");
    expect(said()).toContain("2026");
    expect(said()).toContain("Most cited first.");
    expect(said()).toContain(CITERS_UNREAD);
    expect(titles()).toEqual(["Citing paper 0", "Citing paper 1", "Citing paper 2"]);
    const lines = [...host.querySelectorAll(".dbt-citer .dbt-meta")].map((p) => p.textContent);
    expect(lines[0]).toBe("Michael G. Levin · BioEssays · 2024 · review · cited 34 times");
    /* `article` is what nearly every row is, so it is not said; once is not "1 times". */
    expect(lines[1]).toBe("Ada Lovelace · A Journal · 2025 · cited once");
  });

  it("builds each link itself: the DOI, else the OpenAlex id, with no referrer and no opener", () => {
    const { doi: _doi, ...noDoi } = citer(1);
    withCiters(found(3, { citers: [citer(0), noDoi, { ...noDoi, openalexId: "W1\"><script>", title: "No address at all" }] }));
    const links = [...host.querySelectorAll<HTMLAnchorElement>("a.dbt-citer-title")];
    expect(links.map((a) => a.href)).toEqual(["https://doi.org/10.1000/citer.0", "https://openalex.org/W7001"]);
    for (const a of links) {
      expect(a.target).toBe("_blank");
      expect(a.rel.split(" ").sort()).toEqual(["noopener", "noreferrer"]);
    }
    /* The third has no address we can build, so it is text and not a link. */
    expect(titles()).toEqual(["Citing paper 0", "Citing paper 1", "No address at all"]);
    expect(host.querySelector("script")).toBeNull();
  });

  it("shows the first ten, then all of them on one press", () => {
    withCiters(found(39));
    expect(titles()).toHaveLength(10);
    expect(showAll()?.textContent).toBe("Show all 39");
    press(showAll());
    expect(titles()).toHaveLength(39);
    expect(showAll()).toBeNull();
    /* Ten or fewer need no button. */
    withCiters(found(10));
    expect(titles()).toHaveLength(10);
    expect(showAll()).toBeNull();
  });

  it("says when the page limit left some out, and separately when a record could not be shown (F5)", () => {
    withCiters(found(100, { count: 389, capped: true }));
    expect(said()).toContain("389 papers cite this piece");
    expect(said()).toContain("The 100 most cited are listed.");
    expect(showAll()?.textContent).toBe("Show all 100");

    /* 39 returned, one unshowable: 38 listed, and the limit hid none. */
    withCiters(found(38, { count: 39, returned: 39, dropped: 1 }));
    expect(said()).toContain("39 papers cite this piece");
    expect(said()).toContain("38 are listed, most cited first.");
    expect(said()).toContain("1 record could not be shown");
    expect(said()).not.toContain("most cited are listed");

    /* 100 of 389 returned, five unshowable: 95 listed, and it does not claim 100. */
    withCiters(found(95, { count: 389, returned: 100, dropped: 5, capped: true }));
    expect(said()).toContain("We asked for the 100 most cited, and 95 are listed.");
    expect(said()).toContain("5 records could not be shown");
    expect(said()).not.toContain("The 100 most cited are listed.");

    /* A count, and nothing we can show: not the "no paper citing it" sentence. */
    withCiters(found(0, { count: 2, returned: 2, dropped: 2 }));
    expect(said()).toContain("2 papers cite this piece");
    expect(said()).toContain("None of them could be shown here.");
    expect(said()).not.toContain(CITERS_NONE);
  });

  it("is on screen before the search has run, beside its button, and starts nothing (F8)", () => {
    let ensured = 0;
    let regenerated = 0;
    const before = owner({
      status: "none",
      debate: null,
      ensure: async () => {
        ensured += 1;
      },
      regenerate: async () => {
        regenerated += 1;
      },
    });
    withCiters(found(12), before);
    /* The band is height-bounded. A list must sit inside
       its scroller even before there is a stored paid search. */
    expect(section()?.parentElement?.classList.contains("dbt-scroll")).toBe(true);
    expect(text()).toContain("Nobody has asked the web about this one yet.");
    expect(said()).toContain("12 papers cite this piece");
    expect(titles()).toHaveLength(10);
    press(showAll());
    expect(titles()).toHaveLength(12);
    expect(scholar()).not.toBeNull();
    expect([ensured, regenerated]).toEqual([0, 0]);
    /* …and while the opening read is still out, or failed. */
    withCiters(found(2), owner({ status: "loading", debate: null }));
    expect(titles()).toHaveLength(2);
    withCiters(found(2), owner({ status: "error", debate: null, error: "We could not load this." }));
    expect(titles()).toHaveLength(2);
  });

  it("names the service contact address in its description of what is sent", () => {
    expect(CITERS_ABOUT).toContain("contact address");
  });

  it("is Reception's, not Claims'", () => {
    withCiters(found(3), owner(), "claims");
    expect(section()).toBeNull();
    withCiters(found(3), owner(), "reception");
    expect(section()).not.toBeNull();
  });

  it("does not change Reception's count, which is the web search's rows", () => {
    withCiters(found(39), owner({ debate: artefact({ direct: { rows: [], counts: counts(EMPTY) } }) }));
    expect(segments()[0]).toBe("Reception0");
    expect(host.querySelectorAll(".dbt-item")).toHaveLength(0);
    expect(titles()).toHaveLength(10);
  });

  it("is not drawn for a visitor, who keeps the Scholar link alone", () => {
    paintShared(shared());
    expect(section()).toBeNull();
    expect(text()).not.toContain(CITERS_HEADING);
    expect(host.querySelector("a.dbt-scholar")).not.toBeNull();
  });

  it("says in the (i) where the list comes from and what is sent", () => {
    withCiters(found(3));
    expect(card()).toContain(CITERS_ABOUT);
    withCiters(found(3), owner({ status: "none", debate: null }));
    expect(card()).toContain(CITERS_ABOUT);
    paintShared(shared());
    expect(card()).not.toContain(CITERS_ABOUT);
  });
});

describe("each row saying what it is", () => {
  it("labels a row about this piece by its strongest signal, and a claim row with no chip at all", () => {
    paint(owner());
    const marks = [...host.querySelectorAll(".dbt-mark")].map((m) => m.textContent ?? "");
    expect(marks).toEqual(["Names this piece"]);
    paint(owner(), "claims");
    expect(host.querySelectorAll(".dbt-mark")).toHaveLength(0);
    /* The pill said the same thing on every claim row; the claim itself says it now. */
    expect(text()).not.toContain("On what it claims");
  });

  /* The level is the *strongest* signal, by a lookup over a fixed order — never
     the first one, and never a sum of them. */
  it("takes the strongest signal for the chip when a row has several", () => {
    paint(
      owner({
        debate: artefact({
          direct: {
            rows: [
              direct({
                identifies: [
                  { kind: "named", by: "title", witness: "Notes on my sourdough starter" },
                  { kind: "linked", url: "https://example.com/the-piece" },
                ],
              }),
            ],
            counts: counts(),
          },
        }),
      }),
    );
    expect(host.querySelector(".dbt-mark")?.textContent).toBe("Links this piece");
  });

  /* Greg asked for this tooltip by name: *"a tooltip for each showing the
     reasons"*. It is the evidence itself — the address that matched, the words
     found in the page's extract — and not a gloss on it, so what it must never
     do is summarise several signals into one line. */
  it("lists every signal in the tooltip, one line each, with the evidence in it", () => {
    const lines = identificationEvidence(
      direct({
        identifies: [
          { kind: "linked", url: "https://example.com/the-piece" },
          {
            kind: "quoted",
            quote: "a starter needs cool water",
            blockId: KNOWN,
            coverage: 0.223,
            density: 0.164,
          },
          { kind: "named", by: "title-and-byline", witness: "Notes on my starter, by A. Baker" },
        ],
      }),
    );
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain("https://example.com/the-piece");
    expect(lines[1]).toContain("a starter needs cool water");
    expect(lines[1]).toContain("22%");
    expect(lines[1]).toContain("16%");
    expect(lines[2]).toContain("title and byline");
    expect(lines[2]).toContain("Notes on my starter, by A. Baker");
  });

  /* The floor fires on a single 8-word window, so a real hit on a long article
     rounds to zero — and "0% turns up here" under a chip saying the page quotes
     it reads as a contradiction. */
  it("says under 1% rather than 0% for a hit too small to round to one", () => {
    const lines = identificationEvidence(
      direct({
        identifies: [
          { kind: "quoted", quote: "eight words of the piece", blockId: KNOWN, coverage: 0.004, density: 0.65 },
        ],
      }),
    );
    expect(lines[0]).toContain("under 1%");
    expect(lines[0]).not.toContain("0%");
  });

  /* An artefact written before 2026-09-06 has no `identifies` key at all.
     `identifiesOf` reads it as `named` on the witness that kept it, so nothing
     needs re-running — and the panel must not blank the chip or throw. */
  it("draws a chip for a row stored before the field existed", () => {
    const old = direct();
    delete (old as { identifies?: unknown }).identifies;
    paint(owner({ debate: artefact({ direct: { rows: [old], counts: counts() } }) }));
    expect(host.querySelector(".dbt-mark")?.textContent).toBe("Names this piece");
    expect(identificationEvidence(old)[0]).toContain("Notes on my sourdough starter, week 3");
  });
});

describe("the lean is a direction, never a score", () => {
  it("has an appearance for every lean and no number in any of them", () => {
    const keys = Object.keys(LEAN_APPEARANCE).sort();
    expect(keys).toEqual(["cannot-tell", "leans-against", "leans-for", "neither"]);
    for (const [name, look] of Object.entries(LEAN_APPEARANCE)) {
      expect(look.label, name).not.toMatch(/\d/);
      expect(look.label, name).not.toContain("%");
    }
  });

  it("prints no percentage and no score on a full panel", () => {
    paint(owner());
    expect(text()).not.toContain("%");
    expect(text().toLowerCase()).not.toContain("score");
  });

  /* Rule 3. `unclear` and `cannot-tell` are not failure states, and the way a
     panel says so is that they get the same furniture as the rest: a named chip
     with visible words in it, not an absence and not a warning. */
  it("draws neither and cannot-tell with the same chip the others get", () => {
    const four: DebateLean[] = ["leans-for", "leans-against", "neither", "cannot-tell"];
    paint(
      owner({
        debate: artefact({
          direct: {
            rows: four.map((lean, i) =>
              direct({ id: `spya-d2w4r${"23456789"[i] ?? "2"}`, lean }),
            ),
            counts: counts({ reportedRows: 4, keptRows: 4 }),
          },
          /* Emptied, so the four chips counted below are the four asked for
             rather than four plus whatever the other group happened to hold. */
          claims: { rows: [], counts: counts({ returnedSources: 0, reportedRows: 0, keptRows: 0 }) },
        }),
      }),
    );
    const chips = [...host.querySelectorAll(".dbt-lean")];
    expect(chips).toHaveLength(4);
    for (const chip of chips) {
      expect((chip.textContent ?? "").trim().length).toBeGreaterThan(0);
      /* No chip is drawn as a fault. A dimmed or warning-coloured "cannot-tell"
         would be the panel disbelieving its own model out loud. */
      expect(chip.className).not.toMatch(/error|warn|fail/);
    }
    for (const lean of four) {
      expect(text()).toContain(LEAN_APPEARANCE[lean].label);
    }
  });
});

describe("what the model read, and what we located", () => {
  /* Rule 4, and it is the assertion that stops the two halves of a row being
     drawn alike. `applies`, `relation` and `lean` are inside the labelled
     block; the quotation is outside it. */
  it("labels relation and lean as the AI's, on their own line, apart from the quotation", () => {
    paint(owner());
    const line = host.querySelector(".dbt-item .dbt-ai-line");
    expect(line).not.toBeNull();
    const inside = line?.textContent ?? "";
    expect(line?.querySelector(".dbt-ai-tag")?.textContent).toBe("AI");
    expect(inside).toContain(LEAN_APPEARANCE["leans-against"].label);
    expect(inside).toContain("disputes");
    /* The positive control: the located quotation is *not* in there. */
    expect(inside).not.toContain("the argument here does not survive its own third section");
  });

  it("keeps the AI's paragraph inside the 'AI interpretation' fence, and the quotation out", () => {
    paint(owner());
    const read = host.querySelector(".dbt-ai");
    expect(read).not.toBeNull();
    const inside = read?.textContent ?? "";
    expect(inside).toContain("AI interpretation");
    expect(inside).toContain("It says the piece's third section contradicts its second.");
    expect(inside).not.toContain("the argument here does not survive its own third section");
  });

  /* The title says what the work is; the site under it is the authority signal
     a reader can judge for themselves. Both the wire's, never the model's. */
  it("leads the row with the title as the link out, and the site under it", () => {
    paint(owner());
    const item = host.querySelector(".dbt-item");
    const first = item?.firstElementChild;
    expect(first?.matches("a.dbt-title")).toBe(true);
    expect(first?.textContent).toContain("A reply to the piece");
    expect(item?.querySelector(".dbt-meta .dbt-site")?.textContent).toBe("example.org");
  });

  it("uses the address as the headline when the search gave no title, and does not repeat the site", () => {
    const untitled = claim({ url: "https://arxiv.org/pdf/1809.10635" });
    delete untitled.title;
    paint(
      owner({
        debate: artefact({
          direct: { rows: [], counts: counts() },
          claims: {
            rows: [untitled],
            counts: counts({ returnedSources: 1 }),
          },
        }),
      }),
      "claims",
    );
    expect(host.querySelector("a.dbt-title")?.textContent).toBe("arxiv.org/pdf/1809.10635");
    expect(host.querySelector(".dbt-site")).toBeNull();
  });

  /* A stranger's page: the address of the article being read is not its
     business, and it must not get a handle on this window. */
  it("opens every outbound link in a new tab with no referrer and no opener", () => {
    paint(owner());
    const out = [...host.querySelectorAll<HTMLAnchorElement>("a[href^='https://']")];
    /* The row's title and its *Read it on…*, and the Scholar link under them. */
    expect(out.length).toBeGreaterThanOrEqual(3);
    for (const a of out) {
      expect(a.target, a.href).toBe("_blank");
      expect(a.rel.split(" ").sort(), a.href).toEqual(["noopener", "noreferrer"]);
    }
  });

  /* The ⓘ went into `more` on 2026-09-29: one way to see a source's detail,
     and the portalled dialog a keyboard reader tabbed past went with it. */
  it("has no ⓘ button and no hover card any more", () => {
    paint(owner());
    expect(host.querySelector(".dbt-info")).toBeNull();
    expect(document.querySelector("[role='dialog']")).toBeNull();
  });

  /* Rule 6. The excerpt is a slice of a stranger's page. React escapes by
     default, so this passes the day it is written — and it is here because the
     one way to lose it is a `dangerouslySetInnerHTML` added later for
     highlighting, which nothing else would catch. */
  it("renders a source quote as text and never as markup", () => {
    paint(
      owner({
        debate: artefact({
          direct: {
            rows: [direct({ sourceQuote: "<img src=x onerror=alert(1)> and <b>bold</b>" })],
            counts: counts(),
          },
        }),
      }),
    );
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector(".dbt-quote b")).toBeNull();
    expect(text()).toContain("<img src=x onerror=alert(1)> and <b>bold</b>");
  });

  /* Every other string on the row is a stranger's too — the title off the
     wire, the witness, and what the model wrote about the page — and `more`
     draws the ones the card used to. Open, so they are all on screen. */
  it("renders the title, the witness and the AI's paragraph as text, open or closed", () => {
    const hostile = "<img src=y onerror=alert(2)><script>x()</script>";
    paint(
      owner({
        debate: artefact({
          direct: {
            rows: [
              direct({
                title: `T ${hostile}`,
                articleReferenceQuote: `W ${hostile}`,
                applies: `A ${hostile}`,
                limits: `L ${hostile}`,
              }),
            ],
            counts: counts(),
          },
        }),
      }),
    );
    press(host.querySelector(".dbt-more"));
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector("script")).toBeNull();
    for (const prefix of ["T ", "W ", "A ", "L "]) expect(text()).toContain(`${prefix}${hostile}`);
  });
});

describe("the owner's foot lines", () => {
  it("says nothing when the model's rows all survived", () => {
    expect(keptNote(counts({ reportedRows: 4, keptRows: 4 }), "direct")).toBeNull();
  });

  it("names how many were dropped when they were not", () => {
    const note =
      keptNote(counts({ reportedRows: 6, keptRows: 4, lost: losses({ uncited: 2 }) }), "direct") ??
      "";
    expect(note).toContain("6");
    expect(note).toContain("4");
  });

  /* **Each sentence names its own search**, because the headings that used to
     say it are gone and the two searches' numbers cannot be summed:
     `returnedSources` is per-pass and `distinctSources` dedupes across the whole
     list, so a page returned by both would be counted twice against once. */
  it("says which of the two searches it is counting", () => {
    const one = keptNote(counts({ reportedRows: 6, keptRows: 4 }), "direct") ?? "";
    const two = keptNote(counts({ reportedRows: 6, keptRows: 4 }), "claims") ?? "";
    expect(one).toContain("replies to this piece");
    expect(two).toContain("what it claims");
    expect(one).not.toBe(two);
  });

  /* A row past the cap was not refused — nothing was wrong with it, the list
     simply stopped — so it must not be reported as one we could not check. The
     numbers are the same either way, which is why this needs asserting. */
  it("says so when rows were lost to the cap rather than to a check", () => {
    const note = keptNote(counts({ reportedRows: 14, keptRows: 12, omittedOverCap: 2 }), "direct") ?? "";
    expect(note).toContain("12");
    expect(note).toContain("past the limit");
    expect(note).not.toContain("could not be checked");
  });

  it("says both when some were refused and some were past the cap", () => {
    const note =
      keptNote(
        counts({
          reportedRows: 16,
          keptRows: 12,
          omittedOverCap: 1,
          lost: losses({ unverifiedSource: 3 }),
        }),
        "direct",
      ) ?? "";
    expect(note).toContain("3 could not be checked");
    expect(note).toContain("1 more was past the limit");
  });

  /* **A copy was checked, and checked successfully.** It links the piece, it
     quotes it exactly, every counter reads clean — and it was refused for being
     the article rather than a reply to it. Folding it into "could not be
     checked" tells the reader we failed at something we did not fail at, which
     is the wording this clause exists to avoid. */
  it("does not say a mirror could not be checked, because it could", () => {
    const note =
      keptNote(
        counts({ reportedRows: 4, keptRows: 3, lost: losses({ sourceIsCopy: 1 }) }),
        "direct",
      ) ?? "";
    expect(note).toContain("1 turned out to be a copy of this article rather than a reply to it");
    expect(note).not.toContain("could not be checked");
  });

  it("keeps the two kinds of refusal apart when a search has both", () => {
    const note =
      keptNote(
        counts({
          reportedRows: 9,
          keptRows: 4,
          omittedOverCap: 1,
          lost: losses({ unverifiedSource: 2, sourceIsCopy: 2 }),
        }),
        "direct",
      ) ?? "";
    expect(note).toContain("2 could not be checked");
    expect(note).toContain("2 turned out to be copies");
    expect(note).toContain("1 more was past the limit");
  });

  /* **The one unacceptable outcome is a counter that stops reaching the
     reader** (docs/reusable/silent-success.md), and the way it happens is that
     somebody adds a reason to `DebateLosses` and nobody adds a clause. This
     walks every field there is, so a new one arrives here red rather than
     silent: `anyLost` makes the *type* exhaustive, and this makes the
     *sentence* exhaustive. */
  it("puts every loss reason there is into a sentence the reader gets", () => {
    for (const reason of Object.keys(losses()) as (keyof DebateLosses)[]) {
      const note = keptNote(
        counts({ reportedRows: 5, keptRows: 4, lost: losses({ [reason]: 1 }) }),
        "direct",
      );
      expect(note, reason).not.toBeNull();
      expect(note ?? "", reason).toContain("5");
      expect(note ?? "", reason).toContain("4");
      /* Not merely present: the sentence has to *account* for the missing row,
         so one clause or another has to claim it. */
      expect(note ?? "", reason).toMatch(/1 could not be checked|1 turned out to be a copy/);
    }
  });

  /* **Every debate artefact in the local database predates `sourceIsCopy`**,
     which landed on 2026-09-06 — and `isDebateDocument` validates two arrays and
     nothing else, so those artefacts reach this panel with the key simply
     absent. Read as a number it is `undefined`, and one `Math.min` away from a
     `NaN` that fails every comparison below it: the sentence keeps its counts
     and loses every clause that explains them. Found by looking at the stored
     rows rather than at the type, which says the field is always there. */
  it("still explains the losses on an artefact stored before the copy counter", () => {
    const old = losses({ unverifiedSource: 2 }) as Partial<DebateLosses>;
    delete old.sourceIsCopy;
    const note =
      keptNote(counts({ reportedRows: 5, keptRows: 3, lost: old as DebateLosses }), "direct") ?? "";
    expect(note).toContain("2 could not be checked");
    expect(note).not.toContain("NaN");
  });

  /* Rule 5, the half a model can walk past. Ten pages of evidence, three rows
     reported, all three valid: every loss counter reads zero and seven pages
     never entered the answer. */
  it("says how many returned pages contribute, when that differs", () => {
    const note =
      sourcesNote(
        counts({ returnedSources: 7 }),
        [{ url: "https://a.example" }, { url: "https://b.example" }],
        "direct",
      ) ?? "";
    expect(note).toContain("7");
    expect(note).toContain("2");
  });

  it("says nothing when every returned page contributes", () => {
    expect(
      sourcesNote(
        counts({ returnedSources: 2 }),
        [{ url: "https://a.example" }, { url: "https://b.example" }],
        "direct",
      ),
    ).toBeNull();
  });

  /* Rows are deliberately not deduplicated by URL — one review can answer two
     claims — so two rows about one page is one contributing page, and the
     sentence has to count pages rather than rows or it fires on a truth. */
  it("counts pages rather than rows when one page answers twice", () => {
    expect(
      sourcesNote(
        counts({ returnedSources: 1 }),
        [{ url: "https://a.example" }, { url: "https://a.example" }],
        "direct",
      ),
    ).toBeNull();
  });

  it("draws the foot lines on the panel, not only in the helpers", () => {
    paint(
      owner({
        debate: artefact({
          direct: {
            rows: [direct()],
            counts: counts({ returnedSources: 9, reportedRows: 5, keptRows: 1, lost: losses({ uncited: 4 }) }),
          },
        }),
      }),
    );
    expect(card()).toContain("9");
    expect(card()).toContain("5");
  });

  /* **Both searches keep their own numbers under the one list.** The tempting
     simplification is to sum them into one pair of sentences, and it is wrong on
     a fact rather than on taste — so this asserts that a losing claims search is
     still reported when the direct one is clean. */
  it("reports each search's losses even though there is only one list", () => {
    paint(
      owner({
        debate: artefact({
          direct: { rows: [direct()], counts: counts({ returnedSources: 1 }) },
          claims: {
            rows: [claim()],
            counts: counts({
              returnedSources: 1,
              reportedRows: 7,
              keptRows: 1,
              lost: losses({ claimNotInBlock: 6 }),
            }),
          },
        }),
      }),
    );
    const foot = card();
    expect(foot).toContain("what it claims");
    expect(foot).toContain("7");
    expect(foot).not.toContain("replies to this piece");
  });
});

describe("searchedAt is displayed provenance, not staleness", () => {
  /* In the band's (i) since 2026-10-01, in `AboutMade`'s words. The year is
     the one part of the date no locale reorders. */
  it("says when the search ran, on an artefact that is perfectly current", () => {
    paint(owner());
    expect(text()).not.toContain("Searched");
    expect(card()).toMatch(/Searched by .*2026/);
  });

  it("says something different when the article has moved underneath it", () => {
    paint(owner({ stale: true }));
    /* Both, and they are not the same sentence: the search is still dated, and
       the article changing is a separate fact with its own banner. */
    expect(card()).toContain("Searched by");
    expect(text()).toContain("The article has changed");
  });
});



describe("more, which replaced the ⓘ card", () => {
  it("starts closed, with the detail in the page but hidden", () => {
    paint(owner());
    const button = host.querySelector<HTMLButtonElement>(".dbt-item .dbt-more");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    const detail = document.getElementById(button?.getAttribute("aria-controls") ?? "");
    expect(detail, "aria-controls names an element that exists").not.toBeNull();
    expect(detail?.hidden).toBe(true);
    expect(host.querySelector(".dbt-item")?.classList.contains("open")).toBe(false);
  });

  it("opens on a press and holds everything the card held", () => {
    paint(owner());
    const item = host.querySelector(".dbt-item");
    const button = item?.querySelector<HTMLButtonElement>(".dbt-more");
    press(button);
    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(item?.classList.contains("open")).toBe(true);
    const detail = document.getElementById(button?.getAttribute("aria-controls") ?? "");
    expect(detail?.hidden).toBe(false);
    const inside = detail?.textContent ?? "";
    expect(inside).toContain("AI interpretation");
    expect(inside).toContain("It says the piece's third section contradicts its second.");
    expect(inside).toContain("https://example.org/a-reply");
    /* The extracts-only sentence was on every row's `more` until 2026-10-03;
       it is said once, in the band's (i) (plan 261003o, step 8). */
    expect(inside).not.toContain(DEBATE_EXTRACTS_ONLY);
    expect(card()).toContain(DEBATE_EXTRACTS_ONLY);
    const out = detail?.querySelector<HTMLAnchorElement>("a.dbt-out");
    expect(out?.textContent).toContain("Read it on example.org");
    expect(out?.href).toBe("https://example.org/a-reply");
    /* And closes again. */
    press(button);
    expect(button?.getAttribute("aria-expanded")).toBe("false");
  });

  /* A direct row's whole claim is that this page is about this piece; the
     witness is the evidence, and it went where the card went. */
  it("carries the witness on a row about this piece, and none on a claim row", () => {
    paint(owner());
    expect(host.querySelector(".dbt-item .dbt-ref")?.textContent).toBe(
      "It names this article: “Notes on my sourdough starter, week 3”",
    );
    paint(owner(), "claims");
    expect(host.querySelectorAll(".dbt-item")).toHaveLength(1);
    expect(host.querySelector(".dbt-item .dbt-ref")).toBeNull();
  });

  /* Keyboard parity is what the ⓘ lacked. A native `<button type="button">`
     is activated by Enter and Space by the browser itself — jsdom does not
     synthesise that, so what is asserted is the element, not the keystroke. */
  it("is a real button a keyboard reaches, named for the source it opens", () => {
    paint(owner());
    const button = host.querySelector<HTMLButtonElement>(".dbt-more");
    expect(button?.tagName).toBe("BUTTON");
    expect(button?.type).toBe("button");
    expect(button?.disabled).toBe(false);
    expect(button?.tabIndex).toBe(0);
    button?.focus();
    expect(document.activeElement).toBe(button);
    expect(button?.textContent).toContain("more about “A reply to the piece”");
  });
});

describe("the head count", () => {
  it("says excerpts, and the pages behind them only when that differs", () => {
    expect(headCount([{ url: "https://a.example" }])).toBe("1 excerpt");
    expect(headCount([{ url: "https://a.example" }, { url: "https://b.example" }])).toBe("2 excerpts");
    expect(headCount([{ url: "https://a.example" }, { url: "https://a.example" }])).toBe(
      "2 excerpts from 1 page",
    );
    expect(headCount([])).toBe("0 excerpts");
  });

  it("counts what is on screen, on the panel", () => {
    paint(
      owner({
        debate: artefact({
          claims: {
            rows: [claim(), claim({ id: "spya-c7w2d3", claimQuote: "another claim" })],
            counts: counts(),
          },
        }),
      }),
      "claims",
    );
    expect(card()).toContain("2 excerpts from 1 page on screen.");
    /* The sub-mode on screen, not the whole debate. */
    paint(owner());
    expect(card()).toContain("1 excerpt on screen.");
  });
});

describe("Claims: one group per claim, in the article's own words", () => {
  it("heads each group with the claim, the way to its passage and how many rows are under it", () => {
    paint(
      owner({
        debate: artefact({
          claims: {
            rows: [claim(), claim({ id: "spya-c7w2d3", url: "https://third.example/x" })],
            counts: counts({ reportedRows: 2, keptRows: 2 }),
          },
        }),
      }),
      "claims",
    );
    const groups = [...host.querySelectorAll("details.dbt-claim-group")];
    expect(groups).toHaveLength(1);
    const summary = groups[0]?.querySelector("summary");
    expect(summary?.querySelector(".dbt-group-quote")?.textContent).toBe("“a starter needs cool water”");
    expect(summary?.querySelector(".dbt-group-count")?.textContent).toBe("2");
    expect(groups[0]?.querySelectorAll(".dbt-item")).toHaveLength(2);
    /* The claim is the heading, so the rows under it do not repeat it. */
    expect(host.querySelectorAll(".dbt-item .dbt-claim")).toHaveLength(0);
    /* `BlockRef` is a real `<a href>` so the browser's own affordances work —
       status bar, ⌘-click, copy link address — and a plain left click jumps
       in place. src/web/BlockRef.tsx. */
    const ref = summary?.querySelector<HTMLAnchorElement>("a.block-ref");
    expect(ref, "a block reference for the claim's block").not.toBeNull();
    expect(ref?.textContent).toContain(KNOWN.slice(-6));
    press(ref);
    expect(jumped).toEqual([KNOWN]);
  });

  /* Native `<details>`, open: a reader sees every claim's rows on arrival, and
     can fold away the ones they are not checking. */
  it("draws every group open", () => {
    paint(owner(), "claims");
    const group = host.querySelector<HTMLDetailsElement>("details.dbt-claim-group");
    expect(group?.open).toBe(true);
  });

  it("groups in the order the article makes its claims, not the order the search found them", () => {
    const EARLY = "spya-w7t24d" as BlockId;
    paint(
      owner({
        debate: artefact({
          claims: {
            rows: [
              claim({ id: "spya-c7w2d3", claimQuote: "the later claim" }),
              claim({ id: "spya-c7w2d4", blockId: EARLY, claimQuote: "the earlier claim" }),
            ],
            counts: counts({ reportedRows: 2, keptRows: 2 }),
          },
        }),
      }),
      "claims",
      "prioritised",
      new Map([
        [EARLY, 0],
        [KNOWN, 5],
      ]),
    );
    const heads = [...host.querySelectorAll(".dbt-group-quote")].map((h) => h.textContent);
    expect(heads).toEqual(["“the earlier claim”", "“the later claim”"]);
  });

  /* No for/against tally in a heading (GPT Sol's F9): it would promote the
     model's reading of each page into a headline in our voice. */
  it("puts no stance tally in a claim's heading", () => {
    paint(owner(), "claims");
    const head = host.querySelector("details.dbt-claim-group > summary")?.textContent ?? "";
    for (const look of Object.values(LEAN_APPEARANCE)) expect(head).not.toContain(look.label);
    expect(head.toLowerCase()).not.toMatch(/against|supportive|critical/);
  });

  it("has no order control, and ignores `debateby`", () => {
    const rows = [
      claim({ id: "spya-c7w2d3", title: "Supportive one", lean: "leans-for" }),
      claim({ id: "spya-c7w2d4", title: "Critical one", lean: "leans-against" }),
    ];
    const debate = artefact({ claims: { rows, counts: counts({ reportedRows: 2, keptRows: 2 }) } });
    for (const order of ["prioritised", "stance", "date"] as const) {
      paint(owner({ debate }), "claims", order);
      expect(host.querySelector(".gloss-sort"), order).toBeNull();
      expect(rowTitles(), order).toEqual(["Supportive one", "Critical one"]);
    }
  });
});

describe("Reception's order bar", () => {
  const supportive = direct({ id: "spya-d2w4r3", url: "https://fan.example/x", title: "Supportive", lean: "leans-for" });
  const critical = direct({ id: "spya-d2w4r4", url: "https://critic.example/x", title: "Critical", lean: "leans-against" });
  const two = () =>
    artefact({ direct: { rows: [supportive, critical], counts: counts({ reportedRows: 2, keptRows: 2 }) } });

  it("offers as found and stance, in Glossary's words, with as found pressed", () => {
    paint(owner({ debate: two() }));
    const group = host.querySelector("[role='group'][aria-label='Order the sources by']");
    expect(group).not.toBeNull();
    const buttons = [...(group?.querySelectorAll("button") ?? [])];
    expect(buttons.map((b) => b.textContent)).toEqual(["as found", "stance"]);
    expect(host.querySelector(".gloss-sort-btn[aria-pressed='true']")?.textContent).toBe("as found");
    expect(rowTitles()).toEqual(["Supportive", "Critical"]);
  });

  /* Date is asked for and no row carries a year, so what is drawn is *as
     found* — and the pressed button has to say so. */
  it("presses the order actually drawn, not the one the URL asked for", () => {
    paint(owner({ debate: two() }), "reception", "date");
    expect(host.querySelector(".gloss-sort-btn[aria-pressed='true']")?.textContent).toBe("as found");
  });

  it("hands a press back as the order's word", () => {
    paint(owner({ debate: two() }));
    press([...host.querySelectorAll(".gloss-sort-btn")].find((b) => b.textContent === "stance"));
    expect(ordered).toEqual(["stance"]);
  });

  /* The per-order sentence over the list went on 2026-10-03 (plan 261003o,
     step 8): the pressed button already says the order. */
  it("draws no sentence about the order over the list", () => {
    paint(owner({ debate: two() }), "reception", "stance");
    expect(host.querySelector(".dbt-frame")).toBeNull();
  });

  it("puts the critical rows first in stance", () => {
    paint(owner({ debate: two() }), "reception", "stance");
    expect(rowTitles()).toEqual(["Critical", "Supportive"]);
  });

  /* Each order is applied **within** the two identification groups: a
     title-only row never climbs above one that quotes the piece. */
  it("orders within the two groups, never across them", () => {
    const quoting = (id: string, title: string, lean: DebateLean) =>
      direct({
        id,
        title,
        lean,
        url: `https://quoting.example/${id}`,
        identifies: [{ kind: "quoted", quote: "a starter needs cool water", blockId: KNOWN, coverage: 0.04, density: 0.13 }],
      });
    paint(
      owner({
        debate: artefact({
          direct: {
            rows: [
              direct({ id: "spya-d2w4r3", title: "Named, supportive", lean: "leans-for" }),
              quoting("spya-d2w4r4", "Quoted, supportive", "leans-for"),
              quoting("spya-d2w4r5", "Quoted, critical", "leans-against"),
              direct({ id: "spya-d2w4r6", title: "Named, critical", lean: "leans-against" }),
            ],
            counts: counts({ reportedRows: 4, keptRows: 4 }),
          },
        }),
      }),
      "reception",
      "stance",
    );
    expect(rowTitles()).toEqual(["Quoted, critical", "Quoted, supportive", "Named, critical", "Named, supportive"]);
    expect(host.querySelectorAll("section.dbt-title-only .dbt-item")).toHaveLength(2);
  });

  /* F14: two buttons that draw the same list teach the reader the control does
     nothing. One row cannot be ordered. */
  it("draws no bar when no two orders would draw different lists", () => {
    paint(owner());
    expect(host.querySelector(".gloss-sort")).toBeNull();
  });

  it("gives a visitor the same bar and the same orders", () => {
    paintShared(
      shared({ direct: { rows: [supportive, critical], sourceNotPublishable: 0 } } as Partial<PublicDebate>),
      "reception",
      "stance",
    );
    expect([...host.querySelectorAll(".gloss-sort-btn")].map((b) => b.textContent)).toEqual(["as found", "stance"]);
    expect(host.querySelector(".gloss-sort-btn[aria-pressed='true']")?.textContent).toBe("stance");
  });
});

describe("Reception by date, and the marker at this piece's year", () => {
  const dated = () =>
    artefact({
      direct: {
        rows: [
          direct({ id: "spya-d2w4r2", title: "No year" }),
          direct3({ id: "spya-d2w4r3", title: "Later", publishedYear: 2024 }),
          direct3({ id: "spya-d2w4r4", title: "Same year", publishedYear: 2022 }),
          direct3({ id: "spya-d2w4r5", title: "Earlier", publishedYear: 2016 }),
        ],
        counts: counts({ returnedSources: 4, reportedRows: 4, keptRows: 4 }),
      },
    });

  it("draws oldest first, the marker before the first row of the article's year, undated last", () => {
    paint(owner({ debate: dated() }), "reception", "date", new Map(), { articleYear: 2022 });
    expect(host.querySelector(".gloss-sort-btn[aria-pressed='true']")?.textContent).toBe("date");
    expect(sequence()).toEqual([
      "Earlier",
      "This piece, 2022",
      "Same year",
      "Later",
      DEBATE_UNDATED,
      "No year",
    ]);
    /* Never "after this piece": a year cannot order two things inside itself. */
    expect(text().toLowerCase()).not.toContain("after this piece");
  });

  it("draws no marker when the article gives no year", () => {
    paint(owner({ debate: dated() }), "reception", "date");
    expect(host.querySelector(".dbt-marker")).toBeNull();
    expect(sequence()).toEqual(["Earlier", "Same year", "Later", DEBATE_UNDATED, "No year"]);
  });
});


/* ------------------------------------------------------ stage 2 (debate/3) --
   What the search now keeps about the work — title, authors, year — and the
   AI's `bears`, which *prioritised* orders by and the relevance bar filters.
   docs/plans/260929h-debate-mode-clearer-sources-and-orders.md F1, F2, F5, F7. */

/** A claim row with stage 2's fields, cast the way the store casts. */
function claim3(over: Partial<ClaimDebateRow> & Record<string, unknown>): ClaimDebateRow {
  return claim(over as Partial<ClaimDebateRow>);
}

/** …and a row about this piece with them. */
function direct3(over: Partial<DirectDebateRow> & Record<string, unknown>): DirectDebateRow {
  return direct(over as Partial<DirectDebateRow>);
}

/** What a reader sees, in document order: titles, markers and the missing-data lines. */
function sequence(): string[] {
  return [...host.querySelectorAll(".dbt-item a.dbt-title, .dbt-marker, .dbt-gap")].map(
    (el) => el.textContent ?? "",
  );
}

describe("the work: title, authors and year", () => {
  const authored = (authors: string[]) =>
    artefact({
      direct: { rows: [], counts: counts() },
      claims: {
        rows: [claim3({ authors, publishedYear: 2016, url: "https://www.nature.com/articles/nn.4304" })],
        counts: counts(),
      },
    });

  it("draws authors · year · site under the title, with et al. past three", () => {
    paint(owner({ debate: authored(["Maingret", "Girardeau", "Todorova", "Goutierre"]) }), "claims");
    expect(host.querySelector(".dbt-byline")?.textContent).toBe("Maingret, Girardeau et al. · 2016");
    const meta = host.querySelector(".dbt-meta")?.textContent ?? "";
    expect(meta.indexOf("2016")).toBeLessThan(meta.indexOf("nature.com"));
  });

  it("names all of them up to three", () => {
    paint(owner({ debate: authored(["Maingret", "Girardeau", "Todorova"]) }), "claims");
    expect(host.querySelector(".dbt-byline")?.textContent).toBe("Maingret, Girardeau, Todorova · 2016");
  });

  it("puts every author in more, and says whose reading they are", () => {
    paint(owner({ debate: authored(["Maingret", "Girardeau", "Todorova", "Goutierre"]) }), "claims");
    const detail = host.querySelector(".dbt-detail");
    expect(detail?.querySelector(".dbt-authors")?.textContent).toBe(
      "By Maingret, Girardeau, Todorova, Goutierre",
    );
    /* The engine's own title won here, so the line does not call it the AI's. */
    expect(detail?.querySelector(".dbt-work-note")?.textContent).toBe(
      "Authors and year as the AI read them off the page; each was found in the page's extract.",
    );
    /* Drawn as a reading, not a record: its own quiet class with the caveat on hover. */
    expect(host.querySelector(".dbt-byline")?.getAttribute("title")).toContain("As the AI read it");
  });

  it("keeps the engine's title when it is whole, even beside a workTitle", () => {
    paint(
      owner({
        debate: artefact({
          claims: { rows: [claim3({ title: "On starters", workTitle: "The AI's reading" })], counts: counts() },
        }),
      }),
      "claims",
    );
    const titles = [...host.querySelectorAll("a.dbt-title")].map((a) => a.textContent);
    expect(titles).toContain("On starters");
    expect(titles).not.toContain("The AI's reading");
    expect(host.querySelector(".dbt-work-note")).toBeNull();
  });

  it("uses the workTitle where the engine's is cut short, and says the title is the AI's", () => {
    paint(
      owner({
        debate: artefact({
          direct: { rows: [], counts: counts() },
          claims: {
            rows: [
              claim3({
                title: "Memory Sources Associated with REM and NREM Dream Reports ...",
                workTitle: "Memory Sources Associated with REM and NREM Dream Reports Throughout the Night",
                authors: ["Baylor", "Cavallero"],
                publishedYear: 2001,
              }),
            ],
            counts: counts(),
          },
        }),
      }),
      "claims",
    );
    expect(host.querySelector("a.dbt-title")?.textContent).toBe(
      "Memory Sources Associated with REM and NREM Dream Reports Throughout the Night",
    );
    expect(host.querySelector(".dbt-work-note")?.textContent).toBe(
      "Title, authors and year as the AI read them off the page; each was found in the page's extract.",
    );
  });

  it("uses the workTitle where the engine gave none, with the site kept", () => {
    const untitled = claim3({ workTitle: "A paper", url: "https://arxiv.org/pdf/1809.10635" });
    delete untitled.title;
    paint(owner({ debate: artefact({ direct: { rows: [], counts: counts() }, claims: { rows: [untitled], counts: counts() } }) }), "claims");
    expect(host.querySelector("a.dbt-title")?.textContent).toBe("A paper");
    expect(host.querySelector(".dbt-site")?.textContent).toBe("arxiv.org");
  });

  it("says nothing about the AI's reading on a row with none of the three", () => {
    paint(owner());
    expect(host.querySelector(".dbt-byline")).toBeNull();
    expect(host.querySelector(".dbt-work-note")).toBeNull();
    expect(host.querySelector(".dbt-authors")).toBeNull();
  });
});

describe("Claims, and the relevance bar", () => {
  const judged = () =>
    artefact({
      claims: {
        rows: [
          claim3({ id: "spya-c7w2d2", url: "https://loose.example/x", title: "Loose", bears: "loosely" }),
          claim3({ id: "spya-c7w2d3", url: "https://direct.example/x", title: "Direct", bears: "directly" }),
          claim3({ id: "spya-c7w2d4", url: "https://unjudged.example/x", title: "Unjudged" }),
          claim3({ id: "spya-c7w2d5", url: "https://part.example/x", title: "Part", bears: "partly" }),
        ],
        counts: counts({ returnedSources: 4, reportedRows: 4, keptRows: 4 }),
      },
    });

  /* Within a claim: most directly bearing first, the unjudged last. */
  it("puts the rows the AI judged most direct first within a claim, and the unjudged last", () => {
    paint(owner({ debate: judged() }), "claims");
    expect(rowTitles()).toEqual(["Direct", "Part", "Loose", "Unjudged"]);
  });

  it("puts the bears word on the AI line, before the relation", () => {
    paint(owner({ debate: judged() }), "claims");
    const line = [...host.querySelectorAll(".dbt-ai-line")].find((l) => l.textContent?.includes("bears directly"));
    expect(line?.textContent).toMatch(/^AIbears directly·qualifies/);
  });

  it("labels the claim rows that have no relevance judgment, including at a restrictive bar", () => {
    paint(owner({ debate: judged() }), "claims", "prioritised", new Map(), { relevance: "directly" });
    const items = [...host.querySelectorAll(".dbt-item")];
    expect(items[0]?.querySelector(".dbt-ai-line")?.textContent).not.toContain("Not judged for relevance by the AI");
    expect(items[1]?.querySelector(".dbt-ai-line")?.textContent).toContain("Not judged for relevance by the AI");
    paint(owner(), "claims");
    expect(host.querySelector(".dbt-ai-line")?.textContent).toContain("Not judged for relevance by the AI");
    paint(owner(), "reception");
    expect(host.querySelector(".dbt-ai-line")?.textContent).not.toContain("Not judged for relevance by the AI");
  });

  /* A bar speaks only when it hides something (plan 261003o, step 8):
     *"Nothing is hidden by this threshold."* is gone. */
  it("hides nothing until the reader moves it, and says nothing while it hides nothing", () => {
    paint(owner({ debate: judged() }), "claims");
    expect(host.querySelector(".dbt-rel .gloss-gate-value")?.textContent).toBe("bears loosely · 3 of 3 judged");
    expect(host.querySelector(".dbt-rel .gloss-gate-note")).toBeNull();
    expect(text()).not.toContain("Nothing is hidden by this threshold.");
    expect(host.querySelector(".dbt-rel .gloss-gate-reset")).toBeNull();
  });

  /* The value is words, so it is not mono: the one thing this bar does not
     share with every other band's slider, whose classes it carries
     (glossary.css § the threshold slider; plan 261007a § K5). Both halves: the
     modifier is on the span, and its rule hands the face back. Without either
     the words are drawn as a reading off an instrument, and nothing else here
     would notice.

     **One rule, and under no condition** (GPT Sol, K5-F2): the first draft
     asked only that the rule's text existed, which a copy inside `@media print`
     satisfies while the screen stays mono. This is still the wiring and not
     the rendering; the computed face is in the plan's browser measurement. */
  it("wires its word value to an unconditional inherited-face rule", () => {
    paint(owner({ debate: judged() }), "claims");
    expect(host.querySelector(".dbt-rel .gloss-gate-value")?.className).toBe("gloss-gate-value in-words");
    const css = readerCssNoComments();
    const named = [...css.matchAll(/\.gloss-gate-value\.in-words\b/g)];
    expect(named, "the modifier is written exactly once").toHaveLength(1);
    const at = named[0]?.index ?? -1;
    expect(css.slice(at)).toMatch(/^\.gloss-gate-value\.in-words\s*\{\s*font-family:\s*inherit;?\s*\}/);
    expect(enclosing(css, at), "inside an at-rule, so not on every screen").toEqual([]);
  });

  it("never hides an unjudged row, and its count is the rows drawn", () => {
    paint(owner({ debate: judged() }), "claims", "prioritised", new Map(), { relevance: "directly" });
    expect(rowTitles()).toEqual(["Direct", "Unjudged"]);
    /* Its N of M counts the rows the AI judged: one drawn of three. The
       unjudged row is still on the list but is not made to look as though it
       cleared "bears directly". */
    expect(host.querySelector(".dbt-rel .gloss-gate-value")?.textContent).toBe("bears directly · 1 of 3 judged");
    expect(host.querySelector(".dbt-rel .gloss-gate-note")?.textContent).toBe(
      "2 answers to its claims are hidden by this threshold. Drag the slider left to show them.",
    );
    /* The claim's own count is the rows under it, and so is the segment's. */
    expect(host.querySelector(".dbt-group-count")?.textContent).toBe("2");
    expect(segments()).toEqual(["Reception1", "Claims2"]);
    expect(card()).toContain("2 excerpts on screen.");
    /* The foot counts pages behind the rows drawn, not the ones hidden. */
    expect(card()).toContain("returned evidence from 4 pages; 2 contribute to the rows shown");
    expect(host.querySelector(".dbt-rel .gloss-gate-reset")).not.toBeNull();
  });

  /* GPT Sol round 2 of 260929h, R2: with every judged row hidden and an
     unjudged one still drawn, the note said "All 2 answers to its claims are
     hidden" over a list with an answer on it. The count may say "judged"; the
     note is about the list, so it counts every claim row. */
  it("never says all are hidden while an unjudged answer is still on the list", () => {
    const allJudgedHidden = artefact({
      claims: {
        rows: [
          claim3({ id: "spya-c7w2d2", url: "https://loose.example/x", title: "Loose", bears: "loosely" }),
          claim3({ id: "spya-c7w2d4", url: "https://unjudged.example/x", title: "Unjudged" }),
          claim3({ id: "spya-c7w2d5", url: "https://part.example/x", title: "Part", bears: "partly" }),
        ],
        counts: counts({ returnedSources: 3, reportedRows: 3, keptRows: 3 }),
      },
    });
    paint(owner({ debate: allJudgedHidden }), "claims", "prioritised", new Map(), { relevance: "directly" });
    expect(rowTitles()).toContain("Unjudged");
    expect(host.querySelector(".dbt-rel .gloss-gate-value")?.textContent).toBe("bears directly · 0 of 2 judged");
    const note = host.querySelector(".dbt-rel .gloss-gate-note")?.textContent ?? "";
    expect(note).not.toMatch(/^All /);
    expect(note).toBe("2 answers to its claims are hidden by this threshold. Drag the slider left to show them.");
  });

  /* **GPT Sol's F2 on plan 261003o.** Every row at one level does not make the
     bar useless: two `partly` rows are both hidden by `?bears=directly`, and a
     reader who arrives on that link needs the bar on screen to see why the
     list is empty, and its reset to get out. */
  it("still shows the bar and its reset over rows all at one level, when the address hides them all", () => {
    const allPartly = artefact({
      claims: {
        rows: [
          claim3({ id: "spya-c7w2d2", title: "One", bears: "partly" }),
          claim3({ id: "spya-c7w2d3", title: "Two", bears: "partly" }),
        ],
        counts: counts({ reportedRows: 2, keptRows: 2 }),
      },
    });
    paint(owner({ debate: allPartly }), "claims", "prioritised", new Map(), { relevance: "directly" });
    expect(host.querySelectorAll(".dbt-item")).toHaveLength(0);
    expect(host.querySelector(".dbt-rel")).not.toBeNull();
    expect(host.querySelector(".dbt-rel .gloss-gate-note")?.textContent).toMatch(/^All 2 answers to its claims are hidden/);
    /* A list the reader's own setting emptied is not a search that found nothing. */
    expect(host.querySelector(".dbt-empty")).toBeNull();
    expect(text()).not.toContain(DEBATE_CLAIMS_NONE);
    press(host.querySelector(".dbt-rel .gloss-gate-reset"));
    expect(relevanced).toEqual([null]);
    /* …and untouched, the same rows show the bar too. */
    paint(owner({ debate: allPartly }), "claims");
    expect(host.querySelector(".dbt-rel")).not.toBeNull();
    expect(host.querySelectorAll(".dbt-item")).toHaveLength(2);
  });

  it("hands the drag back as a word", () => {
    paint(owner({ debate: judged() }), "claims");
    const slider = document.getElementById("dbt-rel-bar") as HTMLInputElement | null;
    expect(slider?.value).toBe("0");
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    act(() => {
      setter?.call(slider, "1");
      slider?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(relevanced).toEqual(["partly"]);
  });

  it("is not there, and filters nothing, in Reception", () => {
    paint(owner({ debate: judged() }), "reception", "prioritised", new Map(), { relevance: "directly" });
    expect(host.querySelector(".dbt-rel")).toBeNull();
    expect(host.querySelectorAll(".dbt-item")).toHaveLength(1);
  });

  it("is not offered on rows without bears", () => {
    paint(owner(), "claims");
    expect(host.querySelector(".dbt-rel")).toBeNull();
  });

  /* **GPT Sol's F3.** A visitor's rows carry `bears` since 2026-10-01
     (src/public/dto.ts § `publicDebateRowBase`), so the bar is theirs too. */
  it("is a visitor's too, on a public payload whose rows carry bears", () => {
    const rows = [
      claim3({ id: "spya-c7w2d2", title: "Loose", bears: "loosely" }),
      claim3({ id: "spya-c7w2d3", title: "Direct", bears: "directly" }),
    ];
    const debate = shared({ claims: { rows, sourceNotPublishable: 0 } } as Partial<PublicDebate>);
    paintShared(debate, "claims");
    expect(host.querySelector(".dbt-rel .gloss-gate-value")?.textContent).toBe("bears loosely · 2 of 2 judged");
    expect(rowTitles()).toEqual(["Direct", "Loose"]);
    paintShared(debate, "claims", "prioritised", { relevance: "directly" });
    expect(rowTitles()).toEqual(["Direct"]);
    expect(host.querySelector(".dbt-rel .gloss-gate-reset")).not.toBeNull();
  });
});


/* ------------------------------------------------------------------ threads --
   Plan 260930j (SPIDERYARN-READING2-6M): the themes the sources share and the
   key sources, as a box of toggles above the list. */
describe("DebatePanel — threads", () => {
  const rowA = claim({ id: "spya-thra01", url: "https://a.example/one", title: "One" });
  const rowB = claim({ id: "spya-thra02", url: "https://b.example/two", title: "Two" });
  const rowC = claim({ id: "spya-thra03", url: "https://c.example/three", title: "Three" });
  const withSynthesis = (synthesis: unknown) =>
    artefact({
      direct: { rows: [], counts: counts() },
      claims: { rows: [rowA, rowB, rowC], counts: counts() },
      synthesis,
    } as Partial<Debate>);
  const made: DebateSynthesis = {
    kind: "made",
    themes: [{ id: "spya-thm002", label: "replication", gist: "Both retest it.", rowIds: [rowA.id, rowB.id] }],
    key: [{ rowId: rowC.id, role: "dissents", why: "It takes the other side." }],
  };
  const titles = () => [...host.querySelectorAll(".dbt-title")].map((a) => a.textContent);

  it("draws nothing for a debate searched before synthesis existed, or one too small to ask", () => {
    paint(owner({ debate: withSynthesis(undefined) }), "claims", "prioritised");
    expect(host.querySelector(".dbt-threads")).toBeNull();
    expect(host.querySelector(".dbt-thread-failed")).toBeNull();
    paint(owner({ debate: withSynthesis({ kind: "too-few", rows: 2 }) }), "claims", "prioritised");
    expect(host.querySelector(".dbt-threads")).toBeNull();
    expect(host.querySelector(".dbt-thread-failed")).toBeNull();
    expect(titles()).toEqual(["One", "Two", "Three"]);
  });

  it("says so, quietly, when the call failed — and keeps every row", () => {
    paint(owner({ debate: withSynthesis({ kind: "failed" }) }), "claims", "prioritised");
    expect(host.querySelector(".dbt-threads")).toBeNull();
    expect(host.querySelector(".dbt-thread-failed")?.textContent).toMatch(/still listed below/);
    expect(titles()).toEqual(["One", "Two", "Three"]);
  });

  it("says in the open when the bars hide every row of the chosen thread", () => {
    const hidden = {
      direct: { rows: [], counts: counts() },
      claims: {
        rows: [
          { ...rowA, bears: "loosely" as const },
          { ...rowB, bears: "loosely" as const },
          { ...rowC, bears: "directly" as const },
        ],
        counts: counts(),
      },
      synthesis: made,
    } as Partial<Debate>;
    paint(owner({ debate: artefact(hidden) }), "claims", "prioritised", new Map(), {
      relevance: "directly",
      thread: "spya-thm002",
    });
    expect(titles()).toEqual([]);
    expect(host.querySelector(".dbt-thread-showing")?.textContent).toMatch(
      /The relevance bar is hiding every source on this thread/,
    );
    /* The pressed button stays pressable, so it can be let go. */
    expect((host.querySelector(".dbt-thread.on") as HTMLButtonElement).disabled).toBe(false);
  });

  it("offers the key sources first, then each theme, each with its count", () => {
    paint(owner({ debate: withSynthesis(made) }), "claims", "prioritised");
    const buttons = [...host.querySelectorAll(".dbt-thread")];
    expect(host.querySelector(".dbt-thread-list")?.getAttribute("role")).toBe("group");
    expect(host.querySelector(".dbt-thread-list")?.getAttribute("aria-label")).toMatch(/Show only/);
    expect(buttons.map((b) => b.querySelector(".dbt-thread-label")?.textContent)).toEqual([
      "Key sources1",
      "replication2",
    ]);
    expect(buttons.every((b) => b.getAttribute("type") === "button")).toBe(true);
    expect(buttons.every((b) => b.getAttribute("aria-pressed") === "false")).toBe(true);
  });

  it("marks a key row with its reason", () => {
    paint(owner({ debate: withSynthesis(made) }), "claims", "prioritised");
    const lines = [...host.querySelectorAll(".dbt-key-line")];
    expect(lines).toHaveLength(1);
    expect(lines[0]?.textContent).toContain("Key source · takes a different view");
    expect(lines[0]?.textContent).toContain("It takes the other side.");
  });

  it("narrows the list to the thread the address names, and says how to undo it", () => {
    paint(owner({ debate: withSynthesis(made) }), "claims", "prioritised", new Map(), { thread: "spya-thm002" });
    expect(titles()).toEqual(["One", "Two"]);
    expect(host.querySelector(".dbt-thread.on")?.getAttribute("aria-pressed")).toBe("true");
    expect(host.querySelector(".dbt-thread-showing")?.textContent).toContain(
      "Showing 2 excerpts on “replication”",
    );
    /* The head count and the foot follow the thread, not only the list. */
    expect(card()).toContain("2 excerpts on screen.");
    act(() => (host.querySelector(".dbt-thread-all") as HTMLButtonElement).click());
    expect(threaded).toEqual([null]);
  });

  it("uses the thread-filtered rows for the foot's page count too", () => {
    const debate = artefact({
      direct: {
        rows: [],
        counts: counts({ returnedSources: 0, reportedRows: 0, keptRows: 0 }),
      },
      claims: {
        rows: [rowA, rowB, rowC],
        counts: counts({ returnedSources: 3, reportedRows: 3, keptRows: 3 }),
      },
      synthesis: made,
    });
    paint(owner({ debate }), "claims", "prioritised", new Map(), { thread: "spya-thm002" });
    expect(card()).toContain(
      "The search for answers to what it claims returned evidence from 3 pages; 2 contribute to the rows shown.",
    );
  });

  it("hands a press back as the thread's id, and a second press as a clear", () => {
    paint(owner({ debate: withSynthesis(made) }), "claims", "prioritised");
    act(() => (host.querySelectorAll(".dbt-thread")[0] as HTMLButtonElement).click());
    expect(threaded).toEqual(["key"]);
    paint(owner({ debate: withSynthesis(made) }), "claims", "prioritised", new Map(), { thread: "key" });
    expect(titles()).toEqual(["Three"]);
    act(() => (host.querySelector(".dbt-thread.on") as HTMLButtonElement).click());
    expect(threaded).toEqual(["key", null]);
  });

  it("reads an id this debate does not have as no filter, not an empty list", () => {
    paint(owner({ debate: withSynthesis(made) }), "claims", "prioritised", new Map(), { thread: "spya-gone00" });
    expect(titles()).toEqual(["One", "Two", "Three"]);
    expect(host.querySelector(".dbt-thread-showing")).toBeNull();
  });

  /* Until 2026-10-01 this case said a visitor's synthesis was never read: the
     public DTO did not carry it. Greg approved it crossing (plan 261001b), so
     the rule is now the reverse — a visitor's threads draw like the owner's,
     and one without a synthesis (the boundary withheld a row) draws none. */
  it("draws a visitor's threads from their PublicDebate, and none when it has no synthesis", () => {
    const shared = (synthesis?: DebateSynthesis) =>
      ({
        searchedAt: "2026-09-05T10:00:00.000Z",
        direct: { rows: [], sourceNotPublishable: 0 },
        claims: { rows: [rowA, rowB, rowC], sourceNotPublishable: 0 },
        ...(synthesis ? { synthesis } : {}),
      }) as unknown as PublicDebate;
    paintShared(shared(made), "claims");
    expect(host.querySelector(".dbt-threads")?.textContent).toContain("replication");
    expect(host.querySelector(".dbt-key-line")).not.toBeNull();
    paintShared(shared(), "claims");
    expect(host.querySelector(".dbt-threads")).toBeNull();
    expect(titles()).toEqual(["One", "Two", "Three"]);
  });

  it("disables a thread the relevance bar has emptied", () => {
    const judgedRows = {
      direct: { rows: [], counts: counts() },
      claims: {
        rows: [
          { ...rowA, bears: "loosely" as const },
          { ...rowB, bears: "loosely" as const },
          { ...rowC, bears: "directly" as const },
        ],
        counts: counts(),
      },
      synthesis: made,
    } as Partial<Debate>;
    paint(owner({ debate: artefact(judgedRows) }), "claims", "prioritised", new Map(), {
      relevance: "directly",
    });
    const theme = host.querySelectorAll(".dbt-thread")[1] as HTMLButtonElement;
    expect(theme.disabled).toBe(true);
    expect(theme.querySelector(".dbt-thread-count")?.textContent).toBe("0");
    expect(theme.title).toBe("The relevance bar is hiding every source on this");
  });

  /* **Scoped to the sub-mode** — plan 261003o, step 6. A thread is offered
     where it has a *stored* row; one whose rows are all in the other sub-mode
     is not offered here, and an address that names it narrows nothing here.
     Greg's `debatethread=key` link, whose key sources were all on one claim, is
     the case: it must not empty Reception. */
  describe("scoped to the sub-mode on screen", () => {
    const reply = direct({ id: "spya-thrd01", title: "A reply" });
    const mixed = (synthesis: DebateSynthesis) =>
      artefact({
        direct: { rows: [reply], counts: counts() },
        claims: { rows: [rowA, rowB, rowC], counts: counts() },
        synthesis,
      } as Partial<Debate>);
    const labels = () => [...host.querySelectorAll(".dbt-thread .dbt-thread-name")].map((b) => b.textContent);

    it("offers only orders that change the Reception rows left by a thread", () => {
      const supportive = direct({ id: "spya-d2w4r2", title: "Supportive", lean: "leans-for" });
      const critical = direct({ id: "spya-d2w4r3", title: "Critical", publishedYear: 2024 });
      const debate = artefact({
        direct: { rows: [supportive, critical], counts: counts({ reportedRows: 2, keptRows: 2 }) },
        synthesis: {
          kind: "made", themes: [],
          key: [{ rowId: supportive.id, role: "responds", why: "The reply." }],
        },
      });
      paint(owner({ debate }), "reception", "date", new Map(), { thread: "key" });
      expect(rowTitles()).toEqual(["Supportive"]);
      expect(host.querySelector(".gloss-sort")).toBeNull();
      expect(host.querySelector(".dbt-gap")).toBeNull();
      paint(owner({ debate }), "reception");
      expect(host.querySelector(".gloss-sort")).not.toBeNull();
    });

    it("offers no thread in a sub-mode where none has a stored row", () => {
      paint(owner({ debate: mixed(made) }));
      expect(host.querySelector(".dbt-threads")).toBeNull();
      paint(owner({ debate: mixed(made) }), "claims");
      expect(labels()).toEqual(["Key sources", "replication"]);
    });

    it("offers a thread in each sub-mode where it has a stored row, counted there", () => {
      const both: DebateSynthesis = {
        kind: "made",
        themes: [{ id: "spya-thm002", label: "replication", gist: "Both retest it.", rowIds: [rowA.id, reply.id] }],
        key: [{ rowId: rowC.id, role: "dissents", why: "It takes the other side." }],
      };
      paint(owner({ debate: mixed(both) }));
      expect(labels()).toEqual(["replication"]);
      expect(host.querySelector(".dbt-thread-count")?.textContent).toBe("1");
      paint(owner({ debate: mixed(both) }), "claims");
      expect(labels()).toEqual(["Key sources", "replication"]);
    });

    it("neither narrows nor selects on a thread the address names that has no stored row here", () => {
      paint(owner({ debate: mixed(made) }), "reception", "prioritised", new Map(), { thread: "key" });
      expect(titles()).toEqual(["A reply"]);
      expect(host.querySelector(".dbt-thread.on")).toBeNull();
      expect(host.querySelector(".dbt-thread-showing")).toBeNull();
      expect(segments()).toEqual(["Reception1", "Claims1"]);
      /* The positive control: the same address narrows Claims, and says so. */
      paint(owner({ debate: mixed(made) }), "claims", "prioritised", new Map(), { thread: "key" });
      expect(titles()).toEqual(["Three"]);
      expect(host.querySelector(".dbt-thread-showing")?.textContent).toContain("Showing 1 excerpt picked as key");
    });
  });
});

/* ------------------------------------------------- Claims: the claims list -- */

/**
 * **Claims' list of the article's claims** — plan 261008i stage 2, § 2 and
 * § 5. Its own read and press, so it is drawn whatever Reception has stored;
 * each state is its own sentence; the quote is the article's and the line
 * under it is labelled as the AI's; a stale list is read-only with *List
 * again*; and a visitor gets the list and nothing to press.
 */
describe("Claims' list of the article's claims", () => {
  const LISTED = [
    { id: "spya-cdm2a4", blockId: KNOWN, quote: "a starter needs cool water", statement: "Cool water suits a young starter." },
    { id: "spya-cdm2b5", blockId: "spya-p7x2wd" as BlockId, quote: "salt slows it down", statement: "Salt slows fermentation." },
  ];
  const ready = (over: Partial<UseDebateClaims> = {}) =>
    claimListOwner({ status: "ready", claimList: claimListOf(LISTED), ...over });
  const listedQuotes = () => [...host.querySelectorAll(".dbt-listed-claim .dbt-group-quote")].map((q) => q.textContent);
  const buttonsNamed = (name: string) =>
    [...host.querySelectorAll("button")].filter((b) => (b.textContent ?? "").includes(name));

  it("is reachable before any search is stored: the control is drawn and Claims offers List its claims", () => {
    paint(owner({ status: "none", debate: null }), "claims");
    expect(segments()).toEqual(["Reception0", "Claims0"]);
    expect(text()).toContain(DEBATE_CLAIMS_LIST_NONE);
    expect(buttonsNamed(DEBATE_CLAIMS_LIST_RUN)).toHaveLength(1);
    /* Reception's pre-search screen is Reception's, not Claims'. */
    expect(text()).not.toContain("Nobody has asked the web about this one yet.");
    /* The positive control: Reception still draws it. */
    paint(owner({ status: "none", debate: null }));
    expect(text()).toContain("Nobody has asked the web about this one yet.");
    expect(text()).not.toContain(DEBATE_CLAIMS_LIST_NONE);
  });

  it("presses List its claims with the unforced request", () => {
    let ensured = 0;
    let regenerated = 0;
    paint(owner({ status: "none", debate: null }), "claims", "prioritised", new Map(), {
      claimList: claimListOwner({
        ensure: async () => {
          ensured++;
        },
        regenerate: async () => {
          regenerated++;
        },
      }),
    });
    press(buttonsNamed(DEBATE_CLAIMS_LIST_RUN)[0]);
    expect([ensured, regenerated]).toEqual([1, 0]);
  });

  it("draws the list with each quote, its jump, and the AI's line labelled as the AI's", () => {
    paint(owner(), "claims", "prioritised", new Map(), { claimList: ready() });
    expect(listedQuotes()).toEqual(["“a starter needs cool water”", "“salt slows it down”"]);
    const statements = [...host.querySelectorAll(".dbt-listed-statement")].map((p) => p.textContent);
    expect(statements[0]).toContain("Cool water suits a young starter.");
    expect(statements[0]).toContain(DEBATE_CLAIMS_LIST_AI);
    /* The quote is not labelled as the AI's: it is the article's. */
    expect(host.querySelector(".dbt-listed-head")?.textContent).not.toContain(DEBATE_CLAIMS_LIST_AI);
    /* Each claim offers the way to its block, and pressing it goes there. */
    const jump = host.querySelector<HTMLElement>(".dbt-listed-claim .dbt-listed-head button, .dbt-listed-claim .dbt-listed-head a");
    expect(jump).not.toBeNull();
    press(jump);
    expect(jumped).toEqual([KNOWN]);
  });

  it("counts the listed claims on the segment when there is a list, and an older search's rows when not", () => {
    /* The default debate carries one legacy claim row. */
    paint(owner(), "claims");
    expect(segments()).toEqual(["Reception1", "Claims1"]);
    paint(owner(), "claims", "prioritised", new Map(), { claimList: ready() });
    expect(segments()).toEqual(["Reception1", "Claims2"]);
    expect(host.querySelector(".dbt-views [role='radio'][aria-checked='true']")?.getAttribute("aria-label")).toBe(
      "Claims, 2 claims",
    );
    /* …and the older search's rows are still drawn, under their own heading. */
    expect(host.querySelector(".dbt-group-head")?.textContent).toBe(DEBATE_CLAIMS_EARLIER);
  });

  it("says an empty list is a real answer, with its own sentence", () => {
    paint(owner(), "claims", "prioritised", new Map(), {
      claimList: claimListOwner({ status: "ready", claimList: claimListOf([]) }),
    });
    expect(text()).toContain(DEBATE_CLAIMS_LIST_EMPTY);
    expect(listedQuotes()).toEqual([]);
  });

  it("offers List again on a stale list, shown read-only, and forces it", () => {
    let ensured = 0;
    let regenerated = 0;
    const verbs = {
      ensure: async () => {
        ensured++;
      },
      regenerate: async () => {
        regenerated++;
      },
    };
    paint(owner(), "claims", "prioritised", new Map(), { claimList: ready({ stale: true, ...verbs }) });
    expect(text()).toContain(DEBATE_CLAIMS_LIST_STALE);
    expect(listedQuotes()).toHaveLength(2);
    /* Read-only: no chat button on a listed claim. */
    expect(host.querySelector(".dbt-listed-claim .dbt-claim-check")).toBeNull();
    press(buttonsNamed(DEBATE_CLAIMS_LIST_AGAIN)[0]);
    expect([ensured, regenerated]).toEqual([0, 1]);
    /* The positive control: a current list has the chat button and no banner. */
    paint(owner(), "claims", "prioritised", new Map(), { claimList: ready() });
    expect(text()).not.toContain(DEBATE_CLAIMS_LIST_STALE);
    expect(buttonsNamed(DEBATE_CLAIMS_LIST_AGAIN)).toHaveLength(0);
    expect(host.querySelectorAll(".dbt-listed-claim .dbt-claim-check")).toHaveLength(2);
  });

  it("draws nothing of the list in Reception", () => {
    paint(owner(), "reception", "prioritised", new Map(), { claimList: ready() });
    expect(listedQuotes()).toEqual([]);
  });

  it("gives a visitor the list and no controls", () => {
    paintShared(shared({ claims: { pass: "not-run", rows: [] } }), "claims", "prioritised", {
      claimList: { claims: LISTED },
    });
    expect(listedQuotes()).toEqual(["“a starter needs cool water”", "“salt slows it down”"]);
    expect(host.querySelector(".dbt-claim-check")).toBeNull();
    expect(buttonsNamed(DEBATE_CLAIMS_LIST_RUN)).toHaveLength(0);
    expect(buttonsNamed(DEBATE_CLAIMS_LIST_AGAIN)).toHaveLength(0);
    expect(host.querySelector(".gloss-empty")).toBeNull();
  });

  it("gives a visitor the list when no search was stored at all", () => {
    paintShared(null, "claims", "prioritised", { claimList: { claims: LISTED } });
    expect(listedQuotes()).toHaveLength(2);
    expect(segments()).toEqual(["Reception0", "Claims2"]);
  });
});
