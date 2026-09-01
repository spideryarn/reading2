/**
 * `--wait` and `ssh <command>`: the two places where what you typed becomes
 * something that runs on the box.
 *
 * Both exist because of the same failure. `gjd-remote ssh 'free -g'` ignored
 * its positionals, opened a login shell, printed the MOTD and exited 0 — a
 * command that was never run, reported as a command that succeeded. `--wait`
 * is the same hazard pointed the other way: a duration that is misread is a
 * session that starts three orders of magnitude too early or too late, and
 * nothing about the output says which.
 *
 * See docs/reusable/silent-success.md and docs/project/hetzner-remote-server-box.md.
 */
import { describe, expect, it } from "vitest";
import { MAX_WAIT_SECONDS, parseDuration, sshInvocation, waitPreamble } from "../scripts/gjd-remote-run.js";

/** The seconds, or the reason it was refused — so a table can assert either. */
const seconds = (raw: string) => {
  const d = parseDuration(raw);
  return d.ok ? d.seconds : `refused: ${d.why}`;
};

describe("parseDuration", () => {
  it("takes all four units", () => {
    expect(seconds("45s")).toBe(45);
    expect(seconds("15m")).toBe(900);
    expect(seconds("2h")).toBe(7200);
    expect(seconds("1d")).toBe(86400);
  });

  it("takes a fraction that lands on a whole second", () => {
    expect(seconds("1.5h")).toBe(5400);
    expect(seconds("0.5m")).toBe(30);
  });

  it("trims and lower-cases, because a shell hands over what was typed", () => {
    expect(seconds(" 2H ")).toBe(7200);
    expect(seconds("30S")).toBe(30);
  });

  // The whole reason a unit is mandatory: 2 seconds and 2 hours are both
  // plausible readings of `--wait 2`, and the only way to find out which one
  // was guessed is to watch whether the session starts now or after lunch.
  it("refuses a bare number, and says what to type instead", () => {
    const d = parseDuration("2");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.why).toContain("2s, 2m, 2h or 2d");
  });

  it("refuses anything that is not a duration", () => {
    for (const bad of ["", "   ", "h", "2 h", "2hh", "2h30m", "-5m", "two hours", "1e3s", "2w", "NaNs"]) {
      expect(parseDuration(bad).ok, bad).toBe(false);
    }
  });

  // Silently rounding 0.5s to 1s would be a wait that does not match its own
  // label. Refusing it costs nobody anything: whole seconds are all a `sleep`
  // in this job can honestly promise.
  it("refuses a fraction of a second rather than rounding it", () => {
    const d = parseDuration("0.5s");
    expect(d.ok).toBe(false);
    if (!d.ok) expect(d.why).toContain("whole number of seconds");
  });

  it("refuses zero, and anything longer than the box's life", () => {
    expect(parseDuration("0s").ok).toBe(false);
    expect(parseDuration("0h").ok).toBe(false);
    expect(seconds("30d")).toBe(MAX_WAIT_SECONDS);
    expect(parseDuration("31d").ok).toBe(false);
    expect(parseDuration("999d").ok).toBe(false);
  });

  it("keeps the label the person typed, normalised", () => {
    const d = parseDuration(" 2H ");
    expect(d.ok && d.label).toBe("2h");
  });
});

describe("waitPreamble", () => {
  it("sleeps for exactly the seconds it was given, and says so first", () => {
    const p = waitPreamble(7200, "2h");
    expect(p).toContain("sleep 7200");
    expect(p).toContain("waiting 2h before starting Claude");
    // The order is the point: nothing may run before the announcement, or an
    // attached pane shows a blank screen for two hours.
    expect(p.indexOf("waiting 2h")).toBeLessThan(p.indexOf("sleep 7200"));
  });

  it("survives a box whose date cannot do -d", () => {
    // The fallback is not decoration. Without it the pane prints "until " with
    // nothing after it, which reads as a broken clock rather than a shell
    // without GNU date.
    const p = waitPreamble(60, "1m");
    expect(p).toContain("|| at=''");
    expect(p).toContain('${at:+ — until $at}');
  });

  it("says the wait is over, so an attached pane can tell sleeping from wedged", () => {
    expect(waitPreamble(60, "1m")).toContain("the wait is over");
  });

  // This is the guard that stands between a duration label and a shell script.
  // Every one of these strings would otherwise close the single quotes it is
  // interpolated into.
  it("refuses a label that is not a duration", () => {
    for (const bad of ["2h'; rm -rf ~; '", "2h; echo hi", "$(id)", "`id`", "2 h", "", "2y", "hello"]) {
      expect(() => waitPreamble(60, bad), bad).toThrow(/duration label/);
    }
  });

  it("refuses a length it was told to parse and did not", () => {
    expect(() => waitPreamble(0, "0s")).toThrow();
    expect(() => waitPreamble(-60, "1m")).toThrow();
    expect(() => waitPreamble(1.5, "1.5s")).toThrow();
    expect(() => waitPreamble(MAX_WAIT_SECONDS + 1, "31d")).toThrow();
  });
});

describe("sshInvocation", () => {
  const host = "greg@1.2.3.4";
  const sshOpts = ["-o", "ConnectTimeout=10"];

  // The bug this whole function exists for: the command used to be dropped and
  // the exit code said it had run.
  it("puts the command last, where ssh runs it", () => {
    const { args, interactive } = sshInvocation({ host, sshOpts, words: ["free -g"] });
    expect(args.at(-1)).toBe("free -g");
    expect(args.at(-2)).toBe(host);
    expect(interactive).toBe(false);
  });

  it("allocates a pty for a shell and not for a command", () => {
    expect(sshInvocation({ host, sshOpts, words: [] }).args).toContain("-t");
    // No pty for a command, so `gjd-remote ssh 'tmux ls' | grep …` pipes like
    // anything else, and no escape sequences land in the middle of the output.
    expect(sshInvocation({ host, sshOpts, words: ["tmux ls"] }).args).not.toContain("-t");
  });

  it("joins words the way ssh does", () => {
    const { args } = sshInvocation({ host, sshOpts, words: ["echo", "one", "two"] });
    expect(args.at(-1)).toBe("echo one two");
  });

  it("keeps the ssh options, wherever the command goes", () => {
    for (const words of [[], ["uptime"]]) {
      const { args } = sshInvocation({ host, sshOpts, words });
      expect(args).toEqual(expect.arrayContaining(sshOpts));
      expect(args).toContain(host);
    }
  });

  // `gjd-remote ssh ''` asked for a command and gave none. Opening an
  // interactive shell instead would be the old bug wearing a new hat: what you
  // asked for did not happen, and nothing said so.
  it("refuses an empty command rather than falling back to a shell", () => {
    expect(() => sshInvocation({ host, sshOpts, words: [""] })).toThrow(/no command/);
    expect(() => sshInvocation({ host, sshOpts, words: ["  "] })).toThrow(/no command/);
  });

  it("passes the command through untouched, quotes and all", () => {
    const nasty = `printf '%s\\n' "a b" $HOME \`id -u\``;
    expect(sshInvocation({ host, sshOpts, words: [nasty] }).args.at(-1)).toBe(nasty);
  });
});
