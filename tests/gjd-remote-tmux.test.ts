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
import {
  SESSION_FIELDS,
  SESSION_SENTINEL,
  bindingsVerdict,
  buildBindingsScript,
  buildSessionScript,
  parseSessionLine,
  parseSessions,
} from "../scripts/gjd-remote-tmux.js";

/** Encode a name or title the way the remote script does. */
const b64 = (t: string) => Buffer.from(t, "utf8").toString("base64");

/** One well-formed record. */
const row = (o: Partial<{ sid: string; created: string; att: string; win: string; prov: string; name: string; title: string }> = {}) =>
  [
    o.sid ?? "$4",
    o.created ?? "1788190336",
    o.att ?? "0",
    o.win ?? "1",
    o.prov ?? "0",
    b64(o.name ?? "fix-the-toc"),
    b64(o.title ?? "Fix the ToC ordering"),
  ].join("|");

/** What the box really printed on 2026-08-31, tmux 3.4, verbatim. */
const REAL = [
  "$11|1788191420|1|1|0|YmFjay10by10ZXh0LW5hdmlnYXRpb24=|QmFjayB0byB0ZXh0IG5hdmlnYXRpb24=",
  "$4|1788190336|1|1|0|Y2hhdC1tYXJrZG93bi1mb3JtYXR0aW5nLWFuZC10b29scw==|Q2hhdCBtYXJrZG93biBmb3JtYXR0aW5nIGFuZCB0b29scw==",
  "$36|1788194293|0|2|1|ZGF0YWJhc2UtbW92ZS1jb21wbGV0aW9u|",
  "GJDOK",
].join("\n");

describe("parseSessionLine", () => {
  it("reads a well-formed record", () => {
    const s = parseSessionLine(row({ win: "2", prov: "1" }));
    expect(s).not.toBeNull();
    expect(s?.name).toBe("fix-the-toc");
    expect(s?.created.getTime()).toBe(1788190336 * 1000);
    expect(s?.attached).toBe(false);
    expect(s?.windows).toBe(2);
    expect(s?.provisional).toBe(true);
    expect(s?.title).toBe("Fix the ToC ordering");
  });

  it("counts an attached session as attached", () => {
    expect(parseSessionLine(row({ att: "1" }))?.attached).toBe(true);
  });

  /**
   * THE FIRST REGRESSION. `tmux display -p -t "=name"` — no colon — printed
   * three empty fields and exited 0 on tmux 3.4, and the old parse coerced
   * them: `Number("")` is 0, so every session was dated to the epoch, and
   * `"" !== "0"` is true, so every session read as attached.
   */
  it("refuses a record tmux left empty, rather than dating it to 1970", () => {
    expect(parseSessionLine("$4|||||" + "|")).toBeNull();
    expect(parseSessionLine(row({ created: "" }))).toBeNull();
    expect(parseSessionLine(row({ att: "" }))).toBeNull();
    expect(parseSessionLine(row({ win: "" }))).toBeNull();
  });

  it("refuses a created stamp that is not a positive integer", () => {
    for (const created of ["0", "-5", "not-a-number", "17e9", "1788190336.5"]) {
      expect(parseSessionLine(row({ created })), created).toBeNull();
    }
  });

  /**
   * THE SECOND REGRESSION, found by GPT Sol reviewing the first fix. The parse
   * was strict about the fields tmux fills in and still took a FOUR-field line,
   * and anything in the provisional slot that was not "1" quietly became
   * `false` — the flag that decides whether `ls` may rename a session out from
   * under whoever named it.
   */
  it("refuses a record with the wrong number of fields", () => {
    expect(parseSessionLine("$4|1788190336|0|1")).toBeNull();
    expect(parseSessionLine(`${row()}|extra`)).toBeNull();
    expect(parseSessionLine("")).toBeNull();
  });

  it("refuses junk in the provisional slot instead of reading it as settled", () => {
    for (const prov of ["", "garbage", "2", "true"]) {
      expect(parseSessionLine(row({ prov })), prov).toBeNull();
    }
  });

  it("refuses anything that is not a tmux session id in the first field", () => {
    for (const sid of ["", "4", "$", "$4x", "name"]) {
      expect(parseSessionLine(row({ sid })), sid).toBeNull();
    }
  });

  it("refuses a name or title that is not valid base64", () => {
    expect(parseSessionLine(`$4|1788190336|0|1|0|not base64!|${b64("t")}`)).toBeNull();
    expect(parseSessionLine(`$4|1788190336|0|1|0|${b64("n")}|not base64!`)).toBeNull();
  });

  /**
   * The reason both free-text fields travel base64: a `|` in either would
   * otherwise shift every field after it. tmux permits it in a session name,
   * and the record must survive one rather than mis-splitting.
   */
  it("keeps a name or title containing the field separator", () => {
    const s = parseSessionLine(row({ name: "weird|name", title: "Rename foo|bar and ship it" }));
    expect(s?.name).toBe("weird|name");
    expect(s?.title).toBe("Rename foo|bar and ship it");
  });

  it("treats a missing title as no title, not as a broken record", () => {
    const s = parseSessionLine(row({ title: "" }));
    expect(s?.title).toBe("");
    expect(s?.name).toBe("fix-the-toc");
  });

  it("refuses a record with no name", () => {
    expect(parseSessionLine(row({ name: "" }))).toBeNull();
  });
});

