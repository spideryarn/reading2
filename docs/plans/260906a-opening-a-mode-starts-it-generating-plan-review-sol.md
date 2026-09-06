I would not approve the plan as written. The largest blockers are Diagram’s stale activation token, Quiz’s forced/unforced split, Candidates’ disclosure regression, and the type-safety check that does not actually check the step literals.

| Surface | Is the proposed seam a real press? | Main problem |
|---|---|---|
| Diagram | The Dock handler is a press | It arms `sketch` even when Diagram opens another submode, leaving a token that Back can consume later |
| Tweets | Yes, if `Link.onNavigate` runs after navigation eligibility checks | Correct for ordinary SPA clicks; must test the actual DockLink/navigation path |
| Quiz | `RememberBand.onChange` only follows a changed-chip press | Pressing an already-selected Quiz chip never arms; empty-state button remains forced unless explicitly rewired |
| Claims | Yes, `RefereeViews.onView` is called by its button | Stream mapping works, but `reload` needs ordered-read semantics |
| Candidates | Yes, `RefereeViews.onView` is called by its button | Disclosure happens too late, and `startBrief` lacks an atomic double-start guard |

## Findings

1. **Blocker: Diagram can spend after Back without a press**

The proposed `diagram: "sketch"` mapping assumes opening Diagram always lands on Sketch. It does not: `diagramParam` survives while the reader leaves the mode, and [`DiagramBand`](</home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/App.tsx>) renders the current `?diagram=` value.

Concrete path:

1. Open Diagram and select Illustrated.
2. Leave for Plain.
3. Press Diagram.
4. The Dock arms `sketch`, but Illustrated mounts, so nobody claims the token.
5. Navigate Back until history restores Diagram/Sketch.
6. Sketch mounts, claims the still-unowned token, and spends money without a Sketch or Diagram press at that point.

The activation store does not expire an unclaimed token on navigation; it remains in the module-level map.

Do not blindly map Diagram to Sketch. Either:

- make the Diagram press explicitly reset the submode to Sketch;
- arm the actual effective diagram kind; or
- arm a generic Diagram activation that `DiagramBand` translates and consumes immediately.

Add the non-default-submode/Back sequence as a regression test.

2. **Blocker: Quiz still has a forced/unforced double-spend path**

Splitting `useQuiz.write` into `ensure` and `write` is correct, but Stage 3 must also change [`QuizPanel`](</home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/QuizPanel.tsx>). Its current shared `run()` path calls `owner.write()` for both:

- the empty-state “generate” action; and
- regeneration of an existing quiz.

If the empty button remains forced, an automatic `ensure()` and a near-simultaneous button press produce different `work_key`s and can both run.

Wire the empty state specifically to `ensure`; reserve forced `write` for rewrite/regeneration. Test the request bodies, not merely the number of button callbacks.

Tweets’ proposed `write(false, true)` is the right equivalent: its existing empty action is also unforced, so automatic and manual empty-state requests share a key.

3. **Quiz’s chip seam misses an important real press**

[`RememberSubModeToggle`](</home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/App.tsx>) only calls `onChange` when `value !== view`. Therefore:

- switching from Recall to Quiz arms correctly;
- arriving at `?remember=quiz` and pressing the already-selected Quiz chip does nothing;
- after a failed initial read, pressing the current chip cannot arm a retry.

Arm from the Quiz button’s actual click handler, before the conditional query-state update, rather than only from `onChange`. Direct query writes, pasted URLs, and Back/Forward should continue bypassing that handler.

4. **Blocker: Candidates removes the pre-spend disclosure**

The plan says the reader has “read its tooltip,” but the code does not guarantee that. The current disclosure is attached to the `StartBrief` button and visible panel content: it explains that terms derived from the paper go to a search engine/model before that button is pressed.

With chip-triggered generation, the paid external search begins after the chip press but before the reader can see the Candidates panel’s disclosure. [`referee-mode.md`](</home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/docs/project/referee-mode.md>) currently makes the visible pre-spend wording an explicit rule; it also notes that hurried readers cannot be assumed to read a tooltip.

Put equivalent visible disclosure somewhere present before the Candidates chip is pressed—probably in the Referee mode selector—or retain the manual start. Test that the disclosure is present before the authorizing click.

5. **Candidates has a plausible double-stream start**

[`startBrief`](</home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/CandidatesPanel.tsx>) guards with the render-time `thread` value:

```ts
if (!loaded || thread) return;
```

That is not an atomic guard. An automatic effect and the still-visible manual button can both invoke the same closure before the optimistic chat update renders. Unlike Claims, Candidates has no synchronous `running` ref and no job-table deduplication; the two sends can mint separate thread IDs and make two requests.

React will often flush the effect before a later discrete click, but payment correctness should not depend on that scheduling detail. Add a synchronous ref/latch around the initial brief creation and release it only according to an explicit retry policy.

6. **The Claims placeholder does not break `useAutoRun`**

The proposed mapping is mechanically sound:

- before `pull`: `run === null` → `none`;
- `pull` installs `{status: "pending"}` synchronously;
- the following render maps any non-null run to `ready`;
- the activation was already consumed before `pull`.

