// @vitest-environment jsdom
/**
 * **The New session panel's discovery deadline, at its edges.**
 *
 * `tests/fleet-web.test.tsx` holds the Baseline regressions for the absolute
 * discovery deadline — every poll failing, a launch that answers for four
 * minutes, a poll that never answers, a late answer after the give-up. This
 * file EXTENDS them rather than redoing them; they stay exactly as they are.
 * Stage 5 of docs/plans/260910c-session-continuity-protect-drafts-and-keep-context-current.md
 * asked for three more cases:
 *
 * 1. **A late discovery, with a named winner** (ledger row F9, GPT Sol's
 *    wording, accepted verbatim): *a poll begun before the absolute discovery
 *    deadline but resolving after it must not update the launch or erase the
 *    give-up state; the absolute deadline wins, the late result is discarded,
 *    and no further poll starts.* Both a late `started` and a late `failed`.
 * 2. **The panel unmounted mid-poll.**
 * 3. **A duplicate tap on Start**, and a tap after a give-up, which must get a
 *    deadline of its own rather than inherit the old one.
 *
 * Mounted on its own, the way tests/fleet-new-session-mic.test.tsx does it,
 * with the dictation hook as a fixture: nothing here is about the microphone,
 * and a real hook would only add a way for `sendBlocked` to be true for reasons
 * this file does not control.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UseDictation } from "../src/web/useDictation.js";
import {
  parseLaunch,
  type LaunchRecord,
  type NewSessionApi,
  type PollOutcome,
  type StartOutcome,
} from "../tools/fleet/web/src/new-session-client";

vi.mock("../src/web/useDictation.js", () => ({
  useDictation: (): UseDictation =>
    ({
      supported: true,
      phase: "idle",
      armed: false,
      transcribing: false,
      liveText: true,
      interim: "",
      level: { current: 0 },
      meter: "none",
      quiet: false,
      toggle: () => {},
      error: null,
      startedAt: null,
      deviceLabel: null,
      deviceId: null,
      deviceUnavailable: false,
      chooseDevice: () => {},
      recording: null,
      clearRecording: () => {},
      canRetry: false,
      retry: () => {},
    }) as UseDictation,
}));

const { NewSessionPanel, POLL_GIVE_UP_MS, POLL_MS } = await import("../tools/fleet/web/src/NewSessionPanel");

/* As fleet-web.test.tsx does. Without it every `act` logs a complaint, and the
   console spy in the unmount test would be reading those instead of the panel. */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** Every test starts its clock here, so "elapsed" means "since polling began". */
const T0 = new Date("2026-09-10T12:00:00Z").getTime();
const elapsed = (): number => Date.now() - T0;

/** A launch record, through the real parser, so the fixture is one the wire could carry. */
function launch(id: string, state: "starting" | "started" | "failed", extra: Record<string, unknown> = {}): LaunchRecord {
  const notification =
    state === "started" ? { kind: "pending" } : state === "starting" ? { kind: "not-attempted" } : { kind: "not-applicable" };
  const record = parseLaunch({
    id,
    progress: { state, notification },
    name: null,
    dir: "/home/greg/code/spideryarn2",
    promptBytes: 7,
    requestedAt: "",
    finishedAt: state === "starting" ? null : "",
    error: null,
    maybeStarted: false,
    note: null,
    ...extra,
  });
  if (record === null) throw new Error(`the ${state} fixture did not parse`);
  return record;
}

const stillStarting = (record: LaunchRecord): PollOutcome => ({
  ok: true,
  feed: { busy: true, retryAfterMs: 0, launches: [record] },
});

/** A promise the test settles by hand — a request accepted and not yet answered. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve: (value: T) => void = () => {
    throw new Error("deferred resolved before it was created");
  };
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

let host: HTMLDivElement;
let root: Root;
let mounted = false;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(T0);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  mounted = false;
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function mount(api: NewSessionApi): void {
  act(() => {
    root.render(<NewSessionPanel api={api} />);
  });
  mounted = true;
}

function unmount(): void {
  act(() => root.unmount());
  mounted = false;
}

function text(): string {
  return host.textContent ?? "";
}

function button(label: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === label);
  if (!found) {
    throw new Error(`no button saying ${label}; saw: ${[...host.querySelectorAll("button")].map((b) => b.textContent).join(" | ")}`);
  }
  return found;
}

/** Open the panel if it is shut, and type a prompt into its box. */
function typePrompt(value: string): void {
  if (host.querySelector("#new-session-prompt") === null) act(() => button("New session").click());
  const box = host.querySelector<HTMLTextAreaElement>("#new-session-prompt");
  if (!box) throw new Error("no prompt box");
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  if (!setter) throw new Error("this DOM has no HTMLTextAreaElement value setter");
  act(() => {
    setter.call(box, value);
    box.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** Press Start and let an already-answered POST land. */
async function tapStart(): Promise<void> {
  await act(async () => {
    button("Start it").click();
  });
}

/** Advance the clock in the panel's own steps, flushing each tick's promises inside `act`. */
async function steps(count: number, each: number = POLL_MS): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(each);
    });
  }
}

