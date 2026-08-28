/**
 * Who has an account, asked of the Auth service rather than of the database.
 *
 * The admin page needs six facts that exist only in `auth.users` — the id, the
 * address, when the account was made, when it last signed in, whether the
 * address is confirmed, and which providers are linked. This module is where
 * they come from.
 *
 * ## Why not a query
 *
 * Because the query does not work in production, and the reason is one we
 * built on purpose. `auth.users` belongs to Supabase — owned by
 * `supabase_auth_admin`, in a schema `spideryarn_app` has no grants into — and
 * `spideryarn_app` is what the deployed server connects as. Measured, not
 * argued:
 *
 * ```
 * $ psql "$DATABASE_URL" -c "select id from auth.users limit 1"
 * ERROR:  permission denied for schema auth
 * ```
 *
 * Locally the same query works, because `DATABASE_URL` on a laptop is the
 * `postgres` superuser — which is why the first version of this page shipped
 * broken and nobody saw it.
 * docs/postmortems/admin-id-was-the-local-one.md § Still broken.
 *
 * **This is the documented way.** Supabase's own guidance is that the Admin API
 * is how server-side code reads account facts, and that the `auth` schema is
 * not one to build on: *"columns, indices, constraints or other database
 * objects managed by Supabase may change at any time and you should be careful
 * when referencing them directly."* Only the primary key is promised. A grant
 * or a view over that table would work today and is not a contract.
 * docs/project/admin.md § The page cannot read `auth.users` in production.
 *
 * `scripts/check-owner-identity.ts` reached the same conclusion for the same
 * reason on 2026-08-26, a day before the admin page was built querying the
 * table anyway.
 *
 * ## The shape of the code, and why it is in three pieces
 *
 * `listAccounts` is the pagination, and takes the page-fetcher as an argument.
 * `gotruePages` is the only piece that does I/O. `accountFrom` is the mapping
 * from one API object to one row. Each can be checked without the other two,
 * and the middle one is the only piece a test cannot reach.
 */

import type { AccountRow } from "./account-row.js";

export type { AccountRow };

/**
 * One page of accounts, however it was obtained.
 *
 * `total` is the Auth service's own count of accounts, from the
 * `x-total-count` header — the number this module checks itself against. See
 * `listAccounts`.
 */
export interface AccountPage {
  users: unknown[];
  /** `undefined` when the response carried no `x-total-count`. */
  total?: number;
  /**
   * Is there another page? From the response's own `Link … rel="next"`.
   *
   * `undefined` means the response carried no `Link` header and the question
   * cannot be answered — not "no". See `listAccounts` for what is done then.
   */
  hasNext?: boolean;
}

/** Asks for one page. Page numbers are 1-based, as GoTrue's are. */
export type GetAccountPage = (page: number, perPage: number) => Promise<AccountPage>;

/**
 * How many to ask for at a time.
 *
 * **The service's own default is 50, and it truncates silently** — no error, no
 * flag on the response, just fewer accounts than exist. Somebody with 70 users
 * saw 50 and nothing to say so (supabase/auth-js#538). That is the failure this
 * whole file is shaped around, and it is why the count is checked below rather
 * than trusted.
 *
 * 200 rather than 50 to make the common case one request. It is not a cap we
 * rely on: no maximum is documented, so a service that quietly clamps this to
 * something smaller must still produce the right answer, and it does — the loop
 * asks for the next page based on what it *received*, never on what it asked
 * for.
 */
const PER_PAGE = 200;

/**
 * A page count nothing legitimate will reach.
 *
 * At `PER_PAGE` this is two hundred thousand accounts. It exists so that a
 * service which answered a full page for ever could not spin here — a loop
 * whose exit depends on the far end agreeing to stop is a loop that needs its
 * own end.
 */
const MAX_PAGES = 1000;

/**
 * Every account, following the pages to the end.
 *
 * **The count is checked against the service's own.** `x-total-count` comes
 * back on the first response, and if fewer accounts are collected than it
 * named, this throws rather than returning a short list. That is the whole
 * point: a truncated list of users is not a visibly broken page, it is a page
 * that looks right and is missing people, and the 50-row default is a live
 * mechanism for producing one. A check taken from outside the loop is the only
 * thing that can catch the loop being wrong —
 * docs/reusable/silent-success.md.
 *
 * **It throws only on a shortfall, never on a surplus.** Someone signing up
 * while this is paging makes the real total larger than the one the first page
 * reported; that is not a fault and must not fail the page. The direction that
 * matters is the one that loses people.
 *
 * A response with no `x-total-count` is not treated as zero — it means the
 * check cannot run, and the list is returned unchecked rather than rejected.
 * Absent is not a number: `Number("")` is `0`, and a zero here would make an
 * empty first page look like a complete answer.
 */
