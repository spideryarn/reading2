/**
 * The queue of ideas — tools/overseer/idea-queue.ts and its two companions.
 *
 * **WHAT THIS FILE IS REALLY DEFENDING.** The queue is
 * [overseer.md](../docs/project/overseer.md)'s gate 3 made into a file: *"nothing
 * dispatched that Greg did not queue"*, tested by *"is it in the queue?"*. Once
 * the Overseer both reads and writes that file, presence is far too weak a test,
 * so most of what is asserted below is that a **specific way of dispatching
 * something nobody agreed to** is refused:
 *
 *  1. the Overseer cannot authorise, at any of the three entrances;
 *  2. an approval names a REVISION, so an item cannot be approved and then
 *     enlarged (GPT Sol's P0-2, the hole the plan review found);
 *  3. a queue with a hole in it authorises nothing at all, rather than reading
 *     as a short but healthy queue;
 *  4. a stale write is refused **and the file is unchanged afterwards** — a
 *     refusal that had already written is not a refusal.
 *
 * Every test that touches a disk writes into its own temp directory. Nothing
 * here reads or writes `~/.overseer/`, which is the live Overseer's store —
 * `withRoot` is the only way a test gets a path.
 */
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EMPTY_METADATA,
  IDEA_QUEUE_SCHEMA,
  ID_RULE,
  QUEUE_FILE,
  QUEUE_INIT_FILE,
  QUEUE_LOCK_FILE,
  VERSION_ZERO,
  appendEvents,
  asPlacement,
  currentOrder,
  envelope,
  foldQueue,
  isDispatchable,
  isPriority,
  mintId,
  parseEvent,
  parseVersion,
  place,
  queueRoot,
  readQueue,
  sameVersion,
  spellVersion,
  viewOf,
  waitingAhead,
  whyNotDispatchable,
  type IdeaEvent,
  type IdeaItem,
  type IdeaMetadata,
  type Placement,
  type QueueView,
} from "../tools/overseer/idea-queue.js";
import { CLUSTERS, seedEvents } from "../tools/overseer/idea-queue-seed.js";
import { itemWait, queueDepth, throughput } from "../tools/overseer/idea-queue-wait.js";
import { planPriorities, parsePriorityFile } from "../tools/overseer/idea-queue-priorities.js";

const roots: string[] = [];

function withRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "idea-queue-"));
  roots.push(root);
  return root;
}

afterEach(() => {
  while (roots.length > 0) {
    const root = roots.pop();
    if (root !== undefined) rmSync(root, { recursive: true, force: true });
  }
});

/* ------------------------------------------------------------------ *
 * Builders, so a test reads as the thing it is about.
 * ------------------------------------------------------------------ */

const A = "qi-aaaaaaaa";
const B = "qi-bbbbbbbb";
const C = "qi-cccccccc";
const D = "qi-dddddddd";

let tick = 0;
function at(): string {
  tick += 1;
  return new Date(Date.UTC(2026, 8, 9, 0, 0, tick)).toISOString();
}

let eventCounter = 0;
function env(by: "greg" | "overseer" = "greg"): ReturnType<typeof envelope> {
  eventCounter += 1;
  return { schema: IDEA_QUEUE_SCHEMA, eventId: `ev-${eventCounter}`, commandId: null, at: at(), by };
}

function added(
  id: string,
  over: {
    by?: "greg" | "overseer";
    placement?: Placement;
    needsGreg?: boolean;
    text?: string;
    title?: string | null;
    metadata?: IdeaMetadata;
    priority?: number | null;
  } = {},
): IdeaEvent {
  return {
    ...env(over.by ?? "greg"),
    kind: "added",
    id,
    text: over.text ?? `the idea called ${id}`,
    title: over.title ?? null,
    metadata: over.metadata ?? EMPTY_METADATA,
    placement: over.placement ?? { at: "back" },
    needsGreg: over.needsGreg ?? false,
    priority: over.priority ?? null,
  };
}

function only(view: QueueView, id: string): IdeaItem {
  const item = [...view.items, ...view.settled].find((i) => i.id === id);
  if (item === undefined) throw new Error(`no ${id} in the view`);
  return item;
}

describe("the fold: order and placement", () => {
  it("keeps items in the order they were added, and honours the front", () => {
    const view = foldQueue([added(A), added(B), added(C, { placement: { at: "front" } })]);
    expect(currentOrder(view)).toEqual([C, A, B]);
  });

  it("places before and after a named anchor", () => {
    const view = foldQueue([
      added(A),
      added(B),
      added(C, { placement: { at: "after", anchor: A } }),
      added(D, { placement: { at: "before", anchor: A } }),
    ]);
    expect(currentOrder(view)).toEqual([D, A, C, B]);
  });

  it("moves an existing item without duplicating it", () => {
    const view = foldQueue([
      added(A),
      added(B),
      added(C),
      { ...env(), kind: "moved", id: C, placement: { at: "front" } },
      { ...env(), kind: "moved", id: A, placement: { at: "after", anchor: B } },
    ]);
    expect(currentOrder(view)).toEqual([C, B, A]);
  });

  it("an anchor dropped by a LATER event is no problem — the move happened first", () => {
    /* The case that decided the design: replay is in log order, so a `moved`
       that named a live anchor stays valid when the anchor leaves afterwards. */
    const view = foldQueue([
      added(A),
      added(B),
      { ...env(), kind: "moved", id: B, placement: { at: "before", anchor: A } },
      { ...env(), kind: "dropped", id: A, why: "superseded" },
    ]);
    expect(currentOrder(view)).toEqual([B]);
    expect(view.problems).toEqual([]);
  });

  it("an anchor missing WHEN ITS OWN MOVE REPLAYS is a problem, never a silent front-or-back", () => {
    /* Rounding a missing anchor to an end would invent an ordering nobody asked
       for, in the one file whose ordering is the instruction. */
    const view = foldQueue([
      added(A),
      added(B),
      { ...env(), kind: "dropped", id: A, why: null },
      { ...env(), kind: "moved", id: B, placement: { at: "after", anchor: A } },
    ]);
    expect(view.problems.map((p) => p.kind)).toEqual(["missing-anchor"]);
    /* And the whole queue is now undispatchable, which is the safe direction. */
    expect(view.items.every((i) => !isDispatchable(view, i))).toBe(true);
  });

  describe("place", () => {
    it("front, back, before and after", () => {
      const order = ["a", "b", "c"];
      expect(place(order, "c", { at: "front" }).ok).toBe(true);
      expect(order).toEqual(["c", "a", "b"]);
      expect(place(order, "c", { at: "back" }).ok).toBe(true);
      expect(order).toEqual(["a", "b", "c"]);
      expect(place(order, "a", { at: "after", anchor: "b" }).ok).toBe(true);
      expect(order).toEqual(["b", "a", "c"]);
      expect(place(order, "c", { at: "before", anchor: "b" }).ok).toBe(true);
      expect(order).toEqual(["c", "b", "a"]);
    });

    it("refuses to place an item relative to itself", () => {
      const order = ["a", "b"];
      const result = place(order, "a", { at: "after", anchor: "a" });
      expect(result.ok).toBe(false);
      expect(order).toEqual(["a", "b"]);
    });

    it("refuses a missing anchor and leaves the order alone", () => {
      const order = ["a", "b"];
      expect(place(order, "a", { at: "before", anchor: "zzz" }).ok).toBe(false);
      expect(order).toEqual(["a", "b"]);
    });
  });
});

