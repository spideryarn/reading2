/**
 * **GPT-Live's fragments into chat rows, and the orderings that would corrupt them.**
 *
 * `src/web/live/gpt-live/segments.ts`. The wire gives 200 ms transcript
 * windows with no turn ids, from two people who can talk at once. Every test
 * here is a way the stored conversation could come out wrong with no error
 * anywhere: words dropped, rows out of order, an answer frozen at its
 * preamble, an exchange written twice.
 *
 * The orderings are GPT Sol's, from the plan review
 * (docs/plans/261003a-gpt-live-alongside-realtime-plan-review-sol.md, F1–F3).
 * The last two tests replay real traces from the spike.
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  Segmenter,
  type SegmentEvent,
  type Speaker,
  type SpokenExchange,
  type TranscriptFragment,
} from "../src/web/live/gpt-live/segments.js";

let ids = 0;

/** One fragment, as the wire sends it. */
function fragment(role: Speaker, startMs: number, delta: string, eventId = `e${ids++}`): SegmentEvent {
  return { type: "fragment", role, eventId, startMs, endMs: startMs + 200, delta };
}

/** A sentence as fragments: one word per 200 ms window, each with its own leading space. */
function say(role: Speaker, startMs: number, sentence: string): SegmentEvent[] {
  return sentence.split(" ").map((word, i) => fragment(role, startMs + i * 200, ` ${word}`));
}

function feed(s: Segmenter, events: SegmentEvent[]): SpokenExchange[] {
  const out: SpokenExchange[] = [];
  for (const e of events) out.push(...s.push(e));
  return out;
}

/** The rows as they would be stored: [question, answer]. */
const rows = (exchanges: SpokenExchange[]) => exchanges.map((x) => [x.question, x.answer]);

const TOOL = { name: "search", label: "Searched the article", detail: "lighthouse" };
const PASSAGE = { blockIds: ["spya-k3m9qt"], why: "where it says so" };

describe("an ordinary conversation", () => {
  it("is one exchange, written only at closing", () => {
    const s = new Segmenter();
    const during = feed(s, [
      ...say("reader", 1_000, "Why does he think that?"),
      ...say("companion", 2_400, "Because he says so."),
    ]);
    expect(during).toEqual([]);
    const { exchanges, unattached } = s.closing();
    expect(rows(exchanges)).toEqual([["Why does he think that?", "Because he says so."]]);
    expect(exchanges[0]).toMatchObject({ seq: 0, id: "gpt-live-0", interrupted: false, tools: [], passages: [] });
    expect(unattached).toEqual({ tools: [], passages: [] });
  });

  it("writes the first exchange once the second question has been asked and answered", () => {
    const s = new Segmenter();
    expect(
      feed(s, [
        ...say("reader", 1_000, "Why does he think that?"),
        ...say("companion", 2_400, "Because he says so."),
        ...say("reader", 8_000, "And where is that?"),
      ]),
    ).toEqual([]);
    /* The second question may still be growing: nothing is written until the
       companion has been heard well past its last word. */
    const out = feed(s, say("companion", 11_000, "In the second section."));
    expect(rows(out)).toEqual([["Why does he think that?", "Because he says so."]]);
    expect(out[0]?.interrupted).toBe(false);
    expect(rows(s.closing().exchanges)).toEqual([["And where is that?", "In the second section."]]);
  });
});

