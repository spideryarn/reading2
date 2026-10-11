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
 * visiting by a link's key. It then calls `reread` — owner first, link second
 * (access.ts) — because another usage request may have won the same claim and
 * the response only reports articles moved by this request.
 *
 * Here, in its own file, and called from `ArticlePage` rather than from
 * access.ts, which holds the sanitiser's ingress (docs/project/security-map.md);
 * this reads nothing of the article and decides nothing about access.
 * A failed response still causes one re-read. The claim and move commit before
 * the route reads the billing summary, so a lost or failed response can hide a
 * move that already happened; the ordinary owner-first read is the safe way to
 * discover it.
 *
 * No billing cache to tell: `useBilling` keeps none between its instances, and
 * every surface that draws the plan reads it fresh when it mounts.
 */

import { useEffect, useRef } from "react";

import { apiFetch, readJson } from "../lib/api.js";

/**
 * A successful private-link read is the ordinary case. `not-shared` with a
 * key is the narrow race where another usage request transferred the article
 * after our owner read but before the link fallback, clearing that key.
 */
export function shouldCheckSharedArticleClaim(
  access: { readonly kind: string; readonly sharedBy?: string },
  hasShareKey: boolean,
): boolean {
  return (
    (access.kind === "public" && access.sharedBy === "link") ||
    (access.kind === "not-shared" && hasShareKey)
  );
}

/**
 * @param claimCheckNeeded the page either read through the private key, or
 *   reached `not-shared` with that key during the transfer race described by
 *   `shouldCheckSharedArticleClaim`.
 */
export function useClaimSharedArticle(
  slug: string,
  readerId: string | null,
  claimCheckNeeded: boolean,
  reread: () => void,
): void {
  /* Every slug and reader asked about during this mount, so returning to an
     earlier pair does not ask it twice (StrictMode's double run included). */
  const asked = useRef(new Set<string>());
  /* Who the page is for now: an answer for a slug or reader it has left is dropped. */
  const current = useRef({ slug, readerId });
  current.current = { slug, readerId };

  useEffect(() => {
    if (!claimCheckNeeded || readerId === null) return;
    const key = JSON.stringify([slug, readerId]);
    if (asked.current.has(key)) return;
    asked.current.add(key);
    void (async () => {
      try {
        await readJson<unknown>(await apiFetch("/api/billing/usage", {}, readerId));
      } catch {
        /* The claim may have committed before the response failed. */
      }
      if (current.current.slug === slug && current.current.readerId === readerId) reread();
    })();
  }, [slug, readerId, claimCheckNeeded, reread]);
}