describe("gate 3, made mechanical", () => {
  it("Greg adding an item IS the authorisation, at revision 0", () => {
    const view = foldQueue([added(A)]);
    const item = only(view, A);
    expect(item.authority).toEqual({ kind: "authorized", by: "greg", at: item.addedAt, revision: 0 });
    expect(isDispatchable(view, item)).toBe(true);
  });

  it("an item the Overseer added is a PROPOSAL and is not dispatchable", () => {
    /* Its stated dispatch test is "is it in the queue?", so a coordinator able
       to append an authorised item could pass its own gate in one line. */
    const view = foldQueue([added(A, { by: "overseer" })]);
    const item = only(view, A);
    expect(item.authority.kind).toBe("proposed");
    expect(isDispatchable(view, item)).toBe(false);
    expect(whyNotDispatchable(view, item)).toContain("nobody has authorised this yet");
  });

  it("an `authorized` event from the Overseer is a PROBLEM, not a promotion", () => {
    /* The second entrance to the same rule. */
    const view = foldQueue([added(A, { by: "overseer" }), { ...env("overseer"), kind: "authorized", id: A, revision: 0 }]);
    expect(view.problems.map((p) => p.kind)).toEqual(["unauthorized-authorization"]);
    expect(only(view, A).authority.kind).toBe("proposed");
  });

  it("but Greg can promote a proposal, and the history says who did what", () => {
    const view = foldQueue([added(A, { by: "overseer" }), { ...env("greg"), kind: "authorized", id: A, revision: 0 }]);
    const item = only(view, A);
    expect(item.authority.kind).toBe("authorized");
    expect(item.addedBy).toBe("overseer");
    expect(item.history.at(-1)?.by).toBe("greg");
    expect(item.history.at(-1)?.what).toBe("authorised revision 0");
    expect(isDispatchable(view, item)).toBe(true);
    expect(view.problems).toEqual([]);
  });
});

describe("an authorisation names the revision it authorises — Sol's P0-2", () => {
  it("a content edit by the Overseer LAPSES Greg's approval", () => {
    /* The hole: Greg approves "investigate X", an agent enlarges the file set,
       and the changed job is still marked approved. */
    const view = foldQueue([
      added(A),
      { ...env("overseer"), kind: "edited", id: A, metadata: { areas: ["everything", "and", "more"] } },
    ]);
    const item = only(view, A);
    expect(item.revision).toBe(1);
    expect(item.authority).toMatchObject({ kind: "authorized", revision: 0 });
    expect(isDispatchable(view, item)).toBe(false);
    expect(whyNotDispatchable(view, item)).toContain("no longer names what this says");
    /* And it is NOT a problem — the queue is fine, this one item needs a yes. */
    expect(view.problems).toEqual([]);
  });

  it("a content edit by Greg re-authorises in the same act", () => {
    /* He is the authority, so making him press twice would train him to press
       twice — which is how an approval becomes a reflex. */
    const view = foldQueue([added(A), { ...env("greg"), kind: "edited", id: A, text: "what I actually meant" }]);
    const item = only(view, A);
    expect(item.revision).toBe(1);
    expect(item.authority).toMatchObject({ kind: "authorized", revision: 1 });
    expect(isDispatchable(view, item)).toBe(true);
  });

  it("a Greg edit does NOT authorise a proposal he has not approved", () => {
    /* Tidying somebody's wording is not saying yes to their idea. */
    const view = foldQueue([added(A, { by: "overseer" }), { ...env("greg"), kind: "edited", id: A, title: "tidier" }]);
    const item = only(view, A);
    expect(item.authority.kind).toBe("proposed");
    expect(isDispatchable(view, item)).toBe(false);
  });

  it("a non-content edit does not bump the revision or lapse anything", () => {
    /* Marking an item as needing Greg is not a change to what the item says. */
    const view = foldQueue([added(A), { ...env("overseer"), kind: "edited", id: A, needsGreg: true }]);
    const item = only(view, A);
    expect(item.revision).toBe(0);
    expect(item.authority).toMatchObject({ kind: "authorized", revision: 0 });
    /* Still not dispatchable, but for the OTHER reason. */
    expect(whyNotDispatchable(view, item)).toContain("waiting on Greg");
  });

  it("an authorisation for a revision that is not current is a problem", () => {
    const view = foldQueue([
      added(A, { by: "overseer" }),
      { ...env("overseer"), kind: "edited", id: A, text: "changed" },
      /* Naming revision 0 when the item is at 1 — stale on arrival. */
      { ...env("greg"), kind: "authorized", id: A, revision: 0 },
    ]);
    expect(view.problems.map((p) => p.kind)).toEqual(["illegal-transition"]);
    expect(only(view, A).authority.kind).toBe("proposed");
  });

  it("re-authorising after a lapse restores dispatchability", () => {
    const view = foldQueue([
      added(A),
      { ...env("overseer"), kind: "edited", id: A, text: "enlarged" },
      { ...env("greg"), kind: "authorized", id: A, revision: 1 },
    ]);
    const item = only(view, A);
    expect(isDispatchable(view, item)).toBe(true);
    expect(whyNotDispatchable(view, item)).toBeNull();
  });
});

describe("the fold is total, and names what it cannot accept", () => {
  it("an event for an id that was never added is a problem, not a crash", () => {
    const view = foldQueue([added(A), { ...env(), kind: "done", id: "qi-nosuchid" }]);
    expect(view.items).toHaveLength(1);
    expect(view.problems.map((p) => p.kind)).toEqual(["unknown-item"]);
  });

  it("a duplicate `added` keeps the FIRST words and records a problem", () => {
    const view = foldQueue([
      added(A, { text: "what Greg actually said" }),
      added(A, { text: "something else entirely", by: "overseer" }),
    ]);
    expect(view.items).toHaveLength(1);
    expect(only(view, A).text).toBe("what Greg actually said");
    expect(only(view, A).addedBy).toBe("greg");
    expect(view.problems.map((p) => p.kind)).toEqual(["duplicate-item"]);
  });

  it("dispatching something already dispatched is a problem", () => {
    const view = foldQueue([
      added(A),
      { ...env("overseer"), kind: "dispatched", id: A, session: "one", plan: null },
      { ...env("overseer"), kind: "dispatched", id: A, session: "two", plan: null },
    ]);
    expect(view.problems.map((p) => p.kind)).toEqual(["illegal-transition"]);
    /* The first dispatch stands; the second did not overwrite it. */
    expect(only(view, A).dispatchedTo).toBe("one");
  });

  it("finishing something already dropped is a problem", () => {
    const view = foldQueue([
      added(A),
      { ...env(), kind: "dropped", id: A, why: null },
      { ...env(), kind: "done", id: A },
    ]);
    expect(view.problems.map((p) => p.kind)).toEqual(["illegal-transition"]);
    expect(only(view, A).lifecycle).toBe("dropped");
  });

  it("ANY problem makes the whole queue undispatchable", () => {
    /* The safe direction: a hole in the record is not a licence. A perfectly
       good item sits beside a bad event and must not go out. */
    const view = foldQueue([added(A), { ...env(), kind: "done", id: "qi-nosuchid" }]);
    const item = only(view, A);
    expect(item.authority.kind).toBe("authorized");
    expect(isDispatchable(view, item)).toBe(false);
    expect(whyNotDispatchable(view, item)).toContain("unresolved problem");
  });

  it("folds an empty history to an empty queue rather than throwing", () => {
    const view = foldQueue([]);
    expect(view.items).toEqual([]);
    expect(view.settled).toEqual([]);
    expect(view.problems).toEqual([]);
    expect(sameVersion(view.version, VERSION_ZERO)).toBe(true);
  });
});

