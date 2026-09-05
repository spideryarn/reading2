/**
 * **`/read/public` belongs to the shelf, and the three places that have to agree
 * about it.**
 *
 * The address of the public listing is under `/read/`, so it occupies a name an
 * article could otherwise have been given. One rule, `isReservedSlug`
 * (src/ingest.ts), and three enforcers that would each fail differently:
 *
 * 1. **`parseRoute`** (src/web/router.ts) — the client. Without it `/read/public`
 *    is an article route, and the reader is told *this document is not shared*
 *    about a document that does not exist.
 * 2. **`decidePublicPage`** (src/public/page.ts) — the edge, which decides the
 *    status and the `<head>` before the bundle loads. If the two disagree, one
 *    of them serves a 404 for a page the other renders — and nothing reports it,
 *    because both halves are behaving exactly as written.
 * 3. **`lockOrCreateArticle`** (src/store/pg-revisions.ts) — the one line in the
 *    repo that brings an article address into existence. Without it an article
 *    *can* be called `public`; it simply becomes unreachable at its own
 *    canonical URL, which is the version of this failure nobody would notice.
 *
 * ## Why this is one file rather than three assertions in three suites
 *
 * Because the failure is **disagreement**, not any one of them being wrong.
 * Three tests in three files each pass while the trio drifts apart; here the
 * three are read against the same constant in the same run, and the near-miss
 * cases — `publicly`, `public-notes` — are asserted in all three at once so a
 * fix in one place cannot quietly widen the reservation in another.
 *
 * docs/plans/260904b-pricing-page-and-public-showcase.md § 3, which records that
 * the plan's first answer here — adding the name to `RESERVED` in src/slug.ts —
 * was a factual error: that set belongs to `assertSlug`, and `isSlug`, which is
 * what every router asks, has never consulted it.
 */

import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { articles } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { mintId } from "../src/ids.js";
import { isReservedSlug, isSlug, PUBLIC_LIBRARY_SLUG } from "../src/ingest.js";
import { currentOwnerId } from "../src/owner.js";
import { decidePublicPage } from "../src/public/page.js";
import { lockOrCreateArticle, PublishRefused } from "../src/store/pg-revisions.js";
import { parseRoute, PUBLIC_LIBRARY_HREF } from "../src/web/router.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

/** Names that only *look* like the reserved one. None of them is reserved. */
const NEAR_MISSES = ["publicly", "public-notes", "publics", "notpublic", "pub"];

describe("the reserved shelf address", () => {
  /**
   * **It is still a slug**, and that is deliberate rather than an oversight.
   *
   * `isSlug` answers *may this string be turned into a path*, and it is asked at
   * every read as well as at minting. Refusing `public` there would refuse it on
   * the way out too, so a row that somehow held the name could never be read
   * back or repaired. The reservation is a second, narrower question with its
   * own function — the same split src/slug.ts argues for at length.
   */
  it("is a legal slug shape, which is exactly why it has to be reserved separately", () => {
    expect(isSlug(PUBLIC_LIBRARY_SLUG)).toBe(true);
    expect(isReservedSlug(PUBLIC_LIBRARY_SLUG)).toBe(true);
  });

  /** Case-folded, for the reason src/slug.ts gives about its own reserved set. */
  it("is reserved whatever case it is written in", () => {
    expect(isReservedSlug("PUBLIC")).toBe(true);
    expect(isReservedSlug("Public")).toBe(true);
  });

  it("and reserves nothing that merely starts the same way", () => {
    for (const name of NEAR_MISSES) expect({ name, reserved: isReservedSlug(name) }).toEqual({
      name,
      reserved: false,
    });
  });

  /* --------------------------------------------------------- the client -- */

  it("parses as the public shelf, not as an article", () => {
    expect(parseRoute(PUBLIC_LIBRARY_HREF)).toEqual({ kind: "public-library" });
    /* Greg writes these addresses with a trailing slash, and every other route
       here takes both spellings. */
    expect(parseRoute(`${PUBLIC_LIBRARY_HREF}/`)).toEqual({ kind: "public-library" });
  });

  /**
   * **And the href is built from the reserved name**, rather than typed out
   * beside it. Two spellings is one place for the route and the reservation to
   * come apart, and the failure would be a route the reservation had stopped
   * protecting with nothing to say so.
   */
  it("and its href is the reserved name, not a second copy of it", () => {
    expect(PUBLIC_LIBRARY_HREF).toBe(`/read/${PUBLIC_LIBRARY_SLUG}`);
  });

  it("while a near miss is still an ordinary article route", () => {
    for (const name of NEAR_MISSES) {
      expect(parseRoute(`/read/${name}`)).toEqual({ kind: "read", slug: name, view: "article" });
    }
  });

  /* ----------------------------------------------------------- the edge -- */

  /**
   * **The edge answers it from a constant**, with no head and no read.
   *
   * `load` is `null` here on purpose: `servePublicReadPage` does not attempt one
   * for this address, so passing a head would be testing a call that never
   * happens. **200 since stage 3b**, because there is a page behind the address
   * now — and still no head, because a `PublicHead` is composed from an article
   * and this is not one. What this pins either way is that the answer does not
   * come from the article reader.
   */
  it("is answered by the edge without consulting the article reader", () => {
    const decision = decidePublicPage("GET", PUBLIC_LIBRARY_SLUG, null, "sha");
    expect(decision.head).toBeNull();
    expect(decision.status).toBe(200);
  });

  /**
   * **And the client and the edge agree about it**, which is the property this
   * file exists for. App.tsx draws `PublicLibraryPage` for `public-library`; the
   * edge sets a 200. A 200 from one and a not-found page from the other is the
   * shape that ships without anybody noticing, and it went the other way round
   * until stage 3b: both said 404, deliberately, while there was no page.
   *
   * **`head` stays `null` on both sides of that change**, which is the part
   * worth keeping an assertion on now that the status has moved. The obvious
   * next edit here is to give the shelf a link-preview card, and the reason not
   * to is that `PublicHead` is composed from one article's title and gist
   * (src/public/page-head.ts) — there is no article, so a head built here could
   * only be a made-up one.
   */
  it("and the client's answer and the edge's status say the same thing", () => {
    const route = parseRoute(PUBLIC_LIBRARY_HREF);
    const decision = decidePublicPage("GET", PUBLIC_LIBRARY_SLUG, null, "sha");
    /* Both "there is a page here, and it is not an article". */
    expect(route.kind).toBe("public-library");
    expect(decision.status).toBe(200);
    expect(decision.head).toBeNull();
  });

  /**
   * A near miss goes to the reader exactly as before — the edge's own control,
   * without which every case above would pass on a `decidePublicPage` that
   * answered 404 to everything.
   */
  it("while a near miss still reaches the article path at the edge", () => {
    const found = decidePublicPage("GET", "public-notes", { kind: "not-shared" }, "sha");
    expect(found.status).toBe(404);
    const ok = decidePublicPage(
      "GET",
      "public-notes",
      { kind: "found", head: { slug: "public-notes", title: "A piece", gist: null, canonical: null } },
      "sha",
    );
    expect(ok.status).toBe(200);
    expect(ok.head?.title).toBe("A piece");
  });
});

