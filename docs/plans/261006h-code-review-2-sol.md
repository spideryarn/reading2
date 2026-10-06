- **D1 — P1, reproduced: a late initial session strips a cold shared link.** [App.tsx:220](/var/tmp/spideryarn-worktrees/qi-9wyhwqre-reader-keyed-storage/src/web/App.tsx:220) treats `!loading` as a known session. But [useSession.ts:87](/var/tmp/spideryarn-worktrees/qi-9wyhwqre-reader-keyed-storage/src/web/useSession.ts:87) ends loading after eight seconds even without an answer. The hook then records a signed-out article arrival. When `INITIAL_SESSION` later identifies A, it mistakes that for a reader change and strips the link’s parameters.

  In an in-memory regression test, `/read/slow-cold?mode=glossary&at=spya-d2w4rt` became `/read/slow-cold`, and A’s record became empty. The same test **passed with the previous ArticlePage placement**.

  **Smallest fix:** distinguish “loading deadline elapsed” from “session actually known.” Keep the hook’s slug null until an actual session notification arrives. Preserve the signed-out fallback UI and add this regression test.

- **D2 — P3, reasoned: the settings-store comment contradicts the new wiring.** [App.tsx:199](/var/tmp/spideryarn-worktrees/qi-9wyhwqre-reader-keyed-storage/src/web/App.tsx:199) still says “nothing here wakes it,” but App now subscribes through `useLastView` on every route. Signed-in visits therefore wake its settings request; signed-out visits issue none. Store updates also rerender App. The article already subscribed before this move, so this alone does not establish an article regression.

  **Smallest fix:** update the comment to describe the unconditional App subscription and remove the claim that Reader replaced it.

The requested command passed: **5 files, 105 tests**. Ordinary cold loads, shelf returns, article jumps, metadata transitions, and direct/sign-out/sign-in reader switches remain supported. The access gate delays reading-mode descendants until after the rewrite, addressing the effect-order concern. Modeling the awaited reauthentication notification cleared A’s URL before reload; I did not establish that suspected exposure.

No files changed.

VERDICT: rework