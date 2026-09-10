/**
 * The Questions view's server composition, before there is a panel to hide a
 * bad answer behind.
 *
 * The important assertion is not that cards can be assembled. It is that an
 * empty list is reassuring only after BOTH independent observers supplied a
 * fresh, complete reading. Every test below removes one positive control at a
 * time, because `{items: []}` is also what every broken probe naturally emits.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CHECKPOINT_STALE_MS,
  FLEET_STALE_CADENCES,
  SCAN_STALE_MS,
} from "../tools/fleet/question-freshness.js";
import type { FleetRow, FleetSnapshot } from "../tools/fleet/collect.js";
import { parsePane, type PaneQuestion } from "../tools/fleet/pane.js";
import { composeQuestions } from "../tools/fleet/questions.js";
import { statePayload } from "../tools/fleet/state.js";
import type { AttentionFeed, AttentionItem, QuestionGap, QuestionItem } from "../tools/fleet/wire.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures/fleet-panes");
const NOW = Date.parse("2026-09-09T12:00:00.000Z");
const FRESH = "2026-09-09T11:59:30.000Z";

function fixtureQuestion(name: string): PaneQuestion {
  return parsePane(readFileSync(path.join(FIXTURES, name), "utf8"));
}

function row(
  id: string,
  question: PaneQuestion | null,
  over: Partial<Pick<FleetRow, "name" | "paneId" | "claudeSessionId" | "status" | "execution">> = {},
): FleetRow {
  /* The composer deliberately reads only this projection. Keeping the fixture
     typed as FleetRow catches field renames while avoiding a page of unrelated
     health, pause and metadata setup in every test. */
  return {
    id,
    name: over.name ?? `session-${id.slice(1)}`,
    paneId: over.paneId === undefined ? `%${id.slice(1)}` : over.paneId,
    claudeSessionId: over.claudeSessionId === undefined ? `00000000-0000-4000-8000-${id.slice(1).padStart(12, "0")}` : over.claudeSessionId,
    status: over.status ?? { kind: "needs-you" },
    question,
    execution: over.execution ?? { kind: "unknown", why: "not relevant to this composition", cause: "not-probed" },
  } as FleetRow;
}

function attentionItem(
  id: string,
  sessionId: string,
  evidence: AttentionItem["evidence"],
  over: Partial<AttentionItem> = {},
): AttentionItem {
  return {
    id,
    sessionId,
    sessionName: `session-${sessionId.slice(1)}`,
    waitingSince: "2026-09-09T11:30:00.000Z",
    kind: "technical",
    evidence,
    answerability: { kind: "phone" },
    duplicates: [],
    ...over,
  };
}

function published(items: readonly AttentionItem[] = [], over: Record<string, unknown> = {}): AttentionFeed {
  return {
    kind: "published",
    coordinatorWrittenAt: FRESH,
    list: { kind: "list", items, sessionsScanned: 3, sessionsUnreadable: 0, scannedAt: FRESH },
    ...over,
  } as AttentionFeed;
}

function compose(over: Partial<Parameters<typeof composeQuestions>[0]> = {}) {
  return composeQuestions({
    rows: [],
    attentionFeed: published(),
    collectionError: null,
    collectedAt: FRESH,
    refreshMs: 60_000,
    now: NOW,
    ...over,
  });
}

function items(view: ReturnType<typeof composeQuestions>): readonly QuestionItem[] {
  return view.kind === "not-observed" ? [] : view.items;
}

function gaps(view: ReturnType<typeof composeQuestions>): readonly QuestionGap[] {
  return view.kind === "complete" ? [] : view.gaps;
}

function gapKinds(view: ReturnType<typeof composeQuestions>): string[] {
  return gaps(view).map((gap) => gap.kind);
}

