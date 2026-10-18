# Marginalia notes that save a click: where a quote comes from, and what a citation says

Report `spya-w99qsz` (#596, suggestion, Sentry SPIDERYARN-READING2-JJ), from Greg (admin,
`feedback-reporter.ts` exit 0), filed 2026-10-17 23:31 UTC reading
`rovelli-order-of-time-…-spya-r26sug` with Structure open. Queue item `qi-djrqnhdm`. Session
`fbw99qsz-marginalia-saves-a-click`.

> Probably the most useful thing is to situate the article in the outside world, in references that
> it makes and references made to it. I'm thinking especially of the annotations mode, because as
> I'm reading this, most often I want to know a bit more about the quotes or the citations or the
> allusions or whatever, and indeed a bit about what people think of the claims being made. […] the
> annotations should be the useful stuff, the stuff that saves the user a click, the things that
> they would have looked up. So it could be a combination of, you know, oh, where does that come
> from, or why did they choose that quote, or what's that citation say, and does it really say what
> they say it says? And then also, this is confusing and I want to understand this more, or
> whatever. Those are the two primary things I think I want the annotations mode to do. And
> actually it strikes me for a while that the glossary could be not just individual words, could be
> phrases or ideas. Maybe that's a thing to come back to. But let's start with just enhancing the
> annotations mode with stuff that the user might find useful, and you figure out how to represent
> it or how to fit it in with the modes we have. So maybe we need a separate explanations mode, kind
> of like the glossary. And then the annotations mode could draw on explanations mode. And we could
> broaden sources to include not just, like, explicit citations, but quotes or mentions or allusions
> or whatever.
>
> — Greg, 2026-10-17 (spya-w99qsz)

"Annotations mode" is Marginalia ([marginalia.md](../project/marginalia.md)).

## What is there already

- **Marginalia's own model notes** (`relations/3`, plan
  [261011o](261011o-marginalia-off-the-first-open-and-notes-of-its-own.md)): four kinds, *tension*,
  *recall*, *explain*, *aside*, written by the one `relations` call, quoted and checked, owner only,
  2–8 per article. **"This is confusing" is already `explain`**; its prompt says "Use only the
  article. Not what you know from elsewhere", so it cannot say where a quote comes from.
- **Sources › Citations**: every cited work, and since 261017h a **checked note on what each work
  says**, written from its abstract alone and checked against it (`citation-blurbs`,
  [bibliography.md](../project/bibliography.md)). The Sources band and the hover card show it; **the
  margin's *Cites* line does not** — opened, it shows only the by-line and the reference entry
  (`CitationNote` in `MarginaliaColumn.tsx`).
