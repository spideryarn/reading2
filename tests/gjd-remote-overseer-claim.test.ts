/**
 * **Marking exactly one live session as the Overseer.**
 *
 * The Overseer is one permanent Claude session supervising 20–35 others
 * (docs/project/overseer.md). Until 2026-09-08 nothing on the box could tell it
 * from any other session, so two sessions could both believe they were it and
 * neither could find out. The claim is a role string in the session's own tmux
 * environment — docs/plans/260908j-mark-one-session-as-the-overseer.md.
 *
 * TWO HALVES, AND THE SECOND ONE IS THE POINT. The first half hands
 * `parseSessionLine` and the deciders strings, which is cheap and covers the
 * arms. The second half runs REAL TMUX on a disposable socket, because the two
 * facts this design leans on are facts about tmux and not about our parse:
 *
 *  - `show-environment -t <session> VAR` does not fall back to the global
 *    environment, so `set-environment -g` cannot mint a claim;
 *  - **killing the holder releases the claim** — which is the whole reason
 *    there is no lock file to break and no liveness check to get wrong. Asserted
 *    here rather than assumed, because "the claim dies with the session" was a
 *    sentence in a plan before it was a thing anybody watched happen.
 *
 * The tmux half is skipped where tmux and GNU coreutils are not both present —
 * the same probe `gjd-remote-tmux-script.test.ts` uses, and for the same reason:
 * the script only ever runs on the box.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  META,
  METADATA_VERSION,
  OVERSEER_ROLE,
  ROLE_UNREADABLE,
  ROW_COUNT,
  SESSION_SENTINEL,
  type Session,
  buildSessionScript,
  decideClaim,
  decideRelease,
  overseerClaim,
  parseSessionLine,
  parseSessions,
  releaseSucceeded,
  setRoleCommand,
} from "../scripts/gjd-remote-tmux.js";
import {
  OVERSEER_ROLE as WIRE_OVERSEER_ROLE,
  type SessionRole as WireRole,
  claimFromSnapshot,
  describeClaim,
  overseerClaim as wireClaim,
  parseRole as parseWireRole,
} from "../tools/fleet/overseer-claim.js";
import { readOverseerClaim } from "../scripts/overseer.js";

const b64 = (t: string) => Buffer.from(t, "utf8").toString("base64");

/** One well-formed record, with the role field last. */
const row = (o: { sid?: string; name?: string; role?: string } = {}): string =>
  [
    o.sid ?? "$1",
    "1757000000",
    "0",
    "1",
    "0",
    "3c67234f-2da6-4208-8473-9b5ee58be82a",
    "claude",
    b64(o.name ?? "one"),
    b64(""),
    METADATA_VERSION,
    "claude",
    "spideryarn/reading2",
    b64("/home/greg/code/spideryarn2"),
    b64(o.role ?? ""),
  ].join("|");

const reply = (rows: string[]) => [`${ROW_COUNT} ${rows.length}`, ...rows, SESSION_SENTINEL].join("\n");

/** The sessions a reply parses to, or a thrown assertion naming what went wrong. */
function sessionsOf(rows: string[]): Session[] {
  const parsed = parseSessions(reply(rows));
  expect(parsed.failure).toBeNull();
  return parsed.sessions;
}

