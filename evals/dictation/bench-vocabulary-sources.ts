/**
 * **Where should the vocabulary come from, and how much of it is too much?**
 *
 *   npx tsx evals/dictation/bench-vocabulary-sources.ts
 *
 * The earlier `bench-vocabulary.mjs` settled that a vocabulary helps at all,
 * against one hand-written list. This one asks the next question: which
 * *sources* are worth reading, and — the part nobody measures — whether a big
 * list starts putting words in the reader's mouth.
 *
 * ## It imports the real builder
 *
 * `src/vocabulary.ts`, not a copy of it. An eval that reimplements the thing it
 * is measuring can only tell you about the reimplementation, and the number it
 * produces goes on to justify shipping the other one. Everything below the
 * condition list is scoring; the term lists themselves are the app's.
 *
 * ## Three numbers, and the third is the one to watch
 *
 * - **WER** over the whole utterance, which is the usual figure and the least
 *   interesting: a nine-word error on a proper noun barely moves it.
 * - **Recall** of the terms whose spelling is actually the point.
 * - **Invented**: vocabulary terms that appear in a transcript of an utterance
 *   that did not contain them. This is the cost side of the trade, it can only
 *   be seen by having a control clip with no jargon in it at all, and a
 *   vocabulary tuned on recall alone will drive it up without ever saying so.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { loadEnvLocal } from "../../src/env.js";
import { transcribeWith, vocabularyFor } from "../../src/transcribe.js";
import { SITE_TERMS, pack, phrases, properNouns, proseOf } from "../../src/vocabulary.js";

loadEnvLocal();
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) throw new Error("OPENROUTER_API_KEY is not set");

const DIR = new URL(".", import.meta.url).pathname;
const DATA = `${DIR}../../data`;
const MODEL = "google/gemini-3.1-flash-lite";
const RUNS = Number(process.env.RUNS ?? 2);

interface Utterance {
  id: string;
  slug: string | null;
  voice: string;
  source: string;
  text: string;
  hard: string[];
}
const { utterances } = JSON.parse(
  fs.readFileSync(`${DIR}utterances.json`, "utf8"),
) as { utterances: Utterance[] };

/* ------------------------------------------------------------------ sources */

interface GlossaryEntry {
  name: string;
  aliases: string[];
  centrality?: number;
  difficulty?: number;
}
function glossaryOf(slug: string | null): GlossaryEntry[] {
  if (!slug) return [];
  const raw = JSON.parse(fs.readFileSync(`${DATA}/${slug}/glossary.json`, "utf8"));
  return raw.glossary?.entries ?? raw.entries ?? [];
}
/**
 * The article's title and its author, which production puts in the vocabulary
 * and the harness's other rows do not. Only the `+purpose` row uses it, so that
 * the one arm making a claim about production is composed the way production
 * composes.
 */
function titleOf(slug: string | null): string[] {
  if (!slug) return [];
  const meta = JSON.parse(fs.readFileSync(`${DATA}/${slug}/meta.json`, "utf8"));
  return [meta.title, meta.byline].filter((t: unknown): t is string => Boolean(t));
}

function namesOf(slug: string | null, limit: number): string[] {
  if (!slug) return [];
  const { blocks } = JSON.parse(fs.readFileSync(`${DATA}/${slug}/blocks.json`, "utf8"));
  return properNouns(proseOf(blocks), limit);
}
const PROFILE: string[] = (() => {
  const { profile } = JSON.parse(fs.readFileSync(`${DATA}/reader.json`, "utf8"));
  /* **`phrases`, exactly as production does it.** A paragraph handed to `pack`
     as one term is truncated at 80 characters, which is the bug GPT Sol's
     second review found — and a harness that did not share the fix would have
     measured a different prompt again. */
  return profile ? phrases(profile) : [];
})();