describe("lifecycle", () => {
  it("a dispatched item stays in the queue, carrying its session", () => {
    const view = foldQueue([
      added(A),
      { ...env("overseer"), kind: "dispatched", id: A, session: "some-session", plan: "docs/plans/z.md" },
    ]);
    expect(view.items).toHaveLength(1);
    expect(only(view, A).lifecycle).toBe("dispatched");
    expect(only(view, A).dispatchedTo).toBe("some-session");
    expect(view.settled).toHaveLength(0);
  });

  it("done and dropped leave the ordered queue for `settled`, newest first", () => {
    const view = foldQueue([
      added(A),
      added(B),
      added(C),
      { ...env("overseer"), kind: "done", id: A },
      { ...env(), kind: "dropped", id: B, why: "superseded" },
    ]);
    expect(currentOrder(view)).toEqual([C]);
    expect(view.settled.map((s) => s.id)).toEqual([B, A]);
    expect(view.settled[0]?.droppedWhy).toBe("superseded");
    expect(view.settled[0]?.history.at(-1)?.what).toBe("dropped: superseded");
  });

  it("an edit changes only what it names, and clearing differs from leaving alone", () => {
    const metadata: IdeaMetadata = { ...EMPTY_METADATA, source: "docs/plans/a.md", size: "L", areas: ["tools/"] };
    const view = foldQueue([
      added(A, { title: "first title", metadata }),
      { ...env("greg"), kind: "edited", id: A, metadata: { size: null, areas: ["tools/fleet/"] } },
    ]);
    const item = only(view, A);
    expect(item.title).toBe("first title");
    expect(item.metadata.source).toBe("docs/plans/a.md");
    expect(item.metadata.size).toBeNull();
    expect(item.metadata.areas).toEqual(["tools/fleet/"]);
    expect(item.lastTouchedAt).not.toBeNull();
  });

  it("does not invent an edit time for an untouched item", () => {
    /* "Never touched since" and "touched at the moment it was created" are
       different claims, and the second is false. */
    expect(only(foldQueue([added(A)]), A).lastTouchedAt).toBeNull();
  });
});

describe("waitingAhead", () => {
  it("counts only the items that could actually go out ahead of you", () => {
    const view = foldQueue([
      added(A),
      added(B, { by: "overseer" }),
      added(C, { needsGreg: true }),
      added(D),
      { ...env("overseer"), kind: "dispatched", id: A, session: "s", plan: null },
    ]);
    /* A is running (capacity, not a queue); B is an unauthorised proposal; C is
       waiting on a person. Only those three are ahead of D and NONE of them is
       something D is waiting behind. */
    expect(waitingAhead(view, D)).toBe(0);
  });

  it("counts a genuinely dispatchable item ahead", () => {
    const view = foldQueue([added(A), added(B)]);
    expect(waitingAhead(view, A)).toBe(0);
    expect(waitingAhead(view, B)).toBe(1);
  });

  it("is null for an id that is not in the ordered queue", () => {
    expect(waitingAhead(foldQueue([added(A)]), "qi-nosuchid")).toBeNull();
  });
});

describe("the version token", () => {
  it("names the tail as well as the count, so two histories of a length differ", () => {
    const one = foldQueue([added(A)]);
    const two = foldQueue([added(B)]);
    expect(one.version.events).toBe(two.version.events);
    expect(sameVersion(one.version, two.version)).toBe(false);
  });

  it("round-trips through its spelling", () => {
    const view = foldQueue([added(A)]);
    const spelled = spellVersion(view.version);
    expect(parseVersion(spelled)).toEqual(view.version);
    expect(parseVersion(spellVersion(VERSION_ZERO))).toEqual(VERSION_ZERO);
  });

  it("refuses a spelling it cannot trust", () => {
    expect(parseVersion("")).toBeNull();
    expect(parseVersion("abc")).toBeNull();
    expect(parseVersion("-1")).toBeNull();
    expect(parseVersion("3")).toBeNull(); // a non-zero count with no tail id
    expect(parseVersion("3.")).toBeNull();
  });
});

describe("parseEvent", () => {
  it("reads back everything the builders write", () => {
    for (const event of [
      added(A, { metadata: { ...EMPTY_METADATA, runs: "engineering-manager.md" } }),
      { ...env(), kind: "moved" as const, id: A, placement: { at: "after" as const, anchor: B } },
      { ...env(), kind: "authorized" as const, id: A, revision: 2 },
      { ...env("overseer"), kind: "dispatched" as const, id: A, session: "s", plan: null },
      { ...env(), kind: "done" as const, id: A },
      { ...env(), kind: "dropped" as const, id: A, why: "no longer wanted" },
    ]) {
      expect(parseEvent(JSON.stringify(event))).toEqual(event);
    }
  });

  it("refuses a line with no actor rather than defaulting it to Greg", () => {
    /* THE ONE THAT MATTERS MOST. Defaulting here would mint an authorisation
       out of a parse failure. */
    expect(parseEvent(JSON.stringify({ ...added(A), by: undefined }))).toBeNull();
  });

  it("refuses `dashboard` as an actor", () => {
    /* `wire.ts`'s Speaker has that arm and it means "a report, never an
       instruction". A queue write is an instruction. */
    expect(parseEvent(JSON.stringify({ ...added(A), by: "dashboard" }))).toBeNull();
  });

  it("refuses a line with no event id, because the version names the tail", () => {
    expect(parseEvent(JSON.stringify({ ...added(A), eventId: undefined }))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...added(A), eventId: "" }))).toBeNull();
  });

  it("refuses an id that is not a queue id", () => {
    expect(parseEvent(JSON.stringify({ ...added(A), id: "../../etc/passwd" }))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...added(A), id: "qi-short" }))).toBeNull();
  });

  it("refuses a schema this build does not know", () => {
    expect(parseEvent(JSON.stringify({ ...added(A), schema: 99 }))).toBeNull();
  });

  it("refuses an `added` with no text, no placement, or an unparseable time", () => {
    expect(parseEvent(JSON.stringify({ ...added(A), text: "   " }))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...added(A), placement: undefined }))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...added(A), at: "not a date" }))).toBeNull();
  });

  it("refuses a `dispatched` with no session, because that is what makes it true", () => {
    const line = JSON.stringify({ ...env("overseer"), kind: "dispatched", id: A, session: "" });
    expect(parseEvent(line)).toBeNull();
  });

  it("refuses an `authorized` with no revision — an approval must name what it approves", () => {
    expect(parseEvent(JSON.stringify({ ...env("greg"), kind: "authorized", id: A }))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...env("greg"), kind: "authorized", id: A, revision: -1 }))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...env("greg"), kind: "authorized", id: A, revision: 1.5 }))).toBeNull();
  });

  it("refuses nonsense outright", () => {
    expect(parseEvent("")).toBeNull();
    expect(parseEvent("not json")).toBeNull();
    expect(parseEvent("[]")).toBeNull();
    expect(parseEvent(JSON.stringify({ ...env(), kind: "invented", id: A }))).toBeNull();
  });

  it("distinguishes an absent title from a cleared one on an edit", () => {
    const absent = parseEvent(JSON.stringify({ ...env(), kind: "edited", id: A }));
    const cleared = parseEvent(JSON.stringify({ ...env(), kind: "edited", id: A, title: null }));
    expect(absent && "title" in absent).toBe(false);
    expect(cleared && "title" in cleared).toBe(true);
  });

  describe("asPlacement", () => {
    it("takes the four shapes and nothing else", () => {
      expect(asPlacement({ at: "front" })).toEqual({ at: "front" });
      expect(asPlacement({ at: "back" })).toEqual({ at: "back" });
      expect(asPlacement({ at: "before", anchor: A })).toEqual({ at: "before", anchor: A });
      expect(asPlacement({ at: "middle" })).toBeNull();
      expect(asPlacement({ at: "after" })).toBeNull();
      /* An anchor that is not an id is not an anchor — this is where a path
         would otherwise arrive. */
      expect(asPlacement({ at: "after", anchor: "../../etc/passwd" })).toBeNull();
      expect(asPlacement(null)).toBeNull();
    });
  });
});