describe("reading a role off the wire", () => {
  it("an empty role field is NONE — the session holds no claim", () => {
    const r = parseSessionLine(row({ role: "" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.role).toEqual({ kind: "none" });
  });

  it("the overseer role is recognised", () => {
    const r = parseSessionLine(row({ role: OVERSEER_ROLE }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.role).toEqual({ kind: "overseer" });
  });

  it("a role this reader has never heard of is OTHER, and keeps its name", () => {
    const r = parseSessionLine(row({ role: "auditor" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.role).toEqual({ kind: "other", name: "auditor" });
  });

  it("a malformed role is CANNOT-TELL, never none — something is there and we could not read it", () => {
    const r = parseSessionLine(row({ role: "Over Seer!" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.role.kind).toBe("cannot-tell");
  });

  it("a role that is not decodable base64 fails the LINE, like every other field", () => {
    const line = row().replace(/[^|]*$/, "!!!not-base64!!!");
    expect(parseSessionLine(line).ok).toBe(false);
  });

  it("a thirteen-field line — the shape before the role existed — is refused, not defaulted", () => {
    const old = row().split("|").slice(0, 13).join("|");
    expect(parseSessionLine(old).ok).toBe(false);
  });
});

describe("who holds the claim", () => {
  it("nobody, and that is a real answer", () => {
    expect(overseerClaim(sessionsOf([row({ sid: "$1", name: "a" })]))).toEqual({ kind: "none" });
  });

  it("one holder, named", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a" }), row({ sid: "$2", name: "b", role: OVERSEER_ROLE })]);
    expect(overseerClaim(list)).toEqual({ kind: "one", name: "b", id: "$2" });
  });

  it("two holders is a FAULT, not a pick — both names are reported", () => {
    const list = sessionsOf([
      row({ sid: "$1", name: "a", role: OVERSEER_ROLE }),
      row({ sid: "$2", name: "b", role: OVERSEER_ROLE }),
    ]);
    const claim = overseerClaim(list);
    expect(claim.kind).toBe("contested");
    if (claim.kind !== "contested") return;
    expect(claim.names).toEqual(["a", "b"]);
  });

  it("a role we could not read is CANNOT-TELL — it is not evidence that nobody holds it", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a", role: "Over Seer!" })]);
    expect(overseerClaim(list).kind).toBe("cannot-tell");
  });

  it("ONE HOLDER PLUS ONE UNREADABLE ROW IS NOT SINGLETON OWNERSHIP", () => {
    // The claim this whole mechanism makes is *exactly one*, and a row nobody
    // could read might be a second claimant. So the answer is cannot-tell —
    // GPT Sol's P0-2, against a first draft that returned `one` here.
    const list = sessionsOf([
      row({ sid: "$1", name: "a", role: "Over Seer!" }),
      row({ sid: "$2", name: "b", role: OVERSEER_ROLE }),
    ]);
    const claim = overseerClaim(list);
    expect(claim.kind).toBe("cannot-tell");
    // ...and it still says WHO, so a caller that only wants somebody to prod
    // keeps the address. What it has lost is the guarantee, not the name.
    //
    // Asserted on the FIELD, not on the sentence. This read `why.toContain("b")`
    // for one commit, which passes on the word "be" in "could not be read" — a
    // check that could not have failed, in a file about checks that cannot.
    if (claim.kind !== "cannot-tell") return;
    expect(claim.holder).toEqual({ name: "b", id: "$2" });
  });

  it("and when nobody was seen holding it, there is no holder to report", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a", role: "Over Seer!" })]);
    const claim = overseerClaim(list);
    expect(claim.kind).toBe("cannot-tell");
    if (claim.kind !== "cannot-tell") return;
    expect(claim.holder).toBeUndefined();
  });

  it("A READING THAT MAY NOT DESCRIBE NOW BEATS EVEN `contested`", () => {
    // Two holders in an old snapshot do not prove two holders now — killing one
    // is exactly what somebody would have done about it. GPT Sol, second review,
    // against a version where `contested` short-circuited first.
    const list = sessionsOf([
      row({ sid: "$1", name: "a", role: OVERSEER_ROLE }),
      row({ sid: "$2", name: "b", role: OVERSEER_ROLE }),
    ]);
    expect(wireClaim(list, { ok: false, scope: "moment", why: "this reading is stale" }).kind).toBe("cannot-tell");
    // ...whereas a merely SHORT list leaves two known holders two known holders.
    expect(wireClaim(list, { ok: false, scope: "rows", why: "a row was dropped" }).kind).toBe("contested");
  });

  it("TWO KNOWN HOLDERS BEAT AN INCOMPLETE READING — more rows could only make it worse", () => {
    const list = sessionsOf([
      row({ sid: "$1", name: "a", role: OVERSEER_ROLE }),
      row({ sid: "$2", name: "b", role: OVERSEER_ROLE }),
      row({ sid: "$3", name: "c", role: "Over Seer!" }),
    ]);
    expect(overseerClaim(list).kind).toBe("contested");
  });
});

describe("deciding whether a claim may go ahead", () => {
  it("claims a free role", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a" })]);
    expect(decideClaim(list, "a")).toEqual({ kind: "claim", id: "$1", name: "a" });
  });

  it("refuses when somebody else holds it, and NAMES them", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a" }), row({ sid: "$2", name: "held", role: OVERSEER_ROLE })]);
    const v = decideClaim(list, "a");
    expect(v.kind).toBe("refused");
    if (v.kind !== "refused") return;
    expect(v.why).toContain("held");
  });

  it("is a no-op when the target already holds it", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a", role: OVERSEER_ROLE })]);
    expect(decideClaim(list, "a").kind).toBe("already-yours");
  });

  it("refuses a session that is not there", () => {
    expect(decideClaim(sessionsOf([row({ name: "a" })]), "ghost").kind).toBe("refused");
  });

  it("refuses to claim over a role we could not read, rather than overwriting it", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a", role: "Over Seer!" })]);
    expect(decideClaim(list, "a").kind).toBe("refused");
  });

  it("releasing a session that does not hold it says so rather than pretending to work", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a" })]);
    expect(decideRelease(list, "a").kind).toBe("refused");
  });

  it("releases the holder", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a", role: OVERSEER_ROLE })]);
    expect(decideRelease(list, "a")).toEqual({ kind: "release", id: "$1", name: "a" });
  });
});

