// @vitest-environment jsdom
/**
 * **A mockup's id in a question opens the mockup in place** — plan 261029g,
 * after plan 261028b's link left Greg's home-screen web app with no way back
 * to the dialog (`spya-rrvwca`). Only an id of the fixed shape becomes a
 * button, nothing inside a monospaced block does, and tapping it draws the
 * mockup after its surrounding plain-text run rather than navigating anywhere.
 * src/web/MockupsInText.tsx, src/web/MockupView.tsx.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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

const { TextWithMockups } = await import("../src/web/MockupsInText.js");
const { PlainTextBlocks } = await import("../src/web/PlainTextBlocks.js");

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ID = "m-n0gnmu";
const asked: string[] = [];

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  asked.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(typeof input === "string" ? input : input instanceof URL ? input : input.url);
    asked.push(url);
    if (url === `/api/admin/mockups/${ID}`) {
      return Response.json({
        mockup: {
          id: ID,
          title: "Two columns",
          made: "2026-10-28",
          question: null,
          report: null,
          body: [{ kind: "text", text: "Inside the mockup, m-k3m9qt.\n```\n+--+\n|  |\n```" }],
          images: [],
        },
      });
    }
    return Response.json({ error: "no" }, { status: 404 });
  }) as typeof fetch;
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

function draw(text: string) {
  act(() => root.render(<TextWithMockups text={text} className="fb-question-text" stateKey="q-aaaaaa:summary" />));
}

const toggles = () => [...host.querySelectorAll<HTMLButtonElement>("button[data-mockup-toggle]")];

describe("TextWithMockups", () => {
  it("makes a mockup id a button, keeps the words around it, and links nowhere", () => {
    draw(`Compare ${ID} with the other one.`);
    expect(toggles().map((b) => b.textContent)).toEqual([ID]);
    expect(toggles()[0]?.getAttribute("aria-expanded")).toBe("false");
    expect(host.querySelectorAll("a")).toHaveLength(0);
    expect(host.textContent).toBe(`Compare ${ID} with the other one.`);
    expect(asked).toEqual([]);
  });

  it("leaves a string that is not a mockup id alone, and anything inside a fence", () => {
    /* `l` is outside the id alphabet (src/ids.ts); seven characters is not an id. */
    draw("m-llllll m-n0gnmuu xm-n0gnmu");
    expect(toggles()).toHaveLength(0);
    draw(`\`\`\`\n${ID}\n\`\`\``);
    expect(toggles()).toHaveLength(0);
  });

  it("opens the mockup after its text run on a tap, and shuts it on the next", async () => {
    draw(`See ${ID}.\n\`\`\`\n+\n\`\`\`\nAfter.`);
    act(() => toggles()[0]?.click());
    await settle();
    expect(asked).toEqual([`/api/admin/mockups/${ID}`]);
    expect(toggles()[0]?.getAttribute("aria-expanded")).toBe("true");
    const shown = host.querySelector(`[data-mockup="${ID}"]`);
    expect(shown?.textContent).toContain("Inside the mockup");
    expect(shown?.querySelector("pre.fb-mono")?.textContent).toBe("+--+\n|  |");
    /* Drawn after the text run that named it, before the block that follows. */
    expect(shown?.previousElementSibling?.textContent).toBe(`See ${ID}.`);
    expect(shown?.nextElementSibling?.tagName).toBe("PRE");
    /* A mockup's own body opens nothing further. */
    expect(shown?.querySelectorAll("button[data-mockup-toggle]")).toHaveLength(0);

    act(() => toggles()[0]?.click());
    expect(host.querySelector(`[data-mockup="${ID}"]`)).toBeNull();
    expect(toggles()[0]?.getAttribute("aria-expanded")).toBe("false");
  });

  it("forgets what was open when keyed to another question, as the thread pager does", async () => {
    /* FeedbackEarlier.tsx keys each body by its question's id: the thread view
       is reused when paging, and without the key the next question would
       inherit this one's open mockup (GPT Sol, plan 261029g, F1). */
    const text = `See ${ID}.`;
    act(() => root.render(<TextWithMockups text={text} className="x" stateKey="q-aaaaaa:summary" />));
    act(() => toggles()[0]?.click());
    await settle();
    expect(host.querySelector(`[data-mockup="${ID}"]`)).not.toBeNull();
    act(() => root.render(<TextWithMockups text={text} className="x" stateKey="q-bbbbbb:summary" />));
    expect(host.querySelector(`[data-mockup="${ID}"]`)).toBeNull();
  });
});

describe("PlainTextBlocks", () => {
  it("makes nothing of a mockup id", () => {
    act(() => root.render(<PlainTextBlocks text={`See ${ID}.`} />));
    expect(host.querySelectorAll("a, button")).toHaveLength(0);
  });
});
