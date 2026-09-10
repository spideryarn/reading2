/**
 * The browser is the final authority on whether the Questions view is complete.
 * It parses rows, attention and the reconciliation independently, so these
 * tests exercise contradictions a typed server composer cannot produce.
 */
import { describe, expect, it } from "vitest";

import {
  CHECKPOINT_STALE_MS,
  FLEET_STALE_CADENCES,
  SCAN_STALE_MS,
} from "../tools/fleet/question-freshness.js";
import { parseFleetState, questionsAtTime } from "../tools/fleet/web/src/types.js";
import type { FleetState } from "../tools/fleet/web/src/types.js";

const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const FRESH = "2026-09-09T11:59:30.000Z";

function rowQuestion(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    kind: "question",
    prompt: "Which colour?",
    material: { kind: "read", text: "☐ Colour\n\nChoose one", fingerprint: "material-1" },
    options: [
      { label: "Red", consequence: "unknown", key: { via: "digit", digit: "1" } },
      { label: "Blue", consequence: "unknown", key: { via: "digit", digit: "2" } },
    ],
    gate: { kind: "conversation" },
    ...over,
  };
}

function row(id = "$1", question: unknown = rowQuestion()): Record<string, unknown> {
  return {
    id,
    paneId: `%${id.slice(1)}`,
    name: `session-${id.slice(1)}`,
    status: { kind: "needs-you" },
    question,
    panePid: 101,
    claudeSessionId: `00000000-0000-4000-8000-${id.slice(1).padStart(12, "0")}`,
  };
}

function attentionItem(id = "prose-1", sessionId = "$1"): Record<string, unknown> {
  return {
    id,
    sessionId,
    sessionName: `session-${sessionId.slice(1)}`,
    waitingSince: "2026-09-09T11:30:00.000Z",
    kind: "technical",
    evidence: {
      kind: "prose",
      excerpt: "The cache can be strict or compatible; I need the product choice.",
      why: "the turn ended by handing over a product decision",
    },
    answerability: { kind: "phone" },
    duplicates: [],
  };
}

function attention(items: readonly unknown[] = []): Record<string, unknown> {
  return {
    kind: "published",
    coordinatorWrittenAt: FRESH,
    list: { kind: "list", items, sessionsScanned: 3, sessionsUnreadable: 0, scannedAt: FRESH },
  };
}

function dialogItem(rowId = "$1"): Record<string, unknown> {
  return {
    kind: "dialog",
    rowId,
    target: { kind: "addressable", sessionId: rowId, sessionName: `session-${rowId.slice(1)}` },
  };
}

function proseItem(itemId = "prose-1"): Record<string, unknown> {
  return {
    kind: "prose",
    itemId,
    target: { kind: "addressable", sessionId: "$1", sessionName: "session-1" },
    excerpt: "The cache can be strict or compatible; I need the product choice.",
    why: "the turn ended by handing over a product decision",
    waitingSince: "2026-09-09T11:30:00.000Z",
    attentionKind: "technical",
    duplicates: [],
  };
}

function payload(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema: 1,
    servedAt: new Date(NOW).toISOString(),
    rows: [row()],
    collectedAt: FRESH,
    tmuxServerPid: 1,
    tookMs: 10,
    error: null,
    health: null,
    refreshMs: 60_000,
    answeringEnabled: true,
    attemptedAt: FRESH,
    attention: attention(),
    questions: { kind: "complete", items: [dialogItem()] },
    overseer: { kind: "not-asked" },
    usage: { kind: "not-asked" },
    ...over,
  };
}

function read(over: Record<string, unknown> = {}): FleetState {
  const parsed = parseFleetState(payload(over), NOW);
  expect(parsed.ok, parsed.ok ? "" : parsed.why).toBe(true);
  if (!parsed.ok) throw new Error(parsed.why);
  return parsed.state;
}

function gapKinds(state: FleetState): string[] {
  return state.questions.kind === "complete" ? [] : state.questions.gaps.map((gap) => gap.kind);
}

