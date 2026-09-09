/**
 * Telling the Overseer a session was started from the web UI.
 *
 * **Nothing here touches tmux, a pane or a gateway.** `send` is injected, and
 * the claim and the rows are handed in by the caller that read them from one
 * snapshot — so every arm of `NotifyOutcome`, including the ones that are hard
 * to provoke on a real box, is reachable here.
 *
 * The arms that matter most are the ones that are NOT a send: nobody holding
 * the role, two sessions holding it, and a holder we cannot address. Each is a
 * different fact, and the point of the union is that the launch record cannot
 * flatten them into "not sent".
 */
import { describe, expect, it } from "vitest";

import { renderMessage } from "../tools/fleet/actions.js";
import {
  NOTIFY_SPEAKER,
  PROMPT_EXCERPT_CHARS,
  describeNotify,
  notifyLine,
  notifyOverseer,
  promptExcerpt,
  type AddressableRow,
  type NotifyDeps,
} from "../tools/fleet/notify-overseer.js";

function row(over: Partial<AddressableRow> = {}): AddressableRow {
  return {
    id: "$7",
    name: "Overseer",
    paneId: "%42",
    panePid: 1234,
    claudeSessionId: "117e181a-155b-435a-b95b-e74220678d1a",
    status: { kind: "idle" },
    ...over,
  };
}

