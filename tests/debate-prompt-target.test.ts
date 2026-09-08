/**
 * **Both search prompts must bind the row's target, and must rule out the one
 * wrong target the model actually reached for.**
 *
 * This is a test over prose, which is unusual and needs its justification.
 *
 * Three stored rows recorded the outside page's stance toward *its own* subject
 * rather than toward the row's target: a page arguing Uri Geller was a fraud
 * marked `negative` on a row whose target was a claim it **supported**, so the
 * reader got a red *Critical* chip over a source that agreed with the article.
 * All three were in the claims group — the group that already carried a
 * target-binding sentence — so this was never a missing instruction. It was an
 * incomplete negation: the sentence ruled out the article as a whole and ruled
 * out tone, and said nothing about the source's own subject.
 *
 * **The repair is those words, and nothing else free can check that they are
 * still there.** Whether the repair *worked* needs repeated live generation on
 * polarity-inverting sources, which costs money (the plan's § E″, Sol's F70).
 * What a test can do is stop the clause being dropped in a later rewrite and
 * nothing noticing — which is `docs/reusable/silent-success.md`'s shape exactly,
 * since the failure would be invisible until somebody read a chip and believed
 * it.
 *
 * **So these assert on meaning-bearing fragments, not on whole sentences.** A
 * rewrite that says the same thing in different words *should* be free to
 * happen; each check below is therefore the smallest phrase that carries the
 * obligation, and the file says which obligation. If you are here because you
 * reworded the prompt and this went red, the question to answer is not "how do I
 * match the new wording" but "does the new wording still bind the target and
 * still rule out the source's own subject".
 */
import { describe, expect, it } from "vitest";
import { CLAIMS_SYSTEM, DIRECT_SYSTEM } from "../src/debate.js";

/**
 * **Newlines collapsed to spaces before matching.**
 *
 * The prompts are hard-wrapped at 76 characters, so a phrase that reads as one
 * sentence to the model is split by a line break in the source and a plain
 * `toContain` fails on it. That is a property of how the file is typeset, not of
 * what the prompt says, and a test that could be broken by re-wrapping a
 * paragraph would be measuring the wrong thing.
 */
const flat = (prompt: string) => prompt.replace(/\s+/g, " ");

/** Both groups, by the name the plan uses for them. */
const PROMPTS: ReadonlyArray<[string, string]> = [
  ["group one, the direct search", flat(DIRECT_SYSTEM)],
  ["group two, the claims search", flat(CLAIMS_SYSTEM)],
];

describe("every prompt binds this row's target", () => {
  it.each(PROMPTS)("%s names what the lean is toward", (_name, prompt) => {
    expect(prompt).toContain("this row's target");
  });

  /* Group one bound its target **nowhere** before 2026-09-08 — the only hint was
     a comment inside the answer format, `"applies": "what it says about this
     article"`. That is the gap this half closes. */
  it("group one says the target is the article itself", () => {
    expect(flat(DIRECT_SYSTEM)).toContain("THE ARTICLE ITSELF");
  });

  it("group two says the target is the quoted claim", () => {
    expect(flat(CLAIMS_SYSTEM)).toContain("THE CLAIM YOU QUOTED");
  });
});

describe("every prompt rules out the target the bug actually reached for", () => {
  /* The clause with the most evidence behind it: all three known errors are a
     stance toward the outside piece's own subject. */
  it.each(PROMPTS)("%s excludes the outside piece's own subject", (_name, prompt) => {
    expect(prompt).toContain("whatever the outside piece is itself discussing");
  });

  /* The two exclusions that were already there and must not be lost in the
     rewrite that added the third. */
  it.each(PROMPTS)("%s still excludes tone", (_name, prompt) => {
    expect(prompt).toMatch(/\btone\b/);
  });

  it("group two still excludes the article as a whole, which is a different row's target", () => {
    expect(flat(CLAIMS_SYSTEM)).toContain("the article as a whole");
  });
});

describe("the answer vocabulary the prompt shows is the vocabulary the parser accepts", () => {
  /* The failure this is against: a repair that reworded the vocabulary so the
     model answered "supportive" would coerce every row to `cannot-tell`, and
     `cannot-tell` reads as *the wrong label was removed*. The repair would look
     like a success exactly when it had destroyed the field — Sol's F62. This is
     the free half of that check; the paid half is a live run.

     Written out rather than derived from `DebateLean`, deliberately: a check
     that imports the same constant as the code it checks shares its assumption
     and cannot see a change to it. These four strings are the contract. */
  const LEANS = ["leans-for", "leans-against", "neither", "cannot-tell"];

  it.each(PROMPTS)("%s offers exactly the four leans", (_name, prompt) => {
    for (const lean of LEANS) expect(prompt).toContain(lean);
    /* And none of the vocabulary it replaced, which would otherwise sit in an
       example unnoticed and be copied straight back into an answer. */
    for (const old of ["positive", "negative", "neutral", "unknown"]) {
      expect(prompt).not.toContain(`"${old}"`);
    }
  });

  it.each(PROMPTS)("%s asks for the field by its current name", (_name, prompt) => {
    expect(prompt).toContain('"lean"');
    expect(prompt).not.toContain('"valence"');
  });
});

describe("the relation and the lean are asked about the same thing", () => {
  /* Sol's F54. `relation` was scoped to the outside *page* and the lean to the
     *quoted passage* — two subjects on one row, which is its own invitation to
     answer them about two different things. */
  it("scopes relation to the quoted passage, not to the page", () => {
    expect(flat(DIRECT_SYSTEM)).toContain("what the QUOTED PASSAGE does to this row's target");
    expect(flat(CLAIMS_SYSTEM)).toContain("what the QUOTED PASSAGE does to this row's target");
  });

  /* The positive control for this whole file: the two prompts really are two
     different strings, so an assertion passing on both means something. */
  it("is checking two distinct prompts", () => {
    expect(DIRECT_SYSTEM).not.toBe(CLAIMS_SYSTEM);
    expect(DIRECT_SYSTEM.length).toBeGreaterThan(200);
    expect(CLAIMS_SYSTEM.length).toBeGreaterThan(200);
  });
});