describe("parseSessions", () => {
  it("reads what the box actually printed", () => {
    const { sessions, unreadable, failure } = parseSessions(REAL);
    expect(failure).toBeNull();
    expect(unreadable).toEqual([]);
    expect(sessions.map((s) => s.name)).toEqual([
      "back-to-text-navigation",
      "chat-markdown-formatting-and-tools",
      "database-move-completion",
    ]);
    expect(sessions.map((s) => s.attached)).toEqual([true, true, false]);
    expect(sessions.map((s) => s.provisional)).toEqual([false, false, true]);
    expect(sessions[2]?.title).toBe("");
  });

  it("is empty, and not a failure, for a box with no sessions", () => {
    expect(parseSessions(SESSION_SENTINEL)).toEqual({ sessions: [], unreadable: [], failure: null });
  });

  /**
   * THE THIRD REGRESSION, also Sol's. `tmux ls | while read` exits 0 with no
   * output when tmux is missing or broken — byte-for-byte what an idle box
   * looks like — and every caller reads that emptiness as an answer: `ls` says
   * "no sessions", `new` decides the name is free, `resume` finds nothing to
   * attach to. Confirmed on the box by running the script with tmux off the
   * PATH. So the script signs off, and a reply with no signature is a failure.
   */
  it("refuses a reply with no completion marker", () => {
    const { failure } = parseSessions(row());
    expect(failure).toMatch(/completion marker/);
  });

  it("refuses an empty reply, which is what a broken tmux looks like", () => {
    expect(parseSessions("").failure).not.toBeNull();
  });

  it("passes the box's own explanation through", () => {
    const { failure } = parseSessions("GJDERR tmux is not on this box");
    expect(failure).toBe("tmux is not on this box");
  });

  /**
   * FAILS CLOSED. A caller handed only the readable sessions would believe the
   * box has fewer than it does — so `new` would find a taken name free, and
   * `resume` would attach to the wrong "most recent".
   */
  it("reports an unreadable record rather than quietly shortening the list", () => {
    const { sessions, unreadable, failure } = parseSessions([row(), "$9|||||" + "|", SESSION_SENTINEL].join("\n"));
    expect(failure).toBeNull();
    expect(sessions.map((s) => s.name)).toEqual(["fix-the-toc"]);
    expect(unreadable).toEqual(["$9||||||"]);
  });
});

describe("buildSessionScript", () => {
  const script = buildSessionScript();

  /**
   * The original bug was asking for the stats per session with `tmux display -p
   * -t "=$name"`. `display` takes a target *pane*, and the `=` exact-match
   * prefix is only honoured on the session part when a colon follows — so tmux
   * 3.4 printed three empty fields and exited 0.
   *
   * `-t "=$name:"` would have fixed it. `tmux ls -F` is better than fixed: one
   * command, no target at all, nothing left to get wrong. This test holds that
   * shape rather than the colon, because the colon fixes a design we no longer
   * use — and it holds it for the WHOLE script, since reaching for `display`
   * again to fetch one more field is exactly how this would come back.
   */
  it("never asks display for anything", () => {
    expect(script).not.toContain("display");
  });

  it("gets everything tmux knows from a single untargeted listing", () => {
    expect(script).toContain(`tmux ls -F '${SESSION_FIELDS}'`);
  });

  it("puts the session id first and the free-text name last", () => {
    expect(SESSION_FIELDS.split("|")[0]).toBe("#{session_id}");
    expect(SESSION_FIELDS.split("|").at(-1)).toBe("#{session_name}");
  });

  it("signs off, so an empty reply cannot pass for an empty box", () => {
    expect(script.trimEnd().endsWith(`echo ${SESSION_SENTINEL}`)).toBe(true);
  });

  it("refuses to guess when tmux is not there", () => {
    expect(script).toContain("command -v tmux");
    expect(script).toContain("GJDERR");
  });

  /** tmux's own "no server running" is the one genuine empty case. */
  it("still treats a stopped tmux server as an empty box", () => {
    expect(script).toContain("no server running");
  });

  it("encodes both free-text fields so no session name can shift the record", () => {
    expect(script).toContain('"$(printf \'%s\' "$name" | base64 -w0)"');
    expect(script).toContain('"$(printf \'%s\' "$title" | base64 -w0)"');
  });

  /** show-environment takes a target-session, and a session id is unambiguous there. */
  it("reads the two variables we pinned into the session environment, by id", () => {
    expect(script).toContain('tmux show-environment -t "$sid" CLAUDE_SESSION_ID');
    expect(script).toContain('tmux show-environment -t "$sid" GJD_PROVISIONAL');
  });
});

