# Review: stage 1 of the 2026-09-06 codebase sweep

You are reviewing built code, not a plan. Weight this higher than a plan-stage review: a plan review
cannot find a `PATCH` that writes one field and then rejects the request, and this one is meant to.

## What this is

The fourth periodic `improve-the-codebase` sweep of the Spideryarn repo. The umbrella plan is
`docs/plans/260906h-improve-the-codebase-fourth-sweep.md` (read it — it carries the evidence states,
the counts, and a section at the foot listing three of its own claims that were wrong on first
draft). This diff is **Stage 1 only**: the Tier 1 items, which are meant to be cheap, mechanical and
evidence-in-hand. Nothing here changes behaviour in a request path.

The diff is at the end of this file, followed by the full text of the two new test files.

## The five changes, and what each claims

**T1.1 — `tests/biome-config-is-live.test.ts` (new).** `npm run lint` cannot currently tell you that
`biome.jsonc` was read. A comment in a file named `biome.json` silently drops the rest of the config
and every rule reverts to default; this happened here once (83 suppressed warnings reappeared) and
`docs/project/linting.md` records the incident, the tell and a detection command that was wired into
nothing. Measured for this change, reading biome's own exit code: with the config, a rule set to
`error` exits 1; with the config renamed away, the same code is reported as *info* and the command
exits **0**. Also live today: `npx biome rage` reports that the `recommended` field the whole rule
set hangs from is deprecated and removed in the next major.

**T1.2 — `ai-unusable` registered, plus `tests/every-ai-code-is-registered.test.ts` (new), plus a
change to `tests/messages.test.ts`.** `ai-unusable` is emitted by two files and was in `CODE_KINDS`
nowhere; both emitting files, and one earlier plan, asked in prose for it to be registered, three
times over four days. The new test derives its universe from `git ls-files src` and asserts every
`[ai-…]` literal resolves through `kindOfMessage`.

**This is the change most worth your attention.** Registering the code alone turned an existing
assertion in `messages.test.ts` red: it asserted `codes(EVERY) === keys(CODE_KINDS)`, where `EVERY`
is built from `messages.ts`'s own exports — so it silently required that every registered code's
sentence live in that one file. I split that equality into a subset assertion there, and moved the
no-orphan direction into the new tree-wide test.

