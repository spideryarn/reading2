# The glossary keeps cited works out: a citation is not a term

Feedback report `spya-zn97q5` (Sentry SPIDERYARN-READING2-BN), Overseer queue item `qi-gbcjdnyj`.
Up: [plans.md](../project/plans.md). The feature: [glossary.md](../project/glossary.md).

> It looks as though there is at least one glossary item in this article that's actually a paper,
> Saha et al. I don't think the glossary should include citations. That's what citations are for.
>
> — Greg, 2026-10-03, on `arxiv-2610-spya-bfrbaj`

## Goal

A paper the article cites ("Saha et al.") does not get a glossary entry, and is not underlined in
the prose as a glossary term. Cited works already have their own mode, Citations
([citations.md](../project/citations.md)), which lists every one and marks each in the prose.

## Why it happens

The glossary prompt (`SYSTEM` in [`src/glossary.ts`](../../src/glossary.ts)) invites it. Under
WHAT BELONGS it lists *"people, organisations, places, works and events named without
introduction"*, and a paper cited as "Saha et al." is a work, or a group of people, named without
introduction. Nothing in WHAT DOES NOT says a citation is different. Today's paperwork rule
(`paperwork("pick")`, `glossary/8`) only covers the reference list at the end, and a citation sits
in the body.

## It reproduces locally, in three shapes

I could not read the production row (no production access from an unattended session), so I did not
see the "Saha et al." entry itself. But the eval that 261003d ran today recorded glossaries for
local papers under the current prompt (`evals/results/paperwork-modes/after*/`), and the same thing
is in them:

| Shape | Recorded example (`source-spya-f550ta`, `entropy-24-00930-spya-pywwkq`) |
|---|---|
| **The entry is a citation** | `[work] Rakov and Uman` with alias `Rakov and Uman (2003)`; `[person] Stenhoff` with alias `Stenhoff (1999)`; `[person] Williams and Beer` |
| **A real term, with a citation as an alias** | `[term] fragmented science`, alias `Turner (2001)`; `[event] Dorstone case`, alias `Morris (1936)` |
| **A real event named through its citation** | `[event] Camp Blanding triggered-lightning experiment`, alias `Hill et al. 2008 experiment` |

The second shape matters as much as the first. An alias is what the prose underlines, so the alias
`Turner (2001)` puts a glossary underline on a citation and opens "fragmented science" from it.

The same runs also show what must **not** be lost: `Georg Wilhelm Richmann`, `Jean-Martin Charcot`,
`François Arago`, `Pyotr Kapitsa` — people the piece talks about as people — and, in the essay
`scaling-hypothesis`, `GPT-3`, `AlphaZero`, `Hans Moravec`. Those are glossary entries and stay.

## Key decisions

**1. The line is "cited" against "discussed", not "work" against "term".** A work the piece only
points at as a source (author-and-year, "et al.", a bracketed number) is out. A work or a person the
piece talks about (a novel it analyses, a scientist whose experiment it describes) stays. Greg's
words are about citations, and dropping every `work` and `person` would undo the 260826d and
260926a work that got people into the glossary at all. *If Greg wants the stricter rule (no works at
all), that is a one-line change to the prompt later; it is recorded as a question below.*

**2. The idea survives under its own name.** When a cited paper matters because of an idea it
introduced, the entry is the idea ("partial information decomposition"), never the citation
("Williams and Beer").

**3. Two layers: the prompt does the judging, and code catches the one shape that needs no
judging.**

- *The prompt* gets a rule in WHAT DOES NOT and a line in NAMES AND ALIASES, and the version goes
  to `glossary/9`. Only a model can tell "Stenhoff (1999)" the citation from "Blade Runner (1982)"
  the film under discussion.
- *Code* drops any entry whose name is a name followed by "et al", and any such alias, in
  `toEntries`. Nothing is called "Saha et al." but a citation, so this needs no judgment. It is there because a prompt is a request, not a guarantee, and "Saha
  et al." is the exact case Greg reported.

**The simpler option passed over: the prompt alone.** It is one edit and probably enough. The guard
is about fifteen lines and one test, touches nothing else, and makes the reported case impossible
rather than unlikely, so it is worth having.

