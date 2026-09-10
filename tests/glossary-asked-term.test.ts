/**
 * **The glossary's *Look up a term* box** — what it finds, what it refuses, and
 * which of three different facts a refusal is saying.
 *
 * Built for a reader who asked for one:
 *
 * > I would like to be able to type into a search box in the glossary for a
 * > particular term and for it to look for that term and add it to the
 * > glossary. And maybe it should be a tiny bit robust in the spelling or
 * > something if I type it wrong.
 * >
 * > — a reader, 2026-09-04, `[SPIDERYARN-READING2-Y]`
 *
 * Two halves of that request are deliberately not built, and this file pins
 * both:
 *
 * - **"add it to the glossary"** — nothing is stored. `AskedTermAnswer` in
 *   src/types.ts has the three reasons; the sharpest is that
 *   src/store/public-reader.ts publishes the whole glossary document to
 *   everyone a shared article is shared with, so a reader-added entry would
 *   leave with it.
 * - **"robust in the spelling"** — the tolerance is exactly `term-match.ts`'s
 *   folding of case, plurals and possessives, and there is no fuzzy matching
 *   and no *"did you mean…"*. The cases below say what that does and does not
 *   buy, so a later change that quietly adds edit distance has to argue with a
 *   test rather than with a comment.
 *
 * **Three refusals, three codes**, and they are three because
 * docs/postmortems/260904c-the-glossary-said-the-term-was-not-there.md was
 * written a day earlier about this exact code path, and its named class is
 * *collapsed diagnosis*: several causes that want different actions, refused
 * with one sentence that cannot be true of all of them.
 *
 *   1. `[gl-ask-absent]` — the words are nowhere. Chat is the way through.
 *   2. `[gl-ask-part-word]` — the characters are there, always inside a longer
 *      word. The reader can retype it as the piece writes it.
 *   3. `[gl-ask-no-prose]` — nothing was searched, so nothing is claimed.
 *
 * **Matched on the bracketed code, never on the sentence** — docs/project/copy.md
 * § The bracketed code. Rewording the copy must not turn this file red; changing
 * which branch fires must.
 */
import { describe, expect, it } from "vitest";

import { MAX_ASKED_TERM } from "../src/asked-term.js";
import type { ExplainEnding } from "../src/explain.js";
import { type AskedTermQuestion, makeAskAboutTerm } from "../src/term-lookup.js";
import { MAX_TERM } from "../src/vocabulary.js";
import type { Article, AskedTermAnswer, Block, Tree } from "../src/types.js";

/** One paragraph, with an id a test can name. */
function para(id: string, text: string): Block {
  return {
    id: id as Block["id"],
    kind: "text",
    tag: "p",
    gistable: true,
    html: `<p>${text}</p>`,
    text,
    words: text.split(/\s+/).length,
  };
}

/**
 * A block with no words in it — a picture, an embed.
 *
 * **A real `Block`, with no cast.** The first version of this helper invented
 * `kind: "figure"` and left `text` out, hidden behind `as unknown as Block` — so
 * it pinned the branch while saying nothing about whether a *stored* article can
 * reach it. `media` is in `BlockKind` and `text` is a required `string`, so the
 * empty string is what a picture actually carries, and that is what
 * `[gl-ask-no-prose]` is asked about. GPT Sol's review.
 */
function media(id: string): Block {
  return {
    id: id as Block["id"],
    kind: "media",
    tag: "figure",
    gistable: false,
    html: '<figure><img alt=""></figure>',
    text: "",
    words: 0,
  };
}

/**
 * An article and an `explain` that records what it was asked.
 *
 * `loadArticle` can be made to throw the way an owner-filtered read does, which
 * is how the ownership case below is driven — see it for why that is the real
 * check and not a stand-in for one.
 */
