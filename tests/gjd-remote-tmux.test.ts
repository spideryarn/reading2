/**
 * Reading the box's tmux sessions.
 *
 * These exist because of a bug that shipped and nothing caught: `sessions()`
 * asked tmux for its stats with `tmux display -p -t "=$name"`, and `display`
 * takes a target *pane*, so on tmux 3.4 every field came back EMPTY. The parse
 * then turned `""` into `Number("") === 0` — the epoch — and `"" !== "0"` into
 * `attached: true`. Result: `gjd-remote ls` showed `20696d` for every session's
 * age and `ATT yes` for every session, including one created detached a second
 * earlier. Both columns were wrong on every row, for the whole life of the
 * script, and both looked like plausible output.
 *
 * So the rule these tests hold: a line tmux did not fill in is a PARSE FAILURE,
 * never a session at the epoch. See docs/reusable/silent-success.md and
 * docs/plans/260831aa-gjd-remote-ssh-multiplexing-stdin-prompt-tmux-target-colon-fix.md.
 */
import { describe, expect, it } from "vitest";
import { SESSION_FIELDS, buildSessionScript, parseSessionLine, parseSessions } from "../scripts/gjd-remote-tmux.js";

/** What the box really printed on 2026-08-31, tmux 3.4. */
const REAL = [
  "chat-markdown-formatting-and-tools|1788190336|1|1|0|Chat markdown formatting and tools",
  "run-unix-sleep-for-2h|1788192576|0|1|1|",
  "s-0831-1500|1788188475|0|1|1|",
].join("\n");

describe("parseSessionLine", () => {
  it("reads a well-formed line", () => {
    const s = parseSessionLine("fix-the-toc|1788190336|0|2|1|Fix the ToC ordering");
    expect(s).not.toBeNull();
    expect(s?.name).toBe("fix-the-toc");
    expect(s?.created.getTime()).toBe(1788190336 * 1000);
    expect(s?.attached).toBe(false);
    expect(s?.windows).toBe(2);
    expect(s?.provisional).toBe(true);
    expect(s?.title).toBe("Fix the ToC ordering");
  });

  it("counts an attached session as attached", () => {
    expect(parseSessionLine("a|1788190336|1|1|0|")?.attached).toBe(true);
  });

  // THE REGRESSION. This is the exact line the broken format string produced.
  it("refuses a line tmux left empty, rather than dating it to 1970", () => {
    expect(parseSessionLine("s-0831-1554||||0|")).toBeNull();
  });

  it("refuses a line with only some fields missing", () => {
    expect(parseSessionLine("a||0|1|0|")).toBeNull();
    expect(parseSessionLine("a|1788190336||1|0|")).toBeNull();
    expect(parseSessionLine("a|1788190336|0||0|")).toBeNull();
  });

  it("refuses a created stamp that is not a positive integer", () => {
    expect(parseSessionLine("a|0|0|1|0|")).toBeNull();
    expect(parseSessionLine("a|-5|0|1|0|")).toBeNull();
    expect(parseSessionLine("a|not-a-number|0|1|0|")).toBeNull();
  });

  it("refuses a line with no name", () => {
    expect(parseSessionLine("|1788190336|0|1|0|")).toBeNull();
    expect(parseSessionLine("")).toBeNull();
  });

  it("keeps a title containing the separator", () => {
    const s = parseSessionLine("a|1788190336|0|1|0|Rename foo|bar and ship it");
    expect(s?.title).toBe("Rename foo|bar and ship it");
  });

  it("treats a missing title as no title, not as a broken line", () => {
    const s = parseSessionLine("a|1788190336|0|1|1|");
    expect(s?.title).toBe("");
    expect(s?.provisional).toBe(true);
  });
});

describe("parseSessions", () => {
  it("reads what the box actually printed", () => {
    const { sessions, unreadable } = parseSessions(REAL);
    expect(unreadable).toEqual([]);
    expect(sessions.map((s) => s.name)).toEqual([
      "chat-markdown-formatting-and-tools",
      "run-unix-sleep-for-2h",
      "s-0831-1500",
    ]);
    expect(sessions.map((s) => s.attached)).toEqual([true, false, false]);
    expect(sessions.map((s) => s.provisional)).toEqual([false, true, true]);
  });

  it("is empty for no output, which is what a box with no sessions gives", () => {
    expect(parseSessions("")).toEqual({ sessions: [], unreadable: [] });
    expect(parseSessions("\n \n")).toEqual({ sessions: [], unreadable: [] });
  });

  /**
   * FAILS CLOSED. A caller that got `["good"]` back would believe the box has
   * one session — so `new bad` would look like a free name and `resume` would
   * attach to the wrong "most recent". The unreadable line has to come back
   * with the readable ones so the caller can refuse to act.
   */
  it("reports an unparseable line rather than quietly shortening the list", () => {
    const { sessions, unreadable } = parseSessions(["good|1788190336|0|1|0|", "bad||||0|"].join("\n"));
    expect(sessions.map((s) => s.name)).toEqual(["good"]);
    expect(unreadable).toEqual(["bad||||0|"]);
  });
});

describe("buildSessionScript", () => {
  /**
   * The bug was asking for these fields per session with `tmux display -p -t
   * "=$name"`. `display` takes a target *pane*, and the `=` exact-match prefix
   * is only honoured on the session part when a colon follows — so tmux 3.4
   * printed three empty fields and exited 0.
   *
   * `-t "=$name:"` would have fixed it. `tmux ls -F` is better than fixed: it
   * fills every field for every session in ONE command with no target at all,
   * so there is no target left to get wrong. This test holds that shape, not
   * the colon, because the colon is the fix for a design we no longer use.
   */
  const script = buildSessionScript();

  it("gets the stats from a single untargeted listing", () => {
    expect(script).toContain(`tmux ls -F '${SESSION_FIELDS}'`);
  });

  it("never asks display -p for a session's stats again", () => {
    expect(script).not.toContain("display");
  });

  it("names the fields in the order parseSessionLine reads them", () => {
    expect(SESSION_FIELDS).toBe("#{session_name}|#{session_created}|#{session_attached}|#{session_windows}");
  });

  /** `show-environment` really does take a target-session, so the bare `=` is right here. */
  it("still reads the two variables we pinned into the session environment", () => {
    expect(script).toContain('tmux show-environment -t "=$s" CLAUDE_SESSION_ID');
    expect(script).toContain('tmux show-environment -t "=$s" GJD_PROVISIONAL');
  });
});