describe("the file", () => {
  it("distinguishes never-written from empty from unreadable", () => {
    const root = withRoot();
    /* NEVER WRITTEN: nobody has used this queue. */
    expect(readQueue(root).kind).toBe("never-written");
    expect(existsSync(join(root, QUEUE_FILE))).toBe(false);

    /* EMPTY: a real file that folds to nothing. A different claim, and drawn as
       the same blank list the two become one — the wrong one. */
    writeFileSync(join(root, QUEUE_FILE), "");
    const empty = readQueue(root);
    expect(empty.kind).toBe("queue");
    if (empty.kind === "queue") expect(empty.view.items).toEqual([]);
  });

  it("a line it cannot parse becomes a problem, and the queue authorises nothing", () => {
    const root = withRoot();
    appendEvents([added(A)], { root });
    appendFileSync(join(root, QUEUE_FILE), "{not json at all}\n");
    appendEvents([added(B)], { root });

    const read = readQueue(root);
    expect(read.kind).toBe("queue");
    if (read.kind !== "queue") return;
    expect(read.view.items).toHaveLength(2);
    expect(read.view.problems.map((p) => p.kind)).toEqual(["unreadable-line"]);
    /* **The point of the whole arrangement**: a queue two items short must not
       authorise the items it did manage to read. */
    expect(read.view.items.every((i) => !isDispatchable(read.view, i))).toBe(true);
  });

  it("appends, folds, and reports the version it reached", () => {
    const root = withRoot();
    const first = appendEvents([added(A)], { root });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.view.version.events).toBe(1);

    const second = appendEvents([added(B, { placement: { at: "front" } })], { root, expect: first.view.version });
    expect(second.ok).toBe(true);
    if (second.ok) expect(currentOrder(second.view)).toEqual([B, A]);
    expect(readFileSync(join(root, QUEUE_FILE), "utf8").trimEnd().split("\n")).toHaveLength(2);
  });

  it("refuses a stale write and leaves the file byte-identical", () => {
    const root = withRoot();
    appendEvents([added(A)], { root });
    const before = readFileSync(join(root, QUEUE_FILE), "utf8");

    const stale = appendEvents([added(B)], { root, expect: VERSION_ZERO });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.code).toBe("stale-version");
      expect(stale.why).toContain("the queue has moved on");
    }
    /* **A refusal that had already written is not a refusal.** */
    expect(readFileSync(join(root, QUEUE_FILE), "utf8")).toBe(before);
  });

  it("writes several events as one batch", () => {
    const root = withRoot();
    const result = appendEvents([added(A), added(B), added(C)], { root });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.view.version.events).toBe(3);
    expect(readFileSync(join(root, QUEUE_FILE), "utf8").trimEnd().split("\n")).toHaveLength(3);
  });

  it("repairs a torn final line rather than welding the next append onto it", () => {
    const root = withRoot();
    appendEvents([added(A)], { root });
    /* A writer killed mid-append: no trailing newline. */
    appendFileSync(join(root, QUEUE_FILE), '{"kind":"added","schema":1,"at":"2026');

    const result = appendEvents([added(B)], { root });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    /* And it SAYS it repaired something, rather than swallowing it — those
       bytes are gone and somebody should know. */
    expect(result.repaired.torn).toBe(true);
    const lines = readFileSync(join(root, QUEUE_FILE), "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(parseEvent(line)).not.toBeNull();
  });

  it("refuses a relative queue directory rather than resolving it against cwd", () => {
    const result = appendEvents([added(A)], { root: "relative/queue" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.why).toContain("absolute path");
  });

  it("refuses to append nothing", () => {
    expect(appendEvents([], { root: withRoot() }).ok).toBe(false);
  });

  it("says why when a live lock is held, rather than writing beside it", () => {
    const root = withRoot();
    /* A lock naming this very process, which is certainly alive. */
    writeFileSync(
      join(root, QUEUE_LOCK_FILE),
      `${JSON.stringify({ pid: process.pid, instanceId: "someone-else", hostname: "here", startedAt: at() })}\n`,
    );
    const result = appendEvents([added(A)], { root });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("locked");
      expect(result.why).toContain("Refusing to run beside it");
    }
    expect(existsSync(join(root, QUEUE_FILE))).toBe(false);
  });

  it("uses its OWN lock, never the store's — the daemon holds that one for life", () => {
    expect(QUEUE_LOCK_FILE).toBe("queue.lock");
    expect(QUEUE_LOCK_FILE).not.toBe("overseer.lock");
  });

  it("viewOf gives the empty view for never-written and null for unreadable", () => {
    expect(viewOf({ kind: "never-written", path: "x" })?.items).toEqual([]);
    expect(viewOf({ kind: "unreadable", why: "nope", path: "x" })).toBeNull();
  });
});

describe("queueRoot", () => {
  it("prefers the override, and treats an empty one as unset", () => {
    expect(queueRoot({ OVERSEER_QUEUE_DIR: "/somewhere/else" })).toBe("/somewhere/else");
    expect(queueRoot({ OVERSEER_QUEUE_DIR: "" }).endsWith("/.overseer")).toBe(true);
    expect(queueRoot({}).endsWith("/.overseer")).toBe(true);
  });
});

describe("mintId", () => {
  it("makes ids that match the rule it publishes", () => {
    for (let i = 0; i < 200; i += 1) expect(mintId()).toMatch(ID_RULE);
  });

  it("has no characters that get misread off a phone screen", () => {
    /* A deterministic sweep of the whole alphabet rather than a hope about
       Math.random: every character in every position it can occupy. */
    for (let i = 0; i < 30; i += 1) {
      const id = mintId(() => i / 30);
      expect(id).toMatch(ID_RULE);
      expect(id.slice(3)).not.toMatch(/[ilou01]/);
    }
  });

  it("rejects a plausible-looking id that is not one", () => {
    expect(ID_RULE.test("qi-aaaaaaa")).toBe(false); // seven
    expect(ID_RULE.test("qi-aaaaaaaaa")).toBe(false); // nine
    expect(ID_RULE.test("aaaaaaaa")).toBe(false); // no prefix
    expect(ID_RULE.test("qi-aaaaaao1")).toBe(false); // excluded characters
  });
});

