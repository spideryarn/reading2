/**
 * **Every way a fetched document reaches stage 1, priced against the real
 * ledger** — plan 261020b stage 3's matrix, for the fetched half (the upload
 * half is tests/long-pdf-fetch-step.test.ts).
 *
 * The real fetch step, the real `priceFetchedPdf` against a real job and
 * reservation, and a stubbed network: `fetchDocument` refuses loopback
 * addresses (src/fetch.ts), so there is no way to serve these from this
 * process. `writeRaw` is spied on, because the claim about every refusal is
 * *ordering* — nothing is stored, so nothing paid can start.
 *
 * **`MAX_PAGES` is 400 here** (mocked), the cap the plan raises to once it is
 * shown to load; the boundaries above today's 250 are only reachable that way.
 * The account is on a 20-article tier, so every count up to 8 slots fits and
 * the price is what is under test.
 */
import { createHash } from "node:crypto";

import { PDFDocument } from "pdf-lib";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TierRow } from "../src/billing/tiers.js";
import { loadEnvLocal } from "../src/env.js";
import type { FetchedDocument, RawManifest } from "../src/fetch.js";
import { mintId } from "../src/ids.js";
import type { OwnerId } from "../src/owner.js";
import { STEPS } from "../src/pipeline.js";
import type { StepContext } from "../src/pipeline.js";
import { canonicalKey } from "../src/source.js";
import { blobStore } from "../src/store/blobs.js";
import { nullCheckpointStore } from "../src/store/checkpoints.js";
import { mintAttempt } from "../src/store/jobs.js";
import { priceFetchedPdf, reserveIngest } from "../src/store/pg-billing.js";
import { memoryArtefacts } from "./helpers/memory-artefacts.js";
import { pgReady } from "./helpers/pg-ready.js";
import { seedAuthUser } from "./helpers/seed-auth-user.js";

loadEnvLocal();
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });

/** What the network serves, by address; anything else is a 404-shaped throw. */
const served = new Map<string, FetchedDocument>();
const stored = { n: 0 };

vi.mock("../src/uploads.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/uploads.js")>();
  return { ...real, MAX_PAGES: 400 };
});

vi.mock("../src/fetch.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/fetch.js")>();
  return {
    ...real,
    fetchDocument: async (url: string) => {
      const doc = served.get(url);
      if (!doc) throw new real.FetchFailure("not-found", url, `nothing served at ${url}`, { status: 404 });
      return doc;
    },
    writeRaw: async (doc: FetchedDocument) => {
      stored.n += 1;
      return real.writeRaw(doc);
    },
  };
});

const { pool } = await pgReady({
  suite: "tests/long-pdf-fetch-matrix.test.ts",
  tables: ["spideryarn.billing_accounts", "spideryarn.ingest_events", "spideryarn.articles", "spideryarn.jobs"],
  columns: [{ table: "spideryarn.ingest_events", column: "slots" }],
  keepPool: true,
  max: 4,
});

const OWNER = "0b11a1a0-0000-4000-8000-00000010ba02" as OwnerId;
const SLUG = "long-pdf-matrix-";
const blobs = blobStore();

const PRICE = "price_long_pdf_matrix";
const TIERS: readonly TierRow[] = [
  {
    id: "long-pdf-matrix",
    productName: "Spideryarn Long PDF Matrix",
    description: "Twenty articles a month.",
    ingestsPerPeriod: 20,
    lookupKey: "spideryarn_long_pdf_matrix_monthly",
    stripePriceId: PRICE,
    livemode: false,
    active: true,
    sortOrder: 31,
    amounts: { usd: 1000 },
  },
];

async function givenPaidPeriod(): Promise<void> {
  await pool.query(
    `insert into spideryarn.billing_accounts
       (owner_id, stripe_customer_id, stripe_subscription_id, price_id, status,
        current_period_start, current_period_end)
     values ($1, $2, $3, $4, 'active', now() - interval '5 days', now() + interval '25 days')
     on conflict (owner_id) do update set price_id = excluded.price_id, status = 'active',
       current_period_start = excluded.current_period_start, current_period_end = excluded.current_period_end`,
    [OWNER, `cus_${OWNER}`, `sub_${OWNER}`, PRICE],
  );
}

async function pdfWithPages(count: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(`matrix-${count}-${Math.random()}`);
  for (let i = 0; i < count; i++) doc.addPage([200, 200]);
  return doc.save();
}

const shaOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const rubbish: (() => Promise<unknown>)[] = [];

function aPdf(url: string, bytes: Uint8Array, chain: string[] = [url]): FetchedDocument {
  rubbish.push(() => blobs.remove(canonicalKey(shaOf(bytes), "pdf")));
  return {
    requestedUrl: chain[0] ?? url,
    url,
    chain,
    status: 200,
    kind: "pdf",
    contentType: "application/pdf",
    bytes,
    text: null,
    encoding: null,
    fetchedAt: new Date().toISOString(),
  };
}

