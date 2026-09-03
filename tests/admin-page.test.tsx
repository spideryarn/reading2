// @vitest-environment jsdom
/**
 * The users page, actually rendered — src/web/AdminPage.tsx.
 *
 * **Everything else about this feature is tested without a screen.** The gate
 * is a route test, the arithmetic is a pure function, the SQL is `.toSQL()`,
 * the types are a live query. None of them would notice a column that throws on
 * a `null`, an empty state that draws an empty grid, or an error with nothing to
 * press — and those are the three ways a page of numbers actually fails.
 *
 * So this mounts the real component against a stubbed `fetch` and asserts what
 * a reader would see. It is the durable half of a browser pass: the browser can
 * see the layout and this cannot, but this will still be here in six months.
 * Same shape and same reasoning as tests/offline-remount.test.tsx.
 *
 * Only the Supabase SDK and `fetch` are stubbed — the network, and the thing
 * that decides what comes back over it. Everything else is the real page:
 * TanStack, the columns, `relative-time`, `nuqs`.
 *
 * ## The bug this file found before anybody meant it to
 *
 * When it was first written, `await act(async () => root.render(<AdminUsersPage
 * />))` **never resolved** — every test in the file timed out, with nothing on
 * `console.error` and no stack to read. Rendered outside `act` the page was
 * perfect, and every part of it passed inside `act` on its own: the hook,
 * `useNow`, the columns, `useSortedTable`, `nuqs`, `AdminHome`, and every pair
 * of them tried. Only the whole page hung.
 *
 * It was a **render loop**, and the cause was one line copied from the shelf:
 * `const dir = rawDir ?? []` above the memo that builds the sorting state. A
 * fresh array every render is a changed dependency every render, so the memo
 * recomputed, TanStack saw new state, and round it went. `act` waits for React
 * to go quiet, so a loop is exactly the shape that makes it hang for ever
 * rather than fail — see docs/postmortems/260827e-shelf-render-loop.md, found on the
 * shelf and fixed in both places.
 *
 * Worth keeping because of what it says about this kind of test: it caught a
 * bug that no assertion in it was aiming at, and it caught it as a *timeout*,
 * which reads like a broken test rather than like broken code.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
/* `apiFetch` reaches for IndexedDB (the offline cache in lib/api.ts), which
   jsdom does not have — and the failure is a hang rather than a throw, so the
   symptom is every test in the file timing out with no error. Same import and
   same reason as tests/offline-remount.test.tsx. */
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_EMAIL_LOCAL, ADMIN_USER_ID_LOCAL, type AdminUser } from "../src/admin.js";

vi.mock("../src/web/lib/supabase.js", () => ({
  supabase: {
    auth: {
      getSession: async () => ({ data: { session: { access_token: "TOKEN" } } }),
      refreshSession: async () => ({ data: { session: null } }),
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    },
  },
  callbackUrl: () => "https://spideryarn.test/auth/callback",
  CALLBACK_PATH: "/auth/callback",
}));

const { AdminUsersPage } = await import("../src/web/AdminPage.js");

/* The page's sort lives in the address bar through nuqs, which needs its
   adapter above it — src/web/main.tsx wraps the whole app in the same one, and
   calls `enableHistorySync()` for the same reason: without it nuqs does not see
   a `pushState` we make ourselves, so a sort click would change the order and
   not the URL. Mounting the page without both would be testing a page the app
   does not have. */
enableHistorySync();

/**
 * Two accounts, deliberately lopsided.
 *
 * Bob has **nothing**: never signed in, never read anything, no email
 * confirmation, no providers, and a zero in every count. That is the row that
 * breaks a page — every cell on it is the absent case at once — and it is a
 * real state, since an account exists from the moment somebody signs up.
 */
const ALICE: AdminUser = {
  id: "aaaaaaaa-1111-4000-8000-000000000001",
  email: "alice@example.test",
  createdAt: "2026-08-01T10:00:00.000Z",
  lastSignInAt: "2026-08-26T10:00:00.000Z",
  emailConfirmedAt: "2026-08-01T10:01:00.000Z",
  providers: ["google"],
  articles: 12,
  archived: 3,
  uploads: 2,
  questions: 40,
  chats: 5,
  searches: 7,
  opens: 99,
  lastReadAt: "2026-08-27T09:00:00.000Z",
  spendNanos: 1_234_500_000,
  spendCalls: 42,
  /* Some of Alice's calls reported no cost, because that is the ordinary state
     of this ledger rather than an edge case, and the column has to draw the
     marker that says so. */
  spendUnpricedCalls: 7,
  spendMonth: "2026-08",
};

