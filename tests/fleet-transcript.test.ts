/**
 * The recent messages of one session — tools/fleet/transcript.ts.
 *
 * EVERY FIXTURE UNDER tests/fixtures/fleet-transcripts/ IS A REAL CAPTURE, cut
 * verbatim out of live `~/.claude/projects/**\/*.jsonl` on the box on
 * 2026-09-08, with two declared exceptions:
 *
 * - `real-tail-truncated-final-line.jsonl` — real records, with the last one cut
 *   at 55% and the trailing newline removed, to reproduce the file as it looks
 *   while an agent is mid-write. This is the normal state of a live transcript,
 *   not an exotic one, and it must not fail the read.
 * - `real-conversation.jsonl` — two contiguous runs of one real session joined
 *   together. The 16 records between them were tool traffic and a single 126 KB
 *   attachment; keeping them would have made a 133 KB fixture to show two
 *   sentences.
 *
 * Two more files are built at test time rather than committed, and both are
 * about the byte-walking rather than the parse: a transcript larger than three
 * read chunks (the repo does not need a 1 MB fixture to prove a loop iterates)
 * and a one-record file with no trailing newline.
 *
 * THE ASYMMETRY IS THE POINT, and it is not the same asymmetry as
 * `fleet-pane.test.ts`. A missing message costs a scroll. A message attributed
 * to the wrong speaker is a lie on a dashboard Greg reads on his phone to decide
 * which agent to interrupt — and the transcript format is full of machine-written
 * text wearing `role: "user"`: compaction summaries, `<system-reminder>`
 * injections, subagent completion notices, and messages from other agents. Most
 * of this file is therefore about who said a thing, not whether it was returned.
 */
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  findTranscript,
  isClaudeSessionId,
  readRecentMessages,
  recordsToTurns,
  slugifyDir,
  type RecentMessages,
  type TranscriptTurn,
} from "../tools/fleet/transcript.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/fleet-transcripts");
/** A real uuid, so nothing here depends on the validator being lax. */
const UUID = "c1f41eee-14d7-4393-8b70-3e7e8168a690";
const DIR = "/home/greg/code/spideryarn2/.claude/worktrees/demo";

/**
 * Stage a transcript body under a projects directory, and return the directory.
 *
 * `slug` defaults to the one `dir` implies; pass a different one to reproduce a
 * session that moved after launch, which is the ordinary case on this box.
 */
function stage(body: Buffer | string, slug = slugifyDir(DIR), uuid = UUID): string {
  const projects = path.join(mkdtempSync(path.join(tmpdir(), "fleet-transcript-")), "projects");
  mkdirSync(path.join(projects, slug), { recursive: true });
  writeFileSync(path.join(projects, slug, `${uuid}.jsonl`), body);
  return projects;
}

function fixtureBytes(name: string): Buffer {
  return readFileSync(path.join(FIXTURES, name));
}

async function readFixture(
  name: string,
  opts: { limit?: number; maxBytes?: number; maxTextChars?: number; slug?: string } = {},
): Promise<RecentMessages> {
  const projects = stage(fixtureBytes(name), opts.slug);
  // SPREAD, not `limit: opts.limit`. `exactOptionalPropertyTypes` is on, which
  // makes "absent" and "present and undefined" different things — and they
  // genuinely are here: an explicit `limit: undefined` would be a caller
  // saying "no limit" rather than a caller not mentioning limits, and the
  // defaults would never apply.
  return readRecentMessages({
    claudeSessionId: UUID,
    dir: DIR,
    projectsDir: projects,
    ...(opts.limit === undefined ? {} : { limit: opts.limit }),
    ...(opts.maxBytes === undefined ? {} : { maxBytes: opts.maxBytes }),
    ...(opts.maxTextChars === undefined ? {} : { maxTextChars: opts.maxTextChars }),
  });
}

/** Narrow to `found`, failing loudly rather than returning a shape with no turns. */
async function found(name: string, opts: Parameters<typeof readFixture>[1] = {}) {
  const res = await readFixture(name, opts);
  if (res.kind !== "found") throw new Error(`${name} → ${res.kind}: ${"why" in res ? res.why : ""}`);
  return res;
}

function speakers(turns: TranscriptTurn[]): string[] {
  return turns.map((t) => t.speaker);
}

// ---------------------------------------------------------------------------

describe("the fixture corpus", () => {
  const files = readdirSync(FIXTURES)
    .filter((f) => f.endsWith(".jsonl"))
    .sort();

  it("has the shapes this module exists to get right", () => {
    // Named individually rather than counted, because the interesting thing
    // about each is a different failure. A count would stay green if somebody
    // swapped the compaction fixture for a second copy of the conversation.
    expect(files).toEqual([
      "empty.jsonl",
      "real-compaction-summary.jsonl",
      "real-conversation.jsonl",
      "real-metadata-only.jsonl",
      "real-peer-message.jsonl",
      "real-relocated.jsonl",
      "real-tail-tools-only.jsonl",
      "real-tail-truncated-final-line.jsonl",
      "real-task-notification.jsonl",
    ]);
  });

  it("is real JSONL — every fixture but the declared malformed one parses whole", async () => {
    for (const f of files) {
      const res = await found(f);
      if (f === "real-tail-truncated-final-line.jsonl") {
        expect(res.recordsUnparseable).toBe(1);
      } else {
        expect(res.recordsUnparseable).toBe(0);
      }
    }
  });
});

