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
      ...over,
      collectedAt: "collectedAt" in over ? over["collectedAt"] : "2026-09-08T20:05:00.000Z",
      attemptedAt: "2026-09-08T20:05:00.000Z",
      servedAt: "2026-09-08T20:05:00.000Z",
      tmuxServerPid: 1,
      tookMs: 10,
      error: null,
      health: null,
      refreshMs: 60_000,
      answeringEnabled: true,
      attention: { kind: "not-asked" },
    },
    Date.parse("2026-09-08T20:05:00.000Z"),
  );
  if (!read.ok) throw new Error(`the fixture did not parse: ${read.why}`);
  return read.state;
}

const NOW = Date.parse("2026-09-08T20:05:00.000Z");

const header = (state: FleetState): string => {
  // The real `freshness`, not a stub: the masthead's age tooltip is built from
  // it, and a hand-made object with the wrong shape crashes the render in a way
  // that has nothing to do with what these tests are about.
  const fresh = freshness({ state, receivedAt: NOW, error: null, failures: 0, now: NOW });
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