/**
 * **A STATUS IS NOT A CONTRADICTION, AND MAY NOT DOWNGRADE THE VIEW.**
 *
 * The resolver asks whether the payload is self-consistent; the panel asks
 * whether it may offer a button. Only the first is a claim about completeness.
 * A gate saying `conversation` beside material that is not `read` is a real
 * contradiction the server's classifier cannot produce, and earns a gap. A row
 * whose status is `unknown` is exactly what the composer should have sent.
 *
 * Measured 2026-09-09 before this split: a row whose only defect was
 * `status: unknown` turned `complete` into `partial` and drew *"This list may be
 * incomplete."* over a list with nothing missing. `steer.ts § steerableStatus`
 * records that a failing agents call turns every Claude row `unknown` at once,
 * so it fired for every waiting dialog at the same moment — A17, and the second
 * gap this area has had to delete for it.
 */
describe("a non-steerable status withholds the control without claiming the list is short", () => {
  /* The baseline first, so a green below is about the status rather than about
     the fixture never having been complete. */
  it("is complete for an ordinary steerable row", () => {
    expect(read().questions.kind).toBe("complete");
  });

  for (const status of [
    { kind: "waiting" },
    { kind: "no-claude" },
    { kind: "shell" },
    { kind: "unknown", why: "the agents call failed" },
  ]) {
    it(`stays complete for status ${status.kind}`, () => {
      expect(read({ rows: [{ ...row(), status }] }).questions.kind).toBe("complete");
    });
  }

  /* The other half of the pair: a genuine cross-field contradiction still
     downgrades, so this is a narrowing rather than the check switched off. */
  it("still downgrades a conversation gate whose material is not readable", () => {
    const state = read({ rows: [row("$1", rowQuestion({ material: { kind: "no-material" } }))] });
    expect(state.questions.kind).toBe("partial");
    expect(gapKinds(state)).toContain("dialog-source-inconsistent");
  });
});

describe("the Questions field's fifth and sixth states", () => {
  it("keeps an older server's absent field distinct from a present field this page cannot read", () => {
    const absentPayload = payload();
    delete absentPayload.questions;
    const absent = parseFleetState(absentPayload, NOW);
    expect(absent.ok).toBe(true);
    if (!absent.ok) return;
    expect(absent.state.questions).toEqual({
      kind: "partial",
      items: [],
      gaps: [{ kind: "questions-not-reported" }],
    });

    const unreadable = read({ questions: "newer shape" });
    expect(unreadable.questions).toEqual({
      kind: "partial",
      items: [],
      gaps: [{ kind: "questions-unreadable", why: expect.stringContaining("not an object") }],
    });
  });

  it("does not call a complete Questions field complete when its independently parsed attention source is unreadable", () => {
    const state = read({ attention: "not an attention object" });
    expect(gapKinds(state)).toContain("attention-unreadable");
  });
});

