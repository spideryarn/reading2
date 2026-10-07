/**
 * **The emails a gift voucher sends** — one to its recipient when it is made
 * (and again when its address really changes), one to its creator when it is
 * claimed. docs/plans/261001p-voucher-emails-to-recipient-and-creator.md, and
 * the table `billing_voucher_emails` in src/db/schema.ts.
 *
 * ## The shape: an outbox, sent at most once
 *
 * 1. **Queue**, inside the event's own transaction (the voucher insert, the
 *    claim's `UPDATE … RETURNING`, the address change). The provider request is
 *    rendered and frozen there: subject, text, HTML, and for a gift the
 *    recipient. So the event and its email commit together, and nothing about
 *    sending happens inside that transaction.
 * 2. **Reserve**, after the response: one `UPDATE … SET status = 'sending',
 *    attempts = attempts + 1, attempt_started_at = now() … RETURNING attempts`,
 *    so of any number of contenders exactly one wins. The automatic send may
 *    reserve only a `queued` row, and does **not** look at the voucher's live
 *    state: an event that committed keeps its email (event-time eligibility).
 *    Revoking is what cancels, by moving queued gifts to `skipped` in the
 *    revoke's own transaction (`skipQueuedGifts`).
 * 3. **Send** the stored request with `Idempotency-Key: voucher-email/<id>`.
 *    Resend answers a repeat of the same key and body with the first result for
 *    24 hours, so retrying a send it did accept does not send it twice.
 * 4. **Complete**: `WHERE id = $1 AND status = 'sending' AND attempts = <mine>`,
 *    so an attempt that lost its lease cannot overwrite the one that took it.
 *
 * A **Retry** (the admin's button) may reserve a `queued`, `failed` or
 * `skipped` row, or a `sending` one whose lease is more than ten minutes old —
 * never a `sent` one — and, for a gift, only while its voucher is unrevoked
 * and still at that address (claimed or not: see `RETRYABLE`). That is `RETRYABLE`, one SQL fragment,
 * and the list's `retryable` flag is the same fragment, so the page and the
 * route cannot disagree.
 *
 * ## What may fail, and what that leaves
 *
 * Everything after the event — reserve, the creator lookup, the send, complete
 * — is caught here and logged with a label and the delivery id, never an
 * address, a body, the note, the recipient's name or a starter's link, which
 * may carry a private link's key (a database error's message can quote a query's
 * parameters, so only its `name` is logged). It never throws to its caller. A
 * failure leaves `queued` (never reserved) or `sending` (never completed), and
 * both can be retried.
 *
 * ## Lock order
 *
 * **Voucher, then delivery**, everywhere: the claim and the revoke lock the
 * voucher and then write its deliveries. Nothing here locks a delivery and then
 * its voucher — a reservation's `UPDATE … FROM billing_vouchers` reads the
 * voucher without locking it.
 */

import { and, eq, isNull, sql } from "drizzle-orm";

import {
  type VoucherEmailState,
  type VoucherEmailStatus,
  type VoucherEmails,
  cleanRecipientName,
  freeArticles,
  giftEmailGreeting,
  giftEmailHeading,
  giftEmailStarterLine,
  giftEmailSubject,
} from "../admin-vouchers.js";
import { type Articles, type Points, articles as toArticles, budgetFor, ingestHeadroom } from "../billing/points.js";
import { FREE_LIFETIME_INGESTS } from "../billing/tiers.js";
import { getDb } from "../db/client.js";
import { billingVoucherEmails, billingVouchers } from "../db/schema.js";
import { type EmailDeps, type SendResult, noteText, oneLine, sendEmail } from "../email.js";
import { log } from "../log.js";
import { ADMIN_VOUCHERS_URL, PUBLIC_ORIGIN } from "../urls.js";
import { type AccountEmail, accountEmail } from "./admin-accounts.js";

const logger = log("store");

export type VoucherEmailKind = "gift" | "claimed";

/**
 * The longest `detail` we keep. The table's CHECK is a ceiling far above it
 * that only catches a runaway (docs/project/sql.md § "Except a size limit").
 */
const DETAIL_MAX = 200;

/** The idempotency key Resend is given. One per delivery, never per attempt. */
export function idempotencyKeyFor(deliveryId: string): string {
  return `voucher-email/${deliveryId}`;
}

/** A database error's name and nothing else: its message can quote a parameter. */
function errorName(err: unknown): string {
  return err instanceof Error ? err.name : "unknown error";
}

/* ------------------------------------------------------------ messages -- */

const LOGIN_URL = `${PUBLIC_ORIGIN}/login`;
const HOME_URL = `${PUBLIC_ORIGIN}/`;
const SMALL_NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

