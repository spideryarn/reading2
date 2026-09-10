# A literal `new URL(…, import.meta.url)` is rewritten when a jsdom test loads the module

**2026-09-10.** For an hour and twenty-four minutes, `tests/fleet-work-evidence-e2e.test.tsx` was red
on `dev`, because the first line of the Overseer daemon's `runOverseer` threw under that test's
jsdom environment. Nothing reached a reader: this is the fleet tooling on the box, the daemon and the
dashboard were not restarted on the broken commit, and outside the test runner, in node, the same
line works. What it cost was a red `dev` that other sessions merged into their work, and one full
readiness `check` that failed.

The account first written of this (in the fix's commit message and the doc comment on
`readModuleStartRevision`) says *"under jsdom `import.meta.url` is not a `file:` URL"*. **That is
wrong**, and the fix works for a different reason from the one it gives. Both are corrected below.

## What happened

Plan 260910f stage 1 (`cb4c3ba7`, on `dev` in merge `1c6e1e4e`, pushed 19:08:56 BST) made every
service record the git revision it started from. In `tools/overseer/daemon.ts` it added, as the
first statement of `runOverseer`:

```ts
const revision = options.revision ?? readStartRevision(fileURLToPath(new URL("../..", import.meta.url)));
```

`tests/fleet-work-evidence-e2e.test.tsx` (`// @vitest-environment jsdom`, added `45d7626b`) drives
the real `runOverseer` and passes no `revision`, so it reached that line and failed:

```
TypeError: The URL must be of scheme file
 ❯ runOverseer tools/overseer/daemon.ts
```

Reproduced on 2026-09-10 with an untracked copy of `daemon.ts` carrying the old line, which also
recorded its URLs before throwing:

```
import.meta.url             = file:///…/ops-diagnose/tools/overseer/zztmp-daemon.ts
new URL("../..", i.m.url)   = http://localhost:3000/@fs/home/greg/…/ops-diagnose
```

`import.meta.url` is a perfectly good `file:` URL. What changed is the **expression**: a throwaway
module evaluated under both environments (vitest 4.1.11, vite 8.2.2) gave

| | node | jsdom |
|---|---|---|
| `import.meta.url` | `file:///…/url.ts` | `file:///…/url.ts` |
| `new URL("../..", import.meta.url)` (literal) | `file:///…/ops-diagnose/` | `http://localhost:3000/@fs/…/ops-diagnose` |
| `new URL(UP, import.meta.url)` (variable) | `file:///…/ops-diagnose/` | `file:///…/ops-diagnose/` |

A jsdom test is transformed by the **client** pipeline, and two plugins rewrite exactly the literal
form `new URL('<string>', import.meta.url)`, the idiom for a browser asset:

- Vite's `vite:asset-import-meta-url` replaces the string with a dev URL, `/@fs/<absolute path>`;
- vitest's `vitest:normalize-url` then replaces `import.meta.url` in that expression with
  `self.location`, so that it resolves as it would in a browser. Under jsdom, `self.location` is
  `http://localhost:3000/`.

`fileURLToPath` of an `http:` URL throws. In the node environment neither plugin runs.

**The fix, `3d6e851b`**, moved the derivation into `readModuleStartRevision(moduleUrl, up)` in
`tools/fleet/revision.ts`, which catches a non-file URL and returns `unknown` with a reason.
`daemon.ts` and `server.ts` now call `readModuleStartRevision(import.meta.url, "../..")`. The e2e
test is green again, **but not because of the catch**. The call site now passes `import.meta.url`
as a plain value, which is `file:`, and inside `revision.ts` the URL is built from a variable, which
neither plugin rewrites. Under jsdom the helper returns a `known` stamp: the probe got
`{"kind":"known","sha":"8a39c7ab…","dirty":false}`. So the `unknown` branch is never taken in this
repo's jsdom lane. Its unit test feeds it an `http://localhost:3000/…` module URL, which models the
wrong belief, and the e2e test now runs a real `git status` against whatever checkout it sits in.

## The class: code whose meaning depends on the loader, imported by a test on a different loader

A server module is written for node's loader. The same file, imported by a jsdom test, is compiled by
the browser pipeline, which is entitled to rewrite browser idioms, and
`new URL("<literal>", import.meta.url)` is one. The line is correct in production and correct in every
node test. It changes meaning only in the one place that imports the module under a different
transform, and that place was not one the author thought of as a consumer.

It compounds with a second shape: **a diagnostic on a start path that can throw.** The revision stamp
exists to be informative. It was placed first in `runOverseer` "before anything else can take time",
with no guard, so a failure to describe the process stopped the process.

### Other live instances

Found with a regex walk of the static import graph from all 260 jsdom test files (910 modules
reached; it follows relative imports only, not the `@` alias). It found no other literal-form site
reached by a jsdom test today. The latent ones, all reached only from node now:

- `tools/overseer/diagnose.ts:908`: `fileURLToPath(new URL("../..", import.meta.url))`, added one
  stage later in the same plan (`3c69ddcd`): the same line, one stage later.
- `scripts/overseer.ts:134`: `fileURLToPath(new URL(".", import.meta.url))`.
- `scripts/bench-cold-start.ts:74`: `fileURLToPath(new URL("..", import.meta.url))`, at module
  top level, so importing it would throw.

The form `fileURLToPath(import.meta.url)` is **safe** under jsdom (the table above), including
`scripts/browser-sign-in.ts:82`, which two jsdom tests do reach. The `vite*.config.ts` and
`vitest*.config.ts` files use the literal form too. They are loaded by node, never transformed for
the client, and are fine.