describe("reference resolution can only downgrade", () => {
  it("downgrades a reported item set that omits an eligible live dialog", () => {
    const state = read({ questions: { kind: "complete", items: [] } });
    expect(state.questions.kind).toBe("partial");
    expect(gapKinds(state)).toContain("eligible-observation-omitted");
  });

  it("downgrades a reported item set that omits an eligible prose observation", () => {
    const source = attentionItem();
    const state = read({
      rows: [row("$1", { kind: "none" })],
      attention: attention([source]),
      questions: { kind: "complete", items: [] },
    });
    expect(state.questions.kind).toBe("partial");
    expect(gapKinds(state)).toContain("eligible-observation-omitted");
  });

  it("adds no omission gap when an ordinary server composition represents every eligible observation", () => {
    const source = attentionItem();
    const state = read({
      attention: attention([source]),
      questions: { kind: "complete", items: [dialogItem(), proseItem()] },
    });
    expect(state.questions.kind).toBe("complete");
    expect(gapKinds(state)).not.toContain("eligible-observation-omitted");
  });

  it("keeps a dialog card and adds a gap when its row reference dangles", () => {
    const state = read({ rows: [], questions: { kind: "complete", items: [dialogItem("$9")] } });
    expect(state.questions).toMatchObject({ kind: "partial", items: [{ kind: "dialog", rowId: "$9" }] });
    expect(gapKinds(state)).toContain("dialog-reference-unresolved");
  });

  it("keeps a prose card and adds a gap when its attention reference dangles", () => {
    const state = read({ questions: { kind: "complete", items: [proseItem("missing")] } });
    expect(state.questions).toMatchObject({ kind: "partial", items: [{ kind: "prose", itemId: "missing" }] });
    expect(gapKinds(state)).toContain("attention-reference-unresolved");
  });

  it("downgrades independently parsed malformed gates and materials instead of making ordinary dialog cards", () => {
    const badGate = read({ rows: [row("$1", rowQuestion({ gate: { kind: "new-gate" } }))] });
    expect(gapKinds(badGate)).toContain("dialog-source-inconsistent");

    const badMaterial = read({ rows: [row("$1", rowQuestion({ material: { kind: "read", text: "missing fingerprint" } }))] });
    expect(gapKinds(badMaterial)).toContain("dialog-source-inconsistent");
  });

  it("downgrades the impossible conversation plus no-material or unreadable-material combinations", () => {
    for (const material of [{ kind: "no-material" }, { kind: "unreadable", why: "capture clipped" }]) {
      const state = read({ rows: [row("$1", rowQuestion({ material }))] });
      expect(gapKinds(state)).toContain("dialog-source-inconsistent");
      expect(state.questions).toMatchObject({ kind: "partial", items: [{ kind: "dialog", rowId: "$1" }] });
    }
  });

  it("reports rows the client could not parse without discarding valid question cards", () => {
    const state = read({ rows: [row(), { name: "missing-address" }] });
    expect(state.unreadableRows).toBe(1);
    expect(gapKinds(state)).toContain("rows-unreadable");
    expect(state.questions).toMatchObject({ items: [{ kind: "dialog", rowId: "$1" }] });
  });

  it("validates a prose reference against the authoritative attention item", () => {
    const source = attentionItem();
    const state = read({ attention: attention([source]), questions: { kind: "complete", items: [dialogItem(), proseItem()] } });
    expect(state.questions.kind).toBe("complete");

    const changed = proseItem();
    changed.excerpt = "different copied words";
    const inconsistent = read({ attention: attention([source]), questions: { kind: "complete", items: [dialogItem(), changed] } });
    expect(gapKinds(inconsistent)).toContain("attention-reference-unresolved");
    expect(inconsistent.questions.kind).toBe("partial");
    if (inconsistent.questions.kind !== "partial") return;
    expect(inconsistent.questions.items).toEqual(expect.arrayContaining([
      expect.objectContaining({ itemId: "prose-1", excerpt: "different copied words" }),
    ]));
  });

  /* The client half of the same correction: it had its own independent copy of
     the removed gap, so the defect would have survived fixing only the server. */
  it("discards an inbox dialog with no conversation row, in silence", () => {
    const source = {
      ...attentionItem("dialog-1", "$9"),
      evidence: { kind: "dialog", question: "Ship it?", options: ["Yes", "No"] },
    };
    const state = read({ attention: attention([source]) });
    expect(gapKinds(state)).not.toContain("attention-dialog-not-in-rows");
    expect(state.questions).toMatchObject({ kind: "complete" });
  });

  it("parses the stopped-judge gap and re-derives it from a `limited` inbox on its own clock", () => {
    /* Plan 260910f D6: the server composer names the stop; the browser both
       parses that gap strictly and re-derives it from the attention it parsed
       itself, so a server that forgot it still cannot make the view complete. */
    const stopped = { kind: "exhausted", why: "the day's ceiling would be crossed", until: "2026-09-10T00:00:00.000Z" };
    const limited = {
      kind: "published",
      coordinatorWrittenAt: FRESH,
      list: { kind: "limited", items: [], sessionsScanned: 3, sessionsUnreadable: 0, scannedAt: FRESH, stopped },
    };
    const withGap = read({
      attention: limited,
      questions: {
        kind: "partial",
        items: [dialogItem()],
        gaps: [{ kind: "attention-judgement-stopped", why: stopped.why, until: stopped.until }],
      },
    });
    expect(gapKinds(withGap)).toContain("attention-judgement-stopped");
    const forgot = read({ attention: limited, questions: { kind: "complete", items: [dialogItem()] } });
    expect(questionsAtTime(forgot, NOW).kind).toBe("partial");
    const again = questionsAtTime(forgot, NOW);
    expect(again.kind === "complete" ? [] : again.gaps.map((g) => g.kind)).toContain("attention-judgement-stopped");
    /* A gap with no instant is not one this page can draw. */
    const broken = parseFleetState(
      payload({
        attention: limited,
        questions: { kind: "partial", items: [dialogItem()], gaps: [{ kind: "attention-judgement-stopped", why: "x" }] },
      }),
      NOW,
    );
    expect(broken.ok && broken.state.questions.kind !== "complete" ? broken.state.questions.gaps.map((g) => g.kind) : []).toContain(
      "questions-unreadable",
    );
  });

  it("never promotes server partial or not-observed views", () => {
    const partial = read({
      questions: { kind: "partial", items: [dialogItem()], gaps: [{ kind: "collection-failed", why: "earlier failure" }] },
    });
    expect(partial.questions.kind).toBe("partial");

    const notObserved = read({
      questions: { kind: "not-observed", gaps: [{ kind: "attention-not-asked" }] },
    });
    expect(notObserved.questions.kind).toBe("not-observed");
  });
});

