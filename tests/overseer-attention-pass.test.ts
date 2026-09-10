/**
 * One pass over a fleet — tools/overseer/attention-pass.ts.
 *
 * Driven against REAL CAPTURES with an injected classifier, so the pass can be
 * exercised on the panes the live box actually produces without tmux and without
 * spending anything. The fixtures under tests/fixtures/overseer-turn-tails/ named
 * `ended-*`, `mid-turn-*` and `no-input-box-*` were taken with
 * `tmux capture-pane -p` on this box on 2026-09-08, read only; the rest are
 * hand-written for plan 260910f's labelled set (labels.json beside them).
 *
 * THE THING THIS FILE IS REALLY ABOUT is the accounting. An empty inbox is the
 * output the whole system is trying to earn, and it is also what a completely
 * broken probe produces — so every session must land in exactly one bucket, the
 * buckets must sum to what was scanned, and "twenty scanned and none readable"
 * must not draw as "twenty scanned and all quiet"
 * (docs/reusable/silent-success.md).
 */
import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import type { UsageVerdict } from "../tools/fleet/wire.js";
import type { CacheableVerdict, ClassifierVerdict } from "../tools/overseer/attention-classify.js";
import {
  ATTENTION_CLASSIFIER_MODEL,
  CLASSIFIER_PROMPT_VERSION,
  NO_SPEND,
  PROPOSAL_PROMPT_VERSION,
} from "../tools/overseer/attention-classify.js";
import type { AttentionMemory } from "../tools/overseer/attention-memory.js";
import type { ClassifyOutcome } from "../tools/overseer/model-budget.js";
import {
  breakdownBalances,
  runAttentionPass,
  sessionsRead,
  type SessionToScan,
} from "../tools/overseer/attention-pass.js";

function pane(name: string): string {
  return readFileSync(new URL(`./fixtures/overseer-turn-tails/${name}`, import.meta.url), "utf8");
}

function fleetPane(name: string): string {
  return readFileSync(new URL(`./fixtures/fleet-panes/${name}`, import.meta.url), "utf8");
}

const NOW = () => new Date("2026-09-08T14:00:00.000Z");

/** A fleet built out of named fixtures: `[sessionName, fixture]`, paneIds minted in order. */
function fleetOf(panes: readonly (readonly [string, string])[]): {
  sessions: SessionToScan[];
  capture: (paneId: string) => string;
} {
  const sessions = panes.map(([name], i) => ({
    sessionId: `$${i + 1}`,
    sessionName: name,
    paneId: `%${i + 1}`,
  }));
  const byPane = new Map(panes.map(([, text], i) => [`%${i + 1}`, text]));
  return {
    sessions,
    capture: (paneId) => {
      const text = byPane.get(paneId);
      if (text === undefined) throw new Error(`no pane ${paneId}`);
      return text;
    },
  };
}

const askedSomething: ClassifierVerdict = {
  kind: "question",
  topic: "whether to shut the stack down",
  why: "it named an action and stopped, waiting for the word",
  attentionKind: "technical",
  answerability: { kind: "phone" },
};
const askedNothing: ClassifierVerdict = { kind: "no-question", why: "a status report" };

/** A version-2 answer about the shut-it-down fixture, naming `recipient`. Its quote IS in that fixture's tail. */
function proposing(recipient: "sol" | "fable" | "greg" | "overseer" | "self"): ClassifierVerdict {
  return {
    ...askedSomething,
    recipient,
    reason: `it is ${recipient}'s kind of question`,
    asks: "Say the word and I'll shut it down.",
  } as ClassifierVerdict;
}

const USAGE_OK: UsageVerdict = { level: "ok", reasons: [], activeLimit: null };
const USAGE_LIMITED: UsageVerdict = { level: "limited", reasons: ["a 429 on the five-hour window"], activeLimit: null };

