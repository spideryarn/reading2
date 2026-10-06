# Skim: the cue situates the quote, and a term chip opens the glossary's own card

Two reports of Greg's from the Feedback button, 2026-10-06, both filed from Skim on
`2608-13566v1-spya-yurten`. Both are admin rows (`feedback-unswept.ts --show`, Sentry confirmed).
Up: [skim.md](../project/skim.md).

## What he said

Report `spya-jghnva`:

> In Skim mode, when generating a question, use it as a way to contextualise the quote.
>
> For example, this question doesn't do that very well:
>
> "Which interpretation does their evidence favour, and how close to the training data does the test sit?"
>
> The quote then is something like "our results favour the latter interpretation..."
>
> The question we generate with Skim mode is an opportunity to situate the quote, eg it could tell us what's being asked of the evidence and/or what are the two interpretations?
>
> — Greg, 2026-10-06

Report `spya-se0e4v`:

> In Skim mode, the Glossary clues don't have to say "also at stop X". And they should provide/reuse the usual "go to glossary" etc in rich tooltips
>
> — Greg, 2026-10-06

## Stage 1 — the term chips (UI, no model)

Today (`SkimPanel.tsx` § `StopCardView`, `stop-card.ts`): a term chip under the current stop reads
*name · also at stop k*, and pressing it opens one line of the term's sense in place, with an icon
into Glossary. The prose has a much richer card for the same term (`ProseHoverCard.tsx` §
`TermCard`): what it means here, what it means in general, what the web said, and one row of
*Dig deeper · Hide · Open glossary*.

Build:

1. **Drop "also at stop k".** Remove `alsoAt` from `CardTerm`, its computation in `stop-card.ts`,
   the `<span className="skim-also">`, the `.skim-also` rule and the header bullet. A grep for
   `alsoAt|skim-also|also at stop` should then find only history (plans, this doc, skim.md's dated
   account).
2. **A term chip opens the glossary's own card.** Export `TermCard` (and what it needs) from
   `ProseHoverCard.tsx` and draw it as the content of the shared `Tooltip` with
   `interactive={{ label }}` (Tooltip.tsx — the pointer and Tab can get into it) around each term
   chip. Hover or focus opens it on a desktop. A tap or click opens it too and it stays until a tap
   elsewhere — `Tooltip`'s controlled `open`/`onOpenChange`, the way `Spine.tsx` does it for a
   finger. **The one-line sense in place goes for terms**: one surface, not two showing the same
   term. Ideas chips are unchanged (they still open in place).
3. **The card's actions**: the owner's band passes its `GlossaryRead` as `TermActions` (Dig deeper,
   Hide); a visitor's band passes `null` and gets *Open glossary* alone, and only when
   `canOpen({kind:"term"})` — today a visitor with no Glossary mode gets no icon, so the card must
   be able to draw with no way out. *Open glossary* is the existing `onOpen({kind:"term", id})`;
   *Dig deeper* starts the look and opens Glossary on the term, exactly as from the prose.

The simpler option passed over: keep the in-place line and add only the three buttons under it.
It is less code, but it is a second, thinner drawing of a glossary entry, which is what "reuse the
usual" asks us not to have.

Not in this stage: the same card on Ideas chips (an Idea has no card of its own yet).

