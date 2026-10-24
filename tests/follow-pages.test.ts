/**
 * **Stage 1 follows the pages** — `followPages` with an injected fetcher and an
 * injected judge gateway, so every case is about what this code does with an
 * answer, not about what the model would say. Plan
 * docs/plans/261024p-a-multi-page-article-imports-from-its-first-page.md §
 * Stage 1; the step-level and store halves are tests/multi-page-fetch-step.test.ts.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FetchFailure, type FetchedDocument, type FetchedHtml } from "../src/fetch.js";
import { followPages, pagesDetail, type PageFetcher } from "../src/follow-pages.js";
import type { MultiPageGateway } from "../src/multi-page.js";

const SITE = "https://essay.example";

/** A page Readability keeps, with three links to other pages of its own site and one off it. */
function landing(extraLinks = ""): string {
  const para = (n: number) =>
    `<p>Paragraph ${n} of the abstract, long enough that Readability keeps it as prose rather than dropping it as a fragment of chrome or furniture.</p>`;
  return `<!doctype html><html><head><title>The Long Essay</title></head><body>
<nav class="chapters"><a href="/one">Chapter I</a> <a href="/two">Chapter II</a> <a href="/three">Chapter III</a></nav>
<article><h1>The Long Essay</h1>${[1, 2, 3, 4, 5, 6].map(para).join("\n")}</article>
<footer><a href="https://elsewhere.example/about">About</a>${extraLinks}</footer>
</body></html>`;
}

function page(url: string, text: string, finalUrl = url): FetchedHtml {
  const bytes = new TextEncoder().encode(text);
  return {
    kind: "html",
    requestedUrl: url,
    url: finalUrl,
    chain: finalUrl === url ? [url] : [url, finalUrl],
    status: 200,
    contentType: "text/html; charset=utf-8",
    bytes,
    text,
    encoding: "utf-8",
    fetchedAt: new Date().toISOString(),
  };
}

const PAGE1 = page(`${SITE}/`, landing());

/** A gateway that answers once with `answer`, counting its calls. */
function judge(answer: { continues: boolean; pages: string[] } | Error) {
  const calls: unknown[] = [];
  const gateway: MultiPageGateway = async (_job, body) => {
    calls.push(body);
    if (answer instanceof Error) throw answer;
    return {
      json: {
        choices: [{ finish_reason: "stop", message: { content: JSON.stringify({ ...answer, reason: "a test" }) } }],
      },
      answeredBy: null,
      generationId: null,
    };
  };
  return { gateway, calls };
}

/** The ids `pageLinks` gives page 1's links, in document order. */
const L = { one: "L1", two: "L2", three: "L3" } as const;

/** A network of pages by address; anything else is a 404. Records what each fetch was allowed. */
function network(pages: Record<string, FetchedDocument | Error>) {
  const asked: { url: string; maxBytes: number }[] = [];
  const fetchDocument: PageFetcher = async (url, options) => {
    asked.push({ url, maxBytes: options.maxBytes });
    const doc = pages[url];
    if (doc === undefined) throw new FetchFailure("not-found", url, "nothing here", { status: 404 });
    if (doc instanceof Error) throw doc;
    return doc;
  };
  return { fetchDocument, asked };
}

const signal = () => new AbortController().signal;

