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

/**
 * Why a send was skipped. A closed set, because a caller decides on it:
 * `noteArrival` retries a production process with no key and does not retry a
 * laptop, so a new reason must be a type error there rather than a silent guess.
 */
export type SkipReason = "not production" | "no RESEND_API_KEY";

export type SendResult =
  | { readonly kind: "sent"; readonly id: string | null }
  /** Deliberately not sent: not production, or no key. Not an error. */
  | { readonly kind: "skipped"; readonly reason: SkipReason }
  | { readonly kind: "failed"; readonly reason: string };

/**
 * **A seam, for tests.** The default is the real thing, so forgetting to inject
 * cannot make production inert — the same reasoning as `listSubscriptions` on
 * `syncSubscriptionFromStripe`.
 */
export interface EmailDeps {
  readonly fetch?: typeof fetch;
  readonly env?: EmailEnv;
}

/** Why this environment will not send, or `null` if it will. */
/** The five names this module reads, and nothing else. */
export interface EmailEnv {
  readonly VERCEL_ENV?: string | undefined;
  readonly NODE_ENV?: string | undefined;
  readonly RESEND_API_KEY?: string | undefined;
  readonly SPIDERYARN_EMAIL_SEND?: string | undefined;
  readonly SPIDERYARN_ADMIN_EMAIL?: string | undefined;
}

/**
 * Read one name at a time, never the whole of `process.env`: the environment
 * inventory (tests/env-names-are-inventoried.test.ts) can only see a literal
 * `process.env.NAME`.
 */
function realEnv(): EmailEnv {
  return {
    VERCEL_ENV: process.env.VERCEL_ENV,
    NODE_ENV: process.env.NODE_ENV,
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    SPIDERYARN_EMAIL_SEND: process.env.SPIDERYARN_EMAIL_SEND,
    SPIDERYARN_ADMIN_EMAIL: process.env.SPIDERYARN_ADMIN_EMAIL,
  };
}

function whyNotSend(env: EmailEnv): SkipReason | null {
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
    const env = deps.env ?? realEnv();
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
export function adminAddress(env: EmailEnv = realEnv()): string {
  return env.SPIDERYARN_ADMIN_EMAIL?.trim() || DEFAULT_ADMIN_EMAIL;
}

/** Tell the admin something happened. **Never throws** — see `sendEmail`. */
export async function notifyAdmin(
  message: { readonly subject: string; readonly text: string },
  label: string,
  deps: EmailDeps = {},
): Promise<SendResult> {
  return await sendEmail(
    { to: adminAddress(deps.env ?? realEnv()), subject: message.subject, text: message.text },
    `admin: ${label}`,
    deps,
  );
}