describe("a role the box could not be asked about", () => {
  it("the sentinel is CANNOT-TELL, and is not the same bytes as an empty field", () => {
    // `show-environment -t X VAR` exits 1 both for a variable that is not set
    // and for a session that has gone, so the script dumps the environment and
    // sends '?' when even that failed. If those two collapsed, a session that
    // vanished mid-listing would report as one that holds no claim.
    const r = parseSessionLine(row().replace(/[^|]*$/, ROLE_UNREADABLE));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.role.kind).toBe("cannot-tell");
    expect(r.session.role).not.toEqual({ kind: "none" });
  });

  it("poisons the whole reading rather than being ignored", () => {
    const list = sessionsOf([
      row({ sid: "$1", name: "a" }),
      row({ sid: "$2", name: "b" }).replace(/[^|]*$/, ROLE_UNREADABLE),
    ]);
    expect(overseerClaim(list).kind).toBe("cannot-tell");
  });

  it("and a claim is REFUSED while any role is unreadable", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a" }).replace(/[^|]*$/, ROLE_UNREADABLE)]);
    expect(decideClaim(list, "a").kind).toBe("refused");
  });
});

describe("what the refusal does and does not promise", () => {
  it("TWO CLAIMS FROM THE SAME SNAPSHOT ARE BOTH ALLOWED — this is not a mutex", () => {
    // The contract is eventual detection, not mutual exclusion. Written down as
    // a test so nobody later reads `decideClaim` as a lock. GPT Sol's P1-1.
    const before = sessionsOf([row({ sid: "$1", name: "a" }), row({ sid: "$2", name: "b" })]);
    expect(decideClaim(before, "a").kind).toBe("claim");
    expect(decideClaim(before, "b").kind).toBe("claim");
  });

  it("and the box that results is reported as contested, not resolved in someone's favour", () => {
    const after = sessionsOf([
      row({ sid: "$1", name: "a", role: OVERSEER_ROLE }),
      row({ sid: "$2", name: "b", role: OVERSEER_ROLE }),
    ]);
    expect(overseerClaim(after).kind).toBe("contested");
  });

  it("releasing is allowed WHILE contested, because that is the repair", () => {
    const contested = sessionsOf([
      row({ sid: "$1", name: "a", role: OVERSEER_ROLE }),
      row({ sid: "$2", name: "b", role: OVERSEER_ROLE }),
    ]);
    expect(decideRelease(contested, "a")).toEqual({ kind: "release", id: "$1", name: "a" });
  });
});

