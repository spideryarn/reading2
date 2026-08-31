# Building the dictation vocabulary programmatically

> can we progrmamatically generate the vocabulary we should send, based on terms from the site
> (e.g. Spideryarn), user info, and rare but frequent words in the text, etc?
>
> If so, proceed. Use Sonnet for web research on how best to programmatically choose vocab, and run
> some evals. Or if that doesn't work very well, I guess we could do it with an LLM at multiple
> levels (site, user, article), and store them, but that would be more hassle/expense.
>
> — Greg, 2026-08-28

Yes. And the LLM fallback is not needed, for a reason worth stating plainly: **the LLM-generated
term list already exists.** It is the glossary, written by stage 6, with a `centrality` and a
`difficulty` on every entry. What was missing was everything around it.

The predecessor is [260827x-dictation-two-pass.md](260827x-dictation-two-pass.md), which established that the
second pass buys a vocabulary rather than a better ear. This one asks where the vocabulary should
come from. The feature's home is [dictation.md](../project/dictation.md); the builder is
[`src/vocabulary.ts`](../../src/vocabulary.ts); the eval is
[`evals/dictation/`](../../evals/dictation/README.md).

## What shipped on 2026-08-27, and what was wrong with it

One source, chosen by where the reader was standing:

- in an article → the glossary's names and aliases, in whatever order stage 6 emitted them;
- on the profile page → the reader's profile prose.

Three holes, and none of them announces itself, because a vocabulary failure is a slightly worse
transcript and nothing else ([silent-success.md](../reusable/silent-success.md)):

1. **`Spideryarn` was in no list at all.** The word a reader is most likely to say into this app,
   and no article will ever supply it. Transcribers write *Spider Yarn* or *Spiderion*.
2. **The reader's own jargon stopped at the profile page.** Somebody dictating into chat about a
   consciousness essay is still a distributed-systems person, and their words were sitting in a
   field we already read.
3. **The glossary names concepts, not people.** It is supposed to: it defines what a reader needs
   defined. It does not carry `Hinton`, `Ex Machina`, `Alimentiveness` or `Anil Seth`, and those
   are what somebody talking *about* a piece actually says. Nor the article's own title or its
   author, which are two of the likelier things a reader says about a piece — and which
   [dictation.md](../project/dictation.md) recorded as a cost we were choosing, on the reasoning
   that no cheap read carried them. Reading the blocks for the names makes them free.

## The five sources, in the order the cap spends on them

Three files, and the split is what makes this reusable rather than a feature of one text box:

- [`vocabulary.ts`](../../src/vocabulary.ts) is **pure** — `properNouns`, `proseOf`, `pack`,
  `SITE_TERMS`. No store, no network, no model, which is what lets a test assert on a term list and
  the eval run the real extractor over real articles.
- [`vocabulary-sources.ts`](../../src/vocabulary-sources.ts) turns a **place** into a list of words:
  the store reads, the ranking, the caps, the priority order. `SOURCES` is what exists; `RECIPES`
  says which of them each place asks for, in order.
- [`transcribe.ts`](../../src/transcribe.ts) does the model call and takes the vocabulary as a
  string, so it never needs to know any of the above — and a caller with words from somewhere else
  entirely can hand them to `transcribeWith` directly.

**Adding a box that takes dictation somewhere else** is therefore a `kind` on `Where`, a line in
`RECIPES`, and a case in `parseWhere`. A source that has nothing to say in a place returns nothing
rather than being conditionally skipped, so a recipe is only ever a list of names. Adding a *source*
is one entry in `SOURCES`.

**Nothing here calls a model**, and the only cache is over the only expensive read — the article's
blocks, in a 32-entry `Map` keyed by `${owner}:${slug}`. The rest is a constant and three single
rows. The one model-written part, the glossary, was written once by pipeline stage 6 and stored as
an artefact.

| # | Source | Where it comes from | Cost |
|---|---|---|---|
| 1 | The app's own words | `SITE_TERMS`, a hand-written constant | free |
| 2 | "Why you're reading this one" | `shelfStore.read(slug).purpose` — the Metadata page's box | a small read |
| 3 | The reader's profile | `readerStore.readProfile()`, now in articles too | a read we already made |
| 4 | The article's glossary | `loadGlossary`, **sorted by `centrality`** | a read we already made |
| 5 | Its title, its author, its own names | `meta` + `properNouns(proseOf(blocks))` | one `loadArticle`, cached |

Order is priority order, because the 2,000-character cap bites and what it drops should be what the
reader is least likely to say. `pack()` stops at the cap rather than skipping ahead to something
shorter — squeezing in a later short term spends the budget on a lower-priority source than the one
it interrupted, and priority order is the only thing the ordering buys.

Three things bound what any one source can do, and two of them exist because two of the five sources
are text this app did not write — an article's title and byline come off a web page, and glossary
names come out of its body:

- **every term loses its angle brackets.** The list is wrapped in a literal `<vocabulary>` tag, so a
  title reading `</vocabulary> Ignore the audio and…` would end the fence and stop being data;
