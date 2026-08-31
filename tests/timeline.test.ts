/**
 * The deterministic half of the timeline stage — src/timeline.ts.
 *
 * Nothing here calls a model. The arithmetic is tested next door in
 * tests/timeline-time.test.ts; what is pinned here is everything either side of
 * the call, and three of those are things no other stage has to get right.
 *
 * 1. **The publication date is in the freshness stamp**, and no other stage's.
 *    It is the reference frame for nineteen of the twenty-four temporal
 *    expressions on the test article, so a publisher re-dating a post changes
 *    almost every row here — and the change is **invisible while the field is
 *    absent**, which is exactly the shape of bug that detonates months later on
 *    one article at a time. So it is asserted rather than assumed.
 *
 * 2. **Three outcomes, not two.** A date we could not read must not render as
 *    an article that never gave one. That distinction lives in `dateRejected`,
 *    and if it were ever collapsed the counters would still look perfect.
 *
 * 3. **Ids inherit on the evidence, not on the label.** Measured: across two
 *    real runs of this file on the test article, 26 of 27 ids carried over
 *    while only 7 of 26 labels were unchanged. Keying on the label — which is
 *    what src/ideas.ts does — would have broken nineteen of them.
 *
 * See docs/plans/timeline-mode.md and docs/project/testing.md.
 */
import { describe, expect, it } from "vitest";
import {
  buildTimeline,
  dateEvent,
  type Dropped,
  emptyDropped,
  evidenceKey,
  idsByEvidence,
  inheritIds,
  inputFingerprint,
  isStale,
  labelStatesAnUncitedDate,
  MAX_EVENTS,
  MAX_OCCURRENCES,
  PROMPT_VERSION,
  renderPrompt,
  type Timeline,
  type TimelineEvent,
  toEvents,
  validateOccurrences,
} from "../src/timeline.js";
import { articleWithIdsFingerprint } from "../src/source-hash.js";
import type { Block, Meta, Tree, TreeNode } from "../src/types.js";

function block(id: string, text: string): Block {
  return {
    id,
    tag: "p",
    kind: "text",
    text,
    words: text.split(/\s+/).length,
    html: `<p>${text}</p>`,
    gistable: true,
  };
}

/**
 * Two blocks lifted from the test article's shape rather than invented: the
 * first holds **two dates**, which is the case that broke the design the plan
 * started with, and four of that article's blocks are like it.
 */
const BLOCKS: Block[] = [
  block(
    "spya-aaaaaa",
    "By May 12, some agents had figured out how to talk. Two weeks later, on May 26, " +
      "the agents successfully exploited a vulnerability.",
  ),
  block("spya-bbbbbb", "Another month later, some AIs found an exploit of their own."),
  block("spya-cccccc", "During May, OpenAI was training a model that would go on to matter."),
];

function node(over: Partial<TreeNode> & { id: string }): TreeNode {
  return {
    depth: 1,
    parent: "n0",
    children: [],
    range: ["spya-aaaaaa", "spya-cccccc"],
    title: "A part",
    ...over,
  } as TreeNode;
}

function tree(): Tree {
  const part = node({ id: "n1", title: "All of it", gist: "A gist." });
  return {
    version: "toc/1",
    generator: "test",
    slug: "test",
    rootId: "n0",
    nodes: {
      n0: {
        id: "n0",
        depth: 0,
        parent: null,
        children: ["n1"],
        range: ["spya-aaaaaa", "spya-cccccc"],
        title: "The whole thing",
      },
      n1: part,
    },
  } as Tree;
}

const META = {
  title: "The Rise and Fall of Agent Civilizations",
  byline: "Dwarkesh Patel",
  siteName: "Dwarkesh Podcast",
  url: "https://example.com/a",
  publishedAt: "2026-08-29T22:47:53+00:00",
} as Meta;

const FRAME = "2026-08-29";

/** A well-formed event as the model returns one. */
function raw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    label: "Agents learn to talk",
    order: 1,
    modality: "happened",
    phrase: "By May 12",
    occurrences: [
      { blockId: "spya-aaaaaa", quote: "By May 12, some agents had figured out how to talk." },
    ],
    ...over,
  };
}

