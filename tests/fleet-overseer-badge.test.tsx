// @vitest-environment jsdom
/**
 * **The dashboard saying who the Overseer is — and, more importantly, when
 * nobody is.**
 *
 * The box is meant to have exactly one supervising session
 * (docs/project/overseer.md), and the claim is a variable in that session's tmux
 * environment, so it dies with the tmux server. **After a reboot nobody holds
 * it**, and nothing else on this page would notice: the daemon can be perfectly
 * alive, the rows all present, the counts all green. So the absent state is what
 * these tests are mostly about — a per-row badge structurally cannot show it,
 * which is why the header carries a line of its own.
 *
 * The plan is docs/plans/260908j-mark-one-session-as-the-overseer.md.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Header, freshness } from "../tools/fleet/web/src/Header";
import { SessionsPanel } from "../tools/fleet/web/src/SessionsPanel";
import { parseFleetState, type FleetState, type SessionRole } from "../tools/fleet/web/src/types";

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const draw = (node: React.ReactNode): void => {
  act(() => root.render(node));
};

/** A payload the way the server sends it, so the real parser runs. */
function wireRow(over: { id: string; name: string; role?: unknown }): Record<string, unknown> {
  return {
    id: over.id,
    name: over.name,
    title: null,
    repo: "spideryarn/reading2",
    worktree: null,
    meta: { version: 1, kind: "claude", repo: "spideryarn/reading2", dir: "/home/greg/code/spideryarn2" },
    startedAt: "2026-09-08T20:00:00.000Z",
    paneId: "%1",
    panePid: 100,
    claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
    question: null,
    status: { kind: "idle" },
    ...("role" in over ? { role: over.role } : {}),
  };
}

/** Through the REAL parser, so an absent `role` key is absent the way a server makes it. */
function stateOf(rows: Record<string, unknown>[], over: Record<string, unknown> = {}): FleetState {
  const read = parseFleetState(
    {
      schema: 1,
      rows,
      collectedAt: "2026-09-08T20:04:50.000Z",
      attemptedAt: "2026-09-08T20:05:00.000Z",
      servedAt: "2026-09-08T20:05:00.000Z",
      tmuxServerPid: 1,
      tookMs: 10,
      error: null,
      health: null,
      refreshMs: 60_000,
      answeringEnabled: true,
      attention: { kind: "not-asked" },
      // LAST, so an override actually overrides. It sat above these defaults for
      // one commit and `error: null` quietly won, which made two tests about a
      // failed collection pass against a healthy payload.
      ...over,
    },
    Date.parse("2026-09-08T20:05:00.000Z"),
  );
  if (!read.ok) throw new Error(`the fixture did not parse: ${read.why}`);
  return read.state;
}

const NOW = Date.parse("2026-09-08T20:05:00.000Z");

/**
 * The masthead, with the REAL `freshness` rather than a stub.
 *
 * `over` is what the page's own transport would be reporting — a failed refresh,
 * or nothing having arrived for a while — because the Overseer line reads the
 * same freshness the STALE banner does, and a hand-made object with the wrong
 * shape crashes the render for reasons that have nothing to do with these tests.
 */
const header = (
  state: FleetState,
  over: { receivedAt?: number; error?: string | null; failures?: number; now?: number } = {},
): string => {
  const now = over.now ?? NOW;
  const fresh = freshness({
    state,
    receivedAt: over.receivedAt ?? now,
    error: over.error ?? null,
    failures: over.failures ?? 0,
    now,
  });
  draw(<Header state={state} fresh={fresh} onRefresh={() => {}} />);
  return host.textContent ?? "";
};

