/**
 * **Mirror's deterministic half** — what goes into the prompt, and what is
 * allowed back out of it.
 *
 * Nothing here calls a model. Whether the prompt *works* is a judgement about
 * tone and abstention that only a person reading a transcript can make, and
 * that is `evals/referee-mirror.ts`. What these tests hold is the half that can
 * be wrong silently: a remark about a comment nobody wrote, a "possible
 * misunderstanding" whose quoted passage is not in the passage, a broken reply
 * becoming the friendly empty list.
 *
 * The last of those is the one to keep in mind while editing any of this.
 * `{"remarks": []}` is Mirror's **best** answer — most sets of comments deserve
 * no remark — so every failure shaped like an empty list looks exactly like
 * success. docs/reusable/silent-success.md.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_COMMENTS,
  MAX_REMARKS,
  buildMirrorMessages,
  coverageAskable,
  mirrorInput,
  validateRemarks,
} from "../src/referee-mirror.js";
import type { MirrorComment, MirrorCriterion } from "../src/referee-mirror.js";
import type { Block, BlockId, Comment } from "../src/types.js";

const block = (id: string, text: string): Block => ({
  id: id as BlockId,
  tag: "p",
  kind: "text",
  text,
  words: text.split(/\s+/).length,
  html: `<p>${text}</p>`,
  gistable: true,
});

const METHODS = "Participants were randomised by a computer-generated sequence held off site.";
const RESULTS = "The effect was 0.3 points and did not reach significance in the primary analysis.";

const blocks: Block[] = [block("spya-aaaaaa", METHODS), block("spya-bbbbbb", RESULTS)];

const A_BODY = "This does not say who held the sequence.";

/**
 * **`body: undefined` means "leave the key out", and only the factories may say
 * so.**
 *
 * `Comment.body` is absent or a string — never a present `undefined` — because
 * the route trims once and drops an empty string, so "they wrote nothing" has
 * one representation across both stores (src/types.ts § `Comment.body`). With
 * `exactOptionalPropertyTypes` on, that is a distinction the compiler enforces,
 * and passing `{ body: undefined }` straight through a spread would have
 * produced a comment shape the stores cannot produce.
 *
 * Two directions were available. Widening `Comment`, `MirrorComment` or
 * `mirrorInput`'s parameter to accept a present `undefined` would model a state
 * that does not exist, in the production types, to make a test read nicely —
 * exactly backwards. So the conversion happens here instead: a **call site**
 * says `body: undefined`, which is the readable way to write "this one is a
 * bookmark", and the factory turns that request into an omitted key. One place,
 * and the bodyless cases are the ones this file exists for.
 *
 * `"body" in over` is what tells "omit it" apart from "did not mention it", and
 * they are genuinely different: `comment()` has the default body.
 */
type CommentOver = Omit<Partial<Comment>, "body"> & { body?: string | undefined };

let counter = 0;
const comment = (over: CommentOver = {}): Comment => {
  counter += 1;
  const { body: given, ...rest } = over;
  const body = "body" in over ? given : A_BODY;
  return {
    id: `spya-c${String(counter).padStart(5, "0")}`,
    blockId: "spya-aaaaaa" as BlockId,
    quote: "randomised",
    start: METHODS.indexOf("randomised"),
    createdAt: "2026-08-31T00:00:00.000Z",
    status: "none",
    ...(body === undefined ? {} : { body }),
    ...rest,
  };
};

const CRITERIA: MirrorCriterion[] = [
  { id: "spya-crit01", text: "are the controls adequate?" },
];

/**
 * A gathered comment, for the validator tests, which do not run the gatherer.
 *
 * Same `body: undefined` ⇒ omitted-key rule as `comment` above, and for the
 * same reason: `MirrorComment.body` is absent on a placement-only comment, and
 * `validateRemarks` reads `about.body !== undefined` to decide whether a
 * `placement` remark is allowed. A present `undefined` would make that check
 * pass on a comment the referee had explained.
 */
type GatheredOver = Omit<Partial<MirrorComment>, "body"> & { body?: string | undefined };

const gathered = (over: GatheredOver = {}): MirrorComment => {
  const { body: given, ...rest } = over;
  const body = "body" in over ? given : A_BODY;
  return {
    id: "spya-c00001",
    blockId: "spya-aaaaaa",
    quote: "randomised",
    passage: METHODS,
    ...(body === undefined ? {} : { body }),
    ...rest,
  };
};

