/**
 * **What a row in Chat's list of conversations says** — plan 261005h, report
 * `spya-svsbae`: on a phone the rows could not be told apart.
 *
 * Two halves. `rowTitle` is a function and is tested as one. How many lines a
 * row may take is the stylesheet's, and jsdom lays nothing out, so that half
 * pins the declarations.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { titleFrom } from "../src/chat.js";
import type { ChatMessage } from "../src/types.js";
import { ROW_TITLE_MAX, rowTitle } from "../src/web/chat-list-row.js";

const said = (role: ChatMessage["role"], text: string): ChatMessage => ({
  id: `spya-${role}`,
  role,
  text,
  createdAt: "2026-10-05T07:37:00.000Z",
  status: "done",
});

/** A conversation as the server makes one: its title is `titleFrom` of the first question. */
const asked = (question: string) => ({
  title: titleFrom(question),
  messages: [said("user", question), said("assistant", "An answer.")],
});

const LONG =
  "Explain the opening argument of this article in detail, in particular what the author means by entropy";

describe("rowTitle", () => {
  it("shows the whole first question when the title is only its cut-off start", () => {
    const thread = asked(LONG);
    // The premise: the server's cut is what made two rows read alike.
    expect(thread.title).toBe("Explain the opening argument of this article in detail, in…");
    expect(rowTitle(thread)).toBe(LONG);
  });

  it("tells two conversations apart that start with the same sixty characters", () => {
    const a = asked(LONG);
    const b = asked(LONG.replace("what the author means by entropy", "how the second section follows"));
    expect(a.title).toBe(b.title);
    expect(rowTitle(a)).not.toBe(rowTitle(b));
  });

  it("leaves a short question as its title", () => {
    const thread = asked("What is entropy?");
    expect(rowTitle(thread)).toBe("What is entropy?");
  });

  it("never touches a renamed conversation", () => {
    expect(rowTitle({ ...asked(LONG), title: "Entropy, opening" })).toBe("Entropy, opening");
    // Even a rename that happens to end in the same character.
    expect(rowTitle({ ...asked(LONG), title: "Entropy and so on…" })).toBe("Entropy and so on…");
    /* A rename that is a prefix of the question and ends in `…`, but is not
       the cut the server makes — GPT Sol, plan review. A looser prefix test
       put the question back over the reader's own name for it. */
    expect(rowTitle({ ...asked(LONG), title: "Explain…" })).toBe("Explain…");
    expect(rowTitle({ ...asked(LONG), title: "Explain the opening argument…" })).toBe(
      "Explain the opening argument…",
    );
  });

  it("collapses the question's whitespace the way the title did", () => {
    const question = `Explain the opening\n\nargument   of this article in detail, in particular the part about heat`;
    const thread = asked(question);
    expect(rowTitle(thread)).toBe(
      "Explain the opening argument of this article in detail, in particular the part about heat",
    );
  });

  it("holds for a question with no early space, where the title is cut mid-word", () => {
    const question = `${"x".repeat(70)} and then some words`;
    const thread = asked(question);
    expect(thread.title).toBe(`${"x".repeat(60)}…`);
    expect(rowTitle(thread)).toBe(question);
  });

  it("stops at a word, with an ellipsis, once the question is very long", () => {
    const question = Array.from({ length: 80 }, (_, i) => `word${i}`).join(" ");
    const shown = rowTitle(asked(question));
    expect(shown.length).toBeLessThanOrEqual(ROW_TITLE_MAX + 1);
    expect(shown.endsWith("…")).toBe(true);
    expect(question.startsWith(shown.slice(0, -1))).toBe(true);
    // Cut between words, not inside one.
    expect(question[shown.length - 1]).toBe(" ");
  });

  it("falls back to the title when there is nothing to read it from", () => {
    expect(rowTitle({ title: "Something cut…", messages: [] })).toBe("Something cut…");
    expect(rowTitle({ title: "Something cut…", messages: [said("assistant", "Something cut off")] })).toBe(
      "Something cut…",
    );
    expect(rowTitle({ title: "New chat", messages: [] })).toBe("New chat");
  });
});

describe("how many lines a row may take (styles/mode-band.css)", () => {
  const css = readFileSync("src/web/styles/mode-band.css", "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  /** The body of the `max-width: 731px` block that names the list's rows. */
  const narrow = (): string => {
    for (const m of css.matchAll(/@media \(max-width: 731px\)\s*\{((?:[^{}]*\{[^{}]*\})*)\s*\}/g)) {
      if ((m[1] ?? "").includes(".chat-thread-title")) return m[1] ?? "";
    }
    return "";
  };
  const wide = (): string => css.replace(/@media[^{]*\{(?:[^{}]*\{[^{}]*\})*\s*\}/g, "");
  const rule = (within: string, selector: string): string =>
    new RegExp(`${selector.replace(".", "\\.")}\\s*\\{([^}]*)\\}`).exec(within)?.[1] ?? "";

  it("gives the title three lines and the preview two under 732px", () => {
    expect(rule(narrow(), ".chat-thread-title")).toContain("-webkit-line-clamp: 3");
    expect(rule(narrow(), ".chat-thread-title")).toContain("line-clamp: 3");
    const last = rule(narrow(), ".chat-thread-last");
    expect(last).toContain("white-space: normal");
    expect(last).toContain("display: -webkit-box");
    expect(last).toContain("-webkit-box-orient: vertical");
    expect(last).toContain("-webkit-line-clamp: 2");
  });

  it("leaves a wide window as it was: two lines of title, one of preview", () => {
    expect(rule(wide(), ".chat-thread-title")).toContain("-webkit-line-clamp: 2");
    expect(rule(wide(), ".chat-thread-last")).toContain("white-space: nowrap");
    expect(rule(wide(), ".chat-thread-last")).not.toContain("line-clamp");
  });
});
