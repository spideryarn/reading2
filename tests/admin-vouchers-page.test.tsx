// @vitest-environment jsdom
/**
 * `/admin/vouchers`, actually rendered — src/web/AdminVouchersPage.tsx, plan
 * 261001m stage 2.
 *
 * Only the Supabase SDK and `fetch` are stubbed, as in
 * tests/admin-page.test.tsx. What is pinned: the rows the server sends are the
 * rows on screen, each in its own status; Revoke sends exactly
 * `PATCH /api/admin/vouchers/:id { revoked: true }`; the address is editable
 * only while a voucher waits; and a refusal from the server reaches the page in
 * its own words.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

const { AdminVouchersPage } = await import("../src/web/AdminVouchersPage.js");
const { useAdminVouchers } = await import("../src/web/useAdminVouchers.js");
const { SignedInReader } = await import("../src/web/lib/made-for.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const WAITING = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const CLAIMED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";
const REVOKED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3";

const VOUCHERS = [
  {
    id: WAITING,
    email: "waiting@example.test",
    articles: 20,
    note: "met at the conference",
    recipientNote: "Lovely to meet you at the conference.",
    recipientName: "Ada Lovelace",
    createdAt: "2026-10-01T10:00:00Z",
    createdBy: "admin",
    updatedAt: "2026-10-01T10:00:00Z",
    claimedBy: null,
    claimedAt: null,
    revokedAt: null,
    claimantEmail: null,
    starter: null,
    emails: { gift: null, claimed: null },
  },
  {
    id: CLAIMED,
    email: "claimed@example.test",
    articles: 10,
    note: null,
    recipientNote: null,
    recipientName: null,
    createdAt: "2026-09-20T10:00:00Z",
    createdBy: "admin",
    updatedAt: "2026-09-21T10:00:00Z",
    claimedBy: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    claimedAt: "2026-09-21T10:00:00Z",
    revokedAt: null,
    claimantEmail: "claimed-now@example.test",
    claimant: { kind: "free", used: 4, limit: 13, remaining: 9, lapsed: false },
    starter: null,
    emails: { gift: null, claimed: null },
  },
  {
    id: REVOKED,
    email: "revoked@example.test",
    articles: 5,
    note: null,
    recipientNote: null,
    recipientName: null,
    createdAt: "2026-09-10T10:00:00Z",
    createdBy: "admin",
    updatedAt: "2026-09-11T10:00:00Z",
    claimedBy: null,
    claimedAt: null,
    revokedAt: "2026-09-11T10:00:00Z",
    claimantEmail: null,
    starter: null,
    emails: { gift: null, claimed: null },
  },
];

type Call = { method: string; url: string; body: unknown };
let calls: Call[];
let patchAnswer: { status: number; body: unknown };
/** Status 0 is a network failure: `fetch` throws. */
let postAnswer: { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
let retryAnswer: { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
let listAnswer: unknown[];
/** What `GET /api/library` answers: the administrator's own shelf, for the starter picker. */
let shelfAnswer: unknown[];

/** A shelf row with what the picker reads, and what the shelf's cache insists on. */
const shelfRow = (over: { readonly slug: string; readonly [field: string]: unknown }) => ({
  title: "Untitled",
  addedAt: "2026-10-01T10:00:00Z",
  words: 1000,
  minutes: 5,
  blocks: 10,
  parts: 1,
  sections: 1,
  comments: 0,
  sourceReusable: true,
  opens: 0,
  has: { arc: false, tweets: false, glossary: false },
  processing: "full",
  ...over,
});

/* Out of order, so "newest first" is the picker's doing. */
const SHELF = [
  shelfRow({ slug: "the-bitter-lesson", title: "The Bitter Lesson", addedAt: "2026-10-05T10:00:00Z", privateLinkOn: true }),
  shelfRow({ slug: "another-one", title: "Another", addedAt: "2026-10-01T10:00:00Z", visibility: "public" }),
  shelfRow({ slug: "some-paper", title: "Some Paper", addedAt: "2026-10-06T10:00:00Z" }),
  shelfRow({ slug: "abstract-only", title: "Abstract Only", addedAt: "2026-10-07T10:00:00Z", processing: "minimal" }),
];

beforeEach(() => {
  calls = [];
  patchAnswer = { status: 200, body: { ok: true } };
  postAnswer = { status: 201, body: { id: "new", email: "queued" } };
  retryAnswer = { status: 202, body: { id: "x", email: "sending" } };
  listAnswer = VOUCHERS;
  shelfAnswer = SHELF;
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const json = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (method === "PATCH") return json(patchAnswer.status, patchAnswer.body);
    if (method === "POST" && url.includes("/retry")) {
      const answer = await retryAnswer;
      return json(answer.status, answer.body);
    }
    if (method === "POST") {
      const answer = await postAnswer;
      if (answer.status === 0) throw new TypeError("Failed to fetch");
      return json(answer.status, answer.body);
    }
    if (url.startsWith("/api/library")) return json(200, { articles: shelfAnswer });
    /* The *Author gifts* section's own read (plan 261009u); its suite is tests/admin-author-gifts.test.tsx. */
    if (url === "/api/admin/author-gifts") return json(200, { gifts: [] });
    return json(200, { vouchers: listAnswer });
  }) as typeof fetch;
});

let host: HTMLDivElement;
let root: Root;

async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  /* Signed in, as App draws every admin page: the starter picker reads this reader's shelf. */
  await act(async () =>
    root.render(
      <SignedInReader.Provider value="reader-1">
        <AdminVouchersPage />
      </SignedInReader.Provider>,
    ),
  );
  for (let i = 0; i < 50 && !host.querySelector("tbody tr"); i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
  }
}

async function settle() {
  for (let i = 0; i < 10; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
  }
}

const rowFor = (email: string) =>
  [...host.querySelectorAll("tbody tr")].find((tr) => tr.textContent?.includes(email)) as
    | HTMLTableRowElement
    | undefined;