/** `the three articles every free account starts with`, from the constant. */
function freeAllowanceClause(): string {
  const n: number = FREE_LIFETIME_INGESTS;
  const word = SMALL_NUMBERS[n] ?? String(n);
  return `the ${word} article${n === 1 ? "" : "s"} every free account starts with`;
}

export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
}

/**
 * **Who the recipient's email is written for**, decided before the event's
 * transaction (`giftAudienceFor` in src/store/pg-vouchers.ts) and frozen with
 * the rest of the email. docs/plans/261002a-fb99-voucher-email-for-existing-user.md.
 *
 * `invite` is anyone we cannot name as one existing reader — no account, an
 * unconfirmed one, two of them, or a lookup that failed — and its wording
 * (*sign in, or create an account*) is true for a reader too, which is why it is
 * the answer to any doubt. `reader` is exactly one account whose confirmed
 * address is the voucher's, with its plan as of now.
 */
export type GiftAudience =
  | { readonly kind: "invite" }
  | { readonly kind: "reader"; readonly plan: ReaderStanding };

/**
 * A reader's plan, as the existing-reader email needs it. `free` carries the
 * raw inputs to the wall's own arithmetic, not a count, so the email's *before*
 * and *after* are `ingestHeadroom` over the same `wallUsed` against the budget
 * without and with the gift — what the wall will actually admit. `waiting` is
 * the other gifts at this address not yet claimed, which the next visit claims
 * together with this one, so *after* includes them.
 */
export type ReaderStanding =
  | { readonly kind: "free"; readonly limit: Articles; readonly wallUsed: Points; readonly waiting: Articles }
  | { readonly kind: "paid" }
  | { readonly kind: "unknown" };

const INVITE: GiftAudience = { kind: "invite" };

/** `3 articles`, `1 article`. */
function articlesCount(n: number): string {
  return `${n} article${n === 1 ? "" : "s"}`;
}

/**
 * **Somebody else's text, made safe for the HTML part** — the note to the
 * recipient (plan 261002b), which an administrator wrote and a stranger's mail
 * client draws. Every character that could open markup or close an attribute
 * is an entity; newlines become `<br>`, and nothing else of it is markup. So a
 * `<a href>` in a note arrives as the visible text of a tag, never a link.
 */
function escapeNoteHtml(note: string): string {
  return note
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\r\n?/g, "\n")
    .replace(/\n/g, "<br>");
}

/**
 * The note, as an italic quoted block under the heading, or nothing at all.
 * Unlabelled: Greg signs it himself — Greg, 2026-10-02: *"Maybe just italicise
 * the note from me"* — and /admin/vouchers reminds him to.
 */
function noteRow(note: string | null): string {
  if (note === null) return "";
  return (
    `<tr><td style="padding:0 0 20px 0;"><table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>` +
    `<td style="font-size:16px;line-height:1.6;color:#f5f5f5;font-style:italic;border-left:3px solid #DB8A45;padding:2px 0 2px 14px;">` +
    `<em>${escapeNoteHtml(note)}</em></td></tr></table></td></tr>\n`
  );
}

/**
 * *Dear Ada,* as its own plain row between the heading and the note, or
 * nothing at all. The name is somebody else's text, escaped here as the note
 * is. Plan 261007f.
 */
function greetingRow(name: string | null): string {
  if (name === null) return "";
  return `<tr><td style="font-size:16px;line-height:1.6;padding:0 0 16px 0;">${escapeNoteHtml(giftEmailGreeting(name))}</td></tr>\n`;
}

/**
 * **The starter article, as the email links it** (plan 261007j): its title,
 * which is the author's text, and its address — the plain public one, or the
 * private link with its key on, which is why this is rendered here and kept in
 * the one email and nowhere else. Resolved by src/store/voucher-starter.ts.
 */
export interface GiftStarter {
  readonly title: string;
  readonly url: string;
}

/**
 * **What the administrator chose for the recipient**: their name, the note to
 * them, and the article to start with. One named object rather than adjacent
 * `string | null` arguments, which could be swapped without a type error
 * (261007f, Sol's F9).
 */
export interface GiftWords {
  /** Their name, raw; null for no greeting. */
  readonly recipientName: string | null;
  /** The note to them, raw; null for none. */
  readonly recipientNote: string | null;
  /**
   * The starter article; absent or null for none, and then the email is byte
   * for byte what it was before starters existed. Optional so that the golden
   * assertions from 261007f, which predate it, still say exactly that.
   */
  readonly starter?: GiftStarter | null;
}

const NO_WORDS: GiftWords = { recipientName: null, recipientNote: null };

