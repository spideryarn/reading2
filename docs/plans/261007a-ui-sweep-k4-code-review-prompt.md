# Review: K4 of the UI sweep. Failure sentences, and five small panel states

Repo: this worktree (`/var/tmp/spideryarn-worktrees/agent-a1808d25fe65f8be3`), branch
`worktree-agent-a1808d25fe65f8be3`. TypeScript, ESM, React 19, vitest with jsdom. Read `CLAUDE.md`
§ Working agreements first.

Nonce, to echo on the first line of your answer: `K4-REVIEW-c41d7e`.

## The candidate

Committed, as five commits with two merges of `origin/dev` between them. Review these five and
nothing the merges brought:

    git show b007f68cd   # group 1: the stream reader's throws, and six catches
    git show 012af29a1   # group 2: Skim's purpose box
    git show 675d794f9   # group 3: four more catch sites
    git show e707aa87f   # group 4: Quotes, Glossary, Referee, Search
    git show 5d593947c   # the rewrite hold at Quotes' ceiling, docs, lint

    git show --stat --format= b007f68cd 012af29a1 675d794f9 e707aa87f 5d593947c   # every changed path

Start with `src/web/lib/sse.ts` § `readAnswerStream`, `src/web/SkimPurpose.tsx`,
`src/web/purpose.ts` § `storedPurpose`, `src/web/QuotesPanel.tsx` § `Foot` and its call site, and
`tests/kept-answer-catches-say-a-readers-sentence.test.tsx`. That is where to begin, not the limit
of scope: the five commits are.

Also part of the candidate, to be read as a reviewer of its conclusions and not only of the code:
`docs/plans/261007a-ui-sweep-k4-failure-sentences-and-panel-states.md` (what landed, the browser
measurements, what the umbrella got wrong, what was left) and the new paragraphs in
`docs/project/copy.md` § The same seam in the browser. The specification is
`docs/plans/261007a-ui-sweep-umbrella.md` § K4 and K4's line in its File manifest.

## What it is meant to do

Only a sentence somebody wrote for a reader may reach one (`docs/project/copy.md`;
`src/web/lib/describe-failure.ts` § `describeFetchFailure` is the one place a caught failure
becomes that sentence; `src/web/lib/reader-facing.ts` has the classes and the lost-connection
mark). Eleven catches printed `(err as Error).message`. They now call the helper, after the throw
seam under four of them was fixed so that the helper classifies each throw correctly.

Beside that, five panel states:

- Quotes' foot at the 40-quote ceiling shows a running, starting or failed job (or the rewrite
  hold's waiting line) in place of the ceiling sentence, and asks again through the forced rewrite
  (`rerun`), never Find more.
- A glossary occurrence chip records the block, so the ‹ › stepper goes on from it. The glossary's
  "look up a term" box cancels an Enter or Escape an input method is using
  (`docs/project/keyboard.md` § A key an input method is using is not ours).
- Referee's Criteria and Mirror offer their retry only while `worthRetrying` (src/messages.ts)
  says another go could work; the failure sentence stays.
- Search's three order buttons are a named group with `aria-pressed`, a guarded hover, an
  `:active`, the app's focus mark and a 40px touch floor, in `search.css` under their own class.
  They deliberately do **not** use `OrderGroup`, and the row at rest must not change.
- The hint under failed saved searches promises a retry only for rows whose ⚠ is a button.

Rules the builder was given: stay inside the manifest (so `src/web/lib/api.ts`,
`DiagramPanel.tsx`, `useCriteria.ts`, `narrow-window.css`, `Metadata.tsx` and the rewrite hold
itself were not edited); no new machinery; no dependency; reader-facing sentences follow
`docs/project/copy.md`; no prompt is touched.

## What was measured in a browser

