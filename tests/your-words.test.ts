/**
 * your-words.md (src/store/your-words.ts): the reader's own words on one
 * article, from the rows the export walk reads. Built from hand-made rows: the
 * route and the zip are tested end to end in tests/export-route.test.ts.
 * Plan docs/plans/261020w-export-your-own-words-and-a-chat-as-markdown.md § Stage 3.
 */
import { describe, expect, it } from "vitest";
import type { ArticleRows } from "../src/store/article-rows.js";
import { yourWordsMarkdown } from "../src/store/your-words.js";

const T = (s: string) => new Date(`2026-10-19T${s}:00.000Z`);
const EXPORTED = new Date("2026-10-20T09:00:00.000Z");

type Rows = {
  -readonly [K in keyof ArticleRows]?: unknown;
};

function comment(over: Record<string, unknown>) {
  return {
    id: "c",
    blockId: "spya-bbbbbb",
    quote: null,
    start: null,
    body: null,
    status: "none",
    answer: null,
    colour: null,
    severity: null,
    criterionId: null,
    valence: null,
    createdAt: T("10:00"),
    ...over,
  };
}

function rows(over: Rows = {}): ArticleRows {
  return {
    article: {
      slug: "tinbergen-spya-ks84se",
      titleOverride: null,
      purpose: null,
      shareToken: "SECRET-SHARE-TOKEN",
      ownerId: "0e5c0001-0000-4000-8000-0000000000aa",
    },
    revision: { title: "On aims and methods", finalUrl: "https://example.test/t", requestedUrl: null },
    blocks: [
      { blockId: "spya-aaaaaa", ordinal: 0, text: "First paragraph." },
      { blockId: "spya-bbbbbb", ordinal: 1, text: "Second paragraph, about survival value." },
    ],
    comments: [],
    chatThreads: [],
    chatMessages: [],
    chatMentions: [],
    quizAttempts: [],
    articleTags: [],
    refereeCriteria: [],
    ...over,
  } as unknown as ArticleRows;
}

