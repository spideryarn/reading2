// @vitest-environment jsdom
/**
 * The recovery panel's first control (plan 260910f, Stage 2): **Resume…** only
 * under all four conditions, the inline confirmation and its one POST, a line
 * for each of the seven request states, the pace line, manual instructions
 * built only from a strict uuid, no control of any kind on the classes that
 * must not have one, and the footer that says what the control does.
 *
 * The harness is tests/fleet-recovery-panel.test.tsx's: a real React root in
 * jsdom, the recovery API injected, and the client's parser exercised directly.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RecoveryPanel } from "../tools/fleet/web/src/RecoveryPanel";
import {
  RECOVERY_RESUME_URL,
  makeRecoveryResumeApi,
  parseRecoveryFeed,
  parseResumePostAnswer,
  type RecoveryApi,
  type RecoveryResumeApi,
  type RecoveryView,
  type ResumePostView,
} from "../tools/fleet/web/src/recovery-client";
import type {
  RecoveryFeed,
  RecoveryResumePostBody,
  RecoveryResumePreview,
  RecoveryResumeProjection,
  RecoveryResumeRequestState,
  RecoveryResumeSection,
  RecoveryWireEvidence,
  RecoveryWireRecord,
  RecoveryWireRecordState,
} from "../tools/fleet/wire";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const CONVERSATION = "4e1c8b07-9a2d-4f63-b5e8-1d7c0a9f3e52";
const NOW = Date.parse("2026-09-10T15:00:00.000Z");
const CHECKED_AT = "2026-09-10T14:58:00.000Z";
/** A space and a quote, so the manual instructions have to quote it properly. */
const DIR = "/home/greg/code/spideryarn2/.claude/worktrees/greg's glossary fix";
const CONFIG_DIR = "/home/greg/.claude-gregmindstone";
const NUDGE =
  "This session was interrupted (the machine restarted at 2026-09-10T13:00:00.000Z). Re-read your plan and your last messages, check `git status` in your worktree, and carry on from where you stopped. If you cannot tell what you were doing, say so and stop.";
const FOOTER =
  "The one control here is Resume: it asks the Overseer to start that one interrupted Claude session again, after checking the box, the quota and the session's evidence. Others you pick wait their turn. Nothing resumes on its own, and nothing here dismisses anything.";

const id = (n: number): string => `rc-${String(n).padStart(20, "0")}`;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

function supported(over: Partial<Extract<RecoveryWireEvidence, { kind: "checked" }>> = {}): RecoveryWireEvidence {
  return {
    kind: "checked",
    dir: { kind: "exists", path: DIR },
    worktree: { kind: "none" },
    transcript: { kind: "found", conversationId: CONVERSATION, path: `/home/greg/.claude/projects/x/${CONVERSATION}.jsonl`, via: "slug-guess", mtime: null },
    lastActivity: { at: "2026-09-10T13:00:00.000Z", source: "transcript" },
    resume: { kind: "supported", conversationId: CONVERSATION, transcriptPath: `/home/greg/.claude/projects/x/${CONVERSATION}.jsonl` },
    ...over,
  };
}

function rec(recordId: string, state: RecoveryWireRecordState, over: Partial<RecoveryWireRecord> = {}): RecoveryWireRecord {
  return {
    id: recordId,
    key: `$1 ${recordId}`,
    name: `session-${recordId}`,
    at: "2026-09-10T14:00:00.000Z",
    origin: "journal",
    oversize: false,
    entry: { dir: DIR, worktree: null, lastSeenAlive: "2026-09-10T13:00:00.000Z", lastStatusKey: "working" },
    lastSeen: { statusKey: "working", title: null, harness: "claude-code", collectedAt: "2026-09-10T13:00:00.000Z" },
    disappearance: { goneWhy: "tmux-server-changed", generation: "changed", producerRun: "changed", watched: true, bootChanged: true },
    state,
    ...over,
  };
}

function classified(recordId: string, kind: "interrupted" | "unknown" | "present-but-unmatched" | "ended-before-reboot", evidence: RecoveryWireEvidence = supported()): RecoveryWireRecord {
  const row = { tmuxId: "$5", name: "live-one", dir: "/work/x", claimedConversationId: null, statusKey: "working", executionToken: null, conversationId: null };
  const classification =
    kind === "present-but-unmatched"
      ? { kind, why: "a live row has the same name", row }
      : kind === "ended-before-reboot"
        ? { kind, why: "last observed stopped", statusKey: "no-claude", observedAt: "2026-09-10T13:00:00.000Z" }
        : { kind, why: kind === "interrupted" ? "the host rebooted while this session was running" : "nobody watched it go" };
  return rec(recordId, { kind: "classified", classification, evidence } as RecoveryWireRecordState);
}

