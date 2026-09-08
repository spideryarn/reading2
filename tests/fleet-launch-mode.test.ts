/**
 * **A SESSION THAT DID NOT LAUNCH IN AUTO MODE** — `readPaneMode` in
 * tools/fleet/pane.ts, `modeApplicability` in tools/fleet/collect.ts, and
 * `parsePermissionMode` in the client.
 *
 * ## What is being defended, and what it has cost
 *
 * A Claude Code session in default (manual) mode stops at the first command its
 * own settings cannot approve — `git fetch`, `git log`, `npm run
 * worktree:setup`, an MCP read — and waits for a human who is asleep.
 * **34.9 agent-hours since 2026-09-06**, 20% of launches, longest single stall
 * 7.38 hours. `gjd-remote log` reports such a session as `running`, identical to
 * a healthy one. The full measurement is in `PaneAutoMode`'s comment in pane.ts.
 *
 * ## The asymmetry, which is the opposite way round from fleet-pane.test.ts
 *
 * That file is about not inventing a question, because a false question invites
 * a digit into somebody's session. This one is about a **badge on a card**, and
 * the two failure directions are:
 *
 *  - **a false alarm**, which is the expensive one. Twenty rows saying "this
 *    session is broken" when they are fine teaches Greg to ignore the badge,
 *    and then the badge is worth nothing on the day it is right.
 *  - **a missed detection**, which costs a glance at a terminal.
 *
 * So `cannot-tell` is the arm most of this file is about, and the rule earns
 * `not-auto` from a mode name it has actually seen rather than from "it did not
 * say auto".
 *
 * ## Every fixture here is a real capture
 *
 * All of them are already pinned under tests/fixtures/fleet-panes/ and their
 * provenance is stated at the top of tests/fleet-pane.test.ts — captured with
 * `tmux capture-pane -p` and nothing else.
 *
 *  - **auto mode**: `none-working-empty-prompt.txt`,
 *    `none-idle-with-prose-numbered-list.txt`, `none-working-with-lettered-table.txt`,
 *    `none-working-with-prose-decisions-list.txt` — other agents' live sessions.
 *  - **manual mode**: `none-dialog-just-answered.txt`,
 *    `none-slash-command-autocomplete.txt`,
 *    `none-typed-numbered-message-in-input-box.txt` — three captures of one
 *    throwaway session launched without `--permission-mode auto`, which is
 *    exactly the defect.
 *  - **no Claude at all**: `none-bare-shell.txt` (a real shell that printed a
 *    numbered list), `none-blank-pane.txt` (a real empty pane — which is also
 *    what every `gjd-remote` sleep timer and `tmux-job` run looks like; five of
 *    the nineteen live panes at 09:40 on 2026-09-08 were exactly this).
 *  - **a dialog on screen**: the `dialog-*` fixtures, none of which has a
 *    status bar at all, because Claude Code's modal pushes it off the
 *    screenful. That is a measured fact and it has a consequence — see the test
 *    that says so.
 *
 * Where a shape could not be captured it is DERIVED from a named real capture
 * by one stated change, in the test, so the change sits next to the assertion —
 * the convention tests/fleet-pane.test.ts set.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { modeApplicability, readPanes, toRows, type FleetRow } from "../tools/fleet/collect.js";
import { readPaneMode } from "../tools/fleet/pane.js";
import type { FleetStatus } from "../tools/fleet/status.js";
import { parsePermissionMode, parseRow } from "../tools/fleet/web/src/types.js";
import type { Session } from "../scripts/gjd-remote-tmux.js";

function fixture(name: string): string {
  return readFileSync(path.join(process.cwd(), "tests/fixtures/fleet-panes", name), "utf8");
}

/* ------------------------------------------------------ reading the pane -- */

