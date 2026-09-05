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
 * docs/postmortems/260828f-admin-id-was-the-local-one.md.
 *
 * **What the second entry costs.** Not "nothing", which is what this comment
 * said first and which GPT Sol correctly refused: OIDC guarantees uniqueness
 * for the pair *(issuer, subject)*, not for a subject on its own, and GoTrue's
 * admin create-user API takes an explicit id — `scripts/db-seed-owner.ts` uses
 * it. An id can be created deliberately.
 *
 * The accurate version is narrower:
 *
 * - **The issuer is pinned one layer up.** `src/auth.ts` verifies every token
 *   against the project named by `SUPABASE_URL`, so a token minted by the
 *   laptop stack does not verify on production. `f4d08b58…` cannot arrive on a
 *   production request unless that account exists *in production*.
 * - **Creating one there needs the service-role key.** Anyone holding it owns
 *   the project already, so this widens nothing an attacker can reach.
 * - **It does widen what a mistake of ours can do**: a seed or a restore
 *   pointed at production could mint that id, and it would be an administrator.
 *
 * The version that closes it outright compares *(project, id)* rather than id,
 * which is a signature change at three call sites. Not done; written down
 * rather than left implicit.
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
 *
 * **Greg's real address, and the only account that should answer to it is
 * production's.** The local stack uses `ADMIN_EMAIL_LOCAL` below; the one place
 * this constant is still named by the seed is `renamableFrom` in
 * scripts/seed-accounts.ts, which exists precisely to move a local row *off* it.
 */
export const ADMIN_EMAIL = "greg@gregdetre.com";

/**
 * What `ADMIN_USER_ID_LOCAL` is called on a local stack — **a dummy, and it
 * says so.**
 *
 * ## Why it is not Greg's address
 *
 * It was, until 2026-09-02, and that was a confusion waiting to happen. Greg:
 *
 * > I worry about confusion, because greg@gregdetre.com is my real user on
 * > production with Google login. So I'd like the dev-dummy user to be called
 * > something distinct and different, and that highlights it's a dummy.
 *
 * The two accounts had the same address and nothing else in common: different
 * projects, different ids, one signed in with Google by a human and one holding
 * a generated password so that no human is needed. A screenshot, a Studio user
 * table or an admin page therefore could not be read for which stack it came
 * from — and the single worst mistake available in this repo is doing something
 * to production while believing you are local.
 *
 * **Renaming it costs nothing, because the gate never read it.** `/api/admin/*`
 * compares uuids (see the header at length), `SPIDERYARN_OWNER_ID` is a uuid,
 * and `tests/helpers/authed.ts` signs with a uuid. The address is a label on a
 * row, so this changes what a person sees and nothing that code decides.
 *
 * `.local` is reserved for link-local mDNS (RFC 6762), so it is not a domain
 * anybody can hold and it reads as a fixture at a glance. It is **not** a
 * guarantee that nothing will send to it — GPT Sol was right to correct that:
 * the local stack runs Mailpit (`supabase/config.toml`), which will happily
 * accept a message for it. What the choice buys is legibility, and that it
 * matches `DEV_OWNER_EMAIL` in src/owner.ts — the two read as a matched set of
 * local fixtures rather than as one real person and one not.
 *
 * `scripts/seed-accounts.ts` renames an existing row from `ADMIN_EMAIL` to this
 * without being asked, so a machine seeded before 2026-09-02 needs nothing run
 * by hand.
 */
