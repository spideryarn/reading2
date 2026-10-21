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
 *
 * **And, for the administrator, whose it is and who opened its private link**
 * (since plan 261021d; Greg's reply `spya-xug3kf` to q-agbc89: *"As an admin, I
 * want to be able to see anything."*).
 */
import { useEffect, useState } from "react";

import type { AdminArticleAccess, AdminLinkOpener } from "../admin-articles.js";
import { isAdmin } from "../admin.js";
import { readableDate } from "../billing-plan.js";
import {
  LINK_OPENS_HEADING,
  LINK_OPENS_NONE,
  LINK_OPENS_SIGNED_OUT,
  LINK_OPENS_UNKNOWN_ACCOUNT,
  OWNERSHIP_ADMIN_CHECKING,
  OWNERSHIP_ADMIN_FAILED,
  OWNERSHIP_ADMIN_NO_EMAIL,
  OWNERSHIP_ADMIN_NOT_FOUND,
  OWNERSHIP_ADMIN_OWNER,
  OWNERSHIP_NOT_YOURS,
  OWNERSHIP_SIGNED_IN_AS,
  OWNERSHIP_YOURS,
} from "../messages.js";
import { type ShareKey, withShareKey } from "../share-key.js";
import { apiFetch, HttpError, readJson } from "./lib/api.js";
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

/** What the administrator's lines have to say, keyed on the request it answers. */
type AdminRead =
  | { kind: "checking" }
  | { kind: "found"; access: AdminArticleAccess }
  | { kind: "not-found" }
  | { kind: "failed"; message: string };

/**
 * **One request for both admin lines**: `GET /api/admin/articles/:slug/access`,
 * with the address's key when there is one. The server answers only for an
 * article the administrator can already read — their own, a public one, or a
 * private one named with its key — so what this component is handed cannot
 * widen that; a private article without its key is a 404 like no article.
 *
 * Asked only when `isAdmin(readerId)`; the namespace gate on `/api/admin` is
 * the real check. Bound by `apiFetch` to the account the page was resolved
 * for, so a session that moves mid-flight is refused before it is sent as
 * somebody else. The key travels in the query string, which our request log
 * drops (security-map.md § Where the key may travel).
 */
function useAdminArticleAccess(slug: string, readerId: string | null, shareKey: ShareKey | null): AdminRead {
  const asks = isAdmin(readerId);
  const [read, setRead] = useState<AdminRead>({ kind: "checking" });
  useEffect(() => {
    if (!asks || readerId === null) return;
    let live = true;
    setRead({ kind: "checking" });
    apiFetch(withShareKey(`/api/admin/articles/${encodeURIComponent(slug)}/access`, shareKey), {}, readerId)
      .then((r) => readJson<AdminArticleAccess>(r))
      .then((access) => {
        if (live) setRead({ kind: "found", access });
      })
      .catch((e: Error) => {
        if (!live) return;
        setRead(e instanceof HttpError && e.status === 404 ? { kind: "not-found" } : { kind: "failed", message: describeFetchFailure(e) });
      });
    return () => {
      live = false;
    };
  }, [asks, slug, readerId, shareKey]);
  return read;
}

/**
 * **The administrator's extra lines on a visitor's details page**: whose the
 * article is, and who opened its private link. Greg, `spya-cf30ac`: *"I'm an
 * admin, so I want all of the details that we have"*; for a private link, his
 * reply `spya-xug3kf` to q-agbc89. Mounted only for a confirmed session; draws
 * nothing for anybody `isAdmin` refuses.
 */
export function AdminOwnerLine({
  slug,
  readerId,
  shareKey,
}: {
  slug: string;
  readerId: string | null;
  /** The address's private-link key, or null. */
  shareKey: ShareKey | null;
}) {
  const read = useAdminArticleAccess(slug, readerId, shareKey);
  if (!isAdmin(readerId)) return null;
  return (
    <>
      <p data-admin-owner className="tw:mt-2 tw:mb-0 tw:text-sm tw:text-ink-faint">
        {ownerSentence(read)}
      </p>
      {read.kind === "found" && <LinkOpens access={read.access} />}
    </>
  );
}

/**
 * **Who opened the administrator's own article's private link**, on the
 * owner's *Access & sharing* card. Only for the administrator: whether owners
 * should see who opened their link is a decision nobody has made (plan
 * 261021d § 5), so for anybody else this draws nothing and asks nothing.
 */
export function AdminLinkOpens({ slug, readerId }: { slug: string; readerId: string | null }) {
  const read = useAdminArticleAccess(slug, readerId, null);
  if (!isAdmin(readerId) || read.kind !== "found") return null;
  return <LinkOpens access={read.access} />;
}

/**
 * The openers line. Drawn when a link is on now or any open is recorded, so a
 * public article that never had a link says nothing about links.
 */
function LinkOpens({ access }: { access: AdminArticleAccess }) {
  const { openers, signedOut } = access;
  if (!access.privateLink && openers.length === 0 && signedOut === null) return null;
  if (openers.length === 0 && signedOut === null)
    return (
      <p data-admin-link-opens="none" className="tw:mt-2 tw:mb-0 tw:text-sm tw:text-ink-faint">
        {LINK_OPENS_NONE}
      </p>
    );
  return (
    <div data-admin-link-opens className="tw:mt-2 tw:text-sm tw:text-ink-faint">
      {openers.length > 0 && (
        <>
          <p className="tw:m-0">{LINK_OPENS_HEADING}</p>
          <ul className="tw:m-0 tw:pl-5">
            {openers.map((o) => (
              <li key={o.readerId}>{openerLine(o, access.emailsAvailable)}</li>
            ))}
          </ul>
        </>
      )}
      {signedOut && (
        <p className="tw:m-0">
          {LINK_OPENS_SIGNED_OUT} {signedOut.opens.toLocaleString()}
          {readableDate(signedOut.lastOpenedAt) ? `, last ${readableDate(signedOut.lastOpenedAt)}.` : "."}
        </p>
      )}
    </div>
  );
}

function openerLine(o: AdminLinkOpener, emailsAvailable: boolean): string {
  const who = o.email ?? (emailsAvailable ? LINK_OPENS_UNKNOWN_ACCOUNT : `account ${o.readerId}`);
  const times = o.opens === 1 ? "once" : `${o.opens.toLocaleString()} times`;
  const last = readableDate(o.lastOpenedAt);
  return last ? `${who} — ${times}, last ${last}` : `${who} — ${times}`;
}

function ownerSentence(read: AdminRead): string {
  switch (read.kind) {
    case "checking":
      return OWNERSHIP_ADMIN_CHECKING;
    case "not-found":
      return OWNERSHIP_ADMIN_NOT_FOUND;
    case "failed":
      return `${OWNERSHIP_ADMIN_FAILED} ${read.message}`;
    case "found": {
      const { access } = read;
      /* `ownerEmail` is null both when the whole listing failed and when the
         Auth service does not know the account; only the first is "just now". */
      if (access.ownerEmail) return `${OWNERSHIP_ADMIN_OWNER} ${access.ownerEmail}.`;
      return access.emailsAvailable ? `${OWNERSHIP_ADMIN_OWNER} account ${access.ownerId}.` : OWNERSHIP_ADMIN_NO_EMAIL;
    }
    default: {
      const unreachable: never = read;
      return unreachable;
    }
  }
}