describe("the reader speaks while the companion is speaking (F1)", () => {
  it("makes 'mm-hm' a short question, loses nothing, and does not mark the answer interrupted", () => {
    const s = new Segmenter();
    const out = feed(s, [
      ...say("reader", 1_000, "What is the argument?"),
      ...say("companion", 2_000, "It has three parts and the"),
      fragment("reader", 3_200, " mm-hm"),
      ...say("companion", 3_200, "first is about cost while the second is about time"),
    ]);
    expect(rows(out)).toEqual([["What is the argument?", "It has three parts and the"]]);
    expect(out[0]?.interrupted).toBe(false);
    expect(rows(s.closing().exchanges)).toEqual([
      ["mm-hm", "first is about cost while the second is about time"],
    ]);
  });

  it("keeps the rows in spoken order when a real interruption is followed by the companion carrying on", () => {
    const s = new Segmenter();
    const out = feed(s, [
      ...say("reader", 1_000, "What is the argument?"),
      ...say("companion", 2_000, "It has three parts and the"),
      ...say("reader", 3_200, "But what about the other example?"),
      ...say("companion", 3_200, "first is about cost"),
      ...say("companion", 6_400, "and the second is about time"),
    ]);
    expect(rows(out)).toEqual([["What is the argument?", "It has three parts and the"]]);
    expect(out[0]?.interrupted).toBe(true);
    const rest = s.closing().exchanges;
    expect(rows(rest)).toEqual([
      ["But what about the other example?", "first is about cost and the second is about time"],
    ]);
    /* Every word said is in a row. */
    const stored = [...out, ...rest].flatMap((x) => [x.question, x.answer]).join(" ");
    expect(stored).toBe(
      "What is the argument? It has three parts and the But what about the other example? first is about cost and the second is about time",
    );
  });

  it("keeps 'Don't continue', which the first draft of the plan would have dropped", () => {
    const s = new Segmenter();
    feed(s, [
      ...say("reader", 1_000, "What is the argument?"),
      ...say("companion", 2_000, "It has three parts and the"),
      ...say("reader", 3_200, "Don't continue"),
    ]);
    const { exchanges } = s.closing();
    expect(rows(exchanges)).toEqual([
      ["What is the argument?", "It has three parts and the"],
      ["Don't continue", ""],
    ]);
    /* Two words: it splits the rows and does not set the flag. */
    expect(exchanges.map((x) => x.interrupted)).toEqual([false, false]);
  });

  it("does not call a long question interrupted when the companion had already stopped", () => {
    const s = new Segmenter();
    feed(s, [
      ...say("companion", 1_000, "It has three parts."),
      ...say("reader", 4_000, "And which of those does he rely on?"),
    ]);
    expect(s.closing().exchanges.map((x) => x.interrupted)).toEqual([false, false]);
  });

  it("keeps a reader's sentence in one row when its fragments are sparse and the companion talks through them", () => {
    const s = new Segmenter();
    const exchanges = feed(s, [
      ...say("companion", 1_000, "It has three parts and the first of them is cost"),
      /* The spike has 600 ms between two words of one sentence. */
      fragment("reader", 1_400, " hang"),
      fragment("reader", 2_000, " on"),
      fragment("reader", 2_800, " please"),
    ]);
    exchanges.push(...s.closing().exchanges);
    expect(rows(exchanges)).toEqual([
      ["", "It has"],
      ["hang on please", "three parts and the first of them is cost"],
    ]);
  });

  it("does not alternate word by word when both talk at once", () => {
    const s = new Segmenter();
    feed(s, [
      ...say("companion", 1_000, "It has three parts and"),
      /* Both speaking through the same second. */
      ...say("reader", 2_000, "hang on that is not what I asked"),
      ...say("companion", 2_000, "the first is cost"),
    ]);
    expect(rows(s.closing().exchanges)).toEqual([
      ["", "It has three parts and"],
      ["hang on that is not what I asked", "the first is cost"],
    ]);
  });
});

