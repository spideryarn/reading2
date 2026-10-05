// @vitest-environment jsdom
/**
 * **The open page takes the real structure in, live** — `useLateStructure`
 * (src/web/article/useLateStructure.ts),
 * docs/plans/261005j-open-the-article-before-structure-and-swap-the-real-tree-in-live.md
 * § Stage 2 and § Review record.
 *
 * A first import publishes with a stand-in tree (`provisional:
 * "awaiting-structure"`) and a `["structure"]` job replaces it in a second
 * publication. The hook is what notices, from the open reading view, and it is
 * a **level** check: *the tree I hold is awaiting, and a jobs list read after
 * it arrived shows no structure job for this slug*.
 *
 * What each case is for:
 *
 * - **a running job, then gone** — the ordinary path: no fetch while it runs,
 *   exactly one when it goes, and the article that comes back is the held one
 *   with a new tree and **the same `blocks` array**, so the prose and its
 *   images are not redrawn;
 * - **a stale `loaded` list** — GPT Sol's F2. `loaded` means a list landed at
 *   some point, which can be before this article existed. Deciding on it would
 *   say *could not be built* over a job that is running;
 * - **still awaiting** → `stalled`; **a block re-classified** → `mismatch`
 *   (Sol's F5: the same ids do not prove the same blocks);
 * - **the images' second draw** arriving after the swap must not put the
 *   stand-in back, which is why the late tree is held beside the article;
 * - **an answer for the article the reader has left** is ignored;
 * - **ask again** each time a structure job for the slug comes and goes;
 * - **no idle polls once resolved**, with a positive control beside it.
 *
 * Harness from tests/arc-idle-poll.test.ts: the real engine singleton, a faked
 * `apiFetch`, fake timers.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Article, Block, BlockId, Tree } from "../src/types.js";

/** Every request made, in order, as `METHOD url`. */
let calls: string[] = [];
/** What `GET /api/jobs` answers. */
let queue: unknown[] = [];
/** A case may answer some requests itself; null falls through to the defaults. */
let override: ((url: string, method: string) => Response | Promise<Response> | null) | null = null;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    calls.push(`${method} ${url}`);
    const answered = override?.(url, method);
    if (answered) return Promise.resolve(answered);
    /* `busy: true`, as in idle-work.test.ts: a never-busy fake would drive the
       running job to completion inside the mount flush. */
    if (url.includes("/advance")) {
      return Promise.resolve(
        json({ job: { id: "x", status: "running" }, ran: "structure", busy: true, done: false }),
      );
    }
    return Promise.resolve(json({ jobs: queue }));
  },
  /* Throws on a non-2xx, as the real one does (src/web/lib/api.ts). */
  readJson: async (r: Response) => {
    const text = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return text === "" ? {} : JSON.parse(text);
  },
  statusOf: () => null,
}));

const { useLateStructure } = await import("../src/web/article/useLateStructure.js");
type WithLateStructure = import("../src/web/article/useLateStructure.js").WithLateStructure;
const { jobEngine } = await import("../src/web/jobEngine.js");

const SLUG = "opened-before-structure";
const ARTICLE_URL = `GET /api/article/${SLUG}`;

function block(i: number, over: Partial<Block> = {}): Block {
  return {
    id: `spya-ls${i}` as BlockId,
    tag: "p",
    kind: "text",
    text: `paragraph ${i}`,
    words: 2,
    html: `<p>paragraph ${i}</p>`,
    gistable: true,
    ...over,
  };
}

const BLOCKS = [0, 1, 2, 3].map((i) => block(i));

function tree(provisional?: Tree["provisional"]): Tree {
  const first = BLOCKS[0]?.id as BlockId;
  const last = BLOCKS[3]?.id as BlockId;
  return {
    version: "1",
    generator: provisional ? "headings" : "model",
    slug: SLUG,
    rootId: "n1",
    nodes: {
      n1: { id: "n1", depth: 0, parent: null, children: [], range: [first, last], title: "All" },
    },
    ...(provisional ? { provisional } : {}),
  } as unknown as Tree;
}

