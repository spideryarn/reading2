// @vitest-environment jsdom
/**
 * **The Earlier tab is not drawn again while the reader types on Write.**
 *
 * It is hidden, not unmounted, so every render of FeedbackDialog used to render
 * it too — for an admin, every question thread and waiting report on every
 * keystroke and on the press of Send (spya-bewb4q, plan 261029k). These count
 * renders of the tab's three parts, so a change that lets the dialog's state
 * reach them again goes red here rather than on an old iPad.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const renders = { filter: 0, threads: 0, list: 0 };

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async () => new Response(JSON.stringify({ reports: [], more: false, counts: {} }), { status: 200 }),
  failure: async (res: Response) => new Error(await res.text()),
}));
vi.mock("../src/web/router.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../src/web/router.js")>()),
  useRoute: () => ({ kind: "read", slug: "a-piece", view: "article" }),
  navigate: vi.fn(),
}));
vi.mock("../src/web/useDictationField.js", () => ({
  useDictationField: () => ({
    dictation: { supported: false, armed: false, transcribing: false, recording: null, toggle: () => {}, artifact: () => 0, dismiss: () => {} },
    readOnly: false,
    busy: false,
    toggle: () => {},
    finishThenDone: () => {},
    sendingAfter: false,
  }),
}));
vi.mock("../src/web/DictationStrip.js", () => ({
  DictationButton: () => null,
  DictationStrip: () => null,
}));
vi.mock("../src/web/FeedbackEarlier.js", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/web/FeedbackEarlier.js")>();
  return {
    ...real,
    EarlierFilter: (props: Parameters<typeof real.EarlierFilter>[0]) => {
      renders.filter += 1;
      return real.EarlierFilter(props);
    },
    EarlierThreads: (props: Parameters<typeof real.EarlierThreads>[0]) => {
      renders.threads += 1;
      return real.EarlierThreads(props);
    },
    EarlierList: (props: Parameters<typeof real.EarlierList>[0]) => {
      renders.list += 1;
      return real.EarlierList(props);
    },
  };
});

beforeEach(() => {
  const proto = window.HTMLDialogElement.prototype;
  proto.showModal = function showModal(this: HTMLDialogElement) {
    this.open = true;
  };
  proto.close = function close(this: HTMLDialogElement) {
    this.open = false;
    this.dispatchEvent(new Event("close"));
  };
});

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const { FeedbackDialog } = await import("../src/web/FeedbackDialog.js");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  renders.filter = renders.threads = renders.list = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const where = { url: "https://example.test/read/a-piece", slug: "a-piece", path: "/read/a-piece" };

function type(box: HTMLTextAreaElement, text: string) {
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
  for (let i = 1; i <= text.length; i += 1) {
    act(() => {
      set.call(box, text.slice(0, i));
      box.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }
}

describe("the Earlier tab while the reader is on Write", () => {
  for (const admin of [false, true]) {
    it(`is not rendered again by keystrokes in the Write box (${admin ? "admin" : "reader"})`, async () => {
      await act(async () => {
        root.render(createElement(FeedbackDialog, { open: true, onClose: () => {}, where, admin }));
      });
      const before = { ...renders };
      expect(before.list).toBeGreaterThan(0);
      const box = host.ownerDocument.querySelector<HTMLTextAreaElement>("textarea.fb-body")!;
      type(box, "slow on an iPad");
      expect(box.value).toBe("slow on an iPad");
      expect(renders).toEqual(before);
    });
  }

  it("is drawn with what is current the moment it is shown", async () => {
    await act(async () => {
      root.render(createElement(FeedbackDialog, { open: true, onClose: () => {}, where, admin: false }));
    });
    const box = host.ownerDocument.querySelector<HTMLTextAreaElement>("textarea.fb-body")!;
    type(box, "abc");
    const before = renders.list;
    const tab = [...host.ownerDocument.querySelectorAll<HTMLButtonElement>("[role=tab]")].find((b) =>
      /earlier/i.test(b.textContent ?? ""),
    )!;
    await act(async () => tab.click());
    expect(renders.list).toBeGreaterThan(before);
    expect(host.ownerDocument.querySelector(".fb-earlier")?.hasAttribute("hidden")).toBe(false);
  });
});
