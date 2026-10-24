/**
 * **An author gift as `/admin/vouchers` sees it** — the wire contract between
 * the routes under `/api/admin/author-gifts` (src/store/pg-author-gifts.ts
 * builds it) and the page that draws it.
 * docs/plans/261010c-author-gift-draft-voucher-from-the-add-page.md.
 *
 * A flat module, for src/admin-vouchers.ts's reason: the browser may not
 * import from src/store/, even a type (tests/client-imports.test.ts), and two
 * hand-kept copies of one shape are two places to disagree. Its one import is
 * a type from that module, which is on the same list. Admin-only: it carries
 * the notes and the addresses.
 */

import type { StarterOwner } from "./admin-vouchers.js";

/**
 * **Where a gift has got to — derived, never stored** (D1). `sending` is
 * frozen with no voucher yet: a *Send* that died part-way, which pressing
 * *Send* again finishes.
 */
export type AuthorGiftStatus = "draft" | "sending" | "sent" | "discarded";

/** What one lookup came to. Null while it is pending. */
export type AuthorLookupOutcome = "address" | "author" | "nothing" | "failed";

/** The longest the notes may be, in code points (D6). The table's CHECK is a far higher ceiling. */
export const AUTHOR_GIFT_NOTES_MAX = 20_000;

/** The longest guidance for the lookup's message, in code points (plan 261024f § D4). The table's CHECK is a far higher ceiling. */
export const AUTHOR_GIFT_GUIDANCE_MAX = 4_000;

/** A lookup unfinished this long is `failed / stale`, and a new one may start (D4). */
export const AUTHOR_LOOKUP_STALE_MINUTES = 5;

/** How many free articles a new gift carries until somebody changes it. The column's default. */
export const AUTHOR_GIFT_DEFAULT_ARTICLES = 20;

/**
 * **What a lookup cost, from the ledger** — every `ai_calls` row with its
 * `run_id` (D5). `unpricedCalls` above zero means the figure is a floor: some
 * call has not said what it cost.
 */
export interface AuthorLookupCost {
  /** Nano-dollars: 1e-9 USD. Whole numbers, so nothing is lost to floats on the wire. */
  readonly nanos: number;
  readonly calls: number;
  readonly unpricedCalls: number;
}

/** One lookup run, as the gift's row lists it. */
export interface AdminAuthorLookup {
  readonly id: string;
  readonly createdAt: string;
  readonly finishedAt: string | null;
  readonly outcome: AuthorLookupOutcome | null;
  /** A reason — a status code, an error name, `stale` — never the provider's prose. */
  readonly failure: string | null;
  readonly authorName: string | null;
  readonly authorSourceUrl: string | null;
  /** An address seen in a result or the article. Whether it was applied is `AdminAuthorGift.emailLookupId`. */
  readonly email: string | null;
  readonly emailSourceUrl: string | null;
  /** An address the model gave that no result showed: *suggested, not seen*. Never applied. */
  readonly suggestedEmail: string | null;
  readonly contactUrl: string | null;
  /** How many searches the provider says ran. */
  readonly searches: number | null;
  readonly model: string | null;
  /**
   * The model's suggested message, whole: shown under the email with *Use as
   * your message*, and never in the email until Greg saves it there (plan
   * 261024f, R1). Null when there was none.
   */
  readonly suggestedMessage: string | null;
  /** Null until the run claimed the row and could spend. */
  readonly cost: AuthorLookupCost | null;
}

/** One gift, as `/admin/vouchers`' *Author gifts* draws it. */
export interface AdminAuthorGift {
  readonly id: string;
  readonly status: AuthorGiftStatus;
  /**
   * The article, by the slug frozen at create, and its current title; null once
   * deleted. `linkable`: public, or its private link on, so *Send* can link it
   * as it is. False on an agent's draft of a private article with no link,
   * whose *Send* makes the link behind the rights tick (plan 261010r § D2).
   *
   * `owner`: whose it is now, once the gift's voucher is claimed (plan
   * 261011n § D3, `StarterOwner` in src/admin-vouchers.ts). The title stays
   * when it has moved: it was the administrator's own article, and they gave it.
   */
  readonly starter: {
    readonly slug: string;
    readonly title: string | null;
    readonly linkable: boolean;
    readonly owner: StarterOwner | null;
  };
  readonly email: string | null;
  readonly recipientName: string | null;
  readonly recipientNote: string | null;
  readonly articles: number;
  readonly notes: string | null;
  readonly notesUpdatedAt: string | null;
  /** The lookup that supplied the current address; null when typed, or edited since. */
  readonly emailLookupId: string | null;
  /** The lookup that supplied the current name; null when typed, or edited since. */
  readonly nameLookupId: string | null;
  readonly createdAt: string;
  readonly createdBy: string;
  readonly updatedAt: string;
  readonly sendStartedAt: string | null;
  readonly discardedAt: string | null;
  /** The voucher's id once it exists (`sent`); null before. */
  readonly voucherId: string | null;
  /**
   * Whether the article is on High-powered AI (`high_power_since` set), for the
   * draft card's line and its *Switch on* (plan 261021j § D4). False once the
   * article is deleted. Says nothing about which model made what is already
   * made.
   */
  readonly highPower: boolean;
  /** Newest first. */
  readonly lookups: readonly AdminAuthorLookup[];
}

