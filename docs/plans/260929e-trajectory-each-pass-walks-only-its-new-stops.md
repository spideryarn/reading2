# Trajectory: each pass walks only its new stops

Investigation write-up: [docs/investigations/261002k-skim-trajectory-coverage-quote-spread-deeper-passes-and-diversity-evals.md](../investigations/261002k-skim-trajectory-coverage-quote-spread-deeper-passes-and-diversity-evals.md).

From an admin report of Greg's, SPIDERYARN-READING2-4P (overseer queue `qi-amm7ytak`), made on
`arxiv-2212-spya-u5293w` at depth 2 (More):

> In Trajectory mode, it's a bit annoying for the more detailed levels of granularity to reuse the
> same snippets as the coarser levels if I've just read the coarser level. So I wonder if we should
> say that the more detailed levels have to us different snippets, and perhaps longer snippets? At
> the same time, I suppose it's possible that a user might jump straight to the more detailed
> levels... but I suspect they won't. Hmm. Or maybe the coarser levels make more use of Summary or
> Glossary, and the more detailed levels make more use of Quotes and Ideas? Dunno, I'm not at all
> sure that that will make things better or be a good blanket rule. The main thing is to ensure that
> there's diversity within levels, and perhaps ideally between them.
>
> — Greg, 2026-09-29

**In one line:** the repeats Greg met between levels are not the model's doing — the passes are
built to contain one another, so More walks every Gist stop again and Most walks every More stop.
The fix is in the walk, not the prompt: **More walks only the stops More adds, and Most only the
ones Most adds.** No model call changes and no stored route goes out of date.

## What was measured

[`scripts/eval/trajectory-diversity.ts`](../../scripts/eval/skim-diversity.ts) reads every
stored route in the local database (six articles: two papers, an essay, a lecture, a long essay and
an encyclopaedia entry; four at `trajectory/6`, two at `/7`) and counts, per pass, for a reader who
walked the shallower passes first. No model call, nothing written. Greg's own article is only in
production, which this box cannot read. Results:
`evals/results/trajectory-diversity-2026-09-29T13-11-37-091Z.json`.

Two ways of walking the same stored routes: **nested** is today's (depth *d* walks every stop with
depth ≤ *d*), **added** walks only the stops with depth = *d*.

| Pass | Walk | Stops in the walk | Already walked at a shallower pass | Pairs in the pass carrying the same Idea | Consecutive stops in the same top-level section |
|---|---|---|---|---|---|
| Gist | both | 20 | 0 | 1 | 3 of 14 |
| More | nested | 47 | **20 (43%)** | 4 | 10 of 41 |
| More | added | 27 | 0 | 1 | 7 of 21 |
| Most | nested | 103 | **47 (46%)** | 15 | 46 of 97 |
| Most | added | 56 | 0 | 3 | 36 of 50 |

What that says:

- **Between levels, the repeat is structural and large.** Nearly half of every deeper walk is
  stops the reader has just stood at. That is Greg's complaint exactly, and the *added* walk takes
  it to zero by construction.
- **Within a pass, a strict semantic read finds repeats only at Most, and rarely.** The two proxy
  columns above (shared Idea, same section) cannot say whether two stops make the same point, so an
  Opus subagent read every stop's full words, pass by pass, and marked a pair only where reading the
  second tells you nothing new
  ([`…-semantic-read.json`](../../evals/results/trajectory-diversity-2026-09-29-semantic-read.json),
  over the per-stop snapshot in
  [`…-13-21-10-335Z.json`](../../evals/results/trajectory-diversity-2026-09-29T13-21-10-335Z.json)):

  | Pass (its own stops) | Stops | Pairs within the pass that make the same point | Stops that only restate a shallower pass |
  |---|---|---|---|
  | Gist | 20 | 0 | – |
  | More | 27 | 0 | 4 |
  | Most | 56 | 3 (all adjacent sentences) | 5 |

  The three are *Cargo Cult Science*'s "they don't publish it at all" then "publication probability
  depends upon the answer", and two pairs in the long essay's Most. The across-pass restatements
  (9 of 83 deeper stops, 11%) are the same order as 260929b's blind read found (2–3 in 33).
