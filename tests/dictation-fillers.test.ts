/**
 * **What the filler stripper may and may not do to a reader's words.**
 *
 * The cases are the easy half. The half that matters is `is a subsequence`
 * below, which is the machine-checkable form of the promise the whole design
 * rests on: **it deletes, and it can only delete.** A model asked to tidy a
 * transcript can paraphrase, and a fluent paraphrase looks exactly like a good
 * transcript — so the reason this app strips fillers with a regex rather than
 * with a prompt is precisely that the regex's honesty can be asserted.
 * [`src/dictation-fillers.ts`](../src/dictation-fillers.ts) and
 * [260905c](../docs/plans/260905c-dictation-filler-words-and-mic-offline.md).
 */
import { describe, expect, it } from "vitest";
import { stripFillers } from "../src/dictation-fillers.js";

/** Words, lower-cased, punctuation gone. What the invariant is stated over. */
function words(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}']+/gu) ?? []);
}

/** Is `b` obtainable from `a` by deleting words and nothing else? */
function isSubsequence(a: string[], b: string[]): boolean {
  let i = 0;
  for (const word of b) {
    while (i < a.length && a[i] !== word) i++;
    if (i === a.length) return false;
    i++;
  }
  return true;
}

/**
 * Every case in one table so that the invariant below can be run over all of
 * them without a second list to keep in step.
 */
const CASES: { said: string; want: string; why: string }[] = [
  { said: "Um, I think that's right.", want: "I think that's right.", why: "the ordinary one" },
  { said: "It is, um, fine.", want: "It is, fine.", why: "the comma the filler was holding open" },
  { said: "I uh think so.", want: "I think so.", why: "no punctuation around it at all" },
  { said: "Um, the thing is, er, hard.", want: "The thing is, hard.", why: "two of them, and a capital to give back" },
  { said: "So, ah, I see.", want: "So, I see.", why: "ah is a filler, per the report — mid-sentence" },
  { said: "Erm, maybe.", want: "Maybe.", why: "the British spelling" },
  { said: "Ummm, ages ago.", want: "Ages ago.", why: "a stretched one" },
  { said: "So, um, um, no.", want: "So, no.", why: "two in a row leave two commas" },
  { said: "Well — um — no.", want: "Well — no.", why: "dashes, not commas" },
  /* The ones it must not touch. Each is a word a reader meant. */
  { said: "Uh-huh, that's it.", want: "Uh-huh, that's it.", why: "uh-huh is yes" },
  { said: "Uh-uh, not that one.", want: "Uh-uh, not that one.", why: "uh-uh is no" },
  { said: "An umbrella, obviously.", want: "An umbrella, obviously.", why: "um inside a word" },
  { said: "Ahmed wrote the paper.", want: "Ahmed wrote the paper.", why: "ah inside a name" },
  { said: "Her answer was better.", want: "Her answer was better.", why: "er inside a word" },
  { said: "They were summering there.", want: "They were summering there.", why: "er and um inside words" },
  { said: "Hmm, I'm not sure.", want: "Hmm, I'm not sure.", why: "hmm is thinking, and is an answer" },
  { said: "Mm, possibly.", want: "Mm, possibly.", why: "mm is agreement" },
  { said: "Oh, I hadn't seen that.", want: "Oh, I hadn't seen that.", why: "oh is surprise" },
  { said: "It was, like, enormous.", want: "It was, like, enormous.", why: "like is a real word and stays" },
  { said: "You know, I mean, it's fine.", want: "You know, I mean, it's fine.", why: "not on the list, deliberately" },
  { said: "I— I think so.", want: "I— I think so.", why: "a stutter is deferred, not handled" },
  { said: "Über alles.", want: "Über alles.", why: "an accented letter is a letter" },
  /* **Every one of these was deleting a real word until GPT Sol's plan review.**
     Kept as a block, and named, because they are the cases that decide whether
     this function is safe to run on somebody's words at all. */
  { said: "To err is human.", want: "To err is human.", why: "err is a verb, and is off the list" },
  { said: "I went to the ER.", want: "I went to the ER.", why: "ER is a hospital, not a hesitation" },
  { said: "The UM report is out.", want: "The UM report is out.", why: "an initialism in capitals" },
  { said: "AH is the ticker symbol.", want: "AH is the ticker symbol.", why: "capitals again" },
  { said: "Ah, now I see.", want: "Ah, now I see.", why: "ah opening a sentence is a reaction" },
  { said: "It was, ah, difficult.", want: "It was, difficult.", why: "ah mid-sentence is hesitation" },
  { said: "He finished. Ah, good.", want: "He finished. Ah, good.", why: "ah after a full stop is still opening one" },
  { said: "Um, eBay is down.", want: "eBay is down.", why: "eBay keeps its own capitals" },
  { said: "Um, iPhone sales fell.", want: "iPhone sales fell.", why: "and so does iPhone" },
  { said: "I um, think so.", want: "I think so.", why: "the comma was the hesitation's, and goes with it" },
  { said: "Well: um, no.", want: "Well: no.", why: "a comma orphaned after a colon" },
  { said: "It was (um) fine.", want: "It was fine.", why: "brackets with nothing left in them" },
  { said: "Um? Yes.", want: "Um? Yes.", why: "a capital with no comma after it is a unit or a symbol, not hesitation" },
  { said: "The battery stores 100 Ah for use.", want: "The battery stores 100 Ah for use.", why: "Ah is the ampere-hour" },
  { said: "Er is erbium, the symbol matters.", want: "Er is erbium, the symbol matters.", why: "Er is erbium" },
  { said: "He replied (Ah, now I see).", want: "He replied (Ah, now I see).", why: "a sentence can open inside a bracket" },
  { said: "Um, run --help to see it.", want: "Run --help to see it.", why: "a double dash somewhere else is not ours to touch" },
  { said: "Um, what?—No, wait.", want: "What?—No, wait.", why: "and neither is a dash somewhere else" },
  { said: "Hello  world, um, spaced oddly.", want: "Hello  world, spaced oddly.", why: "a double space we did not make stays" },
  { said: "I—um—no.", want: "I—no.", why: "em dashes, unspaced" },
  { said: "That’s er better.", want: "That’s better.", why: "a typographic apostrophe is not a word boundary to break on" },
  { said: "Whatever’er that is.", want: "Whatever’er that is.", why: "er behind a curly apostrophe is part of a word" },
];