/** What the server answers for the article. `blocks` are the raw ones: the html
 *  differs from the held copy's, as it does once the sanitiser and the images
 *  have been over it, and that must not read as a different article. */
function payload(t: Tree, blocks: Block[] = BLOCKS): Article {
  return {
    meta: { slug: SLUG, title: "T" },
    blocks: blocks.map((b) => ({ ...b, html: `${b.html}<!-- raw -->` })),
    tree: t,
    navLabelStatus: t.provisional ? "pending" : "ready",
  } as unknown as Article;
}

/** The article as the page holds it. A fresh object per call, the same blocks. */
function held(t: Tree, blocks: Block[] = BLOCKS, slug = SLUG): Article {
  return {
    meta: { slug, title: "T" },
    blocks,
    tree: t,
    navLabelStatus: t.provisional ? "pending" : "ready",
  } as unknown as Article;
}

const structureJob = (status: "queued" | "running" | "done" | "error", id = "ls-j1") => ({
  id,
  ownerId: "ls-reader",
  slug: SLUG,
  steps: [{ name: "structure", label: "Structure", status }],
  status,
  createdAt: "2026-10-05T09:00:00.000Z",
});

let root: Root | null = null;
let host: HTMLElement | null = null;
let last: WithLateStructure | null = null;

function Probe({ slug, article }: { slug: string; article: Article }) {
  last = useLateStructure(slug, article);
  return null;
}

async function show(slug: string, article: Article): Promise<void> {
  if (!root) {
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  }
  await act(async () => {
    root?.render(createElement(Probe, { slug, article }));
  });
}

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

const articleFetches = () => calls.filter((c) => c === ARTICLE_URL);
const jobPolls = () => calls.filter((c) => c === "GET /api/jobs");

beforeEach(async () => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  jobEngine.reset();
  calls = [];
  override = null;
  queue = [];
  last = null;
  vi.useFakeTimers();
  Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  jobEngine.start("ls-reader");
  /* The session's first list lands — empty — before any article is on screen.
     Every case below therefore starts from the state Sol's F2 is about: a
     `loaded` snapshot that was read before this article arrived. */
  await advance(0);
  expect(jobEngine.getSnapshot().loaded).toBe(true);
  calls = [];
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  host?.remove();
  root = null;
  host = null;
  jobEngine.reset();
  vi.useRealTimers();
});

describe("an article whose tree is not awaiting", () => {
  it("is handed back as it came, and nothing is asked", async () => {
    const article = held(tree());
    await show(SLUG, article);
    await advance(20_000);

    expect(last?.article).toBe(article);
    expect(last?.structure).toBe("final");
    expect(calls).toEqual([]);
  });

  it("treats the final headings fallback as final", async () => {
    const article = held(tree("headings"));
    await show(SLUG, article);
    await advance(20_000);

    expect(last?.article).toBe(article);
    expect(last?.structure).toBe("final");
    expect(articleFetches()).toEqual([]);
  });
});

describe("an awaiting article with its structure job running", () => {
  it("does not fetch while the job runs, fetches once when it goes, and swaps only the tree", async () => {
    queue = [structureJob("running")];
    const real = tree();
    override = (url) => (url === `/api/article/${SLUG}` ? json(payload(real)) : null);
    const article = held(tree("awaiting-structure"));

    await show(SLUG, article);
    await advance(5_000);
    expect(articleFetches(), "no fetch while the job is running").toEqual([]);
    expect(last?.structure).toBe("building");
    expect(last?.article).toBe(article);

    queue = [structureJob("done")];
    await advance(5_000);

    expect(articleFetches(), "exactly one fetch once the job has gone").toHaveLength(1);
    expect(last?.structure).toBe("final");
    expect(last?.article.tree.provisional).toBeUndefined();
    expect(last?.article.tree).toEqual(real);
    expect(last?.article.navLabelStatus).toBe("ready");
    expect(last?.article.blocks, "the same blocks array, so the prose is not redrawn").toBe(
      article.blocks,
    );
    expect(last?.article.meta).toBe(article.meta);

    await advance(60_000);
    expect(articleFetches(), "and never a second").toHaveLength(1);
  });

  it("counts a queued job as one that is coming", async () => {
    queue = [structureJob("queued")];
    override = (url) => (url === `/api/article/${SLUG}` ? json(payload(tree())) : null);
    await show(SLUG, held(tree("awaiting-structure")));
    await advance(5_000);

    expect(articleFetches()).toEqual([]);
    expect(last?.structure).toBe("building");
  });

  it("does not put a missing `arc` in or take one away (Sol F8)", async () => {
    const arc = { version: "t", generator: "t", slug: SLUG, sourceHash: "h", entries: [] };
    override = (url) =>
      url === `/api/article/${SLUG}` ? json({ ...payload(tree()), arc }) : null;
    await show(SLUG, held(tree("awaiting-structure")));
    await advance(5_000);

    expect(last?.structure).toBe("final");
    expect(last?.article.arc).toBeUndefined();
  });
});