**The more thorough option passed over: check every entry against the article's Citations list**
(drop an entry or alias equal to a cited work's in-text label). It would catch the author-and-year
shapes in code too. It also makes the glossary step depend on the citations step: its order in the
pipeline, its staleness, and what to do when Citations has not run. That is two stages braided
together to catch what the prompt already catches; the measurement below decided against it.

**4. A term the reader looks up themselves is left alone.** If a reader types "Saha et al." into
*Look up a term…*, that is their request, and it is added to their own list as now
(`src/glossary-added.ts`). The rule is about what the model picks unasked.

**5. Glossaries already made.** `PROMPT_VERSION` is part of the step's stamp
([glossary.md § Staleness](../project/glossary.md#staleness-and-the-force-cascade)), so a glossary
written by `glossary/8` is out of date and is rewritten the next time its glossary step runs, with
entry ids inherited by name (`idsByTerm`), exactly as on every earlier bump. Until then an old list
keeps its citation entry, and the reader can use **Hide** on it. No backfill and no read-time
filter: nothing here is worth a second code path, and no production data is touched.

## Stages, as built

The order changed from the first draft, on GPT Sol's plan review (finding 3): the eval and the
old-prompt arm came first, then the prompt, then the guard, so that the prompt's effect was measured
before code could hide it.

### Stage 1 — the eval and the old prompt, measured ✅

`evals/glossary-citations.ts` calls production's `generateGlossary` and stores each list under
`evals/results/glossary-citations/<arm>/`. Five runs of `glossary/8` on the two papers, two on the
essay, three on the essay with people.

### Stage 2 — the prompt rule, `glossary/9` ✅

Three wordings were run. The first was contaminated (its examples were the eval paper's own
citations), the second was no better, and the third is shipped: the "what is the name's job in the
piece" test Sol asked for, a worked BAD/GOOD case from another field, and "do not make up a name the
piece does not use" (Sol's finding 6). The numbers are in
[261003g](../investigations/261003g-glossary-citation-entries-before-and-after-the-rule.md):
entries named for a cited book, three runs in five before and none in ten after; citation aliases,
five in five runs before and two in ten after; people kept.

### Stage 3 — the code guard ✅

`citesByEtAl` in `src/glossary.ts`, used in `toEntries` on the name (skip the entry) and each alias
(skip the alias). The test in `tests/glossary.test.ts` was written first and seen red (the three
"et al." entries survived), then green.

### Stage 4 — docs and bookkeeping

[glossary.md § A cited work is not a term](../project/glossary.md#a-cited-work-is-not-a-term), the
investigation, the feedback note, `feedback-endings.ts`. Help says nothing about which kinds of
thing get an entry beyond its search keywords, so it needs no change. GPT Sol code review, the full
suite, push to `dev`. No deploy.

## GPT Sol's plan review, and what was done with it

[The review](261003o-glossary-keeps-cited-works-out-plan-review-sol.md). Verdict: build with the P1
changes.

1. **The "et al" guard can remove a real term** (a piece about the abbreviation, a work titled "Et
   Al.", a study discussed at length but called "Saha et al." throughout); drop it. **Kept,
   narrowed.** It now needs a name before "et al", so the first two cases survive, and the test
   covers one. The third is the reported case itself: Greg objected to an entry named "Saha et al.",
   and however much a piece says about that study, the entry's name is still a citation label. The
   guard costs one line and makes the reported case impossible rather than unlikely.
2. **The wording needs an operational test and worked cases.** Done; it is the shipped wording, and
   it is what kept the people.
3. **The eval cannot see the prompt's effect once the guard is in.** Reordered, above. The final
   arm does include the guard; the investigation says what that is worth (one alias in five old
   runs).
4. **Two draws and loose criteria will not separate effect from wobble.** Five old-prompt runs and
   ten of the shipped prompt on the paper that shows the failure; per-candidate rates reported;
   `noema` people run on both sides. Not done: forbidden and protected lists declared before the
   run (they were read off the first runs), and blind classification (the classes are "is this name
   only ever a citation in the text", checked against the text).
5. **A visitor to a public article goes on seeing an old list, and cannot hide or re-run.** True,
   and left so: see the question below. A read-time filter stays out, as Sol agreed.
6. **An idea keeps an entry only if the piece names it.** In the prompt.

## What is not built, and why it is not owed

**The Citations cross-check** (drop an entry or alias equal to a cited work's in-text label). The
measurement says what still gets through is two aliases in ten runs on the densest paper we have.
That does not pay for making the glossary step depend on the citations step. It is a passed-over
option, not a deferred half of this report, so it has no queue entry.

## Questions for Greg (none block the work)

1. **Works and people the piece talks about still get entries** (a book it analyses, a model like
   GPT-3, a scientist whose story it tells). I read "citations" as sources pointed at, not every
   work named. If you want no works at all in the glossary, say so and it is a small prompt change.
2. **The article you reported keeps "Saha et al." until its glossary is made again.** After the
   next deploy, pressing **Find terms again** on it writes a new list under the new rule; nothing
   does that for you, and I have not touched production. Other articles' lists are the same: each
   is rewritten the next time its glossary step runs, and until then the owner can **Hide** an
   entry. A visitor to a shared article cannot do either. If that matters for the public shelf, the
   fix is re-running those glossaries through the ordinary job, which is yours to ask for.
3. **The cost, on a paper dense with citations:** the list is two or three entries shorter, and in
   two runs of ten it was much shorter (7 and 12 entries, where the old prompt gave 17 to 19).
   *Find more* fills it in. If short lists turn up in real use, the next thing to try is the
   wording, not the rule.

## Ledger

- 2026-10-03: prior-work check clean (plans, feedback notes, `git log origin/dev`, `gjd-remote ls`:
  the only session named for the report is this one).
- 2026-10-03: plan reviewed by GPT Sol (build with the P1 changes); five of six findings taken, one
  kept with a narrower regex.
- 2026-10-03: measured, 63 glossary calls on Sonnet in all. The first wording's clean result was
  thrown out because the prompt quoted the eval paper's citations as its examples.