describe("what goes in", () => {
  it("skips a comment with no body — a bookmark has no sentence to critique", () => {
    const bookmark = comment({ body: undefined });
    const written = comment();
    /* The factory's own contract, checked rather than assumed: `body:
       undefined` above has to produce a comment with the key ABSENT. The two
       are the same at runtime here and different to the compiler, and it is the
       compiler that stops a present `undefined` reaching `validateRemarks`,
       where `about.body !== undefined` decides whether a placement remark is
       allowed. See `CommentOver`. */
    expect("body" in bookmark).toBe(false);
    expect("body" in written).toBe(true);
    const input = mirrorInput([bookmark, written], blocks);
    expect(input.comments.map((c) => c.id)).toEqual([written.id]);
    expect(input.skippedBookmarks).toBe(1);
  });

  it("treats a body of nothing but whitespace as a bookmark", () => {
    /* The route trims once and stores `undefined` rather than `""`, so this
       should not arrive — but a store that predates that rule, or a second one
       that forgets it, would send a comment the model could only respond to by
       remarking on the passage, which is the one thing this mode does not do. */
    const input = mirrorInput([comment({ body: "   \n  " })], blocks);
    expect(input.comments).toEqual([]);
    expect(input.skippedBookmarks).toBe(1);
  });

  it("attaches the text of the block the comment is anchored to", () => {
    const input = mirrorInput([comment()], blocks);
    expect(input.comments[0]?.passage).toBe(METHODS);
    expect(input.comments[0]?.blockId).toBe("spya-aaaaaa");
    expect(input.comments[0]?.quote).toBe("randomised");
  });

  it("skips a comment whose block this revision no longer has, and counts it", () => {
    const orphan = comment({ blockId: "spya-zzzzzz" as BlockId });
    const input = mirrorInput([orphan, comment()], blocks);
    expect(input.comments).toHaveLength(1);
    expect(input.skippedOrphans).toBe(1);
  });

  it("puts the comments in document order, not the order they were made", () => {
    /* The referee meets their own comments in this order when they read the
       paper. A list in any other order is one they cannot walk down the page
       with. */
    const late = comment({ blockId: "spya-bbbbbb" as BlockId, start: 4 });
    const earlyInSecondBlock = comment({ blockId: "spya-bbbbbb" as BlockId, start: 0 });
    const first = comment({ blockId: "spya-aaaaaa" as BlockId, start: 12 });
    const input = mirrorInput([late, earlyInSecondBlock, first], blocks);
    expect(input.comments.map((c) => c.id)).toEqual([
      first.id,
      earlyInSecondBlock.id,
      late.id,
    ]);
  });

  it("caps the list and says how many it left behind", () => {
    const many = Array.from({ length: MAX_COMMENTS + 3 }, (_, i) => comment({ start: i }));
    const input = mirrorInput(many, blocks);
    expect(input.comments).toHaveLength(MAX_COMMENTS);
    expect(input.truncated).toBe(3);
  });

  /* The one exception to "a comment with no body is skipped", and the reason it
     exists: a placement with nothing under it IS the referee's claim, made in a
     number instead of a sentence. */
  it("keeps a bodyless comment that carries a placement", () => {
    const placed = { ...comment({ body: undefined }), valence: -80, criterionId: "spya-crit01" };
    const input = mirrorInput([placed], blocks, CRITERIA);
    expect(input.comments).toHaveLength(1);
    expect(input.skippedBookmarks).toBe(0);
    expect(input.comments[0]?.valence).toBe(-80);
    expect(input.comments[0]?.body).toBeUndefined();
  });

  it("resolves the criterion a placement was made on, when the list can name it", () => {
    const placed = { ...comment({ body: undefined }), valence: 40, criterionId: "spya-crit01" };
    const input = mirrorInput([placed], blocks, CRITERIA);
    expect(input.comments[0]?.criterion).toBe("are the controls adequate?");
  });

  it("carries the placement through on a comment that also has a body", () => {
    const both = { ...comment(), valence: -20, criterionId: "spya-crit01" };
    const input = mirrorInput([both], blocks, CRITERIA);
    expect(input.comments[0]?.valence).toBe(-20);
    expect(input.comments[0]?.body).toBe(A_BODY);
  });

  it("ignores a valence outside the scale, and counts it as the unit alarm", () => {
    /* A referee's -100…+100 arriving as 0-100, or as a fraction, is the drift
       `Dropped.subOne` exists for in search.ts. Ignored rather than rescaled,
       because a confident wrong guess rewrites their own judgement. */
    const wrong = { ...comment({ body: undefined }), valence: 640 };
    const input = mirrorInput([wrong], blocks, CRITERIA);
    expect(input.comments).toEqual([]);
    expect(input.badValence).toBe(1);
    expect(input.skippedBookmarks).toBe(1);
  });

  it("leaves a comment with a null placement alone — that is an ordinary note", () => {
    const plain = { ...comment(), valence: null, criterionId: null };
    const input = mirrorInput([plain], blocks, CRITERIA);
    expect(input.badValence).toBe(0);
    expect(input.comments[0]?.valence).toBeUndefined();
  });
});

