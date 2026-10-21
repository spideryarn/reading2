/**
 * **A visitor opened a private link: say so, once.** Greg, 2026-10-20 (reply
 * `spya-xug3kf` to q-agbc89, option C): the signed-in accounts that open a
 * private link, plus a count of signed-out opens, seen by the administrator
 * alone. docs/plans/261021d-admin-sees-a-private-link-s-owner-and-who-opened-it.md § 3.
 *
 * From the page, as the owner's record-open is (`OwnedArticle` in
 * ArticlePage.tsx), and for its reasons: not from inside a GET, which a
 * prefetch, retry or unfurler would inflate; and **once per slug per mount**,
 * by a ref, because StrictMode runs every effect twice in development.
 *
 * Only on a private link — `sharedBy === "link"` and a key in the address. A
 * public article sends nothing, so the visitor tests' *a signed-out browser
 * issues no POST* still holds there. Three cases:
 *
 * - **signed in, session confirmed** — the authenticated route, bound by
 *   `apiFetch` to the account access was resolved for, so a session that
 *   changes mid-flight is refused rather than recorded as somebody else;
 * - **signed out** — the one public write, credential-less
 *   (`notePrivateLinkOpened`);
 * - **session unconfirmed** — nothing: it may be the owner's own.
 *
 * Failures are swallowed: the reader is reading, and a missed count is not
 * theirs to hear about.
 */
import { useEffect, useRef } from "react";

import type { PublicSharedBy } from "../public-types.js";
import { type ShareKey, withShareKey } from "../share-key.js";
import { apiFetch } from "./lib/api.js";
import { notePrivateLinkOpened } from "./public-api.js";

export function usePrivateLinkOpen(
  slug: string,
  sharedBy: PublicSharedBy,
  shareKey: ShareKey | null,
  readerId: string | null,
  sessionUnconfirmed: boolean,
): void {
  const noted = useRef<string | null>(null);
  useEffect(() => {
    if (sharedBy !== "link" || shareKey === null || sessionUnconfirmed) return;
    if (noted.current === slug) return;
    noted.current = slug;
    const sent =
      readerId === null
        ? notePrivateLinkOpened(slug, shareKey)
        : apiFetch(withShareKey(`/api/private-link-opens/${encodeURIComponent(slug)}`, shareKey), { method: "POST" }, readerId);
    void sent.catch(() => {});
  }, [slug, sharedBy, shareKey, readerId, sessionUnconfirmed]);
}
