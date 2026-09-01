/**
 * Opening a tab per session, and the guards that stop it opening them anywhere else.
 *
 * Two kinds of failure are worth catching here, and neither of them errors:
 *
 *  - a guard that fails OPEN. `ITERM_SESSION_ID` is inherited, so inside tmux or
 *    across ssh it names a tab that is not in front of you, and the classic
 *    self-check approves everything when the variable is empty. Each refusal
 *    below is asserted by making it refuse, never by watching it allow.
 *  - a script that gets retried when it must not be. A walk over every window
 *    can be aborted mid-flight by a peer closing a tab (-1719), and retrying is
 *    the only cure — but retrying the script that CREATES a tab gives two tabs
 *    for one session. The structural test for that is that the mutating script
 *    contains no enumeration at all.
 *
 * Nothing here talks to iTerm. The AppleScript is asserted as text, which is
 * what makes it testable at all; the live end of it was run by hand against
 * iTerm 3.6.6 — see docs/plans/260901f-gjd-remote-resume-all-opens-every-session-in-its-own-iterm-tab.md.
 */
import { describe, expect, it } from "vitest";
import {
  isSessionUuid,
  newTabScript,
  openTabsRefusal,
  parseHere,
  planTabs,
  resolveScript,
  resumeCommand,
  selectScript,
  selfSessionUuid,
} from "../scripts/gjd-remote-resume-all.js";

const UUID = "486E9CEB-9FBE-420F-8B7E-941FB35360DC";
/** An iTerm tab with nothing in the way. */
const ITERM = { TERM_PROGRAM: "iTerm.app", ITERM_SESSION_ID: `w5t11p0:${UUID}` } as NodeJS.ProcessEnv;

const session = (name: string, attached: boolean, minutesAgo: number) => ({
  name,
  attached,
  created: new Date(Date.now() - minutesAgo * 60_000),
});

describe("selfSessionUuid", () => {
  it("takes the half after the colon, not the w5t11 coordinate", () => {
    // The prefix is frozen when the shell starts and tracks nothing: this one
    // said w5t11 while the tab was window 1, tab 12.
    expect(selfSessionUuid(ITERM)).toBe(UUID);
  });

  it("is undefined rather than empty when the variable is missing or the wrong shape", () => {
    // Undefined, not "": the classic guard `[ "$sid" != "$me" ]` with an empty
    // `me` approves everything, so an empty string is the dangerous answer.
    for (const raw of [undefined, "", "no-colon-here", `w5t11p0:${UUID.slice(0, 20)}`, `:${UUID}`, `w5t11p0:not-a-uuid`]) {
      expect(selfSessionUuid({ ITERM_SESSION_ID: raw } as NodeJS.ProcessEnv)).toBeUndefined();
    }
  });
});

describe("openTabsRefusal", () => {
  it("allows a plain iTerm tab", () => {
    expect(openTabsRefusal(ITERM, true)).toBeUndefined();
  });

  it("refuses where ITERM_SESSION_ID is inherited from somewhere else", () => {
    // Both of these have a perfectly well-formed UUID in the environment. It
    // just belongs to a different terminal, and opening ten tabs in somebody
    // else's window is not a mistake you can take back.
    expect(openTabsRefusal({ ...ITERM, TMUX: "/tmp/tmux-501/default,1,0" }, true)).toMatch(/tmux/);
    expect(openTabsRefusal({ ...ITERM, STY: "1234.pts-0.host" }, true)).toMatch(/tmux|screen/);
    expect(openTabsRefusal({ ...ITERM, SSH_CONNECTION: "1.2.3.4 22" }, true)).toMatch(/ssh/);
    expect(openTabsRefusal({ ...ITERM, SSH_TTY: "/dev/ttys001" }, true)).toMatch(/ssh/);
  });

  it("refuses a terminal that is not iTerm, and no terminal at all", () => {
    expect(openTabsRefusal({ ...ITERM, TERM_PROGRAM: "Apple_Terminal" }, true)).toMatch(/not iTerm/);
    expect(openTabsRefusal({ ...ITERM, TERM_PROGRAM: undefined }, true)).toMatch(/not iTerm/);
    expect(openTabsRefusal(ITERM, false)).toMatch(/not a terminal/);
    expect(openTabsRefusal({ ...ITERM, CI: "true" }, true)).toMatch(/CI/);
  });

  it("refuses when it cannot tell which window is its own", () => {
    // The one condition the colour guard in gjd-remote-tab.ts does not have:
    // painting your own stdout needs no identity, driving iTerm does.
    expect(openTabsRefusal({ TERM_PROGRAM: "iTerm.app" } as NodeJS.ProcessEnv, true)).toMatch(/ITERM_SESSION_ID/);
  });
});