describe("readPaneMode — which permission mode the status bar says", () => {
  /**
   * The healthy shape, on four separate live captures of other agents'
   * sessions. Four rather than one because the tail of the line varies a lot —
   * `(shift+tab to cycle)`, a count of shells, a `gh auth login` hint — and a
   * rule that only worked on the tail it was written against would look right
   * here and fail on the box.
   */
  it("reads auto mode off a live session's status bar", () => {
    for (const name of [
      "none-working-empty-prompt.txt",
      "none-idle-with-prose-numbered-list.txt",
      "none-working-with-lettered-table.txt",
      "none-working-with-prose-decisions-list.txt",
    ]) {
      expect(readPaneMode(fixture(name)), name).toEqual({ kind: "auto" });
    }
  });

  /**
   * **THE DEFECT ITSELF**, on three captures of one real session launched
   * without `--permission-mode auto`. This is the assertion the whole stage is
   * for: something on this box now says out loud that this session will stop at
   * its first unapproved command.
   */
  it("reads manual mode — the defective launch — off a real capture", () => {
    for (const name of [
      "none-dialog-just-answered.txt",
      "none-slash-command-autocomplete.txt",
      "none-typed-numbered-message-in-input-box.txt",
    ]) {
      expect(readPaneMode(fixture(name)), name).toEqual({ kind: "not-auto", mode: "manual mode" });
    }
  });

  /**
   * **THE FALSE POSITIVE THE ANCHOR EXISTS FOR, and it is not hypothetical.**
   *
   * Agents on this box read and write about the dashboard constantly, and the
   * brief for this very feature quotes a status bar verbatim. So a pane can
   * hold the bytes `⏵⏵ auto mode on (shift+tab to cycle) · …` in the middle of a
   * document while the session displaying it is in manual mode — and a
   * substring test would call that session healthy, which is precisely the
   * session we are hunting.
   *
   * Derived from `none-typed-numbered-message-in-input-box.txt` (a real manual-
   * mode capture) by one change: the auto-mode line from
   * `none-working-empty-prompt.txt` (a real auto-mode capture) is spliced into
   * the transcript, thirteen lines above the live status bar. Both halves are
   * real; only the splice is ours.
   */
  it("is not fooled by an auto-mode status bar quoted in the transcript", () => {
    const manual = fixture("none-typed-numbered-message-in-input-box.txt");
    const quoted = fixture("none-working-empty-prompt.txt")
      .split("\n")
      .find((l) => l.includes("auto mode on"));
    expect(quoted).toBeDefined();

    const lines = manual.split("\n");
    const statusBar = lines.findIndex((l) => l.includes("manual mode on"));
    expect(statusBar).toBeGreaterThan(13);
    lines[statusBar - 13] = quoted ?? "";
    const derived = lines.join("\n");

    // The naive rule really would fire on this pane, which is the whole point.
    expect(derived).toContain("auto mode on");
    expect(readPaneMode(derived)).toEqual({ kind: "not-auto", mode: "manual mode" });
  });

  /**
   * The other half of the same guard: a whole status bar quoted ABOVE a live
   * one does not win, because the live one is the lower of the two.
   *
   * Derived from `none-typed-numbered-message-in-input-box.txt` by prepending
   * the two-line status-bar block out of `none-working-empty-prompt.txt`.
   */
  it("takes the lowest status bar, so a quoted block above the live one loses", () => {
    const auto = fixture("none-working-empty-prompt.txt").split("\n");
    const at = auto.findIndex((l) => l.includes("auto mode on"));
    const block = [auto[at - 1] ?? "", auto[at] ?? ""];
    const derived = [...block, ...fixture("none-typed-numbered-message-in-input-box.txt").split("\n")].join("\n");
    expect(readPaneMode(derived)).toEqual({ kind: "not-auto", mode: "manual mode" });
  });

  /**
   * A pane with no status bar on it cannot be reported as either. The shell and
   * the blank pane are here as `cannot-tell` rather than as `not-applicable`
   * because `readPaneMode` reads TEXT — whether a session has a permission mode
   * at all is a fact about what is RUNNING in it, and that is `modeApplicability`'s
   * job below. Nothing ever calls this function on a shell.
   */
  it("says it cannot tell about a pane with no status bar on it", () => {
    for (const name of ["none-bare-shell.txt", "none-blank-pane.txt"]) {
      const read = readPaneMode(fixture(name));
      expect(read.kind, name).toBe("cannot-tell");
      if (read.kind !== "cannot-tell") throw new Error("unreachable");
      expect(read.why).toMatch(/not on this screenful/);
    }
  });

  /**
   * **A BLOCKED SESSION'S MODE IS USUALLY UNREADABLE, AND THAT IS A FINDING
   * RATHER THAN A GAP.** Claude Code's modal takes the whole screenful, so none
   * of the eleven captured dialogs has a status bar under it.
   *
   * The consequence is where the value of this feature actually is: the mode
   * can be read on a session that is `working` or `idle` — before it has hit
   * anything it needs approval for — and not on one that is already stuck. That
   * is the right way round for a check whose promise is *within sixty seconds
   * of the session starting*, and it is why collect.ts reads the pane for the
   * working rows rather than only for the blocked ones.
   */
  it("cannot read the mode while a dialog is up, on every dialog we have captured", () => {
    for (const name of [
      "dialog-bash-permission.txt",
      "dialog-file-write.txt",
      "dialog-edit-diff.txt",
      "dialog-folder-trust.txt",
      "dialog-model-selector.txt",
      "dialog-ask-user-question.txt",
    ]) {
      expect(readPaneMode(fixture(name)).kind, name).toBe("cannot-tell");
    }
  });

  /**
   * A capture that begins mid-redraw: the chrome line is on screen and the mode
   * line under it has not been painted yet.
   *
   * Derived from `none-working-empty-prompt.txt` by deleting one line — the
   * mode line — which is what a capture taken between two frames looks like.
   * The reason has to name the situation, because "cannot tell" with no reason
   * is a shrug and this one is diagnosable.
   */
  it("says it cannot tell, with a reason, when the mode line has not been painted", () => {
    const lines = fixture("none-working-empty-prompt.txt").split("\n");
    const at = lines.findIndex((l) => l.includes("auto mode on"));
    expect(at).toBeGreaterThan(0);
    lines.splice(at, 1);
    const read = readPaneMode(lines.join("\n"));
    expect(read.kind).toBe("cannot-tell");
    if (read.kind !== "cannot-tell") throw new Error("unreachable");
    expect(read.why).toMatch(/mid-redraw/);
  });

  /**
   * **A MODE NAME WE HAVE NEVER SEEN IS `cannot-tell`, NOT `not-auto`.**
   *
   * The tempting rule is "anything that is not `auto mode` is the defect", and
   * it is right about today's two names and wrong the day Claude Code renames
   * one: every session on the box turns red at once, and a badge that has cried
   * wolf on twenty rows is worth nothing on the day it is right.
   *
   * Derived from `none-working-empty-prompt.txt` by renaming the mode in its
   * status bar, which is exactly the change a Claude Code release would make.
   */
  it("refuses to call an unfamiliar mode name a defect", () => {
    const real = fixture("none-working-empty-prompt.txt");
    const derived = real.replace("auto mode on", "supervised mode on");
    expect(derived).not.toBe(real);
    const read = readPaneMode(derived);
    expect(read.kind).toBe("cannot-tell");
    if (read.kind !== "cannot-tell") throw new Error("unreachable");
    expect(read.why).toContain("supervised mode");
  });

  /**
   * `capture-pane -p -e` keeps the escapes, and steer.ts uses that flag. A rule
   * that only worked on the stripped output would be a trap for the next
   * caller — the same one `stripAnsi` exists for.
   */
  it("reads the mode through ANSI escapes", () => {
    const plain = fixture("none-working-empty-prompt.txt");
    const coloured = plain.replace("auto mode on", "[1;32mauto mode on[0m");
    expect(coloured).not.toBe(plain);
    expect(readPaneMode(coloured)).toEqual({ kind: "auto" });
  });
});

