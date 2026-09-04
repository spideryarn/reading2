## Verdict

`React.memo(TableView)` will successfully skip the `?at=` renders with the currently installed dependencies, but Stage 2 is not safe as written. The proposed “pass `location.search` minus `at`” prop has no subscription of its own, so ten reading-view parameters can leave the table’s existing permalinks stale.

I would approve the memo only after permalink invalidation is made explicit and tested. I would merge the proposed `blockHref` optimisation into that same stage.

One state caveat: this stopped being a plan-only worktree while I reviewed it. `search-hits.ts`, `measure-cpu.ts`, and `performance.md` were modified concurrently, and Stage 1 is now implemented. I compared those changes with committed HEAD `99941cc2`; I did not edit anything.

## 1. Memo safety

The favourable claims check out:

- `at` is local state in `useReadingPosition` at [App.tsx:1285](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:1285). It drives restoration, feedback context, and Diagram, but is not passed to `TableView`.
- `jumpTo` is `useCallback(..., [setAt])` at [App.tsx:1379](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:1379).
- The call at [App.tsx:2570](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:2570) contains exactly the four unstable inline functions named by the plan.
- I checked the next dependency level: `geometry`, `sections`, `fit`, `arcCells`, mark maps, chat maps, notes, and `blockText` are memoised on inputs unaffected by `at`; see [App.tsx:1490](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:1490), [App.tsx:1620](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:1620), [App.tsx:2081](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:2081), and [App.tsx:2253](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:2253).
- The fresh `capability={{…}}` values at [App.tsx:1132](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:1132) and [App.tsx:1197](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:1197) are created by a parent that does not rerender for `Reader`’s local `at` update. They therefore do not spoil this particular memo.
- I found no `useQueryState` below `TableView`.

The nuqs claim is also true for the installed version, 2.10.0:

- `useQueryState` wraps the multi-key setter in a callback at [node_modules/nuqs/dist/index.js:715](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/node_modules/nuqs/dist/index.js:715).
- The underlying setter is a `useCallback` at [index.js:572](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/node_modules/nuqs/dist/index.js:572).
- The parser map is stabilised at [index.js:495](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/node_modules/nuqs/dist/index.js:495), and the React adapter’s `updateUrl` is memoised at [react.js:52](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/node_modules/nuqs/dist/adapters/react.js:52).

Thus `setAt → jumpTo → onJump` remains referentially stable across `at` changes today. Because `package.json` permits compatible upgrades with `^2.10.0`, the render-count regression test should pin this behaviour rather than treating node_modules inspection as a permanent API guarantee.

The context claim needs narrower wording. I verified that there is no `createContext` call in `src/`, but `TableView` descendants do consume Lucide’s context at [Icon.mjs:14](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/node_modules/lucide-react/dist/esm/Icon.mjs:14). The provider’s value is stable because [main.tsx:193](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/main.tsx:193) passes constants and Lucide memoises it. Therefore context does not defeat the memo today, but “no `createContext` in our source” is not proof that no context can bypass it.

Also, the plan’s claim that `Reader` will go to zero renders is false. `Reader` owns the `at` subscription, so it will continue rerendering; only memoised children can skip it. See [plan:173](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/plans/260904a-more-scroll-cpu-wins.md:173).

## 2. The `blockHref` hole

Passing a raw carried-search prop does not itself solve invalidation. nuqs subscriptions are key-isolated: its adapter filters `location.search` to the keys each hook watches and returns the cached snapshot when those keys are unchanged, at [react.js:37](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/node_modules/nuqs/dist/adapters/react.js:37). A child-only URL change therefore does not wake `Reader`.

The audit of all reading parameters is:

| Status | Parameters |
|---|---|
| Safe by definition | `at` — `blockHref` overwrites it with the target block |
| Directly rerender `Reader` | `text`, `spine`, `cols`, `note`, `panel`, `mode`, `thread`, `term`, `sort`, `gate`, `refscale` |
| Indirectly rerender it by pushing changed marks/selections upward | `idea`, `quote`, `event`, `match`, `find`, `runs`, `order`, `crits` |
| Can leave stale permalinks | `rank`, `bar`, `run`, `conf`, `deep`, `diagram`, `dx`, `dhue`, `referee`, `remember` |

