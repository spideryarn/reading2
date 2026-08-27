# The PDF library that took down every route, including the ones with no PDF

**2026-08-27.** Production answered `500 {"error": "The compiled API failed to load"}` to every
request for roughly seven hours. The build was green. The deploy said `Ready`. The homepage rendered
a blank black page with nothing in the browser console.

> **Fixed the same morning**, in [`src/pdf.ts`](../../src/pdf.ts) — one `await`, and a cached import
> promise. Verified in production: `/api/health` returns `200` with `ok: true`, `warnings: []`,
> `store: postgres, articles: 5`. Everything in the present tense below the fix line describes the
> code as it was.

## What actually happened

The reason was in a runtime log nobody had read:

```
ReferenceError: DOMMatrix is not defined
  at file:///var/task/node_modules/pdfjs-dist/legacy/build/pdf.mjs:16713:22
  at async handler (file:///var/task/api/index.js:55:28)
```

and, higher up the same build, a line that had been printed and ignored:

```
Warning: Cannot load "@napi-rs/canvas" package: "Error: Cannot find module '@napi-rs/canvas'
Require stack:
- /var/task/node_modules/pdfjs-dist/legacy/build/pdf.mjs".
```

Four steps, each verified rather than assumed:

1. [`src/pdf.ts`](../../src/pdf.ts) imported pdf.js **statically, at module scope**:
   `import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs"`.
2. [`src/pipeline.ts`](../../src/pipeline.ts) imports [`src/pdf-read.ts`](../../src/pdf-read.ts),
   which imports `src/pdf.ts`; [`src/vercel.ts`](../../src/vercel.ts) imports the pipeline. So pdf.js
   was in the API's module graph, and **evaluating the API evaluated pdf.js** — on every route,
   whether or not a PDF was anywhere near the request.
3. pdf.js's module body touches `DOMMatrix`. Node does not have `DOMMatrix`. pdf.js gets it from
   **`@napi-rs/canvas`**, which it `require`s inside a try/catch.
4. Vercel's dependency tracer bundles what it can statically read. It cannot read a `require` inside
   a try/catch that it never evaluates, so it put pdf.js into `/var/task` and left the canvas package
   out. The `Require stack` in the warning names `/var/task`, which is the function bundle rather
   than the build machine — that is the line that proves it is a tracing failure and not an install
   one.

## Why no test and no laptop could ever have caught it

`@napi-rs/canvas` is an **optional, platform-specific** package: one binary per platform, resolved at
install time. The development machine has `@napi-rs/canvas-darwin-arm64` sitting in `node_modules`,
and it exports `DOMMatrix` as a function. So on a laptop:

```
node -e "const c=require('@napi-rs/canvas'); console.log(typeof c.DOMMatrix)"   → function
node --input-type=module -e "await import('pdfjs-dist/legacy/build/pdf.mjs')"    → imports fine
```

The **same bundle** that dies in production imports cleanly here. The 71 tests in
`tests/pdf*.test.ts` pass, and passed throughout the outage, because they run on the machine that has
the binary. There is no arrangement of local tests that would have gone red.

This is the sharpest instance yet of [silent-success.md](../reusable/silent-success.md), and it is
worth naming why: the check you would naturally run — *does the API import?* — **shares its
environment** with the code, and the environment is the whole bug.

## The false lead worth writing down

The obvious fix is "add `@napi-rs/canvas` as an explicit dependency so Vercel installs it". That was
the first plan, and it was wrong. The lockfile **already** carried every platform:

```
node_modules/@napi-rs/canvas-linux-x64-gnu
node_modules/@napi-rs/canvas-linux-x64-musl
… ten more
```

So the package was available to the build and would have been installed. The tracer was the problem,
not the install, and a dependency line would have changed nothing while looking like a fix. What
settled it was reading *where* the failing `require` stack pointed — `/var/task`, the bundle — rather
than assuming a missing install because the message said "Cannot find module".

## The fix, and why this one rather than the other one

```ts
type Pdfjs = typeof import("pdfjs-dist/legacy/build/pdf.mjs");
let pdfjsPromise: Promise<Pdfjs> | undefined;

function loadPdfjs(): Promise<Pdfjs> {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs");
  return pdfjsPromise;
}
```

and, at the one call site, `const pdfjs = await loadPdfjs();`.

There was exactly **one** use of `pdfjs` in the file — `pdfjs.getDocument` — which is what turned a
feared restructuring into three lines. The *promise* is cached rather than the module, so two
concurrent callers share one import instead of racing to start a second.

The property that matters is not laziness for its own sake: **a route that never opens a PDF never
loads pdf.js**, so the API comes up whether or not the canvas binary reached the bundle. The other
candidate fix — forcing canvas into the bundle via `includeFiles` — would have kept a PDF engine
loading on every cold start of every route to make one route work.

Confirmed by grepping the built artefact, which is the only check that is not another opinion:

```
from "pdfjs-dist/legacy/build/pdf.mjs"      → gone
import("pdfjs-dist/legacy/build/pdf.mjs")   → present
```

## What this class of bug is, and how to not have it again

The class is **a module-scope import with a native or environment-dependent dependency, in a bundle
that is deployed somewhere other than where it is developed**. It has three properties that together
make it invisible:

- it fails at *import*, so it takes out everything, not the feature it belongs to;
- it fails only in the target environment, so no local test can be red;
- the build is green, because the build never runs the module.

Three things would each have caught it, and are worth having:

1. **Import the built bundle in CI, on the deployment's platform.** `node -e "import('./api-dist/vercel.js')"`
   on Linux is the entire test. It is cheap and it is exactly the thing production does first.
2. **Treat a `Cannot load … package` warning in a build log as an error.** It was printed, in full,
   in the successful build, seven hours before anyone read it.
3. **Ask what a serverless API's module graph actually pulls in.** `src/vercel.ts` reaching a PDF
   rendering engine through `pipeline.ts` is not something anyone decided; it is something that
   happened. A check that the API bundle contains no heavy native dependency would have flagged it
   before it broke anything.

The deeper architectural point: [`src/pipeline.ts`](../../src/pipeline.ts) is the *ingest* pipeline,
and the serverless API imports it whole in order to reach a few functions. Ingest does not work in
production at all yet ([deployment.md](../project/deployment.md)), so the API is currently paying —
in bundle size, cold start, and now availability — for code it cannot use. Splitting the read path
from the ingest path would make this whole class of failure structurally impossible rather than
individually fixable.

## See also

- [first-vercel-deploy-silent-failures.md](first-vercel-deploy-silent-failures.md) — the same
  deployment, the same shape: green build, dead function
- [silent-success.md](../reusable/silent-success.md) — the pattern
- [deployment.md](../project/deployment.md) — why the API is compiled by the build command, and the
  four things there that fail without saying so
- [`api/index.js`](../../api/index.js) — the `try` around the import, which is the only reason the
  reason was readable at all
