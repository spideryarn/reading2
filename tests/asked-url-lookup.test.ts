/** The real lookup over scripted query rows; no Postgres or network. */
import { beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({
  rows: [] as { slug: string; url: string | null; requestedUrl: string | null; askedUrl: string | null }[],
}));

vi.mock("../src/db/client.js", () => ({
  getDb: () => ({
    select: (fields: Record<string, unknown>) => ({
      from: () => ({
        leftJoin: () => ({
          where: async () => query.rows.map((row) => Object.fromEntries(
            Object.keys(fields).map((key) => [key, row[key as keyof typeof row]]),
          )),
        }),
      }),
    }),
  }),
}));

import { urlKey } from "../src/ingest.js";
import type { FetchedDocument } from "../src/fetch.js";
import { resolvePaperSource } from "../src/paper-sources.js";
import { fetchByAddress } from "../src/pipeline.js";
import { slugForUrlKey } from "../src/store/find-article.js";

const ASKED = "https://short.example/paper";
const FINAL = "https://cdn.example/paper.pdf";

beforeEach(() => { query.rows = []; });

describe("finding a paper whose candidate redirects outside the registry's patterns", () => {
  it.each([
    "https://arxiv.org/abs/1706.03762",
    "https://aclanthology.org/N19-1423/",
    "https://proceedings.mlr.press/v139/radford21a.html",
    "https://proceedings.neurips.cc/paper/2017/hash/3f5ee243547dee91fbd053c1c4a845aa-Abstract.html",
    "https://openaccess.thecvf.com/content_cvpr_2016/html/He_Deep_Residual_Learning_CVPR_2016_paper.html",
    "https://jmlr.org/papers/v15/srivastava14a.html",
    "https://www.nber.org/papers/w30000",
  ])("keeps the asked address usable for %s", async (address) => {
    const paper = resolvePaperSource(address);
    if (paper === null || paper.candidates[0] === undefined) throw new Error("fixture names no candidate");
    const candidate = paper.candidates[0];
    expect(resolvePaperSource(FINAL)).toBeNull();

    // The production fetch helper admits this outcome: kind and marker are
    // checked, but a candidate's final address need not match the registry.
    const fetched = await fetchByAddress(ASKED, { slug: "held-paper", signal: new AbortController().signal }, async (requestedUrl): Promise<FetchedDocument> => {
      const first = requestedUrl === ASKED;
      const url = first ? address : FINAL;
      const base = {
        requestedUrl, url, chain: [requestedUrl, url], status: 200,
        contentType: null, bytes: new Uint8Array(4), fetchedAt: "2026-10-06T00:00:00.000Z",
      };
      return first || candidate.expect === "html"
        ? { ...base, kind: "html", text: candidate.marker ?? "landing page", encoding: "utf-8" }
        : { ...base, kind: "pdf", text: null, encoding: null };
    });
    expect(fetched.paper?.source).toBe(paper.source);
    expect(fetched.doc.requestedUrl).toBe(candidate.url);
    query.rows = [{ slug: "held-paper", url: fetched.doc.url, requestedUrl: fetched.doc.requestedUrl, askedUrl: ASKED }];
    expect(await slugForUrlKey(urlKey(ASKED))).toBe("held-paper");
  });

  it("still refuses an ordinary moving link, even when its pasted address looks like a paper", async () => {
    const askedUrl = "https://arxiv.org/abs/1706.03762";
    query.rows = [{ slug: "ordinary-page", url: FINAL, requestedUrl: "https://blog.example/latest", askedUrl }];
    expect(await slugForUrlKey(urlKey(askedUrl))).toBeUndefined();
    expect(await slugForUrlKey(urlKey(FINAL))).toBe("ordinary-page");
  });

  it("does not adopt an unpublished paper through its candidate", async () => {
    query.rows = [{ slug: "draft", url: null, requestedUrl: "https://arxiv.org/html/1706.03762", askedUrl: ASKED }];
    expect(await slugForUrlKey(urlKey(ASKED))).toBeUndefined();
  });
});
