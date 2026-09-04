## Verdict

The double-patching design is sound with nuqs 2.10.0, and I would keep it over the parameter inventory. It is self-maintaining in the way the inventory was not.

I would not sign this off unchanged, though. There is one remaining quiet permalink bug, two harness-reporting defects, and several documentation claims that are stronger than the evidence.

## Findings

1. **P2 — pathname-only history writes leave memoized permalinks stale.**

   `useAddressSearch()` snapshots only `location.search` ([router.ts:922](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/router.ts:922)), but `blockHref()` also reads `location.pathname` ([BlockRef.tsx:89](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/BlockRef.tsx:89)). Therefore:

   ```text
   /read/x?cols=1 → /read/x/?cols=1
   ```

   dispatches `NAVIGATED`, but the store snapshot remains `"?cols=1"` and `carried` remains unchanged. `useRoute` wakes the parent, but `TableView` receives the same 29 props and its memo holds, leaving its anchor `href`s on `/read/x`.

   This is not purely hypothetical: both spellings are accepted as the same route ([router.ts:274](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/router.ts:274)). I reproduced the store-level failure in a temporary focused test: expected `/read/x/?cols=1&at=…`, received `/read/x?cols=1&at=…`.

   The fix is to make the subscribed address contain both pathname and search, and pass pathname through the memo boundary too. The existing test exercises only query changes ([permalinks-follow-the-address.test.tsx:82](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/tests/permalinks-follow-the-address.test.tsx:82)).

2. **P2 — the CDP client silently treats protocol errors as successful wheel dispatches.**

   CDP error responses have `{id, error}`, but the message handler models only `{id, result}` and always resolves the promise ([measure-cpu.ts:352](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/scripts/measure-cpu.ts:352)). Consequently, `wheel.failed` ([measure-cpu.ts:568](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/scripts/measure-cpu.ts:568)) counts only synchronous `WebSocket.send()` failures—not rejected CDP commands. A connection close can also leave pending promises unresolved forever.

   This did not invalidate the recorded A/B runs: all four reported 417 dispatches and exactly 50,040px, and `wheel.wallMs` ended around 25,021ms. But the harness currently cannot prove “zero failed commands” as its field claims.

3. **P2 — “dropped frames” is not what the probe counts.**

   The probe counts rAF intervals longer than 32ms once each ([measure-cpu.ts:646](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/scripts/measure-cpu.ts:646)). A 133ms interval represents roughly seven missed 60Hz refresh opportunities but increments the counter once. The denominator is delivered rAF intervals, not expected frames.

   Therefore these formulations are false or materially misleading:

   - “drops one frame in fourteen” ([plan:52](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/plans/260904a-more-scroll-cpu-wins.md:52))
   - “one dropped frame in nine becomes one in thirty-eight” ([plan:229](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/plans/260904a-more-scroll-cpu-wins.md:229))
   - “four fifths of the dropped frames” ([nuqs-setter-is-stable.test.tsx:6](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/tests/nuqs-setter-is-stable.test.tsx:6))
   - “miss one frame in nine” ([performance.md:742](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/project/performance.md:742))

   The defensible wording is: “10.8% of observed rAF intervals exceeded 32ms, falling to 2.6%.” The p95 result remains valid. “A clean 60fps frame” should be narrowed to “p95 returned to one-refresh cadence”; the after runs still contain 117–133ms maxima.