describe("nothing is written on silence (F2)", () => {
  it("does not freeze an answer at its preamble when the backend's answer is spoken 3.5 s later", () => {
    const s = new Segmenter();
    const out = feed(s, [
      ...say("reader", 1_000, "What does it say about the lighthouse?"),
      ...say("companion", 2_600, "Checking the article."),
      { type: "tool", delegationId: "d1", tool: TOOL },
      /* The backend has finished. The voice has not started the answer. */
      { type: "delegation-final", delegationId: "d1" },
    ]);
    expect(out).toEqual([]);
    /* Three and a half seconds of nothing, then the answer. */
    expect(feed(s, say("companion", 6_700, "It was painted teal in 1987."))).toEqual([]);
    const { exchanges } = s.closing();
    expect(rows(exchanges)).toEqual([
      ["What does it say about the lighthouse?", "Checking the article. It was painted teal in 1987."],
    ]);
    expect(exchanges[0]?.tools).toEqual([TOOL]);
  });
});

describe("the wire repeats itself and arrives out of order", () => {
  it("ignores a fragment it has already had", () => {
    const s = new Segmenter();
    feed(s, [
      fragment("reader", 1_000, " Why", "a"),
      fragment("reader", 1_000, " Why", "a"),
      fragment("reader", 1_200, " now?", "b"),
      fragment("reader", 1_000, " Why", "a"),
    ]);
    expect(rows(s.closing().exchanges)).toEqual([["Why now?", ""]]);
  });

  it("puts a reader fragment that arrives late where it was said", () => {
    const s = new Segmenter();
    const question = say("reader", 1_000, "Why does he think that?");
    const lastWord = question.pop() as SegmentEvent;
    feed(s, [...question, ...say("companion", 2_400, "Because he says so."), lastWord]);
    expect(rows(s.closing().exchanges)).toEqual([["Why does he think that?", "Because he says so."]]);
  });

  it("gives the same rows whatever order the fragments arrive in", () => {
    const events = [
      ...say("reader", 1_000, "What is the argument?"),
      ...say("companion", 2_000, "It has three parts and the"),
      ...say("reader", 3_200, "But what about the other example?"),
      ...say("companion", 3_200, "first is about cost"),
    ];
    const inOrder = new Segmenter();
    feed(inOrder, events);
    const reversed = new Segmenter();
    feed(reversed, [...events].reverse());
    expect(rows(reversed.closing().exchanges)).toEqual(rows(inOrder.closing().exchanges));
  });

  it("joins deltas with the spaces they carry, and keeps the space of a blank one", () => {
    const s = new Segmenter();
    feed(s, [
      fragment("companion", 1_000, " teal"),
      fragment("companion", 1_200, " in"),
      fragment("companion", 1_400, " 198"),
      fragment("companion", 1_600, "7."),
      fragment("companion", 1_800, " "),
      fragment("companion", 2_000, "Really"),
      fragment("companion", 2_200, "."),
    ]);
    expect(rows(s.closing().exchanges)).toEqual([["", "teal in 1987. Really."]]);
  });

  /* The browser check of 2026-10-03 stored "Checking.He says AI removes…": the
     first delta of the backend's spoken answer came with no space of its own,
     seconds after the filler. */
  it("puts a space before a delta that has none when the speaker had paused before it", () => {
    const s = new Segmenter();
    feed(s, [
      ...say("reader", 1_000, "What is the main argument?"),
      fragment("companion", 2_200, " Checking"),
      fragment("companion", 2_400, "."),
      fragment("companion", 5_600, "He"),
      fragment("companion", 5_800, " says"),
      fragment("companion", 6_000, " so."),
    ]);
    expect(rows(s.closing().exchanges)).toEqual([["What is the main argument?", "Checking. He says so."]]);
    expect(s.lines().at(-1)?.text).toBe("Checking. He says so.");
  });

  it("puts that space in wherever the fragments arrive in a different order", () => {
    const s = new Segmenter();
    feed(s, [
      fragment("companion", 5_600, "He"),
      fragment("companion", 5_800, " says so."),
      fragment("companion", 2_200, " Checking"),
      fragment("companion", 2_400, "."),
    ]);
    expect(rows(s.closing().exchanges)).toEqual([["", "Checking. He says so."]]);
  });

  it("never puts one inside a number or a word split across neighbouring windows, or before closing punctuation", () => {
    const s = new Segmenter();
    feed(s, [
      fragment("companion", 1_000, " It"),
      fragment("companion", 1_200, " cost"),
      fragment("companion", 1_400, " 3."),
      fragment("companion", 1_600, "14"),
      fragment("companion", 1_800, " in"),
      fragment("companion", 2_000, " the"),
      fragment("companion", 2_200, " U."),
      fragment("companion", 2_400, "S."),
      fragment("companion", 2_600, " extra"),
      fragment("companion", 2_800, "ordinarily"),
      /* One empty window inside a slowly spoken year is still one number. */
      fragment("companion", 3_000, " 198"),
      fragment("companion", 3_400, "7"),
      /* And punctuation after a long pause stays on its word. */
      fragment("companion", 6_000, "."),
    ]);
    expect(rows(s.closing().exchanges)).toEqual([["", "It cost 3.14 in the U.S. extraordinarily 1987."]]);
  });

  it("does not let a whitespace-only fragment start a row or split one", () => {
    const s = new Segmenter();
    feed(s, [
      ...say("reader", 1_000, "Why does he"),
      fragment("companion", 2_000, " "),
      /* A long pause, with only a blank from the companion in it. */
      ...say("reader", 4_000, "think that?"),
    ]);
    expect(rows(s.closing().exchanges)).toEqual([["Why does he think that?", ""]]);
  });
});

