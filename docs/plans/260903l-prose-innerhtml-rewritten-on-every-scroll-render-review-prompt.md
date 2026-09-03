# Review request: built code, not a plan

You are reviewing **already-built code** in the Spideryarn repo (an AI-assisted reading app;
TypeScript, React 19, Vite). Weight this higher than a plan review: the bugs are in the diff.

Read, in this order:

1. `docs/plans/260903l-prose-innerhtml-rewritten-on-every-scroll-render.md` — the plan, the
   measurement, the reasoning, and what was deliberately not done.
2. The diff below (also reproducible with `git diff -- src/web/TableView.tsx scripts/measure-cpu.ts`).
3. `src/web/TableView.tsx` around `proseHtml` / `proseCache` for full context.
4. `docs/project/performance.md` — the standing knowledge about this page, including the many ways a
   measurement here has lied before.

## What the change claims

React compares `dangerouslySetInnerHTML` by the identity of its `{ __html }` wrapper, and then
writes `domElement.innerHTML` **unconditionally** with no check against the current contents. So a
fresh object literal in JSX rebuilt all 551 prose paragraphs on every `TableView` render — 18,734
subtree rebuilds during one scroll, all byte-identical. The fix memoises the wrapper objects and
reuses them when the html is unchanged.

Measured, production build, 25s of wheel events, three runs a side:
main-thread CPU **77.1% → 49.0%** of one core; `LayoutDuration` **17.1% → 0.8%**;
`RecalcStyleDuration` **10.6% → 0.9%**; prose mutations **18,734 → 0**.

## What I most want you to attack

1. **Is the React claim actually right?** I read it out of
   `node_modules/react-dom/cjs/react-dom-client.development.js` — the identity test at ~line 21007
   and the unconditional `domElement.innerHTML = key` at ~line 20419. Check the *production* build
   too (`react-dom-client.production.js`), since every number I quote is from a production bundle
   and I only read the development source. If production compares the string, my mechanism is wrong
   even though the measurement is real, and the explanation in the docs would be a lie that outlives
   the fix.
2. **The `useRef` written during render.** `proseCache.current` is assigned inside `useMemo`. I argue
   it is safe because it is a cache keyed on value equality, so any reuse is an object whose
   `__html` is `===` what we just computed. Is there a concurrent-rendering, Offscreen/Activity, or
   StrictMode case where this is wrong, or wrong *enough to matter*? Two `TableView` instances
   mounted at once would share nothing (the ref is per-instance) — confirm that.
3. **Did I break annotation?** The map now holds an entry for **every** block; it used to hold only
   blocks whose html differed from `block.html`. `proseHtml` is also a dependency of the
   `markReturnPath` effect. Does covering every block change that effect's behaviour, or the
   `TAP_ATTR` / hover-card assumption (documented in `useHoverCard.ts`) that React replaces those
   nodes wholesale and a stale mark leaves with the node it was on? **That assumption is the one I
   am most worried about** — the fix's entire point is that React now *stops* replacing those nodes,
   so anything that was relying on the churn to clear state is now broken. Please go and check the
   consumers rather than reasoning about it.
4. **The fallback.** `proseHtml.get(block.id) ?? { __html: block.html }` reintroduces a fresh object
   on a path I claim is unreachable. Is it genuinely unreachable (rows map over the same `blocks`
   array the memo iterates)? Is silently-degraded performance the right failure mode, or should it
   be impossible by construction?
5. **The measurement.** `docs/project/performance.md` lists a dozen ways a number here has been
   wrong before — a page that never rendered, a window straddling a reload, two Chromes on one port.
   Attack the methodology: 551 rows and 66,123px are reported on every run; before and after differ
   only in that one JSX expression (I flipped it back, rebuilt, re-measured, flipped it forward);
   both sides ran against the same `vite preview` and the same Postgres. What would you not believe?