/* ------------------------------------------- the third enforcer, for real -- */

await pgReady({
  suite: "tests/reserved-article-address.test.ts",
  tables: ["spideryarn.articles"],
});
/**
 * **The one line in the repo that brings an article address into existence.**
 *
 * The two routing halves above are pure and always run; this one needs Postgres,
 * because what is being tested is a refusal *inside* the insert path and there
 * is no honest way to observe it without the row and the lock.
 *
 * **Every case rolls back.** They are asserting a decision, not leaving a
 * fixture, and a transaction that throws is the cheapest way to have written
 * nothing — which also means these cases cannot collide with a peer's run.
 */
describe("creating an article with the reserved name", { timeout: 20_000 }, () => {
  afterAll(async () => {
    await closeDb();
  });

  /** Rolled back whatever happens, by throwing a value nothing else uses. */
  const ROLLED_BACK = Symbol("rolled back");
  async function inRolledBackTx<T>(run: (tx: never) => Promise<T>): Promise<T> {
    let answer: T | undefined;
    let got = false;
    try {
      await getDb().transaction(async (tx) => {
        answer = await run(tx as never);
        got = true;
        throw ROLLED_BACK;
      });
    } catch (err) {
      if (err !== ROLLED_BACK) throw err;
    }
    /* A rollback that happened *before* the body finished would leave `answer`
       undefined and make an assertion about it vacuous. */
    expect(got, "the transaction body did not finish").toBe(true);
    return answer as T;
  }

  it("is refused, and says which address it collides with", async () => {
    await expect(
      inRolledBackTx((tx) => lockOrCreateArticle(tx, PUBLIC_LIBRARY_SLUG)),
    ).rejects.toBeInstanceOf(PublishRefused);
    await expect(
      inRolledBackTx((tx) => lockOrCreateArticle(tx, PUBLIC_LIBRARY_SLUG)),
    ).rejects.toThrow(new RegExp(`/read/${PUBLIC_LIBRARY_SLUG}`));
  });

  /**
   * **The positive control, and the case above is worthless without it.**
   *
   * A `lockOrCreateArticle` that refused everything — or that threw before it
   * ever reached the insert — would pass the refusal on its own. This is the one
   * that fails in that case.
   */
  it("while a name that merely starts the same way is created as usual", async () => {
    const slug = `public-notes-${randomUUID().slice(0, 8)}`;
    const row = await inRolledBackTx((tx) => lockOrCreateArticle(tx, slug));
    expect(row.slug).toBe(slug);
    expect(row.ownerId).toBe(currentOwnerId());
  });

  /**
   * **And an article that already holds the name is still locked, not refused.**
   *
   * The check sits after the lock attempt and before the insert, deliberately:
   * what is refused is *taking* the name. An existing row on some deployment —
   * this install has none, which was checked on 2026-09-04 — goes on being
   * locked, read, re-extracted and repaired, rather than becoming unwritable the
   * day the reservation shipped. A refusal at the top of the function would have
   * done that, and would have looked identical in every other test here.
   */
  it("but an article that already has the name is still locked, not refused", async () => {
    const row = await inRolledBackTx(async (tx) => {
      await (tx as unknown as ReturnType<typeof getDb>).insert(articles).values({
        id: randomUUID(),
        ownerId: currentOwnerId(),
        slug: PUBLIC_LIBRARY_SLUG,
        shortId: mintId(),
      });
      return lockOrCreateArticle(tx, PUBLIC_LIBRARY_SLUG);
    });
    expect(row.slug).toBe(PUBLIC_LIBRARY_SLUG);
  });
});
