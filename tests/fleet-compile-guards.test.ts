/**
 * The guards that only the COMPILER can enforce, made to fail if they stop.
 *
 * Several types under `tools/fleet/` carry a comment saying the compiler
 * prevents something — a one-tap enacted action, a new refusal code with no HTTP
 * status, a gate arm nobody handled. Until this file, every one of those was a
 * *claim about* the compiler with nothing checking it, and the usual way of
 * proving a guard works does not work on this kind of guard:
 *
 * **`vitest` never type-checks.** A type-level guard cannot go red under
 * `npm test` — and the corollary is the part that bites, raised by the
 * `orchestrator-setup` session on 2026-09-08: **if the guard cannot go red under
 * `npm test`, then MUTATING it cannot go red under `npm test` either.** So the
 * mutation ritual this project runs on everything else is blind here, and a
 * `Record<Code, number>` quietly widened to `Partial<Record<…>>` would leave
 * every test green while the thing its comment promises stops being true.
 *
 * THE MECHANISM IS `@ts-expect-error`, and it is the whole point of the file.
 * The directive is an assertion that the next line does NOT compile, and
 * TypeScript reports an **unused** `@ts-expect-error` as an error of its own. So
 * if somebody removes a guard, the line below starts compiling, the directive
 * becomes unused, and `npm run typecheck` fails. That turns "this should not
 * compile" from a comment into something a gate enforces.
 *
 * **It is `npm run typecheck` that runs this, not `npm test`** — the wrapper
 * covers `tests/tsconfig.json`, which plain `tsc -p tsconfig.json` does not.
 * Both are gates, so the guard is real either way, but a reader who expects a
 * red test will not see one. Hence the runtime assertion at the bottom of each
 * block: something has to be here for `npm test` to run at all, and it is the
 * paired positive — the shape that SHOULD compile, actually built.
 */
import { describe, expect, it } from "vitest";

import { ACTIONS } from "../tools/fleet/actions.js";
import { classifyGate, type PaneGate } from "../tools/fleet/pane.js";
import { fleetState } from "../tools/fleet/state.js";
import type {
  Action as ActionWire,
  EnactedAction,
  FleetState as FleetStateWire,
  LaunchProgress,
  LaunchRecordView,
  NotifyOutcomeView,
  QueuedItem,
} from "../tools/fleet/wire.js";
import type { ClientAction } from "../tools/fleet/web/src/actions-client.js";
import type { DrainDeps } from "../tools/fleet/drain.js";
import { realActionDeps, type ActionDeps } from "../tools/fleet/routes-actions.js";
import { realBroadcastDeps, type BroadcastDeps } from "../tools/fleet/routes-broadcast.js";
import { RENAME_STATUS, type RenameErrorCode } from "../tools/fleet/routes-rename.js";
import { REFUSAL_STATUS, realSteerDeps, type SteerDeps } from "../tools/fleet/routes-steer.js";
import type { SendCoordinator } from "../tools/fleet/send-coordinator.js";
import { grantsPermission } from "../tools/fleet/pane.js";
import { answerQuestion, type RefusalCode, type SteerIo, type SteerResult } from "../tools/fleet/steer.js";

describe("an enacted action is never one-tap", () => {
  /**
   * `needsConfirm` is the literal `true`, not `boolean`, so that adding a
   * one-tap enacted action is a compile error and therefore a DECISION. Each of
   * the four either deletes work, kills somebody's agent, or throws away a
   * running test suite.
   */
  it("refuses to type an enacted action that could be pressed once", () => {
    const legal: EnactedAction = {
      effect: "enacted",
      id: "kill-session",
      scope: "session",
      label: "Exit",
      summary: "Kill the session",
      needsConfirm: true,
      gate: "the name must still mean this session",
    };
    expect(legal.needsConfirm).toBe(true);

    // @ts-expect-error `needsConfirm: false` on an enacted action must not compile.
    const illegal: EnactedAction = { ...legal, needsConfirm: false };
    void illegal;

    // The runtime half, so `npm test` says something too: no enacted action in
    // the real catalogue can be pressed once.
    const enacted = ACTIONS.filter((a) => a.effect === "enacted");
    expect(enacted.length).toBeGreaterThan(0);
    for (const a of enacted) expect(a.needsConfirm, a.id).toBe(true);
  });
});

