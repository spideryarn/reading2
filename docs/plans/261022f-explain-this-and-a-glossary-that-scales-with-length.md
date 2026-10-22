# "Explain this", and a glossary that grows with the length of the piece

Greg's admin report `spya-e5t77w` (#674, 2026-10-21 23:11 UTC), on Rovelli's *The Order of Time*,
paragraph `spya-zbpzqk`. Trusted (`feedback-reporter.ts` exit 0). His words are in the note,
[261021_2311-torricelli-explain-names-the-glossary-missed.md](../user-feedback/261021_2311-torricelli-explain-names-the-glossary-missed.md).

In short: he met *Torricelli*, did not know who that was, and nothing made it one click away. He
asked for three things: a write-up of the "explain this" continuum (glossary, citations, things
referred to but not cited, later "explain this sentence"), with evidence on what helps learners; a
signpost from the reading-experience vision doc; and to build only the parts where the evidence is
good, the change is fairly easy, and we are confident it helps. He guessed the simplest of these
himself:

> the simplest extension would be to say the glossary should include stuff like Torricelli […] I've
> got a hunch that maybe it would have been found by the glossary, but the glossary only finds so
> many because, you know, it does a sweep and it's instructed not to try and find endless numbers of
> things.

## Why Torricelli was missed (production, read-only, 2026-10-22)

His hunch is right, and there were two causes, not one.

The book is 1,046 blocks and 38,255 body words. Its glossary has **one pass and 20 entries**
(`glossary/9`, Sonnet): Anaximander, entropy, Boltzmann, Gödel, loop quantum gravity … Edmund
Husserl. Torricelli is named in exactly one block. Citations does not have him either: he is not
cited, only told about, and none of the 20 cited works is his.

1. **A fixed cap on a list that ought to scale.** `suggestedCount` asks for one term per 400 words,
   about 96 here, and clamped it to `BATCH_SIZE`, 20. So a book got one entry per 1,900 words where
   an essay gets one per 400.
2. **A rule that left passing names out on purpose.** *WHAT DOES NOT* excluded *"terms you can
   define only from general knowledge and which the piece does not actually depend on"*, and a name
   dropped once is exactly that. Lifting the cap alone did not bring him in (below).

## What was built (`glossary/10`)

- **The count follows the length.** `MAX_ENTRIES = 150` replaces `BATCH_SIZE = 20`. The call streams
  and its budget is sized from the count (`600 + count × 340` answer tokens), and 150 stays under the
  response ceiling; a test pins that. Past about 60,000 words the density falls again, and *Find
  more* is the way on. That is a ceiling, stated, not a fix for every length.
- ***Find more* asks for what the length still wants**: `suggestedCount(words, existing)` is
  `target − existing`, never fewer than the old ask (at most 20) on an essay. So on an essay it is
  byte-for-byte the old request, and on Greg's 20-entry book list one press asks for 76. This is what
  makes the fix reach the list that prompted it (GPT Sol F1).
- **A long piece is worked through part by part.** When the count is over 20, the request gains one
  line: *work through it part by part … give a name or term met only in a late part the same chance
  as one met early.* An essay's request does not change.
- **A name met once earns an entry.** *WHAT BELONGS* says people, organisations, places, works and
  events named without introduction count *even when the piece names them only once, in passing*,
  and the *does not depend on* exclusion now says it is about terms, not names; `centrality` says how
  little rests on a name.

No new artefact, column, route or screen. The prompt bump does not announce older lists as outdated
(260929c), and *Find more* still appends to them (`appendableVersion`, 261004f).

### The simpler and the more complicated options passed over

