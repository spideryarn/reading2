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
    createdAt: "2026-10-01T10:00:00Z",
    createdBy: "admin",
    updatedAt: "2026-10-01T10:00:00Z",
    claimedBy: null,
    claimedAt: null,
    revokedAt: null,
    claimantEmail: null,
  },
  {
    id: CLAIMED,
    email: "claimed@example.test",
    articles: 10,
    note: null,
    createdAt: "2026-09-20T10:00:00Z",
    createdBy: "admin",
    updatedAt: "2026-09-21T10:00:00Z",
    claimedBy: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    claimedAt: "2026-09-21T10:00:00Z",
    revokedAt: null,
    claimantEmail: "claimed-now@example.test",
    claimant: { kind: "free", used: 4, limit: 13, remaining: 9, lapsed: false },
  },
  {
    id: REVOKED,
    email: "revoked@example.test",
    articles: 5,
    note: null,
    createdAt: "2026-09-10T10:00:00Z",
    createdBy: "admin",
    updatedAt: "2026-09-11T10:00:00Z",
    claimedBy: null,
    claimedAt: null,
    revokedAt: "2026-09-11T10:00:00Z",
    claimantEmail: null,
  },
];

type Call = { method: string; url: string; body: unknown };
let calls: Call[];
let patchAnswer: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  patchAnswer = { status: 200, body: { ok: true } };
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
    if (method === "POST") return json(201, { id: "new" });
    return json(200, { vouchers: VOUCHERS });
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
    expect(claimed).toMatch(/4 used.*9 left/);
    expect(rowFor("revoked@example.test")?.textContent).toContain("Revoked");
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
    await act(async () => buttonIn(rowFor("waiting@example.test"), "Edit")?.click());
    expect(rowFor("waiting@example.test")?.querySelector('input[type="email"]')).not.toBeNull();
    await act(async () => buttonIn(rowFor("waiting@example.test"), "Cancel")?.click());

    await act(async () => buttonIn(rowFor("claimed@example.test"), "Edit")?.click());
    const editing = rowFor("claimed@example.test");
    expect(editing?.querySelector('input[type="number"]')).not.toBeNull();
    expect(editing?.querySelector('input[type="email"]')).toBeNull();
  });

  it("shows the server's refusal in its own words", async () => {
    patchAnswer = { status: 409, body: { error: "That voucher has been claimed." } };
    await mount();
    await act(async () => buttonIn(rowFor("claimed@example.test"), "Revoke")?.click());
    await settle();
    expect(host.textContent).toContain("That voucher has been claimed.");
  });
});