Headless system Chrome against this worktree's dev server, with every non-GET to a model-capable
route refused inside the browser. The numbers are in the plan doc § The browser check. In short:
Search's order row at 1440 (fine pointer) is identical at rest before and after, and at 390 (touch)
differs only in button height (22.19 to 40) and the row's height with it; x, width, radius,
colours, font size and line count are the same; Chrome's accessibility tree gains a group named
"Order the passages by" and three pressed states; a real Tab draws `solid 2px` in
`--highlight-text`. Glossary's stepper reads 1, then 2 after the second chip, then 3 after Next, on
two articles. Diagram's two reads, refused, each print the helper's lost-connection sentence.

Not reached in a browser, and covered by unit tests only: the four model-calling streams, Skim's
purpose box, the Referee failures, Quotes at its ceiling, the failed-search hint, the ask box under
a real input method.

## What I want from you

An independent attack first. Then answer these two directly:

1. **Does any change alter what a reader sees beyond what the plan says?** Name each one you find,
   whether or not you think it is wrong.
2. **Is any sentence a reader can now be shown false, or less true than the one it replaced?**
   Include the three new sentences in `SkimPurpose.tsx` and the three hint variants in
   `SearchPanel.tsx`.

Severity, by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

Give each finding an ID (`K4-F1`, `K4-F2`, …), its severity, whether it is **established** (direct
evidence: a failing run, or an exact reachable path) or **reasoned**, and the evidence. Refuse
("not ready") only on an established P0 or P1.

**Fix what is inside this cluster, narrowly and red first** (write the test, see it fail for the
right reason, then fix); **report, do not fix, anything wider** or anything in a file outside the
five commits' path list. Do not edit `docs/plans/261007a-ui-sweep-umbrella.md`. Do not commit; leave
your changes in the working tree and say what you changed and why. Do not invent or alter any
quotation attributed to Greg.

You have no network and no database: run a single test file with `npx vitest run tests/<one>` or a
script with `node --import tsx`. `npm run typecheck` works. Do not run the whole suite.

End with a verdict line: **ready**, **ready with these fixes**, or **not ready**.

## My own suspicions (already mine, worth less; spend most of the run elsewhere)

- The sentence I would least like to be wrong about: in `SkimPurpose.tsx`, when the save rejected
  and the re-read shows the draft **is** stored, the code carries on to `owner.ensure()`, a paid
  call. I think that is what the press asked for. Is there a path where the stored value equals
  the draft although this press did not store it, or where `ensure()` then runs twice?
- `SkimPurpose.tsx` compares `held.purpose !== text` where `text` is `draft.trim()`. The server
  normalises with `normaliseProfileText` (src/profile.ts): `\r\n` to `\n`, then trim. Can a browser
  textarea's value differ from that and make a stored sentence read as "not saved"?
- A refused `done` frame is now a `MalformedReply`, so the reader gets `PAGE_FAULT` where they got
  "The answer arrived in a form this page could not read… Trying again starts a fresh answer."
  I argue in the plan doc that this is truer. For Glossary's ask box the server may not have stored
  anything a reload would show; is `PAGE_FAULT` still the better sentence there?
- `MirrorPanel.tsx`: under a failure that is not worth retrying the one button is not drawn, so
  the reader cannot run Mirror again without leaving the sub-mode. `JobProgress` has the same
  rule. Is that right for a `blocked` failure, where the reader's lever is to change their comments?
- The site code (`[source-open]`, `[export-failed]`) is now appended only when the reason carries
  none. Does anything parse those codes, or any test or doc promise them on every failure?
- `display: contents` on `.srch-sort-group`: Chrome exposes the group. Is there a browser the app
  supports where a `role="group"` on a `display: contents` box is dropped from the accessibility
  tree, and does that matter more than changing the row's layout would?
- `QuotesPanel.tsx`: `elsewhere` is `rerun("Choose them again", true)`. With the seventh sweep's
  rewrite hold (`rewriting`, `newList`, `runDisabled`), is there a state at the ceiling where the
  wrong control shows, or two do?
