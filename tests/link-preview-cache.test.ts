/**
 * **The shared cache: fetch once, and expire what should expire.**
 *
 * Four properties, and every one of them is silent rather than loud when it
 * goes — a cache that quietly stopped sharing, or quietly stopped forgetting,
 * looks exactly like a cache that works.
 *
 * 1. **Single-flight.** Two cold requests for one URL arriving at the same
 *    moment: one is told to fetch and the other is told to wait. A unique row
 *    prevents duplicate *storage* and never duplicate *traffic*, so an upsert
 *    on its own would have both of them out on the network and both of them
 *    spending. GPT Sol, 2026-09-05, P1-4.
 * 2. **A transient failure expires and a stable one does not** — inside ten
 *    minutes and inside seven days respectively. *"Cache the failure"* with no
 *    clock is what lets one blip poison a global row for ever, and one 429 is
 *    not a fact about a URL. P2-2.
 * 3. **A redirect leaves an alias**, so the address the author wrote goes on
 *    being found after the content has landed under the address the server
 *    ended at. Without it, every redirecting spelling is a permanent miss.
 * 4. **An expired row reads as nothing**, so no caller can serve a stale answer
 *    by forgetting a date comparison.
 *
 * The lifetimes themselves are a pure function and are pinned here too: they
 * are policy, and policy that changed by accident would look like a cache
 * behaving differently rather than like a decision being reversed.
 *
 * Skips loudly when there is no database; tests/helpers/pg-ready.ts.
 */
import { eq } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";

import { closeDb, getDb } from "../src/db/client.js";
import { linkPreviews } from "../src/db/schema.js";
import { loadEnvLocal } from "../src/env.js";
import { FetchFailure } from "../src/fetch.js";
import { classifyFailure, PREVIEW_LIFETIMES } from "../src/link-previews.js";
import { pgLinkPreviewStore, sweepLinkPreviews } from "../src/store/pg-link-previews.js";
import { pgReady } from "./helpers/pg-ready.js";

loadEnvLocal();

await pgReady({
  suite: "tests/link-preview-cache.test.ts",
  tables: ["spideryarn.link_previews"],
});

/** A distinct address per case, so nothing here depends on the order they ran. */
const at = (name: string) => `https://cache.example/${name}`;

const LEASE_MS = 20_000;

afterEach(async () => {
  await getDb().delete(linkPreviews);
});

afterAll(async () => {
  await closeDb();
});