describe("composeQuestions: the pane owns dialogs", () => {
  it("admits a real conversation fixture and excludes real permission and unknown-gate fixtures", () => {
    const conversation = fixtureQuestion("dialog-ask-user-question-colour.txt");
    const permission = fixtureQuestion("dialog-bash-permission.txt");
    const unknown = fixtureQuestion("dialog-loop-cloud-schedule.txt");
    expect(conversation.kind === "question" ? conversation.gate.kind : null).toBe("conversation");
    expect(permission.kind === "question" ? permission.gate.kind : null).toBe("permission");
    expect(unknown.kind === "question" ? unknown.gate.kind : null).toBe("unknown");

    const view = compose({ rows: [row("$1", conversation), row("$2", permission), row("$3", unknown)] });
    expect(view.kind).toBe("complete");
    expect(items(view)).toMatchObject([{ kind: "dialog", rowId: "$1" }]);
  });

  it("keeps one dialog card per row even when the questions are byte-for-byte identical", () => {
    const question = fixtureQuestion("dialog-ask-user-question-colour.txt");
    expect(items(compose({ rows: [row("$1", question), row("$2", question)] }))).toMatchObject([
      { kind: "dialog", rowId: "$1" },
      { kind: "dialog", rowId: "$2" },
    ]);
  });

  it("keeps a typed conversation observation visible when either half of its steerable address is absent", () => {
    const question = fixtureQuestion("dialog-ask-user-question-colour.txt");
    /* Neither shape can be produced by the real collector: without a pane it
       cannot capture the question. These are typed unit inputs to the pure
       composer, exercising the defensive contract at its actual seam. */
    const view = compose({
      rows: [
        row("$1", question, { paneId: null }),
        row("$2", question, { claudeSessionId: null }),
      ],
    });
    expect(items(view)).toMatchObject([
      { kind: "dialog-unaddressable", rowId: "$1", target: { kind: "unaddressable", why: expect.stringContaining("pane") } },
      {
        kind: "dialog-unaddressable",
        rowId: "$2",
        target: { kind: "unaddressable", why: expect.stringContaining("conversation") },
      },
    ]);
  });
});

