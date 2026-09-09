/**
 * **The browser half: the parser, the provenance rule, and the bands.**
 *
 * Every test here is a refusal, and each one is a way the *page* could have
 * shown better news than the data carried — which is a separate risk from the
 * server's verdict being wrong, and was not covered at all until GPT Sol's
 * Stage 2 review pointed out that the 405 existing web tests do not touch this
 * panel.
 *
 * The plan is
 * docs/plans/260909b-readiness-tab-latest-tests-and-typecheck-on-dev-with-24h-graphs.md.
 */
import { describe, expect, it } from "vitest";

import { acceptsGzip } from "../tools/fleet/routes-readiness.js";
import { bucketMarks } from "../tools/fleet/web/src/ReadinessPanel.js";
import { parseReadiness, type ReadingView } from "../tools/fleet/web/src/readiness-client.js";

const SHA = "1111111111111111111111111111111111111111";
const OTHER = "2222222222222222222222222222222222222222";

const clean = (sha: string) => ({ kind: "known", sha, branch: "dev", dirty: false });

/** A well-formed payload, which each test then spoils in exactly one way. */
function payload(over: Record<string, unknown> = {}): unknown {
  return {
    schema: 1,
    kind: "readiness",
    collectedAt: "2026-09-09T06:00:00.000Z",
    windowHours: 24,
    refreshMs: 120_000,
    readings: [],
    verdict: { kind: "ready", sha: SHA, evidence: [], caveat: "…" },
    dev: { kind: "known", devSha: SHA, primarySha: SHA, primaryBehind: 0, trunkGap: 3, observedAt: "…", caveat: "…" },
    diagnostics: {
      unreadableRecords: [],
      unreadableLogs: [],
      unreadableRoots: [],
      scanTruncated: false,
      rootsTruncated: false,
      logsSkippedForBudget: 0,
      checkoutsScanned: 13,
      storeRefused: null,
      tmuxWhy: null,
    },
    ...over,
  };
}

function reading(over: Partial<ReadingView> = {}): ReadingView {
  return {
    runId: "aabbcc",
    atMs: Date.parse("2026-09-09T05:00:00.000Z"),
    state: "pass",
    check: "test",
    scope: "full",
    source: "wrapper",
    commandLine: "vitest run",
    durationMs: 1000,
    treeAtStart: { kind: "known", sha: SHA, branch: "dev", dirty: false },
    treeAtEnd: { kind: "known", sha: SHA, branch: "dev", dirty: false },
    logPath: null,
    why: null,
    counts: null,
    ...over,
  };
}

describe("reading the server's answer in the browser", () => {
  it("accepts a well-formed answer", () => {
    const view = parseReadiness(payload());
    expect(view.kind).toBe("readiness");
    expect(view.kind === "readiness" && view.verdict.kind).toBe("ready");
  });

  it("refuses an answer stamped with a schema this build does not read", () => {
    /* A server deployed under a page that has been open on a phone for hours.
       Reading a schema-2 payload field by field with a schema-1 parser gave a
       green verdict; the whole envelope has to be refused, because we no longer
       know what the fields mean. GPT Sol, Stage 2 review. */
    const view = parseReadiness(payload({ schema: 2 }));
    expect(view.kind).toBe("unavailable");
    expect(view.kind === "unavailable" && view.why).toContain("schema");
  });

  it("refuses an answer with no readings or no diagnostics, rather than inventing empties", () => {
    /* `readings: undefined` became `[]`, and a missing `diagnostics` became
       "0 checkouts; nothing unreadable or skipped" — a reassuring sentence
       manufactured out of nothing at all. */
    expect(parseReadiness(payload({ readings: undefined })).kind).toBe("unavailable");
    expect(parseReadiness(payload({ diagnostics: undefined })).kind).toBe("unavailable");
  });

  it("refuses a `ready` verdict whose sha is not a sha", () => {
    const view = parseReadiness(payload({ verdict: { kind: "ready", sha: "yes", evidence: [], caveat: "" } }));
    expect(view.kind === "readiness" && view.verdict.kind).toBe("unknown");
  });

  it("falls back to unknown for a verdict arm it does not recognise, never to ready", () => {
    const view = parseReadiness(payload({ verdict: { kind: "probably-fine", sha: SHA, evidence: [] } }));
    expect(view.kind === "readiness" && view.verdict.kind).toBe("unknown");
  });

  it("refuses to fill in a missing collection time with its own clock", () => {
    /* Substituting Date.now() would draw a stale answer as a fresh one, which is
       the whole reason the stamp is on the wire. */
    expect(parseReadiness(payload({ collectedAt: undefined })).kind).toBe("unavailable");
  });

  it("reads a tree stamp with no explicit `dirty` as unknown, not as clean", () => {
    const view = parseReadiness(
      payload({ readings: [{ atMs: 1, state: "pass", record: { check: "test", runId: "x", treeAtStart: { kind: "known", sha: SHA } } }] }),
    );
    const first = view.kind === "readiness" ? view.readings[0] : null;
    expect(first?.treeAtStart.kind).toBe("unknown");
  });

  it("gives an unrecognised source its own arm rather than calling it a log", () => {
    const view = parseReadiness(
      payload({ readings: [{ atMs: 1, state: "pass", record: { check: "test", runId: "x", source: "something-new" } }] }),
    );
    const first = view.kind === "readiness" ? view.readings[0] : null;
    expect(first?.source).toBe("unknown");
  });
});

