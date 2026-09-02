# Review prompt — Stage 5, the response to your own review

This is the last stage. It exists to act on your review of stages 2 and 3
(`docs/plans/260902f-make-referee-mode-understandable-stage23-review-sol.md`, verdict *ship with
changes*, "I would not ship the current commit until findings 1–4 are fixed").

Scoped diff (`src` + `tests` only, 2,331 lines):
`/tmp/claude-1000/-home-greg-code-spideryarn2/a4050f5f-51fd-4db5-acf6-5bbf91c54fff/scratchpad/stage5.diff`

**Your job is to check the fixes, not to re-open the whole feature.** Stages 1–3 are pushed and were
reviewed. Judge only whether each finding is genuinely closed, and whether closing it broke anything.

## What was done, finding by finding

1. **Candidates' cost wording.** Honest-labelling route taken, not tool suppression. Button is now
   "Build the reviewer brief"; the note says an AI turn starts and a web search **may** run, sending
   terms drawn from the paper to a search engine. Tool suppression was rejected because it needs a
   per-turn tool policy threaded from a button through `useChat`, the chat route and `converse` — a
   client deciding what the server may call, in the one place where "what did this cost" must stay
   answerable server-side. **Is the new wording true?** Check `CANDIDATES_OPENING`, `MAX_TOOL_ROUNDS`,
   and what a first press actually does.
2. **The card was kept and cut, not deleted.** Greg asked for it by name, so a reviewer does not get
   to remove it; but your substance was taken. The four sub-mode lines are gone (they duplicated the
   four chip cards, which post-dated the copy). Measured in the live DOM at 1280×900 on an article
   with no criteria: **409.5px → 203.1px**, against a 269.9px empty-state composer. Two independent
   harnesses reproduced the 409.5. Is what remains the right two ideas, and is anything now missing
   that the removed lines were carrying?
3. **The two red-to-green tooltips** are scale-neutral now and defer to `TheKey`. They were *not*
   derived from the current scale, on the grounds that the key already cannot drift and a second copy
   of the mapping is a second thing to keep in step. Agree or not?
4. **`ANSWER_OVERFLOWED` split.** The first attempt gave both halves the same `[ai-overflowed]` code
   and `tests/messages.test.ts` refused it — two sentences under one code. Final shape:
   `ANSWER_OVERFLOWED` keeps the code and the narrowing advice and goes to Search alone;
   `ANSWER_OVERFLOWED_FIXED_ASK` / `[ai-overflowed-no-ask]` is retry-only for the mode's three
   callers; `parseHits(text, ask: AskKind = "fixed")` defaults to the one that promises least. Check
   every caller gets the right one, and that the default is the safe way round.
5. **Cards that restated their label.** "Try again" and Claims' tick rewritten. Three removed: the
   rank numeral's, and **both Mirror evidence badges**. The Mirror removal went further than you
   asked — its second paragraph *was* `EVIDENCE_NOTE`, printed visibly under the same list — and one
   fact went with it: that an untested kind is present because it is cheap to check and easy to
   dismiss. That fact was **not** moved into the visible footnote. Should it be?
6. **Docs**: `referee-mode.md`, `tooltips.md`. `url-state.md` deliberately untouched — rule-bearing,
   awaiting Greg.
7. **Tests.** All five weaknesses fixed: the file now imports Claims, Candidates and
   `PlaceOnCriterion`; the `body.length > 80` check is a restatement comparison (each paragraph
   against the other and against the visible label) plus a length floor; `text()` skips `sr-only` and
   hidden nodes; stylesheet assertions strip CSS comments; the Candidates test now says it counts
   client requests, not model calls. Eleven mutations were run and all went red.

## Two places the implementer says you were wrong — adjudicate

- **Your finding 7 said `.crit-run[aria-disabled="true"]` also appears in a CSS comment at
  `styles.css:6643`, so deleting the real rule would still pass.** They report the comment names
  `aria-disabled` and `:disabled` in prose but not that selector, and that deleting the rule reddened
  the test as it stood. They hardened it anyway (comments are now stripped). Check who is right.
- **The new restatement check catches copying, not paraphrase**, and they wrote that limit into the
  test rather than implying otherwise: *"Draws this claim's passages in the article"* under the label
  *Mark these passages in the paper* shares one content word in three and would pass. Is a length
  floor plus a copy check plus real coverage of three more panels enough, or is there a cheap
  paraphrase check worth having?

## Go looking for

- Anything in this diff that broke a stage 1–3 behaviour, especially the message split reaching
  `src/search.ts`, `src/referee-mirror.ts` and the criteria/claims stream parsers.
- Any card left in the mode that still restates its label, that you did not name the first time.
- Whether removing three cards left a control with **no** explanation at all where it needs one.
- Any test in this diff that asserts the implementation rather than the behaviour.

## Evidence

`npm run typecheck` clean. The referee/message/search test files pass (84 tests). The full suite is
noisy today for reasons outside this work: peers are mutating the one shared local Supabase — an
index being moved, the seeded admin account renamed by another plan in flight, job leases racing — so
`db-schema`, `seed-admin-signin`, `store-jobs-parity`, `routes` and `admin-store` flip between runs
and disagree run-to-run. The four stable baseline failures (`doc-links`, `pdf-bundle-trace`,
`store-artefact-manifest`, `store-roundtrip`) predate all of this work. Nothing in this diff touches
jobs, schema, auth or routes.

Verdict — **ship / ship with changes / do not ship** — then numbered findings, most serious first,
file and line, and what you would do instead. Do not summarise the change back to me.
