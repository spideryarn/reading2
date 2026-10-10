/**
 * **What a tab or a row from before the rename still says, and what it gets.**
 *
 * Plan docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md,
 * Stage 2: Bibliography's step, job, route and chat origin were all called
 * `citations` until 2026-10-09, and its find-it job `citations-find`. The
 * deployed code and the database must never be out of step in a way that
 * breaks a reader (§ The database), and a tab open across the deploy must not
 * be told an artefact is missing (§ After GPT Sol's plan review, F1). So, for
 * one deploy, removed by the contract (plan 261009w's queue item):
 *
 * - the old GET and POST paths answer, with the old envelope;
 * - job ingress reads an old step name as its new one;
 * - an old origin, sent or stored, is read as the new one;
 * - the ledger's old names are classified, counted and labelled as the new.
 *
 * The real dispatcher with the store's loads injected, as
 * tests/none-yet-catch-boundary.test.ts does: no database, no socket. The
 * stored-row halves (the column pair, the step-run mirror, a stored origin) are
 * tests/bibliography-expand-pg.test.ts and tests/chat-origin-route.test.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { costCategoryOf } from "../src/cost-categories.js";
import { taskOf } from "../src/cost-cube.js";
import { BibliographyListNotFound } from "../src/store/bibliography-list-not-found.js";
import { currentLedgerName, currentStepName } from "../src/step-order.js";
import { originColumns, originFromColumns } from "../src/thread-origin.js";
import { NONE_YET_AS_NULL_HEADER } from "../src/types.js";
import { lineName } from "../src/web/ArticleCost.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const stores = vi.hoisted(() => ({
  loadBibliography: vi.fn(),
  candidates: vi.fn(),
  profile: vi.fn(),
  investigate: vi.fn(),
}));

vi.mock("../src/store/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/store/index.js")>();
  const { guardDbStore } = await import("../src/store/db-errors.js");
  const loads = guardDbStore("old-names-test", { loadBibliography: stores.loadBibliography });
  return {
    ...actual,
    ...loads,
    readerStore: { ...actual.readerStore, readProfile: stores.profile },
    citedCandidates: stores.candidates,
    investigateCitation: stores.investigate,
  };
});

const { handleApi, parseJobRequest } = await import("../src/routes.js");

const SLUG = "old-names";
const WORK = "spya-ttm222";
const LIST = { slug: SLUG, version: "citations/6", citations: [], capped: false };
const FOUND = { bibliography: LIST, stale: false, outdated: true };

beforeEach(() => {
  vi.resetAllMocks();
  stores.profile.mockResolvedValue(null);
  stores.candidates.mockResolvedValue([]);
  stores.loadBibliography.mockResolvedValue(FOUND);
});

async function call(method: string, url: string, asks = true) {
  const req = Object.assign((async function* () {})(), {
    method,
    url,
    headers: { ...AUTHED_HEADERS, ...(asks ? { [NONE_YET_AS_NULL_HEADER]: "1" } : {}) },
  }) as unknown as IncomingMessage;
  let body = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    getHeader() { return undefined; },
    flushHeaders() {},
    on() {},
    once() {},
    write(chunk: string) { body += chunk; return true; },
    end(chunk = "") { body += chunk; this.writableEnded = true; },
  };
  await handleApi(req, res as unknown as ServerResponse, acceptAny);
  return { status: res.statusCode, body };
}

describe("the old Bibliography paths, for a tab loaded before the rename", () => {
  it("GET /api/bibliography/:slug answers with the new envelope", async () => {
    const res = await call("GET", `/api/bibliography/${SLUG}`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toEqual(FOUND);
    expect(body).not.toHaveProperty("citations");
  });

  it("GET /api/citations/:slug answers with the envelope the old hook reads", async () => {
    /* The old hook (git show 68d9ed837:src/web/useCitations.ts) reads
       `loaded.citations`, `loaded.stale` and `loaded.outdated`. */
    const res = await call("GET", `/api/citations/${SLUG}`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toEqual({ citations: LIST, stale: false, outdated: true });
    expect(body).not.toHaveProperty("bibliography");
  });

  it("GET /api/citations/:slug says `null` for no list yet, as the old hook asks", async () => {
    stores.loadBibliography.mockRejectedValue(new BibliographyListNotFound());
    const res = await call("GET", `/api/citations/${SLUG}`);
    expect(res.status).toBe(200);
    expect(res.body).toBe("null");
  });

  it("POST /api/citations/:slug/:id/investigate reaches the same press", async () => {
    stores.investigate.mockResolvedValue({
      stream: async function* () {
        yield { type: "stage", stage: "reading" };
      },
      release: () => {},
    });
    const res = await call("POST", `/api/citations/${SLUG}/${WORK}/investigate`, false);
    expect(res.status).not.toBe(404);
    expect(stores.investigate).toHaveBeenCalledTimes(1);
    expect(stores.investigate.mock.calls[0]?.slice(0, 2)).toEqual([SLUG, WORK]);
  });
});

describe("job ingress, for a tab that still names `citations`", () => {
  it("reads an old step name in `steps` and `force` as the new one", () => {
    const parsed = parseJobRequest({ slug: "a-slug", steps: ["citations"], force: ["citations"] });
    expect(parsed.steps).toEqual(["bibliography"]);
    expect(parsed.force).toEqual(["bibliography"]);
  });

  it("still refuses a name that was never a step", () => {
    expect(() => parseJobRequest({ slug: "a-slug", steps: ["citationz"] })).toThrow(/step names/);
  });
});

describe("a chat's origin, as an old row or an old tab spells it", () => {
  it("reads a stored `citations` origin as Bibliography's", () => {
    const row = { originMode: "citations", originItemId: WORK, originBlockId: null, originQuote: "A work", originLens: null };
    expect(originFromColumns(row)).toEqual({ origin: { mode: "bibliography", itemId: WORK, quote: "A work" } });
  });

  it("writes the new word", () => {
    expect(originColumns({ mode: "bibliography", itemId: WORK, quote: "A work" }).originMode).toBe("bibliography");
  });
});

describe("the ledger's old names (F10)", () => {
  it("canonicalises the step, the job and the earlier renames in one place", () => {
    expect(currentLedgerName("citations")).toBe("bibliography");
    expect(currentLedgerName("citations-find")).toBe("citation-find");
    expect(currentLedgerName("trajectory")).toBe("skim");
    expect(currentLedgerName("hierarchy")).toBe("structure");
    expect(currentLedgerName("glossary")).toBe("glossary");
    /* A job rename is not a step rename: a job's old name never reaches a step. */
    expect(currentStepName("citations-find")).toBe("citations-find");
  });

  it("classifies an old row under its new name", () => {
    expect(costCategoryOf({ scopeKind: "request", job: "citations-find", stepName: null })).toBe(
      "interactive request work",
    );
    expect(costCategoryOf({ scopeKind: "job_step", job: "citations", stepName: "citations" })).toBe(
      costCategoryOf({ scopeKind: "job_step", job: "bibliography", stepName: "bibliography" }),
    );
  });

  it("names an old row by its new name in the cost cube and the article's cost view", () => {
    expect(taskOf({ job: "citations", stepName: "citations" })).toBe("bibliography");
    expect(taskOf({ job: "citations-find", stepName: null })).toBe("citation-find");
    expect(lineName({ job: "citations-find", stepName: null } as never)).toBe("citation-find");
  });
});
