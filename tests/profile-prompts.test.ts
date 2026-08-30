/**
 * The reader profile, where it lands in the three batch prompts.
 *
 * `tests/article-prompt.test.ts` covers the request path — search, explain and
 * chat — because that is where the caching argument lives. It has never covered
 * glossary, tweets or summaries at all, and that gap is not academic: the
 * chat-cache bug of 2026-08-26 survived precisely because the one test file
 * that looked at prompts looked at three of the eight
 * (docs/postmortems/chat-cache-automatic-breakpoint.md).
 *
 * Two properties per stage, and the second is the one that will break quietly:
 *
 *  - the profile **arrives** when there is one;
 *  - and it **leaves no trace at all** when there is not. A prompt that always
 *    carries the header with nothing under it has taught the model to expect
 *    one, and an empty one then reads as "this reader is nobody in particular"
 *    rather than as "we did not ask". Nothing about the output would look
 *    wrong; the entries would just be blander.
 */
import { describe, expect, it } from "vitest";
import type { Block, Meta, Tree, TreeNode } from "../src/types.js";
import { renderProfile } from "../src/profile.js";
import { renderPrompt as glossaryPrompt } from "../src/glossary.js";
import { renderPrompt as tweetsPrompt } from "../src/tweets.js";
import { renderPrompt as summaryPrompt } from "../src/summarise.js";

const id = (i: number) => `spya-aaaaa${i}`;

const block = (i: number): Block => ({
  id: id(i),
  tag: "p",
  kind: "text",
  text: `Paragraph ${i} says something worth summarising at some length.`,
  words: 9,
  html: `<p>Paragraph ${i}</p>`,
  gistable: true,
});

const BLOCKS: Block[] = Array.from({ length: 10 }, (_, i) => block(i));

function node(over: Partial<TreeNode> & Pick<TreeNode, "id" | "depth" | "range">): TreeNode {
  return { parent: null, children: [], title: over.id, gist: `the gist of ${over.id}`, ...over } as TreeNode;
}

const TREE: Tree = {
  version: "toc/test",
  generator: "test",
  slug: "fixture",
  rootId: "root",
  nodes: {
    root: node({ id: "root", depth: 0, range: [id(0), id(9)], children: ["part-a", "part-b"] }),
    "part-a": node({ id: "part-a", depth: 1, parent: "root", range: [id(0), id(5)] }),
    "part-b": node({ id: "part-b", depth: 1, parent: "root", range: [id(6), id(9)] }),
  },
};

const META: Meta = { slug: "fixture", title: "A Fixture", byline: "A. Writer" };

/** A profile with a word in it that could not plausibly come from anywhere else. */
const PROFILE = renderProfile({
  profile: "A neuroethologist, rusty on thermodynamics.",
  purpose: "I want the evidence.",
})!;

/** Everything `profileSection` writes around the profile, so absence can be tested for. */
const MARKERS = ["WHO IS READING", "neuroethologist", "I want the evidence"];

describe("glossary's prompt", () => {
  const render = (profile: string | null) =>
    glossaryPrompt({ tree: TREE, count: 8, existing: [], profile });

  it("carries the profile when there is one", () => {
    const out = render(PROFILE);
    for (const marker of MARKERS) expect(out).toContain(marker);
  });

  it("says nothing about a reader when there is none", () => {
    const out = render(null);
    for (const marker of MARKERS) expect(out).not.toContain(marker);
  });

  it("does not gain so much as a blank line when there is none", () => {
    /* Stricter than the test above, and it is the one that catches the usual
       mistake: a `${profile ?? ""}` left in place emits nothing visible and two
       newlines, and nobody notices until a diff of two prompts is the only way
       to explain a cache miss. */
    expect(render(null)).toBe(glossaryPrompt({ tree: TREE, count: 8, existing: [] , profile: null }));
    expect(render(null)).not.toMatch(/\n{3,}/);
  });
});

describe("tweets' prompt", () => {
  const render = (profile: string | null) =>
    tweetsPrompt({ meta: META, tree: TREE, posts: 6, profile });

  it("carries the profile when there is one", () => {
    const out = render(PROFILE);
    for (const marker of MARKERS) expect(out).toContain(marker);
  });

  it("says nothing about a reader when there is none", () => {
    const out = render(null);
    for (const marker of MARKERS) expect(out).not.toContain(marker);
    expect(out).not.toMatch(/\n{3,}/);
  });
});

describe("summaries' prompt", () => {
  const batch = {
    scope: TREE.nodes.root!,
    targets: [TREE.nodes["part-a"]!, TREE.nodes["part-b"]!],
  };
  const render = (profile: string | null) =>
    summaryPrompt({ meta: META, tree: TREE, blocks: BLOCKS, batch, profile });

  it("carries the profile when there is one", () => {
    const out = render(PROFILE);
    for (const marker of MARKERS) expect(out).toContain(marker);
  });

  it("says nothing about a reader when there is none", () => {
    const out = render(null);
    for (const marker of MARKERS) expect(out).not.toContain(marker);
  });

  /**
   * **There used to be a second box about intent in this prompt**, and two
   * tests here about how the pair sat together: the profile had to come first,
   * because who they are frames what "lead with this" even means, and the steer
   * had to work on its own so it did not become conditional on the profile.
   *
   * The steer is gone (docs/plans/steer-becomes-the-profile.md) — it asked the
   * same question the profile's per-article half already asks. What replaces
   * those two tests is one about the deletion having actually reached the
   * renderer: a header left behind teaches the model to expect an instruction
   * that nothing can now supply, and it would look like nothing at all.
   */
  it("has no steer left in it, with a profile or without", () => {
    expect(render(PROFILE)).not.toContain("WHAT THIS READER IS AFTER");
    expect(render(null)).not.toContain("WHAT THIS READER IS AFTER");
  });
});