describe("a jobs list from before the article arrived (Sol F2)", () => {
  it("decides nothing until a list asked for after the article has been read", async () => {
    /* The engine holds a loaded, empty list (beforeEach). The next one is held
       on the wire, and it is the one that would show the job. */
    let release: (r: Response) => void = () => {};
    let heldPolls = 0;
    override = (url) => {
      if (url === "/api/jobs") {
        heldPolls += 1;
        if (heldPolls === 1) return new Promise<Response>((r) => (release = r));
      }
      return url === `/api/article/${SLUG}` ? json(payload(tree("awaiting-structure"))) : null;
    };

    await show(SLUG, held(tree("awaiting-structure")));
    await advance(500);

    expect(jobPolls().length, "it asked for a fresh list").toBeGreaterThan(0);
    expect(articleFetches(), "the stale list showing no job decided nothing").toEqual([]);
    expect(last?.structure).toBe("building");

    queue = [structureJob("running")];
    release(json({ jobs: queue }));
    await advance(3_000);

    expect(articleFetches(), "and the fresh one shows the job running").toEqual([]);
    expect(last?.structure).toBe("building");
  });

  it("keeps asking for that list through a failed poll", async () => {
    let failed = 0;
    override = (url) => {
      if (url === "/api/jobs" && failed < 2) {
        failed += 1;
        return json({ error: "a transient fault" }, 500);
      }
      return url === `/api/article/${SLUG}` ? json(payload(tree())) : null;
    };

    await show(SLUG, held(tree("awaiting-structure")));
    await advance(30_000);

    expect(failed).toBe(2);
    expect(last?.structure, "a later list still arrived, and the tree with it").toBe("final");
  });
});

