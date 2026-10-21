// @vitest-environment jsdom
/**
 * **Author gifts on `/admin/vouchers`, actually rendered** — plan
 * docs/plans/261010c-author-gift-draft-voucher-from-the-add-page.md, stage 3
 * (§ D7, D10, Revision 3's R2-F2 and R2-F7). src/web/AdminAuthorGifts.tsx.
 *
 * Only the Supabase SDK and `fetch` are stubbed, as in
 * tests/admin-vouchers-page.test.tsx. What is pinned: each status in plain
 * words; Send held back without an address and confirmed by naming it; a notes
 * edit on a sent gift sends the notes and nothing else; *Look up again* only on
 * a draft; *found, not applied* and *suggested, not seen*; *Draft a gift*'s
 * 202 and 200 told apart; and the re-read while a lookup runs, which stops.
 */
import { enableHistorySync, NuqsAdapter } from "nuqs/adapters/react";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AdminAuthorGift, AdminAuthorLookup } from "../src/admin-author-gifts.js";
import { SHARING_RIGHTS_CONFIRM } from "../src/messages.js";

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
const { SignedInReader } = await import("../src/web/lib/made-for.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/* The tab is in the address through nuqs (plan 261020ab), so the page is
   mounted under the adapter the app has — src/web/main.tsx, which calls this
   too, for the same reason as tests/admin-page.test.tsx. */
enableHistorySync();

const DRAFT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd1";
const SENT = "dddddddd-dddd-4ddd-8ddd-ddddddddddd2";
const LOOKUP = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1";

function lookup(over: Partial<AdminAuthorLookup> = {}): AdminAuthorLookup {
  return {
    id: LOOKUP,
    createdAt: "2026-10-09T10:00:00Z",
    finishedAt: "2026-10-09T10:00:30Z",
    outcome: "nothing",
    failure: null,
    authorName: null,
    authorSourceUrl: null,
    email: null,
    emailSourceUrl: null,
    suggestedEmail: null,
    contactUrl: null,
    searches: 2,
    model: "anthropic/claude-sonnet",
    cost: { nanos: 12_340_000, calls: 1, unpricedCalls: 0 },
    ...over,
  };
}

function gift(over: Partial<AdminAuthorGift> = {}): AdminAuthorGift {
  return {
    id: DRAFT,
    status: "draft",
    starter: { slug: "the-bitter-lesson", title: "The Bitter Lesson", linkable: true, owner: null },
    email: null,
    recipientName: null,
    recipientNote: null,
    articles: 20,
    notes: null,
    notesUpdatedAt: null,
    emailLookupId: null,
    nameLookupId: null,
    createdAt: "2026-10-09T10:00:00Z",
    createdBy: "admin",
    updatedAt: "2026-10-09T10:00:00Z",
    sendStartedAt: null,
    discardedAt: null,
    voucherId: null,
    highPower: false,
    lookups: [],
    ...over,
  };
}

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
const SHELF = [
  shelfRow({ slug: "the-bitter-lesson", title: "The Bitter Lesson", addedAt: "2026-10-05T10:00:00Z" }),
  shelfRow({ slug: "some-paper", title: "Some Paper", addedAt: "2026-10-06T10:00:00Z" }),
];

type Call = { method: string; url: string; body: unknown };
type Answer = { status: number; body: unknown };
let calls: Call[];
let giftsAnswer: () => AdminAuthorGift[];
let ensureAnswer: Answer;
let patchAnswer: Answer;
let sendAnswer: Answer;
let lookupAnswer: Answer;
let highPowerAnswer: Answer;
let heldWrite: Promise<Response> | null;

beforeEach(() => {
  calls = [];
  giftsAnswer = () => [];
  ensureAnswer = { status: 202, body: { id: DRAFT, status: "draft", created: true, lookupId: LOOKUP } };
  patchAnswer = { status: 200, body: { ok: true } };
  sendAnswer = { status: 201, body: { voucherId: "v", email: "queued" } };
  lookupAnswer = { status: 202, body: { lookupId: LOOKUP } };
  highPowerAnswer = { status: 200, body: { highPower: true, queued: 0 } };
  heldWrite = null;
  /* A tab click writes `?tab=` into the address, which would outlive the test. */
  history.replaceState(null, "", "/admin/vouchers");
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const json = ({ status, body: value }: Answer) =>
      new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (method === "GET" && url === "/api/admin/author-gifts") return json({ status: 200, body: { gifts: giftsAnswer() } });
    if (method !== "GET" && heldWrite !== null) return heldWrite;
    if (method === "POST" && url === "/api/admin/author-gifts") return json(ensureAnswer);
    if (method === "POST" && url.endsWith("/lookups")) return json(lookupAnswer);
    if (method === "POST" && url.endsWith("/send")) return json(sendAnswer);
    if (method === "POST" && url.endsWith("/high-power")) return json(highPowerAnswer);
    if (method === "PATCH") return json(patchAnswer);
    if (url.startsWith("/api/library")) return json({ status: 200, body: { articles: SHELF } });
    return json({ status: 200, body: { vouchers: [] } });
  }) as typeof fetch;
});

let host: HTMLDivElement;
let root: Root;

async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
  }
}

/** The page as the app draws it: signed in, under nuqs' adapter. */
function page(): ReactNode {
  return (
    <NuqsAdapter>
      <SignedInReader.Provider value="reader-1">
        <AdminVouchersPage />
      </SignedInReader.Provider>
    </NuqsAdapter>
  );
}

/** Mounted, and on the Drafts tab, where the gifts are (plan 261020ab) — unless `tab` says otherwise. */
async function mount({ tab = "Drafts" }: { tab?: "Give" | "Drafts" | "Given" | null } = {}) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(page()));
  await settle(20);
  if (tab !== null) await act(async () => tabNamed(tab)?.click());
}

const tabNamed = (name: string) =>
  [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent?.startsWith(name));
const panelOf = (name: string) => {
  const id = tabNamed(name)?.getAttribute("aria-controls");
  return id ? (host.querySelector(`#${id}`) as HTMLElement | null) : null;
};
/** What a person can see of an element: its text without any `hidden` part. */
const visibleText = (el: Element | null | undefined) => {
  if (!el) return "";
  const copy = el.cloneNode(true) as Element;
  for (const h of copy.querySelectorAll("[hidden]")) h.remove();
  return copy.textContent ?? "";
};
/** Whether an element is inside a `hidden` part, or is one. */
const isHidden = (el: Element | null | undefined) => el?.closest("[hidden]") != null;
/** nuqs writes the address behind a throttle, so a single read is a race. */
async function addressSettles(test: (search: URLSearchParams) => boolean) {
  for (let i = 0; i < 50 && !test(new URLSearchParams(location.search)); i++) await settle(1);
  return new URLSearchParams(location.search);
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  history.replaceState(null, "", "/");
});

const section = () => host.querySelector('section[aria-label="Author gifts"]') as HTMLElement;
const card = (id: string) => host.querySelector(`#author-gift-${id}`) as HTMLElement | null;
const button = (el: Element | null, label: string) =>
  [...(el?.querySelectorAll("button") ?? [])].find((b) => b.textContent?.trim() === label);
const sets = (el: HTMLInputElement | HTMLTextAreaElement, value: string) => {
  const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, value);
  el.dispatchEvent(new Event("input", { bubbles: true }));
};
const writes = () => calls.filter((c) => c.method !== "GET");