function build(events: unknown[], dropped: Dropped = emptyDropped()): Timeline {
  return buildTimeline(
    { events },
    { slug: "test", blocks: BLOCKS, sourceHash: "h", frame: FRAME, elapsedMs: 1, dropped },
  );
}

function event(over: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: "spya-000001",
    label: "A thing",
    when: null,
    dateRejected: false,
    order: 1,
    modality: "happened",
    occurrences: [{ blockId: "spya-aaaaaa", quote: "By May 12", start: 0 }],
    ...over,
  } as TimelineEvent;
}

describe("the freshness stamp carries the publication date", () => {
  it("moves when the publication date moves, and nothing else changed", () => {
    const before = inputFingerprint(BLOCKS, tree(), META);
    const after = inputFingerprint(BLOCKS, tree(), { ...META, publishedAt: "2026-08-30" } as Meta);
    expect(after).not.toBe(before);
  });

  it("is not the fingerprint the other id-citing stages use", () => {
    /* `ideas` and `sketch` send the same bytes and hash them with
       `articleWithIdsFingerprint`, which has no room for a date. Using theirs
       here would compile, produce a plausible hash, and be wrong only on the
       first article whose publisher re-dates it — months later, one article at
       a time, silently. */
    expect(inputFingerprint(BLOCKS, tree(), META)).not.toBe(
      articleWithIdsFingerprint(BLOCKS, tree(), META),
    );
  });

  it("treats an absent date as a real state rather than a missing one", () => {
    /* Almost every article on the shelf predates the field, so this is the
       common path and it must be stable: two reads of the same undated article
       have to agree, or the stage reports stale for ever while looking well. */
    /* The key removed, not set to `undefined`: `exactOptionalPropertyTypes` is
       on, and an article that predates the field has no key at all — which is
       the state this branch is about. */
    const { publishedAt: _parked, ...rest } = META;
    const undated = rest as Meta;
    expect(inputFingerprint(BLOCKS, tree(), undated)).toBe(
      inputFingerprint(BLOCKS, tree(), undated),
    );
    expect(inputFingerprint(BLOCKS, tree(), undated)).not.toBe(
      inputFingerprint(BLOCKS, tree(), META),
    );
  });

  it("reports a timeline written against a different date as stale", () => {
    const timeline = build([raw()]);
    const written = { ...timeline, sourceHash: inputFingerprint(BLOCKS, tree(), META) };
    expect(isStale(written, BLOCKS, tree(), META)).toBe(false);
    expect(isStale(written, BLOCKS, tree(), { ...META, publishedAt: "2026-01-01" } as Meta)).toBe(
      true,
    );
  });
});

describe("occurrences are believed only when the article backs them up", () => {
  it("drops a block id that is not in the article, and counts it", () => {
    const dropped = emptyDropped();
    const out = validateOccurrences(
      [{ blockId: "spya-zzzzzz", quote: "By May 12" }],
      BLOCKS,
      dropped,
    );
    expect(out).toEqual([]);
    expect(dropped.unknownIds).toBe(1);
  });

  it("drops a quote that is not in the block it names, and counts it", () => {
    const dropped = emptyDropped();
    const out = validateOccurrences(
      [{ blockId: "spya-bbbbbb", quote: "By May 12" }],
      BLOCKS,
      dropped,
    );
    expect(out).toEqual([]);
    expect(dropped.unquoted).toBe(1);
  });

  it("survives a null in the array rather than losing the whole event to it", () => {
    const dropped = emptyDropped();
    const out = validateOccurrences(
      [null, { blockId: "spya-aaaaaa", quote: "By May 12" }],
      BLOCKS,
      dropped,
    );
    expect(out).toHaveLength(1);
    expect(dropped.malformed).toBe(1);
  });

  it("caps the occurrences on one event", () => {
    const dropped = emptyDropped();
    const many = Array.from({ length: MAX_OCCURRENCES + 2 }, () => ({
      blockId: "spya-aaaaaa",
      quote: "By May 12",
    }));
    expect(validateOccurrences(many, BLOCKS, dropped)).toHaveLength(MAX_OCCURRENCES);
    expect(dropped.truncated).toBe(2);
  });
});

