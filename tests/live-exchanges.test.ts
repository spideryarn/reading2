/**
 * **The exchange ledger, and the orderings that would corrupt a transcript.**
 *
 * `src/web/live/exchanges.ts` exists because the obvious implementation — keep
 * the last question, keep the last answer, write them down when the answer ends
 * — is wrong, and looks right until somebody talks over the model. These tests
 * are the sequences that break it.
 *
 * Every one of them is a *transcript corruption*, which is the thing worth being
 * frightened of here: an answer stored with the wrong question, or with no
 * question, is something the reader reads back a week later and disbelieves.
 * There is no error, no exception, nothing in a log.
 *
 * Written from GPT Sol's review of docs/plans/live-conversation-in-chat.md,
 * whose finding 1 supplied the interleaving in "an answer can arrive before the
 * question it answers".
 */
import { describe, expect, it } from "vitest";

import { ExchangeLedger } from "../src/web/live/exchanges.js";

/* ---------- the events, as OpenAI actually sends them ---------- */

const userItem = (id: string) => ({
  type: "conversation.item.added",
  item: { id, role: "user", type: "message" },
});
const transcribed = (id: string, transcript: string) => ({
  type: "conversation.item.input_audio_transcription.completed",
  item_id: id,
  transcript,
});
const transcriptionFailed = (id: string) => ({
  type: "conversation.item.input_audio_transcription.failed",
  item_id: id,
});
const responseCreated = (id: string) => ({ type: "response.created", response: { id } });
const spoke = (transcript: string) => ({
  type: "response.output_audio_transcript.done",
  transcript,
});
/** A response that finished having asked for nothing more. */
const responseDone = (id: string) => ({
  type: "response.done",
  response: { id, status: "completed", output: [{ type: "message" }] },
});
/** A response that ended by asking for a tool — NOT the end of the answer. */
const responseWantsTool = (id: string) => ({
  type: "response.done",
  response: { id, status: "completed", output: [{ type: "function_call", call_id: "c1" }] },
});

function feed(ledger: ExchangeLedger, events: Record<string, unknown>[]) {
  const out = [];
  for (const e of events) out.push(...ledger.push(e));
  return out;
}

describe("assembling one ordinary turn", () => {
  it("emits nothing until BOTH halves are settled", () => {
    const l = new ExchangeLedger();
    expect(feed(l, [userItem("u1"), responseCreated("r1"), spoke("Because he says so.")])).toEqual(
      [],
    );
    /* The answer is finished but the question has not been transcribed yet.
       Emitting here would write down an answer with an empty question. */
    expect(feed(l, [responseDone("r1")])).toEqual([]);
    const out = feed(l, [transcribed("u1", "Why does he think that?")]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      question: "Why does he think that?",
      answer: "Because he says so.",
      interrupted: false,
    });
  });

  it("does not end the exchange on a response that asked for a tool", () => {
    /* The failure this prevents: storing "let me look that up" as the answer
       and throwing away the reply that actually answers the question. */
    const l = new ExchangeLedger();
    feed(l, [userItem("u1"), transcribed("u1", "Does he say qualia?")]);
    feed(l, [responseCreated("r1"), spoke("Let me check.")]);
    expect(feed(l, [responseWantsTool("r1")])).toEqual([]);

    l.tool({ name: "search_article_words", label: "searched", detail: "nothing found" });
    const out = feed(l, [responseCreated("r2"), spoke("No, he never uses it."), responseDone("r2")]);
    expect(out).toHaveLength(1);
    expect(out[0]?.answer).toBe("No, he never uses it.");
    expect(out[0]?.tools).toHaveLength(1);
  });
});

describe("the orderings that corrupt a transcript", () => {
  /**
   * GPT Sol's sequence, verbatim: U1 committed, R1 answers, reader interrupts
   * with U2, R1's transcript lands, U2 transcribes, R2 finishes, and only then
   * does U1's transcription arrive.
   *
   * The naive implementation writes R1 against U2, or writes turn 2 before
   * turn 1. Both are silent.
   */
  it("keeps conversation order when an answer arrives before the question it answers", () => {
    const l = new ExchangeLedger();
    const seen = [
      ...feed(l, [userItem("u1"), responseCreated("r1"), spoke("The first answer."), responseDone("r1")]),
      ...feed(l, [userItem("u2"), responseCreated("r2")]),
      ...feed(l, [transcribed("u2", "The second question.")]),
      ...feed(l, [spoke("The second answer."), responseDone("r2")]),
    ];
    /* Turn 2 is complete and turn 1 is not. Nothing may be emitted yet — the
       store appends, so emitting turn 2 now puts the conversation permanently
       out of order. */
    expect(seen, "turn 2 was emitted while turn 1 was still incomplete").toEqual([]);

    const out = feed(l, [transcribed("u1", "The first question.")]);
    expect(out.map((e) => e.question)).toEqual(["The first question.", "The second question."]);
    expect(out.map((e) => e.answer)).toEqual(["The first answer.", "The second answer."]);
  });

  it("attaches a late transcription to its own turn, not the newest one", () => {
    const l = new ExchangeLedger();
    feed(l, [userItem("u1"), responseCreated("r1"), spoke("A1"), responseDone("r1")]);
    feed(l, [userItem("u2"), responseCreated("r2"), spoke("A2"), responseDone("r2")]);
    /* Both answers are in; the transcriptions arrive backwards. Keying on
       `item_id` is the whole defence. */
    feed(l, [transcribed("u2", "Q2")]);
    const out = feed(l, [transcribed("u1", "Q1")]);
    expect(out.map((e) => [e.question, e.answer])).toEqual([
      ["Q1", "A1"],
      ["Q2", "A2"],
    ]);
  });

  it("does not strand the conversation on a transcription that never succeeds", () => {
    /* A failed transcription must settle the turn. If it did not, every later
       exchange would queue behind it forever — the ordering rule turns one lost
       transcript into a lost conversation. */
    const l = new ExchangeLedger();
    feed(l, [userItem("u1"), responseCreated("r1"), spoke("A1"), responseDone("r1")]);
    feed(l, [userItem("u2"), responseCreated("r2"), spoke("A2"), responseDone("r2")]);
    feed(l, [transcribed("u2", "Q2")]);
    const out = feed(l, [transcriptionFailed("u1")]);
    expect(out).toHaveLength(2);
    expect(out[0]?.question).toBe("");
    expect(out[0]?.answer).toBe("A1");
    expect(out[1]?.question).toBe("Q2");
  });
});

