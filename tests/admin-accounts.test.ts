/**
 * The account list, and the two ways it can be quietly wrong.
 *
 * `src/store/admin-accounts.ts` replaced a `select()` on `auth.users` with the
 * Auth service's Admin API, because the database role the deployed server uses
 * has no grants into the `auth` schema — docs/project/admin.md. The move brings
 * two failures the query did not have, and this file is mostly about those:
 *
 * 1. **A short list that looks complete.** The service pages, defaults to 50 a
 *    page, and says nothing when it truncates. Somebody with 70 users saw 50
 *    and no sign anything was missing (supabase/auth-js#538). A page listing
 *    "everyone" while missing people is worse than a page that fails.
 * 2. **A wide object.** The response carries `phone`, `user_metadata`,
 *    `identities` and whatever is added upstream next. The old query could only
 *    return the columns it named; this one gets everything and must name what
 *    it keeps.
 *
 * Both are exercised against fakes, because neither can be reached from a real
 * project with two accounts on it — docs/reusable/silent-success.md, and see
 * `pages()` below for how the fake is built.
 */
import { describe, expect, it } from "vitest";

import {
  accountFrom,
  gotruePages,
  listAccounts,
  type AccountPage,
  type GetAccountPage,
} from "../src/store/admin-accounts.js";

/**
 * One fake account, and **every fake in this file is built by this function**.
 *
 * A hand-written object per test is how a test comes to pass against the bug it
 * was written for: the one the author typed happens to lack the field that
 * breaks things. One builder, overridden per test, means a change to the shape
 * reaches every case at once.
 */
function raw(id: string, over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    email: `${id}@example.test`,
    created_at: "2026-08-01T00:00:00.000Z",
    last_sign_in_at: "2026-08-20T09:30:00.000Z",
    email_confirmed_at: "2026-08-01T00:05:00.000Z",
    app_metadata: { provider: "google", providers: ["google"] },
    ...over,
  };
}

/**
 * A service holding `n` accounts, answering `perPage` at a time.
 *
 * `served` records what was asked for, so a test can assert the pagination
 * happened rather than only that the arithmetic came out right — the two are
 * different claims and only one of them is about the loop.
 *
 * `clamp` models a service that silently gives back fewer than asked for, which
 * is exactly what the 50-row default is.
 */
function pages(
  n: number,
  opts: { clamp?: number; total?: number | null; noLink?: boolean } = {},
) {
  const served: Array<{ page: number; perPage: number }> = [];
  const all = Array.from({ length: n }, (_, i) => raw(`u${i + 1}`));
  const get: GetAccountPage = async (page, perPage) => {
    served.push({ page, perPage });
    const size = Math.min(perPage, opts.clamp ?? perPage);
    const users = all.slice((page - 1) * size, page * size);
    const total = opts.total === null ? undefined : (opts.total ?? n);
    const out: AccountPage = {
      users,
      ...(total === undefined ? {} : { total }),
      /* The real service sends `Link … rel="next"` and this models it.
         `noLink` is the other half — a response with no `Link` at all, where
         the only safe way to learn there is no more is to be handed an empty
         page. Both are real and they terminate differently. */
      ...(opts.noLink ? {} : { hasNext: page * size < n }),
    };
    return out;
  };
  return { get, served };
}

