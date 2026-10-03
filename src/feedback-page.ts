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
 * - the path only — no origin, no query string, no fragment;
 * - **only a path the router recognises.** A signed-in reader can file a report
 *   from any address at all — a mistyped one, a pasted one — and the route
 *   accepts any `http(s)` origin, so an unrecognised path is somebody's
 *   arbitrary text and is `null` (GPT Sol's plan review, P1). `parseRoute` is
 *   the app's own answer to "is this one of our pages", so there is no second
 *   list here to drift from it;
 * - an import is just `/add`, since what follows is a third party's address or
 *   an upload's id;
 * - no length cap, because none is reachable: every recognised path is a
 *   fixed word or two, or holds a slug of at most 60 characters;
 * - `null` when there is no address, or it is not an `http(s)` one.
 *
 * **What it does still carry, knowingly:** an article's slug, in `/read/<slug>`.
 * A slug is made from the source's title or file name, it is validated
 * (`isSlug`), and it is the one name for the article the reader already sees in
 * their own address bar and shelf.
 */
import { parseRoute } from "./web/router.js";

export function feedbackPageLabel(url: string | null): string | null {
  if (url === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  const path = parsed.pathname;
  const route = parseRoute(path);
  switch (route.kind) {
    case "not-found":
      return null;
    case "add":
    case "add-upload":
      return "/add";
    default:
      return path;
  }
}
