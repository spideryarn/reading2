/**
 * **A gift voucher's starter article, resolved for its email** — which of the
 * administrator's own articles, its title, and the address the email links:
 * the plain public one, or the private link with its key on.
 * docs/plans/261007j-gift-voucher-starter-article-by-private-link.md.
 *
 * Asked by `createVoucher` for a new voucher and by `updateVoucher` for a real
 * change of address (src/store/pg-vouchers.ts), and by nothing else. Never for a
 * replayed create: that is answered from the voucher's own row, whatever has
 * happened to the article since (Sol's F2).
 *
 * ## As the administrator, through the owner's own reads
 *
 * Every read here is scoped by `ownedSlug`, so it is asked as whoever the
 * request is for — `serveAuthenticatedApi` sets that before the admin gate. An
 * article that is somebody else's is the same answer as one that does not
 * exist, as it is everywhere else.
 *
 * ## The key is read, never made
 *
 * A private article's key comes from `pgShareLinkStore.read`, the owner's
 * read and still the one statement in `src/` that selects `share_token`. This
 * file is its second caller (tests/share-link-token-stays-home.test.ts pins
 * the list). A private article whose link is off is refused, so the
 * administrator makes the link on the article's own card, after its rights
 * tick-box; nothing here mints one. The address it builds goes into the gift
 * email and nowhere else: not a log line, not an error, not the voucher's row.
 */

import { getDb } from "../db/client.js";
import { articles } from "../db/schema.js";
import { parseShareKey, withShareKey } from "../share-key.js";
import { articleUrl } from "../urls.js";
import { ownedSlug } from "./owned-slug.js";
import { pgArticleReader } from "./pg.js";
import { pgShareLinkStore } from "./pg-share-link.js";
import type { GiftStarter } from "./pg-voucher-emails.js";

/** The starter as a voucher stores it and its email links it. */
export interface Starter extends GiftStarter {
  readonly articleId: string;
  readonly slug: string;
}

/**
 * What a slug came to. Each refusal is a state of the article that the
 * administrator can see and change, and the route says which in a sentence.
 *
 * - `absent`: no article of theirs has that slug — none at all, or somebody
 *   else's, or deleted.
 * - `unpublished`: nothing to read yet — still being added, or a paper with
 *   only its title and abstract (`minimal`), which a private link refuses too.
 * - `link-off`: private, with no private link.
 */
export type StarterResolution =
  | { readonly kind: "ready"; readonly starter: Starter }
  | { readonly kind: "absent" }
  | { readonly kind: "unpublished" }
  | { readonly kind: "link-off" };

/** The `status` the owner's reads give a slug that is not theirs, or not there. */
function isAbsence(err: unknown): boolean {
  return (err as { status?: unknown } | null | undefined)?.status === 404;
}

/**
 * **Resolve one slug, as the current owner.** Throws only on a database error,
 * which the caller lets fail its request: an email sent without the starter
 * because a read failed would look exactly like one that meant to.
 *
 * Three reads, none locked. The article can change between them; each later
 * read that finds it gone answers `absent`, which is what it then is.
 */
export async function resolveStarter(slug: string): Promise<StarterResolution> {
  /* Named columns: this is a row with a key on it, and the key is not one of
     them. The title and the key each come from the read that owns them. */
  const [row] = await getDb()
    .select({
      id: articles.id,
      visibility: articles.visibility,
      processing: articles.processing,
      currentRevisionId: articles.currentRevisionId,
    })
    .from(articles)
    .where(ownedSlug(slug))
    .limit(1);
  if (!row) return { kind: "absent" };
  if (row.currentRevisionId === null || row.processing === "minimal") return { kind: "unpublished" };

  try {
    /* The revision's own title, never the owner's rename: this goes to a
       stranger, who will see the author's title on the page it opens. */
    const { title } = await pgArticleReader.loadArticleIdentity(slug);
    const url = await addressOf(slug, row.visibility === "public");
    if (url === null) return { kind: "link-off" };
    return { kind: "ready", starter: { articleId: row.id, slug, title, url } };
  } catch (err) {
    if (isAbsence(err)) return { kind: "absent" };
    throw err;
  }
}

/**
 * The address the email links, or null when a private article has no link. A
 * public article needs no key and its key is not read: it opens without one,
 * and turning sharing off later should close the page, not leave a key behind
 * in somebody's inbox.
 */
async function addressOf(slug: string, isPublic: boolean): Promise<string | null> {
  const page = articleUrl(slug);
  if (isPublic) return page;
  const link = await pgShareLinkStore.read(slug);
  if (!link.on) return null;
  /* A stored key always has the shape (the CHECK `articles_share_token_shape`);
     one that somehow did not is treated as no link, the closed direction. */
  const key = parseShareKey(link.key);
  return key === null ? null : withShareKey(page, key);
}