function harness(
  opts: { blocks?: Block[]; notYours?: boolean; ending?: ExplainEnding } = {},
) {
  const blocks = opts.blocks ?? [para("spya-aaaaaa", "An opening paragraph.")];
  const meta = { slug: "harness", title: "A piece" };
  const tree = { rootId: blocks[0]?.id, nodes: {} } as unknown as Tree;
  const article = { meta, blocks, tree } as unknown as Article;

  const asked: { blockId: string; quote: string }[] = [];

  const prepare = makeAskAboutTerm({
    reader: {
      loadArticle: async () => {
        if (opts.notYours) {
          /* Exactly what `ownedSlug` produces for a slug that is not the
             reader's: not a 403, because the existence of somebody else's
             article is not ours to confirm. src/store/pg.ts § `notFound`. */
          throw Object.assign(new Error('No article "harness".'), { status: 404 });
        }
        return article;
      },
    },
    /* Two deltas and a `done`, the shape `explainStream` promises, ending the
       way `opts.ending` says. `abandoned`, `truncated` and `filtered` are the
       three that `explainStream` hands back as `done` carrying half an answer —
       what it really does, src/explain.ts § the `switch` on `outcome.kind`. See
       "an answer that stopped part-way" below. */
    explainStream: async function* (req) {
      asked.push({ blockId: req.blockId, quote: req.quote });
      yield { type: "delta", text: "An " };
      yield { type: "delta", text: "answer." };
      yield {
        type: "done",
        ending: opts.ending ?? "finished",
        answer: "An answer.",
        citations: [
          { url: "https://example.org/a", title: "A" },
          { url: "javascript:alert(1)", title: "Not a link" },
        ],
        searches: 1,
        model: "a-model",
      };
    },
    now: () => "2026-09-04T00:00:00.000Z",
  });

  /** Refuse or answer, drained — what the JSON route used to hand back. */
  const ask = async (slug: string, term: unknown, signal?: AbortSignal) =>
    drain(await prepare(slug, term), signal);

  return { ask, prepare, asked };
}

/**
 * The one `done`'s answer, or a throw. **A stream that ends without `done`
 * throws too**, so a test cannot mistake a stopped stream for an answer.
 */
async function drain(question: AskedTermQuestion, signal?: AbortSignal): Promise<AskedTermAnswer> {
  let answer: AskedTermAnswer | undefined;
  for await (const event of question.stream(signal)) {
    if (event.type === "done") answer = event.answer;
  }
  if (!answer) throw new Error("the stream ended without a done");
  return answer;
}

/**
 * The failure, with its status — **settled into a value before anything is
 * thrown.**
 *
 * `tests/glossary-lookup-refusals.test.ts` has the argument: the obvious
 * `try`/`catch` version reports a call that wrongly *answered* as a refusal
 * whose message happens not to match, which is a green test over a broken
 * feature.
 */
async function refusal(work: Promise<unknown>): Promise<{ status?: number; message: string }> {
  const outcome = await work.then(
    () => ({ refused: false }) as const,
    (err: Error & { status?: number }) => ({ refused: true, err }) as const,
  );
  if (!outcome.refused) throw new Error("expected a refusal and got an answer");
  return {
    ...(outcome.err.status === undefined ? {} : { status: outcome.err.status }),
    message: outcome.err.message,
  };
}