function preview(recordId: string, over: Partial<RecoveryResumePreview> = {}): RecoveryResumePreview {
  return {
    candidateId: recordId,
    conversationId: CONVERSATION,
    dir: DIR,
    title: "Fix the glossary hover",
    brief: { kind: "quoted", text: "Please fix the glossary hover so it stops flickering on narrow screens.", truncated: false },
    lastWords: { kind: "quoted", text: "I have the failing test; now for the fix in Tooltip.tsx.", truncated: true },
    uncertainty: ["lastActivity is only a floor", "a resume is not proof the work will finish"],
    nudge: NUDGE,
    account: { kind: "pinned", name: "mindstone", configDir: CONFIG_DIR },
    ...over,
  };
}

function projection(over: Partial<RecoveryResumeProjection> = {}): RecoveryResumeProjection {
  return { schema: 1, writtenAt: "2026-09-10T14:59:00.000Z", launcher: { kind: "wired" }, gate: null, pace: { kind: "free" }, requests: [], previews: [], orphans: [], pendingOverflow: 0, ...over };
}

const published = (p: RecoveryResumeProjection): RecoveryResumeSection => ({ kind: "published", projection: p });

function feed(records: RecoveryWireRecord[], resume: RecoveryResumeSection): Extract<RecoveryFeed, { kind: "published" }> {
  return {
    schema: 1,
    kind: "published",
    composedAt: "2026-09-10T15:00:00.000Z",
    path: "/store/recovery.json",
    writtenAt: "2026-09-10T14:59:00.000Z",
    view: { kind: "checked", checkedAt: CHECKED_AT, inventory: { kind: "trusted", collectedAt: "2026-09-10T14:57:00.000Z", rows: 3 } },
    replay: { kind: "ran", worldChanges: 0, derived: 0, scannedBytes: 10 },
    overflow: 0,
    total: records.length,
    unresolved: records.filter((r) => r.state.kind !== "resolved").length,
    olderCount: 0,
    records,
    resume,
  };
}

function api(view: RecoveryView, calls: { n: number } = { n: 0 }): RecoveryApi {
  return {
    fetch: () => {
      calls.n += 1;
      return Promise.resolve(view);
    },
  };
}

function resumeApi(answers: (() => Promise<ResumePostView>)[], posted: RecoveryResumePostBody[] = []): RecoveryResumeApi {
  return {
    post: (body) => {
      posted.push(body);
      const next = answers.shift();
      if (next === undefined) throw new Error("no answer left in the fake");
      return next();
    },
  };
}

const answered = (outcome: "queued" | "already-requested" | "already-launched", candidateId: string, status = outcome === "queued" ? 202 : 200): (() => Promise<ResumePostView>) => () =>
  Promise.resolve({ kind: "answered", status, answer: { ok: true, outcome, candidateId } });

async function show(view: RecoveryView, resume: RecoveryResumeApi = resumeApi([]), calls: { n: number } = { n: 0 }): Promise<void> {
  await act(async () => {
    root.render(<RecoveryPanel api={api(view, calls)} resumeApi={resume} nowMs={NOW} />);
  });
}