describe("who said it", () => {
  /**
   * The plain case, and the one everything else is a deviation from: a person
   * typed something, the model answered.
   */
  it("reads a real typed turn and the real reply, oldest first", async () => {
    const res = await found("real-conversation.jsonl");
    expect(speakers(res.turns)).toEqual(["human", "assistant"]);
    expect(res.turns[0]?.text).toBe("steer-probe-VYWni13vNIX");
    expect(res.turns[1]?.text).toContain("Probe received");
    // Order is load-bearing: the client renders top-to-bottom. ISO timestamps
    // sort lexicographically, which is the whole reason they are kept as strings.
    const [first, second] = [res.turns[0]?.at, res.turns[1]?.at];
    expect(typeof first).toBe("string");
    expect(typeof second).toBe("string");
    expect(String(first) < String(second)).toBe(true);
  });

  /**
   * THE WORST WRONG ANSWER THIS MODULE COULD GIVE.
   *
   * A compaction summary is `role: "user"`, is 14.8 KB long, and opens "This
   * session is being continued from a previous conversation that ran out of
   * context." Rendered as a human turn it reads exactly like Greg recapping the
   * task — a fluent, detailed, entirely machine-written brief attributed to him.
   * Nothing about the record's `role`, its `content` type or its position
   * distinguishes it; only `isCompactSummary` does.
   */
  it("does not mistake a compaction summary for something a person said", async () => {
    const res = await found("real-compaction-summary.jsonl");
    const summary = res.turns.find((t) => t.text.startsWith("This session is being continued"));
    // Positive first: the turn is there and carries the text.
    expect(summary).toBeDefined();
    expect(summary?.text).toContain("This session is being continued from a previous conversation");
    // And it is labelled as what it is.
    expect(summary?.speaker).toBe("compact-summary");
    // The negative, which alone would pass if the turn vanished entirely.
    expect(speakers(res.turns).filter((s) => s === "human")).not.toContain("compact-summary");
  });

  /**
   * A cross-session message carries BOTH `isMeta: true` and
   * `origin.kind: "peer"`, so the order those are checked in decides the answer.
   * Checking `isMeta` first — which is what the code did at first — labels every
   * message from another agent "injected", i.e. boilerplate worth skipping,
   * which is precisely backwards: it is the most interesting kind of user record
   * on a box where agents talk to each other.
   */
  it("calls a message from another agent a peer message, not an injection", async () => {
    const res = await found("real-peer-message.jsonl");
    expect(res.turns).toHaveLength(1);
    expect(res.turns[0]?.text).toContain("Another Claude session sent a message");
    expect(res.turns[0]?.speaker).toBe("peer");
  });

  /** A subagent finishing is machinery. It is not Greg, and it is not the agent. */
  it("calls a subagent completion a notification", async () => {
    const res = await found("real-task-notification.jsonl");
    const note = res.turns.find((t) => t.text.includes("<task-notification>"));
    expect(note).toBeDefined();
    expect(note?.speaker).toBe("notification");
    expect(speakers(res.turns)).toContain("assistant");
  });

  /**
   * Named because it is what stops the four cases above from being one case.
   * If every user record collapsed to `human` this suite would still be green
   * on the individual assertions above only by accident of ordering, so assert
   * the whole set is genuinely more than one thing.
   */
  it("does not collapse every user record to one speaker", async () => {
    const all = new Set<string>();
    for (const f of readdirSync(FIXTURES).filter((f) => f.endsWith(".jsonl"))) {
      for (const s of speakers((await found(f)).turns)) all.add(s);
    }
    expect([...all].sort()).toEqual(["assistant", "compact-summary", "human", "injected", "notification", "peer", "system"]);
  });
});