describe("the migration of the sixteen clusters", () => {
  const events = seedEvents({ at: "2026-09-09T00:00:00.000Z" });

  it("produces exactly the sixteen the doc listed, in the doc's order", () => {
    expect(CLUSTERS).toHaveLength(16);
    const view = foldQueue(events);
    expect(view.items).toHaveLength(16);
    expect(view.problems).toEqual([]);
    expect(view.items.map((i) => i.title?.split(" — ")[0])).toEqual([
      "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P",
    ]);
  });

  it("seeds the four that name Greg as needing him, and no others", () => {
    /* The doc says "ask again before dispatching those four" — a sentence that
       was enforced by somebody reading a column, and is now a field. */
    const view = foldQueue(events);
    const needing = view.items.filter((i) => i.needsGreg).map((i) => i.title?.split(" — ")[0]);
    expect(needing).toEqual(["A", "C", "F", "M"]);
    for (const item of view.items) {
      expect(item.needsGreg).toBe(item.metadata.waitingOn?.startsWith("Greg:") ?? false);
    }
  });

  it("carries the plan as every item's source, and engineering-manager.md as what to run", () => {
    const view = foldQueue(events);
    for (const item of view.items) {
      expect(item.metadata.source).toContain("260908f-prioritised-spideryarn-codebase-improvements");
      expect(item.metadata.runs).toBe("docs/reusable/engineering-manager.md");
    }
  });

  it("SEEDS NOTHING DISPATCHABLE — every row is a proposal until Greg authorises", () => {
    /* **The change GPT Sol argued for twice.** The first version wrote
       `by: "greg"`, so all sixteen arrived pre-authorised on the strength of a
       conversation the day before. Under the documented meaning of `by` — *who
       recorded this* — that was false provenance: a script recorded them.
       Seeding them as proposals costs one command at cutover and makes the
       authorisation a fresh, dated, attributed act by the only person who can
       make one. */
    const view = foldQueue(events);
    expect(view.items.every((i) => i.addedBy === "overseer")).toBe(true);
    expect(view.items.every((i) => i.authority.kind === "proposed")).toBe(true);
    expect(view.items.filter((i) => isDispatchable(view, i))).toHaveLength(0);
  });

  it("and Greg authorising them makes exactly the twelve unblocked ones dispatchable", () => {
    /* What the cutover does, in one act. The four whose `waiting on` names him
       stay blocked afterwards, which is the whole point of that column. */
    const seeded = foldQueue(events);
    const approvals: IdeaEvent[] = seeded.items.map((item) => ({
      ...env("greg"),
      kind: "authorized" as const,
      id: item.id,
      revision: item.revision,
    }));
    const view = foldQueue([...events, ...approvals]);
    expect(view.problems).toEqual([]);
    expect(view.items.filter((i) => isDispatchable(view, i))).toHaveLength(12);
    expect(view.items.filter((i) => i.needsGreg)).toHaveLength(4);
  });

  it("does NOT migrate the two the Overseer only noticed", () => {
    /* Sol's P1-4. The seeded sixteen are proposals now too, but these two are a
       different thing: they are not among the work Greg deferred at all, and
       they stay in the Markdown under the heading saying the Overseer may not
       originate them. */
    const view = foldQueue(events);
    for (const item of view.items) {
      expect(item.text).not.toContain("decision log in the store");
      expect(item.text).not.toContain("local-time display");
    }
  });

  it("is deterministic given its inputs, so the migration can be checked against its source", () => {
    let n = 0;
    const mint = (): string => `qi-${String(n++).padStart(8, "2")}`;
    const once = seedEvents({ at: "2026-09-09T00:00:00.000Z", mint: mint });
    n = 0;
    const twice = seedEvents({ at: "2026-09-09T00:00:00.000Z", mint: mint });
    /* Everything but the event ids, which are uuids by design. */
    const strip = (e: IdeaEvent): unknown => ({ ...e, eventId: null });
    expect(once.map(strip)).toEqual(twice.map(strip));
  });
});

describe("what can honestly be said about the wait", () => {
  const nowMs = Date.UTC(2026, 8, 20, 0, 0, 0);
  const daysAgo = (days: number): string => new Date(nowMs - days * 24 * 60 * 60 * 1000).toISOString();

  it("splits the depth by WHY each item is not moving, without double-counting", () => {
    const view = foldQueue([
      added(A),
      added(B),
      added(C, { needsGreg: true }),
      added(D, { by: "overseer" }),
      { ...env("overseer"), kind: "dispatched", id: A, session: "s", plan: null },
    ]);
    const depth = queueDepth(view);
    expect(depth).toMatchObject({ dispatchable: 1, needsGreg: 1, unauthorized: 1, dispatched: 1 });
    /* The parts must not exceed the whole — a reader adding them up would
       otherwise find the queue longer than it is. */
    expect(depth.dispatchable + depth.needsGreg + depth.unauthorized + depth.dispatched).toBe(view.items.length);
  });

  it("counts a row held ONLY by a broken file under queueHeld, not as unapproved", () => {
    /* **SOL'S P2-2, and it had no test until a mutation run said so.**
       `isDispatchable` is false for everything while the file has a problem, so
       inferring authority from it reported `12 not approved` beside twelve
       perfectly approved rows — in the same view as the alarm explaining that
       the file was the trouble. */
    const view = foldQueue([added(A), added(B), { ...env(), kind: "done", id: "qi-nosuchid" }]);
    expect(view.problems).toHaveLength(1);
    const depth = queueDepth(view);
    expect(depth).toMatchObject({ queueHeld: 2, unauthorized: 0, dispatchable: 0, needsGreg: 0 });
    /* Still a partition. */
    expect(depth.dispatchable + depth.needsGreg + depth.unauthorized + depth.queueHeld + depth.dispatched).toBe(
      view.items.length,
    );
  });

  it("and itemWait says the FILE is the problem rather than promising a place in line", () => {
    const view = foldQueue([added(A), { ...env(), kind: "done", id: "qi-nosuchid" }]);
    const wait = itemWait(view, only(view, A));
    expect(wait.kind).toBe("queue-held");
    expect(wait.why).toContain("waiting for somebody to fix the record");
  });

  it("counts an item that is both unauthorised and waiting on Greg exactly once", () => {
    const view = foldQueue([added(A, { by: "overseer", needsGreg: true })]);
    const depth = queueDepth(view);
    expect(depth.needsGreg + depth.unauthorized).toBe(1);
    /* And it reports the actionable half. */
    expect(depth.needsGreg).toBe(1);
  });

  it("reports throughput measured on the queue's own events, per window", () => {
    const view = foldQueue([
      added(A),
      added(B),
      { ...env("overseer"), at: daysAgo(3), kind: "dispatched", id: A, session: "s1", plan: null },
      { ...env("overseer"), at: daysAgo(2), kind: "done", id: A },
      { ...env("overseer"), at: daysAgo(20), kind: "dispatched", id: B, session: "s2", plan: null },
    ]);
    const rate = throughput(view, nowMs);
    expect(rate.windows.find((w) => w.days === 7)).toMatchObject({ dispatched: 1, done: 1 });
    expect(rate.windows.find((w) => w.days === 30)).toMatchObject({ dispatched: 2, done: 1 });
    expect(rate.dispatchesEver).toBe(2);
  });

  it("NEVER offers a duration, and says how far off one is", () => {
    /* Sol's answer 3, twice over: "a wide range does not repair a wrong
       estimator". The type has one arm on purpose, so a page cannot render a
       confident figure by forgetting a comparison. */
    const empty = throughput(foldQueue([added(A)]), nowMs);
    expect(empty.duration.kind).toBe("not-enough");
    expect(empty.duration.why).toContain("nothing has been through this queue yet");

    const some = throughput(
      foldQueue([
        added(A),
        { ...env("overseer"), at: daysAgo(2), kind: "dispatched", id: A, session: "s", plan: null },
        { ...env("overseer"), at: daysAgo(1), kind: "done", id: A },
      ]),
      nowMs,
    );
    expect(some.duration.kind).toBe("not-enough");
    expect(some.duration.why).toContain("1 completion");
  });

  it("names which kind of 'I cannot say' each item is", () => {
    const view = foldQueue([
      added(A),
      added(B, { needsGreg: true }),
      added(C, { by: "overseer" }),
      added(D),
      { ...env("overseer"), kind: "dispatched", id: D, session: "running-one", plan: null },
    ]);
    expect(itemWait(view, only(view, A)).kind).toBe("ahead");
    expect(itemWait(view, only(view, B)).kind).toBe("needs-greg");
    expect(itemWait(view, only(view, C)).kind).toBe("not-authorized");
    const running = itemWait(view, only(view, D));
    expect(running.kind).toBe("running");
    if (running.kind === "running") expect(running.session).toBe("running-one");
  });

  it("tells a lapsed approval apart from a proposal, because the fix differs", () => {
    const view = foldQueue([added(A), { ...env("overseer"), kind: "edited", id: A, text: "enlarged" }]);
    const wait = itemWait(view, only(view, A));
    expect(wait.kind).toBe("not-authorized");
    expect(wait.why).toContain("edited since it was authorised");
  });

  it("says 'next in line' rather than '0 ahead'", () => {
    const view = foldQueue([added(A), added(B)]);
    expect(itemWait(view, only(view, A)).why).toContain("next in line");
    expect(itemWait(view, only(view, B)).why).toContain("1 item ahead");
  });
});

