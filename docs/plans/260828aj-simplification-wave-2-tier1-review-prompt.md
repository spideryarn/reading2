# Tier 1 of the simplification wave, built — review the code

You are reviewing the code built from Tier 1 of
[`docs/plans/260828aj-simplification-wave-2.md`](260828aj-simplification-wave-2.md). The plan itself was reviewed by
you before anything was built ([`260828aj-simplification-wave-2-review-sol.md`](260828aj-simplification-wave-2-review-sol.md)),
and Tier 0 was reviewed after it was built
([`260828aj-simplification-wave-2-code-review-sol.md`](260828aj-simplification-wave-2-code-review-sol.md)). This is
the third pass and it is on the built code, which is the one that matters: a plan review cannot find
a `PATCH` that writes one field and then rejects the request.

**Weight correctness over taste.** The whole tier is meant to be behaviour-preserving except where
it is explicitly not, and I have said which is which below. What I most want to know is where I have
claimed "no behaviour change" and been wrong.

## What this repo is

Spideryarn: an AI-assisted reading app. TypeScript + ESM, `tsx` to run, one server process,
Postgres via Drizzle, a React client under `src/web/`, vitest. Read `CLAUDE.md` first; then
[`docs/reusable/silent-success.md`](../reusable/silent-success.md), which is the discipline most of
this tier is about — a check that reports success while doing nothing, with the obvious verification
agreeing because it shares an assumption with the code.

**The tree is shared by about six concurrent agent sessions.** Files outside the diff below may have
moved under me. Where I say something is held back, that is why.

## The thirteen commits, and what each claims

| commit | claim |
|---|---|
| `9dad75a` | a header said the Postgres artefact store was not written; it is, and nothing in production imports it |
| `91680a1` | **the only Sentry package declared was the one we deliberately do not import.** `@sentry/node-core/light` and `@sentry/core` are imported and were undeclared; `@sentry/node` was declared and imported nowhere. Swapped, `npm install --package-lock-only`, thirteen packages out of the lockfile |
| `0e75064` | **the server half of the "an article may not address our own API" rule was inert in production.** `ownOrigins()` could only learn the host from `SPIDERYARN_ORIGINS`, which nothing has ever set. Now reads `VERCEL_PROJECT_PRODUCTION_URL` and `VERCEL_URL` |
| `c5ac05a` | **`npm run pdf` spends money and never read `.env.local`.** Fixed, and the rule added to the AST gate that already knows which CLIs spend |
| `e65d754` | ten exports nothing imports; two comments claiming a component survives a slug change when `App.tsx` keys it on the slug |
| `0a4e0db` | a dead `editTurn` that was the version **missing** the `expectedTailId` tail check; a stale duplicate `JobStore` declaring a different API from the live one |
| `5794e2a` | `stripFence` ×8 and `readJson` ×4 into `src/parse-json.ts`, with the five copies of the privacy reasoning merged |
| `2a43831` | one `pgReady` for 32 suites — **and the "loud skip" they were all built around had been silent under `npm test` all along** |
| `2765523` | `fetchOk` for six write sites, and the test on the error path that none of them had |
| `65723b1`, `8dcb7c2` | three untracked scratch files at the repo root: two deleted, one restored after a subagent disagreed with me |
| `7b2d45d`, `cfff901` | plan updates, and fencing three pasted diffs that had been breaking `tests/doc-links.test.ts` |

## The eight questions I actually want answered