describe("written means frozen", () => {
  const twoExchanges = [
    ...say("reader", 1_000, "Why does he think that?"),
    ...say("companion", 2_400, "Because he says so."),
    ...say("reader", 8_000, "And where is that?"),
    ...say("companion", 11_000, "In the second section."),
  ];

  it("hands each exchange over exactly once, however much arrives afterwards", () => {
    const s = new Segmenter();
    const emitted = feed(s, twoExchanges);
    expect(emitted.map((x) => x.seq)).toEqual([0]);
    emitted.push(...feed(s, say("reader", 15_000, "And who disagrees with him?")));
    emitted.push(...feed(s, say("companion", 18_000, "Nobody in this piece.")));
    emitted.push(...s.closing().exchanges);
    emitted.push(...s.closing().exchanges);
    expect(emitted.map((x) => x.seq)).toEqual([0, 1, 2]);
    expect(new Set(emitted.map((x) => x.id)).size).toBe(3);
    expect(rows(emitted)).toEqual([
      ["Why does he think that?", "Because he says so."],
      ["And where is that?", "In the second section."],
      ["And who disagrees with him?", "Nobody in this piece."],
    ]);
  });

  it("puts a fragment that arrives for a frozen exchange into the next one, not back into the frozen one", () => {
    const s = new Segmenter();
    const emitted = feed(s, twoExchanges);
    expect(rows(emitted)).toEqual([["Why does he think that?", "Because he says so."]]);
    /* Its time is inside the first answer, which has been written. */
    expect(feed(s, [fragment("companion", 3_400, " Honestly.")])).toEqual([]);
    expect(rows(s.closing().exchanges)).toEqual([["And where is that?", "Honestly. In the second section."]]);
  });

  it("starts a new exchange with an empty question for companion speech after closing", () => {
    const s = new Segmenter();
    feed(s, twoExchanges);
    s.closing();
    /* Late, and timed inside the first answer: it still goes after everything written. */
    expect(feed(s, [fragment("companion", 3_400, " Goodbye.")])).toEqual([]);
    const late = s.closing().exchanges;
    expect(rows(late)).toEqual([["", "Goodbye."]]);
    expect(late[0]?.seq).toBe(2);
    /* The record of segments stays in spoken order. */
    const starts = s.segments().map((segment) => segment.startMs);
    expect(starts).toEqual([...starts].sort((a, b) => a - b));
    expect(starts.at(-1)).toBeGreaterThanOrEqual(11_600);
  });
});

