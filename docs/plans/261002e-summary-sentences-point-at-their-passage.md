# Summary sentences point at their passage, and light up when it is on screen

Report `spya-ra5fuz` (SPIDERYARN-READING2-8V), from an admin, so trusted input — Greg, 2026-10-01,
filed from Summary at Brief on the libre article:

> Could we highlight the phrases or sentences in the summary that's being displayed that relate to
> the blocks on the screen? … when either of those blocks are visible on the screen, that
> summary-sentence would be highlighted.
>
> And indeed, perhaps I could hover over the summary-sentence and it would highlight, and I'd get a
> rich tooltip (see tooltips.md) that shows the quotes/blocks from the article that relate to it, and
> I could click on those.
>
> … if it's making things much more complex for a given summary-sentence to relate to multiple
> blocks, then we could just say that each summary-sentence can link to a *single* piece of the text
> that most relates to it. And it's worth saying that not every summary-sentence needs to point to
> somewhere in the text.
>
> … (I suspect that would be messier and also probably involve a lot more annotations. So maybe
> defer that and anything else that's too much complexity for a v2.)

The dispatcher's v1 boundary, from his words: **at most one block per summary sentence, not every
sentence needs one, no multiple colours, no sentence-level highlights in the prose.**

## What is there already

- Each stored paragraph is `{ text, ids }`: one to three body-evidence block ids, chosen by the
  writer, checked against the article, and checked again by the fidelity guard (`src/simple-check.ts`
  reads each paragraph beside its cited blocks). **Nothing below the paragraph is recorded.** No
  sentence knows which of its paragraph's blocks it came from.
- The earlier ask (8K, `spya-rqch7a`) shipped on 2026-10-01: every block link in a band
  (`[data-block-link]`) gets a wash while its block is on screen — one generated `<style>` rule
  (`src/web/OnScreenLinksStyle.tsx`, `onScreenLinkCss` in `src/web/on-screen.ts`). It is off when the
  band lies over the prose.
- `BlockRef` (`src/web/BlockRef.tsx`) draws a block link, and takes `children` to draw a phrase
  instead of the short id. Every `[data-block-link]` gets the one shared rich card
  (`src/web/BlockLinkCard.tsx`: the section, then the passage cut short), and a press jumps there.

So **a sentence drawn as a `BlockRef` with the sentence as its children gets all three behaviours
Greg asked for for free**: lit while its block is on screen (8K's rule), the rich card on hover
showing that passage, and a press that goes there. The UI is mostly a class and a stylesheet rule.
The real work is getting the per-sentence block.

## Options for the per-sentence block

1. **Paragraph-level only (no model change).** Light the whole paragraph when any of its cited
   blocks is on screen, and give the paragraph a card listing its two or three blocks. Works on
   every stored summary today. Passed over as the *answer*, because Greg asked for sentences and a
   Fuller paragraph is four sentences about three different passages: a lit paragraph says "one of
   these four sentences is about what you are looking at". Kept as nothing — the chips already light
   (8K), which is the paragraph-level version.
2. **Guess the sentence's block in the client** — lexical overlap between each sentence and its
   paragraph's 1–3 blocks. Free and retroactive, but the summary is in *plain words* and the passage
   is not, by design, so overlap is weakest exactly where it matters. A confident wrong link is worse
   than none (prompting-guide.md § a model's claim used as a join key; silent-success). Rejected.
3. **Ask the guard's quick-tier call to assign sentences.** It already reads every paragraph beside
   its blocks. Mixes a fidelity check with an alignment job, and a checker that fails would then
   also lose the links. Rejected.
4. **The writer says it** (chosen). The writer chose the blocks; it knows which sentence came from
   which. Each paragraph's answer becomes sentences, each naming **at most one of that paragraph's
   own ids**, or none.

## The design

### Answer shape (the model's)

```json
{"paragraphs": [
  {"ids": ["spya-k3m9qt", "spya-p7w2dn"],
   "sentences": [
     {"text": "This paper asks …", "id": "spya-k3m9qt"},
     {"text": "It matters because …", "id": null},
     {"text": "Group A did twice as well …", "id": "spya-p7w2dn"}]}
]}
```

- `ids` stays exactly what it is: 1–3 per paragraph, the door rule, the guard's input, the chips.
- `sentences[].id` is **required and nullable** (prompting-guide.md: an optional field makes the
  model emit the comma anyway; OpenAI's subset wants every property required). In code: an id not in
  that paragraph's surviving `ids` becomes `null` and is counted (`dropped.sentenceIds`), never
  promoted into `ids`. So a sentence can only ever point at a passage the paragraph already rests on
  and the guard already checked.
- Paragraph `text` is **derived**: the sentences' texts trimmed and joined with one space. Word and
  sentence limits, the guard and everything else that reads `text` are unchanged. An empty sentence
  is dropped; a paragraph with no non-empty sentence is `empty`, as now.

### Stored shape

`SimpleParagraph` gains `sentences?: SimpleSentence[]`, `{ text: string; id: BlockId | null }`.
Optional because every summary stored before this has none, and those still render, as plain text
with chips, exactly as today. `SIMPLE_VERSION` (`simple/2`) is **not** bumped: the change is
additive, and a bump would make every stored summary unreadable (`isUsableSimpleSummary` requires an
exact match) — the trap 261001p's P1-3 named. Whatever reads a stored row must tolerate the field
being absent and must validate it when present (a malformed `sentences` reads as absent for that
paragraph, never as a broken page).

**One shared accessor decides whether a paragraph's sentences are usable** (Sol F2), for the owner's
read and the visitor's alike: a non-empty array; each entry `{ text: non-empty string, id: string |
null }`; every non-null id one of that paragraph's own `ids`; and **the trimmed sentence texts joined
with one space equal `paragraph.text` exactly**. Anything else answers "no sentences" for that
paragraph alone — its text and chips draw as today, and the rest of the summary is untouched. The
join rule is the point: the guard checked `text`, so the panel may only show sentences that *are*
that text. `assertNoBlockIdEnums` covers `"id"` as well as `"ids"`. `SIMPLE_PROMPT_VERSION` → `simple-prompt/4`.

Old summaries do not get sentence links until rewritten. Outdated-by-prompt is deliberately silent
(Greg, 2026-09-29, SPIDERYARN-READING2-55), so nothing nags the owner; *Write it again* picks it up.
No backfill in v1 — named below.

The public payload (`src/public-types.ts`, `src/public/dto.ts`) carries `sentences` for a visitor,
validated the same way. It is the same words as `text`, cut differently, so nothing new is disclosed.

### The prompt

One section, replacing **WHERE EACH PARAGRAPH COMES FROM**'s output half, plus the OUTPUT example:
each paragraph still lists one to three ids; then it is written as its sentences, and each sentence
names the one of *that paragraph's* ids it most rests on, or `null` when it rests on none in
particular (a framing sentence, a takeaway that draws on the whole paragraph). No sentence names an
id its paragraph did not list. The schema (`SIMPLE_SUMMARY_OUTPUT_SCHEMA`) states the new shape, so
`ARTICLE_OUTPUT_FORMAT`'s row and its test move with it.

`ANSWER_TOKENS` grows: each sentence costs its id or `null` and its JSON (~15 tokens). At Fuller's
five paragraphs of four sentences that is ~300 more; size it from the limits as the current formula
does, not by guessing.

### The panel

`SimplePanel`'s `Paragraph`: with `sentences`, each sentence with an id is a
`<BlockRef id onJump className="simple-sentence">{text}</BlockRef>`, one without is a plain span,
separated by a space; the chips stay after the paragraph, unchanged. Without `sentences`, today's
`<p>` exactly.

`.simple-sentence` in `styles/summary.css` undoes the chip look so it reads as prose — the text's
own colour and weight, full opacity (a block link rests at 0.5), no chip padding — with a quiet hover
cue (underline or the same wash, lighter) so a pointer can see it is live. The on-screen wash comes
from 8K's rule unchanged: it already matches any `[data-block-link]` in `.mode-band` and uses
`box-decoration-break: clone`, so a sentence wrapping over three lines washes cleanly. The card is
BlockLinkCard's: the section head is dropped by subtraction only when the link's text contains it,
so a sentence normally gets head and passage.

A missing block (an id the article no longer has) renders as BlockRef's non-link span — for a
sentence that would be the sentence in the missing-ref style; acceptable, and the stale banner is
already up in that case.

Nothing lights on a phone (the band lies over the prose, so 8K's rule is off). On touch a tap on a
sentence jumps, as on any block link; BlockLinkCard suppresses touch previews by design, so the card
is a pointer and keyboard thing (Sol F3). A wrapped sentence's card anchors to the whole element's
box; the browser check looks at that.

## Not in v1 (v2, named)

- **More than one block per sentence.** Greg's own fallback; one keeps the card one passage long.
- **Multiple colours** pairing each lit sentence to its block on screen.
- **Sentence-level highlights in the prose** — marking the sentence in the article that the summary
  sentence came from. Needs a sub-block anchor, which block-ids.md does not have.
- **Backfilling stored summaries** with sentence links without rewriting them.
- **The same treatment for other modes** (Tweets, FAQ answers) — the `BlockRef`-as-sentence pattern
  carries over, but each is its own prompt.

## Stages

1. **Writer and storage** (`src/simple-summary.ts`, `src/types.ts`, the stored-row reader, the public
   DTO, tests). Red first: a test that a validated answer keeps per-sentence ids, nulls an id not in
   its paragraph's ids, derives `text`, and that a `simple/2` row without `sentences` still reads.
   Done when `npm test` and `npm run typecheck` are green.
2. **Measure the prompt change** (prompting-guide.md § Measuring a prompt change, scaled to the
   change): production's own `generateSimpleSummary`, guard on, on three local articles including a
   paper, before (commit before stage 1) twice and after twice. Screens: validity failures and
   retries, words per level, guard flags, share of sentences with an id, share of sentence ids that
   were nulled for being outside the paragraph, cost and latency. Read every after-arm output, and
   check a sample of sentence→block links by eye (does the passage say what the sentence says?).
   **And a blind judge** (Sol F1; prompting-guide.md § Measuring is explicit that numbers are only
   screens): paragraph `text` of each level paired before-vs-after and before-vs-before (the
   control), sides shuffled with `blindCoin`, key checked for balance, a fresh subagent reading only
   the pairs file, asked which is easier for an outsider and whether either loses, bends or blurs a
   claim. Plus a fixed sample of after-arm sentence links (every linked sentence of one level per
   article) graded: does the passage say what the sentence says? Under $5. Write up in
   `docs/investigations/`.
3. **The panel** (`SimplePanel.tsx`, `styles/summary.css`, a component test), and a browser check in
   a Sonnet subagent: hover card (including on a sentence that wraps over lines), keyboard focus
   opens it, press jumps, wash follows the scroll, Brief/Simple/Fuller all work, an old summary
   without sentences unchanged.
4. **Docs**: summaries.md (a section, the v2 list), the user-feedback note, awaiting-approval.md.

GPT Sol on this plan before stage 1, and on the code before push.

## Risks

- **The shape change hurts the words.** Splitting into sentences could make the model write choppier
  prose, or spend reasoning on alignment. Stage 2 is there to see it; if it does, the fallback is a
  separate `cites` list (`[{ sentence: n, id }]`) beside unchanged `text` — worse to validate (the
  client must split sentences the same way the model counted them), so second choice.
- **A wrong sentence link** that the guard does not catch, since the guard checks the paragraph
  against all its blocks. Bounded: the link can only name a block the paragraph cites, so the worst
  case is the right paragraph's wrong passage. Stage 2 samples them.
- **Every sentence becomes a link** for a screen reader. A Brief paragraph of three linked sentences
  reads as three links; that is what they are.

## Ledger

- **Plan review** (GPT Sol, `--sandbox review`,
  [answer](261002e-summary-sentences-point-at-their-passage-plan-review-sol.md)): design kept. F1 (P1)
  blind judge required — accepted, stage 2 amended. F2 (P2) sentence/text equivalence as a read
  invariant through one accessor — accepted. F3 (P3) touch taps jump, no card — accepted.
- **Before arm** run on HEAD e23212480 (prompt `simple-prompt/3`), Opus, guard on, no profile:
  `evals/results/simple/high-none-sentbefore{1,2}/`, three articles each (PID paper
  `entropy-24-00930-spya-pywwkq`, `greatwork-spya-yw4d3t`, `noema-mythology-of-conscious-ai`); six
  of six valid, 181–214 words in the probe's one-line report, $0.86 in all.
- **Stages 1 and 3** built by an Opus subagent, committed as 28f99cdf1. Deviations from the plan:
  `sentences` is typed `unknown` on `SimpleParagraph`, so the compiler refuses any read that skips
  `usableSentences`; a second counter, `emptySentences`; `ANSWER_TOKENS` 1,350 → 2,150.
- **Stage 2, measured** in [261002o](../investigations/261002o-summary-sentences-that-name-their-passage.md):
  plainness 8–8 (2 the same) against a control of 4–1 (4 the same); fidelity flags no worse; links
  29/31 GOOD, 0 WRONG; 96% of sentences carry an id; about 40% more output tokens and +2.6 s median
  per press. Shipped as built.
- **Code review** (GPT Sol, write-capable, [answer](261002e-summary-sentences-point-at-their-passage-code-review-sol.md)),
  on 1f323ceea. C1 (P1) the schema admitted an empty sentence list and blank sentence text that
  the parser discards — fixed by Sol, `minItems: 1` and `pattern: "\\S"`, postmortem
  [261002e](../postmortems/261002e-a-strict-schema-admits-shapes-its-parser-discards.md). C2 (P1) a
  sentence whose passage changed under the same words kept its DOM node and an open card's old
  anchor — fixed by Sol, keyed on position, id and words, postmortem
  [261002f](../postmortems/261002f-a-reference-keeps-its-dom-identity-after-its-passage-changes.md).
  Both read and accepted; gates rerun green. C3 (P1, pre-existing) `paragraphs` and `ids` may be
  empty under the schema — not this change's; left for the schema's owner, named here. C4 (P2) the
  probe records no retries or guard outcomes — noted in 261002o.
- **Browser check** (Sonnet, Playwright, after merging dev's `structure` step rename): every check
  passed on `ds-spya-me0d4g` rewritten by the new code: the prose look, the card on hover (including
  a wrapped sentence) and on Tab focus, the jump, the wash following the scroll, all three levels, and
  an old summary unchanged. Two earlier attempts failed with `PublishRefused`, because the worktree
  predated the step rename that the shared local database had already been migrated to. That had
  nothing to do with this change. **Gates:** `npm test` gave 6 reds, all fresh-worktree build gaps
  plus the feedback-endings map, and each passed after `npm run build`, `build:fleet` and
  `scripts/feedback-endings.ts`. `npm run typecheck` is clean.