describe("the header says who the Overseer is", () => {
  it("names the one session that holds the claim", () => {
    const text = header(stateOf([wireRow({ id: "$1", name: "alpha", role: { kind: "overseer" } })]));
    expect(text).toContain("Overseer: alpha");
  });

  it("SAYS SO OUT LOUD when nobody holds it — the state a reboot leaves behind", () => {
    const text = header(stateOf([wireRow({ id: "$1", name: "alpha", role: { kind: "none" } })]));
    expect(text).toContain("no Overseer session");
  });

  it("shouts when two sessions both claim it, rather than picking one", () => {
    const text = header(
      stateOf([
        wireRow({ id: "$1", name: "alpha", role: { kind: "overseer" } }),
        wireRow({ id: "$2", name: "beta", role: { kind: "overseer" } }),
      ]),
    );
    expect(text).toContain("2 sessions claim to be the Overseer");
    expect(text).toContain("alpha");
    expect(text).toContain("beta");
  });

  it("A PAYLOAD FROM BEFORE THE FIRST COLLECTION IS NOT A BOX WITH NO OVERSEER", () => {
    const text = header(stateOf([], { collectedAt: null }));
    expect(text).toContain("Overseer unknown");
    expect(text).not.toContain("no Overseer session");
  });

  it("a row the page had to drop makes the answer uncertain — it could have been the holder's", () => {
    // `parseFleetState` drops a row with no id and counts it. A shorter list
    // must not pass as a complete one. GPT Sol's P0-2.
    const text = header(stateOf([wireRow({ id: "$1", name: "alpha", role: { kind: "none" } }), { name: "?" }]));
    expect(text).toContain("Overseer unknown");
    expect(text).not.toContain("no Overseer session");
  });

  it("A SERVER THAT DOES NOT REPORT ROLES IS NOT A BOX WITH NO OVERSEER", () => {
    // The field was added without a schema bump, so an older dashboard sends no
    // `role` key at all. Reading that as "nobody" would print a confident,
    // plausible, wrong sentence — the exact substitution this page keeps being
    // written to avoid.
    const text = header(stateOf([wireRow({ id: "$1", name: "alpha" })]));
    expect(text).toContain("Overseer unknown");
    expect(text).not.toContain("no Overseer session");
  });

  /* ------------------------------------------------------------------ *
   * The page can be STALE and confident at the same time. It must not be.
   * GPT Sol, second review: the first version of this line read only the row
   * count, so the masthead could say STALE in one breath and `Overseer: alpha`
   * in the next about a session that died an hour ago.
   * ------------------------------------------------------------------ */

  const HOLDER = [{ id: "$1", name: "alpha", role: { kind: "overseer" } }].map((r) =>
    wireRow({ id: r.id, name: r.name, role: r.role }),
  );

  it("names the holder only while the reading describes NOW", () => {
    expect(header(stateOf(HOLDER))).toContain("Overseer: alpha");
  });

  it("A COLLECTION THAT FAILED CANNOT NAME A HOLDER — its rows are the last good ones", () => {
    const text = header(stateOf(HOLDER, { error: "tmux went away" }));
    expect(text).toContain("Overseer unknown");
    expect(text).not.toContain("Overseer: alpha");
  });

  it("nor can a snapshot the page has decided is stale", () => {
    // Ten minutes past the last thing that arrived, against a ~60s cadence.
    const text = header(stateOf(HOLDER), { receivedAt: NOW, now: NOW + 10 * 60_000 });
    expect(text).toContain("Overseer unknown");
    expect(text).not.toContain("Overseer: alpha");
  });

  it("nor can one whose last refresh failed in the browser", () => {
    const text = header(stateOf(HOLDER), { error: null, failures: 3, receivedAt: NOW });
    // `freshness` treats a failed refresh as stale however new the payload is.
    const stale = header(stateOf(HOLDER), { error: "fetch failed", failures: 3, receivedAt: NOW });
    expect(stale).toContain("Overseer unknown");
    // ...and the same page with no failures still names it, so the assertion
    // above is about the failure rather than about the fixture.
    expect(text).toContain("Overseer: alpha");
  });

  it("TWO HOLDERS IN A STALE SNAPSHOT ARE NOT REPORTED AS TWO HOLDERS NOW", () => {
    const both = [
      wireRow({ id: "$1", name: "alpha", role: { kind: "overseer" } }),
      wireRow({ id: "$2", name: "beta", role: { kind: "overseer" } }),
    ];
    expect(header(stateOf(both))).toContain("2 sessions claim to be the Overseer");
    const text = header(stateOf(both, { error: "tmux went away" }));
    expect(text).toContain("Overseer unknown");
    expect(text).not.toContain("2 sessions claim");
  });
});

describe("the row badge", () => {
  /**
   * The panel with everything it does not use stubbed.
   *
   * The card path reads `rows` and `now` and nothing else — the steer, rename,
   * actions, messages and new-session APIs are handed to the DETAIL pane, which
   * is not open here. They are cast rather than built because building five API
   * objects to assert one badge would be testing the harness.
   */
  const panel = (state: FleetState): string => {
    draw(
      <SessionsPanel
        rows={state.rows}
        now={Date.parse("2026-09-08T20:05:00.000Z")}
        collected={true}
        unreadableRows={0}
        answeringEnabled={{ kind: "enabled" }}
        tmuxServerPid={1}
        order="status"
        onOrder={() => {}}
        selectedId={null}
        onSelect={() => {}}
        steer={{} as never}
        rename={{} as never}
        actions={{} as never}
        messages={{} as never}
        newSession={{} as never}
        onRefresh={() => {}}
      />,
    );
    return host.textContent ?? "";
  };

  it("marks the holder", () => {
    expect(panel(stateOf([wireRow({ id: "$1", name: "alpha", role: { kind: "overseer" } })]))).toContain("Overseer");
  });

  it("marks nobody else — including a role this build has never heard of", () => {
    const other: SessionRole = { kind: "other", name: "auditor" };
    const text = panel(stateOf([wireRow({ id: "$1", name: "alpha", role: other })]));
    expect(text).not.toContain("Overseer");
  });
});
