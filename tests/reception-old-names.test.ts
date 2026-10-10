/**
 * **What a tab or a row from before the rename still says about Reception and
 * Claims, and what it gets.**
 *
 * Plan docs/plans/261009w-peer-review-becomes-sources-all-the-way-down.md,
 * Stage 3: Reception's step, job, route and chat origin were all called
 * `debate` until 2026-10-09, the claims list's `debate-claims`, and a reader's
 * claim check's job `debate-check`. tests/bibliography-old-names.test.ts is
 * Stage 2's half and says why; for one deploy, removed by the contract (plan
 * 261009w's queue item):
 *
 * - the old GET and POST paths answer, with the old envelope;
 * - job ingress reads an old step name as its new one;
 * - an old origin, sent or stored, is read as the new one, a `debate` claim
 *   and a `debate` lens each by its shape;
 * - the ledger's old names are classified, counted and labelled as the new.
 *
 * The real dispatcher with the store's reads injected, as
 * tests/bibliography-old-names.test.ts does: no database, no socket. The
 * stored halves (the column pairs, the step-run mirror, the claim-check view)
 * are tests/reception-expand-pg.test.ts; a stored or sent `debate` origin
 * through the real route is tests/chat-origin-route.test.ts; the public
 * payload's old keys are tests/public-dto-owner-only-fields.test.ts.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { costCategoryOf } from "../src/cost-categories.js";
import { taskOf } from "../src/cost-cube.js";
import { ArtefactNotMadeYet } from "../src/store/artefact-not-made-yet.js";
import { currentLedgerName, currentStepName } from "../src/step-order.js";
import { originColumns, originFromColumns } from "../src/thread-origin.js";
import { currentOriginMode, NONE_YET_AS_NULL_HEADER } from "../src/types.js";
import { lineName } from "../src/web/ArticleCost.js";
import { acceptAny, AUTHED_HEADERS } from "./helpers/authed.js";

const stores = vi.hoisted(() => ({
  loadReception: vi.fn(),
  loadSourcesClaims: vi.fn(),
  sweep: vi.fn(),
  profile: vi.fn(),
}));

vi.mock("../src/store/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/store/index.js")>();
  const { guardDbStore } = await import("../src/store/db-errors.js");
  const loads = guardDbStore("old-names-test", {
    loadReception: stores.loadReception,
    loadSourcesClaims: stores.loadSourcesClaims,
  });
  return {
    ...actual,
    ...loads,
    readerStore: { ...actual.readerStore, readProfile: stores.profile },
    sourcesClaimChecksStore: { ...actual.sourcesClaimChecksStore, sweep: stores.sweep },
  };
});

const { handleApi, parseJobRequest } = await import("../src/routes.js");

const SLUG = "old-names";
const BLOCK = "spya-bbbbbb";
const RECEPTION = { version: "debate/7", slug: SLUG, searchedAt: "2026-10-09T00:00:00.000Z" };
const FOUND = { reception: RECEPTION, stale: false, outdated: true };
const LIST = { version: "debate-claims/1", slug: SLUG, claims: [] };
const LIST_FOUND = { claimList: LIST, stale: true, outdated: false };

beforeEach(() => {
  vi.resetAllMocks();
  stores.profile.mockResolvedValue(null);
  stores.loadReception.mockResolvedValue(FOUND);
  stores.loadSourcesClaims.mockResolvedValue(LIST_FOUND);
  stores.sweep.mockResolvedValue([]);
});

async function call(method: string, url: string, asks = true, body?: unknown) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))];
  const req = Object.assign(
    (async function* () {
      yield* chunks;
    })(),
    {
      method,
      url,
      headers: {
        ...AUTHED_HEADERS,
        ...(asks ? { [NONE_YET_AS_NULL_HEADER]: "1" } : {}),
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
    },
  ) as unknown as IncomingMessage;
  let out = "";
  const res = {
    statusCode: 0,
    writableEnded: false,
    destroyed: false,
    setHeader() {},
    getHeader() { return undefined; },
    flushHeaders() {},
    on() {},
    once() {},
    write(chunk: string) { out += chunk; return true; },
    end(chunk = "") { out += chunk; this.writableEnded = true; },
  };
  await handleApi(req, res as unknown as ServerResponse, acceptAny);
  return { status: res.statusCode, body: out };
}

describe("the old Reception path, for a tab loaded before the rename", () => {
  it("GET /api/reception/:slug answers with the new envelope", async () => {
    const res = await call("GET", `/api/reception/${SLUG}`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual(FOUND);
  });

  it("GET /api/debate/:slug answers with the envelope the old hook reads", async () => {
    /* The old hook (git show 6b0b64f78:src/web/useDebate.ts) reads
       `loaded.debate`, `loaded.stale` and `loaded.outdated`. */
    const res = await call("GET", `/api/debate/${SLUG}`);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as Record<string, unknown>;
    expect(body).toEqual({ debate: RECEPTION, stale: false, outdated: true });
    expect(body).not.toHaveProperty("reception");
  });

  it("GET /api/debate/:slug says `null` for no search yet, as the old hook asks", async () => {
    stores.loadReception.mockRejectedValue(new ArtefactNotMadeYet("no search yet"));
    const res = await call("GET", `/api/debate/${SLUG}`);
    expect(res.status).toBe(200);
    expect(res.body).toBe("null");
  });
});

