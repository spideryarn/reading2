/**
 * **Whose article this is**, as the first line of the details page's sharing
 * section — the owner's *Access & sharing* card and a visitor's *Access*.
 * Greg, 2026-10-19 (`spya-cf30ac`):
 *
 * > It doesn't seem obvious who owns an article … Maybe it could be under the
 * > sharing section.
 *
 * docs/plans/261020j-say-who-owns-an-article-on-its-details-page.md.
 *
 * **It claims only what the page already knows.** The owner's page is drawn
 * only when the owned read answered, so `"yours"` is never a guess; a visitor's
 * page is drawn for anybody else, so `"not-yours"` is said only when the session
 * is signed in *and* the server agreed it is somebody's — an unconfirmed session
 * may be the owner's own (SharedNotice says so), and a signed-out reader is not
 * told anything about ownership at all.
 */
import { useEffect, useState } from "react";

import type { AdminArticle, AdminArticles } from "../admin-articles.js";
import { isAdmin } from "../admin.js";
import {
  OWNERSHIP_ADMIN_CHECKING,
  OWNERSHIP_ADMIN_FAILED,
  OWNERSHIP_ADMIN_LINK,
  OWNERSHIP_ADMIN_NO_EMAIL,
  OWNERSHIP_ADMIN_NOT_LISTED,
  OWNERSHIP_ADMIN_OWNER,
  OWNERSHIP_NOT_YOURS,
  OWNERSHIP_SIGNED_IN_AS,
  OWNERSHIP_YOURS,
} from "../messages.js";
import type { PublicSharedBy } from "../public-types.js";
import { apiFetch, readJson } from "./lib/api.js";
import { describeFetchFailure } from "./lib/describe-failure.js";

export function Ownership({
  whose,
  email,
}: {
  whose: "yours" | "not-yours";
  /** The signed-in account's own address, or null when the session has none to show. */
  email: string | null;
}) {
  return (
    <p data-ownership={whose} className="tw:m-0 tw:text-sm tw:text-ink">
      <span className="tw:font-semibold">{whose === "yours" ? OWNERSHIP_YOURS : OWNERSHIP_NOT_YOURS}</span>
      {email && (
        <span className="tw:text-ink-faint">
          {" "}
          {OWNERSHIP_SIGNED_IN_AS} {email}.
        </span>
      )}
    </p>
  );
}

/** What the administrator's line has to say, keyed on the request it answers. */
type AdminRead =
  | { kind: "checking" }
  | { kind: "found"; row: AdminArticle; emailsAvailable: boolean }
  | { kind: "not-listed" }
  | { kind: "failed"; message: string };

/**
 * **The administrator's extra line on a visitor's details page**: whose the
 * article is. Greg, `spya-cf30ac`: *"I'm an admin, so I want all of the details
 * that we have"*.
 *
 * **Public articles only, and the server is what makes it so.** It reads the
 * `/admin/articles` list (`GET /api/admin/articles`) and finds this article by
 * slug — and that list carries a slug only for the administrator's own and
 * public articles (pg-article-transfer.ts § `listArticlesAcrossOwners`). A
 * private-link article has no slug there, so it cannot be matched however this
 * component is called: holding the key lets you read it, not learn whose it is
 * (admin.md § What it deliberately does not show). Whether that should change
 * is question q-agbc89. So a private link gets a sentence saying so and makes
 * no request.
 *
 * Mounted only for a confirmed session whose id `isAdmin` accepts; the
 * namespace gate on `/api/admin` is the real check. The answer is kept only
 * for the slug and reader it was asked for.
 */
export function AdminOwnerLine({
  slug,
  readerId,
  sharedBy,
}: {
  slug: string;
  readerId: string | null;
  sharedBy: PublicSharedBy;
}) {
  const asks = isAdmin(readerId) && sharedBy === "public";
  const [read, setRead] = useState<AdminRead>({ kind: "checking" });
  useEffect(() => {
    if (!asks || readerId === null) return;
    let live = true;
    setRead({ kind: "checking" });
    /* Bind the request to the same account whose confirmed access result
       mounted this line. If the session moves while the token is being read,
       apiFetch refuses before sending rather than asking /api/admin as B. */
    apiFetch("/api/admin/articles", {}, readerId)
      .then((r) => readJson<AdminArticles>(r))
      .then((body) => {
        if (!live) return;
        const row = body.articles.find((a) => a.slug === slug);
        setRead(row ? { kind: "found", row, emailsAvailable: body.emailsAvailable } : { kind: "not-listed" });
      })
      .catch((e: Error) => {
        if (live) setRead({ kind: "failed", message: describeFetchFailure(e) });
      });
    return () => {
      live = false;
    };
  }, [asks, slug, readerId]);

  if (!isAdmin(readerId)) return null;
  return (
    <p data-admin-owner className="tw:mt-2 tw:mb-0 tw:text-sm tw:text-ink-faint">
      {adminSentence(sharedBy, read)}
    </p>
  );
}

function adminSentence(sharedBy: PublicSharedBy, read: AdminRead): string {
  if (sharedBy === "link") return OWNERSHIP_ADMIN_LINK;
  switch (read.kind) {
    case "checking":
      return OWNERSHIP_ADMIN_CHECKING;
    case "not-listed":
      return OWNERSHIP_ADMIN_NOT_LISTED;
    case "failed":
      return `${OWNERSHIP_ADMIN_FAILED} ${read.message}`;
    case "found":
      /* `ownerEmail` is null both when the whole listing failed and when the
         Auth service does not know the account; only the first is "just now". */
      if (read.row.ownerEmail) return `${OWNERSHIP_ADMIN_OWNER} ${read.row.ownerEmail}.`;
      return read.emailsAvailable ? `${OWNERSHIP_ADMIN_OWNER} account ${read.row.ownerId}.` : OWNERSHIP_ADMIN_NO_EMAIL;
    default: {
      const unreachable: never = read;
      return unreachable;
    }
  }
}