describe("reading the whole account list", () => {
  it("returns every account when they fit in one page", async () => {
    const { get, served } = pages(3);
    const rows = await listAccounts(get);
    expect(rows.map((r) => r.id)).toEqual(["u1", "u2", "u3"]);
    expect(served).toHaveLength(1);
  });

  /**
   * **The regression test for the whole file.**
   *
   * The service is holding 120 accounts and hands back 50 at a time however
   * many are asked for. An implementation that issues one request and returns
   * what it gets — which is the obvious implementation, and the one the
   * supabase/auth-js report is about — returns 50 here and reports no problem.
   */
  it("follows the pages when the service gives back fewer than asked for", async () => {
    const { get, served } = pages(120, { clamp: 50 });
    const rows = await listAccounts(get);
    expect(rows).toHaveLength(120);
    expect(new Set(rows.map((r) => r.id)).size).toBe(120);
    /* Three requests, and the third one is what proves the loop asked again
       after a full page rather than stopping on a count it liked. */
    expect(served.map((s) => s.page)).toEqual([1, 2, 3]);
  });

  it("stops at the end rather than asking for ever, with no headers to help", async () => {
    /* Neither a total nor a `Link`, so nothing but an empty page can end this.
       The case matters because absent must not read as "no more": a service
       sending no `Link` would otherwise be listed one page deep. */
    const { get, served } = pages(100, { clamp: 50, total: null, noLink: true });
    const rows = await listAccounts(get);
    expect(rows).toHaveLength(100);
    /* Two full pages, then one empty one to learn there is no more. */
    expect(served.map((s) => s.page)).toEqual([1, 2, 3]);
  });

  it("believes the service when it says there is no next page", async () => {
    /* With a `Link` header the last full page ends the listing, so there is no
       extra empty request. Asserted on the request log rather than on the rows,
       because the rows are the same either way — the claim here is about what
       was asked for. */
    const { get, served } = pages(100, { clamp: 50 });
    await expect(listAccounts(get)).resolves.toHaveLength(100);
    expect(served.map((s) => s.page)).toEqual([1, 2]);
  });
});

/**
 * **The signup that lands between two pages.**
 *
 * GPT Sol found this reviewing the first version, 2026-08-28, and reproduced it
 * on 400 accounts: `rows=400, unique=399, u400 missing, u200 duplicated`.
 *
 * Offset pagination has no snapshot. A row inserted before page two shifts
 * everything after it by one, so page two repeats the last row of page one and
 * the account that should have been at the boundary is never returned. The
 * arrival count then *matches* — the duplicate made up the number — and a loop
 * that stops when enough have arrived stops one account short and reports
 * success.
 *
 * That is why the count is an audit and never a terminator, and why what is
 * counted is distinct ids.
 */
describe("pages that shift under a listing", () => {
  /** 30 accounts, and a 31st inserted at the front just before page two. */
  function shifting() {
    const before = Array.from({ length: 30 }, (_, i) => raw(`u${i + 1}`));
    let asked = 0;
    const get: GetAccountPage = async (page) => {
      asked++;
      /* The insert lands after page one has been served. `newcomer` at the
         front is what makes every later offset point one row too early. */
      const all = asked > 1 ? [raw("newcomer"), ...before] : before;
      const users = all.slice((page - 1) * 10, page * 10);
      return { users, total: 30, hasNext: page * 10 < all.length };
    };
    return get;
  }

  it("serves each account once, and does not lose the one at the end", async () => {
    const rows = await listAccounts(shifting());
    const ids = rows.map((r) => r.id);
    /* **The two symptoms, and they are the same bug.** The shift makes page two
       repeat the last row of page one; a loop that stops once thirty rows have
       *arrived* stops there, having returned `u10` twice and `u30` never. */
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("u30");
    expect(ids).toHaveLength(30);
  });

  it("keeps asking after the promised total has arrived", async () => {
    /* The mechanism, stated on its own so the assertion above cannot pass for
       an unrelated reason. Four requests for thirty accounts at ten a page is
       one more than the arithmetic suggests, and that fourth is where `u30`
       comes from. */
    const get = shifting();
    const served: number[] = [];
    await listAccounts(async (page, per) => {
      served.push(page);
      return get(page, per);
    });
    expect(served).toEqual([1, 2, 3, 4]);
  });

  /* **What this cannot fix, said plainly.** `newcomer` is inserted at the front
     after page one was served, so no later offset ever covers index 0 and it is
     simply not in this listing. That is inherent to offset pagination and no
     client-side loop can conjure it; it appears on the next load. The bug worth
     fixing was losing an account that *was* served-able, and asserting that
     `newcomer` came back would be asserting something untrue. */
});

