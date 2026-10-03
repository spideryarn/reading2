/**
 * **Reception's two groups, and the two things the split must never do.**
 *
 * Debate's group-one rows carry the name of the strongest evidence that the page
 * is about *this* article — it links the address, it quotes the article's own
 * words, or it names the title. From 2026-09-06 to 2026-10-03 the reader set a
 * floor under that (`?name=`, defaulting to *quotes it*), and the default hid
 * the citing papers and the published replies the search was changed to find
 * (docs/postmortems/261003h-debate-default-bar-hides-the-citing-papers-the-search-was-changed-to-find.md).
 * Since then nothing is hidden: the rows that link or quote the piece come
 * first, and the ones that only name it follow under their own heading (plan
 * 261003o, step 3).
 *
 * The panel's own rendering is covered next door in debate-panel.test.tsx. What
 * is here is the rule underneath, tested without a DOM, because two of its
 * properties are invisible on screen until they are wrong:
 *
 *  1. **Which side a row falls on.** `named` is weaker than `quoted` is weaker
 *     than `linked` — a page that links this article's address has done the one
 *     thing a page about a *different* document with the same title cannot. So
 *     only a row whose **strongest** signal is `named` goes under the title-only
 *     heading.
 *  2. **Nothing is lost and nothing is reordered.** Every row is in exactly one
 *     group, in the order it arrived.
 */
import { describe, expect, it } from "vitest";

import { receptionSections } from "../src/web/debate-levels.js";
import {
  type BlockId,
  type DirectDebateRow,
  type IdentificationSignal,
  identificationLevel,
} from "../src/types.js";

const KNOWN = "spya-k3m9qt" as BlockId;

function row(id: string, identifies: IdentificationSignal[]): DirectDebateRow {
  return {
    id,
    url: `https://example.org/${id}`,
    title: "A page",
    sourceQuote: "the third section does not survive its own second",
    articleReferenceQuote: "Notes on my sourdough starter, week 3",
    relation: "disputes",
    lean: "leans-against",
    applies: "It says the piece contradicts itself.",
    identifies,
  };
}

const NAMED = row("spya-d2w4r2", [
  { kind: "named", by: "title", witness: "Notes on my sourdough starter, week 3" },
]);
const QUOTED = row("spya-d2w4r3", [
  { kind: "quoted", quote: "a starter needs cool water", blockId: KNOWN, coverage: 0.04, density: 0.13 },
  { kind: "named", by: "title", witness: "Notes on my sourdough starter, week 3" },
]);
/* `named` first on this one, so a split reading the first signal rather than
   the strongest puts a linking page under the title-only heading. */
const LINKED = row("spya-d2w4r4", [
  { kind: "named", by: "title", witness: "Notes on my sourdough starter, week 3" },
  { kind: "linked", url: "https://example.net/the-piece" },
]);
const ALL = [NAMED, QUOTED, LINKED];

describe("which group a row about this piece is in", () => {
  it("takes each row's strongest signal, not its first", () => {
    /* The rows above deliberately carry `named` alongside the stronger fact,
       because that is what a real row looks like: a page that links the article
       usually names it too. */
    expect(identificationLevel(LINKED)).toBe("linked");
    expect(identificationLevel(QUOTED)).toBe("quoted");
    expect(identificationLevel(NAMED)).toBe("named");
  });

  it("puts the rows that link or quote the piece first, and a title-only row in its own group", () => {
    const { confirmed, titleOnly } = receptionSections(ALL);
    expect(confirmed.map((r) => r.id)).toEqual([QUOTED.id, LINKED.id]);
    expect(titleOnly.map((r) => r.id)).toEqual([NAMED.id]);
  });

  it("leaves the rows in the order they arrived, in both groups", () => {
    /* The split groups and never orders: which order each group is drawn in is
       `?debateby=`'s business (debate-order.ts), and none of those orders is
       by identification level — the chip on the row already says it. */
    const second = { ...NAMED, id: "spya-d2w4r5" };
    const shuffled = [LINKED, second, QUOTED, NAMED];
    const { confirmed, titleOnly } = receptionSections(shuffled);
    expect(confirmed.map((r) => r.id)).toEqual([LINKED.id, QUOTED.id]);
    expect(titleOnly.map((r) => r.id)).toEqual([second.id, NAMED.id]);
  });

  it("keeps every row, in exactly one group", () => {
    /* The promise the old threshold could not make: nothing is hidden. */
    const { confirmed, titleOnly } = receptionSections(ALL);
    expect(confirmed.length + titleOnly.length).toBe(ALL.length);
    expect(new Set([...confirmed, ...titleOnly]).size).toBe(ALL.length);
  });

  /* The decoy that set the old default (260906b, the constitution): one row,
     title only. It must never come out as confirmed reception. */
  it("puts a lone title-only row in the title-only group, never among the confirmed", () => {
    const { confirmed, titleOnly } = receptionSections([NAMED]);
    expect(confirmed).toEqual([]);
    expect(titleOnly).toEqual([NAMED]);
  });

  it("reads a row stored before the field existed as title-only", () => {
    /* Every artefact written before 2026-09-06 has no `identifies` key at all;
       `identifiesOf` reads it as `named` on the witness that kept it. That is
       what the field would have said, so an old artefact's rows sit where the
       decoy does rather than among the confirmed. */
    const old = { ...NAMED } as Partial<DirectDebateRow> & { identifies?: unknown };
    delete old.identifies;
    const { confirmed, titleOnly } = receptionSections([old as DirectDebateRow, QUOTED]);
    expect(confirmed.map((r) => r.id)).toEqual([QUOTED.id]);
    expect(titleOnly.map((r) => r.id)).toEqual([NAMED.id]);
  });
});
