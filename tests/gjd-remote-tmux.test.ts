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
  AGENTS_FAIL,
  AGENTS_OK,
  META,
  ROW_COUNT,
  SESSION_FIELDS,
  SESSION_SENTINEL,
  type Session,
  type SessionState,
  type SessionUnknownCause,
  bindingsVerdict,
  buildBindingsScript,
  buildSessionScript,
  formatWait,
  parseAgents,
  parseSessionLine,
  escapeName,
  parseSessions,
  printableName,
  resolveSession,
  sessionRepo,
  sessionState,
} from "../scripts/gjd-remote-tmux.js";

/** Encode a name or title the way the remote script does. */
const b64 = (t: string) => Buffer.from(t, "utf8").toString("base64");

/** A reply the way the script builds one: the control lines, the rows, the sign-off. */
const reply = (rows: string[], control: string[] = []) =>
  [...control, `${ROW_COUNT} ${rows.length}`, ...rows, SESSION_SENTINEL].join("\n");

/** A uuid of the shape `claude --session-id` mints. */
const UUID = "3c67234f-2da6-4208-8473-9b5ee58be82a";

/** One well-formed record. */
const row = (
  o: Partial<{
    sid: string;
    created: string;
    att: string;
    win: string;
    prov: string;
    id: string;
    proc: string;
    name: string;
    title: string;
    /** The four metadata fields. `dir` is given in the clear and encoded here,
     *  the way the remote script encodes it. */
    v: string;
    kind: string;
    repo: string;
    dir: string;
  }> = {},
) =>
  [
    o.sid ?? "$4",
    o.created ?? "1788190336",
    o.att ?? "0",
    o.win ?? "1",
    o.prov ?? "0",
    o.id ?? UUID,
    o.proc ?? "claude",
    b64(o.name ?? "fix-the-toc"),
    b64(o.title ?? "Fix the ToC ordering"),
    o.v ?? "1",
    o.kind ?? "claude",
    o.repo ?? "gregdetre/reading2",
    b64(o.dir ?? "/home/greg/code/spideryarn2"),
  ].join("|");

/**
 * The session a well-formed line makes, or null.
 *
 * `parseSessionLine` tells two failures apart — a line that is not a record at
 * all, and a record whose metadata contradicts itself — and most of the tests
 * below are about the first, where "null" is the whole of what they want to
 * say.
 */
const parsed = (line: string): Session | null => {
  const r = parseSessionLine(line);
  return r.ok ? r.session : null;
};

/**
 * What the box really printed on 2026-09-01, tmux 3.4, claude 2.1.251, verbatim
 * but for the agents blob, which is trimmed to the three sessions below.
 *
 * Three states in one reply, and they are the three worth having: a session
 * Claude Code calls `waiting` — parked on a permission prompt nobody has
 * answered — one it calls `busy`, and one that is not in the agents list at all
 * because `--wait` has it asleep with 13,335 seconds still to run.
 */
const AGENTS_JSON = JSON.stringify([
  { pid: 3645673, cwd: "/home/greg/code/spideryarn2", kind: "interactive", startedAt: 1788259262000, sessionId: "49348111-df07-44ac-a204-f2e168f46de5", name: "spideryarn2-d0", status: "waiting" },
  { pid: 400660, cwd: "/home/greg/code/spideryarn2", kind: "interactive", startedAt: 1788194296011, sessionId: "3c67234f-2da6-4208-8473-9b5ee58be82a", name: "spideryarn2-60", status: "busy" },
  { pid: 2732791, cwd: "/home/greg/code/spideryarn2", kind: "interactive", startedAt: 1788246895000, sessionId: "70852e00-cc1b-4218-9106-4f7b17eb6e34", name: "spideryarn2-76", status: "idle" },
]);

const REAL = reply(
  [
    "$36|1788194293|1|1|0|3c67234f-2da6-4208-8473-9b5ee58be82a|claude|ZGF0YWJhc2UtbW92ZS1jb21wbGV0aW9u|RGF0YWJhc2UgbW92ZSBjb21wbGV0aW9u||||",
    "$81|1788259262|1|1|0|49348111-df07-44ac-a204-f2e168f46de5|claude|Z2pkLXJlbW90ZS1scy1zdGF0dXMtaW5kaWNhdG9ycw==|Z2pkLXJlbW90ZSBscyBzdGF0dXMgaW5kaWNhdG9ycw==||||",
    "$78|1788259066|0|1|1|7d9a25bf-ef51-425f-9ec5-65ada264eb4c|wait:13335|cnVuLWdpdC1jb21taXQtY2hhbmdlcy1tZC10aGVuLXB1bGw=|||||",
    "$77|1788246895|1|1|0|70852e00-cc1b-4218-9106-4f7b17eb6e34|claude|d29ya3RyZWVzLW1pZ3JhdGlvbi1oaXN0b3J5|V29ya3RyZWVzIG1pZ3JhdGlvbiBoaXN0b3J5||||",
  ],
  [`${AGENTS_OK} ${Buffer.from(AGENTS_JSON, "utf8").toString("base64")}`],
);

