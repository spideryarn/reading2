/**
 * Stage 3b — a footnote being renumbered must not cost a paragraph its id.
 *
 * `extractText` walks `textContent`, so a marker's own digits are part of
 * `Block.text` and the carry-over key is built from that text. An author who
 * inserts one note near the top shifts every later marker `7 → 8`, so **every
 * paragraph below it keys differently while its prose is unchanged**, gets a
 * fresh id on the next re-extraction, and takes every comment anchored to it
 * with it. docs/plans/footnotes.md, "The trap that would cost the most".
 *
 * The fix strips the **recognised marker and back-link nodes** — never a text
 * pattern, because markers are also letters, stars and Roman numerals and a
 * leading number can be a note's own first word — and folds the `noteId`s the
 * block cites into the key. Numbering changes, the id is carried; the target or
 * the note's words change, a fresh id is minted.
 *
 * Everything here goes through the real `canonicaliseNotes`, so the stamps the
 * key reads are the ones stage 2 actually writes. Hand-built canonical markup
 * would keep passing if stage 2 stopped emitting an attribute.
 *
 * The last describe is the safety case, and it is the reason this file exists at
 * all: the key is computed on **both** sides of the match, over stored blocks
 * and over this run's candidates, so a change to it that is not symmetric
 * matches nothing, re-mints every block of every article that already exists,
 * and orphans every comment in the database.
 */
import { JSDOM } from "jsdom";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { splitIntoBlocks } from "../src/blocks.js";
import { runExtract } from "../src/extract.js";
import { canonicaliseNotes } from "../src/notes.js";
import type { Block } from "../src/types.js";

/** Stage 2, then stage 3 — the two halves of what an ingest does to a page. */
function canonical(source: string): string {
  const dom = new JSDOM(source);
  canonicaliseNotes(dom.window.document);
  return dom.window.document.body.innerHTML;
}

/** A pandoc/gwern page as its author published it: markers, then a notes list. */
const source = (paragraphs: string, notes: string): string =>
  `<article>${paragraphs}<section role="doc-endnotes"><ol>${notes}</ol></section></article>`;

/** The same page after stage 2 — which is what stage 3 is ever handed. */
const page = (paragraphs: string, notes: string): string => canonical(source(paragraphs, notes));

/** One citation. `label` is what the author printed; `target` is which note. */
const cite = (label: string, target: string, markerId = `fnref${label}`): string =>
  `<a href="#fn${target}" id="${markerId}" role="doc-noteref">${label}</a>`;

/**
 * One note, with the author's own back-link per place it is cited — numbered
 * `1 2 3` the way Wikipedia numbers them, so the note's own text changes when
 * it gains a citation.
 */
const note = (name: string, words: string, backs: string[]): string =>
  `<li id="fn${name}">${words} ${backs
    .map((b, i) => `<a href="#${b}" role="doc-backlink">${i + 1}</a>`)
    .join(" ")}</li>`;

const textOf = (blocks: Block[], needle: string): Block =>
  blocks.find((b) => b.text.includes(needle))!;

/**
 * The block a paragraph's citation lands on — the marker's href, after stage 3
 * has repointed it at the note's block id.
 *
 * Needed wherever the notes read alike, because then "which note" is not a
 * question the text can answer and only the citation can.
 */
const citedBlockId = (blocks: Block[], needle: string): string =>
  /href="#(spya-(?!note-)[0-9a-z]+)"/.exec(
    /<a[^>]*data-spya-note-ref[^>]*>/.exec(textOf(blocks, needle).html)?.[0] ?? "",
  )?.[1] ?? "";

/* -------------------------------------------------------------------------- */
/* 1. Insertion — one new note at the top renumbers everything below it        */
/* -------------------------------------------------------------------------- */

