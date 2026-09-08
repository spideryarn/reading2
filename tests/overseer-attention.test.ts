/**
 * The attention inbox's DECIDING half — tools/overseer/attention.ts.
 *
 * The list is the small, boring half of the problem and it is built honestly.
 * Fable, 2026-09-08, rejecting the framing before answering it:
 *
 * > A blocked agent is the cheapest thing on the box. It burns no quota, no CPU,
 * > no reviewer time; its only cost is wall-clock and a worktree … The agent
 * > that costs real money is the one that is working, confidently, on the wrong
 * > thing … It never asks. It never appears on a "needs you" list.
 *
 * So nothing here should be mistaken for the whole answer. What it must be is
 * correct about the four decisions the shape carries, which is what this file
 * tests: the evidence union stays two things, there is no score anywhere, the
 * durations are first-seen rather than last-seen, and the PRODUCER sorts.
 *
 * The type-level half is at the bottom, and it is there rather than here for a
 * reason worth knowing: **vitest strips types without looking at them**, so a
 * type-level test cannot go red at `npm test`. It goes red at `npm run
 * typecheck`, which resolves every .ts in the repo — see scripts/typecheck.ts,
 * whose whole second half exists because `tests/` was once checked by nothing.
 */
import { describe, expect, it } from "vitest";

import {
  ATTENTION_KIND_ORDER,
  attentionQuestionKey,
  buildAttentionList,
  rememberWaits,
  waitKey,
  type AttentionObservation,
} from "../tools/overseer/attention.js";
import type {
  AttentionAnswerability,
  AttentionEvidence,
  AttentionItem,
  AttentionKind,
} from "../tools/fleet/wire.js";

const PHONE: AttentionAnswerability = { kind: "phone" };

function prose(topic: string, why = "the turn ended by handing over a decision"): AttentionEvidence {
  return { kind: "prose", excerpt: `… ${topic}`, why };
}

function observation(over: Partial<AttentionObservation> & Pick<AttentionObservation, "sessionId">): AttentionObservation {
  return {
    sessionName: over.sessionId,
    kind: "technical",
    evidence: prose("tests are red"),
    answerability: PHONE,
    topic: "tests are red",
    ...over,
  };
}

/** The memory, built by hand so a test can say exactly how long each thing has waited. */
function waits(entries: readonly (readonly [AttentionObservation, string])[]): ReadonlyMap<string, string> {
  // Through `waitKey`, never a second copy of its spelling. The first draft of
  // this helper wrote the key by hand and got the separator wrong, so every
  // lookup missed and every item was dropped for having no wait — five red
  // tests that all looked like a sorting bug.
  return new Map(entries.map(([o, at]) => [waitKey(o.sessionId, attentionQuestionKey(o)), at]));
}

describe("sorting — kind first, and age only as a tie-breaker", () => {
  it("puts an irreversible question above a technical one that has waited far longer", () => {
    // "The agent that has waited longest is the one for whom ten more minutes
    // matters least." Age is a tie-breaker, not a rank.
    const old = observation({ sessionId: "$1", kind: "technical", topic: "rerun the suite?" });
    const fresh = observation({ sessionId: "$2", kind: "irreversible", topic: "push to main?" });
    const list = buildAttentionList({
      observations: [old, fresh],
      waits: waits([
        [old, "2026-09-08T04:00:00.000Z"],
        [fresh, "2026-09-08T13:59:00.000Z"],
      ]),
      sessionsScanned: 2,
      sessionsRead: 2,
      unclassified: [],
      sessionsUnreadable: 0,
      scannedAt: "2026-09-08T14:00:00.000Z",
    });
    expect(list.kind).toBe("list");
    if (list.kind !== "list") return;
    expect(list.items.map((i) => i.sessionId)).toEqual(["$2", "$1"]);
  });

  it("orders the four kinds by consequence and reversibility, not by name", () => {
    expect(ATTENTION_KIND_ORDER).toEqual(["irreversible", "product", "technical", "other"]);
  });

  it("breaks a tie within one kind by putting the longest wait first", () => {
    const older = observation({ sessionId: "$1", topic: "a" });
    const newer = observation({ sessionId: "$2", topic: "b" });
    const list = buildAttentionList({
      observations: [newer, older],
      waits: waits([
        [older, "2026-09-08T09:00:00.000Z"],
        [newer, "2026-09-08T13:00:00.000Z"],
      ]),
      sessionsScanned: 2,
      sessionsRead: 2,
      unclassified: [],
      sessionsUnreadable: 0,
      scannedAt: "2026-09-08T14:00:00.000Z",
    });
    if (list.kind !== "list") return;
    expect(list.items.map((i) => i.sessionId)).toEqual(["$1", "$2"]);
  });

  it("is total: two items that agree on kind and instant still come back in one fixed order", () => {
    // Astra's interaction rule — "do not reorder or replace a card's options
    // while his finger is approaching them" — needs the sort to be a function of
    // the data, not of the order the sessions happened to be scanned in.
    const a = observation({ sessionId: "$1", topic: "a" });
    const b = observation({ sessionId: "$2", topic: "b" });
    const at = "2026-09-08T09:00:00.000Z";
    const one = buildAttentionList({
      observations: [a, b],
      waits: waits([
        [a, at],
        [b, at],
      ]),
      sessionsScanned: 2,
      sessionsRead: 2,
      unclassified: [],
      sessionsUnreadable: 0,
      scannedAt: at,
    });
    const other = buildAttentionList({
      observations: [b, a],
      waits: waits([
        [a, at],
        [b, at],
      ]),
      sessionsScanned: 2,
      sessionsRead: 2,
      unclassified: [],
      sessionsUnreadable: 0,
      scannedAt: at,
    });
    if (one.kind !== "list" || other.kind !== "list") return;
    expect(other.items.map((i) => i.id)).toEqual(one.items.map((i) => i.id));
  });
});