/* ------------------------------------------------------------------ *
 * The bypasses GPT Sol reproduced in round two, each now closed.
 *
 * Every test in this block was written from a sequence Sol actually ran against
 * the built code and got the wrong answer from. They are the calibration for
 * whether the rest of this file is load-bearing: the queue passed 120 tests
 * while all of these were true.
 * ------------------------------------------------------------------ */

describe("round two: only Greg can answer his own question", () => {
  it("the Overseer cannot clear needsGreg, and the attempt is a problem", () => {
    /* **SOL'S P0-2.** `needsGreg` was writable by any actor and excluded from
       `changesContent`, so `edit --by overseer --ready` cleared Greg's blocker
       without bumping the revision or lapsing his approval — and the item came
       out dispatchable. An honestly attributed Overseer edit answering a
       question only Greg can answer. */
    const view = foldQueue([
      added(A, { needsGreg: true }),
      { ...env("overseer"), kind: "edited", id: A, needsGreg: false },
    ]);
    const item = only(view, A);
    expect(item.needsGreg).toBe(true);
    expect(isDispatchable(view, item)).toBe(false);
    expect(view.problems.map((p) => p.kind)).toEqual(["unauthorized-authorization"]);
  });

  it("but Greg can clear it, and the item becomes dispatchable", () => {
    const view = foldQueue([added(A, { needsGreg: true }), { ...env("greg"), kind: "edited", id: A, needsGreg: false }]);
    expect(only(view, A).needsGreg).toBe(false);
    expect(isDispatchable(view, only(view, A))).toBe(true);
    expect(view.problems).toEqual([]);
  });

  it("and anyone may still SET it — noticing is what the coordinator is for", () => {
    const view = foldQueue([added(A), { ...env("overseer"), kind: "edited", id: A, needsGreg: true }]);
    expect(only(view, A).needsGreg).toBe(true);
    expect(view.problems).toEqual([]);
  });
});

describe("round two: a dispatch the gate would not have allowed is a problem", () => {
  it("an unauthorised item cannot be dispatched, and says WHICH rule refused it", () => {
    /* **SOL'S P1-3.** The arm checked only `lifecycle === "queued"`, so a
       proposal could become `dispatched` with nothing recorded — a dispatch
       nobody agreed to, sitting in the record looking like permission.

       **The message is asserted, not just the refusal**, and that is what makes
       this test isolate the guard it is about. A mutation run found the
       authority check could be deleted and this still passed: a `proposed`
       authority has no `revision`, so `undefined !== 0` fires the NEXT check and
       refuses for an accidental reason. Both guards stay — defence in depth is
       fine — but a test that cannot tell them apart is not testing either. */
    const view = foldQueue([
      added(A, { by: "overseer" }),
      { ...env("overseer"), kind: "dispatched", id: A, session: "s", plan: null },
    ]);
    expect(view.problems.map((p) => p.kind)).toEqual(["illegal-transition"]);
    expect(view.problems[0]?.why).toContain("nobody had authorised it");
    expect(only(view, A).lifecycle).toBe("queued");
  });

  it("an item whose approval lapsed cannot be dispatched", () => {
    const view = foldQueue([
      added(A),
      { ...env("overseer"), kind: "edited", id: A, text: "enlarged" },
      { ...env("overseer"), kind: "dispatched", id: A, session: "s", plan: null },
    ]);
    expect(view.problems[0]?.why).toContain("authorised only for");
    expect(only(view, A).lifecycle).toBe("queued");
  });

  it("an item waiting on Greg cannot be dispatched", () => {
    const view = foldQueue([
      added(A, { needsGreg: true }),
      { ...env("overseer"), kind: "dispatched", id: A, session: "s", plan: null },
    ]);
    expect(view.problems[0]?.why).toContain("still waiting on Greg");
    expect(only(view, A).lifecycle).toBe("queued");
  });

  it("a problem found LATER does not retrospectively invalidate an earlier dispatch", () => {
    /* The clean-queue clause is deliberately absent from the fold's check: a log
       can only answer whether the item was dispatchable AT THAT POINT. */
    const view = foldQueue([
      added(A),
      { ...env("overseer"), kind: "dispatched", id: A, session: "s", plan: null },
      { ...env(), kind: "done", id: "qi-nosuchid" },
    ]);
    expect(only(view, A).lifecycle).toBe("dispatched");
    expect(view.problems.map((p) => p.kind)).toEqual(["unknown-item"]);
  });
});

describe("round two: a settled item cannot come back as an ordering anchor", () => {
  it("refuses to move a done item, so it cannot be reinserted invisibly", () => {
    /* **SOL'S P2-1**, reproduced exactly: `A,B,C → done A → move A front →
       move C after A` gave a visible order of `C,B` with no problem — the
       stale-anchor bug re-entering through a different door. */
    const view = foldQueue([
      added(A),
      added(B),
      added(C),
      { ...env("overseer"), kind: "done", id: A },
      { ...env(), kind: "moved", id: A, placement: { at: "front" } },
      { ...env(), kind: "moved", id: C, placement: { at: "after", anchor: A } },
    ]);
    expect(currentOrder(view)).toEqual([B, C]);
    expect(view.problems.map((p) => p.kind)).toEqual(["illegal-transition", "missing-anchor"]);
  });
});

describe("round two: present-but-invalid is not absent", () => {
  it('rejects needsGreg: "yes" rather than reading it as false', () => {
    /* **SOL'S P1-1**, and the sharpest of the parse findings: it fed a
       Greg-added event carrying `needsGreg: "yes"`, `metadata: null` and
       `title: 42`, and got back an authorised, unblocked, DISPATCHABLE item
       with no problem recorded. A route straight around `problems`. */
    expect(parseEvent(JSON.stringify({ ...added(A, { needsGreg: true }), needsGreg: "yes" }))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...added(A), needsGreg: 1 }))).toBeNull();
  });

  it("rejects a title that is not a string", () => {
    expect(parseEvent(JSON.stringify({ ...added(A), title: 42 }))).toBeNull();
  });

  it("rejects metadata that is present and not an object", () => {
    expect(parseEvent(JSON.stringify({ ...added(A), metadata: 7 }))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...added(A), metadata: "a lull" }))).toBeNull();
  });

  it("rejects a metadata field of the wrong type, and an areas list that is not strings", () => {
    expect(parseEvent(JSON.stringify({ ...added(A), metadata: { size: 3 } }))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...added(A), metadata: { areas: "tools/" } }))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...added(A), metadata: { areas: ["ok", 5] } }))).toBeNull();
  });

  it("still accepts an ABSENT optional field as its default", () => {
    /* The other half of the rule: leniency about what is missing, strictness
       about what is there and wrong. */
    const line = JSON.stringify({ ...env(), kind: "added", id: A, text: "t", placement: { at: "back" } });
    const event = parseEvent(line);
    expect(event).not.toBeNull();
    if (event?.kind !== "added") return;
    expect(event.title).toBeNull();
    expect(event.metadata).toEqual(EMPTY_METADATA);
    expect(event.needsGreg).toBe(false);
  });

  it("rejects a wrong-typed field on an edit, a dispatch and a drop too", () => {
    expect(parseEvent(JSON.stringify({ ...env(), kind: "edited", id: A, text: 5 }))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...env(), kind: "edited", id: A, needsGreg: "yes" }))).toBeNull();
    expect(parseEvent(JSON.stringify({ ...env(), kind: "edited", id: A, metadata: 4 }))).toBeNull();
    expect(
      parseEvent(JSON.stringify({ ...env("overseer"), kind: "dispatched", id: A, session: "s", plan: 9 })),
    ).toBeNull();
    expect(parseEvent(JSON.stringify({ ...env(), kind: "dropped", id: A, why: 9 }))).toBeNull();
  });
});

