// @vitest-environment jsdom
/**
 * **Author gifts on `/admin/vouchers`, actually rendered** — plan
 * docs/plans/261009u-author-gift-draft-voucher-from-the-add-page.md, stage 3
 * (§ D7, D10, Revision 3's R2-F2 and R2-F7). src/web/AdminAuthorGifts.tsx.
 *
 * Only the Supabase SDK and `fetch` are stubbed, as in
 * tests/admin-vouchers-page.test.tsx. What is pinned: each status in plain
 * words; Send held back without an address and confirmed by naming it; a notes
 * edit on a sent gift sends the notes and nothing else; *Look up again* only on
 * a draft; *found, not applied* and *suggested, not seen*; *Draft a gift*'s
 * 202 and 200 told apart; and the re-read while a lookup runs, which stops.
 */
import { act } from "react";
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
    starter: { slug: "the-bitter-lesson", title: "The Bitter Lesson" },
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
let heldWrite: Promise<Response> | null;

beforeEach(() => {
  calls = [];
  giftsAnswer = () => [];
  ensureAnswer = { status: 202, body: { id: DRAFT, status: "draft", created: true, lookupId: LOOKUP } };
  patchAnswer = { status: 200, body: { ok: true } };
  sendAnswer = { status: 201, body: { voucherId: "v", email: "queued" } };
  lookupAnswer = { status: 202, body: { lookupId: LOOKUP } };
  heldWrite = null;
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

async function mount() {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () =>
    root.render(
      <SignedInReader.Provider value="reader-1">
        <AdminVouchersPage />
      </SignedInReader.Provider>,
    ),
  );
  await settle(20);
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
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

  it("asks before Send by naming the address, then sends, and re-reads the vouchers", async () => {
    giftsAnswer = () => [gift({ email: "ann@example.test" })];
    await mount();
    const vouchersRead = () => calls.filter((c) => c.method === "GET" && c.url === "/api/admin/vouchers").length;
    const before = vouchersRead();
    await act(async () => button(card(DRAFT), "Send")?.click());
    expect(writes()).toEqual([]);
    expect(card(DRAFT)?.textContent).toContain("Send the gift email to ann@example.test?");
    await act(async () => button(card(DRAFT), "Send to ann@example.test")?.click());
    await settle();
    expect(writes()).toEqual([{ method: "POST", url: `/api/admin/author-gifts/${DRAFT}/send`, body: undefined }]);
    expect(card(DRAFT)?.textContent).toContain("The gift email is on its way");
    expect(vouchersRead()).toBeGreaterThan(before);
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
    expect(c?.textContent).toContain("Old notes.\nSecond line.");
    expect(c?.textContent).toContain("last written");
    await act(async () => button(c, "Edit notes")?.click());
    const box = c?.querySelector('textarea[aria-label="Notes"]') as HTMLTextAreaElement;
    expect(box.value).toBe("Old notes.\nSecond line.");
    await act(async () => sets(box, "Old notes.\nSecond line.\nShe replied."));
    await act(async () => button(c, "Save notes")?.click());
    await settle();
    expect(writes()).toEqual([
      { method: "PATCH", url: `/api/admin/author-gifts/${SENT}`, body: { notes: "Old notes.\nSecond line.\nShe replied." } },
    ]);
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
    await act(async () => button(c, "Save")?.click());
    await settle();
    expect(writes()).toEqual([{ method: "PATCH", url: `/api/admin/author-gifts/${DRAFT}`, body: { recipientName: "Ann Author" } }]);
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

  describe("Draft a gift for an author", () => {
    const form = () => host.querySelector('form[aria-label="Draft a gift for an author"]') as HTMLFormElement;
    const picker = () => host.querySelector("#author-gift-new-article") as HTMLSelectElement;
    const submit = () => form().querySelector('button[type="submit"]') as HTMLButtonElement;

    async function fill() {
      for (let i = 0; i < 50 && (picker()?.options.length ?? 0) < 2; i++) await settle();
      await act(async () => {
        picker().value = "some-paper";
        picker().dispatchEvent(new Event("change", { bubbles: true }));
      });
      expect(submit().disabled).toBe(true);
      const tick = form().querySelector('input[type="checkbox"]') as HTMLInputElement;
      await act(async () => tick.click());
    }

    it("reuses the starter picker, and asks for the private link's rights confirmation", async () => {
      await mount();
      for (let i = 0; i < 50 && (picker()?.options.length ?? 0) < 2; i++) await settle();
      /* Newest first, as the voucher form's picker. */
      expect([...picker().options].map((o) => o.value)).toEqual(["", "some-paper", "the-bitter-lesson"]);
      expect(form().textContent).toContain(SHARING_RIGHTS_CONFIRM);
      expect(form().textContent).toContain("up to three searches");
      expect(submit().disabled).toBe(true);
    });

    it("locks the chosen article and rights while drafting is in flight", async () => {
      await mount();
      await fill();
      heldWrite = new Promise<Response>(() => {});
      act(() => form().requestSubmit());
      expect(picker().disabled).toBe(true);
      expect((form().querySelector('input[type="checkbox"]') as HTMLInputElement).disabled).toBe(true);
      expect(button(form(), "Refresh")?.disabled).toBe(true);
    });

    it("sends the slug with the rights confirmed, and says a new gift's lookup is running (202)", async () => {
      await mount();
      await fill();
      expect(submit().disabled).toBe(false);
      await act(async () => form().requestSubmit());
      await settle();
      expect(writes()).toEqual([
        { method: "POST", url: "/api/admin/author-gifts", body: { slug: "some-paper", rightsConfirmed: true } },
      ]);
      expect(form().querySelector('[role="status"]')?.textContent).toContain("lookup for its author is running");
    });

    it("says the article already has a gift (200), and scrolls to it", async () => {
      ensureAnswer = { status: 200, body: { id: SENT, status: "sent", created: false } };
      giftsAnswer = () => [gift(), gift({ id: SENT, status: "sent", email: "a@example.test", voucherId: "v1" })];
      const scrolled: Element[] = [];
      Element.prototype.scrollIntoView = function (this: Element) {
        scrolled.push(this);
      };
      try {
        await mount();
        await fill();
        await act(async () => form().requestSubmit());
        await settle();
        expect(form().querySelector('[role="status"]')?.textContent).toContain("already has a gift");
        expect(scrolled).toEqual([card(SENT)]);
        expect(card(SENT)?.className).toContain("tw:ring-2");
        expect(card(DRAFT)?.className).not.toContain("tw:ring-2");
      } finally {
        delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
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
      await act(async () =>
        root.render(
          <SignedInReader.Provider value="reader-1">
            <AdminVouchersPage />
          </SignedInReader.Provider>,
        ),
      );
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
      await act(async () =>
        root.render(
          <SignedInReader.Provider value="reader-1">
            <AdminVouchersPage />
          </SignedInReader.Provider>,
        ),
      );
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
      await act(async () =>
        root.render(
          <SignedInReader.Provider value="reader-1">
            <AdminVouchersPage />
          </SignedInReader.Provider>,
        ),
      );
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
