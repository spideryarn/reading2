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
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ADMIN_USER_ID_LOCAL } from "../src/admin.js";
import type { AdminFeedbackPage, AdminFeedbackReport } from "../src/types.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

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

const READER = "f6fa5f50-fb98-47a9-84b4-03d6edba7136";

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
    ignoredAt: null,
    createdAt: "2026-10-01T09:00:00.000Z",
  };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Every request the page made, its lifetime, and a hand to answer it when the test says. */
const asked: {
  url: string;
  method: string;
  sent: unknown;
  signal: AbortSignal | null;
  answer: (page: AdminFeedbackPage) => void;
  /** Any body and status: the Ignore button's PATCH answers `{ report }`, or fails. */
  reply: (body: unknown, status?: number) => void;
}[] = [];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  asked.length = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init?.signal ?? null;
          const abort = () => {
            signal?.removeEventListener("abort", abort);
            reject(new DOMException("Aborted", "AbortError"));
          };
          signal?.addEventListener("abort", abort, { once: true });
          const reply = (body: unknown, status = 200) => {
            signal?.removeEventListener("abort", abort);
            resolve(json(body, status));
          };
          asked.push({
            url: String(input),
            method: init?.method ?? "GET",
            sent: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
            signal,
            answer: (page) => reply(page),
            reply,
          });
          if (signal?.aborted) abort();
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
  it("starts a live request again when StrictMode rehearses the effect", async () => {
    await act(async () => root.render(<StrictMode><Page /></StrictMode>));
    await waitFor("StrictMode's live request", () => asked.some((request) => !request.signal?.aborted));

    const live = asked.filter((request) => !request.signal?.aborted);
    expect(live).toHaveLength(1);
    expect(asked.filter((request) => request !== live[0]).every((request) => request.signal?.aborted)).toBe(true);

    await act(async () => live[0]?.answer({ reports: [], hasMore: false, nextCursor: null }));
    await waitFor("the live answer", () => host.textContent?.includes("0 reports") === true);
  });

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
    /* The keyed remount prevents stale state from painting; aborting also
       releases the old response body and connection instead of leaving a
       request for a component that no longer exists. */
    expect(asked[1]?.signal?.aborted).toBe(true);

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

/**
 * **Ignore** — Greg, 2026-10-03 (`spya-g95x4j`): *"I just saw feedback that I
 * wished I could delete, and there wasn't a way to do it, or at least mark it
 * as to be ignored."* docs/plans/261003j-….
 */
describe("Ignore", () => {
  const card = (body: string): HTMLElement => {
    const found = [...host.querySelectorAll("li")].find((li) => li.textContent?.includes(body));
    if (!found) throw new Error(`no card for "${body}"`);
    return found as HTMLElement;
  };
  const within = (li: HTMLElement, name: string): HTMLButtonElement => {
    const found = [...li.querySelectorAll("button")].find((b) => b.textContent?.trim() === name);
    if (!found) throw new Error(`no button "${name}" on that card`);
    return found;
  };

  async function twoReports(): Promise<void> {
    await act(async () => root.render(<Page />));
    await waitFor("the first request", () => asked.length === 1);
    await act(async () =>
      asked[0]?.answer({
        reports: [report("spya-eeeeee", READER, "ASDF1"), report("spya-ffffff", READER, "a real bug")],
        hasMore: false,
        nextCursor: null,
      }),
    );
    await waitFor("both cards", () => bodies().length === 2);
  }

  it("marks the one card from the server's answer, and takes it back", async () => {
    await twoReports();
    expect(card("ASDF1").dataset.ignored).toBeUndefined();

    await act(async () => within(card("ASDF1"), "Ignore").click());
    await waitFor("the PATCH", () => asked.length === 2);
    expect(asked[1]?.method).toBe("PATCH");
    expect(asked[1]?.url).toBe(`/api/admin/feedback/${READER}/spya-eeeeee`);
    expect(asked[1]?.sent).toEqual({ ignored: true });
    /* Not drawn as ignored until the server has said so. */
    expect(card("ASDF1").dataset.ignored).toBeUndefined();
    expect(within(card("ASDF1"), "Ignore").disabled).toBe(true);

    await act(async () =>
      asked[1]?.reply({
        report: { ...report("spya-eeeeee", READER, "ASDF1"), ignoredAt: "2026-10-03T10:00:00.000Z" },
      }),
    );
    await waitFor("the ignored card", () => card("ASDF1").dataset.ignored === "true");
    expect(card("ASDF1").textContent).toContain("Ignored");
    /* Still in the list, words and all, and the other card untouched. */
    expect(bodies()).toEqual(["ASDF1", "a real bug"]);
    expect(card("a real bug").dataset.ignored).toBeUndefined();

    await act(async () => within(card("ASDF1"), "Undo").click());
    await waitFor("the undo", () => asked.length === 3);
    expect(asked[2]?.sent).toEqual({ ignored: false });
    await act(async () => asked[2]?.reply({ report: report("spya-eeeeee", READER, "ASDF1") }));
    await waitFor("the card back as it was", () => card("ASDF1").dataset.ignored === undefined);
    within(card("ASDF1"), "Ignore");
  });

  /* GPT Sol's plan review, F2: a Refresh that read the old row and landed
     after the PATCH would put *Ignore* back on a report the database is
     already ignoring. So the list and the write take turns: neither can be
     started while the other is in flight. */
  it("takes turns with Refresh, so an older list cannot land on top of the write", async () => {
    await twoReports();

    await act(async () => button("Refresh").click());
    await waitFor("the refresh", () => asked.length === 2);
    expect(within(card("ASDF1"), "Ignore").disabled).toBe(true);
    await act(async () => within(card("ASDF1"), "Ignore").click());
    await settle();
    expect(asked).toHaveLength(2);
    await act(async () =>
      asked[1]?.answer({
        reports: [report("spya-eeeeee", READER, "ASDF1"), report("spya-ffffff", READER, "a real bug")],
        hasMore: false,
        nextCursor: null,
      }),
    );
    await waitFor("the button back", () => within(card("ASDF1"), "Ignore").disabled === false);

    await act(async () => within(card("ASDF1"), "Ignore").click());
    await waitFor("the PATCH", () => asked.length === 3);
    expect(button("Refresh").disabled).toBe(true);
    /* Every card waits, not only the one pressed. */
    expect(within(card("a real bug"), "Ignore").disabled).toBe(true);
    await act(async () =>
      asked[2]?.reply({
        report: { ...report("spya-eeeeee", READER, "ASDF1"), ignoredAt: "2026-10-03T10:00:00.000Z" },
      }),
    );
    await waitFor("the ignored card", () => card("ASDF1").dataset.ignored === "true");
    expect(button("Refresh").disabled).toBe(false);
    expect(within(card("a real bug"), "Ignore").disabled).toBe(false);
  });

  it("leaves the card as it was when the write fails, and says so", async () => {
    await twoReports();
    await act(async () => within(card("ASDF1"), "Ignore").click());
    await waitFor("the PATCH", () => asked.length === 2);
    await act(async () => asked[1]?.reply({ error: "There is no such report." }, 404));
    await waitFor("the failure", () => card("ASDF1").querySelector('[role="alert"]') !== null);
    expect(card("ASDF1").dataset.ignored).toBeUndefined();
    /* Pressable again: a failure is not a dead button. */
    expect(within(card("ASDF1"), "Ignore").disabled).toBe(false);
  });
});