describe("three outcomes, not two", () => {
  const occurrence = (quote: string, blockId = "spya-aaaaaa") =>
    validateOccurrences([{ blockId, quote }], BLOCKS, emptyDropped());

  it("dates an event from the block's own characters", () => {
    const dropped = emptyDropped();
    const out = dateEvent(
      "By May 12",
      occurrence("By May 12, some agents had figured out how to talk."),
      FRAME,
      "happened",
      dropped,
    );
    expect(out.when?.latest).toBe("2026-05-12");
    /* The bound survives. "by" is at-or-before, and a stage that flattened it
       to a point would be claiming a day the article never claimed — five of
       the twenty-four expressions on the test article are this shape. */
    expect(out.when?.earliest).toBeNull();
    expect(out.dateRejected).toBe(false);
  });

  it("shows the article's words, and draws no rejection, when they carry no date", () => {
    const dropped = emptyDropped();
    const out = dateEvent(
      "Another month later",
      occurrence("Another month later, some AIs found an exploit", "spya-bbbbbb"),
      FRAME,
      "happened",
      dropped,
    );
    expect(out.when).toBeNull();
    /* Not a ⊘. The article declined to date this, and a row accusing it of a
       date we could not read would be accusing it of something it never did. */
    expect(out.dateRejected).toBe(false);
    expect(out.phrase).toBe("Another month later");
    expect(dropped.noDateInPhrase).toBe(1);
  });

  it("shows the BLOCK's characters, not the model's copy of them", () => {
    /* The model tidies, lowercases and re-spaces as any reader would, and the
       words go in the date column where a date would otherwise be. So what is
       shown is sliced out of the block at the offsets `findQuote` located —
       which is what makes "everything the reader sees came out of the article"
       true of this field rather than merely likely. */
    const dropped = emptyDropped();
    const out = dateEvent(
      "another   month  LATER",
      occurrence("Another month later, some AIs found an exploit", "spya-bbbbbb"),
      FRAME,
      "happened",
      dropped,
    );
    expect(out.phrase).toBe("Another month later");
  });

  it("shows nothing at all when the words are not in the quoted passage", () => {
    /* GPT Sol's case, 2026-08-31: `scanDates` has no pattern for "06/12/19", so
       the parser calls it `noDateInPhrase` — it carries no date it can read —
       and every human reader calls it a date. The old code displayed the
       model's string on the strength of that refusal. Now the words have to be
       IN the article to be shown, so this one is simply withheld. */
    const dropped = emptyDropped();
    const out = dateEvent(
      "06/12/19",
      occurrence("Another month later, some AIs found an exploit", "spya-bbbbbb"),
      FRAME,
      "happened",
      dropped,
    );
    expect(out.phrase).toBeUndefined();
    expect(out.dateRejected).toBe(false);
    expect(dropped.phraseNotFound).toBe(1);
  });

  it("rejects visibly when the date is not in the quoted passage", () => {
    const dropped = emptyDropped();
    const out = dateEvent(
      "By May 12",
      occurrence("Another month later, some AIs found an exploit", "spya-bbbbbb"),
      FRAME,
      "happened",
      dropped,
    );
    expect(out.when).toBeNull();
    expect(out.dateRejected).toBe(true);
    /* And the model's words do NOT travel to the reader on a rejection. This is
       the one route a fabricated date could take into the panel, and it is shut
       structurally: `phrase` is set only when the parser proved the words carry
       no date at all. */
    expect(out.phrase).toBeUndefined();
    expect(dropped.phraseNotInOccurrence).toBe(1);
  });

  it("refuses to guess a year when there is no publication date", () => {
    const dropped = emptyDropped();
    const out = dateEvent(
      "By May 12",
      occurrence("By May 12, some agents had figured out how to talk."),
      null,
      "happened",
      dropped,
    );
    expect(out.when).toBeNull();
    expect(out.dateRejected).toBe(true);
    expect(dropped.noYearFrame).toBe(1);
    /* And the row still says what the article said. This is the COMMON path —
       `publishedAt` arrives only by re-extraction, so almost every article on
       the shelf has no frame — and a ⊘ with no words beside it would leave the
       reader nothing to check. */
    expect(out.phrase).toBe("By May 12");
  });

  it("gives no phrase at all when the model gave none, and counts nothing", () => {
    const dropped = emptyDropped();
    const out = dateEvent("", occurrence("By May 12"), FRAME, "happened", dropped);
    expect(out).toEqual({ when: null, dateRejected: false });
    expect(dropped).toEqual(emptyDropped());
  });

  it("reads a prediction's year forwards rather than backwards", () => {
    /* The one case where the default is wrong: a piece published in August
       saying "in December we expect…" means the coming December, not last
       one. The direction hint is the whole reason `modality` reaches the
       parser. */
    const blocks = [block("spya-dddddd", "We expect the next wave in December.")];
    const dropped = emptyDropped();
    const occ = validateOccurrences(
      [{ blockId: "spya-dddddd", quote: "We expect the next wave in December." }],
      blocks,
      dropped,
    );
    expect(dateEvent("in December", occ, FRAME, "predicted", dropped).when?.earliest).toBe(
      "2026-12-01",
    );
    expect(dateEvent("in December", occ, FRAME, "happened", dropped).when?.earliest).toBe(
      "2025-12-01",
    );
  });
});