describe("round two: a lost queue never reads as an empty one", () => {
  it("writes an initialisation marker on the first append", () => {
    const root = withRoot();
    expect(existsSync(join(root, QUEUE_INIT_FILE))).toBe(false);
    appendEvents([added(A)], { root });
    expect(existsSync(join(root, QUEUE_INIT_FILE))).toBe(true);
  });

  it("a DELETED queue is unreadable, not never-written", () => {
    /* **SOL'S P1-2**, and the one finding that put a false sentence on screen:
       after cutover, deleting the live queue rendered "Nothing has been queued
       here yet". */
    const root = withRoot();
    appendEvents([added(A)], { root });
    rmSync(join(root, QUEUE_FILE));
    const read = readQueue(root);
    expect(read.kind).toBe("unreadable");
    if (read.kind === "unreadable") {
      expect(read.why).toContain("LOST queue");
      expect(read.why).toContain("not a new one");
    }
  });

  it("a TRUNCATED queue is unreadable, not an emptied one", () => {
    const root = withRoot();
    appendEvents([added(A)], { root });
    writeFileSync(join(root, QUEUE_FILE), "");
    const read = readQueue(root);
    expect(read.kind).toBe("unreadable");
    if (read.kind === "unreadable") expect(read.why).toContain("truncated");
  });

  it("an empty file with NO marker is still never-written", () => {
    /* The marker is what draws the line; without one there is nothing to lose. */
    const root = withRoot();
    writeFileSync(join(root, QUEUE_FILE), "");
    const read = readQueue(root);
    expect(read.kind).toBe("queue");
  });

  it("the READER refuses a relative root, which its comment used to claim while only the writer did", () => {
    const read = readQueue("relative/queue");
    expect(read.kind).toBe("unreadable");
    if (read.kind === "unreadable") expect(read.why).toContain("absolute path");
  });
});

describe("round two: an append that would break the record is refused", () => {
  it("refuses a move with a missing anchor rather than writing an irreparable problem", () => {
    /* **SOL'S P1-3, second half.** `appendEvents` used to write first and hand
       back the problematic view afterwards, so this printed a tick and put a
       problem in the log that only hand-editing could remove — in an
       authorisation record. */
    const root = withRoot();
    appendEvents([added(A)], { root });
    const before = readFileSync(join(root, QUEUE_FILE), "utf8");

    const result = appendEvents([{ ...env(), kind: "moved", id: A, placement: { at: "after", anchor: B } }], { root });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe("would-break");
      expect(result.why).toContain("no way to take them back");
    }
    expect(readFileSync(join(root, QUEUE_FILE), "utf8")).toBe(before);
  });

  it("refuses `done` on an unknown id", () => {
    const root = withRoot();
    appendEvents([added(A)], { root });
    const result = appendEvents([{ ...env(), kind: "done", id: "qi-nosuchid" }], { root });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("would-break");
  });

  it("refuses to record a dispatch of an unauthorised item", () => {
    const root = withRoot();
    appendEvents([added(A, { by: "overseer" })], { root });
    const result = appendEvents(
      [{ ...env("overseer"), kind: "dispatched", id: A, session: "s", plan: null }],
      { root },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("would-break");
  });

  it("still ALLOWS an append to a queue that already has problems", () => {
    /* Otherwise one bad line freezes the record forever, and there is no way to
       write the note explaining it. The check asks only whether this batch
       makes things worse. */
    const root = withRoot();
    appendEvents([added(A)], { root });
    appendFileSync(join(root, QUEUE_FILE), "{not json}\n");
    const result = appendEvents([added(B)], { root });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.view.problems).toHaveLength(1);
  });
});

/* ------------------------------------------------------------------ *
 * Priority — 260909d.
 * ------------------------------------------------------------------ */

function prioritized(id: string, priority: number | null, by: "greg" | "overseer" = "overseer"): IdeaEvent {
  return { ...env(by), kind: "prioritized", id, priority };
}

describe("priority is ordering, not content", () => {
  it("the Overseer setting one bumps no revision and lapses nothing", () => {
    /* **THE CALL THIS WHOLE FEATURE TURNS ON.** A content edit by anyone but
       Greg lapses his approval (Sol's P0-2). A priority is the same axis as
       `moved`, which lapses nothing — so if this ever starts bumping the
       revision, applying Greg's own banding to sixteen items would hand him
       sixteen re-approvals to click through. */
    const view = foldQueue([added(A), prioritized(A, 0.9)]);
    const item = only(view, A);
    expect(item.priority).toBe(0.9);
    expect(item.revision).toBe(0);
    expect(item.authority).toMatchObject({ kind: "authorized", revision: 0 });
    expect(isDispatchable(view, item)).toBe(true);
    expect(view.problems).toEqual([]);
  });

  it("cannot make an unauthorised item dispatchable, however high it goes", () => {
    /* Priority moves an item up the LIST. It must not move it past the gate. */
    const view = foldQueue([added(A, { by: "overseer" }), prioritized(A, 1)]);
    const item = only(view, A);
    expect(currentOrder(view)).toEqual([A]);
    expect(isDispatchable(view, item)).toBe(false);
    expect(whyNotDispatchable(view, item)).toContain("authoris");
  });

  it("cannot answer a question only Greg can answer", () => {
    const view = foldQueue([added(A, { needsGreg: true }), prioritized(A, 1)]);
    expect(only(view, A).needsGreg).toBe(true);
    expect(isDispatchable(view, only(view, A))).toBe(false);
  });

  it("is null until somebody says otherwise — never 0, never 0.5", () => {
    /* Three candidate defaults and two of them put words in somebody's mouth:
       0.5 is an opinion nobody expressed, 0 is a judgement nobody made. */
    expect(only(foldQueue([added(A)]), A).priority).toBeNull();
  });

  it("a settled item cannot be reprioritised", () => {
    /* Same guard, same reason, as `moved`: it is out of the ordering, and a
       write against it is a stale intent getting a defined answer. */
    const view = foldQueue([added(A), { ...env(), kind: "done", id: A }, prioritized(A, 0.9)]);
    expect(view.problems.map((p) => p.kind)).toEqual(["illegal-transition"]);
    expect(only(view, A).priority).toBeNull();
  });

  it("clearing it puts the item back below every stated one", () => {
    const view = foldQueue([added(A), added(B), prioritized(A, 0.9), prioritized(B, 0.1), prioritized(A, null)]);
    expect(currentOrder(view)).toEqual([B, A]);
    expect(only(view, A).priority).toBeNull();
  });

  it("says what it did, in the item's own history", () => {
    const view = foldQueue([added(A), prioritized(A, 0.85), prioritized(A, null)]);
    const said = only(view, A).history.map((t) => t.what);
    expect(said).toEqual(["added", "prioritised at 0.85", "priority cleared"]);
  });
});

