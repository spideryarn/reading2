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
import { cascadeForce } from "../src/jobs.js";
import { parseJobRequest } from "../src/routes.js";
import { howLong, threadMarkdown } from "../src/web/Tweets.js";
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

/**
 * The footer's "Write it again", which is a different request from the one
 * above and fails in a way that looks like success.
 *
 * A rewrite asked for without `force` is accepted, queued, and skipped — the
 * step's own freshness check says the thread on disk is current, because it is.
 * The job goes green, the page refetches, and the reader gets back the same
 * thread they just asked to replace, with nothing anywhere saying why. That is
 * docs/reusable/silent-success.md exactly, and it is why the flag is pinned
 * here rather than left to the page.
 */
describe("the request the rewrite sends", () => {
  it("keeps the force alongside the steps", () => {
    expect(parseJobRequest({ slug: "writes", steps: ["tweets"], force: ["tweets"] })).toEqual({
      slug: "writes",
      steps: ["tweets"],
      force: ["tweets"],
    });
  });

  it("really does force the step once the queue has cascaded it", () => {
    // `tweets` is in FORCE_ONLY_WHEN_NAMED, so it is forced only when named —
    // which is what makes naming it the whole difference between this request
    // and the one the empty state sends.
    expect([...cascadeForce(["tweets"], new Set(["tweets"]))]).toEqual(["tweets"]);
    expect([...cascadeForce(["tweets"], new Set())]).toEqual([]);
  });
});

/**
 * How long the model took, which the artefact has recorded from the first run
 * and nothing showed until the page grew a footer.
 */
describe("howLong", () => {
  it("reads in seconds while it is short", () => {
    expect(howLong(6136)).toBe("6.1s");
    expect(howLong(59_900)).toBe("59.9s");
  });

  it("switches to minutes once seconds stop being readable", () => {
    expect(howLong(72_000)).toBe("1m 12s");
    expect(howLong(600_000)).toBe("10m 0s");
  });

  it("says it does not know rather than saying zero", () => {
    // The failure the borrow list warns about: an empty timing rendered as
    // `0ms` reads as "instant" rather than as "we never measured it".
    expect(howLong(Number.NaN)).toBe("an unknown time");
    expect(howLong(-1)).toBe("an unknown time");
  });
});