/**
 * "Why you're reading this one", as the reader would have typed it on the
 * Metadata page.
 *
 * **Not read from `data/`, and that is the honest way round.** No article on
 * this machine has a purpose written on it, so reading the store would give an
 * empty string and a row of zeroes that looked like a finding. This is the text
 * the `purpose-box` clip was written against, and every hard term in that clip
 * comes from here and from nowhere else — so the `+purpose` row is the only one
 * that can score on it, and the rest of the table shows what missing that box
 * costs.
 */
const PURPOSE: string[] = phrases(
  "For Thursday's reading group with Anjali Chaudhuri. I want the argument " +
    "against Vervaeke on relevance realisation, and where it leaves Friston.",
);


/** Today's shipped behaviour: names and aliases in whatever order they are stored. */
const asStored = (g: GlossaryEntry[]) => g.flatMap((e) => [e.name, ...e.aliases]);

/** The same terms, most central first — so the cap keeps the ones worth keeping. */
const ranked = (g: GlossaryEntry[]) =>
  [...g]
    .sort((a, b) => (b.centrality ?? 0) - (a.centrality ?? 0))
    .flatMap((e) => [e.name, ...e.aliases]);

const CAP = 2_000;

/**
 * Every name in every article on this machine, singletons included.
 *
 * The prose is handed over twice so that a name said once clears the
 * two-occurrence floor — a blunt way to ask for "all of them" without giving
 * the extractor a knob that only an eval would ever turn.
 *
 * **This is not a test of size.** It includes the three articles the clips are
 * about, so it adds relevant coverage *and* irrelevant bulk at the same time,
 * and its good score cannot be read as "size is harmless". {@link IRRELEVANT}
 * is the arm that holds the right terms fixed and adds only wrong ones. GPT
 * Sol's second review, item 3.
 */
/**
 * Every article on this machine that can be read right now, as prose.
 *
 * **Tolerant on purpose, and loud about it.** `data/` is not only the library —
 * other agents' test suites write fixtures into it and delete them again, and
 * one of those killed a 650-call run at the seventh minute with a
 * `SyntaxError` from a `blocks.json` that was never an article
 * (docs/reusable/silent-success.md is about the opposite failure; this is the
 * one where a whole hour is lost to somebody else's fixture). So a directory
 * that will not parse is skipped **and named**, rather than either crashing the
 * run or vanishing from it.
 *
 * Only the two bulk arms use this. The three articles the clips are about go
 * through `glossaryOf` and `namesOf`, which are deliberately not tolerant: if
 * one of *those* will not read, every number in the table is wrong and the run
 * should stop.
 */
function libraryProse(): { slug: string; prose: string; glossary: string[] }[] {
  const out: { slug: string; prose: string; glossary: string[] }[] = [];
  for (const slug of fs.readdirSync(DATA)) {
    if (!fs.existsSync(`${DATA}/${slug}/blocks.json`)) continue;
    try {
      const { blocks } = JSON.parse(fs.readFileSync(`${DATA}/${slug}/blocks.json`, "utf8"));
      const glossary = fs.existsSync(`${DATA}/${slug}/glossary.json`) ? ranked(glossaryOf(slug)) : [];
      out.push({ slug, prose: proseOf(blocks), glossary });
    } catch (e) {
      console.log(`  skipping ${slug}: ${(e as Error).message.slice(0, 60)}`);
    }
  }
  return out;
}

const LIBRARY: string[] = (() => {
  const terms: string[] = [];
  for (const { prose, glossary } of libraryProse()) {
    terms.push(...properNouns(`${prose}\n${prose}`, 2_000), ...glossary);
  }
  return [...new Set(terms)];
})();

/** The slugs the clips are about. */
const SPOKEN_ABOUT = new Set(["noema-mythology-of-conscious-ai", "fowler-phrenology", "constitution"]);