/** The orange button, for the email's own action and for the starter's link. */
function buttonHtml(button: { readonly label: string; readonly url: string }): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr><td bgcolor="#DB8A45" style="background-color:#DB8A45;border-radius:6px;padding:12px 24px;"><a href="${button.url}" style="color:#0a0a0a;font-size:16px;font-weight:600;text-decoration:none;display:inline-block;">${button.label}</a></td></tr></table>`;
}

/**
 * The starter's line and its *Read it* button, between the note and our own
 * words, or nothing at all. The title is the author's text and the address
 * carries a key: both escaped here, though neither should need it — an address
 * we built has no quote or ampersand in it today. Plan 261007j.
 */
function starterRows(starter: SaidStarter | null): string {
  if (starter === null) return "";
  return (
    `<tr><td style="font-size:16px;line-height:1.6;padding:0 0 12px 0;">${escapeNoteHtml(starter.line)}</td></tr>\n` +
    `<tr><td style="padding:0 0 24px 0;">${buttonHtml({ label: "Read it", url: escapeNoteHtml(starter.url) })}</td></tr>\n`
  );
}

/**
 * One email in the shape of supabase/templates/confirmation.html. Every value
 * interpolated is ours, **except `name`, `note` and `starter`**, which are
 * escaped here, at the one place they meet markup.
 */
function giftHtml(parts: {
  readonly subject: string;
  readonly heading: string;
  /** Their name, cleaned to one line and otherwise raw; null for none. */
  readonly name: string | null;
  /** The note to the recipient, raw; null for none. */
  readonly note: string | null;
  /** The starter article's line and address, cleaned and otherwise raw; null for none. */
  readonly starter: SaidStarter | null;
  readonly paragraphs: readonly string[];
  readonly button: { readonly label: string; readonly url: string };
  readonly after: string;
}): string {
  const paragraphs = parts.paragraphs.map(
    (p, i) =>
      `<tr><td style="font-size:16px;line-height:1.6;padding:0 0 ${i === parts.paragraphs.length - 1 ? 28 : 16}px 0;">${p}</td></tr>`,
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark">
<meta name="supported-color-schemes" content="dark">
<title>${parts.subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#0a0a0a;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#0a0a0a" style="background-color:#0a0a0a;">
<tr><td align="center" style="padding:40px 16px;">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:480px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#e5e5e5;">
<tr><td style="padding:0 0 32px 0;">
<img src="${PUBLIC_ORIGIN}/apple-touch-icon.png" width="32" height="32" alt="" style="display:inline-block;vertical-align:middle;border:0;">
<span style="display:inline-block;vertical-align:middle;margin-left:10px;font-family:Georgia,'Times New Roman',serif;font-size:22px;color:#DB8A45;">Spideryarn</span>
</td></tr>
<tr><td style="font-size:22px;line-height:1.3;font-weight:600;color:#f5f5f5;padding:0 0 16px 0;">${parts.heading}</td></tr>
${greetingRow(parts.name)}${noteRow(parts.note)}${starterRows(parts.starter)}${paragraphs.join("\n")}
<tr><td style="padding:0 0 28px 0;">
${buttonHtml(parts.button)}
</td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:#a3a3a3;padding:0 0 28px 0;">${parts.after}</td></tr>
<tr><td style="font-size:13px;line-height:1.6;color:#a3a3a3;border-top:1px solid #262626;padding:20px 0 0 0;">Spideryarn helps you read deeply and efficiently. Questions? Reply to this email, or write to <a href="mailto:hello@spideryarn.com" style="color:#a3a3a3;">hello@spideryarn.com</a>.</td></tr>
</table>
</td></tr>
</table>
</body>
</html>
`;
}

const FOOTER_TEXT =
  "Spideryarn helps you read deeply and efficiently. Questions? Reply to this email, or write to hello@spideryarn.com.";

/**
 * **The recipient's email.** The values in it are `articles`, an integer the
 * route validated, for an existing reader two counts we computed, and the two
 * values that are not ours: `recipientName`, which opens it as *Dear <name>,*
 * (plan 261007f), and `recipientNote`, the administrator's note *to them*
 * (plan 261002b). Both are escaped where they meet the HTML
 * (`escapeNoteHtml`). They go directly under the heading, the greeting first,
 * above anything we wrote, in both audiences, and never in the subject.
 *
 * **And the starter article** (plan 261007j), after the note and before our own
 * words: one line naming it, and its address — on a line of its own in the
 * text, behind a *Read it* button in the HTML. Its title is the author's text,
 * treated as the name is. Its address may carry a private link's key, so it is
 * never logged, never in the subject, and this rendered email is the one copy
 * of ours (tests/voucher-starter.test.ts).
 *
 * **Never the private note, the creator or the voucher id** —
 * tests/billing-voucher-emails.test.ts pins that, for both audiences. With
 * none of the three, the email is byte for byte what it was before any existed.
 */