describe("tool calls", () => {
  /**
   * Tool traffic was 2718 `tool_use` + 2718 `tool_result` against 1017 assistant
   * text blocks in the measured transcript. Returning the results would spend
   * the byte budget on `grep` output; returning nothing at all would render an
   * agent that is busy as an agent that is silent.
   */
  it("keeps the tool's name and drops its result", async () => {
    const res = await found("real-tail-tools-only.jsonl");
    // Positive: the turns exist, and they say what the agent is doing.
    expect(res.turns.length).toBeGreaterThan(0);
    const names = res.turns.flatMap((t) => t.toolCalls.map((c) => c.name));
    expect(names).toContain("Bash");
    expect(res.turns.some((t) => t.toolCalls.some((c) => (c.detail ?? "").length > 0))).toBe(true);
    // And the results were seen and deliberately skipped, not missed.
    expect(res.toolResultsSkipped).toBeGreaterThan(0);
  });

  /**
   * Paired with the positive above, because `not.toContain` on a body of text is
   * satisfied by the text disappearing altogether — the defect this codebase
   * found twice this week.
   */
  it("puts no tool-result payload into any turn's text", async () => {
    const res = await found("real-tail-tools-only.jsonl");
    const everything = res.turns.map((t) => t.text).join("\n");
    // The real tool results in this fixture contain these; the tool calls do not.
    const rawFixture = fixtureBytes("real-tail-tools-only.jsonl").toString("utf8");
    expect(rawFixture).toContain('"tool_result"');
    expect(everything).not.toContain('"tool_result"');
    // The positive that makes the line above mean something: the turns are
    // present and non-empty in the field that should carry content.
    expect(res.turns.some((t) => t.toolCalls.length > 0)).toBe(true);
  });

  it("does not return thinking blocks", async () => {
    const res = await found("real-conversation.jsonl");
    const raw = fixtureBytes("real-conversation.jsonl").toString("utf8");
    // The fixture really does contain a thinking block with a signature…
    expect(raw).toContain('"thinking"');
    expect(raw).toContain('"signature"');
    // …and the assistant turn built from that same message carries the prose.
    const assistant = res.turns.find((t) => t.speaker === "assistant");
    expect(assistant?.text).toContain("Probe received");
    expect(res.turns.map((t) => t.text).join("\n")).not.toContain("signature");
  });
});

describe("one API turn split across several records", () => {
  /**
   * 1497 of 2806 `message.id`s in the measured transcript appear on more than
   * one line, up to four: Claude Code writes the thinking block, the text block
   * and each tool call as separate records sharing an id. Left uncoalesced, one
   * reply renders as three bubbles and "the last 12 turns" delivers four.
   */
  it("coalesces records that share a message id", async () => {
    const raw = fixtureBytes("real-conversation.jsonl").toString("utf8");
    const ids = [...raw.matchAll(/"id":"(msg_[^"]+)"/g)].map((m) => m[1]);
    // The fixture genuinely contains one id on two separate records.
    expect(new Set(ids).size).toBeLessThan(ids.length);

    const res = await found("real-conversation.jsonl");
    expect(res.turns.filter((t) => t.speaker === "assistant")).toHaveLength(1);
  });

  /**
   * THE REGRESSION TEST FOR A BUG THAT NO CHECK CAUGHT — it was found by
   * measuring against live sessions, which is the only reason it is here.
   *
   * The stop-reading condition counted RECORDS, on the reasoning that records
   * are at least as many as turns. That is exactly backwards: one turn is up to
   * four records, so stopping at "13 records" delivered 6 turns to a caller that
   * asked for 12 — on all 23 live sessions at once. The payload looked perfectly
   * healthy while doing it: no error, no flag, just less conversation than was
   * asked for, which is the shape nobody notices on a dashboard.
   *
   * Asking for 10 turns from a file whose every turn is three records is the
   * cheapest thing that goes red for it.
   */
  it("returns as many turns as were asked for, even when each is several records", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 60; i++) {
      const id = `msg_${String(i).padStart(4, "0")}`;
      const at = `2026-09-08T00:00:${String(i % 60).padStart(2, "0")}.000Z`;
      const base = { type: "assistant", timestamp: at, message: { id, role: "assistant" } };
      lines.push(
        JSON.stringify({ ...base, message: { ...base.message, content: [{ type: "thinking", thinking: "…", signature: "x".repeat(200) }] } }),
        JSON.stringify({ ...base, message: { ...base.message, content: [{ type: "tool_use", id: `toolu_${i}`, name: "Bash", input: { command: `echo ${i}` } }] } }),
        JSON.stringify({ ...base, message: { ...base.message, content: [{ type: "text", text: `turn ${i}` }] } }),
      );
    }
    const projects = stage(`${lines.join("\n")}\n`);
    const res = await readRecentMessages({
      claudeSessionId: UUID,
      dir: DIR,
      projectsDir: projects,
      limit: 10,
    });
    expect(res.kind).toBe("found");
    if (res.kind !== "found") return;
    expect(res.turns).toHaveLength(10);
    // And they are the newest ten, in order — not ten of something else.
    expect(res.turns.map((t) => t.text)).toEqual(
      Array.from({ length: 10 }, (_, i) => `turn ${50 + i}`),
    );
  });

  it("does not merge two turns that merely sit next to each other", () => {
    // Two user records, no message id on either — the shape a person typing
    // twice produces. Merging on adjacency would glue them together.
    const { turns } = recordsToTurns(
      [
        { type: "user", timestamp: "2026-09-08T01:00:00Z", message: { role: "user", content: "first" } },
        { type: "user", timestamp: "2026-09-08T01:00:01Z", message: { role: "user", content: "second" } },
      ],
      2000,
    );
    expect(turns.map((t) => t.text)).toEqual(["first", "second"]);
  });
});