describe("Author gifts", () => {
  it("opens on the gift `?gift=<id>` names, highlighted (plan 261011n § D1)", async () => {
    giftsAnswer = () => [gift({ id: DRAFT }), gift({ id: SENT })];
    history.replaceState(null, "", `/admin/vouchers?gift=${SENT}`);
    try {
      await mount();
      expect(card(SENT)?.className).toMatch(/ring-2/);
      expect(card(DRAFT)?.className).not.toMatch(/ring-2/);
    } finally {
      history.replaceState(null, "", "/");
    }
  });

  it("ignores a `?gift=` that is not a gift id", async () => {
    giftsAnswer = () => [gift({ id: DRAFT })];
    history.replaceState(null, "", "/admin/vouchers?gift=%3Cscript%3E");
    try {
      await mount();
      expect(card(DRAFT)?.className).not.toMatch(/ring-2/);
    } finally {
      history.replaceState(null, "", "/");
    }
  });

  it("sits above the voucher table, and is not a table itself", async () => {
    giftsAnswer = () => [gift()];
    await mount();
    expect(section()).not.toBeNull();
    expect(section().querySelector("table")).toBeNull();
  });

  it("says where each gift has got to in plain words", async () => {
    giftsAnswer = () => [
      gift({ id: "a1" }),
      gift({ id: "a2", status: "sending", email: "x@example.test", sendStartedAt: "2026-10-09T11:00:00Z" }),
      gift({ id: "a3", status: "sent", email: "x@example.test", voucherId: "v1" }),
      gift({ id: "a4", status: "discarded", discardedAt: "2026-10-09T12:00:00Z" }),
    ];
    await mount();
    const status = (id: string) => card(id)?.querySelector("[data-gift-status]")?.textContent;
    expect(status("a1")).toBe("Draft — not sent");
    expect(status("a2")).toBe("Sending didn't finish — press Send again");
    expect(status("a3")).toContain("Sent");
    expect(status("a4")).toMatch(/^Discarded on /);
    /* The article, by its title, links to it. */
    const link = card("a1")?.querySelector("a");
    expect(link?.textContent).toBe("The Bitter Lesson");
    expect(link?.getAttribute("href")).toBe("/read/the-bitter-lesson");
    /* Send on a draft and a half-sent one; Restore only on the discarded; nothing but notes on the sent. */
    expect(button(card("a2"), "Send")).toBeDefined();
    expect(button(card("a3"), "Send")).toBeUndefined();
    expect(button(card("a3"), "Edit")).toBeUndefined();
    expect(button(card("a4"), "Restore")).toBeDefined();
    expect(button(card("a4"), "Send")).toBeUndefined();
  });

  /* Plan 261011n § D3: whose the starter is once the gift's voucher is claimed. */
  it("says Now theirs, unlinked, once the claim moved it, and links /admin/articles when it stayed", async () => {
    const sent = { status: "sent" as const, email: "x@example.test", voucherId: "v1" };
    giftsAnswer = () => [
      gift({ id: "m1", ...sent, starter: { slug: "moved", title: "Moved", linkable: false, owner: "claimant" } }),
      gift({ id: "s1", ...sent, starter: { slug: "stayed", title: "Stayed", linkable: true, owner: "creator" } }),
      gift({ id: "w1", ...sent, starter: { slug: "waiting", title: "Waiting", linkable: true, owner: null } }),
    ];
    await mount();
    /* Theirs now: the title stays, but its address would be a 404 for the administrator. */
    expect(card("m1")?.textContent).toContain("Moved · Now theirs");
    expect(card("m1")?.querySelector('a[href="/read/moved"]')).toBeNull();
    expect(card("s1")?.textContent).toContain("Claimed; the article is still yours — transfer it on /admin/articles");
    expect(card("s1")?.querySelector('a[href="/admin/articles"]')).not.toBeNull();
    expect(card("s1")?.querySelector('a[href="/read/stayed"]')).not.toBeNull();
    expect(card("w1")?.textContent).not.toContain("Now theirs");
    expect(card("w1")?.textContent).not.toContain("still yours");
  });

  it("says in the Send confirmation that a private article becomes theirs when they sign in", async () => {
    giftsAnswer = () => [gift({ email: "ann@example.test" })];
    await mount();
    await act(async () => button(card(DRAFT), "Send")?.click());
    expect(card(DRAFT)?.textContent).toContain(
      "When they sign in, a private article with none of your notes on it becomes theirs.",
    );
  });

  it("holds Send back without an address, and says why", async () => {
    giftsAnswer = () => [gift()];
    await mount();
    const send = button(card(DRAFT), "Send");
    expect(send?.disabled).toBe(true);
    const reason = host.querySelector(`#${send?.getAttribute("aria-describedby")}`);
    expect(reason?.textContent).toContain("address");
  });

  it("holds Send back while a lookup is running, so its result can be reviewed first", async () => {
    giftsAnswer = () => [
      gift({
        email: "ann@example.test",
        lookups: [lookup({ outcome: null, finishedAt: null, cost: null, createdAt: new Date().toISOString() })],
      }),
    ];
    await mount();
    const send = button(card(DRAFT), "Send");
    expect(send?.disabled).toBe(true);
    const reason = host.querySelector(`#${send?.getAttribute("aria-describedby")}`);
    expect(reason?.textContent).toContain("lookup");
  });

  it("asks before Send by naming the address, then sends what it showed, and re-reads the vouchers", async () => {
    giftsAnswer = () => [gift({ email: "ann@example.test", recipientName: "Ann" })];
    await mount();
    const vouchersRead = () => calls.filter((c) => c.method === "GET" && c.url === "/api/admin/vouchers").length;
    const before = vouchersRead();
    await act(async () => button(card(DRAFT), "Send")?.click());
    expect(writes()).toEqual([]);
    expect(card(DRAFT)?.textContent).toContain("Send the gift email to ann@example.test?");
    /* Plan 261020z: green outline send, red back-out. */
    const sendTo = button(card(DRAFT), "Send to ann@example.test");
    expect(sendTo?.classList.contains("tone-positive")).toBe(true);
    expect(sendTo?.getAttribute("data-variant")).toBe("outline");
    expect(button(card(DRAFT), "Cancel")?.classList.contains("tone-negative")).toBe(true);
    await act(async () => button(card(DRAFT), "Send to ann@example.test")?.click());
    await settle();
    /* Plan 261010i: the gift as the confirmation showed it, so an agent's edit since is refused. */
    expect(writes()).toEqual([
      {
        method: "POST",
        url: `/api/admin/author-gifts/${DRAFT}/send`,
        body: { expected: { email: "ann@example.test", recipientName: "Ann", recipientNote: null, articles: 20 } },
      },
    ]);
    expect(card(DRAFT)?.textContent).toContain("The gift email is on its way");
    expect(vouchersRead()).toBeGreaterThan(before);
  });

  it("keeps the gift being confirmed when a refresh brings an agent's edit", async () => {
    const shown = gift({ email: "ann@example.test", recipientName: "Ann", recipientNote: "For Ann", articles: 20 });
    giftsAnswer = () => [shown];
    await mount();
    await act(async () => button(card(DRAFT), "Send")?.click());

    giftsAnswer = () => [gift({ email: "agent@example.test", recipientName: "Agent", recipientNote: "Changed", articles: 5 })];
    await act(async () => (section().querySelector('[aria-label="Refresh the author gifts"]') as HTMLButtonElement).click());
    await settle();
    expect(button(card(DRAFT), "Send to ann@example.test")).toBeDefined();
    expect(card(DRAFT)?.textContent).toContain("For Ann");
    sendAnswer = { status: 409, body: { error: "That gift changed since you opened it, so nothing was sent." } };
    await act(async () => button(card(DRAFT), "Send to ann@example.test")?.click());
    await settle();
    expect(writes()).toEqual([
      {
        method: "POST",
        url: `/api/admin/author-gifts/${DRAFT}/send`,
        body: { expected: { email: "ann@example.test", recipientName: "Ann", recipientNote: "For Ann", articles: 20 } },
      },
    ]);
    expect(card(DRAFT)?.querySelector('[role="alert"]')?.textContent).toContain("changed since you opened it");
    expect(card(DRAFT)?.textContent).toContain("agent@example.test");
    /* Reopening is an explicit review of the new fields. */
    await act(async () => button(card(DRAFT), "Send")?.click());
    expect(button(card(DRAFT), "Send to agent@example.test")).toBeDefined();
  });

  it("closes an open confirmation when a refresh says the gift is discarded", async () => {
    giftsAnswer = () => [gift({ email: "ann@example.test" })];
    await mount();
    await act(async () => button(card(DRAFT), "Send")?.click());
    giftsAnswer = () => [gift({ status: "discarded", email: "ann@example.test", discardedAt: "2026-10-09T12:00:00Z" })];
    await act(async () => (section().querySelector('[aria-label="Refresh the author gifts"]') as HTMLButtonElement).click());
    await settle();
    expect(card(DRAFT)?.querySelector("[data-gift-status]")?.textContent).toContain("Discarded");
    expect(button(card(DRAFT), "Send to ann@example.test")).toBeUndefined();
    expect(writes()).toEqual([]);
    giftsAnswer = () => [gift({ email: "ann@example.test" })];
    await act(async () => (section().querySelector('[aria-label="Refresh the author gifts"]') as HTMLButtonElement).click());
    await settle();
    expect(button(card(DRAFT), "Send to ann@example.test")).toBeUndefined();
    expect(button(card(DRAFT), "Send")).toBeDefined();
  });

  /* Plan 261010r § D2: an agent drafted it for an article with no link, so
     Send makes the link, and only after Greg ticks the rights box himself. */
  it("asks for the rights tick before a Send that makes the private link, and sends the tick", async () => {
    giftsAnswer = () => [
      gift({ email: "ann@example.test", recipientName: "Ann", starter: { slug: "s", title: "T", linkable: false, owner: null } }),
    ];
    await mount();
    await act(async () => button(card(DRAFT), "Send")?.click());
    expect(card(DRAFT)?.textContent).toContain(SHARING_RIGHTS_CONFIRM);
    expect(card(DRAFT)?.textContent).toContain("private link");
    const send = () => button(card(DRAFT), "Send to ann@example.test");
    expect(send()?.disabled).toBe(true);
    await act(async () => send()?.click());
    expect(writes()).toEqual([]);
    const tick = card(DRAFT)?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => tick.click());
    expect(send()?.disabled).toBe(false);
    await act(async () => send()?.click());
    await settle();
    expect(writes()).toEqual([
      {
        method: "POST",
        url: `/api/admin/author-gifts/${DRAFT}/send`,
        body: {
          expected: { email: "ann@example.test", recipientName: "Ann", recipientNote: null, articles: 20 },
          rightsConfirmed: true,
        },
      },
    ]);
  });

  it("asks for no tick when the article is already readable by link", async () => {
    giftsAnswer = () => [gift({ email: "ann@example.test" })];
    await mount();
    await act(async () => button(card(DRAFT), "Send")?.click());
    expect(card(DRAFT)?.querySelector('input[type="checkbox"]')).toBeNull();
    expect(card(DRAFT)?.textContent).not.toContain(SHARING_RIGHTS_CONFIRM);
  });

  it("keeps the confirmation's rights tick across a refresh instead of replacing the review", async () => {
    giftsAnswer = () => [
      gift({ email: "ann@example.test", starter: { slug: "s", title: "T", linkable: false, owner: null } }),
    ];
    await mount();
    await act(async () => button(card(DRAFT), "Send")?.click());
    const tick = card(DRAFT)?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => tick.click());
    expect(tick.checked).toBe(true);

    giftsAnswer = () => [gift({ email: "ann@example.test" })];
    await act(async () => (section().querySelector('[aria-label="Refresh the author gifts"]') as HTMLButtonElement).click());
    await settle();
    const refreshedTick = card(DRAFT)?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(refreshedTick.checked).toBe(true);
    expect(button(card(DRAFT), "Send to ann@example.test")?.disabled).toBe(false);
  });

  it("requires a fresh rights tick when a refused Send opens a second confirmation", async () => {
    sendAnswer = { status: 409, body: { error: "The starter moved." } };
    giftsAnswer = () => [
      gift({ email: "ann@example.test", starter: { slug: "s", title: "T", linkable: false, owner: null } }),
    ];
    await mount();
    await act(async () => button(card(DRAFT), "Send")?.click());
    const tick = card(DRAFT)?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => tick.click());
    await act(async () => button(card(DRAFT), "Send to ann@example.test")?.click());
    await settle();

    await act(async () => button(card(DRAFT), "Send")?.click());
    const secondTick = card(DRAFT)?.querySelector('input[type="checkbox"]') as HTMLInputElement;
    expect(secondTick.checked).toBe(false);
    expect(button(card(DRAFT), "Send to ann@example.test")?.disabled).toBe(true);
  });

  it("shows a refused Send in the server's words, beside the gift", async () => {
    sendAnswer = { status: 409, body: { error: "That gift has been discarded. Restore it first." } };
    giftsAnswer = () => [gift({ email: "ann@example.test" })];
    await mount();
    await act(async () => button(card(DRAFT), "Send")?.click());
    await act(async () => button(card(DRAFT), "Send to ann@example.test")?.click());
    await settle();
    expect(card(DRAFT)?.querySelector('[role="alert"]')?.textContent).toBe(
      "That gift has been discarded. Restore it first.",
    );
  });

  it("does not claim Send succeeded when the server's success reply is malformed", async () => {
    sendAnswer = { status: 201, body: { voucherId: "v", email: "something-new" } };
    giftsAnswer = () => [gift({ email: "ann@example.test" })];
    await mount();
    await act(async () => button(card(DRAFT), "Send")?.click());
    await act(async () => button(card(DRAFT), "Send to ann@example.test")?.click());
    await settle();
    const alert = card(DRAFT)?.querySelector('[role="alert"]');
    expect(alert).not.toBeNull();
    expect(alert?.textContent ?? "").toContain("answer");
    expect(card(DRAFT)?.textContent).not.toContain("email is on its way");
  });

  it("lets the notes change on a sent gift, and sends the notes and nothing else", async () => {
    giftsAnswer = () => [
      gift({ id: SENT, status: "sent", email: "ann@example.test", voucherId: "v1", notes: "Old notes.\nSecond line.", notesUpdatedAt: "2026-10-09T13:00:00Z" }),
    ];
    await mount();
    const c = card(SENT);
    /* A sent gift is folded to its line (plan 261020ab); its notes are inside. */
    await act(async () => button(c, "Show")?.click());
    expect(c?.textContent).toContain("Old notes.\nSecond line.");
    expect(c?.textContent).toContain("last written");
    await act(async () => button(c, "Edit notes")?.click());
    const box = c?.querySelector('textarea[aria-label="Notes"]') as HTMLTextAreaElement;
    expect(box.value).toBe("Old notes.\nSecond line.");
    await act(async () => sets(box, "Old notes.\nSecond line.\nShe replied."));
    /* Plan 261020z: Save notes green, Cancel red. */
    expect(button(c, "Save notes")?.classList.contains("tone-positive")).toBe(true);
    expect(button(c, "Cancel")?.classList.contains("tone-negative")).toBe(true);
    await act(async () => button(c, "Save notes")?.click());
    await settle();
    expect(writes()).toEqual([
      {
        method: "PATCH",
        url: `/api/admin/author-gifts/${SENT}`,
        /* With the stamp the notes had when Edit was pressed, so the server can refuse a stale save (Sol's C7). */
        body: { notes: "Old notes.\nSecond line.\nShe replied.", notesBase: "2026-10-09T13:00:00Z" },
      },
    ]);
  });

  it("sends a null base for notes never written", async () => {
    giftsAnswer = () => [gift()];
    await mount();
    const c = card(DRAFT);
    await act(async () => button(c, "Edit notes")?.click());
    const box = c?.querySelector('textarea[aria-label="Notes"]') as HTMLTextAreaElement;
    await act(async () => sets(box, "First words."));
    await act(async () => button(c, "Save notes")?.click());
    await settle();
    expect(writes()).toEqual([
      { method: "PATCH", url: `/api/admin/author-gifts/${DRAFT}`, body: { notes: "First words.", notesBase: null } },
    ]);
  });

  it("keeps what Greg typed when the server refuses a stale save, and says why", async () => {
    patchAnswer = { status: 409, body: { error: "The notes changed since you opened them; reload and try again." } };
    giftsAnswer = () => [gift({ notes: "Greg's note.", notesUpdatedAt: "2026-10-09T13:00:00Z" })];
    await mount();
    const c = card(DRAFT);
    await act(async () => button(c, "Edit notes")?.click());
    const box = () => c?.querySelector('textarea[aria-label="Notes"]') as HTMLTextAreaElement | null;
    await act(async () => sets(box() as HTMLTextAreaElement, "Greg's long, careful rewrite."));
    await act(async () => button(c, "Save notes")?.click());
    await settle();
    expect(c?.querySelector('[role="alert"]')?.textContent).toBe(
      "The notes changed since you opened them; reload and try again.",
    );
    expect(box()?.value).toBe("Greg's long, careful rewrite.");
  });

  it("will not overwrite notes a lookup appended while the notes editor was open", async () => {
    let row = gift({ notes: "Greg's note.", notesUpdatedAt: "2026-10-09T13:00:00Z" });
    giftsAnswer = () => [row];
    await mount();
    const c = card(DRAFT);
    await act(async () => button(c, "Edit notes")?.click());
    const box = c?.querySelector('textarea[aria-label="Notes"]') as HTMLTextAreaElement;
    await act(async () => sets(box, "Greg's edited note."));

    row = gift({
      notes: "Greg's note.\n\nLookup: address found.",
      notesUpdatedAt: "2026-10-09T13:01:00Z",
    });
    await act(async () => button(section(), "Refresh")?.click());
    await settle();

    expect(c?.textContent).toContain("notes changed after you started editing");
    expect(c?.textContent).toContain("Save is paused");
    expect(button(c, "Save notes")?.disabled).toBe(true);
  });

  it("will not save notes while a lookup that may append to them is still running", async () => {
    let row = gift({ notes: "Greg's note.", notesUpdatedAt: "2026-10-09T13:00:00Z" });
    giftsAnswer = () => [row];
    await mount();
    const c = card(DRAFT);
    await act(async () => button(c, "Edit notes")?.click());
    row = gift({
      notes: "Greg's note.",
      notesUpdatedAt: "2026-10-09T13:00:00Z",
      lookups: [lookup({ outcome: null, finishedAt: null, cost: null, createdAt: new Date().toISOString() })],
    });
    await act(async () => button(section(), "Refresh")?.click());
    await settle();
    expect(c?.textContent).toContain("lookup is still running");
    expect(button(c, "Save notes")?.disabled).toBe(true);
  });

  it("locks an editor's fields while its save is in flight, so later typing is not discarded", async () => {
    giftsAnswer = () => [gift({ recipientName: "Ann" })];
    await mount();
    const c = card(DRAFT);
    await act(async () => button(c, "Edit")?.click());
    const name = c?.querySelector('input[aria-label="Their name"]') as HTMLInputElement;
    await act(async () => sets(name, "Ann Author"));
    heldWrite = new Promise<Response>(() => {});
    act(() => button(c, "Save")?.click());
    expect(name.disabled).toBe(true);
    expect((c?.querySelector('input[aria-label="Email address"]') as HTMLInputElement | null)?.disabled).toBe(true);
    expect((c?.querySelector('textarea[aria-label="Note to them"]') as HTMLTextAreaElement | null)?.disabled).toBe(true);
  });

  it("offers Look up again only on a draft, and not while one is running", async () => {
    giftsAnswer = () => [
      gift({ lookups: [lookup()] }),
      gift({ id: SENT, status: "sent", email: "a@example.test", voucherId: "v1", lookups: [lookup({ id: "l2" })] }),
    ];
    await mount();
    expect(button(card(SENT), "Look up again")).toBeUndefined();
    await act(async () => button(card(DRAFT), "Look up again")?.click());
    await settle();
    expect(writes()).toEqual([{ method: "POST", url: `/api/admin/author-gifts/${DRAFT}/lookups`, body: undefined }]);
  });

  it("disables Look up again while a lookup is running", async () => {
    giftsAnswer = () => [
      gift({ lookups: [lookup({ outcome: null, finishedAt: null, cost: null, createdAt: new Date().toISOString() })] }),
    ];
    await mount();
    const again = [...(card(DRAFT)?.querySelectorAll("button") ?? [])].find((b) => b.textContent === "Looking…");
    expect(again?.disabled).toBe(true);
  });

  it("says where the address came from, and marks a run's different address found, not applied", async () => {
    giftsAnswer = () => [
      gift({
        email: "typed@example.test",
        emailLookupId: null,
        recipientName: "Ann Author",
        nameLookupId: LOOKUP,
        lookups: [
          lookup({
            outcome: "address",
            email: "found@example.test",
            emailSourceUrl: "https://example.test/about",
            authorName: "Ann Author",
            authorSourceUrl: "https://example.test/bio",
          }),
        ],
      }),
    ];
    await mount();
    const c = card(DRAFT);
    const fields = c?.querySelector("dl")?.textContent ?? "";
    expect(fields).toContain("typed@example.test — typed by you");
    expect(fields).toContain("seen at https://example.test/bio");
    const run = c?.querySelector("ul li")?.textContent ?? "";
    expect(run).toContain("Address found");
    expect(run).toContain("found@example.test (seen at https://example.test/about) — found, not applied");
    /* The name was taken from this run, so it is not "not applied". */
    expect(run.match(/found, not applied/g)).toHaveLength(1);
    expect([...(c?.querySelectorAll("ul li a") ?? [])].map((a) => a.getAttribute("href"))).toContain(
      "https://example.test/about",
    );
  });

  it("does not say found, not applied of the run the address was taken from", async () => {
    giftsAnswer = () => [
      gift({
        email: "found@example.test",
        emailLookupId: LOOKUP,
        lookups: [lookup({ outcome: "address", email: "found@example.test", emailSourceUrl: "https://example.test/about" })],
      }),
    ];
    await mount();
    expect(card(DRAFT)?.textContent).not.toContain("not applied");
    expect(card(DRAFT)?.querySelector("dl")?.textContent).toContain("from the lookup");
  });

  it("labels an address no result showed as suggested, not seen", async () => {
    giftsAnswer = () => [gift({ lookups: [lookup({ outcome: "author", suggestedEmail: "guess@example.test" })] })];
    await mount();
    const run = card(DRAFT)?.querySelector("ul li")?.textContent ?? "";
    expect(run).toContain("Author found, no address");
    expect(run).toContain("guess@example.test — suggested, not seen in any result");
  });

  it("says each run's outcome, flags more than three searches, and gives the cost", async () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    const old = new Date(Date.now() - 20 * 60_000).toISOString();
    giftsAnswer = () => [
      gift({
        lookups: [
          lookup({ id: "r1", outcome: null, finishedAt: null, cost: null, createdAt: recent }),
          lookup({ id: "r2", outcome: null, finishedAt: null, cost: null, createdAt: old }),
          lookup({ id: "r3", outcome: "failed", failure: "503", searches: 5, cost: { nanos: 1_000_000, calls: 2, unpricedCalls: 1 } }),
          lookup({ id: "r4", outcome: "failed", failure: "stale" }),
        ],
      }),
    ];
    await mount();
    const runs = [...(card(DRAFT)?.querySelectorAll("ul li") ?? [])].map((li) => li.textContent ?? "");
    expect(runs[0]).toContain("Looking…");
    expect(runs[0]).toContain("nothing spent yet");
    expect(runs[1]).toContain("Did not finish");
    expect(runs[2]).toContain("Failed: 503");
    expect(runs[2]).toContain("5 searches — more than the 3 it was allowed");
    expect(runs[2]).toContain("cost not fully known");
    expect(runs[3]).toContain("Did not finish");
    expect(runs[3]).toContain("2 searches · cost: $0.0123 (1 call)");
  });

  it("edits a draft's fields, sending only what changed", async () => {
    giftsAnswer = () => [gift({ email: "found@example.test", emailLookupId: LOOKUP, recipientName: "Ann", lookups: [lookup()] })];
    await mount();
    const c = card(DRAFT);
    await act(async () => button(c, "Edit")?.click());
    const name = c?.querySelector('input[aria-label="Their name"]') as HTMLInputElement;
    await act(async () => sets(name, "Ann Author"));
    /* Plan 261020z: Save green, Cancel red. */
    expect(button(c, "Save")?.classList.contains("tone-positive")).toBe(true);
    expect(button(c, "Cancel")?.classList.contains("tone-negative")).toBe(true);
    await act(async () => button(c, "Save")?.click());
    await settle();
    expect(writes()).toEqual([{ method: "PATCH", url: `/api/admin/author-gifts/${DRAFT}`, body: { recipientName: "Ann Author" } }]);
  });

  /* Plan 261011k, Greg 2026-10-11 (spya-cfbp0q). */
  it("replaces the address from a pasted `Name <address>`, fills an empty name, and saves both diffs", async () => {
    giftsAnswer = () => [gift({ email: "old@example.test", recipientName: null })];
    await mount();
    const c = card(DRAFT);
    await act(async () => button(c, "Edit")?.click());
    const email = c?.querySelector('input[aria-label="Email address"]') as HTMLInputElement;
    await act(async () => sets(email, "Ann Author <ann@example.test>"));
    await act(async () => button(c, "Save")?.click());
    await settle();
    expect(writes()).toEqual([
      {
        method: "PATCH",
        url: `/api/admin/author-gifts/${DRAFT}`,
        body: { email: "ann@example.test", recipientName: "Ann Author" },
      },
    ]);
  });

  /* Plan 261021j § D4: the draft card's High-powered AI line. */
  describe("High-powered AI on the card", () => {
    const line = (id: string) => card(id)?.querySelector("[data-high-power]");

    it("says on or off on a draft, with Switch on only when off, and nothing on a finished gift", async () => {
      giftsAnswer = () => [
        gift({ id: "off", highPower: false }),
        gift({ id: "on", highPower: true }),
        gift({ id: "sent", status: "sent", email: "x@example.test", voucherId: "v1", highPower: false }),
        gift({ id: "gone", status: "discarded", discardedAt: "2026-10-09T12:00:00Z" }),
      ];
      await mount();
      expect(line("off")?.textContent).toContain("High-powered AI: off");
      expect(button(card("off"), "Switch on")).toBeDefined();
      expect(line("on")?.textContent).toContain("High-powered AI: on");
      expect(button(card("on"), "Switch on")).toBeUndefined();
      expect(line("sent")).toBeNull();
      expect(line("gone")).toBeNull();
    });

    it("posts Switch on to the gift's high-power route, then reads the list again", async () => {
      let on = false;
      giftsAnswer = () => [gift({ highPower: on })];
      highPowerAnswer = { status: 200, body: { highPower: true, queued: 8 } };
      await mount();
      const reads = () => calls.filter((c) => c.method === "GET" && c.url === "/api/admin/author-gifts").length;
      const before = reads();
      on = true;
      await act(async () => button(card(DRAFT), "Switch on")?.click());
      await settle();
      expect(writes()).toEqual([{ method: "POST", url: `/api/admin/author-gifts/${DRAFT}/high-power`, body: undefined }]);
      expect(reads()).toBeGreaterThan(before);
      expect(line(DRAFT)?.textContent).toContain("High-powered AI: on");
      expect(card(DRAFT)?.querySelector('[role="alert"]')).toBeNull();
    });

    it("says Switching on… while it is in flight, with the card's actions held", async () => {
      giftsAnswer = () => [gift()];
      await mount();
      heldWrite = new Promise<Response>(() => {});
      act(() => button(card(DRAFT), "Switch on")?.click());
      expect(button(card(DRAFT), "Switching on…")?.disabled).toBe(true);
      expect(button(card(DRAFT), "Discard")?.disabled).toBe(true);
    });

    it("shows a refused Switch on in the server's words", async () => {
      giftsAnswer = () => [gift()];
      highPowerAnswer = { status: 409, body: { error: "That gift has been sent or discarded, so its article is no longer switched from here." } };
      await mount();
      await act(async () => button(card(DRAFT), "Switch on")?.click());
      await settle();
      expect(card(DRAFT)?.querySelector('[role="alert"]')?.textContent).toBe(
        "That gift has been sent or discarded, so its article is no longer switched from here.",
      );
    });
  });

  it("discards a draft, and restores a discarded one", async () => {
    giftsAnswer = () => [gift(), gift({ id: SENT, status: "discarded", discardedAt: "2026-10-09T12:00:00Z" })];
    await mount();
    await act(async () => button(card(DRAFT), "Discard")?.click());
    await settle();
    await act(async () => button(card(SENT), "Restore")?.click());
    await settle();
    expect(writes().map((c) => [c.url, c.body])).toEqual([
      [`/api/admin/author-gifts/${DRAFT}`, { discarded: true }],
      [`/api/admin/author-gifts/${SENT}`, { discarded: false }],
    ]);
  });

  /* Plan 261020ab, Greg 2026-10-20 (spya-vusqvg): one *New gift* form on
     Give, and a tick-box that makes it the draft of an author gift. */
  describe("New gift, ticked for the author of one of my articles", () => {
    const form = () => host.querySelector('form[aria-label="New gift"]') as HTMLFormElement;
    const forAuthor = () => host.querySelector("#voucher-new-for-author") as HTMLInputElement;
    const picker = () => host.querySelector("#author-gift-new-article") as HTMLSelectElement;
    const voucherPicker = () => host.querySelector("#voucher-new-starter") as HTMLSelectElement;
    const submit = () => [...form().querySelectorAll<HTMLButtonElement>('button[type="submit"]')].find((b) => !isHidden(b)) as HTMLButtonElement;
    const rights = () => form().querySelector("#voucher-new-rights") as HTMLInputElement;

    async function tick() {
      await act(async () => forAuthor().click());
    }

    async function choose(select: HTMLSelectElement, slug: string) {
      await act(async () => {
        select.value = slug;
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }

    async function shelfIn() {
      for (let i = 0; i < 50 && (voucherPicker()?.options.length ?? 0) < 2; i++) await settle();
    }

    async function fill() {
      await shelfIn();
      await tick();
      await choose(picker(), "some-paper");
      expect(submit().disabled).toBe(true);
      await act(async () => rights().click());
    }

    it("is unticked at first: the voucher form as before, ending on Create voucher", async () => {
      await mount({ tab: null });
      expect(tabNamed("Give")?.getAttribute("aria-selected")).toBe("true");
      expect(forAuthor().checked).toBe(false);
      expect(isHidden(host.querySelector("#voucher-new-email"))).toBe(false);
      expect(picker()).toBeNull();
      expect(submit().textContent).toBe("Create voucher");
    });

    it("ticked, hides the voucher's fields without clearing them, and asks for the article and the rights", async () => {
      await mount({ tab: null });
      await shelfIn();
      const email = host.querySelector("#voucher-new-email") as HTMLInputElement;
      await act(async () => sets(email, "kept@example.test"));
      await tick();
      expect(isHidden(email)).toBe(true);
      expect(isHidden(host.querySelector("#voucher-new-recipient-note"))).toBe(true);
      expect(isHidden(host.querySelector("#voucher-new-note"))).toBe(true);
      /* The article is required: Choose one…, newest first, as the voucher's picker. */
      expect([...picker().options].map((o) => o.value)).toEqual(["", "some-paper", "the-bitter-lesson"]);
      expect(picker().options[0]?.textContent).toBe("Choose one…");
      expect(visibleText(form())).toContain(SHARING_RIGHTS_CONFIRM);
      expect(visibleText(form())).toContain("up to three searches");
      expect(visibleText(form())).toContain("Nothing is emailed");
      expect(visibleText(form())).toContain("Drafts");
      expect(submit().textContent).toBe("Draft a gift");
      expect(submit().disabled).toBe(true);
      await tick();
      expect(isHidden(email)).toBe(false);
      expect(email.value).toBe("kept@example.test");
      expect(submit().textContent).toBe("Create voucher");
    });

    it("carries the chosen article across the tick, both ways", async () => {
      await mount({ tab: null });
      await shelfIn();
      await choose(voucherPicker(), "the-bitter-lesson");
      await tick();
      expect(picker().value).toBe("the-bitter-lesson");
      await choose(picker(), "some-paper");
      await tick();
      expect(voucherPicker().value).toBe("some-paper");
    });

    /* P1-02 of the plan review: drafting makes the private link, so the
       ticked form takes an article with none, which the voucher form refuses. */
    it("takes an article with no private link once the rights are ticked; unticked, Create still waits for one", async () => {
      await mount({ tab: null });
      await fill();
      expect(submit().disabled).toBe(false);
      await tick();
      expect(voucherPicker().value).toBe("some-paper");
      expect(submit().textContent).toBe("Create voucher");
      expect(submit().disabled).toBe(true);
      expect(host.querySelector("#voucher-new-starter-status")?.textContent).toContain("no private link yet");
    });

    it("locks the chosen article and rights while drafting is in flight", async () => {
      await mount({ tab: null });
      await fill();
      heldWrite = new Promise<Response>(() => {});
      act(() => form().requestSubmit());
      expect(picker().disabled).toBe(true);
      expect(rights().disabled).toBe(true);
      expect(button(picker().parentElement?.parentElement ?? null, "Refresh")?.disabled).toBe(true);
    });

    it("sends the slug with the rights confirmed, then opens Drafts on the new gift, whose lookup is running (202)", async () => {
      let drafted = false;
      giftsAnswer = () => (drafted ? [gift({ id: SENT, status: "sent", email: "a@example.test", voucherId: "v1" }), gift()] : []);
      ensureAnswer = { status: 202, body: { id: DRAFT, status: "draft", created: true, lookupId: LOOKUP } };
      await mount({ tab: null });
      await fill();
      expect(submit().disabled).toBe(false);
      drafted = true;
      await act(async () => form().requestSubmit());
      await settle();
      expect(writes()).toEqual([
        { method: "POST", url: "/api/admin/author-gifts", body: { slug: "some-paper", rightsConfirmed: true, highPower: true } },
      ]);
      expect(tabNamed("Drafts")?.getAttribute("aria-selected")).toBe("true");
      expect(panelOf("Drafts")?.hidden).toBe(false);
      expect(panelOf("Give")?.hidden).toBe(true);
      expect(panelOf("Drafts")?.querySelector('[role="status"]')?.textContent).toContain("lookup for its author is running");
      expect(card(DRAFT)?.className).toContain("tw:ring-2");
      expect(await addressSettles((q) => q.get("tab") === "drafts")).toBeDefined();
    });

    it("says the article already has a gift (200), opens Drafts, and scrolls to it", async () => {
      ensureAnswer = { status: 200, body: { id: SENT, status: "sent", created: false } };
      giftsAnswer = () => [gift(), gift({ id: SENT, status: "sent", email: "a@example.test", voucherId: "v1" })];
      const scrolled: Element[] = [];
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolled.push(this);
      };
      try {
        await mount({ tab: null });
        /* A fresh pointer must supersede an earlier fold choice. Otherwise
           drafting this article says it is highlighted, but leaves the
           finished card's fields shut. */
        await act(async () => tabNamed("Drafts")?.click());
        await act(async () => button(card(SENT), "Show")?.click());
        await act(async () => button(card(SENT), "Hide")?.click());
        expect(isHidden(card(SENT)?.querySelector("dl"))).toBe(true);
        await act(async () => tabNamed("Give")?.click());
        await fill();
        await act(async () => form().requestSubmit());
        await settle();
        expect(panelOf("Drafts")?.querySelector('[role="status"]')?.textContent).toContain("already has a gift");
        expect(panelOf("Drafts")?.hidden).toBe(false);
        expect(scrolled).toEqual([card(SENT)]);
        expect(card(SENT)?.className).toContain("tw:ring-2");
        expect(card(DRAFT)?.className).not.toContain("tw:ring-2");
        /* Highlighted, so open although it is sent (P2-02). */
        expect(isHidden(card(SENT)?.querySelector("dl"))).toBe(false);
      } finally {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    });

    /* Plan 261021j § D4. */
    const highPower = () => form().querySelector("#author-gift-new-high-power") as HTMLInputElement | null;

    it("offers High-powered AI, ticked, once an article is chosen, and says what it does", async () => {
      await mount({ tab: null });
      await shelfIn();
      await tick();
      expect(highPower()).toBeNull();
      await choose(picker(), "some-paper");
      expect(highPower()?.checked).toBe(true);
      expect(visibleText(form())).toContain(
        "Uses Opus for what is made from now on. What is already made, Structure included, stays as it is — to have it all on Opus, tick High-powered AI when you import it.",
      );
      expect(visibleText(form())).toContain("queues the article's main modes");
    });

    it("sends highPower false when it is unticked, and is ticked again after drafting", async () => {
      await mount({ tab: null });
      await fill();
      await act(async () => highPower()?.click());
      await act(async () => form().requestSubmit());
      await settle();
      expect(writes()).toEqual([
        { method: "POST", url: "/api/admin/author-gifts", body: { slug: "some-paper", rightsConfirmed: true, highPower: false } },
      ]);
      await act(async () => tabNamed("Give")?.click());
      await choose(picker(), "some-paper");
      expect(highPower()?.checked).toBe(true);
    });

    it("keeps a refusal on the form, on Give", async () => {
      ensureAnswer = { status: 409, body: { error: "That article is not published yet." } };
      await mount({ tab: null });
      await fill();
      await act(async () => form().requestSubmit());
      await settle();
      expect(form().querySelector('[role="alert"]')?.textContent).toBe("That article is not published yet.");
      expect(tabNamed("Give")?.getAttribute("aria-selected")).toBe("true");
    });
  });

  /* Plan 261020ab, Greg 2026-10-20 (spya-vyddks): *"add tabs at the top to divide it"*. */
  describe("the three tabs", () => {
    const names = () => [...host.querySelectorAll('[role="tab"]')].map((t) => t.textContent);

    it("opens on Give, with the other two panels hidden rather than gone", async () => {
      giftsAnswer = () => [gift()];
      await mount({ tab: null });
      expect(host.querySelector('[role="tablist"]')).not.toBeNull();
      expect(names().map((n) => n?.replace(/\d+$/, ""))).toEqual(["Give", "Drafts", "Given"]);
      expect(tabNamed("Give")?.getAttribute("aria-selected")).toBe("true");
      expect(panelOf("Give")?.hidden).toBe(false);
      expect(panelOf("Drafts")?.hidden).toBe(true);
      expect(panelOf("Given")?.hidden).toBe(true);
      /* Mounted all the same, so the gift list is there to come back to. */
      expect(panelOf("Drafts")?.contains(card(DRAFT))).toBe(true);
      expect(panelOf("Give")?.textContent).toContain("A voucher adds articles");
    });

    it("switches by click, and puts the tab in the address", async () => {
      await mount({ tab: null });
      await act(async () => tabNamed("Given")?.click());
      expect(tabNamed("Given")?.getAttribute("aria-selected")).toBe("true");
      expect(panelOf("Given")?.hidden).toBe(false);
      expect(panelOf("Give")?.hidden).toBe(true);
      expect((await addressSettles((q) => q.get("tab") === "given")).get("tab")).toBe("given");
      await act(async () => tabNamed("Give")?.click());
      expect(panelOf("Give")?.hidden).toBe(false);
      expect((await addressSettles((q) => !q.has("tab"))).has("tab")).toBe(false);
    });

    it("moves with the arrow keys, round the ends, and keeps only the chosen tab in the Tab order", async () => {
      await mount({ tab: null });
      const key = async (k: string) =>
        act(async () => {
          (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true }));
        });
      tabNamed("Give")?.focus();
      await key("ArrowRight");
      expect(document.activeElement).toBe(tabNamed("Drafts"));
      expect(panelOf("Drafts")?.hidden).toBe(false);
      await key("ArrowRight");
      expect(document.activeElement).toBe(tabNamed("Given"));
      await key("ArrowRight");
      expect(document.activeElement).toBe(tabNamed("Give"));
      await key("ArrowLeft");
      expect(document.activeElement).toBe(tabNamed("Given"));
      expect([...host.querySelectorAll('[role="tab"]')].map((t) => t.getAttribute("tabindex"))).toEqual(["-1", "-1", "0"]);
    });

    it("opens the tab `?tab=` names, and Give for one it does not know", async () => {
      history.replaceState(null, "", "/admin/vouchers?tab=given");
      await mount({ tab: null });
      expect(panelOf("Given")?.hidden).toBe(false);
      act(() => root.unmount());
      host.remove();
      history.replaceState(null, "", "/admin/vouchers?tab=nonsense");
      await mount({ tab: null });
      expect(tabNamed("Give")?.getAttribute("aria-selected")).toBe("true");
      expect(panelOf("Give")?.hidden).toBe(false);
    });

    it("opens Drafts for `?gift=` without a tab, and a tab chosen by hand clears it", async () => {
      giftsAnswer = () => [gift()];
      history.replaceState(null, "", `/admin/vouchers?gift=${DRAFT}`);
      await mount({ tab: null });
      expect(panelOf("Drafts")?.hidden).toBe(false);
      await act(async () => tabNamed("Give")?.click());
      const q = await addressSettles((s) => !s.has("gift"));
      expect(q.has("gift")).toBe(false);
      expect(panelOf("Give")?.hidden).toBe(false);
    });

    it("opens and points at `?gift=` when it arrives after the page is already mounted", async () => {
      giftsAnswer = () => [gift()];
      const scrolled: Element[] = [];
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolled.push(this);
      };
      try {
        await mount({ tab: null });
        expect(panelOf("Give")?.hidden).toBe(false);
        await act(async () => history.pushState(null, "", `/admin/vouchers?gift=${DRAFT}`));
        await settle();
        expect(panelOf("Drafts")?.hidden).toBe(false);
        expect(card(DRAFT)?.className).toContain("tw:ring-2");
        expect(scrolled).toEqual([card(DRAFT)]);
      } finally {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    });

    it("waits to scroll to `?gift=` until Drafts is visible", async () => {
      giftsAnswer = () => [gift()];
      history.replaceState(null, "", `/admin/vouchers?tab=given&gift=${DRAFT}`);
      const scrolled: Element[] = [];
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolled.push(this);
      };
      try {
        await mount({ tab: null });
        expect(panelOf("Drafts")?.hidden).toBe(true);
        expect(scrolled).toEqual([]);
        await act(async () => tabNamed("Drafts")?.click());
        expect(scrolled).toEqual([card(DRAFT)]);
      } finally {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    });

    it("counts the gifts waiting on you in Drafts, and the vouchers in Given", async () => {
      giftsAnswer = () => [
        gift({ id: "a1" }),
        gift({ id: "a2", status: "sending", email: "x@example.test", sendStartedAt: "2026-10-09T11:00:00Z" }),
        gift({ id: "a3", status: "sent", email: "x@example.test", voucherId: "v1" }),
        gift({ id: "a4", status: "discarded", discardedAt: "2026-10-09T12:00:00Z" }),
      ];
      await mount({ tab: null });
      expect(names()).toEqual(["Give", "Drafts2", "Given0"]);
    });

    it("draws no count on Drafts when nothing waits", async () => {
      giftsAnswer = () => [gift({ id: "a3", status: "sent", email: "x@example.test", voucherId: "v1" })];
      await mount({ tab: null });
      expect(tabNamed("Drafts")?.textContent).toBe("Drafts");
    });
  });

  /* Plan 261020ab, Greg 2026-10-20 (spya-vcnmrd, #663): *"I discarded the
     message re Tinbergen & ethology, but it's still hanging around. At the
     very least collapse it"*. */
  describe("a finished gift, folded to one line", () => {
    const TINBERGEN = "Niko Tinbergen's 1963 paper on the four questions of ethology. ".repeat(24);
    const discarded = () =>
      gift({
        id: SENT,
        status: "discarded",
        discardedAt: "2026-10-20T16:33:50Z",
        starter: { slug: "tinbergen1963onethology-spya-ks84se", title: "On aims and methods of Ethology", linkable: true, owner: null },
        notes: TINBERGEN,
        notesUpdatedAt: "2026-10-20T16:30:00Z",
        lookups: [lookup({ outcome: "author", authorName: "Niko Tinbergen" })],
      });

    it("shows a discarded gift's title and status, and none of its notes or lookups until Show", async () => {
      giftsAnswer = () => [discarded()];
      await mount();
      const c = card(SENT);
      const seen = visibleText(c);
      expect(seen).toContain("On aims and methods of Ethology");
      expect(seen).toMatch(/Discarded on /);
      expect(seen).not.toContain("four questions");
      expect(seen).not.toContain("Niko Tinbergen");
      expect(button(c, "Restore")).toBeDefined();
      expect(isHidden(button(c, "Restore"))).toBe(false);
      const show = button(c, "Show") as HTMLButtonElement;
      expect(show.getAttribute("aria-expanded")).toBe("false");
      const body = host.querySelector(`#${show.getAttribute("aria-controls")}`);
      expect(body?.hasAttribute("hidden")).toBe(true);
      await act(async () => show.click());
      expect(visibleText(c)).toContain("four questions");
      expect(button(c, "Hide")?.getAttribute("aria-expanded")).toBe("true");
      await act(async () => button(c, "Hide")?.click());
      expect(visibleText(c)).not.toContain("four questions");
    });

    it("folds a sent gift too, and says its voucher is under Given", async () => {
      giftsAnswer = () => [gift({ id: SENT, status: "sent", email: "a@example.test", voucherId: "v1", notes: "Sent notes." })];
      await mount();
      expect(card(SENT)?.querySelector("[data-gift-status]")?.textContent).toBe("Sent — its voucher is under Given");
      expect(visibleText(card(SENT))).not.toContain("Sent notes.");
    });

    it("folds a gift at once when it is discarded, with Restore on its line", async () => {
      let gone = false;
      giftsAnswer = () => [gone ? gift({ status: "discarded", discardedAt: "2026-10-20T16:33:50Z", notes: "Long notes." }) : gift({ notes: "Long notes." })];
      await mount();
      expect(visibleText(card(DRAFT))).toContain("Long notes.");
      gone = true;
      await act(async () => button(card(DRAFT), "Discard")?.click());
      await settle();
      expect(visibleText(card(DRAFT))).not.toContain("Long notes.");
      const restore = button(card(DRAFT), "Restore");
      expect(restore).toBeDefined();
      expect(isHidden(restore)).toBe(false);
      gone = false;
      await act(async () => restore?.click());
      await settle();
      expect(visibleText(card(DRAFT))).toContain("Long notes.");
    });

    it("keeps a just-sent gift's Sent message on its folded line", async () => {
      let sent = false;
      giftsAnswer = () => [
        sent
          ? gift({ status: "sent", email: "ann@example.test", voucherId: "v1", notes: "Draft notes." })
          : gift({ email: "ann@example.test", notes: "Draft notes." }),
      ];
      await mount();
      await act(async () => button(card(DRAFT), "Send")?.click());
      sent = true;
      await act(async () => button(card(DRAFT), "Send to ann@example.test")?.click());
      await settle();
      const seen = visibleText(card(DRAFT));
      expect(seen).toContain("The gift email is on its way; its voucher is under Given.");
      expect(seen).not.toContain("Draft notes.");
    });

    it("keeps open a finished gift `?gift=` names", async () => {
      giftsAnswer = () => [discarded()];
      history.replaceState(null, "", `/admin/vouchers?gift=${SENT}`);
      await mount({ tab: null });
      expect(visibleText(card(SENT))).toContain("four questions");
    });

    it("lists the finished gifts after the ones waiting, newest first within each", async () => {
      giftsAnswer = () => [
        gift({ id: "f1", status: "sent", email: "x@example.test", voucherId: "v1" }),
        gift({ id: "w1" }),
        gift({ id: "f2", status: "discarded", discardedAt: "2026-10-09T12:00:00Z" }),
        gift({ id: "w2", status: "sending", email: "x@example.test", sendStartedAt: "2026-10-09T11:00:00Z" }),
      ];
      await mount();
      expect([...section().querySelectorAll("li[id^='author-gift-']")].map((li) => li.id)).toEqual(
        ["w1", "w2", "f1", "f2"].map((id) => `author-gift-${id}`),
      );
    });
  });

  describe("while a lookup runs", () => {
    const reads = () => calls.filter((c) => c.method === "GET" && c.url === "/api/admin/author-gifts").length;

    async function advance(ms: number) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(ms);
      });
    }

    it("reads again every few seconds until none is running", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.parse("2026-10-09T10:00:10Z") });
      let pending = true;
      giftsAnswer = () => [
        gift({
          lookups: [
            pending
              ? lookup({ outcome: null, finishedAt: null, cost: null, createdAt: "2026-10-09T10:00:00Z" })
              : lookup(),
          ],
        }),
      ];
      host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
      await act(async () => root.render(page()));
      await advance(100);
      const first = reads();
      expect(first).toBe(1);
      expect(section().textContent).toContain("checked every few seconds");
      await advance(3_000);
      expect(reads()).toBe(2);
      await advance(3_000);
      expect(reads()).toBe(3);
      pending = false;
      await advance(3_000);
      expect(reads()).toBe(4);
      await advance(30_000);
      expect(reads()).toBe(4);
      expect(card(DRAFT)?.textContent).toContain("Nothing found");
    });

    it("reads nothing more at rest", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.parse("2026-10-09T10:00:10Z") });
      giftsAnswer = () => [gift({ lookups: [lookup()] })];
      host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
      await act(async () => root.render(page()));
      await advance(60_000);
      expect(reads()).toBe(1);
    });

    it("gives up after three minutes", async () => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"], now: Date.parse("2026-10-09T10:00:10Z") });
      giftsAnswer = () => [
        gift({ lookups: [lookup({ outcome: null, finishedAt: null, cost: null, createdAt: "2026-10-09T10:00:00Z" })] }),
      ];
      host = document.createElement("div");
      document.body.append(host);
      root = createRoot(host);
      await act(async () => root.render(page()));
      /* In steps, so each read's answer is drawn and its effect sets the next timer. */
      for (let t = 0; t < 3 * 60_000 + 10_000; t += 1_000) await advance(1_000);
      const atLimit = reads();
      expect(atLimit).toBeGreaterThan(55);
      expect(atLimit).toBeLessThan(65);
      for (let t = 0; t < 60_000; t += 1_000) await advance(1_000);
      expect(reads()).toBe(atLimit);
      /* Still running, as far as anyone knows: it says so, and Refresh is the way on. */
      expect(card(DRAFT)?.textContent).toContain("Looking…");
      expect(section().textContent).not.toContain("checked every few seconds");
    });
  });
});
