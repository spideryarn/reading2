// @vitest-environment jsdom
/**
 * **The administrator's rows in the command bar, and the author-gift dialog
 * they open** — plan 261024n (Greg, `spya-v88mga`).
 *
 * The bar is mounted out of the real `Dock`, as tests/command-bar.test.tsx
 * does, and `useSession` says who is reading. What is held:
 *
 *  - a reader, and the administrator under *view as*, get no admin row at all;
 *  - the administrator gets them, typed-only, and none wears `generates`;
 *  - pressing *Gift this to its author* makes no request until the press, then
 *    opens the dialog over the article, which reads `/api/admin/author-gifts`;
 *  - the dialog drafts only behind the rights tick, sends the High-powered AI
 *    box as it stands, shows an existing gift without posting, says a refusal
 *    in the server's words, and retries a failed read;
 *  - the sentence picker is never sent an admin row (plan § F4).
 *
 * The server's refusal of `/api/admin/*` for anybody else is not here: it is
 * tests/routes.test.ts and tests/author-gifts.test.ts, and these rows are a
 * courtesy on top of it.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import type { AdminAuthorGift } from "../src/admin-author-gifts.js";
import { EXPERIMENTAL_OFF } from "./helpers/experimental-fixtures.js";

/** Who `useSession` says is here. Re-posed by each test before it renders. */
const session: { user: { id: string } | null } = { user: null };
vi.mock("../src/web/useSession.js", () => ({
  useSession: () => ({ session: null, user: session.user, loading: false, known: true }),
}));

const { Dock } = await import("../src/web/Dock.js");
const { FeedbackHost } = await import("../src/web/FeedbackButton.js");
const { AuthorGiftDialog } = await import("../src/web/AuthorGiftDialog.js");
const { adminRows } = await import("../src/web/admin-commands.js");
const { parseArgumentQuery } = await import("../src/web/command-match.js");
const { adminOnly, parseRoute } = await import("../src/web/router.js");

const SLUG = "a-piece";
const VIEW_AS = "__spideryarnViewAs";

interface Call {
  readonly url: string;
  readonly method: string;
  readonly body: unknown;
}
let calls: Call[];
let modalOverlaps: string[];
/** What `GET /api/admin/author-gifts` answers, in turn; the last repeats. */
let listAnswers: (() => Response)[];
/** What `POST /api/admin/author-gifts` answers. */
let postAnswer: () => Response;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function aGift(over: Partial<AdminAuthorGift> = {}): AdminAuthorGift {
  return {
    id: "gift-1",
    status: "draft",
    starter: { slug: SLUG, title: "A piece", linkable: true, owner: null },
    email: "ada@example.org",
    recipientName: "Ada",
    recipientNote: null,
    articles: 20,
    notes: null,
    notesUpdatedAt: null,
    emailLookupId: null,
    nameLookupId: null,
    createdAt: "2026-10-24T00:00:00.000Z",
    createdBy: ADMIN_USER_ID_LOCAL,
    updatedAt: "2026-10-24T00:00:00.000Z",
    sendStartedAt: null,
    discardedAt: null,
    voucherId: null,
    highPower: true,
    lookups: [],
    ...over,
  } as AdminAuthorGift;
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  history.replaceState(null, "", `/read/${SLUG}`);
  const proto = window.HTMLDialogElement?.prototype;
  if (proto) {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      const other = [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].find((dialog) => dialog !== this);
      if (other) modalOverlaps.push(`${other.className} -> ${this.className}`);
      this.open = true;
    };
    proto.close = function close(this: HTMLDialogElement) {
      this.open = false;
      this.dispatchEvent(new Event("close"));
    };
  }
  session.user = null;
  delete (window as unknown as Record<string, unknown>)[VIEW_AS];
  calls = [];
  modalOverlaps = [];
  listAnswers = [() => json({ gifts: [] })];
  postAnswer = () => json({ id: "gift-1", status: "draft", created: true, lookupId: "look-1" }, 202);
  vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    calls.push({ url, method, body: init?.body === undefined ? undefined : JSON.parse(String(init.body)) });
    if (url === "/api/admin/author-gifts" && method === "GET") {
      const answer = listAnswers.length > 1 ? listAnswers.shift() : listAnswers[0];
      return Promise.resolve((answer ?? (() => json({ gifts: [] })))());
    }
    if (url === "/api/admin/author-gifts" && method === "POST") return Promise.resolve(postAnswer());
    if (url === "/api/command-pick") return Promise.resolve(json({ kind: "none" }));
    return Promise.resolve(json({}));
  });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  delete (window as unknown as Record<string, unknown>)[VIEW_AS];
});

