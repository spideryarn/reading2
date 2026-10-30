# Sources digest Stage 2 code review — GPT Sol

Status 2026-10-30: commit `ea1959879` reviewed; Stage 2 findings fixed in the working tree, not
committed. Two wider defects and one deliberate view-as policy conflict are left for Greg to decide.

## Findings

### SD2-01 — P0 — a cross-tab completion could enqueue a second ~$1 digest run — fixed

**Evidence.** The original [`useSourcesDigest`](../../src/web/useSourcesDigest.ts) stopped treating
the digest as working as soon as the matching job left the active queue, although the completion
refresh had not replaced the earlier `none`. Queue completions are announced from a passive effect;
the later `useAutoRun` effect from that same render therefore still held `none` and called
`ensure`. Merely adding `landing` to the rendered predicate was not sufficient: a state update in
one passive effect does not change a later effect's closure from the same commit. The completed run
could be followed by a second unforced job; if the profile, source or prompt freshness had changed,
that job could do the paid work even though the contract says a stored stale/outdated digest
consumes the press without a rerun.

**Fixed.** [`useSourcesDigest.ts:159`](../../src/web/useSourcesDigest.ts#L159) now keeps the
completion-to-read interval in state and an identity-protected ref;
[`ensure` checks the ref at action time](../../src/web/useSourcesDigest.ts#L177), and the rendered
auto-run status also includes landing at line 206. The regression at
[`sources-digest-panel.test.tsx:275`](../../tests/sources-digest-panel.test.tsx#L275) changes a
posed other-tab job from running to done in an earlier passive effect while holding the digest GET.

**Red then green.** Before the action-time guard, the test failed with one received
`{slug: "a-piece", steps: ["sources-digest"]}` POST where it expected none. After the fix, all ten
tests in the file pass. The class and the wider sibling are recorded in
[the postmortem](../postmortems/261030c-a-state-update-in-one-passive-effect-cannot-guard-a-later-effect-from-the-same-render.md).

### SD2-02 — P0 — Where it sits has the same completion-effect race — not fixed, for you

**Evidence.** This predates Stage 2, but it is the precedent the new hook copied.
[`useSituate.ts:230-247`](../../src/web/useSituate.ts#L230) sets landing state in its completion
callback and its unforced `ensure` has no synchronous landing guard. The returned `starting` does
include landing at line 275, and [`useWhereAutoRun.ts:135-145`](../../src/web/useWhereAutoRun.ts#L135)
uses that to report `loading`, but only on the next render. A later auto-run effect in the same
commit can still act on the preceding `none`, exactly as Digest did. It has the same possible
duplicate paid work when the stored dossier is already stale/outdated.

**Not fixed, for you.** This is wider than the reviewed stage. The concrete change is to give
`useSituate` the same synchronous, identity-protected completion-to-read guard and refuse its
unforced `ensure` while that guard is set, with a regression that announces completion from an
earlier passive effect and holds the Situate GET. The longer-term change is the shared landing
primitive described in the postmortem, so a future hook cannot copy only the visible state half.

### SD2-03 — P1 — a schema-valid writer answer can store a completely blank `written` digest — not fixed, for you

**Evidence.** The Stage 1 validator checks that `overview` and `sections` containers exist, then
returns their post-sanitisation arrays without requiring any usable prose
([`sources-digest.ts:985-996`](../../src/sources-digest.ts#L985)). Empty arrays are schema-valid, and
valid-looking paragraphs can all be dropped for unknown block ids. The generator nevertheless
stores `outcome: "written"` at
[`sources-digest.ts:1378-1384`](../../src/sources-digest.ts#L1378). Stage 2 correctly omits an empty
overview and every empty section and reserves its explanatory copy for `nothing-found`
([`SourcesDigestPanel.tsx:274-297`](../../src/web/SourcesDigestPanel.tsx#L274)), so that stored result
draws only a headline, search log and rewrite control after the expensive run.

**Not fixed, for you.** This is the already-reviewed server stage. After `checkedOverview` and
`checkedSections`, reject the writer answer when the overview and all four sections are empty; add a
red-first `checkDigest` or generation test. Do not relabel it `nothing-found`: that outcome means no
reader or writer had evidence to work from, which is false here.

### SD2-04 — P2 — “owner only” deliberately includes read-only admin view-as — not fixed, for you

**Evidence.** Shared/public visitors are correctly excluded: `VISITOR_SOURCES_VIEWS` removes
Digest and `visitorSourcesView` maps pasted `?sources=digest` to Bibliography
([`params.ts:1648-1671`](../../src/web/params.ts#L1648)); the visitor test also observes no digest
GET. An admin view-as tab is different. It mounts the owner band and Digest hook, the GET route
explicitly carries `viewAs: "read"` ([`routes.ts:12973-12992`](../../src/routes.ts#L12973)), and the
view-as allowlist test names it. It can therefore see the Digest chip and request the stored digest.
It cannot start a paid run: `useAutoRun` returns in view-as
([`useAutoRun.ts:155-161`](../../src/web/useAutoRun.ts#L155)), and the API client refuses non-GETs.

**Not fixed, for you.** This matches the standing view-as design—an administrator sees “all its
modes … exactly as the owner sees them”—rather than an accidental disclosure. If F3's “owner only”
is meant to exclude even the read-only administrator, the concrete change is to remove the route
from the view-as allowlist and hide/map Digest in the owner band when `viewAsNonce()` is present,
with UI and gate tests. Otherwise, make the Digest contract explicitly say “owner-scoped, including
read-only admin view-as” so the next review does not interpret the two policies differently.

### SD2-05 — P2 — the Sources voice audit did not name Digest's model prose — fixed

**Evidence.** The panel correctly uses `.simple-text`, so the overview, section paragraphs and
expanded model detail already render in the AI face. But Sources' mode-level checklist in
`tests/voices-css.test.ts` did not list that selector, leaving the new surface absent from the
repository's “every mode has been asked whose words it shows” guard.

**Fixed.** Added `.simple-text` to Sources at
[`voices-css.test.ts:197-200`](../../tests/voices-css.test.ts#L197). This is a maintenance guard, not
a changed behavior; all 16 voice tests pass.

### SD2-06 — P3 — registration comments still described three chips and nine sub-modes — fixed

**Evidence.** The executable unions had the right four chips and ten addresses, but comments beside
them still said three and nine.

**Fixed.** Corrected the counts and named Digest in
[`params.ts:1551`](../../src/web/params.ts#L1551),
[`params.ts:1609`](../../src/web/params.ts#L1609), and
[`sub-modes.ts:252`](../../src/web/sub-modes.ts#L252). The evergreen `sources.md` update remains in
the plan's Stage 4, as the plan explicitly assigns it.

## Checks with no finding

- Links, Back, reload, restored URL state, stale/outdated stored results and StrictMode do not arm a
  run. Chip and command-bar presses use the shared activation token; the fresh-queue wait plus the
  fixed landing guard closes the Digest cross-tab path.
- Shared/public rendering never mounts `useSourcesDigest`, never shows a Digest chip, and a pasted
  address draws Bibliography. Switch-off hides the normal chip and command-bar row; an explicit
  Digest address keeps its own chip visible and checked.
- Model prose, source titles, search text and strangers' quotes are React text children. Source
  links are rechecked with `isWebUrl`; only HTTP(S) becomes an `href`, and external anchors have
  `target="_blank" rel="noreferrer noopener"`.
- Sentences reuse Summary's `Sentence` and `BlockRef`; an id absent from the article becomes the
  shared missing-id span under `BlockLinkProvider`. Empty individual sections are omitted,
  `nothing-found` has explicit copy, and stale has the shared notice and rewrite control.
- The chip row, run controls, waiting/error states, paragraph/source folds and sentence doors reuse
  the existing shared pieces. Mode and step registration sites covered by the Stage 2 diff are
  exhaustive under the compiler/tests.

## Verification

- `tests/sources-digest-panel.test.tsx`: 10 passed; the new behavior test was seen red, then green.
- `tests/sources-chips.test.tsx` + `tests/command-bar-sub-modes.test.tsx`: 88 passed.
- `tests/voices-css.test.ts`: 16 passed.
- `tests/read-error-matrix.test.tsx`: 191 passed.
- `tests/rewrite-hold.test.tsx`: 482 passed, 19 skipped.
- `tests/every-mode-draws-its-surface.test.tsx` + `tests/url-state.test.ts`: 157 passed.
- `tests/doc-links.test.ts`: 18 passed.
- Biome lint on the five touched TypeScript/TSX files: clean.
- `npm run typecheck` could not start because `tsx` could not create its sandbox IPC socket. The
  requested fallback ran: extension, web, root and fleet projects passed; the tests project stopped
  on five errors in the concurrent, untracked Stage 3 file
  `tests/sources-digest-and-summary-origins.test.ts`. None names a Stage 2 review file. Re-run the
  full typecheck after that concurrent edit settles.
- `git diff --check` on the review's files: clean. No database, commit, push or deploy action was
  taken.

approve with changes