async function click(el: Element | null | undefined): Promise<void> {
  if (el === null || el === undefined) throw new Error("nothing to click");
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

const q = (sel: string, within: ParentNode = host): HTMLElement | null => within.querySelector(sel);
const all = (sel: string, within: ParentNode = host): HTMLElement[] => [...within.querySelectorAll<HTMLElement>(sel)];
const testId = (name: string, within: ParentNode = host): HTMLElement | null => q(`[data-testid="${name}"]`, within);
const openButtons = (): HTMLElement[] => all('[data-testid="recovery-resume-open"]');
const text = (): string => host.textContent ?? "";
const card = (recordId: string): HTMLElement => {
  const found = all('[data-testid="recovery-record"]').find((el) => el.textContent?.includes(`session-${recordId}`));
  if (found === undefined) throw new Error(`no card for ${recordId}`);
  return found;
};

/* ------------------------------------------------------------------ */

describe("Resume… appears only under all four conditions", () => {
  it("interrupted, supported, a wired launcher and a pinned account: Resume…", async () => {
    await show(feed([classified(id(1), "interrupted")], published(projection({ previews: [preview(id(1))] }))));
    expect(openButtons()).toHaveLength(1);
    expect(openButtons()[0]?.textContent).toBe("Resume…");
  });

  it("no control of any kind on unknown, present-but-unmatched or ended-before-reboot, even with supported evidence and a pinned preview", async () => {
    const records = [classified(id(1), "unknown"), classified(id(2), "present-but-unmatched"), classified(id(3), "ended-before-reboot")];
    await show(feed(records, published(projection({ previews: records.map((r) => preview(r.id)) }))));
    expect(all('[data-testid="recovery-record"]')).toHaveLength(3);
    expect(all("button")).toHaveLength(0);
    expect(all("a[href]")).toHaveLength(0);
    expect(testId("recovery-resume-manual")).toBeNull();
    expect(text()).not.toContain("--resume");
  });

  it("not supported: no Resume…", async () => {
    const evidence = supported({ resume: { kind: "not-supported", why: "the session ran headless" } });
    await show(feed([classified(id(1), "interrupted", evidence)], published(projection({ previews: [preview(id(1))] }))));
    expect(openButtons()).toHaveLength(0);
  });

  it("an unwired launcher: manual instructions, and one line saying why the page cannot resume it", async () => {
    const why = "the launch protocol is not composed into this daemon yet";
    await show(feed([classified(id(1), "interrupted")], published(projection({ launcher: { kind: "unwired", why }, previews: [preview(id(1))] }))));
    expect(openButtons()).toHaveLength(0);
    expect(testId("recovery-resume-manual")).not.toBeNull();
    expect(testId("recovery-resume-why-not")?.textContent).toContain(why);
  });

  it("the PROVEN default login: no Resume…, the plain claude --resume, no config directory and no account warning, and the why in words", async () => {
    const why = "started on the default login, which gjd-remote cannot relaunch by name";
    await show(feed([classified(id(1), "interrupted")], published(projection({ previews: [preview(id(1), { account: { kind: "unknown", reason: "default-login", why } })] }))));
    expect(openButtons()).toHaveLength(0);
    const command = testId("recovery-resume-manual-command")?.textContent ?? "";
    expect(command).toContain(`claude --resume ${CONVERSATION}`);
    expect(command).not.toContain("CLAUDE_CONFIG_DIR");
    expect(testId("recovery-resume-manual")?.textContent).toContain(why);
    expect(testId("recovery-resume-account-warning")).toBeNull();
  });

  it("G17: an account that is NOT established (unreadable, ambiguous, elsewhere): the plain command AND the warning that CLAUDE_CONFIG_DIR must name the transcript's account", async () => {
    for (const reason of ["ledger-unreadable", "ledger-ambiguous", "account-unusable", "transcript-elsewhere", "no-transcript"] as const) {
      const why = `the account is not established (${reason})`;
      await show(feed([classified(id(1), "interrupted")], published(projection({ previews: [preview(id(1), { account: { kind: "unknown", reason, why } })] }))));
      expect(openButtons()).toHaveLength(0);
      expect(testId("recovery-resume-manual-command")?.textContent).not.toContain("CLAUDE_CONFIG_DIR=");
      const warning = testId("recovery-resume-account-warning");
      expect({ reason, warned: warning !== null }).toEqual({ reason, warned: true });
      expect(warning?.textContent).toContain("CLAUDE_CONFIG_DIR");
    }
  });

  it("no preview for the record: no Resume…, manual instructions", async () => {
    await show(feed([classified(id(1), "interrupted")], published(projection())));
    expect(openButtons()).toHaveLength(0);
    expect(testId("recovery-resume-manual")).not.toBeNull();
  });

  it("the section absent: one quiet line, and no Resume…", async () => {
    await show(feed([classified(id(1), "interrupted")], { kind: "absent", why: "the recovery index carries no resume data" }));
    expect(openButtons()).toHaveLength(0);
    expect(testId("recovery-resume-absent")?.textContent).toBe("Resume is not available from this dashboard yet.");
    expect(testId("recovery-resume-banner")).toBeNull();
  });

  const alarms: [string, Extract<RecoveryResumeSection, { kind: "unreadable" | "unsupported-schema" }>][] = [
    ["unreadable", { kind: "unreadable", why: "requests[0] names rc-ghost, which the index does not hold" }],
    ["unsupported-schema", { kind: "unsupported-schema", saw: "2", known: 1, why: "the index's resume field says schema 2" }],
  ];
  for (const [name, section] of alarms) {
    it(`the section ${name}: an alarm banner above the list, and the list itself unchanged`, async () => {
      const records = [classified(id(1), "interrupted"), classified(id(2), "unknown")];
      await show(feed(records, section));
      const banner = testId("recovery-resume-banner");
      expect(banner?.textContent).toContain(section.why);
      expect(openButtons()).toHaveLength(0);
      expect(all('[data-testid="recovery-record"]').map((el) => el.getAttribute("data-state"))).toEqual(["interrupted", "unknown"]);
      // The banner comes before the first record.
      const first = all('[data-testid="recovery-record"]')[0];
      expect(banner !== null && first !== undefined && banner.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  }
});

describe("the inline confirmation", () => {
  const view = (): RecoveryFeed => feed([classified(id(1), "interrupted")], published(projection({ previews: [preview(id(1))] })));

  it("opens inline, not as a dialog, and shows every part", async () => {
    await show(view());
    expect(testId("recovery-resume-confirm")).toBeNull();
    await click(openButtons()[0]);
    const confirm = testId("recovery-resume-confirm");
    expect(confirm).not.toBeNull();
    expect(all('dialog, [role="dialog"]')).toHaveLength(0);
    const inside = confirm as HTMLElement;
    const brief = testId("recovery-resume-brief", inside);
    expect(brief?.textContent).toContain("Please fix the glossary hover so it stops flickering on narrow screens.");
    expect(brief?.textContent).toMatch(/quoted/i);
    const lastWords = testId("recovery-resume-last-words", inside);
    expect(lastWords?.textContent).toContain("I have the failing test; now for the fix in Tooltip.tsx.");
    expect(lastWords?.textContent).toMatch(/truncated/i);
    expect(all("li", testId("recovery-resume-uncertainty", inside) ?? inside).map((li) => li.textContent)).toEqual([
      "lastActivity is only a floor",
      "a resume is not proof the work will finish",
    ]);
    expect(testId("recovery-resume-account", inside)?.textContent).toBe("Runs under account mindstone");
    expect(testId("recovery-resume-nudge", inside)?.textContent).toBe(NUDGE);
    expect(testId("recovery-resume-dir", inside)?.textContent).toContain(DIR);
    expect(inside.textContent).toContain("Starts one session. Any others you pick wait until this one is verified running.");
    const submit = testId("recovery-resume-submit", inside);
    expect(submit?.textContent).toBe("Resume this session");
    expect(all("a[href]")).toHaveLength(0);
  });

  it("the tap posts once, with what the page showed; the button is disabled in flight; the answer is said plainly and the index is read again", async () => {
    let release!: (v: ResumePostView) => void;
    const posted: RecoveryResumePostBody[] = [];
    const fake = resumeApi([() => new Promise<ResumePostView>((resolve) => (release = resolve)), answered("already-requested", id(1))], posted);
    const calls = { n: 0 };
    await show(view(), fake, calls);
    await click(openButtons()[0]);
    await click(testId("recovery-resume-submit"));
    expect(posted).toEqual([{ candidateId: id(1), seen: { checkedAt: CHECKED_AT, conversationId: CONVERSATION, dir: DIR } }]);
    expect((testId("recovery-resume-submit") as HTMLButtonElement).disabled).toBe(true);
    // A second tap while in flight does nothing.
    await click(testId("recovery-resume-submit"));
    expect(posted).toHaveLength(1);
    const before = calls.n;
    await act(async () => {
      release({ kind: "answered", status: 202, answer: { ok: true, outcome: "queued", candidateId: id(1) } });
    });
    expect(testId("recovery-resume-outcome")?.textContent).toMatch(/^Queued\./);
    expect((testId("recovery-resume-submit") as HTMLButtonElement).disabled).toBe(false);
    expect(calls.n).toBeGreaterThan(before);

    await click(testId("recovery-resume-submit"));
    expect(posted).toHaveLength(2);
    expect(testId("recovery-resume-outcome")?.textContent).toMatch(/^Already requested/);
    expect(testId("recovery-resume-outcome")?.textContent).toContain("nothing new was queued");
  });

  it("a lost answer says it may still have been queued, and that the next refresh will show it", async () => {
    await show(view(), resumeApi([() => Promise.resolve({ kind: "no-answer", why: "no answer within 10s" })]));
    await click(openButtons()[0]);
    await click(testId("recovery-resume-submit"));
    expect(testId("recovery-resume-outcome")?.textContent).toMatch(/may still have been queued/);
  });

  it("a refusal is said with its reason", async () => {
    await show(view(), resumeApi([() => Promise.resolve({ kind: "answered", status: 403, answer: { ok: false, why: "Origin http://evil.example is not this server" } })]));
    await click(openButtons()[0]);
    await click(testId("recovery-resume-submit"));
    expect(testId("recovery-resume-outcome")?.textContent).toContain("Origin http://evil.example is not this server");
  });

  it("Cancel closes it without posting", async () => {
    const posted: RecoveryResumePostBody[] = [];
    await show(view(), resumeApi([], posted));
    await click(openButtons()[0]);
    await click(testId("recovery-resume-cancel"));
    expect(testId("recovery-resume-confirm")).toBeNull();
    expect(posted).toEqual([]);
  });
});

describe("a state line for each of the seven request states", () => {
  const requestedAt = "2026-09-10T14:50:00.000Z";
  const launch = { occurrenceId: "lo-7f3a9c", state: "observed-running" as const, attempt: 1, reservationHeld: false, disposed: false, endedAt: null, completion: null };
  const states: RecoveryResumeRequestState[] = [
    { kind: "pending", position: 2, requestedAt, actor: "dashboard", why: "the box's health is critical", until: "2026-09-10T15:30:00.000Z" },
    { kind: "launched", requestedAt, launch, verification: { inventoryResumed: true, observedRunning: true, transcriptGrew: false, sessionLineSeen: false }, waitingFor: "the transcript to grow" },
    { kind: "ended-unverified", requestedAt, launch: { ...launch, state: "completed", completion: { kind: "exit", code: 1 } }, how: "it exited with code 1 before it was seen running" },
    { kind: "needs-greg", requestedAt, launch: { ...launch, state: "outcome-unknown" }, why: "the launch's outcome is unknown", disposeCommand: "npx tsx scripts/overseer-launch.ts dispose lo-7f3a9c" },
    { kind: "refused", requestedAt, refusedAt: "2026-09-10T14:51:00.000Z", why: "the transcript is gone since the preview" },
    { kind: "disposed", requestedAt, launch: { ...launch, disposed: true } },
    { kind: "resumed", requestedAt, launch, verifiedAt: "2026-09-10T14:56:00.000Z" },
  ];
  const records = states.map((_, i) => classified(id(i + 1), "interrupted"));
  const p = projection({
    requests: states.map((state, i) => ({ candidateId: id(i + 1), name: `session-${id(i + 1)}`, state })),
    previews: records.map((r) => preview(r.id)),
    pace: { kind: "waiting-for-verification", candidateId: id(2), name: `session-${id(2)}`, since: "2026-09-10T14:52:00.000Z" },
  });

  const line = (recordId: string): HTMLElement | null => testId("recovery-resume-state", card(recordId));

  it("draws every arm, in plain words, on its own record", async () => {
    await show(feed(records, published(p)));
    expect(states.map((_, i) => line(id(i + 1))?.getAttribute("data-kind"))).toEqual(["pending", "launched", "ended-unverified", "needs-greg", "refused", "disposed", "resumed"]);

    const pending = line(id(1))?.textContent ?? "";
    expect(pending).toContain("the box's health is critical");
    expect(pending).toContain("2026-09-10T15:30:00.000Z");
    expect(pending).toContain("position 2");

    const launched = line(id(2)) as HTMLElement;
    expect(launched.textContent).toContain("the transcript to grow");
    expect(all('[data-ok="true"]', launched)).toHaveLength(2);
    expect(all('[data-ok="false"]', launched)).toHaveLength(2);
    expect(all("[data-ok]", launched).map((el) => el.textContent?.slice(0, 1))).toEqual(["✓", "✓", "✗", "✗"]);

    expect(line(id(3))?.textContent).toContain("it exited with code 1 before it was seen running");

    const needs = line(id(4)) as HTMLElement;
    expect(needs.textContent).toContain("the launch's outcome is unknown");
    expect(q("code", needs)?.textContent).toBe("npx tsx scripts/overseer-launch.ts dispose lo-7f3a9c");
    expect(all("a[href]", needs)).toHaveLength(0);

    expect(line(id(5))?.textContent).toContain("the transcript is gone since the preview");
    expect(line(id(6))?.textContent).toMatch(/disposed/);
    expect(line(id(7))?.textContent).toContain("2026-09-10T14:56:00.000Z");
  });

  it("Resume… is offered again on the refused record, and on no record whose request is anything else", async () => {
    await show(feed(records, published(p)));
    const offered = all('[data-testid="recovery-record"]').filter((el) => testId("recovery-resume-open", el) !== null);
    expect(offered).toEqual([card(id(5))]);
  });

  it("the pace line names the session everything is waiting for, above the list", async () => {
    await show(feed(records, published(p)));
    const pace = testId("recovery-pace");
    expect(pace?.textContent).toContain(`session-${id(2)}`);
    expect(pace?.textContent).toMatch(/verified running/);
    const first = all('[data-testid="recovery-record"]')[0];
    expect(pace !== null && first !== undefined && pace.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("no pace line when the pace is free", async () => {
    await show(feed(records, published({ ...p, pace: { kind: "free" } })));
    expect(testId("recovery-pace")).toBeNull();
  });
});

describe("G18, G19: what the queue holds that no card can show", () => {
  it("G18: a request for a record the index no longer holds is listed above the records, with its state and why, and the records are untouched", async () => {
    const gone = "rc-99999999999999999999";
    const why = "the recovery index no longer holds this record, so the request cannot be shown against it";
    await show(
      feed(
        [classified(id(1), "interrupted")],
        published(
          projection({
            previews: [preview(id(1))],
            orphans: [{ candidateId: gone, state: { kind: "pending", position: 1, requestedAt: "2026-09-10T14:50:00.000Z", actor: "dashboard", why: "being handled", until: null }, why }],
          }),
        ),
      ),
    );
    const orphans = testId("recovery-resume-orphans");
    expect(orphans).not.toBeNull();
    expect(orphans?.textContent).toContain(gone);
    expect(orphans?.textContent).toContain(why);
    expect(orphans?.textContent).toContain("Queued");
    expect(all('[data-testid="recovery-record"]')).toHaveLength(1);
    expect(openButtons()).toHaveLength(1);
  });

  it("G18: no orphans, no list", async () => {
    await show(feed([classified(id(1), "interrupted")], published(projection({ previews: [preview(id(1))] }))));
    expect(testId("recovery-resume-orphans")).toBeNull();
  });

  it("G19: a stuck blocker is named on the pace line with its exact dispose command", async () => {
    const disposeCommand = `npx tsx scripts/overseer-launches.ts dispose lo-7 --as not-running --why "<what you checked>"`;
    await show(
      feed(
        [classified(id(1), "interrupted")],
        published(projection({ pace: { kind: "stuck", candidateId: id(1), name: `session-${id(1)}`, state: "completed", why: "its launch slot has not been released", disposeCommand } })),
      ),
    );
    const pace = testId("recovery-pace");
    expect(pace?.textContent).toContain(`session-${id(1)}`);
    expect(pace?.textContent).toContain("its launch slot has not been released");
    expect(pace?.textContent).toContain(disposeCommand);
  });
});

describe("manual instructions", () => {
  it("a supported record the page cannot resume, pinned: gjd-remote ssh, cd into the quoted directory, and claude --resume under the account's config directory", async () => {
    await show(
      feed([classified(id(1), "interrupted")], published(projection({ launcher: { kind: "unwired", why: "not composed yet" }, previews: [preview(id(1))] }))),
    );
    const command = testId("recovery-resume-manual-command");
    expect(command?.tagName).toBe("CODE");
    expect(command?.closest("a")).toBeNull();
    expect(command?.textContent).toBe(
      ["gjd-remote ssh", `cd '/home/greg/code/spideryarn2/.claude/worktrees/greg'\\''s glossary fix'`, `CLAUDE_CONFIG_DIR=${CONFIG_DIR} claude --resume ${CONVERSATION}`].join("\n"),
    );
  });

  it("not supported, with a verified conversation: the plain command, and a note that the account must be the one holding the transcript", async () => {
    const evidence = supported({ resume: { kind: "not-supported", why: "the session ran headless" } });
    await show(feed([classified(id(1), "interrupted", evidence)], { kind: "absent", why: "no resume data" }));
    const manual = testId("recovery-resume-manual");
    expect(testId("recovery-resume-manual-command")?.textContent).toContain(`claude --resume ${CONVERSATION}`);
    expect(testId("recovery-resume-manual-command")?.textContent).not.toContain("CLAUDE_CONFIG_DIR");
    expect(manual?.textContent).toMatch(/config directory/);
  });

  it("not supported with only a claimed conversation: nothing", async () => {
    const evidence = supported({
      transcript: { kind: "found-under-claim", claimedConversationId: CONVERSATION, path: "/p/c.jsonl", mtime: null, why: "unverified" },
      resume: { kind: "not-supported", why: "no verified conversation" },
    });
    await show(feed([classified(id(1), "interrupted", evidence)], published(projection())));
    expect(testId("recovery-resume-manual")).toBeNull();
    expect(text()).not.toContain("--resume");
  });

  it("never built from an id that is not a strict uuid", async () => {
    const bad = ["../../x; rm -rf ~", "4E1C8B07-9A2D-4F63-B5E8-1D7C0A9F3E52", `${CONVERSATION} --dangerously-skip-permissions`, `${CONVERSATION}\n`, "not-a-uuid"];
    for (const conversationId of bad) {
      const notSupported = supported({
        transcript: { kind: "found", conversationId, path: "/p/c.jsonl", via: "scan", mtime: null },
        resume: { kind: "not-supported", why: "the session ran headless" },
      });
      const unwired = supported({
        transcript: { kind: "found", conversationId, path: "/p/c.jsonl", via: "scan", mtime: null },
        resume: { kind: "supported", conversationId, transcriptPath: "/p/c.jsonl" },
      });
      await show(
        feed(
          [classified(id(1), "interrupted", notSupported), classified(id(2), "interrupted", unwired)],
          published(projection({ launcher: { kind: "unwired", why: "not yet" }, previews: [preview(id(2), { conversationId })] })),
        ),
      );
      expect(testId("recovery-resume-manual-command"), conversationId).toBeNull();
      expect(text(), conversationId).not.toContain("claude --resume");
    }
  });

  it("manual keeps today's host-and-directory text, and no command", async () => {
    const evidence = supported({ resume: { kind: "manual", host: "gjd-box", dir: "/work/shell", why: "a shell job: only a place to go and look" } });
    await show(feed([classified(id(1), "interrupted", evidence)], published(projection())));
    expect(text()).toContain("on gjd-box, in /work/shell");
    expect(testId("recovery-resume-manual")).toBeNull();
    expect(text()).not.toMatch(/\bssh\b|\bcd \/|--resume/);
  });
});

describe("the footer", () => {
  it("says what the one control does, in the plan's words", async () => {
    await show(feed([], { kind: "absent", why: "none" }));
    expect(testId("recovery-footer")?.textContent).toBe(FOOTER);
    expect(q('[data-testid="recovery-footer"] strong')?.textContent).toBe("Resume");
  });

  it("and says it under every arm, including a failure", async () => {
    await show({ kind: "no-answer", why: "this browser could not reach the dashboard" });
    expect(testId("recovery-footer")?.textContent).toBe(FOOTER);
  });
});

describe("the client's resume section: its own arms, and never a hand on the records", () => {
  const records = [classified(id(1), "interrupted"), classified(id(2), "unknown")];
  const pending: RecoveryResumeRequestState = { kind: "pending", position: 1, requestedAt: "2026-09-10T14:50:00.000Z", actor: "dashboard", why: "gate", until: null };
  const resumed: RecoveryResumeRequestState = { kind: "resumed", requestedAt: null, launch: null, verifiedAt: "2026-09-10T14:56:00.000Z" };

  it("a whole projection passes as itself", () => {
    const body = feed(records, published(projection({ requests: [{ candidateId: id(1), name: `session-${id(1)}`, state: pending }], previews: [preview(id(1))] })));
    expect(parseRecoveryFeed(JSON.parse(JSON.stringify(body)))).toEqual(body);
  });

  it("a server that predates resume sends no section: absent, and the records exactly as sent", () => {
    const { resume: _resume, ...old } = feed(records, { kind: "absent", why: "x" });
    const parsed = parseRecoveryFeed(JSON.parse(JSON.stringify(old)));
    expect(parsed).toMatchObject({ kind: "published", resume: { kind: "absent" } });
    if (parsed.kind === "published") expect(parsed.records).toEqual(records);
  });

  const contradictions: [string, RecoveryResumeProjection][] = [
    [
      "two request states for one candidate",
      projection({
        requests: [
          { candidateId: id(1), name: `session-${id(1)}`, state: pending },
          { candidateId: id(1), name: `session-${id(1)}`, state: { kind: "refused", requestedAt: "2026-09-10T14:50:00.000Z", refusedAt: "2026-09-10T14:51:00.000Z", why: "x" } },
        ],
      }),
    ],
    [
      "a resumed state beside a pending one for the same candidate",
      projection({
        requests: [
          { candidateId: id(1), name: `session-${id(1)}`, state: resumed },
          { candidateId: id(1), name: `session-${id(1)}`, state: pending },
        ],
      }),
    ],
    [
      "two pending requests at one position",
      projection({
        requests: [
          { candidateId: id(1), name: `session-${id(1)}`, state: pending },
          { candidateId: id(2), name: `session-${id(2)}`, state: pending },
        ],
      }),
    ],
    ["a request under another record's name", projection({ requests: [{ candidateId: id(1), name: `session-${id(2)}`, state: pending }] })],
    ["two previews for one candidate", projection({ previews: [preview(id(1)), preview(id(1))] })],
    ["a preview whose conversation is not its record's", projection({ previews: [preview(id(1), { conversationId: "0a6d2f94-e7b3-4c18-9f52-b3e8a1d7c640" })] })],
  ];
  for (const [name, p] of contradictions) {
    it(`refuses ${name} as an unreadable section, and keeps the records`, () => {
      const parsed = parseRecoveryFeed(JSON.parse(JSON.stringify(feed(records, published(p)))));
      expect(parsed.kind).toBe("published");
      if (parsed.kind !== "published") return;
      expect(parsed.resume).toMatchObject({ kind: "unreadable", why: expect.stringMatching(/contradicts itself/) });
      expect(parsed.records).toEqual(records);
    });
  }

  it("a malformed section is unreadable, never a whole no-answer", () => {
    for (const bad of [{ kind: "published", projection: { schema: 1 } }, { kind: "published" }, { kind: "mystery" }, "yes", { kind: "unreadable" }]) {
      const parsed = parseRecoveryFeed({ ...JSON.parse(JSON.stringify(feed(records, { kind: "absent", why: "x" }))), resume: bad });
      expect(parsed.kind, JSON.stringify(bad)).toBe("published");
      if (parsed.kind === "published") {
        expect(parsed.resume.kind, JSON.stringify(bad)).toBe("unreadable");
        expect(parsed.records).toEqual(records);
      }
    }
  });
});

describe("the client's POST", () => {
  it("posts JSON to the route, and reads the answer for the candidate it asked about", async () => {
    const seen: { url: string; init: RequestInit | undefined }[] = [];
    const post = makeRecoveryResumeApi((input, init) => {
      seen.push({ url: String(input), init });
      return Promise.resolve(new Response(JSON.stringify({ ok: true, outcome: "queued", candidateId: id(1) }), { status: 202 }));
    });
    const body: RecoveryResumePostBody = { candidateId: id(1), seen: { checkedAt: CHECKED_AT, conversationId: CONVERSATION, dir: DIR } };
    expect(await post.post(body)).toEqual({ kind: "answered", status: 202, answer: { ok: true, outcome: "queued", candidateId: id(1) } });
    expect(seen[0]?.url).toBe(RECOVERY_RESUME_URL);
    expect(seen[0]?.init?.method).toBe("POST");
    expect((seen[0]?.init?.headers as Record<string, string> | undefined)?.["content-type"]).toBe("application/json");
    expect(JSON.parse(String(seen[0]?.init?.body))).toEqual(body);
  });

  it("an answer about another candidate, or of an unknown shape, is no answer", () => {
    expect(parseResumePostAnswer({ ok: true, outcome: "queued", candidateId: id(2) }, id(1))).toBeNull();
    expect(parseResumePostAnswer({ ok: true, outcome: "launched-twice", candidateId: id(1) }, id(1))).toBeNull();
    expect(parseResumePostAnswer({ ok: false, why: "no" }, id(1))).toEqual({ ok: false, why: "no" });
  });

  it("a network failure is the browser's own no-answer", async () => {
    const post = makeRecoveryResumeApi(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await post.post({ candidateId: id(1), seen: { checkedAt: CHECKED_AT, conversationId: CONVERSATION, dir: DIR } })).toMatchObject({ kind: "no-answer" });
  });
});