/**
 * Counting what tmux binds.
 *
 * The rule the box now holds is that tmux binds NOTHING — no prefix, no keys —
 * so every keystroke reaches Claude Code. See
 * docs/project/remote-box.md § tmux keeps sessions alive and does nothing else.
 *
 * The trap these tests are built around: a tmux server reads ~/.tmux.conf once,
 * when it starts, and the box's server outlives provisioning by weeks. So the
 * FILE being right and the KEYBOARD being right are two different facts, and
 * the gap between them is invisible — provisioning goes green, `Ctrl-B` is
 * still eaten. That is why there are two numbers rather than one.
 */
describe("buildBindingsScript", () => {
  const script = buildBindingsScript();

  it("signs off, so an empty reply cannot pass for a clean box", () => {
    expect(script.trimEnd().endsWith(`echo ${SESSION_SENTINEL}`)).toBe(true);
  });

  it("refuses to guess when tmux is not there", () => {
    expect(script).toContain("command -v tmux");
    expect(script).toContain("GJDERR");
  });

  /**
   * The load-bearing one. `tmux list-keys` with no server running prints to
   * stderr and nothing to stdout, so a bare `grep -c` answers 0 — the same byte
   * a perfectly configured box gives. `tmux ls` has to gate it so "nothing to
   * ask" can say so.
   */
  it("asks whether a server is running before counting its bindings", () => {
    expect(script).toContain("if tmux ls >/dev/null 2>&1; then");
    expect(script).toContain("live=none");
  });

  it("counts the file on a throwaway socket, not the box's real one", () => {
    expect(script).toContain('tmux -f "$HOME/.tmux.conf" -L "$sock"');
    expect(script).toContain("sock=gjddoctor$$");
  });

  it("cleans up the probe server whether or not it counted", () => {
    expect(script.match(/tmux -L "\$sock" kill-server/g)?.length).toBe(2);
  });
});

describe("bindingsVerdict", () => {
  const ok = (body: string) => [body, SESSION_SENTINEL].join("\n");

  it("passes when the file and the running server both bind nothing", () => {
    const v = bindingsVerdict(ok("live=0 conf=0"));
    expect(v.ok).toBe(true);
    expect(v.why).toContain("file and server agree");
  });

  it("passes when there is no server to ask, and says so", () => {
    const v = bindingsVerdict(ok("live=none conf=0"));
    expect(v.ok).toBe(true);
    expect(v.why).toContain("no server running");
  });

  /**
   * The case this check exists for: provisioning rewrote the file, the running
   * server never re-read it, and nothing else on the box looks wrong.
   */
  it("fails when the file is right but the running server has not re-read it", () => {
    const v = bindingsVerdict(ok("live=260 conf=0"));
    expect(v.ok).toBe(false);
    expect(v.why).toContain("source-file");
    // Not "re-provision" — provisioning rewrites the file, which is already right.
    expect(v.why).not.toContain("re-provision");
  });

  it("fails on the file, and points at provisioning rather than at source-file", () => {
    const v = bindingsVerdict(ok("live=0 conf=260"));
    expect(v.ok).toBe(false);
    expect(v.why).toContain("re-provision");
  });

  /** The file is what every future server on this box reads, so it is named first. */
  it("names the file when both are wrong", () => {
    const v = bindingsVerdict(ok("live=260 conf=260"));
    expect(v.ok).toBe(false);
    expect(v.why).toContain(".tmux.conf");
  });

  it("fails closed on a reply that never finished", () => {
    const v = bindingsVerdict("live=0 conf=0");
    expect(v.ok).toBe(false);
    expect(v.why).toContain("did not finish");
  });

  it("fails closed on a reply it cannot parse", () => {
    const v = bindingsVerdict(ok("live= conf="));
    expect(v.ok).toBe(false);
    expect(v.why).toContain("could not read");
  });

  it("passes the box's own error through rather than inventing a verdict", () => {
    const v = bindingsVerdict(`GJDERR tmux is not on this box\n${SESSION_SENTINEL}`);
    expect(v.ok).toBe(false);
    expect(v.why).toBe("tmux is not on this box");
  });

  /** An empty reply is the shape every other bug in this file wore. */
  it("fails closed on silence", () => {
    expect(bindingsVerdict("").ok).toBe(false);
  });
});