- **Sources › Claims (Debate)**: what others say about a claim, already in the margin, shut.
- **Glossary `background`**: who a named person is, what a named work is, from the model's memory,
  labelled — the precedent for showing memory as a label rather than a warning
  ([glossary.md § Provenance is the label](../project/glossary.md#provenance-is-the-label-not-a-badge)).
- **The sibling report `spya-h5mteu`** (plan `261018h-modes-say-what-the-wider-world-thinks-labelled.md`,
  session `fbh5mteu-modes-wider-world`, reviewed and finishing, not yet on `dev` when this was
  written): a shared prompt section `widerWorld()` so Chat, Recall, Tutorial and Quiz may say when
  the article is wrong or disputed, labelled article / memory / web. Its rule that carries here:
  **the three origins are always told apart, and memory is said to be memory.** Its section is
  written for conversational replies (placement, turn shape, search); a margin note is 25 words
  with a stamp, so this work labels by the note's kind rather than by importing that section.

## The simplest useful version (this plan)

Two things, both inside Marginalia, no new mode, no migration, no new call.

### Stage 1 — the *Cites* line opens to what the work says

Where a cited work has a checked note, the margin's opened *Cites* entry shows it under the
by-line, with the same `CiteBlurb` component the Sources band uses (its card says it was written
from the abstract and checked, quotes the abstract, links it). A work without one is unchanged.
This answers "what's that citation say" without a click, from something we already pay for.

- The margin's *Cites* line is owner-only and reads the owner's fresh Bibliography
  (`marginaliaBibliography` in `Reader.tsx`), which already carries `blurb` through the one guard
  `shownBlurb` (`attachBlurbs`). So the margin shows exactly what the band shows, and nothing new
  reaches a visitor.
- **Not** "does it really say what they say it says": that needs the article's claim checked against
  the work, a new model call with its own faithfulness check. Queued (below).
- `<CiteBlurb blurb={work.blurb} owned linked />` inside the opened panel (not a tooltip, so the
  link is safe). The *Cites* card (`MARG_TIPS.citation`) is reworded: it promised only the article's
  title, authors and entry, which is no longer all that opens; it now names the AI-written, checked
  note on what the work says too (Sol F5).
- 261003j ("nothing about a paper beyond what's available in the bibliography … better to say less")
  does not forbid this: the checked abstract note is the labelled exception Greg asked for in
  261017h, and the Sources band already shows it.

### Stage 2 — origin notes: where a quote, allusion or named reference comes from

The `relations` call may write a few **origin notes** beside a passage that quotes, alludes to or
names a work, a line, a saying or a person **that the piece itself does not explain**: where it
comes from. From the model's own knowledge. (Revised after GPT Sol's plan review,
[261018i-plan-review-sol.md](261018i-plan-review-sol.md): F1–F4, F6, F7 taken.)

- **Their own array, not a kind the model picks** (Sol F1). The answer gains a top-level
  `sourceNotes` array whose rows have no `kind` field; code stamps `kind: "source"` after
  validation. The existing `notes` array keeps the unconditional "Use only the article" rule. One
  shared set of taken passages across both, so a passage still gets at most one note; a separate
  `sourceNotesDropped` count. So the provenance boundary is a field, as Glossary's `senseHere` /
  `background` is, rather than a word the model writes into one mixed list.
- **Labelled visibly as memory and unchecked** (Sol F2): the stamp is *Origin* (not *Source*, which
  could read as "a source was consulted"), and after the note's words a muted **AI memory,
  unchecked**. The card says the article does not say this, the AI wrote it from what it already
  knows, nothing checked it, and to treat it as a lead. In the AI's face like every model note.
- **When to write one**: a careful general reader would otherwise stop to look it up — an
  unattributed quotation, an allusion they may miss, a work or person named in passing whose
  identity matters to the point. **Not** when the piece attributes and explains it already, not for
  a formal citation (Citations has those), not for something famous enough that every reader
  knows it.
- **The attribution ladder** (Sol F3), in the prompt with negative examples:
  - name an exact work only when sure of that exact work;
  - otherwise say only what you are sure of — the author, the tradition, "a saying often
    attributed to …" — or write nothing;
  - say when an attribution is disputed or only commonly made;
  - never quote remembered wording as if it were checked;
  - **never say why the author chose it or what they intended.** The note may say plainly what the
    original was about, which is often what makes the fit visible; the reader draws the line.
  Greg asked "why did they choose that quote"; the honest v1 is the origin and what the original
  meant, not a guess at intent.
- **No target**: the row is `{blockId, quote, text}`. The quote check is unchanged: `quote` must be
  the article's words in that passage. That proves the join, not the attribution, which is what the
  label is for.
- **Its own small allowance** (Sol F4): `sourceCap(p) = min(4, max(2, ceil(p / 16)))`, so 2–4 per
  article, beside today's 2–8 article-only notes. Sol suggested a fixed 2; a long chapter thick with
  quotation (Greg's Rovelli) would then get two, which undersells the ask, so 4 at most. Over-cap
  has its own counter. `answerTokens` adds `sourceCap(p) × TOKENS_PER_NOTE`.
- **Order in the answer**: `notes`, then `sourceNotes`, then `relations` — notes first is what made
  the model write them at all (261011o § Measurement).
- `PROMPT_VERSION` → `relations/4`: every stored row becomes outdated, and the next time its owner
  shows the column it is rewritten, the old words and notes staying on screen until then (as at
  `relations/3`). No backfill, no migration (the notes are inside the `relations` JSONB; the stored
  `notes` list holds `source` rows after the code stamps them, so the client reads one list).
- **Every place that has to hear about it** (Sol F7): `MARGIN_NOTE_KINDS` and `MarginNotesDropped`
  (types), `toSourceNotes`, `sourceCap`, `answerTokens`, schema and prompt (relations.ts);
  `NOTE_TIPS` (a `Record`, so a missing row is a type error); `AsideNote` (the visible label);
  `MARG_TIPS.citation` (stage 1); the help page `src/web/help/pages/modes/marginalia.md` and its
  generated corpus; the mode catalogue entry in `src/mode-catalog.ts`; the export description of
  `relations.json`; `bibliography.md`'s "Marginalia does not show notes"; `marginalia.md`; tests in
  `tests/relations.test.ts` (schema keys, caps, validator) and the margin card/render tests. No
  public DTO change: relations stay owner-only.

### How we will know it works

`evals/margin-notes/run.ts`, unchanged in method ([prompting-guide.md § Measuring a prompt
change](../project/prompting-guide.md#measuring-a-prompt-change)): `before` twice on the current
prompt (the control), `after` twice on the new one, each arm recording `PROMPT_VERSION` and the
source hash. Arms are prefixed `w99-` so 261011o's are never touched. Local articles: rich in
quotation and allusion — Nagel's *What is it like to be a bat?* (`fd-src-nagel-bat-spya-f5aw85`),
*What You Can't Say* (`say-spya-ur0xcy`), the Weizenbaum profile
(`joseph-weizenbaum-inventor-eliza-chatbot-turned-spya-rtd7c7`), *The Age of the Essay*
(`essay-spya-z7v5j9`), *Why Nerds are Unpopular* (`nerds-spya-m034gh`) — and the Transformer
paper (`arxiv-1706-03762v7-spya-wv4w9s`), where origin notes should be rare. (*On Reading Slowly*
was in the first `before` arms and is dropped: locally it has two paragraphs.)

**A case manifest first** (Sol F6), written before any `after` arm runs, in
`evals/marginalia-sources/cases.md`: for each article, the passages that should get an origin note
(the quotation or allusion, the most specific attribution that is defensible, and how I checked it),
and the tempting negatives (an attribution the piece already explains, a formal citation, something
too famous to need it).

Pass, both `after` runs:

1. **Every attribution in every origin note is checked**, not only the ones that look doubtful,
   against the manifest or a web source. **One wrong, over-specific, or disputed-but-unqualified
   attribution fails** the arm; fix the prompt and rerun. If two rounds cannot reach zero, drop
   unattributed quotations from v1 and keep named people, works and allusions.
2. **Zero claims about why the author chose something.**
3. **Zero origin notes on a manifest negative**; the paper gets at most one.
4. **Each allusion-rich article gets at least one correct, useful origin note** in both runs.
5. **The existing notes are not hurt**: read every article-only note in the after arms for memory
   leaking in (zero allowed); their count within the two `before` arms' range ± 2 per article.
6. **Relation words**: each `after` arm's agreement with `w99-before` at least the control's
   (`w99-before-2` vs `w99-before`) minus 8 points — 261011o's shipped prompt sat 4–8 below.
7. **No origin note dropped by validation** that the manifest would have wanted (drops counted).
8. **Usefulness, blind**: a fresh subagent sees only the origin notes with their passages, shuffled
   across the two after runs, and marks each useful / redundant / harmful to the reading. Harmful
   must be zero.

Cost: about $0.05 per article per arm, so a few dollars with a rerun.

## What is deferred, and queued

Each gets an overseer-queue entry before the note may say shipped. Queued 2026-10-18 as proposals:
1 `qi-am9ern9p`, 2 `qi-y8s68xd9` (marked needs-Greg: a new mode, or Glossary widened?),
3 `qi-3mmccm5n`, 4 `qi-k3a48hvn`, 5 `qi-b6gnkcya`.

1. **"Does it really say what they say it says?"** — check the article's sentence that cites a work
   against that work's abstract, and say in the margin when the abstract does not support it. Needs
   the citing sentence per work (Bibliography has the block), a check call like citation-blurbs'
   own, and a careful label. Builds on stage 1.
2. **An Explanations mode** — Greg's "glossary … not just individual words, could be phrases or
   ideas": a band of the confusing passages explained, which Marginalia could draw on instead of
   writing its own `explain` notes. Bigger than this: a new mode, a new step, its own eval. Worth
   doing once the `explain` and `source` notes show what readers press.
3. **Sources broadened to quotes, mentions and allusions** — the `source` notes as a list in the
   Sources band beside Citations. Wait until the margin shows they are good.
4. **What people think of the claims, in the margin** — Debate's rows are already there, shut;
   whether to open them or show more is a separate call, once this lands.
5. **A web-checked `source` note** — a search per note to confirm the attribution and link it. A
   call per note; only if memory proves too wrong.

## The simpler options passed over

- **Only stage 1.** Free and immediate, but it answers only the explicit citations; most of what
  Greg describes on a book like Rovelli's is quotation and allusion with no reference entry.
- **Let `explain` use memory.** One kind fewer, but then the reader cannot tell which explain notes
  are the article's and which are the model's — the one thing spya-h5mteu says must stay visible.
- **A separate step for source notes.** A second call per article and a second freshness stamp for
  the same column, when the call that already reads the whole article can write them.

## Decisions and assumptions (nobody is watching this session)

- Built on 261018h's principle, not its code: labelled by kind and a visible label, not by the
  conversational `widerWorld()` section.
- The extra cap is a small product choice inside Greg's explicit ask ("the useful stuff"); it is
  reversible by a constant.

## Measurement

Arms in `evals/results/margin-notes/w99-*.json` (each records `PROMPT_VERSION` and the hash of
`src/relations.ts`); `npx tsx evals/marginalia-sources/report.ts <arms>` prints the table and
every note. The manifest is [`evals/marginalia-sources/cases.md`](../../evals/marginalia-sources/cases.md),
written by a subagent before any after arm ran, each attribution web-checked. The blind file,
key and verdicts are `evals/marginalia-sources/judge-*`. The article dumps the manifest was
written from are not committed (they are the articles' prose); `dump.ts` makes them again.

| Arm | Prompt | Origin notes (6 articles) | Article-only notes | Words agreeing with `w99-before` |
|---|---|---|---|---|
| `w99-before` | `relations/3` | — | 17 | — |
| `w99-before-2` (control) | `relations/3` | — | 18 | 86.9% |
| `w99-after`, `-2` | first `relations/4` | 9, 12 | 15, 19 | 85.1%, 84.2% |
| **`w99-after3`, `-4`** | **what shipped** | **6, 8** | 14, 15 | **85.3%, 84.4%** |

What it says:

- **No wrong attribution in any of the 35 origin notes**, checked one by one against the manifest
  and the judge. None of the three traps was mis-attributed: *"Argue with idiots"* (often pinned on
  Twain, with no evidence) and *"with us or against us"* got no note at all, and every Alberti note
  says only who Alberti was, never which work the quotation is from (the manifest could not trace
  one). No note said why the author chose anything.
- **The Transformer paper got none**, in four runs.
- **The first prompt wrote notes the piece did not need**: ten of 21 on the manifest's negatives (six passages),
  all correct but saying what the passage already said (Montaigne, *Pygmalion*, *Lord of the Flies*,
  Arthur Miller, Wotton, *Fight Club*). The shipped prompt names the cases worth writing (what the
  piece leaves bare) and says to read the surrounding sentences first. Three of 14 then landed on
  a negative.
- **Blind usefulness** (gate 8; an Opus subagent saw only the 14 shipped-prompt notes, shuffled,
  with their passages): **10 useful, 4 redundant, 0 harmful, all accurate.** The redundant four
  repeat the passage (Marx on *Capital*, Miller, Wotton) or are common knowledge (*Fight Club*).
- **The relation words did not move beyond the control**: 84–85% agreement against the control's
  86.9%, inside gate 6's 8 points.
- **Article-only notes**: counts within ±2 of the control per article. Reading every one for memory
  leaking in found one marginal case, an *explain* calling the Fight Club line "a joke borrowed from
  the film", the same register as the control's explain notes, so not a regression this caused.
- **Misses**: the manifest's best positives were mostly bare phrases (*"the American century"*,
  *"military-industrial complex"*, Oresme, Michelangelo's nose). The model prefers named people and
  works. Recall is the weak side, not precision.
- **Origin-note validation drops were not recorded in these arms.** The eval runner recorded
  `notesDropped` but omitted `sourceNotesDropped`, so gate 7 cannot be checked from the committed
  files. The code-review fix records it for future arms; proving it for these arms would require a
  paid rerun.

**Gate 3 (zero notes on a negative) overruled**, after two prompt rounds: three redundant notes in
fourteen, none wrong, and the judge found none harmful. Redundancy fell from six to three; a third
round would fit the prompt to these six articles. Watch it in use.
**Wotton, overruling the manifest**: the passage names him with no word of who he was, which is
the prompt's own case for a note; the manifest's negative was about the quotation, which the piece
attributes.

## Progress

- 2026-10-18: plan written; eval articles chosen; GPT Sol plan review REVISE, F1–F7 taken (above).
- Stage 1 landed (`86cb811de`): the *Cites* line opens to the checked note.
- Stage 2 built: `sourceNotes`, `toSourceNotes`, `sourceCap`, `relations/4`, the *Origin* card and
  label, help, catalogue, export description and docs; measured above.
- Stage 2 committed (`e86448f5a`); full `npm test` green (46151 passed), typecheck clean.
- Browser check (Sonnet, Playwright, local): an *Origin* note with its label at 1280 and 1100px on
  `nerds-spya-m034gh`, made by the model unaided; the tooltip; an opened *Cites* line with and
  without a blurb on `arxiv-1706-03762v7-spya-wv4w9s`. No console errors, no data changed.
- GPT Sol code review: **REVISE**
  ([261018i-code-review-sol.md](261018i-code-review-sol.md)); answered below.
- Deferred items queued (§ What is deferred).

## Code review, and what was done with it

- **P1, an `explain` note leaks memory (*Fight Club* "the film"); split the call.** Checked, and
  **not taken**. The control arms do the same: their `explain` notes gloss *nil admirari* ("Latin
  for 'to be astonished at nothing'"), *diff* ("the programmer's term") and the Latin root of
  *tact*, none from the article. A gloss from general knowledge is what `explain` has always done
  on relations/3, so this is not a leak the shared call caused. Gate 5's "zero allowed" was stricter
  than the baseline it was measured against; that was the gate's mistake. Splitting the call would
  add a second paid call per article and would not change it. Whether `explain` should itself be
  held to the article word for word is a separate question, which nothing in this report asks.
  Sol's sentence in marginalia.md, which overclaimed, has been corrected to say this.
- **P2, gate 3 failed.** Already overruled in § Measurement, with the reason. Greg can reverse it;
  the prompt is one constant.
- **P2, export description.** Taken (Sol's fix): `relations.json` now says a `source` note is "AI
  memory, unchecked", in the README and the HTML index, with a test.
- **P2, eval runner dropped `sourceNotesDropped`.** Taken (Sol's fix): future arms record
  `sourceNote.*`, and report.ts says "origin drops unrecorded" for the committed ones. Gate 7 for
  these arms rests on `toSourceNotes`' unit tests, not on the arms.