describe("coverage is only asked about when it can be answered", () => {
  const whole = {
    comments: [gathered()],
    skippedBookmarks: 0,
    skippedOrphans: 0,
    badValence: 0,
    truncated: 0,
  };

  it("is asked when there are criteria and nothing was cut", () => {
    expect(coverageAskable(CRITERIA, whole)).toBe(true);
  });

  it("is not asked when there are no criteria", () => {
    expect(coverageAskable([], whole)).toBe(false);
  });

  it("is not asked once the comment list has been truncated", () => {
    /* The claim is "nothing you have written bears on this", which is about the
       whole set. Over a cut set it would be a confident finding about comments
       the model never saw. */
    expect(coverageAskable(CRITERIA, { ...whole, truncated: 1 })).toBe(false);
  });
});

describe("the prompt", () => {
  it("carries no byline, publication or address — there is no article in it at all", () => {
    /* Rule 4 of the plan: referee-facing calls are identity-stripped, because
       the same paper is rated higher when it carries a famous author. Mirror
       gets that by construction rather than by an option — it is never given
       the piece, only the passages the referee marked. */
    const messages = buildMirrorMessages([gathered()], []);
    const sent = JSON.stringify(messages);
    expect(sent).not.toContain("BY:");
    expect(sent).not.toContain("PUBLISHED IN:");
    expect(sent).not.toContain("URL:");
    expect(sent).not.toContain("TITLE:");
  });

  it("names the comment id, the referee's words and the passage", () => {
    const messages = buildMirrorMessages([gathered()], []);
    const user = String(messages[1]?.content);
    expect(user).toContain("spya-c00001");
    expect(user).toContain("This does not say who held the sequence.");
    expect(user).toContain(METHODS);
  });

  it("says the placement in words as well as in a number", () => {
    /* A bare "-80" in a list of comments reads as a score the model is being
       asked to agree with. It is the referee's, and the sentence says so. */
    const user = String(
      buildMirrorMessages(
        [
          gathered({
            body: undefined,
            valence: -80,
            criterion: "are the controls adequate?",
          }),
        ],
        CRITERIA,
      )[1]?.content,
    );
    expect(user).toContain("-80");
    expect(user).toContain("counts against");
    expect(user).toContain("are the controls adequate?");
    expect(user).toContain("wrote nothing under it");
  });

  it("says nothing about criteria when there are none", () => {
    const user = String(buildMirrorMessages([gathered()], [])[1]?.content);
    expect(user).not.toContain("CRITERIA");
  });

  it("lists the criteria when there are some", () => {
    const user = String(buildMirrorMessages([gathered()], CRITERIA)[1]?.content);
    expect(user).toContain("are the controls adequate?");
  });
});

