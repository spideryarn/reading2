# Code review findings: 261006k

F1 — The user-feedback note and the phone reference doc overstate an unreproduced diagnosis, and
the note repeats the plan-review claim that buttons stayed at their own size even though the
inflated Skim text is itself inside a button. The evidence supports “the measured pattern strongly
fits Safari text autosizing”; it does not support “this is Safari text autosizing” for every such
case or a button exemption. **Action:** narrowed those sentences to the observed short labels, kept
the diagnosis explicitly at strong-inference confidence, and made the source comment equally plain.

F2 — `DECLINED_HTML` does not yet hold six actual decisions, as the test says it does. The `tab-size`
reason says the only tabs drawn are in an article's `<pre>`, but the app also draws model code blocks
and other `<pre>` surfaces. The tap-highlight reason explicitly says “undecided”, while the test's
purpose is to ensure a decision was made; the two font-settings entries say only that no bug was
seen. **Action:** replaced these with codebase-specific decisions: retain the browser's tab width
for preserved-whitespace content, do not copy Tailwind theme font settings because this app owns its
font families and defines no corresponding theme settings, and retain Safari's native tap feedback
because the app does not provide a pressed state for every interactive element.

F3 — `htmlProps` says it recognizes a selector list that names bare `html`, but
`s.trim().split(/\s+/).pop() === "html"` also accepts a descendant selector such as `.shell html`.
That could let a future preflight property count as covered by a rule which cannot match the root
element. The exact text-size assertion happens to catch today's property separately; the generic
check remains weaker than it claims. **Action:** required a selector-list member to equal `html`
exactly.

F4 — The test's introductory comment was only partly updated for the fourth incident: its lower
paragraphs still say all three incidents were about buttons and that the checklist is buttons-only.
That is now false and obscures why `DECLINED_HTML` exists. **Action:** updated the comment to
describe both covered elements and all four incidents.

F5 — The feedback note says the fix is already on `dev`, but the branch-containment check for
`c05cde802` currently lists only this review worktree; `origin/dev` is at `e4d1e92bd`. **Action:**
no file change in this review, because the statement becomes true atomically when the reviewed
stage is pushed and this reviewer was expressly told not to push. The stage owner must not call the
report finished unless that push succeeds.

F6 — The plan still says `grep -r text-size-adjust src/web styles` “is empty”, in present tense,
even though this stage adds the match. The controls reference similarly says “we set nothing” and
then says the rule now exists. **Action:** put both claims explicitly in the before-change past
tense.

F7 — The plan says the test file gains “two checks”, but the commit adds three: coverage of every
preflight `html` property, the exact `100%` values, and stale-decline detection. **Action:** named
all three checks.

F8 — The full-scale option says “all 566 rules” would move, but 566 is the count of `font-size`
declarations, including `inherit` and already-tokenized values; it is not a count of CSS rules or of
edits. **Action:** said that all 566 declarations must be audited and the numeric choices moved
onto the designed scale, and called the smaller option's estimate declarations rather than rules
too.

## Verification

- The client build emits the WebKit, Mozilla and unprefixed `100%` declarations on bare `html`
  inside `@layer base`, before `@layer app` and utilities.
- Mutation checks all failed as intended: changing the selector to `html.foo`, moving the rule to
  `@layer app`, changing both values to `auto`, and deleting `line-height` from `DECLINED_HTML`.
  The stale-decline check also failed when `line-height` was both set and still declined.
- `npx vitest run tests/preflight-substitute.test.ts tests/doc-links.test.ts`: 23/23 passed.
- The exact `npm run typecheck` and the `tsx` half of `npm run build` cannot open the CLI's Unix
  socket in this sandbox (`listen EPERM /tmp/tsx-1000/*.pipe`). Running the same TypeScript entry
  points with `node --import tsx` passed; the client build, static-page build, and API build all
  completed.
- The six plan-review findings are applied. The corrected audit counts are internally consistent,
  and both versions of the question for Greg explain the examples, scope, cost, and recommendation
  without requiring code knowledge.