/**
 * The articles the irrelevant terms come from, **named rather than inferred**.
 *
 * "Everything in `data/` that is not a clip's article" was the first version,
 * and it made two arms of the table depend on whatever else happened to be on
 * the machine — other agents add and remove articles here, and one run's
 * wrong-vocabulary arm came out 928 characters and the next 1,598 with no
 * change to this file. A table that cannot be re-run is a table nobody can
 * argue with. Missing ones are named at the top of the run rather than quietly
 * shrinking the arm.
 */
const IRRELEVANT_SLUGS = ["writes", "revistes-ub-30977"];

/**
 * Terms from articles **no clip mentions**, and nothing else.
 *
 * This is what makes a size arm a size arm: appended to the correct vocabulary,
 * with its relevant terms and their order untouched, so the only difference
 * between that row and this one is bulk that is wrong. `LIBRARY` could not do
 * that job because it contains the clips' own articles.
 */
const IRRELEVANT: string[] = (() => {
  const found = new Map(libraryProse().map((a) => [a.slug, a]));
  const terms: string[] = [];
  for (const slug of IRRELEVANT_SLUGS) {
    const article = found.get(slug);
    if (!article) {
      console.log(`  the irrelevant-terms pool is missing ${slug} — the size arms are short`);
      continue;
    }
    if (SPOKEN_ABOUT.has(slug)) throw new Error(`${slug} is both spoken about and "irrelevant"`);
    terms.push(...properNouns(`${article.prose}\n${article.prose}`, 2_000), ...article.glossary);
  }
  return [...new Set(terms)];
})();