const buttonIn = (el: Element | undefined, label: string) =>
  [...(el?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === label);

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("/admin/vouchers", () => {
  it("draws one row per voucher, each with its status", async () => {
    await mount();
    expect(host.querySelectorAll("tbody tr")).toHaveLength(3);
    expect(rowFor("waiting@example.test")?.textContent).toContain("Waiting for sign-up");
    expect(rowFor("waiting@example.test")?.textContent).toContain("met at the conference");
    const claimed = rowFor("claimed@example.test")?.textContent ?? "";
    expect(claimed).toContain("Claimed by claimed-now@example.test");
    expect(claimed).toContain("21 September 2026");
    expect(claimed).toMatch(/4 added.*free allowance 13.*9 further private articles/);
    expect(claimed).not.toContain("used of");
    expect(rowFor("revoked@example.test")?.textContent).toContain("Revoked");
  });

  /**
   * The browser regression of 2026-10-01, the same class DataTable met on
   * 2026-09-28 (src/web/lib/DataTable.tsx § the scroll box): the caption and
   * the Actions header are `sr-only`, which is `position: absolute`, and with
   * no positioned ancestor they were laid out against the table's full width
   * instead of being clipped by the scroll box — so the *page* scrolled
   * sideways by 336px at 390. jsdom has no layout, so this pins the class that
   * fixes it; the Playwright measurement in plan 261001m's Log is the evidence.
   */
  it("keeps the table's scroll box positioned, so sr-only text cannot widen the page", async () => {
    await mount();
    const box = host.querySelector("table")?.parentElement;
    expect(box?.className).toMatch(/\btw:overflow-x-auto\b/);
    expect(box?.className).toMatch(/\btw:relative\b/);
  });

  /* Plan 261006h: the arrow keys scroll whatever has focus. jsdom lays nothing
     out, so the two widths are stand-ins. */
  for (const [what, content, expected] of [
    ["makes the table's box a named tab stop when the table is wider than it", 900, { tabindex: "0", role: "region", name: "Every gift voucher, newest first" }],
    ["does not make the table's box a tab stop when the table fits", 360, { tabindex: null, role: null, name: null }],
  ] as const) {
    it(what, async () => {
      const isBox = (el: Element) => el === host?.querySelector("table")?.parentElement;
      vi.spyOn(Element.prototype, "scrollWidth", "get").mockImplementation(function (this: Element) {
        return isBox(this) ? content : 0;
      });
      vi.spyOn(Element.prototype, "clientWidth", "get").mockImplementation(function (this: Element) {
        return isBox(this) ? 360 : 0;
      });
      try {
        await mount();
        /* The list arrives after the first paint; let the box be measured with it in. */
        await settle();
        const box = host.querySelector("table")?.parentElement;
        expect({
          tabindex: box?.getAttribute("tabindex") ?? null,
          role: box?.getAttribute("role") ?? null,
          name: box?.getAttribute("aria-label") ?? null,
        }).toEqual(expected);
      } finally {
        vi.restoreAllMocks();
      }
    });
  }

  it("sends the right PATCH on Revoke, and reads the list again", async () => {
    await mount();
    const before = calls.length;
    await act(async () => buttonIn(rowFor("claimed@example.test"), "Revoke")?.click());
    await settle();
    const patch = calls.slice(before).find((c) => c.method === "PATCH");
    expect(patch).toEqual({
      method: "PATCH",
      url: `/api/admin/vouchers/${CLAIMED}`,
      body: { revoked: true },
    });
    expect(calls.slice(before).some((c) => c.method === "GET")).toBe(true);
  });

  it("offers Restore on a revoked voucher", async () => {
    await mount();
    await act(async () => buttonIn(rowFor("revoked@example.test"), "Restore")?.click());
    await settle();
    expect(calls.find((c) => c.method === "PATCH")).toEqual({
      method: "PATCH",
      url: `/api/admin/vouchers/${REVOKED}`,
      body: { revoked: false },
    });
  });

  it("lets the address change only while a voucher waits", async () => {
    await mount();
    const waiting = rowFor("waiting@example.test");
    await act(async () => buttonIn(waiting, "Edit")?.click());
    const email = waiting?.querySelector('input[type="email"]');
    expect(email).not.toBeNull();
    expect(document.activeElement).toBe(email);
    await act(async () => buttonIn(waiting, "Cancel")?.click());
    expect(document.activeElement).toBe(buttonIn(waiting, "Edit"));

    await act(async () => buttonIn(rowFor("claimed@example.test"), "Edit")?.click());
    const editing = rowFor("claimed@example.test");
    expect(editing?.querySelector('input[type="number"]')).not.toBeNull();
    expect(editing?.querySelector('input[type="email"]')).toBeNull();
  });

  it("shows the note to them, and lets it be edited without pretending that resends it", async () => {
    await mount();
    const waiting = rowFor("waiting@example.test");
    expect(waiting?.textContent).toContain("Lovely to meet you at the conference.");
    await act(async () => buttonIn(waiting, "Edit")?.click());
    const area = waiting?.querySelector<HTMLTextAreaElement>('textarea[aria-label="Note to them"]');
    expect(area?.value).toBe("Lovely to meet you at the conference.");
    expect(waiting?.textContent).toContain("Changing it does not resend");

    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(area, "Better words.");
      area?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonIn(waiting, "Save")?.click());
    await settle();
    expect(calls.find((c) => c.method === "PATCH")?.body).toEqual({ recipientNote: "Better words." });
  });

  it("shows their name under the address, and Edit changes it and sends only that", async () => {
    /* Plan 261007f. */
    await mount();
    const waiting = rowFor("waiting@example.test");
    const firstCell = waiting?.querySelector("td");
    expect(firstCell?.textContent).toBe("waiting@example.testAda Lovelace");
    expect(rowFor("claimed@example.test")?.querySelector("td")?.textContent).toBe("claimed@example.test");

    await act(async () => buttonIn(waiting, "Edit")?.click());
    const name = firstCell?.querySelector<HTMLInputElement>('input[aria-label="Their name"]');
    expect(name?.value).toBe("Ada Lovelace");
    /* Native maxLength counts UTF-16 units, while the route and Postgres count
       Unicode code points. It would stop a valid 80-emoji name at 40. */
    expect(name?.hasAttribute("maxlength")).toBe(false);
    expect(waiting?.textContent).toContain("The same goes for their name.");

    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(name, " Ada ");
      name?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonIn(waiting, "Save")?.click());
    await settle();
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ recipientName: "Ada" }]);

    /* Emptied, it is sent as none; a claimed voucher's name can change too. */
    calls.length = 0;
    /* The row is held, not found again: while it is edited its address is in
       a box, so `rowFor` cannot see it. */
    await act(async () => buttonIn(waiting, "Edit")?.click());
    const again = waiting?.querySelector<HTMLInputElement>('input[aria-label="Their name"]');
    await act(async () => {
      setter?.call(again, "  ");
      again?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonIn(waiting, "Save")?.click());
    await settle();
    expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ recipientName: null }]);

    await act(async () => buttonIn(rowFor("claimed@example.test"), "Edit")?.click());
    expect(rowFor("claimed@example.test")?.querySelector('input[aria-label="Their name"]')).not.toBeNull();
  });

  it("refuses an over-limit raw name in Edit instead of trimming it into acceptance", async () => {
    await mount();
    const waiting = rowFor("waiting@example.test");
    await act(async () => buttonIn(waiting, "Edit")?.click());
    const name = waiting?.querySelector<HTMLInputElement>('input[aria-label="Their name"]');
    const raw = `${"x".repeat(80)} `;
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(name, raw);
      name?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonIn(waiting, "Save")?.click());
    await settle();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
    expect(waiting?.textContent).toContain("recipientName must be at most 80 characters.");
  });

  it("does not PATCH when only invisible formatting differs from the stored name", async () => {
    await mount();
    const waiting = rowFor("waiting@example.test");
    await act(async () => buttonIn(waiting, "Edit")?.click());
    const name = waiting?.querySelector<HTMLInputElement>('input[aria-label="Their name"]');
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter?.call(name, "Ada Lovelace\u202e");
      name?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => buttonIn(waiting, "Save")?.click());
    await settle();
    expect(calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });

  it("keeps every text field at a non-zooming size on a coarse pointer", async () => {
    await mount();
    await act(async () => buttonIn(rowFor("waiting@example.test"), "Edit")?.click());

    const fields = [...host.querySelectorAll<HTMLInputElement>('input[type="email"], input[type="number"], input[type="text"]')];
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(field.className, field.getAttribute("aria-label") ?? field.id).toContain(
        "tw:any-pointer-coarse:text-base",
      );
    }
  });

  it("shows the server's refusal in its own words", async () => {
    patchAnswer = { status: 409, body: { error: "That voucher has been claimed." } };
    await mount();
    await act(async () => buttonIn(rowFor("claimed@example.test"), "Revoke")?.click());
    await settle();
    expect(host.textContent).toContain("That voucher has been claimed.");
  });

  it("does not let an older read overwrite the refresh after a write", async () => {
    let answerFirstRead: ((response: Response) => void) | null = null;
    let reads = 0;
    const fresh = [{ ...VOUCHERS[0], email: "fresh@example.test" }];
    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      if (method === "POST") return Promise.resolve(new Response('{"id":"new"}', { status: 201 }));
      reads += 1;
      if (reads === 1) {
        return new Promise<Response>((resolve) => {
          answerFirstRead = resolve;
        });
      }
      return Promise.resolve(
        new Response(JSON.stringify({ vouchers: fresh }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    }) as typeof fetch;

    function Harness() {
      const state = useAdminVouchers();
      return (
        <>
          <button type="button" onClick={() => void state.create({ email: "fresh@example.test", articles: 20, note: null, recipientNote: null, recipientName: null, starterSlug: null })}>
            Create
          </button>
          <span>{state.vouchers?.map((voucher) => voucher.email).join(",") ?? "loading"}</span>
        </>
      );
    }

    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(<Harness />));
    await settle();
    expect(reads).toBe(1);

    await act(async () => host.querySelector("button")?.click());
    await settle();
    expect(host.textContent).toContain("fresh@example.test");

    await act(async () => {
      answerFirstRead?.(
        new Response(JSON.stringify({ vouchers: VOUCHERS }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    });
    await settle();
    expect(host.textContent).toContain("fresh@example.test");
  });

  describe("its emails", () => {
    const GIFT_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
    const NOTICE_ID = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";
    const delivery = (over: Record<string, unknown>) => ({
      id: GIFT_ID,
      kind: "gift",
      status: "sent",
      attempts: 1,
      detail: null,
      updatedAt: "2026-10-01T16:20:00Z",
      attemptStartedAt: "2026-10-01T16:19:59Z",
      retryable: false,
      ...over,
    });
    const withEmails = (gift: unknown, claimed: unknown = null) => [
      { ...VOUCHERS[1], emails: { gift, claimed } },
    ];
    const statusCell = () => rowFor("claimed@example.test")?.querySelectorAll("td")[5];

    it("says an email was sent, and when", async () => {
      listAnswer = withEmails(delivery({}), delivery({ id: NOTICE_ID, kind: "claimed" }));
      await mount();
      const text = statusCell()?.textContent ?? "";
      expect(text).toMatch(/Email to them: sent \S/);
      expect(text).toMatch(/Email to you: sent \S/);
      expect(text).toContain("2026");
    });

    it("says why one was not sent, or failed", async () => {
      listAnswer = withEmails(
        delivery({ status: "skipped", detail: "not production" }),
        delivery({ id: NOTICE_ID, kind: "claimed", status: "failed", detail: "Resend answered 422" }),
      );
      await mount();
      const text = statusCell()?.textContent ?? "";
      expect(text).toContain("Email to them: not sent (not production)");
      expect(text).toContain("Email to you: failed (Resend answered 422)");
    });

    it("does not claim a thrown request definitely failed", async () => {
      listAnswer = withEmails(
        delivery({ status: "failed", detail: "request outcome unknown (TimeoutError)", retryable: true }),
      );
      await mount();
      const text = statusCell()?.textContent ?? "";
      expect(text).toContain("request outcome unknown (TimeoutError)");
      expect(text).toContain("may or may not have gone");
    });

    it("says waiting and sending, and warns when a send has been stuck for over ten minutes", async () => {
      const fresh = new Date(Date.now() - 60_000).toISOString();
      listAnswer = withEmails(
        delivery({ status: "queued", attemptStartedAt: null }),
        delivery({ id: NOTICE_ID, kind: "claimed", status: "sending", attemptStartedAt: fresh }),
      );
      await mount();
      let text = statusCell()?.textContent ?? "";
      expect(text).toContain("Email to them: waiting to send");
      expect(text).toContain("Email to you: sending…");
      expect(text).not.toContain("may or may not have gone");

      act(() => root.unmount());
      host.remove();
      const stale = new Date(Date.now() - 11 * 60_000).toISOString();
      listAnswer = withEmails(delivery({ status: "sending", attemptStartedAt: stale }));
      await mount();
      text = statusCell()?.textContent ?? "";
      expect(text).toContain("Email to them: sending…");
      expect(text).toContain("may or may not have gone");
    });

    it("offers Retry only where the server says it may be retried", async () => {
      listAnswer = withEmails(
        delivery({ status: "failed", detail: "Resend answered 500", retryable: true }),
        delivery({ id: NOTICE_ID, kind: "claimed", status: "sent", retryable: false }),
      );
      await mount();
      const retries = [...(statusCell()?.querySelectorAll("button") ?? [])].filter(
        (b) => b.textContent?.trim() === "Retry",
      );
      expect(retries).toHaveLength(1);
    });

    it("posts Retry to that email's route, once, and reads the list again", async () => {
      listAnswer = withEmails(delivery({ status: "failed", detail: "Resend answered 500", retryable: true }));
      let answer: (value: { status: number; body: unknown }) => void = () => {};
      retryAnswer = new Promise((resolve) => {
        answer = resolve;
      });
      await mount();
      const before = calls.length;
      const retry = buttonIn(statusCell(), "Retry");
      await act(async () => {
        /* Both invocations happen before React can draw `disabled`. */
        retry?.click();
        retry?.click();
      });
      await settle();
      expect(buttonIn(statusCell(), "Retry")?.disabled).toBe(true);
      const posts = calls.slice(before).filter((c) => c.method === "POST");
      expect(posts).toEqual([
        { method: "POST", url: `/api/admin/voucher-emails/${GIFT_ID}/retry`, body: undefined },
      ]);
      await act(async () => answer({ status: 202, body: { id: GIFT_ID, email: "sending" } }));
      await settle();
      expect(calls.slice(before).some((c) => c.method === "GET")).toBe(true);
    });

    it("does not read or schedule a later read when an in-flight Retry outlives the page", async () => {
      listAnswer = withEmails(delivery({ status: "failed", detail: "Resend answered 500", retryable: true }));
      let answer: (value: { status: number; body: unknown }) => void = () => {};
      retryAnswer = new Promise((resolve) => {
        answer = resolve;
      });
      await mount();
      const reads = calls.filter((c) => c.method === "GET").length;
      await act(async () => buttonIn(statusCell(), "Retry")?.click());
      act(() => root.unmount());
      await act(async () => answer({ status: 202, body: { id: GIFT_ID, email: "sending" } }));
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(calls.filter((c) => c.method === "GET")).toHaveLength(reads);
      /* afterEach unmounts again; give it a root to unmount. */
      root = createRoot(host);
    });

    it("shows a refused Retry in the server's words", async () => {
      listAnswer = withEmails(delivery({ status: "failed", detail: "Resend answered 500", retryable: true }));
      retryAnswer = { status: 409, body: { error: "That email cannot be retried." } };
      await mount();
      await act(async () => buttonIn(statusCell(), "Retry")?.click());
      await settle();
      expect(statusCell()?.textContent).toContain("That email cannot be retried.");
    });
  });

  describe("creating one", () => {
    const form = () => host.querySelector('form[aria-label="New gift voucher"]') as HTMLFormElement;

    async function fill(email: string) {
      const input = host.querySelector("#voucher-new-email") as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      await act(async () => {
        setter?.call(input, email);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    async function submit() {
      await act(async () => form().requestSubmit());
      await settle();
    }

    const creates = () => calls.filter((c) => c.method === "POST" && c.url === "/api/admin/vouchers");

    /* Greg, 2026-10-03 (spya-prv9yu): *"Make the 'Create voucher' button more
       visible. And emphasise the public over the private message"*. jsdom has
       no layout, so this pins what the layout is built from: the submit is the
       filled primary button and the last control in the form, and the note
       they will read comes before the one only the admin sees, in the form and
       in the table. */
    it("puts the note to them before the private note, and ends on a filled Create button", async () => {
      await mount();
      const controls = [...form().querySelectorAll<HTMLElement>("input, textarea, button")];
      const at = (selector: string) => controls.indexOf(form().querySelector(selector) as HTMLElement);
      expect(at("#voucher-new-recipient-note")).toBeGreaterThan(-1);
      expect(at("#voucher-new-recipient-note")).toBeLessThan(at("#voucher-new-note"));
      const create = form().querySelector('button[type="submit"]') as HTMLButtonElement;
      expect(controls.at(-1)).toBe(create);
      expect(create.dataset.variant).toBe("default");
      const heads = [...host.querySelectorAll("thead th")].map((th) => th.textContent);
      expect(heads.indexOf("Note to them")).toBeLessThan(heads.indexOf("Private note"));
      const cells = [...(rowFor("waiting@example.test")?.querySelectorAll("td") ?? [])];
      expect(cells[heads.indexOf("Private note")]?.textContent).toContain("met at the conference");
    });
    const idOf = (call: Call | undefined) => (call?.body as { id?: unknown } | undefined)?.id;

    /* Sol's F13 on 261007j: the inputs stay editable while a create is in
       flight, so the answer to the first must not wipe a second draft typed
       meanwhile. */
    it("keeps a draft typed while the create was in flight", async () => {
      await mount();
      await fill("first@example.test");
      let answer: (value: { status: number; body: unknown }) => void = () => {};
      postAnswer = new Promise((resolve) => {
        answer = resolve;
      });
      await act(async () => form().requestSubmit());
      await fill("second@example.test");
      await act(async () => answer({ status: 201, body: { id: "new", email: "queued" } }));
      await settle();
      expect((host.querySelector("#voucher-new-email") as HTMLInputElement).value).toBe("second@example.test");
    });

    it("still clears the form when nothing changed while the create was in flight", async () => {
      await mount();
      await fill("first@example.test");
      await submit();
      expect((host.querySelector("#voucher-new-email") as HTMLInputElement).value).toBe("");
    });

    it("sends an id it minted, and the same one again when the same form is resubmitted", async () => {
      await mount();
      await fill("new@example.test");
      postAnswer = { status: 0, body: null };
      await submit();
      await submit();
      const [first, second] = creates();
      const id = idOf(first);
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      expect(idOf(second)).toBe(id);
      expect(first?.body).toMatchObject({ email: "new@example.test", articles: 20, note: null });

      /* A changed form is a different voucher. */
      await fill("other@example.test");
      postAnswer = { status: 201, body: { id: "x", email: "queued" } };
      await submit();
      const third = creates()[2];
      expect(idOf(third)).not.toBe(id);

      /* After a success, the next voucher is a new one even with the same fields. */
      await fill("other@example.test");
      await submit();
      expect(idOf(creates()[3])).not.toBe(idOf(third));
    });

    async function write(note: string) {
      const area = host.querySelector("#voucher-new-recipient-note") as HTMLTextAreaElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      await act(async () => {
        setter?.call(area, note);
        area.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    const sketch = () => host.querySelector('[aria-label="What their email will look like"]');

    it("sends a note to them, and resends the same id only for the same note", async () => {
      /* Greg, 2026-10-01 (spya-hc5q0e). Plan 261002b. */
      await mount();
      await fill("new@example.test");
      await write("Great to meet you today.");
      postAnswer = { status: 0, body: null };
      await submit();
      expect(creates()[0]?.body).toMatchObject({ recipientNote: "Great to meet you today." });
      await write("Something else.");
      await submit();
      expect(idOf(creates()[1])).not.toBe(idOf(creates()[0]));
    });

    async function name(value: string) {
      const input = host.querySelector("#voucher-new-recipient-name") as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      await act(async () => {
        setter?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    it("has a box for their name above the note, and says what it does", async () => {
      /* Greg, 2026-10-06 (spya-vc6pnm). Plan 261007f. */
      await mount();
      const input = form().querySelector<HTMLInputElement>("#voucher-new-recipient-name");
      expect(input?.type).toBe("text");
      expect(input?.required).toBe(false);
      /* Leave the code-point limit to the server, as the note below does. */
      expect(input?.hasAttribute("maxlength")).toBe(false);
      expect(input?.labels?.[0]?.textContent).toContain("Their name");
      expect(input?.labels?.[0]?.textContent).toContain("optional");
      expect(input?.labels?.[0]?.textContent).toContain("Dear <name>,");
      const controls = [...form().querySelectorAll<HTMLElement>("input, textarea, button")];
      const at = (selector: string) => controls.indexOf(form().querySelector(selector) as HTMLElement);
      expect(at("#voucher-new-articles")).toBeLessThan(at("#voucher-new-recipient-name"));
      expect(at("#voucher-new-recipient-name")).toBeLessThan(at("#voucher-new-recipient-note"));
    });

    it("sends their name, trimmed, or none; and clears the box once the voucher is made", async () => {
      await mount();
      await fill("new@example.test");
      await submit();
      expect(creates()[0]?.body).toMatchObject({ recipientName: null });
      await fill("new@example.test");
      await name("  Ada  ");
      await write("A note.");
      await submit();
      expect(creates()[1]?.body).toMatchObject({ recipientName: "Ada", recipientNote: "A note." });
      expect((host.querySelector("#voucher-new-recipient-name") as HTMLInputElement).value).toBe("");
    });

    it("refuses an over-limit raw name in Create instead of trimming it into acceptance", async () => {
      await mount();
      await fill("new@example.test");
      const raw = `${"x".repeat(80)} `;
      await name(raw);
      await submit();
      expect(creates()).toHaveLength(0);
      expect(form().textContent).toContain("recipientName must be at most 80 characters.");
    });

    it("submits the same cleaned name that its sketch shows", async () => {
      await mount();
      await fill("new@example.test");
      await name(`Ada\u200bLovelace\u202e`);
      await submit();
      expect(creates()[0]?.body).toMatchObject({ recipientName: "Ada Lovelace" });
    });

    it("mints a new id when only their name changed after a create whose answer was lost", async () => {
      /* The replay fingerprint lists the input's fields by hand (Sol's F5):
         without the name in it this resubmit would reuse the id for a
         different body, and the server would answer 409. */
      await mount();
      await fill("new@example.test");
      await name("Ada");
      postAnswer = { status: 0, body: null };
      await submit();
      await submit();
      expect(idOf(creates()[1])).toBe(idOf(creates()[0]));
      await name("Grace");
      await submit();
      expect(creates()[2]?.body).toMatchObject({ email: "new@example.test", recipientName: "Grace" });
      expect(idOf(creates()[2])).not.toBe(idOf(creates()[0]));
    });

    it("sketches the greeting under the heading once a name is typed, and not before", async () => {
      await mount();
      const lines = () => [...(sketch()?.querySelectorAll("p") ?? [])].map((p) => p.textContent);
      expect(sketch()?.textContent).not.toContain("Dear");
      await name(" Ada ");
      expect(lines().indexOf("Dear Ada,")).toBe(lines().indexOf("A gift of 20 free articles") + 1);
      /* Still above the note. */
      await write("Great to meet you today.");
      expect(lines().indexOf("Dear Ada,")).toBe(lines().indexOf("Great to meet you today.") - 1);
      expect(sketch()?.textContent).toContain("Subject: A gift of 20 free articles on Spideryarn");
      await name("   ");
      expect(sketch()?.textContent).not.toContain("Dear");
    });

    it("sketches the same cleaned greeting the email will render", async () => {
      await mount();
      await name(`Ada\u200bLovelace\u202e`);
      expect(sketch()?.textContent).toContain("Dear Ada Lovelace,");
      for (const control of ["\u200b", "\u202e"]) expect(sketch()?.textContent).not.toContain(control);

      await name("\u200b\u202e\u2060");
      expect(sketch()?.textContent).not.toContain("Dear");
    });

    it("sketches the email, with the note where it will go", async () => {
      await mount();
      /* Native maxLength counts UTF-16 units, unlike Postgres char_length, so
         it must not reject a valid 500-emoji note before the server sees it. */
      expect(host.querySelector("#voucher-new-recipient-note")?.hasAttribute("maxlength")).toBe(false);
      expect(sketch()?.textContent).toContain("A gift of 20 free articles on Spideryarn");
      expect(sketch()?.textContent).toContain("Your note to them goes here");
      await write("Great to meet you today.");
      expect(sketch()?.textContent).toContain("Great to meet you today.");
      expect(sketch()?.textContent).not.toContain("A note from");
      expect(sketch()?.querySelector("em")?.textContent).toBe("Great to meet you today.");
      expect(sketch()?.textContent).not.toContain("Your note to them goes here");
    });

    it("reminds you to sign the note, since the email is from Spideryarn", async () => {
      await mount();
      const area = form().querySelector<HTMLTextAreaElement>("#voucher-new-recipient-note");
      expect(area?.labels?.[0]?.textContent).toContain("Note to them");
      expect(area?.getAttribute("aria-describedby")).toBe("voucher-new-recipient-note-hint");
      const hint = form().querySelector("#voucher-new-recipient-note-hint");
      expect(hint?.textContent).toContain("Sign it yourself");
      expect(hint?.textContent).toContain("— Greg");
      expect(hint?.closest("label")).toBeNull();
      expect(hint?.hasAttribute("hidden")).toBe(false);
    });

    it("says the email is on its way", async () => {
      await mount();
      await fill("new@example.test");
      await submit();
      expect(form().textContent).toContain("Voucher created. The email to them is on its way.");
    });

    it("says so when the voucher had already been created", async () => {
      postAnswer = { status: 200, body: { id: "x", email: "replayed" } };
      await mount();
      await fill("new@example.test");
      await submit();
      expect(form().textContent).toContain("already been created");
      expect(form().textContent).not.toContain("on its way");
    });

    it("reads the list again straight away, and once more four seconds later", async () => {
      await mount();
      await fill("new@example.test");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        /* The voucher list's reads; the starter picker's shelf has its own. */
        const reads = () => calls.filter((c) => c.method === "GET" && c.url === "/api/admin/vouchers").length;
        const start = reads();
        await act(async () => form().requestSubmit());
        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });
        expect(reads()).toBe(start + 1);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(3_000);
        });
        expect(reads()).toBe(start + 1);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(1_000);
        });
        expect(reads()).toBe(start + 2);
        await act(async () => {
          await vi.advanceTimersByTimeAsync(10_000);
        });
        expect(reads()).toBe(start + 2);
      } finally {
        vi.useRealTimers();
      }
    });

    it("drops the later read when the page goes away", async () => {
      await mount();
      await fill("new@example.test");
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
      try {
        await act(async () => form().requestSubmit());
        await act(async () => {
          await vi.advanceTimersByTimeAsync(100);
        });
        const reads = calls.filter((c) => c.method === "GET").length;
        act(() => root.unmount());
        await vi.advanceTimersByTimeAsync(5_000);
        expect(calls.filter((c) => c.method === "GET").length).toBe(reads);
        /* afterEach unmounts again; give it a root to unmount. */
        root = createRoot(host);
      } finally {
        vi.useRealTimers();
      }
    });
  });

  /**
   * **The starter article** — plan 261007j stage 2. The picker reads the
   * administrator's own shelf, links out to the add page and to the article's
   * own sharing card rather than importing or making a link itself (§ Why the
   * form links out), and holds Create back while the chosen article could not
   * be linked. The key is never asked for, so it can be in no request and on
   * no screen.
   */
  describe("its starter article", () => {
    const form = () => host.querySelector('form[aria-label="New gift voucher"]') as HTMLFormElement;
    const picker = () => host.querySelector("#voucher-new-starter") as HTMLSelectElement;
    const statusLine = () => host.querySelector("#voucher-new-starter-status");
    const createButton = () => form().querySelector('button[type="submit"]') as HTMLButtonElement;
    const creates = () => calls.filter((c) => c.method === "POST" && c.url === "/api/admin/vouchers");
    const idOf = (call: Call | undefined) => (call?.body as { id?: unknown } | undefined)?.id;
    const linkNamed = (label: string) =>
      [...host.querySelectorAll<HTMLAnchorElement>("a")].find((a) => a.textContent?.trim() === label);

    /* The shelf arrives after the voucher list; wait for its options. */
    async function mountWithShelf() {
      await mount();
      for (let i = 0; i < 50 && (picker()?.options.length ?? 0) < 2; i++) await settle();
    }

    async function choose(slug: string) {
      await act(async () => {
        picker().value = slug;
        picker().dispatchEvent(new Event("change", { bubbles: true }));
      });
    }

    async function fill(email: string) {
      const input = host.querySelector("#voucher-new-email") as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      await act(async () => {
        setter?.call(input, email);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }

    async function submit() {
      await act(async () => form().requestSubmit());
      await settle();
    }

    it("offers your own articles, newest first, without the abstract-only papers, and none by default", async () => {
      await mountWithShelf();
      expect([...picker().options].map((o) => o.textContent)).toEqual([
        "None",
        "Some Paper",
        "The Bitter Lesson",
        "Another",
      ]);
      expect(picker().value).toBe("");
      expect(picker().labels?.[0]?.textContent).toContain("Starter article");
      /* After the note to them, before the private note. */
      const controls = [...form().querySelectorAll<HTMLElement>("input, textarea, select, button")];
      const at = (selector: string) => controls.indexOf(form().querySelector(selector) as HTMLElement);
      expect(at("#voucher-new-recipient-note")).toBeLessThan(at("#voucher-new-starter"));
      expect(at("#voucher-new-starter")).toBeLessThan(at("#voucher-new-note"));
      expect(statusLine()).toBeNull();
      expect(createButton().disabled).toBe(false);
    });

    it("says a private article with its link on will be carried, and lets Create go", async () => {
      await mountWithShelf();
      await choose("the-bitter-lesson");
      expect(statusLine()?.textContent).toContain("The Bitter Lesson");
      expect(statusLine()?.textContent).toContain("private link is on");
      expect(statusLine()?.textContent).toContain("The email will carry it.");
      expect(createButton().disabled).toBe(false);
    });

    it("says a public article is linked by its public page, no key involved", async () => {
      await mountWithShelf();
      await choose("another-one");
      expect(statusLine()?.textContent).toContain("public");
      expect(statusLine()?.textContent).toContain("no key involved");
      const page = linkNamed("its public page");
      expect(page?.getAttribute("href")).toBe("/read/another-one");
      expect(page?.target).toBe("_blank");
      expect(page?.rel).toContain("noopener");
      expect(createButton().disabled).toBe(false);
    });

    it("holds Create back for a private article with no link, and links to its sharing card in a new tab", async () => {
      await mountWithShelf();
      await choose("some-paper");
      expect(statusLine()?.textContent).toContain("private, with no private link yet");
      const make = linkNamed("Make one on its page");
      expect(make?.getAttribute("href")).toBe("/read/some-paper/metadata?section=access-sharing");
      expect(make?.target).toBe("_blank");
      expect(make?.rel).toContain("noopener");
      expect(createButton().disabled).toBe(true);
      expect(statusLine()?.textContent).toContain("Create voucher waits until it has one.");
      expect(createButton().getAttribute("aria-describedby")).toBe("voucher-new-starter-status");
    });

    it("turns no link into on when Refresh reads the shelf again", async () => {
      await mountWithShelf();
      await choose("some-paper");
      expect(createButton().disabled).toBe(true);
      shelfAnswer = SHELF.map((row) => (row.slug === "some-paper" ? { ...row, privateLinkOn: true } : row));
      const before = calls.length;
      await act(async () => buttonIn(form(), "Refresh")?.click());
      await settle();
      expect(calls.slice(before).filter((c) => c.method === "GET").map((c) => c.url)).toEqual(["/api/library"]);
      expect(statusLine()?.textContent).toContain("private link is on");
      expect(createButton().disabled).toBe(false);
    });

    it("holds Create back when the chosen article has left the shelf", async () => {
      await mountWithShelf();
      await choose("some-paper");
      shelfAnswer = SHELF.filter((row) => row.slug !== "some-paper");
      await act(async () => buttonIn(form(), "Refresh")?.click());
      await settle();
      expect(statusLine()?.textContent).toContain("no longer on your shelf");
      expect(createButton().disabled).toBe(true);
    });

    it("opens the add page for a pasted address in a new tab, and imports nothing itself", async () => {
      await mountWithShelf();
      const box = host.querySelector("#voucher-new-import") as HTMLInputElement;
      expect(box.labels?.[0]?.textContent).toContain("Or import one");
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      await act(async () => {
        setter?.call(box, " https://example.test/essay ");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
      const open = linkNamed("Import in a new tab");
      expect(open?.getAttribute("href")).toBe("/add/https%3A%2F%2Fexample.test%2Fessay");
      expect(open?.target).toBe("_blank");
      expect(open?.rel).toContain("noopener");
      /* Enter in the box opens it too, and must not create the voucher. */
      const opened = vi.fn((e: Event) => e.preventDefault());
      open?.addEventListener("click", opened);
      await act(async () => {
        box.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
      });
      await settle();
      expect(opened).toHaveBeenCalledTimes(1);
      expect(creates()).toHaveLength(0);
      expect(calls.some((c) => c.method !== "GET")).toBe(false);
    });

    it("sends the starter's slug, or null, and goes back to none once the voucher is made", async () => {
      await mountWithShelf();
      await fill("new@example.test");
      await submit();
      expect(creates()[0]?.body).toMatchObject({ starterSlug: null });
      await fill("new@example.test");
      await choose("the-bitter-lesson");
      await submit();
      expect(creates()[1]?.body).toMatchObject({ email: "new@example.test", starterSlug: "the-bitter-lesson" });
      expect(picker().value).toBe("");
    });

    it("mints a new id when only the starter changed after a create whose answer was lost", async () => {
      /* Sol's F5, as 261007f's name: the fingerprint lists every field by hand. */
      await mountWithShelf();
      await fill("new@example.test");
      await choose("the-bitter-lesson");
      postAnswer = { status: 0, body: null };
      await submit();
      await submit();
      expect(idOf(creates()[1])).toBe(idOf(creates()[0]));
      await choose("another-one");
      await submit();
      expect(creates()[2]?.body).toMatchObject({ starterSlug: "another-one" });
      expect(idOf(creates()[2])).not.toBe(idOf(creates()[0]));
    });

    it("shows the server's sentence when it refuses the starter anyway", async () => {
      const sentence = "That starter article is private and has no private link. Make the link on its page first.";
      postAnswer = { status: 409, body: { error: sentence } };
      await mountWithShelf();
      await fill("new@example.test");
      await choose("the-bitter-lesson");
      await submit();
      expect(form().querySelector('[role="alert"]')?.textContent).toBe(sentence);
    });

    it.each(["link-off", "deleted", "minimal"])("replays a lost create answer even after its starter becomes %s", async (state) => {
      await mountWithShelf();
      await fill("new@example.test");
      await choose("the-bitter-lesson");
      postAnswer = { status: 0, body: null };
      await submit();
      shelfAnswer = state === "deleted"
        ? SHELF.filter((row) => row.slug !== "the-bitter-lesson")
        : SHELF.map((row) => row.slug === "the-bitter-lesson"
          ? { ...row, privateLinkOn: false, ...(state === "minimal" ? { processing: "minimal" } : {}) }
          : row);
      await act(async () => buttonIn(form(), "Refresh")?.click());
      await settle();
      expect(createButton().disabled).toBe(false);
      expect(statusLine()?.textContent).toContain("retry the unchanged voucher");
      /* A changed draft is a new create and still needs an eligible starter. */
      await fill("changed@example.test");
      expect(createButton().disabled).toBe(true);
      await submit();
      expect(creates()).toHaveLength(1);
      await fill("new@example.test");
      expect(createButton().disabled).toBe(false);
      postAnswer = { status: 200, body: { id: "x", email: "replayed" } };
      await submit();
      expect(creates()).toHaveLength(2);
      expect(creates()[1]?.body).toEqual(creates()[0]?.body);
      expect(form().textContent).toContain("already been created");
    });

    it("keeps an import draft out of voucher validation", async () => {
      await mountWithShelf();
      await fill("new@example.test");
      const box = host.querySelector("#voucher-new-import") as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      await act(async () => {
        setter?.call(box, "example.test/essay");
        box.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(linkNamed("Import in a new tab")?.getAttribute("href")).toBe("/add/example.test%2Fessay");
      expect(form().checkValidity()).toBe(true);
      await submit();
      expect(creates()).toHaveLength(1);
      expect(creates()[0]?.body).toMatchObject({ starterSlug: null });
    });

    it.each([false, true])("voices the sketch title according to its rename flag (%s)", async (renamed) => {
      shelfAnswer = SHELF.map((row) => row.slug === "the-bitter-lesson" ? { ...row, titleOverridden: renamed } : row);
      await mountWithShelf();
      await choose("the-bitter-lesson");
      const sketch = host.querySelector('[aria-label="What their email will look like"]');
      expect(sketch?.querySelector(renamed ? ".voice-reader" : ".voice-author")?.textContent).toBe("The Bitter Lesson");
      if (renamed) expect(sketch?.textContent).toContain("Their email uses the article’s original title.");
    });

    it("sketches the starter line, title only, after the note", async () => {
      await mountWithShelf();
      const sketch = () => host.querySelector('[aria-label="What their email will look like"]');
      const lines = () => [...(sketch()?.querySelectorAll("p") ?? [])].map((p) => p.textContent);
      expect(sketch()?.textContent).not.toContain("Here is");
      await choose("the-bitter-lesson");
      const line = 'Here is "The Bitter Lesson" in Spideryarn, to start with:';
      expect(lines()).toContain(line);
      expect(lines().indexOf(line)).toBe(lines().indexOf("Your note to them goes here, if you write one.") + 1);
      await choose("");
      expect(sketch()?.textContent).not.toContain("Here is");
    });

    it("never asks for, sends or shows a key", async () => {
      await mountWithShelf();
      for (const slug of ["the-bitter-lesson", "another-one", "some-paper", "the-bitter-lesson"]) await choose(slug);
      await fill("new@example.test");
      await submit();
      for (const c of calls) {
        expect(c.url).not.toContain("share-link");
        expect(`${c.url} ${JSON.stringify(c.body ?? null)}`).not.toMatch(/[?&]key=/);
      }
      expect(host.innerHTML).not.toMatch(/[?&](amp;)?key=/);
    });
  });

  describe("a voucher with a starter", () => {
    const STARTED = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa4";
    const GONE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa5";
    const withStarters = () => [
      { ...VOUCHERS[0], id: STARTED, email: "started@example.test", starter: { slug: "the-bitter-lesson", title: "The Bitter Lesson" } },
      { ...VOUCHERS[0], id: GONE, email: "gone@example.test", recipientName: null, starter: { slug: "old-essay", title: null } },
      { ...VOUCHERS[1], starter: null },
    ];

    it("names its starter under the address, and says when the article is gone", async () => {
      listAnswer = withStarters();
      await mount();
      const started = rowFor("started@example.test")?.querySelector("td");
      expect(started?.textContent).toContain("Starter: The Bitter Lesson");
      /* The title is the author's words (fonts.md). */
      expect([...(started?.querySelectorAll(".voice-author") ?? [])].map((e) => e.textContent)).toEqual([
        "The Bitter Lesson",
      ]);
      expect(rowFor("gone@example.test")?.querySelector("td")?.textContent).toContain("Starter: old-essay (deleted)");
      expect(rowFor("claimed@example.test")?.querySelector("td")?.textContent).toBe("claimed@example.test");
    });

    async function readdress(answer: unknown) {
      patchAnswer = { status: 200, body: answer };
      listAnswer = withStarters();
      await mount();
      const row = rowFor("started@example.test");
      await act(async () => buttonIn(row, "Edit")?.click());
      const email = row?.querySelector<HTMLInputElement>('input[type="email"]');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      await act(async () => {
        setter?.call(email, "moved@example.test");
        email?.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => buttonIn(row, "Save")?.click());
      await settle();
      expect(calls.filter((c) => c.method === "PATCH").map((c) => c.body)).toEqual([{ email: "moved@example.test" }]);
      return row;
    }

    it("says so when a new address's email went without its starter", async () => {
      const row = await readdress({ ok: true, email: "queued", starter: "dropped" });
      const said = row?.querySelector('[role="status"]')?.textContent ?? "";
      expect(said).toContain("Saved.");
      expect(said).toContain("without the starter article");
    });

    it("says nothing extra when the starter went with it", async () => {
      const row = await readdress({ ok: true, email: "queued", starter: "kept" });
      expect(row?.textContent).not.toContain("without the starter article");
    });
  });
});