const BOB: AdminUser = {
  id: "bbbbbbbb-1111-4000-8000-000000000002",
  email: "bob@example.test",
  createdAt: "2026-08-20T10:00:00.000Z",
  providers: [],
  articles: 0,
  archived: 0,
  uploads: 0,
  questions: 0,
  chats: 0,
  searches: 0,
  opens: 0,
  spendNanos: 0,
  spendCalls: 0,
  spendUnpricedCalls: 0,
  spendMonth: "2026-08",
};

/**
 * The administrator, and a second account that is not.
 *
 * `ADMIN_USER_ID_LOCAL` rather than a made-up uuid: the marker asks `isAdmin`,
 * and a fixture id that only *looked* like the administrator's would test a
 * page that never draws the marker at all. `OTHER_ACCOUNT` is well-formed and
 * on nobody's list.
 */
const GREG: AdminUser = { ...ALICE, id: ADMIN_USER_ID_LOCAL, email: ADMIN_EMAIL_LOCAL };
const OTHER_ACCOUNT = "3f7b19d4-6c28-4e51-8a03-b5d7e2914c6f";

const jsonOk = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.unstubAllGlobals();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  /* The address is part of the page: nuqs reads the sort out of it, and a
     `?by=` left behind by the previous test would silently change what the
     next one is looking at. */
  history.replaceState(null, "", "/admin/users");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** Let React flush, and any promise already in flight resolve. */
async function settle(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

/**
 * Wait for something to become true, and **fail saying what never happened**.
 *
 * Not a `setTimeout` guess: a fixed sleep passes on this laptop and fails under
 * load, and — worse — goes green even when the thing never happened, because
 * the assertion that follows it is about something else.
 */
async function waitFor(what: string, ready: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (ready()) return;
    await new Promise((go) => setTimeout(go, 5));
  }
  throw new Error(`never happened: ${what}`);
}

/** Mount the page and let its one fetch land. */
async function show(): Promise<HTMLElement> {
  await act(async () => {
    root.render(
      <NuqsAdapter>
        <AdminUsersPage />
      </NuqsAdapter>,
    );
  });
  await settle();
  return host;
}

/**
 * The `admin` markers in the table.
 *
 * Matched on the marker's own text rather than on a class or a `title`,
 * and **exactly** — one of the fixtures below is `dev-admin@spideryarn.local`,
 * so a `includes("admin")` here would find the address and pass for the wrong
 * reason.
 */
function markers(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>("tbody span")].filter(
    (s) => (s.textContent ?? "").trim() === "admin",
  );
}

