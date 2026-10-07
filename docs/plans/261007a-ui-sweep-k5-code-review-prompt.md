# Review: UI sweep cluster K5 — the threshold slider and the order row, one set of rules each

Echo this nonce on the first line of your answer: **K5-ONE-RULE-3H8V**

Repo: this worktree (`/var/tmp/spideryarn-worktrees/agent-a9c5866f16a8fec1a`), a branch off `dev`.
TypeScript + ESM, React, hand-written CSS under `src/web/styles/`, all of it imported by
`src/web/styles.css` in a fixed order and landing inside `@layer app`; Tailwind v4 utilities
prefixed `tw:` sit in a later layer. Read `docs/project/design-css-overview.md` for the map and
`docs/project/web-client.md` § "Never delete a semantic class name".

## The candidate

One commit, `28713c72a`, on base `434e03141`.

    git diff 434e03141...28713c72a
    git diff --stat 434e03141...28713c72a     # the complete list of changed paths

Start with `src/web/styles/glossary.css` (the order row and the slider, now the only copy of
each), `quotes.css`, `debate.css`, `narrow-window.css` § a coarse pointer, then the three panels
(`QuotesPanel.tsx` § `RankBar` and `BarSlider`, `SearchPanel.tsx` § `ConfSlider`,
`DebatePanel.tsx` § `StopBar`), then the six tests. That is where to begin, not the limit of
scope; the diff is.

## What it is meant to do

The specification is `docs/plans/261007a-ui-sweep-umbrella.md` § K5, K5's line in its File
manifest, and § What the review changed (U17 and U18 are your own plan-review findings). What was
built and measured is in
`docs/plans/261007a-ui-sweep-k5-threshold-slider-and-order-row-one-class-set.md`. **Read that doc
as a reviewer of its conclusions, not only of the code**: it makes a claim about what a reader
sees, and about which of the umbrella's statements were not so.

In one paragraph: the slider's ten rules existed four times (`.gloss-gate*`, `.srch-gate*`,
`.quotes-bar*`, `.dbt-bar*`) and the order row's eight twice (`.gloss-sort*`, `.quotes-rank*`).
Quotes, Search and Debate now emit the glossary's class names and their copies are deleted.
Debate's value is words, so its span carries `in-words` and
`.gloss-gate-value.in-words { font-family: inherit; }` gives it the face it had. No component is
merged. Search's order row (`.srch-sort*`) is untouched.

**The invariant: nothing a reader sees changes.** Not in any band, theme, width, pointer type or
state. The claim the plan doc actually makes is narrower, "no difference in the measured matrix",
and it lists what the matrix does not reach.

## The evidence, which you can read and partly re-run

- `docs/plans/261007a-ui-sweep-k5-measure.ts.txt` and `…-measure-lib.ts.txt`: the Playwright
  script. It needs a browser and a dev server, which you do not have, but its `compare` mode needs
  neither:

      cp docs/plans/261007a-ui-sweep-k5-measure.ts.txt /tmp/k5-measure.ts
      node --import tsx /tmp/k5-measure.ts compare docs/plans/261007a-ui-sweep-k5-measure-before.json.gz docs/plans/261007a-ui-sweep-k5-measure-after.json.gz

  (`compare` does not import the lib.) It prints `0 difference(s) over 76084 compared values`.
  The two `.json.gz` files are the compact output: 28 scenes (seven bands by four cells), 292
  state captures, 2,112 element records each; per element 74 named computed properties in clear, a
  hash over every computed longhand, the bounding rectangle, the scroll sizes, the own text and
  the matched pseudo-classes. `gunzip -c` one and read it.
- `docs/plans/261007a-ui-sweep-k5-census.mjs.txt`: PostCSS over the source sheets
  (`node <copy>.mjs src`) or a built file (`… built <file> --canon`). Copy it to a `.mjs` first.
  `…-k5-built-rest.mjs.txt` lists every other rule of a built file in order. On the two builds the
  first differs in one line (the modifier) and the second in none (3,383 rules). `dist/` in this
  worktree is the build of the candidate; I have no copy of the base build in the repo.
- `docs/plans/261007a-ui-sweep-k5-mutate.py.txt`: fourteen mutations, each red in the test named.

## What you can and cannot run, and what you may change

