# Second code review, after your findings were fixed

You reviewed this code and returned **not safe to commit**, with five findings. All five were
right, including a typecheck error I had introduced after my last typecheck run. Everything has
been fixed. This is the re-review.

Read-only — do not edit files. Rank findings, mark must-fix / should-fix / note, and end with a
one-line verdict: safe to commit, or not.

## What to read

- `docs/plans/glossary-read-latency-code-review-sol.md` — your previous review.
- `docs/plans/glossary-read-latency.md` — the plan; its "How each part is checked" section was
  rewritten around your fifth finding.
- `docs/plans/glossary-read-latency-code.diff` — **regenerated**, so it is no longer stale.
- `docs/plans/glossary-read-latency-new-tests.txt` — the three new test files in full.
- The live files, for anything the diff clips.

`src/web/App.tsx` still has another agent's concurrent work in it (`ReviewStance`, `ThreadKind`,
`Mode`, a review-mode band). Mine are only the `useGlossaryRead` call, `terms`, the `GlossaryBand`
props and the deleted `onEntries` effect.

## What changed since your review

1. **Typecheck** — `let run: Promise<void> | undefined`. `npm run typecheck` reports nothing for
   any file in this change.
2. **A joined request is no longer an answer to "it changed".** `GlossaryRead` now has two
   operations. `reload()` joins an in-flight request and is used only by the band's mount.
   `refresh()` is used by `onFinished` and arms a **trailing** fetch that runs after the current
   one, in `fetchNow`'s `finally`, guarded on still being the current generation.
3. **A lookup is no longer erased.** `patchEntry` still does not bump the generation — that would
   lose completed-job refreshes, as you said — but if a request is in flight it arms the same
   trailing read, so the answer comes back from the server, which has it by then.
4. **A failed background revalidation keeps the list.** The catch now does
   `setStatus(was => was === "loading" ? "error" : was)`. The error is still reported; the panel
   renders it above the list.
5. **The test gaps.** `tests/glossary-band-wiring.test.ts` now exists (source-level, labelled as
   such). `useJobs` is posed rather than inert, so `onFinished` is exercised. `blocksQuery` is
   exported and its SQL asserted, so reverting it to a bare `.select()` fails. A tree-only ideas
   case is asserted as a property in `store-block-reads.test.ts`. The plan no longer claims tests
   that do not exist. The `Promise.all` comment no longer claims guaranteed concurrency.

**The mock had to be fixed before two of the new tests meant anything.** It built the response
body at reply time, so a request issued before a change was answered with the state after it —
joining a stale request and running a fresh one were indistinguishable, and both new tests passed
on the broken code. It now snapshots the body when the request arrives.

## Evidence: every guard seen to fail

- `onFinished` using `reload` → "does not miss a job that finished while a request was in flight" red.
- `patchEntry` not arming the trailing read → "keeps the checked term..." red.
- Unconditional `setStatus("error")` → "keeps the list when a background revalidation fails" red.
- Band's mount revalidate deleted → "still picks up a glossary written while it was closed" red.
- Generation guard deleted → both race tests red (only after the mock and the release order were
  fixed; before that, one of them passed without the guard).
- A second `useGlossaryRead(slug)` in `App.tsx` → wiring test red.
- `arc` dropped from the `article` projection → projection test red.
- A policy key omitted → **compile** error.

193 tests pass across the suites this change touches. Lint clean on the touched files.

## What I most want you to attack

1. **The trailing-fetch mechanism.** `trailing` is a boolean, set by `refresh()` and by
   `patchEntry`, consumed in `fetchNow`'s `finally` behind `mine === generation.current`. Where
   does it drop a refresh, run one too many, or loop? Specifically: `refresh()` returns the
   *joined* promise, which resolves before the trailing fetch it armed has run — is that a lie to
   any caller? `reset()` awaits `run(false)` after `clear()`; `clear()` sets `trailing = false` —
   right or wrong? Can a `refresh()` arriving during the trailing fetch itself be lost?
2. **`fetchLatest` — a ref updated during render, read in an async `finally`.** Is that sound, or
   can it call a `fetchNow` closed over a stale slug after a slug change?
3. **The status machine.** `loading → ready|none|error`, and after that never back to `loading`.
   With the new catch rule, is there a state where the panel shows a list *and* a message that
   contradicts it, or an error that never clears? `error` is set in the catch and cleared on
   success — is it cleared on every path that should clear it?
4. **Whether the fixes moved the bug rather than fixing it.** Particularly 3: is the trailing read
   after a lookup actually guaranteed to see the stored lookup, or is there a window where the
   POST has returned but the read still misses it?
5. **The new tests.** Which of them could still pass while the thing it names is broken? I found
   three that could and fixed them; assume there is a fourth.
6. **Anything in the regenerated diff that is wrong**, and anything you have not been told about.