describe("reading a claim off a dashboard snapshot", () => {
  const NOW = Date.parse("2026-09-08T20:05:00.000Z");
  const snapshot = (over: Record<string, unknown> = {}) => ({
    schema: 1,
    collectedAt: "2026-09-08T20:04:30.000Z",
    error: null,
    rows: [{ id: "$1", name: "alpha", role: { kind: "overseer" } }],
    ...over,
  });
  const read = (body: unknown) => claimFromSnapshot(body, { nowMs: NOW, maxAgeMs: 5 * 60_000 });

  it("names the holder in a fresh, complete snapshot", () => {
    expect(read(snapshot())).toEqual({ kind: "one", name: "alpha", id: "$1" });
  });

  it("REFUSES A PAYLOAD WHOSE COLLECTION FAILED — those rows are the last good ones, not current", () => {
    expect(read(snapshot({ error: "tmux went away" })).kind).toBe("cannot-tell");
  });

  it("refuses a snapshot from before the first collection, which is not an empty box", () => {
    expect(read(snapshot({ collectedAt: null, rows: [] })).kind).toBe("cannot-tell");
  });

  it("refuses a stale snapshot rather than naming a session that may be gone", () => {
    expect(read(snapshot({ collectedAt: "2026-09-08T19:00:00.000Z" })).kind).toBe("cannot-tell");
  });

  it("refuses a schema it does not read", () => {
    expect(read(snapshot({ schema: 2 })).kind).toBe("cannot-tell");
  });

  it("a row it cannot read makes the whole answer uncertain, holder or no holder", () => {
    expect(read(snapshot({ rows: [{ id: "$1", name: "alpha", role: { kind: "overseer" } }, {}] })).kind).toBe(
      "cannot-tell",
    );
    expect(read(snapshot({ rows: [{ id: "$1", name: "alpha", role: { kind: "none" } }, {}] })).kind).toBe(
      "cannot-tell",
    );
  });

  it("says none for a fresh, complete snapshot in which nobody holds it", () => {
    expect(read(snapshot({ rows: [{ id: "$1", name: "alpha", role: { kind: "none" } }] }))).toEqual({ kind: "none" });
  });

  // FOUR MALFORMED AUTHORITY FIELDS, all of which the first version accepted as
  // `{kind:"one"}`. GPT Sol confirmed each against the function before reporting
  // it, which is why they are here as four cases rather than one.
  it("only `error: null` establishes a good collection — an ABSENT error does not", () => {
    const { error: _dropped, ...withoutError } = snapshot();
    expect(read(withoutError).kind).toBe("cannot-tell");
  });

  it("nor does an error that is not a message", () => {
    expect(read(snapshot({ error: { message: "failed" } })).kind).toBe("cannot-tell");
  });

  it("A SNAPSHOT STAMPED IN THE FUTURE IS NOT THE FRESHEST POSSIBLE ONE", () => {
    expect(read(snapshot({ collectedAt: "2027-09-08T20:04:30.000Z" })).kind).toBe("cannot-tell");
  });

  it("a row whose id is not tmux's own shape is dropped and counted, not acted on", () => {
    expect(read(snapshot({ rows: [{ id: "not-a-tmux-handle", name: "alpha", role: { kind: "overseer" } }] })).kind).toBe(
      "cannot-tell",
    );
  });
});

describe("whether a release actually took", () => {
  // The first version asked `role.kind !== "overseer"`, which a target whose
  // role could not be read satisfies — so the command printed a green success
  // without knowing whether anything had happened. GPT Sol, second review.
  it("a target that is gone counts as released, because dying releases the claim", () => {
    expect(releaseSucceeded(sessionsOf([row({ sid: "$1", name: "a" })]), "$999")).toBe(true);
  });

  it("a target whose role is now positively NONE counts", () => {
    expect(releaseSucceeded(sessionsOf([row({ sid: "$1", name: "a" })]), "$1")).toBe(true);
  });

  it("A TARGET WHOSE ROLE COULD NOT BE READ DOES NOT COUNT", () => {
    const list = sessionsOf([row({ sid: "$1", name: "a" }).replace(/[^|]*$/, ROLE_UNREADABLE)]);
    expect(releaseSucceeded(list, "$1")).toBe(false);
  });

  it("nor does one that still holds it", () => {
    expect(releaseSucceeded(sessionsOf([row({ sid: "$1", name: "a", role: OVERSEER_ROLE })]), "$1")).toBe(false);
  });
});

