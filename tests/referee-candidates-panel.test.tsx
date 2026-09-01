// @vitest-environment jsdom
/**
 * **What an editor is shown, and what they are told was not checked.**
 *
 * `tests/referee-candidates.test.ts` holds the four rules as pure functions.
 * This file is about the half of Candidates that is a claim made on a screen:
 *
 *  - **A name only ever appears with a source link the search returned**, and
 *    the one that did not appear is *counted out loud*. A shortlist that
 *    silently shrank is the failure this whole sub-mode is built against.
 *  - **Three sentences are printed whatever the model said** — what conflict of
 *    interest was not checked, what the list is skewed towards, and which byline
 *    the author exclusion actually ran against. None of them is the model's, so
 *    none of them can be talked out of appearing.
 *  - **No number beside a person.** Referee mode's first rule is *no verdict,
 *    ever*, and an ordinal on a candidate row is one glance from a ranking of
 *    people — which is also the thing the matching research says a tool must not
 *    do, since ordering by anything prominence-shaped reproduces a measured bias
 *    mechanically.
 *  - **The fenced JSON never reaches the screen**, closed or half-arrived.
 *
 * No router and no hook: `CandidatesPanel` is a pure function of its props,
 * which is the band-owns-the-fetch, panel-is-pure split every referee panel
 * makes. Harness copied from tests/referee-mirror-panel.test.tsx.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { Block, BlockId, ChatMessage, ChatThread } from "../src/types.js";
import {
  COI_NOT_CHECKED,
  INDEXING_SKEW,
  NO_BYLINE_TO_EXCLUDE,
  NO_NAMES_YET,
  SHORTLIST_FENCE,
} from "../src/referee-candidates.js";
import { CandidatesPanel } from "../src/web/CandidatesPanel.js";

/* Real ids: `ID_PATTERN` rejects `1`, `i`, `l` and `o`, so a plausible-looking
   `spya-aaa111` is not one of ours. docs/project/block-ids.md § the alphabet. */
const BLOCK = "spya-k3m9qt" as BlockId;
const FOUND = "https://example.org/lab/kessler";

const BLOCKS: Block[] = [
  {
    id: BLOCK,
    tag: "p",
    kind: "text",
    text: "We fitted a hierarchical Bayesian model to forty subjects.",
    words: 9,
    html: "<p>We fitted a hierarchical Bayesian model to forty subjects.</p>",
    gistable: true,
  },
];

function fence(rows: unknown[]): string {
  return `\`\`\`${SHORTLIST_FENCE}\n${JSON.stringify(rows)}\n\`\`\``;
}

function candidate(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    name: "Ada Kessler",
    affiliation: "University of Nowhere",
    requirement: "Someone who can judge a hierarchical Bayesian fit",
    blockId: BLOCK,
    why: "Has published the method on comparable data",
    sources: [FOUND],
    ...over,
  };
}

function answer(text: string, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "spya-msg2aa",
    role: "assistant",
    text,
    createdAt: "2026-09-01T00:00:00.000Z",
    status: "done",
    /* What OpenRouter's annotations reported — the allowed set rule 1 checks
       against. Without this, no candidate in these fixtures could be shown, and
       every assertion below would pass for the wrong reason. */
    citations: [{ url: FOUND, title: "Kessler Lab — people" }],
    searches: 2,
    ...over,
  };
}

function thread(messages: ChatMessage[]): ChatThread {
  return {
    id: "spya-thr2aa",
    title: "Candidates",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    kind: "candidates",
    messages,
  };
}

let host: HTMLDivElement;
let root: Root;
const jumped: string[] = [];
const asked: string[] = [];

function paint(t: ChatThread | null, byline?: string) {
  act(() => {
    root.render(
      createElement(CandidatesPanel, {
        thread: t,
        loaded: true,
        loadFailed: false,
        blocks: BLOCKS,
        ...(byline === undefined ? {} : { byline }),
        error: null,
        onAsk: (q: string) => asked.push(q),
        onStop: () => {},
        onJump: (id: string) => jumped.push(id),
      }),
    );
  });
}

/** The panel's text, with whitespace flattened so wrapping cannot matter. */
function text(): string {
  return (host.textContent ?? "").replace(/\s+/g, " ");
}