describe("a note inserted near the top", () => {
  const BEFORE = page(
    `<p>Alpha prose, which is unchanged throughout.${cite("1", "1")}</p>
     <p>Beta prose, which is also unchanged.${cite("2", "2")}</p>`,
    `${note("1", "The first note's words.", ["fnref1"])}
     ${note("2", "The second note's words.", ["fnref2"])}`,
  );
  /* The same two paragraphs, word for word. A third note is cited above them,
     so the author's own markers now read 2 and 3 where they read 1 and 2. */
  const AFTER = page(
    `<p>Gamma prose, newly written.${cite("1", "0")}</p>
     <p>Alpha prose, which is unchanged throughout.${cite("2", "1")}</p>
     <p>Beta prose, which is also unchanged.${cite("3", "2")}</p>`,
    `${note("0", "The inserted note's words.", ["fnref1"])}
     ${note("1", "The first note's words.", ["fnref2"])}
     ${note("2", "The second note's words.", ["fnref3"])}`,
  );

  const first = splitIntoBlocks(BEFORE);
  const second = splitIntoBlocks(AFTER, first.blocks);

  it("keeps the id of a paragraph whose only change is its marker's number", () => {
    for (const prose of ["Alpha prose", "Beta prose"]) {
      expect(textOf(second.blocks, prose).id, prose).toBe(textOf(first.blocks, prose).id);
    }
  });

  it("keeps the id of a note block whose number moved under it", () => {
    for (const words of ["first note's words", "second note's words"]) {
      expect(textOf(second.blocks, words).id, words).toBe(textOf(first.blocks, words).id);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 2. Target replacement — the paragraph now means something else             */
/* -------------------------------------------------------------------------- */

describe("a citation repointed at a different note", () => {
  const BEFORE = page(
    `<p>Alpha prose, which is unchanged throughout.${cite("1", "1")}</p>
     <p>Beta prose, which is also unchanged.${cite("2", "2")}</p>`,
    `${note("1", "The first note's words.", ["fnref1"])}
     ${note("2", "The second note's words.", ["fnref2"])}`,
  );
  /* Not one word of either paragraph has changed and neither has a printed
     number. Alpha now cites the second note and Beta the first, so both
     paragraphs assert something different from what they asserted before. */
  const AFTER = page(
    `<p>Alpha prose, which is unchanged throughout.${cite("1", "2")}</p>
     <p>Beta prose, which is also unchanged.${cite("2", "1")}</p>`,
    `${note("1", "The first note's words.", ["fnref2"])}
     ${note("2", "The second note's words.", ["fnref1"])}`,
  );

  const first = splitIntoBlocks(BEFORE);
  const second = splitIntoBlocks(AFTER, first.blocks);

  it("mints rather than carrying, because the paragraph cites something else", () => {
    expect(textOf(second.blocks, "Alpha prose").id).not.toBe(textOf(first.blocks, "Alpha prose").id);
  });

  it("does not hand the paragraph the other one's id either", () => {
    expect(textOf(second.blocks, "Alpha prose").id).not.toBe(textOf(first.blocks, "Beta prose").id);
  });
});

/* -------------------------------------------------------------------------- */
/* 3. Stripped-text collision — same words, different notes                   */
/* -------------------------------------------------------------------------- */

describe("two paragraphs whose words are identical once the markers are gone", () => {
  /* This is what the naive fix gets wrong. Take the markers out of the text and
     these two paragraphs are the same string, so a text-only key puts them in
     one bucket and hands out the ids in document order — and reordering them
     silently swaps a reader's annotations onto the other claim. */
  const BEFORE = page(
    `<p>The same words.${cite("1", "1")}</p>
     <p>The same words.${cite("2", "2")}</p>`,
    `${note("1", "The first note's words.", ["fnref1"])}
     ${note("2", "The second note's words.", ["fnref2"])}`,
  );
  /* The paragraph citing the second note now comes first. Neither has changed. */
  const AFTER = page(
    `<p>The same words.${cite("2", "2")}</p>
     <p>The same words.${cite("1", "1")}</p>`,
    `${note("1", "The first note's words.", ["fnref1"])}
     ${note("2", "The second note's words.", ["fnref2"])}`,
  );

  const first = splitIntoBlocks(BEFORE);
  const second = splitIntoBlocks(AFTER, first.blocks);

  /** Which note this paragraph cites — the only thing telling the two apart. */
  const citing = (blocks: Block[], noteWords: string): Block => {
    const noteId = textOf(blocks, noteWords).noteId!;
    return blocks.find((b) => b.tag === "p" && b.html.includes(`data-spya-note-ref="${noteId}"`))!;
  };

  it("keeps the two ids distinct", () => {
    expect(new Set(second.blocks.map((b) => b.id)).size).toBe(second.blocks.length);
  });

  it("does not swap them when the two paragraphs change places", () => {
    for (const words of ["first note's words", "second note's words"]) {
      expect(citing(second.blocks, words).id, words).toBe(citing(first.blocks, words).id);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* 4. A note that genuinely begins with a number                              */
/* -------------------------------------------------------------------------- */

describe("text that genuinely begins with a number", () => {
  /* The rejected version of this fix took a leading number off the key by
     pattern. These two paragraphs are what that costs: they differ in nothing
     but their first word, and they cite the same note, so with the number gone
     they key identically and the reorder below hands each the other's id — a
     reader's note silently moved onto a different claim, which block-ids.md is
     explicit is worse than losing it.
     The note itself also starts with a number and is cited twice, so its
     author-written back-links — which Wikipedia numbers `1 2 3`, one per place
     it is cited — are part of its text and change when a third citation lands. */
  const NOTE_WORDS = "1970 was the year the network first carried a message.";
  const BEFORE = page(
    `<p>1970 was a good year for the network.${cite("1", "1", "fnref1a")}</p>
     <p>1971 was a good year for the network.${cite("1", "1", "fnref1b")}</p>`,
    note("1", NOTE_WORDS, ["fnref1a", "fnref1b"]),
  );
  /* The two paragraphs change places, and a third citation is added. Not one
     word of either paragraph, or of the note, has changed. */
  const AFTER = page(
    `<p>1971 was a good year for the network.${cite("1", "1", "fnref1b")}</p>
     <p>1970 was a good year for the network.${cite("1", "1", "fnref1a")}</p>
     <p>Gamma prose, newly written.${cite("1", "1", "fnref1c")}</p>`,
    note("1", NOTE_WORDS, ["fnref1b", "fnref1a", "fnref1c"]),
  );

  const first = splitIntoBlocks(BEFORE);
  const second = splitIntoBlocks(AFTER, first.blocks);

  it("does not fold two paragraphs together over their leading number", () => {
    for (const year of ["1970 was a good year", "1971 was a good year"]) {
      expect(textOf(second.blocks, year).id, year).toBe(textOf(first.blocks, year).id);
    }
  });

  it("leaves the number in the block's stored text", () => {
    // The other wrong fix: strip the digits in `extractText` and the key
    // follows for free — along with the first word of every note like this one.
    expect(textOf(second.blocks, "was the year").text.startsWith("1970")).toBe(true);
  });

  it("keeps the note's id when it gains a third back-link", () => {
    expect(textOf(second.blocks, "was the year").id).toBe(textOf(first.blocks, "was the year").id);
  });
});

/* -------------------------------------------------------------------------- */
/* 5. What this deliberately does NOT do: editing a note's own words           */
/* -------------------------------------------------------------------------- */

/**
 * **Correcting a typo in a note re-mints the block ids of the passages citing
 * it.** Their own prose has not changed by a character, and they lose their
 * anchors anyway. This is known, it is asserted here rather than left to be
 * discovered, and it is the *safe* direction of failure.
 *
 * It was fixed once and the fix was withdrawn. `noteId` is a hash of the note's
 * words, so the only way to tell "the author reworded note 7" from "note 7 is a
 * different note now" is a second signal, and the one available is the author's
 * own anchor (`fn7`, `cite_note-14`). Stage 2 was changed to carry it and stage
 * 3 to reconcile on it; GPT Sol then reproduced a mixed insert-edit-renumber
 * revision in which a passage's id moved onto a **different passage** — the
 * wrong-attachment failure the fingerprint exists to prevent, twice in two
 * rounds. docs/project/block-ids.md is explicit that a lost anchor is the safer
 * failure than a moved one, so the whole mechanism came out again: stage 2 is
 * untouched, and a note's identity is its content and nothing else.
 *
 * The renumbering bug this stage exists for is unaffected — that is about a
 * marker's digits, not a note's words, and it is the four tests above.
 */
describe("a note whose wording was corrected", () => {
  const paragraphs = `<p>Alpha prose, which is unchanged throughout.${cite("1", "1")}</p>
     <p>Beta prose, which is also unchanged.${cite("2", "2")}</p>`;
  const BEFORE = page(
    paragraphs,
    `${note("1", "The first note's words, with a tpyo in them.", ["fnref1"])}
     ${note("2", "The second note's words.", ["fnref2"])}`,
  );
  /* The same article with the typo fixed, and nothing else touched at all. */
  const AFTER = page(
    paragraphs,
    `${note("1", "The first note's words, with a typo in them.", ["fnref1"])}
     ${note("2", "The second note's words.", ["fnref2"])}`,
  );

  const first = splitIntoBlocks(BEFORE);
  const second = splitIntoBlocks(AFTER, first.blocks);

  it("re-mints the passage citing it — the cost, written down", () => {
    expect(textOf(second.blocks, "Alpha prose").id).not.toBe(
      textOf(first.blocks, "Alpha prose").id,
    );
  });

  it("leaves every passage citing a note it did not touch alone", () => {
    // The blast radius is the notes actually edited, and nothing wider.
    expect(textOf(second.blocks, "Beta prose").id).toBe(textOf(first.blocks, "Beta prose").id);
  });
});


/* -------------------------------------------------------------------------- */
/* 6. Notes that read alike — "Ibid.", and the counter that told them apart    */
/* -------------------------------------------------------------------------- */

/**
 * **The renumbering, moved from the marker into the note id.** `mintNoteId`
 * hashes the note's prose and then appends `-2`, `-3` to whichever *duplicates*
 * come later in document order, so two notes reading "Ibid." are `h` and `h-2`.
 * Insert a third above them and the counters rotate: `h` is now the new one,
 * the old first is `h-2`, the old second is `h-3`.
 *
 * That is the same bug this stage exists to fix, one level down — and the first
 * version of this key named the note by its *whole* id, so it propagated the
 * rotation into every citing passage. GPT Sol reproduced it
 * (footnotes-stage3b-review-sol.md, blocker 1). The counter is a **position**,
 * and a position is not an identity: two notes saying the same words are the
 * same note as far as a citing passage is concerned. So the key names the
 * content digest and drops the counter, and the first test below is that fix.
 *
 * **The second test pins a limit older than this stage, and measured to be.**
 * Three notes whose prose is identical are indistinguishable to a key built from
 * content, so their block ids go out in document order and the inserted note
 * takes the first old note's id — which is `exactKey`'s documented behaviour for
 * any two blocks that read alike. Run the same fixture with the whole of stage
 * 3b switched off and the rotation is identical; the only difference is that the
 * citing passages re-mint as well (2026-08-29). So it is neither introduced nor
 * fixed here.
 *
 * What would fix it: tell identical notes apart by the author's own anchor —
 * which stage 2 would have to be taught to keep, and briefly was — used **only**
 * in a note body's own key
 * and never in a citing passage's — a passage cares what its note says, not
 * which of two identical copies it is, and folding the anchor into a passage's
 * key would re-mint it whenever the author renumbered. That helps where anchors
 * are stable (Wikipedia's `cite_note-lstm1997-2`) and not where they are
 * positional (pandoc's `fn1`). Deliberately not built here: a second mechanism
 * for a pre-existing fault, inside a change already carrying two integrity
 * fixes. See docs/plans/footnotes.md.
 */
describe('three notes that all read "Ibid."', () => {
  const IBID = "Ibid., 43.";
  const BEFORE = page(
    `<p>Alpha prose, which is unchanged throughout.${cite("1", "1")}</p>
     <p>Beta prose, which is also unchanged.${cite("2", "2")}</p>`,
    `${note("1", IBID, ["fnref1"])} ${note("2", IBID, ["fnref2"])}`,
  );
  /* One more identical note, cited from a new paragraph above the other two. */
  const AFTER = page(
    `<p>Gamma prose, newly written.${cite("1", "0")}</p>
     <p>Alpha prose, which is unchanged throughout.${cite("2", "1")}</p>
     <p>Beta prose, which is also unchanged.${cite("3", "2")}</p>`,
    `${note("0", IBID, ["fnref1"])} ${note("1", IBID, ["fnref2"])} ${note("2", IBID, ["fnref3"])}`,
  );

  const first = splitIntoBlocks(BEFORE);
  const second = splitIntoBlocks(AFTER, first.blocks);

  it("keeps the ids of the passages citing them", () => {
    for (const prose of ["Alpha prose", "Beta prose"]) {
      expect(textOf(second.blocks, prose).id, prose).toBe(textOf(first.blocks, prose).id);
    }
  });

  it("still hands identical notes their ids in document order, as it always has", () => {
    // Identical prose, so the citation is the only thing that says which note is
    // which — and following Alpha's marker lands on the block that used to be
    // Beta's note. That is the pre-existing limit, pinned rather than claimed to
    // be fixed; the fix described above would make this line go red on purpose.
    const noteIds = (r: typeof first) => r.blocks.filter((b) => b.noteId).map((b) => b.id);
    expect(noteIds(second).slice(0, 2)).toEqual(noteIds(first));
    expect(citedBlockId(second.blocks, "Alpha prose")).toBe(
      citedBlockId(first.blocks, "Beta prose"),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 6. The migration fallback must not reach a stamped block                    */
/* -------------------------------------------------------------------------- */

/**
 * **The bridge reaches an ordinary paragraph, and always did.** GPT Sol's third
 * review: the fallback's bucket accepts every *unstamped* previous block, and an
 * ordinary paragraph is unstamped forever — so this is not migration-only, and a
 * paragraph that gains a marker can take an ordinary paragraph's id.
 *
 * Reproduced, and then measured three ways before believing it was ours
 * (`output/bridge-probe.mts`, 2026-08-29):
 *
 * | code | result |
 * |---|---|
 * | HEAD, with none of stage 3b | **carried** |
 * | stage 3b, bridge on | **carried** |
 * | stage 3b, bridge off | minted |
 *
 * So the bridge **restores** what the old code did; it does not introduce this.
 * The cause is older than any of it: `extractText` walks `textContent`, so a
 * marker's digits are part of `Block.text`, and `<p>Alpha1</p>` and
 * `<p>Alpha<marker>1</p>` genuinely *read alike*. `exactKey` has always handed
 * two blocks that read alike their ids in document order, which is its
 * documented behaviour and the reason a page of repeated `<li>Yes</li>` keeps
 * its ids at all.
 *
 * Pinned rather than fixed, because the fix is not in this stage: it would be to
 * stop marker digits reaching `Block.text`, which changes what every consumer
 * reads. Turning the bridge off instead would *change* behaviour rather than
 * preserve it, and would re-mint 206 of 356 blocks on a pre-canonicaliser
 * article — the failure this bridge exists to prevent.
 */
describe("an ordinary paragraph that gains a marker", () => {
  const BEFORE = page(
    `<p>Alpha1</p><p>Carrier prose citing a note.${cite("1", "1")}</p>`,
    `${note("1", "The stamped note's words.", ["fnref1"])}`,
  );
  /* The ordinary paragraph is gone. A new one reads "Alpha" plus a marker "1",
     so its raw text is "Alpha1" too — the same string, a different block. */
  const AFTER = page(
    `<p>Alpha${cite("1", "1", "fnrefA")}</p>
     <p>Carrier prose citing a note.${cite("1", "1")}</p>`,
    `${note("1", "The stamped note's words.", ["fnrefA", "fnref1"])}`,
  );
  const first = splitIntoBlocks(BEFORE);
  const second = splitIntoBlocks(AFTER, first.blocks);
  const norm = (t: string) => t.replace(/\s+/gu, "");
  const before = first.blocks.find((b) => norm(b.text) === "Alpha1")!;
  const after = second.blocks.find(
    (b) => norm(b.text) === "Alpha1" && b.html.includes("data-spya-note-ref"),
  )!;

  it("is a fixture where the two really do read alike", () => {
    /* Without this the test could pass for the wrong reason — two blocks that
       differ in text would mint no matter what the bridge did. */
    expect(before.text).toBe(after.text);
  });

  it("carries the id, which is what the code without any of this stage does", () => {
    expect(after.id).toBe(before.id);
  });
});

/**
 * **A legacy key that spells a new one.** GPT Sol's blocker 2. The two keys
 * shared a namespace: `x:p:n[<noteId>]prose` is what a stamped block keys as,
 * and it is also what an *unstamped* block keys as if its prose literally begins
 * `n[<noteId>]`. So a paragraph could reach a previous block that carries stamps
 * — the one direction the fallback was supposed to be unable to go — and take an
 * id belonging to a passage that had not changed at all.
 *
 * The article is hostile-looking and that is the point: the id it steals belongs
 * to an ordinary paragraph elsewhere on the page, and the theft is silent.
 */
describe("prose that spells out a note key", () => {
  const NOTE_A = "The first note's words.";
  const NOTE_B = "The second note's words, which are different.";
  const BEFORE = page(
    `<p>Tail${cite("1", "1")}</p>
     <p>Padding prose, so the document is not two blocks long.</p>`,
    `${note("1", NOTE_A, ["fnref1"])} ${note("2", NOTE_B, [])}`,
  );
  const first = splitIntoBlocks(BEFORE);
  /* The literal id of note A, which the article below writes out in its prose. */
  const noteA = textOf(first.blocks, "first note's words").noteId!;

  /* Two paragraphs. The first is new, cites note **B**, and its raw text —
     marker digits and all — spells note A's key exactly. The second is the
     untouched `Tail` paragraph, still citing note A. */
  const AFTER = page(
    `<p>n[${noteA}]Tai${cite("l", "2")}</p>
     <p>Tail${cite("1", "1")}</p>
     <p>Padding prose, so the document is not two blocks long.</p>`,
    `${note("1", NOTE_A, ["fnref1"])} ${note("2", NOTE_B, ["fnrefl"])}`,
  );
  const second = splitIntoBlocks(AFTER, first.blocks);

  it("leaves the unchanged passage its id", () => {
    const tail = second.blocks.find((b) => b.tag === "p" && b.text === "Tail1")!;
    expect(tail.id).toBe(textOf(first.blocks, "Tail").id);
  });

  it("mints for the paragraph that merely spells the key out", () => {
    const impostor = second.blocks.find((b) => b.text.startsWith(`n[${noteA}]`))!;
    expect(impostor.id).not.toBe(textOf(first.blocks, "Tail").id);
  });
});

/* -------------------------------------------------------------------------- */
/* 7. A digest that is all digits is still a digest                            */
/* -------------------------------------------------------------------------- */

/**
 * **`spya-note-9417977611` is a note id, not a note id with a counter on it.**
 *
 * A note's id is `spya-note-` plus ten hex characters, and duplicates get `-2`,
 * `-3` appended. Stripping that counter with `/-\d+$/` eats the **digest itself**
 * whenever it happens to be all digits, which is about one note in a hundred, so
 * two entirely different notes both come out as `spya-note` and every passage
 * citing either of them keys the same. GPT Sol found it in the second review and
 * reproduced it with two real notes: repointing an unchanged paragraph from one
 * to the other carried its old id, which is the wrong-attachment failure the
 * fingerprint exists to prevent.
 *
 * The counter is now parsed structurally — the ten-hex field is captured rather
 * than the tail being chopped off.
 */
describe("two notes whose digests are all digits", () => {
  /* Chosen because sha256 of each begins with ten digits and nothing else;
     asserted below, so this fixture cannot quietly stop being the hard case. */
  const NOTE_A = "note-12";
  const NOTE_B = "note-58";
  const BEFORE = page(
    `<p>Alpha prose, which is unchanged throughout.${cite("1", "1")}</p>
     <p>Beta prose, which is also unchanged.${cite("2", "2")}</p>`,
    `${note("1", NOTE_A, ["fnref1"])} ${note("2", NOTE_B, ["fnref2"])}`,
  );
  /* The two citations change places. Neither paragraph's prose has changed. */
  const AFTER = page(
    `<p>Alpha prose, which is unchanged throughout.${cite("1", "2")}</p>
     <p>Beta prose, which is also unchanged.${cite("2", "1")}</p>`,
    `${note("1", NOTE_A, ["fnref2"])} ${note("2", NOTE_B, ["fnref1"])}`,
  );

  const first = splitIntoBlocks(BEFORE);
  const second = splitIntoBlocks(AFTER, first.blocks);

  it("is a fixture whose digests really are numeric", () => {
    for (const words of [NOTE_A, NOTE_B]) {
      const id = textOf(first.blocks, words).noteId!;
      expect(/^spya-note-[0-9]{10}$/.test(id), id).toBe(true);
    }
  });

  it("mints for a passage repointed between them", () => {
    expect(textOf(second.blocks, "Alpha prose").id).not.toBe(
      textOf(first.blocks, "Alpha prose").id,
    );
  });
});

/* -------------------------------------------------------------------------- */
/* 8. What the parse says, over what the string search guessed                 */
/* -------------------------------------------------------------------------- */

/**
 * The cheap `MIGHT_BE_STAMPED` test is a gate, not an answer, and both of its
 * mistakes are here. Prose that merely writes an attribute name out gets parsed
 * and found to hold no stamp, so it must come back with **the caller's own
 * text** rather than a re-derivation. And a stamp whose value is not one stage 2
 * could have minted is not a stamp: the safe thing to do with a control we do
 * not recognise is leave it alone, because removing it while contributing no
 * identity collapses two blocks that differ only in what was deleted.
 *
 * Hand-built rather than run through stage 2, and deliberately so — stage 2
 * scrubs every forged stamp off the document, so this is the shape that only
 * reaches stage 3 from a stored artefact or a direct caller.
 */
describe("html that only looks stamped", () => {
  it("keeps the id of a paragraph that writes an attribute name in its prose", () => {
    const article = `<article>
      <p>The attribute is spelled data-spya-note-ref and it means a marker.</p>
      <p>An ordinary second paragraph, for company.</p>
    </article>`;
    const first = splitIntoBlocks(article);
    const second = splitIntoBlocks(article, first.blocks);
    expect(second.stats.minted).toBe(0);
    expect(second.blocks.map((b) => b.id)).toEqual(first.blocks.map((b) => b.id));
  });

  it("does not collapse two blocks that differ only in an unrecognised control", () => {
    /* Each paragraph carries a **real** marker as well, so the parse does find a
       stamp and does re-derive the text — without that, the "nothing recognised,
       hand the caller's text straight back" rule covers this case on its own and
       the assertion would pass however the invalid one were treated. */
    /* A digest with letters in it, deliberately: an all-digit one would drag
       the counter-stripping bug into a test that is not about it, which is how
       the earlier version of this fixture exercised that collapse without ever
       being able to detect it. The numeric case has its own test above. */
    const marker = `<sup><a data-spya-note-ref="spya-note-0123456abc">1</a></sup>`;
    const paragraphs = (order: readonly string[]) =>
      `<article>${order
        .map((w) => `<p>Same words <a data-spya-note-ref="not-a-note-id">${w}</a>${marker}</p>`)
        .join("")}</article>`;
    const first = splitIntoBlocks(paragraphs(["alpha", "beta"]));
    /* Reordered, which is what turns "these two share a key" into a swap. */
    const second = splitIntoBlocks(paragraphs(["beta", "alpha"]), first.blocks);
    for (const word of ["alpha", "beta"]) {
      expect(textOf(second.blocks, word).id, word).toBe(textOf(first.blocks, word).id);
    }
  });
});

/* -------------------------------------------------------------------------- */
/* What this costs an article that was ingested before stage 2 existed         */
/* -------------------------------------------------------------------------- */

/**
 * **Why `legacyKey` exists, and why it is not a hole in the new one.**
 *
 * An article already in the database was split before `canonicaliseNotes`
 * existed, so its stored html holds the author's raw markers and none of stage
 * 2's stamps. Its blocks therefore key the old way while this run's candidates
 * key the new way, and the two would never meet. Measured over the committed
 * fixtures — previous = Readability with the notes pass **off**, current = the
 * same page with it **on**, 2026-08-29 — that cost, before the bridge:
 *
 *     wiki_transformer  206 of 356 blocks re-minted (85 citing, 121 notes)
 *     gwern              55 of 184 (21 citing, 34 notes)
 *     acx_footnotes      35 of  96 (17 citing, 18 notes)
 *     tufte              10 of  68 (5 citing, 5 notes)
 *
 * With the old key the same transition cost 0, 0, 18 and 10, so all but the
 * notes' own restructuring was this change's doing rather than stage 2's. The
 * same requirement is already committed, over the real corpus, as "turning the
 * pass on keeps every note's block id" in tests/notes-canonical.test.ts.
 *
 * The bridge only ever reaches a previous block with no stamp on it — a stamped
 * one is bucketed under a key naming the notes it cites, which no legacy key
 * can spell. So it fires once, on an article's first re-ingest after stage 2,
 * and never between two canonicalised runs. "Repointed at a different note",
 * above, is what pins that: point the fallback at a bucket of legacy keys built
 * over *all* previous blocks and it carries the id instead of minting.
 *
 * What it does not fix, because the old key never did either: two paragraphs
 * that read identically down to the marker's digits, both keying the legacy way
 * because the article predates stage 2, still take their ids in document order.
 */
describe("an article ingested before stage 2 existed", () => {
  const SOURCE = source(
    `<p>Alpha prose, which is unchanged throughout.${cite("1", "1")}</p>
     <p>Delta prose, which cites nothing at all.</p>`,
    note("1", "The first note's words.", ["fnref1"]),
  );
  /* The author's own markup, straight into stage 3 — no stamps anywhere. */
  const before = splitIntoBlocks(SOURCE);
  const after = splitIntoBlocks(canonical(SOURCE), before.blocks);

  it("keeps the id of the paragraph that cites a note", () => {
    expect(textOf(after.blocks, "Alpha prose").id).toBe(textOf(before.blocks, "Alpha prose").id);
  });

  it("keeps the id of the note block itself", () => {
    expect(textOf(after.blocks, "first note's words").id).toBe(
      textOf(before.blocks, "first note's words").id,
    );
  });

  it("keeps the id of every block that has nothing to do with a footnote", () => {
    expect(textOf(after.blocks, "Delta prose").id).toBe(textOf(before.blocks, "Delta prose").id);
  });
});

/* -------------------------------------------------------------------------- */
/* The safety case — a re-ingest that changes nothing must change nothing      */
/* -------------------------------------------------------------------------- */

/**
 * Real pages, through the real extraction, matched against themselves.
 *
 * The key is computed over **stored blocks** on one side and over **this run's
 * candidates** on the other, and the two are not the same object: a candidate's
 * html is read before its id is written and before `retargetAnchors` repoints
 * its hrefs. A key that reads anything those two disagree about would match
 * nothing at all — which does not look like a bug, it looks like an article
 * that changed.
 */
describe("a no-op re-ingest of a real article", () => {
  const FIXTURES = path.join(import.meta.dirname, "..", "evals", "extraction", "fixtures");
  const SLOW = 120_000;
  /* One with 170 markers over 121 notes, one Substack post, one pandoc page. */
  const PAGES = ["wiki_transformer.html", "acx_footnotes.html", "gwern.html"];
  const extracted = new Map<string, string>();

  beforeAll(async () => {
    for (const fixture of PAGES) {
      const html = await readFile(path.join(FIXTURES, fixture), "utf-8");
      const result = await runExtract({
        html,
        url: `https://example.test/${fixture}`,
        slug: fixture,
      });
      extracted.set(fixture, result.extractedHtml);
    }
  }, SLOW);

  for (const fixture of PAGES) {
    it(
      `carries every id it can and mints nothing new — ${fixture}`,
      () => {
        const html = extracted.get(fixture)!;
        const first = splitIntoBlocks(html);
        /* The same html again, with no ids in it — which is what stage 2 hands
           over on a re-ingest, and the only case carry-over exists for. */
        const second = splitIntoBlocks(html, first.blocks);

        /* An `<hr>` and an empty block have no text and no src to match on, so
           they re-mint however the key is built. That is the known limit
           (tests/blocks.test.ts), and it is the only thing allowed to mint. */
        const unmatchable = first.blocks.filter(
          (b) => b.text.trim() === "" && !/\bsrc="/.test(b.html),
        ).length;
        expect(second.stats.minted).toBe(unmatchable);
        expect(second.stats.carried).toBe(second.stats.total - unmatchable);
        expect(second.blocks.map((b) => b.id)).toEqual(first.blocks.map((b) => b.id));
      },
      SLOW,
    );
  }

  it(
    "keeps every note-bearing block matched, which is where the new key applies",
    () => {
      const html = extracted.get("wiki_transformer.html")!;
      const first = splitIntoBlocks(html);
      const stamped = first.blocks.filter((b) => b.html.includes("data-spya-note"));
      /* A guard on the guard: if stage 2 stopped stamping, or the sanitiser
         started scrubbing, the assertions above would still pass over blocks
         the new key never touched. */
      expect(stamped.length).toBeGreaterThan(100);
      const second = splitIntoBlocks(html, first.blocks);
      const byId = new Map(first.blocks.map((b) => [b.id, b]));
      for (const b of stamped) expect(byId.has(b.id) && second.blocks.some((s) => s.id === b.id)).toBe(true);
    },
    SLOW,
  );
});