/* ------------------------------------------- when the question applies at all -- */

function statused(status: FleetStatus): FleetStatus {
  return status;
}

describe("modeApplicability — which sessions even have a permission mode", () => {
  /**
   * **A SHELL IS NOT A DEFECTIVE LAUNCH.** It has no permission mode at all,
   * and reporting one as `not-auto` would be a false alarm about a session that
   * is working perfectly — the failure that costs this badge its credibility.
   * `waiting` is the `gjd-remote` sleep timer and `no-claude` is a session
   * somebody made by hand; both are the same claim.
   */
  it("settles a shell, a sleep timer and a Claude-less session as not-applicable", () => {
    for (const status of [
      statused({ kind: "shell", busy: null }),
      statused({ kind: "shell", busy: true }),
      statused({ kind: "waiting", secondsLeft: 900 }),
      statused({ kind: "no-claude" }),
    ]) {
      const decided = modeApplicability(status);
      expect(decided.kind, status.kind).toBe("settled");
      if (decided.kind !== "settled") throw new Error("unreachable");
      expect(decided.mode.kind).toBe("not-applicable");
    }
  });

  /**
   * The three statuses that mean an interactive Claude is drawing that pane.
   * `needs-you` is included even though a dialog usually hides the status bar,
   * because the capture is being taken for that row anyway.
   */
  it("reads the pane for every interactive Claude, working and idle included", () => {
    for (const status of [
      statused({ kind: "needs-you" }),
      statused({ kind: "working" }),
      statused({ kind: "idle" }),
    ]) {
      expect(modeApplicability(status).kind, status.kind).toBe("read-the-pane");
    }
  });

  /**
   * **`unknown` IS `cannot-tell`, NOT `not-applicable`.** The box could not say
   * what is running, so claiming the session has no permission mode would be a
   * claim nobody made — and one failed `claude agents --json` call turns EVERY
   * Claude row unknown at once (status.ts says so at length), so the alternative
   * would silently declare the whole fleet exempt.
   */
  it("says it cannot tell about a session the box could not describe", () => {
    const decided = modeApplicability({ kind: "unknown", why: "claude: command not found", cause: "agents-unavailable" });
    expect(decided.kind).toBe("settled");
    if (decided.kind !== "settled") throw new Error("unreachable");
    expect(decided.mode.kind).toBe("cannot-tell");
  });
});