export const ADMIN_EMAIL_LOCAL = "dev-admin@spideryarn.local";

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
 * it is a count, a date, or — since the billing fields below — a plan the
 * account is on. Nothing on it names an article, a file, a URL or a sentence:
 * how many pieces somebody has is a fact about the account, and *which* pieces
 * they are is their reading.
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

  /* ------------------------------------------------------------- spend ---
   *
   * **What this account's reading cost us in model calls**, over a period the
   * page has to name. Greg asked for the column explicitly (2026-09-02) and GPT
   * Sol withdrew its objection on two conditions, both of which are why there
   * are four fields here rather than one:
   *
   * > A bare currency number would overclaim.
   *
   * - **A defined period**, so it is `spendMonth` and not "recently". A number
   *   whose window is implied is a number two people will read differently.
   * - **A visible partial marker**, so `spendUnpricedCalls` travels beside the
   *   money. 207 of this box's 243 rows reported no cost at all; a `$0.00`
   *   drawn from those would be a lie the page tells confidently.
   *
   * `spendCalls` is the third leg of the same argument: zero calls and zero
   * dollars are different facts, and only one of them means "nothing happened".
   *
   * Eval and dev-CLI spend is excluded — see `productSpendByOwner` in
   * src/store/ai-calls-spend-pg.ts. It is ours rather than a reader's, and on a
   * per-account page it would draw whoever's owner id the environment was
   * carrying as costing forty times what anybody else does.
   */

  /** Model spend over `spendMonth`, in nano-dollars. Credits + BYOK + computed. */
  spendNanos: number;
  /** Metered calls behind that figure. `0` means nothing happened, not "free". */
  spendCalls: number;
  /** How many of those reported no cost, so the figure above is short. */
  spendUnpricedCalls: number;
  /** `YYYY-MM`, UTC — the period the three numbers above cover, never implied. */
  spendMonth: string;

  /* ------------------------------------------------------------ billing ---
   *
   * **What this account is entitled to, and how much of it is gone.** The plan
   * said this would be "one field on `AdminUser`, one column, one per-owner
   * statement in `pg-admin.ts`"; it is four fields, and the extra three are
   * each load-bearing rather than decoration:
   *
   * - `plan` alone cannot be rendered as a usage figure — "reader" says nothing
   *   about whether they are near the ceiling, which is the operational
   *   question this column is for.
   * - `ingests` without `ingestLimit` is a number with no scale, and the limit
   *   is a *row* in `billing_tiers` that somebody may raise at any time, so it
   *   cannot be a constant in the browser.
   * - `ingestWindow` because the two allowances are measured over different
   *   spans — a paid one over the billing period, the free one over the
   *   lifetime of the account — and a bare "3 of 20" that does not say which is
   *   the same overclaim `spendMonth` exists to prevent one column along.
   *
   * **The administrator's own row is exempt from the quota**, and the *page*
   * says so rather than the wire: the Ingests cell draws an em dash for an
   * account `isAdmin` recognises, which is a question already answered in the
   * browser on that same row (`AdminMarker` in src/web/admin-columns.tsx). A
   * fifth field would be a second opinion about the same two uuids. The plan and
   * status fields are filled in as usual, because an administrator may hold a
   * real subscription and it is a fact about the account either way.
   */

  /** `"free"`, or the id of the tier this account is currently entitled to. */
  plan: string;
  /**
   * The raw Stripe subscription status, when there is a subscription at all.
   *
   * Raw text rather than a derived word, for the reason `billing_accounts.status`
   * is text: entitlement is decided by an allowlist, and a status Stripe adds
   * next year should show itself on this page rather than be flattened into
   * whichever of ours it least resembles. **A status that does not entitle sits
   * beside `plan: "free"`** — which is the lapsed account, and is exactly what
   * an administrator looking at a support email needs to see.
   */
  planStatus?: string;
  /** Successful ingests over `ingestWindow`, plus reservations still in flight. */
  ingests: number;
  /**
   * How many of `ingests` are cheap right now — their article is public, so they
   * cost half a slot each (src/billing/half-units.ts).
   *
   * **A count, not a total**, and the cell does its own arithmetic with it. The
   * enforcement figure is in half-units and there is no rounding rule that makes
   * one out of it look right beside an article limit — the whole argument is in
   * src/billing-plan.ts § *Every number here is a whole article*. It is a fifth
   * field for the same reason `ingestWindow` is a third: `12` beside `3` is not
   * readable without it, and the page cannot work it out.
   *
   * Reservations in flight are never in here. They are charged full price
   * because nobody yet knows whether the article will be shared.
   */
  ingestsShared: number;
  /** What that count is measured against — the tier's row, or the free three. */
  ingestLimit: number;
  /**
   * Which span `ingests` covers. `period` is Stripe's, not a calendar month.
   *
   * **`stale` is a third value rather than a flavour of `lifetime`**, because
   * the pair it produces has no scale on its own: a subscription whose stored
   * period has run out shows a *lifetime* count against a *monthly* tier limit,
   * so `61 / 20` is two different questions in one fraction. The cell needs to
   * be able to say so, and `active` in the status column beside it does not —
   * that is the status of a subscription whose dates we could not read. GPT Sol,
   * 2026-09-03.
   */
  ingestWindow: "period" | "lifetime" | "stale";
}

/**
 * Nano-dollars as a string, **for the browser** — a deliberate second copy of
 * `formatNanos` in [src/ai-spend.ts](ai-spend.ts), and the reason is a bundle
 * boundary rather than an oversight.
 *
 * That module opens with `import { AsyncLocalStorage } from "node:async_hooks"`,
 * because the spend collector is a request-scoped store. Importing one formatter
 * from it would pull the whole ledger, the gateway request shapes and pino into
 * the client bundle — exactly the accident `tests/client-imports.test.ts` was
 * written for, when four lines from `src/converse.ts` grew the bundle 24KB and
 * put `OPENROUTER_API_KEY` in it. The remedy that test names is to put the
 * shared thing in a module that imports nothing, and this is that module.
 *
 * **The two must agree**, and `tests/admin-spend-column.test.ts` holds them
 * against each other rather than trusting this comment: a report and a page
 * showing different dollars for the same account is a bug that would be argued
 * about for an hour before anybody suspected the formatter.
 */
export function formatSpendNanos(nanos: number): string {
  const dollars = nanos / 1e9;
  /* Eight decimals under a hundredth of a cent, because `$0.0000` on a call
     that really cost something reads as free — the rounding-to-zero that
     `formatNanos` was caught doing on a live probe. */
  if (nanos !== 0 && Math.abs(dollars) < 0.0001) return `$${dollars.toFixed(8)}`;
  return `$${dollars.toFixed(4)}`;
}
