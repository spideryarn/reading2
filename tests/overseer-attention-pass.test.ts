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

import type { ClassifierVerdict } from "../tools/overseer/attention-classify.js";
import { CLASSIFIER_PROMPT_VERSION, NO_SPEND } from "../tools/overseer/attention-classify.js";
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
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND }),
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
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND }),
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
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND }),
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
      classify: async () => ({ verdict: { kind: "unreadable", why: "429" }, spend: { ...NO_SPEND, calls: 1 } }),
      maxCalls: 10,
      now: NOW,
    });
    let calls = 0;
    const second = await runAttentionPass({
      sessions,
      capture,
      classify: async () => {
        calls += 1;
        return { verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 } };
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
      classify: async () => ({ verdict: askedNothing, spend: { ...NO_SPEND, calls: 1 } }),
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
          ? { verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 } }
          : { verdict: { kind: "unreadable", why: "429" }, spend: { ...NO_SPEND, calls: 1 } },
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
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND }),
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
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND }),
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
      classify: async () => ({ verdict: askedSomething, spend: NO_SPEND }),
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
          ? { verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 } }
          : { verdict: { kind: "unreadable", why: "429" }, spend: { ...NO_SPEND, calls: 1 } },
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
          ? { verdict: { kind: "unreadable", why: "429" }, spend: { ...NO_SPEND, calls: 1 } }
          : { verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 } },
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
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND }),
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
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND }),
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
      classify: async () => ({ verdict: askedSomething, spend: NO_SPEND }),
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
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND }),
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
        return { verdict: askedSomething, spend: NO_SPEND };
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
        return { verdict: askedSomething, spend: NO_SPEND };
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
        return { verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 } };
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
      return { verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 } };
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
    const classify = async () => ({ verdict: askedSomething, spend: NO_SPEND });
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
        return { verdict: askedNothing, spend: { ...NO_SPEND, calls: 1 } };
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
      classify: async () => ({ verdict: askedSomething, spend: NO_SPEND }),
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
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND }),
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
      classify: async () => ({ verdict: askedNothing, spend: NO_SPEND }),
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
      classify: async () => ({ verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 } }),
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
        return attempts === 1 ? { verdict: askedNothing, spend: { ...NO_SPEND, calls: 1 } } : refuse();
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
      classify: async () => ({ verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 } }),
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
        return { verdict: askedSomething, spend: { ...NO_SPEND, calls: 1 } };
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

  it("keeps a stale verdict's card when its re-read fails, and does not count it unjudged", async () => {
    // D3: stale is not absent. Treating a failed re-read as absent would make a
    // question vanish on the very pass that tried to refresh it.
    const memory = staleOf(await remembered());
    const { sessions, capture } = fleetOf([["asks", pane("ended-prose-question-shut-it-down.txt")]]);
    const result = await runAttentionPass({
      sessions,
      capture,
      classify: async () => ({ verdict: { kind: "unreadable", why: "not JSON" }, spend: { ...NO_SPEND, calls: 1 } }),
      memory,
      maxCalls: 10,
      now: NOW,
    });
    expect(result.list).toMatchObject({ kind: "list", sessionsUnreadable: 0 });
    if (result.list.kind !== "list") return;
    expect(result.list.items).toHaveLength(1);
    expect([...result.memory.verdicts.values()].map((v) => v.promptVersion)).toEqual([null]);
  });

  it("keeps a stale verdict's card when the budget refuses its re-read", async () => {
    const memory = staleOf(await remembered());
    const { sessions, capture } = fleetOf([["asks", pane("ended-prose-question-shut-it-down.txt")]]);
    const result = await runAttentionPass({ sessions, capture, classify: refuse, memory, maxCalls: 10, now: NOW });
    expect(result.list).toMatchObject({ kind: "limited", sessionsUnreadable: 0 });
    if (result.list.kind !== "limited") return;
    expect(result.list.items).toHaveLength(1);
  });
});