/* ------------------------------------------------- carrying it on the row -- */

function session(over: Partial<Session> & { id: string }): Session {
  return {
    name: over.id,
    title: "",
    created: new Date("2026-09-08T09:00:00Z"),
    attached: false,
    windows: 1,
    provisional: false,
    claudeId: null,
    proc: null,
    meta: { version: "legacy" },
    ...over,
  } as Session;
}

describe("the row carries the mode", () => {
  /**
   * `toRows` settles the arms it can settle without touching tmux, so a shell
   * never shows a shrug even on a snapshot built without the capture pass —
   * `snapshotFrom` is used by the JSON round-trip test and by anything that
   * rebuilds a snapshot from a parse.
   */
  it("settles a shell's row without capturing anything", () => {
    const rows = toRows([session({ id: "$1" })], new Map([["$1", { kind: "shell", busy: null } as FleetStatus]]));
    expect(rows[0]?.permissionMode.kind).toBe("not-applicable");
  });

  /**
   * **The safe default before anything has been read.** A row whose pane has
   * not been captured yet must not read as healthy; `cannot-tell` is the arm
   * that says nothing either way.
   */
  it("starts an interactive Claude's row at cannot-tell, not at auto", () => {
    const rows = toRows([session({ id: "$1" })], new Map([["$1", { kind: "working" } as FleetStatus]]));
    expect(rows[0]?.permissionMode.kind).toBe("cannot-tell");
  });

  /**
   * **THE PASS THAT ACTUALLY POPULATES IT.** Injected capture, so this runs
   * without tmux — the seam steer.ts already uses.
   *
   * The three rows are the three outcomes in one call: a working session in
   * manual mode is found, a working session in auto mode is cleared, and a
   * shell is not captured at all. The last is asserted on the CAPTURE LOG
   * rather than on the answer, because "we decided not to ask" and "we asked
   * and it said nothing" produce the same field and only one of them is what
   * the cost argument in collect.ts claims.
   */
  it("reads the mode off the pane for the interactive rows, and asks nothing of a shell", () => {
    const asked: string[] = [];
    const rows = toRows(
      [session({ id: "$1" }), session({ id: "$2" }), session({ id: "$3" })],
      new Map<string, FleetStatus>([
        ["$1", { kind: "working" }],
        ["$2", { kind: "idle" }],
        ["$3", { kind: "shell", busy: null }],
      ]),
      new Map([
        ["$1", { paneId: "%11", panePid: 1 }],
        ["$2", { paneId: "%22", panePid: 2 }],
        ["$3", { paneId: "%33", panePid: 3 }],
      ]),
    );
    readPanes(rows, (paneId) => {
      asked.push(paneId);
      return fixture(paneId === "%11" ? "none-typed-numbered-message-in-input-box.txt" : "none-working-empty-prompt.txt");
    });
    expect(asked).toEqual(["%11", "%22"]);
    expect(rows[0]?.permissionMode).toEqual({ kind: "not-auto", mode: "manual mode" });
    expect(rows[1]?.permissionMode).toEqual({ kind: "auto" });
    expect(rows[2]?.permissionMode.kind).toBe("not-applicable");
  });

  /**
   * **ONE CAPTURE ANSWERS BOTH QUESTIONS.** A blocked row's pane was already
   * being read for its dialog; taking a second `capture-pane` of the same pane
   * in the same pass would be a second read of a screen that may have changed
   * between them, which is worse than it is expensive — the two facts on the
   * card would then be about two different frames.
   */
  it("takes one capture per pane, and the blocked row still gets its question", () => {
    const asked: string[] = [];
    const rows = toRows(
      [session({ id: "$1" })],
      new Map<string, FleetStatus>([["$1", { kind: "needs-you" }]]),
      new Map([["$1", { paneId: "%11", panePid: 1 }]]),
    );
    readPanes(rows, (paneId) => {
      asked.push(paneId);
      return fixture("dialog-bash-permission.txt");
    });
    expect(asked).toEqual(["%11"]);
    expect(rows[0]?.question?.kind).toBe("question");
    // A dialog covers the status bar, so this is the honest answer for it.
    expect(rows[0]?.permissionMode.kind).toBe("cannot-tell");
  });

  /** A capture that throws leaves both facts unread rather than inventing either. */
  it("leaves the mode unread when the pane cannot be captured", () => {
    const rows = toRows(
      [session({ id: "$1" })],
      new Map<string, FleetStatus>([["$1", { kind: "working" }]]),
      new Map([["$1", { paneId: "%11", panePid: 1 }]]),
    );
    readPanes(rows, () => {
      throw new Error("no such pane");
    });
    expect(rows[0]?.permissionMode.kind).toBe("cannot-tell");
    expect(rows[0]?.question).toBeNull();
  });

  /** A row tmux gave no pane cannot be read either, and says so. */
  it("says it cannot tell about a row with no pane handle", () => {
    const rows = toRows([session({ id: "$1" })], new Map<string, FleetStatus>([["$1", { kind: "working" }]]));
    readPanes(rows, () => {
      throw new Error("should not be called");
    });
    expect(rows[0]?.permissionMode.kind).toBe("cannot-tell");
  });

  /** It has to survive `JSON.stringify`, which is how the server serves it. */
  it("survives the round trip the server puts it through", () => {
    const rows = toRows([session({ id: "$1" })], new Map<string, FleetStatus>([["$1", { kind: "working" }]]));
    const first = rows[0] as FleetRow;
    first.permissionMode = { kind: "not-auto", mode: "manual mode" };
    const back = JSON.parse(JSON.stringify(rows)) as FleetRow[];
    expect(back[0]?.permissionMode).toEqual({ kind: "not-auto", mode: "manual mode" });
  });
});