describe("parseSessionLine", () => {
  it("reads a well-formed record", () => {
    const s = parsed(row({ win: "2", prov: "1" }));
    expect(s).not.toBeNull();
    expect(s?.name).toBe("fix-the-toc");
    expect(s?.created.getTime()).toBe(1788190336 * 1000);
    expect(s?.attached).toBe(false);
    expect(s?.windows).toBe(2);
    expect(s?.provisional).toBe(true);
    expect(s?.title).toBe("Fix the ToC ordering");
  });

  /**
   * The id used to be validated and thrown away. It is now the ONLY thing
   * `kill`, `resume` and `attach` address a session by, so losing it here would
   * take every one of them out — see `Session.id`.
   */
  it("keeps tmux's session id, which is what every command addresses", () => {
    expect(parsed(row({ sid: "$81" }))?.id).toBe("$81");
  });

  it("counts an attached session as attached", () => {
    expect(parsed(row({ att: "1" }))?.attached).toBe(true);
  });

  /**
   * THE FIRST REGRESSION. `tmux display -p -t "=name"` — no colon — printed
   * three empty fields and exited 0 on tmux 3.4, and the old parse coerced
   * them: `Number("")` is 0, so every session was dated to the epoch, and
   * `"" !== "0"` is true, so every session read as attached.
   */
  it("refuses a record tmux left empty, rather than dating it to 1970", () => {
    expect(parsed("$4||||||||")).toBeNull();
    expect(parsed(row({ created: "" }))).toBeNull();
    expect(parsed(row({ att: "" }))).toBeNull();
    expect(parsed(row({ win: "" }))).toBeNull();
  });

  it("refuses a created stamp that is not a positive integer", () => {
    for (const created of ["0", "-5", "not-a-number", "17e9", "1788190336.5"]) {
      expect(parsed(row({ created })), created).toBeNull();
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
    expect(parsed("$4|1788190336|0|1")).toBeNull();
    expect(parsed(`${row()}|extra`)).toBeNull();
    expect(parsed("")).toBeNull();
  });

  it("refuses junk in the provisional slot instead of reading it as settled", () => {
    for (const prov of ["", "garbage", "2", "true"]) {
      expect(parsed(row({ prov })), prov).toBeNull();
    }
  });

  it("refuses anything that is not a tmux session id in the first field", () => {
    for (const sid of ["", "4", "$", "$4x", "name"]) {
      expect(parsed(row({ sid })), sid).toBeNull();
    }
  });

  it("refuses a name or title that is not valid base64", () => {
    const meta = `1|claude|gregdetre/reading2|${b64("/home/greg/code/spideryarn2")}`;
    expect(parsed(`$4|1788190336|0|1|0|${UUID}|claude|not base64!|${b64("t")}|${meta}`)).toBeNull();
    expect(parsed(`$4|1788190336|0|1|0|${UUID}|claude|${b64("n")}|not base64!|${meta}`)).toBeNull();
  });

  /**
   * The reason both free-text fields travel base64: a `|` in either would
   * otherwise shift every field after it. tmux permits it in a session name,
   * and the record must survive one rather than mis-splitting.
   */
  it("keeps a name or title containing the field separator", () => {
    const s = parsed(row({ name: "weird|name", title: "Rename foo|bar and ship it" }));
    expect(s?.name).toBe("weird|name");
    expect(s?.title).toBe("Rename foo|bar and ship it");
  });

  it("treats a missing title as no title, not as a broken record", () => {
    const s = parsed(row({ title: "" }));
    expect(s?.title).toBe("");
    expect(s?.name).toBe("fix-the-toc");
  });

  it("refuses a record with no name", () => {
    expect(parsed(row({ name: "" }))).toBeNull();
  });

  /**
   * Empty means what it says: `new-shell` makes sessions with no Claude in them.
   *
   * A mangled id is KEPT, and that is the point of the test. Everything else in
   * the record comes from tmux; this comes from a tmux environment variable
   * anybody can set by hand, and rejecting the line would put it in
   * `unreadable` — which `sessions()` treats as fatal, so one mistyped variable
   * on one session would take `ls`, `new-claude` and `resume` down for the whole
   * box. `sessionState` reports that row as unknown instead.
   */
  it("takes an empty claude id as no Claude, and keeps a mangled one rather than losing the row", () => {
    expect(parsed(row({ id: "" }))?.claudeId).toBeNull();
    expect(parsed(row({ id: UUID }))?.claudeId).toBe(UUID);
    for (const id of [UUID.slice(0, 20), UUID.toUpperCase(), `${UUID}x`, "not-a-uuid"]) {
      expect(parsed(row({ id })), id).not.toBeNull();
    }
  });

  /** A `|` in it is a different matter: it shifts the record, and the field
   *  count catches it — the same guard every other field relies on. */
  it("still refuses an id carrying the field separator", () => {
    expect(parsed(row({ id: "a|b" }))).toBeNull();
  });

  /**
   * The process probe has four shapes and no fifth. A token this reader was not
   * written against decides whether a row is reported as scheduled, running or
   * gone, so rounding an unrecognised one to `none` would be a row claiming "no
   * claude" about a session with a Claude in it.
   */
  it("reads the process probe, and refuses a token it was not written for", () => {
    expect(parsed(row({ proc: "claude" }))?.proc).toEqual({ kind: "claude" });
    expect(parsed(row({ proc: "none" }))?.proc).toEqual({ kind: "none" });
    expect(parsed(row({ proc: "?" }))?.proc).toEqual({ kind: "unknown" });
    expect(parsed(row({ proc: "wait:13335" }))?.proc).toEqual({ kind: "wait", secondsLeft: 13335 });
    // 0 and negatives never leave the box — the script drops them — so seeing
    // one means the record did not come from the script this was written for.
    for (const proc of ["", "wait", "wait:", "wait:0", "wait:-1", "wait:1.5", "wait:2h", "sleeping", "CLAUDE"]) {
      expect(parsed(row({ proc })), proc).toBeNull();
    }
  });

  /**
   * `/^[1-9]\d*$/` accepts four hundred digits, `Number` makes that `Infinity`,
   * and `new Date(Infinity)` is an Invalid Date that the AGE column renders as
   * `NaNm`. Sol's point, and the same shape as every other bug in this file: a
   * plausible-looking column that is not a number.
   */
  it("refuses a number too big to be a number", () => {
    expect(parsed(row({ created: "9".repeat(400) }))).toBeNull();
    expect(parsed(row({ win: "9".repeat(400) }))).toBeNull();
    expect(parsed(row({ proc: `wait:${"9".repeat(400)}` }))).toBeNull();
  });
});

/**
 * What Claude Code says about its own sessions.
 *
 * `claude agents --json` is first-party and documented as being for scripting,
 * but the array is still somebody else's, so every field is checked. The rule
 * these tests hold: a record we cannot read is skipped, and a status we do not
 * recognise is kept as-is so it can be reported as unknown rather than rounded
 * to the nearest state we do know.
 */
describe("parseAgents", () => {
  const agent = (o: Record<string, unknown>) => ({
    pid: 400660,
    cwd: "/home/greg/code/spideryarn2",
    kind: "interactive",
    startedAt: 1788194296011,
    sessionId: UUID,
    name: "spideryarn2-60",
    status: "busy",
    ...o,
  });

  it("reads what the box actually printed", () => {
    const m = parseAgents(AGENTS_JSON);
    expect(m?.size).toBe(3);
    expect(m?.get("49348111-df07-44ac-a204-f2e168f46de5")).toBe("waiting");
    expect(m?.get("3c67234f-2da6-4208-8473-9b5ee58be82a")).toBe("busy");
    expect(m?.get("70852e00-cc1b-4218-9106-4f7b17eb6e34")).toBe("idle");
  });

  it("is a failure, not an empty list, when the reply is not JSON", () => {
    expect(parseAgents("")).toBeNull();
    expect(parseAgents("not json at all")).toBeNull();
  });

  /** `claude agents` without `--json` prints a table. A table is not an array. */
  it("is a failure when the JSON is not the array we asked for", () => {
    expect(parseAgents('{"sessions":[]}')).toBeNull();
    expect(parseAgents('"a string"')).toBeNull();
    expect(parseAgents("null")).toBeNull();
  });

  it("is an empty map, and not a failure, when nothing is running", () => {
    expect(parseAgents("[]")).toEqual(new Map());
  });

  /**
   * ONE BAD RECORD FAILS THE WHOLE REPLY, and this is the test Sol's review
   * turned around. The first version skipped them, which looks careful and is
   * the opposite: rename `sessionId` to `session_id` in some later Claude Code
   * and every record is skipped, leaving a perfectly healthy EMPTY MAP — which
   * means "no Claude is running anywhere", a confident wrong answer on every row
   * at once. A short list of statuses is indistinguishable from a correct one.
   */
  it("fails the whole reply on a record it cannot read, rather than dropping it", () => {
    expect(parseAgents(JSON.stringify([agent({ sessionId: "spideryarn2-60" })]))).toBeNull();
    expect(parseAgents(JSON.stringify([agent({ sessionId: undefined })]))).toBeNull();
    expect(parseAgents(JSON.stringify([agent({}), agent({ sessionId: undefined })]))).toBeNull();
    expect(parseAgents(JSON.stringify(["not an object"]))).toBeNull();
  });

  /** The whole-reply rule again: schema drift renaming `status` must not read
   *  as a box where nothing is running. */
  it("fails the whole reply on a record with no status, rather than inventing one", () => {
    expect(parseAgents(JSON.stringify([agent({ status: undefined })]))).toBeNull();
    expect(parseAgents(JSON.stringify([agent({ status: "" })]))).toBeNull();
    expect(parseAgents(JSON.stringify([agent({ status: 3 })]))).toBeNull();
  });

  /** Claude Code contradicting itself about one session. Picking the last is
   *  picking at random, on a row that decides whether somebody is being waited on. */
  it("fails on a duplicate session id rather than letting the last one win", () => {
    expect(parseAgents(JSON.stringify([agent({ status: "busy" }), agent({ status: "idle" })]))).toBeNull();
  });

  /**
   * A status this version has never seen is carried through unchanged, because
   * `sessionState` has to be able to tell "Claude Code said something new" from
   * "Claude Code said nothing". Rounding it to `idle` would report a session as
   * finished while it waits for somebody.
   */
  it("keeps a status it does not recognise, so it can be reported as unknown", () => {
    expect(parseAgents(JSON.stringify([agent({ status: "compacting" })]))?.get(UUID)).toBe("compacting");
  });
});

/**
 * The states `gjd-remote ls` puts on screen.
 *
 * The order of the clauses is the design, and each of these tests is a pair of
 * states that would otherwise be told apart wrongly. See the doc comment on
 * `sessionState`.
 */
describe("sessionState", () => {
  const session = (o: Partial<Session> = {}): Session => ({
    id: "$7",
    name: "fix-the-toc",
    created: new Date(1788190336000),
    attached: false,
    windows: 1,
    title: "Fix the ToC ordering",
    provisional: false,
    claudeId: UUID,
    proc: { kind: "claude" },
    meta: { version: 1, kind: "claude", repo: "gregdetre/reading2", dir: "/home/greg/code/spideryarn2" },
    ...o,
  });
  const agents = (status: string) => new Map([[UUID, status]]);

  it("calls a session with no Claude in it a shell", () => {
    // Before anything else: a `new-shell` was never going to be in the agents
    // list, and running it through the rest would report it as a dead Claude.
    expect(sessionState(session({ claudeId: null }), null).kind).toBe("shell");
    expect(sessionState(session({ claudeId: null }), new Map()).kind).toBe("shell");
  });

  /**
   * WHAT THE EIGHT GHOST SESSIONS NEEDED. On 2026-09-05 `gjd-remote ls` showed
   * eight rows reading `shell`, and Greg could not tell which were husks. Seven
   * were running `npm test` for other agents; one had been an abandoned prompt
   * for fifteen hours. A bare `shell` said the same about both.
   */
  it("says whether anything is running in a shell", () => {
    const shell = (proc: Session["proc"]) => sessionState(session({ claudeId: null, proc }), new Map());
    expect(shell({ kind: "busy" })).toEqual({ kind: "shell", busy: true });
    expect(shell({ kind: "none" })).toEqual({ kind: "shell", busy: false });
  });

  /**
   * `null`, never `false`. "Nothing is running in it" and "the box could not be
   * asked" are the same emptiness, and the whole file exists because that
   * emptiness keeps getting read as an answer.
   */
  it("admits it does not know, rather than calling an unprobed shell idle", () => {
    const state = sessionState(session({ claudeId: null, proc: { kind: "unknown" } }), new Map());
    expect(state).toEqual({ kind: "shell", busy: null });
  });

  it("says unknown for a hand-set CLAUDE_SESSION_ID, rather than calling it a shell", () => {
    const st = sessionState(session({ claudeId: "not-a-uuid" }), new Map());
    expect(st.kind).toBe("unknown");
    expect(st.kind === "unknown" && st.why).toMatch(/not a Claude session id/);
  });

  it("says unknown rather than guessing when the box could not be asked", () => {
    const s = sessionState(session(), null);
    expect(s.kind).toBe("unknown");
    expect(s.kind === "unknown" && s.why).toMatch(/could not say/);
  });

  it("reads Claude Code's three statuses", () => {
    expect(sessionState(session(), agents("waiting")).kind).toBe("needs-you");
    expect(sessionState(session(), agents("busy")).kind).toBe("working");
    expect(sessionState(session(), agents("idle")).kind).toBe("idle");
  });

  /**
   * The wrong half of this coin flip is a session reported as finished while it
   * sits waiting for a person — which is the exact failure the column was added
   * to prevent.
   */
  it("says unknown for a status a later Claude Code invented", () => {
    const s = sessionState(session(), agents("compacting"));
    expect(s.kind).toBe("unknown");
    expect(s.kind === "unknown" && s.why).toContain("compacting");
  });

  /**
   * `--wait`. The live sleep is the evidence, and it is the only evidence
   * accepted: a session with no Claude and no sleep is not "about to start".
   */
  it("counts down a --wait that has not finished yet", () => {
    const s = sessionState(session({ proc: { kind: "wait", secondsLeft: 13335 } }), new Map());
    expect(s).toEqual({ kind: "waiting", secondsLeft: 13335 });
  });

  /**
   * `--wait` is read BEFORE the agents list, so a countdown still shows on a box
   * where `claude agents` is missing or broken. It is safe to put it first
   * because the evidence is our own job script still running with a live sleep
   * under it, and a Claude cannot be in the same pane at the same time.
   */
  it("counts down a --wait even when the box could not say what Claude is doing", () => {
    const s = sessionState(session({ proc: { kind: "wait", secondsLeft: 900 } }), null);
    expect(s).toEqual({ kind: "waiting", secondsLeft: 900 });
  });

  /**
   * THE MEASURED CASE, and the reason this function takes a process probe at
   * all. On 2026-09-01, twice, a session started with `--dir ~` had a live
   * `claude --session-id <uuid>` for 35 seconds and `claude agents --json`
   * matched it zero times. So absent-from-the-list is not the same as
   * not-running, and calling it `no claude` would be a confident lie about a
   * session that is working.
   */
  it("does not report a running-but-unlisted Claude as gone", () => {
    const st = sessionState(session({ proc: { kind: "claude" } }), new Map());
    expect(st.kind).toBe("unknown");
    expect(st.kind === "unknown" && st.why).toMatch(/did not list it/);
  });

  it("does not report a probe it could not run as an empty session either", () => {
    const st = sessionState(session({ proc: { kind: "unknown" } }), new Map());
    expect(st.kind).toBe("unknown");
    expect(st.kind === "unknown" && st.why).toMatch(/could not look/);
  });

  it("says no-claude only when the box looked and found nothing", () => {
    expect(sessionState(session({ proc: { kind: "none" } }), new Map()).kind).toBe("no-claude");
  });

  /**
   * `cause` is the half of `unknown` that a MACHINE reads, and it exists
   * because the other half cannot be read that way.
   *
   * Something watching the box compares one collection with the next to decide
   * whether anything happened. `why` is written for a person: it gets reworded,
   * and one of the five interpolates a string that changes between calls. Diff
   * those and a session flaps between states it never left. So what is pinned
   * here is not the sentences — those are free to change — but that each fault
   * has an identifier, that no two faults share one, and that the identifier
   * does not move when the wording does.
   */
  describe("cause: the identifier a watcher may diff, where why is only for reading", () => {
    const unknownOf = (state: SessionState) => {
      if (state.kind !== "unknown") throw new Error(`expected unknown, got ${state.kind}`);
      return state;
    };

    /**
     * One session per unknown clause, in the order `sessionState` reaches them.
     *
     * The `Record` is the point of the annotation: a new cause added to the
     * union stops this file compiling until somebody either produces a session
     * that reaches it or says in the `Exclude` why no session can. **A new
     * fault cannot arrive untested and cannot arrive un-argued.** It has
     * already fired once for real: `client-declared` was added and this file
     * refused to compile until it appeared below.
     *
     * Two are excluded, and both because nothing `sessionState` does can reach
     * them — they are stamped by code that never observed the box at all:
     *
     *  - `no-status-derived` — tools/fleet/collect.ts's admission of a bug of
     *    ours, and tested there.
     *  - `client-declared` — tools/fleet/routes-steer.ts, parsing a status a
     *    browser asserted in a request body, and tested there.
     *
     * NOTE that vitest does not typecheck, so this guard cannot go red at
     * `npm test`. It fires at `npm run typecheck`, and only there.
     */
    const every = (): Record<
      Exclude<SessionUnknownCause, "no-status-derived" | "client-declared">,
      Extract<SessionState, { kind: "unknown" }>
    > => ({
      "not-a-session-id": unknownOf(sessionState(session({ claudeId: "not-a-uuid" }), new Map())),
      "agents-unavailable": unknownOf(sessionState(session(), null)),
      "unrecognised-agent-status": unknownOf(sessionState(session(), agents("compacting"))),
      "running-but-unlisted": unknownOf(sessionState(session({ proc: { kind: "claude" } }), new Map())),
      "process-probe-unavailable": unknownOf(sessionState(session({ proc: { kind: "unknown" } }), new Map())),
    });

    it("names the fault at each of the five clauses that can reach unknown", () => {
      for (const [expected, state] of Object.entries(every())) {
        expect(state.cause).toBe(expected);
      }
    });

    /**
     * THE ONE THAT MATTERS. Two clauses sharing a cause is not a compile error
     * and not a visible bug — the page still reads correctly, because the page
     * reads `why`. It only shows up as a watcher that cannot tell "the box is
     * broken" from "this session's id is nonsense", which is the distinction
     * every comment in this area is about.
     */
    it("gives no two of them the same identifier", () => {
      const causes = Object.values(every()).map((s) => s.cause);
      expect(new Set(causes).size).toBe(causes.length);
    });

    it("does not move when the wording does", () => {
      // The interpolating clause, and the reason prose is unusable as a key: a
      // box reporting two statuses this version has never heard of has ONE
      // problem, and two different sentences about it.
      const a = unknownOf(sessionState(session(), agents("compacting")));
      const b = unknownOf(sessionState(session(), agents("rewinding")));
      expect(a.why).not.toBe(b.why);
      expect(a.cause).toBe(b.cause);
    });

    /**
     * ...AND THE TOKEN IS NOT THROWN AWAY, which is the other half of the same
     * argument and was added for the Overseer's S2 (GPT Sol's S1-1).
     *
     * The cause says WHICH FAULT this is and must not move when the box reports
     * two unfamiliar statuses in turn — the test above. But a watcher keyed on
     * the cause alone then sees one unchanging session while the source moved
     * twice, and `compacting` followed by `waiting-for-input` is a real
     * transition that would be permanently lost. The rule the cause obeys was
     * about OUR wording; this is the box's own observation, and it changes only
     * when the box says something different.
     */
    it("keeps the status token the box actually reported, beside the cause", () => {
      const a = unknownOf(sessionState(session(), agents("compacting")));
      const b = unknownOf(sessionState(session(), agents("rewinding")));
      expect(a.reportedStatus).toBe("compacting");
      expect(b.reportedStatus).toBe("rewinding");
    });

    it("sets it at that one clause and nowhere else", () => {
      // Optional on purpose: every other construction site describes a fault it
      // has no token for, and a required field would be a sixth thing for each
      // of them to invent an answer to.
      expect(unknownOf(sessionState(session(), null)).reportedStatus).toBeUndefined();
      expect(unknownOf(sessionState(session({ claudeId: "not-a-uuid" }), new Map())).reportedStatus).toBeUndefined();
    });
  });
});

describe("formatWait", () => {
  it("reads at a glance", () => {
    expect(formatWait(0)).toBe("0s");
    expect(formatWait(45)).toBe("45s");
    expect(formatWait(59)).toBe("59s");
    expect(formatWait(60)).toBe("1m");
    expect(formatWait(3599)).toBe("59m");
    expect(formatWait(3600)).toBe("1h");
    expect(formatWait(13335)).toBe("3h42m");
    expect(formatWait(86399)).toBe("23h59m");
    expect(formatWait(86400)).toBe("1d");
    expect(formatWait(100000)).toBe("1d3h");
  });

  /** A wait whose deadline has just passed must not print a minus sign. */
  it("does not go backwards", () => {
    expect(formatWait(-5)).toBe("0s");
  });
});

describe("parseSessions", () => {
  it("reads what the box actually printed", () => {
    const { sessions, unreadable, failure, agents, agentsWhy } = parseSessions(REAL);
    expect(failure).toBeNull();
    expect(unreadable).toEqual([]);
    expect(agentsWhy).toBeNull();
    expect(sessions.map((s) => s.name)).toEqual([
      "database-move-completion",
      "gjd-remote-ls-status-indicators",
      "run-git-commit-changes-md-then-pull",
      "worktrees-migration-history",
    ]);
    expect(sessions.map((s) => s.attached)).toEqual([true, true, false, true]);
    expect(sessions.map((s) => s.provisional)).toEqual([false, false, true, false]);
    expect(sessions[2]?.title).toBe("");
    expect(sessions[2]?.proc).toEqual({ kind: "wait", secondsLeft: 13335 });
    expect(agents?.get("49348111-df07-44ac-a204-f2e168f46de5")).toBe("waiting");
  });

  /**
   * The end-to-end claim, against one real reply: these four rows really were
   * in those four states on the box, checked against the panes by hand before
   * this fixture was taken. `gjd-remote-ls-status-indicators` was sitting on a
   * question with six options and going nowhere until somebody answered it,
   * which is the row this whole column exists to surface.
   */
  it("turns that reply into the four states a person cares about", () => {
    const { sessions, agents } = parseSessions(REAL);
    expect(sessions.map((s) => sessionState(s, agents))).toEqual([
      { kind: "working" },
      { kind: "needs-you" },
      { kind: "waiting", secondsLeft: 13335 },
      { kind: "idle" },
    ]);
  });

  /**
   * The `GJDAGENTS` line is not a session record, and counting it as an
   * unreadable one would be fatal: `sessions()` refuses to hand back a list it
   * knows is short, so every `ls`, `new-claude` and `resume` would die on a
   * perfectly healthy box.
   */
  it("does not mistake its own agents line for a broken session record", () => {
    const { unreadable, sessions } = parseSessions(REAL);
    expect(unreadable).toEqual([]);
    expect(sessions).toHaveLength(4);
  });

  /**
   * FAILS CLOSED, and this is the one that matters most here. An agents reply
   * that never arrived leaves every session looking like one with no Claude in
   * it — a full screen of confident, plausible, wrong rows. Verified against
   * the box on 2026-09-01 by putting a `claude` on the PATH that prints
   * nothing: nine live sessions, all nine reported `unknown`.
   */
  it("will not guess at a state when the box could not say what Claude is doing", () => {
    const out = reply([row()], [`${AGENTS_FAIL} claude agents --json printed nothing`]);
    const { sessions, agents, agentsWhy, unreadable, failure } = parseSessions(out);
    expect(failure).toBeNull();
    expect(unreadable).toEqual([]);
    expect(agents).toBeNull();
    expect(agentsWhy).toContain("printed nothing");
    expect(sessions[0] && sessionState(sessions[0], agents).kind).toBe("unknown");
  });

  it("treats an agents blob it cannot read as a failure, not as an empty list", () => {
    const { agents, agentsWhy } = parseSessions(reply([row()], [`${AGENTS_OK} not-base64!`]));
    expect(agents).toBeNull();
    expect(agentsWhy).toContain("could not read");
  });

  it("treats valid base64 that is not the JSON we asked for as a failure too", () => {
    const out = reply([row()], [`${AGENTS_OK} ${Buffer.from('{"not":"an array"}', "utf8").toString("base64")}`]);
    expect(parseSessions(out).agents).toBeNull();
  });

  /**
   * An empty agents list is a real answer — a box with tmux sessions and no
   * Claude in any of them — and it must not read as a failure, or `ls` would
   * warn on every perfectly healthy quiet box.
   */
  it("keeps an empty agents list distinct from a missing one", () => {
    const out = reply([row({ proc: "none" })], [`${AGENTS_OK} ${Buffer.from("[]", "utf8").toString("base64")}`]);
    const { agents, agentsWhy, sessions } = parseSessions(out);
    expect(agents).toEqual(new Map());
    expect(agentsWhy).toBeNull();
    expect(sessions[0] && sessionState(sessions[0], agents).kind).toBe("no-claude");
  });

  it("is empty, and not a failure, for a box with no sessions", () => {
    const r = parseSessions(reply([], [`${AGENTS_OK} ${Buffer.from("[]", "utf8").toString("base64")}`]));
    expect(r).toEqual({ sessions: [], unreadable: [], failure: null, agents: new Map(), agentsWhy: null });
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

  /**
   * A reply that signs off and then keeps talking is a reply something else got
   * into. Taking the lines before the signature and ignoring the rest is
   * reading half of a message that has already gone wrong. Sol's point.
   */
  /**
   * THE BUG THIS COUNT EXISTS FOR, and it had been in `ls` since it was written.
   * `rows=$(tmux ls …)` strips the trailing newline; the loop was fed
   * `printf '%s' "$rows"`; `read` returns false on an unterminated final line,
   * so its body never ran for the LAST session. Ten sessions on the box, nine on
   * screen, every time, in alphabetical order. Nothing looked wrong — a list of
   * nine sessions is exactly what a box with nine sessions prints. Found by GPT
   * Sol on 2026-09-01 and reproduced on the box the same minute.
   *
   * The printf is fixed. This holds the whole CLASS shut: tmux says how many
   * rows it had, and a listing that does not match it is a failure rather than a
   * shorter list.
   */
  it("refuses a listing shorter than the one tmux says it sent", () => {
    const short = [`${ROW_COUNT} 2`, row(), SESSION_SENTINEL].join("\n");
    const { failure, sessions } = parseSessions(short);
    expect(failure).toMatch(/tmux listed 2 session\(s\) and 1 reached this laptop/);
    expect(sessions).toEqual([]);
  });

  /** Counts the unreadable ones too — they arrived, they just could not be read,
   *  and conflating the two failures would make each one hide the other. */
  it("counts a row it could not read towards the total", () => {
    const { failure } = parseSessions([`${ROW_COUNT} 2`, row(), "$9||||||||", SESSION_SENTINEL].join("\n"));
    expect(failure).toBeNull();
  });

  it("refuses a reply with no row count, or with two of them", () => {
    expect(parseSessions([row(), SESSION_SENTINEL].join("\n")).failure).toMatch(/0 row counts/);
    expect(parseSessions([`${ROW_COUNT} 1`, `${ROW_COUNT} 1`, row(), SESSION_SENTINEL].join("\n")).failure).toMatch(
      /2 row counts/,
    );
  });

  /** Two answers to one question is a reply something has been interleaved
   *  with, and picking one is picking at random. */
  it("refuses a box that answered twice about what Claude is doing", () => {
    const out = reply([row()], [`${AGENTS_OK} W10=`, `${AGENTS_FAIL} nope`]);
    expect(parseSessions(out).failure).toMatch(/answered twice/);
  });

  it("refuses a reply that carries on after signing off", () => {
    const { failure } = parseSessions(`${reply([row()])}\nand then some`);
    expect(failure).toMatch(/after it had finished/);
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
    const { sessions, unreadable, failure } = parseSessions(reply([row(), "$9||||||||"]));
    expect(failure).toBeNull();
    expect(sessions.map((s) => s.name)).toEqual(["fix-the-toc"]);
    expect(unreadable).toEqual(["$9||||||||"]);
  });
});

describe("buildSessionScript", () => {
  // `ls`'s version, which is the only one with the agents block in it.
  const script = buildSessionScript({ agents: true });

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

  /**
   * NOT `#{pane_pid}`, and this test is the memory of why. That field is the
   * active pane of the session's CURRENT window, so a Claude in a second window
   * or a split was invisible — and an invisible Claude that is also absent from
   * `claude agents --json` reads as a session with no Claude in it. GPT Sol
   * found it; `tests/gjd-remote-tmux-script.test.ts` runs the case.
   */
  it("asks for every pane, not the one that happens to be on screen", () => {
    expect(SESSION_FIELDS).not.toContain("#{pane_pid}");
    expect(script).toContain("tmux list-panes -a -F '#{session_id} #{pane_pid}'");
    expect(script.match(/tmux ls -F/g)?.length).toBe(1);
  });

  /**
   * ONE snapshot, and its exit status checked. `ps --ppid <pid>` exits 1 for
   * "no children" — the ordinary case — so a per-session call had to throw its
   * status away, and a `ps` that failed for any other reason then looked exactly
   * like a pane with nothing under it.
   */
  it("takes one process snapshot and checks that it worked", () => {
    expect(script.match(/ps -eo/g)?.length).toBe(1);
    expect(script).toContain('snap=$(ps -eo pid=,ppid=,etimes=,args= 2>/dev/null) && [ -n "$snap" ] || snap=');
    expect(script).not.toContain("--ppid");
  });

  it("reads the remaining wait off the sleep itself", () => {
    // Elapsed subtracted from the sleep's own argument, and a non-positive
    // remainder dropped — a wait that is over is not a wait.
    expect(script).toContain('r = w[2] - E[q]; if (r > 0)');
  });

  /** A token awk did not mean to print must not become a state. */
  it("refuses to pass on a probe result it does not recognise", () => {
    expect(script).toContain("case \"$proc\" in claude|none|busy|wait:[1-9]*) ;; *) proc='?' ;; esac");
  });

  /**
   * A sleep is only a `--wait` if one of OUR job scripts is the thing sleeping.
   * Once Claude exits the job `exec`s a login shell, and somebody typing
   * `sleep 900` into it would otherwise be reported as a scheduled job that had
   * never started.
   */
  it("only calls a sleep a wait when our own job script is the one running", () => {
    expect(script).toContain('index(A[P[q]], "/gjd-remote/jobs/")');
  });

  /**
   * Matched on THIS session's uuid, so a neighbouring session's Claude cannot
   * answer for this one, and as a fixed string so an id somebody hand-set
   * cannot be a regex.
   *
   * **`==` was not enough for that, and this docstring used to say it was.**
   * awk compares two values NUMERICALLY when both look like numbers, and `-v`
   * and `split()` produce exactly those, so `01` and `1` were the same session
   * id. The concatenated `""` is what makes it the string comparison the
   * sentence above always claimed — GPT Sol, round 2, 2026-09-08.
   *
   * It used to be `index(A[q], "--session-id " id)` — a substring search over
   * the flattened `ps` line, with no `argv[0]` check, no stop at a bare `--`,
   * and no way to match `--session-id=<id>`. What the probe actually does with
   * a command line now lives in `claudeForSession`, and the behaviour is held
   * by running the script in tests/gjd-remote-tmux-script.test.ts rather than
   * by matching its text here.
   */
  it("looks for this session's own Claude, by uuid and as a fixed string", () => {
    expect(script).toContain("claudeForSession(A[q], id)");
    // String equality, not a match, so an id somebody hand-set into the tmux
    // environment cannot be a pattern — and not a number, so `01` is not `1`.
    expect(script).toContain('return ((seen "") == (want ""))');
  });

  /** A snapshot it could not take, or a session tmux named no pane for, must
   *  not read as "nothing is running in there". */
  it("says it could not look, rather than that there was nothing to see", () => {
    expect(script).toContain('if [ -z "$snap" ] || [ -z "$mine" ]; then');
    expect(script).toContain("proc='?'");
  });

  /**
   * `printf '%s'` on a command substitution — which has already had its trailing
   * newline stripped — leaves the last line unterminated, and `read` returns
   * false on it without running the loop body. That dropped the last session for
   * the whole life of this script.
   */
  it("terminates the last row, so the loop actually sees it", () => {
    expect(script).toContain(`printf '%s\\n' "$rows" | while IFS= read -r row; do`);
    expect(script).not.toContain(`printf '%s' "$rows" |`);
  });

  it("says how many rows tmux gave it, so a short listing cannot pass for a correct one", () => {
    expect(script).toContain(`printf '${ROW_COUNT} %s\\n' "$n"`);
  });

  /**
   * `claude agents --json` costs ~1.6s of process startup, and only `ls` shows
   * states. `new-claude` checking a name is free, `resume` and `kill` want the
   * list and nothing else, and must neither pay for it nor be able to hang on it.
   */
  it("only asks Claude Code when the caller wants states", () => {
    expect(buildSessionScript({ agents: false })).not.toContain("claude agents");
    expect(buildSessionScript({ agents: true })).toContain("claude agents");
  });

  /**
   * FAILS CLOSED. `claude agents --json` is how every row gets its state, and
   * an empty answer is what a box with no Claude sessions gives AND what a
   * missing or too-old `claude` gives. The two must not share a byte, or a
   * broken box shows a screen of confident "no claude".
   */
  it("says whether it could ask Claude Code, rather than leaving it to be inferred", () => {
    expect(script).toContain("command -v claude");
    expect(script).toContain(AGENTS_OK);
    expect(script).toContain(AGENTS_FAIL);
  });

  it("asks Claude Code once for the whole box", () => {
    // The command substitution, not the phrase — the failure message names the
    // command too, and counting that would be counting the apology.
    expect(script.match(/\$\(claude agents --json/g)?.length).toBe(1);
  });

  /**
   * It is the only free text in the reply and it is full of separators, so it
   * travels the same way the name and the title do.
   */
  it("encodes the agents reply too", () => {
    expect(script).toContain(`printf '${AGENTS_OK} %s\\n' "$(printf '%s' "$agents" | base64 -w0)"`);
  });

  /**
   * A non-interactive ssh sources neither .bashrc nor .bash_profile, so the
   * script gets a stock PATH — the same trap the job script in cmdNewClaude
   * already works around. APPEND, never replace: `claude` under nvm or
   * ~/.local/bin is only findable through the inherited PATH, and losing it
   * would turn every row on a working box into `unknown`.
   */
  it("widens the PATH before anything at all, without discarding the one it was given", () => {
    // Added, not replaced, and on the END so the inherited PATH still wins —
    // a `claude` under nvm is the one this box's sessions are actually running.
    // FIRST LINE, so tmux and ps get the widened PATH too, not only claude.
    expect(script.trim().split("\n")[0]).toBe('PATH="$PATH:/usr/local/bin:/usr/bin:/bin"');
  });

  /**
   * NOT screen-scraping, and this test is here to keep it that way. Matching
   * Claude's spinner glyphs off `capture-pane` works today and is the first
   * thing anybody reaches for; cmux, which does this for a living, records it
   * as its single largest source of bugs, arriving every time Claude changes
   * how it draws.
   */
  it("never reads the state off the screen", () => {
    expect(script).not.toContain("capture-pane");
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
  it("reads the variables we pinned into the session environment, by id", () => {
    for (const v of ["CLAUDE_SESSION_ID", "GJD_PROVISIONAL", ...Object.values(META)]) {
      expect(script, v).toContain(`tmux show-environment -t "$sid" ${v}`);
    }
  });

  /** The checkout path is free text the way the name and the title are — a
   *  directory may contain the field separator — so it travels base64 too. */
  it("encodes the checkout path, and leaves the constrained fields readable", () => {
    expect(script).toContain('"$(printf \'%s\' "$mdir" | base64 -w0)"');
    expect(script).toContain('"$mver" "$mkind" "$mrepo"');
  });
});

/**
 * Counting what tmux binds.
 *
 * The rule the box now holds is that tmux binds NOTHING — no prefix, no keys —
 * so every keystroke reaches Claude Code. See
 * docs/project/hetzner-remote-server-box.md § tmux keeps sessions alive and does nothing else.
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

/**
 * The four variables a session carries about WHICH REPO it is for.
 *
 * `gjd-remote` used to know one repo, so `ls` could say which directory a
 * session was in and nothing else needed saying. Now a session can be for any
 * repo on the box, and the REPO column has to come from somewhere.
 *
 * IT CANNOT COME FROM `pane_current_path`: a shell that has `cd`'d elsewhere,
 * or a session started with `--dir ~`, would then be attributed to whatever
 * repo happens to be under the cursor. So the launcher pins the answer into the
 * tmux environment and the listing reads it back.
 *
 * THE VERSION IS THE WHOLE POINT (GPT Sol, finding 8 of the plan review). Every
 * session on the box — including the ones started before this existed — is
 * rendered by the NEW listing script, so an empty `GJD_REPO` is ambiguous: it is
 * either a session that predates the change, or a new session that lost its
 * metadata. Those two must not look alike, because the first is a row to
 * display as `(unknown)` and the second is a listing to refuse.
 */
describe("session metadata", () => {
  /** What a session started before any of this existed looks like today: the
   *  same record as everyone else's, with four empty fields on the end. */
  const legacy = (o: Partial<{ name: string; id: string }> = {}) =>
    row({ v: "", kind: "", repo: "", dir: "", ...o });

  /** The session, or the refusal as an error — for the cases that are about
   *  what a good record says rather than about how a bad one fails. */
  const ok = (line: string) => {
    const r = parseSessionLine(line);
    if (!r.ok) throw new Error(`expected a session, got: ${r.why ?? "not a record"}`);
    return r.session;
  };

  it("reads the four variables a new session carries", () => {
    expect(ok(row()).meta).toEqual({
      version: 1,
      kind: "claude",
      repo: "gregdetre/reading2",
      dir: "/home/greg/code/spideryarn2",
    });
  });

  it("takes a session with none of them as one that predates them", () => {
    expect(ok(legacy()).meta).toEqual({ version: "legacy" });
  });

  it("accepts all three kinds, so a setup job need not masquerade as a shell", () => {
    for (const kind of ["claude", "shell", "setup"]) {
      expect(ok(row({ kind })).meta).toMatchObject({ kind });
    }
  });

  /**
   * A repo is `owner/name`, lower-cased, or the literal `unknown` for a session
   * started against an arbitrary `--dir`. Anything else did not come from the
   * launcher, and guessing at it is how the wrong repo ends up on screen.
   */
  it("refuses a repo that is not a slug, and accepts the literal unknown", () => {
    expect(ok(row({ repo: "unknown" })).meta).toMatchObject({ repo: "unknown" });
    for (const repo of ["", "reading2", "gregdetre/", "/reading2", "GregDetre/Reading2", "a/b/c", ".."]) {
      const r = parseSessionLine(row({ repo }));
      expect(r.ok, repo).toBe(false);
      if (!r.ok) expect(r.why, repo).toContain("GJD_REPO");
    }
  });

  it("refuses a kind it was not written for", () => {
    for (const kind of ["", "job", "CLAUDE", "setup2"]) {
      const r = parseSessionLine(row({ kind }));
      expect(r.ok, kind).toBe(false);
      if (!r.ok) expect(r.why, kind).toContain("GJD_KIND");
    }
  });

  it("refuses a directory that is not an absolute path", () => {
    for (const dir of ["", "code/spideryarn2", "~/code", "./x"]) {
      const r = parseSessionLine(row({ dir }));
      expect(r.ok, dir).toBe(false);
      if (!r.ok) expect(r.why, dir).toContain("GJD_REMOTE_DIR");
    }
  });

  /** Paths may contain the field separator, so the directory travels base64. */
  it("keeps a directory containing the field separator", () => {
    expect(ok(row({ dir: "/home/greg/code/a|b" })).meta).toMatchObject({ dir: "/home/greg/code/a|b" });
  });

  /**
   * The half-migrated record. No version but a repo means the launcher wrote
   * some of the metadata and not the rest, which is not a legacy session and
   * must not be displayed as one.
   */
  it("refuses a record with no version that carries metadata anyway", () => {
    const r = parseSessionLine(row({ v: "", kind: "", repo: "gregdetre/reading2", dir: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toContain("GJD_METADATA_VERSION");
  });

  it("refuses a version it has never heard of, naming it", () => {
    for (const v of ["2", "0", "1.0", "one"]) {
      const r = parseSessionLine(row({ v }));
      expect(r.ok, v).toBe(false);
      if (!r.ok) expect(r.why, v).toContain(v);
    }
  });

  /** The message has to say WHICH session, or there is nothing to go and look at. */
  it("names the session in the refusal", () => {
    const r = parseSessionLine(row({ name: "database-move", repo: "" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toContain("database-move");
  });

  describe("a listing that mixes the two", () => {
    it("reads a legacy session and a new one side by side", () => {
      const { sessions, failure, unreadable } = parseSessions(
        reply([legacy({ name: "older", id: UUID }), row({ name: "newer" })]),
      );
      expect(failure).toBeNull();
      expect(unreadable).toEqual([]);
      expect(sessions.map((s) => s.meta.version)).toEqual(["legacy", 1]);
    });

    /**
     * THE ONE THIS EXISTS FOR. One good row and one that lost its repo is not a
     * listing with a gap in it — it is a listing this laptop cannot trust, the
     * same way a short row count is. A degraded row would put `(unknown)` next
     * to a session that has a perfectly good repo the box simply failed to
     * report.
     */
    it("refuses the whole listing when one new session is malformed", () => {
      const { sessions, failure } = parseSessions(
        reply([legacy({ name: "older", id: UUID }), row({ name: "newer", repo: "" })]),
      );
      expect(sessions).toEqual([]);
      expect(failure).toContain("newer");
      expect(failure).toContain("GJD_REPO");
    });

    it("refuses the whole listing for a version it does not know", () => {
      const { sessions, failure } = parseSessions(reply([row({ name: "newer", v: "2" })]));
      expect(sessions).toEqual([]);
      expect(failure).toContain("2");
    });
  });

  /**
   * What the REPO column shows. Both unknowns read the same on screen — a
   * session from before this existed, and one started against an arbitrary
   * directory — because neither can be attributed to a repo, and inventing a
   * distinction the reader cannot act on is worse than one honest word.
   */
  describe("the REPO column", () => {
    it("shows the slug for a session that has one", () => {
      expect(sessionRepo(ok(row()))).toEqual({ text: "gregdetre/reading2", known: true });
    });

    it("shows (unknown) for a legacy session, and says it is not known", () => {
      expect(sessionRepo(ok(legacy()))).toEqual({ text: "(unknown)", known: false });
    });

    it("shows (unknown) for a session started against an arbitrary directory", () => {
      expect(sessionRepo(ok(row({ repo: "unknown" })))).toEqual({ text: "(unknown)", known: false });
    });
  });

  /**
   * A setup job has no Claude in it, so it lands where `new-shell` lands. Said
   * out loud here because the STATE column is the one place a setup job could
   * be mistaken for something a person is meant to attach to.
   */
  it("reports a setup session's state as a shell, the same as new-shell", () => {
    const s = ok(row({ kind: "setup", id: "" }));
    expect(sessionState(s, new Map()).kind).toBe("shell");
  });
});

/**
 * **The bug Greg hit on 2026-09-05, and the rule that prevents its family.**
 *
 * `ls` lists every tmux session on the box, and agents make sessions by hand to
 * hold long commands — so a listed name need only satisfy tmux. `kill` and
 * `resume` tested it against `SLUG` instead, which is lower-case only, and
 * `gjd-remote kill gateA` answered with the usage string while leaving the
 * session running. A name this tool will not MINT is not a name it may refuse
 * to ACT ON.
 */
describe("resolveSession", () => {
  const s = (name: string, id: string): Session => ({
    id,
    name,
    created: new Date(1788190336000),
    attached: false,
    windows: 1,
    title: "",
    provisional: false,
    claudeId: null,
    proc: { kind: "none" },
    meta: { version: "legacy" },
  });
  const live = [s("gateA", "$1"), s("stageDbase", "$2"), s("spideryarn-ui-top-bar-cleanup", "$3")];

  it("resolves a name with capitals in it, which SLUG rejected", () => {
    const r = resolveSession(live, "gateA");
    expect(r.ok).toBe(true);
    expect(r.ok && r.session.id).toBe("$1");
  });

  it("resolves an ordinary name too", () => {
    const r = resolveSession(live, "spideryarn-ui-top-bar-cleanup");
    expect(r.ok && r.session.id).toBe("$3");
  });

  /**
   * EXACT, never a prefix. `tmux kill-session -t name` without the `=` prefix
   * matches by prefix, so a bare `stage` would kill `stageDbase` — and a kill
   * that lands on the wrong session is not an error you get to take back.
   */
  it("does not match a prefix of a live name", () => {
    expect(resolveSession(live, "stage").ok).toBe(false);
    expect(resolveSession(live, "gate").ok).toBe(false);
  });

  it("says nothing was killed, and where to look", () => {
    const r = resolveSession(live, "nope");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.why).toContain("no live session named 'nope'");
    expect(r.ok === false && r.why).toContain("gjd-remote ls");
  });

  it("offers the close match when the only difference is case", () => {
    const r = resolveSession(live, "stagedbase");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.why).toContain("did you mean 'stageDbase'?");
  });

  /** Empty is a refusal, not a wildcard: `find` on `""` must not match `""`. */
  it("refuses an empty name", () => {
    expect(resolveSession(live, "").ok).toBe(false);
  });

  /**
   * A tmux id resolves too, so `resume-all` can address the session it saw
   * rather than re-resolving a name in a tab it opens seconds later.
   */
  it("resolves a tmux id", () => {
    const r = resolveSession(live, "$2");
    expect(r.ok && r.session.name).toBe("stageDbase");
  });

  it("refuses an id nothing on the box has", () => {
    expect(resolveSession(live, "$99").ok).toBe(false);
  });

  /**
   * NAME FIRST. A session really called `$1` is somebody's session, and handing
   * back a different one because the string looks like an id is the exact
   * substitution this function exists to prevent.
   */
  it("prefers a session named like an id over the session with that id", () => {
    const odd = [...live, { ...live[0], id: "$9", name: "$1" } as Session];
    const r = resolveSession(odd, "$1");
    expect(r.ok && r.session.id).toBe("$9");
  });
});

/**
 * A name off the box is untrusted text, and shell quoting is not the whole of
 * the defence: a tmux session name may hold control characters, and printing
 * one raw hands the reader's terminal an escape sequence somebody else wrote.
 */
describe("printableName", () => {
  it("quotes an ordinary name", () => {
    expect(printableName("gateA")).toBe("'gateA'");
  });

  /**
   * The unquoted half exists for the `ls` table, where the padding has to be
   * the width on screen. Having only the quoted one is why the table — the one
   * place that prints every name on the box — was still writing them raw.
   */
  it("has an unquoted twin for the table, escaping the same things", () => {
    expect(escapeName("gateA")).toBe("gateA");
    expect(escapeName("a\u001b[2Jb")).toBe("a\\x1b[2Jb");
    expect(printableName("a\u001b[2Jb")).toBe(`'${escapeName("a\u001b[2Jb")}'`);
  });

  it("escapes a control character rather than sending it to the terminal", () => {
    expect(printableName("a\u001b[2Jb")).toBe("'a\\x1b[2Jb'");
    expect(printableName("a\rb")).toBe("'a\\x0db'");
    expect(printableName("a\u0007b")).toBe("'a\\x07b'");
  });

  it("leaves a name that only looks alarming alone", () => {
    expect(printableName("--wait")).toBe("'--wait'");
  });
});