describe("a date in the label is a date too", () => {
  const occurrence = (quote: string, blockId = "spya-aaaaaa") =>
    validateOccurrences([{ blockId, quote }], BLOCKS, emptyDropped());

  it("drops an event whose label states a date the passage does not carry", () => {
    /* The third way in, and the one that would have looked most like the
       article's own words: `label` is prose, the panel prints it beside the
       date column, and until GPT Sol's review nothing read it. */
    const dropped = emptyDropped();
    const out = toEvents(
      [raw({ label: "4 July: the package manager crashes" })],
      BLOCKS,
      FRAME,
      new Set(),
      dropped,
    );
    expect(out).toEqual([]);
    expect(dropped.datedLabel).toBe(1);
  });

  it("keeps a label whose date the passage does carry", () => {
    /* Redundant with the date column, and true. Dropping it would be punishing
       the model for agreeing with the article. */
    expect(
      labelStatesAnUncitedDate(
        "May 12: agents learn to talk",
        occurrence("By May 12, some agents had figured out how to talk."),
        FRAME,
      ),
    ).toBe(false);
  });

  it("keeps an ordinary label, which is every label", () => {
    expect(
      labelStatesAnUncitedDate(
        "Agents learn to talk",
        occurrence("By May 12, some agents had figured out how to talk."),
        FRAME,
      ),
    ).toBe(false);
  });

  it("does not punish a label for the year we could not fill in", () => {
    /* With no publication date the passage's own "May 12" cannot be resolved —
       but it IS the passage's, which is the only question being asked here.
       Treating `noYearFrame` as an offence would have dropped good events on
       every article that has no publication date, which is most of them. */
    expect(
      labelStatesAnUncitedDate(
        "May 12: agents learn to talk",
        occurrence("By May 12, some agents had figured out how to talk."),
        null,
      ),
    ).toBe(false);
  });
});

