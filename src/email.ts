/**
 * **Email the server sends itself.** One function to send, one to tell the
 * admin, and neither can throw.
 *
 * Auth email (confirmations, resets) is not this: Supabase sends that over
 * Resend's SMTP, and never comes through here — docs/project/email.md. This is
 * the other half of the same account: the same key, the same verified domain,
 * the same sender, through Resend's HTTP API. Anything new that the server
 * mails should go through `sendEmail` rather than grow a second way.
 *
 * ## Three rules, all structural
 *
 * - **It never throws.** Its callers are a reader's first request and a Stripe
 *   sync, and a notification is not allowed to fail either. Every outcome is a
 *   value, `SendResult`, and every failure is also logged.
 * - **Only production sends.** The box's `.env.local` carries the real key, so
 *   without this every local sign-up and every test-mode checkout would mail a
 *   real inbox. Anywhere else it logs that it would have sent and returns
 *   `skipped`. `SPIDERYARN_EMAIL_SEND=1` overrides it for a deliberate manual
 *   check — never under vitest, where `NODE_ENV` is `test`.
 * - **Neither the body nor the recipient is logged.** A caller may one day put
 *   something private in either; the log line carries a label naming the kind
 *   of mail instead.
 *
 * Plain text only, for now: admin mail does not need HTML, and an HTML
 * template can arrive with the first reader-facing email that does.
 */

import { errorFields, log } from "./log.js";

const logger = log("email");

/** Resend's send endpoint. https://resend.com/docs/api-reference/emails/send-email */
const RESEND_URL = "https://api.resend.com/emails";

/** The sender auth mail already uses — docs/project/website-text.md § The contact address. */
export const FROM = "Spideryarn <hello@spideryarn.com>";

/**
 * Where admin notifications go unless `SPIDERYARN_ADMIN_EMAIL` says otherwise.
 * `hello@` forwards to Greg (docs/project/email.md), so no env file needs a new
 * line for this to work.
 */
export const DEFAULT_ADMIN_EMAIL = "hello@spideryarn.com";

/** Long enough for Resend on a bad day; short enough not to hold a request hostage. */
const TIMEOUT_MS = 10_000;

export interface Email {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
}

export type SendResult =
  | { readonly kind: "sent"; readonly id: string | null }
  /** Deliberately not sent: not production, or no key. Not an error. */
  | { readonly kind: "skipped"; readonly reason: string }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * **A seam, for tests.** The default is the real thing, so forgetting to inject
 * cannot make production inert — the same reasoning as `listSubscriptions` on
 * `syncSubscriptionFromStripe`.
 */
export interface EmailDeps {
  readonly fetch?: typeof fetch;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** Why this environment will not send, or `null` if it will. */
function whyNotSend(env: Readonly<Record<string, string | undefined>>): string | null {
  const optedIn = env.SPIDERYARN_EMAIL_SEND === "1" && env.NODE_ENV !== "test";
  if (!optedIn && env.VERCEL_ENV !== "production") return "not production";
  if (!env.RESEND_API_KEY) return "no RESEND_API_KEY";
  return null;
}

/**
 * Send one plain-text email through Resend. **Never throws.**
 *
 * `label` names the kind of mail for the log line — "admin: sign-up", say — so
 * a failure can be found without the log ever holding the recipient's address
 * or the body.
 */
export async function sendEmail(email: Email, label: string, deps: EmailDeps = {}): Promise<SendResult> {
  try {
    const env = deps.env ?? process.env;
    const skip = whyNotSend(env);
    if (skip) {
      /* Info for "not production", which is every dev machine all day; warn for
         a production process with no key, which is a misconfiguration. */
      if (skip === "not production") logger.info({ label }, "not sending email outside production");
      else logger.warn({ label, reason: skip }, "not sending email");
      return { kind: "skipped", reason: skip };
    }

    const response = await (deps.fetch ?? fetch)(RESEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from: FROM, to: [email.to], subject: email.subject, text: email.text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      /* Provider validation messages can echo a recipient or submitted field.
         The status is enough to diagnose the class without breaking this
         module's rule that neither recipient nor message reaches a log. Still
         consume the body so fetch can release its connection. */
      await response.text().catch(() => "");
      const reason = `Resend answered ${response.status}`;
      logger.error({ label, status: response.status }, "sending email failed");
      return { kind: "failed", reason };
    }

    const body = (await response.json().catch(() => null)) as { id?: unknown } | null;
    const id = typeof body?.id === "string" ? body.id : null;
    logger.info({ label, id }, "sent email");
    return { kind: "sent", id };
  } catch (err) {
    logger.error({ label, ...errorFields(err) }, "sending email failed");
    return { kind: "failed", reason: err instanceof Error ? err.name : "unknown error" };
  }
}

/** Where admin notifications go. */
export function adminAddress(env: Readonly<Record<string, string | undefined>> = process.env): string {
  return env.SPIDERYARN_ADMIN_EMAIL?.trim() || DEFAULT_ADMIN_EMAIL;
}

/** Tell the admin something happened. **Never throws** — see `sendEmail`. */
export async function notifyAdmin(
  message: { readonly subject: string; readonly text: string },
  label: string,
  deps: EmailDeps = {},
): Promise<SendResult> {
  return await sendEmail(
    { to: adminAddress(deps.env ?? process.env), subject: message.subject, text: message.text },
    `admin: ${label}`,
    deps,
  );
}