const STOPPED = "stopped asking";

describe("a discovery that arrives after the deadline", () => {
  /*
   * The late result, per outcome: the words it would put on the card if it were
   * (wrongly) allowed to land. Both are asserted absent by distinctive text, so
   * rewording the card cannot quietly retire the check.
   */
  const outcomes = [
    { outcome: "started", late: () => launch("S1", "started", { name: "late-arrival" }), shows: "late-arrival" },
    {
      outcome: "failed",
      late: () => launch("S1", "failed", { error: "late-refusal from the launcher" }),
      shows: "late-refusal from the launcher",
    },
  ] as const;

  /*
   * Two windows, and the first is the one that was open. The deadline is
   * `POLL_GIVE_UP_MS` after polling began, but it was only ever LOOKED AT when
   * the interval ticked — and the tick that lands exactly on the deadline does
   * not pass it (`>`), so the give-up tick is the one after. An answer arriving
   * in those three seconds was applied as though it were on time: the card
   * rewritten, the launch "settled", and no give-up banner ever drawn. The
   * second window is the existing regression's (fleet-web.test.tsx, "ignores a
   * poll that answers after the page has already given up"), which covered only
   * a late `started`.
   */
  const windows = [
    { window: "before the next tick has noticed", stepsPastStart: Math.ceil(POLL_GIVE_UP_MS / POLL_MS), extraMs: POLL_MS / 3 },
    { window: "after the give-up tick", stepsPastStart: Math.ceil(POLL_GIVE_UP_MS / POLL_MS) + 2, extraMs: 0 },
  ] as const;

  const cases = outcomes.flatMap((o) => windows.map((w) => ({ ...o, ...w })));

  it.each(cases)(
    "discards a late $outcome that answers $window, keeps the give-up, and asks nothing more",
    async ({ late, shows, stepsPastStart, extraMs }) => {
      const starting = launch("S1", "starting");
      const held = deferred<PollOutcome>();
      let heldBegunAt: number | null = null;
      let polls = 0;

      mount({
        start: async () => ({ accepted: true, launch: starting }),
        poll: () => {
          polls += 1;
          /* Answer promptly until the last interval before the deadline; the
             ask begun then is the one that is still out when the deadline
             passes. Single-flight keeps any later tick from asking again. */
          if (heldBegunAt === null && elapsed() >= POLL_GIVE_UP_MS - POLL_MS) {
            heldBegunAt = elapsed();
            return held.promise;
          }
          return Promise.resolve(stillStarting(starting));
        },
      });
      typePrompt("start me");
      await tapStart();

      await steps(stepsPastStart);
      if (extraMs > 0) await steps(1, extraMs);

      /* The premises, asserted, so the test cannot pass by testing something
         easier: the held ask really did begin BEFORE the deadline, and the
         clock really is past it when the answer lands. */
      expect(heldBegunAt).not.toBeNull();
      expect(heldBegunAt as unknown as number).toBeLessThan(POLL_GIVE_UP_MS);
      expect(elapsed()).toBeGreaterThan(POLL_GIVE_UP_MS);

      // The late answer arrives, with news.
      await act(async () => {
        held.resolve({ ok: true, feed: { busy: false, retryAfterMs: 0, launches: [late()] } });
      });

      // The deadline won: the banner stands and the card was not rewritten.
      expect(text()).toContain(STOPPED);
      expect(text()).toContain("Starting…");
      expect(text()).not.toContain(shows);

      // And nothing further is asked, for a minute and more.
      const settled = polls;
      await steps(20);
      expect(polls).toBe(settled);
      expect(text()).toContain(STOPPED);
      expect(text()).not.toContain(shows);
    },
  );
});