/**
 * The catalogue's server arms and the parsed client arms meet through
 * `wire.ts`, not a comment saying two handwritten unions should agree.
 *
 * This has the same boundary as the other shared-wire guards: only a required,
 * top-level field is guaranteed to arrive as a compile failure. A client may
 * deliberately re-type an id it read from JSON, and may read an absent stagger
 * as null, but it may not silently omit a new required field the server sends.
 */
describe("the actions catalogue's shared wire shapes", () => {
  type EveryKeyRequired<T> = [T] extends [Required<T>] ? true : false;
  type EnactedWire = Extract<ActionWire, { effect: "enacted" }>;
  type EnactedClient = Extract<ClientAction, { effect: "enacted" }>;

  it("requires every top-level field on the server's enacted arm in the client arm", () => {
    const total: EveryKeyRequired<EnactedWire> = true;
    expect(total).toBe(true);

    // @ts-expect-error `false` is assignable ONLY when an enacted wire field is
    // optional. If this compiles, the directive goes unused and `npm run
    // typecheck` fails rather than a new field quietly becoming optional.
    const optional: EveryKeyRequired<EnactedWire> = false;
    void optional;

    /* This is deliberately the CLIENT arm, not a second server fixture. Add a
       required top-level field to `EnactedAction` in wire.ts and this object
       stops compiling until actions-client.ts parses or explicitly declines it. */
    const parsed: EnactedClient = {
      effect: "enacted",
      id: "a newer enacted id is still named",
      scope: "session",
      label: "An enacted action",
      summary: "Its wire fields are carried to the client.",
      needsConfirm: true,
      gate: "The server's named gate.",
    };
    expect(parsed.effect).toBe("enacted");

    const server: EnactedAction = {
      effect: "enacted",
      id: "kill-session",
      scope: "session",
      label: "Exit",
      summary: "Kill the session",
      needsConfirm: true,
      gate: "the name must still mean this session",
    };
    expect(server.needsConfirm).toBe(true);
  });
});

describe("every refusal code has a status, and a new one cannot inherit a guess", () => {
  /**
   * `Record<Code, number>` rather than a partial or a lookup with a fallback.
   * A fallback is how a new refusal comes to be answered with somebody else's
   * status — a 409 that should have been a 403, or worse a 200.
   */
  it("refuses a status table with a code missing", () => {
    /* READ OFF THE REAL EXPORTS, not off a fresh annotation written here.
       The first draft of this test declared its own `Record<RefusalCode, number>`
       and put a `@ts-expect-error` on an incomplete literal — which passes
       forever, because the annotation being tested was the one in the test. It
       could not detect `routes-rename.ts` widening to `Partial<Record<…>>`, and
       I checked: that mutation left it green. An assertion that constructs its
       own premise cannot detect the premise changing, which is tonight's other
       lesson arriving in the file written to apply the first one.

       So these are ASSIGNMENTS of the real values to the total type. If either
       export is widened, weakened to a partial, or given a fallback lookup,
       these stop compiling — and `npm run typecheck` is the gate that says so. */
    const totalRefusals: Record<RefusalCode, number> = REFUSAL_STATUS;
    const totalRenames: Record<RenameErrorCode, number> = RENAME_STATUS;
    expect(Object.keys(totalRefusals).length).toBeGreaterThan(10);
    expect(Object.keys(totalRenames).length).toBeGreaterThan(5);

    // @ts-expect-error and a code that does not exist is wrong in the other
    // direction — this one IS about the literal, so writing it here is right.
    const invented: Record<RenameErrorCode, number> = { ...RENAME_STATUS, "not-a-real-code": 400 };
    void invented;

    // Runtime: nothing in either table is a 2xx, whatever the compiler thinks.
    // A refusal answered 200 is the failure both tables exist to prevent.
    for (const [code, status] of Object.entries({ ...REFUSAL_STATUS, ...RENAME_STATUS })) {
      expect(status, code).toBeGreaterThanOrEqual(400);
    }
  });
});

