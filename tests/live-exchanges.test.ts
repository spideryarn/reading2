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
 * Written from GPT Sol's review of docs/plans/260831l-live-conversation-in-chat.md,
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
/**
 * The model's transcript, **carrying the response it belongs to** — as the real
 * event does.
 *
 * The `response_id` was missing from this helper for a day, and its absence was
 * not a tidiness problem: it made a causal implementation untestable and let
 * the "attribute everything to the newest turn" bug pass every test in this
 * file. GPT Sol, reviewing the built code, 2026-08-31.
 */
const spoke = (transcript: string, response = "r1", item = `${response}-a`) => ({
  type: "response.output_audio_transcript.done",
  response_id: response,
  item_id: item,
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
    /* Two failures this prevents, and the second was introduced by fixing the
       first. Storing "let me look that up" as the answer and throwing away the
       reply that answers the question is the obvious one. The other is the
       mirror of it: the second response's `done` frame carries only *its own*
       transcript, so a single string assigned from it loses the first half —
       which the reader heard out loud and would find missing from their own
       transcript. Both runs are kept, in the order they were spoken, joined
       with a space. */
    const l = new ExchangeLedger();
    feed(l, [userItem("u1"), transcribed("u1", "Does he say qualia?")]);
    feed(l, [responseCreated("r1"), spoke("Let me check.")]);
    expect(feed(l, [responseWantsTool("r1")])).toEqual([]);

    l.tool("c1", { name: "search_article_words", label: "searched", detail: "nothing found" });
    const out = feed(l, [responseCreated("r2"), spoke("No, he never uses it.", "r2"), responseDone("r2")]);
    expect(out).toHaveLength(1);
    expect(out[0]?.answer).toBe("Let me check. No, he never uses it.");
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
      ...feed(l, [spoke("The second answer.", "r2"), responseDone("r2")]),
    ];
    /* Turn 2 is complete and turn 1 is not. Nothing may be emitted yet — the
       store appends, so emitting turn 2 now puts the conversation permanently
       out of order. */
    expect(seen, "turn 2 was emitted while turn 1 was still incomplete").toEqual([]);

    const out = feed(l, [transcribed("u1", "The first question.")]);
    expect(out.map((e) => e.question)).toEqual(["The first question.", "The second question."]);
    expect(out.map((e) => e.answer)).toEqual(["The first answer.", "The second answer."]);
  });

  /**
   * **The sequence the whole file exists for, delivered in the order it happens
   * in.**
   *
   * The test above it was written with R1's transcript arriving *before* U2 is
   * created — the one order in which "attribute everything to the newest turn"
   * happens to be right. GPT Sol found that on review: the implementation had
   * exactly that bug, and every test here agreed with it.
   *
   * Here the reader interrupts *first*, so `current` has already moved to U2 by
   * the time R1's own words arrive. Attributed by `current`, R1's answer lands
   * on U2 — and U1 is stored with a question and no answer while U2 gets an
   * answer to something nobody asked. No error, nothing in a console.
   */
  it("attributes an answer to the turn it ANSWERS, not the one being spoken now", () => {
    const l = new ExchangeLedger();
    /* U1 is asked and R1 begins. */
    feed(l, [userItem("u1"), responseCreated("r1")]);
    /* The reader talks over it. U2 is created — `current` moves here. */
    feed(l, [userItem("u2")]);
    /* And only now does R1's own transcript arrive. */
    feed(l, [spoke("The first answer.", "r1"), responseDone("r1")]);
    /* U2 is answered by a response of its own. */
    feed(l, [responseCreated("r2"), spoke("The second answer.", "r2"), responseDone("r2")]);

    /* Gathered across feeds: turn 1 completes the moment its transcription
       lands, and turn 2 a moment later. */
    const out = [
      ...feed(l, [transcribed("u1", "The first question.")]),
      ...feed(l, [transcribed("u2", "The second question.")]),
    ];

    expect(out.map((e) => [e.question, e.answer])).toEqual([
      ["The first question.", "The first answer."],
      ["The second question.", "The second answer."],
    ]);
  });

  it("files a tool receipt against the turn that asked for it", () => {
    /* Same defect, same shape. The browser runs the tool, and a slow one
       finishes after the reader has taken another turn — so a receipt filed by
       "the newest turn" is a claim the reader never saw made, attached to a
       question it has nothing to do with. */
    const l = new ExchangeLedger();
    feed(l, [userItem("u1"), transcribed("u1", "Q1"), responseCreated("r1")]);
    feed(l, [
      {
        type: "response.function_call_arguments.done",
        response_id: "r1",
        call_id: "call-1",
        name: "search_article_words",
        arguments: "{}",
      },
      responseWantsTool("r1"),
    ]);
    /* The reader interrupts before the tool comes back, so `current` moves. */
    feed(l, [userItem("u2"), transcribed("u2", "Q2")]);
    /* And only now does the browser answer the call. */
    l.tool("call-1", { name: "search_article_words", label: "searched", detail: "9 passages" });
    l.passage("call-1", { blockIds: ["spya-aaa222"], why: "the rainstorm" });

    /* `drain` rather than a completed pair, because what is being asserted is
       *which turn holds the receipt* — and making both turns complete would
       need a continuation response, whose own attribution is a separate
       question this test has no business also answering. */
    const out = l.drain();
    expect(out.map((e) => e.question)).toEqual(["Q1", "Q2"]);
    expect(out.map((e) => e.tools.length), "the receipt was filed on the wrong turn").toEqual([
      1, 0,
    ]);
    expect(out.map((e) => e.passages.length)).toEqual([1, 0]);
  });

  it("attaches a late transcription to its own turn, not the newest one", () => {
    const l = new ExchangeLedger();
    feed(l, [userItem("u1"), responseCreated("r1"), spoke("A1"), responseDone("r1")]);
    feed(l, [userItem("u2"), responseCreated("r2"), spoke("A2", "r2"), responseDone("r2")]);
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
    feed(l, [userItem("u2"), responseCreated("r2"), spoke("A2", "r2"), responseDone("r2")]);
    feed(l, [transcribed("u2", "Q2")]);
    const out = feed(l, [transcriptionFailed("u1")]);
    expect(out).toHaveLength(2);
    expect(out[0]?.question).toBe("");
    expect(out[0]?.answer).toBe("A1");
    expect(out[1]?.question).toBe("Q2");
  });
});