describe("finding the file", () => {
  /**
   * THE REGRESSION TEST FOR THE FINDING THAT SHAPED THE MODULE.
   *
   * Slugifying `row.meta.dir` located the transcript for only 7 of the 30 live
   * sessions that had a uuid (measured 2026-09-08). `meta.dir` is where the
   * session was LAUNCHED; `EnterWorktree` then moves it, and the transcript file
   * moves with it while `meta.dir` stays put. A lookup that trusts the directory
   * reports "no messages" for two thirds of a busy box.
   */
  it("finds a transcript whose session moved to a worktree after launch", async () => {
    const elsewhere = slugifyDir("/home/greg/code/spideryarn2/.claude/worktrees/somewhere-else");
    expect(elsewhere).not.toBe(slugifyDir(DIR));

    const res = await found("real-conversation.jsonl", { slug: elsewhere });
    expect(res.via).toBe("scan");
    expect(res.turns[0]?.text).toBe("steer-probe-VYWni13vNIX");
  });

  it("takes the cheap path when the session has not moved", async () => {
    const res = await found("real-conversation.jsonl");
    expect(res.via).toBe("slug-guess");
    expect(res.turns.length).toBeGreaterThan(0);
  });

  /**
   * If a copy of a transcript is ever left under an old slug, taking the first
   * `readdir` hit makes the answer depend on directory order — so the dashboard
   * could show a stale conversation, plausibly, and a different one next
   * refresh. The newest write is the right one by any reading, and `copies`
   * says the situation happened at all.
   */
  it("takes the newest when a uuid is under two slugs, and says there were two", async () => {
    const projects = stage("", "-a-stale-copy");
    const stale = path.join(projects, "-a-stale-copy", `${UUID}.jsonl`);
    writeFileSync(
      stale,
      `${JSON.stringify({ type: "user", timestamp: "2026-09-01T00:00:00Z", origin: { kind: "human" }, message: { role: "user", content: "the OLD conversation" } })}\n`,
    );
    // Backdate it so "newest" is a fact about the files, not about write order.
    const old = new Date("2026-09-01T00:00:00Z");
    utimesSync(stale, old, old);

    mkdirSync(path.join(projects, "-the-live-one"), { recursive: true });
    writeFileSync(
      path.join(projects, "-the-live-one", `${UUID}.jsonl`),
      `${JSON.stringify({ type: "user", timestamp: "2026-09-08T00:00:00Z", origin: { kind: "human" }, message: { role: "user", content: "the CURRENT conversation" } })}\n`,
    );

    // `dir` names neither, so only the scan can answer.
    const res = await readRecentMessages({ claudeSessionId: UUID, dir: null, projectsDir: projects });
    expect(res.kind).toBe("found");
    if (res.kind !== "found") return;
    expect(res.turns[0]?.text).toBe("the CURRENT conversation");
    expect(res.copies).toBe(2);
  });

  it("slugifies the way this box actually does", () => {
    // Verified against `ls ~/.claude/projects` on 2026-09-08: the `.claude` in a
    // worktree path produces the doubled dash, because both the `/` and the `.`
    // become one.
    expect(slugifyDir("/home/greg/code/spideryarn2/.claude/worktrees/pdf-figures")).toBe(
      "-home-greg-code-spideryarn2--claude-worktrees-pdf-figures",
    );
    expect(slugifyDir("/home/greg/code/spideryarn2")).toBe("-home-greg-code-spideryarn2");
  });

  /** A uuid from session metadata is about to be joined into a path. */
  it("refuses a session id that is not a uuid rather than joining it into a path", async () => {
    expect(isClaudeSessionId(UUID)).toBe(true);
    for (const bad of ["../../etc/passwd", "..", "not-a-uuid", `${UUID}/../..`, ""]) {
      expect(isClaudeSessionId(bad)).toBe(false);
    }
    const projects = stage(fixtureBytes("real-conversation.jsonl"));
    const res = await readRecentMessages({
      claudeSessionId: "../../../etc/passwd",
      dir: DIR,
      projectsDir: projects,
    });
    expect(res.kind).toBe("not-found");
    if (res.kind === "not-found") expect(res.reason).toBe("malformed-claude-session-id");
  });
});