describe("nothing may come between the check and the send", () => {
  /**
   * **`answerQuestion` IS SYNCHRONOUS, AND THAT IS A SAFETY PROPERTY.**
   *
   * Checked after Fable's ruling on the Overseer's snapshot guard, which
   * reframed a question I had been asking wrongly. Mine is not "can a caller
   * forge or mutate a `SeenQuestion`" — it is whether the guard's result may
   * outlive the capture it was computed from. Freezing would not touch that: a
   * frozen object compared at T1 and used at T2 is still a guard about T1.
   *
   * Two halves, and only one of them was already safe.
   *
   * The keystroke is taken from `now` — the fresh parse — and never from
   * `seen`, the client's copy. That is bind-at-the-point-of-use and it was
   * already right. It is also defensive rather than load-bearing, and saying so
   * is the honest version: once `sameQuestion` has passed, the two agree on
   * every field the keystroke is derived from, so using `seen` would not
   * currently be exploitable. It would merely be the shape that becomes
   * exploitable the first time `sameQuestion` stops comparing a field.
   *
   * The load-bearing half is the SYNCHRONY. `steer.ts`'s KNOWN GAPS already
   * records that a window remains between the last check and the send, because
   * tmux has no compare-and-send. What it does not say is that the window is
   * currently *microseconds* only because nothing suspends in it. Make this
   * function `async` and add one `await` between `sameQuestion` and `fire`, and
   * that window becomes arbitrarily long — the pane can be answered from the
   * terminal in the meantime and the digit lands in whatever replaced it. **No
   * test would go red**, because every test here drives a synchronous fake.
   *
   * So the return type is the guard. `SteerResult` and not `Promise<…>` is what
   * makes "nothing suspends between the check and the send" true, and this is
   * what makes changing it a compile error rather than a silent widening.
   */
  it("refuses to type answerQuestion as returning a promise", () => {
    // The real signature, asserted by assignment rather than by a literal
    // written here — the export's own type, not a copy of it.
    const sync: (...args: Parameters<typeof answerQuestion>) => SteerResult = answerQuestion;
    expect(typeof sync).toBe("function");

    // @ts-expect-error if this ever compiles, `answerQuestion` has become async
    // and the check-to-send window is no longer bounded by the event loop.
    const asAsync: (...args: Parameters<typeof answerQuestion>) => Promise<SteerResult> = answerQuestion;
    void asAsync;

    // The runtime half, so `npm test` says something: it really does return a
    // result rather than a thenable. A function returning `Promise<SteerResult>`
    // would satisfy the assignment above under a structural-only reading.
    const io: SteerIo = {
      listPanes: () => "",
      processParents: () => "",
      claudeCandidates: () => "",
      cmdline: () => null,
      capture: () => "",
      sendKeys: () => undefined,
    };
    const out = answerQuestion(
      { paneId: "%1", sessionId: "$1", claudeSessionId: "f1ee7000-0000-4000-8000-000000000001", panePid: 1 },
      { kind: "question", prompt: "?", material: { kind: "no-material" }, options: [], gate: { kind: "conversation" } },
      0,
      { kind: "needs-you" },
      io,
    );
    expect(out).not.toBeInstanceOf(Promise);
    expect(out.ok).toBe(false);
  });
});

describe("the gate's arms cannot be widened by accident", () => {
  /**
   * `grantsPermission` is a type predicate narrowing to everything that is NOT
   * `conversation`, so `now.gate.why` is readable inside the branch. That is
   * what makes a new arm — a future `configuration`, say — a compile error at
   * every call site rather than a silent fall-through to "allowed".
   */
  it("refuses a gate arm this build has never heard of", () => {
    // @ts-expect-error `configuration` is not a PaneGate arm; adding one must break here first.
    const future: PaneGate = { kind: "configuration", why: "changes a harness setting" };
    void future;

    // @ts-expect-error `conversation` carries no `why` — a reason there would be a reason to allow.
    const explained: PaneGate = { kind: "conversation", why: "seems fine" };
    void explained;

    // Runtime, and the paired positive for the predicate: it must be false for
    // exactly one arm. A `grantsPermission` that returned false for `unknown`
    // would compile perfectly and open the hole this whole design closes.
    const permission: PaneGate = { kind: "permission", why: "x" };
    const cannotTell: PaneGate = { kind: "unknown", why: "x" };
    const conversation: PaneGate = { kind: "conversation" };
    expect([permission, cannotTell].map(grantsPermission)).toEqual([true, true]);
    expect(grantsPermission(conversation)).toBe(false);
    // And the classifier really does produce the safe arm from nothing.
    expect(classifyGate({ kind: "no-material" }, []).kind).not.toBe("conversation");
  });
});