describe("interruption", () => {
  it("marks the turn rather than editing what was said", () => {
    /* The transcript cannot be corrected — the server truncates the audio and
       keeps the text whole — so the only honest thing is to say so. */
    const l = new ExchangeLedger();
    feed(l, [userItem("u1"), transcribed("u1", "Q1"), responseCreated("r1"), spoke("A long answer")]);
    l.interrupt();
    const out = feed(l, [responseDone("r1")]);
    expect(out).toHaveLength(1);
    expect(out[0]?.interrupted).toBe(true);
    expect(out[0]?.answer, "the text must be kept whole, not truncated by us").toBe("A long answer");
  });

  it("does not mark a turn whose answer had already finished", () => {
    const l = new ExchangeLedger();
    feed(l, [userItem("u1"), transcribed("u1", "Q1"), responseCreated("r1"), spoke("A1"), responseDone("r1")]);
    l.interrupt();
    expect(l.drain()).toEqual([]);
  });
});

describe("hanging up", () => {
  it("keeps a half-finished exchange rather than discarding it", () => {
    /* A reader who hangs up mid-answer watched those words happen. Throwing
       them away because a terminal event never arrived is the rudest possible
       reading of "incomplete". */
    const l = new ExchangeLedger();
    feed(l, [userItem("u1"), transcribed("u1", "Q1"), responseCreated("r1"), spoke("half an ans")]);
    const out = l.drain();
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ question: "Q1", answer: "half an ans", interrupted: true });
  });

  it("drops a turn with nothing on either side", () => {
    /* An item opened by a cough. Not a conversation turn, and writing it down
       puts an empty pair of rows in the reader's transcript. */
    const l = new ExchangeLedger();
    feed(l, [userItem("u1"), transcriptionFailed("u1")]);
    expect(l.drain()).toEqual([]);
  });

  it("never emits the same exchange twice", () => {
    /* `drain` after a normal emit is the ordinary shape — hang up at the end of
       a completed turn — and a duplicate here is a duplicated turn in the
       reader's thread. */
    const l = new ExchangeLedger();
    const out = feed(l, [
      userItem("u1"),
      transcribed("u1", "Q1"),
      responseCreated("r1"),
      spoke("A1"),
      responseDone("r1"),
    ]);
    expect(out).toHaveLength(1);
    expect(l.drain()).toEqual([]);
  });
});

describe("the exchange id", () => {
  it("is derived from the item, so a replayed write is recognisable", () => {
    /* Not random: the server de-duplicates on this, and a fresh id on every
       retry would append the same exchange twice. */
    const a = new ExchangeLedger();
    const b = new ExchangeLedger();
    const one = feed(a, [userItem("u9"), transcribed("u9", "Q"), responseCreated("r"), spoke("A"), responseDone("r")]);
    const two = feed(b, [userItem("u9"), transcribed("u9", "Q"), responseCreated("r"), spoke("A"), responseDone("r")]);
    expect(one[0]?.id).toBe(two[0]?.id);
    expect(one[0]?.id).toContain("u9");
  });
});

describe("passages", () => {
  it("belong to the turn they were pointed at during", () => {
    const l = new ExchangeLedger();
    feed(l, [userItem("u1"), transcribed("u1", "Q1"), responseCreated("r1")]);
    l.passage({ blockIds: ["spya-aaa111"], why: "the rainstorm" });
    const first = feed(l, [spoke("A1"), responseDone("r1")]);
    expect(first[0]?.passages).toEqual([{ blockIds: ["spya-aaa111"], why: "the rainstorm" }]);

    feed(l, [userItem("u2"), transcribed("u2", "Q2"), responseCreated("r2")]);
    const second = feed(l, [spoke("A2"), responseDone("r2")]);
    expect(second[0]?.passages, "a pointer leaked into the next turn").toEqual([]);
  });
});