Concrete holes:

- `rank` and `bar` live in `useQuotesMode` at [App.tsx:4208](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:4208). If the selected quote remains visible, the pushed `found` value is unchanged.
- `run` is ignored whenever modern `runs` is present, by [params.ts:753](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/params.ts:753).
- `conf` does not change `results` when ordering is not `prioritised`; [App.tsx:4528](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:4528) returns the same `ordered` array.
- `deep` is local to Summary at [App.tsx:4707](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:4707).
- `diagram`, `dx`, and `dhue` are local to Diagram at [App.tsx:4776](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:4776).
- `remember` is local to Remember at [App.tsx:3570](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:3570); changing it need not change `thread`.
- `referee` is local at [App.tsx:4948](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:4948), and the `mirror → candidates` transition pushes no marks from either branch, as shown at [App.tsx:5239](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:5239).

The library/admin parameters below [params.ts:1153](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/params.ts:1153) do not belong to the reading route. If they or unknown parameters appear on a reading URL, the current helper carries them but nothing guarantees a rerender for them either.

The smallest no-product-change fix is one `useQueryStates` subscription at `Reader` for the complete set of non-`at` reading parameters, followed by computing the carried raw query string from `location.search`. Put that parser map in `params.ts` as the canonical reading-parameter inventory. A new parameter must then extend that inventory.

The genuinely simpler product option is to make block permalinks carry only pathname plus `at`. That removes the subscription problem completely, but changes the documented promise that links preserve the exact view and therefore needs Greg’s decision.

Either way, Stage 3’s build-once URL work belongs in Stage 2. The plan already proposes removing `at` once and passing the result at [plan:140](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/plans/260904a-more-scroll-cpu-wins.md:140); parsing it another 551 times would undo that. The later Stage 3 is duplicate work, and its “~18,700” figure is stale now that the plan reports 77–79 renders: the old cost would be roughly 42,000 calls.

## 3. `page(blocks)`

A WeakMap keyed by array identity is correct under the current application invariant:

- Ingress always calls `sanitizeArticle` at [App.tsx:777](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/App.tsx:777).
- `sanitizeArticle` returns a new blocks array rather than mutating at [sanitize.ts:85](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/sanitize.ts:85).
- I found no production mutation of `article.blocks`.

But the invariant is not enforced: `Article.blocks` remains mutable `Block[]` at [types.ts:1313](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/types.ts:1313). The same identity can technically acquire different HTML, at which point the cache is stale. Do not add an O(article) content hash; document the immutability precondition and preferably move the relevant APIs toward `readonly Block[]`.

`findLiteral` originally duplicated exactly `page()`’s `renderedText` and `ruler` work, with `page()` additionally building an unused id index. Its minimum-length exit must remain before cache construction. The committed baseline did so, and the current implementation still does at [search-hits.ts:312](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/search-hits.ts:312).

The original plan missed `foldCase`: it walked and allocated an offset map per block per keypress. The concurrently implemented second lazy WeakMap now fixes that too. That is necessary if the plan claims to address both halves of performance item 2.

Two remaining overclaims:

- Item 2 also says search commits twice per keypress. The cache does not fix that, so “closes item 2 outright” is false.
- It does not “take the parse half out of item 1.” Comment/chat anchor resolution independently calls `renderedText` at [TableView.tsx:424](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/TableView.tsx:424) and [TableView.tsx:435](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/TableView.tsx:435). The private `page()` cache is not on that path.

I found no deliberate reason `page()` was uncached; its old comment described sharing only within one call. It looks like an omission, not a hidden semantic requirement.

## 4. Sequencing

I would sequence this as:

1. Finish the fixed-cadence harness and rerun the live/static baseline.
2. Land permalink correctness, build-once URL composition, `memo(TableView)`, and `memo(Spine)` as one stage.
3. Measure. Stop if these are the two clean wins Greg asked for.
4. Treat the search/referee cache as separate non-scroll work. It is useful, but it should not outrank the scroll win on value for this request.

Measuring hover before building was the right decision. The current draft has now done that and found no effect from synthetic CDP wheel input, while explicitly leaving real hardware unresolved. Given that result, dropping hover work is consistent with “few big wins.”

If a future real-device measurement does show it, the cheapest implementation is to replace the three `row-active` style selectors with `tr:hover` and only maintain `hoveredRow` when `columns.length > 0`. `activeChain` is only consumed by gist cells/panels; plain mode has no columns. But there is no current measurement justifying even that change.

## 5. Browser floor and `content-visibility`

The narrow table claim is correct by specification. `content-visibility` applies only where size containment applies, and size containment has no effect on internal table boxes. Thus `tr` and `td` cannot be useful containment boundaries. [CSS Containment Level 2: `content-visibility`](https://drafts.csswg.org/css-contain-2/#content-visibility), [size containment](https://drafts.csswg.org/css-contain-2/#containment-size).

It is not a general no-op: `.prose` at [TableView.tsx:1026](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/TableView.tsx:1026) is a normal block and is eligible. That would preserve every row and stable block id in the DOM. The plan’s height-estimation, deep-link, spine, and `ResizeObserver` risks are real, however; I agree it does not meet this round’s low-complexity safety bar.

I did not find another clean floor-reducing implementation. A cheap next experiment would be a static-clone A/B of `content-visibility` on `.prose`, with fixed wheel count and explicit deep-link/`scrollToBlock` measurements—not a product change. A DOM tag census is also worth doing: every block always contains a Lucide permalink SVG and every owner row another chat SVG at [BlockGutter.tsx:287](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/BlockGutter.tsx:287) and [BlockGutter.tsx:334](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/BlockGutter.tsx:334). Removing them in a static-clone experiment would tell you whether those hundreds of invisible SVG subtrees materially contribute to the floor. The icon-system rules make replacement a product/design decision, not an automatic fix.

## 6. Other false or overstated claims

- “Zero JS” is false literally: the new harness injects an rAF frame probe. Call it “zero application JS.” The reported 0.5 script time is evidence of that.
- The 12-point floor and “35 app-attributable points” are still computed from unequal input: live received 325–335 wheels and static 369–370. Directionally, the app dominates; the exact subtraction should wait for the Stage 0 rerun.
- “Those long frames are `TableView` renders” is not demonstrated by the tables. Render counts and long-frame counts coexist, but the plan does not correlate individual commits with individual long frames.
- Dismissing `content-visibility` because “layout is 0.8%” repeats the category mistake in softer form: that is wall-clock `LayoutDuration`, not CPU, and `content-visibility` can avoid paint/rendering work too.
- Stage 3 still says “if stage 3’s real-pointer measurement…” at [plan:225](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/plans/260904a-more-scroll-cpu-wins.md:225), although hover is no longer Stage 3 and real hardware was explicitly not measured.
- The Stage 1 appendix beginning at [plan:275](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/plans/260904a-more-scroll-cpu-wins.md:275) now contradicts the updated Stage 1: it still says one cache, one function, and closes item 2 outright.
- “Largest O(article) computation in the client” is unmeasured. It may be the largest identified one; that is the defensible wording.

## Verification performed

I opened all requested documents and named code, searched the full `src/` tree for contexts and URL subscriptions, inspected installed nuqs 2.10.0, and compared concurrent Stage 1 edits with committed HEAD.

I ran:

- `npx vitest run tests/prose-not-rebuilt.test.tsx` — 2/2 passed.
- `npx vitest run tests/article-parsed-once.test.ts` against the current concurrent Stage 1 implementation — 6/6 passed.

I took the production CPU/frame numbers, listener census, and CDP hover experiments on trust. I attempted a local Chromium behaviour check, but system Chrome crashed under this sandbox, so the `content-visibility` conclusion above is spec-verified, not empirically verified here.