/** Every cell of the table, row by row, as text. */
function rows(el: HTMLElement): string[][] {
  return [...el.querySelectorAll("tbody tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => (td.textContent ?? "").trim()),
  );
}

describe("the users page", () => {
  it("draws a row per account, with the counts in it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOk({ users: [ALICE, BOB] })));
    const el = await show();

    const table = rows(el);
    expect(table).toHaveLength(2);
    expect(el.textContent).toContain("alice@example.test");
    expect(el.textContent).toContain("bob@example.test");
    expect(el.textContent).toContain("2 accounts");
    // Alice's numbers, all of them, in the row rather than anywhere on the page.
    const alice = table.find((r) => r[0]?.includes("alice@example.test")) ?? [];
    expect(alice.join("|")).toContain("12");
    expect(alice.join("|")).toContain("40");
  });

  it("draws exactly as many rows as it says there are accounts", async () => {
    /* **A browser screenshot showed "6 accounts" above five rows**, taken while
       another agent's HMR was churning the page, and the honest answer to that
       is a test rather than a squint. Six accounts, one of them with no sortable
       value in the default column — which is the case `sinkLast` moves about,
       and the one where a row could plausibly be lost rather than reordered. */
    const many = [
      ALICE,
      BOB,
      ...[3, 4, 5, 6].map((n) => ({
        ...BOB,
        id: `cccccccc-1111-4000-8000-00000000000${n}`,
        email: `person${n}@example.test`,
        // The last one has no sign-up date at all: unsortable, and sunk.
        ...(n === 6 ? { createdAt: "" } : { createdAt: `2026-08-0${n}T10:00:00.000Z` }),
      })),
    ];
    vi.stubGlobal("fetch", vi.fn(async () => jsonOk({ users: many })));
    const el = await show();

    expect(el.textContent).toContain("6 accounts");
    expect(rows(el)).toHaveLength(6);
    // And every one of them is a different account, rather than one drawn twice.
    expect(new Set(rows(el).map((r) => r[0])).size).toBe(6);
  });

  it("says something in every cell an empty account leaves blank", async () => {
    /* **The row that breaks a page of numbers.** An empty cell reads as data
       that failed to load; "never signed in" is a fact. Every absent value has
       to draw *something* — an em dash with a reason on its `title`. */
    vi.stubGlobal("fetch", vi.fn(async () => jsonOk({ users: [BOB] })));
    const el = await show();

    const [bob = []] = rows(el);
    expect(bob.length).toBeGreaterThan(5);
    for (const [i, cell] of bob.entries()) {
      expect(cell, `cell ${i} is empty`).not.toBe("");
      for (const bad of ["NaN", "undefined", "Invalid Date", "[object Object]"]) {
        expect(cell, `cell ${i}`).not.toContain(bad);
      }
    }
    expect(el.textContent).toContain("—");
    expect(el.querySelector('[title="Never signed in"]')).toBeTruthy();
  });

  it("puts the exact timestamp on a date, not just how long ago", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOk({ users: [ALICE] })));
    const el = await show();
    /* "3 days ago" is the readable answer and "when exactly?" is the next
       question. `exactly()` formats to the reader's locale, so the assertion is
       that the title is *some* other rendering rather than a fixed string. */
    const titled = [...el.querySelectorAll("tbody span[title]")].map((s) => s.getAttribute("title"));
    expect(titled.some((t) => t?.includes("2026"))).toBe(true);
  });

  it("marks the administrator's own row, and nobody else's", async () => {
    /* Greg, 2026-09-03: *"also indicate if a row is an admin user or not"*. The
       marker asks `isAdmin`, which is the id list `/api/admin/*` itself
       compares against — so an unmarked row is an account this page would
       refuse, rather than a second opinion about who Greg is. */
    vi.stubGlobal("fetch", vi.fn(async () => jsonOk({ users: [ALICE, GREG] })));
    const el = await show();

    expect(markers(el)).toHaveLength(1);
    const marked = markers(el)[0]?.closest("tr");
    expect(marked?.textContent).toContain(GREG.email);
    expect(marked?.textContent).not.toContain(ALICE.email);
  });

  it("draws two rows for two accounts on one address, and marks the one that gets in", async () => {
    /* **A rendering case, not a diagnosis.** Two accounts on one address is
       unusual — Supabase links a verified OAuth identity to the existing
       account of the same address — but it is possible through SSO, an admin
       API call or old data, and it is the one shape where a reader could count
       *people* and the page counts *accounts*. What is asserted is only what
       the page does with it: two rows, a count that says two, and a marker
       saying which of them this app lets in. GPT Sol, 2026-09-03, for the
       correction to what this fixture may claim. */
    const TWIN: AdminUser = { ...BOB, id: OTHER_ACCOUNT, email: GREG.email };
    vi.stubGlobal("fetch", vi.fn(async () => jsonOk({ users: [GREG, TWIN] })));
    const el = await show();

    expect(rows(el)).toHaveLength(2);
    expect(el.textContent).toContain("2 accounts");
    expect(markers(el)).toHaveLength(1);
  });

  it("says an address is unconfirmed even when no provider is recorded", async () => {
    /* The note used to live behind `providers.length > 0`, so an account with
       neither drew nothing at all under its address — the row with least else
       to say about it. Its own small bug, found on the way to another. */
    expect(BOB.providers).toEqual([]);
    expect(BOB.emailConfirmedAt).toBeUndefined();
    vi.stubGlobal("fetch", vi.fn(async () => jsonOk({ users: [BOB] })));
    const el = await show();

    expect(el.textContent).toContain("email unconfirmed");
  });

  it("says it of an unconfirmed address only", async () => {
    /* The control the assertion above needs to mean anything: an account with
       no providers and a *confirmed* address must draw no such line. Without
       this, "always say it" would pass the test above and be wrong. GPT Sol
       asked for it, 2026-09-03. */
    const CONFIRMED: AdminUser = { ...BOB, emailConfirmedAt: "2026-08-20T10:01:00.000Z" };
    vi.stubGlobal("fetch", vi.fn(async () => jsonOk({ users: [CONFIRMED] })));
    const el = await show();

    expect(rows(el)).toHaveLength(1);
    expect(el.textContent).not.toContain("unconfirmed");
  });

  it("counts the rows in the table, and the count is read off the page to prove it", async () => {
    /* **The invariant Greg asked for, checked where it can be seen.** The page
       counts `sorted`, the list the table is drawn from; only the DOM can say
       whether that became `<tr>`s, so this reads the number back out of the
       words and compares it with the rows themselves rather than with the
       fixture.

       Three accounts, one of them with no sign-up date at all — the row
       `sinkLast` moves to the bottom, and so the one moment in the render where
       a row is put somewhere else and could plausibly be put nowhere. */
    const NEVER: AdminUser = { ...BOB, id: OTHER_ACCOUNT, email: "nobody@example.test", createdAt: "" };
    vi.stubGlobal("fetch", vi.fn(async () => jsonOk({ users: [ALICE, BOB, NEVER] })));
    const el = await show();

    const label = [...el.querySelectorAll("span")]
      .map((s) => (s.textContent ?? "").trim())
      .find((t) => /^\d+ accounts?$/.test(t));
    expect(label).toBeDefined();
    expect(Number.parseInt(label ?? "", 10)).toBe(rows(el).length);
  });

  it("shows a failure as words, and still offers a way to retry", async () => {
    /* The first load failing used to leave the reader with a message and
       nothing to press, because the controls were drawn only once there were
       rows. GPT Sol found it, 2026-08-27. */
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: "nope [db-failed]" }), { status: 500 })),
    );
    const el = await show();

    expect(el.textContent).toContain("nope [db-failed]");
    expect(el.querySelector("table")).toBeNull();
    expect(el.querySelector('[aria-label="Refresh the user list"]')).toBeTruthy();
  });

  it("says the numbers are stale when a refresh fails over a list it already had", async () => {
    /* The hook keeps the old rows deliberately — throwing away the only figures
       we have because a retry failed is worse. That is only right if the page
       says so; otherwise the error sits above a table that looks current. */
    const fetches = vi
      .fn()
      .mockResolvedValueOnce(jsonOk({ users: [ALICE] }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "gone away" }), { status: 503 }));
    vi.stubGlobal("fetch", fetches);
    const el = await show();
    expect(rows(el)).toHaveLength(1);

    const refresh = el.querySelector<HTMLButtonElement>('[aria-label="Refresh the user list"]');
    await act(async () => refresh?.click());
    await settle();
    await waitFor("the failed refresh was reported", () =>
      (el.textContent ?? "").includes("Refresh failed"),
    );

    expect(el.textContent).toContain("Refresh failed, so these are the previous numbers.");
    // And the numbers are still there rather than blanked.
    expect(rows(el)).toHaveLength(1);
  });

  it("does not draw an empty grid when nothing comes back", async () => {
    /* An empty list is not an answer this page can honestly get — whoever is
       reading it is an account — so it is a symptom rather than a state, and it
       says so. */
    vi.stubGlobal("fetch", vi.fn(async () => jsonOk({ users: [] })));
    const el = await show();
    expect(el.querySelector("table")).toBeNull();
    expect(el.textContent).toContain("should not be possible");
  });

  it("reorders when a sort chip is pressed, and says so in the address", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonOk({ users: [ALICE, BOB] })));
    const el = await show();

    const chip = [...el.querySelectorAll("button")].find((b) =>
      b.getAttribute("aria-label")?.startsWith("Articles"),
    );
    expect(chip, "there is an Articles chip").toBeTruthy();

    const before = rows(el).map((r) => r[0]);
    await act(async () => chip?.click());
    await settle();
    await waitFor("the order changed", () => rows(el)[0]?.[0] !== before[0]);

    /* Descending first for a count, so Alice's 12 comes above Bob's 0 — and the
       default sort is by sign-up date, which puts Bob first. If the order did
       not change, the click did nothing and the URL below would be the only
       evidence, which is exactly the kind of test that passes over a dead
       control. */
    expect(rows(el).map((r) => r[0])).not.toEqual(before);
    expect(rows(el)[0]?.[0]).toContain("alice@example.test");
    expect(location.search).toContain("by=articles");
  });
});
