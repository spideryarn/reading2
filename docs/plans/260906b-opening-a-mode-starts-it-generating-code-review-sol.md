I would not approve this yet. The four original blockers are substantively fixed, but Diagram has one supported URL path where pressing the mode still does not start the picture.

## Findings

1. **Blocker: an invalid or retired `?diagram=` value opens Sketch but arms nothing.**

[`diagramParam`](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/params.ts:899) deliberately degrades old or malformed values such as `?diagram=tree` to the default, Sketch. But Dock passes the raw query value at [Dock.tsx:1168](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/Dock.tsx:1168), and [`armActivationForDiagram`](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/activation.ts:300) accepts only the literal strings `sketch` and `illustrated`.

Concrete result:

1. Visit an old link containing `?mode=plain&diagram=tree`.
2. Press Diagram.
3. The parser renders Sketch.
4. The arming function sees `tree`, arms nothing.
5. Sketch stays at its extra-button empty state.

The comment at [Dock.tsx:1491](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/Dock.tsx:1491) says “arm nothing” degrades exactly as the parser does, but those are opposite outcomes. Normalize through the same shared parser/helper before arming, and add this case to the Diagram test.

2. **Candidates can preserve a failed opening forever, but this is not strictly a status-mapping error.**

The mappings at [useClaims.ts:286](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/useClaims.ts:286) and [CandidatesPanel.tsx:245](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/CandidatesPanel.tsx:245) are correct for `useAutoRun`’s actual definition of `ready`: “there is a row/thread to show,” not “generation succeeded.”

- Claims `pending` and `error` runs count as present. That is safe: pending must not duplicate, and an errored run has a visible Try again button.
- A Candidates thread with a failed opening turn also counts as present, preventing a second thread from being minted.

The Candidates failure UX is incomplete, though. Its `Turn` renders only the error text at [CandidatesPanel.tsx:772](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/CandidatesPanel.tsx:772); it does not expose `useChat.retry`. A failed automatic opening therefore leaves no “retry the brief” action, and every later chip press is consumed as `ready`. Mapping it to `none` would be wrong because `startBrief` would either refuse it or create a duplicate thread. The proper repair is to wire retry for the failed opening turn.

I would treat this as a real follow-up, though the Diagram path is the approval blocker.

3. **`Link.onNavigate` has the right ordering for Tweets, but its general contract is slightly overstated.**

Calling it immediately before `navigate()` at [Link.tsx:60](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/Link.tsx:60) is correct: the token must exist before synchronous route subscribers mount Tweets. Modified clicks, prevented clicks, non-primary buttons and `_blank` are excluded first.

However, [`navigate()` itself can still return early for the current URL](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/router.ts:1092). The current Tweets caller compensates using `view === "tweets"`, so this creates no present bug, but `Link.onNavigate` does not universally mean navigation will occur as its documentation claims.

4. **Candidates’ disclosure has genuinely moved before the authorizing click.**

The new paragraph is inside `.ref-notice`, outside `noticeOpen`, and the entire notice precedes `RefereeViews` in DOM order at [App.tsx:5593](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/App.tsx:5593). It therefore appears before the chips on an ordinary first render.

One limitation: `.ref-brief` is a 40%-height scroller at [styles.css:6913](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/styles.css:6913). On a very short viewport, or after the reader scrolls that preamble, the warning can be offscreen while the chips remain visible. That does not recreate the original “disclosure only after clicking Candidates” defect, but a browser test at the minimum supported viewport is warranted.

## The four blockers

- Diagram stale Back token: fixed for every valid Diagram kind. The minted target now matches the band that mounts; geometries mint nothing. The regression test is meaningful even though it simulates Back through state changes rather than an actual `popstate`.
- Quiz forced/unforced split: fixed. The empty branch calls `owner.ensure`; both rewrite locations still default to forced `owner.write`.
- Already-selected Quiz chip: fixed. Arming occurs before `value !== view`.
- Candidates disclosure: fixed in the initial layout, subject to the small scroll-container caveat above.

I found no ordinary unclaimed-token path for Tweets, Quiz, Claims or Candidates: each token is armed immediately before the synchronous navigation/query-state transition, and pressing an already-mounted chip is handled. The malformed Diagram case creates no token rather than leaving an unclaimed one.

## Hook/race review

- `useClaims`: `discard` controls only ordered GET generations. `pull`’s SSE lifecycle uses `running` and `current` independently, so cleanup does not break it. The slug effect resets `running`; old stream frames are rejected by `current`.
- `useChat.reload`: no effect loop. `controller` is stable per slug, therefore `startLoad` is stable; the mount effect still runs once per committed setup. A second `load.started` correctly replaces the earlier load operation.
- Candidates latch: sound for current call paths. The latch is set synchronously, `send` synchronously registers the optimistic thread, and the next render hands responsibility to the `thread` guard. I found no reachable deadlock path.
- Tweets’ inline callback and ignored `automatic` return are both safe. `useAutoRun` keeps callbacks in refs, and Tweets has no profile-choice control that needs the boolean.

## Tests

`pendingActivation` is a real measurement of the real activation store and real click handlers; it is not testing the API mock. It is nevertheless only half the chain.

Still missing:

- malformed/retired `?diagram=` → effective Sketch → one Sketch POST;
- real chip → real Claims/Candidates/Quiz consumer → POST;
- Claims failed-read reread and ordered-response race;
- simultaneous Candidates automatic/manual start proving one POST;
- Quiz assertions that the empty button is unforced and both rewrites are forced;
- Dock navigation through to the mounted Tweets page, not merely token creation;
- disclosure present above Candidates before the click at a real viewport;
- Candidates failed-opening retry behavior.

The focused suite passed: 6 files, 83 tests. All three TypeScript projects also passed direct `tsc --noEmit`; the repository wrapper itself could not open its `tsx` IPC socket in this sandbox.

## Stale text

At least these need updating:

- “Ten surfaces” in [activation.ts:6](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/activation.ts:6) and [useAutoRun.ts:10](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/useAutoRun.ts:10); the plan correctly records 12 initiating surfaces and 11 targets.
- “five read hooks” at [useAutoRun.ts:91](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/useAutoRun.ts:91).
- Candidates’ “There is no automatic turn any more” header at [CandidatesPanel.tsx:90](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/CandidatesPanel.tsx:90).
- Illustrated’s “not by opening Diagram / opening costs nothing” at [useIllustrated.ts:340](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/useIllustrated.ts:340).
- The Referee target comment still says the tooltip is what supplies the disclosure at [activation.ts:185](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/activation.ts:185).
- The old Candidates workflow and “three chips are inert” at [referee-mode.md:50](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/docs/project/referee-mode.md:50).
- Much of [referee-candidates-press.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/tests/referee-candidates-press.test.tsx:3), especially “three of the four are inert” and “nothing is asked until the button is pressed.”
- `useQuiz.ensure` says its only caller is automatic generation at [useQuiz.ts:276](/home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/useQuiz.ts:276), but the empty-state button now calls it too.

Verdict: the original blockers are real fixes, but I would withhold approval until the invalid Diagram fallback is corrected and tested.