# Stage 1 code review: Reception's default-collapsed layout

Plan: [261020n](261020n-sources-reception-layout-and-a-sources-chat-sub-mode.md).

Verdict after fixes: **pass**. The main shape is sound: *Every page* is open and
contains every stored Reception row for both owners and visitors; Reception's chip, *Every page*
and the `(i)` use the same stored-row population; Claims still applies its relevance and thread
filters; Claims-only themes do not enter Reception; the AI frame and voices are present; outbound
links keep `noreferrer noopener`; and the row disclosure is a named keyboard button with
`aria-expanded` and `aria-controls`.

## Findings

### F1 — medium — a valid deep link stops working after a stale id

**Evidence:** `src/web/ReceptionAndClaimsPanel.tsx:1288-1293`; the stale-id test at
`tests/reception-and-claims-panel.test.tsx:3090-3097` starts from a fresh panel only.

`appliedThread` remembers the last section successfully opened. A later stale parameter returns
without clearing it. If the address then changes back to that valid id, the equality guard treats
the value as already applied, so the section is not reopened and the list is not scrolled. This
breaks the plan's “on every later change” rule. The missing transition test lets it pass.

**Fixed:** yes. A missing section clears the previously applied id without consuming the current
value, so a return to an older valid id reapplies it and a late search can still satisfy the same
parameter. The valid → stale → valid regression failed against the old lines and passes now.

### F2 — medium — an unknown stored relation escapes the fixed AI vocabulary

**Evidence:** `src/web/ReceptionAndClaimsPanel.tsx:888-893` and
`src/web/ReceptionAndClaimsPanel.tsx:3453`.

The new closed-row helper falls back to rendering an unchecked stored `relation` verbatim, while
the open AI line also renders `row.relation` directly. Known relation words are fixed UI copy and
therefore correctly use the UI face; an unknown JSONB value is model-written or hand-written text,
so drawing it verbatim in that face breaks the voice rule and lets the closed and open forms
disagree. The stored reader should conservatively map an unknown value to the existing honest
member, `unclear`, in both places.

**Fixed:** yes. Both row states now read the stored value through one defensive normaliser and use
`unclear` for anything outside the fixed vocabulary. The regression failed against the raw stored
value and passes now.

### F3 — medium — a closed row can be three lines before metadata wraps

**Evidence:** `src/web/styles/reception.css:511-520` keeps `-webkit-line-clamp: 2` on the title,
while `src/web/ReceptionAndClaimsPanel.tsx:3222-3225` and plan 261020n specify one title line and one
metadata line until the row is opened.

The old two-line title clamp survived the redesign. A long closed title can therefore occupy two
lines before the site/year/AI line begins, contradicting the at-a-glance two-line row this stage is
for. Opening the row already removes the clamp, so the closed clamp should be one line.

**Fixed:** yes. The closed clamp is one line; opening the row still removes it. The CSS assertion
failed with the old two-line clamp and passes now.

### F4 — low — claim-check findings reach the changed `Row` without a regression test

**Evidence:** `src/web/ReceptionAndClaimsPanel.tsx:2991-2997` sends claim-check findings through
`Rows`; `tests/reception-and-claims-panel.test.tsx:3234-3248` tests only legacy
`reception.claims.rows`.

The implementation is shared and currently puts `bears` on a claim-check row's closed AI line, but
the touched suite would stay green if `CheckFindings` stopped doing so or began showing
`relation` instead. This is one of the two Claims paths the review brief names explicitly.

**Fixed:** yes. The panel test now supplies a completed claim check and asserts that its finding
shows `bears directly`, not `relation`, on the closed line and keeps `bears` in the opened AI line.

### F5 — low — reader-facing help and comments still describe the removed layout

**Evidence:** `src/web/help/pages/modes/sources.md:133-134` says all sections start folded even
though *Every page* starts open; `src/web/reception-levels.ts:38` says the removed identification
chip remains; `tests/reception-and-claims-panel.test.tsx:35-37` still names that chip as the row's
visible identification.

These contradictions make the new default and the row contract harder to verify, and the Help's
first sentence disagrees with its own *Every page* bullet. Say exactly which sections start folded
and update the two stale signposts.

**Fixed:** yes. The Help now names the sections that start folded and says *Every page* starts
open; the generated Help corpus was rebuilt; the two stale code/test signposts were corrected.

### F6 — low, wider — the panel remains far above the complexity advisory

**Evidence:** scoped Biome lint reports cognitive complexity **72** at
`src/web/ReceptionAndClaimsPanel.tsx:1168` (limit 25), and **34** in the unrelated
`OwnerListedClaims` at `src/web/ReceptionAndClaimsPanel.tsx:2715`.

This is the older panel's accumulated orchestration rather than complexity needed by the section
layout itself. Extracting the whole controller during a layout review would be a wider, high-churn
refactor; the new section selectors and drawing components are already separated from it.

**Fixed:** no — reported as wider than Stage 1.

## Checks

- The exact targeted Vitest command from the review brief: **8 files passed, 479 tests passed**.
- The three behavioral regressions, temporarily run against the old faulty lines: **3 failed**;
  after restoring the fixes, those three plus the claim-check path: **4 passed**.
- Help corpus regeneration/check: **1 file passed, 7 tests passed**.
- `npm run typecheck`: the `tsx` launcher was unable to create `/tmp/tsx-1000/14.pipe` in this
  sandbox (`EPERM`), before the checking script started. Running the same guarded script as
  `node --import tsx scripts/typecheck.ts` passed all four projects — web **666 files**, tests
  **3,634**, fleet web **108**, node **1,141** — and confirmed all **3,859** source files are owned
  by a project.
- Scoped Biome lint: no errors; two existing complexity infos and two existing advisories
  (`useOptionalChain`, descending specificity) remain wider than these fixes.