describe("saying so, instead of returning nothing", () => {
  /**
   * The house rule. Four different facts, four different answers, and only one
   * of them is about the agent — docs/reusable/silent-success.md, and the
   * `collectedAt: null` comments in tools/fleet/state.ts.
   */
  /**
   * `lastModified` is the consumer's only handle on the hazard this module
   * cannot see from inside: `CLAUDE_SESSION_ID` is pinned in the tmux
   * environment at session creation and never updated, so a pane re-used for a
   * second conversation still reports the first one's uuid — and these turns
   * would be real, well-formed, correctly attributed, and about the wrong
   * conversation. A transcript last written hours ago, against a row the
   * collector calls `working`, is that bug rather than a quiet agent.
   */
  it("reports when the transcript was last written, so a stale one can be spotted", async () => {
    const projects = stage(fixtureBytes("real-conversation.jsonl"));
    const file = path.join(projects, slugifyDir(DIR), `${UUID}.jsonl`);
    const longAgo = new Date("2026-09-01T09:30:00Z");
    utimesSync(file, longAgo, longAgo);

    const res = await readRecentMessages({ claudeSessionId: UUID, dir: DIR, projectsDir: projects });
    expect(res.kind).toBe("found");
    if (res.kind !== "found") return;
    expect(res.lastModified).toBe("2026-09-01T09:30:00.000Z");
    // The turns are still returned — the staleness is reported, not guessed at.
    expect(res.turns.length).toBeGreaterThan(0);
  });

  it("distinguishes a session with no conversation id from one with no messages", async () => {
    const res = await readRecentMessages({ claudeSessionId: null, dir: DIR, projectsDir: stage("") });
    expect(res.kind).toBe("not-found");
    if (res.kind === "not-found") {
      expect(res.reason).toBe("no-claude-session-id");
      expect(res.why).toContain("no conversation id");
    }
  });

  it("distinguishes a missing transcript from an empty one", async () => {
    const projects = stage(fixtureBytes("real-conversation.jsonl"));
    const missing = await readRecentMessages({
      claudeSessionId: "00000000-0000-4000-8000-000000000000",
      dir: DIR,
      projectsDir: projects,
    });
    expect(missing.kind).toBe("not-found");
    if (missing.kind === "not-found") expect(missing.reason).toBe("no-transcript-file");

    // An empty transcript is `found`, with zero turns — a different fact, and
    // the one that means "this session really has not said anything".
    const empty = await found("empty.jsonl");
    expect(empty.turns).toEqual([]);
    expect(empty.reachedStartOfFile).toBe(true);
    expect(empty.fileBytes).toBe(0);
  });

  it("says so when the projects directory itself is not there", async () => {
    const res = await readRecentMessages({
      claudeSessionId: UUID,
      dir: DIR,
      projectsDir: path.join(tmpdir(), "fleet-transcript-does-not-exist-9f3a1c"),
    });
    expect(res.kind).toBe("not-found");
    if (res.kind === "not-found") expect(res.reason).toBe("no-projects-directory");
  });

  /**
   * A real session's opening records are all metadata — `custom-title`,
   * `agent-name`, `mode`. It has a transcript, it has records, and nobody has
   * spoken. That is `found` with no turns, and it must not read as an error.
   */
  it("returns found-with-no-turns for a session where nobody has spoken yet", async () => {
    const res = await found("real-metadata-only.jsonl");
    expect(res.recordsParsed).toBeGreaterThan(0);
    expect(res.turns).toEqual([]);
    expect(res.reachedStartOfFile).toBe(true);
  });

  /**
   * `reachedStartOfFile` is what stops "3 turns" from being ambiguous. Without
   * it, a caller cannot tell a quiet session from a truncated read — the same
   * ambiguity as an empty list meaning "none", "not asked yet" or "asked and
   * failed".
   */
  it("admits when it stopped early rather than implying it read everything", async () => {
    const whole = await found("real-tail-tools-only.jsonl");
    expect(whole.reachedStartOfFile).toBe(true);

    const clipped = await found("real-tail-tools-only.jsonl", { limit: 1 });
    expect(clipped.turns).toHaveLength(1);
    expect(clipped.reachedStartOfFile).toBe(false);
  });

  /**
   * THE CASE THE TEST ABOVE ONLY LOOKED LIKE IT COVERED, and the reason this one
   * exists as well.
   *
   * `reachedStartOfFile` is `tail.reachedStartOfFile && kept.length ===
   * turns.length`. In the `limit: 1` test the second conjunct is already false
   * because turns were trimmed, so the answer is `false` whatever the tail
   * reported — a mutation that made the early-return path claim it had reached
   * the start of the file left that test green. Found by mutation, not by
   * reading: docs/reusable/silent-success.md, "an assertion that reddens above
   * the line you care about".
   *
   * To see the tail's own value, the trim must be a no-op — so this returns
   * ZERO turns while stopping early. `countTurnsCheaply` counts an
   * assistant record with only a `thinking` block (it has a message id and is
   * not a tool result), but `recordsToTurns` builds nothing from one. So the
   * read stops on `enough` having produced no turns at all, `0 === 0` satisfies
   * the conjunct, and the tail's honesty is the only thing left deciding.
   *
   * It is also the case that matters most. Zero turns and an unfinished read
   * must never be rendered as "this agent has said nothing" — that is the
   * empty-list-means-three-things bug with a person's attention on the line.
   */
  /**
   * The other half of the same field, and the reason it is a conjunction.
   *
   * The byte walk can reach the start of the file and STILL have dropped turns,
   * because the stop-reading estimate counts only `user` and `assistant`
   * records while `recordsToTurns` also builds turns from `system` records that
   * carry text. The compaction fixture is exactly that shape: three user records
   * (so the estimate never trips a limit of 3) and four turns once the
   * "Conversation compacted" system note is built. Reading to byte 0 is then
   * true and "you have seen everything" is false.
   *
   * Without this, removing `&& kept.length === turns.length` leaves the suite
   * green — measured.
   */
  it("does not claim completeness just because it reached the start of the file", async () => {
    const all = await found("real-compaction-summary.jsonl");
    expect(all.turns).toHaveLength(4);
    expect(all.reachedStartOfFile).toBe(true);

    const trimmed = await found("real-compaction-summary.jsonl", { limit: 3 });
    expect(trimmed.turns).toHaveLength(3);
    // The oldest turn was dropped, so there is more above — even though every
    // byte of the file was read.
    expect(trimmed.reachedStartOfFile).toBe(false);
    // And it is the OLDEST that went, not the newest: the tail is what matters.
    expect(trimmed.turns.map((t) => t.speaker)).toEqual(
      all.turns.slice(1).map((t) => t.speaker),
    );
  });

  it("returns no turns without claiming the session is silent", async () => {
    const lines: string[] = [];
    for (let i = 0; i < 40; i++) {
      lines.push(
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-09-08T00:00:00.000Z",
          uuid: `3f1c9a2b-0000-4000-8000-${String(i).padStart(12, "0")}`,
          message: {
            id: `msg_thinking_${i}`,
            role: "assistant",
            content: [{ type: "thinking", thinking: "…", signature: "s".repeat(10_000) }],
          },
        }),
      );
    }
    const projects = stage(`${lines.join("\n")}\n`);
    const res = await readRecentMessages({
      claudeSessionId: UUID,
      dir: DIR,
      projectsDir: projects,
      limit: 3,
    });
    expect(res.kind).toBe("found");
    if (res.kind !== "found") return;

    // Nothing to show…
    expect(res.turns).toEqual([]);
    // …and it says plainly that it did not get to the start, so "no turns" is
    // about the range read and not about the agent.
    expect(res.reachedStartOfFile).toBe(false);
    // The proof it really did stop early: records were parsed, and far fewer
    // than the file holds.
    expect(res.recordsParsed).toBeGreaterThan(0);
    expect(res.recordsParsed).toBeLessThan(40);
    expect(res.bytesRead).toBeLessThan(res.fileBytes);
  });
});