describe("what is allowed back out", () => {
  const input = [gathered(), gathered({ id: "spya-c00002", blockId: "spya-bbbbbb", passage: RESULTS })];

  it("accepts an empty list — nothing worth raising is a real answer", () => {
    const { remarks, dropped } = validateRemarks({ remarks: [] }, input, []);
    expect(remarks).toEqual([]);
    expect(dropped.unknownComment).toBe(0);
  });

  it("refuses a reply with no remarks array rather than reading it as an empty one", () => {
    /* The whole reason this validator is careful. `[]` is the good answer, so a
       broken reply quietly becoming one would be stored as "your comments are
       fine" and nothing would ever say otherwise. */
    for (const raw of [{}, { remarks: null }, { remarks: "none" }, [], null]) {
      expect(() => validateRemarks(raw, input, [])).toThrow(/could not read/i);
    }
  });

  it("drops a remark that names no comment", () => {
    const { remarks, dropped } = validateRemarks(
      { remarks: [{ kind: "specificity", note: "This is vague." }] },
      input,
      [],
    );
    expect(remarks).toEqual([]);
    expect(dropped.unknownComment).toBe(1);
  });

  it("drops a remark naming a comment that was never sent", () => {
    const { remarks, dropped } = validateRemarks(
      { remarks: [{ kind: "tone", comment: "spya-nobody", note: "Reads as contempt." }] },
      input,
      [],
    );
    expect(remarks).toEqual([]);
    expect(dropped.unknownComment).toBe(1);
  });

  it("drops a possible misunderstanding with no quoted passage", () => {
    /* The only checkable kind, and it is checkable only because of this. A
       misunderstanding the referee cannot verify in a glance is an assertion. */
    const { remarks, dropped } = validateRemarks(
      {
        remarks: [
          { kind: "misunderstanding", comment: "spya-c00001", note: "The passage says otherwise." },
        ],
      },
      input,
      [],
    );
    expect(remarks).toEqual([]);
    expect(dropped.unquoted).toBe(1);
  });

  it("drops a possible misunderstanding whose quote is a paraphrase", () => {
    const { remarks, dropped } = validateRemarks(
      {
        remarks: [
          {
            kind: "misunderstanding",
            comment: "spya-c00001",
            passage: "participants were randomly assigned by computer",
            note: "The passage says otherwise.",
          },
        ],
      },
      input,
      [],
    );
    expect(remarks).toEqual([]);
    expect(dropped.unquoted).toBe(1);
  });

  it("drops a quote that is verbatim from the WRONG comment's block", () => {
    /* A quote is checked against the block the named comment is anchored to,
       not against the article. Otherwise a remark could point at one paragraph
       and quote another, which reads as a contradiction and is not one. */
    const { remarks, dropped } = validateRemarks(
      {
        remarks: [
          {
            kind: "misunderstanding",
            comment: "spya-c00001",
            passage: "did not reach significance",
            note: "The passage says otherwise.",
          },
        ],
      },
      input,
      [],
    );
    expect(remarks).toEqual([]);
    expect(dropped.unquoted).toBe(1);
  });

  it("keeps a verbatim quote, stored as the block spells it rather than as the model retyped it", () => {
    const { remarks } = validateRemarks(
      {
        remarks: [
          {
            kind: "misunderstanding",
            comment: "spya-c00001",
            /* Curly apostrophes and slack whitespace are what `findQuote`
               forgives; what gets stored is the block's own characters, so the
               client can definitely mark them. */
            passage: "a  computer-generated   sequence",
            note: "This comment says the sequence was hand-drawn.",
          },
        ],
      },
      input,
      [],
    );
    const first = remarks[0];
    if (first?.kind !== "misunderstanding") throw new Error("expected a misunderstanding");
    expect(first.passage).toBe("a computer-generated sequence");
    expect(METHODS).toContain(first.passage);
    expect(first.blockId).toBe("spya-aaaaaa");
  });

  it("marks the three kinds the trial tested, and the two it did not", () => {
    const { remarks } = validateRemarks(
      {
        remarks: [
          { kind: "specificity", comment: "spya-c00001", note: "Nothing to act on here." },
          { kind: "tone", comment: "spya-c00002", note: "This would land as contempt." },
          { kind: "coverage", criterion: "are the controls adequate?", note: "Nothing bears on this." },
        ],
      },
      input,
      CRITERIA,
    );
    expect(remarks.map((r) => [r.kind, r.trialTested])).toEqual([
      ["specificity", true],
      ["tone", true],
      ["coverage", false],
    ]);
  });

  it("marks a placement as untested — certain, but no trial ran on this shape", () => {
    const placed = [gathered({ id: "spya-c00009", body: undefined, valence: -80 })];
    const { remarks } = validateRemarks(
      { remarks: [{ kind: "placement", comment: "spya-c00009", note: "Nothing here says why." }] },
      placed,
      [],
    );
    expect(remarks.map((r) => [r.kind, r.trialTested])).toEqual([["placement", false]]);
  });

  it("drops a coverage remark about a criterion nobody asked about", () => {
    const { remarks, dropped } = validateRemarks(
      { remarks: [{ kind: "coverage", criterion: "is it novel?", note: "Nothing bears on this." }] },
      input,
      CRITERIA,
    );
    expect(remarks).toEqual([]);
    expect(dropped.unknownCriterion).toBe(1);
  });

  it("drops every coverage remark when no criteria were sent", () => {
    const { remarks, dropped } = validateRemarks(
      {
        remarks: [
          { kind: "coverage", criterion: "are the controls adequate?", note: "Nothing bears on this." },
        ],
      },
      input,
      [],
    );
    expect(remarks).toEqual([]);
    expect(dropped.unknownCriterion).toBe(1);
  });

  it("drops an unknown kind rather than guessing at it", () => {
    const { remarks, dropped } = validateRemarks(
      { remarks: [{ kind: "praise", comment: "spya-c00001", note: "Good comment." }] },
      input,
      [],
    );
    expect(remarks).toEqual([]);
    expect(dropped.unknownKind).toBe(1);
  });

  it("drops a remark with an empty note", () => {
    const { remarks } = validateRemarks(
      { remarks: [{ kind: "tone", comment: "spya-c00001", note: "  " }] },
      input,
      [],
    );
    expect(remarks).toEqual([]);
  });

  it("keeps one remark per comment and drops the pile-on", () => {
    const { remarks, dropped } = validateRemarks(
      {
        remarks: [
          { kind: "specificity", comment: "spya-c00001", note: "Nothing to act on." },
          { kind: "tone", comment: "spya-c00001", note: "And it is rude." },
        ],
      },
      input,
      [],
    );
    expect(remarks).toHaveLength(1);
    expect(dropped.duplicate).toBe(1);
  });

  it("drops a placement remark about a comment that has no placement", () => {
    const { remarks, dropped } = validateRemarks(
      { remarks: [{ kind: "placement", comment: "spya-c00001", note: "Nothing here says why." }] },
      input,
      [],
    );
    expect(remarks).toEqual([]);
    expect(dropped.notAPlacement).toBe(1);
  });

  it("drops a placement remark about a comment the referee did explain", () => {
    /* Not a near miss: the referee wrote their reason down, and a remark saying
       they did not is their own notes contradicted back at them. */
    const explained = [gathered({ id: "spya-c00009", valence: -80 })];
    const { remarks, dropped } = validateRemarks(
      { remarks: [{ kind: "placement", comment: "spya-c00009", note: "Nothing here says why." }] },
      explained,
      [],
    );
    expect(remarks).toEqual([]);
    expect(dropped.notAPlacement).toBe(1);
  });

  it("keeps a placement remark, with the referee's own words and number on it", () => {
    const placed = [
      gathered({
        id: "spya-c00009",
        body: undefined,
        valence: -80,
        criterion: "are the controls adequate?",
      }),
    ];
    const { remarks } = validateRemarks(
      {
        remarks: [
          {
            kind: "placement",
            comment: "spya-c00009",
            /* The model's own retyping of both, which is ignored: a placement
               has nothing for it to choose, so both come from the comment. */
            passage: "some words it made up",
            valence: 12,
            note: "You have placed this at -80 and written nothing saying why.",
          },
        ],
      },
      placed,
      CRITERIA,
    );
    const first = remarks[0];
    if (first?.kind !== "placement") throw new Error("expected a placement");
    expect(first.valence).toBe(-80);
    expect(first.passage).toBe("randomised");
    expect(first.criterion).toBe("are the controls adequate?");
    expect(first.commentId).toBe("spya-c00009");
  });

  it("caps the list and says how many it cut", () => {
    const many = Array.from({ length: MAX_REMARKS + 2 }, (_, i) => ({
      kind: "coverage",
      criterion: `criterion ${i}`,
      note: "Nothing bears on this.",
    }));
    const criteria: MirrorCriterion[] = many.map((m) => ({ text: m.criterion }));
    const { remarks, dropped } = validateRemarks({ remarks: many }, input, criteria);
    expect(remarks).toHaveLength(MAX_REMARKS);
    expect(dropped.truncated).toBe(2);
  });
});
