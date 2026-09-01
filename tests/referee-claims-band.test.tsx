// @vitest-environment jsdom
/**
 * **The Claims band, wired to a fetch — is the referee told the paper has
 * moved?**
 *
 * tests/referee-claims-panel.test.tsx renders `ClaimsView` with no hook and no
 * fetch, which is right for what it is about: the three empty states and the
 * document order are pure functions of the props. Staleness is not. It is
 * decided in `useClaims` out of two things that arrive separately — the run,
 * and the paper's fingerprint as the GET reported it — so a test that hands
 * `stale` in as a prop is a test of the sentence, not of the judgement.
 *
 * So this file mounts the real `ClaimsBand` over a stubbed `apiFetch`, the way
 * tests/referee-criteria-panel.test.tsx mounts `CriteriaBand`, and asserts the
 * sentence a referee actually reads. The bug it was written for: the server
 * answers `sourceHash: undefined` for a paper whose blocks it could not read,
 * `JSON.stringify` deletes the key outright, and a client that looked for the
 * *key* therefore never saw the answer — so "we checked and cannot tell" came
 * out as "nothing has moved", silently, which is the wrong way round to be
 * wrong (`isStale`, src/search-stale.ts).
 *
 * No `NuqsAdapter`, unlike the criteria file: Claims owns no query parameter.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Claim, ClaimsRun } from "../src/referee-claims.js";
import type { Block, BlockId } from "../src/types.js";

/** One reply, decided by the test that is running. */
let answer: (url: string, init: RequestInit) => Promise<Response>;

/**
 * `apiFetch` and `fetchOk` both, and `readJson`/`failure` deliberately real,
 * because they are the code that decides whether a reply is an answer —
 * tests/referee-criteria-panel.test.tsx § the harness.
 */
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

const { ClaimsBand } = await import("../src/web/ClaimsPanel.js");

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`, so a plausible-looking
   `spya-aaa111` is not one of ours. docs/project/block-ids.md § the alphabet. */
const CLAIMED = "spya-anc234" as BlockId;
const PASSAGE = "spya-cmr456" as BlockId;
const SLUG = "a-paper";

const BLOCKS: Block[] = [
  {
    id: CLAIMED,
    tag: "p",
    kind: "text",
    text: "The method halves annotation time.",
    words: 5,
    html: "<p>The method halves annotation time.</p>",
    gistable: true,
  },
  {
    id: PASSAGE,
    tag: "p",
    kind: "text",
    text: "Annotation time fell by about half across both cohorts.",
    words: 9,
    html: "<p>Annotation time fell by about half across both cohorts.</p>",
    gistable: true,
  },
];

const CLAIM: Claim = {
  id: `${CLAIMED}:8`,
  blockId: CLAIMED,
  quote: "halves annotation time",
  start: 8,
  claim: "The method halves annotation time",
  passages: [
    { blockId: PASSAGE, quote: "fell by about half", start: 17, reasoning: "the timing" },
  ],
  discarded: 0,
};

function run(over: Partial<ClaimsRun> = {}): ClaimsRun {
  return {
    status: "done",
    createdAt: "2026-09-01T09:00:00.000Z",
    claims: [CLAIM],
    ...over,
  };
}

/* ------------------------------------------------------------ the harness -- */

let host: HTMLDivElement;
let root: Root;

function mount(): void {
  act(() => {
    root.render(
      createElement(ClaimsBand, {
        slug: SLUG,
        blocks: BLOCKS,
        onJump: () => {},
        onFound: () => {},
      }),
    );
  });
}

/** Let the `fetch().then()` chain settle — tests/use-search.test.ts § `flush`. */
async function flush(times = 6): Promise<void> {
  for (let i = 0; i < times; i++) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  answer = () => Promise.resolve(json({ run: null }));
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("a claims run answered about an older paper says so above the list", () => {
  /** The sentence the referee reads. Not imported — `ClaimsPanel` inlines it. */
  const WARNING = "Answered about an earlier version of this paper.";

  /**
   * Load the stored run off the GET, with whatever the server said about the
   * paper's fingerprint, and wait for it to reach the screen.
   *
   * The body goes through `JSON.stringify` exactly as `send` does on the server,
   * so a `sourceHash: undefined` disappears here the same way it disappears on
   * the wire — which is the whole of the bug this pins.
   */
  async function paint(current: string | undefined, answered: string | undefined): Promise<void> {
    const stored = run(answered === undefined ? {} : { sourceHash: answered });
    answer = () => Promise.resolve(json({ run: stored, sourceHash: current }));
    mount();
    await flush();
    expect(host.textContent, "no claim reached the screen at all").toContain(CLAIM.claim);
  }

  it("warns when the server checked and could not fingerprint the paper", async () => {
    /* `sourceHash: undefined` is what the GET answers for a paper whose blocks
       it could not read (src/routes.ts § referee claims), and it is a real
       answer: unknown counts as stale from either side. It is also the one that
       vanishes on the wire, so a client reading the key rather than the value
       never sees it and quietly tells the referee nothing has moved. */
    await paint(undefined, "h");
    expect(
      JSON.parse(JSON.stringify({ run: null, sourceHash: undefined })),
      "the premise of this test is that JSON drops the key, and it no longer does",
    ).not.toHaveProperty("sourceHash");
    expect(host.textContent, "the referee was told nothing about a paper nobody could read").toContain(
      WARNING,
    );
  });

  it("says nothing when the paper is the one the run was answered about", async () => {
    await paint("h", "h");
    expect(host.textContent).not.toContain(WARNING);
  });

  it("warns when the paper has moved since the run was answered", async () => {
    await paint("moved", "h");
    expect(host.textContent).toContain(WARNING);
  });

  it("warns about a run saved before runs recorded what they answered", async () => {
    /* The other half of `isStale`'s rule: a run with no fingerprint of its own
       cannot be judged against a paper that has one either. */
    await paint("h", undefined);
    expect(host.textContent).toContain(WARNING);
  });
});