describe("a file that is being written while we read it", () => {
  /**
   * The normal state of a live transcript, not an exotic one: the agent appends
   * as we read, so the last record can be half an object. One bad line must cost
   * one record, never the read.
   */
  it("tolerates a truncated final record and still returns the turns above it", async () => {
    const res = await found("real-tail-truncated-final-line.jsonl");
    expect(res.recordsUnparseable).toBe(1);
    expect(res.recordsParsed).toBeGreaterThan(0);
    expect(res.turns.length).toBeGreaterThan(0);
    expect(res.turns.some((t) => t.toolCalls.length > 0)).toBe(true);
  });

  /**
   * A file whose only record has no trailing newline. This was a real bug: the
   * branch that consumes the bytes after the final newline was gated on
   * `carry.length === 0` as a proxy for "first chunk", so a file with no newline
   * at all never ran it and the newest record was silently dropped.
   */
  it("reads a single record that has no trailing newline", async () => {
    const line = JSON.stringify({
      type: "user",
      timestamp: "2026-09-08T03:00:00Z",
      uuid: "3f1c9a2b-0000-4000-8000-000000000001",
      origin: { kind: "human" },
      message: { role: "user", content: "the only line, unterminated" },
    });
    const projects = stage(line); // deliberately no "\n"
    const res = await readRecentMessages({ claudeSessionId: UUID, dir: DIR, projectsDir: projects });
    expect(res.kind).toBe("found");
    if (res.kind !== "found") return;
    expect(res.turns).toHaveLength(1);
    expect(res.turns[0]?.text).toBe("the only line, unterminated");
  });
});