function aPage(url: string): FetchedDocument {
  const text = `<html><head><title>A page</title></head><body><p>A page ${Math.random()}</p></body></html>`;
  return {
    requestedUrl: url,
    url,
    chain: [url],
    status: 200,
    kind: "html",
    contentType: "text/html; charset=utf-8",
    bytes: new TextEncoder().encode(text),
    text,
    encoding: "utf-8",
    fetchedAt: new Date().toISOString(),
  };
}

/** A job on a live claim for `name`, with a one-slot reservation unless told otherwise. */
async function aClaim(name: string, reserve = true) {
  const slug = `${SLUG}${name}`;
  let reservation: string | null = null;
  if (reserve) {
    const admission = await reserveIngest(OWNER, undefined, TIERS);
    if (admission.kind !== "admitted") throw new Error(`reserving answered ${admission.kind}`);
    reservation = admission.reservationId;
  }
  const id = mintId();
  const attempt = mintAttempt();
  await pool.query(
    `insert into spideryarn.jobs
       (id, owner_id, slug, steps, status, work_key, ingest_event_id, attempt_id, lease_expires_at)
     values ($1, $2, $3, '[]'::jsonb, 'running', $4, $5, $6, now() + interval '10 minutes')`,
    [id, OWNER, slug, `work-${id}`, reservation, attempt],
  );
  return { slug, reservation, id, attempt };
}

function ctxFor(claim: { slug: string; id: string; attempt: string }, url: string): StepContext {
  return {
    slug: claim.slug,
    url,
    report: () => {},
    preview: () => {},
    signal: new AbortController().signal,
    cacheArticle: false,
    power: "standard",
    /* Bound as src/jobs.ts binds it, with this file's tier list. */
    priceFetchedPdf: async (pages, previous) => {
      const answer = await priceFetchedPdf(claim.id, claim.attempt, pages, previous, TIERS);
      if (answer.kind === "stale") throw new Error("the fixture's billing period is stale");
      return answer;
    },
  };
}

async function slotsOf(reservation: string | null): Promise<number> {
  const { rows } = await pool.query<{ slots: number }>("select slots from spideryarn.ingest_events where id = $1", [
    reservation,
  ]);
  return rows[0]!.slots;
}

async function clear(): Promise<void> {
  await pool.query("delete from spideryarn.jobs where owner_id = $1", [OWNER]);
  await pool.query("delete from spideryarn.ingest_events where owner_id = $1", [OWNER]);
  await pool.query("delete from spideryarn.articles where owner_id = $1", [OWNER]);
  await pool.query("delete from spideryarn.billing_accounts where owner_id = $1", [OWNER]);
}

beforeEach(async () => {
  await seedAuthUser(pool, { id: OWNER, email: `matrix-${OWNER}@spideryarn.local`, onConflictDoNothing: true });
  await clear();
  await givenPaidPeriod();
  stored.n = 0;
  served.clear();
});

afterEach(async () => {
  for (const undo of rubbish.splice(0)) await undo().catch(() => {});
});

afterAll(async () => {
  await clear();
  await pool.query("delete from auth.users where id = $1", [OWNER]).catch(() => {});
  await pool.end();
});

const run = (ctx: StepContext) => STEPS.fetch.run(ctx, memoryArtefacts(), nullCheckpointStore());