- **Parallel calls over stretches of the piece** (this plan's first version). GPT Sol rejected it
  ([review](261022f-explain-this-plan-review-sol.md)): duplicates across calls that cannot see each
  other's lists, partial failure that would publish an incomplete list as complete, a `passes`
  count that would lie, cache fan-out paying the article five times, and a fixed cap of five
  stretches anyway. Its F7 proposed one call with the count unclamped, which was measured and
  built. Its other findings fell away with the stretches.
- **Raise the cap and do nothing else.** Measured below: not enough. The model ranked the whole book
  and stopped where the ranking thinned, and the rule against passing names kept him out.
- **Do nothing; the reader can type the name into *Look up a term*.** Two clicks and a word, and it
  streams, with web search if the model needs it. But it only helps a reader who knows the name is
  missing and where the box is, and Greg did not, which is the report.

### What it costs, and what it does to the page

- **Money and time, on a book:** about $0.25 and 40 seconds a first run, against $0.17 and 20
  seconds. On an essay, nothing changes but the names rule.
- **The band:** about half of a book's entries are names with low centrality, under the default
  threshold of 0.10, so they are counted in *N terms hidden* rather than listed. That bends Greg's
  2026-09-12 wish that *most entries come in by default* on a book. It is left as is, because the
  band is not how he reached for Torricelli: the underline and its card are, and those draw every
  entry whatever the threshold.
- **The prose:** the share of the book's blocks with at least one underline went from about a
  quarter to about half. The evidence (Jayes 2022) says underlines make unmarked text look less
  important, so this is a real cost, named here and in the vision doc's next steps. Greg asked for
  the names explicitly. A fainter underline for a low-centrality entry is the evidence-shaped answer
  if it proves too much, and it is queued.

## Results

Every run calls the real `generateGlossary` (Sonnet, no profile) on the book, read from production
inside `begin read only` and never written back, from a scratch script deleted afterwards. The
essays are `evals/glossary-citations.ts` arms against the local database.

| Arm | What | Entries | Torricelli | Terms + concepts | People | Output tokens | Wall |
|---|---|---|---|---|---|---|---|
| `before` | `glossary/9` as shipped | 21 | no | 16 | 5 | 2,236 | 20 s |
| `onecall-96` | the cap lifted only | 55 | no | 28 | 24 | 5,233 | 35 s |
| `names-96` | + the names rule | 70 | **yes** | 20 | 39 | 6,297 | 38 s |
| `names-96b` | the same again | 48 | no | 16 | 27 | 4,580 | 27 s |
| `spread-1` | + part by part (shipped) | 71 | **yes** | 25 | 36 | 6,469 | 40 s |
| `spread-2` | the same again | 73 | **yes** | 35 | 35 | 6,807 | 44 s |
| `append-prod-2` | shipped, *Find more* on Greg's 20-entry list | 87 | **yes** | 33 | 41 | 6,414 | 41 s |

- Input was about 76,000 tokens on every run, uncached, and is most of the cost: $0.17 before, about
  $0.22–0.25 after.
- **Nothing the old list had was lost** in either shipped run (every one of the 21 names or aliases
  matched). `spread-2` had two entries matching no block (*Newton's absolute time*, *mollusk of
  Einstein*), the existing *these exact words do not appear* case.
- Torricelli's entry, `spread-2`: *"Italian physicist who in the 1600s showed that a vacuum can be
  produced by removing air from a tube."* background only, difficulty 0.4, centrality 0.1.
- `append-prod-2` cleared the list's `profileHash` to take the append path; a first emulation that
  kept Greg's profile hash took the rewrite path instead (63 entries, Torricelli present), which is
  what *Write a new list* would do.
- **Essays, three runs of the names rule against the `glossary/9` arms of 261003g:** no citation
  entries or citation aliases in any run (the 261003o guard holds). People went up a little:
  `noema-mythology-of-conscious-ai` 3–4 against 3–7; `source-spya-f550ta` 11–13 against 5–10.
  `scaling-hypothesis` and `source-spya-f550ta` are long enough to be asked for more than 20 now,
  and gave 32 and 25–27 entries against 19–20 and 7–20.
- Two runs per arm on the book, so the numbers are a dated example, not a rate: the same prompt
  differed by 22 entries between two runs (`names-96`, `names-96b`).

## Not built, and why: the write-up holds these

The evidence and the design discussion are in
[explain-this-vision.md](../project/explain-this-vision.md) (direction, not decided) and
[261022b-explain-this-evidence.md](../research/261022b-explain-this-evidence.md) (the evidence).
In short:

- **A candidates list underlined in bulk and filled on click, or filled as the reader approaches.**
  It is several stages of work (a new entry state, a second underline style, streaming into the
  card, a prefetch scheduler, an allowance so a stranger's clicks cannot spend without limit). It
  also breaks the threshold, which needs scores a placeholder does not have. Stretches get most of
  the value for a fraction of the work, so this waits until a book's list is seen to be still too
  thin. Queued.
- **Merging glossary, citations and things referred to but not cited into one kind of entry.**
  That would undo the 2026-10-03 decision that *a cited work is not a term*, and Torricelli does not
  need it: he is told about, not cited, so he is already the glossary's. The continuum is better
  served at the hover card, where a citation's card could also answer *why is this cited* (see the
  vision doc).
- **Web search for names in the batch.** The model knows who Torricelli was; the cap was the
  problem, not knowledge (the same finding as Lamport, 2026-08-26). A reader's own *Look up* already
  searches the web when the model needs it.
- **A model-placed "explain this sentence" underline.** The evidence is against the model deciding
  where a reader is confused. Explaining a selection the reader chooses already exists (select,
  then *Ask AI* with nothing typed asks *"Explain this passage."*,
  [comments.md](../project/comments.md)). Queued as part of the vision doc's later steps, not built.

## Stages

1. **The plan, the evidence doc and the vision doc.** GPT Sol reviewed the first version of the plan
   (read-only) and rejected it. The design was replaced by its F7 and measured (§ Results).
2. **The change**, in `src/glossary.ts`, with tests in `tests/glossary.test.ts`, and
   [glossary.md § A long piece, and a name met once](../project/glossary.md#a-long-piece-and-a-name-met-once).
   GPT Sol's code review, then the push.
3. **Bookkeeping:** the note, the queue entries for the deferred halves, and the Sentry status.
