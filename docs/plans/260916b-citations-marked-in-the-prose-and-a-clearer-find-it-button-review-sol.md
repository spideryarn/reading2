The plan is broadly right, with no P0 blockers. The main architecture—citation marks as a fifth annotation kind, the shared prose hover card, avoiding `Found`, and marking all verified works—is sound. I found six P1 corrections and two P2 decisions worth tightening before construction.

1. **P1 — The “first rendered occurrence” conclusion is too strong, and the proposed resolver cannot currently implement it.**

   [`verifyPlace`](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/citations.ts:244) does omit `near`: both the named-block path at [line 262](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/citations.ts:262) and relocated-block path at [line 272](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/citations.ts:272) choose the first spaced match. The relocation check establishes uniqueness across blocks, not uniqueness within the chosen block.

   However, server `block.text` and browser `textContent` undergo different whitespace transformations. Therefore “first in `block.text`” does not prove that “first in rendered text” denotes the same occurrence.

   There is also a concrete plan inconsistency: [`resolveMark`](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/web/annotate.ts:285) requires an anchor containing `start`, and its matcher uses exact `indexOf` at [line 309](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/web/annotate.ts:309). The plan says both “do not pass `start`” and “use `resolveMark`” at [plan line 108](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/docs/plans/260916b-citations-marked-in-the-prose-and-a-clearer-find-it-button.md:108).

   I would add a citation-specific resolver using the shared forgiving matcher and draw only an unambiguous match—probably [`findOnlyQuote`](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/quote-match.ts:274). Ambiguity or failure should yield no mark.

2. **P1 — `NOT_A_BLOCK_SELECTION` does need changing.**

   The current selector includes `mark:not(.hit)` at [`TableView.tsx:396`](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/web/TableView.tsx:396), and `closest()` treats the comma-separated selectors as alternatives. Consequently:

   - `mark.cite` matches and becomes a dead zone on touch: neither citation card nor block selection happens.
   - `mark.cite.hit` representing citation plus quote does not match merely because it has both classes, so it falls through to block selection.
   - If the same mark also has `data-wash`, `cmt`, `chat`, or `term`, another selector excludes it.

   That quote-only fall-through is intentional and tested at [`block-selection-by-tap.test.tsx:310`](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/tests/block-selection-by-tap.test.tsx:310).

   Until citation touch interaction exists, I would make cite-only and cite-plus-quote behave like quote-only: allow block selection, while continuing to exclude overlaps that have an actually actionable annotation.

3. **P1 — The sanitizer requires three changes, not two.**

   Besides adding `data-cite` and reserving `cite`, this stricter policy must bump [`SANITIZER_VERSION`](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/sanitize-policy.ts:55). The file explicitly requires that at [lines 42–48](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/sanitize-policy.ts:42); otherwise existing version-6 stored blocks are not re-sanitized.

   I found no fourth functional registry that needs changing. `RISKY_ROOT_ATTR` concerns the document root and is not another annotation registry.

   The history claim is also inaccurate: the file describes quote attributes as the “third time” this class of omission occurred at [`sanitize-policy.ts:84`](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/sanitize-policy.ts:84), while the tests enumerate three attribute episodes at [`sanitize.test.ts:303`](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/tests/sanitize.test.ts:303). There was separately a reserved-class omission.

4. **P1 — The hook split is safe only after defining how `find` updates hoisted state.**

   Keeping the poller, auto-run, `find`, `finding`, `findNote`, slug guard, and all POST-capable operations in `CitationsBand` is correct. Nothing else in the proposed read half needs to remain band-local.

   But today `find` directly patches `citations` via `setCitations` at [`useCitations.ts:197`](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/web/useCitations.ts:197), including the F14 stale-result guard. After state moves into `useCitationsRead`, the band half will no longer own that setter.

   The plan should choose the seam explicitly. Simplest: after a successful paid find, call the hoisted read hook’s `refresh()`. Alternatively expose a narrow guarded `applyFoundResult`, preserving the present F14 condition. Do not hoist `find` itself.