const CONDITIONS: { name: string; build: (u: Utterance) => string | Promise<string> }[] = [
  { name: "none", build: () => "" },
  /* What ships today. Article: the glossary. Profile page: the profile prose. */
  {
    name: "shipped",
    build: (u) => pack([u.slug ? asStored(glossaryOf(u.slug)) : PROFILE], CAP),
  },
  { name: "site only", build: () => pack([SITE_TERMS], CAP) },
  /* **The row that lets the profile be one step.** Without it, going from
     `shipped` to `site+profile+glossary` changes three things at once — it adds
     the site terms, adds the profile, and re-ranks the glossary — so no number
     in the table was about the profile alone. GPT Sol's second review, item 2. */
  { name: "site+glossary", build: (u) => pack([SITE_TERMS, ranked(glossaryOf(u.slug))], CAP) },
  /* No article text read at all — the cheap composite. */
  {
    name: "site+profile+glossary",
    build: (u) => pack([SITE_TERMS, PROFILE, ranked(glossaryOf(u.slug))], CAP),
  },
  /* **A limit that actually binds.** `MAX_NAMES` is 40 and these articles
     produce 20-25, so the production number is a ceiling nothing has ever
     touched — which means the table said nothing at all about it. Ten does
     bind, on every article, so this row and the one below it are a real
     comparison of "some of the names" against "all of them". GPT Sol's review,
     item 6. */
  {
    name: "+names(10)",
    build: (u) => pack([SITE_TERMS, PROFILE, ranked(glossaryOf(u.slug)), namesOf(u.slug, 10)], CAP),
  },
  /* The same, plus the names the glossary does not carry. */
  {
    name: "+names(40)",
    build: (u) => pack([SITE_TERMS, PROFILE, ranked(glossaryOf(u.slug)), namesOf(u.slug, 40)], CAP),
  },
  /* **The same condition again, deliberately, and it is the most useful row in
     the table.** Every other number here is one arm of a comparison with
     nothing to compare its own precision against; this one has an identical
     vocabulary to the row above it, so whatever the two rows differ by is what
     this measurement cannot tell apart. In the first run they came out 0.9
     points of WER and one term of recall apart — which retires, on the spot,
     any conclusion drawn from a gap of that size. It arrived by accident, as a
     condition that turned out to build the same list as its neighbour. It is
     kept on purpose. */
  {
    name: "+names(40) again",
    build: (u) => pack([SITE_TERMS, PROFILE, ranked(glossaryOf(u.slug)), namesOf(u.slug, 40)], CAP),
  },
  /* **The fifth source: the reader's own sentence about this article.** Greg
     asked for it on 2026-08-28, after the four-source table above was already
     measured, and it is the one source in the app that is written *about the
     thing the reader is about to talk about*. Everything else is inferred —
     from the article's text, from the reader's biography, from a stage-6 model.
     This box is a person telling us, in their own spelling, what is on their
     mind.

     Only the `purpose-box` clip can move on this row. That is the design: its
     four hard terms are in this box and in nothing else on the machine. */
  {
    name: "+purpose",
    build: (u) =>
      pack(
        [
          SITE_TERMS,
          /* **Only the clip whose box this is.** It used to go into every clip's
             vocabulary, including the profile page's and two articles it says
             nothing about, which made the row a mixture of "the box helps" and
             "an unrelated paragraph is harmless". GPT Sol's second review,
             item 6. */
          u.id === "purpose-box" ? PURPOSE : [],
          PROFILE,
          ranked(glossaryOf(u.slug)),
          titleOf(u.slug),
          namesOf(u.slug, 40),
        ],
        CAP,
      ),
  },
  /* **Size, with everything else held still.** The correct vocabulary, byte for
     byte and in the same order, plus every term from every article no clip
     mentions. The only difference from `+names(40)` is bulk that is wrong,
     which is the question `whole library` was being asked and could not answer.
     GPT Sol's second review, item 3. */
  {
    name: "+names(40) + irrelevant",
    build: (u) =>
      pack(
        [SITE_TERMS, PROFILE, ranked(glossaryOf(u.slug)), namesOf(u.slug, 40), IRRELEVANT],
        CAP,
      ),
  },
  /* **Four times the size, and none of the extra is wrong** — every name in
     every article in the library, plus every glossary, plus the singletons.
     Which is a real thing that could happen: one long book would produce a list
     this size on its own.

     A first attempt at this condition asked for `names(200)` instead and got a
     table identical to `+names(40)`, because the extractor tops out at 20-25
     names per article. A condition that cannot differ from another condition is
     not a control, and it took reading the size line above the results to
     notice — which is why that line is printed. */
  { name: "whole library", build: (u) => pack([SITE_TERMS, PROFILE, LIBRARY, ranked(glossaryOf(u.slug))], 100_000) },
  /* **The wrong article's vocabulary**, at full size. A reader in one tab and a
     slug from another, a stale client, a bug — but mostly this is the cleanest
     way to ask whether a term list drags a transcript towards itself.
     **Nothing in it is said in any clip**, which took two corrections: the
     first version was built from `fowler-phrenology`, which two clips are
     about, and it carried the site terms, which a third clip says out loud. So
     it scored partly as a right vocabulary and the arm meant nothing. GPT Sol's
     second review, item 3. */
  { name: "wrong article", build: () => pack([IRRELEVANT], CAP) },
  /* **The app's own answer, through the app's own code path.** Every other row
     composes its sources here, in this file, which is how the harness came to
     omit production's title and byline entirely and to differ from it in ways
     nobody could see by reading either one alone. This row calls
     `vocabularyFor` — the store reads, the ranking, the cap, the fence — so the
     table has one line in it that is about the thing we ship. GPT Sol's review,
     item 3.

     It should track `+names(40)` closely, and where it does not, this row is
     right and that one is a model. */
  {
    name: "production (vocabularyFor)",
    build: (u) => vocabularyFor(u.slug ? { kind: "article", slug: u.slug } : { kind: "profile" }),
  },
];

/* ------------------------------------------------------------------ scoring */

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Levenshtein distance in words, and the reference length beside it.
 *
 * **Both numbers, not a ratio**, so the caller can sum them into a corpus WER
 * (total edits over total reference words) as well as average the per-utterance
 * ratios. The two disagree, and the disagreement is the point: an average over
 * utterances lets a five-word dictation weigh as much as a thirty-word one,
 * which flatters or punishes a condition depending on which clip it stumbled
 * over. The first version reported only the average and called it WER. GPT
 * Sol's review, item 7.
 */