So the placeholder neither prevents the initial `status === "none"` call nor starts another one. Here, `ready` really means “a Claims run exists,” not “the stream completed,” which is sufficient for automatic-start retirement.

`beginAutoAttempt` also prevents automatic retries after mid-stream failure for the rest of the session. That is adequate if the intended rule is exactly one automatic attempt per session; manual Claims retry remains available.

One typing change is required: `pull` returns `void`, while [`useAutoRun`](</home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/useAutoRun.ts>) currently expects a `Promise<void>` callback. Either accept `void | Promise<void>` for `ensure`, or wrap the call deliberately.

7. **`useChat.reload` can work, but implementation details matter**

Dispatching a second `load.started` is safe under the current reducer:

- it removes/replaces the existing load operation;
- stale responses are rejected by operation identity;
- `loaded` becomes false while the replacement is loading;
- success settles `loaded=true, loadFailed=false`;
- failure settles `loaded=true, loadFailed=true`.

That gives `useAutoRun` the state transition it needs for its one reread.

Claims needs equivalent ordering protection. Extracting its effect into a naïve callback could allow an obsolete request to commit after a slug change or unmount. Prefer the repo’s ordered-read machinery or retain an explicit request identity/liveness check. A retry must also clear the old failure state when it starts and when it succeeds.

Making `reload` required on the public `ClaimsApi` will break typed test fixtures such as [`referee-claims-panel.test.tsx`](</home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/tests/referee-claims-panel.test.tsx>). Since only `useAutoRun` needs it internally, it need not be exposed from the hook.

8. **`Link.onNavigate` is the right Tweets seam**

Provided `onNavigate` is called only after checking:

- `defaultPrevented`;
- primary mouse button;
- no modifier keys;
- no non-self target;

it represents an ordinary in-app link press, rather than a render or history change.

The activation token survives because the router uses client-side `pushState`; the ES module containing the activation map remains loaded while `ArticlePage` switches to the Tweets branch.

Consequences worth documenting/testing:

- Back/Forward and pasted URLs do not arm.
- Cmd/Ctrl-click and `_blank` do not arm.
- A full reload/new tab starts a fresh JS realm and loses the token.
- The visitor Dock should not arm Tweets, since the public page has no owner auto-run consumer.

The proposed Tweets test must exercise the actual DockLink and router navigation. A standalone `Tweets` mount does not prove that `onNavigate` is correctly gated or that the token survives navigation. The current [`tweets-page.test.ts`](</home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/tests/tweets-page.test.ts>) is a non-DOM test, so this is better placed in a new `.test.tsx` test.

9. **The `Record<Exclude<…>>` check is theatre**

This does not catch a misspelled step literal:

```ts
Extract<StepName, "glosary" | "tweets">
```

`Extract` silently erases `"glosary"`. Consequently `Exclude<AutoRunTarget, StepName>` still contains only the stream targets, and the record continues to typecheck. `noUncheckedIndexedAccess` has no bearing on this.

If the record is otherwise unused, `noUnusedLocals` also makes it a compilation liability.

Use a constraint that checks the literals before constructing the union, for example:

```ts
type StepTarget<T extends StepName> = T;

type StepAutoRunTarget = StepTarget<
  | "glossary"
  | "ideas"
  | "quotes"
  | "timeline"
  | "debate"
  | "sketch"
  | "illustrated"
  | "tweets"
  | "quiz"
>;

type StreamAutoRunTarget = "claims" | "candidates";

export type AutoRunTarget = StepAutoRunTarget | StreamAutoRunTarget;
```

A const tuple using `satisfies readonly StepName[]` would also catch misspellings.

10. **Mirror is an omitted sixth surface**

The user explicitly chose Referee submode chips. Mirror currently opens to another explicit generation button and, unlike Criteria or Recall, does not require the reader to supply new text first. [`useMirror`](</home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/src/web/useMirror.ts>) streams a generated response from existing comments.

It may still be intentionally excluded, but the plan needs to name that decision. It cannot be added mechanically to the existing session guard: Mirror stores no artefact, so after unmount/remount it returns to idle while `beginAutoAttempt` would prohibit another legitimate open in the same session. It needs either per-press activation semantics or persistence of its result.

11. **The proposed tests do not reach several real gesture seams**

In particular:

- [`modes-that-start-themselves.test.tsx`](</home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/tests/modes-that-start-themselves.test.tsx>) needs the Diagram non-default-submode/Back case.
- [`referee-candidates-press.test.tsx`](</home/greg/code/spideryarn2/.claude/worktrees/open-a-mode-starts-it/tests/referee-candidates-press.test.tsx>) mounts `CandidatesBand` directly; it does not prove that pressing the Candidates chip arms anything.
- Claims and Candidates need actual `RefereeViews` chip tests under StrictMode.
- Quiz needs both switching to Quiz and pressing an already-selected Quiz chip.
- Candidates needs an automatic/manual initial-start race test.
- Tweets needs modified-click, Back/paste, and real SPA navigation tests.
- A forced/unforced request-body assertion is needed for Quiz.

Finally, the correct inventory after these five additions is **12 initiating surfaces backed by 11 `AutoRunTarget`s**: Diagram mode and the Sketch chip are two surfaces sharing one target. Any documentation count should distinguish those.