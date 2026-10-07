/**
 * **Is this address one of our own reading pages?** A product rule about what
 * Add will take, and nothing else.
 *
 * A reader who is sent somebody's public Spideryarn link and pastes it into
 * Add wants their own copy of the piece. Fetching `/read/<slug>` cannot give
 * them one: that address names another reader's article, not the piece it was
 * made from. So `POST /api/jobs` (src/routes.ts) refuses it, before a slot is
 * reserved, with `OWN_READING_PAGE` (src/messages.ts). Plan 261007f, E8.
 *
 * **Not a defence, and deliberately not inside one.** `normaliseUrl`
 * (src/ingest.ts) decides which addresses are safe to fetch, and the
 * sanitiser's own-origin list decides which links are ours inside an article.
 * Both are listed in docs/project/security-map.md and neither changes for
 * this. Nothing here is relied on for safety: a redirect that ends on one of
 * our pages is not caught, and does not need to be.
 *
 * Only `/read/<something>` is refused. `/help` and `/changelog` are ordinary
 * pages that happen to be ours, and a reader may add them like any other.
 */
import { PUBLIC_ORIGIN } from "./urls.js";

/** `www.spideryarn.com`, and the bare domain that redirects to it. */
const WWW_HOST = new URL(PUBLIC_ORIGIN).hostname;
const OUR_HOSTS: ReadonlySet<string> = new Set([WWW_HOST, WWW_HOST.replace(/^www\./, "")]);

export function isOwnReadingPage(address: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(address);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  /* `new URL` lower-cases the host; a trailing dot is the same host spelled in
     full, and it keeps that. */
  const host = parsed.hostname.replace(/\.$/, "");
  return OUR_HOSTS.has(host) && /^\/read\/[^/]/.test(parsed.pathname);
}