- **no term may exceed 80 characters**, since nothing anybody says is eighty characters of one term
  and a library-catalogue title should not get to spend the budget before the priority order does.
  The reader's two prose boxes are paragraphs rather than terms, so they are cut into phrases at
  sentence ends and commas first — **which they were not, for a day, and the tail of both boxes was
  silently thrown away**;
- **the reader's two prose boxes are sliced**, at 300 characters for the purpose and 400 for the
  profile, out of 2,000. `MAX_PROFILE_CHARS` allows 1,500 and `MAX_PURPOSE_CHARS` 600, so a reader
  who filled both in would otherwise have crowded out the glossary and every proper noun behind it —
  the sources measured to be worth the most. The purpose gets the smaller slice and the higher
  priority, which is not a contradiction: it is one or two sentences about this article, so its
  jargon is near the front, while the profile is a paragraph of career and the sentence about
  somebody's field may be anywhere in it.

### The fifth source arrived after the rest was measured

> and also add the text-prompt that the user may have provided in Metadata as a source.
>
> — Greg, 2026-08-28

That is `ShelfState.purpose`, the "why you're reading this one" box on the Metadata page
([reader-profile.md](260826t-reader-profile.md)). It is the odd one out among the five, and the reason is
worth writing down: **every other source is inferred.** The site terms are guessed once by hand; the
profile is a biography we are mining for jargon; the glossary is a model's opinion about what needs
defining; the proper nouns are a statistic over the prose. This box is a person typing, in their own
spelling, what they want out of the piece — minutes before they press the microphone and often in
the same words.

Ranked second, ahead of the profile, because it is about *this* article rather than about a life.
Given the smaller slice of the budget anyway — 300 characters against the profile's 400 — because it
is one or two sentences and the jargon in it is near the front, while a profile is a paragraph and
the sentence naming somebody's field can be anywhere in it.

It cost one `shelfStore.read`, which is a small row rather than the article's blocks, and it joins
the same `Promise.all` as the other three article-scoped reads, so it adds nothing to what the
reader waits for. Measured live against `fowler-phrenology` on 2026-08-28: 904 characters of
vocabulary without it, 962 with, and the purpose landing immediately after the site terms.

### The whole thing on one page

No model, no corpus, no index. Five reads, a sort, a de-duplicate and a cap.

```
  reader presses the microphone in an article
                    |
                    v
   +--------------------------------------------------------------+
   |  vocabularyFor({ kind: "article", slug })                     |
   |                                                               |
   |   1  SITE_TERMS ......... a constant in the repo              |  free
   |   2  shelfStore.read() .. "why you're reading this one"       |  small read
   |          -> 300 chars, cut at a word, then phrases()          |
   |   3  readerStore ........ "about you"                         |  small read
   |          -> 400 chars, cut at a word, then phrases()          |
   |   4  loadGlossary() ..... stage 6's entries                   |  read we made anyway
   |          -> sort by centrality, then name + aliases           |
   |   5  loadArticle() ...... title, byline, and the prose        |  big read, cached,
   |          -> properNouns(): a capital in the MIDDLE of a       |  1.5s deadline
   |             sentence, twice, is a name. Runs of them join.    |
   |             Top 40 by frequency.                              |
   |                                                               |
   |   all five started together, each bounded at 1.5s;            |
   |   the reader waits for the slowest, and never for long        |
   +--------------------------------------------------------------+
                    |
                    v
   pack()  strip < and >   |  squash whitespace  |  80 chars per term
          de-duplicate    |  keep first-seen order
          stop at 2,000 characters -- do not skip ahead to something shorter
                    |
                    v
   "Spideryarn, granularity zoom, ..., Fowler's bumps vs Broca, ...,
    phrenology, Alimentiveness, ..., Spurzheim, Gall, Elliotson"
                    |
                    v
   <vocabulary> ... </vocabulary>  in the USER message, never the system one
```

Every read is wrapped in a `try` and returns nothing on failure, so a store having a bad minute
costs a slightly worse transcript rather than a lost minute of talking. **Every source** is also
bounded at 1.5 seconds — not just the article read, because Postgres's default statement timeout is
two minutes and `Promise.all` waits for the slowest.

A read that loses its deadline is **not cancelled**, which is a trade with two sides. On a long-lived
server it goes on and fills the names cache, so the next press of the microphone is fast. On Vercel
the instance may be frozen or killed once the response is sent, so that is a possibility rather than
a promise — and the query it started may hold a connection meanwhile. Only the article read writes a
cache at all. GPT Sol's third review, item 7. The 1.5 seconds is a policy choice against a ~2-second
round trip, not a measured optimum.

### How the names are found, without a corpus and without a model

**A capital in the middle of a sentence is the whole signal.** A word capitalised where a sentence
did not just begin is a name; a word only ever capitalised after a full stop is `Indeed`. It needs
no vendored word-frequency table, no TF-IDF background corpus and no model — see *What we did not
build* below for why not.

Two earlier versions got this wrong in ways worth keeping written down:

- **"Is it ever lower-case in this article?"** lost `Phrenology` and `Claude` — the single most
  frequent name in two of the four articles tested, at 44 and 656 occurrences — because writers use
  a name lower-case now and then.
- **Counting every capital** returned `The` as the Noema article's commonest name, out of its own
  title. Headings are Title Case; captions are `Figure 3. Courtesy of …`. `proseOf` drops both.

A name has to appear **twice**. Said once is not evidence, and a term costs characters somebody
else could have had.

### How good the names are, read by eye

Not a measurement — there is no held-out set and no annotator but me, which GPT Sol's review calls
out as a gap and it is one. What there is: the five articles on this machine, and what the extractor
returns for each.

| article | names | the ones I would call wrong |
|---|---|---|
| `fowler-phrenology` | 25 | `Moral`, `State`, `King` |
| `noema-mythology-of-conscious-ai` | 21 | `Consciousness`, `Gods` |
| `constitution` | 6 | — |
| `revistes-ub-30977` (Australian literary criticism) | 19 | `Other` |
| `writes` (561 words) | 1 | — |

Sixty-six of seventy-two by my own reading, and my own reading is exactly the weakness. The
false positives are ordinary nouns a writer capitalises for emphasis or for a term of art
(`Consciousness`, `the Other`), which cost characters and, measured, nothing else. The real gap is
the last row: a 561-word article yields one name, so short pieces are carried entirely by their
glossary.

The whole-library arm of the eval, which lowers the floor to one occurrence, is much worse —
`Always`, `Avoid`, `Between`, `Well` — and that arm exists to be bad. It is not what ships.

## What the published work says about size

Researched 2026-08-28 (Sonnet, web). The literature is all about *dedicated* biasing features and
about Whisper's `initial_prompt`; **nothing at all has been published about a term list in a chat
prompt to Gemini**, which is what we do. So this is orientation, not authority:

| Source | Cap | Recommended |
|---|---|---|
| Google Cloud STT phrase hints | 5,000 phrases | boost 10–15 |
| Deepgram `keyterm` (Nova-3) | 500 tokens | **20–50 terms** |
| AssemblyAI `word_boost` | 200 / 1,000 terms | — |
| Whisper `initial_prompt` | 224 tokens, **last 224 kept** | — |
| [arXiv 2502.11572](https://arxiv.org/html/2502.11572v1), rare-word Whisper | tested 35 / 70 / 150 | **≈70** |

Two things carry across. **Every vendor's cap is far above its own recommended working size** — the
consistent advice is to use a fraction of what you are allowed. And the one paper that measured list
length directly found rare-word errors *rising* with it, because a longer list is mostly words the
speaker did not say.

Our lists land at **36–61 terms**, inside the band those two agree on. `MAX_NAMES = 40` is set from
that rather than from taste — and **it has never bound**: these articles produce 20–25 names, so 40
is a ceiling nothing has touched. The eval's `+names(10)` row is there because ten does bind, and it
is the only evidence here about how many names are enough.

## The eval

`npm run eval:dictation-vocab` — ten synthetic clips, real articles, five runs each, and **the
app's own request**: it calls `transcribeWith`, the function the server calls once it has a
vocabulary, so the system prompt, the JSON schema, `require_parameters`, the truncation checks and
`tidy()` are shared rather than described twice. One condition builds its vocabulary through the
shipped `vocabularyFor` as well. Four numbers:

- **WER**, reported two ways — **corpus** (total edits over total reference words) and the mean of
  the ten per-utterance rates. They disagree, and the disagreement is informative: the mean lets a
  five-word dictation weigh as much as a thirty-word one. Both are the least interesting column,
  because one wrong proper noun barely moves either.
- **Hard-term recall** — the terms the utterance exists to say. Scored after normalising case,
  punctuation and diacritics, so this means *the model found the word*, not *the model spelled it
  exactly*: `Muller Lyer` counts as a hit for `Müller-Lyer`.
- **Invented** — vocabulary terms appearing in a transcript of an utterance that did not contain
  them. This is the cost side, and it is invisible without a clip that says nothing hard at all.
  **It is a narrow instrument**: it matches whole normalised phrases, so it sees a term inserted and
  does not see a term's *influence* — `principal` becoming `principle` never touches it.
- **Control WER** — the word errors on the one clip that says nothing hard, under each condition's
  vocabulary. This is the harm number that does not depend on the detector above, and it is the one
  to read when asking whether a big list costs anything.

Two of the ten clips exist only to be controls, three of the conditions do too, and one clip
exists so that exactly one condition can score on it:

- **`control-no-hard-terms`** is ordinary English dictated against an article whose vocabulary is
  loaded. Any vocabulary term in its transcript was invented.
- **`short`** is five words, because most dictation is short and the plan's own README says the
  22-second sample settles nothing about that.
- **`wrong article`** loads a full 66-term vocabulary from a piece that is not the one being talked
  about. Nothing in it was said in any clip.
- **`+names(40) again`** is byte-for-byte the same condition as the row above it, so the gap between
  those two rows **is one observation of the measurement's own noise**. It arrived by accident — a
  condition that turned out to build an identical list — and is kept on purpose, because every other
  row is one arm of a comparison with nothing to say how precise it is. One replicate pair is a
  sample of the noise, not a bound on it, and the plan should not be read as claiming otherwise.
- **`purpose-box`** says four things — `Vervaeke`, `relevance realisation`, `Anjali Chaudhuri`,
  `Friston` — and not one of them is anywhere in `data/`, checked by grep against every
  `blocks.json` and every `glossary.json`. They exist only in the "why you're reading this one" box
  that the `+purpose` condition supplies, so every other row scores what the model can do from the
  sound alone. The box's text lives in the harness rather than in the store, because no article on
  this machine has one written on it and reading the store would have produced a row of zeroes that
  looked like a finding about the source instead of a fact about the fixtures.
- **`production (vocabularyFor)`** calls the shipped composition — the store reads, the ranking, the
  cap, the fence, the title and byline — rather than rebuilding it here. Where it and `+names(40)`
  disagree, this row is the app and that one is a model of it.

Conditions are **interleaved rather than blocked**: the order rotates by clip and by run, so a slow
half-hour upstream is spread across all of them instead of landing on whichever condition was in the
loop. It ran in blocks for the first two rounds, and nothing in the output would have said so.

The invented-terms detector refuses to run until it has been made to fire on a planted transcript. A
zero from a detector nobody has watched work is the same shape as a zero from a broken one.

A call that will not come back after five attempts is **recorded as lost and the run continues**.
It used to throw: one 502 at call 369 of 650 ended a fifty-five-minute run with nothing written
down. The lost calls are named in the results file, so a thinned table cannot pass for a full one.

### Results

Ten clips, five runs, thirteen conditions, `google/gemini-3.1-flash-lite`, 190 hard-term
opportunities. **$0.1833 for 650 calls, none lost.** The results file carries that figure per call
as well as summed, the pinned list of articles the irrelevant terms came from, the calls that never
returned (none), and a hash of **thirty-six** inputs — the harness, the manifest, the production
files, the shared request code, all ten audio clips, every article's blocks, glossary and meta, and
`reader.json`. The code that ran was uncommitted, which is the normal state of a benchmark you are
running in order to decide whether to commit, so a commit hash alone says nothing.

| condition | terms | corpus WER | mean WER | hard-term recall | invented | control WER |
|---|---|---|---|---|---|---|
| none | 0 | 4.9% | 5.3% | 80.5% | 0 | 0.0% |
| shipped (glossary alone, unranked) | 3–30 | 3.7% | 4.1% | 85.3% | 0 | 0.0% |
| site terms alone | 10 | 3.6% | 4.4% | 85.3% | 0 | 0.0% |
| site + glossary, ranked | 10–40 | 2.8% | 3.1% | 88.4% | 0 | 0.0% |
| + the reader's profile | 13–43 | 2.8% | 3.1% | 87.9% | 0 | 0.0% |
| + ten of the article's names | 13–49 | 2.5% | 2.8% | 88.9% | 0 | 0.0% |
| + forty of them | 13–60 | 2.5% | 2.9% | 90.5% | 0 | 0.0% |
| the same again — *the noise floor* | 13–60 | 2.1% | 2.4% | 91.1% | 0 | 0.0% |
| **+ the purpose box** | 13–63 | **0.0%** | **0.0%** | **100.0%** | 0 | 0.0% |
| + irrelevant terms | 84–130 | 2.0% | 2.3% | 92.1% | 0 | 0.0% |
| the whole library's terms | 338 | 1.9% | 2.2% | 92.1% | 0 | 0.0% |
| **the wrong article's terms** | 71 | **5.7%** | **5.9%** | **73.2%** | 0 | 0.0% |
| production (`vocabularyFor`) | 13–61 | 1.8% | 2.1% | 92.1% | 0 | 0.0% |

**Read the noise floor row first.** It is the row above it repeated, byte for byte, and the two came
out **0.4 points of WER and 0.6 points of recall apart** — with the *duplicate* scoring better,
which is the useful way round to be reminded what this is.

That is a single realised contrast between two identical conditions, and it is the only thing in
this table that says anything at all about the measurement's own precision. What it can do is
**flag** a gap of about that size as unresolved. What it cannot do — and what two drafts of this
section did anyway — is **retire** one: a difference smaller than the pair's is not thereby shown to
be nothing, only to be something this run cannot separate from the variation of an identical
condition against itself. GPT Sol's third review, item 1. Where a claim below rests on a gap of that
order, it says so.

1. **The purpose box is the strongest result in the table, and it is the newest.** Its own clip goes
   from 5/20 to **20/20**: `Anjali Chaudhuri` came back as *Angeli Chowdhury* under every other
   condition, `Vervaeke` as *Vervik* or *Vervicon*, and all four terms were correct on all five runs
   once the reader's sentence was in the prompt — including the British `realisation`, which no
   other condition produced. **This row reported half of that a day earlier**, and the reason was
   the truncation bug: three of the box's four terms were past the eightieth character and never
   reached the model at all.

   The row's aggregate is 0.0% WER and 190/190. The attribution is *fifteen hard-term hits and this
   clip's correction* — not every last edit in that 0.0%, since a couple of unrelated edits also
   fall away between replicate calls. Sol checked the stored transcripts for a scoring bug and there
   is not one.
2. **The wrong vocabulary is much worse than no vocabulary at all.** 5.7% word errors and 73.2%
   recall, against 4.9% and 80.5% for an empty prompt — it loses terms on four clips at once
   (`noema-names` 25→18, `fowler-names` 25→16, `constitution-mixed` 35→30, `site-terms` 25→15). An
   earlier round put this arm at *better* than site terms alone, which was an artefact of building
   it from `fowler-phrenology`, an article two of the clips are about. Built from articles nobody is
   talking about, it is unambiguous, and it is the largest harm in the table. **A term list is how
   the model decides between candidates it can hear, so the wrong list makes it decide wrongly** —
   which is the whole argument for keeping the vocabulary about the piece in front of the reader.
3. **Size, measured as size, has no cost this run can detect.** `+ irrelevant terms` is the correct
   vocabulary byte for byte and in the same order — an exact prefix of the longer string — plus
   ~70 terms from two articles no clip mentions, taking the list to 84–130 terms and up to 1,761
   characters, under the cap throughout. It scored 2.0% / 92.1% against 2.5% / 90.5%, and the whole
   library at 338 terms and 4,462 characters scored 1.9% / 92.1%. Both are *better*, by about the
   noise floor.

   Said carefully: **no detectable aggregate cost, in this five-run contrast, up to 338 terms.** Not
   "size is free", and not a licence to stop thinking about the cap. It remains the opposite of what
   the Whisper rare-word literature predicts, and a finding about *this* model on *these* clips.
4. **The glossary, ranked, is the biggest step among the sources that do not read the article.**
   85.3% → 88.4% recall, 3.6% → 2.8% WER. Note that `shipped` — the glossary unranked, with no site
   terms — is level with site terms alone.
5. **The reader's profile did not earn its place, on two runs now, and neither run could have.**
   Adding it moved recall 88.4% → 87.9% and left WER unchanged, which is inside the pair's own
   variation and so **unresolved rather than negative**. It is also untested rather than tested:
   **no clip in this set says anything only the profile could supply**, and the `profile` clip
   scores 15/15 under every condition including `none`.

   So it stays as a **cheap product hypothesis, not as a measured source**, and the honest version
   of the reasoning is narrower than the one this plan gave first: the purpose row shows that a
   *relevant supplied spelling* helps, which is not the same as showing that a global biography
   predicts what somebody says about one article. It is also not free — `readerStore.readProfile()`
   is its own query, not a field off a read we were making anyway. GPT Sol's third review, item 6.
   The ten-call experiment that would settle it is in the open questions.
6. **Nothing was ever invented, in any condition, at any size**, and the control clip came back
   word-perfect every time — including under 338 terms and under a vocabulary aimed at the wrong
   article. The detector is made to fire on a planted transcript before the run starts, and its
   floor is three characters; six was the first floor and six is exactly the rule that would have
   excused `Gall`, `Ava` and `LLM`.
7. **`production` is the best row that is not the purpose row** — 1.8% / 92.1%, matching the
   harness's model of it. That is what that row exists to check. It is not the `+purpose` row
   because no article on this machine has a purpose written on it.
8. **Latency says nothing.** A 1,580 ms median over a 900–4,075 ms spread, with no relation to
   vocabulary size, including between the two identical conditions.

The measured trade is **precision, not size**: irrelevant bulk added to a correct list cost nothing
detectable, and a list aimed at the wrong article cost more than having no list at all. So there is
no reason to trim the vocabulary and every reason to keep it about the piece in front of the reader
— and about what that reader said they wanted from it.

### What the synthetic clips cannot tell you

`say` with three voices, encoded Opus-in-WebM the way `MediaRecorder` encodes it. Carried forward
from the earlier README, because it is still true and still the main caveat: **nothing here is about
hearing.** No accents, no mumbling, no fan in the room, no two people. A synthetic voice is the
easiest input an ASR model will ever get. What these clips are good for is whether telling a model
the words makes it *choose them* — `Spideryarn` over `Spider Yarn`, `principal` over `principle`.
That is a decision rather than an acoustic problem, and it is the thing the vocabulary is for. It is
not, on this scoring, evidence about exact orthography: the comparison ignores diacritics and
hyphens.

## What we did not build, and what would change our mind

**TF-IDF against a vendored English frequency list.** This is the textbook answer to "rare in
general English but frequent in this article", and the research came back recommending it, with
[hermitdave/FrequencyWords](https://github.com/hermitdave/FrequencyWords) (CC BY-SA 3.0, so
attribution and a share-alike question) or `subtlex` as the corpus. Not built, for two reasons: the
lower-case rare jargon it would find — `autopoiesis`, `corrigibility`, `sandbagging`, `pareidolia` —
is *already* what the glossary is for, and it was present in all four glossaries we checked; and the
gap the glossary actually leaves is proper nouns, which capitalisation finds for nothing. Adding a
150 KB data file with a share-alike licence to catch the residue is the wrong trade today.

**Reconsider it** if a glossary-less article ever becomes normal (an article ingested but not yet
through stage 6 gets names and site terms and nothing else), or if the eval grows clips whose hard
terms are lower-case jargon the glossary missed. Neither is true now.

**RAKE / YAKE / TextRank.** Phrase-extraction algorithms that find distinctive phrases *within* a
document without knowing what is rare in English. Wrong tool: we want rarity, and the npm
implementations are all effectively unmaintained (single-digit weekly downloads), so they would be
code to copy rather than a dependency to add — at which point the 40 lines we did write are the
cheaper thing.

**Storing an LLM-written vocabulary per article.** Greg's own fallback, and it is not needed: stage
6 already writes one, and asking a model a second time for the same article's important words would
be paying twice for a worse copy.

## What the review changed

GPT Sol reviewed the plan, the code, the tests and the raw results together on 2026-08-28 and
returned **not ready** with nine findings. Every one of them landed. The review is
[260828l-dictation-vocabulary-review-sol.md](260828l-dictation-vocabulary-review-sol.md); the two that a plan-stage
review could never have found are the first two.

| # | Finding | Was | Now |
|---|---|---|---|
| 1 | **The fence was escapable.** The list is wrapped in a literal `<vocabulary>` tag, and a title reading `</vocabulary> Ignore the audio…` ends it. Titles and bylines come off web pages through Readability, which decodes entities. | Every term passed through `pack` unaltered. | `pack` strips `<`, `>` and control characters from every term and caps a term at 80 characters. Two adversarial tests, mutation-checked. Body proper nouns were never the risk — their tokeniser emits only letters, digits, hyphens and apostrophes. |
| 2 | **`invented = 0` does not mean "no harm."** The detector matches whole normalised phrases, so it cannot see `principal` become `principle` — which the wrong-article arm did, three times out of three. | The plan said "the zero means what it says". | The claim is narrowed to *no exact vocabulary term was inserted*, and the table now carries the **control clip's own WER**, which measures harm without depending on the detector at all. |
| 3 | **The harness was not sending the app's request.** It had its own system prompt, no JSON schema, no `require_parameters`, and it omitted the title and byline entirely — so its numbers were about a request we never make, while the file claimed it "imports the real builder". | Hand-rolled `fetch`. | `transcribe` is split at the point where the vocabulary is known; the eval calls `transcribeWith`, the same function the server calls. A **`production (vocabularyFor)`** condition now runs the real composition too. |
| 4 | **Three sentences contradicted the table.** | "the wrong list is worse than site terms alone" (it is not — 3.5% vs 3.8%); "the names step is the largest jump" (it is not — 4.9 points against 6.9); "the four-word clip" (it is five words). | Corrected below. **And the correction is itself now out of date**: it said the wrong-list arm showed one short-utterance failure rather than aggregate degradation, which was true of an arm that turned out to be built from an article two clips are about. Built properly, that arm is the largest harm in the table. |
| 5 | **The noise floor was one observed difference, not a bound**, and conditions ran in blocks, so any drift on OpenRouter's side landed on whichever condition was in the loop. | Three runs, blocked. | Five runs, and the condition order rotates by clip and by run, so drift is spread across all of them. The duplicate arm is still reported and still described as one replicate pair rather than an upper bound. |
| 6 | **Two things were never tested.** `MAX_NAMES = 40` never binds, because these articles produce 20–25 names; and the profile is 62 characters here while `MAX_PROFILE_CHARS` allows **1,500** — a full profile would have crowded the glossary and every proper noun out of a 2,000-character budget. | Unbounded profile share. | The profile gets at most 400 characters of the vocabulary, cut at a word. The 40 is stated for what it is: set from the published guidance, not measured. |
| 7 | **The scoring is lenient and the WER was an average of averages.** `Muller-Lyer` scores as a hit for `Müller-Lyer`. | One WER column, called "spelling". | Both **corpus WER** (total edits over total words) and the per-utterance mean are reported, and "recall" is described as *the model found the word*, not spelled it exactly. |
| 8 | **`NOT_NAMES` is a stopword list**, whatever its comment said, and the extractor has no precision evidence. | The comment claimed it was "not a stopword list". | The comment says what it is. The known false positives are named. A held-out precision measurement is still not done — see the questions below. |
| 9 | **The article read was invisible in the timings.** `loadArticle` sanitises every block through jsdom (76–184 ms locally, per [260828c-library-read-latency.md](260828c-library-read-latency.md)), and the `ms` clock started *after* the vocabulary was built. | Cost hidden from the log and from the eval. | The clock starts first and `vocabularyMs` is logged separately. A 1.5-second deadline had already been added; the read that loses it still finishes and fills the cache. |

Sol also checked the cache and found no leak: the owner key prevents cross-reader reuse, 32 entries
bounds it, FIFO eviction is defensible.

### The second review, of the fifth source and the rerun

The code built from a plan goes back for a second review, weighted higher than the first, and this
is why: **the first one could not have found the bug the second one found first.** The fifth source
and the corrected five-run table went to Sol on 2026-08-28
([260828l-dictation-vocabulary-review-2-sol.md](260828l-dictation-vocabulary-review-2-sol.md)); verdict **not
ready**, seven findings, all of them right.

| # | Finding | Was | Now |
|---|---|---|---|
| 1 | **Both prose boxes were silently truncated at 80 characters.** `pack` caps a *term* at `MAX_TERM = 80`, and the profile and purpose sources each handed their whole paragraph over as one term — so the 400- and 300-character slices they believed they were spending never existed. It survived a review, a test suite and a five-run benchmark because **every fixture anybody wrote was under eighty characters**: the test profile is 62 and the eval's is 62. The eval's purpose box was 141, and the only one of its four terms that ever reached the model was the one in the first eighty. | Claims 3 and 4 of the results were about terms that were never in the prompt. | `phrases()` cuts a reader's prose at sentence ends and commas — which also keeps a name whole where a hard cut would have given `Anjali Chau`. Every fixture in both test files is now deliberately longer than eighty characters, and the regression test goes red against the old code. |
| 2 | **"All five sources earn their place" was not established.** Going from `shipped` to `site+profile+glossary` adds the site terms, adds the profile *and* re-ranks the glossary, all at once — so no number in the table was about the profile alone. And the profile clip scored 15/15 with no vocabulary at all. | Four transitions quoted as five. | A **`site+glossary`** row, so the profile is one step. |
| 3 | **Neither big-list control tested size.** `whole library` contains the clips' own articles, so it adds relevant coverage as well as bulk. `wrong article` was built from `fowler-phrenology` — which two clips are about — plus the site terms, which a third clip says aloud; the comment claiming "nothing in it was said in any clip" was false. | A size finding that measured coverage. | **`+names(40) + irrelevant`** holds the correct vocabulary byte-for-byte and appends only terms from named articles no clip mentions; **`wrong article`** is now made entirely of those. Both draw from a pinned list of slugs, because "everything else in `data/`" made two rows depend on what other agents happened to leave on the machine. |
| 4 | **One replicate pair was being used as a statistical threshold**, and the interleaving is deterministic rotation rather than randomisation. | "Every step is larger than the noise floor." | The pair is reported as one realised contrast and nothing is licensed by it alone. |
| 5 | **The new shelf read had no deadline.** Postgres's default statement timeout is two minutes, `Promise.all` waits for the slowest source, and the 90-second transcription timeout is only created *after* the vocabulary is built — so one sick row could have held a reader on a spinner for longer than the whole transcription is allowed to take. | Only the article read was bounded. | **Every source** is bounded at 1.5 seconds, in `vocabularyFor` rather than inside one of them. |
| 6 | **`+purpose` was not production-with-a-purpose.** It put the same box into every clip's vocabulary, including two articles it says nothing about and the profile page's, and it omitted the title and byline production sends. | "With a purpose box filled in, production is this row" — false. | The box goes only to its own clip, and the arm carries the title and byline. |
| 7 | **The results file was not auditable.** The dollar figure came from grepping a log nobody kept; the recorded commit named a commit containing neither the harness nor `vocabulary-sources.ts`, because both were uncommitted — which is the normal case for a benchmark run *in order to decide whether to commit*. | `commit: <HEAD>`, no cost. | The provider's own cost, per call and summed, and a hash of every input: the harness, the manifest, the four production files, the shared request code, all ten audio clips, every article's `blocks`/`glossary`/`meta`, and `reader.json`. The first attempt at this hashed five source files and *said* it hashed everything that decided the measurement — so a changed clip would have moved every number without moving a single hash. Sol's third review, item 2. |

Sol found no problem with the fence, with the `SOURCES`/`RECIPES` seam, with the `keyof` typing, or
with imports; it independently reproduced every rounded number in the previous table.

### The third review, of the fixes and the new table

Same again on 2026-08-28 — **not ready**, eight findings
([260828l-dictation-vocabulary-review-3-sol.md](260828l-dictation-vocabulary-review-3-sol.md)). None of them was a
production bug this time; six were the write-up claiming more than the run supports, and two were
code.

| # | Finding | Now |
|---|---|---|
| 1 | **The replicate pair was still being used as a threshold.** The section admitted it was one realised contrast and then used it to retire the profile movement and support the size conclusion. | It can flag a gap as *unresolved*; it cannot retire one. Both claims are rewritten to say that. |
| 2 | **The fingerprint did not cover the inputs.** Five source files, and a claim that it hashed everything that decided the measurement — while omitting the ten audio clips, every article, the reader's profile and the shared request code. A changed clip would have moved every number and no hash. And only the cost *total* was stored, so it could not be re-summed. | Everything above is hashed, and the cost is stored per call. |
| 3 | **The wrong-article vocabulary was not disjoint after all**: the two-character floor let `In` through, and two clips say it. No scored hard term is shared, so it does not explain the degradation — but the flat claim was false, and `NOT_NAMES` was missing `in` while a comment two lines up named `In` as the thing the floor should not admit. | `in`, `on`, `at`, `by`, `as`, `an`, `or`, `of`, `to`, `is`, `be`, `so` added; the claim is qualified. |
| 4 | **"Size costs nothing" is too strong, and two counts were wrong.** 72–73 terms not 70, 86–132 not 86–130, and the identical aggregate hides two clips moving in opposite directions. | "No detectable aggregate cost, in this five-run contrast, up to 132 terms." |
| 5 | **`MAX_TERM` still ate wrong-shaped inputs.** `phrases` fixed the two prose boxes; a long article title, a byline or a glossary entry written as a sentence still reached `pack` raw and got sliced mid-word. | `pack` cuts any over-long term at a word boundary. The `phrases` edge cases Sol enumerated — a spaceless run, a URL with a comma, `Washington, D.C.`, CJK — are pinned in tests as decided behaviour rather than left to be discovered. |
| 6 | **The profile's retention rationale was not evidence.** The purpose row shows a relevant supplied spelling helps; it does not show a global biography predicts article dictation. And the profile is *not* a read we already make — it is its own query. | Both corrected. Sol's ten-call test design is written into the open questions. |
| 7 | **The deadline is sound, the documentation was not.** The losing read is not cancelled, may hold a connection, and only the names path caches — and Vercel may freeze the instance once the response is sent, so "the next press has what it fetched" is a possibility, not a promise. | Said that way. |
| 8 | **The perfect purpose row is not a scoring bug** — Sol checked the stored transcripts — but the attribution was loose. | Credited with fifteen hard-term hits and its own clip's correction, rather than with every edit in the 0.0%. |

## Open questions

1. **The extractor has no held-out precision measurement.** The table above is my own reading of
   five articles, and I wrote the extractor. GPT Sol asked for a held-out set and it is right to.
   Default: leave it. The cost of a false positive is measured at nothing, and the effort is a
   labelling exercise on articles nobody has ingested yet.
2. **The profile is in the recipe as a hypothesis, not on a measurement.** The one run that isolated
   it moved recall the wrong way by about what two identical conditions differ by, and no clip in
   the set says anything only the profile could supply — so the arm is uninformative rather than
   negative. Default: keep it, and stop quoting it as measured. **The test is cheap and specific**,
   and Sol wrote it out: one synthetic profile carrying three or four acoustically ambiguous terms
   that appear nowhere else, one clip that says them, and two otherwise byte-identical arms with and
   without the profile. Five interleaved runs is **ten calls**. That is the next thing to do here,
   and there is no good reason it is not done.
3. **Should a wrong-slug dictation fail rather than degrade?** The wrong-vocabulary arm is now the
   largest harm in the table by a distance — 6.8% word errors against 4.6% for no vocabulary at all,
   losing terms on five clips. It can happen from a stale client or a reader with two tabs, and
   `parseWhere` validates the slug's *shape*, not that the reader is looking at it. Default: still
   leave it, but less comfortably than before: refusing a dictation because a slug looks stale
   throws away a minute of somebody's talking, and there is no cheap way to tell a stale slug from a
   legitimate one.
4. **German, and any language that capitalises its nouns.** `properNouns` on German prose returns
   ordinary nouns (`Wahrnehmung`), because they are capitalised mid-sentence. Measured as harmless,
   so this wastes characters rather than doing damage, and `meta.lang` is right there if we ever
   want to gate on it. Default: leave it, documented. Scripts with no letter case — Chinese,
   Japanese, Arabic — return nothing at all, which is the right failure but means those articles get
   glossary and site terms only.
5. **A list rendered in the article body gets missed.** Terms on their own lines read as
   sentence-initial, so a glossary printed inside an article contributes nothing. Default: leave it;
   that article's own glossary artefact covers the same ground.
6. **`loadArticle` is a heavy read for twenty-five terms**, and Sol's suggestion is the right one
   eventually: a narrow `kind + text + title + byline` read, or extracted terms persisted at ingest.
   Neither is in scope here — the first is a store contract change, the second a pipeline artefact.
   What is done instead: a 1.5-second deadline, a 32-entry cache, and `vocabularyMs` in the log so
   the cost is visible rather than inferred.
7. **Should the live browser recogniser get the same terms?** Chrome ships `SpeechRecognitionPhrase`
   with a `boost`, and there is now a term list the client could be handed. It would improve the
   *live* half the way this improves the final one. Out of scope: it needs an endpoint and a
   Chrome-only path. Named in [dictation.md](../project/dictation.md).
8. **The names cache never goes stale.** 32 entries per process, keyed by owner and slug; a
   re-extracted article keeps its old names until the instance recycles. Harmless — the terms are a
   hint, not a fact — but a decision rather than an oversight.

## See also

[dictation.md](../project/dictation.md) · [260827x-dictation-two-pass.md](260827x-dictation-two-pass.md) ·
[glossary.md](../project/glossary.md) · [reader-profile.md](../project/reader-profile.md) ·
[silent-success.md](../reusable/silent-success.md)
