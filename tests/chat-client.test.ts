/**
 * The two client-side rules that decide what a conversation is *called* — its
 * ids, and whether it exists at all.
 *
 * Both are pure functions in src/web/useChat.ts, and both were extracted from
 * the hook for the same reason src/chat.ts extracted `withRetry` and
 * `withEdit`: nothing renders from either of them, so a mistake shows up not as
 * a wrong pixel but as some *later* feature naming a row that is not there.
 * That is exactly how the first of these got shipped broken.
 */
import { describe, expect, it } from "vitest";
import { withServerIds, withoutEmpty } from "../src/web/useChat.js";
import type { ChatMessage, ChatThread } from "../src/types.js";

const at = "2026-08-26T00:00:00.000Z";

const msg = (m: Partial<ChatMessage> & { id: string }): ChatMessage => ({
  role: "user",
  text: "",
  createdAt: at,
  status: "done",
  ...m,
});

/** What the client puts on screen the instant Enter is pressed. */
const optimistic = (messages: ChatMessage[]): ChatThread => ({
  id: "guess-thread",
  title: "why is it like that, exactly, and what follows fro",
  createdAt: at,
  updatedAt: at,
  messages,
});

describe("withServerIds — believing the server about what things are called", () => {
  const turn = () =>
    optimistic([
      msg({ id: "guess-u", role: "user", text: "why is it like that?" }),
      msg({ id: "guess-a", role: "assistant", text: "", status: "pending" }),
    ]);

  it("renames the question as well as the answer", () => {
    /* The bug Greg hit on 2026-08-26. Only the answer's id was swapped, so the
       question kept a name the server had never heard of — invisible, because
       nothing renders an id, until the edit button posted it and the server
       answered "That message is not in this conversation." */
    const [after] = withServerIds([turn()], "guess-thread", "guess-a", {
      threadId: "spya-t7r4wz",
      title: "why is it like that?",
      messageId: "spya-aaaaaa",
      questionId: "spya-uuuuuu",
    });
    expect(after?.messages.map((m) => m.id)).toEqual(["spya-uuuuuu", "spya-aaaaaa"]);
    expect(after?.id).toBe("spya-t7r4wz");
    // The server cuts the title on a word boundary; the optimistic one is a
    // blunt slice that would otherwise sit there until the next reload.
    expect(after?.title).toBe("why is it like that?");
  });

  it("renames only the question this turn is about", () => {
    // The second question in a four-message thread. The first pair is already
    // named by the server and must not be touched.
    const before = optimistic([
      msg({ id: "spya-111111", text: "first" }),
      msg({ id: "spya-222222", role: "assistant", text: "answer" }),
      msg({ id: "guess-u", text: "second" }),
      msg({ id: "guess-a", role: "assistant", text: "", status: "pending" }),
    ]);
    const [after] = withServerIds([before], "guess-thread", "guess-a", {
      threadId: "guess-thread",
      title: "a title the server minted",
      messageId: "spya-aaaaaa",
      questionId: "spya-uuuuuu",
    });
    expect(after?.messages.map((m) => m.id)).toEqual([
      "spya-111111",
      "spya-222222",
      "spya-uuuuuu",
      "spya-aaaaaa",
    ]);
    // Only the first turn names a thread, so a later one leaves the title be.
    expect(after?.title).toBe("why is it like that, exactly, and what follows fro");
  });

  it("leaves every other conversation alone", () => {
    const other = optimistic([msg({ id: "spya-999999" })]);
    other.id = "spya-other0";
    const [untouched] = withServerIds([other, turn()], "guess-thread", "guess-a", {
      threadId: "spya-t7r4wz",
      title: "t",
      messageId: "spya-aaaaaa",
      questionId: "spya-uuuuuu",
    });
    expect(untouched).toBe(other);
  });

  it("changes nothing but the answer when the server sends no question id", () => {
    // An older server, or a frame from before this field existed. The answer's
    // id still has to be followed — the stop button is the only name for it.
    const [after] = withServerIds([turn()], "guess-thread", "guess-a", {
      threadId: "guess-thread",
      title: "t",
      messageId: "spya-aaaaaa",
    });
    expect(after?.messages.map((m) => m.id)).toEqual(["guess-u", "spya-aaaaaa"]);
  });
});

describe("withoutEmpty — a conversation nobody said anything in", () => {
  it("drops it", () => {
    /* Greg, 2026-08-26: "If I start a new conversation and then close it, it
       shouldn't store unless there was at least some text in the input box."
       The input box is the panel's half of that test; this is the other half. */
    const empty = optimistic([]);
    expect(withoutEmpty([empty], empty.id)).toEqual([]);
  });

  it("refuses to drop one that has a message in it", () => {
    // This one is on disk. Taking it off the screen would be a deletion that
    // did not delete — it would be back on the next reload.
    const said = optimistic([msg({ id: "spya-111111", text: "hello" })]);
    expect(withoutEmpty([said], said.id)).toEqual([said]);
  });

  it("leaves the other conversations where they are", () => {
    const empty = optimistic([]);
    const kept = optimistic([msg({ id: "spya-111111" })]);
    kept.id = "spya-other0";
    expect(withoutEmpty([kept, empty], empty.id)).toEqual([kept]);
  });
});