export async function listAccounts(getPage: GetAccountPage): Promise<AccountRow[]> {
  const rows: AccountRow[] = [];
  /* **Distinct ids of everything that arrived**, which is three things at once
     and each of them is load-bearing:

     - *distinct*, because offset pagination has no snapshot. A sign-up landing
       between two requests shifts every later page by one, so page 2 repeats a
       row page 1 already had and the account that should have been at the
       boundary is never returned. A plain arrival count is satisfied by the
       duplicate and the loop stops one account short, confidently. GPT Sol
       reproduced exactly that on 400 accounts, 2026-08-28 — `rows=400,
       unique=399, u400 missing, u200 duplicated` — against the version of this
       file that counted arrivals.
     - *of everything*, not of what survives: `accountFrom` drops soft-deleted
       accounts and `x-total-count` counts them, so comparing kept rows would
       fire the shortfall error the first time anybody deleted an account.
     - *ids*, so a malformed object with no id counts for nothing and shows up
       as a shortfall rather than as a silently shorter list. */
  const arrived = new Set<string>();

  let expected: number | undefined;
  let ended = false;

  for (let page = 1; page <= MAX_PAGES && !ended; page++) {
    const got = await getPage(page, PER_PAGE);
    if (page === 1) expected = got.total;

    for (const raw of got.users) {
      const id = idOf(raw);
      /* Deduplicated on the way in. A row seen twice because the pages shifted
         must not become two lines on the page, and must not count twice. */
      if (id && arrived.has(id)) continue;
      if (id) arrived.add(id);
      const row = accountFrom(raw);
      if (row) rows.push(row);
    }

    /* **Termination, in the order the signals deserve.**

       `hasNext` is the service's own answer and is believed when present. An
       empty page ends it too, for a service that sends no `Link`.

       What is deliberately *not* here is "stop once as many have arrived as the
       count promised". That is what let the duplicate above end the loop early,
       and it is exactly the kind of shortcut that agrees with the right answer
       until the one moment it matters. The count is an *audit* below, never a
       terminator. */
    if (got.users.length === 0) ended = true;
    else if (got.hasNext === false) ended = true;
  }

  if (!ended) {
    /* The cap is a guard against a service that never stops, and reaching it
       means the list is certainly incomplete. Returning what was collected
       would be the fail-open version of the same bug this whole file is about. */
    throw new Error(
      `the account list did not end after ${MAX_PAGES} pages. Something is wrong with the ` +
        "Auth service's pagination; showing part of the list would be worse than showing none. " +
        "See src/store/admin-accounts.ts.",
    );
  }

  if (expected !== undefined && arrived.size < expected) {
    throw new Error(
      `the account list is short: the Auth service reports ${expected} accounts and ` +
        `${arrived.size} were read. Showing part of the list as if it were all of it is ` +
        "worse than showing none. See src/store/admin-accounts.ts.",
    );
  }
  return rows;
}

/** The id of one account object, or `""` for anything that has not got one. */
function idOf(raw: unknown): string {
  if (!raw || typeof raw !== "object") return "";
  const id = (raw as { id?: unknown }).id;
  return typeof id === "string" ? id : "";
}

/**
 * One account object from the Auth service, reduced to the six facts the page
 * shows.
 *
 * **This is a fence, and it is the one that matters now.** The response carries
 * far more than the old `select()` did — `phone`, `user_metadata`, `identities`
 * and whatever the service adds next — and none of it belongs on a page about
 * other people's accounts. The rule stated in `pg-admin.ts` and in
 * docs/project/admin.md is *counts and dates only*, and the place it is now
 * enforced is here: fields are named one at a time, so a field nobody has heard
 * of cannot arrive on the page by being added upstream.
 * `tests/admin-accounts.test.ts` feeds it a payload full of things that must
 * not come out the other side.
 *
 * `email_confirmed_at`, deliberately **not** `confirmed_at` — the latter is
 * Supabase's backwards-compatibility field meaning "email *or* phone was
 * confirmed", and the page prints "email unconfirmed" beneath an address, so
 * the wrong one labels a phone-confirmed account the opposite of the truth.
 * GPT Sol found that in the query this replaces; it survives the move.
 *
 * **Soft-deleted accounts are not accounts, and the API returns them.** The
 * query this replaced said `where deleted_at is null`, and dropping that on the
 * way to the API would have put deleted people back on the page. It is not
 * visible in a casual look at the response either: GoTrue omits `deleted_at`
 * entirely on a live account, so every field of every real row said the same
 * thing whether or not the code handled it. Measured on the local stack —
 * created an account, soft-deleted it, and the list still returned it, with
 * `deleted_at` set. That is the only way this could have been settled.
 *
 * Returns `undefined` for anything without a usable id, rather than a row with
 * an empty one. An object that is not an account should not become a line.
 */
