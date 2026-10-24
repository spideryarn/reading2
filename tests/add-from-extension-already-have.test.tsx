// @vitest-environment jsdom
/**
 * **The page the Chrome extension opens, rendered in Strict Mode, over a page
 * the reader already has** — src/web/AddFromExtension.tsx, plan
 * docs/plans/261024y-a-second-press-on-a-page-already-on-the-shelf-opens-it.md.
 *
 * `receive` is tested with its edges injected in tests/extension-handoff.test.ts.
 * What that cannot see is the wiring GPT Sol's plan review asked about (F4):
 * Strict Mode's mount, unmount and mount again sharing one ask; the lookup
 * made for the mounted reader; a found page never reaching the upload engine,
 * not even after a remount; and a failed lookup offering Try again over the
 * same capture rather than uploading or losing it.
 */
import { StrictMode, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { REPEAT_PASTE_ON_THE_SHELF } from "../src/messages.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const READER = "00000000-0000-4000-8000-00000000a11c";
const SAVED = "https://www.cell.com/fulltext/S1";

const lookups: { input: string; madeFor: string | null | undefined }[] = [];
let answer: () => Response = () => Response.json({ slug: "mine-spya-k3m9qt" });

vi.mock("../src/web/lib/api.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/lib/api.js")>();
  return {
    ...real,
    apiFetch: async (input: string, _init?: RequestInit, madeFor?: string | null) => {
      lookups.push({ input, madeFor });
      return answer();
    },
  };
});

vi.mock("../src/web/lib/session.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/lib/session.js")>();
  return { ...real, heldReader: () => READER };
});

const { AddFromExtension, forgetAsk } = await import("../src/web/AddFromExtension.js");
const { ONE_UPLOAD_AT_A_TIME, uploadEngine } = await import("../src/web/uploadEngine.js");

let host: HTMLDivElement;
let root: Root;
let takes: number;
const sendMessage = async () => {
  takes += 1;
  return { kind: "page", html: "<!doctype html><p>x</p>", filename: "X.html", savedFrom: SAVED };
};

beforeEach(() => {
  forgetAsk();
  lookups.length = 0;
  takes = 0;
  answer = () => Response.json({ slug: "mine-spya-k3m9qt" });
  vi.spyOn(uploadEngine, "reader").mockReturnValue(READER);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
});

async function render(): Promise<void> {
  await act(async () => {
    root.render(
      <StrictMode>
        <AddFromExtension readerId={READER} sendMessage={sendMessage} />
      </StrictMode>,
    );
  });
  /* The extension's answer, then the lookup, then the state. */
  for (let i = 0; i < 5; i++) await act(async () => {});
}

describe("a page the reader already has", () => {
  it("is offered, asked once of the extension, looked up for this reader, and never uploaded", async () => {
    const send = vi.spyOn(uploadEngine, "send");
    await render();
    expect(host.textContent).toContain(REPEAT_PASTE_ON_THE_SHELF);
    expect(host.querySelector("button")?.textContent).toBe("Open the article");
    expect(takes).toBe(1);
    expect(lookups).toHaveLength(1);
    for (const one of lookups) {
      expect(one).toEqual({ input: `/api/library/by-url?url=${encodeURIComponent(SAVED)}`, madeFor: READER });
    }
    expect(send).not.toHaveBeenCalled();

    /* Back to this address: a new mount over the same cached capture. */
    await act(async () => root.unmount());
    root = createRoot(host);
    answer = () => Response.json({ slug: null });
    await render();
    expect(send).not.toHaveBeenCalled();
    expect(takes).toBe(1);
  });

  it("a lookup that fails uploads nothing, and Try again asks again over the same capture", async () => {
    const send = vi.spyOn(uploadEngine, "send");
    answer = () => new Response("down", { status: 503 });
    await render();
    expect(host.textContent).toContain("couldn't check whether this page is already on your shelf");
    expect(send).not.toHaveBeenCalled();

    answer = () => Response.json({ slug: "mine-spya-k3m9qt" });
    const retry = [...host.querySelectorAll("button")].find((b) => b.textContent === "Try again");
    expect(retry).toBeDefined();
    await act(async () => retry!.click());
    for (let i = 0; i < 5; i++) await act(async () => {});
    expect(host.textContent).toContain(REPEAT_PASTE_ON_THE_SHELF);
    expect(takes).toBe(1);
    expect(lookups).toHaveLength(2);
    expect(send).not.toHaveBeenCalled();
  });

  it("a page not on the shelf is uploaded once", async () => {
    answer = () => Response.json({ slug: null });
    const send = vi.spyOn(uploadEngine, "send").mockResolvedValue("e47e0510-0000-4000-8000-0000000a1f7e");
    await render();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries once when the competing upload has already settled before the refusal renders", async () => {
    answer = () => Response.json({ slug: null });
    const send = vi
      .spyOn(uploadEngine, "send")
      .mockRejectedValueOnce(new Error(ONE_UPLOAD_AT_A_TIME))
      .mockResolvedValueOnce("e47e0510-0000-4000-8000-0000000a1f7e");

    await render();

    expect(send).toHaveBeenCalledTimes(2);
    expect(takes).toBe(1);
    expect(lookups).toHaveLength(2);
  });
});