describe("reading the tail rather than the file", () => {
  /**
   * The whole point of the module. Built rather than committed: proving a loop
   * iterates over three chunks does not justify a 1 MB fixture in the repo.
   * The records are minimal on purpose — this test is about the byte walking,
   * and the parse is covered by the real captures above.
   */
  function bigTranscript(count: number, padBytes: number): { body: string; count: number } {
    const lines: string[] = [];
    for (let i = 0; i < count; i++) {
      lines.push(
        JSON.stringify({
          type: "user",
          timestamp: `2026-09-08T00:00:${String(i % 60).padStart(2, "0")}.000Z`,
          uuid: `3f1c9a2b-0000-4000-8000-${String(i).padStart(12, "0")}`,
          origin: { kind: "human" },
          message: { role: "user", content: `turn ${i} ${"x".repeat(padBytes)}` },
        }),
      );
    }
    return { body: `${lines.join("\n")}\n`, count };
  }

  it("walks back across several chunks and keeps the order", async () => {
    const { body } = bigTranscript(400, 4000); // ~1.7 MB, well over three 256 KB chunks
    const projects = stage(body);
    expect(statSync(path.join(projects, slugifyDir(DIR), `${UUID}.jsonl`)).size).toBeGreaterThan(
      3 * 256 * 1024,
    );

    const res = await readRecentMessages({
      claudeSessionId: UUID,
      dir: DIR,
      projectsDir: projects,
      limit: 40,
      maxBytes: 4 * 1024 * 1024,
      maxTextChars: 40,
    });
    expect(res.kind).toBe("found");
    if (res.kind !== "found") return;
    // The newest 40, in order, ending at the very last record in the file.
    expect(res.turns).toHaveLength(40);
    expect(res.turns.map((t) => t.text.split(" ").slice(0, 2).join(" "))).toEqual(
      Array.from({ length: 40 }, (_, i) => `turn ${360 + i}`),
    );
    // And it did not read the file to do it.
    expect(res.bytesRead).toBeLessThan(res.fileBytes);
  });

  it("never reads more than maxBytes, even when that means fewer turns", async () => {
    const { body } = bigTranscript(400, 4000);
    const projects = stage(body);
    const res = await readRecentMessages({
      claudeSessionId: UUID,
      dir: DIR,
      projectsDir: projects,
      limit: 10_000, // more than the file holds, so only the cap can stop it
      maxBytes: 100_000,
    });
    expect(res.kind).toBe("found");
    if (res.kind !== "found") return;
    expect(res.bytesRead).toBeLessThanOrEqual(100_000);
    expect(res.fileBytes).toBeGreaterThan(1_000_000);
    // Stopping early is reported, not implied.
    expect(res.reachedStartOfFile).toBe(false);
    expect(res.turns.length).toBeGreaterThan(0);
  });

  /**
   * THE MEASUREMENT THIS MODULE EXISTS FOR, taken against whatever real
   * transcripts are on this box. Skipped rather than failed when there are none,
   * because the suite must pass on a laptop that has never run an agent — but
   * `expect` runs whenever the box has one, and this ran against 33 MB.
   */
  it("reads a fraction of a real multi-megabyte transcript", async () => {
    const projectsDir = path.join(process.env.HOME ?? "", ".claude", "projects");
    let biggest: { file: string; slug: string; size: number } | null = null;
    try {
      for (const slug of readdirSync(projectsDir)) {
        let entries: string[];
        try {
          entries = readdirSync(path.join(projectsDir, slug));
        } catch {
          continue;
        }
        for (const f of entries) {
          if (!f.endsWith(".jsonl")) continue;
          const size = statSync(path.join(projectsDir, slug, f)).size;
          if (biggest === null || size > biggest.size) biggest = { file: f, slug, size };
        }
      }
    } catch {
      biggest = null;
    }
    if (biggest === null || biggest.size < 2_000_000) return; // no real corpus here

    const started = performance.now();
    const res = await readRecentMessages({
      claudeSessionId: biggest.file.replace(/\.jsonl$/, ""),
      dir: null,
      projectsDir,
      limit: 12,
    });
    const tookMs = performance.now() - started;

    expect(res.kind).toBe("found");
    if (res.kind !== "found") return;
    expect(res.fileBytes).toBe(biggest.size);
    // The claim: a small, bounded read of a large file.
    expect(res.bytesRead).toBeLessThanOrEqual(1024 * 1024);
    expect(res.bytesRead / res.fileBytes).toBeLessThan(0.5);
    expect(tookMs).toBeLessThan(2000);
    expect(res.turns.length).toBeGreaterThan(0);
  });
});