describe("what the fetched article says", () => {
  it("is stalled when no job is coming and the tree is still the stand-in", async () => {
    override = (url) =>
      url === `/api/article/${SLUG}` ? json(payload(tree("awaiting-structure"))) : null;
    const article = held(tree("awaiting-structure"));
    await show(SLUG, article);
    await advance(5_000);

    expect(articleFetches()).toHaveLength(1);
    expect(last?.structure).toBe("stalled");
    expect(last?.article).toBe(article);
  });

  it("is a mismatch when a block was re-classified under the same id (Sol F5)", async () => {
    const reclassified = BLOCKS.map((b, i) => (i === 2 ? { ...b, kind: "heading" as const } : b));
    override = (url) =>
      url === `/api/article/${SLUG}` ? json(payload(tree(), reclassified)) : null;
    const article = held(tree("awaiting-structure"));
    await show(SLUG, article);
    await advance(5_000);

    expect(last?.structure).toBe("mismatch");
    expect(last?.article, "the article on screen is untouched").toBe(article);
  });

  it.each([
    ["text", { text: "another paragraph" }],
    ["tag", { tag: "li" }],
    ["level", { level: 2 }],
    ["gistable", { gistable: false }],
    ["role", { role: "footnote" as const }],
    ["treatment", { treatment: "supplement" as const }],
  ])("is a mismatch when a block's %s differs", async (_field, over) => {
    const changed = BLOCKS.map((b, i) => (i === 1 ? { ...b, ...over } : b));
    override = (url) => (url === `/api/article/${SLUG}` ? json(payload(tree(), changed)) : null);
    await show(SLUG, held(tree("awaiting-structure")));
    await advance(5_000);

    expect(last?.structure).toBe("mismatch");
  });

  it("is a mismatch when the same blocks come back in another order", async () => {
    const reordered = [BLOCKS[1], BLOCKS[0], BLOCKS[2], BLOCKS[3]] as Block[];
    override = (url) => (url === `/api/article/${SLUG}` ? json(payload(tree(), reordered)) : null);
    await show(SLUG, held(tree("awaiting-structure")));
    await advance(5_000);

    expect(last?.structure).toBe("mismatch");
  });

  it("reports a failed check honestly and lets the reader retry it without rebuilding", async () => {
    let answer = json({ error: "no" }, 500);
    override = (url) => (url === `/api/article/${SLUG}` ? answer : null);
    const article = held(tree("awaiting-structure"));
    await show(SLUG, article);
    await advance(5_000);

    expect(articleFetches()).toHaveLength(1);
    expect(last?.structure).toBe("unread");
    expect(last?.article).toBe(article);
    answer = json(payload(tree()));
    await act(async () => last?.retry());
    await advance(5_000);
    expect(articleFetches()).toHaveLength(2);
    expect(last?.structure).toBe("final");
    expect(calls.filter((c) => c.startsWith("POST"))).toEqual([]);
  });

  it("mends a fetched node with no `children` list, as the article's door does", async () => {
    const broken = tree();
    delete (broken.nodes.n1 as { children?: unknown }).children;
    override = (url) => (url === `/api/article/${SLUG}` ? json(payload(broken)) : null);
    await show(SLUG, held(tree("awaiting-structure")));
    await advance(5_000);

    expect(last?.structure).toBe("final");
    expect(last?.article.tree.nodes.n1?.children).toEqual([]);
  });
});

describe("asking again", () => {
  it("checks again when the first snapshot of a new structure job is already done", async () => {
    let answer = payload(tree("awaiting-structure"));
    override = (url) => (url === `/api/article/${SLUG}` ? json(answer) : null);
    await show(SLUG, held(tree("awaiting-structure")));
    await advance(5_000);
    expect(last?.structure).toBe("stalled");

    /* Another tab can finish between our polls. No render saw it active. */
    answer = payload(tree());
    queue = [structureJob("done", "ls-fast")];
    jobEngine.poke();
    await advance(3_000);
    expect(last?.structure).toBe("final");
    expect(articleFetches()).toHaveLength(2);
  });

  it("fetches again each time a structure job for the slug comes and goes", async () => {
    let answer = payload(tree("awaiting-structure"));
    override = (url) => (url === `/api/article/${SLUG}` ? json(answer) : null);
    await show(SLUG, held(tree("awaiting-structure")));
    await advance(5_000);
    expect(last?.structure).toBe("stalled");

    /* The owner presses Build it: a job appears… */
    queue = [structureJob("running", "ls-j2")];
    jobEngine.poke();
    await advance(2_000);
    expect(last?.structure, "a running job is not a stall").toBe("building");
    expect(articleFetches()).toHaveLength(1);

    /* …and goes, having published the real tree. */
    answer = payload(tree());
    queue = [structureJob("done", "ls-j2")];
    await advance(5_000);

    expect(articleFetches()).toHaveLength(2);
    expect(last?.structure).toBe("final");
  });

  it("is not moved by another article's structure job", async () => {
    queue = [{ ...structureJob("running"), slug: "somebody-else" }];
    override = (url) => (url === `/api/article/${SLUG}` ? json(payload(tree())) : null);
    await show(SLUG, held(tree("awaiting-structure")));
    await advance(3_000);

    expect(last?.structure).toBe("final");
  });
});

