// @vitest-environment jsdom
/**
 * **The two ways in: *View as* on /admin/users and *View as owner* on
 * /admin/articles.** docs/plans/261019n-admin-sees-other-users-articles-and-views-as-them.md
 * § Part 3, Client 5.
 *
 * What is pinned: the buttons are drawn for other readers and not for the
 * administrator's own rows or another administrator's; pressing one asks for a
 * reason, and nothing is sent without one; the start is `POST
 * /api/admin/view-as` with exactly `{ subject, reason }`; the tab is opened at
 * `/#view-as=<nonce>` with `noopener`; and a refusal is shown in the server's
 * words with no tab opened.
 */
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
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

const { AdminArticlesPage } = await import("../src/web/AdminArticlesPage.js");
const { adminColumns } = await import("../src/web/admin-columns.js");
const { ADMIN_USER_ID_LOCAL } = await import("../src/admin.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ALICE = "a1a1a1a1-0b11-4c5e-8a01-261020000001";
const NONCE = "N".repeat(40) + "-_z";
const THEIRS = {
  id: "a1a1a1a1-0b11-4c5e-8a01-261020000002",
  shortId: "spya-k3m9qt",
  ownerId: ALICE,
  ownerEmail: "alice@example.test",
  mine: false,
  createdAt: "2026-10-10T10:00:00Z",
  visibility: "private",
  processing: "full",
  title: null,
  slug: null,
  published: null,
  cost: { nanos: 0, calls: 0, unpricedCalls: 0 },
};
const MINE = { ...THEIRS, id: "a1a1a1a1-0b11-4c5e-8a01-261020000003", ownerId: ADMIN_USER_ID_LOCAL, ownerEmail: "admin@example.test", mine: true, title: "Mine", slug: "mine", published: true };
const ANOTHER_ADMINS = { ...THEIRS, id: "a1a1a1a1-0b11-4c5e-8a01-261020000004", ownerId: ADMIN_USER_ID_LOCAL, ownerEmail: "admin@example.test", mine: false };

type Call = { method: string; url: string; body: unknown };
let calls: Call[];
let startAnswer: { status: number; body: unknown };
const open = vi.fn();

beforeEach(() => {
  calls = [];
  startAnswer = {
    status: 200,
    body: { nonce: NONCE, subjectId: ALICE, subjectEmail: "alice@example.test", expiresAt: "2026-10-20T12:30:00Z" },
  };
  open.mockReset();
  vi.spyOn(window, "open").mockImplementation((...args: unknown[]) => {
    open(...args);
    return null;
  });
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
    calls.push({ method, url, body });
    const json = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
    if (url === "/api/admin/view-as" && method === "POST") return json(startAnswer.status, startAnswer.body);
    return json(200, { articles: [THEIRS, MINE, ANOTHER_ADMINS], emailsAvailable: true });
  }) as typeof fetch;
});

let host: HTMLDivElement;
let root: Root;

async function settle() {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
    });
  }
}

async function mount(node: ReactNode) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  /* `/admin/articles` keeps its sort in the address through nuqs (plan 261021i),
     which needs its adapter above it, as main.tsx gives the app. */
  await act(async () => root.render(<NuqsAdapter>{node}</NuqsAdapter>));
  await settle();
}

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

const buttons = (el: Element | null | undefined, label: string) =>
  [...(el?.querySelectorAll("button") ?? [])].filter((b) => b.textContent?.trim() === label) as HTMLButtonElement[];
const rows = () => [...host.querySelectorAll("tbody tr")];
const asking = () => host.querySelector('section[aria-label="View as this reader"]');

async function click(el: HTMLElement | undefined) {
  if (!el) throw new Error("nothing to click");
  await act(async () => el.click());
  await settle();
}

async function type(text: string) {
  const input = asking()?.querySelector("input");
  if (!input) throw new Error("no reason box");
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle();
}

describe("/admin/articles: View as owner", () => {
  it("is drawn on another reader's row only", async () => {
    await mount(<AdminArticlesPage />);
    expect(rows()).toHaveLength(3);
    const drawn = rows().map((tr) => buttons(tr, "View as owner").length);
    expect(drawn).toEqual([1, 0, 0]);
  });

  it("asks why, starts with exactly the owner and the reason, and opens the tab noopener", async () => {
    await mount(<AdminArticlesPage />);
    await click(buttons(rows()[0], "View as owner")[0]);
    expect(asking()?.textContent).toContain("alice@example.test");
    const start = buttons(asking(), "View as")[0]!;
    expect(start.disabled).toBe(true);
    await type("  their report says the shelf is empty  ");
    await click(buttons(asking(), "View as")[0]);
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts).toEqual([
      { method: "POST", url: "/api/admin/view-as", body: { subject: ALICE, reason: "their report says the shelf is empty" } },
    ]);
    expect(open).toHaveBeenCalledWith(`/#view-as=${NONCE}`, "_blank", "noopener");
    /* And a link to the same address, for a browser that blocked the window. */
    expect(asking()?.querySelector("a")?.getAttribute("href")).toBe(`/#view-as=${NONCE}`);
    expect(asking()?.querySelector("a")?.getAttribute("rel")).toContain("noopener");
  });

  it("shows a refusal in the server's words and opens nothing", async () => {
    startAnswer = { status: 403, body: { error: "An administrator's account can't be viewed as. [view-as-admin-subject]" } };
    await mount(<AdminArticlesPage />);
    await click(buttons(rows()[0], "View as owner")[0]);
    await type("checking");
    await click(buttons(asking(), "View as")[0]);
    expect(asking()?.textContent).toContain("[view-as-admin-subject]");
    expect(open).not.toHaveBeenCalled();
  });
});

describe("/admin/users: View as in the Account cell", () => {
  const user = (id: string, email: string) => ({
    id,
    email,
    providers: ["email"],
    emailConfirmedAt: "2026-01-01T00:00:00Z",
  });

  async function cellFor(u: ReturnType<typeof user>, onViewAs?: (u: unknown) => void) {
    const column = adminColumns(Date.now(), onViewAs as never).find((c) => c.id === "email")!;
    const cell = column.cell as (ctx: { row: { original: unknown } }) => ReactNode;
    await mount(<div>{cell({ row: { original: u } })}</div>);
  }

  it("is drawn for a reader, and pressing it names that reader", async () => {
    const pressed = vi.fn();
    const alice = user(ALICE, "alice@example.test");
    await cellFor(alice, pressed);
    await click(buttons(host, "View as")[0]);
    expect(pressed).toHaveBeenCalledWith(alice);
  });

  it("is not drawn for an administrator's account", async () => {
    await cellFor(user(ADMIN_USER_ID_LOCAL, "admin@example.test"), vi.fn());
    expect(buttons(host, "View as")).toHaveLength(0);
  });

  it("is not drawn when the page passes no handler", async () => {
    await cellFor(user(ALICE, "alice@example.test"));
    expect(buttons(host, "View as")).toHaveLength(0);
  });
});