describe("asking the dashboard over HTTP", () => {
  const NOW = Date.parse("2026-09-08T20:05:00.000Z");
  const body = {
    schema: 1,
    collectedAt: "2026-09-08T20:04:30.000Z",
    error: null,
    rows: [{ id: "$1", name: "alpha", role: { kind: "overseer" } }],
  };
  /** A `fetch` that answers once, without a network. */
  const answering = (status: number, payload: unknown): typeof fetch =>
    (async () =>
      ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => payload,
      }) as Response) as unknown as typeof fetch;

  it("names the holder when the dashboard answers well", async () => {
    const claim = await readOverseerClaim("http://x", { nowMs: NOW, fetchImpl: answering(200, body) });
    expect(claim).toEqual({ kind: "one", name: "alpha", id: "$1" });
  });

  it("a non-200 is CANNOT-TELL, never 'no Overseer'", async () => {
    const claim = await readOverseerClaim("http://x", { nowMs: NOW, fetchImpl: answering(503, body) });
    expect(claim.kind).toBe("cannot-tell");
  });

  it("A DASHBOARD THAT CANNOT BE REACHED IS NOT A BOX WITH NO OVERSEER", async () => {
    const throwing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const claim = await readOverseerClaim("http://x", { nowMs: NOW, fetchImpl: throwing });
    expect(claim.kind).toBe("cannot-tell");
    if (claim.kind !== "cannot-tell") return;
    expect(claim.why).toContain("ECONNREFUSED");
  });

  it("and the payload's own refusals travel through it", async () => {
    const failed = { ...body, error: "tmux went away" };
    const claim = await readOverseerClaim("http://x", { nowMs: NOW, fetchImpl: answering(200, failed) });
    expect(claim.kind).toBe("cannot-tell");
  });
});

describe("the wire side", () => {
  it("the reader RE-EXPORTS the role string rather than spelling it again", () => {
    // **This passes trivially today, and that is the point of it.** The whole
    // exclusivity rule is string equality against this one word, across a
    // compilation boundary the compiler cannot bridge, so the tmux reader
    // re-exports the constant instead of declaring its own. The assertion is
    // worth nothing while that holds and goes red the day somebody replaces the
    // re-export with a literal — which is exactly the change that would make
    // every gjd-remote claim read as `other` on the dashboard, silently.
    expect(WIRE_OVERSEER_ROLE).toBe(OVERSEER_ROLE);
  });

  it("reads an ABSENT role as cannot-tell — a server from before the field is not a denial", () => {
    expect(parseWireRole(undefined).kind).toBe("cannot-tell");
    expect(parseWireRole(null).kind).toBe("cannot-tell");
  });

  it("reads each arm the collector sends", () => {
    expect(parseWireRole({ kind: "none" })).toEqual({ kind: "none" });
    expect(parseWireRole({ kind: "overseer" })).toEqual({ kind: "overseer" });
    expect(parseWireRole({ kind: "other", name: "auditor" })).toEqual({ kind: "other", name: "auditor" });
    expect(parseWireRole({ kind: "cannot-tell", why: "junk" })).toEqual({ kind: "cannot-tell", why: "junk" });
  });

  it("an arm this build has never heard of is cannot-tell, not none", () => {
    expect(parseWireRole({ kind: "deputy" }).kind).toBe("cannot-tell");
  });

  it("says who holds it, that nobody does, and when two do", () => {
    const r = (id: string, name: string, role: WireRole) => ({ id, name, role });
    expect(wireClaim([r("$1", "a", { kind: "none" })])).toEqual({ kind: "none" });
    expect(wireClaim([r("$1", "a", { kind: "overseer" })])).toEqual({ kind: "one", name: "a", id: "$1" });
    expect(wireClaim([r("$1", "a", { kind: "overseer" }), r("$2", "b", { kind: "overseer" })]).kind).toBe(
      "contested",
    );
    expect(wireClaim([r("$1", "a", { kind: "cannot-tell", why: "x" })]).kind).toBe("cannot-tell");
  });

  it("describes the ABSENT state as a sentence, not a blank", () => {
    expect(describeClaim({ kind: "none" })).toBe("no Overseer session");
  });
});

describe("the tmux command a claim turns into", () => {
  it("quotes the session id, because a bare $2514 is a positional parameter", () => {
    expect(setRoleCommand("$2514", OVERSEER_ROLE)).toContain("'$2514'");
  });

  it("releasing UNSETS rather than writing an empty string", () => {
    expect(setRoleCommand("$1", null)).toContain(" -u ");
  });

  it("refuses an id that is not tmux's own shape", () => {
    expect(() => setRoleCommand("2514; rm -rf /", OVERSEER_ROLE)).toThrow();
  });
});

