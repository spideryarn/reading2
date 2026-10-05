**Do not build until F1 is settled.** No established charging issue found. The storage change otherwise preserves restoration behavior.

**F1 — P1, established: storage failure becomes “first open” on every visit.**

(a) [`readLastView`](/home/greg/code/spideryarn2/.claude/worktrees/fbgqj660-home-link-and-first-open-default/src/web/last-view.ts:382) returns `null` when storage throws. Writes also swallow failures. With storage blocked: open a bare article → receive Summary → choose Plain → leave → reopen bare → receive Summary again. The plan incorrectly equates every `null` with a missing key, violating “never override a later choice.”

A permitted `/tmp` probe confirmed that the existing reader returns `null` both before and after attempting to save Plain under throwing storage.

(b) Add:

> “A storage failure is not evidence of a first open. Distinguish a failed read from a successfully read missing key, and apply the new default only after successfully persisting a first-open marker. If either operation fails, leave the address unchanged.”

**F2 — P2, established: retaining signed-out Home links contradicts deleting the house variant.**

(a) All five house-link pages lack `HomeLogo` when signed out: [`App.tsx`](/home/greg/code/spideryarn2/.claude/worktrees/fbgqj660-home-link-and-first-open-default/src/web/App.tsx:232) returns their pages directly. The plan’s conditional fallback correctly preserves those links, but then `icon="home"` still has five callers. Its unconditional removal instructions, variant deletion, and completion criterion cannot all be followed.

(b) Replace those instructions with:

> “On the five house-link pages, hide the Home link only in the signed-in shell, where App draws HomeLogo. Keep the signed-out Home links, the house variant, its import and its test. Remove Profile’s link and admin Shell’s default library link. Done when no shell draws both the corner logo and a heading-level link home.”

**F3 — P2, reasoned: sharing layout functions does not guarantee sharing their measurements.**

(a) The plan specifies `windowWidth` but not its source. The reader uses [`pageWidth() minus safe-area insets`](/home/greg/code/spideryarn2/.claude/worktrees/fbgqj660-home-link-and-first-open-default/src/web/reader/measure.ts:47), rather than raw `innerWidth`. A default computed at 910px requests Marginalia; the layout computed at 895px refuses it. The `/tmp` probe reproduced that disagreement with the existing helpers. Whether this ships depends on the implementation’s unspecified measurement choice.

(b) Add:

> “Supply the same measurements the reader uses: pageWidth() minus horizontalInset(safeAreaInsets()), and the validated computed root font size. Calculate the default once per arrival; subsequent resizing follows existing layout behavior without reapplying the default.”

**F4 — P3, established: the iPad-landscape completion example contradicts the proposed function.**

(a) With the default rail, Summary fits from **700 usable pixels**, and Summary plus Marginalia fits from **900**. The proposed calculation therefore returns both columns at 1024px and 1194px, contrary to “Summary alone at iPad-landscape width.” The probe confirmed those results.

(b) Replace the width examples with:

> “Done when first-open defaults match the layout boundaries: below 700 usable pixels, Plain; from 700 through 899, Summary alone; from 900, Summary plus Marginalia. Test immediately below and at both boundaries.”

Other checks held: Brief requires a press to start its model job; `""` and `null` both produce no restoration under existing `restoredHref`; no other production reader or sign-out cleanup uses these storage keys. The ordinary authentication initialization is gated before `ArticlePage` mounts, and the existing once-per-slug guard handles StrictMode replay and slug changes.

The permitted Vitest command failed during startup creating `.vite-temp`; **no tests ran**. Repository files were unchanged.

**do not build until F1 is settled**