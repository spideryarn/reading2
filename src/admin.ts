/**
 * Who the administrator is, and nothing else.
 *
 * One account per Supabase project, spelled once, in a module that imports
 * nothing — so the browser can ask exactly the same question the server asks.
 * Greg, 2026-08-27:
 *
 * > Set up an /admin/ page that only user `greg@gregdetre.com` sees a link for
 * > or is allowed to access.
 *
 * Two halves to that sentence, and they are not the same job:
 *
 * - **"sees a link for"** is the client, and it is cosmetic. `isAdmin` there
 *   decides whether a link is drawn. It is not a gate and must never be read as
 *   one: the page's code is in the bundle whatever the answer, and anybody can
 *   type `/admin/users` into the address bar.
 * - **"allowed to access"** is the server, in src/routes.ts, one check on the
 *   `/api/admin` namespace above the route table. That is the whole of the
 *   enforcement, and it would refuse identically if the browser had never heard
 *   of an admin page.
 *
 * ## It is his account id, not his email address
 *
 * Greg named an email and this compares a uuid, so the difference is worth
 * being plain about. **A verified email is trustworthy but not stable.** It is
 * a property of an account that the account holder can change; an account id is
 * the account. GPT Sol led its review of the plan with this, 2026-08-27, and it
 * is right:
 *
 * > A signed JWT makes the email trustworthy, but not stable. Changing or
 * > recreating the account can remove or transfer admin power.
 *
 * Concretely, the escalation is: somebody with an account on this Supabase
 * project changes their own email to Greg's. Today that is blocked, because
 * production requires a confirmation sent to the *new* address
 * (`mailer_autoconfirm` is false — docs/project/auth.md). But that is a setting
 * on a dashboard, in a project this repo shares with an older app, and an
 * authorisation decision resting on it is an authorisation decision one
 * checkbox away from gone. An id needs no such argument: nothing can be issued
 * a `sub` that already exists.
 *
 * **What it costs** is that a recreated account is a different administrator.
 * If Greg's Supabase account is ever made afresh, the admin page quietly stops
 * being his — and *quietly* is the bad half, since App.tsx just shows him the
 * shelf. So `describeAdminMiss` exists: the server logs one fixed sentence when
 * somebody with the right address and the wrong id is turned away, which turns
 * a baffling silence into a line that says what happened and what to edit.
 *
 * That cost was paid on the first deploy rather than at some future recreation,
 * because *a different project* is a different account for the same reason a
 * recreated one is — see `ADMIN_USER_IDS` below. The log sentence was written
 * and nobody was reading it, which is worth knowing about the mitigation.
 *
 * ## Why a constant and not an environment variable
 *
 * An unset environment variable read as "allow everyone" is the canonical
 * fail-open (docs/reusable/silent-success.md), and this repo has been bitten by
 * that shape more than once. A hardcoded id has no unset state: there is
 * nothing to forget to configure, on Vercel or anywhere else. Adding a second
 * administrator is an edit here, which is reviewable in a way an env var is
 * not.
 *
 * The id is not a secret. It travels in every JWT the account holds and it
 * identifies rather than authorises — knowing it gets you no closer to being
 * signed in as it. Shipping it in the browser bundle costs nothing.
 */

/**
 * Greg's `auth.users(id)` **on the local Supabase stack**.
 *
 * The same value `tests/helpers/authed.ts` signs its requests with, and the
 * owner of everything in a laptop's `data/` and database.
 */
export const ADMIN_USER_ID_LOCAL = "f4d08b58-5573-4811-9887-e26c114fb324";

/**
 * Greg's `auth.users(id)` **on the production Supabase project**
 * (`alschkahzfagtppxspfq`), read from `auth.users` on 2026-08-28.
 *
 * A different account from the one above, holding the same email address —
 * which is the whole of the bug this constant fixes, and the reason there is a
 * list rather than a value. See the note on `ADMIN_USER_IDS`.
 */
export const ADMIN_USER_ID_PROD = "001bb7a0-7720-4f1b-8b9d-1ee6e63d132a";

/**
 * Every account that is Greg.
 *
 * ## Why a list, when there is one administrator
 *
 * Because "the administrator" is a person and an account id is not. Sign-up
 * happens per Supabase project, so **one person has one account per project**,
 * and this repo talks to two: a stack on a laptop and
 * `alschkahzfagtppxspfq` in production. The two ids share nothing — GoTrue
 * mints a fresh uuid each time — so a single constant is necessarily right in
 * one place and wrong in the other.
 *
 * It was wrong in production for a day. The constant was read off the local
 * database on 2026-08-27, the built page was checked on a laptop where it
 * worked, and on spideryarn.com the Admin link did not draw and `/api/admin/*`
 * answered Greg 403 — the exact silent lockout the header above predicts as the
 * *cost* of gating on an id, arriving on the first deploy rather than on some
 * future recreated account.
 * docs/postmortems/admin-id-was-the-local-one.md.
 *
 * **This does not widen anything.** Each id is an account that exists on
 * exactly one project, so on either project the other entry names nobody: the
 * production database has no `f4d08b58…`, and nothing can be issued a `sub`
 * that already exists elsewhere. Two entries, one reachable administrator,
 * whichever database the server is pointed at.
 *
 * Still a constant rather than an environment variable, for the reason in the
 * header: an unset env var read as "allow everyone" is the canonical fail-open,
 * and an array literal has no unset state either.
 */
