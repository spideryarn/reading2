Verdict: do not build Stage B exactly as written. The ordinary visible-draft case is fixed, but the proposed emptiness predicate still has dangerous false-empty states, and the foreground-program omission is based on an overbroad conclusion.

## Findings

1. **Blocker — `cleanLines` can erase the draft the guard is meant to detect.**  
   [plan emptiness rule](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/docs/plans/260908f-prose-needs-an-empty-input-box-not-merely-a-box.md:238), [DECORATION](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/pane.ts:372), [cleanLines](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/pane.ts:419)

   Failure sequence: somebody’s input buffer contains `■` or `────` → `cleanLines` replaces those characters with spaces and trims them → everything after `❯` appears empty → `paneSurface` returns `empty-input` → `sendMessage` appends its prose and Enter submits the concatenation.

   I reproduced the lossy step against the real empty fixture: `❯■`, `❯────`, `❯ `, and the genuine `❯ ` all clean to exactly `❯`.

   Use cleaned text only to locate geometry. Determine occupancy from the ANSI-stripped `raw` lines, retaining decoration. The lower border also needs to be the measured full-width border shape, not merely any line classified as a rule; otherwise a multiline draft containing a decoration-only line can masquerade as the closing border.

   Even that cannot prove literal buffer emptiness: a person can type spaces or NBSP that render identically to blank terminal cells. So yes, this is ultimately a renderer string match wearing structural support. Requiring the exact measured raw empty rendering is still much safer than `trim()`, but absolute emptiness requires structured editor state that the capture does not provide.

2. **Blocker if this stage claims to close A10 — the process-group measurement disproves `tpgid`, not every foreground guard.**  
   [plan omission](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/docs/plans/260908f-prose-needs-an-empty-input-box-not-merely-a-box.md:162), [current measured alternative](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/docs/project/orchestrator-direction.md:1218), [verifyTarget](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/steer.ts:690)

   The `pgrp = sid = tpgid` observation is sound: neither `tpgid` nor `#{pane_current_command}` identifies the reader within that group. The conclusion “cannot be built here at all” is not.

   The direction doc records that `~/.claude/sessions/<pid>.json` exposes `status:"shell"` while `claude agents --json` flattens it to `busy`. That may be unsupported application state, but it is a measured conservative refusal signal.

   Failure sequence today: Claude starts a shell child while its old empty box remains visible → the public status remains `working` → `verifyTarget` finds the live Claude descendant → `paneSurface` sees an empty box → direct Send types into the child’s tty. The queue avoids `working`, but the immediate Send path explicitly permits it.

   A perfect proof of foreground ownership may remain unavailable. A useful fail-closed shell-state guard is available. Either build that separately or describe this stage honestly as fixing only the draft/modal portions of A10.

3. **High — the fixture acceptance criterion is already false and could pressure the implementation toward an unsafe carve-out.**  
   [plan corpus rule](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/docs/plans/260908f-prose-needs-an-empty-input-box-not-merely-a-box.md:254), [occupied fixture](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tests/fixtures/fleet-panes/none-working-with-prose-decisions-list.txt:38)

   The repository contains 24 captures, not 23. `none-working-with-prose-decisions-list.txt` ends with `❯ do all three`, so “the typed-numbered fixture is drafted and the rest are empty” cannot pass a correct implementation.

   This is probably the fourth nonempty pane in the plan’s own measurement: a suggested prompt rather than a human draft. Pane text cannot distinguish those. Rename the arm `nonempty-input` or `occupied-input`, and classify both that fixture and `none-typed-numbered-message-in-input-box.txt` into it. Calling it `drafted-input` claims provenance the parser does not possess.

