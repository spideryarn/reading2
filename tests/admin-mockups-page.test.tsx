// @vitest-environment jsdom
/**
 * **`/admin/mockups` and one mockup, drawn** — plan 261028b, Stage 3. The
 * table links to each mockup; the page draws the body's text, its ASCII in the
 * monospaced block, and its image fetched through `apiFetch` (so with the
 * bearer header) into a blob URL that is revoked when the page goes — GPT
 * Sol's plan review, F2. Which addresses are the administrator's is
 * tests/admin-only-routes.test.tsx; the server's answers are
 * tests/admin-mockups-route.test.ts.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
/* `apiFetch` reaches for IndexedDB, which jsdom lacks — tests/admin-page.test.tsx. */
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

const { AdminMockupPage, AdminMockupsPage } = await import("../src/web/AdminMockupsPage.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "m-k3m9qt";
const asked: { url: string; auth: string | null }[] = [];
const made: string[] = [];
const revoked: string[] = [];

function answer(url: string): Response {
  if (url === "/api/admin/mockups") {
    return Response.json({
      mockups: [
        { id: ID, title: "Two columns", made: "2026-10-28", question: "q-cgpett", report: null, images: 1 },
      ],
    });
  }
  if (url === `/api/admin/mockups/${ID}`) {
    return Response.json({
      mockup: {
        id: ID,
        title: "Two columns",
        made: "2026-10-28",
        question: "q-cgpett",
        report: "spya-zytb0g",
        body: [
          { kind: "text", text: "Before.\n```\n+--+\n|  |\n```" },
          { kind: "image", index: 0 },
        ],
        images: [{ index: 0, contentType: "image/png" }],
      },
    });
  }
  if (url === `/api/admin/mockups/${ID}/images/0`) {
    return new Response(new Uint8Array([0x89, 0x50, 0x4e, 0x47]), { headers: { "content-type": "image/png" } });
  }
  return Response.json({ error: "no" }, { status: 404 });
}

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  asked.length = 0;
  made.length = 0;
  revoked.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    asked.push({ url, auth: new Headers(init?.headers).get("authorization") });
    return answer(url);
  }) as typeof fetch;
  let n = 0;
  URL.createObjectURL = () => {
    const url = `blob:mockup-${++n}`;
    made.push(url);
    return url;
  };
  URL.revokeObjectURL = (url: string) => {
    revoked.push(url);
  };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function settle(): Promise<void> {
  for (let i = 0; i < 20; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("/admin/mockups", () => {
  it("draws a row per mockup, linking to its page", async () => {
    history.replaceState(null, "", "/admin/mockups");
    await act(async () => root.render(<NuqsAdapter><AdminMockupsPage /></NuqsAdapter>));
    await settle();
    const row = host.querySelector(`tr[data-mockup="${ID}"]`);
    expect(row?.textContent).toContain("Two columns");
    expect(row?.textContent).toContain("2026-10-28");
    expect(row?.textContent).toContain("q-cgpett");
    const links = [...(row?.querySelectorAll("a") ?? [])].map((a) => a.getAttribute("href"));
    expect(links).toContain(`/admin/mockups/${ID}`);
    expect(asked[0]?.auth).toBe("Bearer TOKEN");
  });
});

describe("/admin/mockups/m-xxxxxx", () => {
  it("draws the text, the ASCII monospaced, and the image from an authenticated fetch, revoked on leaving", async () => {
    history.replaceState(null, "", `/admin/mockups/${ID}`);
    await act(async () => root.render(<NuqsAdapter><AdminMockupPage /></NuqsAdapter>));
    await settle();
    expect(host.querySelector("h1")?.textContent).toBe("Two columns");
    expect(host.textContent).toContain("Before.");
    expect(host.querySelector("pre")?.textContent).toBe("+--+\n|  |");
    expect(host.textContent).toContain("spya-zytb0g");
    const image = asked.find((a) => a.url === `/api/admin/mockups/${ID}/images/0`);
    expect(image?.auth).toBe("Bearer TOKEN");
    expect(host.querySelector("img")?.getAttribute("src")).toBe("blob:mockup-1");
    act(() => root.unmount());
    expect(revoked).toEqual(["blob:mockup-1"]);
    root = createRoot(host);
  });
});
