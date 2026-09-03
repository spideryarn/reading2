/**
 * TEMPORARY SCAFFOLDING — witness 2 of docs/plans/260903f, stage A.
 * Delete this file (and fs-store-witness-setup.ts) before anything is committed.
 *
 * Records, per test file, which of the condemned filesystem-store modules were
 * actually *executed* (not merely imported). Wrapping is applied by a Vite
 * plugin that swaps each condemned module for a generated wrapper importing
 * `wrap` from here.
 */

/** Distinct sites reached during this test file's run. Module-scoped, and
 *  vitest's `isolate: true` gives each test file its own module registry, so
 *  this Set belongs to exactly one test file. */
export const hits = new Set<string>();

let phase: "load" | "test" = "load";
export function setPhase(next: "load" | "test"): void {
  phase = next;
}

function record(site: string): void {
  hits.add(phase === "load" ? `${site}@load` : site);
}

/** Keyed by the *underlying function*, not by property name: a `vi.spyOn` that
 *  replaces the method must produce a fresh wrapper, or the spy never sees a
 *  call and the test goes red for a reason that is the instrument's fault. */
const fnCache = new WeakMap<object, Map<unknown, unknown>>();

/** Wrap one export so that *calling* it (or calling a method on it) records. */
export function wrap(mod: string, name: string, value: unknown): unknown {
  if (typeof value === "function") {
    return new Proxy(value, {
      apply(target, thisArg, args) {
        record(`${mod}:${name}`);
        return Reflect.apply(target as (...a: unknown[]) => unknown, thisArg, args);
      },
      construct(target, args, newTarget) {
        record(`${mod}:${name}`);
        return Reflect.construct(target as new (...a: unknown[]) => object, args, newTarget);
      },
    });
  }
  if (typeof value === "object" && value !== null) {
    return new Proxy(value, {
      get(target, prop, receiver) {
        const inner = Reflect.get(target, prop, receiver);
        if (typeof inner !== "function") return inner;
        const key = typeof prop === "symbol" ? prop.toString() : prop;
        let cache = fnCache.get(target);
        if (!cache) {
          cache = new Map();
          fnCache.set(target, cache);
        }
        const already = cache.get(inner);
        if (already !== undefined) return already;
        const wrapped = new Proxy(inner, {
          apply(fn, thisArg, args) {
            record(`${mod}:${name}.${key}`);
            return Reflect.apply(fn as (...a: unknown[]) => unknown, thisArg, args);
          },
        });
        cache.set(inner, wrapped);
        return wrapped;
      },
    });
  }
  return value;
}