describe("yourWordsMarkdown", () => {
  it("says so when there is nothing yet, under a header naming the article", () => {
    const md = yourWordsMarkdown(rows(), EXPORTED);
    expect(md).toMatch(/^---\nspideryarn: "your-words"\narticle: "On aims and methods"\n/);
    expect(md).toContain('article_url: "https://www.spideryarn.com/read/tinbergen-spya-ks84se"');
    expect(md).toContain('exported: "2026-10-20T09:00:00.000Z"');
    expect(md).toContain("You have not written anything about this article yet.");
  });

  it("never carries the private-link key or the owner's id", () => {
    const md = yourWordsMarkdown(rows({ comments: [comment({ body: "x" })] }), EXPORTED);
    expect(md).not.toContain("SECRET-SHARE-TOKEN");
    expect(md).not.toContain("0e5c0001");
  });

  it("puts the shelf first: your title, your purpose, your tags", () => {
    const md = yourWordsMarkdown(
      rows({
        article: { slug: "s", titleOverride: "My title", purpose: "For the seminar", shareToken: null },
        articleTags: [{ tag: "ethology" }, { tag: "to-read" }],
      }),
      EXPORTED,
    );
    expect(md).toContain('# Your words on "My title"');
    expect(md).toContain("- **Your title:** My title\n- **Why you are reading it:** For the seminar\n- **Your tags:** ethology, to-read");
  });

  it("lists comments in article order, by where the words start, with a lost paragraph's last", () => {
    const md = yourWordsMarkdown(
      rows({
        comments: [
          comment({ id: "gone", blockId: "spya-zzzzzz", body: "on a lost paragraph", createdAt: T("09:00") }),
          comment({ id: "late", blockId: "spya-bbbbbb", quote: "survival", start: 30, body: "later words" }),
          comment({ id: "early", blockId: "spya-bbbbbb", quote: "Second", start: 0, body: "earlier words" }),
          comment({ id: "first", blockId: "spya-aaaaaa", body: "on the first" }),
        ],
      }),
      EXPORTED,
    );
    const order = ["on the first", "earlier words", "later words", "on a lost paragraph"].map((s) => md.indexOf(s));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(md).toContain("_That paragraph is no longer in the article._");
  });

  it("names each mark for what it is, and preserves the answer the reader saw", () => {
    const md = yourWordsMarkdown(
      rows({
        comments: [
          comment({ id: "1", quote: "Second", start: 0, body: "my note", status: "done", answer: "The AI's answer." }),
          comment({ id: "2", quote: "paragraph", start: 7, status: "done", answer: "An old explanation." }),
          comment({ id: "3", quote: "about", start: 18, colour: "yellow" }),
          comment({ id: "4" }),
          comment({ id: "5", quote: "value", start: 33, body: "asked", status: "error", answer: "half an ans" }),
        ],
      }),
      EXPORTED,
    );
    expect(md).toContain("### Note · spya-bbbbbb");
    expect(md).toContain("**You wrote:**\n\nmy note\n\n**Spideryarn answered:**\n\nThe AI's answer.");
    expect(md).toContain("### Asked the AI about this passage · spya-bbbbbb");
    expect(md).toContain("An old explanation.");
    expect(md).toContain("### Highlight (yellow) · spya-bbbbbb");
    expect(md).toContain("### Bookmark · spya-bbbbbb");
    // A whole-paragraph bookmark quotes the paragraph.
    expect(md).toContain("The paragraph:\n\n> Second paragraph, about survival value.");
    expect(md).toContain("half an ans");
    expect(md).toContain("_This answer failed part-way; the above is what arrived._");
  });

  it("keeps a partial failed explanation and says that it failed part-way", () => {
    const md = yourWordsMarkdown(
      rows({
        comments: [
          comment({
            id: "failed",
            quote: "survival",
            start: 30,
            status: "error",
            answer: "The half that the reader already saw.",
          }),
        ],
      }),
      EXPORTED,
    );
    expect(md).toContain("### Asked the AI about this passage · spya-bbbbbb");
    expect(md).toContain("**Spideryarn answered:**\n\nThe half that the reader already saw.");
    expect(md).toContain("_This answer failed part-way; the above is what arrived._");
  });

  it("does not relabel failed or chat-linked questions as ordinary bookmarks", () => {
    const md = yourWordsMarkdown(
      rows({
        comments: [
          comment({ id: "failed", quote: "survival", start: 30, status: "error" }),
          comment({ id: "chat", quote: "value", start: 39, threadId: "t-linked" }),
        ],
      }),
      EXPORTED,
    );
    expect(md.match(/### Asked the AI about this passage/g)).toHaveLength(2);
    expect(md).toContain("_No answer: it failed._");
    expect(md).not.toContain("### Bookmark");
  });

  it("keeps the web sources shown under a comment answer", () => {
    const md = yourWordsMarkdown(
      rows({
        comments: [
          comment({
            body: "my question",
            status: "done",
            answer: "The answer.",
            citations: [
              { url: "https://example.test/a", title: "A source" },
              { url: "https://example.test/b" },
            ],
          }),
        ],
      }),
      EXPORTED,
    );
    expect(md).toContain("Web sources it found:\n\n- A source: https://example.test/a\n- https://example.test/b");
  });

  it("says which referee criterion a note answers, and where the reader placed it", () => {
    const md = yourWordsMarkdown(
      rows({
        refereeCriteria: [{ id: "k1", criterion: "Novelty" }],
        comments: [comment({ body: "derivative", criterionId: "k1", valence: -40, severity: "major" })],
      }),
      EXPORTED,
    );
    expect(md).toContain("### Note, major · ");
    expect(md).toContain('_Referee: on the criterion "Novelty"; you placed it at -40 on its scale._');
  });

  it("writes every quiz answer with the mark it got, marked as the AI's", () => {
    const md = yourWordsMarkdown(
      rows({
        quizAttempts: [
          { question: "What is survival value?", answer: "Fitness.", reply: "Close.", createdAt: T("11:00") },
        ],
      }),
      EXPORTED,
    );
    expect(md).toContain("## Your quiz answers\n\n### What is survival value?");
    expect(md).toContain("**Your answer:**\n\nFitness.\n\n**Spideryarn's mark:**\n\nClose.");
  });

  it("writes every conversation but Referee's candidate threads, its turns in ordinal order", () => {
    const thread = (id: string, kind: string, title: string) => ({
      id,
      kind,
      title,
      createdAt: T("12:00"),
      anchorBlockId: "spya-aaaaaa",
      anchorQuote: "First",
      anchorStart: 0,
    });
    const message = (threadId: string, ordinal: number, role: string, text: string) => ({
      threadId,
      id: `${threadId}-${ordinal}`,
      ordinal,
      role,
      text,
      status: "done",
      createdAt: T("12:00"),
      citations: null,
      searches: null,
      tools: null,
      model: null,
      effort: null,
      error: null,
      stopped: false,
      truncated: false,
      passages: null,
      interrupted: false,
      editedAt: null,
      stance: null,
      help: false,
      modality: null,
      hintOpenedAt: null,
    });
    const md = yourWordsMarkdown(
      rows({
        chatThreads: [thread("t1", "chat", "Survival value"), thread("t2", "candidates", "Machinery")],
        chatMessages: [
          { ...message("t1", 3, "assistant", "The later answer."), id: "t1-3" },
          { ...message("t1", 2, "user", "And later?"), id: "t1-a" },
          { ...message("t1", 1, "assistant", "It means fitness."), id: "t1-1" },
          { ...message("t1", 0, "user", "What is it?"), id: "t1-z" },
          message("t2", 0, "user", "candidate stuff"),
        ],
        chatMentions: [
          {
            threadId: "t1",
            /* The snapshot orders mention rows by message id, not message
               ordinal. These ids deliberately sort backwards so the export
               has to recover the conversation order rather than inherit the
               database's incidental order. */
            messageId: "t1-a",
            mentionedArticleId: "00000000-0000-4000-8000-0000000000cc",
            title: "A later article",
            position: 0,
            createdAt: T("12:01"),
          },
          {
            threadId: "t1",
            messageId: "t1-z",
            mentionedArticleId: "00000000-0000-4000-8000-0000000000bb",
            title: "A related article",
            position: 0,
            createdAt: T("12:00"),
          },
        ],
      }),
      EXPORTED,
    );
    expect(md).toContain("## Your conversations\n\n### Survival value");
    expect(md).toContain("Started from this passage (spya-aaaaaa):\n\n> First");
    expect(md.indexOf("#### You")).toBeLessThan(md.indexOf("#### Spideryarn"));
    expect(md.indexOf("What is it?")).toBeLessThan(md.indexOf("It means fitness."));
    expect(md).toContain("Also reading:\n\n- A related article\n- A later article");
    expect(md).not.toContain("00000000-0000-4000-8000-0000000000bb");
    expect(md).not.toContain("Machinery");
    expect(md).not.toContain("candidate stuff");
  });

  it("does not export a Recall hint until the reader opened it", () => {
    const recall = {
      id: "recall",
      kind: "learn",
      title: "Recall",
      createdAt: T("12:00"),
      anchorBlockId: null,
      anchorQuote: null,
      anchorStart: null,
    };
    const answer = {
      threadId: "recall",
      id: "recall-0",
      ordinal: 0,
      role: "assistant",
      text: "What would change if Y?\n\nHint: the unopened secret.",
      status: "done",
      createdAt: T("12:01"),
      citations: null,
      searches: null,
      tools: null,
      model: null,
      effort: null,
      error: null,
      stopped: false,
      truncated: false,
      passages: null,
      interrupted: false,
      editedAt: null,
      stance: null,
      help: false,
      modality: null,
      hintOpenedAt: null,
    };
    const hidden = yourWordsMarkdown(rows({ chatThreads: [recall], chatMessages: [answer] }), EXPORTED);
    expect(hidden).toContain("What would change if Y?");
    expect(hidden).not.toContain("the unopened secret");

    const shown = yourWordsMarkdown(
      rows({ chatThreads: [recall], chatMessages: [{ ...answer, hintOpenedAt: T("12:02") }] }),
      EXPORTED,
    );
    expect(shown).toContain("the unopened secret");
  });
});
