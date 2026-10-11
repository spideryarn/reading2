# Marginalia off the first open, and a few notes of its own

Two suggestions from Greg, both proved his with `scripts/feedback-reporter.ts` (exit 0), Overseer
queue item `qi-zqajzkf3`. Part of [marginalia.md](../project/marginalia.md).

> I had previously suggested that by default when we open an article for the first time, we would
> open Marginalia mode. Actually I think the UI complexity is overwhelming for new users so let's
> not open Marginalia mode by default.
>
> — Greg, 2026-10-11 (`spya-mw08mv`, SPIDERYARN-READING2-H3)

> The marginalia mode is a nice idea, but it's still not yet useful. […] I think we could give the
> LLM just a bit more freedom to play and experiment, so perhaps it can produce other scribble notes
> as it sees fit. Perhaps it can explain things that would otherwise be confusing, or provide other
> notes sparingly that might be helpful to the reader. We don't want to overdo it, though. […]
> maybe the marginalia mode could highlight really important cross-references, especially if
> there's an inconsistency or if the reader might benefit from being reminded what that other
> section said.
>
> — Greg, 2026-10-11 (`spya-qyuet0`, SPIDERYARN-READING2-HG)

## Stage 1 — the first open stops turning the column on (`spya-mw08mv`)

A reversal of [261005a](261005a-no-home-icon-beside-the-logo-and-a-first-open-default-of-summary-and-marginalia.md)'s
second half. `firstOpenSearch` (src/web/last-view.ts) returned `?mode=chat&guide=1&margin=1` from
900px; it now returns the guide alone from 700px and the article alone below, at any width. Its
`rootFontPx` argument went with `notesFit`, the only thing that read it. Side effect worth knowing:
a first open no longer spends on the column's relation words, because the column is not shown.

Nothing else changes. A pasted `?margin=1`, a reload and a restored view still show the column, and
an article left with the column on is still put back with it.

Tests: `tests/last-view.test.ts` (red on the old code: 900, 1440 and 2400px all asked for
`&margin=1`) and the five hook tests that had `&margin=1` in their expected address.

## Stage 2 — notes the model chooses to write

### What exists, and what Greg is asking for

Marginalia makes one thing itself: the **relation words** (*so*, *but*, *vs*), one model call per
article, the `relations` step ([src/relations.ts](../../src/relations.ts)). Its prompt is closed:
one of ten words per paragraph, no prose. Everything else in the column is another mode's.

**Cross-references already exist**, as links in the prose
([cross-references.md](../project/cross-references.md)): a phrase that sums up something shown
elsewhere links to it. They are many, unranked, and say nothing about *why* the other passage
matters. Greg asks for something different: the few cross-references that matter, especially an
**inconsistency**, or a reminder of **what the other section said**. That is a judgement plus a
sentence, which a link does not carry.

### The change

The same `relations` call may also write **a few notes** (`relations/3`). The model writes nothing
unless it is worth a reader's attention, and at most a handful:

| Kind | Stamp in the margin | What it is | Points at another passage |
|---|---|---|---|
| `explain` | *Note* | a line that unpicks something likely to confuse | no |
| `recall` | *Recall* | what an earlier or later passage said that this one leans on | yes, required |
| `tension` | *Tension* | this passage seems not to fit with another one | yes, required |
| `aside` | *Note* | anything else short that would help this reader here | optional |

`aside` is the "freedom to play" Greg asked for; the other three are the cases he named.

