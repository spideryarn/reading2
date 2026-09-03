/**
 * `inTurnOrder` across a dev-server module re-evaluation.
 *
 * The lock in src/routes.ts is a `Map` at module scope, and
 * [src/process-state.ts](../src/process-state.ts) is the whole argument for why
 * that is not automatically safe here: saving any server module makes Vite
 * restart, the config is re-read from a uniquely named temp file so the registry
 * cannot dedupe it, and **every server module is evaluated a second time inside
 * the same process**. The restart destroys the sockets and does not cancel the
 * in-flight request. So for the length of that request there are two copies of
 * the module, and "a second copy of a lock is not a slower lock, it is no lock
 * at all".
 *
 * `vi.resetModules()` is the same event in miniature: it clears the registry so
 * the next import evaluates the module again, in this process, while whatever
 * the first copy started is still running.
 */
import { describe, expect, it, vi } from "vitest";

/** A promise somebody else resolves. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

/**
 * Generous, and for a reason this file ran into on its first execution.
 *
 * `src/routes.ts` is seven thousand lines with a large import graph, and this
 * test evaluates it **twice**. The default 5s is spent on the second import, so
 * the test times out before it reaches its own assertion — a red that says
 * nothing about the lock. docs/project/testing.md § shelling out.
 */
const SLOW_DOUBLE_IMPORT = 60_000;

describe("inTurnOrder, across a module re-evaluation", () => {
  it("still excludes a turn that arrives through the second copy", async () => {
    const log: string[] = [];
    const first = deferred();

    /* Copy one begins a turn and does not finish it — the in-flight request the
       restart does not cancel. */
    const copy1 = await import("../src/routes.js");
    const a = copy1.inTurnOrder("same-conversation", async () => {
      log.push("a in");
      await first.promise;
      log.push("a out");
    });

    await tick();
    expect(log).toEqual(["a in"]);

    /* The restart. */
    vi.resetModules();
    const copy2 = await import("../src/routes.js");
    expect(copy2).not.toBe(copy1);

    const b = copy2.inTurnOrder("same-conversation", async () => {
      log.push("b in");
    });

    await tick();
    await tick();

    /* The assertion that matters: `b` went through a different module copy, so
       it consulted a different `Map`. If that map is module-scope, `b` has
       already run and the two turns have interleaved on one conversation. */
    expect(log).toEqual(["a in"]);

    first.resolve();
    await a;
    await b;
    expect(log).toEqual(["a in", "a out", "b in"]);
  }, SLOW_DOUBLE_IMPORT);
});
