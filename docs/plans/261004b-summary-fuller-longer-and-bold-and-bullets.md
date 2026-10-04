# Summary: a longer Fuller, and bold and bullets to skim by

Up: [plans.md](../project/plans.md) · owns: [summaries.md](../project/summaries.md)

Two admin reports from the Feedback button, both filed 2026-10-03 on
`we-must-pace-the-frontier-spya-qhda2b` with `?mode=summary&summary=fuller` showing. One plan
because both change the same prompt (`src/simple-summary.ts`).

> I think we want the most detailed submode of Summary to be longer and more detailed still. (I
> think it's called fuller.)
>
> — Greg, 2026-10-03 (`spya-azft06`, SPIDERYARN-READING2-BC)

> Maybe, maybe the summary submodes could make use of Markdown, like bold or bullet points, to make
> it easier to skim the summary. I suppose it's possible they could use headings, but that might be
> overkill. That could be interesting. Experiment with it.
>
> — Greg, 2026-10-03 (`spya-qzsvx4`, SPIDERYARN-READING2-BD)

Prior-work check (2026-10-04): no plan, note, commit or session covers either. `fb-summary-chat`
(a chat about a summary paragraph) is live and will touch `SimplePanel.tsx`; expect a merge there.

## What a reader gets

**Fuller is about twice as long.** Today it is asked for about 220 words in three to five
paragraphs and comes back at 221–261 in five. It will be asked for about 500 in five to eight.
The extra room goes to what Fuller leaves out today: how the work was done, the evidence and the
numbers behind each main finding, the limits the piece itself names, and how the steps of the
argument connect. Brief does not change length.

**Key phrases are bold, and a paragraph that is really a list is drawn as one.**

```
 before                                   after
 ──────                                   ─────
 The rats did worse at the maze when      The rats did worse at the maze when the
 the hippocampus was switched off         hippocampus was switched off **while
 while they reared. Correct first         they reared**. Correct first choices
 choices fell from 78% to 66%. …          fell **from 78% to 66%**. …
 [spya-k3m9qt] [spya-p7w2dn]              [spya-k3m9qt] [spya-p7w2dn]

                                          The paper rules out three other
                                          explanations:
                                           • The light alone did nothing. …
                                           • Switching it off six seconds later
                                             caused no clear drop.
                                           • The rats moved just as much.
                                          [spya-tgnssb] [spya-sge6a2]
```

Every sentence, bold or bulleted, is still the hover-and-press link it is today and still lights up
while its passage is on screen: a bullet **is** one sentence, and bold is drawn inside the link.

## The design

### Formatting is two fields, not Markdown in the text

The model does not write `**` or `- `. The answer's JSON gains two fields:

```
{"paragraphs": [
  {"ids": ["spya-k3m9qt"], "list": false,
   "sentences": [
     {"text": "Correct first choices fell from 78% to 66%.", "id": "spya-k3m9qt", "key": "from 78% to 66%"},
     {"text": "…", "id": null, "key": null}]}
]}
```

- **`key`** on a sentence: a few words copied exactly from that sentence, or `null`. The client
  draws the first occurrence as `<strong>`. Kept only when it is a string, not empty once trimmed
  (`pattern: "\\S"` in the schema, as `text` has), a substring of the sentence's text, at most `SIMPLE_KEY_MAX_WORDS` (8) words, and shorter than the sentence. Anything
  else becomes `null` and is counted in `SimpleDropped`, never a failed level.
- **`list`** on a paragraph: `true` when the first sentence is a lead-in and each later sentence is
  one bullet. Honoured only with three or more usable sentences (a lead and two bullets); otherwise
  the paragraph draws as prose.

Both are required in the live schema (`key` nullable), and **stored only when they say something**:
a valid non-null `key`, and `list` only when `true`. A row from before has neither and reads the same.

**Why fields and not Markdown** (the simpler-looking option, passed over):

- `text` stays plain. The fidelity guard, the word limits, the public payload and anything later
  that quotes a paragraph (the summary-chat session is building one now) read the same words they
  read today, with no asterisks to strip in each place.
- `usableSentences` requires the sentences to rejoin to exactly `text`. A bullet is a sentence, so
  that rule and the per-sentence links survive untouched. Markdown bullets would need a second
  mapping from list items to sentences.
- No Markdown parser runs over model output. [summaries.md § Markdown](../project/summaries.md)
  and security.md stay true: React draws a string and a `<strong>` around a substring of it.
- The schema makes the shape impossible to get half-right; a mistyped `**` cannot leak to a reader.

What it gives up: one bold phrase a sentence at most, no nested lists, no italics. None was asked for.

**Headings are not built.** Greg: *"might be overkill"*. A summary of five to eight short paragraphs
has nothing a heading would divide. If the bold lead of each paragraph turns out to act as one, that
is the cheaper answer.

### Where each level uses it

One schema for all three levels, as today. The prompt asks:

- **Bold, every level:** in a paragraph, at most two sentences have a `key`; most have none. The key
  is the finding, number or term a skimming reader should catch, never a whole sentence.
- **Bullets, Fuller only:** at most two list paragraphs, only where the piece itself gives parallel
  items (findings, steps, reasons). Brief and Simple are told to write `"list": false`; a `true`
  there is still honoured by the reader code, since the shape rule above is what keeps it safe.

### Fuller's numbers

| | today | new |
|---|---|---|
| asked: paragraphs × sentences | 3–5 × 2–4 | 5–8 × 2–5 |
| asked: words ("about", "never more than") | 220, 270 | 500, 600 |
| `SIMPLE_LIMITS.fuller` | min 3, max 5, 480 words | min 3, max 8, 850 words |

`minParagraphs` stays 3 so every stored Fuller still reads as valid. `ANSWER_TOKENS` is recomputed
from the limits (850 words, 8 paragraphs, 5 sentences asked, plus the `key` per sentence). Fuller's
line *"this is an orientation, not a digest, so leave detail to the article"* becomes a Fuller-only
wording that keeps the first half and drops the second: it is still not a replacement, but detail is
what this level is for. Brief and Simple keep the line.

`SIMPLE_PROMPT_VERSION` → `simple-prompt/7`. `SIMPLE_VERSION` stays: both fields are optional on
read, and a row without them draws as it does today. No stored summary is rewritten or marked
`stale`. The owner's read does report it `outdated` (the prompt-version comparison in
src/store/pg.ts), which the panel keeps silent by Greg's 2026-09-29 rule; *Write it again* picks the
new prompt up.