function edits(ref: string, hyp: string): { words: number; edits: number } {
  const r = norm(ref).split(" ");
  const h = norm(hyp).split(" ");
  const w = h.length + 1;
  /* One flat row-major array rather than an array of arrays: the same distance,
     and it types cleanly under `noUncheckedIndexedAccess`. */
  const d = new Int32Array((r.length + 1) * w);
  for (let j = 0; j <= h.length; j++) d[j] = j;
  for (let i = 1; i <= r.length; i++) {
    d[i * w] = i;
    for (let j = 1; j <= h.length; j++) {
      d[i * w + j] =
        r[i - 1] === h[j - 1]
          ? (d[(i - 1) * w + j - 1] as number)
          : 1 +
            Math.min(
              d[(i - 1) * w + j] as number,
              d[i * w + j - 1] as number,
              d[(i - 1) * w + j - 1] as number,
            );
    }
  }
  return { words: r.length, edits: d[r.length * w + h.length] as number };
}

const has = (haystack: string, needle: string) => ` ${norm(haystack)} `.includes(` ${norm(needle)} `);

/**
 * Vocabulary terms the model produced that the reader did not say.
 *
 * **The floor is three characters, not six.** Six was the first choice, on the
 * reasoning that a short term like `AGI` or `God` turning up is weak evidence
 * of anything — and that reasoning quietly excused the detector from looking at
 * `Gall`, `Ava` and `LLM`, which is exactly the kind of insertion a biasing list
 * causes. The committed run's stored transcripts were re-scored at three
 * afterwards and **every count stayed zero**, so the stricter floor costs
 * nothing and the negative result holds at it. Terms of one or two characters
 * are still out: a two-letter string matches too much English to mean anything.
 */
function invented(vocabulary: string, truth: string, hyp: string): string[] {
  const out: string[] = [];
  for (const term of vocabulary.split(", ")) {
    if (term.length < 3) continue;
    if (has(truth, term)) continue;
    if (has(hyp, term)) out.push(term);
  }
  return out;
}

/* **The invented-terms count came back zero everywhere on the first run**, and
   a zero from a detector nobody has watched fire is the same shape as a zero
   from a detector that is broken. So it is made to fire before anything else
   runs: a planted transcript, a term that was never said, and a term that was.
   docs/reusable/silent-success.md. */
{
  const vocabulary = "Philoprogenitiveness, Gall, Spideryarn";
  const truth = "the argument in the second half is much weaker";
  /* One long term and one four-letter one, because the four-letter one is what
     the old six-character floor was silently excusing itself from. */
  const found = invented(vocabulary, truth, "the argument is weaker, said Gall of Philoprogenitiveness");
  if (found.sort().join(",") !== "Gall,Philoprogenitiveness") {
    throw new Error(`the invented-terms check does not work: got [${found.join(", ")}]`);
  }
  if (invented(vocabulary, "I like Spideryarn", "I like Spideryarn").length) {
    throw new Error("the invented-terms check counts a term the reader actually said");
  }
}

/* --------------------------------------------------------------------- call */

/**
 * **The production request, not a copy of it.**
 *
 * This used to be a hand-rolled `fetch` with its own system prompt, no JSON
 * schema and no `require_parameters` — so every number it produced was about a
 * request the app never sends. GPT Sol's review, item 3. `transcribeWith` is
 * the same function the server calls once it has a vocabulary, so the prompt,
 * the schema, the routing flags, the truncation and refusal checks and `tidy()`
 * are shared rather than described twice.
 */
let spent = 0;
async function say(audio: string, vocabulary: string) {
  const out = await transcribeWith(audio, "webm", vocabulary);
  /* **The cost is kept per call, not just summed.** The $ figure the plan
     quotes used to come from grepping a log file nobody committed, so a reader
     of the results file could check every number in the table except that one;
     then only the total was stored, so the total could not be re-summed. GPT
     Sol's second review item 7, then its third review item 2.
     `transcribeWith` returns OpenRouter's own per-call figure. */
  const usd = out.usd ?? 0;
  spent += usd;
  return { text: out.text, ms: out.ms, usd };
}

