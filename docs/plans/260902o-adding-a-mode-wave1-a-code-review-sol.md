## Findings

1. **Medium — the derived cache-coverage test can silently drop one route from its own input.** [cacheable-covers-artefact-routes.test.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/tests/cacheable-covers-artefact-routes.test.ts:98)

   - **(a)** Runnable mutation: rename the `timeline` route binding and its dispatch use to `timelineRoute`, remove `"/api/timeline/"` from `CACHEABLE`, then run `npx vitest run tests/cacheable-covers-artefact-routes.test.ts`. The test remains green: `getDispatch("timeline")` no longer matches, so `servedArtefacts` silently loses Timeline; the three canaries do not notice.
   - **(b)** Capture the binding name from each matched route declaration and use that captured identifier to find its GET dispatch. Keep a mutation control proving that renaming one binding cannot shrink coverage.

2. **Low — the headerless-response hardening is incomplete.** [api.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/lib/api.ts:115)

   - **(a)** Pass `failure()` a headerless failure stub such as `{ status: 500, statusText: "", url: "/api/x", text: async () => "{\"error\":\"boom\"}" } as Response`. `logFailure` still executes `res.headers.get(...)` directly at line 118 and throws a `TypeError` instead of returning the intended `HttpError`.
   - **(b)** Change that remaining access to `contentType: header(res, "content-type")`.

   The `saving()` fix is in the right place: cache bookkeeping should not turn an otherwise usable response into a failed request. Given that the module explicitly supports incomplete test responses, making only the newly exposed stubs “honest” would leave the same accepted input broken elsewhere.

3. **Low — `storesNothing` and “read-only” overstate the quiz-mark exemption.** [api.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/lib/api.ts:769), [routes.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/routes.ts:6532)

   - **(a)** A valid `POST /api/quiz/:slug/mark` makes a model call under the request spend collector, whose sink writes an `ai_calls` ledger row. The route itself even says that the article is attached to “every row this request writes.” It stores no attempt, score, answer, or quiz change, so the cached quiz GET remains current—but it does not literally store nothing.
   - **(b)** Rename the predicate to something like `leavesCachedResourceCurrent` and say explicitly that marking stores no quiz state while accounting is still recorded. Keep the invalidation exemption unchanged.

4. **Low — Stage A leaves several comments contradicting the code or each other.**

   - **(a)** These are directly inspectable:

     - [reading-view-overview.md](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/docs/project/reading-view-overview.md:5) still describes only seven modes taking turns in the band, omitting Outline, Timeline, Referee, and Remember.
     - [visitor.ts](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/visitor.ts:24) still says “three of the eight modes”; with all artefacts present, seven of thirteen return `null`.
     - [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/App.tsx:2639) says `visitorGap` “fails closed”; the new total record instead fails compilation, and a forced unknown value throws.
     - [App.tsx](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/App.tsx:2642) says four modes cost a model call; there are six.
     - [CriteriaPanel.tsx](/home/greg/code/spideryarn2/.claude/worktrees/adding-a-mode/src/web/CriteriaPanel.tsx:303) quotes Timeline’s note as saying “belongs in both,” while this same commit changes that note to “all three.”
   - **(b)** Remove changing counts where possible; otherwise update them to thirteen/seven/six, describe `POLICY` as compile-time total rather than fail-closed, and delete the obsolete quotation.

## Requested checks

### T1.3 semantics

Every mode has the same return before and after:

| Mode | Old and new result |
|---|---|
| plain | `null` |
| hierarchy | `null` |
| outline | `null` |
| summary | `null` |
| glossary | `null` iff `available.glossary`; otherwise its same `not-built` gap |
| ideas | `null` iff `available.ideas`; otherwise its same `not-built` gap |
| quotes | `null` iff `available.quotes`; otherwise its same `not-built` gap |
| search | `owners-only`, “Search” |
| chat | `owners-only`, “Chat” |
| remember | `owners-only`, “Remember” |
| diagram | `owners-only`, “Diagram” |
| timeline | `owners-only`, “Timeline” |
| referee | `owners-only`, “Referee” |

`MODE_LABEL` contains exactly the former six `COSTS` words: Search, Chat, Remember, Diagram, Timeline, Referee.

Consequently `markedModes` has unchanged keys and sentences, and the dock tooltip—reading that map—has unchanged output. The browser trace independently pins all six literal sentences.

### Deleted visitor assertion

The deleted assertion guarded only the label supplied after a result was already `owners-only`. It explicitly skipped `available`, `artefact`, and `null`, so it could not catch a spending mode wrongly marked `available`.

Wrong current rows remain well covered:

- The six spending modes are explicitly required to return `owners-only`.
- The four always-free and three artefact modes are checked independently.
- One-hot artefact fixtures catch crossed keys.
- The expected `markedModes` set catches category changes.
- `BAND_SAYS: Record<Mode, …>` exercises the resulting visitor UI independently.

A missing row is caught by `Record<Mode, VisitorPolicy>`; a wrong row is caught by those behavioral expectations.

### T1.1 types

The author’s reasoning is correct. `satisfies readonly ModeUi[]` contextually checks each `mode` against the literal union `Mode` while retaining the literals present in the array. Therefore `(typeof MODES_UI)[number]["mode"]` is the union of actual rows.

Deleting one row makes:

```ts
Exclude<Mode, (typeof MODES_UI)[number]["mode"]>
```

that missing literal, which violates the default generic’s `T extends never` constraint.

`as const` would make the array a tuple of thirteen distinct readonly object shapes; twelve shapes have no `keepLabel` property, so accessing `m.keepLabel` on their union would fail. I did not run typecheck, as instructed.

### T0.1 cache behavior

The mark changes no quiz-backed state: no score, attempt, answer, or batch is written, and the cached quiz GET reflects none of the accounting ledger. The invalidation exemption is therefore semantically correct despite the misleading `storesNothing` name.

The referee exclusion is also honest:

- `slugOf("/api/referee/criteria/gibbon")` returns `"criteria"`.
- `resourceOf(...)` returns `"/api/referee/criteria"`, whose prefix invalidation spans every article.
- The test waits for fire-and-forget caching and directly asserts `writeCached` was not called for both Referee GETs.

### Raw mode IDs

The requested grep found only:

- `key={mode}` — React identity, not rendered.
- `mode={mode}` passed into `Dock`.
- `mode={mode}` passed into `DockModes`.

No remaining hit renders the raw id to a reader. Visible text, titles, tooltips, and ARIA labels use `MODE_LABEL`.

### Tests

All requested tests passed:

- `visitor-gaps.test.ts`: 19/19
- `public-network-trace.test.tsx`: 35/35
- `cacheable-covers-artefact-routes.test.ts`: 15/15
- `api-fetch-offline.test.ts`: 24/24

I also ran `passage-mode-cleanup.test.tsx`: 3/3. Its preconditions make it non-vacuous, although it is much larger than the “small contract test” promised by the revised plan.

## Verdict

**Ship with changes.** Current visitor and cache behavior is correct, but I would close the self-shrinking cache test and the remaining headerless-response hole, then correct the false contract language before landing.