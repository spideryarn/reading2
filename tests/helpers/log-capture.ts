/**
 * Read what the logger actually wrote, in-process, while a piece of code ran.
 *
 * ## Why this is not `vi.spyOn(process.stdout, "write")`
 *
 * `src/log.ts` builds its logger over `pino.destination({ sync: true })`, and a
 * synchronous SonicBoom destination writes with **`fs.writeSync(1, …)`** — it
 * never goes near `process.stdout.write`. Stubbing the stream captures nothing
 * and the assertion passes for the wrong reason, which is the failure mode this
 * repo keeps finding (docs/reusable/silent-success.md).
 * `tests/log.test.ts` says the same thing in its header and solves it by
 * spawning a child process and reading its stdout. That is the right answer when
 * the thing under test is the logger itself; it is far too heavy when the thing
 * under test is one string a caller hands the logger, which is what the
 * finalizer's tests need.
 *
 * So this patches `fs.writeSync` on the **CommonJS `fs` object SonicBoom itself
 * holds** — `sonic-boom/index.js` does `const fs = require('fs')` and then calls
 * `fs.writeSync(...)`, a property read at call time, so replacing the property
 * intercepts it. `createRequire` is what gets the same object; an
 * `import * as fs from "node:fs"` namespace is a different, read-only view.
 *
 * ## Two things a caller has to do, and the second is the one that matters
 *
 * 1. **Raise the level before the imports.** `level()` in src/log.ts is read
 *    once, at that module's load, and vitest sets `NODE_ENV=test`, which makes
 *    it `silent`. So the file has to set `LOG_LEVEL` inside `vi.hoisted` —
 *    inline, because a hoisted block runs before every import and cannot call
 *    anything imported. There is no way to do it from here.
 * 2. **Assert the capture caught something you expected.** Every failure above
 *    — the level left at `silent`, a path that never logged, a future pino that
 *    writes some other way — produces an *empty* capture, and an empty capture
 *    satisfies every `not.toContain` you can write. A check that cannot go red
 *    is not evidence.
 *
 * Everything is forwarded to the real `writeSync` rather than swallowed: vitest
 * is free to use the same call for its own output, and a capture that ate the
 * reporter would be a memorable way to waste an afternoon.
 */
import { createRequire } from "node:module";

/** The CJS `fs`, which is the object `sonic-boom` closed over. */
type PatchableFs = { writeSync: (...args: never[]) => number };

/**
 * Everything written to a file descriptor while `body` ran, joined.
 *
 * Returned as one string rather than a list of lines because pino may put
 * several lines in one write and callers only ever ask "does this contain …".
 */
export async function logLinesWhile(body: () => Promise<void>): Promise<string> {
  const fs = createRequire(import.meta.url)("fs") as PatchableFs;
  const original = fs.writeSync;
  const call = original as unknown as (...args: unknown[]) => number;
  const seen: string[] = [];

  fs.writeSync = ((...args: unknown[]) => {
    /* `args[1]` is the payload: a string in utf8 content mode, a Buffer
       otherwise, and `String` is right for both. */
    seen.push(String(args[1]));
    return call(...args);
  }) as unknown as PatchableFs["writeSync"];

  try {
    await body();
  } finally {
    /* In a `finally`, because leaving a patched `fs.writeSync` behind would make
       every later test in the worker push into an array nobody empties. */
    fs.writeSync = original;
  }
  return seen.join("");
}