/* --------------------------------------------------------------------- main */

const audioOf = new Map<string, string>();
for (const u of utterances) {
  audioOf.set(u.id, fs.readFileSync(`${DIR}clips/${u.id}.webm`).toString("base64"));
}

console.log(`${MODEL}, ${utterances.length} clips, ${RUNS} runs each.\n`);
console.log("Vocabulary sizes, by condition and clip (characters / terms):");
const vocabularyOf = new Map<string, string>();
for (const c of CONDITIONS) {
  const sizes: string[] = [];
  for (const u of utterances) {
    const v = await c.build(u);
    vocabularyOf.set(`${c.name}::${u.id}`, v);
    sizes.push(v ? `${v.length}/${v.split(", ").length}` : "0");
  }
  console.log(`  ${c.name.padEnd(22)} ${[...new Set(sizes)].join("  ")}`);
}

interface Row {
  /** One entry per run: reference words, edits, so corpus WER can be summed. */
  words: number[];
  edits: number[];
  recallHit: number;
  recallTotal: number;
  invented: string[];
  ms: number[];
  /** One per run, so the headline total can be re-summed from the file. */
  usd: number[];
  transcripts: string[];
}
const results = new Map<string, Map<string, Row>>();
for (const c of CONDITIONS) {
  const perClip = new Map<string, Row>();
  for (const u of utterances) {
    perClip.set(u.id, {
      words: [],
      edits: [],
      recallHit: 0,
      recallTotal: 0,
      invented: [],
      ms: [],
      usd: [],
      transcripts: [],
    });
  }
  results.set(c.name, perClip);
}

/* **Interleaved, not blocked.** Every condition used to run all ten of its
   clips before the next condition started, so a slow half-hour on OpenRouter's
   side landed entirely on whichever condition was in the loop at the time —
   and the table read that as a property of the vocabulary. GPT Sol's review,
   item 5. Rotating the condition order by clip and run spreads any drift across
   all of them, and it is deterministic, so a re-run is comparable.

   Genuine randomisation would be better still and is not available: `Math.random()`
   would make the run unreproducible, and a seeded shuffle is more apparatus than
   a rotation buys over it here. */
const lost: string[] = [];
let done = 0;
for (let run = 0; run < RUNS; run++) {
  for (const [clipIndex, u] of utterances.entries()) {
    for (let k = 0; k < CONDITIONS.length; k++) {
      const c = CONDITIONS[(k + clipIndex + run) % CONDITIONS.length] as (typeof CONDITIONS)[number];
      const vocabulary = vocabularyOf.get(`${c.name}::${u.id}`) ?? "";
      const row = (results.get(c.name) as Map<string, Row>).get(u.id) as Row;

      /* **A blip upstream must not throw away the hour before it.** This used
         to retry three times and then `throw`, and on 2026-08-28 a single 502
         at call 369 of 650 ended a run with nothing written down — 55 minutes
         and $0.10 for no table. Five attempts with a longer backoff, and then
         the call is *recorded as lost and the run goes on*.

         Lost calls are counted and printed, and the count goes in the results
         file, because a run that quietly dropped forty calls and one that
         dropped none must not look the same. */
      let got: Awaited<ReturnType<typeof say>> | null = null;
      let last: unknown;
      for (let attempt = 0; attempt < 5 && !got; attempt++) {
        try {
          got = await say(audioOf.get(u.id) as string, vocabulary);
        } catch (err) {
          last = err;
          if (attempt < 4) await new Promise((r) => setTimeout(r, 3_000 * (attempt + 1)));
        }
      }
      if (!got) {
        lost.push(`${c.name}::${u.id}`);
        console.log(`  lost ${c.name} / ${u.id}: ${(last as Error)?.message?.slice(0, 60)}`);
        continue;
      }
      const scored = edits(u.text, got.text);
      row.words.push(scored.words);
      row.edits.push(scored.edits);
      row.ms.push(got.ms);
      row.usd.push(got.usd);
      row.transcripts.push(got.text);
      for (const term of u.hard) {
        row.recallTotal++;
        if (has(got.text, term)) row.recallHit++;
      }
      if (vocabulary) row.invented.push(...invented(vocabulary, u.text, got.text));
      done++;
      if (done % 20 === 0) process.stdout.write(`${done} `);
    }
  }
}
process.stdout.write(`${done}\n`);