describe("composeQuestions: the inbox owns prose", () => {
  const prose = attentionItem("prose-1", "$1", {
    kind: "prose",
    excerpt: "The cache can be strict or compatible; I need the product choice.",
    why: "the turn ended by handing over a product decision",
  });

  it("keeps prose beside a later conversation dialog, and beside a permission dialog that supplies no card", () => {
    const conversation = fixtureQuestion("dialog-ask-user-question-colour.txt");
    const permission = fixtureQuestion("dialog-bash-permission.txt");

    expect(items(compose({ rows: [row("$1", conversation)], attentionFeed: published([prose]) })).map((x) => x.kind)).toEqual([
      "dialog",
      "prose",
    ]);
    expect(items(compose({ rows: [row("$1", permission)], attentionFeed: published([prose]) })).map((x) => x.kind)).toEqual([
      "prose",
    ]);
  });

  it("does not turn an address lookup into permission to write, even after the execution under it changes", () => {
    const replaced = row("$1", { kind: "none" }, {
      execution: {
        kind: "verified",
        token: { boot: "new-boot", pid: 991, startTicks: 88 },
        harness: "claude-code",
        conversation: { kind: "verified", id: "9f2c41a7-6b5e-4d38-9a10-7c4e2b8f0d62" },
      },
    });
    const item = items(compose({ rows: [replaced], attentionFeed: published([prose]) }))[0];
    expect(item).toMatchObject({ kind: "prose", itemId: "prose-1", target: { kind: "addressable", sessionId: "$1" } });
    /* NOT A LIST OF THREE BANNED NAMES, which is what this was and which a
       future `send` or `canAnswer` would walk straight past. The prose arms are
       read-only by a decision taken under gate 2, so the guard is an allow-list
       of the keys those arms may carry: anything new has to be added here
       deliberately, and a write-shaped field cannot arrive by accident. */
    const ALLOWED = ["kind", "itemId", "target", "excerpt", "why", "waitingSince", "attentionKind", "duplicates"];
    expect(Object.keys(item as object).sort()).toEqual([...ALLOWED].sort());
  });

  it("keeps a prose card with no row, and records addressability independently for every duplicate", () => {
    const grouped = { ...prose, duplicates: [{ sessionId: "$2", sessionName: "duplicate", waitingSince: FRESH }] };
    const view = compose({ rows: [row("$2", { kind: "none" }, { name: "duplicate", paneId: null })], attentionFeed: published([grouped]) });
    expect(items(view)).toMatchObject([
      {
        kind: "prose-unaddressable",
        itemId: "prose-1",
        target: { kind: "unaddressable", why: expect.stringContaining("no fleet row") },
        duplicates: [{ kind: "unaddressable", sessionId: "$2", why: expect.stringContaining("pane") }],
      },
    ]);
  });

  /* THE ASSERTION IS THE SILENCE, and it replaces one that pinned the opposite.
     An inbox dialog the pane no longer shows is ordinary observer lag — the two
     run at ~2 min and ~73 s — so raising a gap put the page in `partial` for
     about two minutes per answered dialog, which across a fleet is most of the
     time. GPT Sol's P1 on the built code. `questions.ts` § composeAttentionItem
     has the argument and why the honest version cannot be written. */
  it("records mixed addressability across a prose item's members, both ways round", () => {
    const grouped = { ...prose, duplicates: [{ sessionId: "$2", sessionName: "duplicate", waitingSince: FRESH }] };

    // Addressable primary, unaddressable duplicate.
    const first = compose({
      rows: [row("$1", { kind: "none" }), row("$2", { kind: "none" }, { name: "duplicate", paneId: null })],
      attentionFeed: published([grouped]),
    });
    expect(items(first)).toMatchObject([
      { kind: "prose", target: { kind: "addressable" }, duplicates: [{ kind: "unaddressable" }] },
    ]);

    // Unaddressable primary, addressable duplicate — the arm follows the
    // PRIMARY, and the duplicate's own addressability is still recorded.
    const second = compose({
      rows: [row("$1", { kind: "none" }, { paneId: null }), row("$2", { kind: "none" }, { name: "duplicate" })],
      attentionFeed: published([grouped]),
    });
    expect(items(second)).toMatchObject([
      { kind: "prose-unaddressable", target: { kind: "unaddressable" }, duplicates: [{ kind: "addressable" }] },
    ]);
  });

  it("discards an inbox dialog the pane no longer shows, in silence", () => {
    const dialog = attentionItem("dialog-1", "$9", { kind: "dialog", question: "Ship it?", options: ["Yes", "No"] });

    // No row at all for that session.
    const gone = compose({ attentionFeed: published([dialog]) });
    expect(items(gone)).toEqual([]);
    expect(gone).toMatchObject({ kind: "complete" });

    // A row that positively saw no dialog — the pane is the authority.
    const answered = compose({ rows: [row("$9", { kind: "none" })], attentionFeed: published([dialog]) });
    expect(items(answered)).toEqual([]);
    expect(answered).toMatchObject({ kind: "complete" });
  });

  /* The other half of the same rule: a row that IS parked and whose question
     could not be read is genuinely missing data, and keeps its own gap — which
     is the one `observeFleet` already had a better name for. */
  it("still reports a needs-you row whose question could not be read, and stays silent when it positively saw none", () => {
    const unreadable = compose({ rows: [row("$9", null, { status: { kind: "needs-you" } })] });
    expect(gapKinds(unreadable)).toContain("row-question-unreadable");

    const sawNone = compose({ rows: [row("$9", { kind: "none" }, { status: { kind: "needs-you" } })] });
    expect(gapKinds(sawNone)).not.toContain("row-question-unreadable");
    expect(sawNone).toMatchObject({ kind: "complete" });
  });

  /* Sol's P2: a list nobody could read is not an observation, so it must not
     help the composer decide it saw enough to be `partial`. */
  it("treats an all-unreadable or zero-scanned inbox as no observation at all", () => {
    /* `published`'s override spreads over the FEED, not into the list, so the
       list is given whole here rather than by naming its two counts. */
    const list = (over: Record<string, unknown>) =>
      published([], { list: { kind: "list", items: [], sessionsScanned: 3, sessionsUnreadable: 0, scannedAt: FRESH, ...over } });

    const nothingRead = compose({ collectedAt: null, attentionFeed: list({ sessionsUnreadable: 3 }) });
    expect(nothingRead.kind).toBe("not-observed");

    const noneScanned = compose({ collectedAt: null, attentionFeed: list({ sessionsScanned: 0 }) });
    expect(noneScanned.kind).toBe("not-observed");
  });

  /* Sol's P2: a deadline that is not a number makes every comparison false, so
     an arbitrarily old snapshot would read as fresh and hold `complete` open. */
  it("treats an unusable refresh cadence as stale rather than as no deadline", () => {
    const view = compose({ refreshMs: Number.NaN });
    expect(gapKinds(view)).toContain("fleet-snapshot-stale");
  });
});