beforeEach(() => {
  (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
    true;
  jumped.length = 0;
  asked.length = 0;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a name reaches the screen only with a source the search returned", () => {
  it("shows a cited candidate, with the search result's own title and the real host", () => {
    paint(thread([answer(`Some people worth asking.\n\n${fence([candidate()])}`)]));
    expect(text()).toContain("Ada Kessler");
    const link = host.querySelector("a[href^='https://example.org']") as HTMLAnchorElement | null;
    expect(link?.textContent).toBe("Kessler Lab — people");
    expect(link?.rel).toBe("noreferrer noopener");
    expect(text()).toContain("example.org");
  });

  it("shows nobody when the URL was never returned, and says so rather than saying nothing", () => {
    paint(
      thread([
        answer(
          `Some people worth asking.\n\n${fence([candidate({ sources: ["https://mit.edu/~kessler"] })])}`,
        ),
      ]),
    );
    expect(text()).not.toContain("Ada Kessler");
    /* The distinction that matters: *named nobody* and *named somebody who could
       not be shown* are different sentences, and a panel that printed the first
       for the second would be hiding the model's failure behind its own. */
    expect(text()).toContain("named people and none of them could be shown");
    expect(text()).toContain("no source link the web search returned");
    expect(text()).not.toContain(NO_NAMES_YET);
  });

  it("says the model has not named anybody when it has not", () => {
    paint(thread([answer("Here is the fit brief. Someone who can judge a Bayesian fit.")]));
    expect(text()).toContain(NO_NAMES_YET);
    expect(text()).not.toContain("named people and none of them could be shown");
  });
});

describe("the three sentences the model cannot talk the panel out of", () => {
  it("prints them with a shortlist", () => {
    paint(thread([answer(fence([candidate()]))]), "Bo Nakamura");
    expect(text()).toContain(COI_NOT_CHECKED);
    expect(text()).toContain(INDEXING_SKEW);
    expect(text()).toContain("Bo Nakamura");
  });

  it("prints them when everything was dropped", () => {
    paint(thread([answer(fence([candidate({ blockId: "spya-zzzzzz" })]))]), "Bo Nakamura");
    expect(text()).toContain(COI_NOT_CHECKED);
    expect(text()).toContain(INDEXING_SKEW);
  });

  it("says no author exclusion ran when the paper has no byline", () => {
    /* Rule 2 has a code half and a prompt half and they are not the same
       strength. With no byline there is nothing to run the code half against,
       and implying a filter ran is the move the research says editors distrust. */
    paint(thread([answer(fence([candidate()]))]));
    expect(text()).toContain(NO_BYLINE_TO_EXCLUDE);
  });

  it("never claims a conflict check found nothing", () => {
    paint(thread([answer(fence([candidate()]))]));
    expect(text()).not.toMatch(/no conflicts? (were )?found/i);
    expect(text()).toMatch(/no conflict-of-interest check has run/i);
  });
});

describe("no verdict, and nothing that reads as one", () => {
  it("puts no ordinal, score or sort control on a candidate row", () => {
    paint(
      thread([
        answer(
          fence([
            candidate(),
            candidate({ name: "Bo Nakamura", sources: [FOUND], affiliation: "Elsewhere" }),
          ]),
        ),
      ]),
    );
    const rows = [...host.querySelectorAll(".cnd-row")];
    expect(rows.length).toBe(2);
    for (const row of rows) {
      /* **The panel adds no number of its own to a person's row.** The fixtures
         above carry no digits, so the only one that may legitimately appear is
         inside the block-ref chip — which is a block id, not a score. Take that
         out and nothing numeric may be left: no ordinal, no confidence, no
         match percentage. A number beside a name is one glance from a ranking of
         people, which is Referee mode's rule 1 and the matching research's
         warning at the same time. */
      const chip = row.querySelector(".block-ref")?.textContent ?? "";
      const rest = (row.textContent ?? "").replace(chip, "").replace(/\s+/g, " ");
      expect(rest).not.toMatch(/\d/);
    }
    /* And no way to re-sort them, because every sort key an editor would reach
       for — citations, seniority — is the one the research says reproduces the
       bias mechanically. */
    expect(host.querySelectorAll("select").length).toBe(0);
    /* The count of the *list* is allowed and lives in the heading: how deep a
       shortlist is is exactly what an editor needs to know, and it is not a
       judgement of anybody. */
    expect(host.querySelector(".cnd-count")?.textContent).toBe("2 names");
  });
});

describe("the fenced block is never on screen", () => {
  it("hides a closed fence", () => {
    paint(thread([answer(`Some people worth asking.\n\n${fence([candidate()])}`)]));
    expect(text()).toContain("Some people worth asking.");
    expect(text()).not.toContain(SHORTLIST_FENCE);
    expect(text()).not.toContain('"sources"');
  });

  it("hides one that has not closed yet, which is what streaming looks like", () => {
    /* The second or two it takes the JSON to arrive. Rendering it and hiding it
       on close would put an unvalidated claim about a named person on screen —
       the one thing the four rules exist to stop. */
    const partial = `Some people worth asking.\n\n\`\`\`${SHORTLIST_FENCE}\n[{"name": "Ada Kess`;
    paint(thread([answer(partial, { status: "pending" })]));
    expect(text()).toContain("Some people worth asking.");
    expect(text()).not.toContain("Ada Kess");
  });
});

describe("the shortlist survives a turn that has no names in it", () => {
  it("keeps the last list while the editor asks a follow-up question", () => {
    /* The editor asks "what would it take to judge the statistics?" and the
       model answers in prose. Reading only the newest answer would blank the
       shortlist, which reads as the app losing the work. */
    paint(
      thread([
        answer(fence([candidate()]), { id: "spya-msg2aa" }),
        {
          id: "spya-msg2bb",
          role: "user",
          text: "What would it take to judge the statistics?",
          createdAt: "2026-09-01T00:00:00.000Z",
          status: "done",
        },
        answer("Someone comfortable with partial pooling.", {
          id: "spya-msg2cc",
          citations: [],
          searches: 0,
        }),
      ]),
    );
    expect(text()).toContain("Ada Kessler");
  });
});