const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const rowsOf = (name: string) => [...(results.get(name) as Map<string, Row>).values()];

console.log("\n\n=== Overall ===");
console.log(
  "corpus WER is total edits / total reference words; mean WER averages the ten",
);
console.log(
  "utterances equally, so it lets a five-word clip count as much as a thirty-word one.\n",
);
console.log(
  `${"condition".padEnd(22)} ${"corpus".padStart(7)} ${"mean".padStart(7)} ${"hard-term recall".padStart(17)} ${"invented".padStart(9)} ${"control WER".padStart(12)}`,
);
for (const c of CONDITIONS) {
  const rows = rowsOf(c.name);
  const corpus = sum(rows.flatMap((r) => r.edits)) / sum(rows.flatMap((r) => r.words));
  const perUtterance = mean(rows.flatMap((r) => r.edits.map((e, i) => e / (r.words[i] as number))));
  const hit = rows.reduce((a, r) => a + r.recallHit, 0);
  const total = rows.reduce((a, r) => a + r.recallTotal, 0);
  const inv = rows.reduce((a, r) => a + r.invented.length, 0);
  /* **The harm number that does not depend on the invented detector.** The
     control clip says nothing hard at all, so its word errors under a loaded
     vocabulary are damage the vocabulary did, whether or not the words it put
     there were on the list. GPT Sol's review, item 2: an exact-phrase detector
     cannot see `principal` become `principle`. This can. */
  const control = (results.get(c.name) as Map<string, Row>).get("control-no-hard-terms") as Row;
  const controlWer = sum(control.edits) / sum(control.words);
  console.log(
    `${c.name.padEnd(22)} ${pct(corpus).padStart(7)} ${pct(perUtterance).padStart(7)} ${`${hit}/${total} = ${pct(hit / total)}`.padStart(17)} ${String(inv).padStart(9)} ${pct(controlWer).padStart(12)}`,
  );
}

console.log("\n=== Hard-term recall, by clip ===");
console.log(
  `${"condition".padEnd(22)} ${utterances.map((u) => u.id.slice(0, 11).padStart(12)).join("")}`,
);
for (const c of CONDITIONS) {
  const perClip = results.get(c.name) as Map<string, Row>;
  const cells = utterances.map((u) => {
    const r = perClip.get(u.id) as Row;
    return (r.recallTotal ? `${r.recallHit}/${r.recallTotal}` : "\u2014").padStart(12);
  });
  console.log(`${c.name.padEnd(22)} ${cells.join("")}`);
}

console.log("\n=== Invented terms (said by no one) ===");
let any = false;
for (const c of CONDITIONS) {
  const perClip = results.get(c.name) as Map<string, Row>;
  for (const u of utterances) {
    const r = perClip.get(u.id) as Row;
    if (r.invented.length) {
      any = true;
      console.log(`  ${c.name.padEnd(22)} ${u.id.padEnd(24)} ${r.invented.join(", ")}`);
    }
  }
}
if (!any) {
  console.log("  none — and read that as \"no exact vocabulary term was inserted\",");
  console.log("  which is narrower than \"no harm\": the control WER column is the rest of it.");
}