## Why nothing went red

- **The focused suites were all node.** Stage 1 ran `fleet-revision`, `overseer-daemon-revision`,
  `fleet-build-stamp`, `overseer-daemon`, `-notes`, `-cli`, `-daemon-ordering` and `fleet-imports`,
  plus typecheck. Every one is the default node environment, where the line is correct. The list was
  assembled from the files edited, and the one test that imports `runOverseer` under jsdom is not
  named after anything that was edited.
- **The full suite was not run before the push**, although AGENTS.md says to run `npm test` on
  finishing a change. It is the only check that loads `daemon.ts` under both transforms. The
  author's full run on the merged tree found it about 70 minutes after stage 1 reached `dev`.
- **Typecheck** cannot see it: `fileURLToPath(URL)` is well typed; the scheme is a runtime value.
- **Neither GPT Sol review could reasonably have seen it.** The plan review
  (`…plan-review-prompt.md`) reviewed a plan with no code in it. The stage-1 review
  (`…stage1-review-prompt.md`) pointed the reviewer at `revision.ts`, the `runOverseer` start and the
  three new tests, and asked about dirty-tree accuracy. It allowed one test file per run, read-only,
  and named no consumer of `runOverseer` in another environment. Catching it would have meant knowing
  that vitest rewrites this idiom under jsdom, and neither answer mentions jsdom, `import.meta` or the
  e2e test.

### How long, and who could have seen it

`origin/dev` was red for this test from 19:08:56 (push of `1c6e1e4e`) to 20:33:05 (push of
`84b8c2a4`), BST. In between, `origin/dev` moved 22 times, in pushes from at least six other lines of
work: the Overseer's decision log, gradual recovery, scheduled dispatch, usage per account, durable
action receipts, the changelog, and Vercel staged grace. What the record shows about whether any of
them ran into it:

- A readiness `check` in the `readiness-checks` worktree ran the full suite on `f77b3115`, which
  contains stage 1. It started at 19:55:05 and **finished at 20:29:01 with its `test` step
  `failed`** (`~/.fleet-readiness/runs/…0683ffef5b0e.json`). It kept no log (`logPath: null`), so
  whether this test was among the failures cannot be confirmed from the record. The previous full
  `check`, on `480fd6b8` (before stage 1), passed at 19:04:58.
- Scheduled dispatch merged `dev` (with stage 1) at `ad02c9b3` and reported "gates green" in
  `b24cdcfb`, without saying which gates. Its earlier "focused tests and typecheck green" reports
  (`ee213ec7`, `7c30355f`) came before that merge.
- Nothing else in the commit messages says what was run.

## What would have caught it, ranked by ease against value

1. **Run the full suite before pushing a change to a module that other tests import.** It is already
   the rule; this is an instance of not following it. Run it as
   `npx tsx scripts/tmux-job.ts npx tsx scripts/readiness-run.ts test`
   ([readiness.md](../project/readiness.md)), not a plain `npm test`, so the run leaves a record. It costs 25 minutes on the box. It is the only item here that catches the whole class,
   including environment transforms nobody has thought of yet.
2. **A static test that fails on `new URL("<literal>", import.meta.url)` outside browser code.**
   That means anywhere outside `src/web/`, `tools/fleet/web/` and the root config files. Suggested
   replacement: `path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")`, or the
   `revision.ts` helper. It is a grep in a test file, like `tests/doc-links.test.ts`. It would fail
   today on the three latent sites above, and must be watched going red on the original `daemon.ts`
   line before it counts. **Proposed, not built.**
3. **Diagnostics on a start path are total.** A stamp, a probe or a version read returns `unknown`
   and never throws, and the entry point computes it and passes it in, rather than the daemon module
   deriving its own location. `readModuleStartRevision` is already total. Passing `revision` from
   `scripts/overseer.ts` would also stop the e2e test running real git.
4. Choose focused suites by *who imports the module*, not by the files edited. Rejected as a habit:
   no one can reliably list transitive importers by hand, and item 1 does it mechanically.
5. `/* @vite-ignore */` at each call site. Rejected: it fixes instances, and whether vitest's own
   rewrite honours it was not checked.
6. Run the daemon tests under jsdom as well, or turn off `vitest:normalize-url`. Rejected. The first
   doubles the environments for one idiom; the second breaks the rewrite that genuine browser code
   under `tools/fleet/web/` relies on.

## The fix that is right for the long term

What shipped is sound code: the derivation now lives in one place, builds its URL from a variable,
and cannot throw. Its explanation is wrong, though. The doc comment on `readModuleStartRevision` says
"jsdom gives it an `http:` URL", and its `unknown` test models that. Both should say instead that the
browser transform rewrites the **literal** form, and that the helper avoids the rewrite by taking the
URL as a value. Otherwise the next reader will "simplify" the call back to the literal. The long-term
shape is item 3, where the entry point supplies the revision, together with the static test in item 2
for the three sites still carrying the literal form.

## The thing I would tell myself

I knew `fleet-work-evidence-e2e` drove the real `runOverseer`. I chose the focused list by what I had
edited, got it green, and pushed, so that the next stage could start. The line I added was the first
statement of a function that a jsdom test calls, and I never asked what loads this module besides
node. When I did look, I wrote down the first explanation that fitted the error message
("`import.meta.url` is not a file URL") without printing the value. One `console.log` would have
shown that it was a `file:` URL, and that the real cause was a rewrite of a line which looks
harmless.

---

Up: [Postmortems](../project/postmortems.md)