describe("the link-preview cache", () => {
  it("hands the claim to one caller and tells the other to wait", async () => {
    const target = at("single-flight");
    /* Sequential rather than raced, deliberately: `Promise.all` through a pool
       that opens connections lazily can serialise anyway, which would make a
       broken lock pass. Two claims one after the other is the same question
       with no timing in it — the second must see the first's `pending` row and
       refuse, and it will only do that if the claim wrote one. */
    const first = await pgLinkPreviewStore.claim(target, LEASE_MS);
    const second = await pgLinkPreviewStore.claim(target, LEASE_MS);
    expect(first).toMatchObject({ kind: "claimed" });
    expect(second).toEqual({ kind: "pending" });
  });

  it("lets the next caller take an abandoned claim once its lease has run out", async () => {
    const target = at("abandoned");
    expect(await pgLinkPreviewStore.claim(target, LEASE_MS)).toMatchObject({
      kind: "claimed",
    });
    /* The process holding it died. A lease and not a flag is the whole reason
       this URL is not wedged for ever. */
    await getDb()
      .update(linkPreviews)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(linkPreviews.target, target));
    expect(await pgLinkPreviewStore.claim(target, LEASE_MS)).toMatchObject({
      kind: "claimed",
    });
  });

  it("gives a claim back when the fetch never happens", async () => {
    const target = at("released");
    const mine = await pgLinkPreviewStore.claim(target, LEASE_MS);
    if (mine.kind !== "claimed") throw new Error("expected the claim");
    await pgLinkPreviewStore.release(target, mine.claimId);
    /* The next caller may try immediately rather than waiting out a lease it
       has no reason to respect — the path a reader whose allowance is spent
       leaves behind. */
    expect(await pgLinkPreviewStore.claim(target, LEASE_MS)).toMatchObject({
      kind: "claimed",
    });
  });

  it("will not let a stalled claimant delete its successor's claim", async () => {
    const target = at("release-is-fenced");
    const first = await pgLinkPreviewStore.claim(target, LEASE_MS);
    if (first.kind !== "claimed") throw new Error("expected the claim");
    /* A stalls past its lease and B takes over. */
    await getDb()
      .update(linkPreviews)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(linkPreviews.target, target));
    const second = await pgLinkPreviewStore.claim(target, LEASE_MS);
    if (second.kind !== "claimed") throw new Error("expected the second claim");
    expect(second.claimId).not.toBe(first.claimId);

    /* A wakes up, is refused allowance, and releases. Without the fencing token
       that delete lands on B's row, and a third caller then starts a third
       fetch of a URL somebody is already fetching. GPT Sol, P1-2. */
    await pgLinkPreviewStore.release(target, first.claimId);
    expect(await pgLinkPreviewStore.claim(target, LEASE_MS)).toEqual({ kind: "pending" });

    /* And B's own release still works, which is the control: a `release` that
       deleted nothing at all would pass the assertion above. */
    await pgLinkPreviewStore.release(target, second.claimId);
    expect(await pgLinkPreviewStore.claim(target, LEASE_MS)).toMatchObject({ kind: "claimed" });
  });

  it("will not let a release take an answer somebody else wrote", async () => {
    const target = at("release-after-fill");
    const mine = await pgLinkPreviewStore.claim(target, LEASE_MS);
    if (mine.kind !== "claimed") throw new Error("expected the claim");
    await pgLinkPreviewStore.fill([
      {
        target,
        entry: { kind: "ok", page: { title: "A title" }, excerpt: null },
        expiresAt: new Date(Date.now() + PREVIEW_LIFETIMES.ok),
      },
    ]);
    /* An overrunning fetch calling `release` after a faster one already
       answered must not delete the answer. */
    await pgLinkPreviewStore.release(target, mine.claimId);
    expect(await pgLinkPreviewStore.read(target)).toEqual({
      kind: "ok",
      page: { title: "A title" },
      excerpt: null,
    });
  });

  it("will not let a slow loser turn a live answer into a failure", async () => {
    const target = at("no-downgrade");
    await pgLinkPreviewStore.fill([
      {
        target,
        entry: { kind: "ok", page: { title: "The good answer" }, excerpt: null },
        expiresAt: new Date(Date.now() + PREVIEW_LIFETIMES.ok),
      },
    ]);
    /* The sequence a per-target claim cannot cover: A stalls past its lease, B
       reclaims and fills a good preview, A wakes up with a timeout and writes
       it over. Or the redirect version — a request for R that redirects to F
       and a direct request for F hold *different* advisory locks and both write
       F. GPT Sol, P1-2. */
    await pgLinkPreviewStore.fill([
      {
        target,
        entry: { kind: "transient", why: "timeout" },
        expiresAt: new Date(Date.now() + PREVIEW_LIFETIMES.transient),
      },
    ]);
    expect(await pgLinkPreviewStore.read(target)).toEqual({
      kind: "ok",
      page: { title: "The good answer" },
      excerpt: null,
    });
  });

  it("still lets a good answer replace a failure, and a failure replace a dead row", async () => {
    /* The control for the case above, and the half that makes the rule
       one-directional rather than a freeze: a cache that could never move on
       from a 404 would be worse than one with no expiry at all. */
    const target = at("recovers");
    await pgLinkPreviewStore.fill([
      {
        target,
        entry: { kind: "permanent", why: "not-found" },
        expiresAt: new Date(Date.now() + PREVIEW_LIFETIMES.permanent),
      },
    ]);
    await pgLinkPreviewStore.fill([
      {
        target,
        entry: { kind: "ok", page: { title: "It came back" }, excerpt: null },
        expiresAt: new Date(Date.now() + PREVIEW_LIFETIMES.ok),
      },
    ]);
    expect(await pgLinkPreviewStore.read(target)).toEqual({
      kind: "ok",
      page: { title: "It came back" },
      excerpt: null,
    });

    /* And once that answer has expired, a failure may take its place. */
    await getDb()
      .update(linkPreviews)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(linkPreviews.target, target));
    await pgLinkPreviewStore.fill([
      {
        target,
        entry: { kind: "permanent", why: "not-found" },
        expiresAt: new Date(Date.now() + PREVIEW_LIFETIMES.permanent),
      },
    ]);
    expect(await pgLinkPreviewStore.read(target)).toEqual({
      kind: "permanent",
      why: "not-found",
    });
  });

  it("reads an expired row as nothing at all", async () => {
    const target = at("expired");
    await pgLinkPreviewStore.fill([
      {
        target,
        entry: { kind: "ok", page: { title: "Stale" }, excerpt: null },
        expiresAt: new Date(Date.now() - 1_000),
      },
    ]);
    /* Not "here is a stale answer, check the date yourself". The staleness test
       is in the WHERE clause so that no caller can skip it. */
    expect(await pgLinkPreviewStore.read(target)).toBeNull();
  });

  it("follows a redirect alias to the content", async () => {
    const requested = at("doi");
    const final = at("the-actual-paper");
    const expiresAt = new Date(Date.now() + PREVIEW_LIFETIMES.ok);
    await pgLinkPreviewStore.fill([
      {
        target: final,
        entry: { kind: "ok", page: { title: "Where it went" }, excerpt: null },
        expiresAt,
      },
      {
        target: requested,
        entry: { kind: "alias", finalTarget: final },
        expiresAt,
      },
    ]);
    expect(await pgLinkPreviewStore.read(requested)).toEqual({
      kind: "ok",
      page: { title: "Where it went" },
      excerpt: null,
    });
    /* And the claim path agrees with the read path, which is what stops a
       fresh alias causing a fetch on every hover. */
    expect(await pgLinkPreviewStore.claim(requested, LEASE_MS)).toEqual({
      kind: "hit",
      entry: { kind: "ok", page: { title: "Where it went" }, excerpt: null },
    });
  });

  it("refetches when an alias points at a row that has expired", async () => {
    const requested = at("doi-stale");
    const final = at("gone-stale");
    await pgLinkPreviewStore.fill([
      {
        target: final,
        entry: { kind: "ok", page: { title: "Old" }, excerpt: null },
        expiresAt: new Date(Date.now() - 1_000),
      },
      {
        target: requested,
        entry: { kind: "alias", finalTarget: final },
        expiresAt: new Date(Date.now() + PREVIEW_LIFETIMES.ok),
      },
    ]);
    expect(await pgLinkPreviewStore.read(requested)).toBeNull();
    /* And the claim is taken on **what the caller asked for**, not on the
       destination: the refetch starts from the requested address and rewrites
       both rows, which is the only way a moved redirect is ever noticed. */
    expect(await pgLinkPreviewStore.claim(requested, LEASE_MS)).toMatchObject({
      kind: "claimed",
    });
  });

  it("sweeps rows that are past their expiry by the grace period", async () => {
    const alive = at("alive");
    const dead = at("dead");
    await pgLinkPreviewStore.fill([
      {
        target: alive,
        entry: { kind: "ok", page: { title: "Alive" }, excerpt: null },
        expiresAt: new Date(Date.now() + PREVIEW_LIFETIMES.ok),
      },
      {
        target: dead,
        entry: { kind: "permanent", why: "not-found" },
        expiresAt: new Date(Date.now() - 60_000),
      },
    ]);
    /* An ownerless row must not live for ever by default — the retention half
       of P1-7. The grace period is what lets a just-expired row be refreshed in
       place rather than deleted and re-inserted. */
    /* The dry run first, because a sweep whose report and whose delete could
       disagree is a sweep nobody can check before running. */
    expect(await sweepLinkPreviews(30_000, { dryRun: true })).toBe(1);
    const untouched = await getDb().select({ target: linkPreviews.target }).from(linkPreviews);
    expect(untouched).toHaveLength(2);

    expect(await sweepLinkPreviews(30_000)).toBe(1);
    const left = await getDb().select({ target: linkPreviews.target }).from(linkPreviews);
    expect(left.map((r) => r.target)).toEqual([alive]);
  });
});