export function accountFrom(raw: unknown): AccountRow | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const u = raw as Record<string, unknown>;
  const id = typeof u.id === "string" ? u.id : "";
  if (!id) return undefined;
  /* Present and non-empty means deleted. Absent is the normal case for a live
     account, so this must not treat "no field" as "deleted". */
  if (typeof u.deleted_at === "string" && u.deleted_at !== "") return undefined;
  return {
    id,
    email: typeof u.email === "string" ? u.email : null,
    createdAt: date(u.created_at),
    lastSignInAt: date(u.last_sign_in_at),
    emailConfirmedAt: date(u.email_confirmed_at),
    /* **Only the providers, never the object they came in.** `app_metadata` is
       writable through the admin API and Supabase's own examples put roles,
       plans and team ids in it, so what arrives there is not ours to predict.
       The page shows which providers are linked, so that is what crosses the
       boundary. */
    providers: providersOf(u.app_metadata),
  };
}

/**
 * The linked providers out of one `app_metadata`.
 *
 * GoTrue writes `providers: ["google"]`, and older rows have only the singular
 * `provider`. Both are read, and anything else yields an empty list rather than
 * a guess.
 *
 * Moved here from `pg-admin.ts` when the accounts stopped coming from a column,
 * so that the narrowing happens where the untrusted object arrives rather than
 * one layer further in.
 */
export function providersOf(meta: unknown): string[] {
  if (!meta || typeof meta !== "object") return [];
  const raw = (meta as { providers?: unknown }).providers;
  if (Array.isArray(raw)) return raw.filter((p): p is string => typeof p === "string");
  const one = (meta as { provider?: unknown }).provider;
  return typeof one === "string" ? [one] : [];
}

/**
 * A string date from the wire, or `null`.
 *
 * The service sends ISO-8601 and the old code path had `Date` objects from the
 * driver, so this converts rather than trusting: `mergeUsers` calls
 * `.toISOString()` on whatever it is given, and a string would throw there.
 * An unparseable value becomes `null` — the page draws that as "—", which is
 * the truth, where an `Invalid Date` would reach `toISOString` and throw the
 * whole page away over one bad field.
 */
function date(value: unknown): Date | null {
  if (typeof value !== "string" || value === "") return null;
  const at = new Date(value);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * The real page-fetcher: `GET /auth/v1/admin/users`, with the service-role key.
 *
 * **Server only, and it is the whole project's key.** It is already in the
 * production environment because Storage needs it (`blobs.ts`), and
 * `vercel-health.ts` checks it is set — so this route adds no credential that
 * was not already there. It must never reach the browser, and nothing in
 * `src/web/` may import this file; `tests/client-imports.test.ts` is what says
 * so by path.
 *
 * `apikey` **and** `Authorization`, which is not belt-and-braces: GoTrue reads
 * the bearer token for the caller's role and Supabase's gateway reads `apikey`
 * to route the request at all, and a request carrying only one of them fails
 * in a way that reads like the other problem.
 */
export function gotruePages(url: string, key: string): GetAccountPage {
  const base = url.replace(/\/+$/, "");
  return async (page, perPage) => {
    const res = await fetch(`${base}/auth/v1/admin/users?page=${page}&per_page=${perPage}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    if (!res.ok) {
      /* The status and nothing else. A body from an auth endpoint is not a
         thing to put in a log or an error message. */
      throw new Error(
        `the Auth service refused the account list (${res.status}). Check SUPABASE_URL and ` +
          "SUPABASE_SERVICE_ROLE_KEY name the project DATABASE_URL does.",
      );
    }
    const body = (await res.json()) as { users?: unknown };
    /* **A response we do not recognise is an error, not an empty list.** This
       read `Array.isArray(body.users) ? body.users : []`, which turns a changed
       envelope, an error body with a 200 on it, or a proxy's HTML into "there
       are no accounts" — a page that works and says nobody has signed up.
       GPT Sol, 2026-08-28. */
    if (!Array.isArray(body.users)) {
      throw new Error(
        "the Auth service's account list was not in the expected shape (no `users` array). " +
          "See src/store/admin-accounts.ts.",
      );
    }
    return {
      users: body.users,
      ...totalFrom(res.headers.get("x-total-count")),
      ...nextFrom(res.headers.get("link")),
    };
  };
}

/**
 * The service's own account count, if it sent one.
 *
 * Absent, blank or non-numeric all mean **"no count came"** rather than zero —
 * `Number("")` is `0`, and a zero here would make `listAccounts` conclude it
 * had read everything on an empty first page. The distinction is the whole
 * value of the check.
 */
/**
 * Whether the service says there is another page, from its `Link` header.
 *
 * GoTrue sends `</admin/users?page=2&per_page=1>; rel="next", …; rel="last"`,
 * and the presence of a `next` relation is the service's own answer to "is that
 * all of them" — better than any inference this end can make from a page size.
 *
 * A response with no `Link` at all returns `{}` rather than `false`: **absent is
 * not "no more"**, and treating it as one would end the listing after a single
 * page against anything that does not send the header.
 */
function nextFrom(header: string | null): { hasNext?: boolean } {
  if (header === null || header.trim() === "") return {};
  return { hasNext: /;\s*rel\s*=\s*"?next"?/i.test(header) };
}

function totalFrom(header: string | null): { total?: number } {
  if (header === null || header.trim() === "") return {};
  const n = Number(header);
  return Number.isInteger(n) && n >= 0 ? { total: n } : {};
}
