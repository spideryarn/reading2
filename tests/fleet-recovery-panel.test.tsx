// @vitest-environment jsdom
/**
 * The "Interrupted work" section: every banner, every classification, the
 * unverified transcript label, `cannot-tell` as itself, `manual` as two facts —
 * and no `<button>` in any state, because nothing on this page may act.
 *
 * The client's parse path is driven through `makeRecoveryApi` with its request
 * leaf injected, so a record the browser cannot read is shown to make the whole
 * answer `no-answer` rather than a shorter list.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RECOVERY_POLL_MS, RecoveryPanel } from "../tools/fleet/web/src/RecoveryPanel";
import { makeRecoveryApi, type RecoveryApi, type RecoveryView } from "../tools/fleet/web/src/recovery-client";
import type { RecoveryFeed, RecoveryWireEvidence, RecoveryWireRecord, RecoveryWireRecordState } from "../tools/fleet/wire";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONVERSATION = "93a6f1d8-2e4b-4c70-b8f5-0d17e6a93c24";
const CLAIM = "2c8f5e0a-7b13-4d96-8e2a-61f4c9d0b375";
const NOW = Date.parse("2026-09-10T15:00:00.000Z");

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

function evidence(over: Partial<Extract<RecoveryWireEvidence, { kind: "checked" }>> = {}): RecoveryWireEvidence {
  return {
    kind: "checked",
    dir: { kind: "exists", path: "/home/greg/code/spideryarn2/.claude/worktrees/a-very-long-worktree-name-that-must-break" },
    worktree: { kind: "none" },
    transcript: { kind: "no-conversation", why: "the session carried neither a verified conversation nor a claim" },
    lastActivity: { at: "2026-09-10T13:00:00.000Z", source: "register-floor" },
    resume: { kind: "not-supported", why: "no verified execution was seen, so the harness is not known" },
    ...over,
  };
}

function rec(id: string, state: RecoveryWireRecordState, over: Partial<RecoveryWireRecord> = {}): RecoveryWireRecord {
  return {
    id,
    key: `$1 ${id}`,
    name: `session-${id}`,
    at: "2026-09-10T14:00:00.000Z",
    origin: "journal",
    oversize: false,
    entry: { dir: `/work/${id}`, worktree: null, lastSeenAlive: "2026-09-10T13:00:00.000Z", lastStatusKey: "working" },
    lastSeen: { statusKey: "working", title: null, harness: "claude-code", collectedAt: "2026-09-10T13:00:00.000Z" },
    disappearance: { goneWhy: "tmux-server-changed", generation: "changed", producerRun: "changed", watched: true, bootChanged: true },
    state,
    ...over,
  };
}

function feed(records: RecoveryWireRecord[], over: Partial<Extract<RecoveryFeed, { kind: "published" }>> = {}): RecoveryFeed {
  return {
    schema: 1,
    kind: "published",
    composedAt: "2026-09-10T15:00:00.000Z",
    path: "/store/recovery.json",
    writtenAt: "2026-09-10T14:59:00.000Z",
    view: { kind: "checked", checkedAt: "2026-09-10T14:58:00.000Z", inventory: { kind: "trusted", collectedAt: "2026-09-10T14:57:00.000Z", rows: 3 } },
    replay: { kind: "ran", worldChanges: 0, derived: 0, scannedBytes: 10 },
    overflow: 0,
    total: records.length,
    unresolved: records.filter((r) => r.state.kind !== "resolved").length,
    olderCount: 0,
    records,
    ...over,
  };
}

function api(view: RecoveryView, calls: { n: number } = { n: 0 }): RecoveryApi {
  return {
    fetch: () => {
      calls.n += 1;
      return Promise.resolve(view);
    },
  };
}

async function show(view: RecoveryView): Promise<void> {
  await act(async () => {
    root.render(<RecoveryPanel api={api(view)} nowMs={NOW} />);
  });
}

function text(): string {
  return host.textContent ?? "";
}

function noButtons(): void {
  expect(host.querySelectorAll("button")).toHaveLength(0);
  expect(host.querySelectorAll("a[href]")).toHaveLength(0);
}

function testId(id: string): HTMLElement | null {
  return host.querySelector(`[data-testid="${id}"]`);
}

describe("the failure arms, each its own sentence", () => {
  const composedAt = "2026-09-10T15:00:00.000Z";
  const arms: [RecoveryView, string][] = [
    [{ kind: "no-answer", why: "this browser could not reach the dashboard" }, "recovery-no-answer"],
    [{ schema: 1, kind: "absent", composedAt, path: "/store/recovery.json", why: "the Overseer has not written a recovery index here" }, "recovery-absent"],
    [{ schema: 1, kind: "unreadable", composedAt, why: "EACCES" }, "recovery-unreadable"],
    [{ schema: 1, kind: "unsupported-schema", composedAt, path: "/s", saw: "2", known: 1, why: "schema 2" }, "recovery-unsupported"],
    [{ schema: 1, kind: "oversized", composedAt, path: "/s", sizeBytes: 9, limitBytes: 1, why: "too big" }, "recovery-oversized"],
  ];
  for (const [view, id] of arms) {
    it(`${view.kind}: its banner, no records, no buttons`, async () => {
      await show(view);
      expect(text()).toContain("Interrupted work");
      expect(testId(id)).not.toBeNull();
      expect(host.querySelectorAll('[data-testid="recovery-record"]')).toHaveLength(0);
      expect(testId("recovery-empty")).toBeNull();
      noButtons();
    });
  }

  it("unreadable says it is not an empty list", async () => {
    await show({ schema: 1, kind: "unreadable", composedAt, why: "EACCES" });
    expect(text()).toContain("This is not an empty list");
  });
});

describe("the banners at the top of a published index", () => {
  it("not yet checked by this daemon: a banner, and the records shown unchecked", async () => {
    await show(
      feed([rec("a", { kind: "unchecked", why: "not yet checked by this daemon" })], {
        view: { kind: "not-yet-checked", why: "the daemon has not yet checked these records since it started" },
      }),
    );
    expect(testId("recovery-banner-unchecked")?.textContent).toContain("Not yet checked by this daemon");
    expect(host.querySelector('[data-state="unchecked"]')).not.toBeNull();
    expect(text()).toContain("whether it exists was not checked");
    noButtons();
  });

  it("an untrusted inventory: its sentence once, as a banner, and not on every row", async () => {
    const sentence = "the latest payload was refused since the last accept";
    const unknown = (id: string) => rec(id, { kind: "classified", classification: { kind: "unknown", why: `the current inventory cannot be trusted: ${sentence}` }, evidence: evidence() });
    await show(feed([unknown("a"), unknown("b"), unknown("c")], { view: { kind: "checked", checkedAt: "2026-09-10T14:58:00.000Z", inventory: { kind: "untrusted", why: sentence } } }));
    expect(testId("recovery-banner-untrusted")?.textContent).toContain(sentence);
    expect(text().split(sentence)).toHaveLength(2);
    expect(host.querySelectorAll('[data-state="unknown"]')).toHaveLength(3);
    expect(text()).toContain("see above");
  });

  it("the replay did not run: a banner with its reason", async () => {
    await show(feed([], { replay: { kind: "not-run", why: "the log is over the replay ceiling" } }));
    expect(testId("recovery-banner-replay")?.textContent).toContain("the log is over the replay ceiling");
  });

  it("overflow: the exact count, and that those events survive only in events.jsonl", async () => {
    await show(feed([], { overflow: 3 }));
    const banner = testId("recovery-banner-overflow")?.textContent ?? "";
    expect(banner).toContain("3 candidates");
    expect(banner).toContain("events.jsonl");
  });

  it("the view's age, against the page's clock", async () => {
    await show(feed([]));
    expect(testId("recovery-age")?.textContent).toMatch(/Checked 2m ago/);
  });

  it("a read index with nothing in it says so, and only then", async () => {
    await show(feed([]));
    expect(testId("recovery-empty")?.textContent).toContain("No interrupted work is recorded");
  });
});

describe("each classification, and the facts on each row", () => {
  const row = { tmuxId: "$5", name: "live-one", dir: "/work/x", claimedConversationId: null, statusKey: "working", executionToken: null, conversationId: null };
  const classes: RecoveryWireRecordState[] = [
    { kind: "classified", classification: { kind: "interrupted", why: "the host rebooted while this session was running" }, evidence: evidence() },
    { kind: "classified", classification: { kind: "present-but-unmatched", why: "a live row has the same name and directory", row }, evidence: evidence() },
    { kind: "classified", classification: { kind: "unknown", why: "nobody watched it go" }, evidence: evidence() },
    { kind: "classified", classification: { kind: "ended-before-reboot", why: "last observed stopped", statusKey: "no-claude", observedAt: "2026-09-10T13:00:00.000Z" }, evidence: evidence() },
    { kind: "classified", classification: { kind: "already-live", why: "the same conversation is live", sameRun: true, row }, evidence: evidence() },
    { kind: "resolved", resolution: { disposition: "resumed", at: "2026-09-10T14:30:00.000Z", evidence: { previousToken: "b:1:2", token: "b:3:4", conversationId: CONVERSATION } } },
    { kind: "resolved", resolution: { disposition: "dismissed", at: "2026-09-10T14:30:00.000Z", evidence: { requestId: "r-1", why: "checked the worktree by hand" } } },
  ];

  it("draws every one with its own state, and no button anywhere", async () => {
    await show(feed(classes.map((state, i) => rec(`c${i}`, state))));
    const states = [...host.querySelectorAll('[data-testid="recovery-record"]')].map((el) => el.getAttribute("data-state"));
    expect(states).toEqual(["interrupted", "present-but-unmatched", "unknown", "ended-before-reboot", "already-live", "resolved", "resolved"]);
    expect(text()).toContain("the host rebooted while this session was running");
    expect(text()).toContain("live-one");
    expect(text()).toContain("checked the worktree by hand");
    expect(text()).toContain("b:1:2 → b:3:4");
    noButtons();
  });

  it("a transcript found under a claim is labelled unverified", async () => {
    await show(
      feed([
        rec("claim", {
          kind: "classified",
          classification: { kind: "interrupted", why: "x" },
          evidence: evidence({ transcript: { kind: "found-under-claim", claimedConversationId: CLAIM, path: "/p/c.jsonl", mtime: null, why: "unverified: found under the tmux environment's claim" } }),
        }),
      ]),
    );
    const pill = [...host.querySelectorAll('[data-slot="pill"]')].find((el) => el.textContent === "unverified");
    expect(pill).toBeDefined();
    expect(text()).toContain(CLAIM);
  });

  it("cannot-tell is its own state and never 'not found'", async () => {
    await show(
      feed([
        rec("bound", {
          kind: "classified",
          classification: { kind: "interrupted", why: "x" },
          evidence: evidence({ transcript: { kind: "cannot-tell", under: "verified", conversationId: CONVERSATION, why: "the transcript search stopped after 2000 project directories" } }),
        }),
      ]),
    );
    expect(text()).toContain("cannot tell");
    expect(text()).toContain("stopped after 2000 project directories");
    expect(text()).not.toContain("not found");
  });

  it("a missing directory, a floor drawn with ≥, the latest evidence, and a resume sentence", async () => {
    await show(
      feed([
        rec("gone", {
          kind: "classified",
          classification: { kind: "interrupted", why: "x" },
          evidence: evidence({ dir: { kind: "missing", path: "/work/gone", why: "no such directory" } }),
        }),
      ]),
    );
    expect(text()).toContain("missing");
    expect(text()).toContain("no such directory");
    expect(text()).toContain("≥ 2026-09-10T13:00:00.000Z");
    expect(text()).toContain("harness claude-code");
    expect(text()).toContain("not supported: no verified execution was seen");
  });

  it("manual: 'on <host>, in <dir>' as two facts, and no command text", async () => {
    await show(
      feed([
        rec("shell", {
          kind: "classified",
          classification: { kind: "interrupted", why: "x" },
          evidence: evidence({ resume: { kind: "manual", host: "gjd-box", dir: "/work/shell", why: "a shell or a manual job: there is nothing to resume, only a place to go and look" } }),
        }),
      ]),
    );
    expect(text()).toContain("on gjd-box, in /work/shell");
    expect(text()).not.toMatch(/\bssh\b|\bcd \/|--resume/);
    noButtons();
  });
});

describe("polling", () => {
  it("fetches on mount, then no faster than once a minute, and stops when unmounted", async () => {
    vi.useFakeTimers();
    const calls = { n: 0 };
    await act(async () => {
      root.render(<RecoveryPanel api={api(feed([]), calls)} nowMs={NOW} />);
    });
    expect(calls.n).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(RECOVERY_POLL_MS - 1);
    });
    expect(calls.n).toBe(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(calls.n).toBe(2);
    act(() => root.unmount());
    await act(async () => {
      vi.advanceTimersByTime(RECOVERY_POLL_MS * 3);
    });
    expect(calls.n).toBe(2);
    root = createRoot(host);
  });

  it("fetches again when the page's refresh nonce changes", async () => {
    const calls = { n: 0 };
    const stable = api(feed([]), calls);
    await act(async () => {
      root.render(<RecoveryPanel api={stable} refreshNonce={0} nowMs={NOW} />);
    });
    await act(async () => {
      root.render(<RecoveryPanel api={stable} refreshNonce={1} nowMs={NOW} />);
    });
    expect(calls.n).toBe(2);
  });
});

describe("the client's strict parser, through the real request path", () => {
  function leaf(body: unknown, status = 200) {
    return () => Promise.resolve({ status, json: () => Promise.resolve(body) } as unknown as Response);
  }

  it("a well-formed published answer passes whole", async () => {
    const body = feed([rec("a", { kind: "unchecked", why: "not yet checked" })]);
    expect(await makeRecoveryApi(leaf(body)).fetch()).toEqual(body);
  });

  it("one record it cannot read makes the whole answer no-answer, never a shorter list", async () => {
    const good = rec("a", { kind: "unchecked", why: "not yet checked" });
    const bad = { ...rec("b", { kind: "unchecked", why: "x" }), state: { kind: "classified", classification: { kind: "a-new-class", why: "x" }, evidence: evidence() } };
    const view = await makeRecoveryApi(leaf({ ...feed([good]), records: [good, bad], total: 2 })).fetch();
    expect(view.kind).toBe("no-answer");
    expect(view).toMatchObject({ why: expect.stringMatching(/record 2/) });
  });

  it("counts that do not add up are refused", async () => {
    const view = await makeRecoveryApi(leaf({ ...feed([]), total: 5, olderCount: 0 })).fetch();
    expect(view.kind).toBe("no-answer");
  });

  it("a network failure is the browser's own no-answer, not the server's voice", async () => {
    const view = await makeRecoveryApi(() => Promise.reject(new TypeError("Failed to fetch"))).fetch();
    expect(view).toMatchObject({ kind: "no-answer", why: expect.stringMatching(/could not reach the dashboard/) });
  });
});