describe("how long a failure stands", () => {
  const now = Date.UTC(2026, 8, 5, 12, 0, 0);

  it("gives a timeout a short expiry", () => {
    const { entry, expiresAt } = classifyFailure(
      new FetchFailure("timeout", "https://x.example/", "too slow"),
      now,
    );
    expect(entry).toEqual({ kind: "transient", why: "timeout" });
    expect(expiresAt.getTime()).toBe(now + PREVIEW_LIFETIMES.transient);
    /* Ten minutes, not ten days: the whole point is that the next reader gets
       a real answer rather than inheriting one blip. */
    expect(PREVIEW_LIFETIMES.transient).toBeLessThan(60 * 60 * 1000);
  });

  it("gives a 404 a long one, and still an expiry", () => {
    const { entry, expiresAt } = classifyFailure(
      new FetchFailure("not-found", "https://x.example/", "gone", {
        status: 404,
      }),
      now,
    );
    expect(entry).toEqual({ kind: "permanent", why: "not-found" });
    expect(expiresAt.getTime()).toBe(now + PREVIEW_LIFETIMES.permanent);
    /* **Stable is not for ever.** A permanent row with no clock is exactly what
       P2-2 refuses: pages come back. */
    expect(Number.isFinite(expiresAt.getTime())).toBe(true);
    expect(expiresAt.getTime()).toBeGreaterThan(now + PREVIEW_LIFETIMES.transient);
  });

  it("treats a Cloudflare 403 as stable, because it is", () => {
    /* philpapers and science.org — the corpus's commonest destination is behind
       a bot challenge, confirmed by `curl` on 2026-09-05. Retrying that every
       ten minutes for every reader would be a lot of traffic to learn the same
       thing twice. */
    const { entry } = classifyFailure(
      new FetchFailure("forbidden", "https://philpapers.example/", "refused", {
        status: 403,
      }),
      now,
    );
    expect(entry).toEqual({ kind: "permanent", why: "forbidden" });
  });

  it("respects Retry-After, within bounds", () => {
    const asked = 45 * 60 * 1000;
    const { expiresAt } = classifyFailure(
      new FetchFailure("rate-limited", "https://x.example/", "slow down", {
        status: 429,
        retryAfterMs: asked,
      }),
      now,
    );
    expect(expiresAt.getTime()).toBe(now + asked);
  });

  it("will not let a server ask for a month", () => {
    const { expiresAt } = classifyFailure(
      new FetchFailure("rate-limited", "https://x.example/", "slow down", {
        status: 429,
        retryAfterMs: 30 * 24 * 60 * 60 * 1000,
      }),
      now,
    );
    /* A shared cache should not promise a stranger's server that nobody will
       look at their page for a month, and a `Retry-After` of zero would be a
       retry loop. Both ends are clamped. */
    expect(expiresAt.getTime()).toBe(now + PREVIEW_LIFETIMES.maxRetryAfter);
  });

  it("treats an unrecognised throw as stable rather than as a reason to retry", () => {
    const { entry } = classifyFailure(new TypeError("fetch failed"), now);
    /* Something that is not a `FetchFailure` is a bug here rather than a
       property of the destination, and hammering somebody else's server every
       ten minutes over our own bug is the wrong direction to fail in. */
    expect(entry).toEqual({ kind: "permanent", why: "failed" });
  });
});
