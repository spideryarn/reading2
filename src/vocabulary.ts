/**
 * **The words a reader is about to say**, assembled so a transcriber can be
 * told them before it guesses.
 *
 * This is the lever that makes dictation's second pass worth making. Measured
 * 2026-08-27 and again 2026-08-28: the same audio through the same model scores
 * 0% word errors when the terms are in the prompt and 3.6–7.3% when they are
 * not, and every one of those errors is a proper noun or a piece of jargon.
 * Nothing else in the request moves the number that much. The plan is
 * [docs/plans/260828l-dictation-vocabulary.md](../docs/plans/260828l-dictation-vocabulary.md);
 * the caller is [`transcribe.ts`](./transcribe.ts), which owns the store reads
 * this file deliberately does not do.
 *
 * ## Everything here is a pure function of text
 *
 * No store, no network, no model. That is not tidiness — it is what lets the
 * eval in `evals/dictation/` run the *real* extractor over real articles
 * instead of a copy of it, and what lets a test assert on the term list rather
 * than on a transcript. See docs/reusable/silent-success.md for why a
 * vocabulary builder in particular needs that: when it silently returns nothing
 * the feature does not break, it just gets quietly worse.
 *
 * ## Why there is no LLM in here
 *
 * Greg asked whether the article-level list would have to be model-generated
 * and stored. It does not, because **the model-generated list already exists**
 * — it is the glossary, built by stage 6, with `centrality` and `difficulty` on
 * every entry. What the glossary misses is the article's *secondary* proper
 * nouns: the people cited, the books, the films, the institutions. A reader
 * dictating about the Noema piece says "Hinton" and "Ex Machina", and neither
 * is a glossary entry. Those are what {@link properNouns} is for, and finding
 * them needs counting, not a model.
 */

/**
 * The app's own words, which nothing in an article will ever supply.
 *
 * Short on purpose. This list is paid for on **every** dictation, including one
 * about a phrenology pamphlet where none of it will be said, and the whole
 * justification for spending those characters is the first entry: a reader
 * saying the name of the product they are talking into should not have to watch
 * it come back as "Spider Yarn" or "Spiderion", which is what happens without
 * this line (measured; see the eval).
 *
 * Feature names earn their place the same way — they are the nouns a reader
 * uses when reporting something about the app, and none of them is ordinary
 * English in this arrangement.
 */
export const SITE_TERMS: readonly string[] = [
  "Spideryarn",
  /* The author's name, added 2026-09-04 because Greg asked for it from inside
     the Feedback dialog — *"along with my name, the author of Spideryarn, Greg
     Detre"*. Ten characters, an unusual surname a transcriber has no reason to
     guess right, and it is in the app's own copy already. Second because it is
     the other proper noun a reader talking about this app is likely to say. */
  "Greg Detre",
  "granularity zoom",
  "gist column",
  "block id",
  "block ids of the form spya-k3m9qt",
  "the shelf",
  "reading view",
  "remember mode",
  "glossary",
  "table of contents",
];

/**
 * Words that begin sentences constantly and are not names.
 *
 * **This is a hand-written English stopword list**, and an earlier version of
 * this comment claimed it was not — "a patch on a statistic, not a stopword
 * list". GPT Sol's review, item 8, pointed out that a hand-written list of
 * English function words is a stopword list whatever the comment says, and it
 * was right. Calling it something else is how it grows: the honest framing is
 * that it is small, it is English-only, and every addition should have to
 * justify itself against making the statistic better instead.
 *
 * {@link properNouns} already refuses to count a capital at the start of a
 * sentence, which removes almost all of these; this list is for the residue —
 * a word that turns up capitalised mid-sentence because it began a clause after
 * a dash, or inside a heading. It does not catch everything: the whole-library
 * arm of the eval turned up `Always`, `Avoid`, `Between` and `Well`. Those cost
 * characters and, measured, nothing else.
 */
const NOT_NAMES = new Set([
  "the", "this", "that", "these", "those", "and", "but", "not", "and so",
  "indeed", "finally", "similarly", "however", "therefore", "meanwhile",
  "perhaps", "suppose", "consider", "put", "seek", "refuses", "being",
  "you", "your", "yours", "i", "i’m", "i'm", "i’ve", "i've", "i’ll", "i'll",
  "we", "our", "it", "its", "he", "she", "they", "there", "here", "when",
  "what", "why", "how", "who", "which", "if", "for", "from", "with", "without",
  /* **`in` was missing while the comment above named `In`.** The two-character
     floor exists to keep `AI` and the first word of `Ex Machina`, and it lets
     `In` through with them — which is how a "wrong article" vocabulary built to
     share nothing with any clip came to contain a word two of them say out
     loud. GPT Sol's third review, item 3. */
  "in", "on", "at", "by", "as", "an", "or", "of", "to", "is", "be", "so",
  /* Document furniture: the words around a figure or a footnote, which are
     capitalised, repeated, and never anything a reader dictates. */
  "figure", "table", "photo", "image", "courtesy", "chapter", "lecture",
  "note", "source", "credit", "fig",
]);