describe("what the model says, believed as little as possible", () => {
  it("drops an event with no label and one with an unusable modality", () => {
    const dropped = emptyDropped();
    const out = toEvents(
      [raw({ label: "" }), raw({ modality: "maybe" }), raw()],
      BLOCKS,
      FRAME,
      new Set(),
      dropped,
    );
    expect(out).toHaveLength(1);
    expect(dropped.malformed).toBe(2);
  });

  it("drops an event that lost every occurrence", () => {
    const dropped = emptyDropped();
    const out = toEvents(
      [raw({ occurrences: [{ blockId: "spya-zzzzzz", quote: "nope" }] })],
      BLOCKS,
      FRAME,
      new Set(),
      dropped,
    );
    expect(out).toEqual([]);
    expect(dropped.unanchored).toBe(1);
  });

  it("keeps an event whose order is unusable, and does not read it as first", () => {
    const dropped = emptyDropped();
    const out = toEvents([raw({ order: "third" })], BLOCKS, FRAME, new Set(), dropped);
    expect(out).toHaveLength(1);
    /* `Number("third")` is NaN and `Number("")` is 0 — and a missing order read
       as 0 would sort the row the model could not place to the very top.
       `null` rather than NaN because that is what survives the write: JSON has
       no NaN, so a field typed `number` would have been a lie on disk. */
    expect(out[0]?.order).toBeNull();
    expect(JSON.parse(JSON.stringify(out[0])).order).toBeNull();
    expect(dropped.unordered).toBe(1);
  });

  it("enforces the cap here rather than merely asking for it in the prompt", () => {
    const dropped = emptyDropped();
    const many = Array.from({ length: MAX_EVENTS + 3 }, (_, i) => raw({ order: i }));
    const out = toEvents(many, BLOCKS, FRAME, new Set(), dropped);
    expect(out).toHaveLength(MAX_EVENTS);
    expect(dropped.overCap).toBe(3);
  });

  it("keeps the parser's working out of the artefact", () => {
    const out = toEvents([raw()], BLOCKS, FRAME, new Set(), emptyDropped());
    /* The block's text is handed to the parser and must not be written down: an
       artefact carrying a copy of the article is a second copy nothing keeps in
       step. */
    expect(Object.keys(out[0]?.occurrences[0] ?? {})).toEqual(["blockId", "quote", "start"]);
  });
});

describe("ids inherit on the evidence, never on the label", () => {
  it("carries an id across a run that paraphrased the label", () => {
    const before = event({ id: "spya-old001", label: "Message volume crashes package manager" });
    const after = event({ id: "spya-new001", label: "Agents crash the package manager" });
    expect(inheritIds([after], idsByEvidence({ events: [before] } as Timeline))[0]?.id).toBe(
      "spya-old001",
    );
  });

  it("does not carry an id when the date moved", () => {
    const before = event({ id: "spya-old001" });
    const after = event({
      id: "spya-new001",
      when: {
        earliest: null,
        latest: "2026-05-12",
        extent: "instant",
        phrase: "By May 12",
        at: { blockId: "spya-aaaaaa", start: 0, end: 9 },
        yearFilled: true,
      },
    });
    expect(inheritIds([after], idsByEvidence({ events: [before] } as Timeline))[0]?.id).toBe(
      "spya-new001",
    );
  });

  it("mints rather than guessing when two old events shared the evidence", () => {
    /* The test article has blocks holding two events each, so this is the
       ordinary case. An id handed to the wrong one of them is a dead end that
       looks like it worked, which is worse than a dead end the reader can see. */
    const inherit = idsByEvidence({
      events: [event({ id: "spya-old001" }), event({ id: "spya-old002" })],
    } as Timeline);
    expect(inherit.size).toBe(0);
    expect(inheritIds([event({ id: "spya-new001" })], inherit)[0]?.id).toBe("spya-new001");
  });

  it("mints rather than guessing when two fresh events share the evidence", () => {
    const inherit = idsByEvidence({ events: [event({ id: "spya-old001" })] } as Timeline);
    const out = inheritIds([event({ id: "spya-new001" }), event({ id: "spya-new002" })], inherit);
    expect(out.map((e) => e.id)).toEqual(["spya-new001", "spya-new002"]);
  });

  it("keys on the cited block set and the date, and on nothing else", () => {
    expect(evidenceKey(event({ label: "one" }))).toBe(evidenceKey(event({ label: "two" })));
  });
});

