The `TableView` fix is technically sound, and I found no annotation regression. I would land that part. I would fix the measurement helper and documentation issues below before landing the whole diff.

## Findings

1. **Medium — `--sign-in-via` is not fenced to localhost.**

   [measure-cpu.ts:563](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/scripts/measure-cpu.ts:563) accepts arbitrary `via` and target origins. The guard in [seed-local-session.ts:95](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/scripts/seed-local-session.ts:95) validates only `SUPABASE_URL`, not either browser origin.

   Under:

   ```text
   --local-sign-in
   --sign-in-via http://localhost:5273
   --url https://attacker.example/
   ```

   the script copies the local Supabase bearer token and every `spideryarn.*` key into `attacker.example`’s `localStorage`, then loads its JavaScript. A hostile `via` origin could also provide the dynamically imported `/src/web/lib/supabase.ts` and receive the magic-link hash.

   Validate both origins as exact `http(s)://localhost` or `127.0.0.1` before minting anything, and copy `spideryarn.lastUser` specifically rather than the entire namespace. The blast radius is a local-development session, hence medium rather than high.

   Also replace the fixed 1.5-second wait at [measure-cpu.ts:577](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/scripts/measure-cpu.ts:577) with an assertion/poll that `location.origin === target`; otherwise a slow navigation can write into the source origin and continue signed out.

2. **Medium — production CPU-profile attribution cannot distinguish app code from dependencies.**

   [measure-cpu.ts:245](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/scripts/measure-cpu.ts:245) calls a frame “ours” only when its raw URL begins `/src/` or `/scripts/`. In a Vite production bundle, app and dependency frames both point into `/assets/...js`, so the CLI will report essentially all production samples as “elsewhere.” Raw CDP profiles do not arrive source-map-resolved; DevTools applies that mapping when loading the file.

   The self-time ranking itself remains useful. The claimed `src/` versus external split is reliable in dev only. Either resolve source maps in the script or remove/qualify that split for production.

3. **Low — bare `--cpu-profile` can treat the next flag as an output filename.**

   The generic parser at [measure-cpu.ts:154](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/scripts/measure-cpu.ts:154) returns the next argument even when it starts with `--`. Thus:

   ```text
   --cpu-profile --scroll
   ```

   attempts to write the profile to a file named `--scroll`. It still recognizes scrolling separately, making this especially unobvious. Treat a following `--…` as “no value,” or split this into `--cpu-profile` plus `--cpu-profile-out PATH`.

4. **Low — several durable explanations are currently false or overstated.**

   - [TableView.tsx:552](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/TableView.tsx:552) still says the map holds only changed blocks; it now deliberately holds every block.
   - The plan says “three runs each side,” but records only two before values at [the plan:13](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/plans/260903l-prose-innerhtml-rewritten-on-every-scroll-render.md:13).
   - “Percentages are of one core” incorrectly covers `ScriptDuration`, `LayoutDuration`, and `RecalcStyleDuration`. The harness correctly documents those as wall-clock task durations at [measure-cpu.ts:729](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/scripts/measure-cpu.ts:729). Say “percentage of the measurement window”; only `ThreadTime` is the main-thread CPU counter.
   - [performance.md:690](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/project/performance.md:690) still says no production measurement exists.
   - The plan says the comment-streaming open item is “addressed,” but [performance.md:609](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/docs/project/performance.md:609) describes anchor resolution and HTML-map reconstruction, both of which still happen. This fix removes almost all resulting DOM writes; it does not remove that O(article) computation.
   - “Largest single cost of scrolling” should be “largest measured main-thread cost,” because whole-renderer CPU was unavailable.

## Answers to the main concerns

The React mechanism is verified in production. The installed React DOM 19.2.8 production build skips a prop when its value is identical at [react-dom-client.production.js:13900](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/node_modules/react-dom/cjs/react-dom-client.production.js:13900), then writes `innerHTML` without string comparison at [react-dom-client.production.js:13067](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/node_modules/react-dom/cjs/react-dom-client.production.js:13067). Your explanation is right.

The render-time ref mutation does violate React’s documented rule against reading or writing refs during render ([official `useRef` documentation](https://react.dev/reference/react/useRef)). Nevertheless, I cannot construct a stale-HTML result here:

- An abandoned render can leave the cache ahead of the committed tree.
- A later render may consequently choose an object React has not previously seen, causing one redundant write.
- It cannot suppress a necessary write: an object is reused only when its `__html` equals the newly computed string.
- StrictMode, concurrent interruption, Activity/Offscreen, and discarded `useMemo` values do not break that invariant.
- Each mounted `TableView` gets its own ref; instances share nothing.

So this is a future-contract/advisory concern, not a present correctness bug. A memoized `ProseBlock` child receiving an HTML string would avoid render-time ref access, but adds 551 component boundaries and should be measured before replacing the current solution.

Annotation remains correct:

- `markReturnPath` has an explicit cleanup at [notes-view.ts:334](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/notes-view.ts:334), and its effect still reruns whenever the `proseHtml` map is recomputed.
- `TAP_ATTR` is explicitly removed by its effect cleanup at [useHoverCard.ts:692](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/useHoverCard.ts:692).
- A genuine HTML change produces a new wrapper at [TableView.tsx:560](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/TableView.tsx:560), detaches the old target, and the existing observer closes the card at [useHoverCard.ts:722](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/useHoverCard.ts:722).
- The behavioral change is beneficial: an unrelated render or a change in another block no longer destroys the target, clears imperative state, or closes the card.

The fallback is unreachable under normal immutable React inputs: both construction and rendering iterate the exact `blocks` array at [TableView.tsx:531](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/TableView.tsx:531) and [TableView.tsx:817](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/src/web/TableView.tsx:817). It becomes reachable only if an upstream caller mutates that array in place, already a broader memoization violation. Graceful raw-prose rendering is a reasonable production failure mode; a development assertion would be optional.

For whole-renderer CPU, use `SystemInfo.getProcessInfo` through the browser-level CDP socket and difference the `cpuTime` of renderer processes. The protocol defines that counter as cumulative CPU across all process threads ([official CDP SystemInfo documentation](https://chromedevtools.github.io/devtools-protocol/tot/SystemInfo/)). In this isolated one-tab Chrome, summing renderer processes would cover the top renderer and OOPIF renderers. The missing figure does not undermine the verified main-thread CPU or mutation claims, but it does prevent a claim about total renderer/browser CPU.

Finally, I verified the code paths and arithmetic, not the historical measurements themselves. I did not receive raw run outputs, build hashes, or the mutation-census script, so I took the reported 77→49 figures, production-server state, and byte-equality observation on trust. The exact `18,734 = 34 × 551` relationship and the source mechanism strongly corroborate them.

The newly appearing, currently untracked [prose-not-rebuilt.test.tsx](/home/greg/code/spideryarn2/.claude/worktrees/scroll-cpu/tests/prose-not-rebuilt.test.tsx:163) passed both tests: zero prose mutations on an unrelated recomputation, and only the genuinely changed block rebuilt. Ensure that file is added if it is intended to ship.