- **Most is also monotonous in a way that is not repetition**: it walks whatever the Quotes found,
  in whichever section they found it. The long essay's Most adds 24 stops, and 20 of its 23 steps
  stay in the section the last one was in.
- **Restatement is semantic, not lexical.** A word-overlap measure (content-word Jaccard ≥ 0.2)
  found no pair in any pass — including the pairs the semantic read did find. So the script's
  `restates` and `near pairs` columns, zero everywhere, are not evidence of variety; 260929b's blind read (2–3 restating stops in 33 added) is
  the best number for it.
- **Snippet length does not follow depth.** Mean quote length per walk, Gist / More-added /
  Most-added, grows on three articles (Antikythera 154 / 189 / 223 characters), shrinks on two
  (entropy 421 / 299 / 205) and is mixed on one. Quotes decides lengths; Trajectory only orders
  them.

## The options, compared

1. **Each deeper pass walks only its own stops (built).** Gist, More and Most become three
   separate walks through one stored route. Pure client change in the walk arithmetic; the stored
   routes, the prompt and `PROMPT_VERSION` are untouched, so nothing goes out of date and nothing is
   spent. Removes 100% of the between-level repeats. **What it gives up:** More and Most stop being
   skims that stand alone and become *what the passes before them left out* — a reader who jumps
   straight to More gets only More's stops. Greg: *"I suspect they won't"*, and Gist is one press
   away. That is the contract, stated in trajectory.md (Sol F3). The other contract Sol offered —
   cumulative passes for a depth button, tranches only along the *More detail ›* door — would give
   "More" two meanings and need the band to remember how the reader arrived; not taken.
2. **Tell the route prompt that deeper passes must differ.** Tried already as `trajectory/8` in
   [260929b](260929b-trajectory-stage2-deeper-passes-eval.md): inside the noise, and it cannot
   touch the structural repeat above, which is 43–46% of the walk. Not repeated.
3. **Longer snippets at deeper levels.** Today's lengths follow no pattern by depth, and they are
   Quotes'. A Quotes change is shared with Quotes mode and every other reader of Quotes; not for a
   Trajectory report. Deferred.
4. **Coarser levels from Summary or Glossary, deeper from Quotes and Ideas.** A second kind of stop.
   260928a's stage 6 declined section stops on evidence (one real section missed in three papers),
   and Greg is unsure it is a good blanket rule. Deferred until reading shows a pass missing
   something Quotes cannot reach.
5. **Within-level variety at Most** — let the route drop a quote that only restates an earlier stop,
   or break long same-section runs. Three same-point pairs in 56 stops, and 5 restatements of a
   shallower pass, is a small problem next to the 46% the walk fixes; and Most holding every
   quote the earlier passes did not use is what makes Gist + More + Most the whole set. Dropping
   stops is a product trade-off. Deferred, with the semantic read above as its baseline.

## The design of option 1

The stored route stays one list with a depth on each stop (src/types.ts § `Trajectory`); only what a
depth *shows* changes.

- **A pass is the stops with exactly that depth**, in route order: `passRoute(stops, d)` replaces
  `visibleRoute`. The band's list, `‹ Stop k of N ›`, ← / →, the door and the stop card's "also at
  stop k" all read it. Gist is unchanged.
- **The depth buttons count their own pass**: *Gist 4 · More 6 · Most 10*, not 4 · 10 · 20. A depth
  is offered when it has any stop at all — `offeredDepths` compared cumulative counts, and on
  exact counts would have dropped a pass no bigger than the one before it (a real route's are
  2 / 2 / 4; Sol F1).
- **No dimmed rows.** `seen` goes from the row and its CSS: no row in a pass is from another pass.
- **A depth change lands on stop 1 of the new pass**, and moves the reader there (scroll and flash,
  through the same `moveTo` as a step). Until now a depth change kept your stop because the deeper
  pass contained it; with separate passes it never does. Stop 1 is what *More detail ›* already
  lands on, so the button and the door agree. Remembering where you were in each pass is deferred.
- **A link's stop wins over its depth**, in one pure resolver, `locate` (Sol F4) — the mode used
  to resolve the depth first and then the stop within it, which is the opposite. A `?stop=` naming
  a stop of another pass shows that stop's pass — so links written before this change, like Greg's own (`depth=2` with, possibly, a Gist
  stop), still arrive at their stop rather than at stop 1 of the wrong pass. A stop that is on no
  pass falls back to the asked depth's stop 1, as now.