4. **High, pre-existing and outside this stage — the browser discards the transport’s uncertainty and says “Nothing was sent.”**  
   [route returns `delivery`](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/routes-steer.ts:1027), [client drops it](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/web/src/steer-client.ts:199), [false rendering](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/web/src/SessionDetail.tsx:120)

   Failure sequence: literal-text `send-keys` succeeds → Enter fails → server returns `send-partial`, `delivery:"partial"` → `steer-client.ts` discards `delivery` → the page states “Nothing was sent” and offers the same generic 409 recovery.

   This is A11b’s exact consumer-flattens-an-honest-union failure. It belongs to the delivery-receipt owner, but should be handed off explicitly; the current direction doc’s claim that the dashboard reports the three outcomes is not true at the browser.

5. **Medium — the `clipped` omission tests the harmless construction, not the named failure.**  
   [plan omission](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/docs/plans/260908f-prose-needs-an-empty-input-box-not-merely-a-box.md:179), [materialAbove](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/pane.ts:632)

   Deleting everything above the real outer border naturally leaves a correct body. The dangerous construction is: take `dialog-edit-diff.txt`, change its first dashed inner separator to solid as the hypothesised future renderer would, and slice the capture from that separator. `materialAbove` then treats line 0 as the outer border and returns readable but incomplete material, omitting the earlier operation/path.

   Therefore the guard’s trigger is demonstrable. The observed Claude build remains safe because inner separators are dashed, so this need not block the draft fix—but “untestable” is not a valid reason to defer it.

6. **Medium — the union gives exhaustive routing, not an unforgeable capability.**  
   [plan capability claim](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/docs/plans/260908f-prose-needs-an-empty-input-box-not-merely-a-box.md:125), [SteerIo send seam](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/steer.ts:409), [realIo export](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/steer.ts:448)

   I found no bypass in the current production call graph: the HTTP route, drain, and broadcast all call `sendMessage`, and `fire` is private. So the runtime narrowing is real.

   But `sendMessage` does not accept an `empty-input` arm; it accepts target/text/status and derives the arm internally. A code caller can supply a `SteerIo` whose `capture` lies while `sendKeys` is real, or call exported `realIo().sendKeys` directly. The union’s `never` ensures every future arm gets a decision; it does not make the arm a capability token. Adjust the plan’s claim unless the transport is made private and tied to internally minted evidence.

7. **Medium — the promised drain assertion does not test the drain.**  
   [plan test](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/docs/plans/260908f-prose-needs-an-empty-input-box-not-merely-a-box.md:258), [actual put-back branch](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/drain.ts:375), [evidence check](/home/greg/code/spideryarn2/.claude/worktrees/fleet-approval-binding/tools/fleet/queue.ts:405)

   Checking only `delivery:"none"` and `sent:[]` proves eligibility for `nothingWasSent`; it does not prove `drain.ts` called `release`, retained the item, cleared its lease, or kept it at the head. A mutation settling every refusal would leave the proposed test green.

   The current implementation does reach the generic put-back path, so the no-code-change claim is correct. Add a drain-level test returning `input-not-empty` and assert `put-back` plus an unleased retained head item. Also describe it precisely: the system automatically attempts delivery again on later drain passes, although it correctly does not retry any keystroke.

## Decisions I agree with

Moving `inputSurface` into `pane.ts` is the right move. It remains a pure reading/classification function and cannot send a keystroke; `pane.ts` already owns dialog parsing, keys, and gate classification. I would phrase its result as observed screen state, not “what may be sent,” leaving policy to `steer.ts`.

`409 Conflict` is right for `input-not-empty`. The browser currently does not automatically retry, and `drain.ts` never reads HTTP statuses—it calls `sendMessage` directly. Do not treat 409 itself as retry permission, because `send-partial` and `send-unknown` are also 409 and must never be retried automatically. Special-case the draft UI so its action is “wait or open the terminal,” not merely the generic “Refresh and look again.”

I ran the targeted tests. The current red-first additions fail in the intended dangerous way: `sendMessage` returns `ok:true` with the literal-text and Enter calls. Overall: 3 failed, 107 passed. No files were changed.