describe("duplicate collapse — the unit is the question, not the session", () => {
  it("folds three sessions asking the same thing into one item with two duplicates", () => {
    // "At 11pm nobody cares which of 36 asked." And a repeated duplicate is the
    // strongest available signal that a POLICY is missing.
    const one = observation({ sessionId: "$1", sessionName: "alpha", topic: "tests are red, is it me?" });
    const two = observation({ sessionId: "$2", sessionName: "beta", topic: "tests are red, is it me?" });
    const three = observation({ sessionId: "$3", sessionName: "gamma", topic: "tests are red, is it me?" });
    const list = buildAttentionList({
      observations: [two, three, one],
      waits: waits([
        [one, "2026-09-08T09:00:00.000Z"],
        [two, "2026-09-08T10:00:00.000Z"],
        [three, "2026-09-08T11:00:00.000Z"],
      ]),
      sessionsScanned: 3,
      sessionsRead: 3,
      unclassified: [],
      sessionsUnreadable: 0,
      scannedAt: "2026-09-08T14:00:00.000Z",
    });
    if (list.kind !== "list") return;
    expect(list.items).toHaveLength(1);
    const item = list.items[0];
    expect(item?.sessionId).toBe("$1");
    expect(item?.waitingSince).toBe("2026-09-08T09:00:00.000Z");
    expect(item?.duplicates.map((d) => d.sessionId)).toEqual(["$2", "$3"]);
  });

  it("groups by the question and NOT by the session: one session asking two things stays two items", () => {
    const first = observation({ sessionId: "$1", topic: "shall I push to main?", kind: "irreversible" });
    const second = observation({ sessionId: "$1", topic: "which wording do you prefer?", kind: "product" });
    const list = buildAttentionList({
      observations: [first, second],
      waits: waits([
        [first, "2026-09-08T09:00:00.000Z"],
        [second, "2026-09-08T09:00:00.000Z"],
      ]),
      sessionsScanned: 1,
      sessionsRead: 1,
      unclassified: [],
      sessionsUnreadable: 0,
      scannedAt: "2026-09-08T14:00:00.000Z",
    });
    if (list.kind !== "list") return;
    expect(list.items).toHaveLength(2);
  });

  it("never collapses a dialog into a prose item, however alike they read", () => {
    // Decision one, and the bug this stage is most likely to ship. A dialog is
    // OBSERVED and answering it picks one of an enumerated set; prose is
    // INFERRED and answering it means free text at a pane. Merging them would
    // give the dangerous one the easy affordance.
    const spoken = observation({ sessionId: "$1", topic: "shall I deploy?" });
    const drawn = observation({
      sessionId: "$2",
      topic: "shall I deploy?",
      evidence: { kind: "dialog", question: "shall I deploy?", options: ["Yes", "No"] },
    });
    const list = buildAttentionList({
      observations: [spoken, drawn],
      waits: waits([
        [spoken, "2026-09-08T09:00:00.000Z"],
        [drawn, "2026-09-08T09:00:00.000Z"],
      ]),
      sessionsScanned: 2,
      sessionsRead: 2,
      unclassified: [],
      sessionsUnreadable: 0,
      scannedAt: "2026-09-08T14:00:00.000Z",
    });
    if (list.kind !== "list") return;
    expect(list.items).toHaveLength(2);
    expect(new Set(list.items.map((i) => i.evidence.kind))).toEqual(new Set(["prose", "dialog"]));
  });

  it("gives an item an id that survives a duplicate arriving", () => {
    const one = observation({ sessionId: "$1", topic: "same question" });
    const two = observation({ sessionId: "$2", topic: "same question" });
    const before = buildAttentionList({
      observations: [one],
      waits: waits([[one, "2026-09-08T09:00:00.000Z"]]),
      sessionsScanned: 1,
      sessionsRead: 1,
      unclassified: [],
      sessionsUnreadable: 0,
      scannedAt: "2026-09-08T14:00:00.000Z",
    });
    const after = buildAttentionList({
      observations: [one, two],
      waits: waits([
        [one, "2026-09-08T09:00:00.000Z"],
        [two, "2026-09-08T13:00:00.000Z"],
      ]),
      sessionsScanned: 2,
      sessionsRead: 2,
      unclassified: [],
      sessionsUnreadable: 0,
      scannedAt: "2026-09-08T14:00:00.000Z",
    });
    if (before.kind !== "list" || after.kind !== "list") return;
    expect(after.items[0]?.id).toBe(before.items[0]?.id);
  });
});