/**
 * **When the two termination signals disagree.**
 *
 * Both cases below are GPT Sol's, found reviewing the first repair, 2026-08-28.
 * They are the same mistake in two places: treating an *absence* of information
 * as a definite "no more".
 */
describe("an explicit next-page signal beats everything else", () => {
  it("keeps going past an empty page that says there is more", async () => {
    /* A row deleted between requests can empty a page in the middle, and the
       service says so. Checking emptiness first — which is what the first
       repair did — ends the listing here and loses `b` without a word. */
    const gappy: GetAccountPage = async (page) => {
      if (page === 1) return { users: [raw("a")], hasNext: true };
      if (page === 2) return { users: [], hasNext: true };
      return { users: [raw("b")], hasNext: false };
    };
    const rows = await listAccounts(gappy);
    expect(rows.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("does not read an unparseable Link header as the end of the list", async () => {
    /* `nextFrom` said `false` for any non-empty header it did not recognise, so
       a proxy rewriting the header — or a format change — ended the listing
       after one page. The same fail-open as an unrecognised body, one layer
       out. Here the header is nonsense, so the flag must be unanswered and the
       empty page is what ends it. */
    const served: number[] = [];
    const weird: GetAccountPage = async (page) => {
      served.push(page);
      /* `hasNext` absent models what `nextFrom` now returns for junk. */
      return page === 1 ? { users: [raw("a")] } : { users: [] };
    };
    await expect(listAccounts(weird)).resolves.toHaveLength(1);
    expect(served).toEqual([1, 2]);
  });
});

describe("a list that is short is an error, not a page", () => {
  /**
   * The service says there are 120 and hands back 50 and then nothing.
   *
   * This is the shape of a real truncation — a page limit the client cannot
   * see, or a service that stops early — and the only reason it is catchable is
   * that the count came from outside the loop.
   */
  it("throws rather than returning part of the list", async () => {
    const short: GetAccountPage = async (page) => ({
      users: page === 1 ? Array.from({ length: 50 }, (_, i) => raw(`u${i}`)) : [],
      total: 120,
    });
    await expect(listAccounts(short)).rejects.toThrow(/short/);
  });

  it("says both numbers, because either one alone explains nothing", async () => {
    const short: GetAccountPage = async () => ({ users: [], total: 7 });
    await expect(listAccounts(short)).rejects.toThrow(/7/);
    await expect(listAccounts(short)).rejects.toThrow(/0 were read/);
  });

  /**
   * **A surplus is not a fault.** Somebody signing up while the pages are being
   * read makes the real list longer than the first page's count. Failing there
   * would take the admin page down for an ordinary event.
   */
  it("does not throw when more accounts arrive than the first page promised", async () => {
    const { get } = pages(5, { total: 3 });
    const rows = await listAccounts(get);
    expect(rows.length).toBeGreaterThanOrEqual(3);
  });

  it("returns the list unchecked when the service sent no count at all", async () => {
    /* Absent must not read as zero. `Number("")` is `0`, and a zero total would
       make an empty first page look like a complete answer. */
    const { get } = pages(4, { total: null });
    await expect(listAccounts(get)).resolves.toHaveLength(4);
  });
});

/**
 * **Soft-deleted accounts, which the API hands back and the query did not.**
 *
 * The `select()` this replaced said `where deleted_at is null`. The Admin API
 * has no such filter, and the gap is invisible in a casual look at a real
 * response: GoTrue omits `deleted_at` entirely on a live account, so every row
 * of a healthy project looks identical whether or not the code handles it.
 *
 * Settled by experiment on the local stack, 2026-08-28 — created an account,
 * soft-deleted it through `DELETE /admin/users/:id` with
 * `should_soft_delete: true`, and the listing still returned it with
 * `deleted_at` set, and `x-total-count` still counted it. Both halves below are
 * that measurement.
 */
describe("an account somebody deleted", () => {
  it("is not a row", () => {
    expect(accountFrom(raw("gone", { deleted_at: "2026-08-28T14:56:16.645868Z" }))).toBeUndefined();
  });

  it("is only deleted when the field is really there", () => {
    /* The control for the check above. A live account has no `deleted_at` at
       all, so a guard that read "absent" as "deleted" would empty the page —
       the opposite failure, and just as quiet. */
    expect(accountFrom(raw("live"))).toBeDefined();
    expect(accountFrom(raw("live", { deleted_at: null }))).toBeDefined();
    expect(accountFrom(raw("live", { deleted_at: "" }))).toBeDefined();
  });

  it("leaves the list short of the service's own count, and that is not an error", () => {
    /* **The trap this pair creates.** `x-total-count` counts deleted rows —
       measured — so the shortfall check cannot compare *kept* rows against it.
       If it did, the first account anybody deleted would take the whole page
       down with "the account list is short", on a page that was entirely
       correct. The comparison is against what arrived, not what survived. */
    const withDeleted: GetAccountPage = async (page) => ({
      users:
        page === 1
          ? [raw("a"), raw("b", { deleted_at: "2026-08-28T14:56:16.645868Z" }), raw("c")]
          : [],
      total: 3,
    });
    return expect(listAccounts(withDeleted)).resolves.toEqual([
      expect.objectContaining({ id: "a" }),
      expect.objectContaining({ id: "c" }),
    ]);
  });

  it("does not stop the pages early either", () => {
    /* The same number is the loop's exit condition, so getting it wrong here
       loses everybody on page two rather than raising anything at all. */
    const paged: GetAccountPage = async (page) => ({
      users:
        page === 1
          ? [raw("a"), raw("b", { deleted_at: "2026-08-28T14:56:16.645868Z" })]
          : page === 2
            ? [raw("c"), raw("d")]
            : [],
      total: 4,
    });
    return expect(listAccounts(paged)).resolves.toHaveLength(3);
  });
});

describe("what comes off one account object", () => {
  it("keeps the six facts the page shows", () => {
    const row = accountFrom(raw("abc"));
    expect(row).toBeDefined();
    expect(row?.id).toBe("abc");
    expect(row?.email).toBe("abc@example.test");
    expect(row?.createdAt?.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(row?.lastSignInAt?.toISOString()).toBe("2026-08-20T09:30:00.000Z");
    expect(row?.emailConfirmedAt?.toISOString()).toBe("2026-08-01T00:05:00.000Z");
    expect(row?.providers).toEqual(["google"]);
  });

  /**
   * **The fence, now that the source hands over everything.**
   *
   * The old `select()` could only return the columns it named, and
   * `tests/auth-users-fence.test.ts` pinned that list. The API has no such
   * ceiling: this is what replaces it. The payload below carries every kind of
   * thing that must not reach a page about other people's accounts, including
   * two that the real response really does contain.
   */
  it("keeps nothing else, whatever the service sends", () => {
    const row = accountFrom(
      raw("abc", {
        phone: "+447700900000",
        user_metadata: { full_name: "Someone Real", avatar_url: "https://example.test/a.png" },
        identities: [{ provider: "google", identity_data: { email: "abc@example.test" } }],
        encrypted_password: "$2a$10$notarealhash",
        app_metadata: {
          provider: "google",
          providers: ["google"],
          /* Real projects put authorization data here — Supabase's own examples
             use roles and plans — and none of it belongs on this page. */
          role: "superadmin",
          stripe_customer_id: "cus_leakedbilling",
        },
        confirmation_token: "tok_abc",
        recovery_token: "tok_rec",
        banned_until: "2027-01-01T00:00:00.000Z",
        is_super_admin: true,
      }),
    );
    expect(Object.keys(row ?? {}).sort()).toEqual([
      "createdAt",
      "email",
      "emailConfirmedAt",
      "id",
      "lastSignInAt",
      "providers",
    ]);
    /* And the whole row, serialised, mentions none of them. The key list alone
       would not be enough if anything were passed through opaquely — which is
       why `app_metadata` is narrowed to `providers` here rather than carried,
       and why the payload above puts a secret *inside* it. GPT Sol pointed out
       that an earlier version of this test claimed to do that and did not. */
    const text = JSON.stringify(row);
    for (const secret of [
      "900000",
      "Someone Real",
      "notarealhash",
      "tok_abc",
      "tok_rec",
      "superadmin",
      "cus_leakedbilling",
    ]) {
      expect(text, secret).not.toContain(secret);
    }
  });

  it("reads the email confirmation, not the one that also answers for a phone", () => {
    /* `confirmed_at` means "email *or* phone was confirmed". The page prints
       "email unconfirmed" beneath an address, so reading that field labels a
       phone-confirmed account the opposite of the truth. GPT Sol found this in
       the query this replaced; the mistake is just as available here. */
    const row = accountFrom(
      raw("abc", { email_confirmed_at: null, confirmed_at: "2026-08-01T00:00:00.000Z" }),
    );
    expect(row?.emailConfirmedAt).toBeNull();
  });

  it("is not a row without an id", () => {
    expect(accountFrom(raw("abc", { id: undefined }))).toBeUndefined();
    expect(accountFrom(raw("abc", { id: "" }))).toBeUndefined();
    expect(accountFrom(null)).toBeUndefined();
    expect(accountFrom("a string")).toBeUndefined();
  });

  it("turns an unusable date into nothing rather than into an Invalid Date", () => {
    /* `mergeUsers` calls `.toISOString()` on these. An `Invalid Date` throws
       there and takes the whole page with it over one bad field, where `null`
       draws as "—". */
    const row = accountFrom(raw("abc", { last_sign_in_at: "not a date", created_at: "" }));
    expect(row?.lastSignInAt).toBeNull();
    expect(row?.createdAt).toBeNull();
  });
});

/**
 * The one piece that does I/O, and the only one that reads a header.
 *
 * `gotruePages` was the untested half: `listAccounts` and `accountFrom` are
 * pure and covered above, and everything this function decides — is the
 * envelope the shape we expect, is there a next page, how many are there —
 * comes out of a `Response` and cannot be reached from either of them. GPT Sol
 * pointed at the fail-open in it, 2026-08-28.
 *
 * `fetch` is replaced rather than a server started. What is being checked is
 * the reading of a response, so a real socket would add a moving part without
 * adding a claim.
 */
describe("the request itself", () => {
  /** One fake `Response`, and every case below is built from it. */
  function reply(
    body: unknown,
    init: { status?: number; headers?: Record<string, string> } = {},
  ): typeof globalThis.fetch {
    return (async () =>
      new Response(typeof body === "string" ? body : JSON.stringify(body), {
        status: init.status ?? 200,
        headers: { "content-type": "application/json", ...(init.headers ?? {}) },
      })) as typeof globalThis.fetch;
  }

  async function withFetch<T>(f: typeof globalThis.fetch, run: () => Promise<T>): Promise<T> {
    const real = globalThis.fetch;
    globalThis.fetch = f;
    try {
      return await run();
    } finally {
      globalThis.fetch = real;
    }
  }

  const get = () => gotruePages("https://project.supabase.co", "service-role-key");

  it("reads the users, the count and the next-page flag", async () => {
    const page = await withFetch(
      reply(
        { users: [raw("a")] },
        {
          headers: {
            "x-total-count": "42",
            link: '</admin/users?page=2&per_page=200>; rel="next", </admin/users?page=9>; rel="last"',
          },
        },
      ),
      () => get()(1, 200),
    );
    expect(page.users).toHaveLength(1);
    expect(page.total).toBe(42);
    expect(page.hasNext).toBe(true);
  });

  it("says there is no next page when the Link header only names the last one", async () => {
    const page = await withFetch(
      reply({ users: [] }, { headers: { link: '</admin/users?page=3>; rel="last"' } }),
      () => get()(3, 200),
    );
    expect(page.hasNext).toBe(false);
  });

  it("leaves the next-page flag unanswered when the Link header makes no sense", async () => {
    /* **Not `false`.** Read as "finished", a rewritten or future-format header
       would end the listing after one page, silently. `false` is only for a
       header that really is a set of relations and has no `next` in it. */
    for (const junk of ["not-a-link", "<https://x/>", "garbage; foo=bar", "0"]) {
      const page = await withFetch(reply({ users: [raw("a")] }, { headers: { link: junk } }), () =>
        get()(1, 200),
      );
      expect(page.hasNext, junk).toBeUndefined();
    }
  });

  it("leaves the next-page flag unanswered when there is no Link header at all", async () => {
    /* **Absent is not "no more".** Read as `false`, a service that sends no
       `Link` would be listed exactly one page deep, silently. */
    const page = await withFetch(reply({ users: [raw("a")] }), () => get()(1, 200));
    expect(page.hasNext).toBeUndefined();
  });

  it("leaves the count unanswered rather than calling it zero", async () => {
    /* `Number("")` is `0`, and a zero total would make an empty first page look
       like a complete answer. */
    for (const header of ["", "  ", "not-a-number", "-1", "3.5"]) {
      const page = await withFetch(
        reply({ users: [] }, { headers: { "x-total-count": header } }),
        () => get()(1, 200),
      );
      expect(page.total, header).toBeUndefined();
    }
  });

  it("refuses a response that is not the shape we expect", async () => {
    /* **The fail-open this replaced.** `Array.isArray(body.users) ? … : []`
       turns a changed envelope, an error body served with a 200, or a proxy's
       HTML into "there are no accounts" — a page that works and says nobody has
       signed up. */
    for (const body of [{}, { users: null }, { users: { a: 1 } }, { error: "nope" }]) {
      await withFetch(reply(body), async () => {
        await expect(get()(1, 200)).rejects.toThrow(/shape/);
      });
    }
  });

  it("refuses a refusal, and does not put the body in the message", async () => {
    const err = await withFetch(
      reply({ msg: "invalid claim: sub", token: "leaked-token-value" }, { status: 401 }),
      async (): Promise<Error> => {
        try {
          await get()(1, 200);
          throw new Error("expected a refusal");
        } catch (e) {
          return e as Error;
        }
      },
    );
    expect(err.message).toContain("401");
    expect(err.message).not.toContain("leaked-token-value");
  });

  it("carries both headers, because the two are read by different things", async () => {
    /* GoTrue reads the bearer token for the caller's role; Supabase's gateway
       reads `apikey` to route the request at all. A request with one of them
       fails in a way that reads like the other problem. */
    let seen: Headers | undefined;
    const spy: typeof globalThis.fetch = async (_input, init) => {
      seen = new Headers(init?.headers);
      return new Response(JSON.stringify({ users: [] }), {
        headers: { "content-type": "application/json" },
      });
    };
    await withFetch(spy, () => get()(1, 200));
    expect(seen?.get("apikey")).toBe("service-role-key");
    expect(seen?.get("authorization")).toBe("Bearer service-role-key");
  });

  it("does not double the slash when the URL has a trailing one", async () => {
    let url = "";
    const spy: typeof globalThis.fetch = async (input) => {
      url = String(input);
      return new Response(JSON.stringify({ users: [] }), {
        headers: { "content-type": "application/json" },
      });
    };
    await withFetch(spy, () => gotruePages("https://project.supabase.co/", "k")(2, 50));
    expect(url).toBe("https://project.supabase.co/auth/v1/admin/users?page=2&per_page=50");
  });
});