Done when: `tests/stop-card.test.ts` and `tests/skim-panel.test.tsx` are updated red-first (no
"also at stop"; a term chip's card holds *Open glossary*, and for an owner *Dig deeper* and *Hide*;
a visitor's holds neither); typecheck and `npm test` green; a browser check at desktop, iPad and
phone widths shows the card opening by hover and by tap, staying inside the window, and each button
working.

## Stage 2 — the cue (prompt, measured)

The cue is the one line the route's model writes per stop (`SKIM_SYSTEM` § 3, `skim/9`). Its rule is
"what to LOOK FOR, never what it found", which the model satisfies with a question that leans on
the quote's own unexplained words — *"Which interpretation does their evidence favour?"* before a
quote that says *"the latter interpretation"*. The reader is told to look for something without
being told what the choice is.

**The change, `skim/10`**: the cue's first job becomes to **set the scene the quote assumes** —
name what is at stake, the two things being compared, what "this" or "the latter" refers to — and
then point at what to look for. Still never the finding. Greg's example, fixed, might read:
*"Is the model reasoning or recalling its training data? See which reading their results favour."*

Two things the plan decides now:

- **The cap goes from 140 to 200 characters** if the measurement shows situating cues being cut
  (an over-long cue is nulled, which is worse than a long one). The current row and the door both
  wrap. Decided by the over-limit count in the eval, not by taste.
- **The model sees only the quotes, the Ideas and the outline, not the paragraph round a quote.**
  So for a quote whose referent ("the latter") is in the sentence before it, the model may have
  nothing to situate with unless an Idea names it. The simple version is wording only. If the
  measurement shows the dangling-reference case is not fixed, the next step is to hand the model the
  quote's own paragraph. **That changes `skimInputHash`, so every stored route would read stale and
  show its banner**; it is not built here without evidence, and if the evidence says it is needed it
  is measured as a third arm and brought to Greg as a question, not shipped.

**Measurement**, per [prompting-guide.md § Measuring a prompt change](../project/prompting-guide.md#measuring-a-prompt-change):
production's own function on four to six real local papers (include `2608-13566v1` if it is local or
can be read from production read-only); `skim/9` twice (the control), `skim/10` once or twice; pairs
are the same quote's cue under each arm, sides shuffled with `blindCoin`, key balance checked. A
blind judge in a fresh subagent sees the quote and the two cues and answers: (a) which cue better
prepares a reader who has not read the paper to understand this quote; (b) does either give away
what the passage found. Cheap screens: over-limit count, share of cues starting "Look for", cue
length. Also compare what the route itself did (stops per depth, carried stops, Idea coverage) so a
cue change has not moved the route. Check OpenRouter `limit_remaining` first; the whole run should
cost well under $5. Written up under `docs/investigations/`.

Ships if (a) beats the control's spread and (b) is no worse. Otherwise the report ends with what was
measured and a question.

Old routes: an older prompt over the same article is *outdated*, not *stale*, and is not announced
(260929c). So existing routes keep their cues until planned again from Metadata. That is the house
rule; named here because it means Greg's own article will not change until he re-plans it.

## Review

GPT Sol on this plan (read-only), then on each stage's code (write-capable).

### Sol's plan review, 2026-10-06 — not ready, 2 P1 and 5 P2; all seven accepted

[The review](261006e-plan-review-sol.md). **Where the text above and this section disagree, this
section is the plan.** No second plan round: each fix is a narrowing, and the code review checks them.

- **F1 (P1), the judge could not tell a grounded scene from an invented one.** The judge is given
  the quote's paragraph and the one before it, and a third question: does either cue invent or
  misstate the context? Shipping needs an improvement on the dangling-reference cases with no
  regression on grounding or on giving the finding away.
- **F2 (P1), a controlled `Tooltip` does not pin on a mouse click.** So no pinning: hover or focus
  on a desktop, a tap that stays open on touch. The panel's one-open-snippet state stays the owner
  of which term is open, so opening an idea still closes a term.
- **F3, a long entry can push the buttons off a short window.** The card gets a height cap and
  scrolls; checked on a phone in landscape with a researched entry.
- **F4, Hide removes the chip that had focus.** After a successful hide, focus goes to the current
  stop's row. Tested on the last term.
- **F5, the plan was wrong about stale.** `loadSkim` counts a hash mismatch only when the stored
  prompt version is the current one, so with the bump to `skim/10` an input change makes old routes
  *outdated*, which is not announced. **Handing the model each quote's paragraph therefore costs no
  banner**, and it becomes a measured arm (C) here rather than a later question.
- **F6, the cap.** 200 from the start, for every new arm; cue lengths are reported.
- **F7, counts cannot show the route held.** Compare the ordered quote ids, depths and `again`
  against how much two control runs differ.

**The arms, then**: A1 and A2 are `skim/9` (the control pair); B is the new wording, cap 200; C is
B plus, for each quote, its own paragraph and the tail of the one before, fenced as data and said to
be for writing the cue. C is what can actually answer "what are the two interpretations?" when the
quote says only "the latter". It costs input tokens on every route and loosens "the route's model
never sees the rest of the prose" (it would see the paragraphs of the quotes, still not the
article). **Ship C only if it beats B on the dangling-reference cases; otherwise B.**

## Progress

- 2026-10-06: plan written; Sol's plan review folded in as above. OpenRouter had $14.70 left of the
  month's $400, so the paid run is held under about $1.
- 2026-10-06: **stage 1 landed** (`0432a7404`, Sol's review and two fixes `35629c447`): no "also at
  stop", and a term chip opens the glossary's own card. Sol found a touch tap that never pinned (P1)
  and a slow Hide stealing focus (P2), fixed both red-first, verdict ready.
- 2026-10-06: **stage 2, two rounds** ([261006b](../investigations/261006b-skim-cue-situates-the-quote-eval.md)).
  Round one (`c943494a9`): B, a scene on every cue, was preferred 72 to 11 but gave the finding away
  twice as often (33 against 17) and misstated context ten times against one. C, the paragraph arm,
  did not clearly beat B on the dangling quotes (14 to 10) and cost 36% more. **So the ship rule
  failed for both, and neither shipped.** Round two: B2 sets a scene only when the quote needs one,
  as a question, from the records alone. Preferred to the old cue 50 to 19; giveaways 18 against 19
  and misstatements 3 against 1, both inside what two runs of the old prompt differ by. On the
  dangling subset it is ahead 15 to 8, which is not clearly outside the control (11 to 10). **B2
  ships as `skim/10`; arm C's code was removed.** OpenRouter spend: about $1.09 over both rounds.
- **Not shown:** one run of each new arm, one judge per comparison and of the writer's family, no
  person has read the pairs, and the regex that marks "dangling" quotes is wide. A judge asked only
  which cue prepares better prefers B's fuller scene to B2's 64 to 19: that is a product trade-off
  (fuller scene, more giveaways) and is put to Greg in the debrief.
- 2026-10-06: **stage 2 review correction to the ship decision above.** The counts recompute, but
  "both inside what two runs of the old prompt differ by" is too strong: B2's misstatement excess
  over A1 is 2 (3 against 1), while the control difference is 1 (3 against 2). A raw count within
  the control's 2–3 is not evidence of no regression. The accepted F1 gate also requires improvement
  on the dangling cases; 15 to 8 with 5 ties does not clearly show it. B2 remains implemented as the
  candidate; shipping requires further target-case evidence or an explicit decision to change that
  gate. The investigation and reference doc now state those limits.