/**
 * SHA-256 of every file that decides what this run measured, first 12 hex.
 *
 * **Every file, and the list had to be made honest twice.** The first version
 * hashed `HEAD`, which named a commit containing neither this harness nor
 * `src/vocabulary-sources.ts`. The second hashed five source files and claimed
 * to hash "each file that decided what the run measured" — while leaving out
 * the ten audio clips, every article the vocabularies are built from, the
 * reader's profile, and the shared request code. **Changing a clip would have
 * changed the measurement without changing a single recorded hash.** GPT Sol's
 * second review item 7, then its third review item 2.
 */
function fingerprint(): Record<string, string> {
  const root = new URL("../../", import.meta.url).pathname;
  const paths = [
    "evals/dictation/bench-vocabulary-sources.ts",
    "evals/dictation/utterances.json",
    "src/vocabulary.ts",
    "src/vocabulary-sources.ts",
    "src/transcribe.ts",
    /* The request itself: the provider flags, the retries, the JSON parsing. */
    "src/ai-call.ts",
    "src/models.ts",
    /* The audio. Without these the fingerprint says nothing about the input. */
    ...utterances.map((u) => `evals/dictation/clips/${u.id}.webm`),
    /* The reader's profile, which two conditions carry. */
    "data/reader.json",
  ];
  /* Every article any condition reads, whether as a clip's own or as noise. */
  const slugs = new Set([...SPOKEN_ABOUT, ...IRRELEVANT_SLUGS, ...libraryProse().map((a) => a.slug)]);
  for (const slug of slugs) {
    for (const file of ["blocks.json", "glossary.json", "meta.json"]) {
      if (fs.existsSync(`${root}data/${slug}/${file}`)) paths.push(`data/${slug}/${file}`);
    }
  }
  return Object.fromEntries(
    paths.map((rel) => [
      rel,
      createHash("sha256").update(fs.readFileSync(`${root}${rel}`)).digest("hex").slice(0, 12),
    ]),
  );
}

const out = `${DIR}results-vocabulary-sources.json`;
fs.writeFileSync(
  out,
  `${JSON.stringify(
    {
      model: MODEL,
      runs: RUNS,
      /* No `Date.now()` stamp written by hand — `git log` on this file is the
         date, and a date typed into a results file is a date that gets copied
         forward into a re-run that did not happen. */
      /* **What it cost, so the plan's dollar figure can be checked.** */
      usd: Math.round(spent * 10_000) / 10_000,
      calls: CONDITIONS.length * utterances.length * RUNS,
      /* Which calls never came back, so a thinned table cannot pass for a full
         one. Empty is the normal case and the one worth being able to see. */
      lost,
      /* Which articles the two size arms drew their irrelevant terms from, so
         the arm can be rebuilt rather than taken on trust. */
      irrelevantFrom: IRRELEVANT_SLUGS,
      /* **A fingerprint of the code that ran, not of `HEAD`.** The commit hash
         was here, and it named a commit that contained neither this harness nor
         `src/vocabulary-sources.ts` — because both were uncommitted when the
         run happened, which is the normal case for a benchmark you are running
         *in order to decide whether to commit*. A hash of the files themselves
         cannot say that. GPT Sol's second review, item 7. */
      code: fingerprint(),
      commit: execFileSync("git", ["rev-parse", "--short", "HEAD"]).toString().trim(),
      conditions: CONDITIONS.map((c) => ({
        name: c.name,
        vocabularies: Object.fromEntries(
          utterances.map((u) => [u.id, vocabularyOf.get(`${c.name}::${u.id}`) ?? ""]),
        ),
        clips: Object.fromEntries(results.get(c.name) as Map<string, Row>),
      })),
    },
    null,
    2,
  )}\n`,
);
if (lost.length) {
  console.log(`\n${lost.length} of ${CONDITIONS.length * utterances.length * RUNS} calls never came back:`);
  for (const one of lost) console.log(`  ${one}`);
}
console.log(`\nEvery transcript is in ${out.replace(`${DIR}`, "")}.`);