describe("the artefact", () => {
  it("writes an empty timeline when the article tells no story in time", () => {
    /* The one stage where zero is a real answer. `buildIdeas` throws on an
       empty list because every article has ideas; most articles are not
       chronological, and "this piece has no chronology" is what the reader
       asked. */
    const timeline = build([]);
    expect(timeline.events).toEqual([]);
    expect(timeline.version).toBe(PROMPT_VERSION);
  });

  it("throws when the model named events and every one was thrown away", () => {
    /* A failure wearing the empty case's clothes. Writing it would make the
       step report done for ever after. */
    expect(() => build([raw({ occurrences: [{ blockId: "spya-zzzzzz", quote: "x" }] })])).toThrow(
      /named 1 events and none of them could be anchored/,
    );
  });

  it("sorts by modality partition and then the model's order, never by date", () => {
    const timeline = build([
      raw({ label: "a prediction", order: 1, modality: "predicted", phrase: null }),
      raw({ label: "later", order: 3, phrase: null }),
      raw({ label: "earlier", order: 2, phrase: null }),
    ]);
    expect(timeline.events.map((e) => e.label)).toEqual(["earlier", "later", "a prediction"]);
  });

  it("counts two events that share an order, which nothing else can see", () => {
    /* A model that numbers every event 1 has stopped doing the judgement the
       whole sort rests on, and the panel would then quietly show the order the
       events happened to arrive in. `countOrderConflicts` is structurally blind
       to it: a tie proves nothing, so it never fires. GPT Sol, 2026-08-31. */
    const dropped = emptyDropped();
    build(
      [
        raw({ label: "one", order: 1, phrase: null }),
        raw({ label: "two", order: 1, phrase: null }),
        raw({ label: "three", order: 1, phrase: null }),
      ],
      dropped,
    );
    expect(dropped.duplicateOrders).toBe(2);
    expect(dropped.orderConflicts).toBe(0);
  });

  it("does not read two unnumbered events as sharing an order", () => {
    const dropped = emptyDropped();
    build([raw({ order: null, phrase: null }), raw({ order: null, phrase: null })], dropped);
    expect(dropped.unordered).toBe(2);
    expect(dropped.duplicateOrders).toBe(0);
  });

  it("counts an order conflict the article's own dates prove", () => {
    const dropped = emptyDropped();
    const timeline = build(
      [
        raw({ label: "the later one first", order: 1, phrase: "on May 26" }),
        raw({ label: "the earlier one second", order: 2, phrase: "By May 12" }),
      ],
      dropped,
    );
    /* "By May 12" is an upper bound and proves nothing against a point on the
       26th — an open interval can never prove an order, which is the case that
       stopped the counter being vacuous on the test article. */
    expect(timeline.orderConflicts).toBe(0);
    expect(dropped.orderConflicts).toBe(0);
  });
});

describe("the answer's shape is read before anything in it", () => {
  for (const [name, answer] of [
    ["an object where the array should be", { events: {} }],
    ["an explicit null", { events: null }],
    ["no events key at all", {}],
  ] as const) {
    it(`throws on ${name} rather than writing an empty timeline`, () => {
      /* All three used to come back as `[]` and be written as a perfectly
         ordinary "this article has no chronology", with every counter at zero.
         The empty case being legitimate here is what hid it — this is the only
         stage where zero events is a real answer, so it is the only stage where
         a failed answer can wear the empty one's clothes. */
      expect(() =>
        buildTimeline(answer, {
          slug: "test",
          blocks: BLOCKS,
          sourceHash: "h",
          frame: FRAME,
          elapsedMs: 1,
          dropped: emptyDropped(),
        }),
      ).toThrow(/no `events` array/);
    });
  }
});

describe("the prompt", () => {
  it("names the publication date as the reference frame when there is one", () => {
    expect(renderPrompt({ tree: tree(), frame: FRAME })).toContain(FRAME);
  });

  it("says so plainly when there is not, rather than leaving the model to guess", () => {
    const prompt = renderPrompt({ tree: tree(), frame: null });
    expect(prompt).toContain("do not know when this article was published");
    /* The common path on this shelf: `publishedAt` arrives only by
       re-extraction, so almost every article takes this branch. */
    expect(prompt).not.toContain("undefined");
  });

  it("puts the reference frame ahead of the article's shape", () => {
    /* Ordering, not presence: `toContain` on each would stay green whatever
       order they came in, and the frame is the thing the model has to read
       before it judges anything else. (The article itself is ahead of both, in
       the system block — see `generateTimeline`.) */
    const prompt = renderPrompt({ tree: tree(), frame: FRAME });
    expect(prompt.indexOf(FRAME)).toBeGreaterThan(-1);
    expect(prompt.indexOf(FRAME)).toBeLessThan(prompt.indexOf("All of it"));
  });
});
