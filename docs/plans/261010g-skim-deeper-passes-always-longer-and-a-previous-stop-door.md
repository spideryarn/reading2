# Skim: a deeper pass is always longer, and the prose gets a previous-stop door

Three admin reports from Greg (`feedback-reporter.ts` exit 0 on each), all filed 2026-10-09 from
Skim on `arxiv-1706-03762-spya-wyt7j0` at build `5f6d3d5f`. The mode is [skim.md](../project/skim.md).

> Levels of the skim mode were supposed to get more and more detailed, and yet in this case it seems
> as though the most detailed skim submode has fewer steps than the middle one.
>
> — Greg, 2026-10-09 (`spya-nbmce7`)

> Feedback report about the more, the higher level skim submodes not having as many steps. I just
> reran it again and it seemed to have more this time. I don't know.
>
> — Greg, 2026-10-09 (`spya-q2w7yt`)

> In skim mode, perhaps add a previous step as well as a next step in the article text. Perhaps the
> previous step is on the left-hand side and the next step is on the right, as it already is.
>
> — Greg, 2026-10-09 (`spya-gm858u`)

## What went wrong: a rule that kept checking the old meaning of a pass

The route is planned once, and each stop gets a `depth` (the first pass it is in) and, since
`skim/9`, `again` (deeper passes it is carried into). The only rule that a deeper pass is bigger is
`growthFailure` (src/skim.ts), and it judges **cumulative** counts — stops at depth ≤ 1, ≤ 2, ≤ 3 —
which is what the reader saw when the passes nested. Since 260929e each pass walks **only its own
stops** (plus, since 261003l, the few carried into it). So the rule checks a number the reader no
longer sees. Cumulative `3 < 7 < 11` passed; the walk was **Gist 3, More 5, Most 4**.

The targets in the prompt have the same fault: they are cumulative too (`about 6 at depth 1 or 2;
about 11 in all` for 11 quotes), which, read as passes, asks for Gist 3, More 3, Most 5 — so even a
model that hits its targets exactly gives a More no longer than Gist, and carrying stops into More
can push it past Most.

**Measured on production** (read-only, 2026-10-10): of the 29 routes stored, **8 have a pass no
longer than the one before it**, as walked. Seven are More = Gist, the targets' doing; one is the
reported route, More 5 > Most 4 (`own 3,4,4` plus one stop carried into More). Greg's re-run
(`skim/11`) came out Gist 5, More 10, Most 13, which is why it "seemed to have more this time": luck,
not a rule.

The class: **a check whose meaning changed under it** — the walk changed in 260929e, and the
invariant kept guarding the old walk. Written up as a postmortem (Stage 3).

## What we build

### 1. The growth rule judges the passes as walked, and a route is repaired rather than shown short

- `growthFailure` takes the **walked** counts of the passes the route offers — `walkedIn`'s
  definition (`depth === d` or `again` includes `d`), one copy in `src/skim.ts` that the client's
  `skim-route.ts` already matches. With at least `GROWTH_MIN_QUOTES` (8) offered quotes each offered
  pass must be strictly longer than the one before; with fewer, never shorter. `visibleCounts` and
  the caps stay cumulative — they bound how many stops there are, which is a different question.
- **Before judging, `validateRoute` repairs** (new rule 9), in this order, until it holds or nothing
  is left to move:
  1. **Drop carried entries** into the shallower of the two passes, the latest in route order first
     (the same order rule 8 already cuts in). A carried stop is an extra; the stop itself stays.
  2. If that is not enough, **move the shallower pass's least important own stop one pass deeper**:
     lowest quote priority, the latest in route order on a tie. Its `again` goes (it is now in the
     pass it was carried into). Never empty a pass that way.
  3. Gist→More is fixed before More→Most, and the loop re-checks both, since moving a stop into More
     can make More as long as Most again.
  Each move is counted in `dropped` (`shrinkCarried`, `shrinkMoved`) so an eval can see how often
  the backstop works. Only if the repair cannot make it hold does the route fail as today.