6. **`scripts/measure-cpu.ts`.** The new `--cpu-profile` (self-time attribution) and `--sign-in-via`
   (carry the SDK's stored token to another origin so a production build can be measured signed in).
   Is the token carry sound, and is it appropriately fenced to localhost? Note `seed-local-session.ts`
   already refuses any non-local Supabase. Also: `ProcessTime` reads 0 under headless Chrome, so I
   am quoting main-thread CPU only — is there a way to recover the whole-renderer figure headlessly,
   and does its absence undermine any claim I made?

## What you can run

The tree is read-only but you may run a single test file or a script:

- `npx vitest run tests/table-view.test.ts`
- `node --import tsx <script>`

Do **not** run `npm test` or `npm run typecheck` (the sandbox blocks them). `npm run typecheck`
passed and the related suites (`table-view`, `annotate`, `zoomable`, `spine-scroll`) are green — 103
tests.

Please be concrete: cite file and line, say what breaks and under what input, and rank findings by
severity. If you think the fix is right, say which of my claims you actually verified versus took on
trust — I would rather know that than get agreement.
## The diff

Quoted output, not citations — the paths inside these doc comments are relative to `scripts/`.

```diff
diff --git a/scripts/measure-cpu.ts b/scripts/measure-cpu.ts
index 1560d76c..a53d993a 100644
--- a/scripts/measure-cpu.ts
+++ b/scripts/measure-cpu.ts
@@ -75,8 +75,47 @@ import { join } from "node:path";
 import { setTimeout as sleep } from "node:timers/promises";
 import { localMagicLink } from "./seed-local-session.js";
 
+/**
+ * Which Chrome, and it is not the same one on every machine.
+ *
+ * This was the macOS path as a bare constant until 2026-09-03, which made the
+ * whole instrument unrunnable on the remote box — where there is exactly one
+ * browser, system Chrome at `/usr/bin/google-chrome-stable`, and the reason
+ * [browser-control.md](../docs/project/browser-control.md) says the mechanism
+ * is decided by the machine rather than by preference. The failure was at
+ * least loud (`ENOENT`), which is more than most of the traps on
+ * [performance.md](../docs/project/performance.md) manage.
+ *
+ * `SPIDERYARN_CHROME` wins, so a machine with Chrome somewhere else needs no
+ * edit here.
+ */
 const CHROME =
-  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
+  process.env.SPIDERYARN_CHROME ||
+  (process.platform === "darwin"
+    ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
+    : "/usr/bin/google-chrome-stable");
+
+/**
+ * A headless box has no screen, and a tab with no screen is not a fair test.
+ *
+ * Chrome will not start at all without one, and the two ways out are not
+ * equivalent for our purpose. `--headless=new` composites for real but is
+ * still its own rendering path; an **X server** — the box has Xvfb, and
+ * `:99` is the one noVNC shows — gives an ordinary visible tab, which matters
+ * more here than anywhere else: `document.visibilityState` drives the pauses
+ * in `useJobs` and `useNow`, `requestAnimationFrame` does not run at all in a
+ * hidden document, and the single most repeated trap on
+ * [performance.md](../docs/project/performance.md) is a harness that could not
+ * produce a genuinely-visible reading and concluded the renderer was frozen.
+ *
+ * So: an inherited `DISPLAY` is used as-is, and otherwise we go headless and
+ * say so. `--display :99` forces one.
+ */
+const display = (() => {
+  const i = process.argv.indexOf("--display");
+  return i === -1 ? process.env.DISPLAY : process.argv[i + 1];
+})();
+const HEADLESS = process.platform !== "darwin" && !display;
 /**
  * Chrome's debugging port, chosen by Chrome rather than by us.
  *
@@ -150,6 +189,88 @@ const INTERESTING = [
 
 type Metrics = Record<string, number>;
 
+/** The shape `Profiler.stop` returns. Only the fields we read are named. */
+interface CpuProfile {
+  nodes: {
+    id: number;
+    callFrame: { functionName: string; url: string; lineNumber: number };
+    children?: number[];
+  }[];
+  /** One entry per sample: the id of the node that was on top of the stack. */
+  samples?: number[];
+  /** Deltas in microseconds, one per sample. */
+  timeDeltas?: number[];
+}
+
+/**
+ * Turn a sampling profile into the only two lists worth reading.
+ *
+ * **Self time, not total time.** A flame graph's fat frame is usually
+ * `performSyncWorkOnRoot`, which tells you React was busy and nothing about
+ * why. Self time is where the samples actually landed, so the answer is a
+ * function you can go and open.
+ *
+ * Frames are grouped by `functionName @ file:line`, because the same name in
+ * two files is two functions and summing them would invent a hotspot that is
+ * not there. Our own code is separated from `node_modules` and the browser's
+ * own frames, since "46% of script is ours" and "46% is React's reconciler"
+ * point at completely different fixes.
+ */
+function reportProfile(profile: CpuProfile, out: string): void {
+  if (out) {
+    writeFileSync(out, JSON.stringify(profile));
+    console.log(`cpu profile written to ${out} (load it in DevTools → Performance)`);
+  }
+  const { nodes, samples, timeDeltas } = profile;
+  if (!samples?.length || !timeDeltas?.length) {
+    console.log("  ⚠ profile has no samples — did the window contain any script at all?");
+    return;
+  }
+  const byId = new Map(nodes.map((n) => [n.id, n]));
+  const self = new Map<string, { ms: number; ours: boolean }>();
+  let total = 0;
+  for (let i = 0; i < samples.length; i++) {
+    const node = byId.get(samples[i] as number);
+    /* `timeDeltas[i]` is the gap *before* sample i, which is the interval the
+       sample stands for. Microseconds. */
+    const ms = (timeDeltas[i] ?? 0) / 1000;
+    if (!node || ms <= 0) continue;
+    const f = node.callFrame;
+    const name = f.functionName || "(anonymous)";
+    /* Chrome's synthetic frames — (program), (idle), (garbage collector) —
+       carry no url. (idle) is not cost and must not be totalled with the rest,
+       or every percentage below is quietly diluted by however long the page
+       spent doing nothing. */
+    if (name === "(idle)" || name === "(program)") continue;
+    const where = f.url ? `${f.url.replace(/^https?:\/\/[^/]+/, "")}:${f.lineNumber + 1}` : "";
+    const ours = where.startsWith("/src/") || where.startsWith("/scripts/");
+    const key = where ? `${name} @ ${where}` : name;
+    const prev = self.get(key);
+    if (prev) prev.ms += ms;
+    else self.set(key, { ms, ours });
+    total += ms;
+  }
+  if (total <= 0) {
+    console.log("  ⚠ profile totalled no script time — the page was idle, or the sampler missed");
+    return;
+  }
+  const ranked = [...self.entries()].sort((a, b) => b[1].ms - a[1].ms);
+  const ourMs = ranked.reduce((n, [, v]) => n + (v.ours ? v.ms : 0), 0);
+  console.log(
+    `\ncpu profile: ${total.toFixed(0)}ms of script in ${samples.length} samples — ` +
+      `${((ourMs / total) * 100).toFixed(0)}% of it in src/`,
+  );
+  const show = (label: string, rows: [string, { ms: number }][]) => {
+    if (rows.length === 0) return;
+    console.log(`  ${label}`);
+    for (const [key, v] of rows.slice(0, 12)) {
+      console.log(`    ${v.ms.toFixed(0).padStart(6)}ms ${((v.ms / total) * 100).toFixed(1).padStart(5)}%  ${key}`);
+    }
+  };
+  show("hottest in src/ (self time):", ranked.filter(([, v]) => v.ours));
+  show("hottest elsewhere (self time):", ranked.filter(([, v]) => !v.ours));
+}
+
 /**
  * One CDP connection, with request ids and a promise per outstanding call.
  *
@@ -341,8 +462,11 @@ async function main(): Promise<void> {
      redirect: the app is on PKCE, and a browser that did not start the flow has
      no code verifier to finish it with. Start on the origin so the module graph
      is loaded and the app's own SDK instance is importable. */
-  const link = has("local-sign-in") ? await localMagicLink(url) : null;
-  const startUrl = link ? new URL(url).origin : url;
+  /* Where the signing-in happens, which is not always where the measuring
+     happens. Empty unless `--sign-in-via` is passed; see the carry below. */
+  const via = flag("sign-in-via", "");
+  const link = has("local-sign-in") ? await localMagicLink(via || url) : null;
+  const startUrl = link ? new URL(via || url).origin : url;
 
   let chrome: ChildProcess | null = null;
   let cdp: Cdp | null = null;
@@ -365,9 +489,15 @@ async function main(): Promise<void> {
         "--disable-backgrounding-occluded-windows",
         "--disable-renderer-backgrounding",
         "--disable-background-timer-throttling",
+        // No screen on this machine. See HEADLESS above for why an X display
+        // is preferred when there is one: a headless tab is honest about its
+        // visibility, but an ordinary visible tab is what we ship.
+        ...(HEADLESS ? ["--headless=new", "--disable-gpu"] : []),
         startUrl,
       ],
-      { stdio: "ignore" },
+      // `--display` has to reach the child as an env var; Chrome has no flag
+      // for it. An inherited DISPLAY already arrives this way.
+      { stdio: "ignore", env: display ? { ...process.env, DISPLAY: display } : process.env },
     );
 
     PORT = await readDebugPort(profile);
@@ -411,6 +541,47 @@ async function main(): Promise<void> {
       const said = signIn.result.value;
       if (!said.startsWith("ok:")) throw new Error(`local sign-in failed — ${said}`);
       console.log(`signed in locally (${said.slice(3)})`);
+
+      /* Carry that session to another origin, which is the only way to measure
+         a **production build** signed in.
+
+         The trick above needs `import('/src/web/lib/supabase.ts')`, and only a
+         dev server serves a module at its source path — so against `vite
+         preview` it throws, and "nothing here has been measured on a
+         production build" stayed an open item on performance.md for a week.
+         `--sign-in-via <dev origin>` signs in there and copies the stored
+         token across, which is not the same thing as writing the session
+         ourselves: the string moved is the one the SDK wrote, in whatever
+         format that version of the SDK writes, so it cannot drift out of step
+         with the client that has to read it. Only the *origin* changes, and
+         both are localhost.
+
+         `sb-…-auth-token` is the SDK's own key and its name follows the
+         Supabase URL's host, so it is matched by prefix rather than spelled
+         out here. `spideryarn.lastUser` rides along because the app reads it
+         on boot. */
+      const target = new URL(url).origin;
+      if (via && target !== new URL(via).origin) {
+        const dump = await cdp.send<{ result: { value: string } }>("Runtime.evaluate", {
+          expression: `JSON.stringify(Object.fromEntries(Object.entries(localStorage)
+            .filter(([k]) => k.startsWith('sb-') || k.startsWith('spideryarn.'))))`,
+          returnByValue: true,
+        });
+        const carried = JSON.parse(dump.result.value) as Record<string, string>;
+        const keys = Object.keys(carried);
+        if (keys.length === 0) throw new Error("nothing to carry — the SDK stored no session");
+        /* Navigate first: `localStorage` is per origin, so this has to be
+           written while the browser is standing on the origin that will read
+           it. Blank rather than the article, so the app does not boot signed
+           out and cache a 401 before the token lands. */
+        await cdp.send("Page.navigate", { url: `${target}/favicon.ico` });
+        await sleep(1500);
+        await cdp.send("Runtime.evaluate", {
+          expression: `(() => { const s = ${JSON.stringify(JSON.stringify(carried))};
+            for (const [k, v] of Object.entries(JSON.parse(s))) localStorage.setItem(k, v); })()`,
+        });
+        console.log(`carried ${keys.length} storage keys to ${target}`);
+      }
       await cdp.send("Page.navigate", { url });
     }
 
@@ -489,8 +660,35 @@ async function main(): Promise<void> {
     console.log(
       `measuring ${seconds}s${has("hidden") ? " (tab hidden)" : ""}${scrolling ? " while scrolling" : ""}…`,
     );
+    /* A sampling profile of the measured window, when asked for.
+
+       **`ScriptDuration` says how much; only this says what.** The split into
+       script / layout / style names a *kind* of work — enough to know whether
+       to look at React or at CSS, and no further. Every scroll investigation
+       on performance.md so far has had to close that last gap by reasoning
+       about the code instead of by measuring it, which is how the diagram
+       memo's `atRow` dependency survived two rounds, and how a grep over the
+       wrong set of files came to read exactly like a grep that found
+       everything.
+
+       Off unless `--cpu-profile` is passed, because the sampler is not free —
+       it perturbs the very number the rest of this script reports. A run that
+       profiles is a run for *finding* the cost; a run that does not is the one
+       whose percentage you quote. Never the same run. */
+    const profiling = has("cpu-profile");
+    if (profiling) {
+      await cdp.send("Profiler.enable");
+      /* 100µs rather than the 1ms default: a scroll's work is thousands of
+         short frame callbacks, and at 1ms most of them fall between samples. */
+      await cdp.send("Profiler.setSamplingInterval", { interval: 100 });
+      await cdp.send("Profiler.start");
+    }
     if (scrolling) await wheel(cdp, seconds * 1000);
     else await sleep(seconds * 1000);
+    if (profiling) {
+      const prof = await cdp.send<{ profile: CpuProfile }>("Profiler.stop");
+      reportProfile(prof.profile, flag("cpu-profile", ""));
+    }
     /* The in-page probe's render counts, when the URL asked for it (`?perf=1`).
        CPU is the number that matters, but it is noisy and it does not say
        *which component* spent it. A render count is exact, causal, and answers
diff --git a/src/web/TableView.tsx b/src/web/TableView.tsx
index 305ba008..de2a1c52 100644
--- a/src/web/TableView.tsx
+++ b/src/web/TableView.tsx
@@ -458,6 +458,18 @@ export function TableView({
    */
   const termMarksByBlock = useMemo(() => termMarks(blocks, terms ?? []), [blocks, terms]);
 
+  /**
+   * Last render's `{ __html }` objects, so an unchanged block can be handed
+   * back the one React has already seen — see `proseHtml` below for why that
+   * is the whole point.
+   *
+   * A cache keyed on value equality, which is what makes writing to it during
+   * render safe: every reuse is an object whose `__html` is `===` the string
+   * we just computed, so a double-invoked or abandoned render can only ever
+   * hand back something identical. Nothing reads it for correctness.
+   */
+  const proseCache = useRef<Map<BlockId, { __html: string }>>(new Map());
+
   /**
    * The verbatim column's HTML, annotated once per change rather than once per
    * render.
@@ -483,9 +495,39 @@ export function TableView({
    * The nearby `Props` docstring on `chats` was already worried about exactly
    * this ("re-`annotateHtml` every paragraph of the article while one answer
    * arrives"); this is the line that makes that worry unnecessary.
+   *
+   * ## Why this holds `{ __html }` objects rather than strings
+   *
+   * **React does not compare the html. It compares the object.** Its update
+   * path decides a prop changed with `!==` on the value
+   * (`react-dom` § `updateProperties`), and for `dangerouslySetInnerHTML` that
+   * value is the `{ __html: … }` wrapper — so a fresh object literal in the
+   * JSX is *always* "changed", and `setProp` then runs
+   * `domElement.innerHTML = …` **unconditionally**, with no test against what
+   * is already there. Writing the identical string still tears the paragraph's
+   * DOM down and rebuilds it.
+   *
+   * Measured on a 551-block article, 2026-09-03: a plain scroll re-rendered
+   * `TableView` 34 times and rewrote **18,734** prose subtrees — 34 × 551,
+   * every block every time, every one of them byte-identical. That churn, not
+   * React's own reconciliation, was the largest single cost of scrolling, and
+   * it is what put layout and style recalculation above script in a production
+   * build. performance.md § What scrolling actually cost.
+   *
+   * So the memo hands out the *same object* for a block whose html has not
+   * changed, and React skips it entirely. Two consequences worth keeping:
+   *
+   * - **Every block gets an entry**, not just the marked minority. An entry
+   *   missing here would fall back to a literal in the JSX and quietly get the
+   *   old behaviour back for that block.
+   * - **Entries survive a recompute.** When one comment arrives, this memo
+   *   re-runs for all 551 blocks, but only the blocks whose html actually
+   *   changed get new objects — so a streaming answer rewrites the paragraphs
+   *   it touches instead of the article.
    */
   const proseHtml = useMemo(() => {
-    const byBlock = new Map<BlockId, string>();
+    const was = proseCache.current;
+    const byBlock = new Map<BlockId, { __html: string }>();
     for (const block of blocks) {
       /* Both kinds in one call. `annotateHtml` cuts each text node at every
          mark boundary in one pass, so a comment and a term over the same words
@@ -513,8 +555,15 @@ export function TableView({
          prose costs one regex. See zoomable.ts § the four load-bearing things,
          the third of which is this ordering. */
       const withHandles = addZoomHandles(marked);
-      if (withHandles !== block.html) byBlock.set(block.id, withHandles);
+      /* **Every block, and the same object when the html has not changed.**
+         Both halves of that are load-bearing; see the docstring above. */
+      const had = was.get(block.id);
+      byBlock.set(
+        block.id,
+        had && had.__html === withHandles ? had : { __html: withHandles },
+      );
     }
+    proseCache.current = byBlock;
     return byBlock;
   }, [blocks, marksByBlock, termMarksByBlock, hitMarks, openTerm]);
 
@@ -971,10 +1020,15 @@ export function TableView({
                 />
                 <div
                   className="prose"
-                  /* Looked up, not computed — see `proseHtml` above. A block
-                     with no marks is absent from the map and renders its own
-                     html untouched. */
-                  dangerouslySetInnerHTML={{ __html: proseHtml.get(block.id) ?? block.html }}
+                  /* Looked up, not built here — and the lookup is the fix.
+                     An object literal in this position is a new object every
+                     render, which React reads as a change and answers with an
+                     unconditional `innerHTML =`; `proseHtml` above has the
+                     measurement. The map covers every block, so the fallback
+                     is unreachable — it is here so that a block that somehow
+                     escaped the memo still renders its own prose rather than
+                     an empty paragraph. */
+                  dangerouslySetInnerHTML={proseHtml.get(block.id) ?? { __html: block.html }}
                 />
               </td>
             )}
```