/* ------------------------------------------------------------------ *
 * The shell branch nothing else can reach: a live listing whose per-session
 * environment read fails. This is the race GPT Sol's P0-1 is about — a session
 * that dies between `tmux ls` and the lookup — and it cannot be arranged against
 * a real server on demand, so `tmux` is stubbed for exactly this one shape.
 * ------------------------------------------------------------------ */

describe.runIf(usable())("when tmux lists a session it can no longer be asked about", () => {
  let dir = "";

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "overseer-claim-stub-"));
    // `ls` still lists the session, and every read of it fails — which is what a
    // session that ended between the listing and the lookup looks like. The
    // OTHER variables answer normally, so the row is a perfectly good record
    // whose ROLE alone is unknowable; a stub that failed everything would be
    // testing a broken tmux instead.
    writeFileSync(
      path.join(dir, "tmux"),
      [
        "#!/bin/sh",
        'if [ "$1" = "ls" ]; then printf \'$7|1757000000|0|1|gone-session\\n\'; exit 0; fi',
        'if [ "$1" = "list-panes" ]; then exit 0; fi',
        'if [ "$1" = "has-session" ]; then exit 1; fi',
        'if [ "$1" = "show-environment" ]; then',
        '  if [ "$4" = "GJD_ROLE" ]; then exit 1; fi',
        '  if [ $# -ge 4 ]; then printf \'%s=\\n\' "$4"; exit 0; fi',
        "  exit 1",
        "fi",
        "exit 0",
      ].join("\n"),
    );
    chmodSync(path.join(dir, "tmux"), 0o755);
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("REPORTS THE ROLE AS UNKNOWN, not as absent", () => {
    const out = execFileSync("bash", ["-c", buildSessionScript({ agents: false })], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${dir}:${process.env["PATH"] ?? ""}` },
    });
    const parsed = parseSessions(out);
    expect(parsed.failure).toBeNull();
    expect(parsed.sessions).toHaveLength(1);
    // The bug this guards: with a by-name read, the empty answer here was
    // indistinguishable from "this session holds no claim", and a vanished
    // session would have been counted as evidence that nobody is the Overseer.
    expect(parsed.sessions[0]?.role.kind).toBe("cannot-tell");
    expect(parsed.sessions[0]?.role).not.toEqual({ kind: "none" });
  });
});

/* ------------------------------------------------------------------ *
 * Against a real tmux server, on a socket nothing else can reach.
 * ------------------------------------------------------------------ */

/** GNU coreutils and tmux, or the whole block is skipped. See the header. */
function usable(): boolean {
  try {
    execFileSync("wc", ["--version"], { stdio: "ignore" });
    execFileSync("tmux", ["-V"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

describe.runIf(usable())("against a real tmux server", () => {
  let dir = "";
  let sock = "";

  const tmux = (...args: string[]): string =>
    execFileSync("tmux", ["-S", sock, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

  /** Run the listing script against this socket and parse it. */
  const list = (): Session[] => {
    const script = buildSessionScript({ agents: false }).replaceAll("tmux ", `tmux -S ${sock} `);
    const out = execFileSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, HOME: dir } });
    const parsed = parseSessions(out);
    expect(parsed.failure).toBeNull();
    return parsed.sessions;
  };

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "overseer-claim-"));
    sock = path.join(dir, "s.sock");
    tmux("new-session", "-d", "-s", "alpha", "sleep 300");
    tmux("new-session", "-d", "-s", "beta", "sleep 300");
    for (const s of ["alpha", "beta"]) {
      tmux("set-environment", "-t", s, META.version, METADATA_VERSION);
      tmux("set-environment", "-t", s, META.kind, "claude");
      tmux("set-environment", "-t", s, META.repo, "spideryarn/reading2");
      tmux("set-environment", "-t", s, META.dir, "/home/greg/code/spideryarn2");
    }
  });

  afterAll(() => {
    try {
      tmux("kill-server");
    } catch {
      /* already gone */
    }
    rmSync(dir, { recursive: true, force: true });
  });

  it("starts with nobody holding the claim", () => {
    expect(overseerClaim(list())).toEqual({ kind: "none" });
  });

  it("a claim is visible to the listing, and only on the session that got it", () => {
    const v = decideClaim(list(), "alpha");
    expect(v.kind).toBe("claim");
    if (v.kind !== "claim") return;
    execFileSync("bash", ["-c", setRoleCommand(v.id, OVERSEER_ROLE).replace("tmux ", `tmux -S ${sock} `)]);

    const claim = overseerClaim(list());
    expect(claim.kind).toBe("one");
    if (claim.kind !== "one") return;
    expect(claim.name).toBe("alpha");
    expect(list().find((s) => s.name === "beta")?.role).toEqual({ kind: "none" });
  });

  it("refuses a second claim, naming the holder", () => {
    const v = decideClaim(list(), "beta");
    expect(v.kind).toBe("refused");
    if (v.kind !== "refused") return;
    expect(v.why).toContain("alpha");
  });

  // tmux prints a multi-line value as SEVERAL LINES, indistinguishable from
  // several variables, so a naive read of the first one accepts them as a
  // perfectly good claim. Nothing here writes such a value — `setRoleCommand`
  // validates the token — so it can only arrive by hand, and the honest answer
  // is that the role could not be read.
  //
  // **BOTH SHAPES, because the first fix only caught the first one.** A version
  // that counted lines matching `^GJD_ROLE=` rejected `overseer\nGJD_ROLE=evil`
  // and cheerfully accepted `overseer\njunk`, and the test written with it
  // proved only "two matching lines are rejected". GPT Sol found that by trying
  // the other value.
  for (const [label, value] of [
    ["a second line that looks like another variable", "overseer\nGJD_ROLE=evil"],
    ["a second line that looks like nothing", "overseer\njunk"],
    ["a leading newline", "\noverseer"],
  ] as const) {
    it(`A ROLE WITH ${label} IS UNREADABLE, not a claim`, () => {
      tmux("set-environment", "-t", "beta", "GJD_ROLE", value);
      try {
        expect(list().find((s) => s.name === "beta")?.role.kind).toBe("cannot-tell");
        expect(overseerClaim(list()).kind).not.toBe("one");
      } finally {
        tmux("set-environment", "-u", "-t", "beta", "GJD_ROLE");
      }
    });
  }

  it("another variable carrying a GJD_ROLE= line cannot answer for the real one", () => {
    // The reason the role is read BY NAME rather than out of a dump of the whole
    // session environment.
    tmux("set-environment", "-t", "beta", "INNOCENT", "x\nGJD_ROLE=overseer");
    try {
      expect(list().find((s) => s.name === "beta")?.role).toEqual({ kind: "none" });
    } finally {
      tmux("set-environment", "-u", "-t", "beta", "INNOCENT");
    }
  });

  it("a GLOBAL role marks nothing — show-environment does not fall back to it", () => {
    tmux("set-environment", "-g", "GJD_ROLE", OVERSEER_ROLE);
    try {
      expect(list().find((s) => s.name === "beta")?.role).toEqual({ kind: "none" });
    } finally {
      tmux("set-environment", "-gu", "GJD_ROLE");
    }
  });

  it("KILLING THE HOLDER RELEASES THE CLAIM — there is nothing left to break", () => {
    tmux("kill-session", "-t", "alpha");
    expect(overseerClaim(list())).toEqual({ kind: "none" });
    // And the role is free again, which is the half that matters after a reboot.
    expect(decideClaim(list(), "beta").kind).toBe("claim");
  });

  it("releasing removes it, and the session stays alive", () => {
    const v = decideClaim(list(), "beta");
    expect(v.kind).toBe("claim");
    if (v.kind !== "claim") return;
    execFileSync("bash", ["-c", setRoleCommand(v.id, OVERSEER_ROLE).replace("tmux ", `tmux -S ${sock} `)]);
    expect(overseerClaim(list()).kind).toBe("one");

    const r = decideRelease(list(), "beta");
    expect(r.kind).toBe("release");
    if (r.kind !== "release") return;
    execFileSync("bash", ["-c", setRoleCommand(r.id, null).replace("tmux ", `tmux -S ${sock} `)]);
    expect(overseerClaim(list())).toEqual({ kind: "none" });
    expect(list().map((s) => s.name)).toContain("beta");
  });
});