describe("waitingSince — first-seen, never last-seen", () => {
  it("keeps the instant a question was first seen across later passes", () => {
    // The pane can say a dialog is open; it cannot say for how long. This is why
    // triage arrives first in Greg's ordering and could not be built first.
    const o = observation({ sessionId: "$1", topic: "shall I push?" });
    const first = rememberWaits(new Map(), [o], "2026-09-08T09:00:00.000Z");
    const second = rememberWaits(first, [o], "2026-09-08T13:00:00.000Z");
    expect([...second.values()]).toEqual(["2026-09-08T09:00:00.000Z"]);
  });

  it("forgets a question that stopped being asked, so a returning one is a new wait", () => {
    const o = observation({ sessionId: "$1", topic: "shall I push?" });
    const first = rememberWaits(new Map(), [o], "2026-09-08T09:00:00.000Z");
    const gone = rememberWaits(first, [], "2026-09-08T10:00:00.000Z");
    const back = rememberWaits(gone, [o], "2026-09-08T11:00:00.000Z");
    expect(gone.size).toBe(0);
    expect([...back.values()]).toEqual(["2026-09-08T11:00:00.000Z"]);
  });

  it("holds one wait per session per question, so two sessions asking the same thing wait separately", () => {
    const one = observation({ sessionId: "$1", topic: "same" });
    const two = observation({ sessionId: "$2", topic: "same" });
    const memory = rememberWaits(new Map(), [one], "2026-09-08T09:00:00.000Z");
    const both = rememberWaits(memory, [one, two], "2026-09-08T13:00:00.000Z");
    expect(both.size).toBe(2);
  });
});

describe("the positive control — an empty list is only good news if something looked", () => {
  it("draws a calm fleet and a broken probe differently", () => {
    // docs/reusable/silent-success.md: most of this project's bugs have been
    // something reporting success while doing nothing, with the obvious check
    // agreeing because it shared an assumption with the code.
    const calm = buildAttentionList({
      observations: [],
      waits: new Map(),
      sessionsScanned: 20,
      sessionsRead: 20,
      unclassified: [],
      sessionsUnreadable: 0,
      scannedAt: "2026-09-08T14:00:00.000Z",
    });
    const blind = buildAttentionList({
      observations: [],
      waits: new Map(),
      sessionsScanned: 0,
      sessionsRead: 0,
      unclassified: [],
      sessionsUnreadable: 0,
      scannedAt: "2026-09-08T14:00:00.000Z",
    });
    // ASSERT THE ARMS, NOT MERELY THAT THEY DIFFER. The first version of this
    // test said `expect(blind).not.toEqual(calm)`, which passed because the two
    // counts differed while BOTH were still `kind: "list"` — a broken probe
    // rendering as a fleet with nothing to report. GPT Sol found it, and it is
    // this project's own recurring shape: a check that answers a weaker question
    // than the one it is named for.
    expect(calm.kind).toBe("list");
    if (calm.kind === "list") expect(calm.sessionsScanned).toBe(20);
    expect(blind.kind).toBe("unknown");
    if (blind.kind !== "unknown") return;
    expect(blind.why).toContain("broken probe");
  });

  it("refuses to call it a calm fleet when every pane scanned was unreadable", () => {
    // The hole `sessionsScanned` alone cannot close: twenty scanned and twenty
    // unreadable renders identically to twenty scanned and twenty quiet.
    const list = buildAttentionList({
      observations: [],
      waits: new Map(),
      sessionsScanned: 20,
      sessionsRead: 0,
      unclassified: [],
      sessionsUnreadable: 0,
      scannedAt: "2026-09-08T14:00:00.000Z",
    });
    expect(list.kind).toBe("unknown");
    if (list.kind !== "unknown") return;
    expect(list.why).toContain("20");
  });

  it("still reports a list when some panes read and some did not", () => {
    const o = observation({ sessionId: "$1" });
    const list = buildAttentionList({
      observations: [o],
      waits: waits([[o, "2026-09-08T09:00:00.000Z"]]),
      sessionsScanned: 20,
      sessionsRead: 3,
      unclassified: [],
      sessionsUnreadable: 0,
      scannedAt: "2026-09-08T14:00:00.000Z",
    });
    expect(list.kind).toBe("list");
  });
});

