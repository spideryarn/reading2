# Stage 3 and C7 code review

Up: [the plan](261002h-quick-search-bar-in-the-dock.md)

**Verdict: land with fixes (made).** Eight scoped findings fixed in the working tree; no commit.
Reviewed ff27cc68c, 234ae4cd9 and e000b8f64 separately, excluding a6fa8bd8e's origin/dev changes.
Read the plan, plan review and stage 1–2 review first. Line numbers below refer to the repaired tree.

- **D1 — P1: Enter handoffs lost their sealed words and overwrote one another.**
  [search-draft.ts:96](../../src/web/search-draft.ts#L96) now queues explicit Enter snapshots;
  [SearchMode.tsx:255](../../src/web/modes/search/SearchMode.tsx#L255) drains them in order and
  starts a fresh session for subsequent edits. Red-first: `seals each Enter with its words and
  preserves subsequent edits` received only the newest draft instead of the two submitted queries.
- **D2 — P1: StrictMode erased an intent before the opening GET completed.**
  [SearchMode.tsx:246](../../src/web/modes/search/SearchMode.tsx#L246) now consumes in a cancellable
  microtask after effect replay. Previously the first setup took the handoff and session cleanup
  discarded it; the second setup had nothing to take. Red-first: `carries Enter through StrictMode
  effect replay and delayed loading` received no POST after loading.
- **D3 — P2: Article or mode departure retained an executable handoff.**
  [DockQuickSearch.tsx:176](../../src/web/DockQuickSearch.tsx#L176) now clears pending actions and
  local session state while preserving draft text. The band's lifetime cleanup also discards a
  handoff left pending when its matcher switch is interrupted, while preserving StrictMode replay.
  Red-first: `drops an unconsumed handoff on
  article departure, retaining only the draft` and `drops an unconsumed handoff when leaving Search
  mode before its matcher switches` unexpectedly submitted on return.
- **D4 — P2: The old bar timer survived the band's takeover.**
  [DockQuickSearch.tsx:103](../../src/web/DockQuickSearch.tsx#L103) observes band registration and
  stops local waiting; forwarding an edit also stops it synchronously. Registration notifies
  subscribers in [search-draft.ts:115](../../src/web/search-draft.ts#L115). Red-first: `cancels the
  old bar timer when the band takes over` submitted the latest words before their 600 ms pause.
- **D5 — P2: A final narrow/coarse/rung shape could hide the focused input.**
  [DockQuickSearch.tsx:146](../../src/web/DockQuickSearch.tsx#L146) checks visibility after layout
  following resize, pointer changes and dock class changes, then transfers to the panel through
  the bolt action. It does not react synchronously to measurement probes. The bolt releases bar
  focus before opening so the panel's quiet-mount guard allows focus. Panel focus uses
  `preventScroll`. Red-first: `moves focus to the panel when the final CSS shape hides the focused
  bar field` left the hidden box focused. This test simulates final CSS visibility; real device
  and layout verification remains stage 4.
- **D6 — P2: The control ignored the explicit visitor prop.**
  [Dock.tsx:2141](../../src/web/Dock.tsx#L2141) and its fit signature now honour `isVisitor`, which
  combines both visitor signals. Red-first: `honours the visitor prop independently of the drawer
  arm` found a control on a bar declaring itself a visitor. The server ownership gate was intact.
- **D7 — P3: Unfocused input events could write the bar draft and launch a search.**
  [DockQuickSearch.tsx:184](../../src/web/DockQuickSearch.tsx#L184) now requires actual input focus.
  Red-first: `only accepts bar edits while its input has focus` opened Search from an unfocused
  input event. Ordinary focused typing is its positive control.
- **D8 — P2: C7's rejected revision could still reset a failed meaning row.**
  [searches.ts:200](../../src/searches.ts#L200) excludes revision requests from the ordinary retry
  branch. Red-first: `an unapplied revision cannot fall through to retry a failed meaning row`
  returned `reset` instead of `minted`. Ordinary retry behavior remains covered by existing tests.

**D9 — P2, wider scope, reported only:**
[SearchPanel.tsx:638](../../src/web/SearchPanel.tsx#L638) submits Enter during IME composition.
That handler already existed before stage 3; the dock's new Enter handler correctly guards it.
A temporary regression test in meaning mode, `WIDER: panel Enter must not submit an IME candidate`,
failed because a composing Enter sent a POST. Removed that temporary failing test and left the
handler unchanged, per the stage boundary. Reproduction output:
`/tmp/quick-search-stage3-wider-red.log`.

Validation:

- Final targeted run: **124 tests passed** in the six search files plus doc links. This includes
  checks that words retains `?find=` without writing the draft or asking, meaning asks only on
  Enter, and unmount removes the shortcut and box/band registrations.
- After the final mode-departure fix, **34 adjacent tests passed** in the panel, parallel-search
  and mode-toggle suites.
- Broader run: **309 passed, one sandbox-blocked check** across 14 files, including public network
  traces, dock fitting, mode toggles, command bar, panel and parallel searches, and Enter promises.
  The failing CSS-import check could not spawn `git` (`EPERM`); its equivalent scan passed
  separately, with two positive-control imports and no offenders.
- `npm run typecheck` encountered tsx's IPC socket restriction. Running the same script using
  `node --import tsx scripts/typecheck.ts` passed all projects and source-file coverage.
- Scoped Biome lint passed, with existing complexity advice in Dock and SearchPanel.
- No PostgreSQL, network or browser tests run. The C7 store path was inspected; the pure decision
  and client rename cases passed. Real iOS keyboard behavior remains the plan's stage 4 check.

The matcher handoff still replaces history; subsequent run selection also uses replace. The CSS
still owns all sizes and coarse-pointer selection, with both control shapes mounted throughout
measurement. Fetches never populate the draft. ArticlePage keys article components by slug, and
stores remain per article. No new requesting path or change to other Dock actions was introduced.

Root-cause analysis was delegated read-only. The asynchronous handoff class is recorded in
[the postmortem](../postmortems/261002h-search-handoffs-are-actions-not-draft-state.md).