export const ADMIN_USER_IDS: readonly string[] = [ADMIN_USER_ID_LOCAL, ADMIN_USER_ID_PROD];

/**
 * The address that id belongs to, for people rather than for code.
 *
 * **Not what the gate compares** — see the header. It is here so that the
 * constant above is legible, and so `describeAdminMiss` can tell "somebody
 * else" from "the right person on a new account" without a second lookup.
 */
export const ADMIN_EMAIL = "greg@gregdetre.com";

/**
 * Is this the administrator?
 *
 * Takes `string | undefined | null` because both callers have a value that may
 * be absent — the server's claims are checked before this runs, the browser's
 * `user.id` is a string but arrives inside a possibly-null user — and a
 * signature that made each of them write their own `?? ""` is a signature that
 * invites one of them to write `?? ADMIN_USER_IDS[0]` by accident.
 *
 * Compared exactly, and lower-cased first because a uuid has no case: Postgres
 * and Supabase both render one in lower case, so this is belt and braces rather
 * than a rule anybody depends on.
 */
export function isAdmin(userId: string | undefined | null): boolean {
  if (typeof userId !== "string") return false;
  const id = userId.trim().toLowerCase();
  /* `includes` on the array, never on a string: a substring test here would
     admit anything containing an id. tests/admin.test.ts pins that. */
  return ADMIN_USER_IDS.includes(id);
}

/**
 * Whether a refusal is worth a line in the log, and what it should say.
 *
 * Only one case is: **the administrator's own email address on an id we do not
 * recognise.** That is either Greg on a recreated account — in which case the
 * page has silently stopped being his and this sentence is the only thing that
 * will tell him why — or somebody who has managed to take his address, which is
 * a thing to know about immediately.
 *
 * Everything else is an ordinary reader on a page that is not theirs, which is
 * not an event.
 *
 * Returns fixed prose or nothing. **Nothing interpolated, ever**: `logRequest`
 * in src/routes.ts writes a message into a `reason` field, and redaction there
 * matches key paths rather than text (docs/project/logging.md), so an email or
 * an id put into this string would be written down in the clear.
 */
export function describeAdminMiss(userId: string, email: string): string | undefined {
  if (isAdmin(userId)) return undefined;
  if (email.trim().toLowerCase() !== ADMIN_EMAIL) return undefined;
  return "the administrator's email arrived on an account id we do not recognise — see src/admin.ts";
}

/**
 * One row of the admin users table — `GET /api/admin/users`.
 *
 * **The only shape in this repo that describes somebody other than the reader
 * asking**, which is why it is worth reading before extending it. Everything on
 * it is a count or a date. Nothing on it names an article, a file, a URL or a
 * sentence: how many pieces somebody has is a fact about the account, and
 * *which* pieces they are is their reading.
 * docs/project/admin.md § What it deliberately does not show.
 *
 * ## Why it is here rather than in src/types.ts
 *
 * Every other wire shape lives there, so this is the exception and it needs a
 * reason. Two:
 *
 * - **`types.ts` is the vocabulary the reading app speaks in** — articles,
 *   blocks, threads, the shelf. This is one page's row, read by three files and
 *   a test, and none of them is the reader's app. Putting it beside `isAdmin`
 *   keeps the whole feature's shared surface in one module.
 * - **It costs a dependency nobody needs.** `types.ts` is edited by everybody;
 *   this module is imported by the browser and imports nothing at all. A shape
 *   used only here does not need to travel through the busiest file in the
 *   repo.
 *
 * Every date is an ISO string and every count is a number that is always
 * present — `0` is an answer, and a missing count would be indistinguishable
 * from one on a page whose whole content is numbers.
 */
export interface AdminUser {
  /** `auth.users(id)` — the same uuid every `owner_id` in the schema points at. */
  id: string;
  email: string;
  /** ISO. When the account was created. */
  createdAt: string;
  /** ISO. Absent for an account that has never completed a sign-in. */
  lastSignInAt?: string;
  /**
   * ISO. Absent until the **email address** is confirmed.
   *
   * `auth.users.email_confirmed_at`, deliberately not `confirmed_at` — that one
   * also answers for a phone, and this sits under an email address on the page.
   * A Google sign-in sets it, because Google has already confirmed the address.
   */
  emailConfirmedAt?: string;
  /** `google`, `email`, … as Supabase records them. Empty if it records none. */
  providers: string[];
  /** Articles on the shelf — archived ones are the next field, not these. */
  articles: number;
  archived: number;
  /** PDFs that finished uploading. An abandoned grant is not an upload. */
  uploads: number;
  /** Questions asked about a passage. */
  questions: number;
  chats: number;
  searches: number;
  /** Times any of their articles has been opened, summed. */
  opens: number;
  /** ISO. The most recent open across all their articles, if there is one. */
  lastReadAt?: string;
}
