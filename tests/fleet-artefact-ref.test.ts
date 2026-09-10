import { describe, expect, it } from "vitest";

import {
  DECISION_ID_RULE,
  MAX_ARTEFACTS,
  QUEUE_ID_RULE,
  artefactHref,
  describeArtefactCheck,
  parseArtefactCheck,
  parseArtefactRef,
  parseArtefactSpec,
  parseCheckedArtefacts,
  pathProblem,
  spellArtefactRef,
  untrustedTextProblem,
  type CheckedArtefact,
} from "../tools/fleet/artefact-ref.js";
import { ID_RULE as DECISIONS_ID_RULE } from "../tools/overseer/decisions.js";
import { ID_RULE as QUEUE_OWNER_ID_RULE } from "../tools/overseer/idea-queue.js";

const BELL = String.fromCharCode(7);
const RLO = String.fromCharCode(0x202e);

describe("the id rules restated here match their owners", () => {
  it("decision and queue ids", () => {
    expect(DECISION_ID_RULE.source).toBe(DECISIONS_ID_RULE.source);
    expect(QUEUE_ID_RULE.source).toBe(QUEUE_OWNER_ID_RULE.source);
  });
});

describe("untrusted text", () => {
  it("accepts plain prose and refuses control and bidi characters", () => {
    expect(untrustedTextProblem("stage 1 green, 42 tests", 100)).toBeNull();
    expect(untrustedTextProblem(`ring${BELL}`, 100)).toMatch(/control/);
    expect(untrustedTextProblem("tab\there", 100)).toMatch(/control/);
    expect(untrustedTextProblem(`abc${RLO}fed`, 100)).toMatch(/bidirectional/);
    expect(untrustedTextProblem("x".repeat(101), 100)).toMatch(/longer than 100/);
  });
});

describe("paths", () => {
  it.each([
    ["../etc/passwd", /'\.' or '\.\.'/],
    ["docs/../../x", /'\.' or '\.\.'/],
    ["docs/./x.md", /'\.' or '\.\.'/],
    ["/etc/passwd", /absolute/],
    ["docs//x.md", /empty segment/],
    ["javascript:alert(1)", /only letters/],
    ["docs\\x.md", /only letters/],
    ["docs/has space.md", /only letters/],
    ["", /empty/],
  ])("refuses %j", (path, why) => {
    expect(pathProblem(path)).toMatch(why);
  });

  it("accepts an ordinary repo path", () => {
    expect(pathProblem("docs/plans/260910e-work-reports-and-decisions-a-small-event-vocabulary.md")).toBeNull();
  });
});

describe("parsing", () => {
  it("round-trips every kind through the CLI spelling", () => {
    for (const spec of ["commit:ceb2e9d7", "path:tools/fleet/artefact-ref.ts", "decision:dec-a3k9mq2p", "queue:qi-evwdxpkf"]) {
      const parsed = parseArtefactSpec(spec);
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(spellArtefactRef(parsed.ref)).toBe(spec);
    }
  });

  it("refuses a non-hex sha, an unknown kind and a missing kind", () => {
    expect(parseArtefactSpec("commit:XYZ1234").ok).toBe(false);
    expect(parseArtefactSpec("commit:abc").ok).toBe(false);
    expect(parseArtefactSpec("url:https://example.com").ok).toBe(false);
    expect(parseArtefactSpec("ceb2e9d7").ok).toBe(false);
    expect(parseArtefactRef({ kind: "path", path: "../x" })).toBeNull();
  });

  it("refuses a check that does not fit its kind, and too many artefacts", () => {
    const commit = { kind: "commit", sha: "ceb2e9d7" };
    expect(parseCheckedArtefacts([{ ref: commit, check: { state: "found" } }])).toBeNull();
    expect(parseCheckedArtefacts([{ ref: { kind: "decision", id: "dec-a3k9mq2p" }, check: { state: "on-dev" } }])).toBeNull();
    expect(parseCheckedArtefacts([{ ref: commit, check: { state: "on-dev" } }])).toHaveLength(1);
    const many = Array.from({ length: MAX_ARTEFACTS + 1 }, () => ({ ref: commit, check: { state: "not-found" } }));
    expect(parseCheckedArtefacts(many)).toBeNull();
    expect(parseArtefactCheck({ state: "unchecked", why: "" })).toBeNull();
    expect(parseArtefactCheck({ state: "unchecked", why: `git${BELL}` })).toBeNull();
  });
});

describe("links", () => {
  const item = (ref: CheckedArtefact["ref"], check: CheckedArtefact["check"]): CheckedArtefact => ({ ref, check });

  it("links a commit or path only when it is on dev, encoding every segment", () => {
    expect(artefactHref(item({ kind: "commit", sha: "ceb2e9d7" }, { state: "on-dev" }))).toBe(
      "https://github.com/spideryarn/reading2/commit/ceb2e9d7",
    );
    expect(artefactHref(item({ kind: "commit", sha: "ceb2e9d7" }, { state: "found-locally" }))).toBeNull();
    expect(artefactHref(item({ kind: "path", path: "docs/a+b@c.md" }, { state: "on-dev" }))).toBe(
      "https://github.com/spideryarn/reading2/blob/dev/docs/a%2Bb%40c.md",
    );
    expect(artefactHref(item({ kind: "path", path: "docs/x.md" }, { state: "not-found" }))).toBeNull();
  });

  it("anchors a found decision, never links a queue item, and refuses an unvalidated ref", () => {
    expect(artefactHref(item({ kind: "decision", id: "dec-a3k9mq2p" }, { state: "found" }))).toBe("#decision-dec-a3k9mq2p");
    expect(artefactHref(item({ kind: "decision", id: "dec-a3k9mq2p" }, { state: "not-found" }))).toBeNull();
    expect(artefactHref(item({ kind: "queue-item", id: "qi-evwdxpkf" }, { state: "found" }))).toBeNull();
    expect(artefactHref(item({ kind: "path", path: "javascript:alert(1)" }, { state: "on-dev" }))).toBeNull();
  });

  it("says what the check found in words", () => {
    expect(describeArtefactCheck({ state: "not-found" })).toBe("not found at receipt");
    expect(describeArtefactCheck({ state: "unchecked", why: "git timed out" })).toBe("not checked: git timed out");
  });
});