1. **`stripFence` — is it really a pure dedup?** Two spellings existed:
   `.replace(/```$/, "").trim()` and `.replace(/\s*```$/, "")`. `src/search.ts`'s was the second one
   **with no trailing `.trim()`**, which the plan had not distinguished. I compared all three on 21
   inputs and got no disagreement. Find an input where they differ, or say you could not.

2. **`readJsonOrNull` puts a bare `JSON.parse` inside the module whose whole purpose is that a
   parse error must not reach a log.** The justification is that the error is discarded rather than
   thrown, so V8's quotation of the input is never built into anything. Is that airtight? And are
   `readJson` in `src/api.ts` and `readJson` in `src/store/import.ts` correctly excluded — they
   distinguish absent from corrupt, and this does not.

3. **`pgReady` — is the parameterisation right, and is `information_schema.columns` the wrong
   probe?** It is privilege-filtered, so a role that cannot see a column would get "run npm run
   db:migrate", which is a misleading message rather than a wrong verdict. Does that matter here?
   Separately: the helper opens a `pg` Pool at module load in 32 files. Is there a connection-count
   problem when vitest runs them in parallel?

4. **`fetchOk`'s exclusions.** Six sites in, eleven left out, and the docstring gives three reasons:
   a response about to be streamed, a status that is an answer rather than a failure, and a fetch
   that is not ours. Is any of the eleven wrongly excluded — or worse, is any of the six wrongly
   *included*, so that a status which used to be an ordinary answer now throws at a reader?

5. **`ownOrigins()` and the Vercel variables.** `VERCEL_URL` is the *deployment* host, which for a
   preview deployment is a per-deployment hostname. Widening the list only makes the sanitiser
   stricter — `isOwnApi` returning true removes the attribute — so I judged the failure direction
   safe without asking. Is that right? Is there a case where treating a host as ours strips
   something a reader wanted?

6. **The `loadEnvLocal` rule in `tests/paid-cli-ledger.test.ts`.** It checks the call happens inside
   `main`, with `{ deferred: false }` reach, resolving the identifier to the `./env.js` import. Can
   you defeat it? The ledger rule in the same file was beaten three ways after its first version,
   and I would rather hear it from you than from the next leak.

7. **`JobStore`, deleted against a recorded decision.** `docs/plans/260826m-simplification-audit.md` A.2 says
   "resolved: keep it — both reviewers said keep", and that text is copied into the wave-2 review
   prompt. I deleted it anyway: `5cb6602` landed a real `JobStore` in `src/store/jobs.ts`,
   implemented by `pgJobStore` and `fsJobStore` and owner-scoped, and the one in `contracts.ts` had
   drifted to a different `claim`, `get` and expiry sweep. Was that the right call, and is the
   struck-rather-than-removed A.2 the right way to record it?

8. **What did I not check?** Every one of these landed with a claim about evidence. Tell me which
   claim is the weakest.

## What is deliberately NOT here

- **Tier 2**, all of it, and **0.4** (three streaming tests). Not attempted.
- **Five call sites of `stripFence`/`readJsonOrNull`** — `arc.ts`, `toc.ts`, `summarise.ts`,
  `glossary.ts`, `ideas.ts`. A peer's supplement/apparatus work landed in all five while this was
  being written, so their hunks and mine are tangled. The helpers are committed; those five call
  sites still have their own copies at HEAD, which is consistent, just not finished.
- **`src/web/preview-colour.tsx`**, which the plan said to delete. Refused: `preview-colour.html` at
  the repo root loads it (knip does not read HTML), and the browser check it exists for was never
  made — `docs/plans/260827l-search-row-colour.md:315` records that the extension was not connected.
- **Four `editTurn` citations** in files a third session has open.

## Evidence I am claiming

- `tests/paid-cli-ledger.test.ts` 34/34, including eight controls for the new rule and a mutation
  control on the real `src/pdf-read.ts`.
- `tests/parse-json.test.ts` — the 18-input comparison against both old spellings, plus a control
  proving the comparison can fail.
- `tests/refused-writes-are-reported.test.tsx` 8/8; breaking `fetchOk` reddens 6 of the 8, and with
  that same break and this file absent, 207 tests across fifteen files all pass.
- The 32 migrated Postgres suites: 33 files, 581 passed, 2 failed serially — the two failures are
  file-level contention over one local Postgres (they pass alone; there were 65 vitest processes in
  this tree at the time). **Zero `⚠` lines, so no suite opted itself out.**
- The stderr measurement, run under the plain default reporter with a `console.warn` beside it as a
  control: the stderr line printed, the `console.warn` did not appear at all, and the run reported
  `1 skipped` rather than `1 passed`.
- `npm run knip`: "Unlisted dependencies" empty for the first time; ten exports and two types gone.
- `tests/doc-links.test.ts` 8/8, from red.

## The diff

Everything below is `git diff 0419d0e..HEAD` over the files this tier touched, minus the 28
mechanical probe migrations, which are represented by four samples in the second block.

```diff
diff --git a/package.json b/package.json
index 00a2103..8c4635d 100644
--- a/package.json
+++ b/package.json
@@ -62,7 +62,8 @@
     "@fontsource-variable/geist": "^5.3.0",
     "@fontsource-variable/geist-mono": "^5.3.0",
     "@mozilla/readability": "^0.6.0",
-    "@sentry/node": "^10.71.0",
+    "@sentry/core": "^10.71.0",
+    "@sentry/node-core": "^10.71.0",
     "@sentry/react": "^10.71.0",
     "@supabase/supabase-js": "^2.112.4",
     "@tanstack/react-table": "^8.21.3",
@@ -88,9 +89,11 @@
   },
   "devDependencies": {
     "@babel/parser": "^7.29.8",
+    "@babel/types": "^7.29.8",
     "@biomejs/biome": "2.5.10",
     "@sentry/vite-plugin": "^5.4.0",
     "@tailwindcss/vite": "^4.3.3",
+    "@tanstack/table-core": "^8.21.3",
     "@types/d3-force": "^3.0.10",
     "@types/jsdom": "^30.0.0",
     "@types/node": "^26.2.0",
diff --git a/src/chat.ts b/src/chat.ts
index 76e6c06..78c4c32 100644
--- a/src/chat.ts
+++ b/src/chat.ts
@@ -550,7 +550,7 @@ export function withRetry(
     messages: [...existing.messages.slice(0, -1), reply],
   };
   /* The whole message rather than its text, so that all three of `beginTurn`,
-     `retryTurn` and `editTurn` hand back the same pair — the question and the
+     `retryTurn` and `withEdit` hand back the same pair — the question and the
      answer beneath it — and the route can name both in its first frame without
      asking which kind of turn this was. The client needs the question's id to
      edit it later; see `withServerIds` in src/web/useChat.ts. */
@@ -694,31 +694,3 @@ export function withEdit(
     discarded: existing.messages.length - index - 1,
   };
 }
-
-export async function editTurn(
-  slug: string,
-  threadId: string,
-  messageId: string,
-  question: string,
-  now: () => string = () => new Date().toISOString(),
-): Promise<{ thread: ChatThread; user: ChatMessage; reply: ChatMessage; discarded: number }> {
-  let out!: { thread: ChatThread; user: ChatMessage; reply: ChatMessage; discarded: number };
-  await update(slug, (threads) => {
-    const next = withEdit(threads, threadId, messageId, question, now());
-    out = { thread: next.thread, user: next.user, reply: next.reply, discarded: next.discarded };
-    return next.threads;
-  });
-  log("store").info(
-    {
-      slug,
-      threadId: out.thread.id,
-      messageId: out.reply.id,
-      // The number is the point of the line: an edit is the only thing in this
-      // file that destroys stored turns, and this is how many it took.
-      discarded: out.discarded,
-      turns: out.thread.messages.length,
-    },
-    "chat question edited",
-  );
-  return out;
-}
diff --git a/src/labels.ts b/src/labels.ts
index c038e49..ebaecf1 100644
--- a/src/labels.ts
+++ b/src/labels.ts
@@ -40,7 +40,8 @@ import { CAPABLE_MODEL } from "./models.js";
 import { loadEnvLocal } from "./env.js";
 import { MODEL_REFUSED } from "./messages.js";
 import { anthropicCallFailed } from "./anthropic-call.js";
-import { parseJsonFrom } from "./parse-json.js";
+import { parseJsonFrom, stripFence } from "./parse-json.js";
+import { isStructural } from "./block-policy.js";
 import { hashBlocks, structureHash } from "./source-hash.js";
 import { budgetFor, truncatedMessage } from "./token-budget.js";
 import type { Block, NodeId, Tree, TreeNode } from "./types.js";
@@ -297,7 +298,7 @@ export function planBatches(
     if (allLeaves) {
       const own = children
         .map((c) => blocks[order.get(c.range[0]) ?? -1])
-        .filter((b): b is Block => !!b && b.gistable);
+        .filter((b): b is Block => !!b && isStructural(b));
       if (own.length > 0) {
         sets.push({ nodeId: id, crumb: here, ...(node.gist ? { gist: node.gist } : {}), blocks: own });
       }
@@ -388,7 +389,7 @@ export function oversizedSets(batches: Batch[], max = MAX_BATCH): SiblingSet[] {
  * callers pass rather than to remember to call it twice.
  */
 function assertCoversEveryBlock(batches: Batch[], blocks: Block[]): void {
-  const wanted = blocks.filter((b) => b.gistable).map((b) => b.id);
+  const wanted = blocks.filter((b) => isStructural(b)).map((b) => b.id);
   const got = batches.flatMap((b) => b.blocks.map((x) => x.id));
   const seen = new Set(got);
 
@@ -498,7 +499,12 @@ export function renderBatch(batch: Batch, blocks: Block[], outline: string): str
          all. Both are needed, and the test that caught the second mistake is the
          one that had been passing vacuously. */
       const outside = i < lo || i > hi;
-      const why = outside ? "CONTEXT" : block.gistable ? "OTHER-SECTION" : "NOT-GISTABLE";
+      /* `isStructural`, not `gistable`, and this is the same distinction the
+         paragraph above makes rather than a second one: what the marker has to
+         say is whether the block *could have been labelled at all*, and since
+         footnotes that is `isStructural`. A note announced as OTHER-SECTION
+         tells the model another batch will label it, which is false. */
+      const why = outside ? "CONTEXT" : isStructural(block) ? "OTHER-SECTION" : "NOT-GISTABLE";
       body.push(`[${why}] <${block.tag}>${kind}: ${block.text}`);
       continue;
     }
@@ -780,14 +786,12 @@ function describeShape(value: unknown): string {
  * It is simply not what gets stored.
  */
 export function parseLabels(raw: string, batch: Batch): Record<string, string> {
-  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
-  /* `parseJsonFrom`, never bare `JSON.parse` — V8's parse error quotes the
-     first characters of what it was handed, src/jobs.ts logs a thrown error's
-     message *and* its stack, and `redact` is path-based so it reaches neither.
-     What lands here is a model's writing about the article, which is exactly
-     what docs/project/logging.md says never goes in a line. src/toc.ts learned
-     this; this file was written without it and a review caught it. */
-  const parsed = parseJsonFrom<{ labels?: unknown }>(text, "the nav labels");
+  /* `stripFence` then `parseJsonFrom`, never bare `JSON.parse`. The reasoning
+     that used to sit here — including that `redact` is path-based and so reaches
+     neither the message nor the stack, and that src/toc.ts learned this before
+     this file was written without it — is now in src/parse-json.ts §
+     `stripFence`, next to the code it is about. */
+  const parsed = parseJsonFrom<{ labels?: unknown }>(stripFence(raw), "the nav labels");
   if (!Array.isArray(parsed.labels)) {
     /* No sample of the text. The shape is the whole diagnosis, and a sample
        here would be the same leak by hand that `parseJsonFrom` just prevented. */
@@ -1022,11 +1026,12 @@ export function assertEveryBlockLabelled(
   labels: Record<string, string>,
   blocks: Block[],
 ): void {
-  const missing = blocks.filter((b) => b.gistable && !labels[b.id]);
+  const missing = blocks.filter((b) => isStructural(b) && !labels[b.id]);
   if (missing.length === 0) return;
+  const wanted = blocks.filter((b) => isStructural(b)).length;
   throw new Error(
-    `The nav labels cover ${blocks.filter((b) => b.gistable).length - missing.length} of ` +
-      `${blocks.filter((b) => b.gistable).length} paragraphs — ${missing.length} came back ` +
+    `The nav labels cover ${wanted - missing.length} of ` +
+      `${wanted} paragraphs — ${missing.length} came back ` +
       `without one (${missing.slice(0, 3).map((b) => b.id).join(", ")}). Every batch is checked ` +
       `against the exact set it was asked about, so this is a gap between the batches rather ` +
       `than inside one. Nothing has been written.`,
@@ -1598,7 +1603,7 @@ async function main(): Promise<void> {
      this command answers `[ai-not-set-up]` on a machine where the key is right
      there in `.env.local`. */
   loadEnvLocal();
-  console.log(`Labelling ${blocks.filter((b) => b.gistable).length} blocks with ${CAPABLE_MODEL}…`);
+  console.log(`Labelling ${blocks.filter((b) => isStructural(b)).length} blocks with ${CAPABLE_MODEL}…`);
   const run = await generateLabels({
     tree,
     blocks,
diff --git a/src/monitoring.ts b/src/monitoring.ts
index 9425ec1..aef86f4 100644
--- a/src/monitoring.ts
+++ b/src/monitoring.ts
@@ -115,6 +115,15 @@ const INTEGRATIONS = [
  * an official exported entry point, not a private path, and error capture is
  * all of what this file uses.
  *
+ * **`@sentry/node-core` and `@sentry/core` are declared in `package.json`, and
+ * were not until 2026-08-28.** Only `@sentry/node` was — the package nothing
+ * imports — so the two this file and src/monitoring-scrub.ts actually load were
+ * resolving as its transitive dependencies. That works right up until a Sentry
+ * release reshuffles its own tree, and then error reporting stops in production
+ * with nothing failing locally to say so. `npm run knip` names this class
+ * "unlisted dependencies"; dropping `@sentry/node` also took thirteen packages
+ * out of the lockfile, which is the 21 MB above.
+ *
  * ## `tracesSampleRate` is omitted, and that is not the same as setting it to 0
  *
  * The obvious way to turn tracing off is `tracesSampleRate: 0`. It does the
diff --git a/src/parse-json.ts b/src/parse-json.ts
index d13fe16..04dd4f0 100644
--- a/src/parse-json.ts
+++ b/src/parse-json.ts
@@ -76,11 +76,24 @@
  * (src/log.ts rule 3). A file name, a slug, a stage name. Never a URL, never a
  * title the model wrote, never anything out of the article.
  *
- * Read the string yourself and pass it in. This does not open files, so
- * `ENOENT` still arrives from `readFile` with its own `code` intact and the
+ * Read the string yourself and pass it in. `parseJsonFrom` does not open files,
+ * so `ENOENT` still arrives from `readFile` with its own `code` intact and the
  * callers that treat "absent" as an ordinary answer keep working unchanged.
+ * `readJsonOrNull` at the bottom is the single exception, and its docstring says
+ * why it is allowed to be one.
+ *
+ * ## The two helpers around it
+ *
+ * `stripFence` and `readJsonOrNull` live here rather than in the seven stages
+ * that used to each own a copy, because both are steps in the same one job —
+ * turning bytes we did not write into a value, without the bytes reaching a log.
+ * Splitting them across the callers is how eight versions of the same three
+ * lines, and five verbatim copies of the same fifteen-line explanation, came to
+ * exist.
  */
 
+import { readFile } from "node:fs/promises";
+
 /**
  * A file or a response that would not parse. Thrown by `parseJsonFrom`.
  *
@@ -171,3 +184,80 @@ export function parseJsonFrom<T>(text: string, source: string): T {
     throw new MalformedJson(`${source} is not valid JSON: ${diagnose(text, err.message)}`);
   }
 }
+
+/**
+ * Strip a stray code fence if the model wraps its JSON despite instructions.
+ *
+ * Every stage that asks a model for JSON needs this — arc, glossary, ideas,
+ * labels, search, summarise, toc and tweets all did, in two spellings that were
+ * checked against each other on eighteen awkward inputs (bare fence, `json`
+ * fence, CRLF, backticks inside a string, a missing close fence, prose before,
+ * prose after, no fence at all, and ten more) and agreed on every one. The
+ * divergence was accidental, so this is the one of them.
+ *
+ * It is deliberately blunt: an opening fence at the very start and a closing one
+ * at the very end, nothing in between examined. Prose before the object survives
+ * it untouched — `parseHits` in src/search.ts is the caller that then goes
+ * looking for the first `{` itself, and it is the only one that needs to.
+ *
+ * ## Why the result goes through `parseJsonFrom` and never through `JSON.parse`
+ *
+ * This is the paragraph that used to be copy-pasted into five stage files, and
+ * it is the reason both halves live here now.
+ *
+ * **Nothing in those stage files logs.** That is exactly what makes a bare
+ * `JSON.parse` there dangerous rather than obviously wrong. A step that throws
+ * is logged by src/jobs.ts with `errorFields`, which keeps `message` *and*
+ * `stack` — and V8's own parse error quotes the first characters of whatever it
+ * was handed. So a bare `JSON.parse` in a file that never calls the logger at
+ * all still writes part of the model's writing about the article into the log.
+ * An error is a value that travels, and where it is thrown is not where it is
+ * written down.
+ *
+ * **And `redact` cannot save you**, because it is path-based: it walks the
+ * fields of a log object by name, and the quotation is buried inside a string
+ * that is itself embedded in another string. It reaches neither the message nor
+ * the stack. src/labels.ts is where that was written down first.
+ *
+ * The history is the argument for one copy. src/toc.ts learned this the hard
+ * way; src/labels.ts was then written without it and a review caught it. Five
+ * files carrying the same fifteen lines is five chances for the sixth file to be
+ * written by someone who never read them.
+ */
+export function stripFence(raw: string): string {
+  return raw
+    .trim()
+    .replace(/^```(?:json)?\s*/i, "")
+    .replace(/```$/, "")
+    .trim();
+}
+
+/**
+ * A JSON artefact on disk, or `null` if it is missing, truncated or not JSON.
+ *
+ * The one thing in this module that opens a file, and the one place in it where
+ * a bare `JSON.parse` is correct: **the error is discarded, not thrown**, so
+ * V8's quotation is never built into a message that anything logs. That is the
+ * whole justification, and it is load-bearing — if this is ever changed to
+ * rethrow, or to warn, it must switch to `parseJsonFrom` in the same edit, or it
+ * puts the leak this module exists to prevent straight back.
+ *
+ * "Missing" and "corrupt" deliberately give the same answer. Four stages
+ * (glossary, ideas, summarise, tweets) read an artefact they are about to
+ * regenerate anyway, and for them an unreadable file is worth exactly what an
+ * absent one is worth: nothing.
+ *
+ * **Not for callers who need to tell those apart**, and two in the tree do, so
+ * check before reaching for this. `readJson` in src/api.ts collects the
+ * unreadable paths so the shelf can say which article broke, and `readJson` in
+ * src/store/import.ts returns `undefined` for `ENOENT` only and lets a genuinely
+ * corrupt file throw. Folding either into this would turn a reported failure
+ * into a silent one — docs/reusable/silent-success.md.
+ */
+export async function readJsonOrNull<T>(file: string): Promise<T | null> {
+  try {
+    return JSON.parse(await readFile(file, "utf-8")) as T;
+  } catch {
+    return null;
+  }
+}
diff --git a/src/pdf-read.ts b/src/pdf-read.ts
index a91f86d..9a8eaa7 100644
--- a/src/pdf-read.ts
+++ b/src/pdf-read.ts
@@ -53,6 +53,7 @@ import path from "node:path";
 import { fileURLToPath } from "node:url";
 import { PDFDocument } from "pdf-lib";
 import { withLedger } from "./cli-ledger.js";
+import { loadEnvLocal } from "./env.js";
 import { stageFailure } from "./job-failure.js";
 import { log } from "./log.js";
 import { PDF_READER_MODEL } from "./models.js";
@@ -1315,6 +1316,13 @@ async function main() {
      later stage is addressed by slug, and because the three eval fixtures are
      each called `source.pdf` and would otherwise share one. */
   const slug = process.argv[3] ?? path.basename(input, ".pdf");
+  /* **In `main`, like the seven stage CLIs** — see the note in src/ideas.ts for
+     why it does not go deeper. Without it `npm run pdf x.pdf` from a shell that
+     has not exported the key stopped at "OPENROUTER_API_KEY is not set" with
+     the key sitting unread in `.env.local`, which reads as a missing credential
+     rather than an unread file. `tests/paid-cli-ledger.test.ts` holds the rule
+     for all eight now. */
+  loadEnvLocal();
   const outFile = path.join("output", `${slug}.html`);
   const dataDir = path.join("data", slug);
   await mkdir(dataDir, { recursive: true });
diff --git a/src/routes.ts b/src/routes.ts
index 6739399..986e499 100644
--- a/src/routes.ts
+++ b/src/routes.ts
@@ -1219,7 +1219,8 @@ async function streamChat(slug: string, body: unknown, res: ServerResponse): Pro
          `withEdit` are pure, so they can be run against a snapshot and thrown
          away. Whatever they would refuse, they refuse here, for free, before
          the destructive part. The authoritative run is still the one inside
-         `retryTurn` / `editTurn` — this is a gate, not a substitute. */
+         `chatStore.retry` / `chatStore.edit` below, which re-reads under the
+         store's own lock — this is a gate, not a substitute. */
       const snapshot = await chatStore.load(slug);
       if (wantsRetry) withRetry(snapshot, threadId, retry as string, "");
       else withEdit(snapshot, threadId, edit as string, (question as string).trim(), "");
diff --git a/src/sanitize-policy.ts b/src/sanitize-policy.ts
index a7a1ca9..4cb356b 100644
--- a/src/sanitize-policy.ts
+++ b/src/sanitize-policy.ts
@@ -274,8 +274,25 @@ const FUNCTIONAL_IRI = /url\(\s*['"]?([^'")]+)['"]?\s*\)/gi;
  *
  * In a browser this is exact: `location.origin` is the page the article is
  * being rendered into, which is the only origin that matters. On the server —
- * where stage 3 runs — there is no such thing, so it takes a configured list
- * and falls back to the local dev origins.
+ * where stage 3 runs — there is no such thing, so it takes the host the
+ * deployment knows itself by, plus a configured list, and falls back to the
+ * local dev origins.
+ *
+ * **`VERCEL_PROJECT_PRODUCTION_URL` and `VERCEL_URL` were added on 2026-08-28,
+ * and until then the server half of this did nothing in production.**
+ * `SPIDERYARN_ORIGINS` was the only way to name the real host and has never
+ * been set — not in `.env.example`, not in deployment.md, not on Vercel — so
+ * `ownOrigins()` returned two localhost entries and stage 3 could not recognise
+ * `https://spideryarn-…vercel.app/api/library` as ours. The browser pass still
+ * caught it, which is precisely the failure this file's header warns about: two
+ * half-policies that read as defence in depth. Vercel sets both variables on
+ * every deployment with no configuration, and src/monitoring.ts:182 already
+ * reads a sibling, so they are known to arrive. They carry a bare host with no
+ * scheme, which is why `https://` goes on here.
+ *
+ * Widening this list can only make the sanitiser **stricter** — `isOwnApi`
+ * returning true removes the attribute — so an origin wrongly counted as ours
+ * costs a stripped link, not a leaked request.
  *
  * **This exists because the first version resolved everything against a
  * placeholder origin**, which made every absolute URL "foreign" — including
@@ -293,8 +310,13 @@ function ownOrigins(): string[] {
     .split(",")
     .map((o: string) => o.trim())
     .filter(Boolean);
+  /* Bare hosts, so they are given the only scheme Vercel serves. A value that
+     already carries one is left alone rather than doubled up. */
+  const deployed = [env?.VERCEL_PROJECT_PRODUCTION_URL, env?.VERCEL_URL]
+    .filter((h): h is string => typeof h === "string" && h.trim() !== "")
+    .map((h: string) => (h.includes("://") ? h.trim() : `https://${h.trim()}`));
   const here = typeof location === "object" && location?.origin ? [location.origin] : [];
-  return [...here, ...configured, "http://localhost:5273", "http://127.0.0.1:5273"];
+  return [...here, ...deployed, ...configured, "http://localhost:5273", "http://127.0.0.1:5273"];
 }
 
 /** A placeholder that no real host can collide with, for resolving relative URLs. */
diff --git a/src/search.ts b/src/search.ts
index 7b2c0bc..83477e1 100644
--- a/src/search.ts
+++ b/src/search.ts
@@ -79,6 +79,7 @@ import {
 } from "./openrouter-stream.js";
 import { ProviderRefused, openRouterStream } from "./ai-call.js";
 import { hitExtractor } from "./search-hits-stream.js";
+import { stripFence } from "./parse-json.js";
 import {
   ANSWER_OVERFLOWED,
   ENDED_UNFINISHED,
@@ -414,7 +415,7 @@ export function validateHits(
  * closed — that is the cut-off case.
  */
 export function parseHits(text: string): unknown {
-  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
+  const trimmed = stripFence(text);
   const from = trimmed.indexOf("{");
   if (from === -1) {
     throw new Error(PROVIDER_UNREADABLE.message, { cause: "no-object" });
diff --git a/src/store/contracts.ts b/src/store/contracts.ts
index 4c6806c..a8dc66a 100644
--- a/src/store/contracts.ts
+++ b/src/store/contracts.ts
@@ -21,8 +21,12 @@
  * 2. `ArtifactWriter` — what the pipeline stages write. Today that is
  *    `PipelineStep.outputs(ctx): string[]`, an interface that returns **file
  *    paths**, implemented across eight stage modules. There is no single file.
- * 3. `CommentStore` and `JobStore` — reader and queue state, each with its own
- *    module and its own in-memory assumptions. Chat and searches belong to this
+ * 3. `CommentStore` and the queue's `JobStore` — reader and queue state, each
+ *    with its own module and its own in-memory assumptions. The queue's half
+ *    has since landed, and its contract lives in [jobs.ts](jobs.ts), not here:
+ *    a second `JobStore` was declared in this file and never implemented, so it
+ *    drifted into declaring a different `claim`, `get` and expiry sweep from the
+ *    real one, and it has been deleted. Chat and searches belong to this
  *    group and have **no interface here yet**: they still write straight to the
  *    filesystem, which is why `postgres` mode currently serves them from files.
  *    That is item 10 of docs/plans/260826e-postgres-storage-implementation.md, not an
@@ -52,7 +56,6 @@ import type {
   GlossaryEntry,
   GlossaryLookup,
   GlossaryFound,
-  Job,
   LibraryEntry,
   LibraryHit,
   ListOptions,
@@ -247,39 +250,6 @@ export interface CommentStore {
   count(slug: string): Promise<number>;
 }
 
-/**
- * The ingest queue's records.
- *
- * The interface a Postgres implementation has to satisfy is wider than the
- * filesystem one's, and the difference is the whole point: `claim` exists
- * because more than one server process can run. Today's queue is a p-queue and
- * an in-memory Map, which cannot survive a second instance — see
- * docs/project/ingest-queue.md.
- */
-export interface JobStore {
-  list(): Promise<Job[]>;
-  get(id: string): Promise<Job | undefined>;
-  create(job: Job): Promise<Job>;
-  /** Patch a job. Fenced by `attemptId` so a stale worker cannot overwrite a newer state. */
-  update(id: string, patch: Partial<Job>, attemptId?: string): Promise<Job>;
-
-  /**
-   * Take the next queued job, if this process may run one.
-   *
-   * **Concurrency 1 globally**, which `SELECT … FOR UPDATE SKIP LOCKED LIMIT 1`
-   * does NOT give you — that lets two workers claim two *different* queued
-   * jobs. The singleton `queue_state` row, locked `FOR UPDATE`, is the
-   * guarantee. Returns `undefined` when another worker holds the queue.
-   */
-  claim(attemptId: string, leaseMs: number): Promise<Job | undefined>;
-
-  /** Extend the lease of a job this process is running. */
-  heartbeat(id: string, attemptId: string, leaseMs: number): Promise<boolean>;
-
-  /** Return jobs whose lease expired mid-run to the queue, or fail them. */
-  rescueExpired(): Promise<number>;
-}
-
 /**
  * What the reader has done to the card: archived it, renamed it, opened it.
  *
diff --git a/src/store/fs.ts b/src/store/fs.ts
index 48a4f18..f8063dc 100644
--- a/src/store/fs.ts
+++ b/src/store/fs.ts
@@ -244,8 +244,8 @@ export const fsChatStore: ChatStore = {
   async edit(slug, threadId, messageId, question, opts = {}) {
     /* **The tail check runs inside the mutex, with the edit.**
 
-       Checking it out here — load, check, then call `editTurn`, which enters
-       the mutex and re-reads — is checking a copy. A `begin` can land, or
+       Checking it in the route — load, check, then call this method, which
+       enters the mutex and re-reads — is checking a copy. A `begin` can land, or
        already be queued, between the two reads: the check passes against
        Q1/A1, `begin` writes Q2/A2, and the edit then runs behind it and
        deletes both. That is precisely the loss `expectedTailId` exists to
diff --git a/src/tweets.ts b/src/tweets.ts
index 19f1fe2..e334051 100644
--- a/src/tweets.ts
+++ b/src/tweets.ts
@@ -38,8 +38,9 @@ import { anthropicCallFailed } from "./anthropic-call.js";
 import { hashBlocks, type BlockFingerprint } from "./source-hash.js";
 import { budgetFor, truncationFailure } from "./token-budget.js";
 import type { Block, Meta, Tree, Tweet, TweetThread } from "./types.js";
-import { parseJsonFrom } from "./parse-json.js";
+import { parseJsonFrom, readJsonOrNull, stripFence } from "./parse-json.js";
 import { articleText } from "./article-prompt.js";
+import { articleWordCounts, isBodyEvidence } from "./block-policy.js";
 import { PROFILE_RULES, hashProfile, profileSection } from "./profile.js";
 import { withLedger } from "./cli-ledger.js";
 
@@ -108,14 +109,6 @@ export function isStale(thread: TweetThread, blocks: BlockFingerprint[]): boolea
   return thread.sourceHash !== hashBlocks(blocks);
 }
 
-async function readJson<T>(file: string): Promise<T | null> {
-  try {
-    return JSON.parse(await readFile(file, "utf-8")) as T;
-  } catch {
-    return null;
-  }
-}
-
 /**
  * Is the thread on disk one we would write again today?
  *
@@ -138,11 +131,11 @@ async function readJson<T>(file: string): Promise<T | null> {
  * thread served for ever.
  */
 export async function threadIsCurrent(dir: string): Promise<boolean> {
-  const thread = await readJson<TweetThread>(path.join(dir, "tweets.json"));
+  const thread = await readJsonOrNull<TweetThread>(path.join(dir, "tweets.json"));
   if (!thread) return false;
   if (thread.version !== PROMPT_VERSION) return false;
   if (thread.generator !== CAPABLE_MODEL) return false;
-  const blocksFile = await readJson<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
+  const blocksFile = await readJsonOrNull<{ blocks: Block[] }>(path.join(dir, "blocks.json"));
   if (!blocksFile?.blocks) return false;
   return !isStale(thread, blocksFile.blocks);
 }
@@ -298,19 +291,15 @@ ${skeleton}`;
 }
 
 /**
- * Strip a stray code fence if the model wraps its JSON despite instructions.
+ * Read the model's answer, fence and all.
  *
- * The parse goes through src/parse-json.ts, and the reason is that **nothing in
- * this file logs**. A step that throws is logged by src/jobs.ts with
- * `errorFields`, which keeps `message` *and* `stack` — and V8's own parse error
- * quotes the first characters of whatever it was handed. So a plain
- * `JSON.parse` here writes part of the model's writing about the article into
- * the log, from a file that never calls the logger at all. An error is a value
- * that travels, and where it is thrown is not where it is written down.
+ * `stripFence` then `parseJsonFrom`, never a bare `JSON.parse` — src/parse-json.ts
+ * § `stripFence` has the reasoning, and the short version is that nothing in this
+ * file logs and that is not enough, because a thrown error is logged where it is
+ * caught and V8 quotes the input in it.
  */
 function parseJson(raw: string): { tweets: string[] } {
-  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
-  return parseJsonFrom(text, "the tweet-thread response");
+  return parseJsonFrom(stripFence(raw), "the tweet-thread response");
 }
 
 /**
@@ -445,7 +434,19 @@ export async function generateTweets(opts: {
      is to name what the prompt actually carried. */
   const profile = opts.profile ?? null;
 
-  const words = blocks.reduce((n, b) => n + b.words, 0);
+  /* **The argument, not the apparatus.** Applied here at the call site rather
+     than inside `articleText`/`articleWithIds`, and that is the whole care in
+     this line: the two builders look like the seam between automatic and asked
+     work and they are not — `ideas` is automatic and sends ids, while
+     `explain`, `search` and `converse` are *asked* and send ids too. Filtering
+     inside the builders would be right three times and would silently leave
+     `ideas` summarising the bibliography. src/block-policy.ts. */
+  const evidence = blocks.filter(isBodyEvidence);
+  /* The **body's** words, from the shared derivation. A thread's length is
+     chosen from how much argument there is; sizing it from a word count that
+     includes the endnotes, while the prompt above excludes them, is the same
+     braiding one layer down. src/block-policy.ts. */
+  const words = articleWordCounts(blocks).body;
   const posts = suggestedLength(words);
   const started = Date.now();
 
@@ -481,7 +482,7 @@ export async function generateTweets(opts: {
       system: [
         {
           type: "text" as const,
-          text: articleText(meta, blocks),
+          text: articleText(meta, evidence),
           ...(opts.cacheArticle ? { cache_control: { type: "ephemeral" as const } } : {}),
         },
         { type: "text" as const, text: SYSTEM },
diff --git a/src/upload-records.ts b/src/upload-records.ts
index bd34bad..15af728 100644
--- a/src/upload-records.ts
+++ b/src/upload-records.ts
@@ -38,7 +38,6 @@ import {
   type UploadStore,
   grantIsOver,
 } from "./store/uploads.js";
-import { MAX_UPLOAD_BYTES } from "./uploads.js";
 
 export type { ClaimFailure, UploadRecord } from "./store/uploads.js";
 export { isUploadId } from "./store/uploads.js";
@@ -116,8 +115,6 @@ export function asOf(record: UploadRecord, now: Date = new Date()): UploadRecord
     : record;
 }
 
-export { grantIsOver };
-
 /** Take exclusive ownership of an upload, or say who got there first. */
 export function claimUpload(
   id: string,
@@ -177,6 +174,3 @@ export function forgetUpload(id: string): Promise<void> {
 export function recordsSurviveTheRequest(): boolean {
   return STORE === "postgres" || !process.env.VERCEL;
 }
-
-/** Re-exported so a caller checking a claimed size does not import two modules to do it. */
-export { MAX_UPLOAD_BYTES };
diff --git a/src/web/ContextPanel.tsx b/src/web/ContextPanel.tsx
index 2017044..0522608 100644
--- a/src/web/ContextPanel.tsx
+++ b/src/web/ContextPanel.tsx
@@ -50,7 +50,7 @@ import { useRenderCount } from "./perf.js";
 const DELAY = { open: 150, close: 60 } as const;
 
 /** The strip of the column left uncovered, so the cells' boundaries show. */
-export const GUTTER_PX = 10;
+const GUTTER_PX = 10;
 
 /**
  * The height of the fade at the panel's bottom edge. Anything inside it is
diff --git a/src/web/ShelfEntry.tsx b/src/web/ShelfEntry.tsx
index b968bbd..4ffa72e 100644
--- a/src/web/ShelfEntry.tsx
+++ b/src/web/ShelfEntry.tsx
@@ -29,7 +29,7 @@ import { readHref } from "./router.js";
 import { TitleEditor } from "./TitleEditor.js";
 import { Tooltip } from "./Tooltip.js";
 import type { useShelf } from "./useShelf.js";
-import { apiFetch, failure } from "./lib/api.js";
+import { fetchOk } from "./lib/api.js";
 
 export type Shelf = ReturnType<typeof useShelf>;
 
@@ -292,16 +292,17 @@ export function Actions({
   const rerun = useCallback(async () => {
     setRerunning(true);
     try {
-      const r = await apiFetch("/api/jobs", {
+      /* `fetchOk`, so the check cannot be dropped. The first version ignored the
+         response entirely, so a refused job — a bad slug, a queue that would not
+         take it, a 501 — left the button spinning briefly and then looking as
+         though it had worked. That is the silent success this repo keeps writing
+         up, and lib/api.ts § `fetchOk` is where it stopped being possible to
+         write it again by forgetting a line. */
+      await fetchOk("/api/jobs", {
         method: "POST",
         headers: { "content-type": "application/json" },
         body: JSON.stringify({ slug: entry.slug, force: ["fetch"] }),
       });
-      /* Checked. The first version ignored the response entirely, so a refused
-         job — a bad slug, a queue that would not take it, a 501 — left the
-         button spinning briefly and then looking as though it had worked. That
-         is the silent success this repo keeps writing up. */
-      if (!r.ok) throw await failure(r);
     } catch (e) {
       shelf.report(`Couldn't queue a rebuild: ${(e as Error).message}`);
     } finally {
diff --git a/src/web/layout.ts b/src/web/layout.ts
index f88051d..b5ea921 100644
--- a/src/web/layout.ts
+++ b/src/web/layout.ts
@@ -113,7 +113,7 @@ export function proseVisible(showText: boolean, modeBand: boolean): boolean {
   return modeBand || showText;
 }
 
-export function spineWidth(mode: SpineMode): number {
+function spineWidth(mode: SpineMode): number {
   return mode === "on" ? SPINE_W : 0;
 }
 
diff --git a/src/web/lib/api.ts b/src/web/lib/api.ts
index b9468b5..cc8bcb6 100644
--- a/src/web/lib/api.ts
+++ b/src/web/lib/api.ts
@@ -282,6 +282,50 @@ export async function apiFetch(input: string, init: RequestInit = {}): Promise<R
   return saving(input, init, await attempt(input, init, () => send(refreshed)));
 }
 
+/**
+ * `apiFetch`, and the response only if the server said yes.
+ *
+ *     await fetchOk(`/api/comments/${slug}/${id}`, { method: "DELETE" });
+ *
+ * The same two lines as `const r = await apiFetch(…); if (!r.ok) throw await
+ * failure(r);` — and the point is not the line. **It makes asking and checking
+ * one act**, so the failure it exists to stop cannot be reached by forgetting.
+ * That failure has already happened twice here, from the same omission in two
+ * hooks: a DELETE that 500'd took the row off the screen and said nothing, and
+ * the reader found it back after a reload (`forget` in useComments.ts, `forget`
+ * in useSearch.ts). `readJson` has that property for a call whose body you go on
+ * to read; this is it for the calls whose body you do not.
+ *
+ * ## What it is not for
+ *
+ * - **A response you are about to stream.** `if (!r.ok || !r.body)` asks a
+ *   second question, and a stream can end by simply stopping, which looks
+ *   exactly like finishing — a different failure from a status code, and not one
+ *   this helper knows anything about. useComments.ts § `answer`, useSearch.ts §
+ *   `run` and chat/effects.ts keep their own check for that reason.
+ * - **A status that is an answer rather than a failure.** A 404 from
+ *   `/api/ideas/:slug` means nobody has asked for ideas yet; a 409 from the chat
+ *   stream means somebody else is already answering; `/api/public/…` answers 404
+ *   for a piece that is simply not shared. Those callers read the status
+ *   *before* deciding, and throwing there would report an ordinary state as a
+ *   fault. useIdeas.ts, useSummaries.ts, useGlossary.ts, public-api.ts,
+ *   App.tsx.
+ * - **A fetch that is not ours.** `apiFetch` refuses anything outside `/api/`,
+ *   so the Wikipedia summary in link-facts.ts and the Supabase settings probe in
+ *   lib/supabase.ts cannot come through here — and both of them treat a non-2xx
+ *   as *nothing to show*, which is not a thing to tell anybody about.
+ *
+ * Worth keeping in front of a `readJson` that reads the body afterwards, rather
+ * than leaving `readJson` to make the same check: `failure` tolerates a body
+ * that dies mid-read and `readJson` does not, so a 500 on a cut connection keeps
+ * its status message instead of surfacing as a `TypeError` about the network.
+ */
+export async function fetchOk(input: string, init: RequestInit = {}): Promise<Response> {
+  const res = await apiFetch(input, init);
+  if (!res.ok) throw await failure(res);
+  return res;
+}
+
 /**
  * Run a request, and fall back to a saved copy if the *transport* failed.
  *
diff --git a/src/web/useComments.ts b/src/web/useComments.ts
index d960de3..118d7ec 100644
--- a/src/web/useComments.ts
+++ b/src/web/useComments.ts
@@ -19,7 +19,7 @@ import { useCallback, useEffect, useRef, useState } from "react";
 import type { BlockId, Comment } from "../types.js";
 import { readEvents, StreamStalled, STREAM_STALL_MS } from "./lib/sse.js";
 import { wentQuiet } from "../messages.js";
-import { apiFetch, failure, readJson } from "./lib/api.js";
+import { apiFetch, failure, fetchOk, readJson } from "./lib/api.js";
 
 /**
  * What to say when the request never reached the server.
@@ -230,12 +230,12 @@ export function useComments(slug: string): CommentsApi {
   const forget = useCallback(
     async (id: string) => {
       try {
-        const r = await apiFetch(`/api/comments/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
-          { method: "DELETE" },
-        );
         // A DELETE that 500s used to remove the comment from the screen and say
         // nothing, so the reader saw it gone and found it back after a reload.
-        if (!r.ok) throw await failure(r);
+        // `fetchOk` is that check made unforgettable — lib/api.ts.
+        await fetchOk(`/api/comments/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
+          { method: "DELETE" },
+        );
       } catch (e) {
         setError(describeFetchFailure(e as Error));
       }
@@ -455,7 +455,7 @@ export function useComments(slug: string): CommentsApi {
       });
       setError(null);
       try {
-        const r = await apiFetch(`/api/comments/${encodeURIComponent(slug)}`, {
+        const r = await fetchOk(`/api/comments/${encodeURIComponent(slug)}`, {
           method: "POST",
           headers: { "Content-Type": "application/json" },
           body: JSON.stringify({
@@ -466,7 +466,6 @@ export function useComments(slug: string): CommentsApi {
             ...(input.body ? { body: input.body } : {}),
           }),
         });
-        if (!r.ok) throw await failure(r);
         const { comment } = await readJson<{ comment: Comment }>(r);
         /* The server may have minted a different id. Drop the row we invented
            before putting the real one, or `put` appends it and the reader has
@@ -501,7 +500,7 @@ export function useComments(slug: string): CommentsApi {
     async (id: string, body: string | null): Promise<void> => {
       setError(null);
       try {
-        const r = await apiFetch(
+        const r = await fetchOk(
           `/api/comments/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
           {
             method: "PATCH",
@@ -509,7 +508,6 @@ export function useComments(slug: string): CommentsApi {
             body: JSON.stringify({ body }),
           },
         );
-        if (!r.ok) throw await failure(r);
         const { comment } = await readJson<{ comment: Comment }>(r);
         /* **The server's comment replaces the stored one; it is not merged
            over it.** A merge cannot express a *removal*: clearing the body
diff --git a/src/web/useGlossary.ts b/src/web/useGlossary.ts
index 047b407..13c34e4 100644
--- a/src/web/useGlossary.ts
+++ b/src/web/useGlossary.ts
@@ -25,10 +25,10 @@
 import { useCallback, useEffect, useMemo, useRef, useState } from "react";
 import type { Glossary, GlossaryEntry, GlossaryLookup, GlossaryResponse, Job } from "../types.js";
 import { useJobs } from "./useJobs.js";
-import { apiFetch, failure, readJson } from "./lib/api.js";
+import { apiFetch, fetchOk, readJson } from "./lib/api.js";
 import { useHasProfile } from "./useProfile.js";
 
-export type GlossaryStatus = "loading" | "none" | "ready" | "error";
+type GlossaryStatus = "loading" | "none" | "ready" | "error";
 
 /**
  * The glossary read: the list, whether it still describes the article, and the
@@ -552,8 +552,7 @@ export function useGlossary(slug: string, read: GlossaryRead): UseGlossary {
    */
   const reset = useCallback(async () => {
     try {
-      const res = await apiFetch(`/api/glossary/${encodeURIComponent(slug)}`, { method: "DELETE" });
-      if (!res.ok) throw await failure(res);
+      await fetchOk(`/api/glossary/${encodeURIComponent(slug)}`, { method: "DELETE" });
     } catch (err) {
       /* **This is where production stops**, and it is not a bug in this hook:
          deleting a glossary under `postgres` would null a column on a published
diff --git a/src/web/useIdeas.ts b/src/web/useIdeas.ts
index c04f584..b1c24f1 100644
--- a/src/web/useIdeas.ts
+++ b/src/web/useIdeas.ts
@@ -27,7 +27,7 @@ import { useJobs } from "./useJobs.js";
 import { apiFetch, readJson } from "./lib/api.js";
 import { useHasProfile } from "./useProfile.js";
 
-export type IdeasStatus = "loading" | "none" | "ready" | "error";
+type IdeasStatus = "loading" | "none" | "ready" | "error";
 
 export interface UseIdeas {
   status: IdeasStatus;
diff --git a/src/web/useProjection.ts b/src/web/useProjection.ts
index 3d1bdde..414d1d0 100644
--- a/src/web/useProjection.ts
+++ b/src/web/useProjection.ts
@@ -32,7 +32,7 @@ import { useEffect, useState } from "react";
 import type { ProjectionPoint, ProjectionResponse, SkipCounts } from "../types.js";
 import { apiFetch, readJson } from "./lib/api.js";
 
-export type ProjectionStatus = "idle" | "loading" | "ready" | "error";
+type ProjectionStatus = "idle" | "loading" | "ready" | "error";
 
 export interface UseProjection {
   status: ProjectionStatus;
@@ -68,11 +68,15 @@ const IDLE: UseProjection = {
 export function useProjection(slug: string, enabled: boolean): UseProjection {
   const [state, setState] = useState<UseProjection & { slug: string }>({ ...IDLE, slug });
 
-  /* **Whose answer this is.** Held in the state rather than compared inside the
-     effect, because the reader can move to another article without this
-     component unmounting — and these coordinates are about one article's
+  /* **Whose answer this is.** These coordinates are about one article's
      paragraphs, so drawing the previous one's would be a picture confidently
-     about the wrong text. `useSimilar` learnt this first; it is the same trap. */
+     about the wrong text.
+
+     **As the app is wired today this can never be false** — `App.tsx` keys the
+     article components on the slug, so a slug change remounts this hook rather
+     than handing it a new slug. The comment here used to claim the opposite.
+     `useSimilar` carries the same guard and the same correction; read the
+     longer version there for why both are kept. */
   const mine = state.slug === slug;
 
   useEffect(() => {
diff --git a/src/web/useSearch.ts b/src/web/useSearch.ts
index fe464aa..c7e747d 100644
--- a/src/web/useSearch.ts
+++ b/src/web/useSearch.ts
@@ -35,7 +35,7 @@ import { mintId } from "../ids.js";
 import { isStale } from "../search-stale.js";
 import { describeFetchFailure } from "./useComments.js";
 import { readEvents, STREAM_STALL_MS } from "./lib/sse.js";
-import { apiFetch, failure, readJson } from "./lib/api.js";
+import { apiFetch, failure, fetchOk, readJson } from "./lib/api.js";
 
 /**
  * A saved run, plus the one thing about it that is not on the run.
@@ -247,13 +247,13 @@ export function useSearch(slug: string): SearchApi {
   const forget = useCallback(
     async (id: string) => {
       try {
-        const r = await apiFetch(`/api/search/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
-          { method: "DELETE" },
-        );
         // A DELETE that 500s used to remove the row from the screen and say
         // nothing, so the reader saw it gone and found it back after a reload.
-        // Same line, same reason, as useComments.ts.
-        if (!r.ok) throw await failure(r);
+        // Same call, same reason, as useComments.ts § `forget` — and it is
+        // `fetchOk` in both because the omission happened twice.
+        await fetchOk(`/api/search/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
+          { method: "DELETE" },
+        );
       } catch (e) {
         setError(describeFetchFailure(e as Error));
       }
@@ -432,7 +432,10 @@ export function useSearch(slug: string): SearchApi {
 
       const send = async () => {
         try {
-          const r = await apiFetch(
+          // Same call, same reason, as `forget` above: a PATCH that 500s used
+          // to change the colour on screen and say nothing, so the reader saw
+          // their choice take and found it gone after a reload.
+          await fetchOk(
             `/api/search/${encodeURIComponent(slug)}/${encodeURIComponent(id)}`,
             {
               method: "PATCH",
@@ -440,10 +443,6 @@ export function useSearch(slug: string): SearchApi {
               body: JSON.stringify({ colour }),
             },
           );
-          // Same line, same reason, as `forget` above: a PATCH that 500s used
-          // to change the colour on screen and say nothing, so the reader saw
-          // their choice take and found it gone after a reload.
-          if (!r.ok) throw await failure(r);
         } catch (e) {
           setError(describeFetchFailure(e as Error));
         }
diff --git a/src/web/useSimilar.ts b/src/web/useSimilar.ts
index 31f9341..1238a8c 100644
--- a/src/web/useSimilar.ts
+++ b/src/web/useSimilar.ts
@@ -34,7 +34,7 @@ import { useEffect, useState } from "react";
 import type { SimilarPair, SimilarResponse } from "../types.js";
 import { apiFetch, readJson } from "./lib/api.js";
 
-export type SimilarStatus = "idle" | "loading" | "ready" | "error";
+type SimilarStatus = "idle" | "loading" | "ready" | "error";
 
 export interface UseSimilar {
   status: SimilarStatus;
@@ -59,12 +59,23 @@ export function useSimilar(slug: string, enabled: boolean): UseSimilar {
     error: null,
   });
 
-  /* **Whose answer this is.** Held in the state rather than compared inside the
-     effect, because the reader can move to another article without this
-     component unmounting — and an answer is about one article's passages, so
+  /* **Whose answer this is.** The answer is about one article's passages, so
      showing the previous one's dotted lines over the new article would be a
-     picture that is confidently about the wrong text. Returning `idle` for a
-     slug we have not answered for yet is the honest report. */
+     picture confidently about the wrong text. Returning `idle` for a slug we
+     have not answered for yet is the honest report.
+
+     **As the app is wired today this can never be false**, and the comment
+     used to claim the opposite — that the reader can move to another article
+     without this component unmounting. They cannot: `App.tsx` keys both
+     `OwnedArticle` and `VisitorArticle` on the slug ("Keyed on the slug so
+     switching article remounts"), and `DiagramPanel` is inside that subtree,
+     so a slug change destroys this hook rather than handing it a new slug.
+     No test exercises the transition either.
+
+     Kept anyway. It costs one string comparison, it is the invariant written
+     down where the invariant is used, and it is the half that survives if
+     someone ever drops that key — which is exactly the kind of change nobody
+     would think to look here for. */
   const mine = state.slug === slug;
 
   useEffect(() => {
diff --git a/src/web/useSummaries.ts b/src/web/useSummaries.ts
index a220b6e..2d00548 100644
--- a/src/web/useSummaries.ts
+++ b/src/web/useSummaries.ts
@@ -30,7 +30,7 @@ import { useJobs } from "./useJobs.js";
 import { apiFetch, readJson } from "./lib/api.js";
 import { useHasProfile } from "./useProfile.js";
 
-export type SummariesStatus = "loading" | "none" | "ready" | "error";
+type SummariesStatus = "loading" | "none" | "ready" | "error";
 
 export interface UseSummaries {
   status: SummariesStatus;
diff --git a/tests/helpers/pg-ready.ts b/tests/helpers/pg-ready.ts
new file mode 100644
index 0000000..9acfb27
--- /dev/null
+++ b/tests/helpers/pg-ready.ts
@@ -0,0 +1,207 @@
+/**
+ * "Is Postgres up, and is it migrated far enough for THIS suite?" — once.
+ *
+ * Around thirty test files each hand-rolled this probe, and the copies drifted:
+ * three were still on a two-second connect timeout, and five skipped without
+ * saying a word. Both drifts are the same failure — a suite that opts itself
+ * out and lets the run print a green tick for having checked nothing.
+ * See docs/reusable/silent-success.md.
+ *
+ * ## Why ten seconds and not two
+ *
+ * Verbatim from tests/store-parity.test.ts:196-201, the file that learned it:
+ *
+ * > 10 seconds, not 2. At 2s this probe timed out under nothing worse than a
+ * > dev server holding connections, and the whole suite skipped — inside a run
+ * > that still printed a green "1103 passed". A parity suite that opts itself
+ * > out when the machine is busy is worse than one that fails, because the
+ * > signal it gives is indistinguishable from success.
+ *
+ * ## Why it warns, and why only sometimes
+ *
+ * Also verbatim, from the same file:
+ *
+ * > Said out loud. DATABASE_URL being SET and the database being unreachable is
+ * > a different situation from having no database at all, and only the first
+ * > one means somebody's Docker is off while they believe these ran.
+ *
+ * So: no `DATABASE_URL` is the fresh-clone-with-no-Docker case and stays quiet;
+ * `DATABASE_URL` set and the probe failing gets one line on stderr naming the
+ * suite that just opted out.
+ *
+ * **And it is `process.stderr.write`, not `console.warn`, which is not a style
+ * choice.** Every copy this replaces used `console.warn`, and vitest's console
+ * interception swallows a `console.warn` made at module load by a file whose
+ * tests then all skip — measured on 2026-08-28 by pointing `DATABASE_URL` at a
+ * refused port: the default reporter printed `1 skipped` and not one word of the
+ * warning. So the "loud skip" the whole family was built around had been silent
+ * under `npm test` the entire time, which is precisely the shape of thing
+ * silent-success.md is about. `process.stderr.write` is not intercepted and does
+ * print. (`--disableConsoleIntercept` or `--reporter=verbose` also surface a
+ * `console.warn`, but nobody runs `npm test` that way.)
+ *
+ * ## Why the caller must `await` this at module load
+ *
+ * The skip has to be a real vitest skip, so the run reports "9 skipped" rather
+ * than "9 passed". A flag set in `beforeAll` with every test returning early
+ * reports **passed** — tests/db-schema.test.ts did exactly that, and was an
+ * example in silent-success.md within four minutes of being written. Call this
+ * with a top-level `await`, at module scope, above the `describe`.
+ *
+ * ## Why it is parameterised rather than one boolean
+ *
+ * Because the suites differ in what "ready enough" means, and flattening that
+ * away would trade one silent skip for another:
+ *
+ * - most want a **table** to exist (`to_regclass`);
+ * - four want a specific **column**, because the migration that added it is the
+ *   thing under test and a database one migration behind would otherwise fail
+ *   with a confusing column error instead of "run npm run db:migrate";
+ * - `admin-store` also needs `auth.users` to be **readable**, which is a grant
+ *   rather than a migration, and is the thing most likely to differ in prod;
+ * - `db-transaction-errors` wants nothing but a live connection.
+ *
+ * Usage:
+ *
+ * ```ts
+ * const { reachable } = await pgReady({ suite: "the Postgres comment store",
+ *                                       tables: ["spideryarn.comments"] });
+ * const when = reachable ? describe : describe.skip;
+ * ```
+ */
+import type { Pool } from "pg";
+
+/** A column the suite needs, named the way Postgres stores it (snake_case). */
+export interface RequiredColumn {
+  /** `schema.table`, e.g. `spideryarn.revision_blocks`. */
+  table: string;
+  column: string;
+}
+
+export interface PgReadyOptions {
+  /** Named in the warning, so a skipped suite is identifiable from one line. */
+  suite: string;
+  /** Tables that must exist. `to_regclass`, so `schema.table`. */
+  tables?: readonly string[];
+  /** Columns that must exist — for a suite whose subject is one migration. */
+  columns?: readonly RequiredColumn[];
+  /** Tables the role must be able to `select` from. A grant, not a migration. */
+  readable?: readonly string[];
+  /** Pool size. Suites that query concurrently ask for more than one. */
+  max?: number;
+  /**
+   * Hand the pool back instead of ending it, for the two suites that run their
+   * own SQL through it. The caller then owns it and must `end()` it.
+   */
+  keepPool?: boolean;
+}
+
+export interface PgReady {
+  /** True only if every check passed. The suite runs iff this is true. */
+  reachable: boolean;
+  /** Empty when reachable; otherwise what was missing, already warned about. */
+  why: string;
+  /** Only when `keepPool`, and only when a connection was attempted at all. */
+  pool?: Pool;
+}
+
+/** 10s. See the header — this number is the whole reason the file exists. */
+const CONNECT_TIMEOUT_MS = 10_000;
+
+/**
+ * Probe Postgres for this suite, warn if it is not there, and say so.
+ *
+ * Never throws: a probe that threw would take the whole file down, which is
+ * louder than the situation warrants but also less informative than the warning.
+ */
+export async function pgReady(options: PgReadyOptions): Promise<PgReady> {
+  const url = process.env.DATABASE_URL;
+  /* No database configured at all — the fresh clone. Quiet on purpose. */
+  if (!url) return { reachable: false, why: "DATABASE_URL is not set" };
+
+  /* Imported here, not at the top, so a file with no DATABASE_URL never pays
+     for loading `pg`. Every copy this replaces did the same. */
+  const { Pool } = await import("pg");
+  const pool = new Pool({
+    connectionString: url,
+    max: options.max ?? 1,
+    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
+  });
+
+  let why = "";
+  try {
+    why = await missingThing(pool, options);
+  } catch (err) {
+    why = `could not reach it: ${(err as Error).message}`;
+  }
+
+  const reachable = why === "";
+  if (!options.keepPool || !reachable) await pool.end();
+
+  if (!reachable) {
+    process.stderr.write(
+      `\n  ⚠ ${options.suite}: DATABASE_URL is set but these tests are skipping: ${why}\n`,
+    );
+  }
+
+  return {
+    reachable,
+    why,
+    ...(options.keepPool && reachable ? { pool } : {}),
+  };
+}
+
+/**
+ * The first thing this suite needs that the database has not got, in words.
+ *
+ * Empty string means everything asked for is there. Naming the *specific*
+ * missing table or column rather than "the schema is not there" is the point:
+ * the four column probes exist because a database one migration behind used to
+ * fail with a confusing 42703 rather than an instruction.
+ */
+async function missingThing(pool: Pool, options: PgReadyOptions): Promise<string> {
+  /* A live connection, which is all `db-transaction-errors` wants, and which
+     also separates "the server is down" from "the migration has not run". */
+  await pool.query("select 1");
+
+  for (const table of options.tables ?? []) {
+    const probe = await pool.query<{ ready: boolean }>(
+      "select to_regclass($1) is not null as ready",
+      [table],
+    );
+    if (probe.rows[0]?.ready !== true) return `${table} is not there — run npm run db:migrate`;
+  }
+
+  for (const { table, column } of options.columns ?? []) {
+    const [schema, name] = splitTable(table);
+    const probe = await pool.query<{ ready: boolean }>(
+      `select exists (
+         select 1 from information_schema.columns
+         where table_schema = $1 and table_name = $2 and column_name = $3
+       ) as ready`,
+      [schema, name, column],
+    );
+    if (probe.rows[0]?.ready !== true) {
+      return `${table}.${column} is missing — run npm run db:migrate`;
+    }
+  }
+
+  for (const table of options.readable ?? []) {
+    /* A separate statement rather than another `exists`: existing and being
+       readable are different failures, and only the second is a grant. */
+    try {
+      await pool.query(`select 1 from ${table} limit 1`);
+    } catch (err) {
+      return `${table} is not readable by this role: ${(err as Error).message}`;
+    }
+  }
+
+  return "";
+}
+
+/** `spideryarn.articles` → `["spideryarn", "articles"]`. */
+function splitTable(qualified: string): [string, string] {
+  const at = qualified.indexOf(".");
+  if (at < 0) return ["public", qualified];
+  return [qualified.slice(0, at), qualified.slice(at + 1)];
+}
diff --git a/tests/paid-cli-ledger.test.ts b/tests/paid-cli-ledger.test.ts
index 224e4ca..8ca526d 100644
--- a/tests/paid-cli-ledger.test.ts
+++ b/tests/paid-cli-ledger.test.ts
@@ -157,6 +157,9 @@ const SKIP_KEYS = new Set([
 /** The name every one of these modules gives its entry function. */
 const MAIN = "main";
 
+/** The export in src/env.ts that reads `.env.local`, by its name at the source. */
+const LOAD_ENV = "loadEnvLocal";
+
 /** Nodes whose body is code the surrounding statement *defines* rather than runs. */
 const FUNCTIONS = new Set([
   "FunctionDeclaration",
@@ -253,21 +256,23 @@ function mentionsAnyName(node: unknown, names: ReadonlySet<string>): boolean {
 }
 
 /**
- * The local name `withLedger` was imported under, or `null`.
+ * The local name a given export was imported under, or `null`.
  *
  * **By binding, not by spelling.** A file that defines its own `withLedger` and
  * calls it has satisfied every text matcher and opened no ledger; this is the
- * check that tells the two apart.
+ * check that tells the two apart. `envOffence` needs exactly the same question
+ * asked about `loadEnvLocal`, which is why this takes the module and the export
+ * rather than hard-coding one pair.
  */
-function ledgerLocalName(body: Node[]): string | null {
+function importedLocalName(body: Node[], moduleSuffix: string, exported: string): string | null {
   for (const stmt of body) {
     if (stmt.type !== "ImportDeclaration") continue;
     const spec = (stmt.source as { value?: string } | undefined)?.value ?? "";
-    if (!spec.endsWith("/cli-ledger.js")) continue;
+    if (!spec.endsWith(moduleSuffix)) continue;
     if (stmt.importKind === "type") continue;
     for (const sp of (stmt.specifiers ?? []) as Node[]) {
       if (sp.type !== "ImportSpecifier" || sp.importKind === "type") continue;
-      if ((sp.imported as { name?: string } | undefined)?.name === "withLedger") {
+      if ((sp.imported as { name?: string } | undefined)?.name === exported) {
         return (sp.local as { name: string }).name;
       }
     }
@@ -275,6 +280,11 @@ function ledgerLocalName(body: Node[]): string | null {
   return null;
 }
 
+/** The local name `withLedger` was imported under, or `null`. */
+function ledgerLocalName(body: Node[]): string | null {
+  return importedLocalName(body, "/cli-ledger.js", "withLedger");
+}
+
 /**
  * The top-level `if`s that run when this module is the entry file.
  *
@@ -412,6 +422,83 @@ function declaresMain(body: Node[]): boolean {
   return false;
 }
 
+/**
+ * **The function `main` is, if it is a function at all.**
+ *
+ * `declaresMain` above answers whether the name exists, which is all the ledger
+ * rule needs. This one hands back the body, because the `.env.local` rule is
+ * about what happens *inside* it.
+ */
+function mainFunction(body: Node[]): Node | null {
+  for (const raw of body) {
+    const stmt =
+      raw.type === "ExportNamedDeclaration" || raw.type === "ExportDefaultDeclaration"
+        ? ((raw.declaration as Node | undefined) ?? raw)
+        : raw;
+    const id = stmt.id as { name?: string } | undefined;
+    if (stmt.type === "FunctionDeclaration" && id?.name === MAIN) return stmt;
+    if (stmt.type !== "VariableDeclaration") continue;
+    for (const d of (stmt.declarations ?? []) as Node[]) {
+      const declared = d.id as { type?: string; name?: string } | undefined;
+      if (declared?.type !== "Identifier" || declared.name !== MAIN) continue;
+      const init = d.init as Node | undefined;
+      if (init && FUNCTIONS.has(init.type as string)) return init;
+      return null;
+    }
+  }
+  return null;
+}
+
+/**
+ * **Every paid CLI reads `.env.local` before it spends.**
+ *
+ * The gap this closes is not money, it is a lie about the machine. Seven of the
+ * eight call `loadEnvLocal()` at the top of `main`; `src/pdf-read.ts` did not,
+ * so `npm run pdf x.pdf` from a shell with no exported key failed with
+ * "OPENROUTER_API_KEY is not set" while the key sat in `.env.local` — a missing
+ * credential, apparently, rather than an unread file. `src/ideas.ts` carried a
+ * comment calling that a real gap across the other stages; by the time this was
+ * written the comment was true of one file and named none of them.
+ *
+ * **In `main`, and it is checked there on purpose.** That same comment says why:
+ * doing it inside the generator would be a no-op under the server, which loads
+ * `.env.local` through `vite.config.ts` before any stage runs, and would pull
+ * `node:fs` into a path that has no use for it.
+ *
+ * **What the walk counts as "calls".** `{ deferred: false }` — what `main`
+ * actually runs, not what it merely defines. A `loadEnvLocal` mentioned inside a
+ * helper that `main` declares and never invokes reads as an offence, which is
+ * the safe direction.
+ */
+export function envOffence(file: string, source: string): string | null {
+  const { body, errors } = parseSource(source);
+  if (errors > 0) {
+    return `${file} — could not be parsed (${errors} error(s)), so nothing here was checked`;
+  }
+  const local = importedLocalName(body, "/env.js", LOAD_ENV);
+  if (!local) return `${file} — imports no ${LOAD_ENV} from ./env.js`;
+
+  const main = mainFunction(body);
+  if (!main) return `${file} — declares no top-level ${MAIN}() function to read .env.local in`;
+
+  /* Same trap as the ledger rule: a local of the same spelling satisfies every
+     matcher that reads the callee's text and reads no file. */
+  if (shadowsBinding(main.body, local)) {
+    return `${file} — ${MAIN}() declares its own ${local}, shadowing the import from ./env.js`;
+  }
+
+  let called = false;
+  walk(main.body, { deferred: false }, (n) => {
+    if (n.type !== "CallExpression" && n.type !== "OptionalCallExpression") return;
+    const callee = n.callee as Node | undefined;
+    if (callee?.type === "Identifier" && callee.name === local) called = true;
+  });
+  if (!called) {
+    return `${file} — ${MAIN}() never calls ${local}(), so a key in .env.local goes unread`;
+  }
+  return null;
+}
+
 /**
  * **The verdict on one call the entrypoint branch runs.**
  *
@@ -881,3 +968,124 @@ describe("the listed stage CLIs open the ledger", () => {
     }
   });
 });
+
+/**
+ * **The same eight CLIs read `.env.local` before they spend.**
+ *
+ * A sibling rule rather than part of the one above, because it is about a
+ * different failure. The ledger rule is about money going missing; this one is
+ * about a working machine reporting itself broken: `npm run pdf x.pdf` from a
+ * shell with no exported key answered "OPENROUTER_API_KEY is not set" while the
+ * key was sitting in `.env.local`, unread.
+ *
+ * It shares the list, the parser and the binding check, which is the reason it
+ * lives here. `PAID_CLIS` is already the set of modules that spend, and a CLI
+ * that spends is exactly a CLI that needs a key.
+ *
+ * **The edge of this, in the same spirit as the header.** It checks the eight
+ * named above and nothing else — `src/embeddings.ts`, `src/converse.ts` and
+ * `src/explain.ts` also call `loadEnvLocal()` and are outside the list because
+ * they are outside `PAID_CLIS`. And it cannot see a CLI that reads a key some
+ * other way.
+ */
+describe("the listed stage CLIs read .env.local", () => {
+  it("calls loadEnvLocal() inside main(), in every one of them", () => {
+    const offenders = Object.keys(PAID_CLIS)
+      .map((file) => envOffence(file, read(file)))
+      .filter((o): o is string => o !== null);
+
+    expect(
+      offenders,
+      "These CLIs spend money and never read .env.local, so running one from a shell\n" +
+        "that has not exported the key fails as though the credential were missing\n" +
+        "rather than unread. Call loadEnvLocal() at the top of main() — src/env.ts,\n" +
+        "and see the note in src/ideas.ts on why it belongs in main and not deeper.\n",
+    ).toEqual([]);
+  });
+
+  /**
+   * **Proved against the broken state**, the same way the ledger rule is.
+   * docs/reusable/silent-success.md — a rule nobody has watched fail is not
+   * evidence, and this one had eight green files the moment it was written,
+   * which is the most convincing way for a new check to be doing nothing.
+   */
+  describe("the detector goes red when it should", () => {
+    const IMPORT = 'import { loadEnvLocal } from "./env.js";\n';
+    const bad: [string, string, string][] = [
+      [
+        "main() never calls it — src/pdf-read.ts before 2026-08-28",
+        `${IMPORT}async function main(): Promise<void> {\n  await run();\n}\n`,
+        "fixture.ts — main() never calls loadEnvLocal(), so a key in .env.local goes unread",
+      ],
+      [
+        "the import missing entirely",
+        "async function main(): Promise<void> {\n  loadEnvLocal();\n}\n",
+        "fixture.ts — imports no loadEnvLocal from ./env.js",
+      ],
+      [
+        /* The binding trap again: right spelling, no import behind it. */
+        "a local loadEnvLocal shadowing the real import",
+        `${IMPORT}async function main(): Promise<void> {\n  const loadEnvLocal = () => {};\n  loadEnvLocal();\n}\n`,
+        "fixture.ts — main() declares its own loadEnvLocal, shadowing the import from ./env.js",
+      ],
+      [
+        /* Defining is not running. A helper that would have read the file, had
+           anything called it, leaves the key just as unread. */
+        "the call inside a helper main() declares and never invokes",
+        `${IMPORT}async function main(): Promise<void> {\n  const setup = () => loadEnvLocal();\n  await run();\n}\n`,
+        "fixture.ts — main() never calls loadEnvLocal(), so a key in .env.local goes unread",
+      ],
+      [
+        "a call in a comment, which is not a call",
+        `${IMPORT}async function main(): Promise<void> {\n  /* loadEnvLocal(); */\n  await run();\n}\n`,
+        "fixture.ts — main() never calls loadEnvLocal(), so a key in .env.local goes unread",
+      ],
+      [
+        /* Called at module scope instead: it runs, but on *import* as well as on
+           start, which is the thing the note in src/ideas.ts refuses. */
+        "called at the top level rather than in main()",
+        `${IMPORT}loadEnvLocal();\nasync function main(): Promise<void> {\n  await run();\n}\n`,
+        "fixture.ts — main() never calls loadEnvLocal(), so a key in .env.local goes unread",
+      ],
+      [
+        "a module with no main() at all",
+        `${IMPORT}loadEnvLocal();\n`,
+        "fixture.ts — declares no top-level main() function to read .env.local in",
+      ],
+      [
+        "a file that will not parse, which checks nothing and must not read as clean",
+        `${IMPORT}async function main(): Promise<void> {\n  const ) = ;\n}\n`,
+        "",
+      ],
+    ];
+
+    for (const [name, source, expected] of bad) {
+      it(name, () => {
+        const offence = envOffence("fixture.ts", source);
+        expect(offence, "the detector said this fixture was fine").not.toBeNull();
+        if (expected === "") {
+          expect(offence).toMatch(/could not be parsed/);
+        } else {
+          expect(offence).toBe(expected);
+        }
+      });
+    }
+
+    /**
+     * **And on the real file**, so the rule is anchored to the tree rather than
+     * to fixtures. The mutation has to match exactly once, for the same reason
+     * the ledger controls insist on it: an anchor that also matched the comment
+     * above the line would edit prose and leave the code running.
+     */
+    it("goes red on src/pdf-read.ts the moment the call is taken out", () => {
+      const source = read("src/pdf-read.ts");
+      expect(envOffence("src/pdf-read.ts", source)).toBeNull();
+      expect(source.split("\n  loadEnvLocal();").length - 1).toBe(1);
+      const without = source.replace("\n  loadEnvLocal();", "");
+      expect(without, "the mutation matched nothing").not.toBe(source);
+      expect(envOffence("src/pdf-read.ts", without)).toBe(
+        "src/pdf-read.ts — main() never calls loadEnvLocal(), so a key in .env.local goes unread",
+      );
+    });
+  });
+});
diff --git a/tests/parse-json.test.ts b/tests/parse-json.test.ts
index 7bb4639..d61f90c 100644
--- a/tests/parse-json.test.ts
+++ b/tests/parse-json.test.ts
@@ -46,7 +46,7 @@ import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
 import path from "node:path";
 import { fileURLToPath } from "node:url";
 import { afterAll, beforeAll, describe, expect, it } from "vitest";
-import { MalformedJson, parseJsonFrom } from "../src/parse-json.js";
+import { MalformedJson, parseJsonFrom, readJsonOrNull, stripFence } from "../src/parse-json.js";
 
 const TSX = fileURLToPath(new URL("../node_modules/.bin/tsx", import.meta.url));
 const ROOT = fileURLToPath(new URL("..", import.meta.url));
@@ -298,3 +298,111 @@ function grab(run: () => unknown): MalformedJson {
   }
   throw new Error("expected a MalformedJson, but nothing was thrown");
 }
+
+/* -------------------------------------------------------------- stripFence --
+   Eight stage files each had their own fence-stripper, in two spellings:
+   `.replace(/```$/, "").trim()` and `.replace(/\s*```$/, "")`. Before unifying
+   them, both were run against every awkward input below and agreed on all of
+   them, so the divergence was accidental and this is a pure dedup.
+
+   The comparison is kept here rather than thrown away, because the claim it
+   supports ("no behaviour change") is the only thing standing between this and
+   a silent regression. `OLD_A` and `OLD_B` are the two spellings exactly as
+   they were in the tree; if a future edit to `stripFence` moves it away from
+   either, the tests below say so with the input that separated them. */
+
+const F = "```";
+const OLD_A = (raw: string) =>
+  raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```$/, "").trim();
+const OLD_B = (raw: string) =>
+  raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
+
+/** Every input the two spellings were compared on. */
+const AWKWARD: ReadonlyArray<readonly [string, string]> = [
+  ["a bare fence", `${F}\n{"a":1}\n${F}`],
+  ["a json fence", `${F}json\n{"a":1}\n${F}`],
+  ["an uppercase JSON fence", `${F}JSON\n{"a":1}\n${F}`],
+  ["CRLF line endings", `${F}json\r\n{"a":1}\r\n${F}`],
+  ["backticks inside a string", `${F}json\n{"a":"see ${F} here"}\n${F}`],
+  ["a missing close fence", `${F}json\n{"a":1}`],
+  ["prose before", `Here you go:\n${F}json\n{"a":1}\n${F}`],
+  ["prose after", `${F}json\n{"a":1}\n${F}\nHope that helps!`],
+  ["no fence at all", `{"a":1}`],
+  ["a fence with no newlines", `${F}json {"a":1} ${F}`],
+  ["trailing spaces after the close", `${F}json\n{"a":1}\n${F}   `],
+  ["a fourth backtick on the close", `${F}json\n{"a":1}\n${F}\``],
+  ["leading whitespace before the fence", `  \n ${F}json\n{"a":1}\n${F}`],
+  ["nothing at all", ""],
+  ["only a fence", F],
+  ["a fence around nothing", `${F}json\n\n${F}`],
+  ["an indented close fence", `${F}json\n{"a":1}\n  ${F}`],
+  ["a fence line inside a string", `${F}json\n{"a":"x\\n${F}\\ny"}\n${F}`],
+];
+
+describe("stripFence", () => {
+  it("agrees with both spellings it replaced, on every awkward input", () => {
+    for (const [name, input] of AWKWARD) {
+      expect(stripFence(input), `${name}: differs from the .trim() spelling`).toBe(OLD_A(input));
+      expect(stripFence(input), `${name}: differs from the \\s* spelling`).toBe(OLD_B(input));
+    }
+  });
+
+  it("the comparison above can actually fail", () => {
+    /* Without this the loop is a claim about a function compared with itself.
+       A stripper that only trims agrees with `stripFence` on "no fence at all"
+       and disagrees everywhere a fence exists — so if this ever stops throwing,
+       the loop above has stopped comparing anything.
+       docs/reusable/silent-success.md § Test the test. */
+    const onlyTrims = (raw: string) => raw.trim();
+    const fenced = AWKWARD.filter(([, input]) => input.includes(F) && input.trim() !== F);
+    expect(fenced.length).toBeGreaterThan(10);
+    for (const [name, input] of fenced) {
+      expect(onlyTrims(input), `${name} should have been changed by stripping`).not.toBe(
+        stripFence(input),
+      );
+    }
+  });
+
+  it("takes the fence off and leaves the JSON parseable", () => {
+    expect(JSON.parse(stripFence(`${F}json\n{"a":1}\n${F}`))).toEqual({ a: 1 });
+    expect(JSON.parse(stripFence(`{"a":1}`))).toEqual({ a: 1 });
+  });
+
+  it("leaves prose before the object alone, because parseHits needs it there", () => {
+    /* src/search.ts is the one caller that hunts for the first `{` itself, and
+       it can only do that if this has not already thrown the prose away. */
+    expect(stripFence(`Here you go:\n${F}json\n{"a":1}\n${F}`)).toContain("Here you go:");
+  });
+});
+
+/* ---------------------------------------------------------- readJsonOrNull -- */
+
+describe("readJsonOrNull", () => {
+  it("reads a JSON artefact", async () => {
+    const dir = path.join(STORE_DIR, "read-json-or-null");
+    await mkdir(dir, { recursive: true });
+    const file = path.join(dir, "ok.json");
+    await writeFile(file, JSON.stringify({ a: 1 }));
+    expect(await readJsonOrNull<{ a: number }>(file)).toEqual({ a: 1 });
+  });
+
+  it("answers null for missing and for corrupt alike", async () => {
+    const dir = path.join(STORE_DIR, "read-json-or-null");
+    await mkdir(dir, { recursive: true });
+    const corrupt = path.join(dir, "corrupt.json");
+    await writeFile(corrupt, '{"a": "ZQREADJSON');
+    expect(await readJsonOrNull(corrupt)).toBeNull();
+    expect(await readJsonOrNull(path.join(dir, "absent.json"))).toBeNull();
+  });
+
+  it("throws nothing, so V8's quotation of the file never reaches a log", async () => {
+    /* The whole justification for a bare `JSON.parse` living in this module.
+       The marker is what a corrupt artefact's first characters would be, and
+       the point is that nothing anywhere can be handed them. */
+    const dir = path.join(STORE_DIR, "read-json-or-null");
+    await mkdir(dir, { recursive: true });
+    const corrupt = path.join(dir, "quoted.json");
+    await writeFile(corrupt, "ZQREADJSONLEAK is not JSON at all");
+    await expect(readJsonOrNull(corrupt)).resolves.toBeNull();
+  });
+});
diff --git a/tests/pg-ready.test.ts b/tests/pg-ready.test.ts
new file mode 100644
index 0000000..ede9c71
--- /dev/null
+++ b/tests/pg-ready.test.ts
@@ -0,0 +1,184 @@
+/**
+ * The shared Postgres readiness probe, both ways round.
+ *
+ * Thirty-two suites now decide whether to run by calling `pgReady`, so its
+ * *skip* branch is load-bearing in a way that is hard to see: on a laptop with
+ * Docker running it never executes, and a helper whose warn branch has never
+ * run is not evidence that a skip would be noticed. That is the whole failure
+ * this helper was written to stop — a suite opting itself out inside a green
+ * run. docs/reusable/silent-success.md.
+ *
+ * So each test below makes the probe fail on purpose, in one of the four ways
+ * it can, and asserts on the **warning** as well as the verdict: a probe that
+ * returned `false` without saying so would pass every "is it false" assertion
+ * ever written about it.
+ *
+ * The happy path needs a real database and skips (loudly, through the helper
+ * itself) without one.
+ */
+import { afterEach, describe, expect, it, vi } from "vitest";
+
+import { loadEnvLocal } from "../src/env.js";
+import { pgReady } from "./helpers/pg-ready.js";
+
+loadEnvLocal();
+
+/** The live database, or empty — captured before any test stubs the variable. */
+const LIVE_URL = process.env.DATABASE_URL ?? "";
+
+/**
+ * A port nothing is listening on, on the loopback.
+ *
+ * Refused, not dropped, so the failure arrives in milliseconds instead of
+ * waiting out the ten-second connect timeout. What is being proved here is that
+ * an unreachable database warns — not how long it takes to notice.
+ */
+const DEAD_URL = "postgresql://postgres:postgres@127.0.0.1:1/postgres";
+
+/**
+ * Everything written to **stderr** while `fn` ran, joined.
+ *
+ * Not `console.warn`, because the helper does not use it and must not: vitest
+ * swallows a module-load `console.warn` from a file whose tests all skip, so the
+ * warning would be invisible in exactly the run that needs it. See the helper's
+ * header. Spying here on the same call the helper makes keeps this test on the
+ * observable outcome rather than on a stand-in for it.
+ */
+async function warningsDuring(fn: () => Promise<unknown>): Promise<string> {
+  const said: string[] = [];
+  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
+    said.push(String(chunk));
+    return true;
+  });
+  try {
+    await fn();
+  } finally {
+    spy.mockRestore();
+  }
+  return said.join("\n");
+}
+
+afterEach(() => {
+  vi.unstubAllEnvs();
+});
+
+describe("pgReady, when the database cannot answer", () => {
+  it("says nothing at all when there is no DATABASE_URL — the fresh clone", async () => {
+    vi.stubEnv("DATABASE_URL", "");
+    let result: Awaited<ReturnType<typeof pgReady>> | undefined;
+    const said = await warningsDuring(async () => {
+      result = await pgReady({ suite: "tests/pg-ready.test.ts", tables: ["spideryarn.articles"] });
+    });
+    expect(result?.reachable).toBe(false);
+    /* Quiet on purpose: no database configured is not the same situation as a
+       database configured and missing, and only the second one is a surprise. */
+    expect(said).toBe("");
+  });
+
+  it("warns, and names the suite, when nothing is listening", async () => {
+    vi.stubEnv("DATABASE_URL", DEAD_URL);
+    let result: Awaited<ReturnType<typeof pgReady>> | undefined;
+    const said = await warningsDuring(async () => {
+      result = await pgReady({ suite: "tests/pg-ready.test.ts", tables: ["spideryarn.articles"] });
+    });
+    expect(result?.reachable).toBe(false);
+    /* The suite's name is the point of the warning. Thirty-two files share one
+       stderr, and "these tests are skipping" without a name tells you nothing
+       you can act on. */
+    expect(said).toContain("tests/pg-ready.test.ts");
+    expect(said).toContain("skipping");
+    expect(result?.why).toContain("could not reach it");
+  });
+
+  it("does not hand back a pool it could not build, even when asked to", async () => {
+    vi.stubEnv("DATABASE_URL", DEAD_URL);
+    let result: Awaited<ReturnType<typeof pgReady>> | undefined;
+    /* Inside `warningsDuring` even though the warning is not what is being
+       asserted: every call here is deliberately unreachable, and one that wrote
+       its warning to the real stderr would put a genuine-looking "these tests
+       are skipping" line into every `npm test`. */
+    await warningsDuring(async () => {
+      result = await pgReady({
+        suite: "tests/pg-ready.test.ts",
+        tables: ["spideryarn.articles"],
+        keepPool: true,
+      });
+    });
+    expect(result?.reachable).toBe(false);
+    /* A caller writing `if (reachable && pool)` is fine either way; one writing
+       `pool!.query(…)` would get an unhandled rejection out of a *skipped*
+       suite, which is the confusing failure this guarantees away. */
+    expect(result?.pool).toBeUndefined();
+  });
+});
+
+const when = LIVE_URL ? describe : describe.skip;
+if (!LIVE_URL) {
+  /* stderr, not console.warn, for the reason the helper's header gives. */
+  process.stderr.write("\n  ⚠ tests/pg-ready.test.ts: no DATABASE_URL, so the live half is skipping\n");
+}
+
+when("pgReady, against the real database", () => {
+  it("is reachable for a table that is there, and says nothing", async () => {
+    let result: Awaited<ReturnType<typeof pgReady>> | undefined;
+    const said = await warningsDuring(async () => {
+      result = await pgReady({ suite: "tests/pg-ready.test.ts", tables: ["spideryarn.articles"] });
+    });
+    expect(result?.reachable).toBe(true);
+    expect(result?.why).toBe("");
+    expect(said).toBe("");
+  });
+
+  it("warns and names the TABLE when the migration has not run", async () => {
+    let result: Awaited<ReturnType<typeof pgReady>> | undefined;
+    const said = await warningsDuring(async () => {
+      result = await pgReady({
+        suite: "tests/pg-ready.test.ts",
+        tables: ["spideryarn.articles", "spideryarn.no_such_table"],
+      });
+    });
+    expect(result?.reachable).toBe(false);
+    /* Naming the missing thing is why the probe is parameterised rather than one
+       shared boolean: "the schema is not there" sends you to the wrong place
+       when what is actually missing is one migration's table. */
+    expect(said).toContain("spideryarn.no_such_table");
+    expect(said).toContain("npm run db:migrate");
+  });
+
+  it("warns and names the COLUMN when the table is there but a migration behind", async () => {
+    let result: Awaited<ReturnType<typeof pgReady>> | undefined;
+    const said = await warningsDuring(async () => {
+      result = await pgReady({
+        suite: "tests/pg-ready.test.ts",
+        columns: [{ table: "spideryarn.articles", column: "no_such_column" }],
+      });
+    });
+    expect(result?.reachable).toBe(false);
+    expect(said).toContain("spideryarn.articles.no_such_column");
+  });
+
+  it("separates readable from existing, which is a grant and not a migration", async () => {
+    let result: Awaited<ReturnType<typeof pgReady>> | undefined;
+    const said = await warningsDuring(async () => {
+      result = await pgReady({
+        suite: "tests/pg-ready.test.ts",
+        readable: ["spideryarn.no_such_table"],
+      });
+    });
+    expect(result?.reachable).toBe(false);
+    expect(said).toContain("not readable by this role");
+  });
+
+  it("hands back a live pool when asked, and the caller can query through it", async () => {
+    const { reachable, pool } = await pgReady({
+      suite: "tests/pg-ready.test.ts",
+      tables: ["spideryarn.articles"],
+      keepPool: true,
+    });
+    expect(reachable).toBe(true);
+    expect(pool).toBeDefined();
+    const rows = await pool!.query<{ n: number }>("select 1 as n");
+    expect(rows.rows[0]?.n).toBe(1);
+    await pool!.end();
+  });
+});
diff --git a/tests/refused-writes-are-reported.test.tsx b/tests/refused-writes-are-reported.test.tsx
new file mode 100644
index 0000000..5c93ce7
--- /dev/null
+++ b/tests/refused-writes-are-reported.test.tsx
@@ -0,0 +1,404 @@
+// @vitest-environment jsdom
+/**
+ * **A write the server refused must not look like one that worked.**
+ *
+ * Six call sites across four surfaces send a DELETE, a POST or a PATCH whose
+ * body nobody reads, and every one of them once shipped — or nearly shipped —
+ * the same defect: the response was never looked at, so a 500 took the row off
+ * the reader's screen and said nothing, and they found it back after a reload.
+ * The comment above each of them says so. What none of them had was a test, and
+ * that is what let the same omission happen twice in two hooks.
+ *
+ * `fetchOk` (src/web/lib/api.ts) is the check made unforgettable. This file is
+ * the measure of it taken from outside: it drives each surface through a real
+ * `apiFetch` and a real `fetchOk` against a stubbed **global `fetch`**, so the
+ * thing under test is the code that actually runs rather than a stand-in for
+ * it.
+ *
+ * **`lib/api.js` is deliberately not mocked**, and that is the whole design of
+ * this file. Two neighbouring tests replace `apiFetch` through `vi.mock`
+ * (`use-comments-load-state`, `glossary-one-fetch`), which is right for what
+ * they are about and useless here: `fetchOk` calls `apiFetch` *inside* the
+ * module, so a mocked `apiFetch` never reaches it, and a mocked `fetchOk` would
+ * be the test asserting against its own fake. Only `lib/supabase.js` is stood
+ * in for — it is a network client and an access token is not what any of this
+ * is about.
+ *
+ * The control: break `fetchOk` so it returns the refused response instead of
+ * throwing, and every test below goes red naming the message it expected. With
+ * the check in place and this file absent, 207 tests across the fifteen files
+ * that touch these hooks all passed against that same break — which is what
+ * "there is no test on the error path" looks like from the inside.
+ */
+import { act, createElement } from "react";
+import { createRoot, type Root } from "react-dom/client";
+import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
+import type { Comment, LibraryEntry } from "../src/types.js";
+import type { GlossaryRead } from "../src/web/useGlossary.js";
+import type { Shelf } from "../src/web/ShelfEntry.js";
+
+/**
+ * The auth client, and nothing else from `lib/`.
+ *
+ * `apiFetch` asks for an access token before every request; the real client
+ * would reach for `localStorage` and the network, and `apiFetch`'s own 1.5s
+ * deadline would then be paid once per request here. Resolving to no session is
+ * exactly what an anonymous request does, and `apiFetch` handles it — the
+ * server's answer is what these tests are about.
+ */
+vi.mock("../src/web/lib/supabase.js", () => ({
+  supabase: {
+    auth: {
+      getSession: () => Promise.resolve({ data: { session: null } }),
+      refreshSession: () => Promise.resolve({ data: { session: null } }),
+      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
+    },
+  },
+}));
+
+/* The job poller and the reader profile, posed rather than run. `useGlossary`
+   needs both to mount, and neither has anything to do with a refused DELETE —
+   except `run`, which is the thing a refused reset must NOT reach. */
+const ran: boolean[] = [];
+vi.mock("../src/web/useJobs.js", () => ({
+  useJobs: () => ({
+    jobs: [],
+    loaded: true,
+    error: null,
+    run: async (_slug: string, _steps: string[], force?: boolean) => {
+      ran.push(force ?? false);
+      return null;
+    },
+    cancel: async () => {},
+  }),
+}));
+vi.mock("../src/web/useProfile.js", () => ({ useHasProfile: () => false }));
+
+const { useComments } = await import("../src/web/useComments.js");
+const { useSearch } = await import("../src/web/useSearch.js");
+const { useGlossary } = await import("../src/web/useGlossary.js");
+const { Actions } = await import("../src/web/ShelfEntry.js");
+
+/* ------------------------------------------------------------- the server --- */
+
+/**
+ * What the stubbed `fetch` answers, decided per request.
+ *
+ * A **real `Response`**, never a hand-built `{ ok, text }`. `failure` reads the
+ * status, the body and the `content-type` header, so a flat object would either
+ * throw inside the code under test or agree with it by accident — and a fake
+ * that cannot express the failure is the shape docs/reusable/silent-success.md
+ * is about. Two neighbouring test files build `{ ok: true, text }` literals;
+ * that works for `readJson` and would not work here.
+ */
+function refused(): Response {
+  return new Response(JSON.stringify({ error: "The store would not take that. [store-no]" }), {
+    status: 500,
+    headers: { "content-type": "application/json" },
+  });
+}
+
+/**
+ * A refusal whose body dies while it is being read — a connection cut after the
+ * headers arrived, a proxy giving up mid-response.
+ *
+ * A real `Response` over an errored stream, so `text()` rejects the way it
+ * really does. This is the only shape that tells `failure` and `readJson` apart.
+ */
+function tornRefusal(): Response {
+  return new Response(
+    new ReadableStream({
+      start(c) {
+        c.error(new TypeError("terminated"));
+      },
+    }),
+    { status: 500, headers: { "content-type": "application/json" } },
+  );
+}
+
+function fine(body: unknown): Response {
+  return new Response(JSON.stringify(body), {
+    status: 200,
+    headers: { "content-type": "application/json" },
+  });
+}
+
+/** Which methods the server refuses this test. Everything else succeeds. */
+let refusing = new Set<string>();
+/** Whether the refusal's body dies mid-read. Set by the one test about it. */
+let torn = false;
+/** What a GET answers with, per path fragment. */
+let reads: Record<string, unknown> = {};
+/** Every write the stub was asked to make, so a test can prove one was sent. */
+let sent: { method: string; url: string }[] = [];
+
+beforeEach(() => {
+  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
+  refusing = new Set();
+  torn = false;
+  sent = [];
+  ran.length = 0;
+  reads = {
+    "/api/comments/": { comments: [] },
+    "/api/search/": { runs: [] },
+    "/api/glossary/": {
+      glossary: { version: 1, model: "t", sourceHash: "abc", profileHash: null, entries: [] },
+      stale: false,
+      outdated: false,
+      profileChanged: false,
+    },
+  };
+  vi.stubGlobal(
+    "fetch",
+    vi.fn((url: string, init?: RequestInit) => {
+      const method = (init?.method ?? "GET").toUpperCase();
+      if (method === "GET") {
+        const key = Object.keys(reads).find((k) => url.startsWith(k));
+        return Promise.resolve(fine(key ? reads[key] : {}));
+      }
+      sent.push({ method, url });
+      if (torn) return Promise.resolve(tornRefusal());
+      if (refusing.has(method)) return Promise.resolve(refused());
+      return Promise.resolve(fine({ comment: STORED, entry: {} }));
+    }),
+  );
+  container = document.createElement("div");
+  document.body.appendChild(container);
+  root = createRoot(container);
+});
+
+afterEach(async () => {
+  await act(async () => root.unmount());
+  container.remove();
+  vi.unstubAllGlobals();
+});
+
+/* -------------------------------------------------------------- the mount --- */
+
+let container: HTMLDivElement;
+let root: Root;
+
+/** Let the fetch chain and the state it sets actually settle. */
+async function settle(times = 6): Promise<void> {
+  for (let i = 0; i < times; i++) {
+    await act(async () => {
+      await new Promise((r) => setTimeout(r, 0));
+    });
+  }
+}
+
+const STORED: Comment = {
+  id: "cmt-1",
+  blockId: "spya-k3m9qt",
+  quote: "the sentence he asked about",
+  start: 0,
+  createdAt: "2026-08-27T10:00:00.000Z",
+  status: "done",
+  answer: "Because of the thing in the paragraph before.",
+};
+
+/** The one sentence the server sent, as the reader should end up seeing it. */
+const SAID = "The store would not take that. [store-no]";
+
+/* ---------------------------------------------------------------- comments --- */
+
+describe("useComments, when the server refuses the write", () => {
+  let api: ReturnType<typeof useComments> | undefined;
+  function Harness() {
+    api = useComments("a-slug");
+    return null;
+  }
+  async function mount(): Promise<void> {
+    await act(async () => root.render(createElement(Harness)));
+    await settle();
+  }
+
+  it("says so when a DELETE is refused, instead of letting the row look deleted", async () => {
+    await mount();
+    refusing.add("DELETE");
+
+    await act(async () => api?.remove("cmt-1"));
+    await settle();
+
+    expect(sent.map((s) => s.method)).toContain("DELETE");
+    expect(api?.error).toBe(SAID);
+  });
+
+  it("puts the reader's comment back when the POST is refused, and says why", async () => {
+    await mount();
+    refusing.add("POST");
+
+    await act(async () => {
+      await api?.create({ id: "cmt-new", blockId: "spya-k3m9qt", quote: "a passage", start: 0 });
+    });
+    await settle();
+
+    expect(sent.map((s) => s.method)).toContain("POST");
+    expect(api?.error).toBe(SAID);
+    /* The optimistic row is rolled back, so the mark over the passage goes with
+       it rather than standing there over a comment the server never took. */
+    expect(api?.comments).toHaveLength(0);
+  });
+
+  /**
+   * **The one thing `fetchOk` does here that `readJson` would not.**
+   *
+   * `create` and `edit` read the body afterwards, so `readJson` already refuses
+   * a 500 — which means the two tests above pass with `fetchOk`'s check deleted,
+   * and on their own they would be an argument for deleting it. This is the case
+   * that separates them. `failure` reads the body with a `.catch`; `readJson`
+   * does not. So a 500 whose connection is cut after the headers arrived reaches
+   * the reader as its status through one and as a `TypeError` through the other
+   * — and `describeFetchFailure` turns any `TypeError` into *"Couldn't reach the
+   * dev server"*, which is both false and unactionable for somebody on a
+   * production page whose server answered perfectly well.
+   */
+  it("keeps the status when a refused reply's body dies mid-read", async () => {
+    await mount();
+    torn = true;
+
+    await act(async () => {
+      await api?.create({ id: "cmt-new", blockId: "spya-k3m9qt", quote: "a passage", start: 0 });
+    });
+    await settle();
+
+    expect(api?.error).toBe(
+      "Request failed (500) — the server's reply wasn't JSON, so the browser console has more.",
+    );
+  });
+
+  it("says so when an edit is refused, rather than showing the new words", async () => {
+    reads["/api/comments/"] = { comments: [STORED] };
+    await mount();
+    expect(api?.comments).toHaveLength(1);
+    refusing.add("PATCH");
+
+    await act(async () => {
+      await api?.edit("cmt-1", "words the server will not take");
+    });
+    await settle();
+
+    expect(sent.map((s) => s.method)).toContain("PATCH");
+    expect(api?.error).toBe(SAID);
+    /* The stored row is untouched — the reader is told the edit did not land,
+       and what is on screen is still what is in the store. */
+    expect(api?.comments[0]?.body).toBeUndefined();
+  });
+});
+
+/* ------------------------------------------------------------------ search --- */
+
+describe("useSearch, when the server refuses the write", () => {
+  let api: ReturnType<typeof useSearch> | undefined;
+  function Harness() {
+    api = useSearch("a-slug");
+    return null;
+  }
+  async function mount(): Promise<void> {
+    await act(async () => root.render(createElement(Harness)));
+    await settle();
+  }
+
+  it("says so when a DELETE is refused, instead of letting the run look deleted", async () => {
+    await mount();
+    refusing.add("DELETE");
+
+    await act(async () => api?.remove("run-1"));
+    await settle();
+
+    expect(sent.map((s) => s.method)).toContain("DELETE");
+    expect(api?.error).toBe(SAID);
+  });
+
+  it("says so when a colour PATCH is refused, instead of letting the swatch stand", async () => {
+    await mount();
+    refusing.add("PATCH");
+
+    await act(async () => api?.recolour("run-1", 3));
+    await settle();
+
+    expect(sent.map((s) => s.method)).toContain("PATCH");
+    expect(api?.error).toBe(SAID);
+  });
+});
+
+/* ---------------------------------------------------------------- glossary --- */
+
+describe("useGlossary, when the reset DELETE is refused", () => {
+  let api: ReturnType<typeof useGlossary> | undefined;
+  /* What `Reader` hands the band. Posed rather than run: `useGlossaryRead` is
+     the *read* half and none of it is what a refused DELETE is about. */
+  const read: GlossaryRead = {
+    status: "none",
+    glossary: null,
+    stale: false,
+    outdated: false,
+    profiled: false,
+    profileChanged: false,
+    error: null,
+    reload: async () => {},
+    refresh: async () => {},
+    clear: () => {},
+    patchEntry: () => {},
+  };
+
+  function Harness() {
+    api = useGlossary("a-slug", read);
+    return null;
+  }
+
+  it("tells the reader, and does not go on to run the step", async () => {
+    await act(async () => root.render(createElement(Harness)));
+    await settle();
+    refusing.add("DELETE");
+
+    await act(async () => {
+      await api?.reset();
+    });
+    await settle();
+
+    expect(sent.map((s) => s.method)).toContain("DELETE");
+    /* `error` is `resetFailed ?? error` — the band has one line for both, and
+       the refused DELETE is the one the reader needs. */
+    expect(api?.error).toBe(SAID);
+    /* **The load-bearing half.** Forcing the step *appends* to the list the
+       reader just asked to be rid of, so a refused DELETE that fell through to
+       `run` would leave them with more terms than they started with — the exact
+       opposite of what they pressed. useGlossary.ts § `reset`. */
+    expect(ran).toEqual([]);
+  });
+});
+
+/* ------------------------------------------------------- the shelf's rerun --- */
+
+describe("the shelf's rebuild button, when the queue refuses the job", () => {
+  it("reports it, rather than going quiet as though the job were queued", async () => {
+    const reported: string[] = [];
+    const shelf = { report: (m: string) => reported.push(m) } as unknown as Shelf;
+    /* `url` is load-bearing on the fixture, not decoration: the button is drawn
+       only for an article that came from a page, because there is nothing to
+       re-fetch for one that came from a PDF. Without it this test would look for
+       a control that is correctly absent. */
+    const entry = {
+      slug: "a-slug",
+      title: "A piece",
+      url: "https://example.com/a-piece",
+    } as unknown as LibraryEntry;
+
+    await act(async () => {
+      root.render(createElement(Actions, { entry, shelf, onEdit: () => {} }));
+    });
+    refusing.add("POST");
+
+    const rebuild = [...container.querySelectorAll("button")].find((b) =>
+      /Re-fetch and rebuild/i.test(`${b.title} ${b.getAttribute("aria-label") ?? ""}`),
+    );
+    expect(rebuild, "the rebuild button is on the card").toBeTruthy();
+
+    await act(async () => rebuild?.click());
+    await settle();
+
+    expect(sent.map((s) => s.method)).toContain("POST");
+    expect(reported).toEqual([`Couldn't queue a rebuild: ${SAID}`]);
+  });
+});
diff --git a/tests/sanitize-own-api.test.ts b/tests/sanitize-own-api.test.ts
index 2779cad..2d83721 100644
--- a/tests/sanitize-own-api.test.ts
+++ b/tests/sanitize-own-api.test.ts
@@ -84,6 +84,39 @@ describe("article HTML cannot reach our API", () => {
         else process.env.SPIDERYARN_ORIGINS = before;
       }
     });
+
+    /**
+     * **Nobody has ever set `SPIDERYARN_ORIGINS`.** It is not in `.env.example`,
+     * not in `docs/project/deployment.md` and not on Vercel, so until 2026-08-28
+     * the test above was the only place it had a value and the server pass could
+     * not recognise our production host at all. The browser pass still could —
+     * it uses `location.origin` — which is what made this a half-policy wearing
+     * the shape of defence in depth, and the file's own header warns about
+     * exactly that.
+     *
+     * Vercel sets these two itself on every deployment, and
+     * `src/monitoring.ts:182` already reads a sibling (`VERCEL_ENV`), so they
+     * are known to reach the server. They carry a bare host with no scheme.
+     *
+     * Widening this list can only make the sanitiser **stricter** — `isOwnApi`
+     * returning true removes the attribute — so the failure direction of getting
+     * it wrong is a stripped link, not a leaked one.
+     */
+    for (const name of ["VERCEL_PROJECT_PRODUCTION_URL", "VERCEL_URL"]) {
+      it(`the host Vercel puts in ${name}, which carries no scheme`, () => {
+        const before = process.env[name];
+        process.env[name] = "spideryarn-greg-detre.vercel.app";
+        try {
+          const out = sanitizeHtml(
+            `<p><img src="https://spideryarn-greg-detre.vercel.app/api/health" alt="x"></p>`,
+          );
+          expect(out).not.toContain("/api/health");
+        } finally {
+          if (before === undefined) delete process.env[name];
+          else process.env[name] = before;
+        }
+      });
+    }
   });
 
   /**
```

## Four of the 28 mechanical probe migrations, as samples

The other 28 are the same shape: delete a hand-rolled `Pool`-and-`to_regclass` block, call `pgReady`
instead. `store-parity` is the file whose comment the helper quotes; `admin-store` is the one that
also needs `auth.users` readable; `store-revision-policy` had a silent hole where only the `catch`
warned; `db-schema` is the one that reported *passed* rather than *skipped*.

```diff
diff --git a/tests/admin-store.test.ts b/tests/admin-store.test.ts
index c786422..8148064 100644
--- a/tests/admin-store.test.ts
+++ b/tests/admin-store.test.ts
@@ -27,37 +27,23 @@
  * no fixture to clean up. It reads whatever is in the database it is pointed
  * at, which is why it asserts shapes and never values.
  */
-import { Pool } from "pg";
-import { afterAll, describe, expect, it } from "vitest";
+import { describe, expect, it } from "vitest";
 
 import { loadEnvLocal } from "../src/env.js";
+import { pgReady } from "./helpers/pg-ready.js";
 
 loadEnvLocal();
 
-const url = process.env.DATABASE_URL;
+/* Both halves matter: our own schema has to be migrated, and the role has to be
+   able to read `auth.users` at all — which is a grant rather than a migration,
+   and is the thing most likely to differ in production.
 
-let pool: Pool | undefined;
-let reachable = false;
-
-if (url) {
-  pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 2000 });
-  try {
-    /* Both halves matter: our own schema has to be migrated, and the role has
-       to be able to read `auth.users` at all — which is a grant rather than a
-       migration, and is the thing most likely to differ in production. */
-    const probe = await pool.query(
-      "select to_regclass('spideryarn.articles') is not null and " +
-        "to_regclass('auth.users') is not null as ready",
-    );
-    reachable = probe.rows[0]?.ready === true;
-    if (reachable) await pool.query("select 1 from auth.users limit 1");
-  } catch {
-    reachable = false;
-  }
-}
-
-afterAll(async () => {
-  await pool?.end();
+   Until the shared helper this probe was on a **two-second** connect timeout
+   and skipped **silently**; the helper's header records what each cost. */
+const { reachable } = await pgReady({
+  suite: "tests/admin-store.test.ts",
+  tables: ["spideryarn.articles", "auth.users"],
+  readable: ["auth.users"],
 });
 
 const dbIt = it.skipIf(!reachable);
diff --git a/tests/db-schema.test.ts b/tests/db-schema.test.ts
index f48003b..74aa707 100644
--- a/tests/db-schema.test.ts
+++ b/tests/db-schema.test.ts
@@ -20,17 +20,16 @@
  */
 
 import { afterAll, describe, expect, it } from "vitest";
-import { Pool, type PoolClient } from "pg";
+import type { PoolClient } from "pg";
 
 import { loadEnvLocal } from "../src/env.js";
 import { UPLOAD_STATUSES } from "../src/source.js";
+import { pgReady } from "./helpers/pg-ready.js";
 
 loadEnvLocal();
 
-const url = process.env.DATABASE_URL;
-
 /**
- * The probe runs at MODULE LOAD, not in `beforeAll`, so that the skip is a real
+ * The `await` is at MODULE LOAD, not in `beforeAll`, so that the skip is a real
  * vitest skip and the run reports "9 skipped" rather than "9 passed".
  *
  * The first version of this file did it the obvious way — a flag set in
@@ -38,21 +37,16 @@ const url = process.env.DATABASE_URL;
  * database that reported **9 passed**, which is a green tick for having checked
  * nothing at all. See docs/reusable/silent-success.md; this file was one of its
  * examples within about four minutes of being written.
+ *
+ * It kept the probe but not the lesson: until the shared helper it was on a
+ * **two-second** connect timeout and skipped **silently**. `keepPool` because
+ * every test below runs its own SQL through this pool.
  */
-let pool: Pool | undefined;
-let reachable = false;
-
-if (url) {
-  pool = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 2000 });
-  try {
-    const probe = await pool.query(
-      "select to_regclass('spideryarn.block_identities') is not null as ready",
-    );
-    reachable = probe.rows[0]?.ready === true;
-  } catch {
-    reachable = false;
-  }
-}
+const { reachable, pool } = await pgReady({
+  suite: "tests/db-schema.test.ts",
+  tables: ["spideryarn.block_identities"],
+  keepPool: true,
+});
 
 afterAll(async () => {
   await pool?.end();
diff --git a/tests/store-parity.test.ts b/tests/store-parity.test.ts
index 099def9..99534d6 100644
--- a/tests/store-parity.test.ts
+++ b/tests/store-parity.test.ts
@@ -100,6 +100,7 @@ import { pgArticleReader } from "../src/store/pg.js";
 import type { Article, LibraryEntry, Meta } from "../src/types.js";
 import { releaseCorpusLock, takeCorpusLock } from "./helpers/corpus-lock.js";
 import { forgetRevisions } from "./helpers/forget-revisions.js";
+import { pgReady } from "./helpers/pg-ready.js";
 import { type LoadedArticle, loadArticleIntoPg } from "./helpers/load-article.js";
 import { seedCommentsFromFiles, seedShelfFromFiles } from "./helpers/seed-reader-state.js";
 
@@ -183,51 +184,24 @@ async function completeArticles(): Promise<string[]> {
   return slugs;
 }
 
-/**
- * The probe runs at MODULE LOAD so the skip is a real vitest skip, and the run
- * reports "skipped" rather than a green tick for having checked nothing.
- */
-let reachable = false;
 /** Everything on disk, the legacy article included. */
 let onDiskSlugs: readonly string[] = [];
 /** The publishable corpus: everything except the legacy article. */
 let slugs: readonly string[] = [];
 
-if (process.env.DATABASE_URL) {
-  const { Pool } = await import("pg");
-  /* 10 seconds, not 2. At 2s this probe timed out under nothing worse than a
-     dev server holding connections, and the whole suite skipped — inside a run
-     that still printed a green "1103 passed". A parity suite that opts itself
-     out when the machine is busy is worse than one that fails, because the
-     signal it gives is indistinguishable from success. */
-  const pool = new Pool({
-    connectionString: process.env.DATABASE_URL,
-    max: 1,
-    connectionTimeoutMillis: 10_000,
-  });
-  let why = "";
-  try {
-    const probe = await pool.query(
-      "select to_regclass('spideryarn.revision_blocks') is not null as ready",
-    );
-    reachable = probe.rows[0]?.ready === true;
-    if (!reachable) why = "the spideryarn schema is not there — run npm run db:migrate";
-  } catch (err) {
-    reachable = false;
-    why = `could not reach it: ${(err as Error).message}`;
-  }
-  await pool.end();
+/* The `await` is at MODULE LOAD so the skip is a real vitest skip, and the run
+   reports "skipped" rather than a green tick for having checked nothing. The
+   ten-second connect timeout and the warning both live in the helper now; its
+   header quotes the paragraph this file used to carry, because this is the
+   suite that learned it. */
+const { reachable } = await pgReady({
+  suite: "tests/store-parity.test.ts",
+  tables: ["spideryarn.revision_blocks"],
+});
 
-  /* Said out loud. DATABASE_URL being SET and the database being unreachable is
-     a different situation from having no database at all, and only the first
-     one means somebody's Docker is off while they believe these ran. */
-  if (!reachable) {
-    console.warn(`\n  ⚠ DATABASE_URL is set but these tests are skipping: ${why}\n`);
-  }
-  if (reachable) {
-    onDiskSlugs = await completeArticles();
-    slugs = onDiskSlugs.filter((slug) => slug !== LEGACY_SLUG);
-  }
+if (reachable) {
+  onDiskSlugs = await completeArticles();
+  slugs = onDiskSlugs.filter((slug) => slug !== LEGACY_SLUG);
 }
 
 const when = reachable ? describe : describe.skip;
diff --git a/tests/store-revision-policy.test.ts b/tests/store-revision-policy.test.ts
index f7fc298..2efc5e3 100644
--- a/tests/store-revision-policy.test.ts
+++ b/tests/store-revision-policy.test.ts
@@ -43,6 +43,7 @@ import { loadEnvLocal } from "../src/env.js";
    file imports it from its real address. */
 import { deriveLibraryScalars } from "../src/library-scalars.js";
 import { REVISION_CARRY_POLICY } from "../src/store/pg-revisions.js";
+import { pgReady } from "./helpers/pg-ready.js";
 
 loadEnvLocal();
 
@@ -139,24 +140,24 @@ describe("deriveLibraryScalars", () => {
 
 /* ------------------------------------------------- against the real table -- */
 
+/* This one wants the probe's ROWS, not just its verdict, so it keeps the pool
+   and reads the column list through it. The old version had a silent hole: an
+   empty result left `liveColumns` null and the suite skipped with nothing on
+   stderr, because only the `catch` warned. */
 let liveColumns: string[] | null = null;
 
-if (process.env.DATABASE_URL) {
-  const { Pool } = await import("pg");
-  const pool = new Pool({
-    connectionString: process.env.DATABASE_URL,
-    max: 1,
-    connectionTimeoutMillis: 10_000,
-  });
-  try {
-    const probe = await pool.query<{ column_name: string }>(
-      `select column_name from information_schema.columns
-       where table_schema = 'spideryarn' and table_name = 'article_revisions'`,
-    );
-    if (probe.rowCount) liveColumns = probe.rows.map((r) => r.column_name);
-  } catch (err) {
-    console.warn(`\n  ⚠ DATABASE_URL is set but this test is skipping: ${(err as Error).message}\n`);
-  }
+const { reachable, pool } = await pgReady({
+  suite: "tests/store-revision-policy.test.ts",
+  tables: ["spideryarn.article_revisions"],
+  keepPool: true,
+});
+
+if (reachable && pool) {
+  const probe = await pool.query<{ column_name: string }>(
+    `select column_name from information_schema.columns
+     where table_schema = 'spideryarn' and table_name = 'article_revisions'`,
+  );
+  liveColumns = probe.rows.map((r) => r.column_name);
   await pool.end();
 }
 
```