describe("a pasted PDF is priced at one slot per 50 pages, before it is stored", () => {
  for (const [pages, slots] of [
    [50, 1],
    [51, 2],
    [100, 2],
    [101, 3],
    [350, 7],
    [351, 8],
    [400, 8],
  ] as const) {
    it(`${pages} pages is ${slots} ${slots === 1 ? "slot" : "slots"}`, async () => {
      const url = `https://example.test/${pages}.pdf`;
      served.set(url, aPdf(url, await pdfWithPages(pages)));
      const claim = await aClaim(`b${pages}`);
      const product = await run(ctxFor(claim, url));
      expect(await slotsOf(claim.reservation)).toBe(slots);
      expect(product.parts?.raw?.pages).toBe(pages);
      if (slots > 1) expect(product.detail).toContain(`This PDF is ${pages} pages, so it uses ${slots} of your articles`);
      else expect(product.detail).not.toMatch(/of your articles/);
    });
  }

  it("401 pages is over the cap: refused, nothing stored, the reservation still one slot", async () => {
    const url = "https://example.test/401.pdf";
    served.set(url, aPdf(url, await pdfWithPages(401)));
    const claim = await aClaim("b401");
    await expect(run(ctxFor(claim, url))).rejects.toThrow(/\[pdf-pages\]/);
    expect(stored.n).toBe(0);
    expect(await slotsOf(claim.reservation)).toBe(1);
  });

  it("a PDF behind a redirect is priced the same", async () => {
    const pasted = "https://example.test/short-link";
    const final = "https://example.test/book.pdf";
    served.set(pasted, aPdf(final, await pdfWithPages(120), [pasted, final]));
    const claim = await aClaim("redirect");
    await run(ctxFor(claim, pasted));
    expect(await slotsOf(claim.reservation)).toBe(3);
  });

  it("a paper source's PDF is priced the same", async () => {
    /* arXiv's abstract page asks for its HTML, then its PDF; only the PDF is there. */
    const pdfUrl = "https://arxiv.org/pdf/2608.13566";
    served.set(pdfUrl, aPdf(pdfUrl, await pdfWithPages(160)));
    const claim = await aClaim("arxiv");
    const product = await run(ctxFor(claim, "https://arxiv.org/abs/2608.13566"));
    expect(product.detail).toContain("arXiv PDF");
    expect(await slotsOf(claim.reservation)).toBe(4);
  });

  it("a web page stays one slot, and is never priced by pages", async () => {
    const url = "https://example.test/page";
    served.set(url, aPage(url));
    const claim = await aClaim("page");
    const product = await run(ctxFor(claim, url));
    expect(product.parts?.raw?.pages).toBeUndefined();
    expect(await slotsOf(claim.reservation)).toBe(1);
  });

  it("refused when the slots are not there: before anything is stored", async () => {
    /* 17 of 20 used: three left, and a 200-page PDF is four. */
    await pool.query(
      `insert into spideryarn.ingest_events (owner_id, kind, reserved_at, succeeded_at, slots)
       select $1, 'ingest', now(), now(), 1 from generate_series(1, 17)`,
      [OWNER],
    );
    const url = "https://example.test/200.pdf";
    served.set(url, aPdf(url, await pdfWithPages(200)));
    const claim = await aClaim("no-room");
    await expect(run(ctxFor(claim, url))).rejects.toThrow(
      /This PDF is 200 pages, which counts as 4 articles, and your account has 3 left\..*\[pay-pages\]/,
    );
    expect(stored.n).toBe(0);
    expect(await slotsOf(claim.reservation)).toBe(1);
  });
});

describe("a Rebuild of a one-page URL that now serves a long PDF", () => {
  it("is refused before anything is stored", async () => {
    const claim = await aClaim("rebuild", false);
    const { rows } = await pool.query<{ id: string }>(
      "insert into spideryarn.articles (owner_id, slug) values ($1, $2) returning id",
      [OWNER, claim.slug],
    );
    await pool.query(
      `insert into spideryarn.ingest_events (owner_id, kind, reserved_at, succeeded_at, article_id)
       values ($1, 'ingest', now(), now(), $2)`,
      [OWNER, rows[0]!.id],
    );
    /* The draft carries the published revision's raw: it was a web page. */
    const artefacts = memoryArtefacts();
    const previous: RawManifest = {
      kind: "html",
      file: "raw.html",
      url: "https://example.test/grows",
      requestedUrl: "https://example.test/grows",
      contentType: "text/html",
      encoding: "utf-8",
      bytes: 100,
      sha256: "0".repeat(64),
      fetchedAt: new Date().toISOString(),
    };
    artefacts.plant(claim.slug, "fetch", "raw", previous);
    const url = "https://example.test/grows";
    served.set(url, aPdf(url, await pdfWithPages(300)));
    await expect(STEPS.fetch.run(ctxFor(claim, url), artefacts, nullCheckpointStore())).rejects.toThrow(
      /\[pdf-rerun-pages\]/,
    );
    expect(stored.n).toBe(0);
  });

  it("is allowed when the previous source was already that long", async () => {
    const claim = await aClaim("rebuild-same", false);
    const { rows } = await pool.query<{ id: string }>(
      "insert into spideryarn.articles (owner_id, slug) values ($1, $2) returning id",
      [OWNER, claim.slug],
    );
    await pool.query(
      `insert into spideryarn.ingest_events (owner_id, kind, reserved_at, succeeded_at, article_id)
       values ($1, 'ingest', now(), now(), $2)`,
      [OWNER, rows[0]!.id],
    );
    const artefacts = memoryArtefacts();
    artefacts.plant(claim.slug, "fetch", "raw", {
      kind: "pdf",
      file: "raw.pdf",
      url: "https://example.test/same.pdf",
      contentType: "application/pdf",
      encoding: null,
      bytes: 100,
      sha256: "1".repeat(64),
      pages: 300,
      fetchedAt: new Date().toISOString(),
    } satisfies RawManifest);
    const url = "https://example.test/same.pdf";
    served.set(url, aPdf(url, await pdfWithPages(300)));
    const product = await STEPS.fetch.run(ctxFor(claim, url), artefacts, nullCheckpointStore());
    expect(product.parts?.raw?.pages).toBe(300);
    /* Free, as a re-run is: no warning, because nothing was charged. */
    expect(product.detail).not.toMatch(/of your articles/);
  });
});
