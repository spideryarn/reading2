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
 * Every object and array under this one, frozen — and the `Map`s and `Set`s it
 * finds have their *contents* frozen, since freezing a collection does nothing.
 *
 * **Written as a walk rather than as a list of the fields worth freezing**, for
 * the reason `mentions()` in tests/chat-invariants.test.ts is a walk: a list is a
 * list of the fields somebody thought of, and the one that gets mutated is the
 * one nobody listed. It covers a field added next year on the day it is added.
 *
 * Memoised in a `WeakSet` of what *this* function has been through, rather than
 * on `Object.isFrozen`. An object frozen shallowly by anything else is frozen
 * and has unfrozen children, so `isFrozen` as the memo would stop the walk at
 * exactly the objects it most needs to get inside — a guard that goes quiet the
 * moment it is defeated.
 */
const walked = new WeakSet<object>();

function freezeDeep<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  const held = value as unknown as object;
  if (walked.has(held)) return value;
  walked.add(held);
  if (held instanceof Map) {
    for (const [key, entry] of held) {
      freezeDeep(key);
      freezeDeep(entry);
    }
    return value;
  }
  if (held instanceof Set) {
    for (const entry of held) freezeDeep(entry);
    return value;
  }
  for (const entry of Object.values(held)) freezeDeep(entry);
  Object.freeze(held);
  return value;
}

/**
 * Frozen all the way down, so an in-place edit throws rather than passing.
 *
 * Sealed **in place** rather than copied, so that a transition which changes
 * nothing can be asserted to hand back the object it was given — the
 * controller's cached projection depends on exactly that.
 *
 * **It used to freeze the shells only** — the operation, not the `reply` on it;
 * the tombstone map, not the tombstones in it — so a mutation one level down
 * went through, and if it was idempotent the twice-run comparison agreed with
 * itself and said nothing. GPT Sol, 2026-08-28. That matters more here than
 * anywhere else in the suite: `RepairOperation.saw` decides whether a repair may
 * write by comparing a conversation **by reference**, which is sound only
 * because the reducer never mutates, and this is what enforces that.
 *
 * **Watched before and after, on three planted mutations**, each idempotent so
 * that the twice-run comparison cannot see it, and each in a place the old seal
 * did not reach. The old harness passed every one of them; this one throws on
 * all three:
 *
 * - an operation-owned nested value — `op.reply.status` written in place in
 *   `moved()`, for a retry or an edit, whose row is drawn rather than written
 *   into `base`. A *send*'s reply is the same object as the message in `base`,
 *   which the old seal did freeze, so this gap was open for exactly the two
 *   shapes nothing else covered: `chat-reduce.test.ts` 67/67 before, 1 failing
 *   after;
 * - a tombstone value — `{ by, final }` mutated in place in `tombstoned()`
 *   rather than replaced: 67/67 before, 3 failing after;
 * - nested event data — `event.done.text` trimmed in place, rewriting the
 *   caller's payload: `chat-invariants.test.ts` 11/11 before, 3 failing after.
 */
export function seal(state: ChatState): ChatState {
  if (walked.has(state)) return state;
  freezeDeep(state.base);
  /* The three collections are frozen through their *contents* here and
     booby-trapped below: an operation and everything on it, a tombstone's
     `{ by, final }`, and the strings in `unnamed`, which need nothing. */
  freezeDeep(state.operations);
  freezeDeep(state.tombstones);
  const mutable = state as {
    operations: ChatState["operations"];
    tombstones: ChatState["tombstones"];
    unnamed: ChatState["unnamed"];
  };
  mutable.operations = sealed(state.operations, "operations");
  mutable.tombstones = sealed(state.tombstones, "tombstones");
  mutable.unnamed = sealed(state.unnamed, "unnamed");
  walked.add(state);
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
    unnamed: [...state.unnamed],
  };
}

/**
 * Apply one event twice, and insist the two answers agree.
 *
 * The second run is the point: it is handed the *same* input as the first, so
 * anything the first run wrote into that input shows up as a difference here.
 * React invokes an updater twice under `StrictMode`, and this file's ancestor
 * has been bitten by an impure one.
 *
 * **The twice-run comparison is the weaker half of this, and it is worth being
 * clear which half does the work.** A mutation the reducer performs on its input
 * is invisible to a comparison of two runs whenever it is idempotent — the
 * second run reads the mutated input and writes the same thing again, so the two
 * answers agree. The freeze is what catches those, which is why it has to reach
 * all the way down: the event's nested `op`, `begun` and `done` as much as the
 * event itself. It was a shallow copy and a shallow freeze until GPT Sol pointed
 * at it, 2026-08-28.
 */
export function twice(state: ChatState, event: ChatEvent): ReturnType<typeof reduce> {
  const sealedState = seal(state);
  const sealedEvent = freezeDeep({ ...event }) as ChatEvent;
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
