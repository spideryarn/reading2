/**
 * Driving `src/web/chat/reduce.ts` honestly: purity enforced, and every order.
 *
 * Shared by tests/chat-reduce.test.ts, which asks what one transition does, and
 * tests/chat-invariants.test.ts, which asks what is true after *any* sequence of
 * them. One copy rather than two, because a purity harness that exists twice is
 * a purity harness one of whose copies will quietly stop being run.
 */
import { expect } from "vitest";
import type { ChatEvent, ChatState } from "../../src/web/chat/model.js";
import { reduce } from "../../src/web/chat/reduce.js";

/**
 * A `Map` or a `Set` that screams if the reducer writes to it.
 *
 * `Object.freeze` is no help here — a frozen `Map` accepts `set` happily — so
 * the mutating methods are replaced with ones that throw. Everything else is
 * bound to the real collection, including `Symbol.iterator`, so
 * `new Map(booby-trapped)` still copies it.
 */
function sealed<T extends object>(collection: T, what: string): T {
  const guarded = new Set(["set", "add", "delete", "clear"]);
  return new Proxy(collection, {
    get(target, prop) {
      if (typeof prop === "string" && guarded.has(prop)) {
        return () => {
          throw new Error(`the reducer called ${what}.${prop}() — it must not mutate its input`);
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

/**
 * Frozen all the way down, so an in-place edit throws rather than passing.
 *
 * Sealed **in place** rather than copied, so that a transition which changes
 * nothing can be asserted to hand back the object it was given — the
 * controller's cached projection depends on exactly that.
 */
export function seal(state: ChatState): ChatState {
  if (Object.isFrozen(state)) return state;
  for (const t of state.base) {
    for (const m of t.messages) Object.freeze(m);
    Object.freeze(t.messages);
    Object.freeze(t);
  }
  Object.freeze(state.base);
  for (const op of state.operations.values()) Object.freeze(op);
  const mutable = state as {
    operations: ChatState["operations"];
    tombstones: ChatState["tombstones"];
  };
  mutable.operations = sealed(state.operations, "operations");
  mutable.tombstones = sealed(state.tombstones, "tombstones");
  return Object.freeze(state);
}

/**
 * The state as something two of can be compared.
 *
 * The `Map` and the `Set` are laid out flat because the booby-trapped ones above
 * are `Proxy` objects, and vitest's deep equality reads a `Set` through its
 * internal slots — which a proxy does not have, so it reports two references to
 * the *same* sealed set as unequal, with "no visual difference".
 */
export function spread(state: ChatState): unknown {
  return {
    ...state,
    operations: [...state.operations.entries()],
    tombstones: [...state.tombstones],
  };
}

/**
 * Apply one event twice, and insist the two answers agree.
 *
 * The second run is the point: it is handed the *same* input as the first, so
 * anything the first run wrote into that input shows up as a difference here.
 * React invokes an updater twice under `StrictMode`, and this file's ancestor
 * has been bitten by an impure one.
 */
export function twice(state: ChatState, event: ChatEvent): ReturnType<typeof reduce> {
  const sealedState = seal(state);
  const sealedEvent = Object.freeze({ ...event }) as ChatEvent;
  const first = reduce(sealedState, sealedEvent);
  const second = reduce(sealedState, sealedEvent);
  expect(spread(second.state), "the same event twice gave two different states").toEqual(
    spread(first.state),
  );
  expect(second.commands, "the same event twice asked for different work").toEqual(first.commands);
  return first;
}

/**
 * Every order of a handful of events.
 *
 * Small on purpose: five events is 120 orders, six is 720, and the point is
 * coverage of *orderings* rather than of length. An invariant that survives
 * every arrangement of five is not being kept by an accident of sequence, which
 * is what a single hand-written sequence cannot tell you.
 */
export function permutations<T>(items: readonly T[]): T[][] {
  if (items.length <= 1) return [[...items]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i] as T, ...tail]);
  }
  return out;
}

/**
 * Run every order of these events, checking the invariant **after every step**.
 *
 * Not only at the end, because an invariant that is briefly false and then true
 * again is still false — the controller tells React after every dispatch, so a
 * reader can see any of these intermediate states.
 *
 * Orders in which a result arrives before the thing it belongs to is registered
 * are included deliberately rather than filtered out. They are refused by the
 * gate, so they are cheap, and "refused" is exactly what has to stay true: the
 * one place an obsolete answer is turned away is the same place an early one is.
 */
export function inEveryOrder(
  start: ChatState,
  events: readonly ChatEvent[],
  holds: (state: ChatState, story: string) => void,
): void {
  for (const order of permutations(events)) {
    let state = start;
    const told: string[] = [];
    holds(state, "before anything happened");
    for (const event of order) {
      told.push(event.type);
      state = twice(state, event).state;
      holds(state, told.join(" → "));
    }
  }
}
