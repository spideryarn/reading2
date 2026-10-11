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

Each note is `{ blockId, kind, text, to }` with `to` a block id or `null`, always present (the
"omit this field" comma trap, [prompting-guide.md](../project/prompting-guide.md#what-the-model-writes-back)).

**Sparing, enforced in code as well as asked for in the prompt.** A cap scaled to the article: one
note per eight listed paragraphs, at least two, at most eight. Validation, each with a `dropped`
counter as the relation rows already have: an unknown `blockId` or `to`; `to` equal to the block or
missing on `recall`/`tension`; a second note on the same block (first wins); text over 40 words or
empty; anything past the cap. **A bad note never fails the run**: the relation words are the step's
contract, notes are extra, and zero notes is a real answer.

**The prompt carries `plainWords("explain")`**, since the step now writes prose a reader sees, and
`src/relations.ts` leaves `PLAIN_WORDS_EXEMPT`.

**In the margin**, a note is a line of its own in the AI's face, under the relation word and before
the part's question: a small-caps stamp, the text, and for `recall`/`tension` a link to the other
passage (`BlockRef`, so it has the block-link card and the jump). **Shown open, not shut** like the
other modes' items: it is short, there are at most eight, and a shut line that says "1 note" would
hide the only thing it has to say. A card on the stamp says what it is and who wrote it (`tips.ts`,
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

One call per article per showing already; this adds output (eight notes is ~400 tokens) and the
model's thinking. Measured below.

### Questions for Greg (decided for the simplest version; easy to change)

- **Q-notes-effort**: the call stays at `low` effort. Finding an inconsistency is the hardest part
  of this; if the measurement shows `low` finds none on articles that have one, raise it to `medium`.
- **Q-notes-kinds**: four kinds, the stamp saying which. *Tension* rather than *Inconsistent*,
  because the model will sometimes be wrong and the softer word leaves room.

## Measurement

(To be filled in: production's own `generateRelations`, the old prompt twice and the new prompt
once on the same local articles; relation word agreement between arms, notes per article, a read of
every note against its passages, tokens and cost.)

## Reviews

- Plan: GPT Sol, `--sandbox review` — `261011o-plan-review-sol.md`.
- Code: GPT Sol, workspace-write — `261011o-code-review-sol.md`.