describe("a term the article uses", () => {
  const blocks = [
    para("spya-aaaaaa", "An opening paragraph about nothing in particular."),
    para("spya-bbbbbb", "Later the piece discusses Attention Heads at some length."),
    para("spya-cccccc", "And attention heads again, here."),
  ];

  it("finds it through a difference of case and a plural", async () => {
    /* The whole of "a tiny bit robust in the spelling": `term-match.ts` folds
       case and a trailing plural, and that is the entirety of the tolerance.
       The reader types the singular in lower case; the piece says the plural
       capitalised. */
    const { ask, asked } = harness({ blocks });
    const answer = await ask("harness", "attention head");
    expect(answer.blockId).toBe("spya-bbbbbb");
    expect(asked).toHaveLength(1);
  });

  it("quotes the article's own words, not the reader's", async () => {
    /* **The passage the model is told about has to be text that is there.**
       Handing it "attention head" against a block that says "Attention Heads"
       is a false premise given to a model asked to reason from it — the fault
       `anchorIn`'s docstring records about the entry's canonical name, met
       again from the other side. It has a second effect worth having: the
       reader's own string never reaches the model at all. */
    const { ask, asked } = harness({ blocks });
    const answer = await ask("harness", "attention head");
    expect(answer.quote).toBe("Attention Heads");
    expect(asked[0]?.quote).toBe("Attention Heads");
  });

  it("anchors to the term's first use, in document order", async () => {
    const { ask } = harness({ blocks });
    expect((await ask("harness", "ATTENTION HEADS")).blockId).toBe("spya-bbbbbb");
  });

  it("normalises what was typed without rewriting the word", async () => {
    /* Padding and a doubled space are typing, not a different term. Nothing
       else about the string is changed: NFC is an encoding, not a spelling. */
    const { ask } = harness({ blocks });
    expect((await ask("harness", "  attention   heads \n")).term).toBe("attention heads");
  });

  it("keeps nothing — the answer is the whole of what happens", async () => {
    /* **The deferral, asserted rather than commented.** There is no store on
       `AskAboutTermDeps` at all, so this is a statement about the *type* as much
       as the value: a later change that adds persistence has to add a seam here,
       and adding one is the moment somebody has to answer
       src/store/public-reader.ts. */
    const { ask } = harness({ blocks });
    const answer = await ask("harness", "attention heads");
    expect(Object.keys(answer).sort()).toEqual(["blockId", "lookup", "quote", "term"]);
    expect(answer.lookup.searches).toBe(1);
  });

  it("filters a citation that is not a web address before it reaches an href", async () => {
    const { ask } = harness({ blocks });
    const answer = await ask("harness", "attention heads");
    expect(answer.lookup.citations.map((c) => c.url)).toEqual(["https://example.org/a"]);
  });
});

describe("an answer that stopped part-way", () => {
  const blocks = [para("spya-aaaaaa", "The piece discusses Attention Heads.")];

  /** The events a stream yields before it ends, and how it ended. */
  async function run(ending: ExplainEnding): Promise<{ seen: string[]; ended: string }> {
    const { prepare } = harness({ blocks, ending });
    const question = await prepare("harness", "attention heads");
    const seen: string[] = [];
    const ended = await (async () => {
      for await (const event of question.stream()) seen.push(event.type);
    })().then(
      () => "finished",
      (err: Error) => err.message,
    );
    return { seen, ended };
  }

  it("knows where the term is before the model is asked anything", async () => {
    /* The route sends `found` as its `begin` frame before the first word, so
       it has to exist before the stream starts — and it has to be the
       article's characters, since it is drawn as a quotation. */
    const { prepare, asked } = harness({ blocks });
    const question = await prepare("harness", "ATTENTION HEAD");
    expect(question.found).toEqual({
      term: "ATTENTION HEAD",
      blockId: "spya-aaaaaa",
      quote: "Attention Heads",
    });
    expect(asked).toEqual([]);
  });

  it("never finishes with the half that had arrived when the reader left", async () => {
    /* **The contract, and an ending `explainStream` treats differently.** An
       abandoned explanation *finishes* there, carrying what arrived — right for
       a comment, wrong here, where the only reader of a `done` is a panel that
       would draw it as a finished answer. */
    const { seen, ended } = await run("abandoned");
    expect(ended).not.toBe("finished");
    expect(seen).toEqual(["delta", "delta"]);
  });

  it("refuses an answer that ran out of room, with its own code", async () => {
    /* GPT Sol's finding on the plan: the first draft checked only the reader's
       signal, and a 1,500-token ceiling reached mid-sentence came out as a
       whole answer. */
    const { seen, ended } = await run("truncated");
    expect(ended).toMatch(/\[gl-cut-off\]/);
    expect(seen).not.toContain("done");
  });

  it("refuses an answer the provider's filter stopped", async () => {
    const { seen, ended } = await run("filtered");
    expect(ended).toMatch(/\[ai-filtered\]/);
    expect(seen).not.toContain("done");
  });

  it("finishes normally on the endings explainStream calls clean", async () => {
    /* The control: without it, a stream that never finished at all would pass
       every case above. */
    for (const ending of ["finished", "unknown-finish-reason", "wants-tools"] as const) {
      const { seen, ended } = await run(ending);
      expect(ended, ending).toBe("finished");
      expect(seen, ending).toEqual(["delta", "delta", "done"]);
    }
  });
});