/* -------------------------------------------------------- off the wire -- */

describe("parsePermissionMode — the client, failing towards the safe arm", () => {
  /**
   * **THE SAFE ARM IS `cannot-tell`, AND IT IS NOT `not-auto`.** A server older
   * than this field sends nothing; if that parsed as the defect, every session
   * on the page would light up on the first deploy where the client is ahead of
   * the server. That is the false alarm this whole design is calibrated against,
   * and it would arrive on all forty rows at once.
   *
   * It is not `auto` either, for the mirror reason: an absent field must not
   * clear a session this build never heard from.
   */
  it("makes an absent, null or malformed field cannot-tell", () => {
    for (const v of [undefined, null, "auto", 7, [], { kind: null }]) {
      const read = parsePermissionMode(v);
      expect(read.kind, JSON.stringify(v ?? null)).toBe("cannot-tell");
    }
  });

  it("makes an arm this build has never heard of cannot-tell, and names it", () => {
    const read = parsePermissionMode({ kind: "bypass" });
    expect(read.kind).toBe("cannot-tell");
    if (read.kind !== "cannot-tell") throw new Error("unreachable");
    expect(read.why).toContain("bypass");
  });

  it("reads the two arms the server sends", () => {
    expect(parsePermissionMode({ kind: "auto" })).toEqual({ kind: "auto" });
    expect(parsePermissionMode({ kind: "not-auto", mode: "manual mode" })).toEqual({
      kind: "not-auto",
      mode: "manual mode",
    });
  });

  /**
   * `not-auto` without a mode name is still `not-auto` — the defect is the
   * fact, not the label — but it must not render a blank. A generic name is
   * supplied rather than dropping the arm.
   */
  it("keeps not-auto when the server sent no mode name", () => {
    const read = parsePermissionMode({ kind: "not-auto" });
    expect(read.kind).toBe("not-auto");
    if (read.kind !== "not-auto") throw new Error("unreachable");
    expect(read.mode).not.toBe("");
  });

  it("carries the reason on the two arms that have one", () => {
    expect(parsePermissionMode({ kind: "cannot-tell", why: "mid-redraw" })).toEqual({
      kind: "cannot-tell",
      why: "mid-redraw",
    });
    expect(parsePermissionMode({ kind: "not-applicable", why: "a shell" })).toEqual({
      kind: "not-applicable",
      why: "a shell",
    });
  });

  /** And `parseRow` has to actually read it, rather than the field existing unused. */
  it("is read off the row, not defaulted", () => {
    const row = parseRow({ id: "$1", permissionMode: { kind: "not-auto", mode: "manual mode" } });
    expect(row?.permissionMode).toEqual({ kind: "not-auto", mode: "manual mode" });
    expect(parseRow({ id: "$1" })?.permissionMode.kind).toBe("cannot-tell");
  });
});
