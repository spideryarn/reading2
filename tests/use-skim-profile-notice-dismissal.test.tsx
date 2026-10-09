// @vitest-environment jsdom
/**
 * The local-write half of Skim's profile-notice dismissal. The route/store
 * round trip is covered by skim-profile-notice-route.test.ts; these are the
 * browser interleavings that only the real hook can settle:
 *
 * - an older GET already in flight must not undo the optimistic hide while the
 *   write's trailing GET is still waiting;
 * - a failed POST is only reported after that trailing GET says the dismissal
 *   did not land (the connection may have failed after the write committed);
 * - a dismissal finishing after navigation cannot change the next article.
 *
 * docs/plans/261009i-skim-profile-notice-can-be-dismissed.md.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Job, SkimResponse } from "../src/types.js";
import type { IdeasRead } from "../src/web/useIdeas.js";
import type { QuotesRead } from "../src/web/useQuotes.js";
import { markUnreachable } from "../src/web/lib/reader-facing.js";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Serve = () => Response | Promise<Response>;
const replies: Serve[] = [];
const requests: Array<{ url: string; method: string }> = [];

vi.mock("../src/web/lib/api.js", async () => {
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return {
    ...real,
    apiFetch: async (url: string, init?: RequestInit) => {
      requests.push({ url, method: init?.method ?? "GET" });
      const reply = replies.shift();
      if (!reply) throw new Error(`No reply queued for ${init?.method ?? "GET"} ${url}`);
      return reply();
    },
  };
});

vi.mock("../src/web/useJobs.js", () => ({
  useJobs: () => ({
    jobs: [] as Job[],
    loaded: true,
    error: null,
    driverFailures: {},
    lastFailure: () => null,
    run: async () => null,
    cancel: async () => {},
    retry: async () => null,
  }),
}));

const { useSkim } = await import("../src/web/useSkim.js");
type UseSkim = import("../src/web/useSkim.js").UseSkim;

const AT = "2026-10-09T01:00:00.000Z";
const response = (slug: string, dismissed: boolean): SkimResponse => ({
  skim: {
    version: "test",
    generator: "test",
    slug,
    sourceHash: "hash",
    profileHash: null,
    stops: [],
    visible: [0, 0, 0],
    offered: 0,
    dropped: {
      collapsed: 0,
      unknownQuote: 0,
      duplicate: 0,
      sameBlock: 0,
      malformed: 0,
      badRole: 0,
      overCap: 0,
    },
    generatedAt: AT,
    elapsedMs: 1,
  },
  stale: false,
  outdated: false,
  profileChanged: true,
  profileNoticeDismissed: dismissed,
  notOnRoute: 0,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const serves = (body: unknown, status = 200): Serve => () => json(body, status);
const dropped = (sentence = "Load failed"): Serve => () =>
  Promise.reject(markUnreachable(new TypeError(sentence)));
const noContent: Serve = () => new Response(null, { status: 204 });

function held(): { serve: Serve; land(reply: Serve): Promise<void> } {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
  });
  let answer: Serve = () => json(null);
  return {
    serve: async () => {
      await gate;
      return answer();
    },
    land: async (reply) => {
      answer = reply;
      await act(async () => open());
      await flush();
    },
  };
}

const fresh = { begin: () => 0, landed: () => {}, begun: () => 0, latest: null };
const quotes: QuotesRead = {
  status: "ready",
  quotes: { quotes: [] } as unknown as QuotesRead["quotes"],
  stale: false,
  outdated: false,
  profiled: false,
  profileChanged: false,
  fresh,
  error: null,
  retryRead: async () => {},
  reload: async () => {},
  refresh: async () => {},
};
const ideas: IdeasRead = {
  status: "ready",
  ideas: { ideas: [] } as unknown as IdeasRead["ideas"],
  stale: false,
  outdated: false,
  profiled: false,
  profileChanged: false,
  fresh,
  error: null,
  retryRead: async () => {},
  reload: async () => {},
  refresh: async () => {},
};

let read: UseSkim | null = null;
function Probe({ slug }: { slug: string }) {
  read = useSkim(slug, quotes, ideas);
  return null;
}

let host: HTMLDivElement;
let root: Root;
const flush = async () =>
  act(async () => {
    for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  });

async function mount(slug = "article-a") {
  await act(async () => root.render(createElement(Probe, { slug })));
  await flush();
}

beforeEach(() => {
  replies.length = 0;
  requests.length = 0;
  read = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("useSkim dismissProfileNotice", () => {
  it("keeps the optimistic hide over an older GET until the trailing read lands", async () => {
    replies.push(serves(response("article-a", false)));
    await mount();

    const oldRead = held();
    const trailing = held();
    replies.push(oldRead.serve, noContent, trailing.serve);
    let refresh!: Promise<void>;
    await act(async () => {
      refresh = read!.refresh();
    });
    let dismiss!: Promise<void>;
    await act(async () => {
      dismiss = read!.dismissProfileNotice();
      await Promise.resolve();
    });
    expect(read!.profileNoticeDismissed, "the press hides the notice at once").toBe(true);

    await oldRead.land(serves(response("article-a", false)));
    expect(
      read!.profileNoticeDismissed,
      "the pre-dismissal GET put the notice back while the write's read was still waiting",
    ).toBe(true);

    await trailing.land(serves(response("article-a", true)));
    await Promise.all([refresh, dismiss]);
    expect(read!.profileNoticeDismissed).toBe(true);
  });

  it("reports a failed POST only when reconciliation says the write did not land", async () => {
    replies.push(serves(response("article-a", false)));
    await mount();

    const reconciliation = held();
    replies.push(dropped(), reconciliation.serve);
    let dismiss!: Promise<void>;
    await act(async () => {
      dismiss = read!.dismissProfileNotice();
      await Promise.resolve();
    });
    expect(read!.profileNoticeDismissed).toBe(true);
    expect(read!.dismissFailed, "a dropped answer is not proof the write failed").toBeNull();

    await reconciliation.land(serves(response("article-a", false)));
    await dismiss;
    expect(read!.profileNoticeDismissed).toBe(false);
    expect(read!.dismissFailed).toContain("[net-down]");
  });

  it("accepts reconciliation that finds the write after the POST answer was lost", async () => {
    replies.push(serves(response("article-a", false)));
    await mount();

    replies.push(dropped(), serves(response("article-a", true)));
    await act(async () => read!.dismissProfileNotice());
    expect(read!.profileNoticeDismissed).toBe(true);
    expect(read!.dismissFailed).toBeNull();
  });

  /* Not kept hidden: nothing confirms the write, and a dismissal the reader
     believes is stored, but is not, comes back on the next open unexplained. */
  it("puts the notice back, with why, when the read after a failed write cannot answer either", async () => {
    replies.push(serves(response("article-a", false)));
    await mount();

    replies.push(dropped(), dropped("Reconciliation failed"));
    await act(async () => read!.dismissProfileNotice());
    expect(read!.profileNoticeDismissed).toBe(false);
    expect(read!.dismissFailed).toContain("[net-down]");
  });

  it("does not attach an old route's rejection to its replacement", async () => {
    replies.push(serves(response("article-a", false)));
    await mount();

    const replacement = response("article-a", false);
    replacement.skim.generatedAt = "2026-10-09T02:00:00.000Z";
    replies.push(dropped(), serves(replacement));
    await act(async () => read!.dismissProfileNotice());
    expect(read!.profileNoticeDismissed).toBe(false);
    expect(read!.dismissFailed).toBeNull();
  });

  it("does not let an old article's dismissal completion change the new article", async () => {
    replies.push(serves(response("article-a", false)));
    await mount();

    const post = held();
    replies.push(post.serve);
    let dismiss!: Promise<void>;
    await act(async () => {
      dismiss = read!.dismissProfileNotice();
      await Promise.resolve();
    });

    replies.push(serves(response("article-b", true)));
    await mount("article-b");
    expect(read!.profileNoticeDismissed).toBe(true);

    await post.land(dropped());
    await dismiss;
    expect(read!.profileNoticeDismissed).toBe(true);
    expect(read!.dismissFailed).toBeNull();
    expect(requests.filter((request) => request.method === "GET")).toHaveLength(2);
  });
});