describe("a term the article does not use", () => {
  it("says the words are absent, and refuses before spending", async () => {
    const { ask, asked } = harness({
      blocks: [para("spya-aaaaaa", "A paragraph about types and nothing else.")],
    });
    const { status, message } = await refusal(ask("harness", "attention heads"));
    expect(status).toBe(409);
    expect(message).toMatch(/\[gl-ask-absent\]/);
    /* Stated everywhere and asserted here: a refusal that calls the model first
       and then throws the right code passes every other case in this file and
       costs real money on every press. */
    expect(asked).toEqual([]);
  });

  it("does not name the term back at the reader", async () => {
    /* The reported bug of 2026-09-04 in its other habitat. The term is in the
       box a line above the message; a sentence repeating it reads as a denial
       of what the reader is looking at rather than a fact about the article. */
    const { ask } = harness({
      blocks: [para("spya-aaaaaa", "A paragraph about types and nothing else.")],
    });
    const { message } = await refusal(ask("harness", "Barbara Liskov"));
    expect(message).not.toContain("Barbara Liskov");
  });

  it("does not offer a guess at what was meant", async () => {
    /* **No "did you mean…", deliberately.** The matcher gives no typo tolerance
       whatever, and the word a reader wants is as often a lowercase idea as a
       proper noun, so there is no candidate list worth ranking. A guess here
       would be the postmortem's fault in a friendlier tone: copy that diagnoses
       past its evidence. */
    const { ask } = harness({
      blocks: [para("spya-aaaaaa", "A paragraph about Barbara Liskov's substitution rule.")],
    });
    const { message } = await refusal(ask("harness", "Barbra Liskov"));
    expect(message).toMatch(/\[gl-ask-absent\]/);
    expect(message).not.toMatch(/did you mean/i);
  });
});

describe("a term that is only ever part of a longer word", () => {
  /**
   * **The second cause, and the reason there are three sentences and not one.**
   *
   * *The piece never says this* and *the piece says this inside a longer word*
   * want different things from the reader — chat, and a retype — so one sentence
   * cannot be true of both. Collapsing them is the class named in
   * docs/postmortems/260904c-the-glossary-said-the-term-was-not-there.md.
   */
  it("says the characters are there rather than that the words are not", async () => {
    const { ask, asked } = harness({
      blocks: [para("spya-aaaaaa", "The argument is axiomatic throughout.")],
    });
    const { status, message } = await refusal(ask("harness", "axiom"));
    expect(status).toBe(409);
    expect(message).toMatch(/\[gl-ask-part-word\]/);
    expect(asked).toEqual([]);
  });

  it("is not reached when the word stands on its own", async () => {
    /* The control. A piece that contains both the whole word and a longer one
       built from it answers rather than refusing, because the matcher found a
       real occurrence — which is what makes the branch above a diagnosis rather
       than a substring test that fires whenever it can. */
    const { ask } = harness({
      blocks: [para("spya-aaaaaa", "An axiom, stated axiomatically.")],
    });
    expect((await ask("harness", "axiom")).quote).toBe("axiom");
  });

  it("fires on a term whose own edge is punctuation, and does not say 'word'", async () => {
    /* **The counterexample that rewrote this sentence.** GPT Sol's review of the
       built code: `-bar` against a piece that says `foo-bar` fails the bounded
       scan — the character before the hyphen is a letter — and passes the loose
       one. The draft copy said the characters were *"every time inside a longer
       word"*, which is false here: `-bar` is right there, starting with its own
       separator.

       What the scan actually establishes, in this case and every other, is that
       a letter or a digit is run up against the characters. That is what the
       sentence claims now, and pinning the branch alone would not have caught
       the difference — so this asserts the claim as well as the code.

       A plain-language phrase rather than the whole sentence, so a rewrite that
       keeps the meaning stays green and one that goes back to asserting a word
       does not. */
    const { ask, asked } = harness({
      blocks: [para("spya-aaaaaa", "Everything here is configured through foo-bar.")],
    });
    const { message } = await refusal(ask("harness", "-bar"));
    expect(message).toMatch(/\[gl-ask-part-word\]/);
    expect(message).not.toMatch(/inside a longer word/);
    expect(message).toMatch(/letter or a digit/);
    expect(asked).toEqual([]);
  });
});