/** A `send` that records what it was given and answers however the test says. */
function recordingSend(
  answer: Awaited<ReturnType<NotifyDeps["send"]>> | Error = { ok: true },
): { send: NotifyDeps["send"]; sent: { text: string; paneId: string }[] } {
  const sent: { text: string; paneId: string }[] = [];
  const send: NotifyDeps["send"] = async (target, text) => {
    sent.push({ text, paneId: target.paneId });
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { send, sent };
}

const LINE = "A new session was started from the web UI at 100.92.255.119: fb2p-thing.";

/**
 * A speaker's prefix, derived from `renderMessage` rather than imported.
 *
 * `SPEAKER_PREFIX` is private to actions.ts, and exporting it so a test could
 * read it would create a second way to know one string — the twin this whole
 * area keeps repairing. Asking the real function what it prepends is both
 * cheaper and stronger: if the prefix changes, this follows it, and if
 * `renderMessage` stops prefixing at all, every assertion below fails.
 */
function prefixOf(speaker: "greg" | "overseer" | "dashboard"): string {
  const rendered = renderMessage("x", speaker);
  if (!rendered.ok) throw new Error(`renderMessage refused a plain word from ${speaker}: ${rendered.why}`);
  return rendered.text.slice(0, -1);
}

describe("who the notification goes to, and the four ways it does not go", () => {
  it("submits to the holder, and says submitted rather than sent", async () => {
    const { send, sent } = recordingSend();
    const outcome = await notifyOverseer({ claim: { kind: "one", name: "Overseer", id: "$7" }, rows: [row()], send }, LINE);

    expect(outcome).toEqual({ kind: "submitted", to: "Overseer", paneId: "%42" });
    expect(sent).toHaveLength(1);
    expect(sent[0]?.paneId).toBe("%42");
    /* The word this codebase is not allowed to use about keystrokes. */
    expect(describeNotify(outcome)).not.toMatch(/\bsent\b/);
    expect(describeNotify(outcome)).toContain("submitted");
  });

  it("sends nothing when nobody holds the role, and that is an answer rather than a failure", async () => {
    const { send, sent } = recordingSend();
    const outcome = await notifyOverseer({ claim: { kind: "none" }, rows: [row()], send }, LINE);

    expect(outcome).toEqual({ kind: "no-holder" });
    expect(sent).toEqual([]);
  });

  /** Picking one would make this code the arbiter of a question it cannot answer. */
  it("refuses to choose when the role is contested", async () => {
    const { send, sent } = recordingSend();
    const outcome = await notifyOverseer(
      { claim: { kind: "contested", names: ["Overseer", "overseer-2"] }, rows: [row()], send },
      LINE,
    );

    expect(outcome).toEqual({ kind: "contested", names: ["Overseer", "overseer-2"] });
    expect(sent).toEqual([]);
    expect(describeNotify(outcome)).toContain("overseer-2");
  });

  it("keeps cannot-tell separate from no-holder", async () => {
    const { send } = recordingSend();
    const outcome = await notifyOverseer(
      { claim: { kind: "cannot-tell", why: "the snapshot was 4m old" }, rows: [], send },
      LINE,
    );

    expect(outcome).toEqual({ kind: "cannot-tell", why: "the snapshot was 4m old" });
    /* The distinction the whole union exists for: not knowing is not the same
       as knowing there is nobody. */
    expect(outcome.kind).not.toBe("no-holder");
  });

  it("cannot tell when the claim names a session that is not in the snapshot it came from", async () => {
    const { send, sent } = recordingSend();
    const outcome = await notifyOverseer(
      { claim: { kind: "one", name: "Overseer", id: "$99" }, rows: [row({ id: "$7" })], send },
      LINE,
    );

    expect(outcome.kind).toBe("cannot-tell");
    expect(sent).toEqual([]);
  });

  it("cannot tell when the holder has no pane to address", async () => {
    const { send, sent } = recordingSend();
    const outcome = await notifyOverseer(
      { claim: { kind: "one", name: "Overseer", id: "$7" }, rows: [row({ paneId: null })], send },
      LINE,
    );

    expect(outcome.kind).toBe("cannot-tell");
    if (outcome.kind === "cannot-tell") expect(outcome.why).toContain("pane");
    expect(sent).toEqual([]);
  });

  it("carries the refusal code and the delivery word through", async () => {
    const { send } = recordingSend({ ok: false, code: "input-not-empty", why: "the box already holds text", delivery: "none" });
    const outcome = await notifyOverseer({ claim: { kind: "one", name: "Overseer", id: "$7" }, rows: [row()], send }, LINE);

    expect(outcome).toMatchObject({ kind: "refused", code: "input-not-empty", delivery: "none" });
    expect(describeNotify(outcome)).toContain("none");
  });

  /**
   * A throw after the send began cannot distinguish "nothing happened" from
   * "half of it did", so it is `unknown` and never `refused`. Calling it a
   * refusal is the one claim this code is never allowed to make.
   */
  it("says unknown, not refused, when the send throws", async () => {
    const { send } = recordingSend(new Error("the child process died"));
    const outcome = await notifyOverseer({ claim: { kind: "one", name: "Overseer", id: "$7" }, rows: [row()], send }, LINE);

    expect(outcome.kind).toBe("unknown");
    expect(describeNotify(outcome)).toContain("not known");
  });
});

describe("what the notification says, and what it may not", () => {
  it("goes as the dashboard, which is neither Greg nor the Overseer", async () => {
    const { send, sent } = recordingSend();
    await notifyOverseer({ claim: { kind: "one", name: "Overseer", id: "$7" }, rows: [row()], send }, LINE);

    const text = sent[0]?.text ?? "";
    expect(NOTIFY_SPEAKER).toBe("dashboard");
    expect(text.startsWith(prefixOf("dashboard"))).toBe(true);
    expect(text).not.toContain(prefixOf("greg"));
    expect(text).not.toContain(prefixOf("overseer"));
  });

  /**
   * `renderMessage` refuses a leading slash from any speaker but Greg, so a
   * composed notice that began with one would be unsendable. The prefix is what
   * keeps that from happening; this asserts it rather than trusting it.
   */
  it("never begins with a slash, even when the prompt does", () => {
    const line = notifyLine({
      sessionName: "x",
      origin: null,
      dir: null,
      promptFirstLine: promptExcerpt("/compact and then keep going"),
    });
    const composed = `${prefixOf("dashboard")}${line}`;
    expect(composed.startsWith("/")).toBe(false);
    expect(line.startsWith("/")).toBe(false);
  });

  it("is one line, because a newline would submit it early", () => {
    const line = notifyLine({
      sessionName: "x",
      origin: "100.92.255.119",
      dir: "/home/greg/code/spideryarn2",
      promptFirstLine: promptExcerpt("do the thing\nand then the other thing"),
    });
    expect(line).not.toContain("\n");
    expect(line).not.toContain("\r");
  });

  it("takes only the first line of the prompt and bounds it", () => {
    expect(promptExcerpt("first line\nsecond line")).toBe("first line");
    const long = promptExcerpt("x".repeat(500));
    expect(long).not.toBeNull();
    expect((long ?? "").length).toBeLessThanOrEqual(PROMPT_EXCERPT_CHARS);
  });

  it("turns a control character into a space rather than losing the whole notice", () => {
    /* Built by code point so this test file has no raw control bytes in it
       either — the first draft of the module put a literal NUL in the source
       and made the file binary to grep. */
    const withTab = `do the${String.fromCharCode(9)}thing`;
    const excerpt = promptExcerpt(withTab);
    expect(excerpt).toBe("do the thing");
    for (const ch of excerpt ?? "") expect(ch.codePointAt(0)).toBeGreaterThanOrEqual(0x20);
  });

  it("says the prompt's first line was empty rather than pretending there was one", () => {
    expect(promptExcerpt("   \n  something")).toBeNull();
    const line = notifyLine({ sessionName: "x", origin: null, dir: null, promptFirstLine: null });
    expect(line).toContain("empty");
  });

  it("names the origin, because there is no authentication and it was not necessarily Greg", () => {
    const line = notifyLine({ sessionName: "n", origin: "100.92.255.119", dir: null, promptFirstLine: "hi" });
    expect(line).toContain("100.92.255.119");
    expect(line).not.toContain("Greg");
  });
});