describe("nothing can be queued at an agent without saying who is speaking", () => {
  /**
   * **THE SAFETY PROPERTY OF THE WHOLE ACTION PATH, and it is a type or it is
   * nothing.** `QueuedItem.speaker` is what stops an automated coordinator's
   * instruction reaching an agent as an ordinary user turn indistinguishable
   * from Greg's — `drain.ts`'s `sendable()` renders the attribution at delivery
   * from this field, deliberately not at enqueue, because a sentence written
   * twenty minutes before it is typed has decayed by the time anybody reads it.
   *
   * The field's own comment says *"Not optional, and there is no default here on
   * purpose: who is speaking is the one thing a caller of this queue may not
   * decline to say."* Until this guard, that was a claim about the compiler with
   * nothing checking it — and the wiring it describes reached the drain during
   * the 2026-09-08 wave while the guard the plan asked for in the same breath
   * did not. Half a safety item is the half that stops it regressing.
   *
   * **The failure this prevents is silent.** An item built without a speaker
   * does not throw and does not look wrong; it arrives at an agent as words with
   * no attribution, which is exactly the state `renderSpoken` exists to make
   * impossible. Nothing at runtime can tell that apart from Greg typing.
   */
  it("refuses an item with no speaker, and one with a speaker it does not know", () => {
    const base = {
      id: "q1",
      sessionId: "$1",
      claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
      payload: { kind: "message", text: "keep going" },
      enqueuedAt: 0,
      leasedAt: null,
      invalidated: null,
    } as const;

    // @ts-expect-error `speaker` is required; an item that declines to say who is
    // asking must not be constructible, because nothing downstream can recover it.
    const anonymous: QueuedItem = { ...base };
    void anonymous;

    // @ts-expect-error A speaker this build does not know must not round to a
    // known one. `parseSpeaker` decides what an unrecognised claim means, at the
    // HTTP boundary where the claim actually arrives — not here.
    const invented: QueuedItem = { ...base, speaker: "some-new-agent" };
    void invented;

    /* Runtime, and the paired positive: the shape that SHOULD compile, actually
       built — so `npm test` has something to run and a reader who expected a red
       test sees the guard is real. `npm run typecheck` is what enforces the two
       directives above; vitest never type-checks. */
    const attributed: QueuedItem = { ...base, speaker: "greg" };
    const coordinator: QueuedItem = { ...base, speaker: "overseer" };
    expect([attributed.speaker, coordinator.speaker]).toEqual(["greg", "overseer"]);
  });
});

