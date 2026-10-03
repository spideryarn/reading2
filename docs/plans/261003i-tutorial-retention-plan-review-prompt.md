# Plan review: Tutorial leans to retention, a softer blurb, quote links that show the quote

You are reviewing a **plan**, before anything is built. Read-only: change no file.

## The candidate

A live, uncommitted file in this worktree (base `428054781`, branch `worktree-fb-tutorial-2610`):

- `docs/plans/261003i-tutorial-leans-to-retention-a-softer-blurb-quote-links-that-show-the-quote.md`
  (untracked)

Read it in full. Then read what it leans on, in the tree:

- `src/converse.ts` — `TUTORIAL_SYSTEM`, `CITING_RULES`, `readItFor`, `lengthLine`
- `src/web/ChatPanel.tsx` — `TutorialInvitation`, the composer placeholder
- `evals/remember-tutorial.ts`, `evals/results/remember-tutorial.md`
- `src/web/Cited.tsx`, `src/web/citations.ts` (`splitCitations`), `src/web/BlockRef.tsx`
- `src/web/keynav.ts` (`beginJump`), `src/web/flash.ts` (`flashBlock`), `src/web/rows.ts`
  (`passageMarks`), `src/web/reader/passages.ts`, `src/web/search-hits.ts`, `src/web/annotate.ts`,
  `src/quote-match.ts` (`findQuote`)
- `docs/project/remember-mode.md`, `docs/project/remembering-vision.md`,
  `docs/project/prompting-guide.md` (§ Measuring a prompt change), `docs/project/vision.md`

## What to do

Make an independent pass first. Attack the plan: is each stage the simplest thing that answers the
report it names; is anything claimed about the code false; will the measurement show what it says
it will; is there a cheaper design the plan passed over; does anything in it cut against
`vision.md` or the rules in `remember-mode.md`?

In particular, **verify the plan's factual claims about the code yourself** — they came from a
subagent's reading and from mine, and several are of the "the parts already exist" shape.

Grade every finding, and give each an id (`PR-1`, `PR-2`, …):

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

For each: what is wrong, the evidence (file and line), and what you would do instead. End with a
verdict line: `VERDICT: build as planned` / `VERDICT: build with the changes above` /
`VERDICT: do not build`, and say which findings the verdict depends on.

## My own suspicions — already mine, worth less; spend most of the run elsewhere

- Stage 2, option A versus B: I have not traced whether a `Found` published at click time is drawn
  as a `mark.hit` before `beginJump`'s scroll settles, nor whether a mark invisible at rest is a
  thing the passage pipeline supports. If A is clearly the more tangled, say so.
- Stage 2's footnote-marker case: I do not know what `renderedText` does with a `<sup>` marker.
- Stage 1's "own-view question" screen is a regex and will miscount; is there a better cheap screen?
- Whether the prompt change in Stage 1 fights anything already in `TUTORIAL_SYSTEM` (the "Doubt"
  task, "ADAPT TO WHO THEY ARE", "If they push back, take it seriously").
- Stage 3 is a proposal only. Is option B (`my_notes` as a Chat tool) sound against
  `docs/project/chat-tools.md`'s filter and `docs/project/security-map.md`?
