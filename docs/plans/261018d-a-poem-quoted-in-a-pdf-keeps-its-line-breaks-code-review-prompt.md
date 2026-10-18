You are reviewing code in a Spideryarn worktree (an AI-assisted reading app). You may fix what you
find inside this change (--sandbox workspace-write); report anything wider for the author to decide.
Do not commit, and do not run git commands that discard work (checkout --, restore, stash, reset,
clean).

The change is commit edda564f7 (`git show edda564f7`): src/pdf-read.ts (`withLines`,
`linesAreTheAuthors`, the call in `renderHtml`), tests/pdf-quote-line-breaks.test.ts, and the plan
docs/plans/261018d-a-poem-quoted-in-a-pdf-keeps-its-line-breaks.md. Your own plan review is
docs/plans/261018d-a-poem-quoted-in-a-pdf-keeps-its-line-breaks-plan-review-sol.md — check every
finding there was actually addressed in the code, not just in the prose.

Check in particular:
1. `withLines` runs after `withMarkers`: can a note marker's `<sup>…</sup>` HTML, or an escaped
   entity, ever contain or split a `\n` so the replacement lands somewhere wrong?
2. An `uncertain` quote (class `pdf-uncertain`, ⟦illegible⟧ markers) — any interaction?
3. Downstream of `block.html`: the reading view, src/web/annotate.ts anchoring, src/web/maths.ts,
   cross-references, search, export, the sanitiser (src/sanitize-policy.ts), and src/blocks.ts
   `blocksAreWhatTheirHtmlProduces` / any check that re-derives blocks from html and compares.
   Does anything treat `<br>` inside a blockquote badly, or split a block at it?
4. Do the tests actually fail without the fix (reason it through, or try reverting withLines
   locally and put it back)?
5. The rule's edge cases: lines of only punctuation (`. . .`), CRLF, a quote with leading-space
   lines, a Unicode line separator.

Run: npx vitest run tests/pdf-quote-line-breaks.test.ts tests/pdf-read.test.ts tests/block*.test.ts
and npm run typecheck (a pre-existing error in tests/matter.test.ts is not ours).

Write findings numbered F1…, each with severity, evidence (file:line) and what you changed if
anything. End with a one-line verdict: APPROVE, APPROVE WITH CHANGES (made), or REJECT.
