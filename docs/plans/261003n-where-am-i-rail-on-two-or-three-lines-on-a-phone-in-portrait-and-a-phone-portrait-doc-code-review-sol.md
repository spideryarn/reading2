VERDICT: proceed

The narrow breadcrumb implementation is sound after one established P1 fix. I found no remaining established P0/P1.

### Findings

- **F7 — P1, established — `Reader.tsx` — fixed.** The candidate put raw `showCrumbs` in `layoutKey`, causing a wide signed-in visitor’s unchanged 44px bar to be treated as a reflow. With `?at=`, that could move them back to the section start when Experimental loaded. The key now carries the effective narrow/tall-bar state only. Added a 768px regression test that failed on the candidate.

- **F8 — P2, established — breadcrumb breakpoint guard — fixed.** The new `731px` query bypassed the existing `spine-width-check` inventory. Added the marker, derived `NARROW_WINDOW_MAX` in TypeScript, and extended both stylesheet tests so the third query cannot drift silently.

- **F9 — P1, established — `phone-and-touch.md` — fixed.** The map contained several incorrect or incomplete signposts: “three questions,” “said this five times,” Skim as the sole exception, “one banner once,” incomplete bar guards, overgeneralised tap/pointer/Enter rules, the wrong banner component, missing Quotes CSS, an overbroad user-agent claim, and incomplete installed-app navigation ownership. All routes now match their owning docs and code. Quote text, dates, report IDs, and source links were corrected, including the 2026-08-27 capitalization.

- **F10 — P2, established — documentation single-source policy — fixed.** The candidate’s “restates nothing” claim was false. The policy section now uses route labels and deep links instead of reproducing contracts. The verbatim quotations remain under the policy’s explicit exception; the code-branch table remains the requested signpost inventory.

- **F11 — P3, established — feedback note — fixed.** “Only a phone in portrait gets it” was false; any window at or below the boundary gets it.

- **F12 — P3, established — experimental-features doc — fixed.** Its unqualified “costs 44px” statement contradicted the new 68px narrow form.

### F1–F6

- **F1:** Addressed for narrow windows; its over-broad candidate fix caused F7, now corrected.
- **F2:** Still **P1, reasoned, reported**. The adjacent targets remain 28px and 39px, below the 44px guidance, with no real-phone verification. The smallest direct change is an approximately 89px bar giving each row 44px; that is a product trade-off on the screen with least height.
- **F3:** Still **P1, reasoned, reported**. Evidence covers the ordinary View-only chip at 390px, not 320px or the longer sign-in-unconfirmed state. The smallest answer is those two browser cases, followed by reserving or stacking chip space if either collides.
- **F4:** Addressed by the taller-bar test and supplied browser evidence. Table head and spine follow the token; the fade reads that same token.
- **F5:** Addressed by F9 and F10.
- **F6:** Addressed; remaining stale height/state wording found during review was corrected.

One-, two-, and four-crumb paths, chevrons, DOM/list order, keyboard focus, `aria-current`, screen-reader-silent separators, voice classes, tooltip anchoring, shell guards, and widths above 731px otherwise checked out.

### Verification

- Requested suite: **5 files, 56 tests passed**.
- Every candidate-added test was made red independently by breaking its subject: breakpoint, bar selector, current-crumb wrapping, narrow layout key, and taller-bar measurement.
- The new wide-window regression failed on the candidate and passed after F7.
- Typecheck: **passed**, 4 projects and all 2,910 source files covered.
- Touched-file Biome lint: passed with only pre-existing `Reader.tsx` advisories.
- `git diff --check`: passed.
- Full `npm test`: attempted, but the sandbox could not reach the local Postgres port; this does not affect the requested self-contained suite.
- No real iPhone was verified, as expected.

Files edited:

- [docs/project/experimental-features.md](/home/greg/code/spideryarn2/.claude/worktrees/fbub4jnc-rail-lines-on-a-phone/docs/project/experimental-features.md)
- [docs/project/phone-and-touch.md](/home/greg/code/spideryarn2/.claude/worktrees/fbub4jnc-rail-lines-on-a-phone/docs/project/phone-and-touch.md)
- [feedback note](/home/greg/code/spideryarn2/.claude/worktrees/fbub4jnc-rail-lines-on-a-phone/docs/user-feedback/261003_1538-where-am-i-rail-three-lines-on-a-phone-and-a-phone-and-touch-map.md)
- [postmortem](/home/greg/code/spideryarn2/.claude/worktrees/fbub4jnc-rail-lines-on-a-phone/docs/postmortems/261003h-a-layout-key-must-name-a-layout-change.md)
- [src/web/layout.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbub4jnc-rail-lines-on-a-phone/src/web/layout.ts)
- [src/web/reader/Reader.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbub4jnc-rail-lines-on-a-phone/src/web/reader/Reader.tsx)
- [src/web/styles/crumbs.css](/home/greg/code/spideryarn2/.claude/worktrees/fbub4jnc-rail-lines-on-a-phone/src/web/styles/crumbs.css)
- [tests/crumbs-narrow.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbub4jnc-rail-lines-on-a-phone/tests/crumbs-narrow.test.ts)
- [tests/headings-crumbs-wiring.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/fbub4jnc-rail-lines-on-a-phone/tests/headings-crumbs-wiring.test.tsx)
- [tests/spine-width.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/fbub4jnc-rail-lines-on-a-phone/tests/spine-width.test.ts)