describe("when the judge is asked, and what it is told", () => {
  it("asks once, and keeps nothing, when the judge says the page is the whole piece", async () => {
    const j = judge({ continues: false, pages: [] });
    const net = network({});
    const out = await followPages(PAGE1, { signal: signal(), fetchDocument: net.fetchDocument, gateway: j.gateway });
    expect(out).toEqual({ judged: "single" });
    expect(j.calls).toHaveLength(1);
    expect(net.asked).toEqual([]);
    expect(pagesDetail(out)).toBeNull();
  });

  it("makes no call for a page with no link to another page of its site", async () => {
    const lonely = page(`${SITE}/`, landing().replace(/<nav[\s\S]*?<\/nav>/, ""));
    const j = judge({ continues: true, pages: ["L1"] });
    const out = await followPages(lonely, { signal: signal(), fetchDocument: network({}).fetchDocument, gateway: j.gateway });
    expect(out).toEqual({ judged: "not-asked" });
    expect(j.calls).toEqual([]);
  });

  it("makes no call for a bot check, even one with links", async () => {
    const fixture = readFileSync(path.join(import.meta.dirname, "..", "evals", "extraction", "fixtures", "winehq_anubis.html"), "utf-8");
    const check = page("https://bugs.winehq.org/", fixture.replace("</body>", '<a href="/page/2">Page 2</a></body>'));
    const j = judge({ continues: true, pages: ["L1"] });
    const out = await followPages(check, { signal: signal(), fetchDocument: network({}).fetchDocument, gateway: j.gateway });
    expect(out).toEqual({ judged: "not-asked" });
    expect(j.calls).toEqual([]);
  });

  it("imports the page alone when the call fails or the answer is refused", async () => {
    for (const answer of [new Error("timed out"), { continues: true, pages: ["L99"] }]) {
      const net = network({});
      const out = await followPages(PAGE1, { signal: signal(), fetchDocument: net.fetchDocument, gateway: judge(answer).gateway });
      expect(out.judged).toBe("failed");
      expect(net.asked).toEqual([]);
    }
  });

  it("imports page 1 alone when the active judge call reaches its deadline", async () => {
    const gateway: MultiPageGateway = async (_job, _body, options) =>
      await new Promise((_resolve, reject) => {
        const stop = () => reject(options.signal?.reason);
        if (options.signal?.aborted) stop();
        else options.signal?.addEventListener("abort", stop, { once: true });
      });
    const out = await followPages(PAGE1, {
      signal: signal(),
      fetchDocument: network({}).fetchDocument,
      gateway,
      judgeTimeoutMs: 5,
    });
    expect(out).toMatchObject({ judged: "failed" });
  });

  it("stops when the job is told to, rather than carrying on alone", async () => {
    const stop = new AbortController();
    const gateway: MultiPageGateway = async () => {
      stop.abort(new Error("stopped"));
      throw new Error("aborted");
    };
    await expect(followPages(PAGE1, { signal: stop.signal, fetchDocument: network({}).fetchDocument, gateway })).rejects.toThrow("stopped");
  });
});

describe("following what was picked", () => {
  it("fetches the pages in the judge's order, and keeps each as it arrived", async () => {
    const two = page(`${SITE}/two`, "<html><body><p>Chapter two.</p></body></html>");
    const one = page(`${SITE}/one`, "<html><body><p>Chapter one.</p></body></html>");
    const net = network({ [`${SITE}/two`]: two, [`${SITE}/one`]: one });
    const out = await followPages(PAGE1, {
      signal: signal(),
      fetchDocument: net.fetchDocument,
      gateway: judge({ continues: true, pages: [L.two, L.one] }).gateway,
    });
    if (out.judged !== "continues") throw new Error(`judged ${out.judged}`);
    expect(out.pages.map((p) => p.url)).toEqual([`${SITE}/two`, `${SITE}/one`]);
    expect(out.pages[0]).toBe(two);
    expect(pagesDetail(out)).toBe("3 pages");
  });

  it("skips a page that fails, leaves the site, is not HTML or is one already held, and keeps the rest", async () => {
    const pdf: FetchedDocument = { ...page(`${SITE}/three`, ""), kind: "pdf", text: null, encoding: null, bytes: new Uint8Array([37, 80, 68, 70]) };
    const net = network({
      /* Off the site after its redirect. */
      [`${SITE}/one`]: page(`${SITE}/one`, "<p>moved</p>", "https://elsewhere.example/one"),
      /* Back to page 1 after its redirect: a duplicate. */
      [`${SITE}/two`]: page(`${SITE}/two`, "<p>again</p>", `${SITE}/`),
      [`${SITE}/three`]: pdf,
    });
    const out = await followPages(PAGE1, {
      signal: signal(),
      fetchDocument: net.fetchDocument,
      gateway: judge({ continues: true, pages: [L.one, L.two, L.three] }).gateway,
    });
    if (out.judged !== "continues") throw new Error(`judged ${out.judged}`);
    expect(out.pages).toEqual([]);
    expect(out.skipped).toEqual({ "off-site": 1, duplicate: 1, "not-html": 1 });
    expect(pagesDetail(out)).toBe("1 of 4 pages");
  });

  it("skips a page that fails to arrive and a second page that lands where the first did", async () => {
    const net = network({
      [`${SITE}/one`]: new FetchFailure("timeout", `${SITE}/one`, "slow"),
      [`${SITE}/two`]: page(`${SITE}/two`, "<p>two</p>", `${SITE}/three/`),
      [`${SITE}/three`]: page(`${SITE}/three`, "<p>three</p>"),
    });
    const out = await followPages(PAGE1, {
      signal: signal(),
      fetchDocument: net.fetchDocument,
      gateway: judge({ continues: true, pages: [L.one, L.two, L.three] }).gateway,
    });
    if (out.judged !== "continues") throw new Error(`judged ${out.judged}`);
    expect(out.pages.map((p) => p.url)).toEqual([`${SITE}/three/`]);
    expect(out.skipped).toEqual({ failed: 1, duplicate: 1 });
  });

  it("will not go down from https to http after a redirect", async () => {
    const net = network({ [`${SITE}/one`]: page(`${SITE}/one`, "<p>one</p>", "http://essay.example/one") });
    const out = await followPages(PAGE1, {
      signal: signal(),
      fetchDocument: net.fetchDocument,
      gateway: judge({ continues: true, pages: [L.one] }).gateway,
    });
    if (out.judged !== "continues") throw new Error(`judged ${out.judged}`);
    expect(out.pages).toEqual([]);
    expect(out.skipped).toEqual({ "off-site": 1 });
  });
});