describe("tool runs and passages", () => {
  it("go on the exchange open when the delegation's final arrives", () => {
    const s = new Segmenter();
    const out = feed(s, [
      ...say("reader", 1_000, "Why does he think that?"),
      ...say("companion", 2_400, "Because he says so."),
      ...say("reader", 8_000, "And where is that?"),
      { type: "tool", delegationId: "d1", tool: TOOL },
      { type: "passage", delegationId: "d1", passage: PASSAGE },
      { type: "delegation-final", delegationId: "d1" },
      ...say("companion", 11_000, "In the second section."),
    ]);
    expect(out[0]).toMatchObject({ seq: 0, tools: [], passages: [] });
    expect(s.closing().exchanges[0]).toMatchObject({ seq: 1, tools: [TOOL], passages: [PASSAGE] });
  });

  it("stay one exchange early when the reader speaks between the backend finishing and the answer (F3, accepted)", () => {
    const s = new Segmenter();
    const exchanges = feed(s, [
      ...say("reader", 1_000, "What does it say about the lighthouse?"),
      ...say("companion", 2_600, "Checking the article."),
      { type: "tool", delegationId: "d1", tool: TOOL },
      { type: "delegation-final", delegationId: "d1" },
      /* The reader speaks in the gap, and the answer comes after. */
      ...say("reader", 6_000, "Take your time."),
      ...say("companion", 9_000, "It was painted teal in 1987."),
    ]);
    exchanges.push(...s.closing().exchanges);
    expect(rows(exchanges)).toEqual([
      ["What does it say about the lighthouse?", "Checking the article."],
      ["Take your time.", "It was painted teal in 1987."],
    ]);
    expect(exchanges.map((x) => x.tools)).toEqual([[TOOL], []]);
  });

  it("follow the answer when the tools finish after the reader's interruption has begun (F3)", () => {
    const s = new Segmenter();
    const exchanges = feed(s, [
      ...say("reader", 1_000, "What does it say about the lighthouse?"),
      ...say("companion", 2_600, "Checking the article."),
      ...say("reader", 5_000, "Actually also tell me who painted it."),
      { type: "tool", delegationId: "d1", tool: TOOL },
      { type: "delegation-final", delegationId: "d1" },
      ...say("companion", 9_000, "It was painted teal in 1987."),
    ]);
    exchanges.push(...s.closing().exchanges);
    expect(exchanges.map((x) => x.tools)).toEqual([[], [TOOL]]);
  });

  it("go on the last exchange at closing when their delegation never finished", () => {
    const s = new Segmenter();
    feed(s, [
      ...say("reader", 1_000, "Why does he think that?"),
      ...say("companion", 2_400, "Because he says so."),
      ...say("reader", 8_000, "And where is that?"),
      ...say("companion", 11_000, "One moment."),
      { type: "tool", delegationId: "d2", tool: TOOL },
    ]);
    const { exchanges, unattached } = s.closing();
    expect(exchanges).toHaveLength(1);
    expect(exchanges[0]).toMatchObject({ seq: 1, tools: [TOOL] });
    expect(unattached).toEqual({ tools: [], passages: [] });
  });

  it("are handed back, and no exchange is invented, when nothing was ever said", () => {
    const s = new Segmenter();
    feed(s, [
      { type: "tool", delegationId: "d1", tool: TOOL },
      { type: "delegation-final", delegationId: "d1", passages: [PASSAGE] },
      { type: "tool", delegationId: "d2", tool: TOOL },
    ]);
    expect(s.closing()).toEqual({
      exchanges: [],
      unattached: { tools: [TOOL, TOOL], passages: [PASSAGE] },
    });
  });

  it("wait for the first exchange when the final arrives before anybody has spoken", () => {
    const s = new Segmenter();
    feed(s, [
      { type: "delegation-final", delegationId: "d1", tools: [TOOL] },
      ...say("companion", 2_000, "It was painted teal."),
    ]);
    expect(s.closing().exchanges[0]?.tools).toEqual([TOOL]);
  });
});