/**
 * What `POST /api/admin/author-gifts` answers (R2-F2): `202` with
 * `created: true` and the first lookup's id for a new gift; `201` with
 * `lookupId: null` for a new gift made with `lookup: false` (261010i); `200`
 * with `created: false` for one that already existed, whose link, lookups and
 * fields it did not touch.
 */
export type AuthorGiftEnsured =
  | { readonly id: string; readonly status: AuthorGiftStatus; readonly created: true; readonly lookupId: string | null }
  | { readonly id: string; readonly status: AuthorGiftStatus; readonly created: false };

/**
 * What `PATCH /api/admin/author-gifts/:id` answers with its `200`: the notes'
 * stamp after the write. A replace carries the stamp its writer last saw as
 * `notesBase`, and a stale one is a `409` (Sol's C7).
 */
export interface AuthorGiftPatched {
  readonly ok: true;
  readonly notesUpdatedAt: string | null;
}

/**
 * What `POST /api/admin/author-gifts/:id/high-power` answers with its `200`:
 * the article is on, and how many main-mode jobs this press queued — zero when
 * every one was already waiting (plan 261021j § D4).
 */
export interface AuthorGiftHighPowered {
  readonly highPower: true;
  readonly queued: number;
}

/** What `POST /api/admin/author-gifts/:id/lookups` answers with its `202`. */
export interface AuthorLookupStarted {
  readonly lookupId: string;
}

/**
 * **What the *Send* confirmation showed** — the body of `POST
 * /api/admin/author-gifts/:id/send`, `{ expected }` (261010i, Sol's F1): the
 * voucher's fields exactly as the list gave them. *Send* goes ahead only while
 * the gift still holds these, so an edit landing after the page drew it (an
 * agent's, through MCP) is a `409`, not an email to an address nobody read.
 */
export interface AuthorGiftSendExpected {
  readonly email: string;
  readonly recipientName: string | null;
  readonly recipientNote: string | null;
  readonly articles: number;
}

/**
 * What `POST /api/admin/author-gifts/:id/send` answers: `201` with `queued`
 * when this press made the voucher, `200` with `replayed` when it already
 * existed. The voucher list has the rest.
 */
export interface AuthorGiftSent {
  readonly voucherId: string;
  readonly email: "queued" | "replayed";
}

/**
 * **The email a draft would send, if sent now** — `GET
 * /api/admin/author-gifts/:id/email` (plan 261024f § D2, R2, R3). Rendered by
 * the same function Send uses, with the private link's address replaced by
 * `STARTER_LINK_PLACEHOLDER`: the page never holds the key. The plain-text part
 * only; the HTML is the same words in the same order. `to` is null while the
 * draft has no address. `audience` says which middle the body has, which can
 * change by Send if the address signs up in between.
 */
export interface AuthorGiftEmailPreview {
  readonly from: string;
  readonly to: string | null;
  readonly subject: string;
  readonly text: string;
  readonly audience: "invite" | "reader";
}

/** What the preview shows where the email will carry the article's address, key and all. */
export const STARTER_LINK_PLACEHOLDER = "[the private link to this article]";

/**
 * **Greg's guidance for the lookup's suggested message** — `GET` and `PUT
 * /api/admin/author-gift-guidance` (plan 261024f § D4, R5). `guidance` is his
 * text, or null while the built-in text is in force; `builtIn` is that text;
 * `fixedPrompt` is the rest of the prompt, read-only, with a marker where the
 * guidance goes. `updatedAt` is when the row in force was saved, null when none
 * ever was.
 */
export interface AuthorGiftGuidance {
  readonly guidance: string | null;
  readonly builtIn: string;
  readonly fixedPrompt: string;
  readonly updatedAt: string | null;
}

/**
 * **The address of one gift on `/admin/vouchers`** — the page opens with that
 * card highlighted and scrolled to (plan 261011n § D1). What MCP's
 * `draft_author_gift` answers, so a harness can open the draft for the admin.
 * The id is an opaque UUID behind the admin gate, so the address grants
 * nothing.
 */
export const AUTHOR_GIFT_PARAM = "gift";

export function authorGiftPath(id: string): string {
  return `/admin/vouchers?${AUTHOR_GIFT_PARAM}=${encodeURIComponent(id)}`;
}