export function giftMessage(
  articles: number,
  audience: GiftAudience = INVITE,
  words: GiftWords = NO_WORDS,
): RenderedEmail {
  if (!Number.isInteger(articles) || articles < 1) throw new Error("a gift message needs a whole number of articles");
  /* Cleaned again here as well as on the way in: this is where they meet the
     mail, and a row written before the rule, or by hand, gets the same rule. */
  const cleanedNote = words.recipientNote === null ? "" : noteText(words.recipientNote);
  const said: Said = {
    name: cleanRecipientName(words.recipientName),
    note: cleanedNote === "" ? null : cleanedNote,
    starter: words.starter ? { line: starterLine(words.starter.title), url: words.starter.url } : null,
  };
  return audience.kind === "reader"
    ? readerGiftMessage(articles, audience.plan, said)
    : inviteGiftMessage(articles, said);
}

/** The starter once its title is cleaned: the sentence, and where it points. */
interface SaidStarter {
  readonly line: string;
  readonly url: string;
}

/** `GiftWords` once cleaned: what the two letters below are written from. */
interface Said {
  readonly name: string | null;
  readonly note: string | null;
  readonly starter: SaidStarter | null;
}

/** Formatting that could reorder the sentence around a title: dropped, as a name's is. */
const BIDI_CONTROLS = /\p{Bidi_Control}/gu;

/**
 * **The starter's sentence, from the author's title**: one line (`oneLine`, so
 * a line break in a title cannot draw a line of its own, and a very long one is
 * cut with an ellipsis), with bidi controls gone. A title that cleans to
 * nothing says *an article* rather than an empty pair of quotes.
 */
function starterLine(title: string): string {
  const flat = oneLine(title.replace(BIDI_CONTROLS, " "), 200);
  return flat === "" ? "Here is an article in Spideryarn, to start with:" : giftEmailStarterLine(flat);
}

/**
 * The text part's greeting, note and starter, each on its own lines between
 * the heading and the intro, or nothing. The starter's address goes on the line
 * under its sentence, so a mail client makes it a link by itself.
 */
function saidLines(said: Said): string[] {
  return [
    ...(said.name === null ? [] : [giftEmailGreeting(said.name), ""]),
    ...(said.note === null ? [] : [said.note, ""]),
    ...(said.starter === null ? [] : [said.starter.line, said.starter.url, ""]),
  ];
}

/** To somebody who may not know Spideryarn: what it is, and how to collect. */
function inviteGiftMessage(articles: number, said: Said): RenderedEmail {
  const gift = freeArticles(articles);
  const subject = giftEmailSubject(articles);
  const intro = `You have been given ${gift} on Spideryarn, for this email address. Spideryarn is a reading tool: add an article or a paper, and it helps you read it deeply and efficiently. It highlights, annotates and explains, but keeps you in the text itself.`;
  const how =
    "Sign in, or create an account, with this same address. The articles are added to your free allowance when you do, with no code to type in.";
  const after = `They come on top of ${freeAllowanceClause()}. If you use Continue with Google, choose the Google account for this address. If you were not expecting this, you can ignore this email.`;
  const text = [
    giftEmailHeading(articles),
    "",
    ...saidLines(said),
    intro,
    "",
    how,
    "",
    `Sign in or create an account: ${LOGIN_URL}`,
    "",
    after,
    "",
    "--",
    FOOTER_TEXT,
  ].join("\n");
  const html = giftHtml({
    subject,
    heading: giftEmailHeading(articles),
    name: said.name,
    note: said.note,
    starter: said.starter,
    paragraphs: [intro, how],
    button: { label: "Sign in or create an account", url: LOGIN_URL },
    after,
  });
  return { subject, text, html };
}

/**
 * To somebody who already reads here: how many articles they had left, and how
 * many they have with the gift — or, on a paid plan, that it waits for Free
 * (billing.md: a gift counts on Free only).
 */
