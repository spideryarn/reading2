// @vitest-environment jsdom
/**
 * **Search's order row says which order is pressed, and the hint under failed
 * searches promises a retry only where there is one.**
 *
 * Two small states of `SearchPanel`, from docs/plans/261007a-ui-sweep-umbrella.md
 * § K4:
 *
 *  - The three order buttons had no `aria-pressed` and no group name, so a
 *    screen reader heard three buttons and not which one was in force. The five
 *    sibling rows are `OrderGroup`s, "Order the … by"; this row stays its own
 *    markup (the review's U16) and takes the same name and state.
 *  - With every ticked search failed, the panel said "The ⚠ on each row above
 *    tries it again", which is false for a row whose failure another try cannot
 *    fix: there the ⚠ is plain text, not a button (`worthRetrying`).
 *
 * The harness is tests/search-opens-prioritised.test.tsx's.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NuqsAdapter } from "nuqs/adapters/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Block, BlockId, SearchRun } from "../src/types.js";

let answer: (url: string, init: RequestInit) => Promise<Response>;

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>(
    "../src/web/lib/api.js",
  );
  const apiFetch = (url: string, init: RequestInit = {}) => answer(url, init);
  return {
    ...real,
    apiFetch,
    fetchOk: async (url: string, init: RequestInit = {}) => {
      const r = await apiFetch(url, init);
      if (!r.ok) throw await real.failure(r);
      return r;
    },
  };
});

const { SearchBand } = await import("../src/web/modes/search/SearchMode.js");

const SLUG = "a-piece";
const ONE = "spya-k3m9qt" as BlockId;

const BLOCKS: Block[] = [
  {
    id: ONE,
    tag: "p",
    kind: "text",
    text: "Thirty-one participants in each arm, with no unexposed comparison group.",
    words: 11,
    html: "<p>Thirty-one participants in each arm, with no unexposed comparison group.</p>",
    gistable: true,
  },
];

/* Real ids: `?runs=` validates through the block-id pattern. */
const DONE = "spya-rnabcd";
const BUSY = "spya-rnabdc";
const BROKE = "spya-rnacbd";

const done: SearchRun = {
  id: DONE,
  criterion: "how big was the trial",
  kind: "meaning",
  createdAt: "2026-09-12T10:00:00.000Z",
  status: "done",
  hits: [{ blockId: ONE, quote: "Thirty-one participants", confidence: 60, reasoning: "the size" }],
};

const failed = (id: string, criterion: string, error: string): SearchRun => ({
  id,
  criterion,
  kind: "meaning",
  createdAt: "2026-09-12T10:00:00.000Z",
  status: "error",
  error,
  hits: [],
});

/* `retry`: another go may pass. `ours`: it cannot (src/messages.ts § CODE_KINDS). */
const RETRYABLE = failed(BUSY, "what was the dose", "The AI service is busy right now. [ai-busy]");
const PERMANENT = failed(
  BROKE,
  "who paid for it",
  "This app's account with the AI service has run out of credit. [ai-no-credit]",
);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function open(runs: SearchRun[], query = ""): Promise<void> {
  answer = (url) =>
    Promise.resolve(
      (url.split("?")[0] ?? url) === `/api/search/${SLUG}`
        ? json({ runs, sourceHash: "h" })
        : json({ error: "not found" }, 404),
    );
  history.replaceState(null, "", `/read/${SLUG}?mode=search&runs=${runs.map((r) => r.id).join(",")}${query}`);
  act(() =>
    root.render(
      createElement(
        NuqsAdapter,
        null,
        createElement(SearchBand, {
          slug: SLUG,
          blocks: BLOCKS,
          onJump: () => {},
          onFound: () => {},
          openHit: null,
          onOpenHit: () => {},
        }),
      ),
    ),
  );
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

describe("Search's order row", () => {
  const orders = () => [...host.querySelectorAll<HTMLButtonElement>(".srch-sort-btn")];
  const pressed = () => orders().map((b) => `${b.textContent}:${b.getAttribute("aria-pressed")}`);

  it("is a named group, worded like its siblings'", async () => {
    await open([done]);
    const group = orders()[0]?.closest('[role="group"]');
    expect(group, "the order buttons are in no group").not.toBeNull();
    expect(group?.getAttribute("aria-label")).toBe("Order the passages by");
    /* The group holds the three orders and nothing else: the count beside
       them is not something to order by. */
    expect(group?.querySelectorAll("button")).toHaveLength(3);
    expect(group?.querySelector(".srch-count")).toBeNull();
  });

  it("says which order is pressed, and only that one", async () => {
    await open([done]);
    expect(pressed()).toEqual(["by place:false", "by confidence:false", "prioritised:true"]);
  });

  it("moves the pressed state with the reader's choice", async () => {
    await open([done]);
    await act(async () => orders()[0]!.click());
    expect(pressed()).toEqual(["by place:true", "by confidence:false", "prioritised:false"]);
    /* The look is still the class's: `aria-pressed` is added, not swapped in. */
    expect(orders()[0]!.className).toBe("srch-sort-btn on");
  });
});

describe("the hint under searches that all failed", () => {
  const hint = () => host.querySelector(".srch-empty .srch-empty-hint")?.textContent ?? "";
  const retryButtons = () => host.querySelectorAll("button.srch-icon:not(.srch-icon-dead) .lucide-triangle-alert").length;

  it("says the ⚠ tries again when every failed row's ⚠ is a button", async () => {
    await open([RETRYABLE]);
    expect(host.querySelector(".srch-failed")?.textContent).toContain("[ai-busy]");
    expect(retryButtons(), "the precondition: the row's ⚠ is a button").toBe(1);
    expect(hint()).toBe("The ⚠ on each row above tries it again.");
  });

  it("promises no retry when no failed row has one", async () => {
    await open([PERMANENT]);
    expect(host.querySelector(".srch-failed")?.textContent).toContain("[ai-no-credit]");
    expect(retryButtons(), "the precondition: no ⚠ is a button").toBe(0);
    expect(hint()).not.toContain("tries");
    expect(hint()).toContain("only marks the failure");
  });

  it("says which rows it is true of when some can be tried again and some cannot", async () => {
    await open([RETRYABLE, PERMANENT]);
    expect(host.querySelector(".srch-failed")?.textContent).toContain("All 2 of these searches failed.");
    expect(retryButtons()).toBe(1);
    expect(hint()).not.toBe("The ⚠ on each row above tries it again.");
    expect(hint()).toContain("where that could work");
    expect(hint()).toContain("only marks the failure");
  });
});
