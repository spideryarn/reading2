/**
 * **A visitor opened a private link: say so, once.** Greg, 2026-10-20 (reply
 * `spya-xug3kf` to q-agbc89, option C): the signed-in accounts that open a
 * private link, plus a count of signed-out opens, seen by the administrator
 * alone. docs/plans/261021d-admin-sees-a-private-link-s-owner-and-who-opened-it.md § 3.
 *
 * From the page, as the owner's record-open is (`OwnedArticle` in
 * ArticlePage.tsx), and for its reasons: not from inside a GET, which a
 * prefetch, retry or unfurler would inflate; and **once per visit**: one slug,
 * key and reader is noted once per page load, in module state rather than a
 * ref. A ref was not enough. StrictMode runs every effect twice, and a
 * signed-in visitor's gift-claim check (`useClaimSharedArticle`) reads the
 * article again and remounts the page under it, so a ref counted every
 * signed-in open twice. The full suite's network trace caught that.
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
import { useEffect } from "react";

import type { PublicSharedBy } from "../public-types.js";
import { type ShareKey, withShareKey } from "../share-key.js";
import { apiFetch } from "./lib/api.js";
import { notePrivateLinkOpened } from "./public-api.js";

/** The last visit noted in this page load: slug, key and reader. */
let lastNoted: string | null = null;

/** Tests only: start a new page load. */
export function forgetNotedPrivateLinkOpen(): void {
  lastNoted = null;
}

export function usePrivateLinkOpen(
  slug: string,
  sharedBy: PublicSharedBy,
  shareKey: ShareKey | null,
  readerId: string | null,
  sessionUnconfirmed: boolean,
): void {
  useEffect(() => {
    if (sharedBy !== "link" || shareKey === null || sessionUnconfirmed) return;
    const visit = `${slug}\n${shareKey}\n${readerId ?? ""}`;
    if (lastNoted === visit) return;
    lastNoted = visit;
    const sent =
      readerId === null
        ? notePrivateLinkOpened(slug, shareKey)
        : apiFetch(withShareKey(`/api/private-link-opens/${encodeURIComponent(slug)}`, shareKey), { method: "POST" }, readerId);
    void sent.catch(() => {});
  }, [slug, sharedBy, shareKey, readerId, sessionUnconfirmed]);
}
