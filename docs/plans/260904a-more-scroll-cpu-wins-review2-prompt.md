# Second review: the built code

You reviewed the plan for this work a couple of hours ago and found a real hole before it shipped —
thank you, it changed the design. This is the **built-code** review, which this project weights
higher than the plan review, because a plan-stage review cannot see what the code actually does.

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu` (a git worktree; work only here).
The change is the single commit at `HEAD` (`436e8eb2`), on top of `99941cc2`.

## Read

1. Your own previous review: `docs/plans/260904a-more-scroll-cpu-wins-review-sol.md`.
2. The plan as it now stands: `docs/plans/260904a-more-scroll-cpu-wins.md` — **rewritten** since you
   saw it, with your corrections folded in and the measured results added.
3. The diff: `git diff HEAD~1 HEAD -- src/ scripts/ tests/`, also saved at
   `/tmp/claude-1000/-home-greg-code-spideryarn2/174d5656-09e2-4f57-ba2f-6a1034373d37/scratchpad/built.diff`.
4. `docs/project/performance.md` § "Scrolling re-rendered the whole reading view, 2026-09-04".

## What changed relative to what you reviewed

**On your finding about `blockHref` — I did not take your recommendation, and I want you to attack
the alternative.** You proposed a `useQueryStates` subscription over an inventory of the reading
parameters, kept in `params.ts`. I judged an inventory would be correct until somebody adds the
thirty-sixth parameter, with a quietly-wrong link as the failure. Instead:

- `src/web/router.ts` gained `watchHistoryWrites()`, which wraps `history.pushState` and
  `history.replaceState` to dispatch the app's existing `NAVIGATED` event, and `useAddressSearch()`,
  a `useSyncExternalStore` whose snapshot is the query **string**.
- `src/web/main.tsx` calls `watchHistoryWrites()` immediately after nuqs's `enableHistorySync()`.
- `Reader` subscribes with `useAddressSearch()`, drops `at` with `searchWithout`, and passes the rest
  to `TableView` as `carried`; `TableView` hands it to `BlockGutter` and `BlockRange`.

**Please try hard to break this.** Specifically:

1. **Does double-patching `history` actually work?** nuqs's `patchHistory` also wraps these methods.
   Read `nuqs/dist/*` and work out what happens with both wrappers installed, in the order
   `main.tsx` installs them. Is there any path where our wrapper is bypassed, or where nuqs's
   `"__nuqs__"` marker logic misbehaves because our wrapper forwarded the arguments? Does
   `history.pushState` remain correct for callers that read `history.length` or rely on the return
   value?
2. **Is `useSyncExternalStore` with a `location.search` snapshot sound here?** Consider tearing,
   SSR/hydration (`getServerSnapshot` returns `""`), and whether a `NAVIGATED` event can fire during
   render.
3. **Is the memo genuinely correct now?** Re-audit the parameters with the new mechanism in place:
   is there any URL change that still fails to reach the permalinks? Any that now reaches them but
   should not have re-rendered `TableView`?
4. **`blockHref` no longer uses `URLSearchParams`.** It is now
   `` `${location.pathname}?${carried ? `${carried}&` : ""}at=${id}` ``. Is that correct for every
   input `searchWithout` can produce — an empty query, a query with a trailing `&`, a malformed
   pair, a parameter whose value contains `&` or `#`, a pathname containing `?`. I changed a
   `tests/block-ref.test.ts` expectation from `cols=0%2C1` to `cols=0,1` because of this; is that
   the right call, and is anything now under-encoded in a way that matters?
5. **Stage 1's second cache.** `foldedTexts` in `search-hits.ts` is a lazily-filled
   `WeakMap<Block[], Folded[]>` built from `page(blocks).texts`. Is the laziness sound? Can the two
   caches disagree? `literalSpans` now takes the fold as an argument — check the `map` indexing is
   still right, especially the `map[i + lowerNeedle.length]` at the end of a block.
6. **The harness.** `wheel()` in `scripts/measure-cpu.ts` no longer awaits each dispatch and paces
   against its own start time, collecting promises and awaiting them at the end. Is that sound over
   CDP — can events arrive out of order, can the collected array grow unboundedly, is the
   `sendMs*` accounting still meaningful now that sends overlap? Does anything about it invalidate
   the before/after numbers in the plan?
7. **The tests.** `tests/article-parsed-once.test.ts`, `tests/permalinks-follow-the-address.test.tsx`
   and `tests/nuqs-setter-is-stable.test.tsx` are new. **Run them** — your sandbox allows it
   (`npx vitest run <file>`). Are they testing what they claim? Would each fail if the thing it
   guards regressed? The one that monkey-patches `String.prototype.toLowerCase` is the one I trust
   least; say if it is too clever.
8. **Any claim in the plan or in `performance.md` that is still false or overstated.** You caught
   six last time, including my calling `LayoutDuration` a percentage of a core. Do it again — I have
   rewritten both documents heavily and will have introduced new ones.

Cite `file:line`. Say explicitly what you verified by opening a file or running something, and what
you took on trust. If you think the inventory approach was still the right call and my patch is
worse, say so plainly and say why.
