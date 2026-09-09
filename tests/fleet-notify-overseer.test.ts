/**
 * Telling the Overseer a session was started from the web UI.
 *
 * **Nothing here touches tmux, a pane or a queue.** The enqueue is injected, and
 * the claim and the rows are handed in by the caller that read them from one
 * snapshot — so every arm of `NotifyOutcome`, including the ones that are hard
 * to provoke on a real box, is reachable here.
 *
 * The arms that matter most are the ones that are NOT a delivery: nobody holding
 * the role, two sessions holding it, a holder we cannot address, and a queue that
 * would not take the message. Each is a different fact, and the point of the
 * union is that the launch record cannot flatten them into "not sent".
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

/** An enqueue that records what it was given and answers however the test says. */
function recordingEnqueue(answer: ReturnType<NotifyDeps["enqueue"]> = { ok: true, position: 1 }): {
  enqueue: NotifyDeps["enqueue"];
  queued: { sessionId: string; text: string; speaker: string }[];
} {
  const queued: { sessionId: string; text: string; speaker: string }[] = [];
  const enqueue: NotifyDeps["enqueue"] = (target, text, speaker) => {
    queued.push({ sessionId: target.sessionId, text, speaker });
    return answer;
  };
  return { enqueue, queued };
}

const LINE = "A new session was started from the web UI at 100.92.255.119: fb2p-thing.";

/**
 * A speaker's prefix, derived from `renderMessage` rather than imported.
 *
 * `SPEAKER_PREFIX` is private to actions.ts, and exporting it so a test could
 * read it would create a second way to know one string — the twin this whole
 * area keeps repairing. Asking the real function what it prepends is both
 * cheaper and stronger: if the prefix changes this follows it, and if
 * `renderMessage` stops prefixing at all, every assertion below fails.
 */
function prefixOf(speaker: "greg" | "overseer" | "dashboard"): string {
  const rendered = renderMessage("x", speaker);
  if (!rendered.ok) throw new Error(`renderMessage refused a plain word from ${speaker}: ${rendered.why}`);
  return rendered.text.slice(0, -1);
}

