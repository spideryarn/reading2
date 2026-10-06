# doc-links names the anchor you meant

*Status as of 2026-10-06: built — evidence: `suggestAnchor` and `describeBrokenAnchor` in
`tests/doc-links.test.ts`, and the test "says which anchor a broken link probably meant". Smaller
than first planned; see [What the plan review changed](#what-the-plan-review-changed).*

Queue item `qi-takva5m9`, authorised by Greg on 2026-10-04 ("If you're confident, address all of the
Q-queue-yeses").

## Goal, context

On 2026-09-10 four plans in one day linked a roadmap heading containing an em dash using the anchor
GitHub would give it — two hyphens — and `tests/doc-links.test.ts` went red on `dev` four times.
Each one cost a peer's merge and a fix commit.

The cause is that this repo's anchor rule is not GitHub's, although its doc comment previously
said it was:

```
heading            ## Stage 3 — the dashboard
punctuation gone   "stage 3  the dashboard"      (two spaces where the dash was)
GitHub             stage-3--the-dashboard        each space becomes a hyphen
this repo          stage-3-the-dashboard         a run of spaces becomes one hyphen
```

Measured on 2026-10-06 with a throwaway script over every tracked `.md`: 6,176 of 38,189 headings
slug differently under the two rules. So nearly every heading with a spaced em dash is a trap for
anyone writing anchors from habit, and the old failure message was only `from → target`, which says a link
is wrong and not what the right one is.

## What changes

1. **The failure message carries the fix.** A new pure function in `tests/doc-links.test.ts`,
   `suggestAnchor(wanted, anchors)`, returns the anchor the writer most likely meant, or `null`:
   - an anchor that equals `wanted` once every run of hyphens in both is collapsed to one, only if
     exactly one anchor matches;
   - otherwise `null`, including when more than one anchor matches. There is no edit-distance
     fallback; spelling changes other than hyphen runs receive no suggestion.

   The broken line becomes `from → target (did you mean #stage-3-the-dashboard? Differs only in
   consecutive hyphens; this checker turns a run of spaces into ONE hyphen)` when there is a unique
   match. Otherwise it stays `from → target`.
2. **The `slug()` doc comment stops claiming to be GitHub's rule** and says where it differs.
3. **One bullet in `docs/reusable/write-planning-doc.md`**, under References, showing the checker's
   single-hyphen anchor for a heading with a spaced em dash and saying the test suggests it when
   the match is unique.

## What does not change

- **The slug rule itself.** Whether the repo should match GitHub (or accept both forms) is a
  separate question: switching would break the thousands of existing single-hyphen links, and
  accepting both would let two spellings of one anchor coexist. It goes to Greg as a question in the
  debrief, not into this change.
- **`scripts/plan-name.ts`.** The queue item marks printing the roadmap anchor form as optional. A
  script that names files is the wrong place to learn about anchors, and with the fix in the error
  message it adds a second home for the same fact. Passed over.

The simpler option passed over: only the doc line, no code. A sentence in a doc agents may not read
is what we already had in effect; the error message is read by exactly the agent who made the
mistake, at the moment they made it.

## Stage 1 (the only stage)

- Tests first, in `tests/doc-links.test.ts`, seen red: `suggestAnchor` on the em-dash case, a typo
  case, a no-match case, an ambiguous hyphen-run case; and one test that the message for a broken
  link built from a real heading with an em dash contains the single-hyphen anchor.
- Implement; `npm test` for that file, `npm run typecheck`, lint on the file.
- Mutation check: break `suggestAnchor` and confirm the new tests go red.
- GPT Sol code review; commit; push to `dev`.

Done means: a link written `#a--b` to a heading `A — b` fails with a line that names `#a-b`.

## What the plan review changed

GPT Sol's review is [261006g-…-review-sol.md](261006g-doc-links-names-the-anchor-you-meant-review-sol.md).
All four findings accepted:

- **F1 (P1)** — two anchors that differ only in hyphen runs: return nothing, and do not fall through
  to a guess. Done, with its own test.
- **F2 (P2)** — the edit-distance fallback is **cut**. `#overview-2` would have been pointed at
  `#overview-1`, and a wrong suggestion taken on trust is a link that passes the test and goes to
  the wrong place, which is the failure the test exists to stop. Only the exact hyphen-run match
  ships. A typo'd or stale anchor gets the same bare line it always did.
- **F3 (P2)** — the message says "differs only in consecutive hyphens" and "this checker", since the
  candidate may be an explicit `<a id>` rather than a heading.
- **F4 (P3)** — the doc line says "this repo's link checker expects", not that the anchor *is* so.

## What landed

- Seen red twice: first on `suggestAnchor is not defined`, then, after the review, on the revised
  expectations against the fuzzy version.
- Shown on a real tree by temporarily adding a link to
  `overseer-direction.md#a-higher-bar-for-robustness-here-than-elsewhere--and-its-ceiling`: the
  failure line named the single-hyphen anchor.
- Mutation: `=== 1` → `>= 1` in `suggestAnchor` turns the ambiguity case red.
- Code review strengthened the controls: collapsing only the first repeated hyphen run and also
  ignoring letter case both passed the original test. Multiple runs in both inputs and a
  case-sensitive explicit-id case now reject those mutations. The message is shorter and its full
  line is pinned, including for a literal id and for ambiguity with no suggestion.

## The code review

GPT Sol's is [261006g-…-code-review-sol.md](261006g-doc-links-names-the-anchor-you-meant-code-review-sol.md):
approve, no P0 or P1. It fixed four things itself, all kept — tests for two mutations that had
passed (collapsing only the first run; ignoring case), a shorter failure line, this plan's stale
promise of the fuzzy fallback, and the doc bullet saying a suggestion comes only when the match is
unique. Gates at commit: `tests/doc-links.test.ts` 17 passed; `npm run typecheck` has one error, an
unused `writtenAsB` in `tests/feedback-dialog-has-its-reader.test.tsx`, which arrived on `dev` with
261006f and is not this change's. The full suite was not run: the change is confined to this one
test file and a doc.

## Open, for Greg

F4's substance is wider than this item. The checker's rule and GitHub's disagree on 6,176 headings,
and the repo's links follow the checker — so a link to an em-dash heading that is green here lands
at the top of the page when the doc is read on GitHub. Nothing in this change alters that.
