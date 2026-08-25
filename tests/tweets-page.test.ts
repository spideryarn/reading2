/**
 * The thread page's one pure part: the text that lands on the clipboard.
 *
 * Everything else on `/read/<slug>/tweets` is rendering, and the rendering is
 * checked in a browser (docs/project/browser-testing.md). This is the piece
 * that has a right answer and can drift without looking wrong: the numbering,
 * and the source line.
 *
 * **The source line is the reason this file exists.** A thread copied out of
 * here can end up on the internet, and a generated summary with no path back to
 * what it summarises is one of vision.md's anti-goals by name — so the URL
 * being in the copy is a product decision (docs/plans/tweet-thread-page.md),
 * not a formatting detail, and it should break a test if it goes.
 *
 * The write half is tested in tweets.test.ts; the page is src/web/Tweets.tsx.
 */
import { describe, expect, it } from "vitest";
import { parseJobRequest } from "../src/routes.js";
import { threadMarkdown } from "../src/web/Tweets.js";
import type { Article, TweetThread } from "../src/types.js";

/** @param url omitted entirely when null — an article fetched from a file has no URL at all. */
function article(url: string | null = "https://paulgraham.com/writes.html"): Article {
  return {
    meta: {
      slug: "writes",
      title: "Writes and Write-Nots",
      ...(url === null ? {} : { url }),
    },
    blocks: [],
    tree: { rootId: "spya-root", nodes: {} } as unknown as Article["tree"],
  };
}

function thread(texts: string[]): TweetThread {
  return {
    version: "tweets/1",
    generator: "claude-opus-5",
    slug: "writes",
    sourceHash: "1ee2ebde490b347e",
    limit: 280,
    tweets: texts.map((text) => ({ text, chars: [...text].length })),
    generatedAt: "2026-08-25T12:12:58.535Z",
    elapsedMs: 6136,
  };
}

describe("threadMarkdown", () => {
  it("puts the title and the article's own URL at the top", () => {
    const md = threadMarkdown(thread(["one", "two"]), article());
    expect(md.startsWith("Writes and Write-Nots\nhttps://paulgraham.com/writes.html\n\n")).toBe(
      true,
    );
  });

  it("numbers the posts from one, against the total", () => {
    const md = threadMarkdown(thread(["one", "two", "three"]), article());
    expect(md).toContain("1/3 one");
    expect(md).toContain("2/3 two");
    expect(md).toContain("3/3 three");
    // No zero-indexed post, which is the mistake `index + 1` exists to avoid.
    expect(md).not.toContain("0/3");
  });

  it("leaves no empty line where a missing URL would have been", () => {
    const md = threadMarkdown(thread(["one"]), article(null));
    expect(md).toBe("Writes and Write-Nots\n\n1/1 one");
  });

  it("keeps a line break inside a post", () => {
    // The prompt allows one, and a copy that flattens it changes what the post
    // says — same reason the page renders with `whitespace-pre-line`.
    const md = threadMarkdown(thread(["first line\nsecond line"]), article());
    expect(md).toContain("1/1 first line\nsecond line");
  });
});

/**
 * The body the "Write the thread" button posts, checked against the parser that
 * has to accept it.
 *
 * Two files have to agree about this shape and neither imports the other: the
 * button builds it in `useJobs.run`, the server pulls it apart in
 * `parseJobRequest`. Nothing else in the repo sends `{ slug, steps }` — every
 * other caller sends `{ url }` — so this pairing was checked by nothing, and it
 * fails as a 400 the reader sees as "the button doesn't work".
 */
describe("the request the button sends", () => {
  it("is accepted, and keeps the steps it asked for", () => {
    expect(parseJobRequest({ slug: "writes", steps: ["tweets"] })).toEqual({
      slug: "writes",
      steps: ["tweets"],
    });
  });

  it("carries no url, which is the half that would be dangerous", () => {
    // Sending both is refused outright (routes.ts), so a page that helpfully
    // added `article.meta.url` here would break its own button.
    expect(() => parseJobRequest({ slug: "writes", url: "https://a.example/x" })).toThrow();
  });
});
