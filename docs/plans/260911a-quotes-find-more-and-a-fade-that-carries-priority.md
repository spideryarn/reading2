# Quotes: find more, a fade that carries priority, and important over striking

Feedback report [SPIDERYARN-READING2-2W](https://greg-detre.sentry.io/issues/SPIDERYARN-READING2-2W),
Greg, 2026-09-10 20:43 UTC, from `/changelog#release-75` on build `3bc0878f`:

> Tweak the Quotes mode:
> - It's good that it now shows the quotes with the outline-border in the main text - perhaps
>   slightly fade the border based on the priority-score (but even low-priority quotes should still
>   be clearly visible)
> - Try and find more quotes by default, and make a small tweak to the prompt to emphasise important
>   rather than striking when highlighting them
> - Remove the "Choose them again" button, and add a "Find more" button

**Two of the three have been here before**, and the history decides the design:

- The outline is [260907c](260907c-quotes-drawn-as-a-stroke-in-the-prose-with-weight-carrying-priority.md),
  where stroke **weight** already carries priority — two tiers, 1px and 3px, split at
  `QUOTE_HEAVY_AT = 0.80`. So the first item changes an existing priority channel rather than adding
  one.
- "Find more" is [report 27](../user-feedback/260905_2052-a-button-to-find-more-quotes.md), which
  doubled the count and declined to build append, and wrote down what would change that: *"If he
  files it a third time … Build it on the second filing, not this one."* This is that filing, and
  this time he names the button and the thing it must replace, so it is append.

## 1. The fade, and how it combines with the weight

**Weight stays exactly as it is; alpha becomes a second, continuous channel on top of it, and both
move the same way.** Higher priority is thicker *and* brighter, so the two reinforce each other and
cannot cancel — a line that is thick-but-faint or thin-but-bright never happens.

| `priorityOf` | weight (unchanged) | alpha (new) |
|---|---|---|
| unscored | 1px | 0.70 |
| < 0.50 | 1px | 0.70 |
| 0.50 → 0.79 | 1px | 0.70 → 0.87, linear |
| 0.80 → 1.00 | 3px | 0.88 → 1.00, linear |

One line: `alpha = 0.70 + 0.30 × clamp((p − 0.5) / 0.5, 0, 1)`, rounded to two places. Today every
stroke is 0.95.

Why this shape and not another:

- **The weight carries the coarse step and the fade the fine one.** Weight is two tiers because the
  blind test in 260907c found a middle tier indistinguishable (13/20, chance) while 1px-vs-3px
  scored 12/12. That rules out *more weights*; it does not rule out a continuous quantity that
  nobody has to identify pairwise. The fade is "slightly", an impression across a page, which is
  the thing Greg asked for.
- **It uses the finding 260907c's acceptance pass made about its own design**: *"The priority does
  help skimming — but through brightness more than thickness."* The fade adds brightness steps
  inside each weight rather than inventing a new kind of mark.
- **The floor is where "clearly visible" is kept, and it is a checked number, not a feeling.** The
  faintest possible stroke is the 1px, 0.70-alpha one. Composited over `--page` (`oklch(0.145 0 0)`)
  it is about **5.3:1** against the page — WCAG's non-text floor is 3:1, and today's 0.95 is about
  8.5:1. A unit test computes that contrast from the token numbers, so a later edit that lowers the
  floor below 3:1 fails a test rather than a reader's eyes. The floor stays at 0.70 rather than, say,
  0.5 (≈3.2:1) because a 1px line needs margin over a 3:1 floor written for thicker components.
- **The bar still agrees with the stroke.** Both read `priorityOf`, so raising the bar still removes
  the faintest and thinnest first.

**How it travels.** `Found.quoteTier: QuoteTier | null` becomes `Found.quoteStroke: QuoteStroke |
null`, where `QuoteStroke = { tier: 1 | 2; alpha: number }` — one named type at the seam, **and on
`Mark` too** (Sol: stopping at `Found` lets `baseMarks` unpack it back into two fields that can
arrive one without the other). `quoteStroke(quote)` sits beside `quoteTier` in QuotesPanel.tsx and
is the one place the mapping lives. `annotateHtml` writes `data-quote` exactly as now and adds
`--quote-a:<alpha>` to the inline `style` it already writes for `--hit-a`; the stylesheet reads it as
`rgb(var(--quote-stroke-rgb) / var(--quote-a, 0.95))`. **No new attribute**, so no sanitiser
policy change: `style` on a mark is already app-owned (the article's own `style` is stripped).

The pressed quote stays white at full strength — it overrides `--quote-stroke-color` outright, so the
fade does not reach it, which is right: "you pressed this" should not be dimmer for a lower-priority
line.

## 2. More by default, and important over striking

- `suggestedQuotes`: one per **~200** words clamped **10–40**, up from one per 300 clamped 8–32. A
  4,000-word piece asks for 20 rather than 13.
- `MAX_QUOTES` — the most **one pass** may add — 32 → **40**.
- `answerTokens` scales with `count` already; `STEP_BUDGET_MS.quotes` 180s → **240s**, unmeasured,
  in proportion.
- **The prompt.** `WHAT EARNS A QUOTE` currently says either reason alone is enough and treats them
  as equals. It keeps that — `max` is Greg's own decision of 2026-08-31 and the scores stay the two
  independent questions they are — but says **importance comes first**: when choosing which lines
  to keep, prefer the lines the argument rests on; a line that is only well put earns its place
  when it is exceptionally so. The intro line changes from *"the lines a reader would want to carry
  out of it"* to lead with the argument. The two score definitions do not change.
- `PROMPT_VERSION` → `quotes/4`.

**What happens to lists that already exist.** Nothing on their own: a prompt bump reaches new runs
only. Every existing list becomes `outdated`. That banner **loses its button** and now reads *"These
include lines chosen by an earlier version of the prompt. Find more uses the current one, and keeps
these."* — because Find more works on an outdated list (§ 3) and adds lines chosen by the new
prompt without taking away the ones the reader has.

**The banner stays up after a Find more on such a list, and that is the corrected design** (see §
What the plan review changed). An append keeps the list's own, older `version`, because most of the
lines in it still are the older prompt's choosing; *"include"* is the word that stays true whether
some or all of them are. The first draft restamped the list `quotes/4` after an append, which Sol
showed certifies lines the current prompt never chose — and does it even when the pass added
nothing.

## 3. Find more — an append, not a rename

**The glossary's shape, reused**: one forced verb; the server decides from the state of the previous
list whether that run appends or replaces.

```
                         previous list?
                               │
            none ──────────────┼──────────── yes
             │                 │              │
         fresh list      sourceHash matches the article now?
                               │
                  no (stale) ──┴── yes
                     │               │
         REPLACE, with every   APPEND: keep every existing quote and its id,
         id minted FRESH —     ask for up to `count` MORE with the existing
         an inherited one      lines listed as already taken, drop any new line
         would point a link    that overlaps an existing one
         at different words
```

(The first draft said the stale replace inherited ids where text matched. It never did — the code
refused exactly that — and Sol caught the plan contradicting it.)

- `existingFor(onDisk, sourceHash)` in src/quotes.ts: the list to append to, or null. **Only the
  article moving refuses an append.** Not the prompt version (above), and not the profile — see
  below.
- `renderPrompt` gains the glossary's "already in the list" section: the existing quotes' text, *find
  up to N more, not these, nothing overlapping them, and an empty list is a real answer*. In the
  **user** message, so the cached system prefix — the article — is byte-identical between passes.
- `buildQuotes` merges: existing quotes first, **always kept** (they win every overlap with a new
  line, regardless of length — the reader's list must not change under them), new lines deduped
  against them and against each other, the whole list re-sorted into document order.
- **Zero new lines is a real outcome, not an error.** `buildQuotes` throws on an empty *fresh* list
  today and keeps doing so; on an append it writes the list with `lastAdded: 0`, and the panel says
  *"Nothing more worth keeping turned up."* under the list. Without that sentence, a Find more that
  found nothing would look exactly like a button that did nothing
  ([silent-success.md](../reusable/silent-success.md)).
- New artefact fields, owner-side only (`PublicQuotes` is a projection and does not take them):
  `passes` (as the glossary's) and `lastAdded` (how many the most recent pass added). `discarded`
  and `elapsedMs` accumulate across passes.
- **A total ceiling, `MAX_QUOTES_TOTAL = 120`** (in `src/types.ts`, because the panel needs it and
  src/quotes.ts is server-only), which is three default passes on a long piece. **The count asked
  for is capped by the room left** (Sol: otherwise a list one short of the ceiling pays for forty
  lines and keeps one), and at the ceiling no model call is made — the stage writes the list back
  with `lastAdded: 0`. The panel does not offer the button there: *"That is as many as we keep for
  one article."*
- **`run.dropped` stays this pass's**, for the log that watches for prompt drift; the artefact's
  `discarded` is the whole list's (Sol). The pipeline's log line and job detail say *"N more, M in
  all"* on an append.

**The profile.** Find more drops the profile checkbox and sends `useProfile = the list's own
setting`: it *continues* the list rather than choosing it for someone else. The artefact keeps the
`profileHash` of the pass that started it. So profiles can only mix in one state: the reader changed
or deleted their profile since the list was made — **which is exactly the state where the badge
already says *"Written for a profile you have changed since"***, and keeping the old stamp keeps that
warning up over a list that is now partly the old profile's. The glossary refuses to merge across
profiles because its `difficulty` is relative to the reader; a quote's words are not.

**What the reader loses: a whole rewrite of a list that is current.** "Choose them again" was the
only way to throw a current list away and start again, including for a new profile. Greg asked for
it to go. The stale banner keeps its **Choose them again** button, because an article that moved
has lines that may no longer be in it and replacing is the only honest action there — the one place
that label still describes what happens.

**The panel**, `QuotesPanel.tsx`:

| state | banner | foot |
|---|---|---|
| current | — | **Find more** |
| outdated | *These include lines chosen by an earlier version … Find more uses the current one, and keeps these.* (no button) | **Find more** |
| stale | *the article has changed … may no longer be in it* + **Choose them again** | — |
| at `MAX_QUOTES_TOTAL` | — | *That is as many as we keep for one article.* |

The running label is *"Finding more…"* for a pass that appends.

## The simpler options passed over

- **Rename the button only.** Report 27 already rejected it: a "Find more" that replaces is a lie on
  any article already at the target, and Greg has now asked twice.
- **Find more as a re-run with a raised target, still replacing** — report 27's proposed second
  step. Passed over because the ask is explicit about extending, and a replace re-rolls the lines
  the reader has already read and scored in their head; ids would survive for exact repeats only.
- **Refuse to append across the prompt version**, as the glossary does. Then the first Find more on
  every existing list — which after this deploy is every list — would silently replace it.
- **A three-level alpha instead of a continuous one.** Would need a new reserved attribute and a
  sanitiser bump for something the continuous `--quote-a` does through the style already written.

## Stages

Each ends with `npm test` (in tmux, scoped plus the full suite once), `npm run typecheck`, and a
GPT Sol review.

1. **The stage** — src/quotes.ts: counts, `MAX_QUOTES_TOTAL`, the prompt, `quotes/4`, `existingFor`,
   the append path in `renderPrompt`/`buildQuotes`/`generateQuotes`, `passes`/`lastAdded`; types;
   `STEP_BUDGET_MS`. Tests first: append keeps every existing id and text; an existing quote wins an
   overlap with a longer new one; zero new writes `lastAdded: 0` rather than throwing; stale
   replaces; outdated appends; the total cap cuts only new lines; the prompt carries the taken list
   and the system block is unchanged between a first pass and an append.
2. **The panel and the stroke** — `QuoteStroke`, `quoteStroke`, `--quote-a` in `annotateHtml`, the
   CSS, the foot/banner table above, `useQuotes.more`. Tests: the alpha mapping and its floor's
   contrast against `--page`; the attribute and style in the markup; the foot per state.
3. **The browser pass** — a real article, signed in: the fade reads as "slightly", the faintest
   stroke is clearly visible, Find more adds lines and keeps the old ones, the zero-case sentence.
4. **The docs** — quotes.md (the stroke channel table, § It replaces becomes § Find more appends,
   § What is still open), the feedback note, this plan's findings.

## What the plan review changed

GPT Sol, `--sandbox review`, 2026-09-11 01:18–01:32: **changes requested**. Six findings; all six
acted on, two of them in a different way from the one Sol proposed.

| # | Sol said | What happened |
|---|---|---|
| 1 | P1 — appending across a prompt version certifies old lines as current; append only on matching version, and give outdated lists a replace action | **Half taken.** The certification was real — the draft restamped the list — and is gone: an append keeps the list's older `version`. The replace action was not taken, because after this deploy *every* list is outdated and it would put the removed button back on every one of them on the day it matters. |
| 2 | P1 — a stale replace must mint fresh ids | Right about the plan text, which was wrong; the code already did. The dead inheritance computation in `generateQuotes` is gone, and a stubbed-model test holds it (seen red with inheritance put back). |
| 3 | P1 — appending across a profile writes false provenance | **Answered by the stamp, not by refusing.** Profiles can only mix when the reader changed theirs since, which is the one state where the badge already warns; the old stamp keeps the warning up. |
| 4 | P2 — `QuoteStroke` must continue through `Mark` | Done — `Found.quoteStroke` and `Mark.quoteStroke`, no standalone tier field. |
| 5 | P2 — keep the pass's drops for the log | Done, and tested. The pipeline comment claiming quotes replaces is fixed. |
| 6 | P2 — cap the count by the room left; `STEP_BUDGET_MS` is a scheduling estimate, not the call's timeout | Done; and noted — raising it does not give the call more time, it keeps the queue's claim honest. |

**#1 and #3 were a real conflict between the house norm and Greg's explicit ask**, so Fable
arbitrated rather than me picking. Its call: keep the append on every list — *"Greg's literal ask is
to extend the list he already has, and he has said so twice"* — and make the stamps say the list is
mixed rather than refuse to make one. It preferred per-quote provenance fields; the artefact-level
version kept on append gets the same honesty (nothing the reader sees becomes false) without a new
field on every quote, and without a new pipeline fact for the visitor projection to strip.

**The cost, named for Greg:** a list written before `quotes/4` now carries the quiet *outdated*
sentence for good, because nothing clears it short of the article changing. If that is noise to
him, the two ways out are (a) drop the outdated banner for quotes, or (b) put a "choose them all
again" on the Metadata page, where nobody meets it by accident.

## What landed, and the code review

Stages 1 and 2 landed together as `4403b44d` — they share every file the fade and Find more touch,
and neither is useful half-done. The full suite: 1076 files green, 7 red, none of them this change's
— two are the fresh-worktree bundle tests (`cold-start-lazy-imports`, `pdf-bundle-trace`, no
`api-dist/`), four are fleet/overseer tests that need `tools/fleet/web/dist` built, and one,
`glossary-band-wiring`, **was** mine: it reads `useQuoteMarks` for `resolveQuotes(blocks, ` on one
line, and the formatter-free rewrap had split it. Put back on one line.

GPT Sol then reviewed the built code with `--sandbox workspace-write`, fixed what it found, and
reported nothing wider. Two P1s, both in the property this change most had to keep — that a Find
more changes nothing the reader already has, and makes no badge lie:

- **A deleted profile left the badge saying "written for you".** The shared `profileIsStale` treats
  a cleared profile as no change, which is right for artefacts that replace and wrong for one that
  appends an unprofiled pass under a kept first-pass stamp. The quotes route alone now counts it as
  a change (`withProfileChanged`'s `clearedCountsAsChanged`).
- **A Find more could reorder an existing quote, or miss an overlap with a legacy one.** The merge
  sorted the whole list against the body-evidence blocks, so an old quote in a block today's policy
  filters out went to the end; and a legacy quote with no `start`, or carrying the model's straight
  dash where the article has a curly one, was located with `indexOf` and missed. Existing spans are
  now re-found through the matcher that admitted them, and new quotes are merged *around* the
  existing list against the whole article, which is never reordered. Both with regression tests.

`8e0957ea`. Every test file that drives `GET /api/quotes/:slug` was run after it — the route
change's other callers — and all passed.

## Stage 3, the browser pass

Playwright against system Chrome on the box, its own dev server from this worktree, signed in as
the local dev owner, on `fowler-phrenology` (15 quotes, `quotes/2`). One real Find more.

**The fade reads as "slightly", and the faintest stroke is clearly visible.** Six distinct values on
the page (1.00, 0.94, 0.88 at 3px; 0.82, 0.76, 0.70 at 1px). The faintest sampled at
`rgb(89,143,115)`, about 5.3:1 against the page — the number the contrast test computes from the
tokens, measured rather than asserted. Against every mark forced back to the old 0.95, the only
visible difference is a slightly greyer green on the light strokes; weight still does most of the
work, which is what "slightly" asked for.

**Find more appended and changed nothing it had.** Outdated banner with no button, *Find more* the
only action, no *Choose them again* anywhere. One press: 34s, 15 → **48** (`passes: 2`, `lastAdded:
33`); all 15 originals kept id, text, scores and relative order, the new ones interleaved in reading
order. Banner still up, as designed. No console errors, nothing in the server log.

What it found, and what happened:

- **Five of the 33 new lines began mid-sentence** — *"are more pious in church than in the family"*.
  The prompt banned a line needing its paragraph, not a fragment cut from a sentence; it now bans
  that too, with that line as the example. `quotes/4` has not shipped, so no second bump. Unmeasured.
- **Every new line was light**: top importance 0.6, two unscored — so after one Find more the prose
  had 29 strokes at 0.70 and 14 at 0.76, where heavy ones had been the majority. That is the model
  being honest about the tail, and the bar hides it; but in the default `document` rank every one is
  outlined. The density question quotes.md already records, made sharper. For Greg.
- **The list stays `quotes/2`**, so the outdated sentence is permanent on it — the designed cost above.
- Small, not fixed: the running label is the pipeline's *"Choosing the quotes"*, not *"Finding
  more…"*, once the job is running (`JobProgress` shows the step's own label); for ~0.4s after the
  job ends the button is back while the old count still shows, before the refresh lands — the same
  gap every job-driven band has.

## What would make this wrong

- If the faintest stroke is not clearly visible in the browser pass, raise the floor; the contrast
  test is the lower bound, not the target.
- If Find more's lines are visibly worse than the first pass's — the model scraping the barrel —
  that is the editorial ceiling doing its job, and the answer is the empty-list sentence, not a
  bigger cap.