- **Why moving a stop is acceptable here when rule 6 never demotes (Sol F8):** rule 6 forbade
  demoting a stop that broke a *cap*, because that would only bloat the deeper pass. This moves a
  stop that the model put in a pass already too long for its place; the total is unchanged and
  every cap still holds (moving a stop deeper can only lower a cumulative count at a shallower
  depth).

### 2. The targets ask for passes that grow

`targetsFor(q)` gives **each pass's own** count, not cumulative ones, chosen so they strictly grow:

- Gist `g` = `min(5, ceil(q/5))`, the old Gist target, lowered until `g + (g+1) + (g+2) ≤ q`;
- More `m` = `min(10, max(g + 1, round(0.4·(q − g))))`;
- Most `n` = `min(36 − g − m, q − g − m)` — the rest, within the cumulative cap.

For 11 quotes that is Gist 2, More 4, Most 5 (was 3, 3, 5 read as passes); for 30, 5, 10, 15. A test
checks `g < m < n` and the caps for every `q` from 8 to `MAX_QUOTES_TOTAL`. The prompt says them as
passes ("about 2 of its own at depth 1, about 4 more at depth 2, about 5 more at depth 3"), says that
a reader walks each pass on its own and expects each to be longer than the one before **counting the
stops carried into it**, and section 2's "Each pass must ADD stops of its own…" sentence becomes that.
`PROMPT_VERSION` → `skim/12`. The input hash is unchanged; a stored route is staled by the version
alone, which is not announced, as at `skim/9`–`skim/11`.

**Trade-off, named:** between 8 and about 14 quotes Gist is one stop shorter than before (11 quotes:
2, was 3), because three growing passes do not fit otherwise. Above that the Gist target is nearly
what it was.

### 3. *‹ Previous stop* in the prose, on the left

The door after the current stop's block (`SkimPanel.tsx` § `SkimDoor`) gets a **‹ Previous stop**
button on the left of its row; *Next stop ›* / *More detail ›* stay on the right, as Greg described.
It is the same `step(-1)` ← already calls, with the same `StepTip` card (keyName ←). It is **not
drawn on the first stop of a pass** — ← there goes to stop 1's passage again, which is a different
job and not what a "previous" button promises. *All stops* (offered while the band is aside on a
narrow window) stays with the forward buttons. `SkimControl` gains `hasPrevious`.

## Simpler options passed over

- **Validator only, prompt unchanged.** No eval, no version bump. But the current targets *ask* for
  More = Gist on most short routes, so the backstop would move a stop on most routes; a backstop that
  fires routinely is the main path. The prompt change makes it a backstop.
- **Throw on a non-growing walk, as the cumulative check does.** No repair code, but the reader then
  gets a failed step and a re-run button where today they get a usable route; and the reported route
  would have failed rather than been fixed.