describe("the AppleScript", () => {
  it("carries every value in argv and never in the script text", () => {
    // A `"` in an interpolated value closes the AppleScript literal and the
    // rest of the value runs as AppleScript. The scripts are constants, so
    // there is nothing to interpolate — assert that they really are.
    for (const s of [resolveScript(), newTabScript(), selectScript()]) {
      expect(s).toContain("of argv");
      expect(s).not.toContain(UUID);
    }
  });

  it("never writes the word `tab` where it means a tab character", () => {
    // Inside `tell application "iTerm2"`, `tab` is iTerm's tab CLASS, so
    // `& tab &` concatenates the literal string "tab" and the output reads
    // `456tabD44EB5D5`. `character id 9` is the way to say it.
    expect(resolveScript()).toContain("character id 9");
    expect(resolveScript()).not.toMatch(/& tab &/);
  });

  it("captures the selected tab before creating anything", () => {
    // `create tab` selects the new tab, so a capture afterwards returns the new
    // tab and the restore is a no-op that looks exactly like a working restore.
    // Two files apart is how that is enforced: resolve reads, newTab creates.
    expect(resolveScript()).toContain("current tab of win");
    expect(resolveScript()).not.toContain("create tab");
    expect(newTabScript()).toContain("create tab");
  });

  it("addresses the window by id in the one script that must not be retried", () => {
    // The retryable walks are read-only; this one creates a tab, so a retry
    // would mean two tabs for one session. It must therefore contain no
    // enumeration for a peer's closing tab to invalidate (-1719).
    expect(newTabScript()).toContain("window id winId");
    expect(newTabScript()).not.toContain("repeat with");
  });

  it("filters husk windows out of both walks", () => {
    // A window whose last tab was closed lingers with tabs = 0 and
    // visible = false, and `close` on it does nothing.
    expect(resolveScript()).toContain("if visible of win then");
    expect(selectScript()).toContain("if visible of win then");
  });

  it("types the command into a shell rather than running it as the tab's program", () => {
    // `create tab ... command "…"` would take the tab down with the command,
    // error message and all, and would not start a login shell.
    expect(newTabScript()).toContain("write s text commandText");
    expect(newTabScript()).not.toContain("command commandText");
  });
});

describe("parseHere", () => {
  it("reads the window id and the selected session", () => {
    expect(parseHere(`456\t${UUID}\n`)).toEqual({ windowId: 456, selectedSession: UUID });
  });

  it("rejects anything that is not exactly that, because errors arrive on this channel", () => {
    // osa() folds stderr into stdout so a -1743 permission failure can be
    // reported. A parse that shrugged would hand back a NaN window id and open
    // tabs nowhere.
    for (const out of [
      "",
      "456",
      UUID,
      `456\t${UUID}\textra`,
      `window\t${UUID}`,
      "456\tnot-a-uuid",
      "execution error: Not authorized to send Apple events to iTerm. (-1743)",
    ]) {
      expect(parseHere(out)).toBeUndefined();
    }
  });
});

describe("isSessionUuid", () => {
  it("is what stops an error message being mistaken for a new tab", () => {
    expect(isSessionUuid(UUID)).toBe(true);
    expect(isSessionUuid(UUID.toLowerCase())).toBe(true);
    expect(isSessionUuid("execution error: iTerm got an error: Invalid index. (-1719)")).toBe(false);
    expect(isSessionUuid("")).toBe(false);
  });
});

describe("resumeCommand", () => {
  it("is the command you would have typed", () => {
    expect(resumeCommand("gjd-remote", "fix-the-toc")).toBe("gjd-remote resume fix-the-toc");
    expect(resumeCommand("/Users/greg/bin/gjd-remote", "fix-the-toc", "ssh")).toBe(
      "/Users/greg/bin/gjd-remote resume fix-the-toc --ssh",
    );
  });
});

describe("planTabs", () => {
  it("leaves attached sessions alone, and says why", () => {
    // `resume` runs `tmux attach -d`, which detaches whoever is there. Opening
    // a tab for an attached session would quietly blank the tab you already
    // had it in.
    const plan = planTabs([session("live", true, 10), session("idle", false, 20)], { includeAttached: false });
    expect(plan.open).toEqual(["idle"]);
    expect(plan.skipped).toEqual([{ name: "live", why: expect.stringContaining("already attached") }]);
  });

  it("takes them when asked", () => {
    const plan = planTabs([session("live", true, 10), session("idle", false, 20)], { includeAttached: true });
    expect(plan.open).toEqual(["idle", "live"]);
    expect(plan.skipped).toEqual([]);
  });

  it("orders oldest first, whatever order tmux listed them in", () => {
    const plan = planTabs([session("b", false, 5), session("c", false, 1), session("a", false, 99)], {
      includeAttached: false,
    });
    expect(plan.open).toEqual(["a", "b", "c"]);
  });

  it("opens nothing from nothing", () => {
    expect(planTabs([], { includeAttached: false })).toEqual({ open: [], skipped: [] });
  });
});