describe("the panel unmounted while a poll is out", () => {
  /*
   * React 19 no longer warns about a state update on an unmounted component, so
   * the console spy below guards against a regression that throws or logs — it
   * cannot see a silent `setState` into a dead tree. The observable half is the
   * part that costs something: an interval still firing, or a request still
   * being made, from a panel nobody can see.
   */
  it("stops the interval, asks nothing more, and a late answer changes nothing", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnings = vi.spyOn(console, "warn").mockImplementation(() => {});
    const starting = launch("S2", "starting");
    const held = deferred<PollOutcome>();
    let polls = 0;

    mount({
      start: async () => ({ accepted: true, launch: starting }),
      poll: () => {
        polls += 1;
        return held.promise;
      },
    });
    typePrompt("start me");
    const before = vi.getTimerCount();
    await tapStart();

    /* The premise: polling is under way, with one ask out and one interval
       armed. Without the second line, "zero timers after unmount" would pass
       for a panel that never set one. */
    expect(polls).toBe(1);
    expect(vi.getTimerCount()).toBe(before + 1);

    unmount();
    expect(vi.getTimerCount()).toBe(before);

    await steps(Math.ceil(POLL_GIVE_UP_MS / POLL_MS) + 5);
    expect(polls).toBe(1);

    await act(async () => {
      held.resolve({ ok: true, feed: { busy: false, retryAfterMs: 0, launches: [launch("S2", "started")] } });
    });
    await steps(3);

    expect(polls).toBe(1);
    expect(host.textContent).toBe("");
    expect(errors.mock.calls).toEqual([]);
    expect(warnings.mock.calls).toEqual([]);
  });
});

describe("pressing Start", () => {
  /*
   * Two taps before the POST has answered must start ONE agent. The button goes
   * `disabled` while asking, but `disabled` is a property of a drawn element: a
   * second tap that lands before the page has redrawn reaches the action, and
   * the file's own rule for `sendBlocked` is that the guard lives in the action
   * as well as on the button. Counted at the api, not read off the screen — two
   * POSTs is two Claudes on a box that has met the OOM killer, whatever the
   * card says.
   */
  it("starts exactly one launch for two taps before the first POST answers", async () => {
    const answer = deferred<StartOutcome>();
    let starts = 0;

    mount({
      start: () => {
        starts += 1;
        return answer.promise;
      },
      poll: async () => stillStarting(launch("S3", "starting")),
    });
    typePrompt("start me");

    // Two taps inside one turn: the page has not redrawn between them.
    const start = button("Start it");
    await act(async () => {
      start.click();
      start.click();
    });
    // And a third after it has, while the POST is still out.
    await act(async () => {
      button("Asking…").click();
    });
    expect(starts).toBe(1);

    await act(async () => {
      answer.resolve({ accepted: true, launch: launch("S3", "starting") });
    });
    expect(starts).toBe(1);
    expect(host.querySelectorAll("li")).toHaveLength(1);
  });

  /*
   * A launch after a give-up is a new launch, and gets four minutes of its own.
   * The deadline is measured from when polling BEGAN, so a panel that measured
   * the second launch from the first one's start would give up on it at the
   * first tick — a banner saying "stopped asking" about a launch it asked about
   * once.
   */
  it("gives a launch after a give-up a fresh deadline of its own", async () => {
    const first = launch("S4", "starting");
    const second = launch("S5", "starting");
    let current = first;
    let starts = 0;
    let polls = 0;

    mount({
      start: async () => {
        starts += 1;
        current = starts === 1 ? first : second;
        return { accepted: true, launch: current };
      },
      poll: async () => {
        polls += 1;
        return stillStarting(current);
      },
    });
    typePrompt("start me");
    await tapStart();
    await steps(Math.ceil(POLL_GIVE_UP_MS / POLL_MS) + 2);
    expect(text()).toContain(STOPPED);

    typePrompt("start another");
    await tapStart();
    expect(starts).toBe(2);
    // The new launch retires the old warning…
    expect(text()).not.toContain(STOPPED);

    // …and is still being asked about half a minute on.
    const relaunched = polls;
    await steps(10);
    expect(text()).not.toContain(STOPPED);
    expect(polls).toBeGreaterThanOrEqual(relaunched + 10);

    // Its own four minutes later, it gives up in its own right, and stops.
    await steps(Math.ceil(POLL_GIVE_UP_MS / POLL_MS));
    expect(text()).toContain(STOPPED);
    const settled = polls;
    await steps(10);
    expect(polls).toBe(settled);
    expect(starts).toBe(2);
  });
});
