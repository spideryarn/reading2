# Review request: the plan for a second round of client CPU work

You are reviewing a **plan**, before anything is built. Be adversarial about the plan's reasoning,
its sequencing, and above all its claims of safety.

Repo: `/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu` (a git worktree; work only here).

## Read, in this order

1. `docs/plans/260904a-more-scroll-cpu-wins.md` — **the plan under review**.
2. `docs/plans/260903l-prose-innerhtml-rewritten-on-every-scroll-render.md` — the work that just
   shipped and that this follows. You reviewed the built code for that one.
3. `docs/project/performance.md` — at minimum "The last column is not CPU", "Render counts beat
   percentages", "Still open, ranked, with citations".
4. `CLAUDE.md` — the house rules the plan has to satisfy. "Prefer boring", "prefer simple over easy",
   "simplest version first".

Then the code the plan names: `src/web/TableView.tsx`, `src/web/App.tsx` (the `<TableView …>` call
site starts at line 2570, `useReadingPosition` at 1284), `src/web/BlockRef.tsx`,
`src/web/BlockGutter.tsx`, `src/web/params.ts`, `src/web/search-hits.ts`, `src/web/annotate.ts`.

## Context you need

Greg's instruction was: *"looking for a few more big wins that won't add too much complexity"*. Two
clean wins beat four braided ones. A recommendation that adds machinery has to earn it.

The reading view is a `<table class="zoom">`, `table-layout: fixed`, one `<tr data-block>` per block,
551 rows / 66,123px / ~14,370 nodes on the test article. Prose is injected with
`dangerouslySetInnerHTML`. `TableView` re-renders ~34 times during one scroll because
`useReadingPosition` writes `?at=` as sections pass the reading line.

A read-only survey (by another agent, so treat its findings as claims to check, not facts) reported:
`TableView` takes 28 props, 24 already identity-stable, 4 unstable and all four trivially fixable
inline arrows; no `createContext` anywhere in `src/`; nothing inside `TableView` or its children
calls `useQueryState`; and `at` is never passed to `TableView` nor derived into any of its props.

## What I want from you

**Please actually open the files and check the load-bearing claims** rather than reasoning from my
prose. Your sandbox lets you run a test file; `npx vitest run tests/prose-not-rebuilt.test.tsx` is
the relevant one and it currently passes.

1. **Is `React.memo(TableView)` actually safe here?** This is the crux. Specifically:
   - Verify or refute the claim that no `TableView` prop depends on `at`. Check `App.tsx:1284–1394`
     and the call site.
   - Verify or refute "no context anywhere in `src/`", and that nothing under `TableView` subscribes
     to the URL.
   - **`onJump` is `jumpTo`, a `useCallback([setAt])` where `setAt` comes from nuqs `useQueryState`.**
     The survey asserts nuqs v2 setters are identity-stable across renders. If that is wrong, the
     memo never matches and the whole stage is worthless. Check it against the installed nuqs
     version in `node_modules`, not from memory.
   - Are there other props whose *memo dependencies* are themselves unstable? The survey checked one
     level; check two.
2. **The `blockHref` hazard.** `src/web/BlockRef.tsx:64` reads `location.search` during render with
   no subscription, and its docstring says that is safe only because every URL parameter re-renders
   the whole tree. The plan proposes auditing every parameter in `params.ts`. **Do that audit
   yourself** and tell me which parameters, if any, would leave stale permalinks behind a
   `React.memo(TableView)`. Name them. If the audit shows a hole, say what the smallest correct fix
   is — I would rather learn that now than after it ships.
3. **Stage 1, the `page(blocks)` WeakMap.** Is a `WeakMap` keyed on the `blocks` array identity
   correct here — can the same array identity ever hold different content? Is `findLiteral` really
   computing the same thing `page()` does, or does it differ in a way the plan has missed? Is there
   a reason `page()` was not already cached that I have failed to notice?
4. **Sequencing.** Is stages 1 → 2 → 3 → 4 the right order for value-per-unit-work? Would you
   reorder, drop, or merge any of them? In particular: stage 3 (hover re-renders the whole table)
   is unmeasured — the plan says measure first. Is that the right call, or should it come earlier?
5. **What the plan has missed.** A cheaper win, a structural idea, or a risk none of the above names.
   Look for it in the code rather than in the plan. The floor experiment says ~20 of the remaining
   ~49% of a core is irreducible browser cost for a document this size — anything that legitimately
   attacks *that* without breaking the "whole document present, addressed by stable block id"
   contract is especially welcome. (I considered `content-visibility: auto` on rows and believe it is
   a no-op, because CSS containment does not apply to internal table elements such as `table-row`.
   Confirm or refute that, from the spec or from Chromium's behaviour.)
6. **Anything in the plan that is overstated or false.** The last review caught me calling
   `LayoutDuration` a percentage of a core. Do it again.

Be specific and cite file:line. Say explicitly what you verified by opening the file or running
something, and what you took on trust.