4. **P2 — the new event-listener explanation is not supported by the measurements.**

   The current uncommitted additions claim that 51,822 listeners fell to a 5,047 “steady state” because reconciliations left detached listeners awaiting collection, and that this was “most of the GC pressure” ([plan:417](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/plans/260904a-more-scroll-cpu-wins.md:417), [performance.md:801](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/project/performance.md:801)).

   But 51,822 came from the old, ack-gated 325-wheel run ([live-run1.json:45](/tmp/claude-1000/-home-greg-code-spideryarn2/174d5656-09e2-4f57-ba2f-6a1034373d37/scratchpad/live-run1.json:45)). The fixed-harness before runs reported 11,576 and 4,404 listeners ([before-new-1.json:27](/tmp/claude-1000/-home-greg-code-spideryarn2/174d5656-09e2-4f57-ba2f-6a1034373d37/scratchpad/before-new-1.json:27), [before-new-2.json:27](/tmp/claude-1000/-home-greg-code-spideryarn2/174d5656-09e2-4f57-ba2f-6a1034373d37/scratchpad/before-new-2.json:27)); one is already below 5,047. The count is evidently GC-sensitive and noisy.

   Chromium increments this counter when a JS event-listener wrapper is constructed and decrements it when the wrapper is destroyed, so delayed collection is plausible, but the before/after correlation does not establish that TableView reconciliation caused it, much less that it caused most GC time. [Chromium’s counter implementation](https://chromium.googlesource.com/chromium/src/+/main/third_party/blink/renderer/bindings/core/v8/js_based_event_listener.cc).

   Force GC before both readings or capture allocations/listener owners before closing this loose end.

5. **P3 — `navigate()` now dispatches `NAVIGATED` twice.**

   The history wrapper dispatches after every write ([router.ts:899](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/router.ts:899)), while `navigate()` still explicitly dispatches immediately after its history write ([router.ts:841](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/router.ts:841)). String snapshots normally suppress a second committed render, but all subscribers are invoked twice and can schedule duplicate work.

6. **P3 — the fold-cache test fixture contradicts its own isolation rule.**

   The test correctly says a shared array lets tests observe previous cache entries ([article-parsed-once.test.ts:55](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/tests/article-parsed-once.test.ts:55)), then creates and shares `BLOCKS` ([article-parsed-once.test.ts:68](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/tests/article-parsed-once.test.ts:68)). It passes because Vitest currently runs the cases in declaration order and later tests prime the cache before resetting the counter. The first test becomes order-dependent under shuffled/concurrent execution.

## Specific audits

### Double-patching history

I opened the installed nuqs code. The order is correct:

1. `enableHistorySync()` runs first ([main.tsx:78](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/main.tsx:78)).
2. nuqs captures the native methods and installs its wrappers ([patch-history-Bze7i4qB.js:49](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/node_modules/nuqs/dist/patch-history-Bze7i4qB.js:49)).
3. `watchHistoryWrites()` then captures those wrappers as its inner `real` functions ([router.ts:903](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/router.ts:903)).

For a nuqs setter, the call path is:

```text
app wrapper → nuqs wrapper → native history → app NAVIGATED → nuqs emitter
```

The `"__nuqs__"` marker is forwarded unchanged, so nuqs correctly skips its external-write resynchronization ([adapters/react.js:10](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/node_modules/nuqs/dist/adapters/react.js:10)). For an ordinary caller, nuqs synchronizes first and the app event follows.

The native method is called exactly once, so `history.length` remains correct. The standard return is `undefined`, which both wrappers preserve. I found no repository caller holding a pre-patch method reference or bypassing the wrapper. A caller that captured the native method before startup, or later overwrote `history.pushState` without delegating, could bypass it—that is the normal monkey-patch limitation, not a present path.

### `useSyncExternalStore`

The primitive string snapshot is sound for React tearing: React can compare and re-read it before commit. An event cannot normally occur during render because all reviewed history writes occur before mount, in handlers, effects, or timers. A component calling a URL setter during render could cause it, but that component would already violate React’s render rules.

`getServerSnapshot: () => ""` is hydration-consistent but deliberately omits the real query until the client update. There is no current SSR problem because this is a client-rendered application. It is not generally SSR-ready: other `BlockRef` callers still evaluate a default parameter that reads `location` ([BlockRef.tsx:89](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/BlockRef.tsx:89)).

### Memo and URL propagation

The memo is otherwise correct:

- Every non-`at` query-byte change changes `carried` and therefore must re-render because the generated links change.
- Plain and percent-encoded `at` keys are all dropped.
- `at`-only writes, history-state-only writes, hash changes, and removed empty separators correctly do not invalidate `TableView`.
- Reordering or re-encoding parameters does re-render, but that is necessary if preserving the written query is the policy.
- The four callbacks have appropriate dependencies, and the nuqs setter test pins the only external identity assumption.

The prop counts are stale. `TableView` now has **29 props**, 25 previously stable plus four repaired callbacks—not 28/24. The incorrect numbers occur in [TableView.tsx:229](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/TableView.tsx:229), [App.tsx:2304](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:2304), [plan:140](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/plans/260904a-more-scroll-cpu-wins.md:140), [performance.md:726](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/project/performance.md:726), and the nuqs test’s header.

“Nothing inside `TableView` changed” is also literally false ([plan:145](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/plans/260904a-more-scroll-cpu-wins.md:145)); `carried` was added and threaded into `BlockRange` and `BlockGutter` ([TableView.tsx:982](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/TableView.tsx:982)). And its comment says it is the only memo in `src/web` ([TableView.tsx:223](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/TableView.tsx:223)), while `Spine` is also memoized ([Spine.tsx:324](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/Spine.tsx:324)).

### `blockHref`

For actual `location.search` input, the textual construction is correct:

- Empty query: correct.
- Trailing or repeated `&`: `searchWithout` removes empty pairs, so it cannot hand `blockHref` a trailing ampersand.
- Malformed percent escape: preserved without throwing.
- Literal `&` and `#` cannot be part of a value in `location.search`; the browser treats them as delimiters. Proper `%26` and `%23` spellings are preserved.
- `location.pathname` cannot contain `?`.
- A comma is legal in a query and nuqs deliberately preserves it ([context-Mu913OAK.js:19](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/node_modules/nuqs/dist/context-Mu913OAK.js:19)). Changing the expected value to `cols=0,1` was right.

Two qualifications:

- The claim that everything is kept “exactly as written” is false for empty pairs and trailing ampersands because they are filtered out ([router.ts:731](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/router.ts:731), [router.ts:750](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/router.ts:750)).
- `id` is now appended without encoding. Current stable block IDs make that safe, but `BlockId` is only a string alias ([types.ts:31](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/types.ts:31)). `encodeURIComponent(id)` would preserve current output and restore the helper’s robustness.

If somebody directly passes `carried="q=a#b"`, `at=` lands in the fragment. That is outside the current `location.search` contract but demonstrates that the pure function is not safe for arbitrary strings.

### Fold cache

The two caches are coherent under the existing immutability convention. `foldedTexts()` necessarily obtains its source from the cached `page(blocks).texts` ([search-hits.ts:448](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/search-hits.ts:448)), so it cannot be built from a different parse. Laziness is correct.

The weakness remains identity-keyed mutable input: `Article.blocks` is typed as mutable ([types.ts:1313](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/types.ts:1313)). In-place mutation makes both caches stale; reordering can associate old text and folds with new block IDs. I found no production mutation, so this is an unenforced precondition rather than a present bug.

The offset map is correct. Its final sentinel is `hay.length` ([search-hits.ts:247](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/search-hits.ts:247)), so `map[i + lowerNeedle.length]` produces the exclusive original end even when a match ends at the end of the block ([search-hits.ts:289](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/search-hits.ts:289)). The current Unicode/search suite also passes.

### Wheel harness

Dispatch order is sound enough for these runs. WebSocket messages are ordered, CDP request IDs associate responses independently, and current Chromium queues wheel acknowledgements in input order. I checked the [CDP Input definition](https://chromedevtools.github.io/devtools-protocol/tot/Input/#method-dispatchMouseEvent) and [Chromium’s input handler](https://chromium.googlesource.com/chromium/src/+/main/content/browser/devtools/protocol/input_handler.cc).

The array grows as `duration / 60ms`: 417 promises for 25 seconds, harmless here but unbounded for arbitrarily long runs. `Promise.all` can also extend the frame-measurement window until the last acknowledgement. The saved runs show only a ~21ms tail, so this did not materially affect their comparison.

`sendMsTotal` is now the sum of overlapping end-to-end acknowledgement latencies. It can exceed wall time and must not be described as time spent sending or CPU. It remains a useful comparative congestion signal; `sendMsMax` and `sendMsOverStep` are clearer.

The deadline pacing can burst after the Node process misses a deadline: negative waits are skipped until it catches up ([measure-cpu.ts:581](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/scripts/measure-cpu.ts:581)). Thus the harness proves equal count and distance, not identical temporal spacing. This weakens “same input” slightly but does not overturn the very large A/B result.

“Every earlier comparison understated the improvement” is too categorical ([performance.md:753](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/project/performance.md:753)). Fewer events clearly biased the slow side favourably, but event coalescing and cadence make the exact effect nonlinear. “Was biased toward understating” is supportable.

### Tests run and assessed

I ran exactly:

```text
npx vitest run tests/article-parsed-once.test.ts \
  tests/permalinks-follow-the-address.test.tsx \
  tests/nuqs-setter-is-stable.test.tsx
```

Result: **3 files, 12 tests passed**.

I additionally ran:

```text
npx vitest run tests/block-ref.test.ts tests/search-hits.test.ts
```

Result: **2 files, 66 tests passed**.

Assessment:

- `nuqs-setter-is-stable`: good and focused. It forces three renders and would fail if either the setter or derived callback changed identity.
- `permalinks-follow-the-address`: would fail for the original query-staleness regression, but it installs the app watcher itself and does not test main’s installation order, nuqs’s actual wrapper/marker path, pathname changes, or that `at` avoids a memoized render. Its “history write anybody makes” claim is broader than the test ([permalinks-follow-the-address.test.tsx:29](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/tests/permalinks-follow-the-address.test.tsx:29)).
- `article-parsed-once`: the second-resolver and second-keystroke assertions would fail if page caching regressed; the first-call assertion alone would not. The fold test would fail if the fold cache were removed, and the laziness test would fail if folding moved eagerly into `page`.
- The `String.prototype.toLowerCase` patch is clever but acceptable under the current synchronous, serial execution: it is restored in `finally` ([article-parsed-once.test.ts:138](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/tests/article-parsed-once.test.ts:138)). It is indirect and its thresholds include unrelated lowercase calls. A spyable fold helper would be cleaner, but I would not reject the change solely for this.

## Remaining documentation corrections

The newly added “remaining cost” arithmetic mixes clocks: `main-thread CPU` is `ThreadTime`, while script/layout/style are wall-clock durations. The source itself warns that these are not interchangeable ([measure-cpu.ts:170](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/scripts/measure-cpu.ts:170)). The roughly 30-point unclassified bucket should be calculated from `TaskDuration - ScriptDuration - LayoutDuration - RecalcStyleDuration`, not from `ThreadTime` ([plan:403](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/plans/260904a-more-scroll-cpu-wins.md:403), [performance.md:788](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/project/performance.md:788)). The numbers happen to be close in these runs; the reasoning is still dimensionally wrong.

`SystemInfo.getProcessInfo` does report cumulative CPU across all process threads, as claimed, although attribution requires an isolated browser or mapping renderer processes to targets. [Official CDP documentation](https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/#method-getProcessInfo).

“No hot function is left to chase” and “another round of render work is not the lever” overreach one sampling profile ([performance.md:796](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/project/performance.md:796)). The evidence supports “no obvious single hot JavaScript function remains.”

Finally, “Before is a detached worktree at `HEAD`” should name `99941cc2`; preserved documentation should not use a moving relative label ([plan:215](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/plans/260904a-more-scroll-cpu-wins.md:215)).

## What I verified versus took on trust

Verified by opening or running:

- The full `99941cc2..436e8eb2` source/test diff.
- Installed nuqs 2.10.0 wrapper, marker, emitter, and encoding implementation.
- All five named/additional test files: **78 tests passed**.
- A temporary pathname-only reproduction: failed as described.
- Saved before/after JSON: A/B CPU, frame, event count, distance, wall-tail, and listener values match the files.
- Current Chromium’s wheel dispatch and listener-counter implementations.

Taken on trust:

- The author’s statements that particular tests were personally watched red.
- The production-build identity, authentication setup, browser conditions, and manual visual checks used to produce the saved measurements.
- The uncommitted 5,047-listener run, because its corresponding raw result was not among the named saved A/B artifacts I inspected.

The two documentation files changed in the working tree while I was reviewing. I did not touch them; the line references above use their current uncommitted contents.