describe("the live transcript", () => {
  it("is one line per segment, with ids that do not change as the segment grows", () => {
    const s = new Segmenter();
    feed(s, say("reader", 1_000, "Why does he"));
    const before = s.lines();
    expect(before).toEqual([
      { id: "seg-0", role: "reader", text: "Why does he", done: false, exchange: "gpt-live-0", seq: 0 },
    ]);
    feed(s, [...say("reader", 1_600, "think that?"), ...say("companion", 2_400, "Because")]);
    expect(s.lines()).toEqual([
      { id: "seg-0", role: "reader", text: "Why does he think that?", done: false, exchange: "gpt-live-0", seq: 0 },
      { id: "seg-1", role: "companion", text: "Because", done: false, exchange: "gpt-live-0", seq: 0 },
    ]);
  });

  /* What the thread groups by (src/web/live/tail.ts, which arrived with dev's
     261002j): a question and its answer are one group, and the group a frozen
     line is in is the exchange it was emitted as. Without this every line is
     its own group and the thread still reads in order, so nothing else here
     would notice the pairing was lost. */
  it("says which exchange each line belongs to, frozen or still open", () => {
    const s = new Segmenter();
    const out = feed(s, [
      ...say("reader", 1_000, "Why does he think that?"),
      ...say("companion", 2_400, "Because he says so."),
      ...say("reader", 8_000, "And where is that?"),
      ...say("companion", 11_000, "In the second section."),
    ]);
    expect(out[0]?.id).toBe("gpt-live-0");
    expect(s.lines().map((l) => [l.id, l.exchange, l.seq])).toEqual([
      ["seg-0", "gpt-live-0", 0],
      ["seg-1", "gpt-live-0", 0],
      ["seg-2", "gpt-live-1", 1],
      ["seg-3", "gpt-live-1", 1],
    ]);
  });

  it("marks a line done when it is frozen, and names an exchange's lines in itemIds", () => {
    const s = new Segmenter();
    const out = feed(s, [
      ...say("reader", 1_000, "Why does he think that?"),
      ...say("companion", 2_400, "Because he says so."),
      ...say("reader", 8_000, "And where is that?"),
      ...say("companion", 11_000, "In the second section."),
    ]);
    expect(out[0]?.itemIds).toEqual(["seg-0", "seg-1"]);
    expect(s.lines().map((l) => [l.id, l.done])).toEqual([
      ["seg-0", true],
      ["seg-1", true],
      ["seg-2", false],
      ["seg-3", false],
    ]);
    expect(s.segments().map((x) => x.frozen)).toEqual([true, true, false, false]);
  });
});

describe("real traces from the spike", () => {
  function replay(name: string): SpokenExchange[] {
    const trace = JSON.parse(
      readFileSync(new URL(`../evals/live/gpt-live-spike/spike-out-${name}.json`, import.meta.url), "utf8"),
    ) as { events: { ev: Record<string, unknown> }[] };
    const s = new Segmenter();
    const during: SpokenExchange[] = [];
    for (const { ev } of trace.events) {
      const role: Speaker | null =
        ev.type === "session.input_transcript.delta"
          ? "reader"
          : ev.type === "session.output_transcript.delta"
            ? "companion"
            : null;
      if (!role) continue;
      during.push(
        ...s.push({
          type: "fragment",
          role,
          eventId: String(ev.event_id),
          startMs: Number(ev.start_ms),
          endMs: Number(ev.end_ms),
          delta: String(ev.delta),
        }),
      );
    }
    expect(during).toEqual([]);
    return s.closing().exchanges;
  }

  it("a spoken question and its answer through a tool", () => {
    expect(rows(replay("spoken"))).toEqual([
      [
        "What does the article say about the lighthouse",
        "I'm checking the article. One moment. It says the lighthouse was painted teal in 1987.",
      ],
    ]);
  });

  it("a typed question has no input transcript, so the answer has an empty question", () => {
    expect(rows(replay("allow"))).toEqual([
      ["", "Alright, checking for that now. The article says it was painted teal in 1987."],
    ]);
  });
});