describe("composeQuestions: every silence remains distinct", () => {
  const cases: { name: string; input: Partial<Parameters<typeof composeQuestions>[0]>; gap: QuestionGap["kind"] }[] = [
    { name: "the server did not ask for the inbox", input: { attentionFeed: { kind: "not-asked" } }, gap: "attention-not-asked" },
    { name: "the checkpoint was absent", input: { attentionFeed: { kind: "checkpoint-absent" } }, gap: "checkpoint-absent" },
    {
      name: "the checkpoint was unreadable",
      input: { attentionFeed: { kind: "checkpoint-unreadable", why: "bad JSON" } },
      gap: "checkpoint-unreadable",
    },
    {
      name: "the attention pass could not judge",
      input: { attentionFeed: published([], { list: { kind: "unknown", why: "gateway 429", scannedAt: FRESH } }) },
      gap: "attention-list-unknown",
    },
    {
      name: "one attention session was unreadable",
      input: {
        attentionFeed: published([], {
          list: { kind: "list", items: [], sessionsScanned: 3, sessionsUnreadable: 1, scannedAt: FRESH },
        }),
      },
      gap: "attention-sessions-unreadable",
    },
    {
      name: "the attention pass scanned zero sessions",
      input: {
        attentionFeed: published([], {
          list: { kind: "list", items: [], sessionsScanned: 0, sessionsUnreadable: 0, scannedAt: FRESH },
        }),
      },
      gap: "attention-no-sessions-scanned",
    },
    { name: "no fleet collection completed", input: { collectedAt: null }, gap: "collection-not-observed" },
    { name: "the last fleet collection failed", input: { collectionError: "tmux refused" }, gap: "collection-failed" },
    { name: "a blocked row's question was unreadable", input: { rows: [row("$1", null)] }, gap: "row-question-unreadable" },
    { name: "the fleet snapshot was stale", input: { collectedAt: "2026-09-09T11:56:00.000Z" }, gap: "fleet-snapshot-stale" },
    {
      name: "the checkpoint was stale",
      input: { attentionFeed: published([], { coordinatorWrittenAt: "2026-09-09T11:54:00.000Z" }) },
      gap: "checkpoint-stale",
    },
    {
      name: "the attention scan was stale",
      input: {
        attentionFeed: published([], {
          list: { kind: "list", items: [], sessionsScanned: 3, sessionsUnreadable: 0, scannedAt: "2026-09-09T11:53:00.000Z" },
        }),
      },
      gap: "attention-scan-stale",
    },
  ];

  for (const { name, input, gap } of cases) {
    it(`${name} → ${gap}`, () => {
      const view = compose(input);
      expect(view.kind).not.toBe("complete");
      expect(gapKinds(view)).toContain(gap);
    });
  }

  it("uses not-observed only when neither source supplied a usable observation", () => {
    const view = compose({ collectedAt: null, attentionFeed: { kind: "not-asked" } });
    expect(view).toMatchObject({
      kind: "not-observed",
      gaps: [{ kind: "collection-not-observed" }, { kind: "attention-not-asked" }],
    });
  });

  it("keeps a genuinely empty partial observation from becoming reassurance", () => {
    expect(compose({ attentionFeed: { kind: "checkpoint-absent" } })).toEqual({
      kind: "partial",
      items: [],
      gaps: [{ kind: "checkpoint-absent" }],
    });
  });

  it("returns a complete empty view only with fresh positive controls from both sources", () => {
    expect(compose()).toEqual({ kind: "complete", items: [] });
  });
});

