/**
 * **A gift's article, read through its private link, may just have become the
 * reader's own** — and if it has, the page re-reads it as its owner.
 * docs/plans/261011n-author-gift-link-and-article-ownership-transfer.md § D3.
 *
 * The author gift email links a private article by its key. When its
 * recipient signs in, their voucher is claimed on `GET /api/billing/usage`, and
 * that claim moves the starter article to them when D3's rules allow
 * (src/store/pg-vouchers.ts § `claimVouchersFor`, step 5). The route answers
 * the slugs it moved as `claimedArticles` (src/billing-plan.ts §
 * `BillingUsage`). The shelf and `/profile` call it anyway; a recipient who
 * signs in straight from the link lands back here instead, so this asks it
 * **once per slug and reader**, only while the page is a signed-in reader
 * visiting by a link's key. If this slug moved, `reread` loads the article
 * again — owner first, link second (access.ts), so it now opens as theirs.
 *
 * Here, in its own file, and called from `ArticlePage` rather than from
 * access.ts, which holds the sanitiser's ingress (docs/project/security-map.md);
 * this reads nothing of the article and decides nothing about access.
 * Failures are silent: the reader is reading already, and the shelf's own call
 * claims what this one missed.
 *
 * No billing cache to tell: `useBilling` keeps none between its instances, and
 * every surface that draws the plan reads it fresh when it mounts.
 */

import { useEffect, useRef } from "react";

import { apiFetch, readJson } from "../lib/api.js";

/** Whether `body` is a `GET /api/billing/usage` answer that moved `slug`. Asked of the body, not cast. */
export function claimedHere(body: unknown, slug: string): boolean {
  if (typeof body !== "object" || body === null) return false;
  const claimed = (body as { claimedArticles?: unknown }).claimedArticles;
  return Array.isArray(claimed) && claimed.includes(slug);
}

/**
 * @param visitorByLink this page is drawing the article as a visitor who came
 *   by its private link's key (`access.kind === "public"`, `sharedBy === "link"`).
 */
export function useClaimSharedArticle(
  slug: string,
  readerId: string | null,
  visitorByLink: boolean,
  reread: () => void,
): void {
  /* The slug and reader asked about, so each pair is asked once however often
     the page renders or the effect re-runs (StrictMode's double run included). */
  const asked = useRef<string | null>(null);
  /* Who the page is for now: an answer for a slug or reader it has left is dropped. */
  const current = useRef({ slug, readerId });
  current.current = { slug, readerId };

  useEffect(() => {
    if (!visitorByLink || readerId === null) return;
    const key = JSON.stringify([slug, readerId]);
    if (asked.current === key) return;
    asked.current = key;
    apiFetch("/api/billing/usage", {}, readerId)
      .then((r) => readJson<unknown>(r))
      .then((body) => {
        if (current.current.slug !== slug || current.current.readerId !== readerId) return;
        if (claimedHere(body, slug)) reread();
      })
      .catch(() => {
        /* Silent, on purpose: see the header. */
      });
  }, [slug, readerId, visitorByLink, reread]);
}