describe("the shared wire state cannot acquire an optional field", () => {
  /**
   * **THE MECHANISM'S OWN CLAIM, HELD TO ITS OWN CLAIM.**
   *
   * `wire.ts` § `FleetState` says a field added there "lands in both twins" and
   * stops the client's parse compiling. That is true of a REQUIRED, top-level
   * field and of nothing else — GPT Sol's M2, and it is right. Write
   * `diagnostic?: string` on the wire type and both ends go on compiling
   * happily: the server's object literal in `fleetState()` may omit an optional
   * key, and the client's parse is an object literal for a type whose key is
   * optional too. So the field ships, nobody reads it, and nothing is red —
   * which is precisely the lossy join the whole shared-wire stage exists to make
   * un-writable, arriving through the one door the mechanism does not cover.
   *
   * **`Required<T> extends T` is the check written the wrong way round**, and it
   * is worth naming because it looks right: a `Required<T>` is always assignable
   * to `T`, optional keys or not, so that reads `true` forever. The question
   * that discriminates is the other direction — can `T` stand in for a version
   * of itself with every key demanded? A type with a `?` cannot.
   *
   * NOT COVERED, deliberately: a required key typed `x: string | undefined`
   * (`Required` leaves those alone under `exactOptionalPropertyTypes`), and any
   * `?` nested inside `Row`, `Health` or `AttentionFeed`. Both are outside what
   * this guard claims — the drop it is about is a whole field going missing from
   * the payload, and a required key, however wide its type, is one both object
   * literals must still write out.
   */
  type EveryKeyRequired<T> = [T] extends [Required<T>] ? true : false;
  /** The two holes filled with the weakest thing that compiles; neither is under test. */
  type WireState = FleetStateWire<unknown, unknown>;

  it("refuses an optional top-level key on the payload every consumer derives from", () => {
    /* The positive, and it is the half with the readable failure: the moment a
       `?` appears on `FleetState`, this reads `false` and the assignment breaks
       by name rather than by a directive going quiet. */
    const total: EveryKeyRequired<WireState> = true;
    expect(total).toBe(true);

    // @ts-expect-error `false` is assignable ONLY when the wire type has an
    // optional key. If this line starts compiling, the directive goes unused and
    // `npm run typecheck` fails — which is what makes the guard un-deletable.
    const optional: EveryKeyRequired<WireState> = false;
    void optional;

    /* READ OFF THE REAL PRODUCER, not off a literal written here — the lesson
       the refusal-status block above learned the hard way. An optional key would
       make `fleetState`'s own return type optional in the same place, and an
       optional key is not assignable to a `Required<>`, so this is a second and
       independent way for the mutation to go red. */
    const payload: Required<WireState> = fleetState(
      null,
      null,
      null,
      60_000,
      true,
      null,
      { kind: "not-asked" },
      { kind: "not-asked" },
      { kind: "not-asked" },
    );

    /* Runtime, and the paired positive: the observable shape of the whole design
       is that a field with nothing to say is PRESENT and null, never absent.
       `collectedAt: null` means never collected; `collectedAt` missing would
       mean this is not the payload at all. */
    expect(Object.hasOwn(payload, "collectedAt")).toBe(true);
    expect(payload.collectedAt).toBeNull();
    expect(Object.hasOwn(payload, "attemptedAt")).toBe(true);
    expect(payload.schema).toBe(1);
  });
});

/**
 * The launch record, which moved behind `wire.ts` because it was a twin.
 *
 * Same guard as the payload above, pointed at the fourth endpoint to migrate.
 * The reason this type is here at all is that it was declared twice — once in
 * `routes-new.ts`, once in `web/src/new-session-client.ts` — and the client's
 * `parseLaunch` read the discriminant as a raw string, so a shape change was
 * invisible to the compiler and would have surfaced as the panel rendering
 * nothing.
 */