- **Make the passes nest again** (each depth contains the one before). What the brief floated; it is
  exactly what Greg reversed in SPIDERYARN-READING2-4P (*"a bit annoying for the more detailed
  levels … to reuse the same snippets"*). Not reopened.
- **Repairing stored routes on read.** The 8 stored routes keep their walk until planned again (the
  version bump marks them out of date, silently, as every Skim version has). A client-side copy of
  the repair would be a second definition of the rule.

## Stages

1. **Rule, repair, targets, prompt** (src/skim.ts, tests/skim.test.ts): red tests first — the
   reported route's shape (`own 3,4,4` + one carried into More) must come out growing; a q=8 route
   at the old targets; targets grow for all q. Then the code. Then a measurement: the NEW arm of
   `scripts/eval/skim-coverage-eval.ts --new-only` on the local articles plus the reported one from
   production (`--file=`), 2 runs each — walked counts per pass, how often the repair fired, Idea
   coverage at each pass against the last `skim/11` results. Written up under `docs/investigations/`.
2. **The previous-stop door** (SkimMode.tsx, SkimPanel.tsx, Reader.tsx, skim.css), with a browser
   check on desktop and a narrow window in a Sonnet subagent.
3. **Docs and bookkeeping**: skim.md (the growth rule, the door), the help page if it names the door,
   a postmortem, the user-feedback note. GPT Sol reviews the plan before Stage 1 and the code before
   the push.

## Log

- **Plan review (GPT Sol)**, [261010g-skim-plan-review-sol.md](261010g-skim-plan-review-sol.md),
  eight findings, all taken: one shared definition of a walked pass (F1 — `src/skim-passes.ts`,
  imported by the band and the server; server code may not import `src/web/`); gaps between
  offered passes and fewer-than-eight routes pinned in tests (F2); a moved stop keeps `again`
  entries deeper than its new depth, and a quote with no priority is the lowest (F3, using
  `priorityOf`, the priority the prompt shows); the promise narrowed to newly planned routes (F4);
  the trade-off wording corrected (F5); an old-twice control in the measurement (F6); the previous
  button predicate by index and a left/right group layout (F7); the simpler "fail rather than move"
  option weighed (F8 — kept the repair because a failed step costs the reader a re-run, and it is
  counted so its rate is visible).
- **Stage 1, measured** — [261010a](../investigations/261010a-skim-per-pass-targets-and-walked-growth.md),
  six articles, two runs per arm, `skim/11` twice as control. Old prompt: 6 of 12 runs did not grow
  as walked. **Round 1, strictly growing passes as planned above:** 0 of 12 failed to grow, but on
  11–13-quote articles Gist fell to two stops and Gist Idea coverage fell from 24–25 to 20 of 49 —
  past the bar. **Round 2, built: More may equal Gist** (Gist target back to `ceil(q/5)`; rule
  `Gist ≤ More < Most`): 0 of 12 break the rule, `shrinkMoved` in 2 of 12 (one stop each), nothing
  thrown, Gist coverage 22–23 against the control's 24–25 — a marginal miss on two runs, named
  here rather than rounded away; More 35 vs 36, Most 39 vs 39. Whether More should be strictly
  longer than Gist at the cost of a two-stop Gist on short articles is Greg's call:
  [q-vzd2xt](../user-feedback/questions/q-vzd2xt.md).
- **What changed from the plan above, therefore:** §1's rule is `Gist ≤ More < Most` (strict only
  for Most over More); §2's targets keep the old Gist and let More equal it; the prompt says a
  deeper pass is never shorter. §3 as planned, with `.skim-door-back` / `.skim-door-on` groups.
- **Stage 2** — door built test-first (`tests/skim-panel.test.tsx` § the door in the prose); help
  page line added. The help page's two Skim pictures predate the button and are for the next
  retake (help-page.md).
- **Stage 3** — skim.md, postmortem
  [261010a](../postmortems/261010a-a-check-guarding-a-walk-that-had-changed-under-it.md), the note.
- **Browser check** (Sonnet subagent, Playwright on the box): the door on desktop, ‹ Previous stop
  stepping back, the end-of-pass door, a phone width wrapping to two rows with no sideways scroll,
  and dark mode — all as intended; screenshots `261010g-shot-*.png`.
- **Code review (GPT Sol)**, [261010g-skim-code-review-sol.md](261010g-skim-code-review-sol.md),
  fixes applied by Sol and checked here: targets below eight quotes no longer contradicted the rule
  (`targetsFor(6)` was 2/1/3; 0 asked for a Gist stop); the prompt's "Most longer than More" said
  only from eight quotes, and "nearly all the quotes" became "about as many as the targets add up
  to" (the same thing below ~40 quotes, where the measurement ran; above, the 36-stop cap already
  ruled); two old tests that judged growth on cumulative counts now use `passSizes`; type docs;
  `hasPrevious` pinned. Left: `scripts/eval/skim-diversity.ts` still calls nesting "today" — a
  historical eval, kept as it was.