Each note is `{ blockId, kind, quote, text, to, toQuote }`, with `to` and `toQuote` always
present and null together (the "omit this field" comma trap,
[prompting-guide.md](../project/prompting-guide.md#what-the-model-writes-back)). **Both ends are
quoted and the quotes checked** (Sol on the plan, P1-3): `quote` must be in the note's own passage
and `toQuote` in the other, with `findQuote(…, "spaced")` as FAQ does, and the stored quotes are the
article's characters. An id alone can name a real but wrong passage.

**Sparing, enforced in code as well as asked for in the prompt.** A cap scaled to the article: one
note per eight listed paragraphs, at least two, at most eight (`noteCap`). Validation, each rule
its own counter in a separate `notesDropped`: a row that is not an object; an unknown `blockId` or
`to`; a kind off the list; `to` equal to the block, missing on `recall`/`tension`, or present on
`explain`; a quote not found; text empty or over 35 words (the prompt asks for 25); a second note on
the same block (first wins); and **only then** the cap, in the model's order, which the prompt makes
most valuable first, so a bad row never takes a slot (Sol P2-5). **A bad note never fails the
run**: the relation words are the step's contract, notes are extra, and zero notes is a real
answer. An article with fewer than two body paragraphs still makes no call and so gets no notes
(Sol P2-6, decided: the short case is not worth a call of its own).

**The notes come before the words in the answer** — in the schema, the example and the user
message. Asked for after the words, the model barely wrote any (§ Measurement).

The answer budget counts a full set of notes at their longest, quotes included (Sol P1-1):
`answerTokens` adds `noteCap × 300` tokens.

**Labels that said "words" now say both** (Sol P2-8): Metadata's rerun row is *Marginalia notes*,
the job's label adds "and writing a few margin notes", and the export's description of
`relations.json` mentions the notes.

**The prompt carries `plainWords("explain")`**, since the step now writes prose a reader sees, and
`src/relations.ts` leaves `PLAIN_WORDS_EXEMPT`.

**In the margin**, a note is a line of its own in the AI's face, under the relation word and before
the part's question: a small-caps stamp, the text, and for `recall`/`tension` a link to the other
passage (`BlockRef`, so it has the block-link card and the jump). **Shown open, not shut** like the
other modes' items: it is short, there are at most eight, and a shut line would hide the only thing
it has to say. (Sol P2-7 pointed out a shut line could show the note's own words, cut to a line;
with 25-word notes the open note is two or three lines at 288px, so open stayed, and the browser
check below looked at a cluster.) A card on the stamp says what it is and who wrote it (`tips.ts`,
a `Record` over the four kinds). Owner only, like the words.

Stored inside the existing `article_revisions.relations` JSONB: `Relations.notes`, optional on read
so an old row is "no notes". **No migration.** Bumping the version makes every old row outdated,
and the next time its owner shows the column it is rewritten; the old words stay on screen until
then (useRelations.ts).

### The simpler options passed over

- **Draw the existing cross-references in the margin.** No model work, but it is the unranked list
  Greg is not asking for, and it carries no sentence; an inconsistency is never a crossref.
- **A separate `marginnotes` step.** Cleaner to read on its own, but a new step is ~30 files (step
  order, jobs, cost categories, routes, schema check constraint, export, metadata rerun, help) and a
  second call over the same article on every showing. The notes need the same input, the same
  freshness and the same owner-only rule, so they ride on the call that exists. If they grow — a
  visitor's copy, a separate rerun — they move out then.
- **Notes shut by default**, like FAQ and Debate items. Rejected above: a shut line with nothing on
  it but a count is the "not yet useful" Greg reported.

### Cost

From about 4.9 to about 5.7 cents an article per run, measured below. It runs once per article
when its owner first shows the column, and once more for every article that already has words,
because the version moved.

### Questions for Greg (decided for the simplest version; easy to change)

- **Q-notes-effort**: the call stays at `low` effort. `medium` was measured and changed nothing
  (§ Measurement).
- **Q-notes-kinds**: four kinds, the stamp saying which. *Tension* rather than *Inconsistent*,
  because the model will sometimes be wrong and the softer word leaves room.
- **Q-notes-density**: about one note per eighteen paragraphs on the four articles measured. More
  is a sentence in the prompt; fewer is the cap.

## Measurement

[`evals/margin-notes/run.ts`](../../evals/margin-notes/run.ts) calls production's own
`generateRelations` at standard power on four local articles of different kinds: the Transformer
paper (`arxiv-1706-03762v7`, 101 paragraphs asked about), a Paul Graham essay (`desres`, 38), Nagel's
*What is it like to be a bat?* (33) and a cognitive-science review (`fd-src-nihms-536461`, 57).
Each arm records `PROMPT_VERSION` and a hash of `src/relations.ts`; the arms are in
`evals/results/margin-notes/`. `npx tsx evals/margin-notes/run.ts report` prints the table.

| Arm | Prompt | Notes (4 articles) | Drawn words | Words agreeing with `before` | Output tokens | Cost |
|---|---|---|---|---|---|---|
| `before` | `relations/2` | — | 28 | — | 5,938 | $0.198 |
| `before-2` | `relations/2`, the control | — | 27 | 208/229 (91%) | 5,939 | $0.198 |
| `after`, `after-2` | notes after the words | 2, 4 | 29, 30 | 197, 194 | 6,237, 6,462 | $0.215, $0.217 |
| `after-medium` | the same at `medium` effort | 2 | 28 | 199 | 6,238 | $0.215 |
| `v2`, `v2-2` | softer "how many" wording | 4, 3 | 27, 28 | 196, 193 | 6,404, 6,358 | $0.217 |
| **`v3`, `v3-2`** | **notes first** — what shipped | **11, 14** | 34, 34 | 190, 200 (83%, 87%) | 7,373, 7,577 | $0.227, $0.229 |

What the numbers say:

- **Asked for after a hundred rows of words, the model hardly wrote a note**; two articles got none
  in any of five runs. Effort made no difference (output tokens show `low` and `medium` did the same
  work). Asking for the notes first raised it to 11–14, every article getting some, both runs.
- **The words moved a little.** Against `before`, the shipped prompt agrees on 83–87% of words; two
  runs of the old prompt agreed on 91%. The drawn turns rose from 27–28 to 34. Acceptable for what
  the notes give, and worth a look if Greg finds the margin busier.
- **Nothing was dropped by validation** in any run: every quote was found in its passage.

**Every note, read against its passages** (the 25 from `v3` and `v3-2`):

- **The Transformer paper's real inconsistency was found in all seven runs of the new prompt,
  whatever its wording**: §6.1 says the big model scored 41.0 BLEU on English-to-French, while
  the abstract and Table 2 give 41.8. A true *Tension*, which is exactly Greg's case.
- **Two *Tension* notes are weak**: that "over 2 BLEU" is only barely true (2.04), and, in the
  essay, that the author's later speculation that research may not be collaborative contradicts his
  earlier remark that it can be. The first is pedantic, the second is a development of the argument,
  which the prompt says is not a tension. 2 weak of 5 distinct tensions; the card tells the reader to
  judge.
- ***Explain* notes are the bulk and mostly good**: why large dot products saturate the softmax,
  why a REPL leaves no place for type declarations, what blocking means in learning experiments,
  the 62.5% arithmetic of probability matching.
- ***Recall* notes are fair**: the result in Table 3 row (E) that "nearly identical" refers to; an
  earlier finding about dopamine and reversal learning that a later passage leans on.
- **Nagel's article came out of extraction with a paragraph spliced into the middle of a sentence**,
  and in every run the model said so in an *aside*. Not what Greg asked for, but true and useful,
  and a pointer to an extraction bug worth its own look (not this work).

## Reviews

- Plan: GPT Sol, `--sandbox review` — `261011o-plan-review-sol.md`.
- Code: GPT Sol, workspace-write — `261011o-code-review-sol.md`.
