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
    createdAt: "2026-10-01T10:00:00Z",
    createdBy: "admin",
    updatedAt: "2026-10-01T10:00:00Z",
    claimedBy: null,
    claimedAt: null,
    revokedAt: null,
    claimantEmail: null,
    emails: { gift: null, claimed: null },
  },
  {
    id: CLAIMED,
    email: "claimed@example.test",
    articles: 10,
    note: null,
    recipientNote: null,
    createdAt: "2026-09-20T10:00:00Z",
    createdBy: "admin",
    updatedAt: "2026-09-21T10:00:00Z",
    claimedBy: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    claimedAt: "2026-09-21T10:00:00Z",
    revokedAt: null,
    claimantEmail: "claimed-now@example.test",
    claimant: { kind: "free", used: 4, limit: 13, remaining: 9, lapsed: false },
    emails: { gift: null, claimed: null },
  },
  {
    id: REVOKED,
    email: "revoked@example.test",
    articles: 5,
    note: null,
    recipientNote: null,
    createdAt: "2026-09-10T10:00:00Z",
    createdBy: "admin",
    updatedAt: "2026-09-11T10:00:00Z",
    claimedBy: null,
    claimedAt: null,
    revokedAt: "2026-09-11T10:00:00Z",
    claimantEmail: null,
    emails: { gift: null, claimed: null },
  },
];

type Call = { method: string; url: string; body: unknown };
let calls: Call[];
let patchAnswer: { status: number; body: unknown };
/** Status 0 is a network failure: `fetch` throws. */
let postAnswer: { status: number; body: unknown };
let retryAnswer: { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;
let listAnswer: unknown[];

beforeEach(() => {
  calls = [];
  patchAnswer = { status: 200, body: { ok: true } };
  postAnswer = { status: 201, body: { id: "new", email: "queued" } };
  retryAnswer = { status: 202, body: { id: "x", email: "sending" } };
  listAnswer = VOUCHERS;
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
      if (postAnswer.status === 0) throw new TypeError("Failed to fetch");
      return json(postAnswer.status, postAnswer.body);
    }
    return json(200, { vouchers: listAnswer });
  }) as typeof fetch;
});

let host: HTMLDivElement;
let root: Root;

async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<AdminVouchersPage />));
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
          <button type="button" onClick={() => void state.create({ email: "fresh@example.test", articles: 20, note: null, recipientNote: null })}>
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
        const reads = () => calls.filter((c) => c.method === "GET").length;
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
});
