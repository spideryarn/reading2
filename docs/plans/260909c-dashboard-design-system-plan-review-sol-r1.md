Reviewed revision `af0b6928` only. I found no P0, but I would revise the plan before implementation: three P1s materially affect scope or sequencing.

## Ranked findings

### P1(1) — The diagnosis identifies a real symptom, but mistakes it for the main cause

Plan: [“What design system means here”](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/docs/plans/260909c-dashboard-design-system-research-a-reusable-ui-ux-prompt-then-apply-it-usage-limits-first.md:37), [Stage 6](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/docs/plans/260909c-dashboard-design-system-research-a-reusable-ui-ux-prompt-then-apply-it-usage-limits-first.md:167)  
Code: [UsagePanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/UsagePanel.tsx:506), [tailwind.css](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/tailwind.css:236)

The narrow type band is real. Within `UsagePanel` specifically I counted:

- `13px` ×16, `12px` ×9, `11px` ×2.
- `text-ink-faint` ×16 and `text-ink-soft` ×9.
- The verdict `<h2>` has no explicit size, so it inherits the 15px body size; most supporting text is 13px. That is only a weak hierarchy.

But the stronger cause is form and information architecture:

- The file contains 17 `<p>` sites, four heading sites, several nested lists, and one continuous published-reading card.
- The primary answer at [lines 527–550](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/UsagePanel.tsx:527) is immediately followed by account identity, two clocks, reasons, rejection provenance, coverage, cache provenance and window validity.
- The component’s own header says the question is “can this account afford more work?”, but the rendering is a careful evidentiary document rather than a decision display.

The ink census does not prove its claimed cause. A majority of quiet text can be good hierarchy if it is genuinely secondary. Here it more strongly indicates that most of the visible page is secondary material. Making those paragraphs quieter will not make the yes/no, percentage and reset time sufficiently easy to find.

Reframe Stage 6 from “restyle” to “rewrite the information hierarchy”:

1. A decision block: available / limited / approaching / cannot tell.
2. The one valid number and next reset time, when they exist.
3. Any caveat that changes that decision immediately adjacent.
4. Provenance, old incidents and secondary clocks progressively disclosed.

The type/emphasis scale is necessary, but it is not sufficient.

### P1(2) — Stage 5 has the right priority but is not yet a buildable stage

Plan: [Stage 5](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/docs/plans/260909c-dashboard-design-system-research-a-reusable-ui-ux-prompt-then-apply-it-usage-limits-first.md:155)  
Prior proposal: [items 1 and 2](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/docs/plans/260909b-unstarted-dashboard-ideas-screenshots-and-fable-product-input-on-the-session-detail-view.md:318)

Putting the landing surface ahead of Usage is not the agent substituting its own taste. Greg’s later acceptance test explicitly makes the three fleet-wide questions the higher-order requirement.

The problem is that Stage 5 postpones its feasibility work until inside the build stage: “say what data exists and what is missing; design and build it.” At this revision:

- “Needed from me” is supported well by `attention`, including scan coverage, unreadable sessions and staleness.
- “Where things stand” is supported only coarsely by `tally`: need-you / working / quiet / unknown. [The existing tally](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/view.ts:236) has no progress or direction measure.
- There is no live, complete “blocked” predicate. `FleetStatus` has no `blocked` arm. `Pause` distinguishes rate limits, scheduled wakeups, background work and unknown evidence, but those do not collectively mean “all blockers.”
- The Overseer register carries historical status strings but deliberately cannot join them to current rows without continuity evidence.
- Last-written, last-commit and last-push—the useful “where does this stand?” signals—are explicitly described by the prior proposal as missing from the list data.

Also, absorbed items 1 and 2 change selected-session detail. They are worthwhile, but neither constitutes a landing surface answering the fleet-wide questions.

Split the stage:

- Stage 5a: define each question, its supported answer, completeness condition, and honest non-answer; produce a 390px wireframe.
- Stage 5b: build only after that evidence review.
- If Stage 5a shows the landing implementation still needs other sessions or new collection work, let the bounded Usage rewrite be the first code pilot rather than allowing the entire design-system job to wait.

So: landing-first as product priority is defensible; landing implementation before its data contract is not.

### P1(3) — “Re-check every state by name” is not a fail-capable safety check

Plan: [honest-absence constraint](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/docs/plans/260909c-dashboard-design-system-research-a-reusable-ui-ux-prompt-then-apply-it-usage-limits-first.md:76), [Stage 6 check](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/docs/plans/260909c-dashboard-design-system-research-a-reusable-ui-ux-prompt-then-apply-it-usage-limits-first.md:167)  
Existing tests: [fleet-usage-card.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tests/fleet-usage-card.test.tsx:276)

The states most likely to be visually demoted or accidentally flattened are:

- `limits.kind === "none"` versus `"unknown"`, especially the visible coverage and its `unreadable`, `malformed` and `TRUNCATED` qualifiers.
- A typed `expired` cache window and a formerly live `value` window whose reset passes while the page is open: neither may display its percentage.
- An unattributed cache after `/login`: it must display no percentages.
- A historical `limited` verdict whose attributed reset has passed: it must say cleared/history, not retain live alarm treatment; its producer reasons need past-tense framing.
- An unreset but unattributed incident: it may say “has not reset,” but only the producer-attributed incident may look like the active block.
- A future or unreadable `collectedAt`: it must look stale/unknown, never fresh.
- The distinct outer absences: `not-asked`, `no-report`, `report-unreadable`, checkpoint absent/unreadable, unsupported schema and feed unreadable. Only `usage === null` may disappear.

The current unit suite is unusually good: it already fails on lost strings, resurfaced expired percentages, missing coverage, misbadged incidents and collapsed absence arms. But it stays green if a redesign puts the coverage in a closed disclosure, makes an unknown caveat 10px faint, or pushes the actual answer below the phone fold.

A proportionate check would be:

- Keep the existing semantic state matrix.
- Give the decision, valid number/reset and decision-changing caveat explicit semantic regions or `data-*` roles.
- Add one browser fixture test at 390px with representative `limited`, `ok-with-coverage`, `expired/unattributed`, and `unknown/stale` states.
- Assert relational invariants rather than pixel snapshots: the verdict and applicable reset are visible in the first viewport; no critical region has a hidden/closed ancestor; the verdict’s computed font size exceeds provenance text; unknown/error text is not assigned the quietest role.
- Keep the existing negative assertions that expired or unattributed percentages do not appear anywhere.

A snapshot of every computed style would be brittle. A small browser test of those relationships is worth having for this private ops page.

### P2(1) — The type census arithmetic is wrong, and the per-tab conclusion is unmeasured

Plan: [census](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/docs/plans/260909c-dashboard-design-system-research-a-reusable-ui-ux-prompt-then-apply-it-usage-limits-first.md:49)

Re-running the supplied command at both `af0b6928` and the cited `447d70f4` produced:

```text
156  text-[12px]
149  text-[13px]
 41  text-[11px]
  3  text-[10px]
  2  text-[15px]
  2  text-[14px]
  1  text-[22px]
  1  text-[17px]
```

That is 355 arbitrary-size utilities total, of which 349—not 355—are 10–13px. There are also seven `text-xs` and six `text-sm` utilities that the supplied census does not count.

The ink counts are exact: 177 faint, 129 soft, 69 ink.

Also, [mode.ts has eight modes](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/tools/fleet/web/src/mode.ts:35), while the plan claims the problem is on “all seven tabs.” The global grep does not establish a per-tab result anyway; the Stage 1 per-tab measurements remain unchecked.

The broad observation survives, but the stated measurement should be corrected and described as a source census, not rendered-screen evidence.

### P2(2) — Keep the reusable document, but make it an actual runnable prompt

Plan: [Stage 3](/home/greg/code/spideryarn2/.claude/worktrees/dashboard-design-system/docs/plans/260909c-dashboard-design-system-research-a-reusable-ui-ux-prompt-then-apply-it-usage-limits-first.md:140)

The document is not ceremony because Greg explicitly requested a reusable prompt. It becomes ceremony if it is only a checklist.

The smallest useful version should ask an agent to consume:

- Purpose and user questions.
- Screenshots at named widths.
- State inventory and honest absences.
- Measurements and available data.

And require a structured output:

- Main decisions the screen supports.
- Ranked obstacles with screenshot/code evidence.
- Proposed primary/secondary hierarchy.
- Material to remove, collapse or move.
- Claims the data cannot support.
- Checks that could fail after implementation.

That can be a short Stage 3, or the output half of Stage 2. It should avoid restating the fleet-specific operational material already in `docs/reusable/agent-fleet-dashboard.md`.

### P2(3) — Several plan facts are still only intentions

The following have not been demonstrated in `af0b6928`:

- The screenshot harness and frozen API capture live only in a scratchpad; no screenshots or harness evidence are committed at this revision, so I could not verify the “data cannot move” claim.
- “One screenful” has no measurable acceptance criterion and no policy for an attention list containing several cards.
- Stage 5 can answer all three questions from current data; the code supports only narrower answers described above.
- “The cost of the general version is one stage: the doc.” The plan itself adds research, full-screen measurement, Sol analysis, shared primitives, two pilot surfaces and every remaining tab.
- The same typographic problem exists on every tab; the per-tab measurements intended to establish this have not been completed.

## Smallest version with most of the value

I would use this order:

1. Finish Stage 1 measurements.
2. Combine research and the concise runnable prompt.
3. Have Sol rank the existing screens and critique the proposed Usage/landing hierarchies.
4. Do the Stage 5 data-contract and wireframe audit, without committing to its build yet.
5. Rewrite Usage as the first end-to-end design-system pilot, including the honest-absence tests above.
6. Build the minimal landing summary from only supported data; state unknown coverage rather than inventing a generic “blocked” count.
7. Stop and reassess before mechanically restyling every remaining tab.

The plan is otherwise sound on fixture isolation, phone and desktop coverage, light/dark coverage, preserving one canonical `UsageCard`, resisting more status colour, and treating Greg’s three questions as the acceptance test. The main correction is to make information hierarchy—not merely typography—the thing being designed and tested.