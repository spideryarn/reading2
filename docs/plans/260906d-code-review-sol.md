Verdict: **refuse**. F11–F14 are established P1 contract failures. I found no evidence that the committed 37-way split changed today’s compiled cascade, but its guards are weaker than claimed.

### F11 — P1 — established: `SPENDS` misses three paid Diagram paths

[DiagramPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/src/web/DiagramPanel.tsx:869) says Force spends through `POST /api/similar`; Drift and Trail spend through `POST /api/projection`. Yet [activation.ts](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/src/web/activation.ts:373) says those three cost nothing, and `SPENDS.diagram` exercises only Sketch and Illustrated.

(a) I added `?diagram=force` to the delegated cases. The sweep stayed green because its recorder captures only `/api/jobs` and discards every other mutation at [the test harness](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/every-mode-draws-its-surface.test.tsx:501). Once `/api/similar` was recorded, the same test failed with paid Diagram POSTs. Thus an existing mode already spends outside the supposedly exhaustive money contract.

(b) Cover all five `DiagramKind` values and record/assert paid direct POSTs as well as jobs. Under the stated click-only rule, gate Similar and Projection through activation; otherwise narrow the contract’s name and claims, and correct the false “cost nothing” prose.

### F12 — P1 — established: Phase A cannot see latent activation tokens

The sweep observes immediate jobs, not what `armActivationForMode` actually left armed.

(a) I changed Plain’s production row from `none` to `{ kind: "fixed", target: "ideas" }`. Its “spends nothing” test passed. No Ideas panel is mounted, so the token remains unclaimed; a later unpressed Ideas mount can consume it. A delegated row can likewise arm its expected target plus an extra paid target without changing the immediate expected POST.

(b) After every scenario, assert that no activation token remains pending across an exhaustive `AutoRunTarget` set. Better still, make delegated rows return `AutoRunTarget | null` and let `armActivationForMode` perform the sole arm centrally.

### F13 — P1 — established: both positive tables admit empty witnesses

The types do not enforce the non-empty promises in their comments.

(a) `delegated.presses` and `posts.steps` are ordinary arrays at [lines 675–685](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/every-mode-draws-its-surface.test.tsx:675). I changed Diagram’s production arm to a no-op and its test row to `presses: []`; the named test ran zero presses and passed. Likewise, `DRAWS.says` is a plain string and `toContain("")` succeeds for an empty band or unrelated chrome.

(b) Use non-empty tuple types for positive spend cases and assert outside the loop that at least one case ran. Assert `row.says.trim() !== ""` before the presentation check.

### F14 — P1 — established: a hidden band counts as readable

[`readable()`](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/every-mode-draws-its-surface.test.tsx:654) removes hidden descendants, but does not inspect the selected band or its ancestors.

(a) I added `hidden` to the real Quotes `<aside>`. Its Phase B test still passed while the entire surface was unavailable to readers. `aria-hidden="true"` has the same hole.

(b) Before cloning, reject an element beneath `el.closest('[hidden], [aria-hidden="true"], [class~="sr-only"]')`; then keep the descendant filtering.

### F15 — P2 — established: the manifest guard erases import order

[The inventory assertion](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/styles-entry-is-imports-only.test.ts:136) sorts both actual and expected imports.

(a) Moving `glossary.css` after `timeline.css` and `debate.css` leaves all four guard tests green. That reverses known equal-specificity `.gloss-quiet` versus `.tl-thin`/`.dbt-empty` overrides.

(b) Compare against an independently written ordered manifest, not sorted directory contents.

### F16 — P2 — established: the manifest accepts live imports outside its contract

The node check uses `startsWith("@import")`, while the inventory silently ignores anything outside `./styles/` and ignores import qualifiers.

(a) All guard tests stayed green for:

- an external `@import "https://…";`
- `@import "../../styles/rogue.css";`
- `@import "./styles/table.css" print;`
- even `@important;`

The second import is omitted by `readerSheets()`; the third makes the table rules print-only.

(b) Require the exact first brand-token import and exact bare `@import "./styles/<file>.css"` nodes thereafter, with no suffixes or other paths.

The deliberate root-token exclusion is defensible once this whitelist exists. Without it, live CSS can be imported outside `src/web/` and hidden from every migrated `readerCss()` test.

### F17 — P2 — established: the import resolver is neither positional nor duplicate-preserving

[`walk()`](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/helpers/stylesheets.ts:73) visits every child before emitting the whole parent and uses one global `seen` set.

(a) Appending a late `@import "./spine.css"` to `table.css` left 19 relevant tests green. The helper hoisted one Spine copy before Table and discarded the manifest’s later Spine import; Tailwind emitted Spine twice and grew the compiled output.

(b) The simplest closure is to forbid relative imports below `styles.css` and duplicates. Otherwise emit source chunks at each import position and use an active-recursion set only for cycles.

### F18 — P2 — established: the new aimed-column vacuity guard accepts dead selectors

[The body regex](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/aimed-column.test.ts:85) permits arbitrary selector suffixes before `{`; `ruleFor` merely searches for the substring.

(a) Adding `.never` to every `.reader[data-aim="N"]` selector left all three tests green, although none can match the DOM.

(b) Parse the complete selector list with a delimiter immediately after `]`, or exercise the selectors against representative DOM.

### F19 — P2 — established: the hue guard proves only the maximum

[The hue assertion](/home/greg/code/spideryarn2/.claude/worktrees/a10-style-ownership/tests/annotate.test.ts:557) checks that some match exists and `Math.max(...) === BAR_HUES`.

(a) Deleting complete rules 1–7 while retaining rule 8 left all 50 annotate tests green. Appending `.never` to all eight selectors also passed.

(b) Match through the rule opener and require the sorted unique values to equal every integer from `1` through `BAR_HUES`.

The isolated committed baseline passed the two requested suites: 32/32 tests. The 900-line owner sweep took about 20 seconds and its current populated literals are otherwise sound; its size is not a finding. Nor are `narrow-window.css` or the nine deliberately unmoved sections—the contiguous no-op constraint justifies both. No repository files were changed.