// @vitest-environment jsdom
/**
 * `/admin/feedback`'s **Readers only** filter, rendered — src/web/AdminPage.tsx
 * § `AdminFeedbackPage`. Greg, 2026-10-01 (SPIDERYARN-READING2-87): *"provide a
 * filter to show only non-admin suggestions (i.e. suggestions from people other
 * than me)."* docs/plans/261001l-….
 *
 * The filtering is the server's (tests/admin-feedback-store.test.ts,
 * tests/routes.test.ts); this is the half a store test cannot see — that the
 * page asks for it on every page, and that **a switch made while *Load older* is
 * in flight is not overtaken by the older answer**. GPT Sol found that race in
 * the plan: `useAdminFeedback`'s in-flight guard would have dropped the
 * switch's reload, and the everyone-page would then have landed under *Readers
 * only*.
 *
 * Only the Supabase SDK and `fetch` are stubbed, as tests/admin-page.test.tsx.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import type { AdminFeedbackPage, AdminFeedbackReport } from "../src/types.js";

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

const { AdminFeedbackPage: Page } = await import("../src/web/AdminPage.js");

const READER = "3f7b19d4-6c28-4e51-8a03-b5d7e2914c6f";

function report(id: string, ownerId: string, body: string): AdminFeedbackReport {
  return {
    id,
    ownerId,
    reporterEmail: `${body}@example.invalid`,
    body,
    kind: "suggestion",
    consented: false,
    url: null,
    slug: null,
    buildCommit: null,
    environment: "development",
    requestVercelId: null,
    diagnosticsVersion: null,
    screenshotBytes: null,
    mirrorAttemptedAt: null,
    mirroredAt: null,
    sentryEventId: null,
    createdAt: "2026-10-01T09:00:00.000Z",
  };
}

const jsonOk = (body: AdminFeedbackPage) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });

/** Every request the page made, and a hand to answer each when the test says. */
const asked: { url: string; answer: (page: AdminFeedbackPage) => void }[] = [];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (input: RequestInfo | URL) =>
        new Promise<Response>((resolve) => {
          asked.push({ url: String(input), answer: (page) => resolve(jsonOk(page)) });
        }),
    ),
  );
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  history.replaceState(null, "", "/admin/feedback");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

async function settle(turns = 4): Promise<void> {
  for (let i = 0; i < turns; i++) {
    await act(async () => {
      await new Promise((go) => setTimeout(go, 0));
    });
  }
}

async function waitFor(what: string, ready: () => boolean): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (ready()) return;
    await settle(1);
  }
  throw new Error(`never happened: ${what}`);
}

function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
  if (!found) throw new Error(`no button "${name}"`);
  return found;
}

function bodies(): string[] {
  return [...host.querySelectorAll("li p")].map((p) => p.textContent ?? "");
}

describe("Readers only", () => {
  it("asks the server for readers on every page", async () => {
    await act(async () => root.render(<Page />));
    await waitFor("the first request", () => asked.length === 1);
    expect(asked[0]?.url).not.toContain("from=");
    expect(button("Everyone").getAttribute("aria-pressed")).toBe("true");

    await act(async () => button("Readers only").click());
    await waitFor("the readers request", () => asked.length === 2);
    expect(asked[1]?.url).toContain("from=readers");
    expect(button("Readers only").getAttribute("aria-pressed")).toBe("true");

    await act(async () =>
      asked[1]?.answer({
        reports: [report("spya-aaaaaa", READER, "first")],
        hasMore: true,
        nextCursor: { createdAt: "2026-10-01T09:00:00.000Z", ownerId: READER, id: "spya-aaaaaa" },
      }),
    );
    await waitFor("the first readers page", () => bodies().includes("first"));

    await act(async () => button("Load older").click());
    await waitFor("the next readers page", () => asked.length === 3);
    /* The cursor carries no filter, so the page has to send it again. */
    expect(asked[2]?.url).toContain("from=readers");
    expect(asked[2]?.url).toContain("before=");
  });

  it("is not overtaken by a Load older that was in flight when it was pressed", async () => {
    await act(async () => root.render(<Page />));
    await waitFor("the first request", () => asked.length === 1);
    await act(async () =>
      asked[0]?.answer({
        reports: [report("spya-bbbbbb", ADMIN_USER_ID_LOCAL, "greg-newest")],
        hasMore: true,
        nextCursor: {
          createdAt: "2026-10-01T09:00:00.000Z",
          ownerId: ADMIN_USER_ID_LOCAL,
          id: "spya-bbbbbb",
        },
      }),
    );
    await waitFor("everyone's first page", () => bodies().includes("greg-newest"));

    /* Load older, still in flight… */
    await act(async () => button("Load older").click());
    await waitFor("the older everyone page", () => asked.length === 2);
    /* …when the switch is pressed. Its request must go out, not be dropped. */
    await act(async () => button("Readers only").click());
    await waitFor("the readers request", () => asked.length === 3);
    expect(asked[2]?.url).toContain("from=readers");
    expect(asked[2]?.url).not.toContain("before=");

    /* Answered out of order: readers first, then the stale everyone page. */
    await act(async () =>
      asked[2]?.answer({ reports: [report("spya-cccccc", READER, "reader")], hasMore: false, nextCursor: null }),
    );
    await act(async () =>
      asked[1]?.answer({
        reports: [report("spya-dddddd", ADMIN_USER_ID_LOCAL, "greg-older")],
        hasMore: false,
        nextCursor: null,
      }),
    );
    await settle();
    expect(bodies()).toEqual(["reader"]);
    expect(host.textContent).not.toContain("Load older");
  });
});