describe("who the notification goes to, and the four ways it does not", () => {
  it("queues it for the holder, and claims no more than that", async () => {
    const { enqueue, queued } = recordingEnqueue({ ok: true, position: 3 });
    const outcome = await notifyOverseer(
      { claim: { kind: "one", name: "Overseer", id: "$7" }, rows: [row()], enqueue },
      LINE,
    );

    expect(outcome).toEqual({ kind: "queued", to: "Overseer", position: 3 });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.sessionId).toBe("$7");
    /* Nothing here can say the Overseer was told, and the words must not either. */
    const said = describeNotify(outcome);
    expect(said).not.toMatch(/\bsent\b/);
    expect(said).not.toMatch(/\bdelivered\b/);
    expect(said).toContain("queued");
  });

  it("queues nothing when nobody holds the role, and that is an answer rather than a failure", async () => {
    const { enqueue, queued } = recordingEnqueue();
    const outcome = await notifyOverseer({ claim: { kind: "none" }, rows: [row()], enqueue }, LINE);

    expect(outcome).toEqual({ kind: "no-holder" });
    expect(queued).toEqual([]);
  });

  /** Picking one would make this code the arbiter of a question it cannot answer. */
  it("refuses to choose when the role is contested", async () => {
    const { enqueue, queued } = recordingEnqueue();
    const outcome = await notifyOverseer(
      { claim: { kind: "contested", names: ["Overseer", "overseer-2"] }, rows: [row()], enqueue },
      LINE,
    );

    expect(outcome).toEqual({ kind: "contested", names: ["Overseer", "overseer-2"] });
    expect(queued).toEqual([]);
    expect(describeNotify(outcome)).toContain("overseer-2");
  });

  it("keeps cannot-tell separate from no-holder", async () => {
    const { enqueue } = recordingEnqueue();
    const outcome = await notifyOverseer(
      { claim: { kind: "cannot-tell", why: "the snapshot was 4m old" }, rows: [], enqueue },
      LINE,
    );

    expect(outcome).toEqual({ kind: "cannot-tell", why: "the snapshot was 4m old" });
    /* The distinction the whole union exists for: not knowing is not the same
       as knowing there is nobody. */
    expect(outcome.kind).not.toBe("no-holder");
  });

  it("cannot tell when the claim names a session that is not in the snapshot it came from", async () => {
    const { enqueue, queued } = recordingEnqueue();
    const outcome = await notifyOverseer(
      { claim: { kind: "one", name: "Overseer", id: "$99" }, rows: [row({ id: "$7" })], enqueue },
      LINE,
    );

    expect(outcome.kind).toBe("cannot-tell");
    expect(queued).toEqual([]);
  });

  it("cannot tell when the holder has no conversation id to address", async () => {
    const { enqueue, queued } = recordingEnqueue();
    const outcome = await notifyOverseer(
      { claim: { kind: "one", name: "Overseer", id: "$7" }, rows: [row({ claudeSessionId: null })], enqueue },
      LINE,
    );

    expect(outcome.kind).toBe("cannot-tell");
    expect(queued).toEqual([]);
  });

  /**
   * `rule` travels rather than being flattened. A full queue is a fact about
   * THIS recipient; `bad-text` is a fact about the MESSAGE and would fail
   * identically for anyone. A record that could not tell them apart could render
   * neither honestly — the lossy-join half of 260908b.
   */
  it("carries the queue's own refusal rule through to the record", async () => {
    const { enqueue } = recordingEnqueue({ ok: false, rule: "session-queue-full", why: "eight already waiting" });
    const outcome = await notifyOverseer(
      { claim: { kind: "one", name: "Overseer", id: "$7" }, rows: [row()], enqueue },
      LINE,
    );

    expect(outcome).toMatchObject({ kind: "not-queued", to: "Overseer", rule: "session-queue-full" });
    expect(describeNotify(outcome)).toContain("session-queue-full");
  });
});

describe("what reaches the queue, and what must not", () => {
  /**
   * **THE RAW LINE, NOT A RENDERED ONE.** `enqueueMessage` applies
   * `renderMessage` itself and `drain.ts` renders again at delivery, so handing
   * over an already-prefixed string prefixes it twice — which reads as clumsy
   * rather than as a bug and fails nothing. This is the assertion that stops it
   * being reintroduced by somebody tidying the composition into one place.
   */
  it("hands the queue raw text and the speaker, never a pre-rendered string", async () => {
    const { enqueue, queued } = recordingEnqueue();
    await notifyOverseer({ claim: { kind: "one", name: "Overseer", id: "$7" }, rows: [row()], enqueue }, LINE);

    const text = queued[0]?.text ?? "";
    expect(text).toBe(LINE);
    expect(text).not.toContain(prefixOf("dashboard"));
    expect(text).not.toContain(prefixOf("greg"));
    expect(text).not.toContain(prefixOf("overseer"));
    /* And the attribution is not lost by staying out of it — the speaker travels
       and the queue is where it is applied. */
    expect(queued[0]?.speaker).toBe("dashboard");
    expect(NOTIFY_SPEAKER).toBe("dashboard");
  });

  /**
   * `renderMessage` refuses a leading slash from any speaker but Greg, so a
   * composed notice beginning with one would be refused at enqueue. Our own
   * words come first, which is what keeps that from happening.
   */
  it("never begins with a slash, even when the prompt does", () => {
    const line = notifyLine({
      sessionName: "x",
      origin: null,
      dir: null,
      promptFirstLine: promptExcerpt("/compact and then keep going"),
    });
    expect(line.startsWith("/")).toBe(false);
    expect(`${prefixOf("dashboard")}${line}`.startsWith("/")).toBe(false);
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
