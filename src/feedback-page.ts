/**
 * **The page a report was filed from, as the reader's own Earlier tab may show
 * it** — a label, not the address.
 * docs/plans/261003g-earlier-tab-shows-the-page-each-report-was-filed-from.md.
 *
 * Greg, 2026-10-01 (spya-y4upzw): *"Can you ensure that when I provide feedback
 * using this Feedback dialog that it includes the URL of the page that I was on
 * as metadata."* It did, and had since 2026-09-02; what was missing was anywhere
 * in the dialog a reader could see that. So the Earlier tab says where each
 * report was filed.
 *
 * **Not the stored address**, because `EarlierFeedback` in src/types.ts keeps
 * that back for a reason that still holds: it can carry the reader's search
 * terms, or a credential inside an `/add/<somebody's URL>`. What is left after
 * these rules is the path of a page this app has:
 *
 * - the path only — no origin, no query string, no fragment (one thing from
 *   the query goes beside it, never in it: `feedbackPageAt`, below);
 * - **only a page the app has.** A signed-in reader can file a report from any
 *   address at all — a mistyped one, a pasted one — and the route accepts any
 *   `http(s)` origin, so an unrecognised path is somebody's arbitrary text and
 *   is `null` (GPT Sol's plan review, P1);
 * - an import is just `/add`, since what follows is a third party's address or
 *   an upload's id;
 * - `null` when there is no address, or it is not an `http(s)` one.
 *
 * **What it does still carry, knowingly:** an article's slug, in `/read/<slug>`.
 * A slug is made from the source's title or file name, it is validated
 * (`isSlug`, at most 60 characters), and it is the one name for the article the
 * reader already sees in their own address bar and shelf. The label is rebuilt
 * from the decoded slug rather than passed through, so a percent-encoded
 * spelling of it does not survive either.
 *
 * **Its own list of pages, and not `parseRoute`.** The router is the app's
 * answer to "is this one of our pages", but it lives in src/web/router.ts,
 * which imports React, and nothing on the server imports from src/web/. The
 * first draft did, on the strength of two files that turned out only to
 * mention the router in comments (GPT Sol's code review). So the fixed pages
 * are named here, and **tests/feedback-page.test.ts holds the two together**:
 * a sample path for every `Route` kind — a new kind is a compile error there —
 * must get a label exactly when the router recognises it. A page missing from
 * this list fails in the safe direction: no label, not a wrong one.
 */
import { isSpideryarnId } from "./ids.js";
import { isSlug } from "./ingest.js";
import {
  ADMIN_COSTS_PATH,
  ADMIN_FEEDBACK_PATH,
  ADMIN_USERS_PATH,
  ADMIN_VOUCHERS_PATH,
} from "./urls.js";

/** The pages whose address is just itself. The router's `*_HREF` constants, as paths. */
const FIXED_PAGES: ReadonlySet<string> = new Set([
  "/",
  "/index.html",
  "/design",
  "/login",
  "/profile",
  "/privacy",
  "/features",
  "/features/public-readable-sharing",
  "/pricing",
  "/contact",
  "/changelog",
  "/help",
  "/opensource",
  "/auth/callback",
  "/oauth/consent",
  "/admin",
  ADMIN_USERS_PATH,
  ADMIN_FEEDBACK_PATH,
  ADMIN_VOUCHERS_PATH,
  ADMIN_COSTS_PATH,
]);

/** The stored address, when it is a web address at all. */
function webAddress(url: string | null): URL | null {
  if (url === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed : null;
}

/** One page of Help: `/help/<one segment>`. `/help` itself is in `FIXED_PAGES`. */
const HELP_PAGE = /^\/help\/[^/]+$/;

/** An article's reading page: `/read/<slug>`, and not its `/metadata`. */
const READING_PAGE = /^\/read\/[^/]+$/;

export function feedbackPageLabel(url: string | null): string | null {
  const parsed = webAddress(url);
  if (parsed === null) return null;
  /* One trailing slash is the same page, as it is to the router. */
  const path = parsed.pathname.length > 1 ? parsed.pathname.replace(/\/$/, "") : parsed.pathname;
  if (FIXED_PAGES.has(path)) return path;
  if (path === "/add" || path.startsWith("/add/")) return "/add";
  /* **A page of Help is just `/help`**, for `/add`'s reason. The router gives
     Help any one segment under it without judging it, and Help draws itself
     there whether or not the segment names a page (src/web/help/help-anchors.ts
     § `resolveHelpPage`), so the segment is whatever somebody typed. One
     segment only: the router has no address deeper than that.
     docs/plans/261007e-help-back-in-the-bar-and-help-as-markdown-pages-by-mode-and-theme-with-reader-guides.md,
     R2. */
  if (HELP_PAGE.test(path)) return "/help";
  /* `/read/public` is slug-shaped, so the public shelf comes out of this arm too. */
  const article = /^\/read\/([^/]+)(\/metadata)?$/.exec(path);
  if (!article) return null;
  let slug: string;
  try {
    slug = decodeURIComponent(article[1] ?? "");
  } catch {
    return null;
  }
  return isSlug(slug) ? `/read/${slug}${article[2] ?? ""}` : null;
}

/**
 * **The paragraph the report was filed at** — the one thing the Earlier tab is
 * given from the stored address's query string, so its link opens the article
 * where the reader was. Greg, 2026-10-06, asked whether the link should carry
 * it: *"B whatever's simplest"*.
 * docs/plans/261006b-earlier-link-carries-the-paragraph.md.
 *
 * `?at=` is the reading position, a block id (docs/project/url-state.md), and
 * a block id is one fixed shape (`isSpideryarnId`): a value that passes cannot
 * be anybody's search terms. Everything else in the query stays behind, for the
 * reason the label has no query at all. `null` unless all of:
 *
 * - the label is an article's reading page — `at` means nothing on its
 *   `/metadata`, on the public shelf (`/read/public`, which is slug-shaped) or
 *   anywhere else;
 * - the address has an `at`, and the first one, if it is repeated, is a block id.
 *
 * Not checked against the article: an id the piece no longer has opens it at
 * the top (docs/project/block-ids.md).
 */
export function feedbackPageAt(url: string | null): string | null {
  const label = feedbackPageLabel(url);
  if (label === null || label === "/read/public" || !READING_PAGE.test(label)) return null;
  const at = webAddress(url)?.searchParams.get("at") ?? null;
  return isSpideryarnId(at) ? at : null;
}