describe("the shared byte budget", () => {
  const sized = (url: string, n: number) => page(url, `<p>${"x".repeat(n - 7)}</p>`);

  it("caps each fetch at what is left, before it is made, so the total never passes it", async () => {
    const net = network({
      [`${SITE}/one`]: sized(`${SITE}/one`, 400),
      [`${SITE}/two`]: sized(`${SITE}/two`, 500),
      [`${SITE}/three`]: sized(`${SITE}/three`, 200),
    });
    const out = await followPages(PAGE1, {
      signal: signal(),
      fetchDocument: net.fetchDocument,
      gateway: judge({ continues: true, pages: [L.one, L.two, L.three] }).gateway,
      budgetBytes: 1000,
    });
    if (out.judged !== "continues") throw new Error(`judged ${out.judged}`);
    /* Each fetch was told what was left: the whole, then what the first did not use. */
    expect(net.asked.map((a) => a.maxBytes)).toEqual([1000, 600, 100]);
    /* The third was over what was left. This fake fetcher handed it back anyway,
       as a real one would not: it is still not kept. */
    expect(out.pages.map((p) => p.url)).toEqual([`${SITE}/one`, `${SITE}/two`]);
    const total = out.pages.reduce((n, p) => n + p.bytes.byteLength, 0);
    expect(total).toBeLessThanOrEqual(1000);
    expect(out.skipped).toEqual({ budget: 1 });
  });

  it("stops asking once a page has spent what was left", async () => {
    const net = network({
      [`${SITE}/one`]: new FetchFailure("too-large", `${SITE}/one`, "too big"),
      [`${SITE}/two`]: sized(`${SITE}/two`, 100),
    });
    const out = await followPages(PAGE1, {
      signal: signal(),
      fetchDocument: net.fetchDocument,
      gateway: judge({ continues: true, pages: [L.one, L.two] }).gateway,
      budgetBytes: 1000,
    });
    if (out.judged !== "continues") throw new Error(`judged ${out.judged}`);
    expect(net.asked.map((a) => a.url)).toEqual([`${SITE}/one`]);
    expect(out.skipped).toEqual({ failed: 1, budget: 1 });
  });

  it("charges bytes read by a failed fetch before continuing", async () => {
    const asked: number[] = [];
    const fetchDocument: PageFetcher = async (url, options) => {
      asked.push(options.maxBytes);
      if (url.endsWith("/one")) {
        options.onBytesRead?.(700);
        throw new FetchFailure("unsupported-type", url, "unsupported");
      }
      return sized(url, 300);
    };
    const out = await followPages(PAGE1, {
      signal: signal(),
      fetchDocument,
      gateway: judge({ continues: true, pages: [L.one, L.two] }).gateway,
      budgetBytes: 1000,
    });
    expect(asked).toEqual([1000, 300]);
    expect(out).toMatchObject({ judged: "continues", skipped: { failed: 1 } });
  });
});

describe("the continuation deadline and cancellation", () => {
  const waitForAbort: PageFetcher = async (_url, options) =>
    await new Promise<FetchedDocument>((_resolve, reject) => {
      const stop = () => reject(options.signal.reason);
      if (options.signal.aborted) stop();
      else options.signal.addEventListener("abort", stop, { once: true });
    });

  it("stops an active continuation fetch at the wall-clock deadline", async () => {
    const out = await followPages(PAGE1, {
      signal: signal(),
      fetchDocument: waitForAbort,
      gateway: judge({ continues: true, pages: [L.one] }).gateway,
      budgetMs: 5,
    });
    expect(out).toEqual({ judged: "continues", picked: 1, pages: [], skipped: { "out-of-time": 1 } });
  });

  it("rethrows cancellation received during a continuation fetch", async () => {
    const controller = new AbortController();
    const fetchDocument: PageFetcher = async (url, options) => {
      queueMicrotask(() => controller.abort(new Error("job stopped")));
      return waitForAbort(url, options);
    };
    await expect(
      followPages(PAGE1, {
        signal: controller.signal,
        fetchDocument,
        gateway: judge({ continues: true, pages: [L.one] }).gateway,
      }),
    ).rejects.toThrow("job stopped");
  });
});
