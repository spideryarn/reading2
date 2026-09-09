/**
 * The browser is the final authority on whether the Questions view is complete.
 * It parses rows, attention and the reconciliation independently, so these
 * tests exercise contradictions a typed server composer cannot produce.
 */
import { describe, expect, it } from "vitest";

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
    const state = read({ attention: attention([source]), questions: { kind: "complete", items: [proseItem()] } });
    expect(state.questions.kind).toBe("complete");

    const changed = proseItem();
    changed.excerpt = "different copied words";
    const inconsistent = read({ attention: attention([source]), questions: { kind: "complete", items: [changed] } });
    expect(gapKinds(inconsistent)).toContain("attention-reference-unresolved");
    expect(inconsistent.questions).toMatchObject({ items: [{ itemId: "prose-1", excerpt: "different copied words" }] });
  });

  it("recovers the completeness gap when an inbox dialog has no conversation row", () => {
    const source = {
      ...attentionItem("dialog-1", "$9"),
      evidence: { kind: "dialog", question: "Ship it?", options: ["Yes", "No"] },
    };
    const state = read({ attention: attention([source]) });
    expect(gapKinds(state)).toContain("attention-dialog-not-in-rows");
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