describe("the launch record's own shape", () => {
  type EveryKeyRequired<T> = [T] extends [Required<T>] ? true : false;

  it("refuses an optional top-level key on the launch record", () => {
    const total: EveryKeyRequired<LaunchRecordView> = true;
    expect(total).toBe(true);

    // @ts-expect-error `false` is assignable ONLY when the type has an optional
    // key. If this starts compiling the directive goes unused and
    // `npm run typecheck` fails — which is what makes the guard un-deletable.
    const optional: EveryKeyRequired<LaunchRecordView> = false;
    void optional;
  });

  /**
   * **THE POINT OF THE NESTING**, asserted rather than only documented.
   *
   * `progress` carries the state and its notification together, so the two bad
   * pairings cannot be written: a launch that is still starting cannot carry an
   * outcome, and one that has started cannot carry "not attempted". A top-level
   * `state` beside a top-level `notification` would compile both.
   */
  it("cannot express a started launch with no notification state", () => {
    const starting: LaunchProgress = { state: "starting", notification: { kind: "not-attempted" } };
    const started: LaunchProgress = { state: "started", notification: { kind: "pending" } };
    const done: LaunchProgress = { state: "started", notification: { kind: "no-holder" } };
    expect([starting.state, started.state, done.state]).toEqual(["starting", "started", "started"]);

    // @ts-expect-error a started launch may not carry `not-attempted` — that arm
    // belongs to `starting`, and this is the pairing the union exists to refuse.
    const wrong: LaunchProgress = { state: "started", notification: { kind: "not-attempted" } };
    void wrong;

    // @ts-expect-error and a starting launch may not carry an outcome, because
    // nothing has been attempted yet for it to be the outcome OF.
    const alsoWrong: LaunchProgress = { state: "starting", notification: { kind: "no-holder" } };
    void alsoWrong;
  });

  /**
   * `queued` is the success word. Neither `sent` nor `delivered` exists in the
   * union, because this route hands the line to the queue and stops — the
   * queue's own surface says what became of the keystrokes.
   */
  it("has no arm that claims a message was received", () => {
    const arms: NotifyOutcomeView["kind"][] = [
      "queued",
      "not-queued",
      "no-holder",
      "contested",
      "cannot-tell",
    ];
    /* Neither word is available, and that is the design: this route hands the
       line to the queue and stops, so it cannot claim a delivery and must not
       have an arm that reads like one. */
    for (const arm of arms) {
      expect(arm).not.toBe("sent");
      expect(arm).not.toBe("delivered");
    }
    expect(arms).toContain("queued");
  });
});

/**
 * **NO PRODUCER HOLDS A TRANSPORT.**
 *
 * The quarantine's guarantee is that a held session is not typed into, and the
 * check that enforces it lives on the line above the transport call inside
 * `send-coordinator.ts`. A producer that could reach `sendMessage` or
 * `answerQuestion` from its own dependency object could send without ever
 * consulting the book — which is precisely what the direct steer route and the
 * two broadcasts were doing until the review of Stage 4 found it.
 *
 * **A RUNTIME TEST CANNOT SAY THIS.** "There is no such field" is a statement
 * about a type, so the assertion has to be one too: each directive below says
 * *this property does not exist*, and TypeScript reports an UNUSED
 * `@ts-expect-error` as an error of its own. Put a transport back on any of the
 * three dependency types and the directive goes unused and `npm run typecheck`
 * fails.
 *
 * The paired positive is the runtime half, so `npm test` has something to run:
 * the coordinator IS on each of them, and it is the only way through.
 *
 * `tests/fleet-imports.test.ts` closes the other door — importing the transport
 * directly rather than taking it as a dependency.
 */
describe("the transport is the coordinator's and nobody else's", () => {
  it("refuses a transport on any producer's dependencies", () => {
    // @ts-expect-error the steering route sends through `deps.send`, and there
    // is no `sendMessage` beside it. If this compiles, a route can type into a
    // pane without asking whether the session is held.
    type SteerTransport = SteerDeps["sendMessage"];
    // @ts-expect-error the same for answering a dialog, which is keystrokes too.
    type SteerAnswerTransport = SteerDeps["answerQuestion"];
    // @ts-expect-error and for the ease-off broadcast next door.
    type ActionTransport = ActionDeps["sendMessage"];
    // @ts-expect-error and for the free-text broadcast, which held one until
    // 2026-09-09 and could therefore type into a session the page showed as HELD.
    type BroadcastTransport = BroadcastDeps["sendMessage"];
    // @ts-expect-error and for the drain.
    type DrainTransport = DrainDeps["sendMessage"];
    type Unused = [SteerTransport, SteerAnswerTransport, ActionTransport, BroadcastTransport, DrainTransport];
    void (undefined as unknown as Unused);

    // THE PAIRED POSITIVE, built rather than described: every producer carries
    // the one object that can type at a pane, and it is the same type in each.
    const coordinators: SendCoordinator[] = [
      realSteerDeps().send,
      realActionDeps().send,
      realBroadcastDeps().send,
    ];
    for (const c of coordinators) expect(typeof c.message).toBe("function");
    expect(coordinators.every((c) => typeof c.book === "function")).toBe(true);
  });
});