describe("the old claims-list paths", () => {
  it("GET /api/sources-claims/:slug answers the list", async () => {
    const res = await call("GET", `/api/sources-claims/${SLUG}`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual(LIST_FOUND);
  });

  it("GET /api/debate-claims/:slug answers the same envelope, which never named the step", async () => {
    /* git show 6b0b64f78:src/web/useDebateClaims.ts reads `loaded.claimList`. */
    const res = await call("GET", `/api/debate-claims/${SLUG}`);
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual(LIST_FOUND);
  });

  it("GET /api/debate-claims/:slug says `null` for no list yet", async () => {
    stores.loadSourcesClaims.mockRejectedValue(new ArtefactNotMadeYet("no list yet"));
    const res = await call("GET", `/api/debate-claims/${SLUG}`);
    expect(res.status).toBe(200);
    expect(res.body).toBe("null");
  });

  it("GET /api/debate-claims/:slug/checks answers `{ checks }`, as the new path does", async () => {
    const checks = [{ id: "spya-cvd222", status: "done" }];
    stores.sweep.mockResolvedValue(checks);
    for (const path of [`/api/sources-claims/${SLUG}/checks`, `/api/debate-claims/${SLUG}/checks`]) {
      const res = await call("GET", path, false);
      expect(res.status, path).toBe(200);
      expect(JSON.parse(res.body), path).toEqual({ checks });
    }
    expect(stores.sweep).toHaveBeenCalledTimes(2);
  });

  it("POST /api/debate-claims/:slug/checks reaches the same press", async () => {
    /* A body that names nothing is refused by the press itself, before any
       store write or spend: what this asks is that the old path reaches it
       rather than 404ing. */
    stores.loadSourcesClaims.mockResolvedValue(LIST_FOUND);
    const oldPath = await call("POST", `/api/debate-claims/${SLUG}/checks`, false, {});
    const newPath = await call("POST", `/api/sources-claims/${SLUG}/checks`, false, {});
    expect(oldPath.status).not.toBe(404);
    expect(oldPath.status).toBe(newPath.status);
    expect(oldPath.body).toBe(newPath.body);
  });
});

describe("job ingress, for a tab that still names `debate` or `debate-claims`", () => {
  it("reads the old step names in `steps` and `force` as the new ones", () => {
    const parsed = parseJobRequest({
      slug: "a-slug",
      steps: ["debate", "debate-claims"],
      force: ["debate", "debate-claims"],
    });
    expect(parsed.steps).toEqual(["reception", "sources-claims"]);
    expect(parsed.force).toEqual(["reception", "sources-claims"]);
  });
});

describe("a chat's origin, as an old row or an old tab spells it", () => {
  it("reads a stored `debate` claim as a Sources › Claims origin", () => {
    const row = { originMode: "debate", originItemId: null, originBlockId: BLOCK, originQuote: "A claim", originLens: null };
    expect(originFromColumns(row)).toEqual({ origin: { mode: "sources-claims", blockId: BLOCK, quote: "A claim" } });
  });

  it("reads a stored `debate` lens as a Reception origin", () => {
    const row = { originMode: "debate", originItemId: null, originBlockId: null, originQuote: null, originLens: "an angle" };
    expect(originFromColumns(row)).toEqual({ origin: { mode: "reception", lens: "an angle" } });
  });

  it("reads a stored `debate` row that is neither shape as no origin", () => {
    const row = { originMode: "debate", originItemId: null, originBlockId: BLOCK, originQuote: null, originLens: "an angle" };
    expect(originFromColumns(row)).toEqual({});
  });

  it("maps a sent `debate` word by its lens", () => {
    expect(currentOriginMode("debate", "an angle")).toBe("reception");
    expect(currentOriginMode("debate", undefined)).toBe("sources-claims");
    expect(currentOriginMode("debate", null)).toBe("sources-claims");
    expect(currentOriginMode("citations", undefined)).toBe("bibliography");
    expect(currentOriginMode("glossary", undefined)).toBe("glossary");
  });

  it("writes the new words", () => {
    expect(originColumns({ mode: "sources-claims", blockId: BLOCK, quote: "A claim" } as never).originMode).toBe(
      "sources-claims",
    );
    expect(originColumns({ mode: "reception", lens: "an angle" }).originMode).toBe("reception");
  });
});

describe("the ledger's old names (F10)", () => {
  it("canonicalises the two steps and the claim check's job", () => {
    expect(currentLedgerName("debate")).toBe("reception");
    expect(currentLedgerName("debate-claims")).toBe("sources-claims");
    expect(currentLedgerName("debate-check")).toBe("sources-claim-check");
    /* A job rename is not a step rename. */
    expect(currentStepName("debate-check")).toBe("debate-check");
    expect(currentStepName("debate")).toBe("reception");
  });

  it("classifies an old row under its new name", () => {
    expect(costCategoryOf({ scopeKind: "request", job: "debate-check", stepName: null })).toBe(
      costCategoryOf({ scopeKind: "request", job: "sources-claim-check", stepName: null }),
    );
    expect(costCategoryOf({ scopeKind: "job_step", job: "debate", stepName: "debate" })).toBe(
      costCategoryOf({ scopeKind: "job_step", job: "reception", stepName: "reception" }),
    );
    expect(costCategoryOf({ scopeKind: "job_step", job: "debate-claims", stepName: "debate-claims" })).toBe(
      costCategoryOf({ scopeKind: "job_step", job: "sources-claims", stepName: "sources-claims" }),
    );
  });

  it("names an old row by its new name in the cost cube and the article's cost view", () => {
    expect(taskOf({ job: "debate", stepName: "debate" })).toBe("reception");
    expect(taskOf({ job: "debate-claims", stepName: "debate-claims" })).toBe("sources-claims");
    expect(taskOf({ job: "debate-check", stepName: null })).toBe("sources-claim-check");
    expect(lineName({ job: "debate-check", stepName: null } as never)).toBe("sources-claim-check");
  });
});