describe("freshness is a current-time selector, not a parse-time fact", () => {
  it("uses every shared freshness threshold at the exact boundary and one millisecond beyond it", () => {
    const stamp = new Date(NOW).toISOString();
    const state = read({
      rows: [],
      collectedAt: stamp,
      refreshMs: 137_000,
      attention: {
        kind: "published",
        coordinatorWrittenAt: stamp,
        list: { kind: "list", items: [], sessionsScanned: 3, sessionsUnreadable: 0, scannedAt: stamp },
      },
      questions: { kind: "complete", items: [] },
    });
    const kindsAt = (at: number): string[] => {
      const view = questionsAtTime(state, at);
      return view.kind === "complete" ? [] : view.gaps.map((gap) => gap.kind);
    };

    const fleetDeadline = 137_000 * FLEET_STALE_CADENCES;
    expect(kindsAt(NOW + fleetDeadline)).not.toContain("fleet-snapshot-stale");
    expect(kindsAt(NOW + fleetDeadline + 1)).toContain("fleet-snapshot-stale");
    expect(kindsAt(NOW + CHECKPOINT_STALE_MS)).not.toContain("checkpoint-stale");
    expect(kindsAt(NOW + CHECKPOINT_STALE_MS + 1)).toContain("checkpoint-stale");
    expect(kindsAt(NOW + SCAN_STALE_MS)).not.toContain("attention-scan-stale");
    expect(kindsAt(NOW + SCAN_STALE_MS + 1)).toContain("attention-scan-stale");
  });

  it("lets a complete view age into partial while the page remains open", () => {
    const state = read();
    expect(state.questions.kind).toBe("complete");

    const later = questionsAtTime(state, NOW + 7 * 60_000);
    expect(later.kind).toBe("partial");
    if (later.kind !== "partial") return;
    expect(later.gaps.map((gap) => gap.kind)).toEqual(
      expect.arrayContaining(["fleet-snapshot-stale", "checkpoint-stale", "attention-scan-stale"]),
    );
  });

  it("detects stale data immediately when transport delivers an old complete view", () => {
    const stale = "2026-09-09T11:52:00.000Z";
    const state = read({
      collectedAt: stale,
      attention: {
        ...attention(),
        coordinatorWrittenAt: stale,
        list: { kind: "list", items: [], sessionsScanned: 3, sessionsUnreadable: 0, scannedAt: stale },
      },
    });
    expect(gapKinds(state)).toEqual(
      expect.arrayContaining(["fleet-snapshot-stale", "checkpoint-stale", "attention-scan-stale"]),
    );
  });
});