function readerGiftMessage(articles: number, plan: ReaderStanding, said: Said): RenderedEmail {
  const gift = freeArticles(articles);
  const subject = giftEmailSubject(articles);
  const intro = `You have been given ${gift} on Spideryarn, for your account with this address.`;
  let standing: string | null;
  switch (plan.kind) {
    case "free": {
      const before = ingestHeadroom(plan.wallUsed, budgetFor(plan.limit));
      const after = ingestHeadroom(plan.wallUsed, budgetFor(toArticles(plan.limit + plan.waiting + articles)));
      const also = plan.waiting > 0 ? `, and ${articlesCount(plan.waiting)} given to you earlier and still waiting` : "";
      standing = `Before this gift you had ${articlesCount(before)} left on your free allowance. With it${also}, you have ${articlesCount(after)}.`;
      break;
    }
    case "paid":
      standing =
        "You are on a paid plan, so you do not need them today. They stay on your account, and count whenever you are on the Free plan.";
      break;
    case "unknown":
      standing = null;
      break;
    default: {
      const never: never = plan;
      throw new Error(`unknown reader standing ${String(never)}`);
    }
  }
  const how = "They are added the next time you open Spideryarn while signed in, with nothing to type in.";
  const after = "If you were not expecting this, you can ignore this email.";
  const paragraphs = standing === null ? [intro, how] : [intro, standing, how];
  const text = [
    giftEmailHeading(articles),
    "",
    ...saidLines(said),
    ...paragraphs.flatMap((p) => [p, ""]),
    `Open Spideryarn: ${HOME_URL}`,
    "",
    after,
    "",
    "--",
    FOOTER_TEXT,
  ].join("\n");
  const html = giftHtml({
    subject,
    heading: giftEmailHeading(articles),
    name: said.name,
    note: said.note,
    starter: said.starter,
    paragraphs,
    button: { label: "Open Spideryarn", url: HOME_URL },
    after,
  });
  return { subject, text, html };
}

/** The facts a claim notice is rendered from, all from the claim's own `UPDATE … RETURNING`. */
export interface ClaimFacts {
  /** The voucher's address, which the claim just matched to the claimant's confirmed one. */
  readonly claimantEmail: string;
  readonly ownerId: string;
  readonly articles: number;
  readonly createdAt: Date;
  readonly claimedAt: Date;
}