describe("stripFillers", () => {
  for (const { said, want, why } of CASES) {
    it(`${why}: ${JSON.stringify(said)}`, () => {
      expect(stripFillers(said)).toBe(want);
    });
  }

  it("never adds, reorders or rewords anything — the words out are a subsequence of the words in", () => {
    /* **The whole argument for doing this with a regex.** Stated over words
       rather than characters, because the tidy-up removes punctuation and the
       first letter may be re-capitalised; over lower-cased words, for the same
       reason. What it pins is the thing a model could not be held to: no word
       appears that was not said, and none of them moves. */
    for (const { said } of CASES) {
      const out = stripFillers(said);
      expect(isSubsequence(words(said), words(out)), `${said} → ${out}`).toBe(true);
    }
  });

  it("leaves a transcript with nothing to remove byte for byte identical", () => {
    /* **The punctuation tidy-up only ever runs on its own damage.** A global
       cleanup is a licence to change text that was already fine — a double
       space the model emitted, a leading ellipsis somebody dictated. GPT Sol's
       plan review, F8. So a transcript with no filler in it does not go through
       any of it. */
    for (const said of [
      "Hello  world, with two spaces.",
      "… and then he left.",
      ", a comma first, oddly.",
      "(Nothing to do here.)",
    ]) {
      expect(stripFillers(said)).toBe(said);
    }
  });

  it("keeps every surviving word byte for byte, bar the one allowed capital", () => {
    /* The subsequence check below is stated over lower-cased tokens, so on its
       own it would not notice a survivor coming back in different case. This is
       the other half: only the *first* word may change, and only by the
       initial-capital rule in `recapitalise`. GPT Sol's plan review, F9. */
    for (const { said } of CASES) {
      const before = said.match(/[\p{L}\p{N}'’]+/gu) ?? [];
      const after = stripFillers(said).match(/[\p{L}\p{N}'’]+/gu) ?? [];
      after.forEach((word, i) => {
        const source = before.find((w) => w.toLowerCase() === word.toLowerCase());
        if (i > 0) expect(before, `${said}: ${word}`).toContain(word);
        else expect(source?.toLowerCase()).toBe(word.toLowerCase());
      });
    }
  });

  it("removes only words that are on the list", () => {
    /* The other half of the subsequence property: what came *out* has to have
       been a filler. A stripper that deleted a random word would satisfy
       "subsequence" perfectly well. */
    const allowed = new Set(["um", "umm", "ummm", "uhm", "uh", "uhh", "uhhh", "er", "erm", "ermm", "ah", "ahh", "ahhh"]);
    for (const { said } of CASES) {
      const before = words(said);
      const after = words(stripFillers(said));
      const removed: string[] = [];
      let i = 0;
      for (const word of before) {
        if (after[i] === word) i++;
        else removed.push(word);
      }
      for (const word of removed) expect(allowed, `${said} lost ${word}`).toContain(word);
    }
  });

  it("gives back the original when stripping would empty it", () => {
    /* An empty transcript means "no speech" everywhere downstream — the box is
       left alone and the audio is offered back. Somebody whose whole dictation
       was a hesitation said a hesitation, and telling them we heard nothing
       would be a different and untrue thing. */
    expect(stripFillers("Um.")).toBe("Um.");
    expect(stripFillers("um")).toBe("um");
    expect(stripFillers("Um, uh, er.")).toBe("Um, uh, er.");
  });

  it("leaves a transcript with no fillers in it byte for byte alone", () => {
    const said = "The argument in section three does not follow from the premise.";
    expect(stripFillers(said)).toBe(said);
  });

  it("does not raise a lower-case opening to a capital that was never there", () => {
    /* `recapitalise` restores the capital the deleted word was carrying, and
       only that. A transcript that genuinely began lower-case stays that way —
       otherwise the function has stopped repairing its own damage and started
       deciding how the reader's sentence should look. */
    expect(stripFillers("um, and then he left")).toBe("and then he left");
  });

  it("keeps a paragraph break", () => {
    /* The whitespace collapse is `[^\\S\\n]`, not `\\s`, for exactly this. A
       dictation long enough to have paragraphs in it should still have them. */
    expect(stripFillers("Um, first point.\n\nSecond point.")).toBe("First point.\n\nSecond point.");
  });
});