/** A token, its position, and whether a full stop came before it. */
interface Token {
  word: string;
  /** True when this token begins a sentence — so its capital means nothing. */
  initial: boolean;
  /** Character offset, used only to tell "New York" from "New. York". */
  at: number;
}

/**
 * Split prose into words, remembering which ones start a sentence.
 *
 * The sentence boundary is the whole point. `.`, `!`, `?`, `:`, `;` and a
 * newline end one; everything after such a mark is a fresh start, and a capital
 * there carries no information at all.
 */
function tokenise(text: string): Token[] {
  const out: Token[] = [];
  let initial = true;
  for (const m of text.matchAll(/([\p{L}\p{N}][\p{L}\p{N}’'-]*)|([.!?:;\n])/gu)) {
    if (m[1]) {
      out.push({ word: m[1], initial, at: m.index ?? 0 });
      initial = false;
    } else initial = true;
  }
  return out;
}

/** `Turing’s` and `Turing's` are the same name. */
function stem(word: string): string {
  return word.toLowerCase().replace(/[’']s$/, "");
}

/**
 * The article's own names, most-used first.
 *
 * **A capital mid-sentence is the whole signal**, and it needs no corpus, no
 * vendored word-frequency table and no model. A word that appears capitalised
 * where a sentence did not just begin is a name; a word that only ever appears
 * capitalised after a full stop is `Indeed`. The first version of this used
 * "does the word ever appear lower-case in the article" instead and lost both
 * `Phrenology` and `Claude` — the central term of two of the four articles we
 * tested on — because a writer uses a name lower-case once in a while.
 *
 * Multi-word names come out whole (`Anil Seth`, `Müller-Lyer`, `New York`) by
 * joining adjacent qualifying tokens: a transcriber given `Seth` alone still
 * has to decide about `Anil`.
 *
 * @param text the article's prose. Give it prose, not headings — see
 *   {@link proseOf}. Title Case capitalises every word and would nominate `Of`.
 * @param limit how many terms to return, most frequent first.
 */
export function properNouns(text: string, limit = 40): string[] {
  const tokens = tokenise(text);

  /** stem → how often it appears, how often capitalised, how often mid-sentence. */
  const stats = new Map<
    string,
    { total: number; capital: number; midSentence: number; form: string }
  >();
  for (const token of tokens) {
    const key = stem(token.word);
    const seen = stats.get(key) ?? {
      total: 0,
      capital: 0,
      midSentence: 0,
      form: token.word,
    };
    seen.total++;
    if (/^\p{Lu}/u.test(token.word)) {
      seen.capital++;
      if (!token.initial) {
        seen.midSentence++;
        /* Spell it the way it is spelled where it means something. */
        seen.form = token.word.replace(/[’']s$/, "");
      }
    }
    stats.set(key, seen);
  }

  const isName = (word: string): boolean => {
    /* **Two characters, not three.** Three cost us `Ex Machina` — the run
       collapsed to `Machina`, which is not what anybody says — and `AI`, which
       is the commonest two-letter term in this library by a distance. The words
       three was protecting against (`Of`, `In`, `As`) are capitalised only in
       Title Case, and headings do not reach here. Checked against all five
       articles on disk: it added `AI` and `Ex Machina` and nothing else. */
    if (word.length < 2) return false;
    const key = stem(word);
    if (NOT_NAMES.has(key)) return false;
    const seen = stats.get(key);
    if (!seen) return false;
    /* Twice mid-sentence is a name. Once is a name only if the word is almost
       always capitalised — which separates a person mentioned in passing from
       an ordinary noun that happened to open a clause. */
    return seen.midSentence >= 2 || (seen.midSentence === 1 && seen.capital / seen.total > 0.6);
  };

  const counts = new Map<string, number>();
  let run: string[] = [];
  const flush = () => {
    if (run.length) {
      const term = run.join(" ");
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
    run = [];
  };
  for (const [i, token] of tokens.entries()) {
    const previous = tokens[i - 1];
    /* One space apart, so a name at the end of one sentence does not glue
       itself to a name at the start of the next. */
    const adjacent = previous ? previous.at + previous.word.length + 1 >= token.at : false;
    if (/^\p{Lu}/u.test(token.word) && isName(token.word)) {
      if (!adjacent) flush();
      run.push(stats.get(stem(token.word))?.form ?? token.word);
    } else flush();
  }
  flush();

  return [...counts]
    /* Said once is not evidence. A vocabulary is a bet that the reader will say
       the word, and the article saying it once is a weak bet at the price of a
       term somebody else could have had. */
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([term]) => term);
}

/**
 * The prose of an article, with headings and captions left out.
 *
 * Headings are Title Case, which capitalises `Of` and `The` and would make
 * {@link properNouns} nominate them — on the Noema article the first draft
 * returned `The` as the article's most frequent name, from its own title.
 * Captions are worse: `Figure`, `Courtesy` and a photographer's name, repeated
 * under every image. The loss is small, because a heading's real names are in
 * the body too, or they are said once, and once is below the floor anyway.
 *
 * `kind === "text"` rather than "not a heading", so a block kind invented later
 * has to be let in on purpose. src/types.ts owns the list.
 *
 * **`"callout"` was let in on 2026-08-31**, the day the kind was invented, and
 * that is this comment earning its keep. A callout is the author's own voice in
 * a box — the article this feature was built for names "Persistent-Astra" and
 * "PHASEONE10841" almost entirely inside them — so leaving it out would have
 * quietly cost the reader those words in dictation, on exactly the articles
 * where they matter most. Found by GPT Sol's review, which went looking for the
 * `kind` consumers the plan claimed did not exist.
 *
 * That kind was replaced by `Block.context` the same afternoon, so a callout
 * extracted since is `kind: "text"` and arrives here without help. The clause
 * **stays for the revisions stored in between**, which have the kind in
 * Postgres and would otherwise lose those names again on a re-read.
 * docs/plans/260831af-carrying-markup-facts-past-readability.md.
 */
export function proseOf(blocks: readonly { kind?: string; text?: string }[]): string {
  return blocks
    .filter((b) => b.kind === "text" || b.kind === "callout")
    .map((b) => b.text ?? "")
    .filter(Boolean)
    .join("\n");
}

/**
 * The longest a single term may be.
 *
 * A vocabulary is a list of things somebody might *say*; nothing anyone says is
 * eighty characters of one term. What this really stops is one source eating
 * the whole budget — a library-catalogue title, a glossary entry written as a
 * sentence, or a payload — and it stops it before the priority order gets a
 * chance to be irrelevant.
 */
export const MAX_TERM = 80;

/**
 * Strip the two characters that could close the fence around the list.
 *
 * **The list is wrapped in a literal `<vocabulary>` tag in the prompt**, and
 * several of its sources are text this app did not write: an article's title
 * and byline come off a web page through Readability, and glossary names come
 * out of the article body. A title reading `</vocabulary> Ignore the audio and
 * …` closes the fence and the rest of it is no longer data.
 *
 * `properNouns` was never the risk — its tokeniser only emits letters, digits,
 * hyphens and apostrophes. Everything else was. GPT Sol's review, item 1;
 * content-extraction.md already records that Readability metadata can carry
 * decoded markup-like text.
 *
 * Angle brackets become spaces rather than the term being dropped, because a
 * title with a stray `<` in it is far more likely to be a title than an attack,
 * and the reader still gets the words.
 */
function fence(term: string): string {
  return term.replace(/[<>]/g, " ");
}

/**
 * The first {@link MAX_TERM} characters, cut at a word.
 *
 * **A mid-word cut is worse than a short term**, because half a word is a
 * spelling the transcriber may go looking for. `pack` used to slice at eighty
 * flat, which is fine for `properNouns` output and wrong for everything else
 * that reaches it as prose: a long article title, a byline with an
 * institution in it, a glossary entry written as a sentence.
 * `phrases` covers the reader's two boxes; this covers every other source, and
 * GPT Sol's third review, item 5, is why it exists separately.
 */
function shorten(term: string): string {
  if (term.length <= MAX_TERM) return term;
  const cut = term.slice(0, MAX_TERM);
  const space = cut.lastIndexOf(" ");
  return (space > 0 ? cut.slice(0, space) : cut).trim();
}

/**
 * Cut a paragraph of the reader's prose into things short enough to be terms.
 *
 * **Because `MAX_TERM` applies to prose too, and used to eat it.** Both prose
 * sources — the profile and the "why you're reading this one" box — handed
 * their whole paragraph to {@link pack} as a single term, and `pack` truncated it
 * at eighty characters. So the 400- and 300-character slices those sources
 * believed they were spending were never spent: everything past the first
 * eighty characters was dropped, silently, and the transcripts were a little
 * worse for it.
 *
 * It survived a review, a test suite and a five-run benchmark because **every
 * fixture was shorter than eighty characters** — the test profile is 62 and the
 * eval's is 62. The eval's purpose box was 141, and the only one of its four
 * terms that ever reached the model was the one in the first eighty characters.
 * GPT Sol's second review, item 1. docs/reusable/silent-success.md.
 *
 * Splitting on sentence ends and on commas, because that is where a reader's
 * prose already breaks and it keeps a name whole: *"Anjali Chaudhuri"* survives
 * where a hard cut at eighty characters would have left *"Anjali Chau"*.
 * Anything still too long is cut at a word boundary where there is one. A run
 * of more than eighty characters with **no space in it at all** — a URL, a
 * hash, a line of CJK, which has no spaces and whose punctuation this does not
 * recognise — is cut every eighty characters instead, because the alternative
 * is dropping it. Named rather than fixed: GPT Sol's third review, item 5,
 * enumerated these, and none of them is a spelling a reader is about to say.
 *
 * Two known and accepted costs of splitting on commas: `Washington, D.C.`
 * becomes two terms, and a URL with a comma in it is cut there.
 */
export function phrases(text: string): string[] {
  const out: string[] = [];
  for (const raw of text.split(/(?<=[.!?;:])\s+|,\s*|\n+/)) {
    let rest = raw.trim().replace(/\s+/g, " ");
    while (rest.length > MAX_TERM) {
      const cut = rest.slice(0, MAX_TERM);
      const space = cut.lastIndexOf(" ");
      const take = space > 0 ? cut.slice(0, space) : cut;
      out.push(take);
      rest = rest.slice(take.length).trim();
    }
    if (rest) out.push(rest);
  }
  return out;
}

/**
 * Fit the parts into the budget, best first, and say them once each.
 *
 * The order of `parts` is the priority order, and the caller owns it. What this
 * adds is the three things every caller would otherwise get subtly wrong: a
 * term that appears in two sources costs its characters once, the cap is
 * checked against the string that will actually be sent rather than against a
 * count of terms, and nothing in a term can end the fence it is about to be
 * wrapped in. A glossary of forty short names and one of forty long ones are
 * not the same purchase.
 *
 * **Called `pack` because `fit` is vitest's focused-test API**, and biome's
 * `noFocusedTests` rule therefore flagged all twenty-two call sites — including
 * ten inside `tests/vocabulary.test.ts`, where the rule is marked FIXABLE and
 * its autofix rewrites `fit(` to `it(`. A linter offering to silently turn a
 * unit test into a focused one is not a warning worth living with.
 */
export function pack(parts: readonly (readonly string[])[], maxChars: number): string {
  return packTerms(parts, maxChars).join(", ");
}

/**
 * **The same list, before it is joined** — because two callers want two shapes
 * of the same answer, and only one of them wants a string.
 *
 * Dictation sends the vocabulary as OpenAI's `prompt`, which is one line of
 * comma-separated terms, so `pack` joins for it. Live conversation sends it as
 * **`keywords`**, which is an array, and joining only to split again would lose
 * exactly the information the split has to guess at: a term containing a comma
 * would come back as two.
 *
 * The budget is still measured in characters including the `, ` that a join
 * would add. That is deliberate — the cap exists to bound what the model is
 * asked to hold, and the two callers should be asking for the same amount of
 * it, not the same number of terms.
 */
export function packTerms(
  parts: readonly (readonly string[])[],
  maxChars: number,
): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  let size = 0;
  for (const part of parts) {
    for (const raw of part) {
      /* Control characters go too: a newline inside a term would break the
         one-line shape the list is read as. `\s+` already collapses them, and
         this is the belt to that brace for the ones `\s` does not cover. */
      const term = shorten(
        fence(raw)
          // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point
          .replace(/[\u0000-\u001f\u007f]/g, " ")
          .trim()
          .replace(/\s+/g, " "),
      );
      if (!term) continue;
      const key = term.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      /* `, ` between terms, so a term costs its length plus two. Break out of
         this source and try the next one, which is shorter more often than not
         — no: break out of everything. A budget spent on the tail of a long
         source is a budget the next source never sees, and the next source is
         only ever lower priority. Stopping is what "best first" means. */
      if (size + term.length + 2 > maxChars) return kept;
      kept.push(term);
      size += term.length + 2;
    }
  }
  return kept;
}