- **The end of a pass.** *End of More — 6 stops.* is now true of the walk. The *More detail ›*
  tooltip says it goes on to the stops the earlier passes left out, not "more stops between these".
- **The Most coverage note** in the info tooltip counts all three passes together: *"Gist, More and
  Most together stop at every one of the N quotes offered to this route"* (or M of N).
- **The prompt still describes nested passes** (`TRAJECTORY_SYSTEM` § THE DEPTH: "depth 2 shows
  every stop at depth 1 or 2"). Left alone deliberately: the model's choice of *which* quotes go at
  each depth is what we want either way, the route order is still one order, and 260929b measured
  the "the reader has read the earlier pass" framing with no gain. Changing the wording would bump
  `PROMPT_VERSION` for no measured benefit. Named here so it is decided, not inherited.
- **Docs**: trajectory.md's "Going round again keeps what you already read" becomes the new rule,
  with Greg's words; keyboard.md and url-state.md where they say what a depth change or a depth link
  does.

## Stages

1. This plan, and a GPT Sol review of it (read-only).
2. Build: `trajectory-route.ts` (pure, test-first in `tests/trajectory-route.test.ts`),
   `TrajectoryMode.tsx`, `TrajectoryPanel.tsx`, `trajectory.css` (the `.seen` rules), the comments
   in `src/types.ts` (the stored passes still nest; `visible` is cumulative and says so) and
   `params.ts`, and the docs (Sol F5). `npm test`, `npm run typecheck`, lint on
   the touched files. A browser check at desktop and phone widths (Sonnet subagent). GPT Sol code
   review with fixes.
3. Feedback note, push to `dev`.

## Deferred

- Remembering your place in each pass across depth changes.
- Options 3, 4 and 5 above.
- Rewording the prompt's description of the passes (with a measured eval if done).

## Progress

- 2026-09-29 — measured (above); plan written.
- GPT Sol plan review ([prompt](260929e-trajectory-plan-review-prompt.md),
  [answer](260929e-trajectory-plan-review-sol.md)): *approve with changes*. All six taken — **F1**
  `offeredDepths` on any stop; **F2** the within-level claim needed a semantic read, not proxies
  (done, table above); **F3** state the contract, More and Most are additions; **F4** one resolver
  where the stop wins; **F5** types, params and CSS in scope; **F6** the result file now carries
  every stop's words, cue, section and Ideas, and the script's header is corrected. Sol checked the
  table's numbers against the JSON independently and they agree.
- Built test-first: `tests/trajectory-route.test.ts` rewritten for separate passes and run red
  (the new exports did not exist) before `trajectory-route.ts` changed; twelve integration tests in
  `tests/trajectory-panel.test.tsx` that pinned nesting were rewritten to the new rules, and new ones
  pin a link's stop winning over its depth, a depth change down, and Most's coverage note counting
  the whole route rather than the rows drawn.
- GPT Sol code review ([prompt](260929e-trajectory-code-review-prompt.md),
  [answer](260929e-trajectory-code-review-sol.md)), *approve with fixes applied*, all three read and
  kept: **F1** a step or row press after a link whose stop won over its depth left the stale
  `depth` in the URL — both coordinates are now replaced together (Gist keeps an absent `depth`);
  **F2** the published control trusted the Quote's stored block rather than checking the article
  still has it; **F3** a type in the script. A depth change whose new stop 1 has no passage now
  refuses rather than moving the band without the prose — Sol's call, pinned in a test.
- Browser check (Sonnet, Playwright, own server on the entropy paper): all six checks pass at
  1280×800, and the four asked at 390×844 — counts 4 · 6 · 10, no dimmed rows, More walks its own
  six, the door lands on Most's stop 1, the tooltip counts the three passes together, and a
  `depth=2` link naming a Gist stop opens Gist on that stop. Screenshots:
  [More, 1280](260929e-shot-more-1280.png), [More, 390](260929e-shot-more-390.png),
  [Most, 1280](260929e-shot-most-1280.png). The link's stale `depth=2` it noticed is Sol's F1,
  fixed after the check ran.