describe("interruption", () => {
  it.each(["failed", "cancelled", "incomplete"])("marks a %s provider answer as unfinished", (status) => {
    const ledger = new ExchangeLedger();
    const out = feed(ledger, [
      userItem("u1"), transcribed("u1", "Q1"), responseCreated("r1"), spoke("A partial answer"),
      { type: "response.done", response: { id: "r1", status, output: [{ type: "message" }] } },
    ]);
    expect(out).toMatchObject([{ question: "Q1", answer: "A partial answer", interrupted: true }]);
    expect(ledger.pending()).toBe(0);
  });

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
  it("is derived from the item rather than minted fresh", () => {
    /* **Nothing on the server reads this**, and the comment here used to say it
       did — that a replayed POST was de-duplicated on it. It is not: the write
       is guarded by `expectedTailId` alone, which is why there is no exchange-id
       column at all (docs/project/live-conversation.md). GPT Sol caught the
       claim on review; a test that describes a mechanism that does not exist is
       worse than no test, because the next person changes the code to match it.
       What the id is actually for is being *stable* — the same exchange rebuilt
       from the same events is the same exchange, which is what lets a caller
       recognise one it has already seen without keeping a list. */
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
    l.passage("c1", { blockIds: ["spya-aaa111"], why: "the rainstorm" });
    const first = feed(l, [spoke("A1"), responseDone("r1")]);
    expect(first[0]?.passages).toEqual([{ blockIds: ["spya-aaa111"], why: "the rainstorm" }]);

    feed(l, [userItem("u2"), transcribed("u2", "Q2"), responseCreated("r2")]);
    const second = feed(l, [spoke("A2", "r2"), responseDone("r2")]);
    expect(second[0]?.passages, "a pointer leaked into the next turn").toEqual([]);
  });
});

describe("what belongs to the exchange on screen", () => {
  it("names every item it was drawn from, so the live copy can come off", () => {
    /* The panel shows a turn arriving and then the *stored* rows arrive
       underneath it. Without this the reader watches their own question
       duplicate itself the moment it is saved. */
    const l = new ExchangeLedger();
    feed(l, [userItem("u1"), transcribed("u1", "Q1"), responseCreated("r1")]);
    const out = feed(l, [
      { type: "response.output_audio_transcript.delta", response_id: "r1", item_id: "i1", delta: "A" },
      { type: "response.output_audio_transcript.done", response_id: "r1", item_id: "i1", transcript: "A1" },
      responseDone("r1"),
    ]);
    expect(out[0]?.itemIds).toEqual(["u1", "i1"]);
  });

  it("names BOTH answer items when a tool split the answer in two", () => {
    /* The case the caller could not work out for itself. A tool-using answer
       spans two responses and two assistant items, and "the ones since the last
       emit" is exactly the arrival-order reasoning this file exists to avoid. */
    const l = new ExchangeLedger();
    feed(l, [userItem("u1"), transcribed("u1", "Q1"), responseCreated("r1")]);
    feed(l, [
      { type: "response.output_audio_transcript.delta", response_id: "r1", item_id: "i1", delta: "Let me look" },
      responseWantsTool("r1"),
    ]);
    const out = feed(l, [
      responseCreated("r2"),
      { type: "response.output_audio_transcript.done", response_id: "r2", item_id: "i2", transcript: "Found it." },
      responseDone("r2"),
    ]);
    expect(out[0]?.itemIds).toEqual(["u1", "i1", "i2"]);
  });

  it("counts what is still unfinished, so a hang-up need not always wait", () => {
    /* The grace window before the channel closes reads this. A reader who stops
       after a finished answer waits for nothing; one who stops mid-sentence
       gets a moment for the transcription of it to land. */
    const l = new ExchangeLedger();
    expect(l.pending()).toBe(0);
    feed(l, [userItem("u1"), responseCreated("r1"), spoke("A1"), responseDone("r1")]);
    expect(l.pending(), "waiting on the question's transcription").toBe(1);
    feed(l, [transcribed("u1", "Q1")]);
    expect(l.pending()).toBe(0);
  });
});