async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

function reading(slug = SLUG): void {
  act(() => {
    root.render(
      // biome-ignore lint/suspicious/noExplicitAny: the reading view's Dock, as tests/command-bar.test.tsx mounts it
      createElement(Dock as any, { slug, view: "article", mode: "plain", onMode: () => {}, experimental: EXPERIMENTAL_OFF }),
    );
  });
}

const bar = (): HTMLDialogElement => host.querySelector<HTMLDialogElement>("dialog.cmdbar") as HTMLDialogElement;
const input = (): HTMLInputElement => bar().querySelector("input.cmdbar-input") as HTMLInputElement;
const listed = (): string[] =>
  [...bar().querySelectorAll<HTMLElement>('[role="option"]')].map((r) => r.querySelector(".cmdbar-name")?.textContent ?? "");
const row = (label: string): HTMLElement | undefined =>
  [...bar().querySelectorAll<HTMLElement>('[role="option"]')].find((r) => r.querySelector(".cmdbar-name")?.textContent === label);

function openBar(): void {
  act(() => host.querySelector<HTMLButtonElement>(".dock-commands")?.click());
}

function type(text: string): void {
  const el = input();
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(el, text);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(key: string): void {
  act(() => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  });
}

const giftDialog = (): HTMLDialogElement | null => document.querySelector<HTMLDialogElement>("dialog.author-gift-dialog");
const giftReads = (): Call[] => calls.filter((c) => c.url.startsWith("/api/admin/"));
const draftButton = (): HTMLButtonElement | undefined =>
  [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Draft a gift for the author");
const boxes = (): HTMLInputElement[] => [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];

describe("who gets admin rows", () => {
  it("a reader gets none, whatever they type", () => {
    reading();
    openBar();
    for (const word of ["gift", "admin", "what it cost", "users", "design"]) {
      type(word);
      expect(listed().filter((l) => l.startsWith("Admin") || l === "Gift this to its author" || l === "What it cost" || l === "Design reference"), word).toEqual([]);
    }
    expect(giftReads()).toEqual([]);
  });

  it("the administrator under view as gets none", () => {
    session.user = { id: ADMIN_USER_ID_LOCAL };
    (window as unknown as Record<string, unknown>)[VIEW_AS] = { nonce: "a".repeat(43) };
    reading();
    openBar();
    type("gift");
    expect(row("Gift this to its author")).toBeUndefined();
    type("admin");
    expect(listed().some((l) => l.startsWith("Admin"))).toBe(false);
  });

  it("the administrator gets them once something is typed, and none says it generates", () => {
    session.user = { id: ADMIN_USER_ID_LOCAL };
    reading();
    openBar();
    expect(listed().some((l) => l.startsWith("Admin") || l === "Gift this to its author")).toBe(false);
    type("admin");
    expect(listed()).toEqual(
      expect.arrayContaining(["Admin", "Admin › Users", "Admin › Feedback", "Admin › Gift vouchers", "Admin › Articles", "Admin › Costs"]),
    );
    type("gift");
    expect(listed()[0]).toBe("Gift this to its author");
    expect(row("Gift this to its author")?.querySelector(".cmdbar-generates")).toBeNull();
    type("design");
    expect(listed()).toContain("Design reference");
    type("what it cost");
    expect(listed()[0]).toBe("What it cost");
    /* The label's `›` is not typeable, so "admin costs" finds the row only by
       its alias — missed in the browser check, 2026-10-24. */
    for (const [typed, label] of [
      ["admin users", "Admin › Users"],
      ["admin feedback", "Admin › Feedback"],
      ["admin vouchers", "Admin › Gift vouchers"],
      ["admin articles", "Admin › Articles"],
      ["admin costs", "Admin › Costs"],
    ] as const) {
      type(typed);
      expect(listed()[0], typed).toBe(label);
    }
    /* Typing reads nothing. */
    expect(giftReads()).toEqual([]);
  });

  it("`feedback` still finds the Feedback dialog's row before the admin page", () => {
    session.user = { id: ADMIN_USER_ID_LOCAL };
    // biome-ignore lint/suspicious/noExplicitAny: the real signed-in Dock under its FeedbackHost
    const dock = createElement(Dock as any, {
      slug: SLUG,
      view: "article",
      mode: "plain",
      onMode: () => {},
      experimental: EXPERIMENTAL_OFF,
    });
    act(() => {
      root.render(<FeedbackHost readerId={ADMIN_USER_ID_LOCAL}>{dock}</FeedbackHost>);
    });
    openBar();
    type("feedback");
    expect(listed()[0]).toBe("Feedback");
    expect(listed().indexOf("Admin › Feedback")).toBeGreaterThan(-1);
  });
});

describe("the rows' words", () => {
  const rows = adminRows({ article: { openAuthorGift: () => ({ kind: "close" }), goToCost: () => ({ kind: "close" }) } });

  it("parse as no argument command — the collision matrix's rule", () => {
    for (const command of rows) {
      if (command.kind !== "page" && command.kind !== "action") continue;
      for (const words of [command.label, ...command.aliases]) {
        expect(parseArgumentQuery(words), words).toEqual([]);
      }
    }
  });

  it("are all typed-only and none generates", () => {
    for (const command of rows) {
      if (command.kind !== "page" && command.kind !== "action") continue;
      expect(command.typedOnly, command.label).toBe(true);
      expect(command.generates, command.label).toBe(false);
    }
  });

  it("go only to administrator-only pages", () => {
    for (const command of rows) {
      if (command.kind === "page") expect(adminOnly(parseRoute(command.href)), command.href).toBe(true);
    }
  });

  it("are about an article only when there is one", () => {
    const ids = adminRows({ article: undefined }).map((c) => (c.kind === "action" ? c.id : c.kind === "page" ? c.href : c.kind));
    expect(ids).not.toContain("admin-author-gift");
    expect(ids).not.toContain("section-what-it-cost");
  });
});

describe("Gift this to its author", () => {
  it("asks nothing until pressed, then opens the dialog over the article once the bar has shut", async () => {
    session.user = { id: ADMIN_USER_ID_LOCAL };
    reading();
    await settle();
    expect(giftReads(), "an admin who has not pressed it").toEqual([]);
    openBar();
    type("gift");
    press("Enter");
    await settle();
    expect(bar().open).toBe(false);
    expect(giftDialog()?.open).toBe(true);
    expect(location.pathname).toBe(`/read/${SLUG}`);
    expect(giftReads().map((c) => `${c.method} ${c.url}`)).toEqual(["GET /api/admin/author-gifts"]);
    expect(modalOverlaps, "the gift dialog opened before the command bar shut").toEqual([]);
  });

  it("keeps one mounted dialog and its state across a close and second press", async () => {
    session.user = { id: ADMIN_USER_ID_LOCAL };
    reading();
    openBar();
    type("gift");
    press("Enter");
    await settle();
    const first = giftDialog();
    act(() => boxes()[0]?.click());
    const close = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Close");
    act(() => close?.click());
    await settle();
    expect(first?.open).toBe(false);

    openBar();
    type("gift");
    press("Enter");
    await settle();
    expect(giftDialog()).toBe(first);
    expect(boxes()[0]?.checked).toBe(true);
    expect(giftReads()).toHaveLength(1);
    expect(modalOverlaps).toEqual([]);
  });

  it("never sends an admin row to the sentence picker", async () => {
    session.user = { id: ADMIN_USER_ID_LOCAL };
    reading();
    openBar();
    type("please could you make this into something nice");
    press("Enter");
    await settle();
    const pick = calls.find((c) => c.url === "/api/command-pick");
    expect(pick, "no sentence was sent").toBeDefined();
    const ids = ((pick?.body as { rows?: { id: string }[] } | undefined)?.rows ?? []).map((r) => r.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.filter((id) => id.includes("admin") || id.includes("design") || id.includes("what-it-cost"))).toEqual([]);
  });

  it("does not carry an open gift dialog onto another article when the Dock is reused", async () => {
    session.user = { id: ADMIN_USER_ID_LOCAL };
    reading();
    openBar();
    type("gift");
    press("Enter");
    await settle();
    expect(giftDialog()?.open).toBe(true);
    expect(giftReads()).toHaveLength(1);

    history.replaceState(null, "", "/read/another-piece");
    reading("another-piece");
    await settle();
    expect(giftDialog()).toBeNull();
    expect(giftReads(), "the new article has not asked for its gifts").toHaveLength(1);

    openBar();
    type("gift");
    press("Enter");
    await settle();
    expect(giftDialog()?.open).toBe(true);
    expect(giftReads()).toHaveLength(2);
    expect(draftButton()?.disabled).toBe(true);
  });
});

describe("the dialog", () => {
  async function dialogFor(): Promise<void> {
    await act(async () => {
      root.render(createElement(AuthorGiftDialog, { slug: SLUG, open: true, onClose: () => {} }));
    });
    await settle();
  }
  it("drafts only behind the rights tick, with High-powered AI on by default", async () => {
    let after = false;
    listAnswers = [() => json({ gifts: after ? [aGift()] : [] })];
    await dialogFor();
    expect(draftButton()?.disabled).toBe(true);
    act(() => boxes()[0]?.click());
    expect(draftButton()?.disabled).toBe(false);
    after = true;
    await act(async () => draftButton()?.click());
    await settle();
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toEqual([
      { url: "/api/admin/author-gifts", method: "POST", body: { slug: SLUG, rightsConfirmed: true, highPower: true } },
    ]);
    expect(host.textContent).toContain("A draft gift is waiting for you to review and send.");
    expect(host.querySelector<HTMLAnchorElement>('a[href="/admin/vouchers?gift=gift-1"]')).not.toBeNull();
  });

  it("sends High-powered AI off when it is unticked", async () => {
    await dialogFor();
    act(() => boxes()[0]?.click());
    act(() => boxes()[1]?.click());
    await act(async () => draftButton()?.click());
    await settle();
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ slug: SLUG, rightsConfirmed: true, highPower: false });
  });

  it("turns two submits in one render into one draft request", async () => {
    await dialogFor();
    act(() => boxes()[0]?.click());
    act(() => {
      draftButton()?.click();
      draftButton()?.click();
    });
    await settle();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("shows a gift already made, and posts nothing", async () => {
    listAnswers = [() => json({ gifts: [aGift({ status: "sent" })] })];
    await dialogFor();
    expect(host.textContent).toContain("This gift has been sent.");
    expect(draftButton()).toBeUndefined();
    expect(calls.filter((c) => c.method === "POST")).toEqual([]);
  });

  it("uses the id ensure returned when the gift's frozen slug differs", async () => {
    postAnswer = () => json({ id: "gift-returned", status: "draft", created: false }, 200);
    listAnswers = [
      () => json({ gifts: [] }),
      () =>
        json({
          gifts: [
            aGift({
              id: "gift-returned",
              starter: { slug: "the-old-address", title: "A piece", linkable: true, owner: null },
            }),
          ],
        }),
    ];
    await dialogFor();
    act(() => boxes()[0]?.click());
    await act(async () => draftButton()?.click());
    await settle();
    expect(host.textContent).toContain("A draft gift is waiting for you to review and send.");
    expect(host.querySelector<HTMLAnchorElement>('a[href="/admin/vouchers?gift=gift-returned"]')).not.toBeNull();
  });

  it("says a refusal in the server's words", async () => {
    postAnswer = () => json({ error: "That article isn't published yet." }, 409);
    await dialogFor();
    act(() => boxes()[0]?.click());
    await act(async () => draftButton()?.click());
    await settle();
    expect(host.textContent).toContain("That article isn't published yet.");
    expect(draftButton()).toBeDefined();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
  });

  it("retries a failed first read", async () => {
    listAnswers = [() => json({ error: "Down for a moment." }, 503), () => json({ gifts: [] })];
    await dialogFor();
    const retry = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === "Retry");
    expect(retry).toBeDefined();
    await act(async () => retry?.click());
    await settle();
    expect(draftButton()).toBeDefined();
  });

  it("after a draft whose read-back fails, says it was drafted and offers no second Draft", async () => {
    listAnswers = [() => json({ gifts: [] }), () => json({ error: "Down for a moment." }, 503)];
    await dialogFor();
    act(() => boxes()[0]?.click());
    await act(async () => draftButton()?.click());
    await settle();
    expect(host.textContent).toContain("The gift was drafted.");
    expect(draftButton()).toBeUndefined();
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(host.querySelector<HTMLAnchorElement>('a[href="/admin/vouchers?gift=gift-1"]')).not.toBeNull();
  });
});