**Question I want answered directly: is that a genuine strengthening or did I weaken a test to make
my change fit?** My argument is that the orphan direction now covers all of `src/` instead of one
module's exports, so nothing that was checked is now unchecked. The counter-argument I can see is
that `EVERY` also verifies each message is *reachable through the factories*, which a source grep
does not, and I may have traded a precise check for a broader but shallower one. Tell me if the
right answer was instead to move `CLAIMS_UNUSABLE`/`ANSWER_UNUSABLE` into `messages.ts` (which is
what both files' own comments ask for) and keep the equality — I judged that a Tier 2 change because
the constants are thrown as bare strings and would have to become `ReaderFacingFailure` objects,
rippling to the throw sites and to `routes.ts`.

**T1.3 — `knip.jsonc`.** Removed a now-dead `ignoreDependencies: ["playwright-core"]`. Its comment
justified it by a runtime `createRequire`, which knip cannot resolve — but there is now a plain
static `import { chromium } from "playwright-core"` in `scripts/measure-annotation.ts`, so knip
resolves it unaided. Knip's own output said "Remove from ignoreDependencies". Verified after the
change that `playwright-core` is still not reported as unused.

**T1.4 — `src/routes.ts`.** A doc comment pointed at `servePublicAsset`, which does not exist
anywhere in the tree. Repointed at what is actually there.

**T1.5 — two dedups.** (a) Two copies of an `en-GB` `toLocaleDateString` with identical options, in
`billing-plan.ts` and `messages.ts`, where a prose sentence was the only thing keeping the /profile
page and the ingest refusal naming the same day. Now one `readableDay(Date)`, with `readableDate(iso)`
delegating — two entry points because the quota holds a `Date` and routing it through the ISO form
would mean `toISOString()` on a possibly-invalid date, which throws where the old code merely printed
`Invalid Date`. (b) Two hand-rolled copies of `tr[data-block="${CSS.escape(id)}"]` in `scroll.ts`,
whose own header claims to be the one place a block is resolved for scrolling; now one `blockRow(id)`
in `src/web/rows.ts`, which already owns that lookup for the many-row case.

## What I want from you

Answer these directly, and say "no finding" where you have none — do not pad.

1. **The `messages.test.ts` change** (see the question above). This is the one I am least sure of.
2. **Are the two new tests tautologies?** For each assertion, name a semantically *wrong*
   implementation that would still pass it. I have proved each can go red — the `ai-unusable`
   assertion by removing the registration (it named both sites), the orphan assertion by adding a
   bogus key, and the biome behavioural assertion by pointing it at a config with the `style` block
   stripped (0 hits with our config, 1 without). But "I broke it on purpose and it noticed" only
   proves it detects *that* break, so tell me what else should be true.
3. **`tests/biome-config-is-live.test.ts` shells out and writes files.** It creates a probe directory
   under `tests/`, runs the pinned biome binary three times, and takes ~10s. Is that acceptable in a
   unit suite, is the cleanup safe against a failure between `mkdirSync` and `rmSync`, and is there a
   cheaper way to ask the same question that I have missed? Note it must run **inside** the repo:
   biome resolves its config by walking up from the file, so a copy in `/tmp` gets the defaults, and
   this repo has already drawn a wrong conclusion from exactly that.
4. **`readableDay`.** Is a second exported entry point the right shape, or should `messages.ts` have
   been made to hold the format and `billing-plan.ts` import it? Note `billing-plan.ts` currently has
   **no imports at all** and both modules are on the client-import allowlist, whose rule is that
   shared modules stay leaves and only import others on the list.
5. **`blockRow`.** `rowsForBlockIds` (same file) builds a map with `querySelectorAll` and keeps the
   first element per id; `blockRow` uses `querySelector`. I claim they agree because ids are unique
   and both take the first match in document order. Is that right, and is there a case where the two
   would differ that the comment does not cover?
6. **Anything in the diff that is not what it says it is.** Especially: a comment that overstates what
   the code does, a claim of "one place" that is not one place, or a dedup that left a copy alive —
   the plan itself argues that a dedup leaving a copy is worse than none.

## What is deliberately not here

Tiers 2 and 3 of the plan — the `FeatureBoundary` rollout (one adopter out of thirteen modes), the
`PublishRefused` permanent-vs-transient distinction, `portalDrift`, the `routes.ts` split. Do not
review those; do tell me if anything in this diff makes one of them harder.

## Known-red, and not mine

`npm run typecheck` currently fails on `tests/dock-corner-controls.test.tsx` with two `TS2741`s:
another agent's in-flight commit (`bea197dc`, "WIP: stage 1 … before its review lands") added a
required `navLabelStatus` to `Article` and did not update that fixture. It is not in this diff and
the file is not touched by it. Everything this diff touches passes; 127 tests across the nine most
related files are green.

---

# The diff, then the two new test files in full

diff --git a/knip.jsonc b/knip.jsonc
index 60f6a072..da2beb0f 100644
--- a/knip.jsonc
+++ b/knip.jsonc
@@ -94,14 +94,23 @@
   // rather than as dependencies. Both are genuinely expected to be on PATH:
   // `supabase` is the CLI from docs/project/supabase-local.md, and `openssl` is
   // used by tests/db-tls.test.ts to inspect the remote's certificate.
-  "ignoreBinaries": ["supabase", "openssl"],
+  "ignoreBinaries": ["supabase", "openssl"]
 
-  // playwright-core is loaded by scripts/remote-smoke-browser.mjs through
-  // createRequire() against a path computed at runtime, because that script
-  // runs on the remote box and has to find whichever copy is there. Knip
-  // resolves static imports, so it cannot see that and reports the dependency
-  // as unused. It is not: dropping it puts the box back on borrowing a
-  // playwright-core from the npx cache at whatever version the MCPs bundled.
-  // See docs/project/browser-control.md.
-  "ignoreDependencies": ["playwright-core"]
+  // There is deliberately no `ignoreDependencies` here any more.
+  //
+  // It used to hold playwright-core, on the good grounds that the only thing
+  // reaching for it was scripts/remote-smoke-browser.mjs through a runtime
+  // createRequire() against a path computed on the box — which knip, resolving
+  // static imports, cannot see. That stopped being true: scripts/
+  // measure-annotation.ts now has a plain `import { chromium } from
+  // "playwright-core"`, so knip resolves the dependency without help and the
+  // entry suppressed nothing. Knip said so itself, in its own output —
+  // "playwright-core  knip.jsonc  Remove from ignoreDependencies" — for however
+  // long it took somebody to read the last three lines of a report.
+  //
+  // A dead ignore is worse than no ignore: it is what hides the *next*
+  // genuinely unused dependency. Removed 2026-09-06,
+  // docs/plans/260906h-improve-the-codebase-fourth-sweep.md § T1.3. The
+  // dependency itself is still needed and still used — see
+  // docs/project/browser-control.md — this is only about knip's view of it.
 }