### Reading it back

`usableSentences` gains `key` on what it returns (present only when valid by the rule above), and a
new `paragraphShape(paragraph)` in `src/types.ts` answers what to draw, for the owner's panel and
the visitor's payload alike:

```ts
type SimpleParagraphShape =
  | { kind: "text" }                                              // no usable sentences: draw `text`
  | { kind: "prose"; sentences: SimpleSentence[] }
  | { kind: "list"; lead: SimpleSentence; items: SimpleSentence[] };
```

`publicSimpleSummary` (src/public/dto.ts) carries `list` and each sentence's valid `key` across and
nothing else new.

## Stages

1. **Server.** Prompt, schema, limits, validation, `usableSentences`, `paragraphShape`, the public
   DTO, tests (red first for: a key that is not a substring is nulled and counted; a two-sentence
   list reads as prose; a Fuller of 8 paragraphs and 700 words is valid; the DTO carries both
   fields). `evals/simple/probe.ts` already records whole paragraphs.
2. **Client.** `SimplePanel.tsx § Paragraph` draws the three shapes; `summary.css` for
   `.simple-list` and `strong`; [fonts.md](../project/fonts.md) for the weight in the model's face;
   `/help` and summaries.md. Browser check at desktop, iPad and phone-portrait: bold and bullets
   draw, a bulleted sentence hovers, jumps and lights up.
3. **Measure and write up** in
   `docs/investigations/261004a-summary-fuller-longer-and-bold-and-bullets-prompt-eval.md`, with
   before and after text for three articles side by side, which is what Greg asked to see.

Each stage ends with gates green, a commit, and a GPT Sol review that may fix inside the stage.

## Measuring it

