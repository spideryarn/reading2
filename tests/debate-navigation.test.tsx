// @vitest-environment jsdom
/** Real router, nuqs and visitor band, with rows produced by the public DTO. */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useQueryState } from "nuqs";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { publicArticle } from "../src/public/dto.js";
import type { PublicDebate } from "../src/public-types.js";
import type { BlockId, Debate, Tree } from "../src/types.js";
import { VisitorDebateBand } from "../src/web/modes/debate/DebateMode.js";
import { modeParam } from "../src/web/params.js";
import { navigate, settleAddress, useRoute } from "../src/web/router.js";
import { lastViewKey, useLastView } from "../src/web/last-view.js";
import { debateWithheldOnSharedLink } from "../src/messages.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
window.scrollTo = () => {};
enableHistorySync();
// This runner's jsdom environment exposes no storage. Exercise the real
// restore hook against a tab-local store, without touching machine state.
const saved = new Map<string, string>();
Object.defineProperty(window, "localStorage", {
  configurable: true,
  value: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
    clear: () => saved.clear(),
  },
});

const SLUG = "debate-navigation";
const BLOCK = "spya-k3m9qt" as BlockId;
const counts = {
  returnedSources: 3, reportedRows: 3, keptRows: 3, omittedOverCap: 0, webSearches: 2,
  lost: {
    uncited: 0, selfSource: 0, unverifiedSource: 0, directnessUnverified: 0,
    sourceIsCopy: 0, claimNotInBlock: 0, unknownBlockId: 0, malformed: 0,
  },
};
const STORED: Debate = {
  version: "debate/3", generator: "model", slug: SLUG, sourceHash: "hash", elapsedMs: 1,
  searchedAt: "2026-10-03T12:00:00.000Z",
  direct: {
    rows: [{
      id: "spya-d2w4rt", url: "https://example.org/reply", title: "A reply",
      sourceQuote: "This reply names the piece.", articleReferenceQuote: "The shared piece",
      relation: "disputes", lean: "leans-against", applies: "It disputes the piece.",
      identifies: [{ kind: "named", by: "title", witness: "The shared piece" }],
    }],
    counts,
  },
  claims: {
    rows: [
      { id: "spya-c7w2d2", title: "Partly", bears: "partly" as const },
      { id: "spya-c7w2d3", title: "Directly", bears: "directly" as const },
      { id: "spya-c7w2d4", title: "Legacy" },
    ].map((row) => ({
      ...row, url: `https://example.org/${row.id}`, sourceQuote: "A response to the claim.",
      claimQuote: "The claim in the piece", blockId: BLOCK,
      relation: "qualifies", lean: "neither", applies: "It qualifies the claim.",
    })),
    counts,
  },
  synthesis: {
    kind: "made", themes: [],
    key: [{ rowId: "spya-c7w2d2", role: "origin", why: "The earlier source." }],
  },
};

function publish(debate: Debate): PublicDebate {
  const payload = publicArticle({
    slug: SLUG, title: "The shared piece", byline: null, siteName: null, lang: null,
    excerpt: null, journal: null, publishedAt: null, publishedYear: null,
    readingLanguage: null, readingIdeas: null, readingDifficultyReason: null,
    headingTitle: null, finalUrl: "https://example.org/piece",
    blocks: [], tree: { rootId: "spya-root", nodes: {} } as unknown as Tree,
    arc: null, assets: null, glossary: null, ideas: null, quotes: null, tweets: null,
    timeline: null, skim: null, faq: null, simpleSummary: null, citations: null, debate,
    crossrefs: null, crossrefsFresh: false, comments: [], searches: [], sketch: null,
    navLabelStatus: "ready", sourceGuess: null,
    sharedBy: "public",
  });
  if (!payload.debate) throw new Error("The DTO dropped the debate");
  return payload.debate;
}

let debate: PublicDebate;
let host: HTMLDivElement;
let root: Root;

function Page() {
  const route = useRoute();
  useLastView(SLUG, "article", null);
  const [mode] = useQueryState("mode", modeParam);
  if (route.kind !== "read") return createElement("p", null, "not found");
  if (mode !== "debate") return createElement("p", null, `band: ${mode}`);
  return createElement(VisitorDebateBand, {
    debate, onJump: () => {}, blockOrder: new Map([[BLOCK, 0]]),
    publishedAt: undefined, articleTitle: "The shared piece",
  });
}

function boot(search: string) {
  history.replaceState(null, "", `/read/${SLUG}${search}`);
  const settled = settleAddress(location.pathname, location.search, location.hash);
  if (settled !== null) history.replaceState(null, "", settled);
  act(() => root.render(createElement(NuqsAdapter, null, createElement(Page))));
}

async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i += 1) {
    await act(async () => { await new Promise((done) => setTimeout(done, 10)); });
  }
  expect(check(), `Address: ${location.href}; panel: ${host.textContent}`).toBe(true);
}