describe("an article with nothing to search", () => {
  it("says nothing was searched rather than that the term is absent", async () => {
    /* **Not a claim about the term.** Without this branch an article the
       extractor left with no prose would answer every question with "the piece
       does not use those words" — a confident sentence over an empty scan,
       which is the reported bug's exact shape. */
    const { ask, asked } = harness({ blocks: [media("spya-aaaaaa")] });
    const { status, message } = await refusal(ask("harness", "attention heads"));
    expect(status).toBe(409);
    expect(message).toMatch(/\[gl-ask-no-prose\]/);
    expect(asked).toEqual([]);
  });
});

describe("what the box will not accept", () => {
  it("refuses an empty term with a 400 and no model call", async () => {
    const { ask, asked } = harness();
    expect((await refusal(ask("harness", "   \n  "))).status).toBe(400);
    expect(asked).toEqual([]);
  });

  it("refuses a term longer than the vocabulary bound", async () => {
    /* The same eighty characters a dictation vocabulary allows one term —
       src/vocabulary.ts § `MAX_TERM`, aliased rather than restated. Measured
       after normalising, so the length is the term's and not the typing's. */
    const { ask } = harness();
    const long = "a".repeat(MAX_ASKED_TERM + 1);
    expect((await refusal(ask("harness", long))).status).toBe(400);
    /* And exactly at the bound it is a term, not junk — an off-by-one here is
       a rejection nobody could explain. It is absent from this article, which
       is a 409 and therefore proof it got past the 400. */
    const { message } = await refusal(ask("harness", "a".repeat(MAX_ASKED_TERM)));
    expect(message).toMatch(/\[gl-ask-absent\]/);
  });

  it("refuses control and formatting characters", async () => {
    /* Bidirectional overrides among them: a string that renders as something
       other than what it is has no business in a regex builder, a log line or a
       panel. Nothing a reader can type on purpose is lost. */
    const { ask, asked } = harness();
    expect((await refusal(ask("harness", "atten\u0000tion"))).status).toBe(400);
    expect((await refusal(ask("harness", "atten\u202Etion"))).status).toBe(400);
    expect(asked).toEqual([]);
  });

  it("refuses a body with no term in it at all", async () => {
    const { ask } = harness();
    expect((await refusal(ask("harness", undefined))).status).toBe(400);
    expect((await refusal(ask("harness", { term: "attention heads" }))).status).toBe(400);
  });
});

describe("the two eighties are one number", () => {
  it("keeps the box's bound and the dictation vocabulary's in step", () => {
    /* **A test rather than a comment, because the import that would have made
       it structural is forbidden.** `asked-term.ts` reaches the browser, so it
       has to import nothing (`tests/client-imports.test.ts`) — and importing
       `vocabulary.ts` for one number would put four hundred lines of dictation
       assembly into the client bundle. So the eighty is written out in both
       places and this is what stops them drifting.

       They are two questions with one answer — *how long may one entry of a
       dictation vocabulary be* and *how long may a term a reader types be* — so
       the day they part company, this failing is the right outcome and somebody
       decides which moves. */
    expect(MAX_ASKED_TERM).toBe(MAX_TERM);
  });
});

describe("somebody else's article", () => {
  /**
   * **The ownership check is `loadArticle`**, which under Postgres joins through
   * `ownedSlug` (src/store/pg.ts) and 404s a slug that is not the reader's. It
   * is the same check `lookUpTerm` relies on, and there is deliberately not a
   * second one: two ways of asking is a second thing to get wrong.
   */
  it("is refused before the term is even looked at", async () => {
    /* **The order is the assertion.** A stranger sending junk must get the 404,
       not a 400 — otherwise the shape of the error says whether the article
       exists, and a bad term becomes an oracle for somebody else's library. */
    const { ask, asked } = harness({ notYours: true });
    const { status } = await refusal(ask("harness", ""));
    expect(status).toBe(404);
    expect(asked).toEqual([]);
  });

  it("is refused for a term the article really does contain", async () => {
    const { ask, asked } = harness({
      blocks: [para("spya-aaaaaa", "A paragraph about Attention Heads.")],
      notYours: true,
    });
    expect((await refusal(ask("harness", "attention heads"))).status).toBe(404);
    expect(asked).toEqual([]);
  });
});
