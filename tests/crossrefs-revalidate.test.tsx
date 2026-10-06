// @vitest-environment jsdom
/**
 * **A crossrefs job that finishes while the article is open reaches the prose.**
 *
 * The after-import box queues `crossrefs` as the article opens, so the first
 * read is the ordinary 404 and the links land a minute later. `useCrossrefs`
 * refreshes when `useJobs` announces a finished job for this article that
 * writes `crossrefs` — and only then.
 * docs/plans/260930f-cross-reference-links-between-blocks-with-a-rich-hover-preview.md.
 */
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SLUG = "xref-revalidate";
const asked: string[] = [];
/** What the next GET answers. `generated` is the links, fresh. */
type Answer = "none-404" | "none-null" | "generated" | "stale" | "http-500" | "transport";
let answer: Answer = "none-404";

vi.mock("../src/web/lib/api.js", async () => {
  /* The real `readJson`, because the claim below turns on it: it is what
     throws for a 500, and a mock that only parsed the body would make a failed
     refresh look like a successful one. */
  const real = await vi.importActual<typeof import("../src/web/lib/api.js")>("../src/web/lib/api.js");
  return {
    ...real,
    apiFetch: async (input: string) => {
      asked.push(input);
      const slug = decodeURIComponent(input.split("/").pop() ?? "");
      if (answer === "transport") throw new TypeError("Load failed");
      if (answer === "http-500") return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
      if (answer === "none-404") return new Response("{}", { status: 404 });
      if (answer === "none-null") return new Response("null", { status: 200 });
      const body = {
        crossrefs: {
          version: "crossrefs/2",
          generator: "test",
          slug,
          sourceHash: "h",
          links: [{ from: "spya-aaaaaa", phrase: "the result", to: "spya-bbbbbb" }],
        },
        stale: answer === "stale",
        outdated: false,
      };
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    },
  };
});

/** The job poller, posed by the test. */
let announce: ((job: { slug: string; status: string; steps: { name: string }[] }) => void) | null = null;
vi.mock("../src/web/useJobs.js", () => ({
  useJobs: (_cadence: unknown, cb?: (job: never) => void) => {
    announce = (cb ?? null) as typeof announce;
    return { jobs: [], loaded: true, error: null };
  },
}));

const { useCrossrefs } = await import("../src/web/useCrossrefs.js");

function Harness({ slug = SLUG }: { slug?: string }): ReactElement {
  const links = useCrossrefs(slug);
  return createElement("p", null, links ? links.map((l) => l.phrase).join(",") : "none");
}

const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  asked.length = 0;
  answer = "none-404";
  announce = null;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("useCrossrefs revalidates on a finished crossrefs job", () => {
  it("draws the links once the job for this article finishes, with no reload", async () => {
    await act(async () => root.render(createElement(Harness)));
    await settle();
    expect(host.textContent).toBe("none");
    expect(asked).toHaveLength(1);

    answer = "generated";
    await act(async () => announce?.({ slug: SLUG, status: "done", steps: [{ name: "crossrefs" }] }));
    await settle();
    expect(host.textContent).toBe("the result");
    expect(asked).toHaveLength(2);
  });

  it("ignores a job for another article, or one that does not write crossrefs", async () => {
    await act(async () => root.render(createElement(Harness)));
    await settle();
    answer = "generated";
    await act(async () => announce?.({ slug: "another", status: "done", steps: [{ name: "crossrefs" }] }));
    await act(async () => announce?.({ slug: SLUG, status: "done", steps: [{ name: "ideas" }] }));
    await settle();
    expect(asked).toHaveLength(1);
    expect(host.textContent).toBe("none");
  });

  /* **A failed refresh is not an answer.** Until 2026-10-06 the catch stored
     `links: null`, which was right when this hook read once and wrong from the
     day it began refreshing on every finished job: a 500 after the job took the
     underlines out of the prose. The four cases after the first two are the
     other half of the claim — each is a read that *did* answer, or a different
     article, and each must still clear. */
  const finishJob = async (slug = SLUG) => {
    await act(async () => announce?.({ slug, status: "done", steps: [{ name: "crossrefs" }] }));
    await settle();
  };
  const drawn = async () => {
    answer = "generated";
    await act(async () => root.render(createElement(Harness)));
    await settle();
    expect(host.textContent, "the links are drawn first").toBe("the result");
  };

  for (const failure of ["http-500", "transport"] as const) {
    it(`keeps the links it has when the refresh fails (${failure})`, async () => {
      await drawn();
      answer = failure;
      await finishJob();
      expect(asked, "the refresh was sent").toHaveLength(2);
      expect(host.textContent).toBe("the result");
    });
  }

  it("clears the links when the refresh answers, and the answer is stale", async () => {
    await drawn();
    answer = "stale";
    await finishJob();
    expect(asked).toHaveLength(2);
    expect(host.textContent).toBe("none");
  });

  for (const absence of ["none-404", "none-null"] as const) {
    it(`clears the links when the refresh answers that there are none (${absence})`, async () => {
      await drawn();
      answer = absence;
      await finishJob();
      expect(asked).toHaveLength(2);
      expect(host.textContent).toBe("none");
    });
  }

  it("draws nothing when the opening read fails", async () => {
    answer = "http-500";
    await act(async () => root.render(createElement(Harness)));
    await settle();
    expect(host.textContent).toBe("none");
  });

  it("never carries one article's links to the next, whose own read failed", async () => {
    await drawn();
    answer = "http-500";
    await act(async () => root.render(createElement(Harness, { slug: "the-next-article" })));
    await settle();
    expect(asked).toHaveLength(2);
    expect(host.textContent).toBe("none");
    /* And back: the first article's links were for a read this mount no longer
       vouches for, so a failed read on return draws nothing either. */
    await act(async () => root.render(createElement(Harness)));
    await settle();
    expect(host.textContent).toBe("none");
  });
});
