/**
 * A conversation as Markdown (src/chat-markdown.ts): what *Copy this
 * conversation* copies and what your-words.md carries per conversation.
 * Plan docs/plans/261020w-export-your-own-words-and-a-chat-as-markdown.md.
 */
import { describe, expect, it } from "vitest";
import {
  conversationDocument,
  conversationMarkdown,
  frontMatter,
  markdownTime,
  type MarkdownThread,
} from "../src/chat-markdown.js";

const at = "2026-10-19T20:41:07.000Z";

function thread(over: Partial<MarkdownThread> = {}): MarkdownThread {
  return {
    title: "What is survival value?",
    kind: "chat",
    createdAt: at,
    messages: [
      { role: "user", text: "What does he mean by survival value?", createdAt: at, status: "done" },
      { role: "assistant", text: "He means the effect on fitness [spya-k3m9qt].", createdAt: at, status: "done" },
    ],
    ...over,
  };
}

/** The front matter's values back, read the way YAML reads a double-quoted scalar. */
function readFrontMatter(doc: string): Record<string, string> {
  const m = /^---\n([\s\S]*?)\n---\n/.exec(doc);
  if (!m?.[1]) throw new Error("no front matter");
  const out: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const i = line.indexOf(": ");
    out[line.slice(0, i)] = JSON.parse(line.slice(i + 2)) as string;
  }
  return out;
}

describe("conversationMarkdown", () => {
  it("writes each turn in order, under You and Spideryarn, block ids kept", () => {
    const md = conversationMarkdown(thread(), 1);
    expect(md).toBe(
      [
        "# What is survival value?",
        "Chat, started 2026-10-19 20:41 UTC.",
        "## You · 2026-10-19 20:41 UTC\n\nWhat does he mean by survival value?",
        "## Spideryarn · 2026-10-19 20:41 UTC\n\nHe means the effect on fitness [spya-k3m9qt].",
      ].join("\n\n"),
    );
  });

  it("nests one level down inside a larger file", () => {
    const md = conversationMarkdown(thread(), 2);
    expect(md.startsWith("## What is survival value?")).toBe(true);
    expect(md).toContain("### You ·");
    expect(md).not.toMatch(/^## You/m);
  });

  it("quotes the passage it started from", () => {
    const md = conversationMarkdown(
      thread({ anchor: { blockId: "spya-k3m9qt", quote: "the study of\nsurvival value", start: 4 } }),
      1,
    );
    expect(md).toContain("Started from this passage (spya-k3m9qt):\n\n> the study of\n> survival value");
  });

  it("says when an answer failed, was stopped, or is still being written", () => {
    const md = conversationMarkdown(
      thread({
        messages: [
          { role: "user", text: "One", createdAt: at, status: "done" },
          { role: "assistant", text: "", createdAt: at, status: "error" },
          { role: "user", text: "Two", createdAt: at, status: "done" },
          { role: "assistant", text: "Partly", createdAt: at, status: "done", stopped: true },
          { role: "user", text: "Three", createdAt: at, status: "done" },
          { role: "assistant", text: "", createdAt: at, status: "pending" },
        ],
      }),
      1,
    );
    expect(md).toContain("_No answer: it failed._");
    expect(md).toContain("Partly\n\n_You stopped this answer early._");
    expect(md).toContain("_This answer was still being written when this was exported._");
  });

  it("keeps what arrived of a failed or unfinished answer, and says every flag that applies", () => {
    const md = conversationMarkdown(
      thread({
        messages: [
          { role: "assistant", text: "Half an", createdAt: at, status: "error" },
          { role: "assistant", text: "So far", createdAt: at, status: "pending" },
          { role: "assistant", text: "Spoken", createdAt: at, status: "done", interrupted: true, truncated: true },
        ],
      }),
      1,
    );
    expect(md).toContain("Half an\n\n_This answer failed part-way; the above is what arrived._");
    expect(md).not.toContain("No answer");
    expect(md).toContain("So far\n\n_This answer was still being written when this was exported; the above");
    expect(md).toContain("may hold words that were never heard._\n\n_This answer may be incomplete");
  });

  it("lists the passages a spoken answer pointed to, and the web pages an answer cited", () => {
    const md = conversationMarkdown(
      thread({
        messages: [
          {
            role: "assistant",
            text: "He means fitness.",
            createdAt: at,
            status: "done",
            passages: [{ blockIds: ["spya-k3m9qt", "spya-a1b2c3"], why: "where he\ndefines it" }],
            citations: [{ url: "https://example.test/a", title: "A page" }, { url: "https://example.test/b" }],
          },
        ],
      }),
      1,
    );
    expect(md).toContain("Passages it pointed to:\n\n- spya-k3m9qt, spya-a1b2c3 — where he defines it");
    expect(md).toContain("Web pages it cited:\n\n- A page: https://example.test/a\n- https://example.test/b");
  });

  it("leaves out a Recall hint the reader never opened, and keeps one they did", () => {
    const text = "You said X. What would change if Y?\n\nHint: think about Z.";
    const unopened = conversationMarkdown(
      thread({ kind: "learn", messages: [{ role: "assistant", text, createdAt: at, status: "done" }] }),
      1,
    );
    expect(unopened).toContain("What would change if Y?");
    expect(unopened).not.toContain("think about Z");

    const opened = conversationMarkdown(
      thread({
        kind: "learn",
        messages: [{ role: "assistant", text, createdAt: at, status: "done", hintOpenedAt: at }],
      }),
      1,
    );
    expect(opened).toContain("think about Z");
  });

  it("drops a command-button line only when told it is a button", () => {
    const text = "This will bookmark it.\n\n[cmd:bookmark:spya-k3m9qt]\n\nAnything else?";
    const t = thread({ messages: [{ role: "assistant", text, createdAt: at, status: "done" }] });
    expect(conversationMarkdown(t, 1)).toContain("[cmd:bookmark:spya-k3m9qt]");
    expect(conversationMarkdown(t, 1, { isButton: () => true })).not.toContain("[cmd:");
  });

  it("keeps a title with a newline on its heading line", () => {
    expect(conversationMarkdown(thread({ title: "Line one\n# not a heading" }), 1)).toMatch(
      /^# Line one # not a heading\n/,
    );
  });
});

describe("conversationDocument", () => {
  it("opens with front matter any YAML reader can take, whatever the title holds", () => {
    const doc = conversationDocument(
      thread({ title: 'He said "no": then\n---\nwhat?' }),
      { slug: "tinbergen-spya-ks84se", title: "On aims: and methods" },
      new Date("2026-10-20T09:00:00.000Z"),
    );
    expect(readFrontMatter(doc)).toEqual({
      spideryarn: "conversation",
      title: 'He said "no": then --- what?',
      kind: "chat",
      article: "On aims: and methods",
      article_url: "https://www.spideryarn.com/read/tinbergen-spya-ks84se",
      started: at,
      exported: "2026-10-20T09:00:00.000Z",
    });
    expect(doc).toContain('A conversation in Spideryarn about "On aims: and methods".');
    expect(doc.endsWith("\n")).toBe(true);
  });
});

describe("frontMatter and markdownTime", () => {
  it("writes each value as a JSON string", () => {
    expect(frontMatter({ a: 'x"y' })).toBe('---\na: "x\\"y"\n---');
  });
  it("prints an unparseable stamp as it came", () => {
    expect(markdownTime("yesterday")).toBe("yesterday");
  });
});