describe("what goes to the browser", () => {
  /**
   * A 14.8 KB machine-written summary is not a message anybody reads on a phone.
   * Cut it, and say that it was cut — the length is reported rather than an
   * ellipsis appended, so the string stays pure content with nothing added that
   * a consumer would have to strip back off.
   */
  it("truncates a long turn and says by how much", async () => {
    const res = await found("real-compaction-summary.jsonl", { maxTextChars: 500 });
    const summary = res.turns.find((t) => t.speaker === "compact-summary");
    expect(summary).toBeDefined();
    expect(summary?.text).toHaveLength(500);
    expect(summary?.truncated).toBe(true);
    expect(summary?.fullChars).toBeGreaterThan(10_000);
    // The beginning survives, so the cut is from the end.
    expect(summary?.text.startsWith("This session is being continued")).toBe(true);
  });

  it("leaves a short turn alone", async () => {
    const res = await found("real-conversation.jsonl");
    const human = res.turns.find((t) => t.speaker === "human");
    expect(human?.truncated).toBe(false);
    expect(human?.fullChars).toBe(human?.text.length);
  });

  /**
   * A cut through the middle of an astral character leaves a lone surrogate,
   * which serialises to invalid UTF-8 on the way to the browser.
   */
  it("does not cut a surrogate pair in half", () => {
    const emoji = "🙂";
    // 10 emoji = 20 JS characters; cutting at 5 lands inside the third pair.
    const { turns } = recordsToTurns(
      [{ type: "user", message: { role: "user", content: emoji.repeat(10) } }],
      5,
    );
    const text = turns[0]?.text ?? "";
    expect(text).toBe(emoji.repeat(2));
    expect(text.length).toBe(4);
    // The real check: nothing left half of a character behind.
    expect([...text]).toHaveLength(2);
    expect(Buffer.from(text, "utf8").toString("utf8")).toBe(text);
  });

  /**
   * The module is not the escaping layer and must not pretend to be one. What it
   * owes the consumer is that it adds nothing of its own — no HTML, no markdown
   * wrapper — so the only markup-looking text in a turn is text the agent really
   * wrote, and React escapes all of it the same way.
   */
  it("passes agent text through without adding markup of its own", () => {
    const hostile = '<img src=x onerror="alert(1)"> & <b>bold</b>';
    const { turns } = recordsToTurns(
      [{ type: "user", message: { role: "user", content: hostile } }],
      2000,
    );
    // Verbatim: not escaped, not stripped, not wrapped. The consumer escapes.
    expect(turns[0]?.text).toBe(hostile);
  });

  it("scrubs terminal control characters, which are noise rather than content", () => {
    // Escapes, not literal control bytes: typing these characters puts raw
    // bytes (a NUL among them) into the source and the file stops being text.
    const withControls = "red\u001B[31m text\u0000 here\u0007";
    const { turns } = recordsToTurns(
      [{ type: "user", message: { role: "user", content: withControls } }],
      2000,
    );
    const text = turns[0]?.text ?? "";
    // Positive: the words survive.
    expect(text).toBe("red[31m text here");
    // Newlines and tabs are content and must not be scrubbed.
    const { turns: kept } = recordsToTurns(
      [{ type: "user", message: { role: "user", content: "a\nb\tc" } }],
      2000,
    );
    expect(kept[0]?.text).toBe("a\nb\tc");
  });
});

describe("a subagent's conversation is not this agent's", () => {
  /**
   * Modern Claude Code writes subagent turns to a `subagents/` subdirectory, but
   * older transcripts interleave them into the main file behind `isSidechain`.
   * Interleaved and unfiltered they read as the main agent saying things it
   * never said — a plausible conversation that did not happen.
   */
  it("drops sidechain records and keeps the main thread's", () => {
    const { turns } = recordsToTurns(
      [
        { type: "user", isSidechain: false, message: { role: "user", content: "the real question" } },
        { type: "user", isSidechain: true, message: { role: "user", content: "a subagent brief" } },
        {
          type: "assistant",
          isSidechain: true,
          message: { role: "assistant", content: [{ type: "text", text: "a subagent answer" }] },
        },
        {
          type: "assistant",
          isSidechain: false,
          message: { role: "assistant", content: [{ type: "text", text: "the real answer" }] },
        },
      ],
      2000,
    );
    expect(turns.map((t) => t.text)).toEqual(["the real question", "the real answer"]);
  });
});

describe("the module has no import side effects", () => {
  /**
   * `server.ts` binds ports at import time, which is why `state.ts` and
   * `config.ts` exist at all; importing `page.ts` from a test once bound 8787
   * and took the suite from 4s to 19s. Nothing here may read the environment or
   * the disk until it is called.
   */
  it("imports cleanly with no HOME to read", async () => {
    const before = process.env.HOME;
    try {
      delete process.env.HOME;
      // `resetModules` forces a genuine re-evaluation of the module body, which
      // is the only thing that would touch the environment if anything did.
      vi.resetModules();
      const mod = await import("../tools/fleet/transcript.js");
      expect(typeof mod.readRecentMessages).toBe("function");
    } finally {
      if (before !== undefined) process.env.HOME = before;
    }
  });

  it("resolves the projects directory inside the call, not at module scope", () => {
    const src = readFileSync(path.resolve(import.meta.dirname, "../tools/fleet/transcript.ts"), "utf8");
    // Positive: the one place it is read is the option default inside the entry point.
    expect(src).toContain('opts.projectsDir ?? path.join(homedir(), ".claude", "projects")');
    // And that is the only call to it anywhere in the file.
    expect(src.match(/homedir\(\)/g)).toHaveLength(1);
  });
});

describe("findTranscript on its own", () => {
  it("reports which route found the file", async () => {
    const projects = stage(fixtureBytes("real-conversation.jsonl"));
    const hit = await findTranscript(projects, UUID, DIR);
    expect(hit.kind).toBe("found");
    if (hit.kind === "found") {
      expect(hit.via).toBe("slug-guess");
      expect(hit.path.endsWith(`${UUID}.jsonl`)).toBe(true);
    }
  });

  it("does not echo an untrusted session id back into the message it renders", async () => {
    const projects = stage("");
    const res = await findTranscript(projects, "<script>alert(1)</script>", null);
    expect(res.kind).toBe("not-found");
    if (res.kind === "not-found") {
      // Positive: it explains itself.
      expect(res.why).toContain("not a uuid");
      expect(res.why).not.toContain("<script>");
    }
  });
});
