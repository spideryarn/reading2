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
 * Plain text by default. A caller may add an `html` part — the first was the
 * gift voucher's email to its recipient (src/store/pg-voucher-emails.ts) — and
 * an `idempotencyKey`, sent as Resend's `Idempotency-Key` header: Resend keeps a
 * key for 24 hours and answers a repeat with the first result instead of
 * sending again, which is what lets a stored delivery be retried at most once.
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
  /** An HTML part beside the text. Optional; admin mail does without. */
  readonly html?: string;
  /** Sent as `Idempotency-Key`. One per delivery, never per attempt. */
  readonly idempotencyKey?: string;
}

/**
 * Why a send was skipped. A closed set, because a caller decides on it:
 * `noteArrival` retries a production process with no key and does not retry a
 * laptop, so a new reason must be a type error there rather than a silent guess.
 */
export type SkipReason = "not production" | "no RESEND_API_KEY";

/**
 * **The error names Resend documents**, and the only part of a failed
 * response's body that is kept. https://resend.com/docs/api-reference/errors.
 * A list rather than "whatever `name` says": the body is the provider's, and a
 * validation message can echo a recipient or a submitted field, so only a
 * string we already knew can pass through to a log line or a stored detail.
 */
export const RESEND_ERROR_NAMES = [
  "validation_error",
  "missing_required_field",
  "invalid_parameter",
  "invalid_attachment",
  "invalid_from_address",
  "invalid_access",
  "invalid_region",
  "invalid_api_key",
  "restricted_api_key",
  "missing_api_key",
  "not_found",
  "method_not_allowed",
  "rate_limit_exceeded",
  "daily_quota_exceeded",
  "monthly_quota_exceeded",
  "security_error",
  "application_error",
  "internal_server_error",
  "invalid_idempotency_key",
  /* Six more on https://resend.com/docs/api-reference/errors, checked 2026-10-01. */
  "email_above_quota",
  "invalid_permission",
  "suspended_api_key",
  "resource_locked",
  "missing_required_parameter",
  "service_unavailable",
  /** The same key with a different request: the caller broke its own rule. */
  "invalid_idempotent_request",
  /** The same key, twice at once: safe to retry later. */
  "concurrent_idempotent_requests",
] as const;
export type ResendErrorName = (typeof RESEND_ERROR_NAMES)[number];

function resendErrorName(body: unknown): ResendErrorName | undefined {
  if (body === null || typeof body !== "object") return undefined;
  const name = (body as { name?: unknown }).name;
  return (RESEND_ERROR_NAMES as readonly unknown[]).includes(name) ? (name as ResendErrorName) : undefined;
}

export type SendResult =
  | { readonly kind: "sent"; readonly id: string | null }
  /** Deliberately not sent: not production, or no key. Not an error. */
  | { readonly kind: "skipped"; readonly reason: SkipReason }
  | {
      readonly kind: "failed";
      /** A status code or an error name, plus an allowlisted Resend name — never a body or an address. */
      readonly reason: string;
      /** Present only when Resend answered with a name on `RESEND_ERROR_NAMES`. */
      readonly providerError?: ResendErrorName;
    };

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
 * Send one email through Resend — plain text, with an HTML part if given.
 * **Never throws.**
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
        ...(email.idempotencyKey === undefined ? {} : { "idempotency-key": email.idempotencyKey }),
      },
      body: JSON.stringify({
        from: FROM,
        to: [email.to],
        subject: email.subject,
        text: email.text,
        ...(email.html === undefined ? {} : { html: email.html }),
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

    if (!response.ok) {
      /* Provider validation messages can echo a recipient or submitted field,
         so the body is read for one thing — an error `name` on the allowlist
         above — and the rest is dropped unlogged. Reading it also lets fetch
         release its connection. */
      const raw = await response.text().catch(() => "");
      let parsed: unknown = null;
      try {
        parsed = JSON.parse(raw);
      } catch {
        parsed = null;
      }
      const providerError = resendErrorName(parsed);
      const reason = `Resend answered ${response.status}${providerError ? ` ${providerError}` : ""}`;
      logger.error({ label, status: response.status, providerError }, "sending email failed");
      return providerError ? { kind: "failed", reason, providerError } : { kind: "failed", reason };
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

/**
 * **Somebody else's text, made safe to put on one line of a plain-text mail.**
 *
 * There is no markup for it to become — the mail is `text` only — but a line
 * break inside it could still draw a line of its own underneath, a fake link
 * included. So every control character (Unicode category `Cc`, which has CR
 * and LF in it) and the Unicode line and paragraph separators are replaced by
 * a space, and the result is capped at `max` code points, the ellipsis
 * included. 254 is a display bound sized for an address, not a protocol
 * limit. Keep it out of the subject either way.
 */
export function oneLine(text: string, max = 254): string {
  const flat = [...text.replace(/[\p{Cc}\u2028\u2029]/gu, " ").trim()];
  return flat.length > max ? `${flat.slice(0, max - 1).join("")}…` : flat.join("");
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
