/**
 * **Every field of a chat message survives the row mapping, both ways.**
 *
 * src/store/pg-chat.ts maps a `ChatMessage` to a row (`messageRow`) and back
 * (`toMessage`) field by field, and every optional field it does not name is
 * dropped without a word: the types allow it, because leaving out an optional
 * key always compiles. `tools`, then `passages` and `interrupted`, then
 * `truncated` went that way —
 * docs/postmortems/261009h-a-flag-the-store-did-not-keep.md.
 *
 * So the fixture is a **`Required<ChatMessage>`**: a field added to the type
 * does not compile here until it is given a value, and once it has one this
 * fails until both halves name it. Every value is a non-default one — `true`
 * for a flag that defaults `false` — or a dropped field would come back as the
 * default and pass.
 *
 * Pure: no database. The `finish` patch, which enumerates fields a third time,
 * is held by tests/chat-truncated-stored.test.ts.
 */
import { describe, expect, it } from "vitest";

import type { chatMessages } from "../src/db/schema.js";
import { messageRow, toMessage } from "../src/store/pg-chat.js";
import type { ChatMessage } from "../src/types.js";

const everyField: Required<ChatMessage> = {
  id: "spya-m3ss4g",
  role: "assistant",
  text: "The three reasons are, first, that the",
  createdAt: "2026-10-09T06:00:00.000Z",
  status: "done",
  citations: [{ url: "https://example.com/a", title: "A" }] as ChatMessage["citations"] & object,
  searches: 2,
  tools: [{ name: "search_article_words", label: "searched for “alpha”", status: "done" }] as ChatMessage["tools"] &
    object,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  error: "a stored error",
  stopped: true,
  truncated: true,
  passages: [{ blockIds: ["spya-k3m9qt"], why: "where it says so" }],
  interrupted: true,
  editedAt: "2026-10-09T06:01:00.000Z",
  stance: "socratic",
  help: true,
  hintOpenedAt: "2026-10-09T06:02:00.000Z",
};

describe("a chat message through messageRow and toMessage", () => {
  it("comes back with every field it went in with", () => {
    const insert = messageRow("00000000-0000-4000-8000-000000261009", "spya-t7r4wz", everyField, 3);
    /* What the database would hand back for that insert: the same values, and
       the two attempt columns null because no attempt was passed. */
    const row = { attemptId: null, attemptStartedAt: null, ...insert } as typeof chatMessages.$inferSelect;
    expect(toMessage(row)).toEqual(everyField);
  });
});