describe("Questions freshness policy has one runtime home", () => {
  it("is imported by both the server composer and browser selector", () => {
    const server = readFileSync(path.resolve(import.meta.dirname, "../tools/fleet/questions.ts"), "utf8");
    const client = readFileSync(path.resolve(import.meta.dirname, "../tools/fleet/web/src/types.ts"), "utf8");
    for (const name of ["FLEET_STALE_CADENCES", "CHECKPOINT_STALE_MS", "SCAN_STALE_MS"]) {
      expect(server).toContain(name);
      expect(client).toContain(name);
    }
    expect(server).toContain('from "./question-freshness.js"');
    expect(client).toContain('from "../../question-freshness.js"');

    const thresholdCases = [
      {
        gap: "fleet-snapshot-stale",
        at: (age: number) => compose({ refreshMs: 137_000, collectedAt: new Date(NOW - age).toISOString() }),
        deadline: 137_000 * FLEET_STALE_CADENCES,
      },
      {
        gap: "checkpoint-stale",
        at: (age: number) => compose({
          attentionFeed: published([], { coordinatorWrittenAt: new Date(NOW - age).toISOString() }),
        }),
        deadline: CHECKPOINT_STALE_MS,
      },
      {
        gap: "attention-scan-stale",
        at: (age: number) => compose({
          attentionFeed: published([], {
            list: { kind: "list", items: [], sessionsScanned: 3, sessionsUnreadable: 0, scannedAt: new Date(NOW - age).toISOString() },
          }),
        }),
        deadline: SCAN_STALE_MS,
      },
    ] as const;
    for (const current of thresholdCases) {
      expect(gapKinds(current.at(current.deadline))).not.toContain(current.gap);
      expect(gapKinds(current.at(current.deadline + 1))).toContain(current.gap);
    }
  });
});

describe("the production payload composition", () => {
  it("reads the checkpoint once and puts questions beside the exact attention reading from it", () => {
    let reads = 0;
    const stamp = new Date().toISOString();
    const snapshot: FleetSnapshot = { rows: [], tmuxServerPid: 1, collectedAt: stamp, tookMs: 12 };
    const attentionFeed = published([], {
      coordinatorWrittenAt: stamp,
      list: { kind: "list", items: [], sessionsScanned: 3, sessionsUnreadable: 0, scannedAt: stamp },
    });
    const payload = JSON.parse(
      statePayload({
        snapshot,
        error: null,
        health: null,
        refreshMs: 60_000,
        answeringEnabled: true,
        attemptedAt: stamp,
        producer: { instance: "1a2b3c4d", publication: 1, inventory: 1 },
        readCheckpoint: () => {
          reads += 1;
          return {
            attention: attentionFeed,
            overseer: { kind: "not-asked" },
            usage: { kind: "not-asked" },
            accountUsage: { kind: "not-asked" },
            work: { kind: "checkpoint-absent" },
          };
        },
      }),
    ) as Record<string, unknown>;

    expect(reads).toBe(1);
    expect(payload.attention).toEqual(attentionFeed);
    expect(payload.questions).toEqual({ kind: "complete", items: [] });
  });

  it("keeps the Questions reconciliation small when a dialog carries a large body", () => {
    const marker = "MATERIAL-THAT-MUST-NOT-BE-COPIED-";
    const text = marker.repeat(2_500);
    const question: PaneQuestion = {
      kind: "question",
      prompt: "Choose a migration",
      material: { kind: "read", text, fingerprint: "large-material" },
      options: [
        { label: "A", consequence: "unknown", key: { via: "digit", digit: "1" } },
        { label: "B", consequence: "unknown", key: { via: "digit", digit: "2" } },
      ],
      gate: { kind: "conversation" },
    };
    const view = compose({ rows: [row("$1", question)] });
    const encoded = JSON.stringify(view);
    expect(encoded).not.toContain(marker);
    expect(encoded.length).toBeLessThan(500);
    expect(items(view)).toEqual([
      {
        kind: "dialog",
        rowId: "$1",
        target: { kind: "addressable", sessionId: "$1", sessionName: "session-1" },
      },
    ]);
  });
});