You may edit this worktree. **Fix what is inside this cluster, narrowly and red-first, and
report, do not fix, anything wider** (a component merge, Search's order row, a doc whose wording
is a rule, another cluster's files). If a fix of yours changes a stylesheet, say so plainly at the
top of your answer: the browser measurement will have to be run again, and you cannot run it. Do
not commit. List every file you changed at the end.

You have no network, not even loopback, so no browser, no dev server and no database. Run a single
test file with `npx vitest run tests/<one>` or a script with `node --import tsx <script>`. Useful
ones: `tests/touch-controls.test.ts`, `tests/glossary-band-wiring.test.ts`,
`tests/debate-panel.test.tsx`, `tests/quotes-and-citations-compact-header.test.tsx`,
`tests/quotes-yours-rows.test.tsx`, `tests/search-results-get-the-room.test.tsx`,
`tests/threshold-slider-adopters.test.tsx`, `tests/order-group.test.tsx`,
`tests/mode-surface-changes-no-markup.test.tsx`, `tests/styles-entry-is-imports-only.test.ts`,
`tests/doc-links.test.ts`. Do not run the whole suite.

## Attack it

Independently, before you read my suspicions below. The invariant to break: find an element, a
band, a theme, a width, a pointer type or a state in which a merged rule resolves differently from
the copy it replaced.

Answer these directly, each with a yes or no and the evidence:

1. **Does any change alter what a reader sees?** For Quotes the rules moved from `quotes.css`
   (imported after `narrow-window.css`) to `glossary.css` (before it); for Debate, from
   `debate.css` to `glossary.css`; for Search's slider they did not move. Name any rule anywhere
   in the cascade (source order, specificity, a `:has()`, a sibling or child combinator, a
   `:first-child`, an attribute selector, a Tailwind utility on the same element) that now wins or
   loses on one of these elements where it did not before. Check the old class names were not
   load-bearing anywhere else: a selector, a `querySelector`, a `closest`, a script under
   `scripts/` or `e2e/`, the fleet dashboard, a doc.
2. **Is there any state or viewport outside the measured matrix where the merged rules could
   resolve differently from the copies?** The plan doc's § What the matrix does not reach is my
   list; what is missing from it, and is anything on it more than a formality?
3. **Does the dedup earn its keep, or does it only move duplication?** 240 stylesheet lines out
   and 65 in, for which three panels' JSX now carries another band's class prefix (`gloss-gate` in
   Search). Is naming the shared control after the glossary the right call against a neutral name,
   given what a rename would have touched? Would you have left the copies?
4. **Is the Debate modifier one flag too many?** The alternatives were a contextual rule
   (`.dbt .gloss-gate-value`) and leaving Debate's value rule alone under its old class. Is
   `font-family: inherit` exactly what "no `font-family` declared" computed to, in every context
   this span can be in?
5. **Was it right to drop the old class names from the elements**, given
   web-client.md § "Never delete a semantic class name"? The reading taken: that rule protects
   names code reads from the DOM, and nothing in `src/` read these.
6. **Is the measurement sound as evidence?** Read the script. Could it report zero while a reader
   sees a difference: an element it does not capture, a state it believes it reached and did not,
   a property the hash cannot see, the delta encoding hiding a change, `compare` skipping
   something besides `cls`? Is the injected Debate order row a fair stand-in?
7. Is each statement in the plan doc's § What in the umbrella or the brief was not so accurate?
8. The one new test case (`tests/debate-panel.test.tsx`, the value's face): does it earn its
   place, and is its statement true at its strength?

For each finding give:
  - an ID (`K5-F1`, `K5-F2`, …), a severity, and whether it is established or reasoned
  - (a) what shows it fails its own claim: the input or mutation I can run, or the rule and
    selector that demonstrates it
  - (b) the smallest change that closes it, and whether you made it
A finding with no (a) goes last.

Severity, by consequence:

| | |
|---|---|
| **P0** | data loss, exploitable security, incorrect charging, or the service broadly unusable |
| **P1** | user-visible wrong behaviour, or an authoritative contract violated |
| **P2** | design or maintainability risk with no wrong behaviour today |
| **P3** | non-behavioural prose or comment defect |

For this cluster, **any visible difference to a reader is a P1**: the whole claim is that there is
none. Refuse only on an established P0 or P1, and name what established it. End with one line:
`VERDICT: ready` / `ready with these fixes` / `not ready`.

Do not invent a quotation from Greg in any doc or comment you edit.

## My own suspicions — read last

These are already my doubts, so confirming them is worth less than anything you find yourself.
Spend most of the run elsewhere.

- The sentence I would least like to be wrong about: **"for Quotes and Debate the rules moved
  earlier in the cascade and no rule of equal weight sits between the old place and the new on the
  same element and property."** I argued it and then measured it; the measurement covers the
  states in the matrix only.
- Debate's order row was measured on injected markup, because no stored debate on this box draws
  it. Its classes did not change, so I think this is the least risky gap, not the most.
- `:active` in the touch cells was produced with mouse events. On a real finger the pressed
  state is the same rule; I have not seen it.
- The hash over all longhands is taken over names sorted, after the first repeat run showed
  Chrome lists custom properties in a changing order. If two elements could differ only in the
  *order* of something meaningful, the hash would not see it. I do not think CSS has such a thing.
- `glossary.css`'s comment about why the touch-screen one-line rule lives there was rewritten. Is
  what it now says true?
- The compact file's delta is against `rest` (or `moved-rest`). If `rest` itself were captured
  before the band had finished laying out, both runs would agree on a wrong picture. The repeat
  run agreeing is my only evidence against that.