describe("a question we have no wait for", () => {
  it("is dropped rather than dated now, because 0s is a lie about a wait we did not time", () => {
    const o = observation({ sessionId: "$1" });
    const list = buildAttentionList({
      observations: [o],
      waits: new Map(),
      sessionsScanned: 1,
      sessionsRead: 1,
      unclassified: [],
      sessionsUnreadable: 0,
      scannedAt: "2026-09-08T14:00:00.000Z",
    });
    if (list.kind !== "list") return;
    expect(list.items).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * THE TYPE-LEVEL HALF. None of this can go red at `npm test`; it goes red at
 * `npm run typecheck`. Every `@ts-expect-error` below is an assertion that the
 * line under it DOES NOT COMPILE — delete the guard it names and the typecheck
 * fails on the unused directive, which is the check working.
 * ------------------------------------------------------------------ */

/** A prose item and a dialog item cannot be read through one field. */
function _noSharedQuestionField(evidence: AttentionEvidence): string {
  // @ts-expect-error — there is no `question` on the prose arm. A single
  // `question: string` with a boolean beside it would let a renderer draw the
  // same card for both, which is how the dangerous one gets the easy affordance.
  return evidence.question;
}

/** And nothing can reach for options without having decided it holds a dialog. */
function _noSharedOptionsField(evidence: AttentionEvidence): readonly string[] {
  // @ts-expect-error — there are no `options` on the prose arm. Answering prose
  // means free text at a pane whose input box may already hold half a sentence
  // somebody else wrote; answering a dialog picks one of an enumerated set.
  return evidence.options;
}

/** Narrowing on `kind` is the only way through, and it works for both. */
function _narrowingWorks(evidence: AttentionEvidence): string {
  return evidence.kind === "dialog" ? evidence.options.join(", ") : evidence.excerpt;
}

const _item: AttentionItem = {
  id: "abc",
  sessionId: "$1",
  sessionName: "alpha",
  waitingSince: "2026-09-08T09:00:00.000Z",
  kind: "irreversible",
  evidence: { kind: "prose", excerpt: "…", why: "…" },
  answerability: { kind: "phone" },
  duplicates: [],
};

const _scored: AttentionItem = {
  ..._item,
  // @ts-expect-error — NO CONFIDENCE FIELD, EVER. Fable and Astra's A18 reached
  // it independently: ranking by self-reported confidence promotes exactly the
  // confident mistakes you most want caught. `AttentionKind` ranks by
  // consequence and reversibility. If a score turns up in a later draft, it is a
  // regression, and this line is what says so.
  confidence: 0.92,
};

const _routed: AttentionItem = {
  ..._item,
  // @ts-expect-error — no routing field either. Who should answer this is a
  // decision the Overseer ACTS on, not something the phone renders; shipping it
  // as a field invites a UI that shows Greg a queue of things it has decided not
  // to ask him. It lands when something answers, not when something lists.
  routeTo: "sol",
};

/** The four kinds are closed. A fifth would be a change to the ranking, not an addition. */
const _kinds: readonly AttentionKind[] = ["irreversible", "product", "technical", "other"];
// @ts-expect-error — "urgent" is not a kind: this ranks by consequence and
// reversibility, and urgency is the axis that would smuggle a score back in.
const _notAKind: AttentionKind = "urgent";

export type _Unused = [
  typeof _noSharedQuestionField,
  typeof _noSharedOptionsField,
  typeof _narrowingWorks,
  typeof _scored,
  typeof _routed,
  typeof _kinds,
  typeof _notAKind,
];
