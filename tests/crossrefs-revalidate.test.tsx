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
let generated = false;

vi.mock("../src/web/lib/api.js", () => ({
  apiFetch: async (input: string) => {
    asked.push(input);
    if (!generated) return new Response("{}", { status: 404 });
    const body = {
      crossrefs: {
        version: "crossrefs/2",
        generator: "test",
        slug: SLUG,
        sourceHash: "h",
        links: [{ from: "spya-aaaaaa", phrase: "the result", to: "spya-bbbbbb" }],
      },
      stale: false,
      outdated: false,
    };
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  },
  readJson: async (res: Response) => res.json(),
}));

/** The job poller, posed by the test. */
let announce: ((job: { slug: string; status: string; steps: { name: string }[] }) => void) | null = null;
vi.mock("../src/web/useJobs.js", () => ({
  useJobs: (_cadence: unknown, cb?: (job: never) => void) => {
    announce = (cb ?? null) as typeof announce;
    return { jobs: [], loaded: true, error: null };
  },
}));

const { useCrossrefs } = await import("../src/web/useCrossrefs.js");

function Harness(): ReactElement {
  const links = useCrossrefs(SLUG);
  return createElement("p", null, links ? links.map((l) => l.phrase).join(",") : "none");
}

const settle = () => act(async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); });

let host: HTMLElement;
let root: Root;
beforeEach(() => {
  asked.length = 0;
  generated = false;
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

    generated = true;
    await act(async () => announce?.({ slug: SLUG, status: "done", steps: [{ name: "crossrefs" }] }));
    await settle();
    expect(host.textContent).toBe("the result");
    expect(asked).toHaveLength(2);
  });

  it("ignores a job for another article, or one that does not write crossrefs", async () => {
    await act(async () => root.render(createElement(Harness)));
    await settle();
    generated = true;
    await act(async () => announce?.({ slug: "another", status: "done", steps: [{ name: "crossrefs" }] }));
    await act(async () => announce?.({ slug: SLUG, status: "done", steps: [{ name: "ideas" }] }));
    await settle();
    expect(asked).toHaveLength(1);
    expect(host.textContent).toBe("none");
  });
});
