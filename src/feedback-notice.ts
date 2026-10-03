/**
 * **The mail that tells the admin a reader filed feedback** — plan
 * docs/plans/261002j-email-the-admin-each-reader-s-feedback.md, at Greg's
 * request (report spya-wwx6ks):
 *
 * > Anytime someone submits feedback that isn't from me, the admin, please
 * > send me an email with their feedback.
 *
 * A third destination for a report, after the row (authoritative) and Sentry
 * (a mirror). Like the Sentry mirror it starts after the reader has been
 * answered and cannot fail their request; unlike it, it carries the words to
 * an inbox, so docs/project/privacy.md § The admin is emailed each reader's
 * feedback and the Resend entry on /privacy say so.
 *
 * ## The reader's words are a stranger's text
 *
 * The mail is **plain text only** — no HTML part, so there is no markup for
 * the words to escape into — and nothing the reader typed reaches the subject,
 * which is a header. In the body:
 *
 * - **`noteText`** flattens every line break to `\n` and every other control
 *   character to a space, so CR/LF cannot start a forged line; bidirectional
 *   controls, which it keeps, are removed here.
 * - **Every line is quoted with `> `**, so a reader who types
 *   `Account id: …` or `Email: …` cannot pass it off as one of ours.
 * - **Links are defanged, best effort** (`inert` below). A plain-text mail
 *   has no links, but a mail client draws its own from anything that looks
 *   like a URL; a reader's `https://` becoming one click from Greg's inbox is
 *   the "link that acts" this should not be. The page address is the reader's
 *   too (`isWebUrl` is all the route checks), so it is live only on our own
 *   origin, and then only as the URL parser re-spells it.
 *
 * ## What caps a burst
 *
 * One mail per **created** report — a retry is `duplicate` and sends nothing —
 * and at most `FEEDBACK_HOURLY_CAP` (30) reports an hour per reader. That is
 * not enough on its own: Resend's free plan is 100 emails a day and auth mail
 * shares it (docs/project/email.md), so one reader at the hourly cap could
 * stop sign-up confirmations within four hours. So each mail takes a slot
 * from `FEEDBACK_NOTICE_POLICY` first — the same atomic, cross-instance
 * allowance the paid features use (src/store/pg-rate-limit.ts), counting
 * **mails attempted rather than reports filed**, so a burst still mails its
 * first twenty instead of each report seeing the others and all staying
 * silent (GPT Sol's plan review). Every mail says the cap exists; every report
 * is on `/admin/feedback` whatever happened to its mail.
 */

import { isAdmin } from "./admin.js";
import { notifyAdmin, noteText, oneLine, type SendResult } from "./email.js";
import { errorFields, log } from "./log.js";
import type { FeedbackReport, FetchAllowanceStore, RatePolicy } from "./store/contracts.js";
import { ADMIN_FEEDBACK_URL, PUBLIC_ORIGIN } from "./urls.js";

const logger = log("email");

/**
 * **The allowance one mail takes.** Twenty a day across every reader — a fifth
 * of Resend's daily quota, which auth mail shares — and five a day from any one
 * reader, so a single account cannot spend the whole of it. The hourly figure
 * and the concurrency are loose on purpose: the day is the bound that matters,
 * and a reader filing three reports in a minute should still produce three
 * mails. The lease covers `sendEmail`'s ten-second timeout with room.
 */
export const FEEDBACK_NOTICE_POLICY = {
  fills: 5,
  windowMs: 60 * 60 * 1000,
  concurrency: 5,
  leaseMs: 30_000,
  daily: { fills: 5, globalFills: 20, windowMs: 24 * 60 * 60 * 1000 },
} as const satisfies RatePolicy;

/**
 * **Bidirectional formatting controls** — Unicode's own `Bidi_Control`
 * property, so the list is the standard's rather than ours: the marks
 * (U+061C, U+200E, U+200F), the embeddings and overrides (U+202A to U+202E)
 * and the isolates (U+2066 to U+2069). The first hand-written list missed
 * U+061C (Sol's code review). Not control characters by Unicode's category,
 * so `noteText` and `oneLine` keep them, and a right-to-left override can make
 * text display in an order other than the one it is stored in. Removed, not
 * replaced: they draw nothing.
 */
const BIDI_CONTROLS = /\p{Bidi_Control}/gu;

/**
 * **Best-effort text a mail client will not turn into a link.** `scheme://`
 * becomes `scheme[:]//`, one of the schemes that need no slashes (`mailto:`,
 * `javascript:` and the like) becomes `mailto[:]`, and `www.` becomes
 * `www[.]` — the usual way to defang an address, so it still reads as what the
 * reader wrote and can be copied back by hand.
 *
 * **Best effort, and said so**: a bare `evil.example` or an email address may
 * still be drawn as a link by some client, and nothing here can prove what
 * Greg's client does. What it removes is the obvious one-click case. Any
 * scheme followed by `//`, RFC 3986's shape, rather than a list; the
 * slash-less ones are a list, because a broad `word:` rule would also mangle
 * every `Note:` the reader typed.
 */