5. **P1 — Make the owner citation GET unconditional.**

   Gating it on the experimental switch deliberately creates inconsistent knowledge between the band and prose. It also complicates the claimed single shared read hook: if `CitationsBand` performs its own read, there are duplicate states/requests; if it refreshes the shared read, the prose marks will appear anyway.

   The experimental-switch contract says the switch hides controls rather than making old URLs incomplete; an existing `?mode=citations` URL remains usable. See [`experimental-features.md:37`](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/docs/project/experimental-features.md:37).

   I would accept the fourth owner-only GET. It is a cheap read, not a model call, and directly satisfies “once generated, always visually indicate.”

6. **P1 — The proposed Find It tooltip contradicts an existing product decision and overpromises validation.**

   The draft says “One model call” at [`plan line 295`](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/docs/plans/260916b-citations-marked-in-the-prose-and-a-clearer-find-it-button.md:295). The existing regression test explicitly rejects user-facing “model call” language at [`citations-panel.test.tsx:227`](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/tests/citations-panel.test.tsx:227). “Pressing it again costs the same price” is also not guaranteed because the attached search can incur variable work.

   “Its own page” is stronger than the current validator. A review or discussion can pass when its title or excerpt matches the work’s title.

   I would say, approximately: “Searches the web for a page about this work and replaces the Scholar fallback only when the result clearly matches the title. Trying again spends again.” Avoid call counts, fixed-price claims, and “own page” unless validation is strengthened.

7. **P2 — “All works” is the right marking rule, but document the hidden-row behavior.**

   I agree with this departure from Quotes. The quote bar is part of the visible quote-density control; the citation threshold is inaccessible from other modes. Applying an unreachable threshold globally would be surprising.

   This follows the Glossary precedent more closely: its prose marks come from the full glossary even when the panel gate hides rows. A citation card for a row hidden by the current bar is therefore not intrinsically broken, provided it contains enough information and an outbound action.

8. **P2 — Keep dashed underline as the candidate, but resolve the overlap ambiguity in the plan.**

   `text-decoration` is unused by current annotation marks: glossary uses a dotted bottom border, comments use a solid bottom border, quotes use inset shadow, and hits use background. Links are already underlined in orange at [`prose.css:241`](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/web/styles/prose.css:241).

   Static inspection cannot establish whether a 1px dashed underline is visually distinct enough from the glossary’s dotted border; the planned `/design` specimen is the right test. I would not promote double underline without seeing it—it is substantially louder.

   The plan should specify what “citation contributes ink only” means. If it means changing prose `color`, that departs from the existing annotation rule of preserving author-text colour at [`annotations.css:33`](/home/greg/code/spideryarn2/.claude/worktrees/fb3k3m-citations-marks-and-find-it/src/web/styles/annotations.css:33). Prefer inherited text colour plus an explicit `text-decoration-color`, then determine from the overlap specimen whether both the dotted border and dashed decoration can remain.

On scope, I would cut stage 5—the complete `?cite=` navigation, row selection, threshold reveal, and scrolling—from this pass. It is a separate interaction feature and is not necessary to answer 3M. The smallest complete version is: persistent citation marks, a card containing work details and “why here,” and an outbound source/Scholar action. The Find It tooltip can remain as the independent answer to 3K.

Explicitly, the five load-bearing conclusions are:

1. **Partially verified:** `start` should not be trusted as a rendered offset, and both verifier branches choose their first spaced match. The claimed identity with the first rendered occurrence is not guaranteed.
2. **Verified:** for an existing block, `resolveOne` unconditionally falls back to the whole block when location fails. No existing caller suppresses that fallback.
3. **False:** cite-only is suppressed by `mark:not(.hit)` and becomes a touch dead zone; cite-plus-quote falls through unless another actionable class/attribute is present.
4. **False:** the sanitizer also needs a version bump; the “forgotten twice” history understates the record.
5. **Partially verified:** the ownership split is sound, but the plan must define how band-local `find` updates hoisted read state without moving the POST upward.

No files were changed.