Arms separated in time (prompting-guide.md § Measuring). Three local articles, no profile, `--power
high`, guard on, two draws an arm: the rat-rearing paper, the entropy paper, *The Scaling Hypothesis*
(an essay, as Greg's was; his own article is not in the local database).

- **Before** (`high-none-fbazb1`, `-fbazb2`), run 2026-10-04 on `0531fb7f` before any edit.

  | | Brief | Simple | Fuller | press |
  |---|---|---|---|---|
  | words, six presses | 95–122 | 160–212 | 221–261, **median 253.5** | 18–30 s, median 26.3 s |
  | paragraphs | 2–3 | 4 | 5 | |
  | guard | all passed, first attempt | same | same | |

- **After** (`high-none-fbaza1`, `-fbaza2`), on the stage-2 commit.

**The judge is GPT Sol**, read-only, a different family from the Opus writer. It gets two files and
no arm names:

- **Fidelity and substance.** Every Fuller, both arms, in shuffled order, each paragraph beside the
  text of its cited passages. It labels every sentence one of: *supported* (the passages say it),
  *repeated* (says again what an earlier sentence of the same summary said), *filler* (generic, true
  of any piece), *unsupported-minor* (a detail the passages do not carry), *unsupported-serious*
  (contradicts the passages, or a claim, number or direction they do not support).
- **Formatting, on identical words.** Each after Fuller and Brief twice, once drawn with its keys
  bold and its lists as bullets, once as plain paragraphs, sides shuffled by `blindCoin` and the key
  checked for balance. One question a pair: which lets a reader find the main findings faster in
  ten seconds, or no difference. No model call writes anything for this.

**Ship rule, declared before any after-run.** Before values are the table above.

1. **Length.** Fuller's median is 406–700 words (406 is 1.6 × 253.5); no level fails validation in
   the six presses.
2. **The other levels hold still.** Brief stays within 76–146 words and Simple within 128–254 (the
   before range ±20%).
3. **Guard, every level.** Before: 0 flags in 18 levels. After: at most 1 flagged level in 18, and
   none stored flagged.
4. **Fidelity, Fuller.** Unsupported sentences (minor and serious) per 100 words after, pooled over
   six, is no higher than the higher of the two before draws' pooled rates. And the number of
   Fullers with any *unsupported-serious* sentence is no higher after than before.
5. **Substance, Fuller.** *Repeated* plus *filler* is at most 15% of after sentences.
6. **Formatting is well-formed.** At least 95% of keys written survive validation; no paragraph
   keeps more than two; no Fuller has more than two list paragraphs; Brief and Simple have none.
7. **Formatting helps.** In the identical-words pairs the formatted side wins more pairs than the
   plain side, for Fuller and for Brief separately. A level that loses or ties ships without that
   formatting in its prompt.
8. **The wait.** The press's median wall time rises by no more than 12 s (to at most 38.3 s).

If 1 or 6 fails: adjust the asks once and re-run the after arm. If 3, 4 or 5 fails: ship the
formatting and a smaller length step (about 350 words), and say so. Rule 7 measures a model's guess
at skimming; whether Greg finds it easier is his eye on the before/after, which is the experiment he
asked for.

## Open for Greg (asked in the debrief, not waited on)

- **[Q-summary-format-keep]** Having seen it: keep bold and bullets, keep only one, or neither?
- **[Q-summary-fuller-length]** Is twice as long right, or more still?

## Passed over

- **Markdown in `text`**, above.
- **A fourth level** ("Detailed") beside Fuller. Greg asked for Fuller itself to grow, and the
  control has three choices already.
- **Regenerating stored summaries.** They keep their text until somebody presses *Write it again*.
- **Streaming Fuller**, now that the wait is longer. Still 260930i's open decision; the ship rule
  caps the added wait instead.

## Ledger

- 2026-10-04: plan written; before arm run.
- 2026-10-04: GPT Sol's plan review
  ([answer](261004b-summary-fuller-longer-and-bold-and-bullets-plan-review-sol.md)). All five
  findings taken. F1: the baseline quoted Simple's word counts as Fuller's; corrected from the
  result files, and the ask raised from 450 to 500 so "about twice" is still true. F2: the
  identical-words formatting pairs. F3: the guard rule covers all three levels. F4: the fidelity
  arithmetic and the substance rubric are spelled out, and the judge is Sol, not Opus. F5: an empty
  key is refused in the schema and in code.
- 2026-10-04: stages 1 and 2 built by an Opus subagent, tests red first, committed as `b56d949ce`.
- 2026-10-04: **the plan as written failed its own ship rule.** The first after arm (`fbaza1`,
  `fbaza2`, Fuller asked for about 500) gave a Fuller median of 490 words and well-formed bold and
  bullets, but a press took a median of 55.1 s against a ceiling of 38.3 s, and two first answers
  were flagged by the guard, both in Simple, against a ceiling of one.
- 2026-10-04: GPT Sol's code review
  ([answer](261004b-summary-fuller-longer-and-bold-and-bullets-code-review-sol.md)), F6 to F12. It
  fixed F6 (the public payload sent `list: true` for a two-sentence list the owner draws as prose),
  F7 and F8 (the eval's tallies could hide a missing verdict and a flag-then-pass), F9 (the wait
  hint). F10 and F11 are the two failures above. **F12 taken:** the flags were in Simple, which a
  shorter Fuller cannot touch, so Simple is asked for no bold; it is shown to nobody.
- 2026-10-04: **the fallback shipped.** Fuller asked for about 350 words in four to seven paragraphs
  (never more than 430); bold in Brief and Fuller only. Arm `fbazc1`, `fbazc2`: Fuller median 374
  (1.48 × before, under rule 1's 1.6 by design), a press 30.9 s, one Simple flag in 18 levels,
  fidelity 0.92 unsupported sentences per 100 words against 1.76 and 1.33 before, formatting
  preferred 12 to 0 on identical words. The limits stay at 8 paragraphs and 850 words, so going to
  500 later is two numbers in the prompt. Write-up, with the before and after text:
  [261004a](../investigations/261004a-summary-fuller-longer-and-bold-and-bullets-prompt-eval.md).
- 2026-10-04: browser check by a Sonnet subagent at desktop, iPad portrait and phone portrait, on a
  summary regenerated through the app's own job route: all passed. Screenshots
  `261004b-shot-*.png` beside this file.
- **Deferred, and queued with the Overseer:** store and show each level as it is written, so Brief
  no longer waits for Fuller and Fuller can be twice as long. It waits on Greg's answer to
  Q-summary-fuller-length in the investigation, which replaces the same-named question above.
