/**
 * The reader profile, where it lands in the batch prompts.
 *
 * `tests/article-prompt.test.ts` covers the request path — search, explain and
 * chat — because that is where the caching argument lives. It has never covered
 * glossary or tweets at all, and that gap is not academic: the
 * chat-cache bug of 2026-08-26 survived precisely because the one test file
 * that looked at prompts looked at three of the eight
 * (docs/postmortems/260826h-chat-cache-automatic-breakpoint.md).
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
import type { Meta, Tree, TreeNode } from "../src/types.js";
import { renderProfile } from "../src/profile.js";
import { renderPrompt as glossaryPrompt } from "../src/glossary.js";
import { renderPrompt as tweetsPrompt } from "../src/tweets.js";
import { renderPrompt as quotesPrompt } from "../src/quotes.js";
import { renderPrompt as quizPrompt } from "../src/quiz.js";

const id = (i: number) => `spya-aaaaa${i}`;

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

/**
 * **Quotes, which took summaries' place here on 2026-08-31.**
 *
 * This file used to cover glossary, tweets and summaries. Stage 5e is gone
 * (docs/plans/260831s-gist-only-summaries.md), and leaving two stages behind would have
 * made the header's own point — *"the one test file that looked at prompts
 * looked at three of the eight"* — truer than it was before. `quotes` is the
 * batch prompt with the same two properties to check and no coverage of them.
 */
describe("quotes' prompt", () => {
  const render = (profile: string | null) => quotesPrompt({ tree: TREE, count: 6, profile, existing: [] });

  it("carries the profile when there is one", () => {
    const out = render(PROFILE);
    for (const marker of MARKERS) expect(out).toContain(marker);
  });

  it("says nothing about a reader when there is none", () => {
    const out = render(null);
    for (const marker of MARKERS) expect(out).not.toContain(marker);
  });

  it("does not gain so much as a blank line when there is none", () => {
    expect(render(null)).not.toMatch(/\n{3,}/);
  });
});

/**
 * The quiz joined on 2026-09-30 (SPIDERYARN-READING2-6Q): a reader who has said
 * why they are reading gets a path that heads for that. It has **its own
 * section** rather than `profileSection`, because the shared reminder says the
 * profile changes nothing about the article's proportions and here the
 * proportions are the point — so the first marker is the quiz's own heading.
 * docs/plans/260930j-quiz-questions-shaped-by-the-readers-reading-goal.md.
 */
describe("quiz's prompt", () => {
  const QUIZ_MARKERS = ["WHY THIS READER IS HERE", "neuroethologist", "I want the evidence"];
  const render = (profile: string | null) => quizPrompt({ tree: TREE, profile });

  it("carries the profile when there is one", () => {
    const out = render(PROFILE);
    for (const marker of QUIZ_MARKERS) expect(out).toContain(marker);
  });

  it("says nothing about a reader when there is none", () => {
    const out = render(null);
    for (const marker of [...QUIZ_MARKERS, "WHO IS READING"]) expect(out).not.toContain(marker);
  });

  it("is byte-for-byte today's prompt when there is none", () => {
    /* "The same as today when there isn't" — Greg's words, asked of the bytes.
       The literal is the prompt as it stood before the profile arrived. */
    expect(render(null)).toBe(`Set the quiz for this article — up to 20 questions.

=== ITS SHAPE ===

PART 1: part-a
  the gist of part-a

PART 2: part-b
  the gist of part-b`);
  });
});