describe("the accounting, which is the positive control", () => {
  it("puts every session in exactly one bucket", async () => {
    const { sessions, capture } = fleetOf([
      ["asks", pane("ended-prose-question-shut-it-down.txt")],
      ["reports", pane("ended-prose-no-question-status-report.txt")],
      ["busy", pane("mid-turn-spinner.txt")],
      ["codex", pane("no-input-box-codex-tui.txt")],
      ["shell", pane("no-input-box-job-shell.txt")],
    ]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    expect(breakdownBalances(result.breakdown)).toBe(true);
    expect(result.breakdown.scanned).toBe(5);
    expect(result.breakdown.endedTurns).toBe(2);
    expect(result.breakdown.midTurn).toBe(1);
    expect(result.breakdown.noInputBox).toBe(2);
    expect(sessionsRead(result.breakdown)).toBe(5);
  });

  it("counts a pane that went away, and does not count it as read", async () => {
    const { sessions } = fleetOf([["gone", pane("mid-turn-spinner.txt")]]);
    const result = await runAttentionPass({
      sessions,
      capture: () => {
        throw new Error("no such pane");
      },
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    expect(result.breakdown.captureFailed).toBe(1);
    expect(sessionsRead(result.breakdown)).toBe(0);
    expect(breakdownBalances(result.breakdown)).toBe(true);
  });

  it("says it could not tell, rather than that nothing needs you, when nothing could be read", async () => {
    // Twenty scanned and twenty unreadable must not draw as a calm fleet. This is
    // the hole `sessionsScanned` alone leaves open.
    const { sessions } = fleetOf([
      ["a", pane("mid-turn-spinner.txt")],
      ["b", pane("mid-turn-spinner.txt")],
    ]);
    const result = await runAttentionPass({
      sessions,
      capture: () => {
        throw new Error("no such pane");
      },
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    expect(result.list.kind).toBe("unknown");
  });

  it("never draws a calm fleet when a classifier call failed", async () => {
    // GPT SOL'S FINDING 1, AND IT IS THE ONE THIS WHOLE STAGE IS ABOUT. One ended
    // turn; OpenRouter returns 429; the verdict is `unreadable`; no observation is
    // produced. Before the fix the published result was
    // `{"kind":"list","items":[],"sessionsScanned":1}` — an empty inbox drawn from
    // a classifier that never answered, indistinguishable from a quiet fleet.
    // `breakdownBalances()` was green throughout, because every row DID enter a
    // bucket: it proves the accounting, not that the deciding half ran.
    const { sessions, capture } = fleetOf([["asks", pane("ended-prose-question-shut-it-down.txt")]]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({
        verdict: { kind: "unreadable", why: "the gateway returned 429" },
        spend: { ...NO_SPEND, calls: 1 },
        model: ATTENTION_CLASSIFIER_MODEL,
      }),
      maxCalls: 10,
      now: NOW,
    });
    expect(result.list.kind).toBe("unknown");
    if (result.list.kind !== "unknown") return;
    expect(result.list.why).toContain("429");
  });

  it("never caches an unreadable verdict, so a 429 does not become permanent", async () => {
    // The half that makes finding 1 lethal rather than transient: the failed
    // verdict was cached under the tail's fingerprint, so every later pass over
    // an unchanged fleet answered from memory, made zero calls, and repeated the
    // calm result for as long as the agent said nothing new.
    const { sessions, capture } = fleetOf([["asks", pane("ended-prose-question-shut-it-down.txt")]]);
    const first = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: { kind: "unreadable", why: "429" }, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    let calls = 0;
    const second = await runAttentionPass({
      sessions,
      capture,
      classify: async () => {
        calls += 1;
        return { verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL };
      },
      memory: first.memory,
      maxCalls: 10,
      now: NOW,
    });
    expect(calls).toBe(1);
    if (second.list.kind !== "list") return;
    expect(second.list.items).toHaveLength(1);
  });

  it("never draws a calm fleet when the budget stopped it looking", async () => {
    const { sessions, capture } = fleetOf([
      ["a", pane("ended-prose-question-shut-it-down.txt")],
      ["b", pane("ended-prose-question-recogniser-fixes.txt")],
    ]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: askedNothing, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 1,
      now: NOW,
    });
    expect(result.list.kind).toBe("unknown");
  });

  it("still publishes the items it DID find when something else went unclassified", async () => {
    // The trade, stated: a partial list is a RECALL failure, which costs an agent
    // wall-clock — the cheapest thing on this box. An empty list on incomplete
    // evidence is a false claim about Greg's obligations. So incompleteness
    // suppresses the CLAIM OF ABSENCE and never the items themselves.
    const { sessions, capture } = fleetOf([
      ["a", pane("ended-prose-question-shut-it-down.txt")],
      ["b", pane("ended-prose-question-recogniser-fixes.txt")],
    ]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async (tail) =>
        tail.includes("shut it down")
          ? { verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }
          : { verdict: { kind: "unreadable", why: "429" }, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL },
      maxCalls: 10,
      now: NOW,
    });
    expect(result.list.kind).toBe("list");
    if (result.list.kind !== "list") return;
    expect(result.list.items).toHaveLength(1);
  });

  it("calls a scan of nothing a broken probe, not a calm fleet", async () => {
    // The wire type's own comment says zero items out of zero scanned is a broken
    // probe. It used to return a list anyway, and the test that was supposed to
    // catch it only asserted that the two results DIFFERED — which they did, by
    // the count. A check that answers a weaker question than the one it is named
    // for.
    const result = await runAttentionPass({
      sessions: [],
      capture: () => "",
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    expect(result.list.kind).toBe("unknown");
  });

  it("does not count an unrecognised dialog as a pane it understood", async () => {
    // `no-input-box` covers two very different things: a pane that is positively
    // NOT Claude Code (a shell, a Codex TUI) and a Claude Code pane whose input
    // box has been taken away by a dialog we could not parse. Counting the second
    // as READ means a harness dialog-format change turns every question on the
    // box into a calm fleet — GPT Sol's finding 1, third variant.
    //
    // Derived from a real capture by one stated change: the dialog's option lines
    // are removed, so `parsePane` no longer recognises it, and what is left is a
    // Claude Code pane with a footer and no input box.
    const real = fleetPane("dialog-bash-permission.txt");
    const gutted = real
      .split("\n")
      .filter((l) => !/^\s*[❯>]?\s*\d\.\s/.test(l))
      .join("\n");
    const { sessions, capture } = fleetOf([["mystery", gutted]]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    expect(result.breakdown.noInputBox).toBe(0);
    expect(result.breakdown.unreadable).toBe(1);
    expect(sessionsRead(result.breakdown)).toBe(0);
    expect(result.list.kind).toBe("unknown");
  });

  it("counts a session it TRIED to judge and could not, and no deliberate skip", async () => {
    // The exclusion is the whole design of the field, not a nicety: it is what
    // makes it renderable at all. A count that included mid-turn sessions and
    // Codex panes would be non-zero on nearly every pass, the page would carry a
    // permanent caveat, and Greg would learn to read past it — the same mistake
    // the dashboard shipped and repaired today, where the fix was not a threshold
    // but scoping the question so it does not arise on rows it cannot apply to.
    const { sessions, capture } = fleetOf([
      ["asks", pane("ended-prose-question-shut-it-down.txt")],
      ["busy", pane("mid-turn-spinner.txt")],
      ["codex", pane("no-input-box-codex-tui.txt")],
      ["shell", pane("no-input-box-job-shell.txt")],
      ["permission", fleetPane("dialog-bash-permission.txt")],
    ]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: askedSomething, spend: NO_SPEND, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    expect(result.list.kind).toBe("list");
    if (result.list.kind !== "list") return;
    // Four of the five were skipped on purpose. None of them is a failure.
    expect(result.list.sessionsUnreadable).toBe(0);
  });

  it("counts a tail the gateway would not answer about", async () => {
    const { sessions, capture } = fleetOf([
      ["asks", pane("ended-prose-question-shut-it-down.txt")],
      ["also", pane("ended-prose-question-recogniser-fixes.txt")],
    ]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async (tail) =>
        tail.includes("shut it down")
          ? { verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }
          : { verdict: { kind: "unreadable", why: "429" }, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL },
      maxCalls: 10,
      now: NOW,
    });
    if (result.list.kind !== "list") return;
    expect(result.list.sessionsUnreadable).toBe(1);
    // …and the items it DID find are still published. Incompleteness suppresses
    // the claim of absence, never the items.
    expect(result.list.items).toHaveLength(1);
  });

  it("counts SESSIONS, not fingerprints, when two sessions share one failed tail", async () => {
    // GPT Sol's second round. Two sessions that ended their turns identically
    // share one tail and one call, which is the whole saving — but if that call
    // fails, TWO sessions went unjudged, and the number Greg reads is about
    // sessions rather than about our internal deduplication.
    const same = pane("ended-prose-question-shut-it-down.txt");
    const { sessions, capture } = fleetOf([
      ["one", same],
      ["two", same],
      ["found", pane("ended-prose-question-recogniser-fixes.txt")],
    ]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async (tail) =>
        tail.includes("shut it down")
          ? { verdict: { kind: "unreadable", why: "429" }, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }
          : { verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL },
      maxCalls: 10,
      now: NOW,
    });
    if (result.list.kind !== "list") return;
    expect(result.list.sessionsUnreadable).toBe(2);
  });

  it("says `unknown` for an empty list with a pane it could not parse, not a list plus a retraction", async () => {
    // GPT Sol's second round, and the version before it was incoherent: nineteen
    // quiet panes plus one unparseable one published "nothing needs you" with a
    // caveat under it retracting the claim. A sentence and its retraction in the
    // same block is worse than either. The rule is keyed on `sessionsUnreadable`
    // now, not on classifier failures alone.
    const gutted = fleetPane("dialog-bash-permission.txt")
      .split("\n")
      .filter((l) => !/^\s*[❯>]?\s*\d\.\s/.test(l))
      .join("\n");
    const { sessions, capture } = fleetOf([
      ["quiet", pane("ended-prose-no-question-status-report.txt")],
      ["mystery", gutted],
    ]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    expect(result.list.kind).toBe("unknown");
    if (result.list.kind !== "unknown") return;
    expect(result.list.why).toContain("could not be judged");
  });

  it("counts a session in the register with no pane to read", async () => {
    const result = await runAttentionPass({
      sessions: [{ sessionId: "$1", sessionName: "nowhere", paneId: null }],
      capture: () => "",
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    // We wanted to judge it and had no address. That is a failure to look, not a
    // decision not to.
    expect(result.list.kind).toBe("unknown");
  });

  it("counts a Claude pane it could not parse", async () => {
    const gutted = fleetPane("dialog-bash-permission.txt")
      .split("\n")
      .filter((l) => !/^\s*[❯>]?\s*\d\.\s/.test(l))
      .join("\n");
    const { sessions, capture } = fleetOf([
      ["asks", pane("ended-prose-question-shut-it-down.txt")],
      ["mystery", gutted],
    ]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: askedSomething, spend: NO_SPEND, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    if (result.list.kind !== "list") return;
    expect(result.list.sessionsUnreadable).toBe(1);
  });

  it("draws a genuinely calm fleet as a list with a count beside it", async () => {
    const { sessions, capture } = fleetOf([
      ["busy", pane("mid-turn-spinner.txt")],
      ["reports", pane("ended-prose-no-question-status-report.txt")],
    ]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    expect(result.list.kind).toBe("list");
    if (result.list.kind !== "list") return;
    expect(result.list.items).toEqual([]);
    expect(result.list.sessionsScanned).toBe(2);
  });
});

describe("what reaches the model, and what does not", () => {
  it("asks about an ended turn and never about one still running", async () => {
    const { sessions, capture } = fleetOf([
      ["asks", pane("ended-prose-question-shut-it-down.txt")],
      ["busy", pane("mid-turn-spinner.txt")],
      ["codex", pane("no-input-box-codex-tui.txt")],
    ]);
    const asked: string[] = [];
    await runAttentionPass({
      sessions,
      capture,
      classify: async (tail) => {
        asked.push(tail);
        return { verdict: askedSomething, spend: NO_SPEND, model: ATTENTION_CLASSIFIER_MODEL };
      },
      maxCalls: 10,
      now: NOW,
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("Say the word and I'll shut it down.");
  });

  it("never sends the input box's draft to the model", async () => {
    // Measured: a message sent at a pane concatenates with what the box already
    // holds. Whatever is in the box is not something the agent said.
    const { sessions, capture } = fleetOf([["asks", pane("ended-prose-question-shut-it-down.txt")]]);
    const asked: string[] = [];
    await runAttentionPass({
      sessions,
      capture,
      classify: async (tail) => {
        asked.push(tail);
        return { verdict: askedSomething, spend: NO_SPEND, model: ATTENTION_CLASSIFIER_MODEL };
      },
      maxCalls: 10,
      now: NOW,
    });
    expect(asked[0]).not.toContain("yes, shut it all down");
  });

  it("charges one call for two sessions that ended their turns identically", async () => {
    const same = pane("ended-prose-question-shut-it-down.txt");
    const { sessions, capture } = fleetOf([
      ["one", same],
      ["two", same],
    ]);
    let calls = 0;
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => {
        calls += 1;
        return { verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL };
      },
      maxCalls: 10,
      now: NOW,
    });
    expect(calls).toBe(1);
    // …and both sessions still appear, one as the primary and one as a duplicate.
    if (result.list.kind !== "list") return;
    expect(result.list.items).toHaveLength(1);
    expect(result.list.items[0]?.duplicates).toHaveLength(1);
  });

  it("spends nothing at all on a second pass over an unchanged fleet", async () => {
    const { sessions, capture } = fleetOf([
      ["asks", pane("ended-prose-question-shut-it-down.txt")],
      ["reports", pane("ended-prose-no-question-status-report.txt")],
    ]);
    let calls = 0;
    const classify = async () => {
      calls += 1;
      return { verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL };
    };
    const first = await runAttentionPass({ sessions, capture, classify, maxCalls: 10, now: NOW });
    expect(calls).toBe(2);
    const second = await runAttentionPass({
      sessions,
      capture,
      classify,
      memory: first.memory,
      maxCalls: 10,
      now: NOW,
    });
    expect(calls).toBe(2);
    expect(second.breakdown.fromCache).toBe(2);
  });

  it("keeps the first-seen instant across passes, so a wait is a wait", async () => {
    const { sessions, capture } = fleetOf([["asks", pane("ended-prose-question-shut-it-down.txt")]]);
    const classify = async () => ({ verdict: askedSomething, spend: NO_SPEND, model: ATTENTION_CLASSIFIER_MODEL });
    const first = await runAttentionPass({ sessions, capture, classify, maxCalls: 10, now: NOW });
    const later = await runAttentionPass({
      sessions,
      capture,
      classify,
      memory: first.memory,
      maxCalls: 10,
      now: () => new Date("2026-09-08T18:00:00.000Z"),
    });
    if (first.list.kind !== "list" || later.list.kind !== "list") return;
    expect(later.list.items[0]?.waitingSince).toBe(first.list.items[0]?.waitingSince);
    expect(later.list.scannedAt).toBe("2026-09-08T18:00:00.000Z");
  });

  it("stops at the budget and says how many it left", async () => {
    const { sessions, capture } = fleetOf([
      ["a", pane("ended-prose-question-shut-it-down.txt")],
      ["b", pane("ended-prose-question-recogniser-fixes.txt")],
      ["c", pane("ended-prose-no-question-status-report.txt")],
    ]);
    let calls = 0;
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => {
        calls += 1;
        return { verdict: askedNothing, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL };
      },
      maxCalls: 1,
      now: NOW,
    });
    expect(calls).toBe(1);
    expect(result.breakdown.overBudget).toBe(2);
  });
});

describe("dialogs, which are observed rather than inferred", () => {
  it("takes a permission dialog out of the list and counts it", async () => {
    // On this box a permission prompt is nearly always a LAUNCH DEFECT — auto
    // mode should have handled it, and the harness says so in the prompt itself.
    // The action is to fix how that session was started, pointed at a different
    // person entirely, so it is not a queue item for Greg at 11pm. Counted, never
    // silently dropped: a rising count is a launcher regression, and the last one
    // cost 34.9 agent-hours in three days before anybody noticed.
    const { sessions, capture } = fleetOf([["permission", fleetPane("dialog-bash-permission.txt")]]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: askedSomething, spend: NO_SPEND, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    expect(result.breakdown.permissionDialogs).toBe(1);
    if (result.list.kind !== "list") return;
    expect(result.list.items).toEqual([]);
    expect(breakdownBalances(result.breakdown)).toBe(true);
  });

  it("keeps a conversation dialog as an item even when the classifier says no question", async () => {
    // The harness DREW it. That is observed, and no verdict about the prose can
    // unobserve it — the model is asked only so a dialog can be ranked alongside
    // prose by consequence, and when it cannot answer the dialog falls to
    // `other` rather than out of the list.
    const { sessions, capture } = fleetOf([["asks", fleetPane("dialog-ask-user-question.txt")]]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    expect(result.breakdown.conversationDialogs).toBe(1);
    if (result.list.kind !== "list") return;
    expect(result.list.items).toHaveLength(1);
    expect(result.list.items[0]?.kind).toBe("other");
    expect(result.list.items[0]?.evidence.kind).toBe("dialog");
  });

  it("carries the drawn options, in the order the harness drew them, even when the model is refused", async () => {
    const { sessions, capture } = fleetOf([["asks", fleetPane("dialog-ask-user-question.txt")]]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async (): Promise<ClassifyOutcome> => ({
        notCalled: { kind: "stopped", stopped: { kind: "exhausted", why: "spent", until: "2026-09-09T00:00:00.000Z" } },
      }),
      maxCalls: 10,
      now: NOW,
    });
    if (result.list.kind !== "limited") throw new Error(`expected limited, got ${result.list.kind}`);
    expect(result.list.items[0]?.evidence.kind).toBe("dialog");
  });

  it("carries the drawn options, in the order the harness drew them", async () => {
    const { sessions, capture } = fleetOf([["asks", fleetPane("dialog-ask-user-question.txt")]]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    if (result.list.kind !== "list") return;
    const evidence = result.list.items[0]?.evidence;
    expect(evidence?.kind).toBe("dialog");
    if (evidence?.kind !== "dialog") return;
    expect(evidence.options.length).toBeGreaterThan(1);
  });
});

describe("the day budget and the prompt version (plan 260910f D3–D6)", () => {
  const EXHAUSTED = {
    kind: "exhausted" as const,
    why: "the day's ceiling of $1.50 would be crossed",
    until: "2026-09-09T00:00:00.000Z",
  };
  const refuse = async (): Promise<ClassifyOutcome> => ({ notCalled: { kind: "stopped", stopped: EXHAUSTED } });

  /** The same memory, as if every verdict in it had been made under a prompt this build does not run. */
  function staleOf(memory: AttentionMemory): AttentionMemory {
    return { ...memory, verdicts: new Map([...memory.verdicts].map(([k, v]) => [k, { ...v, promptVersion: null }])) };
  }

  async function remembered(): Promise<AttentionMemory> {
    const { sessions, capture } = fleetOf([["asks", pane("ended-prose-question-shut-it-down.txt")]]);
    const first = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    return first.memory;
  }

  it("publishes `limited` when the budget refused a call, with the dialog it observed still on it", async () => {
    const { sessions, capture } = fleetOf([
      ["asks", pane("ended-prose-question-shut-it-down.txt")],
      ["dialog", fleetPane("dialog-ask-user-question.txt")],
    ]);
    const result = await runAttentionPass({ sessions, capture, classify: refuse, maxCalls: 10, now: NOW });
    expect(result.list.kind).toBe("limited");
    if (result.list.kind !== "limited") return;
    expect(result.list.stopped).toEqual(EXHAUSTED);
    expect(result.list.items.map((i) => i.evidence.kind)).toEqual(["dialog"]);
    // Both went unjudged — the prose tail entirely, the dialog's rank.
    expect(result.list.sessionsUnreadable).toBe(2);
    expect(breakdownBalances(result.breakdown)).toBe(true);
  });

  it("publishes `limited` even when nothing was found, never an empty list and never `unknown`", async () => {
    // An empty `list` would be "nothing needs you"; `unknown` would hide WHY and
    // until when. The arm exists for exactly this pass.
    const { sessions, capture } = fleetOf([["asks", pane("ended-prose-question-shut-it-down.txt")]]);
    const result = await runAttentionPass({ sessions, capture, classify: refuse, maxCalls: 10, now: NOW });
    expect(result.list).toMatchObject({ kind: "limited", items: [], sessionsUnreadable: 1, stopped: EXHAUSTED });
  });

  it("keeps a cached question's card when the budget refuses the rest", async () => {
    const memory = await remembered();
    const { sessions, capture } = fleetOf([
      ["asks", pane("ended-prose-question-shut-it-down.txt")],
      ["new", pane("ended-prose-question-recogniser-fixes.txt")],
    ]);
    const result = await runAttentionPass({ sessions, capture, classify: refuse, memory, maxCalls: 10, now: NOW });
    expect(result.list.kind).toBe("limited");
    if (result.list.kind !== "limited") return;
    expect(result.list.items.map((i) => i.sessionName)).toEqual(["asks"]);
    expect(result.list.sessionsUnreadable).toBe(1);
  });

  it("stops asking at the first refusal, and counts every tail it did not reach", async () => {
    const { sessions, capture } = fleetOf([
      ["a", pane("ended-prose-question-shut-it-down.txt")],
      ["b", pane("ended-prose-question-recogniser-fixes.txt")],
      ["c", pane("ended-prose-no-question-status-report.txt")],
    ]);
    let attempts = 0;
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async (): Promise<ClassifyOutcome> => {
        attempts += 1;
        return attempts === 1 ? { verdict: askedNothing, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL } : refuse();
      },
      maxCalls: 10,
      now: NOW,
    });
    expect(attempts).toBe(2);
    expect(result.breakdown.budgetRefused).toBe(2);
    expect(result.list).toMatchObject({ kind: "limited", sessionsUnreadable: 2 });
  });

  it("leaves the per-pass catch-up a `list`: that is ordinary operation, not a stop", async () => {
    const { sessions, capture } = fleetOf([
      ["a", pane("ended-prose-question-shut-it-down.txt")],
      ["b", pane("ended-prose-question-recogniser-fixes.txt")],
    ]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 1,
      now: NOW,
    });
    expect(result.list).toMatchObject({ kind: "list", sessionsUnreadable: 1 });
  });

  it("treats a budget it could not consult as unjudged tails, not as a stop it cannot date", async () => {
    // A held or unreadable budget lock is neither the day's ceiling nor the
    // gateway's cooldown, and the wire's `stopped` has no honest `until` for it.
    // So the tails are unjudged — counted, and loud through the counts — and
    // the list is the list it would otherwise be.
    const { sessions, capture } = fleetOf([
      ["dialog", fleetPane("dialog-ask-user-question.txt")],
      ["asks", pane("ended-prose-question-shut-it-down.txt")],
    ]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async (): Promise<ClassifyOutcome> => ({ notCalled: { kind: "unavailable", why: "the budget lock is held" } }),
      maxCalls: 10,
      now: NOW,
    });
    expect(result.list).toMatchObject({ kind: "list", sessionsUnreadable: 2 });
  });

  it("places a stale verdict's card and re-reads it FIRST", async () => {
    const memory = staleOf(await remembered());
    const { sessions, capture } = fleetOf([
      ["asks", pane("ended-prose-question-shut-it-down.txt")],
      ["new", pane("ended-prose-question-recogniser-fixes.txt")],
    ]);
    const asked: string[] = [];
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async (tail) => {
        asked.push(tail);
        return { verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL };
      },
      memory,
      maxCalls: 1,
      now: NOW,
    });
    expect(asked).toHaveLength(1);
    expect(asked[0]).toContain("Say the word and I'll shut it down.");
    expect(result.breakdown.stale).toBe(1);
    expect(result.breakdown.overBudget).toBe(1);
    // …and what it re-read is filed under the prompt that read it.
    expect([...result.memory.verdicts.values()].map((v) => v.promptVersion)).toEqual([CLASSIFIER_PROMPT_VERSION]);
  });

  // A STALE VERDICT PLACES ITS CARD; IT DOES NOT MAKE THE PASS COMPLETE (F12).
  // When the pass tried to re-read a tail and got no usable answer, that session
  // went unjudged THIS pass, and a stale `no-question` must not be what turns
  // the page into "nothing needs you".
  const unavailable = async (): Promise<ClassifyOutcome> => ({
    notCalled: { kind: "unavailable", why: "the budget lock is held" },
  });
  const unreadableAnswer = async (): Promise<ClassifyOutcome> => ({
    verdict: { kind: "unreadable", why: "not JSON" },
    spend: { ...NO_SPEND, calls: 1 },
    model: ATTENTION_CLASSIFIER_MODEL,
  });

  async function staleQuiet() {
    const fleet = fleetOf([["quiet", pane("ended-prose-no-question-status-report.txt")]]);
    const first = await runAttentionPass({
      ...fleet,
      classify: async () => ({ verdict: askedNothing, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    return { ...fleet, memory: staleOf(first.memory) };
  }

  it("keeps a stale verdict's card when its re-read fails, and counts the session unjudged", async () => {
    // D3: stale is not absent, so the question does not vanish on the very pass
    // that tried to refresh it; but the re-read failed, so the list is a floor.
    const memory = staleOf(await remembered());
    const { sessions, capture } = fleetOf([["asks", pane("ended-prose-question-shut-it-down.txt")]]);
    const result = await runAttentionPass({ sessions, capture, classify: unreadableAnswer, memory, maxCalls: 10, now: NOW });
    expect(result.list).toMatchObject({ kind: "list", sessionsUnreadable: 1 });
    if (result.list.kind !== "list") return;
    expect(result.list.items).toHaveLength(1);
    expect([...result.memory.verdicts.values()].map((v) => v.promptVersion)).toEqual([null]);
  });

  it("never draws a calm fleet from a stale `no-question` whose re-read failed", async () => {
    const { sessions, capture, memory } = await staleQuiet();
    const result = await runAttentionPass({ sessions, capture, classify: unreadableAnswer, memory, maxCalls: 10, now: NOW });
    expect(result.list.kind).toBe("unknown");
  });

  it("keeps a stale verdict's card when the budget refuses its re-read, and counts the session unjudged", async () => {
    const memory = staleOf(await remembered());
    const { sessions, capture } = fleetOf([["asks", pane("ended-prose-question-shut-it-down.txt")]]);
    const result = await runAttentionPass({ sessions, capture, classify: refuse, memory, maxCalls: 10, now: NOW });
    expect(result.list).toMatchObject({ kind: "limited", sessionsUnreadable: 1 });
    if (result.list.kind !== "limited") return;
    expect(result.list.items).toHaveLength(1);
  });

  it("never draws a calm fleet from a stale `no-question` when the budget could not be consulted", async () => {
    const { sessions, capture, memory } = await staleQuiet();
    const result = await runAttentionPass({ sessions, capture, classify: unavailable, memory, maxCalls: 10, now: NOW });
    expect(result.breakdown.budgetRefused).toBe(1);
    expect(result.list.kind).toBe("unknown");
  });

  it("keeps a stale question's card when the budget could not be consulted, and counts the session unjudged", async () => {
    const memory = staleOf(await remembered());
    const { sessions, capture } = fleetOf([["asks", pane("ended-prose-question-shut-it-down.txt")]]);
    const result = await runAttentionPass({ sessions, capture, classify: unavailable, memory, maxCalls: 10, now: NOW });
    expect(result.list).toMatchObject({ kind: "list", sessionsUnreadable: 1 });
    if (result.list.kind !== "list") return;
    expect(result.list.items).toHaveLength(1);
  });

  it("files what it re-read under the version it was HANDED, so a version-2 pass never files under 1", async () => {
    const memory = staleOf(await remembered());
    const { sessions, capture } = fleetOf([["asks", pane("ended-prose-question-shut-it-down.txt")]]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: proposing("fable"), spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }),
      memory,
      maxCalls: 10,
      promptVersion: PROPOSAL_PROMPT_VERSION,
      now: NOW,
    });
    expect([...result.memory.verdicts.values()].map((v) => v.promptVersion)).toEqual([PROPOSAL_PROMPT_VERSION]);
  });

  it("counts nothing unjudged when a stale verdict's re-read succeeds", async () => {
    const memory = staleOf(await remembered());
    const { sessions, capture } = fleetOf([["asks", pane("ended-prose-question-shut-it-down.txt")]]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }),
      memory,
      maxCalls: 10,
      now: NOW,
    });
    expect(result.list).toMatchObject({ kind: "list", sessionsUnreadable: 0 });
    if (result.list.kind !== "list") return;
    expect(result.list.items).toHaveLength(1);
  });
});

describe("the proposal on each item (plan 260910f D1, D3, D7, D8, D9, D14)", () => {
  const BY = { kind: "model", model: ATTENTION_CLASSIFIER_MODEL, via: "overseer" };

  function asks(): { sessions: SessionToScan[]; capture: (paneId: string) => string } {
    return fleetOf([["asks", pane("ended-prose-question-shut-it-down.txt")]]);
  }

  function onlyItem(list: Awaited<ReturnType<typeof runAttentionPass>>["list"]) {
    if (list.kind === "unknown") throw new Error(`expected items, got unknown: ${list.why}`);
    const item = list.items[0];
    if (item === undefined) throw new Error("expected one item");
    return item;
  }

  it("marks every prose item `off`, naming the variable, when proposals are not enabled (D7)", async () => {
    const result = await runAttentionPass({
      ...asks(),
      classify: async () => ({ verdict: proposing("fable"), spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    const proposal = onlyItem(result.list).proposal;
    expect(proposal.kind).toBe("off");
    if (proposal.kind !== "off") return;
    expect(proposal.why).toContain("OVERSEER_PROPOSALS");
  });

  it("proposes the holder the model named, with its reason and quote, attributed to the model", async () => {
    const { sessions, capture } = asks();
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: proposing("fable"), spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      promptVersion: PROPOSAL_PROMPT_VERSION,
      usage: USAGE_OK,
      now: NOW,
    });
    const proposal = onlyItem(result.list).proposal;
    const fingerprint = [...result.memory.verdicts.keys()][0];
    expect(proposal).toEqual({
      kind: "proposed",
      // The model is part of the identity (GPT Sol's F18): two models' proposals about one tail are two proposals.
      id: `${fingerprint}:v${PROPOSAL_PROMPT_VERSION}:${ATTENTION_CLASSIFIER_MODEL}`,
      recipient: "fable",
      reason: "it is fable's kind of question",
      asks: "Say the word and I'll shut it down.",
      by: BY,
      reach: { kind: "not-checked", why: expect.any(String) },
    });
  });

  it("stamps `by` from the model the call reported, even when the verdict object carries one of its own (D9, F18)", async () => {
    // Through `unknown`: the type rightly has no `by`, which is the point.
    const forged = { ...proposing("greg"), by: { kind: "person", model: "Greg", via: "overseer" } } as unknown as ClassifierVerdict;
    const result = await runAttentionPass({
      ...asks(),
      classify: async () => ({ verdict: forged, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      promptVersion: PROPOSAL_PROMPT_VERSION,
      now: NOW,
    });
    const proposal = onlyItem(result.list).proposal;
    expect(proposal.kind).toBe("proposed");
    if (proposal.kind !== "proposed") return;
    expect(proposal.by).toEqual(BY);
    // …and the forgery was not remembered either.
    expect(JSON.stringify([...result.memory.verdicts.values()])).not.toContain("Greg");
  });

  it("draws `unplaced` as its own arm, never promoted to Greg (D8)", async () => {
    const unplaced = { ...askedSomething, recipient: "unplaced", unplacedWhy: "could be technical or product" } as ClassifierVerdict;
    const result = await runAttentionPass({
      ...asks(),
      classify: async () => ({ verdict: unplaced, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      promptVersion: PROPOSAL_PROMPT_VERSION,
      now: NOW,
    });
    const proposal = onlyItem(result.list).proposal;
    expect(proposal).toMatchObject({ kind: "unplaced", why: "could be technical or product", by: BY });
  });

  it("says `not-applicable` for a drawn dialog, proposals on or off", async () => {
    for (const promptVersion of [CLASSIFIER_PROMPT_VERSION, PROPOSAL_PROMPT_VERSION]) {
      const result = await runAttentionPass({
        ...fleetOf([["dialog", fleetPane("dialog-ask-user-question.txt")]]),
        classify: async () => ({ verdict: proposing("sol"), spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }),
        maxCalls: 10,
        promptVersion,
        now: NOW,
      });
      expect(onlyItem(result.list).proposal).toEqual({ kind: "not-applicable" });
    }
  });

  async function rememberedUnderVersion1() {
    const fleet = asks();
    const first = await runAttentionPass({
      ...fleet,
      classify: async () => ({ verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      now: NOW,
    });
    return { ...fleet, memory: first.memory };
  }

  it("says `not-reached`, with the budget's reason, for a version-1 card whose re-read was refused (D3)", async () => {
    const { sessions, capture, memory } = await rememberedUnderVersion1();
    const result = await runAttentionPass({
      sessions,
      capture,
      memory,
      classify: async (): Promise<ClassifyOutcome> => ({
        notCalled: { kind: "stopped", stopped: { kind: "exhausted", why: "the day's ceiling is spent", until: "2026-09-09T00:00:00.000Z" } },
      }),
      maxCalls: 10,
      promptVersion: PROPOSAL_PROMPT_VERSION,
      now: NOW,
    });
    const proposal = onlyItem(result.list).proposal;
    expect(proposal.kind).toBe("not-reached");
    if (proposal.kind !== "not-reached") return;
    expect(proposal.why).toContain("the day's ceiling is spent");
  });

  it("says `not-reached` for a version-1 card the per-pass budget did not get to", async () => {
    const { sessions, capture, memory } = await rememberedUnderVersion1();
    const result = await runAttentionPass({
      sessions,
      capture,
      memory,
      classify: async () => {
        throw new Error("maxCalls 0 must not call");
      },
      maxCalls: 0,
      promptVersion: PROPOSAL_PROMPT_VERSION,
      now: NOW,
    });
    expect(onlyItem(result.list).proposal.kind).toBe("not-reached");
  });

  it("says `not-reached` for a version-1 card whose re-read came back unreadable", async () => {
    const { sessions, capture, memory } = await rememberedUnderVersion1();
    const result = await runAttentionPass({
      sessions,
      capture,
      memory,
      classify: async () => ({ verdict: { kind: "unreadable", why: "the quote is not in the tail" }, spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      promptVersion: PROPOSAL_PROMPT_VERSION,
      now: NOW,
    });
    const proposal = onlyItem(result.list).proposal;
    expect(proposal.kind).toBe("not-reached");
    if (proposal.kind !== "not-reached") return;
    expect(proposal.why).toContain("the quote is not in the tail");
  });

  it("remembers recipient, reason and quote with the verdict, and never `reach` (D14)", async () => {
    const result = await runAttentionPass({
      ...asks(),
      classify: async () => ({ verdict: proposing("fable"), spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }),
      maxCalls: 10,
      promptVersion: PROPOSAL_PROMPT_VERSION,
      usage: USAGE_LIMITED,
      now: NOW,
    });
    const remembered = [...result.memory.verdicts.values()][0]?.verdict;
    expect(remembered).toMatchObject({ recipient: "fable", reason: "it is fable's kind of question", asks: "Say the word and I'll shut it down." });
    expect(JSON.stringify(remembered)).not.toContain("reach");
    expect(JSON.stringify(remembered)).not.toContain("unavailable");
  });

  it("projects `reach` afresh each pass: an unchanged tail follows usage ok → limited → ok at no extra cost", async () => {
    const fleet = asks();
    let calls = 0;
    const classify = async (): Promise<ClassifyOutcome> => {
      calls += 1;
      return { verdict: proposing("fable"), spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL };
    };
    let memory: AttentionMemory | undefined;
    const reaches: string[] = [];
    for (const usage of [USAGE_OK, USAGE_LIMITED, USAGE_OK]) {
      const result = await runAttentionPass({
        ...fleet,
        classify,
        ...(memory === undefined ? {} : { memory }),
        maxCalls: 10,
        promptVersion: PROPOSAL_PROMPT_VERSION,
        usage,
        now: NOW,
      });
      memory = result.memory;
      const proposal = onlyItem(result.list).proposal;
      if (proposal.kind !== "proposed") throw new Error(`expected proposed, got ${proposal.kind}`);
      // Missing capability is SHOWN, never substituted: Fable stays the recipient.
      expect(proposal.recipient).toBe("fable");
      reaches.push(proposal.reach.kind);
    }
    expect(reaches).toEqual(["not-checked", "unavailable", "not-checked"]);
    expect(calls).toBe(1);
  });

  it("marks Greg and the agent itself available, and Sol and the Overseer not checked, whatever usage says", async () => {
    const reach: Record<string, string> = {};
    for (const recipient of ["greg", "self", "sol", "overseer"] as const) {
      const result = await runAttentionPass({
        ...asks(),
        classify: async () => ({ verdict: proposing(recipient), spend: { ...NO_SPEND, calls: 1 }, model: ATTENTION_CLASSIFIER_MODEL }),
        maxCalls: 10,
        promptVersion: PROPOSAL_PROMPT_VERSION,
        usage: USAGE_LIMITED,
        now: NOW,
      });
      const proposal = onlyItem(result.list).proposal;
      if (proposal.kind !== "proposed") throw new Error(`expected proposed, got ${proposal.kind}`);
      reach[recipient] = proposal.reach.kind;
    }
    expect(reach).toEqual({ greg: "available", self: "available", sol: "not-checked", overseer: "not-checked" });
  });
});

describe("which model a remembered proposal came from (GPT Sol's F18)", () => {
  const A = "vendor/model-a";
  const B = "vendor/model-b";
  const fleet = () => fleetOf([["asks", pane("ended-prose-question-shut-it-down.txt")]]);

  function proposalOf(list: Awaited<ReturnType<typeof runAttentionPass>>["list"]) {
    if (list.kind === "unknown") throw new Error(`expected items, got unknown: ${list.why}`);
    const item = list.items[0];
    if (item === undefined) throw new Error("expected one item");
    return item.proposal;
  }

  /** A proposal-aware pass whose classifier answers as `model`, counting its calls. */
  function passUnder(model: string, memory?: AttentionMemory, calls = { n: 0 }) {
    return runAttentionPass({
      ...fleet(),
      ...(memory === undefined ? {} : { memory }),
      classify: async (): Promise<ClassifyOutcome> => {
        calls.n += 1;
        return { verdict: proposing("sol"), spend: { ...NO_SPEND, calls: 1 }, model };
      },
      maxCalls: 10,
      promptVersion: PROPOSAL_PROMPT_VERSION,
      now: NOW,
    });
  }

  it("records the model the call answered with beside the verdict it caches", async () => {
    const first = await passUnder(A);
    expect([...first.memory.verdicts.values()].map((v) => v.model)).toEqual([A]);
  });

  it("attributes a cached proposal to the model that made it after the classifier changes — with no call, and a different id", async () => {
    const first = await passUnder(A);
    const calls = { n: 0 };
    const later = await passUnder(B, first.memory, calls);
    expect(calls.n).toBe(0);
    const cached = proposalOf(later.list);
    expect(cached).toMatchObject({ kind: "proposed", by: { kind: "model", model: A, via: "overseer" } });

    const fresh = proposalOf((await passUnder(B)).list);
    expect(fresh).toMatchObject({ kind: "proposed", by: { kind: "model", model: B, via: "overseer" } });
    if (cached.kind !== "proposed" || fresh.kind !== "proposed") return;
    expect(cached.id).not.toBe(fresh.id);
  });

  it("re-reads a remembered proposal whose model was never recorded, and never stamps the current model on it", async () => {
    const first = await passUnder(A);
    // A memory entry from before the model was recorded (schema 1 or 2).
    const legacy: AttentionMemory = {
      ...first.memory,
      verdicts: new Map([...first.memory.verdicts].map(([k, v]) => [k, { ...v, model: null }])),
    };
    // The re-read is refused: the card stays, its proposal is drawn under nobody's name.
    const refused = await runAttentionPass({
      ...fleet(),
      memory: legacy,
      classify: async (): Promise<ClassifyOutcome> => ({ notCalled: { kind: "unavailable", why: "the budget's lock was held" } }),
      maxCalls: 10,
      promptVersion: PROPOSAL_PROMPT_VERSION,
      now: NOW,
    });
    const shown = proposalOf(refused.list);
    expect(shown.kind).toBe("not-reached");
    expect(JSON.stringify(refused.list)).not.toContain(ATTENTION_CLASSIFIER_MODEL);

    // The re-read is answered: attributed to the model that answered it.
    const calls = { n: 0 };
    const reread = await passUnder(B, legacy, calls);
    expect(calls.n).toBe(1);
    expect(proposalOf(reread.list)).toMatchObject({ kind: "proposed", by: { model: B } });
  });

  it("never publishes a remembered quote that the pane it is filed under does not hold", async () => {
    // Every consumer refuses such an item and degrades the WHOLE list (F15), so
    // the producer must not write one: the card stays, the proposal is not drawn.
    const first = await passUnder(A);
    const altered = new Map(
      [...first.memory.verdicts].map(([k, v]) => [
        k,
        { ...v, verdict: { ...v.verdict, asks: "A sentence this pane never held at all." } as CacheableVerdict },
      ]),
    );
    const later = await runAttentionPass({
      ...fleet(),
      memory: { ...first.memory, verdicts: altered },
      classify: async (): Promise<ClassifyOutcome> => {
        throw new Error("a cached verdict needs no call");
      },
      maxCalls: 10,
      promptVersion: PROPOSAL_PROMPT_VERSION,
      now: NOW,
    });
    expect(proposalOf(later.list).kind).toBe("not-reached");
  });
});