describe("a pause is not a word boundary", () => {
  /* GPT Sol's fix check, E1: a 400 ms gap alone put a space inside a year, a
     word and a decimal, and those strings were then stored. */
  it("joins a number, a word and a decimal that a pause fell inside", () => {
    for (const [a, b] of [
      [" 198", "7"],
      [" extra", "ordinarily"],
      [" 3.", "14"],
    ] as const) {
      const s = new Segmenter();
      feed(s, [fragment("companion", 1_000, a), fragment("companion", 1_600, b)]);
      expect(s.closing().exchanges[0]?.answer).toBe(`${a.trim()}${b}`);
    }
  });

  it("still parts a sentence from the one before it", () => {
    const s = new Segmenter();
    feed(s, [
      fragment("companion", 1_000, " Checking."),
      fragment("companion", 1_600, "He"),
      fragment("companion", 1_800, " says so."),
    ]);
    expect(s.closing().exchanges[0]?.answer).toBe("Checking. He says so.");
  });
});

describe("a typed question", () => {
  it("does not mark the answer before it as cut into, because typing interrupts nobody", () => {
    const s = new Segmenter();
    const during = feed(s, [
      ...say("reader", 1_000, "What is the main argument?"),
      ...say("companion", 4_000, "He says writing is thinking."),
      { type: "typed", eventId: "t1", text: "Where exactly does it say that, show me the passage" },
      ...say("companion", 9_000, "In the part that begins yes."),
    ]);
    const exchanges = [...during, ...s.closing().exchanges];
    expect(rows(exchanges)).toEqual([
      ["What is the main argument?", "He says writing is thinking."],
      ["Where exactly does it say that, show me the passage", "In the part that begins yes."],
    ]);
    expect(exchanges.map((x) => x.interrupted ?? false)).toEqual([false, false]);
  });
});

/**
 * **Sounds the transcript writes as words.** The peer's measurement of this
 * engine (docs/investigations/261002r-gpt-live-spike.md § What surprised us):
 * the output transcript carries `[hum]` and `[lip smack]`, and on the wire each
 * arrives **split across fragments** — " [hum" then "]", " [lip" then
 * " smack]" (evals/live/results/261002r-gpt-live-spike/events/). So no single
 * fragment can be recognised as one; the rule is over one speaker's stream.
 */