diff --git a/src/billing-plan.ts b/src/billing-plan.ts
index 0a419708..1eb332ee 100644
--- a/src/billing-plan.ts
+++ b/src/billing-plan.ts
@@ -718,7 +718,31 @@ export function noHigherPlan(tierName: string | null): string {
 export function readableDate(iso: string): string | null {
   const at = Date.parse(iso);
   if (!Number.isFinite(at)) return null;
-  return new Date(at).toLocaleDateString("en-GB", {
+  return readableDay(new Date(at));
+}
+
+/**
+ * The same day, for a caller that already holds a `Date`.
+ *
+ * **This is the format itself, and it is deliberately the only copy of it.** The
+ * sentence above — *"the same rule and the same format `ingestQuotaReached`
+ * uses, so the page and the refusal name the same day"* — was, until 2026-09-06,
+ * the entire mechanism keeping that true: `ingestQuotaReached` in
+ * src/messages.ts had its own `toLocaleDateString("en-GB", …)` with the same
+ * four options written out again, and each was tested separately against a
+ * hardcoded string, so neither test could ever have noticed the other changing.
+ * A reader refused an ingest and then opening /profile would have been shown two
+ * spellings of one date. Two sweeps recorded the pair before it was closed —
+ * docs/plans/260906h-improve-the-codebase-fourth-sweep.md § T1.5.
+ *
+ * `Date` rather than an ISO string because that is what the quota carries, and
+ * routing it through `readableDate` would mean `toISOString()` on a value that
+ * might not be a valid date — which throws, where the old inline call merely
+ * printed `Invalid Date`. Trading a wrong word for an exception is not a fix, so
+ * the two entry points differ in what they accept and agree on everything else.
+ */
+export function readableDay(at: Date): string {
+  return at.toLocaleDateString("en-GB", {
     day: "numeric",
     month: "long",
     year: "numeric",
diff --git a/src/messages.ts b/src/messages.ts
index 268a5a41..1935577c 100644
--- a/src/messages.ts
+++ b/src/messages.ts
@@ -25,6 +25,7 @@
  *    brackets and last, so it is skippable by a reader who does not want it and
  *    quotable by one reporting a problem.
  */
+import { readableDay } from "./billing-plan.js";
 import type { Mode } from "./modes.js";
 import type { DateRejection, EmbeddingReason, StepName } from "./types.js";
 import { MAX_PAGES, MAX_UPLOAD_BYTES } from "./uploads.js";
@@ -299,6 +300,21 @@ export const CODE_KINDS: Record<string, FailureKind> = {
   "ai-filtered": "blocked",
   "ai-no-room": "blocked",
   "ai-empty": "retry",
+  /* **Raised outside this file**, by `CLAIMS_UNUSABLE` (src/referee-claims-run.ts)
+     and `ANSWER_UNUSABLE` (src/referee-criteria-run.ts): the model answered and
+     none of what came back could be found in the paper. `retry` because both
+     sentences end "asking again usually works", which is true — it is a fact
+     about that answer, never about the paper.
+
+     Both sites had asked in prose since 2026-09-02 to be registered here, and
+     `referee-criteria-run.ts` said exactly why it would not happen: *"Skipping
+     the second has no symptom here — `kindOfMessage` returns null,
+     `worthRetrying` says yes, and Retry is the right answer anyway."* It was
+     right, and being right by a default's coincidence is not the same as being
+     declared. tests/every-ai-code-is-registered.test.ts is what now says so;
+     moving the two sentences into this file is still open, and belongs to
+     docs/project/copy.md's own batch rather than here. */
+  "ai-unusable": "retry",
   /* Not a model call, and not the reader's fault either. `retry` on purpose:
      an interrupted job resumes from its artefacts rather than starting again,
      so another go is both allowed and cheap. See `INTERRUPTED`. */
@@ -4094,15 +4110,14 @@ export function ingestQuotaReached(quota: {
     };
   }
 
-  /* Day, month and year, in the reader's words rather than an ISO stamp. `UTC`
-     so the sentence does not change depending on where the server is standing —
-     the boundary itself is Stripe's, and it is not to the hour anyway. */
-  const when = quota.resetAt.toLocaleDateString("en-GB", {
-    day: "numeric",
-    month: "long",
-    year: "numeric",
-    timeZone: "UTC",
-  });
+  /* Day, month and year, in the reader's words rather than an ISO stamp, and
+     `UTC` so the sentence does not change depending on where the server is
+     standing — the boundary itself is Stripe's, and it is not to the hour
+     anyway. All of which is now said once, in `readableDay`: this used to spell
+     the same four options out again, and the only thing keeping the refusal and
+     the /profile page naming one day was a sentence in billing-plan.ts saying
+     they must. */
+  const when = readableDay(quota.resetAt);
   return {
     kind: "blocked",
     message:
diff --git a/src/routes.ts b/src/routes.ts
index a27c58ca..984cfbc7 100644
--- a/src/routes.ts
+++ b/src/routes.ts
@@ -690,8 +690,10 @@ async function sendPlate(
  *
  * **Immutable, and it can be**: the URL contains the hash of its own contents.
  * `private` because the article is one reader's — a shared cache must not hold
- * it. The public twin deliberately answers `no-store` instead, and
- * `servePublicAsset` in src/public/routes.ts says why.
+ * it. The public twin deliberately answers `no-store` instead: `sendBytes`
+ * (src/public/routes.ts) sets no `Cache-Control` at all, because `serveApi` has
+ * already set `no-store` across the whole public namespace before dispatch, and
+ * that function's header says why the two answers must differ.
  */
 async function sendArticleAsset(
   res: ServerResponse,
diff --git a/src/web/rows.ts b/src/web/rows.ts
index 473bb59f..6689082b 100644
--- a/src/web/rows.ts
+++ b/src/web/rows.ts
@@ -38,6 +38,32 @@
  * `tr[data-block]` unscoped, matching what the loop matched: scoping it to
  * `tbody` here would silently drop a row the old code would have found.
  */
+/**
+ * The same lookup for **one** block, and the only spelling of the selector.
+ *
+ * `querySelector` rather than the map above, because for a single id the map
+ * would be a full pass over the table to answer a question the browser answers
+ * with an index. The two agree by the argument in § *The one way this could
+ * differ from the loop, and does not*: ids are unique, and where they were not,
+ * both take the first match in document order.
+ *
+ * It exists so that `tr[data-block="${CSS.escape(id)}"]` is written once.
+ * `src/web/scroll.ts`'s header says it is the one place a block is resolved for
+ * scrolling, and it contained two hand-rolled copies of this expression while
+ * saying so; two more elsewhere were absorbed into `rowsForBlockIds` on
+ * 2026-09-05 and the remaining pair was recorded, unfixed, by two consecutive
+ * codebase sweeps. `CSS.escape` is the part that must not be forgotten by a
+ * fifth copy — a block id is minted by us and is safe today
+ * (docs/project/block-ids.md), which is exactly the reasoning that makes an
+ * unescaped copy survive review.
+ *
+ * Not a fifth caller: `internal-links.ts` runs the same selector against an
+ * arbitrary `doc`, not the live page, so it is a different question.
+ */
+export function blockRow(blockId: string): HTMLElement | null {
+  return document.querySelector<HTMLElement>(`tr[data-block="${CSS.escape(blockId)}"]`);
+}
+
 export function rowsForBlockIds(blockIds: readonly string[]): (HTMLElement | null)[] {
   const byId = new Map<string, HTMLElement>();
   for (const el of document.querySelectorAll<HTMLElement>("tr[data-block]")) {
diff --git a/src/web/scroll.ts b/src/web/scroll.ts
index 7eab3d91..3edc80fb 100644
--- a/src/web/scroll.ts
+++ b/src/web/scroll.ts
@@ -11,6 +11,7 @@
  * Everything addresses the block by its stable id — never by offset or selector
  * path. See docs/project/block-ids.md.
  */
+import { blockRow } from "./rows.js";
 import { safeAreaInsets } from "./safe-area.js";
 
 /**
@@ -526,9 +527,7 @@ export function scrollToTop() {
 }
 
 export function scrollToBlock(id: string, behavior: ScrollBehavior = "smooth") {
-  const row = document.querySelector<HTMLElement>(
-    `tr[data-block="${CSS.escape(id)}"]`,
-  );
+  const row = blockRow(id);
   if (!row) return;
   // Explicit and clamped rather than scrollIntoView(): we want the row's own
   // top edge, offset to clear the bars, and no surprise when the row sits
@@ -665,7 +664,7 @@ export function arrivalTarget(
  * window rather than a constant, so it scales with the viewport.
  */
 export function isBlockOnScreen(id: string): boolean {
-  const row = document.querySelector<HTMLElement>(`tr[data-block="${CSS.escape(id)}"]`);
+  const row = blockRow(id);
   if (!row) return false;
   const { top, bottom } = row.getBoundingClientRect();
   const margin = window.innerHeight * 0.1;
diff --git a/tests/messages.test.ts b/tests/messages.test.ts
index 75257ab5..8d8e62de 100644
--- a/tests/messages.test.ts
+++ b/tests/messages.test.ts
@@ -7,6 +7,8 @@
  * connects the two — see "the sentence must agree with the kind" below, which
  * is the test that would have caught the bug this file was written after.
  */
+import { existsSync } from "node:fs";
+import path from "node:path";
 import { describe, expect, it } from "vitest";
 import * as messages from "../src/messages.js";
 import { OWNED_ARTEFACT, sharingPersonalisedList } from "../src/messages.js";
@@ -221,7 +223,39 @@ describe("the code table and the messages are one fact, not two", () => {
         // heuristic in `kindOfMessage`, not to the table.
         .filter((c) => !/^ai-\d{3}$/.test(c)),
     );
-    expect([...fromMessages].sort()).toEqual(Object.keys(CODE_KINDS).sort());
+    const missing = [...fromMessages].filter((c) => !(c in CODE_KINDS)).sort();
+    expect(missing, "a message in this file carries a code the table does not have").toEqual([]);
+  });
+
+  /**
+   * **This used to be one `toEqual`, and the equality was hiding an assumption.**
+   *
+   * Asserting `codes(EVERY) === keys(CODE_KINDS)` checked both directions at
+   * once, which is why it was written that way — but the reverse direction
+   * silently required that **every registered code's sentence lives in this
+   * file**. That is not true and was never quite true: `ai-unusable` is raised
+   * by `CLAIMS_UNUSABLE` (src/referee-claims-run.ts) and `ANSWER_UNUSABLE`
+   * (src/referee-criteria-run.ts), both of which ask in their own comments to be
+   * registered here.
+   *
+   * The cost of the assumption was four days of not registering it. Adding the
+   * table entry alone turned this test red, and the only way to satisfy the
+   * equality was to move two exported constants and every site that throws them
+   * — so the "two mechanical steps" those comments describe were never two
+   * independent steps, and the cheap half could not land on its own. That is why
+   * three written reminders produced nothing.
+   *
+   * So the reverse direction moved to tests/every-ai-code-is-registered.test.ts,
+   * which derives its universe from `git ls-files src` instead of from this
+   * module's exports, and therefore checks it for the whole tree rather than for
+   * this file. Nothing is unchecked that was checked before; the orphan
+   * assertion simply got wider. docs/plans/260906h-improve-the-codebase-fourth-sweep.md § T1.2.
+   */
+  it("leaves the no-orphan direction to the tree-wide guard", () => {
+    /* A signpost with an assertion under it, so it cannot rot into a comment
+       about a file that stopped existing. */
+    const guard = "every-ai-code-is-registered.test.ts";
+    expect(existsSync(path.join(import.meta.dirname, guard)), `${guard} is gone`).toBe(true);
   });
 });
 
/**
 * **`npm run lint` is only worth what `biome.jsonc` being read is worth.**
 *
 * ## The incident this is the check for
 *
 * Biome parses `//` comments only in a file named `.jsonc`. Put one in
 * `biome.json` and it **drops the rest of the config** — no error, no warning,
 * exit code unchanged, and every rule reverts to its default. It happened here:
 * the config looked right, `npm run lint` ran, and 83 warnings the config
 * switched off kept appearing. Seventh entry in docs/reusable/silent-success.md;
 * the full story is docs/project/linting.md § *The file is `biome.jsonc`, and
 * the extension is load-bearing*.
 *
 * That doc has recorded the incident, the tell **and** a detection command since
 * the day it happened, and the detection command was wired into nothing. This
 * file is the wiring, and it is the fourth codebase sweep to name it —
 * docs/plans/260906h-improve-the-codebase-fourth-sweep.md § T1.1.
 *
 * ## Measured, not assumed
 *
 * Against a scratch config setting `noExplicitAny` to `error`, over a file using
 * `any`, reading **biome's** exit code rather than a pipe's:
 *
 * | | exit | the finding |
 * |---|---|---|
 * | config present | 1 | reported as an error |
 * | config renamed away | **0** | reported as an *info*, and the command passes |
 *
 * So a lost config does not merely lose rules: it downgrades errors to advice
 * and turns the gate green. Everything lint-shaped in this repo — the import
 * cycles rule, `noFloatingPromises`, and any future path-scoped rule on the
 * sanitiser seam — is standing on that.
 *
 * ## And there is a dated reason it matters now
 *
 * `npx biome rage` already reports, against today's config: *"The use of the
 * `recommended` field has been deprecated, and will removed in the next major
 * version of Biome."* `npm run lint` prints none of that. `recommended` at
 * biome.jsonc's `linter.rules` is the field the whole rule set hangs from, so
 * the next major version is this exact failure with a delivery date on it.
 *
 * ## Why `rage`, and why the third assertion
 *
 * `biome rage` answers the question directly — it prints the config's load
 * status and the path it loaded from — where `lint` answers it only by the
 * absence of findings it might not have been looking for.
 *
 * But status and path alone would still pass over a config that loaded and
 * meant nothing, so the third assertion asks for something **only a live config
 * can produce**: `noNonNullAssertion` is deliberately `off` here (83 hits, all
 * `x!`, see linting.md § What's turned off, and why) and is on by default, so a
 * file full of `x!` is silent under our config and noisy under Biome's. That is
 * a claim about behaviour rather than about a file existing.
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * The **pinned** binary, not `npx biome`.
 *
 * `npm run lint` runs the one in `node_modules`, and `@biomejs/biome` is pinned
 * to an exact version in package.json on purpose (biome.jsonc says why: the
 * `noFloatingPromises` rule lives in `nursery` and can move between versions).
 * `npx biome` from a directory outside the repo resolves a *different* copy —
 * measured while writing this file, where it silently checked nothing and
 * exited 0 on a fixture the pinned binary reports an error for. A guard that
 * asked a different binary than the gate does would be answering a different
 * question.
 */
const BIOME = path.join(ROOT, "node_modules", ".bin", "biome");

/** Run a biome subcommand and hand back its output plus its own exit code. */
function biome(args: string[], cwd = ROOT): { out: string; code: number } {
  try {
    const out = execFileSync(BIOME, args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { out, code: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return { out: `${e.stdout ?? ""}${e.stderr ?? ""}`, code: e.status ?? 1 };
  }
}

describe("biome.jsonc is actually being read", () => {
  it("reports the config as loaded, from the .jsonc path", () => {
    const { out } = biome(["rage"]);

    /* The positive control for this whole file: `rage` printing nothing at all
       — a renamed binary, a changed subcommand — would make every `toContain`
       below vacuous. */
    expect(out, "biome rage printed no configuration section").toContain("Biome Configuration:");

    expect(out).toMatch(/Status:\s+Loaded successfully/);
    /* The extension is the load-bearing half: `biome.json` would also load,
       and would silently drop everything after the first comment. */
    expect(out).toMatch(/Path:\s+biome\.jsonc/);
  });

  /**
   * The behavioural half. A config can load and still be the wrong one, so this
   * asks for an outcome that only our settings produce.
   */
  it("applies a rule this repo deliberately turns off", () => {
    /* Inside the repo, because Biome resolves `biome.jsonc` by walking **up**
       from the file — a copy in /tmp gets the defaults, which cost a wrong
       conclusion on 2026-08-30 (linting.md § A copy outside the repo is checked
       against a different config). `tests/` is in the config's `includes`
       allowlist, so a file here is linted like the rest of the tree. */
    const dir = path.join(ROOT, "tests", ".biome-config-probe");
    mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "probe.ts");
    writeFileSync(file, "export const n: number | null = 1 as number | null;\nexport const m = n!;\n");
    try {
      const { out } = biome(["lint", "--max-diagnostics=none", file]);
      /* `x!` is `noNonNullAssertion`, which Biome recommends and biome.jsonc
         switches off. Under our config: silent. Under the defaults: a warning.
         So this assertion fails in exactly the case the file is about. */
      expect(out, "noNonNullAssertion fired — biome.jsonc's `style` block is not being applied").not.toContain(
        "noNonNullAssertion",
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

/* A scratch directory only the negative control below uses. */
let scratch: string | null = null;
afterAll(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
});

describe("the check can tell a live config from a missing one", () => {
  /**
   * **Proving the guard above can fail**, without touching the repo's own
   * config — renaming `biome.jsonc` in a tree a dozen agents share is not a
   * thing a test may do.
   *
   * So the same question is put to a scratch directory twice, with and without
   * a config, and the answers must differ. If they ever stop differing, the two
   * assertions above have become tautologies and this file is defending nothing.
   */
  it("sees a rule apply with a config present and not without one", () => {
    scratch = mkdtempSync(path.join(tmpdir(), "biome-live-"));
    writeFileSync(path.join(scratch, "probe.ts"), "export function f(a: any) {\n  return a;\n}\n");
    const config = path.join(scratch, "biome.jsonc");
    writeFileSync(
      config,
      JSON.stringify({
        linter: { enabled: true, rules: { suspicious: { noExplicitAny: "error" } } },
      }),
    );

    const withConfig = biome(["lint", "--max-diagnostics=none", "."], scratch);
    execFileSync("mv", [config, path.join(scratch, "biome.json.disabled")]);
    const without = biome(["lint", "--max-diagnostics=none", "."], scratch);

    /* The measurement recorded in this file's header: `error` with the config,
       and a passing command without it. */
    expect(withConfig.code, "a config setting a rule to error should fail the command").toBe(1);
    expect(without.code, "no config, so the rule falls back to a default warning").toBe(0);
  });
});
/**
 * **Every `[ai-…]` code written anywhere in `src/` resolves to a `FailureKind`.**
 *
 * ## Why this file exists rather than another case in `messages.test.ts`
 *
 * `tests/messages.test.ts` already holds every invariant about failure codes,
 * and holds them well — but it builds its universe from
 * `import * as messages from "../src/messages.js"`, so **it can only ever check
 * codes that `src/messages.ts` itself exports.** A code minted in another file
 * is not something it fails on; it is something it cannot see.
 *
 * That blind spot had a real occupant for four days. `ai-unusable` is raised by
 * `CLAIMS_UNUSABLE` (src/referee-claims-run.ts) and `ANSWER_UNUSABLE`
 * (src/referee-criteria-run.ts), and was registered nowhere. Both files asked in
 * prose to be registered — twice each — and
 * docs/plans/260902e-codebase-rework-umbrella-what-is-worth-doing-next.md asked
 * a third time. `referee-criteria-run.ts` even wrote down why none of that would
 * work: *"Skipping the second has no symptom here — `kindOfMessage` returns
 * null, `worthRetrying` says yes, and Retry is the right answer anyway — which
 * is precisely why it would be skipped."*
 *
 * So the point of this file is not the one code. It is that **its universe is
 * derived from the source rather than enumerated by hand**, which is the only
 * kind of guard that could have caught a code in a file nobody thought to list.
 * The same shape as tests/no-raw-nul-bytes.test.ts, and for the same reason.
 * docs/plans/260906h-improve-the-codebase-fourth-sweep.md § One level up.
 *
 * ## Why only the `ai-` family
 *
 * `CODE_KINDS` answers one question — *what kind of failure is this, for a job
 * whose error was stored and read back* — and the `ai-` family is the one that
 * always reaches it, because an `ai-` code means a model call failed inside a
 * step. The other families in the tree deliberately do not: `st-`, `mic-` and
 * `live-` are browser-side and never become a job error, and `fb-`, `cmt-`,
 * `pick-` and `admin-only` are HTTP refusal reasons on a response, which no
 * reader ever sees resolved through `kindOfMessage`. Widening this test to every
 * bracketed code was tried first and is wrong: it fails on all four of those
 * families, on CSS attribute selectors, and on array indices.
 *
 * ## Why it asks `kindOfMessage` rather than reading `CODE_KINDS`
 *
 * Because `kindOfMessage` is what production asks. It has a second branch —
 * `[ai-404]` and friends mint a kind from the status rather than from the map —
 * and a test that read the map directly would report those as unregistered and
 * be wrong. Asking the real resolver means this file cannot disagree with the
 * behaviour it is defending.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CODE_KINDS, kindOfMessage } from "../src/messages.js";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * Every source file git knows about, which is what makes the universe derived.
 *
 * `git ls-files` rather than a glob: a file that is present but untracked is
 * somebody's scratch work and not yet part of the tree's promises, and a glob
 * would also have to re-implement the ignore rules to agree with that.
 */
function sourceFiles(): string[] {
  return execFileSync("git", ["-C", ROOT, "ls-files", "src"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
}

/** Every `[ai-…]` occurrence in the tree, with the site that wrote it. */
function aiCodes(): Map<string, string[]> {
  const found = new Map<string, string[]>();
  for (const file of sourceFiles()) {
    const text = readFileSync(path.join(ROOT, file), "utf8");
    for (const match of text.matchAll(/\[(ai-[a-z0-9-]+)\]/g)) {
      const code = match[1];
      if (code === undefined) continue;
      const line = text.slice(0, match.index).split("\n").length;
      const sites = found.get(code) ?? [];
      sites.push(`${file}:${line}`);
      found.set(code, sites);
    }
  }
  return found;
}

describe("every ai- failure code in the tree resolves to a kind", () => {
  /**
   * The positive control, and it is not decoration. A regex that quietly stopped
   * matching — or a `git ls-files` that returned nothing in some future harness —
   * would make the assertion below pass over an empty set, which is
   * docs/reusable/silent-success.md exactly. 36 codes were present when this was
   * written; the bound is deliberately loose, because the number climbing is
   * normal and the number collapsing is the bug.
   */
  it("finds the ai- codes at all", () => {
    const found = aiCodes();
    expect(found.size).toBeGreaterThan(25);
    /* One specific code that must be found, so "the scan ran" is falsifiable by
       content and not only by count. `ai-busy` is the first entry in
       `CODE_KINDS` and is raised in src/ai-call.ts. */
    expect([...found.keys()]).toContain("ai-busy");
  });

  it("resolves every one of them through kindOfMessage", () => {
    const unresolved = [...aiCodes()]
      .filter(([code]) => kindOfMessage(`something went wrong. [${code}]`) === null)
      .map(([code, sites]) => `${code} (${sites.join(", ")})`);

    /* Named in the failure rather than counted, because the fix is to decide
       what kind the code is and add it to `CODE_KINDS` — and whoever sees this
       go red needs the site to make that decision, not a number. */
    expect(unresolved, "ai- codes reaching no kind — register them in CODE_KINDS").toEqual([]);
  });

  /**
   * **The other direction: no entry in the table that nothing can produce.**
   *
   * `tests/messages.test.ts` used to assert this by requiring `CODE_KINDS`'
   * keys to *equal* the codes carried by messages `src/messages.ts` itself
   * mints. That caught an orphan, and it also encoded an assumption that turned
   * out to be false — that every registered code's sentence lives in that one
   * file. `ai-unusable`'s does not, and the equality made registering it
   * impossible without first moving two constants, which is why it went four
   * days unregistered with three written reminders against it.
   *
   * So the direction moved here, where the universe is the **whole tree**
   * rather than one module's exports. That is strictly stronger: an orphan in
   * `CODE_KINDS` is now caught wherever its sentence would have lived, not only
   * when it would have lived in `messages.ts`. All 81 keys pass today.
   */
  it("has nothing in the table that no message ever writes", () => {
    const written = new Set(aiCodes().keys());
    const orphans = Object.keys(CODE_KINDS)
      .filter((code) => code.startsWith("ai-"))
      .filter((code) => !written.has(code));

    expect(orphans, "registered in CODE_KINDS but written by no message in src/").toEqual([]);
  });
});