describe("what arrives afterwards", () => {
  it("ignores a read from before a new structure job began", async () => {
    let release: (r: Response) => void = () => {};
    override = (url) =>
      url === `/api/article/${SLUG}` ? new Promise<Response>((r) => (release = r)) : null;
    const article = held(tree("awaiting-structure"));
    await show(SLUG, article);
    await advance(3_000);
    expect(articleFetches()).toHaveLength(1);

    queue = [structureJob("running", "ls-new")];
    jobEngine.poke();
    await advance(2_000);
    release(json(payload(tree())));
    await advance(2_000);
    expect(last?.structure).toBe("building");
    expect(last?.article).toBe(article);
  });

  it.each([200, 500])("ignores a read after sign-out (HTTP %s)", async (status) => {
    let release: (r: Response) => void = () => {};
    override = (url) =>
      url === `/api/article/${SLUG}` ? new Promise<Response>((r) => (release = r)) : null;
    await show(SLUG, held(tree("awaiting-structure")));
    await advance(3_000);
    jobEngine.stop();
    release(status === 200 ? json(payload(tree())) : json({ error: "gone" }, status));
    await advance(2_000);
    expect(last?.structure).toBe("building");
  });

  it("swaps a late answer only once through StrictMode's double effects", async () => {
    let release: (r: Response) => void = () => {};
    override = (url) =>
      url === `/api/article/${SLUG}` ? new Promise<Response>((r) => (release = r)) : null;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(createElement(StrictMode, null, createElement(Probe, {
        slug: SLUG, article: held(tree("awaiting-structure")),
      })));
    });
    await advance(3_000);
    expect(articleFetches()).toHaveLength(1);
    release(json(payload(tree())));
    await advance(2_000);
    expect(last?.structure).toBe("final");
    expect(articleFetches()).toHaveLength(1);
  });

  it("keeps the real tree when the images' second draw lands after the swap", async () => {
    override = (url) => (url === `/api/article/${SLUG}` ? json(payload(tree())) : null);
    await show(SLUG, held(tree("awaiting-structure")));
    await advance(5_000);
    expect(last?.structure).toBe("final");

    /* access.ts § the second draw: a new article object for the same slug, with
       the images in its blocks and the stand-in tree it was fetched with. */
    const withImages = BLOCKS.map((b) => ({ ...b, html: `${b.html}<img src="blob:x">` }));
    const second = held(tree("awaiting-structure"), withImages);
    await show(SLUG, second);
    await advance(5_000);

    expect(last?.structure).toBe("final");
    expect(last?.article.tree.provisional, "the stand-in did not come back").toBeUndefined();
    expect(last?.article.blocks, "and the pictures did arrive").toBe(withImages);
    expect(articleFetches(), "nor was the article asked for again").toHaveLength(1);
  });

  it("ignores an answer that arrives after the reader has moved to another article", async () => {
    let release: (r: Response) => void = () => {};
    override = (url) =>
      url === `/api/article/${SLUG}` ? new Promise<Response>((r) => (release = r)) : null;
    await show(SLUG, held(tree("awaiting-structure")));
    await advance(3_000);
    expect(articleFetches()).toHaveLength(1);

    const other = held(tree("awaiting-structure"), BLOCKS, "another-article");
    queue = [{ ...structureJob("running"), slug: "another-article" }];
    await show("another-article", other);
    await advance(2_000);

    release(json(payload(tree())));
    await advance(2_000);

    expect(last?.article, "the other article was not given this one's tree").toBe(other);
    expect(last?.structure).toBe("building");
  });
});

describe("what it costs the job engine", () => {
  it("buys no polls once the tree is in", async () => {
    override = (url) => (url === `/api/article/${SLUG}` ? json(payload(tree())) : null);
    await show(SLUG, held(tree("awaiting-structure")));
    await advance(5_000);
    expect(last?.structure).toBe("final");

    calls = [];
    await advance(60_000);
    expect(calls, "a minute at rest after the swap").toEqual([]);
  });

  it("buys none once it has said stalled, either", async () => {
    override = (url) =>
      url === `/api/article/${SLUG}` ? json(payload(tree("awaiting-structure"))) : null;
    await show(SLUG, held(tree("awaiting-structure")));
    await advance(5_000);
    expect(last?.structure).toBe("stalled");

    calls = [];
    await advance(60_000);
    expect(calls).toEqual([]);
  });
});