describe("which marks are drawn as counting", () => {
  const from = Date.parse("2026-09-09T00:00:00.000Z");
  const span = 24 * 60 * 60 * 1000;
  const provenance = (r: ReadingView): string =>
    bucketMarks([r], from, span, SHA)[0]?.provenance ?? "none";

  it("counts a full clean wrapper run on this commit", () => {
    expect(provenance(reading())).toBe("dev");
  });

  it("does not count a run whose tree was dirty at either end", () => {
    /* The client used to keep only `treeAtStart`, so these wore the ringed
       "this one counts" treatment while the server's verdict correctly refused
       them — the picture and the headline disagreeing. */
    expect(provenance(reading({ treeAtStart: { kind: "known", sha: SHA, branch: "dev", dirty: true } }))).toBe("other");
    expect(provenance(reading({ treeAtEnd: { kind: "known", sha: SHA, branch: "dev", dirty: true } }))).toBe("other");
  });

  it("does not count a run whose checkout moved while it ran", () => {
    expect(provenance(reading({ treeAtEnd: clean(OTHER) as ReadingView["treeAtEnd"] }))).toBe("other");
  });

  it("does not count a run on another commit, or a narrowed one", () => {
    expect(provenance(reading({ treeAtStart: clean(OTHER) as ReadingView["treeAtStart"] }))).toBe("other");
    expect(provenance(reading({ scope: "narrowed" }))).toBe("other");
  });

  it("does not count a run that has not finished", () => {
    expect(provenance(reading({ state: "running", treeAtEnd: { kind: "unknown", why: "still going" } }))).toBe("other");
  });

  it("calls only a log reconstruction `nosha`", () => {
    /* A wrapper run whose tree could not be read is a real run about something;
       labelling it "reconstructed from a log" was false. */
    expect(provenance(reading({ source: "tmux-log" }))).toBe("nosha");
    expect(provenance(reading({ treeAtStart: { kind: "unknown", why: "git failed" } }))).toBe("other");
  });

  it("does not call a run from an UNRECOGNISED source a log reconstruction either", () => {
    /* Adding the client's third `source` arm re-opened the very mislabelling it
       was added to close: `!== "wrapper"` swept `unknown` into `nosha`, and the
       tooltip would then make a specific claim about where a run came from that
       is really a guess. Found by re-reading the fix, not by the fix's own test. */
    expect(provenance(reading({ source: "unknown" }))).toBe("other");
  });
});

describe("two runs that want the same pixel", () => {
  const from = Date.parse("2026-09-09T00:00:00.000Z");
  const span = 24 * 60 * 60 * 1000;
  /* Five minutes apart — well inside the ~15 minutes a 2px mark covers. */
  const a = from + 60 * 60 * 1000;
  const b = a + 5 * 60 * 1000;

  it("draws the WORSE of two overlapping runs, whatever the order", () => {
    /* Plain DOM order let a later pass paint over an earlier failure — the
       reducer's same-millisecond tie bug wearing a coat of CSS. */
    const pass = reading({ runId: "p", atMs: a, state: "pass" });
    const fail = reading({ runId: "f", atMs: b, state: "fail" });

    for (const order of [[pass, fail], [fail, pass]]) {
      const drawn = bucketMarks(order, from, span, SHA);
      expect(drawn).toHaveLength(1);
      expect(drawn[0]?.reading.state).toBe("fail");
      expect(drawn[0]?.hidden).toBe(1);
    }
  });

  it("says how many runs a mark stands for", () => {
    const many = [0, 1, 2, 3].map((i) => reading({ runId: `r${i}`, atMs: a + i * 60_000 }));
    const drawn = bucketMarks(many, from, span, SHA);
    expect(drawn).toHaveLength(1);
    expect(drawn[0]?.hidden).toBe(3);
  });

  it("keeps runs that are genuinely far apart apart", () => {
    const spread = [0, 6, 12].map((h) => reading({ runId: `h${h}`, atMs: from + h * 60 * 60 * 1000 }));
    expect(bucketMarks(spread, from, span, SHA)).toHaveLength(3);
  });

  it("prefers the run that counts when two are equally bad", () => {
    const history = reading({ runId: "h", atMs: a, source: "tmux-log" });
    const onDev = reading({ runId: "d", atMs: b });
    const drawn = bucketMarks([history, onDev], from, span, SHA);
    expect(drawn[0]?.provenance).toBe("dev");
  });

  it("gives every mark a key that survives two runs in the same millisecond", () => {
    const twins = [reading({ runId: "one", atMs: a }), reading({ runId: "two", atMs: a })];
    const drawn = bucketMarks(twins, from, span, SHA);
    /* They collapse to one mark, but the one drawn keeps its own identity —
       the key used to be built from the timestamp, so React saw one node. */
    expect(drawn[0]?.reading.runId).toMatch(/^(one|two)$/);
    expect(drawn[0]?.hidden).toBe(1);
  });
});

describe("whether the caller wants gzip", () => {
  it("reads a plain offer as yes", () => {
    expect(acceptsGzip("gzip, deflate, br")).toBe(true);
    expect(acceptsGzip("*")).toBe(true);
  });

  it("reads `q=0` as the refusal it is", () => {
    /* A substring check cannot see a refusal, and gzipping a client that asked
       not to be gzipped is a small dishonesty in a feature about not telling
       small ones. */
    expect(acceptsGzip("gzip;q=0")).toBe(false);
    expect(acceptsGzip("gzip;q=0, deflate")).toBe(false);
    expect(acceptsGzip("*;q=0")).toBe(false);
  });

  it("says no when nothing was offered", () => {
    expect(acceptsGzip("")).toBe(false);
    expect(acceptsGzip("deflate, br")).toBe(false);
  });
});