/** `2026-10-01 17:42 UTC`. */
function utcMinute(at: Date): string {
  const iso = at.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/**
 * **The creator's notice**, plain text in `arrivalMessage`'s shape. **Not the
 * note, and not the recipient's name** (Sol F7): it would be one more copy in Resend, the forwarder and an
 * inbox, and the page already has it. The claimant's address is somebody else's
 * text, so it goes through `oneLine` and never into the subject.
 */
export function claimedMessage(facts: ClaimFacts): RenderedEmail {
  return {
    subject: `Gift voucher claimed: ${facts.articles} article${facts.articles === 1 ? "" : "s"}`,
    text: [
      "A gift voucher has been claimed.",
      "",
      `Email: ${oneLine(facts.claimantEmail)}`,
      `Account id: ${facts.ownerId}`,
      `Claimed: ${utcMinute(facts.claimedAt)}`,
      "",
      `Articles: ${facts.articles}`,
      `Created: ${utcMinute(facts.createdAt)}`,
      "",
      `All vouchers: ${ADMIN_VOUCHERS_URL}`,
    ].join("\n"),
  };
}

/* --------------------------------------------------------------- queue -- */

/** The transaction the event is already inside. */
type Tx = Pick<ReturnType<typeof getDb>, "insert" | "update">;

/**
 * **Queue the recipient's email, in the event's transaction.** `recipient` is
 * the normalised address the voucher has as of this event; it is frozen here.
 * Returns the delivery id, which the caller hands to `afterResponse` **after**
 * its transaction has committed.
 */
export async function queueGiftEmail(
  tx: Tx,
  voucherId: string,
  recipient: string,
  articles: number,
  audience: GiftAudience,
  /** Their name and the administrator's note to them, frozen into the email here. */
  words: GiftWords,
): Promise<string> {
  const message = giftMessage(articles, audience, words);
  const [row] = await tx
    .insert(billingVoucherEmails)
    .values({
      voucherId,
      kind: "gift",
      recipient,
      subject: message.subject,
      bodyText: message.text,
      bodyHtml: message.html ?? null,
    })
    .returning({ id: billingVoucherEmails.id });
  if (!row) throw new Error("queueing a gift voucher email returned no row");
  return row.id;
}

/**
 * **Queue the creator's notice, in the claim's transaction.** The recipient is
 * left null: it is the creator's address, which only the Auth service knows,
 * and that is a network call that does not belong inside a transaction. The
 * first successful lookup freezes it (`deliverReservedVoucherEmail`).
 *
 * `null` if this voucher already has its notice — which nothing should make
 * possible, since a voucher is claimed once, and which must not fail the claim.
 */
export async function queueClaimedEmail(tx: Tx, voucherId: string, facts: ClaimFacts): Promise<string | null> {
  const message = claimedMessage(facts);
  const [row] = await tx
    .insert(billingVoucherEmails)
    .values({ voucherId, kind: "claimed", subject: message.subject, bodyText: message.text, bodyHtml: null })
    .onConflictDoNothing({ target: billingVoucherEmails.voucherId, where: sql`kind = 'claimed'` })
    .returning({ id: billingVoucherEmails.id });
  return row?.id ?? null;
}

/**
 * **Cancel the gift emails that have not started**, in the transaction that
 * revokes the voucher (or readdresses it — an email still waiting for the old
 * address should not go). A `sending` row is already with Resend and is left
 * to finish.
 */
export async function skipQueuedGifts(tx: Tx, voucherId: string, detail: "voucher revoked" | "address changed"): Promise<void> {
  await tx
    .update(billingVoucherEmails)
    .set({ status: "skipped", detail, updatedAt: sql`now()` })
    .where(
      and(
        eq(billingVoucherEmails.voucherId, voucherId),
        eq(billingVoucherEmails.kind, "gift"),
        eq(billingVoucherEmails.status, "queued"),
      ),
    );
}

/* -------------------------------------------------------------- reserve -- */

/**
 * **May the admin's Retry reserve this delivery?** One fragment, over the
 * delivery as `e` and its voucher as `v`, used by the Retry reservation and by
 * the list's `retryable` flag alike.
 *
 * Never `sent`. A `sending` row only once its lease is ten minutes old. A gift
 * only while its voucher is unrevoked and still at the address this delivery
 * was frozen with — a readdressed voucher has a newer delivery for that.
 *
 * **Claimed does not stop a gift's Retry** (261002a, Sol F1). An existing
 * reader claims within moments of opening Spideryarn, often before anybody has
 * seen a failed send; refusing then would make every failure for a reader
 * permanent. The claim moves the voucher to an account with that same confirmed
 * address, so none of the voucher transitions can redirect this email. As for
 * every frozen recipient, a later change in inbox ownership is outside this
 * predicate (docs/project/email.md § Gift voucher emails).
 */
const RETRYABLE = sql`(
  (e.status in ('queued', 'failed', 'skipped')
    or (e.status = 'sending' and e.attempt_started_at < now() - interval '10 minutes'))
  and (e.kind <> 'gift'
    or (v.revoked_at is null and v.email = e.recipient))
)`;

/** What a reservation hands the send: the attempt it now owns. `null` when it lost. */
export type Reserve = (deliveryId: string, mode: "automatic" | "retry") => Promise<number | null>;

const reserve: Reserve = async (deliveryId, mode) => {
  const may = mode === "automatic" ? sql`e.status = 'queued'` : RETRYABLE;
  const result = await getDb().execute(sql`
    update spideryarn.billing_voucher_emails e
       set status = 'sending', attempts = e.attempts + 1, attempt_started_at = now(),
           detail = null, updated_at = now()
      from spideryarn.billing_vouchers v
     where e.id = ${deliveryId} and v.id = e.voucher_id and ${may}
    returning e.attempts`);
  const row = rowsOf<{ attempts: number }>(result)[0];
  return row ? Number(row.attempts) : null;
};

export type RetryReservation =
  | { readonly kind: "reserved"; readonly attempts: number }
  | { readonly kind: "not-found" }
  /** Sent, being sent, or a gift whose voucher was since revoked or readdressed. */
  | { readonly kind: "refused" };

/**
 * **The admin's Retry, reserved inside the request** so the route can answer
 * 404 or 409 in its own words; the send itself goes after the response
 * (`deliverReservedVoucherEmail`). Throws only on a database error, which the
 * route reports as it would any other.
 */
export async function reserveVoucherEmailRetry(deliveryId: string): Promise<RetryReservation> {
  const attempts = await reserve(deliveryId, "retry");
  if (attempts !== null) return { kind: "reserved", attempts };
  const [exists] = await getDb()
    .select({ id: billingVoucherEmails.id })
    .from(billingVoucherEmails)
    .where(eq(billingVoucherEmails.id, deliveryId))
    .limit(1);
  return exists ? { kind: "refused" } : { kind: "not-found" };
}

/* ----------------------------------------------------- send and complete -- */

export interface Outcome {
  readonly status: Extract<VoucherEmailStatus, "sent" | "skipped" | "failed">;
  readonly detail: string | null;
}

export type Complete = (deliveryId: string, attempts: number, outcome: Outcome) => Promise<boolean>;

const complete: Complete = async (deliveryId, attempts, outcome) => {
  const done = await getDb()
    .update(billingVoucherEmails)
    .set({ status: outcome.status, detail: outcome.detail?.slice(0, DETAIL_MAX) ?? null, updatedAt: sql`now()` })
    .where(
      and(
        eq(billingVoucherEmails.id, deliveryId),
        eq(billingVoucherEmails.status, "sending"),
        eq(billingVoucherEmails.attempts, attempts),
      ),
    )
    .returning({ id: billingVoucherEmails.id });
  return done.length > 0;
};

/** The seams, for tests. Every default is the real thing. */
export interface VoucherEmailDeps {
  readonly email?: EmailDeps;
  /** The creator's address, for a claim notice. Defaults to the Auth Admin API. */
  readonly lookupCreator?: (ownerId: string) => Promise<AccountEmail>;
  readonly reserve?: Reserve;
  readonly complete?: Complete;
}

/** A `SendResult` as a stored outcome. The reasons never carry an address. */
function outcomeOf(result: SendResult): Outcome {
  switch (result.kind) {
    case "sent":
      return { status: "sent", detail: null };
    case "skipped":
      return { status: "skipped", detail: result.reason };
    case "failed":
      return {
        status: "failed",
        detail: result.ambiguous ? `request outcome unknown (${result.reason})` : result.reason,
      };
    default: {
      const unhandled: never = result;
      return unhandled;
    }
  }
}

/**
 * **The automatic send, after the event's response.** Reserves only a `queued`
 * row, then delivers it. **Never throws.**
 */
export async function sendQueuedVoucherEmail(deliveryId: string, deps: VoucherEmailDeps = {}): Promise<void> {
  let attempts: number | null;
  try {
    attempts = await (deps.reserve ?? reserve)(deliveryId, "automatic");
  } catch (err) {
    logger.error(
      { deliveryId, err: errorName(err) },
      "voucher email: could not reserve it — it is left queued, and Retry on /admin/vouchers can send it",
    );
    return;
  }
  /* Somebody else has it, or it is no longer queued (sent, or revoked first). */
  if (attempts === null) return;
  await deliverReservedVoucherEmail(deliveryId, attempts, deps);
}

/**
 * **Send a delivery this caller has reserved, and record what happened.**
 * Reads the frozen request from the row and nothing else — bar the voucher's
 * `created_by`, which never changes, for a claim notice's first lookup.
 * **Never throws.**
 */
export async function deliverReservedVoucherEmail(
  deliveryId: string,
  attempts: number,
  deps: VoucherEmailDeps = {},
): Promise<void> {
  const finish = deps.complete ?? complete;
  try {
    const [row] = await getDb()
      .select({
        kind: billingVoucherEmails.kind,
        status: billingVoucherEmails.status,
        attempts: billingVoucherEmails.attempts,
        recipient: billingVoucherEmails.recipient,
        subject: billingVoucherEmails.subject,
        bodyText: billingVoucherEmails.bodyText,
        bodyHtml: billingVoucherEmails.bodyHtml,
        createdBy: billingVouchers.createdBy,
      })
      .from(billingVoucherEmails)
      .innerJoin(billingVouchers, eq(billingVouchers.id, billingVoucherEmails.voucherId))
      .where(eq(billingVoucherEmails.id, deliveryId))
      .limit(1);
    if (!row) return;
    /* A stale worker can resume after Retry has taken its lease. Stop before
       Resend, not merely at completion: the idempotency key is a final defence,
       not a reason to make a provider call this attempt no longer owns. */
    if (row.status !== "sending" || row.attempts !== attempts) {
      logger.warn({ deliveryId, attempts }, "voucher email: this attempt no longer owns the delivery — not sent");
      return;
    }

    let recipient = row.recipient;
    if (recipient === null) {
      /* A claim notice's first attempt: freeze the creator's address, once. */
      const found = await (deps.lookupCreator ?? accountEmail)(row.createdBy);
      if (found.kind !== "found") {
        /* Never `hello@` instead: that address is not known to be theirs (Sol F4). */
        await finish(deliveryId, attempts, { status: "failed", detail: "creator address unavailable" });
        logger.warn({ deliveryId, lookup: found.reason }, "voucher email: the creator's address could not be looked up — not sent");
        return;
      }
      await getDb()
        .update(billingVoucherEmails)
        .set({ recipient: found.email, updatedAt: sql`now()` })
        .where(and(eq(billingVoucherEmails.id, deliveryId), isNull(billingVoucherEmails.recipient)));
      const [frozen] = await getDb()
        .select({
          recipient: billingVoucherEmails.recipient,
          status: billingVoucherEmails.status,
          attempts: billingVoucherEmails.attempts,
        })
        .from(billingVoucherEmails)
        .where(eq(billingVoucherEmails.id, deliveryId))
        .limit(1);
      /* The Auth lookup is a network call and can outlive the ten-minute
         lease. If Retry took the delivery while it was away, the newly frozen
         recipient belongs to the row, but this worker no longer gets to send. */
      if (frozen?.status !== "sending" || frozen.attempts !== attempts) {
        logger.warn({ deliveryId, attempts }, "voucher email: this attempt lost its lease during creator lookup — not sent");
        return;
      }
      recipient = frozen?.recipient ?? null;
      if (recipient === null) throw new Error("a claim notice's recipient did not freeze");
    }

    const label = `voucher: ${row.kind}`;
    const result = await sendEmail(
      {
        to: recipient,
        subject: row.subject,
        text: row.bodyText,
        ...(row.bodyHtml === null ? {} : { html: row.bodyHtml }),
        idempotencyKey: idempotencyKeyFor(deliveryId),
      },
      label,
      deps.email,
    );
    if (result.kind === "failed" && result.providerError === "invalid_idempotent_request") {
      /* The same key with a different body: the frozen request changed, which
         nothing here may do. Failed, and loud. */
      logger.error({ deliveryId }, "voucher email: Resend saw this key with a different request — an invariant is broken");
    }
    if (result.kind === "failed" && result.providerError === "concurrent_idempotent_requests") {
      /* Another request with this key is still in flight. It may be accepted,
         so `failed` would falsely say no email went. Leave this attempt
         `sending`: after its lease ages, Retry asks Resend for the same frozen
         request and key, and the page says it may or may not have gone. */
      logger.warn({ deliveryId, attempts }, "voucher email: the same request is already in flight — outcome is not known yet");
      return;
    }
    const recorded = await finish(deliveryId, attempts, outcomeOf(result));
    if (!recorded) {
      logger.warn({ deliveryId, attempts }, "voucher email: a newer attempt took this delivery over; this outcome was not recorded");
    }
  } catch (err) {
    logger.error(
      { deliveryId, err: errorName(err) },
      "voucher email: delivering it failed — it is left sending, and Retry may take it once its lease is ten minutes old",
    );
  }
}

/* ----------------------------------------------------------------- list -- */

interface LatestRow {
  id: string;
  voucher_id: string;
  kind: VoucherEmailKind;
  status: VoucherEmailStatus;
  attempts: number;
  detail: string | null;
  updated_at: Date | string;
  attempt_started_at: Date | string | null;
  retryable: boolean;
}

function iso(value: Date | string | null): string | null {
  if (value === null) return null;
  return (value instanceof Date ? value : new Date(value)).toISOString();
}

/**
 * **The latest delivery of each kind for these vouchers**, with `retryable`
 * computed by `RETRYABLE` itself. Vouchers with none are absent from the map.
 */
export async function latestVoucherEmails(voucherIds: readonly string[]): Promise<Map<string, VoucherEmails>> {
  const out = new Map<string, VoucherEmails>();
  if (voucherIds.length === 0) return out;
  const result = await getDb().execute(sql`
    select distinct on (e.voucher_id, e.kind)
           e.id, e.voucher_id, e.kind, e.status, e.attempts, e.detail, e.updated_at,
           e.attempt_started_at, ${RETRYABLE} as retryable
      from spideryarn.billing_voucher_emails e
      join spideryarn.billing_vouchers v on v.id = e.voucher_id
     where e.voucher_id in (${sql.join(
       voucherIds.map((id) => sql`${id}`),
       sql`, `,
     )})
     order by e.voucher_id, e.kind, e.created_at desc, e.id desc`);
  for (const row of rowsOf<LatestRow>(result)) {
    const common = {
      id: row.id,
      status: row.status,
      attempts: Number(row.attempts),
      detail: row.detail,
      updatedAt: iso(row.updated_at) ?? "",
      attemptStartedAt: iso(row.attempt_started_at),
      retryable: row.retryable === true,
    };
    const current = out.get(row.voucher_id) ?? { gift: null, claimed: null };
    out.set(
      row.voucher_id,
      row.kind === "gift"
        ? { ...current, gift: { ...common, kind: "gift" } satisfies VoucherEmailState<"gift"> }
        : { ...current, claimed: { ...common, kind: "claimed" } satisfies VoucherEmailState<"claimed"> },
    );
  }
  return out;
}

/** Every delivery for one voucher, oldest first. Tests and diagnostics. */
export async function voucherEmailsFor(voucherId: string) {
  return await getDb()
    .select()
    .from(billingVoucherEmails)
    .where(eq(billingVoucherEmails.voucherId, voucherId))
    .orderBy(billingVoucherEmails.createdAt, billingVoucherEmails.id);
}

function rowsOf<T>(result: unknown): T[] {
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