describe("sounds that are not words", () => {
  it("keeps the spike's two bracketed sounds out of the stored answer", () => {
    const s = new Segmenter();
    feed(s, [
      ...say("reader", 1_000, "Why does he think that?"),
      fragment("companion", 4_600, " Mm."),
      fragment("companion", 4_800, " [lip"),
      fragment("companion", 5_000, " smack]"),
      fragment("companion", 5_200, " The"),
      fragment("companion", 5_400, " answer"),
      fragment("companion", 6_200, " [hum"),
      fragment("companion", 6_400, "]"),
      fragment("companion", 6_600, " is here."),
    ]);
    expect(rows(s.closing().exchanges)).toEqual([["Why does he think that?", "Mm. The answer is here."]]);
  });

  it("never shows half of one on a line while the rest is on its way", () => {
    const s = new Segmenter();
    feed(s, [fragment("companion", 4_600, " Mm."), fragment("companion", 4_800, " [lip")]);
    expect(s.lines().map((l) => l.text)).toEqual(["Mm."]);
    feed(s, [fragment("companion", 5_000, " smack]")]);
    expect(s.lines().map((l) => l.text)).toEqual(["Mm."]);
  });

  it("does not let one open a segment: a call with nothing but a hum stores nothing", () => {
    const s = new Segmenter();
    feed(s, [fragment("companion", 1_000, " [hum"), fragment("companion", 1_200, "]"), fragment("reader", 3_000, "[cough]")]);
    expect(s.lines()).toEqual([]);
    expect(s.segments()).toEqual([]);
    expect(s.closing().exchanges).toEqual([]);
  });

  it("does not let one split the reader's sentence, as a whitespace-only fragment cannot", () => {
    const s = new Segmenter();
    feed(s, [
      ...say("reader", 1_000, "Why does he"),
      fragment("companion", 2_000, " [hum"),
      fragment("companion", 2_200, "]"),
      /* A long pause, with only a hum from the companion in it. */
      ...say("reader", 4_000, "think that?"),
    ]);
    expect(rows(s.closing().exchanges)).toEqual([["Why does he think that?", ""]]);
  });

  it("does not let one settle an exchange: a hum past the reader's last word is not the companion being heard", () => {
    const before = [
      ...say("reader", 1_000, "Why does he think that?"),
      ...say("companion", 2_400, "Because he says so."),
      ...say("reader", 8_000, "And where is that?"),
    ];
    const hummed = new Segmenter();
    expect(feed(hummed, [...before, fragment("companion", 11_000, " [hum"), fragment("companion", 11_200, "]")])).toEqual([]);
    /* The control: a word in the same place does settle it. */
    const spoke = new Segmenter();
    expect(rows(feed(spoke, [...before, fragment("companion", 11_000, " In")]))).toEqual([
      ["Why does he think that?", "Because he says so."],
    ]);
  });

  it("says whether a fragment was speech, so the hook's clocks do not run on a cough", () => {
    const s = new Segmenter();
    const f = (delta: string, at: number): TranscriptFragment => ({ role: "reader", eventId: `t${at}`, startMs: at, endMs: at + 200, delta });
    expect(s.take(f(" [cough", 1_000)).speech).toBe(false);
    expect(s.take(f("]", 1_200)).speech).toBe(false);
    expect(s.take(f(" ", 1_400)).speech).toBe(false);
    expect(s.take(f(" Hello", 1_600)).speech).toBe(true);
    /* A repeat is not speech either. */
    expect(s.take(f(" Hello", 1_600)).speech).toBe(false);
  });

  /* The other side of the rule. A bracket somebody's words really were written
     with is kept: the stored row promises no word is dropped. */
  it.each([
    ["a capital", "[Laughter] he says"],
    ["a number", "see [Smith 2019] for that"],
    ["punctuation", "he wrote [sic!] there"],
    ["more than three words", "[as he puts it himself] it holds"],
    ["a bracket glued to a word", "take x[i] here"],
    ["too long to be a sound", "[uncharacteristically longwinded] yes"],
  ])("keeps a bracket with %s", (_why, sentence) => {
    const s = new Segmenter();
    feed(s, [...say("reader", 1_000, "What then?"), ...say("companion", 2_400, sentence)]);
    expect(rows(s.closing().exchanges)).toEqual([["What then?", sentence]]);
  });

  it("keeps the order of the words when what looked like a sound turns out to be speech", () => {
    const s = new Segmenter();
    feed(s, [
      ...say("reader", 1_000, "What then?"),
      fragment("companion", 2_400, " He says [as"),
      fragment("companion", 2_600, " he"),
      fragment("companion", 2_800, " puts"),
      /* Held until here: a fourth word, so not a sound. Nothing was shown early, nothing is lost. */
      fragment("companion", 3_000, " it] that"),
      fragment("companion", 3_200, " it holds."),
    ]);
    expect(rows(s.closing().exchanges)).toEqual([["What then?", "He says [as he puts it] that it holds."]]);
  });

  it("drops a sound the call ended in the middle of", () => {
    const s = new Segmenter();
    feed(s, [...say("reader", 1_000, "What then?"), fragment("companion", 2_400, " Yes."), fragment("companion", 2_600, " [hum")]);
    expect(rows(s.closing().exchanges)).toEqual([["What then?", "Yes."]]);
  });
});