const titles = () => [...host.querySelectorAll(".dbt-title")].map((row) => row.textContent);
const params = () => new URLSearchParams(location.search);
const inClaims = () => host.querySelector('[aria-label="Claims, 3 sources"]')?.getAttribute("aria-checked") === "true";

function press(selector: string) {
  const button = host.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  act(() => button?.click());
}

beforeEach(() => {
  window.localStorage.clear();
  debate = publish(STORED);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

it("lifts a cold legacy link, and Reception then stays selected", async () => {
  boot("?mode=debate&debateby=claim&name=linked");
  expect(inClaims()).toBe(true);
  expect(params().has("debateby")).toBe(false);
  press('[aria-label="Reception, 1 source"]');
  await until(() => !params().has("debate"));
  expect(titles()).toEqual(["A reply"]);
  expect(host.querySelector(".dbt-title-only h3")?.textContent).toBe("Names this piece by its title only");
});

it("explicit Reception wins over the legacy order", () => {
  boot("?mode=debate&debate=reception&debateby=claim");
  expect(titles()).toEqual(["A reply"]);
  expect(params().has("debateby")).toBe(false);
});

it("navigate lifts the legacy query and keeps its hash", async () => {
  boot("?mode=glossary");
  act(() => navigate(`/read/${SLUG}?mode=debate&debateby=claim#passage`));
  await until(inClaims);
  expect(params().has("debateby")).toBe(false);
  expect(location.hash).toBe("#passage");
});

it("Back and Forward lift legacy entries on the same article", async () => {
  history.replaceState(null, "", `/read/${SLUG}?mode=debate&debateby=claim`);
  history.pushState(null, "", `/read/${SLUG}?mode=glossary`);
  boot("?mode=glossary");
  act(() => history.back());
  await until(inClaims);
  expect(params().has("debateby")).toBe(false);
  act(() => history.forward());
  await until(() => host.textContent === "band: glossary");
  // Simulate another history entry written by the old code before a deploy.
  history.replaceState(null, "", `/read/${SLUG}?mode=debate&debateby=claim`);
  act(() => history.back());
  await until(inClaims);
  act(() => history.forward());
  await until(() => !params().has("debateby") && inClaims());
});

it.each(["?mode=debate&debate=claims", "?mode=debate&debateby=claim"])(
  "restores Claims from %s", async (remembered) => {
    window.localStorage.setItem(lastViewKey(SLUG, null), remembered);
    boot("");
    await until(inClaims);
    expect(params().get("debate")).toBe("claims");
    expect(params().has("debateby")).toBe(false);
  },
);

it("a Claims-only key thread leaves Reception intact and unselected", () => {
  boot("?mode=debate&debatethread=key");
  expect(titles()).toEqual(["A reply"]);
  expect(host.querySelector(".dbt-threads")).toBeNull();
});

it("the public DTO keeps relevance judgments, and a normal segment press keeps filters", async () => {
  expect(debate.claims.rows[0]?.bears).toBe("partly");
  expect(debate.direct.rows[0]?.identifies[0]?.kind).toBe("named");
  boot("?mode=debate&bears=directly&debatethread=key");
  press('[aria-label="Claims, 0 sources"]');
  await until(() => params().get("debate") === "claims");
  expect(titles()).toEqual([]);
  expect(params().get("bears")).toBe("directly");
  expect(params().get("debatethread")).toBe("key");
  expect(host.querySelector(".dbt-thread-showing")?.textContent).toContain("hiding every source on this thread");
});

it("handoff clears both filters in nuqs and shows the advertised public sources", async () => {
  debate = publish({ ...STORED, direct: { ...STORED.direct, rows: [] } });
  boot("?mode=debate&bears=directly&debatethread=key");
  expect(host.querySelector(".dbt-handoff")?.textContent).toBe("See the 3 sources on what it claims");
  press(".dbt-handoff");
  await until(() => inClaims() && !params().has("bears") && !params().has("debatethread"));
  expect(params().has("bears")).toBe(false);
  expect(params().has("debatethread")).toBe(false);
  expect(titles()).toEqual(["Directly", "Partly", "Legacy"]);
});

it("explains rows withheld by the real public boundary in each empty sub-mode", async () => {
  debate = publish({
    ...STORED,
    direct: { ...STORED.direct, rows: STORED.direct.rows.map((row) => ({ ...row, url: "http://127.0.0.1/reply" })) },
    claims: { ...STORED.claims, rows: STORED.claims.rows.map((row) => ({ ...row, url: "http://127.0.0.1/claim" })) },
  });
  expect(debate.direct.sourceNotPublishable).toBe(1);
  expect(debate.claims.sourceNotPublishable).toBe(3);
  boot("?mode=debate");
  expect(host.querySelector(".dbt-empty")?.textContent).toBe(debateWithheldOnSharedLink("The search for replies to this piece", 1));
  press('[aria-label="Claims, 0 sources"]');
  await until(() => params().get("debate") === "claims");
  expect(host.querySelector(".dbt-empty")?.textContent).toBe(debateWithheldOnSharedLink("The search for answers to what it claims", 3));
});