describe("the queue is ordered by priority, then by placement", () => {
  it("puts the higher priority first, whatever order they were added in", () => {
    const view = foldQueue([added(A), added(B), added(C), prioritized(B, 0.9), prioritized(C, 0.5)]);
    expect(currentOrder(view)).toEqual([B, C, A]);
  });

  it("the unstated sort below everything stated, even 0.1", () => {
    const view = foldQueue([added(A), added(B), prioritized(B, 0.1)]);
    expect(currentOrder(view)).toEqual([B, A]);
  });

  it("keeps placement order WITHIN a band — the second key, and it is not the id", () => {
    /* The mutation check lives here: swap the two keys in the comparator and
       this is the test that reds. `place` still owns the order inside a band,
       so `--front`/`--before` keep their meaning where they can be seen. */
    const view = foldQueue([
      added(A),
      added(B),
      added(C),
      prioritized(A, 0.5),
      prioritized(B, 0.5),
      prioritized(C, 0.5),
      { ...env(), kind: "moved", id: C, placement: { at: "front" } },
    ]);
    expect(currentOrder(view)).toEqual([C, A, B]);
  });

  it("0 is a stated priority and outranks the unstated", () => {
    /* The reason `null` is not spelled `0`: they are different claims, and
       this is where the difference is visible. */
    const view = foldQueue([added(A), added(B), prioritized(B, 0)]);
    expect(currentOrder(view)).toEqual([B, A]);
  });

  it("leaves the placement order alone, so an anchor still resolves across bands", () => {
    const view = foldQueue([
      added(A),
      added(B),
      prioritized(A, 0.1),
      prioritized(B, 0.9),
      added(C, { placement: { at: "after", anchor: A } }),
    ]);
    expect(view.problems).toEqual([]);
    /* C has no priority so it sorts last; the placement still took effect,
       which is what stops a later reprioritisation from surprising anybody. */
    expect(currentOrder(view)).toEqual([B, A, C]);
    const promoted = foldQueue([
      added(A),
      added(B),
      prioritized(A, 0.1),
      prioritized(B, 0.9),
      added(C, { placement: { at: "after", anchor: A } }),
      prioritized(C, 0.1),
    ]);
    expect(currentOrder(promoted)).toEqual([B, A, C]);
  });

  it("counts what is ahead in the order actually shown", () => {
    /* `waitingAhead` and `itemWait` both walk `view.items`. If the sort lived
       at the edges instead of in the fold, they would be counting an order
       nobody sees. */
    const view = foldQueue([added(A), added(B), prioritized(B, 0.9)]);
    expect(waitingAhead(view, B)).toBe(0);
    expect(waitingAhead(view, A)).toBe(1);
    expect(itemWait(view, only(view, B))).toMatchObject({ kind: "ahead", ahead: 0 });
    expect(itemWait(view, only(view, A))).toMatchObject({ kind: "ahead", ahead: 1 });
  });
});

describe("a priority out of range rejects the line", () => {
  const base = {
    schema: IDEA_QUEUE_SCHEMA,
    eventId: "ev-p",
    commandId: null,
    at: "2026-09-09T00:00:00.000Z",
    by: "greg",
  };

  it("accepts the ends of the range and null", () => {
    for (const priority of [0, 1, 0.5, null]) {
      expect(parseEvent(JSON.stringify({ ...base, kind: "prioritized", id: A, priority }))).not.toBeNull();
    }
  });

  it("refuses anything outside it, rather than clamping or ignoring it", () => {
    /* Clamping turns `1000` into a legitimate-looking top of the queue;
       ignoring turns a typo into silence. Both are the silent success this
       module exists against, so a bad line is rejected and becomes a problem. */
    for (const priority of [1.0000001, -0.1, "0.9", true, {}, []]) {
      expect(parseEvent(JSON.stringify({ ...base, kind: "prioritized", id: A, priority }))).toBeNull();
    }
  });

  it("refuses the two a JSON file cannot even carry", () => {
    /* `JSON.stringify` writes NaN and Infinity as `null`, which IS a valid
       priority — so asserting them through `parseEvent` would be a check
       answering a weaker question than it looks. They are asserted where they
       can actually arrive: a caller building an event in memory. */
    expect(isPriority(Number.NaN)).toBe(false);
    expect(isPriority(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isPriority(Number.NEGATIVE_INFINITY)).toBe(false);
    expect(isPriority(undefined)).toBe(false);
    expect(isPriority(null)).toBe(true);
    expect(isPriority(0)).toBe(true);
    expect(isPriority(1)).toBe(true);
  });

  it("refuses a prioritized event that names no priority at all", () => {
    expect(parseEvent(JSON.stringify({ ...base, kind: "prioritized", id: A }))).toBeNull();
  });

  it("takes a priority on `added`, and refuses a bad one there too", () => {
    const add = (priority: unknown): string =>
      JSON.stringify({
        ...base,
        kind: "added",
        id: A,
        text: "an idea",
        title: null,
        metadata: EMPTY_METADATA,
        placement: { at: "back" },
        priority,
      });
    expect(parseEvent(add(0.75))).toMatchObject({ kind: "added", priority: 0.75 });
    expect(parseEvent(add(2))).toBeNull();
    expect(parseEvent(add("high"))).toBeNull();
    /* Absent is still absent, and still means nobody has said. */
    const without = JSON.parse(add(null)) as Record<string, unknown>;
    delete without["priority"];
    expect(parseEvent(JSON.stringify(without))).toMatchObject({ priority: null });
  });

  it("a rejected line holds the whole queue, as every rejected line does", () => {
    const root = withRoot();
    appendEvents([added(A)], { root, expect: VERSION_ZERO });
    appendFileSync(join(root, QUEUE_FILE), `${JSON.stringify({ ...base, kind: "prioritized", id: A, priority: 9 })}\n`);
    const view = viewOf(readQueue(root));
    expect(view?.problems.map((p) => p.kind)).toEqual(["unreadable-line"]);
    expect(view === null ? [] : view.items.map((i) => isDispatchable(view, i))).toEqual([false]);
  });
});

describe("set-priorities: Greg's banding as a file somebody can read", () => {
  it("reads id, priority and an ignored trailing comment", () => {
    const parsed = parsePriorityFile(`# Overseer tooling first\n${A} 0.85  # the CLI\n${B} 0.6\n\n${C} 0.15\n`);
    expect(parsed).toEqual({
      ok: true,
      wanted: [
        { id: A, priority: 0.85 },
        { id: B, priority: 0.6 },
        { id: C, priority: 0.15 },
      ],
    });
  });

  it("refuses the WHOLE file for one bad line, naming the line", () => {
    /* Applying the half it understood is the exact failure the fold refuses:
       a partial ordering that looks like the one somebody wrote. */
    const parsed = parsePriorityFile(`${A} 0.85\nqi-nope 0.5\n${C} 0.15\n`);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.why).toContain("line 2");
  });

  it("refuses an out-of-range priority and a missing one", () => {
    expect(parsePriorityFile(`${A} 1.5\n`).ok).toBe(false);
    expect(parsePriorityFile(`${A}\n`).ok).toBe(false);
    expect(parsePriorityFile(`${A} high\n`).ok).toBe(false);
  });

  it("refuses the same id twice, because the second is somebody's mistake", () => {
    const parsed = parsePriorityFile(`${A} 0.2\n${A} 0.8\n`);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.why).toContain(A);
  });

  it("refuses a file that names nothing", () => {
    expect(parsePriorityFile("# only a comment\n\n").ok).toBe(false);
  });

  it("plans a change per item, and no event for one already at that number", () => {
    const view = foldQueue([added(A), added(B), added(C, { needsGreg: true }), prioritized(B, 0.6)]);
    const plan = planPriorities(view, [
      { id: A, priority: 0.85 },
      { id: B, priority: 0.6 },
      { id: C, priority: 0.15 },
      { id: D, priority: 0.4 },
    ]);
    expect(plan.changes).toEqual([
      { id: A, from: null, to: 0.85, needsGreg: false },
      { id: C, from: null, to: 0.15, needsGreg: true },
    ]);
    expect(plan.unchanged.map((u) => u.id)).toEqual([B]);
    expect(plan.absent).toEqual([D]);
    expect(plan.unnamed).toEqual([]);
  });

  it("names the queued items the file says nothing about", () => {
    const view = foldQueue([added(A), added(B)]);
    const plan = planPriorities(view, [{ id: A, priority: 0.85 }]);
    expect(plan.unnamed).toEqual([B]);
  });

  it("does not plan a change against a settled item", () => {
    const view = foldQueue([added(A), { ...env(), kind: "done", id: A }]);
    const plan = planPriorities(view, [{ id: A, priority: 0.85 }]);
    expect(plan.changes).toEqual([]);
    expect(plan.absent).toEqual([A]);
  });
});