export function inert(text: string): string {
  return text
    .replace(/\b([a-z][a-z0-9+.-]*):\/\//gi, "$1[:]//")
    .replace(/\b(mailto|javascript|vbscript|data|tel|sms|file):/gi, "$1[:]")
    .replace(/\bwww\./gi, "www[.]");
}

/** One line of a reader's text, made safe: no breaks, no bidi controls. */
function line(text: string, max?: number): string {
  return oneLine(text.replace(BIDI_CONTROLS, ""), max);
}

/**
 * The page address. **Never the stored spelling on its own say-so**:
 * `isWebUrl` checks the *parsed* protocol and the route stores the string the
 * browser sent, so a value can begin with our origin and still carry a line
 * break or a second address after it (GPT Sol's plan review). On our origin it
 * is the parser's own serialisation, which drops breaks and percent-encodes
 * spaces, so it is one token a client links to us; anywhere else it is inert
 * text.
 */
function pageLine(url: string | null): string {
  if (url === null) return "Page: (not recorded)";
  let parsed: URL | null = null;
  try {
    parsed = new URL(url);
  } catch {
    /* Not a URL at all — the route refuses that, but this mail does not rely on it. */
  }
  if (parsed && parsed.origin === PUBLIC_ORIGIN) return `Page: ${line(parsed.href, 2048)}`;
  return `Page: ${inert(line(url, 2048))}`;
}

/** The mail itself. Pure, so every rule above is tested without a send. */
export function feedbackNoticeMessage(
  report: FeedbackReport,
  ownerId: string,
): { subject: string; text: string } {
  const words = noteText(report.body.replace(BIDI_CONTROLS, ""))
    .split("\n")
    .map((text) => (text === "" ? ">" : `> ${inert(text)}`));
  return {
    /* Closed vocabulary only: `kind` is `FEEDBACK_KINDS` or null, checked by
       the route; nothing the reader typed reaches a header. */
    subject:
      report.kind === null
        ? "New feedback on Spideryarn"
        : `New feedback on Spideryarn (${report.kind})`,
    text: [
      "A reader has sent feedback.",
      "",
      `Report: ${report.id}`,
      `Kind: ${report.kind ?? "(not said)"}`,
      `Filed: ${report.createdAt}`,
      pageLine(report.url),
      /* A slug is lowercase letters, digits and hyphens by the route's check,
         so nothing in it can be a link or a line. */
      `Article: ${report.slug ?? "(none)"}`,
      `Email: ${line(report.reporterEmail)}`,
      `Account id: ${ownerId}`,
      `Extra diagnostics: ${report.consented ? "yes" : "no"}`,
      `Screenshot: ${report.screenshotBytes === null ? "no" : "yes"}`,
      "",
      "What they wrote:",
      "",
      ...words,
      "",
      `All feedback: ${ADMIN_FEEDBACK_URL}`,
      "",
      `At most ${FEEDBACK_NOTICE_POLICY.daily.globalFills} of these are sent a day, ${FEEDBACK_NOTICE_POLICY.daily.fills} from any one reader; every report is on the page above.`,
    ].join("\n"),
  };
}

export type FeedbackNoticeOutcome =
  | { readonly kind: "admin" }
  /** The allowance said no: this reader's share, or everybody's day. */
  | { readonly kind: "capped"; readonly why: "rate" | "concurrency" | "global" }
  | SendResult;

export interface FeedbackNoticeDeps {
  readonly allowance: Pick<FetchAllowanceStore, "take" | "finish">;
  /** The send. The default is `notifyAdmin`; a test passes its own. */
  readonly notify?: (message: { subject: string; text: string }) => Promise<SendResult>;
}

/**
 * Tell the admin, unless the reporter is one or the allowance is spent.
 *
 * **Never throws**, because its caller has already answered the reader and has
 * nowhere to put an error. Must run **inside the reader's owner scope**: the
 * allowance keys its per-reader count on `currentOwnerId()`.
 *
 * **An allowance that cannot be read sends anyway.** The row was just written,
 * so the database failing between the two is rare, and a missed report is the
 * worse mistake at today's volume than one mail past a cap.
 */
export async function noticeFeedback(
  report: FeedbackReport,
  ownerId: string,
  deps: FeedbackNoticeDeps,
): Promise<FeedbackNoticeOutcome> {
  if (isAdmin(ownerId)) return { kind: "admin" };

  let lease: string | null = null;
  try {
    const taken = await deps.allowance.take("feedback-notice", FEEDBACK_NOTICE_POLICY);
    if (taken.kind !== "allowed") {
      logger.info({ why: taken.kind }, "feedback notice skipped: allowance spent");
      return { kind: "capped", why: taken.kind };
    }
    lease = taken.id;
  } catch (err) {
    logger.warn({ ...errorFields(err) }, "feedback notice: allowance unreadable, sending anyway");
  }

  try {
    const notify =
      deps.notify ?? ((message: { subject: string; text: string }) => notifyAdmin(message, "feedback"));
    return await notify(feedbackNoticeMessage(report, ownerId));
  } catch (err) {
    /* `notifyAdmin` never throws; an injected one might, and this function's
       promise not to is still owed. */
    logger.error({ ...errorFields(err) }, "feedback notice failed");
    return { kind: "failed", reason: "threw" };
  } finally {
    if (lease !== null) {
      /* Only the lease is cleared; the row goes on counting against the day. */
      /* `try` around the `await`, not `.catch` on the call: a `finish` that
         throws before it returns a promise would escape a `.catch` (Sol's code
         review). */
      try {
        await deps.allowance.finish(lease);
      } catch (err) {
        logger.warn({ ...errorFields(err) }, "feedback notice: lease not released");
      }
    }
  }
}
